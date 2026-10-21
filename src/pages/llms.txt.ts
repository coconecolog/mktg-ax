// llms.txt（生成AI向けのサイト案内）。「数字の基準」の2ページを先頭に書く（公開ページの構成（数字の基準）7. による）。
import type { APIRoute } from "astro";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "@/consts";
import { getStandardPages } from "@/lib/standards";

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site?.toString().replace(/\/$/, "") || SITE_URL;
  const standards = getStandardPages()
    .map((p) => `- [${p.title}](${siteUrl}${p.path}): ${p.description}`)
    .join("\n");
  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}。中小企業のマーケティング責任者向けの、KPI・予算の分析ツールと情報メディア。

## 数字の基準

${standards}

## サイト

- [便利ツール](${siteUrl}/tools): 予算・KPIの計算・診断ツール
- [ライブラリ（記事・資料）](${siteUrl}/library): 記事とダウンロード資料の一覧
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
