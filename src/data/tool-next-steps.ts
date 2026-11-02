// 1ページ完結のツール（その他のツール）に出す「H1の下の案内」と「結果の直下の次の一手」（2026-11-02）。
// キーはツールのURL。variants のキーは、各ツールの判定（ページのスクリプトが setNextStep() で切り替える）。
// 文中の {名前} は、ページのスクリプトが入れる数字（例 {allowable} = 許容上限CAC）。
// 行き先を変えるときはここだけ編集する。Kit・資料・記事のURLは /tools と /lab の今のURLに合わせる。

export type NextLinkType = "kit" | "resource" | "post" | "tag";

export interface NextLink {
  type: NextLinkType;
  title: string;
  /** カードの説明文（何がわかるか・何ができるか。1〜2文） */
  desc: string;
  href: string;
}

export interface NextVariant {
  /** 見出し（何をすればよいか） */
  title: string;
  /** 説明文。{名前} はページのスクリプトが数字を入れる */
  body: string;
  /** 黒いボタン（1つだけ） */
  cta: { label: string; href: string; type: NextLinkType };
  /** 枠の右に置く資料（表紙つき） */
  feature: NextLink;
  /** 枠の下に2列で並べるカード（Kit・資料・記事。2つ） */
  links: NextLink[];
}

export interface ToolNextStepData {
  /** H1の下の案内の枠 */
  guide: { text: string; label: string; href: string };
  /** 最初に表示する判定 */
  defaultVariant: string;
  variants: Record<string, NextVariant>;
}

const KIT = {
  budgetMake: { label: "予算作成Kit", href: "/tools/budget-simulator" },
  budgetCheck: { label: "予算案診断Kit", href: "/tools/budget-checker" },
};

const WP = {
  annualBudget: { title: "年間予算表", href: "/lab/whitepapers/kgi-kpi-backcast-sheet" },
  budgetWhy: { title: "予算の根拠整理シート", href: "/lab/whitepapers/budget-justification-sheet" },
  dayPlan: { title: "90日計画テンプレート", href: "/lab/whitepapers/90-day-plan-template" },
  skillmap: { title: "スキルマップ＆評価シート", href: "/lab/whitepapers/skillmap" },
  aiContent: { title: "AIの回答に使われるコンテンツの作り方", href: "/lab/whitepapers/flow-to-stock-ideas" },
};

const POST = {
  cacPayback: "/lab/blog/cac-payback-period-btob",
  unitEconomics: "/lab/blog/lead-volume-to-unit-economics",
  aiUseCases: "/lab/blog/generative-ai-marketing-use-cases",
  adCostRate: "/lab/blog/advertising-cost-market-rate",
};

