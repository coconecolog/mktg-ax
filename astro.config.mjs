// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// SITE_URL は「今表示されている本番URL」を必ず入れておくこと。
// placeholder のままにすると内部リンク判定やOGP/サイトマップ/canonicalが誤動作します。
// 独自ドメインが決まったらこの値と .env / GitHub Secrets の PUBLIC_SITE_URL を書き換えてください。
const SITE_URL = process.env.PUBLIC_SITE_URL || "https://mktg-ax.pages.dev";

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  output: "static",
  trailingSlash: "never",
  // 出力を `blog/x.html` 形式（file）にする。既定の directory 形式（`blog/x/index.html`）だと
  // Cloudflare Pages が「/blog/x → /blog/x/」へ自動リダイレクトし、canonical / サイトマップ（スラッシュなし）と矛盾する。
  build: {
    format: "file",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/internal-links") && !page.includes("/resources/thanks") && !page.includes("/contact/thanks"),
    }),
  ],
});
