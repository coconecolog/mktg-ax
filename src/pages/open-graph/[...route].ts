// OGP画像の自動生成エンドポイント。
// 例: /open-graph/blog/{slug}.png、/open-graph/default.png
// 日本語を描画するため、src/fonts/NotoSansJP-Variable.ttf を同梱しています
// （Google Fonts「Noto Sans JP」。OFLライセンス）。
import { OGImageRoute } from "astro-og-canvas";
import { getAllPosts } from "@/lib/posts";
import { SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from "@/consts";

const posts = getAllPosts();

const JP_FONT = ["./src/fonts/NotoSansJP-Variable.ttf"];
const JP_FAMILY = ["Noto Sans JP"];
const BRAND_GRADIENT: [number, number, number][] = [
  [124, 92, 245],
  [76, 40, 166],
];

type PageEntry = {
  title: string;
  description: string;
  thumbnailFsPath?: string;
};

const pages: Record<string, PageEntry> = {
  default: { title: SITE_NAME, description: SITE_TAGLINE },
  tools: { title: "便利ツール", description: SITE_DESCRIPTION },
  "tools/seo-aeo-aio-check": { title: "簡易SEO・AEO・AIO診断チェックリスト", description: SITE_DESCRIPTION },
  resources: { title: "資料一覧", description: SITE_DESCRIPTION },
  service: { title: "サービスについて", description: SITE_DESCRIPTION },
  contact: { title: "お問い合わせ", description: SITE_DESCRIPTION },
};

for (const post of posts) {
  pages[`blog/${post.slug}`] = {
    title: post.title,
    description: post.description,
    // public/配下のファイルはVite/Astroのアセット処理を通らないため、
    // "/images/notion/xxx.jpg" のようなURLパスを "./public/images/notion/xxx.jpg"
    // というファイルシステムパスに変換して渡す必要がある。
    thumbnailFsPath: post.thumbnail ? `./public${post.thumbnail}` : undefined,
  };
}

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page: PageEntry) => ({
    title: page.title,
    description: page.description,
    dir: "ltr",
    bgGradient: BRAND_GRADIENT,
    ...(page.thumbnailFsPath
      ? { bgImage: { path: page.thumbnailFsPath, fit: "cover" as const } }
      : {}),
    border: { color: [255, 255, 255], width: 0 },
    font: {
      title: { size: 64, weight: "Bold", families: JP_FAMILY, lineHeight: 1.3 },
      description: { size: 34, families: JP_FAMILY, lineHeight: 1.5 },
    },
    fonts: JP_FONT,
  }),
});
