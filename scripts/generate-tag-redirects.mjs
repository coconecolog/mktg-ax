// タグページを英字Slug化したことに伴う、旧URL（日本語）→新URL（英字）の301リダイレクトを生成する。
// `astro build` の後に実行し、dist/_redirects（Cloudflare Pagesのリダイレクト定義）の末尾へ追記する。
// public/_redirects（末尾スラッシュ統一のルール）はそのまま生かし、このスクリプトが管理するブロックだけを
// 目印コメントで挟んで毎回書き直す（何度実行しても重複しない）。
//
// 対象: マスタータグDBに英字Slugが設定されているタグのうち、旧URL（タグ名そのもの）と新URLが異なるもの。
// 旧URLは、タグ本体・「ブログ記事」「無料資料」タブ・ページネーション（/2, /3…）をすべて個別に転送する
// （Cloudflare Pagesの静的リダイレクトは上限2,000行。動的リダイレクト（*）は上限100行のため使わない）。
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

// src/consts.ts の TAG_PAGE_SIZE を読む（タグページの1ページあたり件数。ページネーションの転送本数の計算に使う）
const consts = fs.readFileSync(path.join(ROOT, "src/consts.ts"), "utf-8");
const sizeMatch = consts.match(/export const TAG_PAGE_SIZE\s*=\s*(\d+)/);
if (!sizeMatch) throw new Error("[tag-redirects] src/consts.ts から TAG_PAGE_SIZE を読み取れませんでした。");
const pageSize = Number(sizeMatch[1]);

// 実際にページが生成されるタグ（記事・資料のいずれかに使われているタグ）ごとの件数
const counts = new Map(); // name -> { post, resource }
const bump = (name, kind) => {
  const c = counts.get(name) || { post: 0, resource: 0 };
  c[kind] += 1;
  counts.set(name, c);
};
for (const p of postsCache.posts || []) for (const t of p.tags || []) bump(t, "post");
for (const r of resourcesCache?.resources || []) for (const t of r.tags || []) bump(t, "resource");

const slugByName = new Map((postsCache.tags || []).filter((t) => t.slug).map((t) => [t.name, t.slug]));

const lines = [];
const missingSlug = [];
for (const [name, c] of counts) {
  const slug = slugByName.get(name);
  if (!slug) {
    missingSlug.push(name);
    continue;
  }
  const oldSeg = name.replaceAll("/", "／"); // routeSlug.ts の toRouteSlug() と同じ変換
  if (oldSeg === slug) continue;

  const pages = (n) => Math.max(1, Math.ceil(n / pageSize));
  const variants = [
    { suffix: "", n: c.post + c.resource },
    { suffix: "/blog", n: c.post },
    { suffix: "/resources", n: c.resource },
  ];
  for (const { suffix, n } of variants) {
    for (let page = 1; page <= pages(n); page++) {
      const tail = `${suffix}${page === 1 ? "" : `/${page}`}`;
      const to = `/blog/tag/${slug}${tail}`;
      const fromRaw = `/blog/tag/${oldSeg}${tail}`;
      const fromEnc = `/blog/tag/${encodeURIComponent(oldSeg)}${tail}`;
      lines.push(`${fromRaw} ${to} 301`);
      if (fromEnc !== fromRaw) lines.push(`${fromEnc} ${to} 301`);
    }
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
const block = lines.length > 0 ? `\n\n${START}\n${lines.join("\n")}\n${END}\n` : "\n";
fs.mkdirSync(path.dirname(redirectsPath), { recursive: true });
fs.writeFileSync(redirectsPath, existing.trimEnd() + block, "utf-8");

console.log(`[tag-redirects] 301リダイレクト ${lines.length} 行を dist/_redirects に書き出しました。`);
if (lines.length > 1800) {
  console.warn("[tag-redirects] 静的リダイレクトが上限（2,000行）に近づいています。");
}
if (missingSlug.length > 0) {
  console.warn(`[tag-redirects] 英字Slug未設定のタグ（URLが日本語のまま）: ${missingSlug.join("、")}`);
}
