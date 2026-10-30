// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// SITE_URL は「今表示されている本番URL」を必ず入れておくこと。
// placeholder のままにすると内部リンク判定やOGP/サイトマップ/canonicalが誤動作します。
// 独自ドメインが決まったらこの値と .env / GitHub Secrets の PUBLIC_SITE_URL を書き換えてください。
const SITE_URL = process.env.PUBLIC_SITE_URL || "https://meerkitlab.com";

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
      filter: (page) => !page.includes("/internal-links") && !page.includes("/lab/whitepapers/thanks") && !page.includes("/contact/thanks") && !page.includes("/tools/budget-checker/input") && !page.includes("/tools/kpi-check/input") && !page.includes("/tools/budget-simulator/input") && !page.includes("/tools/kpi-sheet-maker/input") && !page.includes("/tools/kpi-analysis/input") &&
        // タグページの「ブログ記事」「無料資料」タブは本体ページへcanonicalを向けているため、サイトマップには載せない
        !/\/lab\/tag\/[^/]+\/(blog|whitepapers)(\/|$)/.test(page),
    }),
  ],
});
