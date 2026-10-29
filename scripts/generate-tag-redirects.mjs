// タグページを英字Slug化したことに伴う、旧URL（日本語）→新URL（英字）の301リダイレクトを生成する。
// `astro build` の後に実行し、dist/_redirects（Cloudflare Pagesのリダイレクト定義）の先頭へ書き込む
// （静的ルールは動的ルールより前に書く決まりのため。scripts/generate-category-redirects.mjs の冒頭コメントを参照）。
// public/_redirects（末尾スラッシュ統一のルール）はそのまま生かし、このスクリプトが管理するブロックだけを
// 目印コメントで挟んで毎回書き直す（何度実行しても重複しない）。
//
// 対象: マスタータグDBに英字Slugが設定されているタグのうち、旧URL（タグ名そのもの）と新URLが異なるもの。
// 2026-10-15のタグページリニューアルでタグページは1URL（/lab/tag/{slug}）だけになったため、転送するのはタグ本体の1本のみ。
// 2026-10-29のURL構造の変更（/blog/tag → /lab/tag）で、旧URL（/blog/tag/{日本語}）から新URL（/lab/tag/{英字}）へ1回で転送する行を書く。
// 旧URLの「ブログ記事」「無料資料」タブ・ページネーション（/blog/tag/{日本語}/2 など）は、public/_redirects の
// 共通ルール（/blog/tag/:tag/… → /lab/tag/:tag）でいったん /lab/tag/{日本語} に寄せられるので、その受け皿の行も書く。
// 日本語URLは「そのままの文字」と「%エンコード」の2通りを書く（どちらで届いても一致するように）。
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const START = "# >>> tag-slug-redirects（scripts/generate-tag-redirects.mjs が自動生成。手で編集しないこと）";
const END = "# <<< tag-slug-redirects";

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8"));
  } catch {
    return null;
  }
}

const postsCache = readJson(".notion-cache/posts.json");
const resourcesCache = readJson(".notion-cache/resources.json");
if (!postsCache) {
  console.warn("[tag-redirects] .notion-cache/posts.json が無いためスキップします。");
  process.exit(0);
}

// 実際にページが生成されるタグ（記事・資料のいずれかに使われているタグ）
const usedNames = new Set();
for (const p of postsCache.posts || []) for (const t of p.tags || []) usedNames.add(t);
for (const r of resourcesCache?.resources || []) for (const t of r.tags || []) usedNames.add(t);

const slugByName = new Map((postsCache.tags || []).filter((t) => t.slug).map((t) => [t.name, t.slug]));

const lines = [];
const missingSlug = [];
for (const name of usedNames) {
  const slug = slugByName.get(name);
  if (!slug) {
    missingSlug.push(name);
    continue;
  }
  const oldSeg = name.replaceAll("/", "／"); // routeSlug.ts の toRouteSlug() と同じ変換
  if (oldSeg === slug) continue;

  const to = `/lab/tag/${slug}`;
  for (const base of ["/blog/tag", "/lab/tag"]) {
    const fromRaw = `${base}/${oldSeg}`;
    const fromEnc = `${base}/${encodeURIComponent(oldSeg)}`;
    lines.push(`${fromRaw} ${to} 301`);
    if (fromEnc !== fromRaw) lines.push(`${fromEnc} ${to} 301`);
  }
}

const redirectsPath = path.join(ROOT, "dist/_redirects");
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
// 先頭に置く（静的ルールは動的ルールより前）
const block = lines.length > 0 ? `${START}\n${lines.join("\n")}\n${END}\n\n` : "";
fs.mkdirSync(path.dirname(redirectsPath), { recursive: true });
fs.writeFileSync(redirectsPath, (block + existing.trim()).replace(/\n{3,}/g, "\n\n") + "\n", "utf-8");

console.log(`[tag-redirects] 301リダイレクト ${lines.length} 行を dist/_redirects に書き出しました。`);
if (lines.length > 1800) {
  console.warn("[tag-redirects] 静的リダイレクトが上限（2,000行）に近づいています。");
}
if (missingSlug.length > 0) {
  console.warn(`[tag-redirects] 英字Slug未設定のタグ（URLが日本語のまま）: ${missingSlug.join("、")}`);
}
