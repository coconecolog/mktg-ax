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
  publishedAt: string;
  updatedAt: string;
  thumbnail: string | null;
  blocks: BlockNode[];
}

export interface PostsCache {
  generatedAt: string;
  posts: Post[];
  error?: string;
}

export interface TocItem {
  anchor: string;
  text: string;
  level: number;
  children: TocItem[];
}
