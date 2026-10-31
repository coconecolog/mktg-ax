// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { readFileSync } from "node:fs";

// SITE_URL は「今表示されている本番URL」を必ず入れておくこと。
// placeholder のままにすると内部リンク判定やOGP/サイトマップ/canonicalが誤動作します。
// 独自ドメインが決まったらこの値と .env / GitHub Secrets の PUBLIC_SITE_URL を書き換えてください。
const SITE_URL = process.env.PUBLIC_SITE_URL || "https://meerkitlab.com";

// サイトマップに載せないページ（noindex のページ・社内用ページ）。
// noindex のページをサイトマップに載せると、Search Console で「送信されたURLに noindex タグが追加されています」になる。
// noindex のページを足したら、ここにも足すこと。
const SITEMAP_EXCLUDE_PREFIXES = [
  "/internal-links",
  "/lab/whitepapers/thanks",
  "/contact/thanks",
];
const SITEMAP_EXCLUDE_EXACT = [
  "/search",
  "/privacy",
  "/tools/budget-checker/input",
  "/tools/kpi-check/input",
  "/tools/budget-simulator/input",
  "/tools/kpi-sheet-maker/input",
  "/tools/kpi-analysis/input",
];

// サイトマップの lastmod 用：記事・資料の更新日（.notion-cache から読む。無ければ付けない）
function readCache(file) {
  try {
    return JSON.parse(readFileSync(new URL(`./.notion-cache/${file}`, import.meta.url), "utf-8"));
  } catch {
    return null;
  }
}
function toLastmod(value) {
  if (!value) return undefined;
  const iso = /T\d{2}:\d{2}/.test(value) ? value : `${value}T00:00:00+09:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
const LASTMOD_BY_PATH = new Map();
for (const post of readCache("posts.json")?.posts ?? []) {
  const lastmod = toLastmod(post.updatedAt || post.publishedAt);
  if (post.slug && lastmod) LASTMOD_BY_PATH.set(`/lab/blog/${post.slug}`, lastmod);
}
for (const resource of readCache("resources.json")?.resources ?? []) {
  const lastmod = toLastmod(resource.updatedAt || resource.publishedAt);
  if (resource.slug && lastmod) LASTMOD_BY_PATH.set(`/lab/whitepapers/${resource.slug}`, lastmod);
}

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  output: "static",
  trailingSlash: "never",
  // 出力を `blog/x.html` 形式（file）にする。既定の directory 形式（`blog/x/index.html`）だと
  // Cloudflare Pages が「/lab/blog/x → /lab/blog/x/」へ自動リダイレクトし、canonical / サイトマップ（スラッシュなし）と矛盾する。
  build: {
    format: "file",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\/$/, "");
        if (SITEMAP_EXCLUDE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return false;
        if (SITEMAP_EXCLUDE_EXACT.includes(path)) return false;
        // タグページの「ブログ記事」「無料資料」タブは本体ページへcanonicalを向けているため、サイトマップには載せない
        return !/\/lab\/tag\/[^/]+\/(blog|whitepapers)$/.test(path);
      },
      // 記事・資料ページには更新日（lastmod）を入れる（Googleが更新を早く見つけられるように）
      serialize: (item) => {
        const path = decodeURI(new URL(item.url).pathname).replace(/\/$/, "");
        const lastmod = LASTMOD_BY_PATH.get(path);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
});
