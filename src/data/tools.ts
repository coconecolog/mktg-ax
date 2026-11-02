// 便利ツールの文言（名前・説明など）。/tools ページとトップページで共通に使う。
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
  "file-search":
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><circle cx="11.5" cy="14.5" r="2.5"/><path d="M13.3 16.3 15 18"/>',
  "file-text":
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  sheet:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/><line x1="9" x2="9" y1="9" y2="21"/><line x1="15" x2="15" y1="9" y2="21"/>',
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
  "chart-spline": '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16c.5-2 1.5-7 4-7 2 0 2 3 4.5 3 2.5 0 4.5-5 5-7"/>',
};

// トップページの3枚カード（PdcaToolCards）用。トップページは別途作り直すので、それまでこのまま残す。
// href を null にすると「公開準備中」の表示になる。
export const MAIN_TOOLS = [
  {
    step: "01",
    phase: "計画",
    purpose: "投資の根拠をつくる",
    icon: "chart-no-axes-combined",
    titleLines: ["予算作成", "Kit"],
    description: "売上目標と今期の実績から、必要なリード数と予算を逆算します。チャネルにリード数と費用を配るだけで、CPL・CACまで判定。",
    detail: "そのまま稟議に使える年間予算表（Excel）を作成。",
    note: "来期の予算策定・社内提案に",
    href: "/tools/budget-simulator",
  },
  {
    step: "02",
    phase: "発見・改善",
    purpose: "次に取り組む課題を見つける",
    icon: "scan-search",
    titleLines: ["KPI妥当性", "診断キット"],
    description: "自分で作ったKPIが売上目標とつながっているか、率やコストに無理がないかを、期のはじめに診断します。",
    detail: "画面でNGを直すと、そのままKPI管理表（Excel）になります。",
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

// /tools のキット（やりたいこと別）。
// resource は小さく添える資料の案内。href を null にすると「準備中」の表示になる。resource を null にすると行を出さない。
// 2026-10-29：年間予算表（M-B-03、/lab/whitepapers/kgi-kpi-backcast-sheet）はKPI管理表「はじめに入力」と同じ中身で独立。予算作成キットはフェーズ2で年間予算表の.xlsxを出力、予算案診断キットは貼りつけ・アップ・画面入力の3つの入口。
export type KitResource = {
  before: string;
  label: string;
  after: string;
  href: string | null;
};

export type Kit = {
  /** create＝作成Kit（/tools の「01 これから作る」）、check＝診断Kit（「02 作ったものを確かめる」） */
  kind: "create" | "check";
  icon: string;
  situation: string;
  description: string;
  name: string;
  button: string;
  href: string;
  resource: KitResource | null;
};

export type KitGroup = {
  title: string;
  note: string;
  kits: Kit[];
};

export const KIT_GROUPS: KitGroup[] = [
  {
    title: "予算",
    note: "来期の予算づくりに",
    kits: [
      {
        kind: "create",
        icon: "chart-no-axes-combined",
        situation: "予算をまだ作っていない",
        description: "売上目標から必要なリード数と予算を逆算。チャネルごとにリード数と費用を配るだけで、CPL・CACまで判定し、年間予算表（Excel）にします。",
        name: "予算作成Kit",
        button: "予算を作る",
        href: "/tools/budget-simulator",
        resource: { before: "スプレッドシートで作りたい方は", label: "年間予算表", after: "", href: "/lab/whitepapers/kgi-kpi-backcast-sheet" },
      },
      {
        kind: "check",
        icon: "file-search",
        situation: "予算案が正しいか確かめたい",
        description: "AIや自社で作った予算案を取りこみ、NGを直して年間予算表（Excel）に仕上げます。",
        name: "予算案診断Kit",
        button: "予算案を診断する",
        href: "/tools/budget-checker",
        resource: { before: "", label: "年間予算表", after: "で作っていれば、読み込むだけで診断できます", href: "/lab/whitepapers/kgi-kpi-backcast-sheet" },
      },
    ],
  },
  {
    title: "KPI",
    note: "期初の設計から毎月の運用まで",
    kits: [
      {
        kind: "create",
        icon: "sheet",
        situation: "KPI管理表がほしい",
        description: "売上目標と今期の実績から逆算し、チャネルに分割すると、判定つきのKPI管理表（Excel）ができます。",
        name: "KPI管理表作成Kit",
        button: "管理表を作る",
        href: "/tools/kpi-sheet-maker",
        resource: { before: "Kitを使わなくても", label: "KPI管理表", after: "をダウンロードして直接記入できます。", href: "/lab/whitepapers/kpi-management-template" },
      },
      {
        kind: "check",
        icon: "scan-search",
        situation: "KPIが正しいか確かめたい",
        description: "KPIと施策の目標が、売上目標とつながっているかを判定します。",
        name: "KPI妥当性診断Kit",
        button: "KPIを診断する",
        href: "/tools/kpi-check",
        resource: { before: "", label: "KPI管理表", after: "で作っていれば、読み込むだけで診断できます", href: "/lab/whitepapers/kpi-management-template" },
      },
      {
        kind: "check",
        icon: "file-chart-column",
        situation: "施策の効果を測りたい",
        description: "打った施策が効いたか、続いている課題は何かを示し、KPI管理表に仕上げます。",
        name: "施策効果診断Kit",
        button: "効果を診断する",
        href: "/tools/kpi-analysis",
        resource: { before: "", label: "KPI管理表", after: "で作っていれば、読み込むだけで診断できます", href: "/lab/whitepapers/kpi-management-template" },
      },
    ],
  },
];

// /tools の2つのセクション（2026-11-02：カテゴリページと同じ型に変更）。
// Kitは KIT_GROUPS の kind で振り分ける。resources は右のグレーの枠に出す資料（slug は資料DBのSlug）。
export const KIT_SECTIONS = [
  {
    kind: "create",
    number: "01",
    anchor: "create",
    title: "これから作る",
    countLabel: "作成Kit",
    description: "計画がまだない方へ。入力しながら判定まで行います。",
    mainLabel: "Kitで作る",
    sideLabel: "スプレッドシートで作る",
    sideNote: "",
    resources: [
      { label: "年間予算表", slug: "kgi-kpi-backcast-sheet", href: "/lab/whitepapers/kgi-kpi-backcast-sheet" },
      { label: "KPI管理表", slug: "kpi-management-template", href: "/lab/whitepapers/kpi-management-template" },
    ],
  },
  {
    kind: "check",
    number: "02",
    anchor: "check",
    title: "作ったものを確かめる",
    countLabel: "診断Kit",
    description: "AIや自社で作った計画、毎月の実績を診断し、直して仕上げます。",
    mainLabel: "Kitで確かめる",
    sideLabel: "資料があれば読み込むだけ",
    sideNote: "次の資料で作っていれば、ファイルを読み込むだけで診断できます。",
    resources: [
      { label: "年間予算表", slug: "kgi-kpi-backcast-sheet", href: "/lab/whitepapers/kgi-kpi-backcast-sheet" },
      { label: "KPI管理表", slug: "kpi-management-template", href: "/lab/whitepapers/kpi-management-template" },
    ],
  },
] as const;

// /tools の「その他」。
export const OTHER_TOOLS = [
  {
    icon: "list-checks",
    category: "SEO・AI検索",
    title: "簡易SEO・AEO・AIO診断チェックリスト",
    description: "全15項目を自分でチェック。SEO・AI検索への対応状況を簡易診断します。",
    href: "/tools/seo-aeo-aio-check",
  },
  {
    icon: "calculator",
    category: "広告の投資判断",
    title: "広告費用対効果（ROAS/CAC）シミュレーター",
    description: "サブスク・リピート型ビジネスのLTVから、許容CACと投資回収期間を試算します。",
    href: "/tools/roas-cac-simulator",
  },
  {
    icon: "scale",
    category: "体制・コスト",
    title: "内製 vs 外注 コスト比較シミュレーター",
    description: "新規採用と、代理店・フリーランスへの外注。累計コストを比較します。",
    href: "/tools/inhouse-vs-outsource",
  },
  {
    icon: "chart-bar-big",
    category: "広告宣伝費",
    title: "広告宣伝費 業界ベンチマーク診断",
    description: "業種・年間売上高・年間広告宣伝費から、同業種と比べた広告宣伝費の水準を診断します。",
    href: "/tools/kpi-benchmark",
  },
] as const;
