// 便利ツールの文言（名前・説明・目安時間など）。/tools ページとトップページで共通に使う。
// ツールを増やす・文言を変えるときは、このファイルを編集する（Notionのツールは参照しない）。
// アイコンは lucide（https://lucide.dev）の線画。ICONS に同じ形式で追加すれば使える。

// lucide アイコンの中身（<svg> の内側）。
export const ICONS: Record<string, string> = {
  "chart-no-axes-combined":
    '<path d="M12 16v5"/><path d="M16 14.639V21"/><path d="M20 10.656V21"/><path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"/><path d="M4 18.463V21"/><path d="M8 14.656V21"/>',
  "scan-search":
    '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
  "file-chart-column":
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 18v-1"/><path d="M12 18v-6"/><path d="M16 18v-3"/>',
  "list-checks":
    '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
  calculator:
    '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
  scale:
    '<path d="M12 3v18"/><path d="m19 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"/><path d="m5 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M7 21h10"/>',
  "chart-bar-big":
    '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><rect x="7" y="13" width="9" height="4" rx="1"/><rect x="7" y="5" width="12" height="4" rx="1"/>',
  "clipboard-check":
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
};

// 計画から改善、報告まで（PDCAの3ツール）。href を null にすると「公開準備中」の表示になる。
export const MAIN_TOOLS = [
  {
    step: "01",
    phase: "計画",
    purpose: "投資の根拠をつくる",
    icon: "chart-no-axes-combined",
    titleLines: ["マーケティング予算", "シミュレーター"],
    description: "今期実績と来期の施策から、予算と投資計画を組み立てます。人件費・ツール費・広告費を整理し、判断の根拠を明確に。",
    detail: "逆算パイプライン・費用内訳・ROI試算を含む計画書を作成。",
    note: "来期の予算策定・社内提案に",
    href: "/tools/budget-simulator",
  },
  {
    step: "02",
    phase: "発見・改善",
    purpose: "次に取り組む課題を見つける",
    icon: "scan-search",
    titleLines: ["KPI妥当性", "チェッカー"],
    description: "売上目標と施策ごとのKPIから、KPIツリーの妥当性を判定。リードの過不足や、受注とつながらないKPIを示します。",
    detail: "空欄は一般的な値で計算。結果はA4横のPDFで出せます。",
    note: "期のはじめにKPIを決めるときに",
    href: "/tools/kpi-check",
  },
  {
    step: "03",
    phase: "報告",
    purpose: "成果と課題を伝える",
    icon: "file-chart-column",
    titleLines: ["マーケ月次報告", "メーカー"],
    description: "期初の計画と、毎月のリード・商談・受注などの数値を整理。経営に伝える月次報告を、A4横のPDF 1枚にまとめます。",
    detail: "翌月は前回のPDFを読み込み、内容を引き継いで作成できます。",
    note: "PDF出力にはメール登録が必要",
    href: "/tools/monthly-report",
  },
] as const;

// 日々の判断に、小さなツール。
export const QUICK_TOOLS = [
  {
    icon: "clipboard-check",
    category: "予算の判定",
    title: "予算案チェッカー",
    description: "生成AIで作った予算案を、人件費込みのCPL・CAC・回収期間・ROI（1年）で判定し、抜けやすいところを指摘します。",
    time: "目安 5分",
    href: "/tools/budget-checker",
  },
  {
    icon: "list-checks",
    category: "SEO・AI検索",
    title: "簡易SEO・AEO・AIO診断チェックリスト",
    description: "全15項目を自分でチェック。SEO・AI検索への対応状況を簡易診断します。",
    time: "目安 2分",
    href: "/tools/seo-aeo-aio-check",
  },
  {
    icon: "calculator",
    category: "広告の投資判断",
    title: "広告費用対効果（ROAS/CAC）シミュレーター",
    description: "サブスク・リピート型ビジネスのLTVから、許容CACと投資回収期間を試算します。",
    time: "目安 1分",
    href: "/tools/roas-cac-simulator",
  },
  {
    icon: "scale",
    category: "体制・コスト",
    title: "内製 vs 外注 コスト比較シミュレーター",
    description: "新規採用と、代理店・フリーランスへの外注。累計コストを比較します。",
    time: "目安 2分",
    href: "/tools/inhouse-vs-outsource",
  },
  {
    icon: "chart-bar-big",
    category: "広告宣伝費",
    title: "広告宣伝費 業界ベンチマーク診断",
    description: "業種・年間売上高・年間広告宣伝費から、同業種と比べた広告宣伝費の水準を診断します。",
    time: "目安 1分",
    href: "/tools/kpi-benchmark",
  },
] as const;