/** 右のカード（2026-11-02：1枚ずつ説明を書く。行き先と説明はここで1回だけ書いて使い回す） */
const L: Record<string, NextLink> = {
  budgetMakeKit: {
    type: "kit",
    title: "予算作成Kit",
    desc: "売上目標から必要なリード数と予算を逆算し、人件費も含めたチャネル別の年間予算表（Excel）を作ります。",
    href: "/tools/budget-simulator",
  },
  budgetCheckKit: {
    type: "kit",
    title: "予算案診断Kit",
    desc: "AIや自社で作った予算案を取りこみ、CPL・CACのNGを直して、年間予算表（Excel）に仕上げます。",
    href: "/tools/budget-checker",
  },
  annualBudget: {
    type: "resource",
    title: "年間予算表",
    desc: "売上目標から必要な件数を逆算し、チャネル別の件数と費用で足りるかを確かめるシートです。使い方ガイドつき。",
    href: "/lab/whitepapers/kgi-kpi-backcast-sheet",
  },
  budgetWhy: {
    type: "resource",
    title: "予算の根拠整理シート",
    desc: "「なぜ今・なぜこの額・なぜこの施策」に答える根拠を5つのステップで組み立て、稟議や会議に貼れる1枚にまとめます。",
    href: "/lab/whitepapers/budget-justification-sheet",
  },
  dayPlan: {
    type: "resource",
    title: "90日計画テンプレート",
    desc: "立ち上げや着任から最初の90日でやることを、3か月・8つのステップに分けて1枚の計画にまとめます。",
    href: "/lab/whitepapers/90-day-plan-template",
  },
  skillmap: {
    type: "resource",
    title: "スキルマップ＆評価シート",
    desc: "マーケの仕事に必要な力を5つの領域・15の行動で示し、一人前の線に届いていない項目を見つけます。",
    href: "/lab/whitepapers/skillmap",
  },
  aiContent: {
    type: "resource",
    title: "AIの回答に使われるコンテンツの作り方",
    desc: "ウェビナーや展示会など6つの施策から、AIの回答に使われる録画・資料・FAQ・記事を作る方法をまとめたアイデア集です。",
    href: "/lab/whitepapers/flow-to-stock-ideas",
  },
  cacPayback: {
    type: "post",
    title: "新規1社にいくらまでかけてよいか",
    desc: "BtoBのCACの上限を、LTVと回収期間を粗利で出して決める方法を解説します。",
    href: "/lab/blog/cac-payback-period-btob",
  },
  unitEconomics: {
    type: "post",
    title: "BtoBマーケの評価軸は「リード数」から「CAC」へ",
    desc: "CPLが安い施策ほどCACが高くなる理由と、許容単価を書き足して管理する方法を解説します。",
    href: "/lab/blog/lead-volume-to-unit-economics",
  },
  aiUseCases: {
    type: "post",
    title: "生成AIのマーケティング活用、どの業務から任せる？",
    desc: "マーケティングの業務のうち、どこから生成AIに任せるかを考えるための記事です。",
    href: "/lab/blog/generative-ai-marketing-use-cases",
  },
  adCostRate: {
    type: "post",
    title: "広告費の相場は売上の何%？",
    desc: "広告宣伝費が売上の何%かという相場と、その数字を予算づくりでどう使うかを解説します。",
    href: "/lab/blog/advertising-cost-market-rate",
  },
  seoTag: {
    type: "tag",
    title: "SEOの記事一覧",
    desc: "タイトル・見出し・説明文など、検索で読まれるページの基本をまとめて読めます。",
    href: "/lab/tag/seo",
  },
  aioTag: {
    type: "tag",
    title: "AIO・AEO・LLMO・GEOの記事一覧",
    desc: "AI検索・生成AIの回答に、自社のページを使ってもらうための記事をまとめて読めます。",
    href: "/lab/tag/aio-aeo",
  },
};

