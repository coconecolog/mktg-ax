// llms.txt（生成AI向けのサイト案内、https://llmstxt.org の形式）。
// 「数字の基準」の2ページを先頭に書く（公開ページの構成（数字の基準）7. による）。
// 2026-11-01：Kit・カテゴリ・記事・資料の一覧を足した（AIがサイトの全体像と、どのページで何がわかるかをつかめるように）。
// 中身はすべてサイトのデータ（src/data/tools.ts・Notionのキャッシュ）から作るので、記事やKitを足してもこのファイルの修正は不要。
import type { APIRoute } from "astro";
import { SITE_NAME, SITE_NAME_KANA, SITE_NAME_PARTS, SITE_URL, SITE_DESCRIPTION, SITE_TAGLINE } from "@/consts";
import { getStandardPages } from "@/lib/standards";
import { KIT_GROUPS, OTHER_TOOLS } from "@/data/tools";
import { getAllCategories, getAllPosts, getCategoryPath } from "@/lib/posts";
import { getAllResources } from "@/lib/resources";

const oneLine = (text: string | null | undefined) => (text || "").replace(/\s+/g, " ").trim();

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site?.toString().replace(/\/$/, "") || SITE_URL;
  const link = (title: string, path: string, note?: string) =>
    `- [${oneLine(title)}](${siteUrl}${path})${note ? `: ${oneLine(note)}` : ""}`;

  const standards = getStandardPages().map((p) => link(p.title, p.path, p.description));
  const kits = KIT_GROUPS.flatMap((g) => g.kits.map((k) => link(k.name, k.href, `${k.situation}方向け。${k.description}`)));
  const otherTools = OTHER_TOOLS.map((t) => link(t.title, t.href, t.description));
  const categories = getAllCategories().map((c) => link(c.name, getCategoryPath(c.name), c.description));
  const posts = getAllPosts().map((p) => link(p.title, `/lab/blog/${p.slug}`, p.description));
  const resources = getAllResources().map((r) =>
    link(r.title, `/lab/whitepapers/${r.slug}`, r.metaDescription || r.description),
  );
  const parts = SITE_NAME_PARTS.map((p) => `${p.en}（${p.kana}）＝${p.meaning}`).join("、");

  const section = (title: string, lines: string[]) => (lines.length > 0 ? `## ${title}\n\n${lines.join("\n")}\n` : "");

  const body = `# ${SITE_NAME}（${SITE_NAME_KANA}）

> ${SITE_TAGLINE.replace(/\s+/g, "")}。${SITE_DESCRIPTION}。中小企業のBtoBマーケティング責任者向けに、予算・KPIを作る／診断する無料のKitと、記事・ダウンロード資料を提供しています。

サイト名の読み方は「${SITE_NAME_KANA}」です（「ミールキットラボ」ではありません）。${parts}を組み合わせた名前です。

記事・資料・Kitの数字は、架空のモデル企業（BtoBの製造業）を基準にしています。数字の定義（リード数・有効リード率・商談化率・受注率・CPL・CACなど）は「数字の基準」のページが正です。Kitはすべて無料で、メールアドレスの登録なしで使えます。

${section("数字の基準", standards)}
${section("Kit（予算・KPIの作成と診断）", kits)}
${section("Labのカテゴリ", categories)}
${section("記事", posts)}
${section("無料ダウンロード資料", resources)}
## Optional

${[link("Kit一覧", "/tools", "予算・KPIのKitの一覧"), link("Lab（記事・資料）", "/lab", "記事とダウンロード資料の一覧"), link("サービスについて", "/service", "運営とサイト名の由来"), ...otherTools].join("\n")}
`;
  return new Response(body.replace(/\n{3,}/g, "\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
