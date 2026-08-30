// ビルド前に実行するスクリプト。Notionから「公開」チェックがオンの記事だけを取得し、
// 画像はすべてローカルにダウンロードした上で .notion-cache/posts.json に書き出す。
// Astro側（src/lib/posts.ts）はこのJSONを読むだけで、ビルド中にNotionへは一切アクセスしない。
//
// 実行方法: npm run fetch-notion （npm run build の中で自動的に呼ばれます）
// 必要な環境変数: NOTION_TOKEN, NOTION_DATABASE_ID
// 任意の環境変数: NOTION_CATEGORIES_DATABASE_ID（未設定でもビルドは止まらず、カテゴリ機能が空になるだけ）

import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveDataSourceId,
  queryAllPages,
  fetchBlockChildrenRecursive,
  getRelationNames,
  getFirstRelationName,
} from "./lib/notion-client.mjs";
import {
  PROP,
  CATEGORY_PROP,
  getTitleText,
  getRichTextPlain,
  getCheckbox,
  getSelectColor,
  getDateISO,
  getFirstFileUrl,
  resolveSlug,
  makeAnchorFactory,
  transformBlocks,
  downloadImage,
  generateFallbackThumbnail,
  resolveCategoryBackgroundDataUri,
  extractExcerpt,
  buildNotionLinkMap,
} from "./lib/transform.mjs";

const CACHE_DIR = path.resolve(process.cwd(), ".notion-cache");
const CACHE_FILE = path.join(CACHE_DIR, "posts.json");

async function writeEmptyCache(reason) {
  console.warn(`\n[fetch-notion] ${reason}`);
  console.warn("[fetch-notion] 記事0件のダミーキャッシュを書き出してビルドを継続します。\n");
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    CACHE_FILE,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), posts: [], categories: [], error: reason },
      null,
      2,
    ),
  );
}

/**
 * マスターカテゴリDB（記事DBの「カテゴリ」リレーション先）を取得する。
 * NOTION_CATEGORIES_DATABASE_ID が未設定の場合は、カテゴリページ機能を使っていないとみなし、
 * 記事の取得は止めずに空配列を返す（カテゴリナビ・カテゴリページが空で表示されるだけで、サイト自体は壊れない）。
 *
 * 各カテゴリページ本文（「説明文」プロパティより下に書かれている記事本文）もブロックとして取得し、
 * カテゴリページ下部にそのカテゴリの解説記事として表示できるようにする。
 */
