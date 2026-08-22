import fs from "node:fs";
import path from "node:path";
import type { BlockNode, Post, PostsCache, TocItem } from "./types";

const CACHE_PATH = path.resolve(process.cwd(), ".notion-cache/posts.json");

function loadCache(): PostsCache {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as PostsCache;
  } catch {
    console.warn(
      "[posts] .notion-cache/posts.json が見つかりません。先に `npm run fetch-notion` を実行してください。空のデータで続行します。",
    );
    return { generatedAt: new Date().toISOString(), posts: [] };
  }
}

const cache = loadCache();

/** 公開日の新しい順にソートされた全記事 */
export function getAllPosts(): Post[] {
  return [...cache.posts].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function getPostBySlug(slug: string): Post | undefined {
  return cache.posts.find((p) => p.slug === slug);
}

export function getAllTags(): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of cache.posts) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function getPostsByTag(tag: string): Post[] {
  return getAllPosts().filter((p) => p.tags.includes(tag));
}

/**
 * 見出し2・見出し3から目次を組み立てる（H3はH2の下にネスト）。
 * 見出し1・見出し4は目次に含めない（仕様どおり）。
 * column_list / column の中身は透過的にたどるが、toggle/callout/quoteの中は目次に含めない。
 */
export function buildToc(blocks: BlockNode[]): TocItem[] {
  const toc: TocItem[] = [];
  let currentH2: TocItem | null = null;

  function walk(nodes: BlockNode[]) {
    for (const node of nodes) {
      if (node.type === "heading_2" && node.anchor) {
        currentH2 = {
          anchor: node.anchor,
          text: (node.richText || []).map((r) => r.text).join(""),
          level: 2,
          children: [],
        };
        toc.push(currentH2);
      } else if (node.type === "heading_3" && node.anchor) {
        const item: TocItem = {
          anchor: node.anchor,
          text: (node.richText || []).map((r) => r.text).join(""),
          level: 3,
          children: [],
        };
        if (currentH2) currentH2.children.push(item);
        else toc.push(item);
      } else if (node.type === "column_list" || node.type === "column") {
        if (node.children) walk(node.children);
      }
    }
  }

  walk(blocks);
  return toc;
}

export const CACHE_GENERATED_AT = cache.generatedAt;
export const CACHE_ERROR = cache.error;
