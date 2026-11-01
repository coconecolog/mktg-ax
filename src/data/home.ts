// トップページ（src/pages/index.astro）の文言・リンクをまとめたファイル。
// 文言を変えたいときは、このファイルの "" の中だけを書き換えてください（index.astro は触らなくてOK）。
// ・改行したい見出しは、配列 [ "1行目", "2行目" ] の要素を増やす・減らすだけで反映されます。
// ・href はリンク先のURLです。サイト内なら "/service" のように / から書きます。

// ------------------------------------------------------------
// ヒーロー（ページ最上部）
// ------------------------------------------------------------
export const HOME_HERO = {
  eyebrow: "少人数でマーケティングを担う、BtoB企業へ",
  titleLines: ["KPIも予算も", "自社の数字で判断する。"],
  descriptionLines: [
    "少人数でマーケティングを担う方に、予算とKPIの判断基準を。",
    "戦略の立案から運用・改善、社内への提案まで、",
    "施策の優先順位と投資の成果を見える化する実務メディアです。",
  ],
  primaryCta: { label: "Lab（記事・資料）を見る", href: "/lab" },
  secondaryCta: { label: "ツール（Kit）を使ってみる", href: "/tools" },
  // 右側の画像（public/images/home/ に置いたファイル）。画像もリンクになります（リンク先は imageLink.href）
  image: {
    src: "/images/home/kpi-illustration.svg",
    alt: "KPIツリーのイメージ。売上目標（KGI）からリード獲得・商談転換（CSF）、MQL数・CPL・商談率・受注率（KPI）に分け、月次で追う。",
  },
  // 画像の下のリンク（線つきのテキストリンク）
  imageLink: { label: "KPIツリーの作り方と例を読む", href: "/lab/blog/kpi-tree" },
};

// ------------------------------------------------------------
// 共通基準（ファーストビューの下の黒い帯）
// items は右の3つ。行を増やす・消すときは { ... }, のまとまりごと操作してください。
// ------------------------------------------------------------
export const HOME_STANDARDS = {
  eyebrow: "共通基準",
  headingLines: ["すべての記事・資料・ツール（Kit）は、", "同じ定義で計算しています。"],
  items: [
    { label: "前提の共有", title: "架空の製造業の前提", link: { label: "モデル企業を見る", href: "/standards" } },
    { label: "具体のシミュレーション", title: "予算・リード・受注の内訳", link: { label: "施策と数字を見る", href: "/standards/model" } },
    { label: "判断の基準", title: "CAC・回収期間・上限コストの基準", link: { label: "数字の定義を見る", href: "/standards/metrics" } },
  ],
};

// ------------------------------------------------------------
// 01 注力テーマ（時期に合わせて差し替えるエリア）
// ・STEP 01〜03 は、category の「サブカテゴリ」（Notionの並び順）と、その「代表記事」から自動で表示します。
//   代表記事が未設定のときは「代表資料」→ そのサブカテゴリの新しい記事・資料 の順で埋めます。
// ・下の一覧は、category の記事・資料を新しい順に latestCount 件表示します。
// ・テーマを変えるときは、category・見出し・tools を書き換えます。
// ------------------------------------------------------------
export const HOME_FOCUS = {
  // false にするとトップページに表示しません（中身は残るので true に戻せばそのまま出ます）
  visible: false,
  eyebrow: "注力テーマ",
  badge: "KPI設計と運用",
  heading: "目標から逆算するKPI設計と、回し続けるための運用・管理手法",
  // Notionのカテゴリ名（マスターカテゴリDBの名前と同じにする）
  category: "KPI・効果測定",
  stepCount: 3,
  stepLabel: "STEP",
  // Kit（左から順に表示）。行を増やす・消すときは { ... }, のまとまりごと操作してください。
  tools: [
    {
      label: "Kit",
      name: "施策効果診断Kit",
      description:
        "毎月の実績と施策ログから、続いている課題と、打ち手が効いたかどうかを確率つきのグラフで示します。画面で直すと、そのまま翌月も使えるKPI管理表（Excel）になります。",
      note: "",
      // 関連資料（資料DBのSlug）。資料を出さないときは null
      resourceSlug: "kpi-management-template",
      cta: { label: "KPIを分析する", href: "/tools/kpi-analysis" },
    },
    {
      label: "Kit",
      name: "KPI妥当性診断Kit",
      description:
        "自分で作ったKPIが売上目標とつながっているか、率やコストに無理がないかを診断します。画面で直すと、そのままKPI管理表（Excel）になります。",
      note: "期のはじめにKPIを決めるときに。",
      resourceSlug: null,
      cta: { label: "KPIを診断する", href: "/tools/kpi-check" },
    },
  ],
  // Kitの下の関連資料の文言
  resourceTypeLabel: "無料資料",
  resourceCtaLabel: "無料で資料をもらう",
  postTag: "記事",
  resourceTag: "資料",
  latestLabel: "このテーマの新着",
  latestCount: 3,
  categoryLinkLabel: "このテーマの記事・資料をすべて見る",
};

