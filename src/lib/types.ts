// .notion-cache/posts.json （scripts/fetch-notion.mjs が生成）の型定義。
// スクリプト側（JS）とAstro側（TS）で二重管理になっているので、
// 片方の形を変えたらもう片方も忘れずに直してください。

export interface RichTextItem {
  text: string;
  href: string | null;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string | null;
}

export interface BlockNode {
  id: string;
  type: string;
  level?: number;
  richText?: RichTextItem[];
  anchor?: string;
  toggleable?: boolean;
  children?: BlockNode[];
  checked?: boolean;
  emoji?: string | null;
  language?: string;
  caption?: string;
  src?: string;
  alt?: string;
  visibleCaption?: string | null;
  hasColumnHeader?: boolean;
  hasRowHeader?: boolean;
  rows?: { cells: RichTextItem[][] }[];
  url?: string;
  name?: string;
  expression?: string;
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  /** 「マスタータグ」DBとのリレーションから解決した単一の主タグ（未設定ならnull） */
  mainTag: string | null;
  /** 「マスターカテゴリ」DBとのリレーションから解決したカテゴリ名（未設定ならnull） */
  category: string | null;
  publishedAt: string;
  updatedAt: string;
  thumbnail: string | null;
  blocks: BlockNode[];
}

// マスターカテゴリDB（Notion）1件分。記事DBの「カテゴリ」リレーション先そのもの。
// representativeSlug は「代表記事Slug」プロパティの値で、
// 対応する記事が見つからない場合は null として扱う。
export interface Category {
  name: string;
  description: string;
  representativeSlug: string | null;
}

export interface PostsCache {
  generatedAt: string;
  posts: Post[];
  categories: Category[];
  error?: string;
}

export interface TocItem {
  anchor: string;
  text: string;
  level: number;
  children: TocItem[];
}

// ------------------------------------------------------------
// .notion-cache/resources.json （scripts/fetch-notion-resources.mjs が生成）の型定義。
// こちらもスクリプト側（JS）と二重管理なので、片方を変えたらもう片方も直すこと。
// ------------------------------------------------------------

export interface Resource {
  id: string;
  slug: string;
  title: string;
  /** 資料説明（本文に表示する説明文） */
  description: string;
  /** ディスクリプション（SEO用メタディスクリプション。未入力ならdescriptionを流用） */
  metaDescription: string;
  tags: string[];
  /** 「マスタータグ」DBとのリレーションから解決した単一の主タグ（未設定ならnull） */
  mainTag: string | null;
  /** 「マスターカテゴリ」DBとのリレーションから解決したカテゴリ名（未設定ならnull） */
  category: string | null;
  /** 「ターゲット・目次」を1行ずつに分割した配列 */
  targetToc: string[];
  publishedAt: string;
  updatedAt: string;
  thumbnail: string | null;
  /** 資料本体ファイルの配信パス。Notion側に「資料ファイル」プロパティが無い間はnull */
  fileUrl: string | null;
  /** 資料DBページ本文のブロック（記事と同じ形式）。見出し・リストなど自由に構成できる可変セクション用。 */
  blocks: BlockNode[];
}

export interface ResourcesCache {
  generatedAt: string;
  resources: Resource[];
  error?: string;
}
