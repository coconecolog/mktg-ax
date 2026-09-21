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
// blocks: BlockNode[] を持つあらゆるページ（記事・資料・カテゴリ・タグページなど）で共通利用できる。
// 次の2通りの書き方を質問と回答とみなして自動で拾う（Notion側の特別な設定は不要）。
//  (1) トグル（またはトグル見出し）で、見出し文が「？」で終わるもの → 中身（子ブロック）を回答にする。
//  (2) 「よくある質問」（または「FAQ」）という見出しの下にあるセクション内で、
//      見出し（または「Q1.」で始まる段落）の文が「？」で終わるもの → 次の見出しまでの段落を回答にする。
//      「Q1.」「A.」などの接頭辞は取り除く。セクションの終わりは、「よくある質問」見出しと同じかそれより
//      上位の見出し（またはページ末尾）。記事本文の途中にたまたまある疑問形の見出しは対象にしない。

function blockText(block: BlockNode): string {
  return (block.richText || []).map((r) => r.text).join("").trim();
}

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

const isHeading = (b: BlockNode) => b.type.startsWith("heading_");
const isQuestionText = (t: string) => t.endsWith("?") || t.endsWith("？");
const isFaqSectionHeading = (b: BlockNode) => {
  if (!isHeading(b)) return false;
  const t = blockText(b);
  return t.includes("よくある質問") || t.includes("よくあるご質問") || /^faq\b/i.test(t) || /^q\s*&\s*a$/i.test(t);
};
const Q_PREFIX = /^Q\s*(?:[0-9０-９]+\s*[.．:：、)）]?|[.．:：、)）])\s*/i;
const A_PREFIX = /^A\s*[.．:：、)）]\s*/i;
// 「Q1. 〜？」の形の段落（見出しではなく太字段落などで書かれている場合）
const isQNumberedParagraph = (b: BlockNode) => !isHeading(b) && /^Q\s*[0-9０-９]+\s*[.．:：、)）]/i.test(blockText(b));

// 「よくある質問」セクション（同じ階層に並んだブロック列）から、質問と回答を取り出す
function parseFaqSection(region: BlockNode[]): FaqEntry[] {
  const entries: FaqEntry[] = [];
  for (let i = 0; i < region.length; i++) {
    const block = region[i];
    const text = blockText(block);
    const isQuestion = (isHeading(block) || isQNumberedParagraph(block)) && isQuestionText(text);
    if (!isQuestion) continue;
    const answerBlocks: BlockNode[] = [];
    let j = i + 1;
    while (j < region.length && !isHeading(region[j]) && !isQNumberedParagraph(region[j])) {
      answerBlocks.push(region[j]);
      j++;
    }
    // 見出し自体が開閉式（トグル見出し）の場合は、中身（子ブロック）を回答に使う
    const answer = (block.children && block.children.length > 0 ? flattenBlockText(block.children) : flattenBlockText(answerBlocks))
      .replace(A_PREFIX, "")
      .trim();
    const question = text.replace(Q_PREFIX, "").trim();
    if (question && answer) entries.push({ question, answer });
    i = j - 1;
  }
  return entries;
}

function collectFaqEntries(blocks: BlockNode[]): FaqEntry[] {
  const entries: FaqEntry[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // (2) 「よくある質問」見出しのセクション
    if (isFaqSectionHeading(block)) {
      const level = block.level ?? 2;
      let region: BlockNode[];
      if (block.toggleable && block.children && block.children.length > 0) {
        region = block.children;
      } else {
        region = [];
        for (let j = i + 1; j < blocks.length; j++) {
          if (isHeading(blocks[j]) && (blocks[j].level ?? 2) <= level) break;
          region.push(blocks[j]);
        }
      }
      entries.push(...parseFaqSection(region));
    }

    // (1) トグルで、見出し文が「？」で終わるもの
    const isToggleLike = block.type === "toggle" || block.toggleable === true;
    if (isToggleLike) {
      const question = blockText(block);
      if (isQuestionText(question) && block.children && block.children.length > 0) {
        const answer = flattenBlockText(block.children).trim();
        if (answer) entries.push({ question, answer });
      }
    }
    if (block.children && block.children.length > 0) {
      entries.push(...collectFaqEntries(block.children));
    }
  }
  // (1)と(2)で同じ質問を二重に拾わないようにする
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.question) ? false : (seen.add(e.question), true)));
}

