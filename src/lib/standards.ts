// 「数字の基準」の2ページ（/standards/metrics・/standards/model）のページ情報と構造化データ。
// 本文は各ページ（src/pages/standards/*.astro）に直接書いている（デザイン：Figma「数字の定義・計算ルール」「モデル企業の全体像」）。
// 原稿の正本はGoogleドライブ。数字を変えるときは、ページの本文とこのファイル（説明文・更新日・指標の説明）をあわせて直す。
// 見出しのアンカー（id）は、記事・ツールからリンクしているので変えない。
import { SITE_NAME, SITE_URL } from "@/consts";

export interface StandardPage {
  slug: "metrics" | "model";
  path: string;
  title: string;
  description: string;
  lastUpdated: string; // YYYY-MM-DD
  datePublished: string; // YYYY-MM-DD
}

// llms.txt・フッターなどに並べる順番
export const STANDARD_PAGES: StandardPage[] = [
  {
    slug: "metrics",
    path: "/standards/metrics",
    title: "数字の定義・計算ルール",
    description:
      "MKTG.AXで使うKPI・予算の数字の定義。人件費込みの費用、目標の逆算、CPL・CAC・ROI・回収期間・CACの上限・許容CPLの式と判定の基準、使わないものとその理由。",
    lastUpdated: "2026-10-20",
    datePublished: "2026-10-20",
  },
  {
    slug: "model",
    path: "/standards/model",
    title: "モデル企業の全体像",
    description:
      "MKTG.AXの記事・資料・ツールの記入例に使う、架空の製造業の数字一式。会社の前提と3期の変化、成長期の目標の逆算、人件費込みの費用、施策・チャネルの判定、経営への説明例。",
    lastUpdated: "2026-10-20",
    datePublished: "2026-10-20",
  },
];

export function getStandardPages(): StandardPage[] {
  return STANDARD_PAGES;
}

export function getStandardPage(slug: StandardPage["slug"]): StandardPage {
  const page = STANDARD_PAGES.find((p) => p.slug === slug);
  if (!page) throw new Error(`[standards] ${slug} のページ情報がありません`);
  return page;
}

// 判定の指標（/standards/metrics の #indicators）。DefinedTerm に使う
export interface StandardTerm {
  name: string;
  anchor: string;
  description: string;
}

export const METRIC_TERMS: StandardTerm[] = [
  { name: "CPL", anchor: "cpl", description: "リード1件の獲得にかかった費用（人件費込み）。CPL ＝ 費用 ÷ リード数" },
  { name: "CAC", anchor: "cac", description: "新規の受注1件の獲得にかかった費用（人件費込み）。CAC ＝ 費用 ÷ 受注件数" },
  {
    name: "ROI",
    anchor: "roi",
    description: "1年間の受注の粗利から費用を引いた額が、費用の何倍かを示す割合。ROI ＝（受注金額 × 粗利率 − 費用）÷ 費用",
  },
  {
    name: "回収期間",
    anchor: "payback",
    description: "受注1件の費用（CAC）を、その1社の粗利で取り返すまでの月数。回収期間（か月）＝ CAC ÷ 1社あたりの月の粗利",
  },
  {
    name: "CACの上限",
    anchor: "cac-limit",
    description: "受注1件の獲得にかけてよい費用（人件費込み）の最大額。CACの上限 ＝ 1社あたりの年間粗利 × 取り返す年数",
  },
  {
    name: "許容CPL",
    anchor: "allowable-cpl",
    description: "CACの上限を、リード1件あたりに直した額。許容CPL ＝ CACの上限 × 商談化率 × 受注率",
  },
];

// ---------- 構造化データ ----------
const iso = (d: string) => `${d}T00:00:00+09:00`;

const author = { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: SITE_NAME, url: SITE_URL };

// 数字の定義ページ：DefinedTermSet（各指標を DefinedTerm にし、url はアンカー付き）
export function buildDefinedTermSetSchema(page: StandardPage, terms: StandardTerm[] = METRIC_TERMS) {
  const url = new URL(page.path, SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": `${url}#termset`,
    name: page.title,
    description: page.description,
    url,
    inLanguage: "ja",
    datePublished: iso(page.datePublished),
    dateModified: iso(page.lastUpdated),
    author,
    publisher: author,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    hasDefinedTerm: terms.map((t) => ({
      "@type": "DefinedTerm",
      "@id": `${url}#${t.anchor}`,
      name: t.name,
      description: t.description,
      url: `${url}#${t.anchor}`,
      inDefinedTermSet: { "@id": `${url}#termset` },
    })),
  };
}

// モデル企業ページ：Article
export function buildStandardArticleSchema(page: StandardPage) {
  const url = new URL(page.path, SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.description,
    url,
    inLanguage: "ja",
    datePublished: iso(page.datePublished),
    dateModified: iso(page.lastUpdated),
    author,
    publisher: author,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}
