// ブログ記事と資料を統合した「ライブラリ」ページ用のデータ層。
// 記事(Post)と資料(Resource)を LibraryItem という共通の形に変換し、公開日順に並べる。
import { getAllPosts, getSubcategoriesByCategory, getSubcategoryAnchor } from "./posts";
import { getAllResources } from "./resources";
import { getToolById } from "./tools";
import type { BlockNode, Post, Resource, Subcategory, Tool } from "./types";

export type LibraryKind = "post" | "resource";

export interface LibraryItem {
  kind: LibraryKind;
  /** NotionページID（サブカテゴリの代表記事・代表資料との突き合わせ用） */
  id: string;
  slug: string;
  href: string;
  title: string;
  description: string;
  category: string | null;
  /** 全カテゴリ名（記事は複数可。資料は1件） */
  categories: string[];
  /** サブカテゴリのページID（複数可） */
  subcategoryIds: string[];
  publishedAt: string;
  thumbnail: string | null;
  /** 記事の読了目安（分）。資料はnull */
  readMinutes: number | null;
  /** 資料ファイルの拡張子（PDF・XLSX等）。記事・不明はnull */
  fileExt: string | null;
  /** 表示用のファイル形式（資料DBの「ファイル形式」、なければ拡張子）。記事はnull */
  fileFormat: string | null;
  typeLabel: string;
  metaLabel: string | null;
  ctaLabel: string;
}

function countChars(blocks: BlockNode[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.richText) {
      total += block.richText.reduce((sum, r) => sum + r.text.length, 0);
    }
    if (block.children) total += countChars(block.children);
  }
  return total;
}

// 本文の文字数から読了時間を概算する（1分あたり約500文字の日本語読解速度を想定した簡易推定値）。
function estimateReadMinutes(post: Post): number {
  return Math.max(1, Math.round(countChars(post.blocks) / 500));
}

// 資料ファイルのURLから拡張子を推測してバッジ表示に使う（取得できない場合はnull）。
function guessFileExt(fileUrl: string | null): string | null {
  if (!fileUrl) return null;
  const match = fileUrl.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toUpperCase() : null;
}

function postToItem(post: Post): LibraryItem {
  return {
    kind: "post",
    id: post.id,
    slug: post.slug,
    href: `/lab/blog/${post.slug}`,
    title: post.title,
    description: post.description,
    category: post.category,
    categories: post.categories,
    subcategoryIds: post.subcategoryIds || [],
    publishedAt: post.publishedAt,
    thumbnail: post.thumbnail,
    readMinutes: estimateReadMinutes(post),
    fileExt: null,
    fileFormat: null,
    typeLabel: "📝 ブログ記事",
    metaLabel: `◷ 読了${estimateReadMinutes(post)}分`,
    ctaLabel: "記事を読む →",
  };
}

function resourceToItem(resource: Resource): LibraryItem {
  const ext = guessFileExt(resource.fileUrl);
  return {
    kind: "resource",
    id: resource.id,
    slug: resource.slug,
    href: `/lab/whitepapers/${resource.slug}`,
    title: resource.title,
    description: resource.description,
    category: resource.category,
    categories: resource.category ? [resource.category] : [],
    subcategoryIds: resource.subcategoryIds || [],
    publishedAt: resource.publishedAt,
    thumbnail: resource.thumbnail,
    readMinutes: null,
    fileExt: ext,
    fileFormat: resource.fileFormat || ext,
    typeLabel: ext ? `📄 無料資料（${ext}）` : "📄 無料資料",
    metaLabel: null,
    ctaLabel: "無料で資料をもらう",
  };
}

export type LibraryFilter = "all" | "post" | "resource";

