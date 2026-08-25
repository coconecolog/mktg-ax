// ブログ記事と資料を統合した「ライブラリ」ページ用のデータ層。
// 記事(Post)と資料(Resource)を LibraryItem という共通の形に変換し、公開日順に並べる。
import { getAllPosts } from "./posts";
import { getAllResources } from "./resources";
import type { BlockNode, Post, Resource } from "./types";

export type LibraryKind = "post" | "resource";

export interface LibraryItem {
  kind: LibraryKind;
  slug: string;
  href: string;
  title: string;
  description: string;
  category: string | null;
  publishedAt: string;
  thumbnail: string | null;
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

// 本文の文字数から読了時間を概算する(1分あたり約500文字の日本語読解速度を想定した簡易推定値)。
function estimateReadMinutes(post: Post): number {
  return Math.max(1, Math.round(countChars(post.blocks) / 500));
}

// 資料ファイルのURLから拡張子を推測してバッジ表示に使う(取得できない場合はnull)。
function guessFileExt(fileUrl: string | null): string | null {
  if (!fileUrl) return null;
  const match = fileUrl.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toUpperCase() : null;
}

function postToItem(post: Post): LibraryItem {
  return {
    kind: "post",
    slug: post.slug,
    href: `/blog/${post.slug}`,
    title: post.title,
    description: post.description,
    category: post.category,
    publishedAt: post.publishedAt,
    thumbnail: post.thumbnail,
    typeLabel: "📝 ブログ記事",
    metaLabel: `◷ 読了${estimateReadMinutes(post)}分`,
    ctaLabel: "記事を読む →",
  };
}

function resourceToItem(resource: Resource): LibraryItem {
  const ext = guessFileExt(resource.fileUrl);
  return {
    kind: "resource",
    slug: resource.slug,
    href: `/resources/${resource.slug}`,
    title: resource.title,
    description: resource.description,
    category: resource.category,
    publishedAt: resource.publishedAt,
    thumbnail: resource.thumbnail,
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