async function fetchCategories(token, linkMap) {
  const databaseId = process.env.NOTION_CATEGORIES_DATABASE_ID;
  if (!databaseId) {
    console.warn(
      "[fetch-notion] NOTION_CATEGORIES_DATABASE_ID が未設定のため、カテゴリ一覧は空のまま続行します。",
    );
    return [];
  }

  console.log("[fetch-notion] カテゴリ一覧を取得中…");
  const dataSourceId = await resolveDataSourceId(token, databaseId);
  const rawPages = await queryAllPages(token, dataSourceId, {});

  const categories = [];
  for (const page of rawPages) {
    const name = getTitleText(page, CATEGORY_PROP.name) || "(無題カテゴリ)";
    const description = getRichTextPlain(page, CATEGORY_PROP.description);
    const representativeSlugRaw = getRichTextPlain(page, CATEGORY_PROP.representativeSlug).trim();
    // サムネイル自動生成の背景として使う。「背景画像ファイル名」が実在すればそれを優先し、
    // 無ければ「テーマカラー」セレクトプロパティの色でグラデーションにフォールバックする。
    const backgroundImageFilename = getRichTextPlain(page, CATEGORY_PROP.backgroundImage).trim();
    const themeColor = getSelectColor(page, CATEGORY_PROP.themeColor);

    const rawBlocks = await fetchBlockChildrenRecursive(token, page.id);
    const makeAnchor = makeAnchorFactory();
    const blocks = await transformBlocks(rawBlocks, makeAnchor, page.id, linkMap);

    categories.push({
      name,
      description,
      representativeSlug: representativeSlugRaw || null,
      themeColor,
      backgroundImageFilename,
      blocks,
    });
  }

  // マスターカテゴリDBには並び順専用のプロパティが無く、Notion APIはテーブル表示上の手動並び順を
  // 取得する手段を提供していない。そのため「代表記事（Slug）」（kiji1, kiji2, …のように記事の
  // 作成順と揃えて命名する運用になっている）を並び順の代わりに使い、自然順（数値部分を数値として比較）で
  // ソートする。代表記事Slugが無いカテゴリは末尾にまとめ、Notion側の取得順を保つ。
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const withSlug = categories.filter((c) => c.representativeSlug);
  const withoutSlug = categories.filter((c) => !c.representativeSlug);
  withSlug.sort((a, b) => collator.compare(a.representativeSlug, b.representativeSlug));
  return [...withSlug, ...withoutSlug];
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    await writeEmptyCache(
      "NOTION_TOKEN または NOTION_DATABASE_ID が設定されていません（.env / GitHub Secrets を確認してください）。",
    );
    return;
  }

  console.log("[fetch-notion] データソースIDを取得中…");
  const dataSourceId = await resolveDataSourceId(token, databaseId);

  console.log("[fetch-notion] 公開記事の一覧を取得中…");
  let rawPages;
  try {
    rawPages = await queryAllPages(token, dataSourceId, {
      filter: { property: PROP.published, checkbox: { equals: true } },
      sorts: [{ property: PROP.publishedAt, direction: "descending" }],
    });
  } catch (err) {
    console.warn(
      `[fetch-notion] フィルター/ソート付きの取得に失敗しました（プロパティ名や型を確認してください）: ${err.message}`,
    );
    console.warn("[fetch-notion] フィルターなしで全件取得し、あとでJS側で絞り込みます…");
    const allPages = await queryAllPages(token, dataSourceId, {});
    rawPages = allPages.filter((p) => getCheckbox(p, PROP.published));
  }

  console.log(`[fetch-notion] ${rawPages.length}件の公開記事を処理します。`);

  // 本文中で「@」から他の記事・資料ページをメンションしてリンクを貼れるようにするための
  // NotionページID → サイト内URL のマップ。カテゴリ・記事のブロック変換より先に作っておく必要がある。
  console.log("[fetch-notion] 記事間リンク用のマップを作成中…");
  const linkMap = await buildNotionLinkMap(token);

  // 自動生成サムネイルの背景をカテゴリ名から引けるように、記事処理より先にカテゴリ一覧を取得しておく。
  const categories = await fetchCategories(token, linkMap);
  const categoryBackgroundMap = new Map();
  for (const c of categories) {
    const dataUri = await resolveCategoryBackgroundDataUri(c.backgroundImageFilename);
    categoryBackgroundMap.set(c.name, { dataUri, colorKey: c.themeColor });
  }

  const posts = [];
  for (const page of rawPages) {
    const title = getTitleText(page, PROP.title) || "(無題)";
    console.log(`  - ${title}`);

    const slug = resolveSlug(getRichTextPlain(page, PROP.slug), page.id, title);
    // タグ・メインタグ・カテゴリは「マスタータグ」「マスターカテゴリ」DBとのリレーションプロパティ。
    // 値には関連ページのIDしか入っていないため、関連ページを取得して名前に解決する。
    const tags = await getRelationNames(token, page, PROP.tags);
    const mainTag = await getFirstRelationName(token, page, PROP.mainTag);
    // カテゴリは複数選択可のリレーション。全件を categories に保持しつつ、
    // 単一バッジ表示用に先頭1件を category としても残す。
    const categories = await getRelationNames(token, page, PROP.category);
    const category = categories[0] || null;
    const publishedAt = getDateISO(page, PROP.publishedAt) || page.created_time;
    const updatedAt = getDateISO(page, PROP.updatedAt) || page.last_edited_time;

    // 「サムネイル画像」に実ファイルがアップロードされていればそれを優先。
    // 未設定の場合は、カテゴリのテーマカラー＋「サムネ用タイトル/サブタイトル」から自動生成する。
    const thumbnailSourceUrl = getFirstFileUrl(page, PROP.thumbnail);
    let thumbnail = thumbnailSourceUrl ? await downloadImage(thumbnailSourceUrl, `thumb-${page.id}`) : null;
    if (!thumbnail) {
      const thumbnailTitle = getRichTextPlain(page, PROP.thumbnailTitle).trim() || title;
      const thumbnailSubtitle = getRichTextPlain(page, PROP.thumbnailSubtitle).trim();
      // 記事に複数カテゴリが設定されている場合も、他のカテゴリ表示と同じく最初の1件を使う。
      const background = categoryBackgroundMap.get(category) || { dataUri: null, colorKey: "default" };
      thumbnail = await generateFallbackThumbnail(page.id, background, thumbnailTitle, thumbnailSubtitle);
    }

    const rawBlocks = await fetchBlockChildrenRecursive(token, page.id);
    const makeAnchor = makeAnchorFactory();
    const blocks = await transformBlocks(rawBlocks, makeAnchor, page.id, linkMap);

    const description = getRichTextPlain(page, PROP.description).trim() || extractExcerpt(blocks);

    posts.push({
      id: page.id,
      slug,
      title,
      description,
      tags,
      mainTag,
      category,
      categories,
      publishedAt,
      updatedAt,
      thumbnail,
      blocks,
    });
  }

  // スラッグの重複チェック（重複していると同じURLに2記事が衝突してビルドが壊れるため）
  const slugCounts = new Map();
  for (const p of posts) slugCounts.set(p.slug, (slugCounts.get(p.slug) || 0) + 1);
  for (const [slug, count] of slugCounts) {
    if (count > 1) {
      console.warn(
        `[fetch-notion] 警告: スラッグ "${slug}" が${count}件の記事で重複しています。Notion側で「スラッグ」を見直してください。`,
      );
    }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    CACHE_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), posts, categories }, null, 2),
  );

  console.log(
    `[fetch-notion] 完了: 記事${posts.length}件・カテゴリ${categories.length}件を .notion-cache/posts.json に書き出しました。`,
  );
}

main().catch((err) => {
  console.error("\n[fetch-notion] エラーが発生しました。ビルドを中止します:");
  console.error(err);
  // ここで空データにフォールバックしてビルドを続けてしまうと、Notion側の一時的な不調で
  // 「記事が0件の空サイト」を本番に上書きデプロイしてしまう危険がある。
  // それよりは今回のデプロイを止めて、前回公開したサイトをそのまま残すほうが安全なため、
  // 環境変数が未設定の場合（開発者がNotionなしでUI確認したいケース）以外は失敗させる。
  process.exit(1);
});
