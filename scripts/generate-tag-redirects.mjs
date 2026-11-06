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
// 実際にタグページがある英字Slug（記事・資料に使われていて、Slugがあるタグ）
const liveSlugs = new Set([...usedNames].map((n) => slugByName.get(n)).filter(Boolean));

const OLD_TAG_SUBPATHS = ["blog", "resources", "2", "3", "4", "5"];
const lines = [];
const seenFrom = new Set(); // 同じ旧URLを2回書かない（先に書いた行が優先）
const push = (fromRaw, to) => {
  const fromEnc = fromRaw.split("/").map((seg) => (/^[\x21-\x7e]*$/.test(seg) ? seg : encodeURIComponent(seg))).join("/");
  for (const from of new Set([fromRaw, fromEnc])) {
    if (seenFrom.has(from)) continue;
    seenFrom.add(from);
    lines.push(`${from} ${to} 301`);
  }
};
// 旧URLの1セグメント（oldSeg）から、新URL（to）へ1回で飛ぶ行をまとめて書く
const pushAll = (oldSeg, to) => {
  for (const base of ["/blog/tag", "/lab/tag"]) push(`${base}/${oldSeg}`, to);
  // 2026-11-06：旧URLのタブ・ページ送り（/blog/tag/{旧}/blog・/2 など）も1回の転送で新URLへ送る
  // （共通ルールだけだと /lab/tag/{旧} を経由して2回の転送になる）。ページ送りは実際にあった5ページ目までを書く。
  for (const base of ["/blog/tag", "/lab/tag"]) {
    for (const sub of OLD_TAG_SUBPATHS) push(`${base}/${oldSeg}/${sub}`, to);
  }
};

// (1) 日本語のタグ名だった旧URL → 今の英字Slug
const missingSlug = [];
for (const name of usedNames) {
  const slug = slugByName.get(name);
  if (!slug) {
    missingSlug.push(name);
    continue;
  }
  const oldSeg = name.replaceAll("/", "／"); // routeSlug.ts の toRouteSlug() と同じ変換
  if (oldSeg === slug) continue;
  pushAll(oldSeg, `/lab/tag/${slug}`);
}

// (2) タグのURLを変えた記録（src/data/tag-slug-history.json）。2026-11-06〜
// 新しいSlugのタグページがあり、旧URLのページがもう無いときだけ書く（NotionのSlugを変える前にデプロイしても、今のページを壊さない）。
const history = readJson("src/data/tag-slug-history.json")?.redirects || [];
const pending = [];
for (const { from, to } of history) {
  if (!from || !to) continue;
  const oldSeg = from.replaceAll("/", "／");
  if (!liveSlugs.has(to) || liveSlugs.has(oldSeg) || (slugByName.has(from) && usedNames.has(from) && slugByName.get(from) !== to)) {
    if (!liveSlugs.has(to)) pending.push(`${from} → ${to}`);
    continue;
  }
  pushAll(oldSeg, `/lab/tag/${to}`);
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
  console.warn(`[tag-redirects] 英字Slug未設定のタグ（公開しない）: ${missingSlug.join("、")}`);
}
if (pending.length > 0) {
  console.log(`[tag-redirects] 新しいSlugのタグページがまだ無いため保留した転送: ${pending.join("、")}`);
}
