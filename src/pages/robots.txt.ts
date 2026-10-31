import type { APIRoute } from "astro";
import { SITE_URL } from "@/consts";

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site?.toString().replace(/\/$/, "") || SITE_URL;
  // Content-Signal（Cloudflareの「コンテンツシグナル」）：検索・AIの回答での参照・AIの学習をすべてOKにする。
  // 2026-11-01：サイト名と数字の基準をAIに覚えてもらうため、学習もOK（ai-train=yes）に変更。
  // 行頭に空白を入れない（2026-11-01 修正）。
  const body = `User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /

Sitemap: ${siteUrl}/sitemap-index.xml
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
