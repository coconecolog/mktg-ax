// カテゴリページを英字Slug化したことに伴う、旧URL（日本語）→新URL（英字）の301リダイレクトを生成する。
// `astro build` の後に実行し、dist/_redirects（Cloudflare Pagesのリダイレクト定義）の先頭へ書き込む。
// 先頭に置くのは、Cloudflare Pagesでは「上にあるルールが優先」かつ「静的ルールは動的ルール（:placeholder・*）より前に書く」
// 決まりのため（2026-10-29 URL構造の変更で /blog/category/:cat → /lab/category/:cat の動的ルールを足したので、
// 日本語URLの行がそれより後ろにあると、日本語のまま /lab/category/{日本語}（404）へ飛んでしまう）。
// タグ用の scripts/generate-tag-redirects.mjs と同じ方式で、このスクリプトが管理するブロックだけを
// 目印コメントで挟んで毎回書き直す（何度実行しても重複しない。タグ側のブロックには触らない）。
//
// 対象: マスターカテゴリDBに英字Slugが設定されているカテゴリのうち、旧URL（カテゴリ名そのもの）と新URLが異なるもの。
// 転送するページは、ビルド済みの dist/lab/category/{英字Slug}.html と dist/lab/category/{英字Slug}/ 配下を
// 実際に走査して決める。2026-10-12のリニューアルでカテゴリページは1ページ（{英字Slug}.html）だけになった。
// 2026-10-29のURL構造の変更（/blog/category → /lab/category）で、旧URL（/blog/category/{日本語}）から新URL（/lab/category/{英字}）へ
// 1回で転送する行を書く。旧日本語URLのページ送り・タブ（/blog/category/{日本語}/2 など）は、public/_redirects の
// 「/blog/category/:cat/…」のルールでいったん /lab/category/{日本語} へ転送されるので、その受け皿の行も書く。
// ページ数を件数から計算しないので、1ページあたり件数（CATEGORY_TAG_PAGE_SIZE）を変えても追従する。
// あわせて、資料DL後のサンクスページ（/resources/thanks/{日本語} → /lab/whitepapers/thanks/{英字}）も転送する（2026-09-25追加）。
// 日本語URLは「そのままの文字」と「%エンコード」の2通りを書く（どちらで届いても一致するように）。
// Cloudflare Pagesの静的リダイレクトは上限2,000行（動的リダイレクト（*）は上限100行のため使わない）。
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const CATEGORY_DIST = path.join(DIST, "lab/category");
const START = "# >>> category-slug-redirects（scripts/generate-category-redirects.mjs が自動生成。手で編集しないこと）";
const END = "# <<< category-slug-redirects";

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8"));
  } catch {
    return null;
  }
}

/** dist/lab/category/{slug}.html と {slug}/ 配下のHTMLから、URLの末尾部分（"", "/2" …）を集める */
function collectTails(slug) {
  const tails = [];
  if (fs.existsSync(path.join(CATEGORY_DIST, `${slug}.html`))) tails.push("");
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name.endsWith(".html")) {
        const base = entry.name.slice(0, -".html".length);
        // format: "directory" でビルドされた場合の index.html にも一応対応する
        tails.push(base === "index" ? prefix : `${prefix}/${base}`);
      }
    }
  };
  walk(path.join(CATEGORY_DIST, slug), "");
  return [...new Set(tails)].sort();
}

const postsCache = readJson(".notion-cache/posts.json");
if (!postsCache) {
  console.warn("[category-redirects] .notion-cache/posts.json が無いためスキップします。");
  process.exit(0);
}

const lines = [];
const missingSlug = [];
for (const category of postsCache.categories || []) {
  const { name, slug } = category;
  if (!slug) {
    missingSlug.push(name);
    continue;
  }
  const oldSeg = name.replaceAll("/", "／"); // routeSlug.ts の toRouteSlug() と同じ変換
  if (oldSeg === slug) continue;

  const tails = collectTails(slug);
  if (tails.length === 0) {
    console.warn(`[category-redirects] カテゴリ「${name}」（${slug}）のページが dist に見つからないためスキップします。`);
    continue;
  }
  for (const tail of tails) {
    const to = `/lab/category/${slug}${tail}`;
    for (const base of ["/blog/category", "/lab/category"]) {
      const fromRaw = `${base}/${oldSeg}${tail}`;
      const fromEnc = `${base}/${encodeURIComponent(oldSeg)}${tail}`;
      lines.push(`${fromRaw} ${to} 301`);
      if (fromEnc !== fromRaw) lines.push(`${fromEnc} ${to} 301`);
    }
  }

  // サンクスページ（noindex・サイトマップ対象外。ブックマーク等で旧URLに来た場合の保険）
  if (fs.existsSync(path.join(DIST, "lab/whitepapers/thanks", `${slug}.html`))) {
    const to = `/lab/whitepapers/thanks/${slug}`;
    for (const base of ["/resources/thanks", "/lab/whitepapers/thanks"]) {
      const fromRaw = `${base}/${oldSeg}`;
      const fromEnc = `${base}/${encodeURIComponent(oldSeg)}`;
      lines.push(`${fromRaw} ${to} 301`);
      if (fromEnc !== fromRaw) lines.push(`${fromEnc} ${to} 301`);
    }
  }
}

const redirectsPath = path.join(DIST, "_redirects");
let existing = "";
try {
  existing = fs.readFileSync(redirectsPath, "utf-8");
} catch {
  /* dist/_redirects が無ければ新規作成 */
}
const startIdx = existing.indexOf(START);
const endIdx = existing.indexOf(END);
if (startIdx !== -1 && endIdx !== -1) {
  existing = (existing.slice(0, startIdx) + existing.slice(endIdx + END.length)).trimEnd();
}
// 先頭に置く（静的ルールは動的ルールより前。理由はファイル冒頭のコメント）
const block = lines.length > 0 ? `${START}\n${lines.join("\n")}\n${END}\n\n` : "";
fs.mkdirSync(path.dirname(redirectsPath), { recursive: true });
const output = (block + existing.trim()).replace(/\n{3,}/g, "\n\n") + "\n";
fs.writeFileSync(redirectsPath, output, "utf-8");

console.log(`[category-redirects] 301リダイレクト ${lines.length} 行を dist/_redirects に書き出しました。`);
// タグ・記事スラッグ変更分も含めた、_redirects 全体の静的リダイレクト行数（上限2,000行）をチェックする
const totalRules = output.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
if (totalRules > 1800) {
  console.warn(`[category-redirects] dist/_redirects 全体のルールが ${totalRules} 行です。上限（2,000行）に近づいています。`);
}
if (missingSlug.length > 0) {
  console.warn(`[category-redirects] 英字Slug未設定のカテゴリ（URLが日本語のまま）: ${missingSlug.join("、")}`);
}