function faqPage(entries: FaqEntry[]) {
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

export function buildFaqSchema(blocks: BlockNode[]) {
  return faqPage(collectFaqEntries(blocks));
}

// ツールページ・お問い合わせページのように、質問と回答を配列（{question, answer}）で持っているページ用。
export function buildFaqSchemaFromItems(items: { question: string; answer: string }[]) {
  return faqPage(items.filter((i) => i.question && i.answer));
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

// ---- 共通: 一覧ページ（CollectionPage + ItemList） ----
// カテゴリページ・ツール一覧などで使う。about には「そのページが扱うテーマ」を渡す（任意）。
export function buildCollectionPageSchema(params: {
  name: string;
  description: string;
  path: string;
  about?: { name: string; description?: string };
  items: TagSchemaItem[];
  itemsStartIndex?: number;
  totalItems?: number;
}) {
  const { name, description, path, about, items, itemsStartIndex = 0, totalItems = items.length } = params;
  const url = new URL(path, SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: "ja",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    ...(about ? { about: { "@type": "Thing", name: about.name, ...(about.description ? { description: about.description } : {}) } } : {}),
    mainEntity: {
      "@type": "ItemList",
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

// ---- 資料詳細ページ（無料ダウンロード資料 = DigitalDocument） ----
// ダウンロードはメール経由のゲート方式のため、ファイルの直接URL（contentUrl）は載せない。
export function buildResourceSchema(params: {
  title: string;
  description: string;
  slug: string;
  thumbnail: string | null;
  fileUrl: string | null;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
  authorName: string | null;
}) {
  const { title, description, slug, thumbnail, fileUrl, tags, publishedAt, updatedAt, authorName } = params;
  const url = new URL(`/resources/${slug}`, SITE_URL).toString();
  const imageUrl = thumbnail ? new URL(thumbnail, SITE_URL).toString() : undefined;
  const isPdf = !!fileUrl && /\.pdf(\?|$)/i.test(fileUrl);
  return {
    "@context": "https://schema.org",
    "@type": "DigitalDocument",
    "@id": `${url}#document`,
    name: title,
    description,
    url,
    inLanguage: "ja",
    isAccessibleForFree: true,
    ...(isPdf ? { encodingFormat: "application/pdf" } : {}),
    ...(imageUrl ? { image: [imageUrl], thumbnailUrl: imageUrl } : {}),
    ...(tags.length > 0 ? { keywords: tags.join(",") } : {}),
    datePublished: toIsoDateTime(publishedAt),
    dateModified: toIsoDateTime(updatedAt),
    author: authorName
      ? { "@type": "Person", name: authorName }
      : { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: { "@id": `${SITE_URL}/#organization` },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}

// ---- 執筆者ページ（ProfilePage + Person） ----
export function buildAuthorSchema(params: {
  name: string;
  path: string;
  title: string;
  expertise: string;
  bio: string;
  image: string | null;
}) {
  const { name, path, title, expertise, bio, image } = params;
  const url = new URL(path, SITE_URL).toString();
  const knowsAbout = expertise
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${url}#webpage`,
    url,
    name: `${name}｜執筆者`,
    inLanguage: "ja",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: {
      "@type": "Person",
      "@id": `${url}#person`,
      name,
      url,
      ...(title ? { jobTitle: title } : {}),
      ...(bio ? { description: bio } : {}),
      ...(image ? { image: new URL(image, SITE_URL).toString() } : {}),
      ...(knowsAbout.length > 0 ? { knowsAbout } : {}),
      worksFor: { "@id": `${SITE_URL}/#organization` },
    },
  };
}

// ---- ツールページ（無料のWebアプリ = WebApplication） ----
export function buildToolSchema(params: { name: string; description: string; path: string }) {
  const { name, description, path } = params;
  const url = new URL(path, SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${url}#app`,
    name,
    description,
    url,
    inLanguage: "ja",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "JPY" },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}
