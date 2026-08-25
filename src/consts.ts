// サイト全体の定数。文言を変えたいときはこのファイルを編集してください。

// SITE_URL は astro.config.mjs の `site` と必ず同じ値にしてください（内部リンク判定・OGP・sitemapに影響）。
export const SITE_URL = import.meta.env.PUBLIC_SITE_URL || "https://mktg-ax.pages.dev";

export const SITE_NAME = "MKTG.AX";
export const SITE_TAGLINE = "中小企業の経営層・マーケティング責任者のための分析ツール&情報メディア";
export const SITE_DESCRIPTION =
  "中小企業の経営層・営業責任者・マーケティング責任者向けに、マーケティング分析ツールや実践的な施策・マーケット情報を発信するメディアです。";

export const DEFAULT_OG_IMAGE = "/open-graph/default.png";

export const NAV_LINKS = [
  { href: "/", label: "トップ" },
  { href: "/tools", label: "便利ツール" },
  { href: "/library", label: "ライブラリ（記事・資料）" },
  { href: "/service", label: "サービスについて" },
  { href: "/contact", label: "お問い合わせ" },
] as const;

export const POSTS_PER_PAGE = 10;

// カテゴリページ・タグページで1ページに表示する記事数（ブログ一覧とは別に6件区切りにしたいため分けている）
export const CATEGORY_TAG_PAGE_SIZE = 6;

// ライブラリ（記事・資料統合）ページで1ページに表示する件数
export const LIBRARY_PAGE_SIZE = 8;

// お問い合わせ先メールアドレス（仮の値です。実際のアドレスに書き換えてください）
// お問い合わせページの実装方法（Googleフォーム等への切り替え）は別途検討予定です。
export const CONTACT_EMAIL = "info@example.com";

// アクセス解析（未設定の項目はタグを出力しない）
export const GA4_ID = import.meta.env.PUBLIC_GA4_ID || "";
export const CLARITY_ID = import.meta.env.PUBLIC_CLARITY_ID || "";
export const GSC_VERIFICATION = import.meta.env.PUBLIC_GSC_VERIFICATION || "";
