import type { APIRoute } from "astro";
import { SITE_URL } from "@/consts";

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site?.toString().replace(/\/$/, "") || SITE_URL;
  // Content-Signal（Cloudflareの「コンテンツシグナル」）：検索とAIの回答での参照はOK、AIの学習はNG。
  // 行頭に空白を入れない（2026-11-01 修正）。
  const body = `User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /

Sitemap: ${siteUrl}/sitemap-index.xml
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
