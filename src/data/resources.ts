// 資料一覧・資料ダウンロードページ用のダミーデータ。
// 今回はNotionと連携せず、このファイルを直接編集する仮実装です。
// 将来Notion連携する場合は、このファイルの代わりに src/lib/posts.ts と同じ要領で
// 別のNotionデータベース（資料用）から取得するモジュールに差し替えてください。

export interface Resource {
  slug: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string;
  updatedAt: string; // ISO日付
  downloadUrl: string; // ダウンロード先（外部ストレージのURL等を想定）
}

export const resources: Resource[] = [
  {
    slug: "marketing-audit-checklist",
    title: "【保存版】中小企業のためのマーケティング診断チェックリスト50",
    description:
      "自社のマーケティング活動を50項目でセルフ診断できるチェックシートです。経営会議の資料としてもご活用いただけます。",
    category: "チェックリスト",
    thumbnail: "/images/resources/placeholder-1.svg",
    updatedAt: "2026-07-01",
    downloadUrl: "#",
  },
  {
    slug: "kpi-design-template",
    title: "営業・マーケティング部門のKPI設計テンプレート",
    description: "部門間の目標がズレがちなKPI設計を、テンプレートに沿って埋めるだけで整理できます。",
    category: "テンプレート",
    thumbnail: "/images/resources/placeholder-2.svg",
    updatedAt: "2026-06-15",
    downloadUrl: "#",
  },
  {
    slug: "2026-btob-market-report",
    title: "2026年版 中小企業BtoBマーケティング市場動向レポート",
    description: "予算配分・利用ツール・成果指標の最新調査結果をまとめたレポートです。",
    category: "調査レポート",
    thumbnail: "/images/resources/placeholder-3.svg",
    updatedAt: "2026-05-20",
    downloadUrl: "#",
  },
];

export function getResourceBySlug(slug: string): Resource | undefined {
  return resources.find((r) => r.slug === slug);
}
