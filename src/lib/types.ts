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
  /** 「マスターカテゴリ」DBとのリレーションから解決したカテゴリ名の先頭1件（未設定ならnull）。カード等の単一バッジ表示用。 */
  category: string | null;
  /** 「マスターカテゴリ」DBとのリレーションから解決した全カテゴリ名（複数選択可）。カテゴリページの絞り込みはこちらを使う。 */
  categories: string[];
  /** 「執筆者リスト」DBとのリレーションから解決した執筆者名（単一選択想定。未設定ならnull）。 */
  author: string | null;
  /** 「記事の要点」プロパティ（複数行テキスト）を1行ずつに分割した配列。記事冒頭の「この記事でわかること」ボックスに使う。空配列なら非表示。 */
  keyPoints: string[];
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
  /** 自動生成サムネイルの背景色（画像未設定時のフォールバック）。「テーマカラー」セレクトプロパティの値。未設定ならnull */
  themeColor: string | null;
  /** 自動生成サムネイルの背景画像ファイル名（public/images/category-backgrounds/ 配下）。未設定なら空文字 */
  backgroundImageFilename: string;
  /** 表示順（「並び順」プロパティ、小さい順）。未設定ならnull（末尾に表示される） */
  order: number | null;
  /** カテゴリページ本文（Notion側で「説明文」より下に書かれた解説記事）のブロック。カテゴリページ下部に表示する。 */
  blocks: BlockNode[];
}

// マスタータグDB（Notion）1件分。記事DB・資料DBの「タグ」リレーション先そのもの。
// マスターカテゴリと同じ構成（自動生成サムネイル用のテーマカラー・背景画像プロパティは無い）。
export interface Tag {
  name: string;
  description: string;
  representativeSlug: string | null;
  /** タグページ本文（Notion側で「説明文」より下に書かれた解説文）のブロック。タグページ下部に表示する。 */
  blocks: BlockNode[];
}

// 執筆者リストDB（Notion）1件分。記事DB・資料DBの「執筆者」リレーション先そのもの。
export interface Author {
  name: string;
  /** 「肩書」プロパティ（例: Consultant）。未設定なら空文字 */
  title: string;
  /** 「主な経験分野」プロパティ（複数行テキスト）。改行を含んだまま保持し、表示側で white-space: pre-line 的に扱う。未設定なら空文字 */
  expertise: string;
  /** 「執筆者紹介文」プロパティ。未設定なら空文字 */
  bio: string;
  /** 「執筆者画像」（files & media）をダウンロードしたローカル配信パス。未設定・未アップロードならnull */
  image: string | null;
  /** 表示順（「並び順」プロパティ、小さい順）。未設定ならnull（末尾に表示される）。取得時点で既にソート済みのため、通常はこの値を直接参照する必要はない */
  order: number | null;
}

export interface PostsCache {
  generatedAt: string;
  posts: Post[];
  categories: Category[];
  tags: Tag[];
  authors: Author[];
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
  /** 「執筆者リスト」DBとのリレーションから解決した執筆者名（単一選択想定。未設定ならnull）。 */
  author: string | null;
  /** 「ターゲット・目次」を1行ずつに分割した配列。1行目を見出し、2行目以降を箇条書きとして表示する。 */
  targetToc: string[];
  publishedAt: string;
  updatedAt: string;
  /** 一覧・詳細ページの見出し画像。資料ファイル（PDF）の1ページ目を自動キャプチャしたもの（旧「資料サムネイル」プロパティは廃止）。PDF以外や生成失敗時はnull */
  thumbnail: string | null;
  /** 資料本体ファイルの配信パス。Notion側に「資料ファイル」プロパティが無い間はnull */
  fileUrl: string | null;
  /** 資料ファイル（PDF）の1ページ目を自動キャプチャした表紙画像。PDF以外やキャプチャ失敗時はnull */
  coverImage: string | null;
  /** 「抜粋ページ」で指定したページ番号を自動キャプチャした画像（指定順）。未指定なら空配列 */
  excerptImages: string[];
  /** 資料DBページ本文のブロック（記事と同じ形式）。見出し・リストなど自由に構成できる可変セクション用。 */
  blocks: BlockNode[];
}

export interface ResourcesCache {
  generatedAt: string;
  resources: Resource[];
  error?: string;
}
