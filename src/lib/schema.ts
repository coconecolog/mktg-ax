import { SITE_NAME, SITE_URL } from "@/consts";
import type { Post } from "./types";

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

export function buildArticleSchema(post: Post) {
  const url = new URL(`/blog/${post.slug}`, SITE_URL).toString();
  const imageUrl = post.thumbnail ? new URL(post.thumbnail, SITE_URL).toString() : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    ...(imageUrl ? { image: [imageUrl] } : {}),
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: {
      "@type": "Organization",
      name: SITE_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
  };
}
