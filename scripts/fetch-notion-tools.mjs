// ビルド前に実行するスクリプト。Notionの「ツールDB」から「公開」チェックがオンのツールだけを取得し、
// .notion-cache/tools.json に書き出す。Astro側（src/lib/tools.ts）はこのJSONを読むだけ。
// ツールDBは「ツールの名簿」で、ツールのページ本体（src/pages/tools/{Slug}.astro）は従来どおりコードで作る。
//
// 実行方法: npm run fetch-notion-tools （npm run build の中で自動的に呼ばれます）
// 必要な環境変数: NOTION_TOKEN, NOTION_TOOLS_DATABASE_ID
//
// 記事・資料と違い、このスクリプトは失敗してもビルドを止めない（フェイルソフト）。
// 取得できなかった場合は0件のキャッシュを書き出し、サイト側は組み込みの初期ツール一覧
// （src/lib/tools.ts の FALLBACK_TOOLS）で表示を続ける。

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveDataSourceId, queryAllPages, getRelationNames } from "./lib/notion-client.mjs";
import { getRichTextPlain, getCheckbox, getNumber, resolveSlug } from "./lib/transform.mjs";

// Notion側のプロパティ名（完全一致が必要）。タイトル列は名前に関わらず「タイトル型のプロパティ」を自動で使う。
const TOOL_PROP = {
  slug: "Slug",
  category: "カテゴリ",
  tags: "タグ",
  description: "説明文",
  shortDescription: "短い説明", // 任意。ヘッダーのプルダウン・トップページ・フッター用の短い説明。空なら説明文の冒頭を自動で使う
  ctaLabel: "ボタン文言",
  duration: "所要時間",
  icon: "アイコンファイル名",
  order: "並び順",
  published: "公開",
};

const CACHE_DIR = path.resolve(process.cwd(), ".notion-cache");
const CACHE_FILE = path.join(CACHE_DIR, "tools.json");
const PAGES_DIR = path.resolve(process.cwd(), "src/pages/tools");
const ICON_DIR = path.resolve(process.cwd(), "public/images/tool-icons");

async function writeCache(tools, error) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const body = { generatedAt: new Date().toISOString(), tools };
  if (error) body.error = error;
  await fs.writeFile(CACHE_FILE, JSON.stringify(body, null, 2));
}

function getTitle(page) {
  const prop = Object.values(page.properties || {}).find((p) => p.type === "title");
  return (prop?.title || []).map((t) => t.plain_text).join("").trim();
}

function toolPageExists(slug) {
  return existsSync(path.join(PAGES_DIR, `${slug}.astro`)) || existsSync(path.join(PAGES_DIR, slug, "index.astro"));
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_TOOLS_DATABASE_ID;

  if (!token || !databaseId) {
    console.warn("[fetch-notion-tools] NOTION_TOKEN または NOTION_TOOLS_DATABASE_ID が未設定です。組み込みの初期ツール一覧で表示します。");
    await writeCache([], "env not set");
    return;
  }

  console.log("[fetch-notion-tools] データソースIDを取得中…");
  const dataSourceId = await resolveDataSourceId(token, databaseId);

  console.log("[fetch-notion-tools] 公開ツールの一覧を取得中…");
  // 型の違いによるエラーを避けるため、全件取得してJS側で「公開」を絞り込む
  const allPages = await queryAllPages(token, dataSourceId, {});
  const rawPages = allPages.filter((p) => getCheckbox(p, TOOL_PROP.published));
  console.log(`[fetch-notion-tools] ${rawPages.length}件の公開ツールを処理します。`);

  const tools = [];
  for (const page of rawPages) {
    const title = getTitle(page) || "(無題)";
    const slug = resolveSlug(getRichTextPlain(page, TOOL_PROP.slug), page.id, title);

    // Slugが未入力・不正、または対応するページ（src/pages/tools/{Slug}.astro）がまだ無いツールは、
    // リンク切れになるため公開しない（ページを作ってから「公開」をONにする運用）。
    if (slug === page.id || slug === "index" || !toolPageExists(slug)) {
      console.warn(`  - ${title}: スキップ（Slug「${slug === page.id ? "(未設定/不正)" : slug}」に対応する src/pages/tools/ のページが見つかりません）`);
      continue;
    }
    console.log(`  - ${title} (/tools/${slug})`);

    const categories = await getRelationNames(token, page, TOOL_PROP.category);
    const tags = await getRelationNames(token, page, TOOL_PROP.tags);
    const description = getRichTextPlain(page, TOOL_PROP.description).trim();
    const shortDescription = getRichTextPlain(page, TOOL_PROP.shortDescription).trim();
    const ctaLabel = getRichTextPlain(page, TOOL_PROP.ctaLabel).trim();
    const duration = getRichTextPlain(page, TOOL_PROP.duration).trim();

    // アイコンはNotionに置かず、public/images/tool-icons/ にアップロードしたファイル名だけを入力してもらう。
    // ファイルが見つからなければ null（サイト側で汎用アイコンを使う）。
    const iconFile = path.basename(getRichTextPlain(page, TOOL_PROP.icon).trim());
    let icon = null;
    if (iconFile) {
      if (existsSync(path.join(ICON_DIR, iconFile))) icon = `/images/tool-icons/${iconFile}`;
      else console.warn(`    警告: アイコン「${iconFile}」が public/images/tool-icons/ に見つかりません。汎用アイコンを使います。`);
    }

    tools.push({
      id: page.id,
      slug,
      href: `/tools/${slug}`,
      title,
      description,
      shortDescription,
      ctaLabel: ctaLabel || "ツールを使ってみる →",
      duration: duration || null,
      icon,
      category: categories[0] || null,
      categories,
      tag: tags[0] || null,
      tags,
      order: getNumber(page, TOOL_PROP.order),
    });
  }

  // 並び順（数値）の昇順。未設定のものは末尾（Notion取得順）。
  tools.sort((a, b) => {
    if (a.order === null && b.order === null) return 0;
    if (a.order === null) return 1;
    if (b.order === null) return -1;
    return a.order - b.order;
  });

  await writeCache(tools);
  console.log(`[fetch-notion-tools] 完了: ${tools.length}件を .notion-cache/tools.json に書き出しました。`);
}

main().catch(async (err) => {
  // ツールDBの取得失敗ではビルドを止めない（組み込みの初期ツール一覧で表示を続ける）
  console.warn("\n[fetch-notion-tools] 取得に失敗しました。組み込みの初期ツール一覧で表示を続けます:");
  console.warn(err?.message || err);
  await writeCache([], String(err?.message || err));
});