/** 公開日の新しい順にソートされた、記事・資料の混合リスト。filterで種別を絞り込める。 */
export function getLibraryItems(filter: LibraryFilter = "all"): LibraryItem[] {
  const posts = filter === "resource" ? [] : getAllPosts().map(postToItem);
  const resources = filter === "post" ? [] : getAllResources().map(resourceToItem);
  return [...posts, ...resources].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function getLibraryCounts() {
  const postCount = getAllPosts().length;
  const resourceCount = getAllResources().length;
  return { all: postCount + resourceCount, post: postCount, resource: resourceCount };
}

/** 指定カテゴリに絞り込んだ、公開日の新しい順の記事・資料の混合リスト。カテゴリページ用。 */
export function getLibraryItemsByCategory(
  categoryName: string,
  filter: LibraryFilter = "all",
): LibraryItem[] {
  // 記事の「カテゴリ」は複数選択可のため、いずれか1つでも一致すれば対象にする。資料は単一カテゴリのまま。
  const posts =
    filter === "resource" ? [] : getAllPosts().filter((p) => p.categories.includes(categoryName)).map(postToItem);
  const resources =
    filter === "post" ? [] : getAllResources().filter((r) => r.category === categoryName).map(resourceToItem);
  return [...posts, ...resources].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function getLibraryCountsByCategory(categoryName: string) {
  const postCount = getAllPosts().filter((p) => p.categories.includes(categoryName)).length;
  const resourceCount = getAllResources().filter((r) => r.category === categoryName).length;
  return { all: postCount + resourceCount, post: postCount, resource: resourceCount };
}

/** 指定タグに絞り込んだ、公開日の新しい順の記事・資料の混合リスト。タグページ用。 */
export function getLibraryItemsByTag(tagName: string, filter: LibraryFilter = "all"): LibraryItem[] {
  // 記事・資料とも「タグ」は複数選択可のため、いずれか1つでも一致すれば対象にする。
  const posts =
    filter === "resource" ? [] : getAllPosts().filter((p) => p.tags.includes(tagName)).map(postToItem);
  const resources =
    filter === "post" ? [] : getAllResources().filter((r) => r.tags.includes(tagName)).map(resourceToItem);
  return [...posts, ...resources].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

/**
 * 記事・資料に実際に使われている全タグ名（重複除去、出現順）。
 * マスタータグDB（NOTION_TAGS_DATABASE_ID）が未設定の環境でもタグページ自体は生成できるように、
 * マスターDBではなく記事・資料の実データから集計している（説明文・本文は getTagByName() で別途マスターDBから補う）。
 */
export function getAllLibraryTagNames(): string[] {
  const names = new Set<string>();
  for (const post of getAllPosts()) {
    for (const tag of post.tags) names.add(tag);
  }
  for (const resource of getAllResources()) {
    for (const tag of resource.tags) names.add(tag);
  }
  return [...names];
}

export function getLibraryCountsByTag(tagName: string) {
  const postCount = getAllPosts().filter((p) => p.tags.includes(tagName)).length;
  const resourceCount = getAllResources().filter((r) => r.tags.includes(tagName)).length;
  return { all: postCount + resourceCount, post: postCount, resource: resourceCount };
}

/** 指定執筆者が書いた、公開日の新しい順の記事・資料の混合リスト。執筆者ページ用。 */
export function getLibraryItemsByAuthor(authorName: string, filter: LibraryFilter = "all"): LibraryItem[] {
  const posts = filter === "resource" ? [] : getAllPosts().filter((p) => p.author === authorName).map(postToItem);
  const resources =
    filter === "post" ? [] : getAllResources().filter((r) => r.author === authorName).map(resourceToItem);
  return [...posts, ...resources].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function getLibraryCountsByAuthor(authorName: string) {
  const postCount = getAllPosts().filter((p) => p.author === authorName).length;
  const resourceCount = getAllResources().filter((r) => r.author === authorName).length;
  return { all: postCount + resourceCount, post: postCount, resource: resourceCount };
}

// ------------------------------------------------------------
// カテゴリページ（2026-10-12リニューアル）用: カテゴリ内の記事・資料をサブカテゴリごとに分ける
// ------------------------------------------------------------

export interface CategorySection {
  /** 対応するサブカテゴリ。null は「その他」（サブカテゴリ未設定の記事・資料をまとめた枠） */
  subcategory: Subcategory | null;
  /** ページ内アンカー（# なし） */
  anchor: string;
  /** 表示用の番号（01, 02 …）。「その他」は空文字 */
  number: string;
  name: string;
  summary: string;
  description: string;
  /** 記事。先頭が「まずはこの記事から」（代表記事。未設定なら最新） */
  posts: LibraryItem[];
  /** 資料。先頭が大きく出す資料（代表資料。未設定なら最新） */
  resources: LibraryItem[];
  /** 関連ツール（件数には含めない） */
  tools: Tool[];
}

export interface CategoryGuide {
  sections: CategorySection[];
  /** カテゴリ内の記事・資料（重複なし・公開日の新しい順）。件数表示と構造化データに使う */
  items: LibraryItem[];
  counts: { all: number; post: number; resource: number };
}

/** 代表のIDに一致するものを先頭に移す（見つからなければ並びはそのまま＝最新が先頭） */
function pinFirst(items: LibraryItem[], id: string | null): LibraryItem[] {
  if (!id) return items;
  const index = items.findIndex((item) => item.id === id);
  if (index <= 0) return items;
  return [items[index], ...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * カテゴリページの中身を、サブカテゴリ（マスターサブカテゴリDBの「並び順」）ごとのブロックに分けて返す。
 * - カテゴリの対象: 「カテゴリ」にこのカテゴリを含む記事・資料に加え、このカテゴリ配下のサブカテゴリが付いた記事・資料（カテゴリの付け忘れ対策）
 * - 1つの記事に複数のサブカテゴリが付いていれば、それぞれのブロックに表示する（件数は重複を数えない）
 * - このカテゴリ配下のサブカテゴリが1つも付いていない記事・資料は、末尾の「その他」にまとめる（0件なら「その他」自体を出さない）
 * - 記事・資料が0件のサブカテゴリも、ブロックとしては表示する（「いま、取り組みたいテーマは？」と番号がずれないように）
 */
export function getCategoryGuide(categoryName: string): CategoryGuide {
  const subcategories = getSubcategoriesByCategory(categoryName);
  const subIds = new Set(subcategories.map((s) => s.id));
  const belongs = (item: LibraryItem) =>
    item.categories.includes(categoryName) || item.subcategoryIds.some((id) => subIds.has(id));

  // サブカテゴリの「代表記事」「代表資料」に選んだものは、記事・資料側に「サブカテゴリ」が付いていなくても
  // そのテーマに表示する（代表に選んだのに出てこない、を防ぐ）。
  const pinnedIds = new Map<string, Set<string>>();
  for (const sub of subcategories) {
    for (const id of [sub.representativePostId, sub.representativeResourceId]) {
      if (!id) continue;
      if (!pinnedIds.has(id)) pinnedIds.set(id, new Set());
      pinnedIds.get(id)!.add(sub.id);
    }
  }
  const sectionIdsOf = (item: LibraryItem) => [...item.subcategoryIds, ...(pinnedIds.get(item.id) ?? [])];

  const items = getLibraryItems("all").filter((item) => belongs(item) || pinnedIds.has(item.id));

  const sections: CategorySection[] = subcategories.map((sub, i) => {
    const inSection = items.filter((item) => sectionIdsOf(item).includes(sub.id));
    return {
      subcategory: sub,
      anchor: getSubcategoryAnchor(sub),
      number: String(i + 1).padStart(2, "0"),
      name: sub.name,
      summary: sub.summary,
      description: sub.description,
      posts: pinFirst(inSection.filter((item) => item.kind === "post"), sub.representativePostId),
      resources: pinFirst(inSection.filter((item) => item.kind === "resource"), sub.representativeResourceId),
      tools: sub.toolIds.map((id) => getToolById(id)).filter((t): t is Tool => !!t),
    };
  });

  const others = items.filter((item) => !sectionIdsOf(item).some((id) => subIds.has(id)));
  if (others.length > 0) {
    sections.push({
      subcategory: null,
      anchor: "others",
      number: "",
      name: subcategories.length > 0 ? "その他" : "記事・資料",
      summary: "",
      description: "",
      posts: others.filter((item) => item.kind === "post"),
      resources: others.filter((item) => item.kind === "resource"),
      tools: [],
    });
  }

  const postCount = items.filter((item) => item.kind === "post").length;
  return {
    sections,
    items,
    counts: { all: items.length, post: postCount, resource: items.length - postCount },
  };
}
