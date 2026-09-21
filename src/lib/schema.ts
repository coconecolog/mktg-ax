import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "@/consts";
import type { BlockNode, Post } from "./types";

export interface BreadcrumbEntry {
  name: string;
  href: string;
}

export function buildBreadcrumbList(entries: BreadcrumbEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: entries.map((entry, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: entry.name,
      item: new URL(entry.href, SITE_URL).toString(),
    })),
  };
}

// 日付文字列をタイムゾーン付きのISO8601形式に正規化する。
// Notionの「日付」プロパティは時刻を指定しない場合 "2026-09-05" のような日付のみの文字列になり、
// これをそのままJSON-LDのdatePublished/dateModifiedに渡すとGoogleのリッチリザルトテストで
// 「日時値が無効」「タイムゾーンがない」という警告になるため、ここで補正する。
function toIsoDateTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  // 既に時刻を含む場合はそのまま使う(例: 2026-09-12T12:02:00Z)
  if (/T\d{2}:\d{2}/.test(value)) return value;
  // 日付のみの場合は日本時間の 00:00:00 として扱う
  return `${value}T00:00:00+09:00`;
}

export function buildArticleSchema(post: Post) {
  const url = new URL(`/blog/${post.slug}`, SITE_URL).toString();
  const imageUrl = post.thumbnail ? new URL(post.thumbnail, SITE_URL).toString() : undefined;

return {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: post.title,
  description: post.description,
  ...(imageUrl ? { image: [imageUrl] } : {}),
  datePublished: toIsoDateTime(post.publishedAt),
  dateModified: toIsoDateTime(post.updatedAt),
  author: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  },
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": url,
  },
};
}

// サイト全体の運営者情報(トップページに設置)。AIやGoogleに「このサイトが何者か」を伝える目的。
export function buildOrganizationSchema() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    ];
}

// ---- FAQPageスキーマ自動生成 ----
// Notion本文中の「トグルブロック(またはトグル見出し)」で、見出し文が「?」で終わるものを
// 質問とみなし、その中身(子ブロック)を回答として抽出する。
// 記事・資料・カテゴリ・タグページなど blocks: BlockNode[] を持つあらゆるページで共通利用できる。
// Notion側で「トグル(またはトグル見出し)」を使い、見出し文を疑問形にするだけで
// 自動的にFAQPageの構造化データとして出力される(特別な設定は不要)。

function flattenBlockText(blocks: BlockNode[]): string {
  return blocks
  .map((block) => {
    const own = (block.richText || []).map((r) => r.text).join("");
    const child = block.children && block.children.length > 0 ? flattenBlockText(block.children) : "";
    return [own, child].filter(Boolean).join(" ");
  })
  .filter(Boolean)
  .join("\n");
}

interface FaqEntry {
  question: string;
  answer: string;
}

function collectFaqEntries(blocks: BlockNode[]): FaqEntry[] {
  const entries: FaqEntry[] = [];
  for (const block of blocks) {
    const isToggleLike = block.type === "toggle" || block.toggleable === true;
    if (isToggleLike) {
      const question = (block.richText || []).map((r) => r.text).join("").trim();
        const isQuestion = question.endsWith("?") || question.endsWith("？");
        if (isQuestion && block.children && block.children.length > 0) {
          const answer = flattenBlockText(block.children).trim();
          if (answer) entries.push({ question, answer });
      }
    }
    if (block.children && block.children.length > 0) {
      entries.push(...collectFaqEntries(block.children));
    }
  }
  return entries;
}

export function buildFaqSchema(blocks: BlockNode[]) {
  const entries = collectFaqEntries(blocks);
  if (entries.length === 0) return null;

return {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: entries.map((entry) => ({
    "@type": "Question",
    name: entry.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: entry.answer,
    },
  })),
};
}

// ---- タグページ（ピラーページ）用の構造化データ ----
// タグページは「そのテーマの総合解説（ピラー）＋関連記事・資料（クラスター）の一覧」として設計している。
// CollectionPage（一覧ページであること）／about: DefinedTerm（そのテーマの定義）／mainEntity: ItemList（クラスター一覧）
// を1つのJSON-LDにまとめて出力する。パンくず（BreadcrumbList）は Breadcrumb.astro が別途出力するのでここでは含めない。
export interface TagSchemaItem {
  href: string;
  title: string;
}

export function buildTagPageSchema(params: {
  tagName: string;
  pageTitle: string;
  description: string;
  path: string; // 例: /blog/tag/ROI
  items: TagSchemaItem[]; // このページに表示している記事・資料
  itemsStartIndex: number; // 0始まり。ページネーション2ページ目以降の position 連番用
  totalItems: number;
}) {
  const { tagName, pageTitle, description, path, items, itemsStartIndex, totalItems } = params;
  const url = new URL(path, SITE_URL).toString();

  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url,
    name: pageTitle,
    description,
    inLanguage: "ja",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: {
      "@type": "DefinedTerm",
      name: tagName,
      description,
      url,
    },
    mainEntity: {
      "@type": "ItemList",
      name: `${tagName}に関する記事・資料`,
      numberOfItems: totalItems,
      itemListElement: items.map((item, i) => ({
        "@type": "ListItem",
        position: itemsStartIndex + i + 1,
        name: item.title,
        url: new URL(item.href, SITE_URL).toString(),
      })),
    },
  };
}
