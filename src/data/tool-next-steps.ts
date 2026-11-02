// 1ページ完結のツール（その他のツール）に出す「H1の下の案内」と「結果の直下の次の一手」（2026-11-02）。
// キーはツールのURL。variants のキーは、各ツールの判定（ページのスクリプトが setNextStep() で切り替える）。
// 文中の {名前} は、ページのスクリプトが入れる数字（例 {allowable} = 許容上限CAC）。
// 行き先を変えるときはここだけ編集する。Kit・資料・記事のURLは /tools と /lab の今のURLに合わせる。

export type NextLinkType = "kit" | "resource" | "post" | "tag";

export interface NextLink {
  type: NextLinkType;
  title: string;
  href: string;
}

export interface NextVariant {
  /** 見出し（何をすればよいか） */
  title: string;
  /** 説明文。{名前} はページのスクリプトが数字を入れる */
  body: string;
  /** 黒いボタン（1つだけ） */
  cta: { label: string; href: string; type: NextLinkType };
  /** ボタンの横の小さな案内（任意） */
  sub?: { text: string; label: string; href: string; type: NextLinkType };
  /** 下に1行ずつ並べる資料・記事 */
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
        sub: { text: "スプレッドシートで作りたい方は", label: "年間予算表", href: WP.annualBudget.href, type: "resource" },
        links: [
          { type: "resource", title: `${WP.budgetWhy.title}｜この上限を稟議の根拠にする`, href: WP.budgetWhy.href },
          { type: "post", title: "新規1社にいくらまでかけてよいか｜CAC回収期間とLTVを粗利で出す", href: POST.cacPayback },
        ],
      },
      check: {
        title: "上限に近いCACです。チャネル別に見て、余裕を持たせる",
        body: "いまのCACは許容上限の {pct} です。チャネル別のCPL・CACを判定しながら年間予算を作ると、どのチャネルを絞るかが見えます。",
        cta: { label: "予算作成Kitで予算を作る", href: KIT.budgetMake.href, type: "kit" },
        sub: { text: "予算案がすでにある方は", label: KIT.budgetCheck.label, href: KIT.budgetCheck.href, type: "kit" },
        links: [
          { type: "post", title: "新規1社にいくらまでかけてよいか｜回収期間から上限を決め直す", href: POST.cacPayback },
          { type: "post", title: "評価軸は「リード数」から「CAC」へ｜CPLが安い施策ほどCACが高くなる理由", href: POST.unitEconomics },
        ],
      },
      fix: {
        title: "どのチャネルがCACを押し上げているかを確かめる",
        body: "いまのCACは許容上限を {over} 超えています。予算案を読み込むと、チャネルごとのCPL・CACを判定し、上限を超えている施策がわかります。直した予算案は年間予算表（Excel）でダウンロードできます。",
        cta: { label: "予算案診断Kitで確かめる", href: KIT.budgetCheck.href, type: "kit" },
        sub: { text: "予算案がまだない方は", label: KIT.budgetMake.label, href: KIT.budgetMake.href, type: "kit" },
        links: [
          { type: "post", title: "新規1社にいくらまでかけてよいか｜回収期間から上限を決め直す", href: POST.cacPayback },
          { type: "post", title: "評価軸は「リード数」から「CAC」へ｜CPLが安い施策ほどCACが高くなる理由", href: POST.unitEconomics },
        ],
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
        body: "AEO・AIO/GEOの点が低めです。展示会やウェビナーなどの施策から、AIに引用されやすい録画・ホワイトペーパー・FAQ・記事を作る方法を、資料にまとめています。",
        cta: { label: "資料を無料でダウンロード", href: WP.aiContent.href, type: "resource" },
        links: [
          { type: "tag", title: "AIO・AEO・LLMO・GEOの記事一覧", href: "/lab/tag/aio-aeo" },
          { type: "post", title: "生成AIのマーケティング活用、どの業務から任せる？", href: POST.aiUseCases },
        ],
      },
      seo: {
        title: "まず、従来のSEOの基本を固める",
        body: "SEOの点がいちばん低い状態です。AI検索も、検索で読まれているページをもとに答えを作ります。タイトル・見出し・説明文から整えてください。",
        cta: { label: "SEOの記事を読む", href: "/lab/tag/seo", type: "tag" },
        links: [
          { type: "resource", title: `${WP.aiContent.title}｜SEOの次にやること`, href: WP.aiContent.href },
          { type: "post", title: "生成AIのマーケティング活用、どの業務から任せる？", href: POST.aiUseCases },
        ],
      },
      good: {
        title: "次は、AIに引用される一次情報を増やす",
        body: "3つとも対応が進んでいます。次は、施策のたびにAIに引用されやすい資料・FAQ・記事を作り、ほかのサイトにない情報を積み上げてください。",
        cta: { label: "資料を無料でダウンロード", href: WP.aiContent.href, type: "resource" },
        links: [
          { type: "post", title: "生成AIのマーケティング活用、どの業務から任せる？", href: POST.aiUseCases },
          { type: "tag", title: "AIO・AEO・LLMO・GEOの記事一覧", href: "/lab/tag/aio-aeo" },
        ],
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
        body: "{months}か月の累計では、内製のほうが安くなる試算です。採用した担当者が最初の90日で何をするかを決めておくと、立ち上がりが早くなります。",
        cta: { label: "資料を無料でダウンロード", href: WP.dayPlan.href, type: "resource" },
        links: [
          { type: "resource", title: `${WP.skillmap.title}｜一人前の基準を決める`, href: WP.skillmap.href },
          { type: "kit", title: "予算作成Kit｜人件費を含めて、施策ごとの年間予算を作る", href: KIT.budgetMake.href },
        ],
      },
      outsource: {
        title: "外注するなら、予算の根拠をそろえる",
        body: "{months}か月の累計では、外注のほうが安くなる試算です。外注費を予算に入れるときは、なぜ今・なぜこの額・なぜこの施策かを示すと、通りやすくなります。",
        cta: { label: "資料を無料でダウンロード", href: WP.budgetWhy.href, type: "resource" },
        links: [
          { type: "kit", title: "予算作成Kit｜人件費を含めて、施策ごとの年間予算を作る", href: KIT.budgetMake.href },
          { type: "resource", title: `${WP.dayPlan.title}｜外注先と最初の90日を決める`, href: WP.dayPlan.href },
        ],
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
        sub: { text: "スプレッドシートで作りたい方は", label: "年間予算表", href: WP.annualBudget.href, type: "resource" },
        links: [
          { type: "post", title: "広告費の相場は売上の何%？", href: POST.adCostRate },
          { type: "resource", title: `${WP.budgetWhy.title}｜差がある理由を説明する`, href: WP.budgetWhy.href },
        ],
      },
    },
  },
};
