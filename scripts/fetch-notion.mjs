// ビルド前に実行するスクリプト。Notionから「公開」チェックがオンの記事だけを取得し、
// 画像はすべてローカルにダウンロードした上で .notion-cache/posts.json に書き出す。
// Astro側（src/lib/posts.ts）はこのJSONを読むだけで、ビルド中にNotionへは一切アクセスしない。
//
// 実行方法: npm run fetch-notion （npm run build の中で自動的に呼ばれます）
// 必要な環境変数: NOTION_TOKEN, NOTION_DATABASE_ID

import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveDataSourceId,
  queryAllPages,
  fetchBlockChildrenRecursive,
} from "./lib/notion-client.mjs";
import {
  PROP,
  getTitleText,
  getRichTextPlain,
  getCheckbox,
  getMultiSelectNames,
  getDateISO,
  getFirstFileUrl,
  resolveSlug,
  makeAnchorFactory,
  transformBlocks,
  downloadImage,
  extractExcerpt,
} from "./lib/transform.mjs";

const CACHE_DIR = path.resolve(process.cwd(), ".notion-cache");
const CACHE_FILE = path.join(CACHE_DIR, "posts.json");

async function writeEmptyCache(reason) {
  console.warn(`\n[fetch-notion] ${reason}`);
  console.warn("[fetch-notion] 記事0件のダミーキャッシュを書き出してビルドを継続します。\n");
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    CACHE_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), posts: [], error: reason }, null, 2),
  );
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

  const posts = [];
  for (const page of rawPages) {
    const title = getTitleText(page, PROP.title) || "(無題)";
    console.log(`  - ${title}`);

    const slug = resolveSlug(getRichTextPlain(page, PROP.slug), page.id, title);
    const tags = getMultiSelectNames(page, PROP.tags);
    const publishedAt = getDateISO(page, PROP.publishedAt) || page.created_time;
    const updatedAt = getDateISO(page, PROP.updatedAt) || page.last_edited_time;

    const thumbnailSourceUrl = getFirstFileUrl(page, PROP.thumbnail);
    const thumbnail = thumbnailSourceUrl
      ? await downloadImage(thumbnailSourceUrl, `thumb-${page.id}`)
      : null;

    const rawBlocks = await fetchBlockChildrenRecursive(token, page.id);
    const makeAnchor = makeAnchorFactory();
    const blocks = await transformBlocks(rawBlocks, makeAnchor, page.id);

    const description = getRichTextPlain(page, PROP.description).trim() || extractExcerpt(blocks);

    posts.push({
      id: page.id,
      slug,
      title,
      description,
      tags,
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
    JSON.stringify({ generatedAt: new Date().toISOString(), posts }, null, 2),
  );

  console.log(`[fetch-notion] 完了: ${posts.length}件を .notion-cache/posts.json に書き出しました。`);
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