// ------------------------------------------------------------
// 02 課題から探す（カテゴリ・サブカテゴリは Notion から自動。ここは見出しまわりの文言だけ）
// ------------------------------------------------------------
export const HOME_ISSUES = {
  eyebrow: "課題から探す",
  heading: "いまの課題に、合うテーマを。",
  subcategoryCount: 3,
  linkLabel: "カテゴリを見る",
};

// ------------------------------------------------------------
// 計画から改善、報告まで（3つのステップのKit）
// ・resource は「あわせて使う資料」（1つ）。href を null にするとリンクなしで「準備中」と出ます
// ・resource.label は資料の上の見出し（カードごとに変えられる）。coverTitle は表紙に出す名前（改行は \n）。guide は資料の下の案内文（空なら出さない）
// ・2026-10-28：作成Kitは作成時に判定までするので、診断Kitは「あわせて使う」に出さない
// ------------------------------------------------------------
export const HOME_PDCA = {
  heading: "計画から改善、報告まで。",
  sub: "予算とKPIを1本でつなぐ、3つのステップ",
  note: "Kitと資料は同じ項目・同じ数字の定義でそろえています。どのステップから始めても使えます。",
  relatedLabel: "あわせて使う資料",
  comingSoonLabel: "準備中",
  listLink: { label: "Kit一覧", href: "/tools" },
  steps: [
    {
      step: "01",
      phase: "計画",
      purpose: "投資の根拠をつくる",
      name: "予算作成Kit",
      description: "売上目標から必要なリード数と予算を逆算し、CPL・CACまで判定した年間予算表（Excel）を作ります。",
      href: "/tools/budget-simulator",
      resource: {
        label: "あわせて使う資料",
        name: "年間計画シート（KPIと予算）",
        coverTitle: "年間\n予算表",
        typeLabel: "スプレッドシート",
        href: "/lab/whitepapers/kgi-kpi-backcast-sheet",
        guide: "予算作成Kitを使わず、スプレッドシートをダウンロードして直接入力しても作れます。表はKPI管理表の「はじめに入力」と同じなので、そのまま貼りつけられます。",
      },
    },
    {
      step: "02",
      phase: "管理",
      purpose: "追う数字を決める",
      name: "KPI管理表作成Kit",
      description: "計画の数字を入れるだけで、毎月の予実と撤退の判断まで自動で出るKPI管理表ができます。",
      href: "/tools/kpi-sheet-maker",
      resource: {
        label: "あわせて使う資料",
        name: "KPI管理表",
        coverTitle: "KPI\n管理表",
        typeLabel: "スプレッドシート",
        href: "/lab/whitepapers/kpi-management-template",
        guide: "KPI管理表作成Kitを使わず、スプレッドシートをダウンロードして直接入力しても作れます。",
      },
    },
    {
      step: "03",
      phase: "改善・報告",
      purpose: "打ち手を見直して伝える",
      name: "施策効果診断Kit",
      description: "毎月の実績と施策ログから、続いている課題と、打ち手が効いたかを確率つきで示します。",
      href: "/tools/kpi-analysis",
      resource: {
        label: "あわせて使う資料",
        name: "KPI管理表",
        coverTitle: "KPI\n管理表",
        typeLabel: "スプレッドシート",
        href: "/lab/whitepapers/kpi-management-template",
        guide: "毎月の実績をKPI管理表に入れて、このKitにアップするだけで診断が終わります。",
      },
    },
  ],
};

// ------------------------------------------------------------
// 03 新着記事・資料（記事と資料をまぜて、自動で新しい順に count 件。ここは見出しまわりの文言だけ）
// 資料の行は「資料」タグ・左列に形式（XLSX・PDFなど）・右端に↓・薄いグレーの背景で、記事と見分けられるようにしています。
// ------------------------------------------------------------
export const HOME_LATEST = {
  eyebrow: "新着記事・資料",
  heading: "いまの実務に、必要な知識を。",
  count: 4,
  resourceTag: "資料",
  resourceMeta: "無料",
  allLink: { label: "Lab（記事・資料）をすべて見る", href: "/lab" },
};

// ------------------------------------------------------------
// 04 ご要望・ご質問（ボタンはお問い合わせフォームへ）
// examples は箇条書きの例。行を増やす・消すときは "…", の単位で操作してください。
// ※ components/ContactCta.astro からも使っています
// ------------------------------------------------------------
export const HOME_REQUEST = {
  eyebrow: "ご要望・ご質問",
  heading: "取り上げてほしいテーマや、使い方の質問を。",
  description: "記事・資料・各種ツール（Kit）へのご要望やご質問を受け付けています。いただいた内容は、今後のコンテンツづくりの参考にします。",
  examples: [
    "こんなテーマの記事や資料を読みたい",
    "分析Kitの使い方・入力のしかたがわからない",
    "資料の記入例や、記事の内容についてもっと知りたい",
  ],
  link: { label: "要望・質問を送る", href: "/contact" },
};