export const TOOL_NEXT_STEPS: Record<string, ToolNextStepData> = {
  "/tools/roas-cac-simulator": {
    guide: {
      text: "1社あたりのCACの上限を試算するツールです。チャネル別の年間予算まで作るなら",
      ...KIT.budgetMake,
    },
    defaultVariant: "ok",
    variants: {
      ok: {
        title: "この上限CACを、チャネル別の年間予算に落とす",
        body: "上限 {allowable} を超えないように、展示会・Web広告などのチャネルにリード数と費用を配ります。CPL・CACの判定つきで、年間予算表（Excel）になります。",
        cta: { label: "予算作成Kitで予算を作る", href: KIT.budgetMake.href, type: "kit" },
        feature: L.annualBudget,
        links: [L.budgetWhy, L.cacPayback],
      },
      check: {
        title: "上限に近いCACです。チャネル別に見て、余裕を持たせる",
        body: "いまのCACは許容上限の {pct} です。チャネル別のCPL・CACを判定しながら年間予算を作ると、どのチャネルを絞るかが見えます。",
        cta: { label: "予算作成Kitで予算を作る", href: KIT.budgetMake.href, type: "kit" },
        feature: L.annualBudget,
        links: [L.budgetCheckKit, L.cacPayback],
      },
      fix: {
        title: "どのチャネルがCACを押し上げているかを確かめる",
        body: "いまのCACは許容上限を {over} 超えています。予算案を読み込むと、チャネルごとのCPL・CACを判定し、上限を超えている施策がわかります。",
        cta: { label: "予算案診断Kitで確かめる", href: KIT.budgetCheck.href, type: "kit" },
        feature: L.annualBudget,
        links: [L.cacPayback, L.unitEconomics],
      },
    },
  },

  "/tools/seo-aeo-aio-check": {
    guide: {
      text: "自社サイトの対応状況を、自分でチェックする簡易ツールです。AIの回答に使われるコンテンツを作るなら",
      label: WP.aiContent.title,
      href: WP.aiContent.href,
    },
    defaultVariant: "aio",
    variants: {
      aio: {
        title: "AIの回答に使われるコンテンツを作る",
        body: "AEO・AIO/GEOの点が低めです。展示会やウェビナーなどの施策から、AIに引用されやすい録画・ホワイトペーパー・FAQ・記事を作ってください。",
        cta: { label: "AIO・AEOの記事を読む", href: "/lab/tag/aio-aeo", type: "tag" },
        feature: L.aiContent,
        links: [L.aiUseCases, L.seoTag],
      },
      seo: {
        title: "まず、従来のSEOの基本を固める",
        body: "SEOの点がいちばん低い状態です。AI検索も、検索で読まれているページをもとに答えを作ります。タイトル・見出し・説明文から整えてください。",
        cta: { label: "SEOの記事を読む", href: "/lab/tag/seo", type: "tag" },
        feature: L.aiContent,
        links: [L.aioTag, L.aiUseCases],
      },
      good: {
        title: "次は、AIに引用される一次情報を増やす",
        body: "3つとも対応が進んでいます。次は、施策のたびにAIに引用されやすい資料・FAQ・記事を作り、ほかのサイトにない情報を積み上げてください。",
        cta: { label: "AIO・AEOの記事を読む", href: "/lab/tag/aio-aeo", type: "tag" },
        feature: L.aiContent,
        links: [L.aiUseCases, L.seoTag],
      },
    },
  },

  "/tools/inhouse-vs-outsource": {
    guide: {
      text: "体制のコストを比べるツールです。人件費も含めて、施策ごとの年間予算を作るなら",
      ...KIT.budgetMake,
    },
    defaultVariant: "inhouse",
    variants: {
      inhouse: {
        title: "採用するなら、最初の90日の計画から",
        body: "{months}か月の累計では、内製のほうが安くなる試算です。採用した担当者の人件費を予算に入れ、最初の90日で何をするかを決めておくと、立ち上がりが早くなります。",
        cta: { label: "予算作成Kitで予算を作る", href: KIT.budgetMake.href, type: "kit" },
        feature: L.dayPlan,
        links: [L.skillmap, L.budgetWhy],
      },
      outsource: {
        title: "外注するなら、予算の根拠をそろえる",
        body: "{months}か月の累計では、外注のほうが安くなる試算です。外注費を予算に入れるときは、なぜ今・なぜこの額・なぜこの施策かを示すと、通りやすくなります。",
        cta: { label: "予算作成Kitで予算を作る", href: KIT.budgetMake.href, type: "kit" },
        feature: L.budgetWhy,
        links: [L.dayPlan, L.annualBudget],
      },
    },
  },

  "/tools/kpi-benchmark": {
    guide: {
      text: "広告宣伝費を業界の水準と比べるツールです。受注目標から必要な予算を逆算するなら",
      ...KIT.budgetMake,
    },
    defaultVariant: "all",
    variants: {
      all: {
        title: "業界の比率ではなく、受注目標から必要な額を出す",
        body: "比率だけでは、予算の額は決まりません。受注目標から必要なリード数と費用を逆算し、いまの広告宣伝費と並べてください。",
        cta: { label: "予算作成Kitで逆算する", href: KIT.budgetMake.href, type: "kit" },
        feature: L.annualBudget,
        links: [L.adCostRate, L.budgetWhy],
      },
    },
  },
};
