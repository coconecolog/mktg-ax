import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// ============================================================
// Notionのプロパティ名（このサイトの仕様書どおりの名称）
// ここを変えるとNotion側のプロパティ名を変更したときに対応できます。
// ============================================================
export const PROP = {
  title: "タイトル",
  tags: "タグ",
  publishedAt: "公開日",
  updatedAt: "更新日",
  thumbnail: "サムネイル画像",
  published: "公開",
  slug: "スラッグ",
  description: "ディスクリプション",
};

// ------------------------------------------------------------
// プロパティ抽出ヘルパー
// ------------------------------------------------------------

function getProperty(page, name) {
  return page.properties?.[name];
}

export function getTitleText(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "title") return "";
  return (prop.title || []).map((t) => t.plain_text).join("");
}

export function getRichTextPlain(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "rich_text") return "";
  return (prop.rich_text || []).map((t) => t.plain_text).join("");
}

export function getCheckbox(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "checkbox") return false;
  return !!prop.checkbox;
}

export function getMultiSelectNames(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "multi_select") return [];
  return (prop.multi_select || []).map((o) => o.name);
}

/**
 * 日付系プロパティを柔軟に取得する。
 * date / created_time / last_edited_time / formula(date) のいずれでも拾える。
 * 見つからない場合は null を返す（呼び出し側でページ自体の created_time 等にフォールバックする）。
 */
export function getDateISO(page, name) {
  const prop = getProperty(page, name);
  if (!prop) return null;
  if (prop.type === "date") return prop.date?.start || null;
  if (prop.type === "created_time") return prop.created_time || null;
  if (prop.type === "last_edited_time") return prop.last_edited_time || null;
  if (prop.type === "formula" && prop.formula?.type === "date") {
    return prop.formula.date?.start || null;
  }
  return null;
}

/** files プロパティの先頭のURLを取得する（Notionアップロード / 外部URLどちらも対応）。 */
export function getFirstFileUrl(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "files") return null;
  const file = (prop.files || [])[0];
  if (!file) return null;
  if (file.type === "external") return file.external.url;
  if (file.type === "file") return file.file.url;
  return null;
}

// ------------------------------------------------------------
// スラッグ
// ------------------------------------------------------------

const SAFE_SLUG_RE = /^[a-zA-Z0-9-_]+$/;

/**
 * カスタムスラッグが安全な形式（半角英数・ハイフン・アンダースコアのみ）ならそれを使い、
 * 空欄・不正な形式の場合はNotionのページID（ハイフン付き32桁）を使う。
 */
export function resolveSlug(customSlug, pageId, titleForWarning) {
  const trimmed = (customSlug || "").trim();
  if (trimmed === "") return pageId;
  if (!SAFE_SLUG_RE.test(trimmed)) {
    console.warn(
      `  [notion] 「${titleForWarning}」のスラッグ「${trimmed}」は半角英数・ハイフン・アンダースコア以外の文字を含むため、ページIDを代わりに使用します。`,
    );
    return pageId;
  }
  return trimmed;
}

// ------------------------------------------------------------
// 見出しの目次アンカーID
// ------------------------------------------------------------

