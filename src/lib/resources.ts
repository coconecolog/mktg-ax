import fs from "node:fs";
import path from "node:path";
import type { Resource, ResourcesCache } from "./types";
import { isPublishedTag } from "./posts";

const CACHE_PATH = path.resolve(process.cwd(), ".notion-cache/resources.json");

function loadCache(): ResourcesCache {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as ResourcesCache;
    // サブカテゴリ（2026-10-12追加）は、古いキャッシュに耐えるようにする
    return { ...parsed, resources: (parsed.resources || []).map((r) => ({
        ...r,
        subcategoryIds: r.subcategoryIds || [],
        // 英字Slugが空のタグは公開しない（posts.ts の hideTagsWithoutSlug と同じ。2026-11-06）
        tags: (r.tags || []).filter(isPublishedTag),
        mainTag: r.mainTag && isPublishedTag(r.mainTag) ? r.mainTag : null,
      })) };
  } catch {
    console.warn(
      "[resources] .notion-cache/resources.json が見つかりません。先に `npm run fetch-notion-resources` を実行してください。空のデータで続行します。",
    );
    return { generatedAt: new Date().toISOString(), resources: [] };
  }
}

const cache = loadCache();

/** 公開日の新しい順にソートされた全資料 */
export function getAllResources(): Resource[] {
  return [...cache.resources].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function getResourceBySlug(slug: string): Resource | undefined {
  return cache.resources.find((r) => r.slug === slug);
}
/** NotionページIDから資料を引く（記事の「CTA資料」リレーション用。公開されていない資料は見つからず undefined になる）。 */
export function getResourceById(id: string): Resource | undefined {
  return cache.resources.find((r) => r.id === id);
}
/** 指定カテゴリに属する資料（資料側の「カテゴリ」リレーションから解決した名前で判定）。 */
export function getResourcesByCategory(name: string): Resource[] {
  return getAllResources().filter((r) => r.category === name);
}
export const RESOURCES_CACHE_GENERATED_AT = cache.generatedAt;
export const RESOURCES_CACHE_ERROR = cache.error;
