// ビルド前に実行するスクリプト。Notionの「資料DB」から「公開」チェックがオンの資料だけを取得し、
// サムネイル・資料ファイルをローカルにダウンロードした上で .notion-cache/resources.json に書き出す。
// Astro側（src/lib/resources.ts）はこのJSONを読むだけで、ビルド中にNotionへは一切アクセスしない。
// scripts/fetch-notion.mjs（ブログ記事用）の資料版です。
//
// 実行方法: npm run fetch-notion-resources （npm run build の中で自動的に呼ばれます）
// 必要な環境変数: NOTION_TOKEN, NOTION_RESOURCES_DATABASE_ID

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
  RESOURCE_PROP,
  getTitleText,
  getRichTextPlain,
  getCheckbox,
  getDateISO,
  resolveSlug,
  makeAnchorFactory,
  transformBlocks,
  resolveLocalRepoFile,
  generateResourcePreviewImages,
  splitBulletLines,
  buildNotionLinkMap,
} from "./lib/transform.mjs";

const CACHE_DIR = path.resolve(process.cwd(), ".notion-cache");
const CACHE_FILE = path.join(CACHE_DIR, "resources.json");

async function writeEmptyCache(reason) {
  console.warn(`\n[fetch-notion-resources] ${reason}`);
  console.warn("[fetch-notion-resources] 資料0件のダミーキャッシュを書き出してビルドを継続します。\n");
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    CACHE_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), resources: [], error: reason }, null, 2),
  );
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_RESOURCES_DATABASE_ID;

  if (!token || !databaseId) {
    await writeEmptyCache(
      "NOTION_TOKEN または NOTION_RESOURCES_DATABASE_ID が設定されていません（.env / GitHub Secrets を確認してください）。",
    );
    return;
  }

  console.log("[fetch-notion-resources] データソースIDを取得中…");
  const dataSourceId = await resolveDataSourceId(token, databaseId);

  console.log("[fetch-notion-resources] 公開資料の一覧を取得中…");
  let rawPages;
  try {
    rawPages = await queryAllPages(token, dataSourceId, {
      filter: { property: RESOURCE_PROP.published, checkbox: { equals: true } },
      sorts: [{ property: RESOURCE_PROP.publishedAt, direction: "descending" }],
    });
  } catch (err) {
    console.warn(
      `[fetch-notion-resources] フィルター/ソート付きの取得に失敗しました（プロパティ名や型を確認してください）: ${err.message}`,
    );
    console.warn("[fetch-notion-resources] フィルターなしで全件取得し、あとでJS側で絞り込みます…");
    const allPages = await queryAllPages(token, dataSourceId, {});
    rawPages = allPages.filter((p) => getCheckbox(p, RESOURCE_PROP.published));
  }

  console.log(`[fetch-notion-resources] ${rawPages.length}件の公開資料を処理します。`);

  // 本文中で「@」から他の記事・資料ページをメンションしてリンクを貼れるようにするための
  // NotionページID → サイト内URL のマップ。ブロック変換より先に作っておく必要がある。
  console.log("[fetch-notion-resources] 記事間リンク用のマップを作成中…");
  const linkMap = await buildNotionLinkMap(token);

  const resources = [];
  for (const page of rawPages) {
    const title = getTitleText(page, RESOURCE_PROP.title) || "(無題)";
    console.log(`  - ${title}`);

    const slug = resolveSlug(getRichTextPlain(page, RESOURCE_PROP.slug), page.id, title);
    // タグ・メインタグ・カテゴリは「マスタータグ」「マスターカテゴリ」DBとのリレーションプロパティ。
    // 値には関連ページのIDしか入っていないため、関連ページを取得して名前に解決する。
    const tags = await getRelationNames(token, page, RESOURCE_PROP.tags);
    const mainTag = await getFirstRelationName(token, page, RESOURCE_PROP.mainTag);
    const category = await getFirstRelationName(token, page, RESOURCE_PROP.category);
    const publishedAt = getDateISO(page, RESOURCE_PROP.publishedAt) || page.created_time;
    const updatedAt = getDateISO(page, RESOURCE_PROP.updatedAt) || page.last_edited_time;

    // 資料ファイル本体はNotionにはアップロードせず、GitHubリポジトリの
    // public/files/resources/ に直接アップロードしてもらう運用。
    // Notion側の「資料ファイル」プロパティには、そのファイル名だけを入力してもらう（テキストプロパティ）。
    const fileFilename = getRichTextPlain(page, RESOURCE_PROP.file);
    const fileUrl = await resolveLocalRepoFile("files/resources", fileFilename);

    // 「抜粋ページ」（例: "3,7"）で指定したページ番号を抜き出す。全角カンマ・スペース区切りも許容。
    const excerptPageNumbers = getRichTextPlain(page, RESOURCE_PROP.excerptPages)
      .split(/[,、\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);

    // 資料ファイルがPDFの場合、1ページ目を自動キャプチャしてサムネイルに使う
    // （旧「資料サムネイル」プロパティは廃止。PDFをアップロードするだけで画像が出るようにする）。
    // あわせて、抜粋ページの指定があればそのページも自動キャプチャする。
    const { thumbnail, coverImage, excerptImages } = await generateResourcePreviewImages(
      fileUrl,
      `resource-preview-${page.id}`,
      excerptPageNumbers,
    );

    const description = getRichTextPlain(page, RESOURCE_PROP.description).trim();
    const metaDescription = getRichTextPlain(page, RESOURCE_PROP.metaDescription).trim() || description;
    const targetToc = splitBulletLines(getRichTextPlain(page, RESOURCE_PROP.targetToc));

    // ページ本文（記事と同じ仕組み）。「目次」「導入事例紹介」など、都度自由に見出し・内容を変えたい
    // 可変セクションはここに書けば、資料DBのプロパティを増やさずにNotion側だけで表現できる。
    const rawBlocks = await fetchBlockChildrenRecursive(token, page.id);
    const makeAnchor = makeAnchorFactory();
    const blocks = await transformBlocks(rawBlocks, makeAnchor, page.id, linkMap);

    resources.push({
      id: page.id,
      slug,
      title,
      description,
      metaDescription,
      tags,
      mainTag,
      category,
      targetToc,
      publishedAt,
      updatedAt,
      thumbnail,
      fileUrl,
      coverImage,
      excerptImages,
      blocks,
    });
  }

  // スラッグの重複チェック（重複していると同じURLに2資料が衝突してビルドが壊れるため）
  const slugCounts = new Map();
  for (const r of resources) slugCounts.set(r.slug, (slugCounts.get(r.slug) || 0) + 1);
  for (const [slug, count] of slugCounts) {
    if (count > 1) {
      console.warn(
        `[fetch-notion-resources] 警告: スラッグ "${slug}" が${count}件の資料で重複しています。Notion側で「Slug」を見直してください。`,
      );
    }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    CACHE_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), resources }, null, 2),
  );

  console.log(`[fetch-notion-resources] 完了: ${resources.length}件を .notion-cache/resources.json に書き出しました。`);
}

main().catch((err) => {
  console.error("\n[fetch-notion-resources] エラーが発生しました。ビルドを中止します:");
  console.error(err);
  // 記事側（fetch-notion.mjs）と同じ方針: 環境変数未設定以外のエラーでは空データにフォールバックせず、
  // 前回公開時点の資料一覧を本番に残したままデプロイを止める。
  process.exit(1);
});