export function makeAnchorFactory() {
  const used = new Map();
  return function makeAnchor(text) {
    let base = (text || "heading")
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    if (base === "") base = "heading";
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

// ------------------------------------------------------------
// リッチテキスト → シンプルな構造に変換
// ------------------------------------------------------------

export function transformRichText(richText) {
  if (!Array.isArray(richText)) return [];
  return richText.map((t) => {
    const a = t.annotations || {};
    return {
      text: t.plain_text || "",
      href: t.href || t.text?.link?.url || null,
      bold: !!a.bold,
      italic: !!a.italic,
      strikethrough: !!a.strikethrough,
      underline: !!a.underline,
      code: !!a.code,
      color: a.color && a.color !== "default" ? a.color : null,
    };
  });
}

export function richTextToPlain(richText) {
  if (!Array.isArray(richText)) return "";
  return richText.map((t) => t.plain_text || "").join("");
}

// ------------------------------------------------------------
// 画像キャプション/altの3パターン判定
//   1) 空欄            → alt無し・キャプション非表示
//   2) "alt:" で始まる  → 残りの文をaltとしてのみ使用（画面には非表示）
//   3) それ以外（空でない） → altとしても画面表示キャプションとしても使用
// ------------------------------------------------------------

export function resolveImageCaption(captionRichText) {
  const raw = richTextToPlain(captionRichText).trim();
  if (raw === "") {
    return { alt: "", visibleCaption: null };
  }
  if (raw.toLowerCase().startsWith("alt:")) {
    const alt = raw.slice(4).trim();
    return { alt, visibleCaption: null };
  }
  return { alt: raw, visibleCaption: raw };
}

// ------------------------------------------------------------
// 画像ダウンロード（Notionの署名付きURLは数時間で失効するため、
// ビルド時にすべてローカルへ保存して public/ 配下から配信する）
// ------------------------------------------------------------

const CONTENT_TYPE_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

function guessExtFromUrl(url) {
  const clean = url.split("?")[0];
  const ext = path.extname(clean).replace(".", "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }
  return null;
}

const IMAGE_OUT_DIR = path.resolve(process.cwd(), "public/images/notion");

// 同一URLの重複ダウンロードを避けるためのキャッシュ
const downloadCache = new Map();

/**
 * 画像をダウンロードして public/images/notion/ に保存し、
 * サイト内から参照できる絶対パス（例: /images/notion/xxxx.jpg）を返す。
 * 失敗した場合は null を返し、呼び出し側でフォールバック表示にする。
 */
export async function downloadImage(url, idHint) {
  if (!url) return null;
  if (downloadCache.has(url)) return downloadCache.get(url);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
    const ext = CONTENT_TYPE_EXT[contentType] || guessExtFromUrl(url) || "jpg";

    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
    const filename = `${idHint}-${hash}.${ext}`;
    const outPath = path.join(IMAGE_OUT_DIR, filename);

    await fs.mkdir(IMAGE_OUT_DIR, { recursive: true });
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(outPath, buffer);

    const publicPath = `/images/notion/${filename}`;
    downloadCache.set(url, publicPath);
    return publicPath;
  } catch (err) {
    console.warn(`  [notion] 画像のダウンロードに失敗しました (${idHint}): ${err.message}`);
    downloadCache.set(url, null);
    return null;
  }
}

/**
 * ディスクリプションが未入力のときのフォールバック用に、
 * 本文の最初のテキストブロックから抜粋を作る。
 */
export function extractExcerpt(blocks, maxLen = 110) {
  for (const b of blocks) {
    // 見出しはタイトルと重複しがちなので除外し、段落・リストなど本文系のみを対象にする
    if (!b.richText || b.type.startsWith("heading_")) continue;
    const text = b.richText.map((r) => r.text).join("");
    const trimmed = text.trim();
    if (trimmed) {
      return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
    }
  }
  return "";
}

// ------------------------------------------------------------
// ブロック本体の変換（再帰）
// ------------------------------------------------------------

/**
 * Notionの生ブロック配列を、Astro側で扱いやすいシンプルな形に変換する。
 * makeAnchor はページ内で一意な見出しアンカーIDを発行する関数（makeAnchorFactory()の返り値）。
 */
export async function transformBlocks(rawBlocks, makeAnchor, idHint) {
  const out = [];
  for (const block of rawBlocks) {
    const node = await transformBlock(block, makeAnchor, idHint);
    if (node) out.push(node);
  }
  return out;
}

async function transformBlock(block, makeAnchor, idHint) {
  const type = block.type;
  const children = block._children || [];
  const base = { id: block.id, type };

  switch (type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "heading_4": {
      const level = Number(type.split("_")[1]);
      const text = transformRichText(block[type].rich_text);
      const plain = richTextToPlain(block[type].rich_text);
      return {
        ...base,
        level,
        richText: text,
        anchor: makeAnchor(plain),
        toggleable: !!block[type].is_toggleable,
        children: await transformBlocks(children, makeAnchor, idHint),
      };
    }

    case "paragraph":
      return {
        ...base,
        richText: transformRichText(block.paragraph.rich_text),
        children: await transformBlocks(children, makeAnchor, idHint),
      };

    case "bulleted_list_item":
    case "numbered_list_item":
      return {
        ...base,
        richText: transformRichText(block[type].rich_text),
        children: await transformBlocks(children, makeAnchor, idHint),
      };

    case "to_do":
      return {
        ...base,
        richText: transformRichText(block.to_do.rich_text),
        checked: !!block.to_do.checked,
        children: await transformBlocks(children, makeAnchor, idHint),
      };

    case "toggle":
      return {
        ...base,
        richText: transformRichText(block.toggle.rich_text),
        children: await transformBlocks(children, makeAnchor, idHint),
      };

    case "callout": {
      const icon = block.callout.icon;
      return {
        ...base,
        richText: transformRichText(block.callout.rich_text),
        emoji: icon?.type === "emoji" ? icon.emoji : null,
        children: await transformBlocks(children, makeAnchor, idHint),
      };
    }

    case "quote":
      return {
        ...base,
        richText: transformRichText(block.quote.rich_text),
        children: await transformBlocks(children, makeAnchor, idHint),
      };

    case "divider":
      return base;

    case "code":
      return {
        ...base,
        richText: transformRichText(block.code.rich_text),
        language: block.code.language || "plain text",
        caption: richTextToPlain(block.code.caption),
      };

    case "image": {
      const img = block.image;
      const sourceUrl = img.type === "external" ? img.external.url : img.file.url;
      const localSrc = await downloadImage(sourceUrl, `${idHint}-${block.id}`);
      const { alt, visibleCaption } = resolveImageCaption(img.caption);
      return { ...base, src: localSrc || sourceUrl, alt, visibleCaption };
    }

    case "table": {
      const rows = children
        .filter((c) => c.type === "table_row")
        .map((row) => ({
          cells: (row.table_row.cells || []).map((cell) => transformRichText(cell)),
        }));
      return {
        ...base,
        hasColumnHeader: !!block.table.has_column_header,
        hasRowHeader: !!block.table.has_row_header,
        rows,
      };
    }

    case "bookmark":
    case "link_preview":
      return { ...base, url: block[type].url, caption: richTextToPlain(block[type]?.caption) };

    case "embed":
      return { ...base, url: block.embed.url };

    case "video":
    case "audio": {
      const media = block[type];
      const url = media.type === "external" ? media.external.url : media.file.url;
      return { ...base, url };
    }

    case "file":
    case "pdf": {
      const media = block[type];
      const url = media.type === "external" ? media.external.url : media.file.url;
      const name = media.name || (type === "pdf" ? "PDFファイル" : "添付ファイル");
      return { ...base, url, name };
    }

    case "equation":
      return { ...base, expression: block.equation.expression };

    case "column_list":
      return { ...base, children: await transformBlocks(children, makeAnchor, idHint) };

    case "column":
      return { ...base, children: await transformBlocks(children, makeAnchor, idHint) };

    case "table_of_contents":
      // 独自の目次コンポーネントを別途表示するため、インライン展開はしない
      return null;

    case "child_page":
    case "child_database":
    case "synced_block":
    case "breadcrumb":
    case "unsupported":
    default:
      console.warn(`  [notion] 未対応のブロックタイプ "${type}" をスキップしました (id=${block.id})`);
      return null;
  }
}

// ============================================================
// 資料ダウンロードページ（/resources）用の追加ヘルパー
// Notion側の「資料DB」（ブログ記事とは別のデータベース）のプロパティ名・変換ロジック。
// ============================================================

export const RESOURCE_PROP = {
  title: "資料名",
  tags: "タグ",
  mainTag: "メインタグ",
  publishedAt: "公開日",
  updatedAt: "更新日",
  thumbnail: "資料サムネイル",
  description: "資料説明",
  targetToc: "ターゲット・目次",
  published: "公開",
  slug: "Slug",
  metaDescription: "ディスクリプション",
  // 資料本体ファイル。Notion側に「ファイル&メディア」プロパティとしてこの名前で追加してください。
  // 未追加の間は資料ファイルのURLが常にnullになります（ダウンロードボタンは準備中表示のまま）。
  file: "資料ファイル",
};

export function getSelectName(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "select") return null;
  return prop.select?.name || null;
}

/**
 * 箇条書き想定のリッチテキスト（複数行テキスト）を改行で分割し、
 * 行頭の記号（・- * • など）を取り除いた配列にする。
 * 「ターゲット・目次」のような項目を画面表示用のリストに変換するために使う。
 */
export function splitBulletLines(text) {
  return (text || "")
    .split("\n")
    .map((line) => line.trim().replace(/^[・\-*•]\s*/, ""))
    .filter((line) => line.length > 0);
}

const RESOURCE_FILE_CONTENT_TYPE_EXT = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function guessResourceFileExt(url) {
  const clean = url.split("?")[0];
  const ext = path.extname(clean).replace(".", "").toLowerCase();
  return ext || null;
}

const RESOURCE_FILE_OUT_DIR = path.resolve(process.cwd(), "public/files/resources");
const resourceFileDownloadCache = new Map();

/**
 * 資料の実ファイル（PDF等）をダウンロードして public/files/resources/ に保存し、
 * サイト内から参照できる絶対パスを返す。downloadImage() の資料ファイル版。
 * 失敗した場合や資料ファイルが未設定の場合は null を返す。
 */
export async function downloadResourceFile(url, idHint) {
  if (!url) return null;
  if (resourceFileDownloadCache.has(url)) return resourceFileDownloadCache.get(url);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
    const ext = RESOURCE_FILE_CONTENT_TYPE_EXT[contentType] || guessResourceFileExt(url) || "pdf";

    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
    const filename = `${idHint}-${hash}.${ext}`;
    const outPath = path.join(RESOURCE_FILE_OUT_DIR, filename);

    await fs.mkdir(RESOURCE_FILE_OUT_DIR, { recursive: true });
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(outPath, buffer);

    const publicPath = `/files/resources/${filename}`;
    resourceFileDownloadCache.set(url, publicPath);
    return publicPath;
  } catch (err) {
    console.warn(`  [notion] 資料ファイルのダウンロードに失敗しました (${idHint}): ${err.message}`);
    resourceFileDownloadCache.set(url, null);
    return null;
  }
}
