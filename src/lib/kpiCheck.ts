// src/lib/kpiCheck.ts
//
// KPI運用チェッカー（/tools/kpi-check）の計算と判定。画面（src/pages/tools/kpi-check.astro）から使う。
// 仕様: Googleドライブ「MKTG.AX／共有（正本）／04_ツール仕様／KPI運用チェッカー 仕様」（2026-10-18）
// 2026-10-23 改修: ステップごとのページ（/tools/kpi-check/setup/1〜6、/monthly/1〜5）に分けた。
// - 入力は「件数」と「率」を選べる（ツリー・施策ごと）。もう一方は計算で出すので、ツリーの逆算の検算（旧 判定1）はやめた
// - 空欄は一般的な値（GENERAL・LINKS。2年目以降の会社の目安）で計算する。画面の薄い文字（プレースホルダ）と同じ値
// - 入力そのもの（raw）は data.plan に置き、判定・PDFには resolvePlan() で空欄を埋めた plan を使う
// 数字の定義: 同「数字の定義（KPI・予算）」。CACの上限・許容CPLは src/lib/budget-calc.ts と共通
// - 計算はすべてブラウザ内。金額は万円、率は%で入れて内部は 0〜1 で扱う
// - 運用の月は期首から12か月（index 0〜11）。期間が年より短いときは、期間の目標を期間ごとにくり返す
import { allowableCpl, cacLimit, clean } from "@/lib/budget-calc";

export const DATA_VERSION = 2;
export const SETTLED_THRESHOLD = 10; // 受注率は決着した商談がこの件数たまってから判定する
export const SMALL_THRESHOLD = 10; // 月の目標がこれ未満のKPIは直近3か月の合計で判定する
export const WINDOW = 3;
export const RECALC_TOLERANCE = 0.05; // 施策のリード目標の合計とツリーのリード数の差の許容範囲（±5%）
export const BASE_RATES = { deal: 0.15, win: 0.29 }; // 一般的な値（基本モデルの成長期＝2年目以降）
export const MEASURE_ARTICLE_URL = "/blog/category/kpi-measurement"; // 判定9の案内先（仮）

// ---------- 期間 ----------
export type Period = "month" | "quarter" | "half" | "year";
export const PERIODS: { key: Period; label: string; months: number }[] = [
  { key: "month", label: "月次", months: 1 },
  { key: "quarter", label: "四半期", months: 3 },
  { key: "half", label: "半期", months: 6 },
  { key: "year", label: "年", months: 12 },
];
export const periodMonths = (p: Period): number => PERIODS.find((x) => x.key === p)?.months ?? 12;
export const periodLabel = (p: Period): string => PERIODS.find((x) => x.key === p)?.label ?? "年";

// ---------- 施策とKPIの定義（仕様 3章） ----------
export type MeasureId = "expo" | "ads" | "site" | "dl" | "mail" | "seminar";
export const MEASURE_IDS: MeasureId[] = ["expo", "ads", "site", "dl", "mail", "seminar"];
/** count=件数（月に割る）／rate=率（目標は%、実績は件数から計算）／cpl=CPL（低いほど良い）／level=残高（配信リスト数。月に割らない）／ref=参考値（判定しない） */
export type KpiKind = "count" | "rate" | "cpl" | "level" | "ref";

export interface FieldDef {
  key: string;
  label: string;
  unit: string;
}
export interface KpiDef {
  key: string;
  label: string;
  kind: KpiKind;
  num?: string; // 実績の欄（count・level は値そのもの、rate は分子）
  den?: string; // rate の分母の欄
  lead?: boolean; // 施策の「リード数」（判定2・CPL・撤退に使う）
}
export interface MeasureDef {
  id: MeasureId;
  name: string;
  short: string;
  fields: FieldDef[];
  kpis: KpiDef[];
  /** 判定3で「置きかえ」を示すKPI（受注に近いもの） */
  closest: string;
}

export const MEASURES: Record<MeasureId, MeasureDef> = {
  expo: {
    id: "expo",
    name: "展示会",
    short: "展示会",
    fields: [
      { key: "visits", label: "立ち寄り数", unit: "件" },
      { key: "cards", label: "名刺の獲得数", unit: "件" },
      { key: "target", label: "うち狙う相手", unit: "件" },
      { key: "reached", label: "うち会期後に連絡がついた", unit: "件" },
    ],
    kpis: [
      { key: "visits", label: "立ち寄り数", kind: "count", num: "visits" },
      { key: "cards", label: "名刺の獲得数", kind: "count", num: "cards", lead: true },
      { key: "targetRate", label: "狙う相手の割合", kind: "rate", num: "target", den: "cards" },
      { key: "reachRate", label: "会期後に連絡がついた割合", kind: "rate", num: "reached", den: "cards" },
    ],
    closest: "cards",
  },
  ads: {
    id: "ads",
    name: "Web広告",
    short: "Web広告",
    fields: [
      { key: "imp", label: "表示回数", unit: "回" },
      { key: "clicks", label: "クリック数", unit: "件" },
      { key: "leads", label: "フォーム送信数（リード数）", unit: "件" },
      { key: "target", label: "うち狙う相手", unit: "件" },
    ],
    kpis: [
      { key: "imp", label: "表示回数", kind: "count", num: "imp" },
      { key: "ctr", label: "クリック率", kind: "rate", num: "clicks", den: "imp" },
      { key: "cvr", label: "フォーム送信率", kind: "rate", num: "leads", den: "clicks" },
      { key: "leads", label: "リード数", kind: "count", num: "leads", lead: true },
      { key: "cpl", label: "CPL", kind: "cpl" },
      { key: "targetRate", label: "狙う相手の割合", kind: "rate", num: "target", den: "leads" },
    ],
    closest: "leads",
  },
  site: {
    id: "site",
    name: "自社サイト（SEO・コンテンツ）",
    short: "自社サイト",
    fields: [
      { key: "organic", label: "自然検索の流入数", unit: "件" },
      { key: "leads", label: "問い合わせ・資料請求の数（リード数）", unit: "件" },
      { key: "target", label: "うち狙う相手", unit: "件" },
    ],
    kpis: [
      { key: "organic", label: "自然検索の流入数", kind: "count", num: "organic" },
      { key: "inqRate", label: "問い合わせ・資料請求の率", kind: "rate", num: "leads", den: "organic" },
      { key: "leads", label: "リード数", kind: "count", num: "leads", lead: true },
      { key: "targetRate", label: "狙う相手の割合", kind: "rate", num: "target", den: "leads" },
    ],
    closest: "leads",
  },
  dl: {
    id: "dl",
    name: "資料ダウンロード（ホワイトペーパー）",
    short: "資料ダウンロード",
    fields: [
      { key: "views", label: "資料ページの閲覧数", unit: "件" },
      { key: "dls", label: "ダウンロード数", unit: "件" },
      { key: "target", label: "うち狙う相手", unit: "件" },
      { key: "inquiries", label: "その後の問い合わせ・相談の数", unit: "件" },
    ],
    kpis: [
      { key: "views", label: "資料ページの閲覧数", kind: "count", num: "views" },
      { key: "dlRate", label: "ダウンロード率", kind: "rate", num: "dls", den: "views" },
      { key: "dls", label: "ダウンロード数", kind: "count", num: "dls", lead: true },
      { key: "targetRate", label: "狙う相手の割合", kind: "rate", num: "target", den: "dls" },
      { key: "inquiries", label: "その後の問い合わせ・相談の数", kind: "count", num: "inquiries" },
    ],
    closest: "inquiries",
  },
  mail: {
    id: "mail",
    name: "メール（メルマガ）",
    short: "メール",
    fields: [
      { key: "list", label: "配信リスト数", unit: "件" },
      { key: "sent", label: "配信数（送った通数）", unit: "通" },
      { key: "delivered", label: "到達数", unit: "通" },
      { key: "opened", label: "開封数", unit: "件" },
      { key: "clicks", label: "クリック数", unit: "件" },
      { key: "conv", label: "問い合わせ・申込の数", unit: "件" },
    ],
    kpis: [
      { key: "list", label: "配信リスト数", kind: "level", num: "list" },
      { key: "delivRate", label: "到達率", kind: "rate", num: "delivered", den: "sent" },
      { key: "openRate", label: "開封率（参考値）", kind: "ref", num: "opened", den: "delivered" },
      { key: "ctr", label: "クリック率", kind: "rate", num: "clicks", den: "delivered" },
      { key: "conv", label: "問い合わせ・申込の数", kind: "count", num: "conv", lead: true },
    ],
    closest: "conv",
  },
  seminar: {
    id: "seminar",
    name: "セミナー（ウェビナーを含む）",
    short: "セミナー",
    fields: [
      { key: "apps", label: "申込数", unit: "件" },
      { key: "attend", label: "参加数", unit: "件" },
      { key: "survey", label: "アンケートの回答数", unit: "件" },
      { key: "consult", label: "個別相談の希望数", unit: "件" },
    ],
    kpis: [
      { key: "apps", label: "申込数", kind: "count", num: "apps", lead: true },
      { key: "attendRate", label: "参加率", kind: "rate", num: "attend", den: "apps" },
      { key: "surveyRate", label: "アンケートの回答率", kind: "rate", num: "survey", den: "attend" },
      { key: "consult", label: "個別相談の希望数", kind: "count", num: "consult" },
    ],
    closest: "consult",
  },
};

export const leadKpi = (id: MeasureId): KpiDef => MEASURES[id].kpis.find((k) => k.lead) as KpiDef;

/** 共通（リードになった後）。全体で1組 */
export const COMMON_KPIS = [
  { key: "handoffRate", label: "営業に渡せる割合" },
  { key: "dealRate", label: "商談化率" },
  { key: "winRate", label: "受注率" },
] as const;
export type CommonKey = (typeof COMMON_KPIS)[number]["key"];

// ---------- 打ち手の候補表（仕様 7章） ----------
export const SOURCES: Record<string, { name: string; url: string }> = {
  A: { name: "展示会営業マーケティング「展示会白書」来場者調査（2026年4月）", url: "https://prtimes.jp/main/html/rd/p/000000091.000063081.html" },
  B: { name: "Sansan「顧客フォローアップの状況調査」ほか（2024年・2025年）", url: "https://sin.sansan.com/wp-content/uploads/2025/04/sansan-exhibition-mail-followup.pdf" },
  C: { name: "Google 広告ヘルプ「検索キャンペーンの品質スコアについて」", url: "https://support.google.com/google-ads/answer/6167118?hl=ja-jp" },
  D: { name: "Google 広告ヘルプ「検索語句レポートを使って除外キーワードの候補を取得する」", url: "https://support.google.com/google-ads/answer/7102466?hl=ja" },
  E: { name: "イントリックス 製造業の購買行動調査2025（2024年12月）", url: "https://webtan.impress.co.jp/r/prtimes/items/000000043.000027606" },
  F: { name: "IDEATECH BtoB購買プロセスの調査（2026年2月）", url: "https://webtan.impress.co.jp/n/2026/02/17/52160" },
  G: { name: "総務省 特定電子メール法", url: "https://www.soumu.go.jp/main_sosiki/joho_tsusin/policyreports/chousa/mail_ken/pdf/071220_2_4.pdf" },
  H: { name: "Gmail「メール送信者のガイドライン」（窓の杜、2024年）", url: "https://forest.watch.impress.co.jp/docs/news/1566913.html" },
  I: { name: "グリーゼ「第3回 BtoBメール閲覧実態調査」（2025年5月）", url: "https://gliese.co.jp/success/resource_files/WP_report_btobmail.pdf" },
  J: { name: "Appleのメールプライバシー保護（Twilio SendGrid、2021年）", url: "https://www.twilio.com/ja-jp/blog/apple-mail-privacy-protection-jp" },
  K: { name: "IDEATECH・Bizibl リサーチカンファレンスシリーズ（2025年7月）", url: "https://webtan.impress.co.jp/r/prtimes/items/000000194.000048571" },
  L: { name: "Oldroyd ほか「The Short Life of Online Sales Leads」HBR（2011年・米国）", url: "https://scholarsarchive.byu.edu/facpub/9711" },
  M: { name: "ワンマーケティング「BtoB購買プロセス白書2025」", url: "https://prtimes.jp/main/html/rd/p/000000013.000068653.html" },
};

export interface ActionItem {
  text: string;
  basis: string;
  src: string[]; // SOURCES のキー
  /** 共通の「営業に渡せる割合」だけ：この施策を選んでいるときに出す */
  when?: MeasureId;
}

export const ACTIONS: Record<string, ActionItem[]> = {
  "expo.visits": [
    {
      text: "ブースの見出しを来場者の業務課題の言葉にする／実物展示やデモを置く／会期前に案内を送り、立ち寄るブースに入れてもらう",
      basis: "立ち寄る決め手は「業務課題に直結するキーワードや展示内容」51.5%、「実物展示やデモ体験」40.1%、「事前に気になっていた企業」36.8%。すべて当日に決めた人は8.8%",
      src: ["A"],
    },
  ],
  "expo.cards": [
    {
      text: "ブースで売り込まず、質問に答えられる技術者を立てる／導入事例を見せる",
      basis: "期待外れのブースは「売り込み感が強い」42.4%、「質問に的確な回答がない」40.1%。期待以上は「開発者やエンジニアから直接話を聞けた」49.1%、「他社では聞けない導入事例」42.2%",
      src: ["A"],
    },
  ],
  "expo.targetRate": [
    {
      text: "名刺ごとに来場目的（情報収集か商談か）を記録して分ける",
      basis: "来場目的は「情報収集・トレンド把握」52.3%、「特定の製品の商談」42.7%",
      src: ["A"],
    },
  ],
  "expo.reachRate": [
    {
      text: "全員に連絡する／ブースで話した内容を踏まえて連絡する／その後は月1回程度、業務に関わる情報を送る",
      basis: "フォローを「数回に1回」「全くしない」が77%。来場者の71.6%がフォローに不満、最多は「ブースの話と無関係な営業」50.6%。理想は「会話を踏まえた提案」56.3%。月1回程度のメルマガは85.1%が目を通す",
      src: ["B", "A"],
    },
  ],
  "ads.ctr": [
    {
      text: "広告文をキーワードの検索意図に合わせ、広告とランディングページの内容をそろえる",
      basis: "品質スコアは推定クリック率・広告の関連性・ランディングページの利便性で診断される。品質スコア自体はKPIにしない",
      src: ["C"],
    },
  ],
  "ads.cvr": [
    {
      text: "広告文をキーワードの検索意図に合わせ、広告とランディングページの内容をそろえる",
      basis: "品質スコアは推定クリック率・広告の関連性・ランディングページの利便性で診断される。品質スコア自体はKPIにしない",
      src: ["C"],
    },
  ],
  "ads.targetRate": [
    {
      text: "検索語句レポートで関連性の低い語句を見つけ、除外キーワードに入れる",
      basis: "検索語句レポートで、関連性の低い語句を除外キーワードの候補として確認できる",
      src: ["D"],
    },
  ],
  "site.inqRate": [
    {
      text: "製品の基本情報・競合との比較・導入事例・導入条件とコスト感のページをそろえる／問い合わせはフォームと電話の両方を用意する",
      basis: "見ている情報は基本情報71%、競合との比較41%、導入事例39%、導入条件やコスト感36%。接点のない企業への問い合わせはフォーム45%、電話31%",
      src: ["E"],
    },
  ],
  "dl.inquiries": [
    {
      text: "一般論や自社宣伝ではなく、実務で使える内容にする／データを新しくする",
      basis: "ダウンロード資料に「がっかり」した経験88.2%。理由は「内容が薄く一般的」70.5%、「ノウハウに見せかけた自社宣伝」45.9%、「情報が古い」30.6%",
      src: ["F"],
    },
    {
      text: "ダウンロード直後に電話しない",
      basis: "直後の電話を「検討前で迷惑」57.8%。最も印象が悪くなる行動の1位は「ダウンロード直後の即架電やしつこいアポ打診」27.2%",
      src: ["F"],
    },
  ],
  "mail.list": [
    {
      text: "名刺交換・展示会・セミナー・資料ダウンロードで接点を持った人を、法律に沿ってリストに入れる。フォームに配信の同意欄を置く",
      basis: "広告・宣伝メールは原則として事前に同意した人にしか送れない。例外は、アドレスを送信者に知らせた人、取引関係にある人など",
      src: ["G"],
    },
  ],
  "mail.delivRate": [
    {
      text: "送信ドメインにSPF・DKIM・DMARCを設定する／ワンクリックで配信停止できるようにする／同意のない相手に送らない",
      basis: "1日5,000通以上の送信者に、認証の設定、迷惑メール率0.10%未満（0.30%以上にしない）、ワンクリックの配信停止を求めている。BtoBメールの受信先はGmail 38.6%、Yahooメール38.0%、会社のアドレス36.3%",
      src: ["H", "I"],
    },
  ],
  "mail.openRate": [
    {
      text: "差出人名を読者が知っている担当者名・会社名にする／件名を読者の課題や関心の言葉にする／プレヘッダーを書く／配信は週1回〜隔週にする",
      basis: "読むのは「差出人が知っている人」42.2%、「件名が関心事に関連」40.8%、「件名が課題に関連」28.5%、「プレヘッダーに興味」22.6%。適切な頻度は「週1回程度」42.3%、「2週間に1回程度」24.4%。開封率は実際より高く出る",
      src: ["I", "J"],
    },
  ],
  "mail.ctr": [
    {
      text: "本文をスマホで1スクロール以内に収め、スマホで表示を確かめる",
      basis: "スマホでも読む人は6割以上、適切な長さは「1スクロール以内」が6割超。不満の1位は「メールが長すぎる」44.0%。形式は「どちらでもいい」51.1%",
      src: ["I"],
    },
  ],
  "seminar.apps": [
    {
      text: "テーマを読者の課題に絞り、内容を作り込む",
      basis: "65.2%が「案内が増えた」、78.7%が内容にがっかりした経験あり、85.1%が「内容次第で企業の評価が下がる」",
      src: ["K"],
    },
  ],
  "common.handoffRate": [
    {
      text: "問い合わせには、すぐ（目安は1時間以内）に連絡する",
      basis: "1時間以内に連絡した企業は、1時間後の企業より決裁者と有意な会話ができる確率が約7倍（2011年・米国）",
      src: ["L"],
      when: "site",
    },
    {
      text: "資料ダウンロードには、すぐに電話しない",
      basis: "直後の電話を「検討前で迷惑」57.8%。最も印象が悪くなる行動の1位は「ダウンロード直後の即架電やしつこいアポ打診」27.2%",
      src: ["F"],
      when: "dl",
    },
  ],
  "common.dealRate": [
    {
      text: "フォームで、比較している相手と検討の時期を聞く",
      basis: "85%が営業との初回面談の前に候補を絞っている",
      src: ["M"],
    },
  ],
  "common.winRate": [
    {
      text: "導入事例とサポート体制の資料を、マーケが営業に用意する",
      basis: "購買の後半は営業の説明・提案が最も重視され、意思決定者は導入企業の満足度・サポート品質を重視する",
      src: ["M"],
    },
  ],
};

/** 打ち手を取り出す。共通の「営業に渡せる割合」は、選んだ施策で出し分ける（自社サイト＝すぐ連絡、資料DL＝すぐ電話しない） */
export function actionsFor(key: string, selected: MeasureId[]): ActionItem[] {
  const list = ACTIONS[key] || [];
  if (key !== "common.handoffRate") return list;
  const hit = list.filter((a) => a.when && selected.includes(a.when));
  return hit.length ? hit : list.filter((a) => a.when === "site");
}

// ---------- データ ----------
export interface KpiPlan {
  target: number | null; // count・level＝件数、rate＝%、cpl＝万円
  monthly: (number | null)[]; // 月別の目標（任意。期間の月数ぶん）
  measurable: boolean; // 今その数字を取れているか
}
export interface OtherPlan {
  name: string;
  after: string; // 施策の中で、どの欄のあとに置くか（欄の key。空＝最後）
  target: number | null;
  monthly: (number | null)[];
  measurable: boolean;
}
export interface CostParts {
  ext: number | null; // 外部に払う費用
  labor: number | null; // 人件費
  tool: number | null; // ツール代
}
export type InputMode = "count" | "rate";
export interface MeasurePlan {
  on: boolean;
  mode: InputMode; // 件数で入れるか、率で入れるか
  counts: Record<string, number | null>; // 欄（fields）ごとの期間の目標件数（件数モードはすべて、率モードは件数のKPIの欄だけ使う）
  rates: Record<string, number | null>; // 率のKPIの目標 %（率モードで使う）
  kpis: Record<string, KpiPlan>; // 月別の目標・今取れているか（目標そのものは resolvePlan で入る）
  others: OtherPlan[];
  cost: number | null;
  parts: CostParts;
  start: number; // 開始月（期首からの月数 0〜11）。resolvePlan が月別の目標から出す（最初に目標が入った月。なければ期首）
  exitAfter: number | null; // 撤退を判定する月＝開始月＋N。resolvePlan が exitAt から出す
  exitAt: number | null; // 撤退を判定し始める月（期首からの月数 0〜11）。null＝決めない
  cplCap: number | null;
  cplCapTouched: boolean; // false のあいだは許容CPLを初期値として入れる
}
export interface PlanMeta {
  /** 一般的な値のまま計算した項目（ツリー）："sales" | "price" | "wins" | "winRate" | "deals" | "dealRate" | "leads" | "cycle" | "margin" | "years" */
  treeDefaults: string[];
  /** 施策ごとの、一般的な値のまま計算したKPI（key） */
  measureDefaults: Partial<Record<MeasureId, string[]>>;
}
export interface Plan {
  treeMode: InputMode; // ツリーを件数で入れるか、率で入れるか
  meta?: PlanMeta; // resolvePlan が付ける
  period: Period;
  startYear: number;
  startMonth: number; // 1〜12
  manageDay: number | null; // 1〜28、31＝月末、null＝決めない
  sales: number | null;
  price: number | null;
  wins: number | null;
  winRate: number | null; // %
  deals: number | null;
  dealRate: number | null; // %
  leads: number | null;
  cycle: number | null; // 商談から受注までの平均期間（月）
  margin: number | null; // 粗利率 %
  years: number | null; // 取り返す年数
  decider: string;
  review: string;
  handoffTarget: number | null; // 営業に渡せる割合（リード→営業に渡す）%。ツリーを率で入れるときの入力。resolvePlan が必ず入れる
  handoffs: number | null; // 営業に渡す数（ツリーを件数で入れるときの入力）
  mqlDealRate: number | null; // 営業に渡したうち商談になる割合 %（ツリーを率で入れるときの入力）
  commonMeasurable: Record<CommonKey, boolean>;
  measures: Record<MeasureId, MeasurePlan>;
}
export interface MeasureMonth {
  f: Record<string, number | null>;
  others: (number | null)[];
  cost: number | null;
  parts: CostParts;
  did: string;
}
export interface CommonMonth {
  handoff: number | null;
  deals: number | null;
  dealAmt: number | null;
  wins: number | null;
  winAmt: number | null;
  losses: number | null;
  lossAmt: number | null;
}
export interface Month {
  m: Record<MeasureId, MeasureMonth>;
  c: CommonMonth;
}
export interface KcData {
  v: number;
  mode: "first" | "monthly";
  plan: Plan;
  months: Month[];
  reportIndex: number;
  email?: string;
}

const emptyParts = (): CostParts => ({ ext: null, labor: null, tool: null });

export function emptyMeasurePlan(id: MeasureId): MeasurePlan {
  const kpis: Record<string, KpiPlan> = {};
  for (const k of MEASURES[id].kpis) kpis[k.key] = { target: null, monthly: [], measurable: true };
  const counts: Record<string, number | null> = {};
  for (const f of MEASURES[id].fields) counts[f.key] = null;
  const rates: Record<string, number | null> = {};
  for (const l of LINKS[id]) rates[l.b] = null; // つながりの先の欄（b）ごとの率 %（月の配信回数は回）
  return { on: false, mode: "count", counts, rates, kpis, others: [], cost: null, parts: emptyParts(), start: 0, exitAfter: 6, exitAt: 6, cplCap: null, cplCapTouched: false };
}

export function emptyMeasureMonth(id: MeasureId): MeasureMonth {
  const f: Record<string, number | null> = {};
  for (const x of MEASURES[id].fields) f[x.key] = null;
  return { f, others: [], cost: null, parts: emptyParts(), did: "" };
}

export const emptyCommonMonth = (): CommonMonth => ({ handoff: null, deals: null, dealAmt: null, wins: null, winAmt: null, losses: null, lossAmt: null });

export function emptyMonth(): Month {
  const m = {} as Record<MeasureId, MeasureMonth>;
  for (const id of MEASURE_IDS) m[id] = emptyMeasureMonth(id);
  return { m, c: emptyCommonMonth() };
}

export function emptyPlan(now = new Date()): Plan {
  const measures = {} as Record<MeasureId, MeasurePlan>;
  for (const id of MEASURE_IDS) measures[id] = emptyMeasurePlan(id);
  // 期首は4月。今日が4月より前なら前年の4月
  const y = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    treeMode: "count",
    period: "year",
    startYear: y,
    startMonth: 4,
    manageDay: 5,
    sales: null,
    price: null,
    wins: null,
    winRate: null,
    deals: null,
    dealRate: null,
    leads: null,
    cycle: null,
    margin: null,
    years: null,
    decider: "",
    review: "",
    handoffTarget: null,
    handoffs: null,
    mqlDealRate: null,
    commonMeasurable: { handoffRate: true, dealRate: true, winRate: true },
    measures,
  };
}

export function emptyData(now = new Date()): KcData {
  return { v: DATA_VERSION, mode: "first", plan: emptyPlan(now), months: Array.from({ length: 12 }, emptyMonth), reportIndex: 0 };
}

const numOrNull = (x: any): number | null => (typeof x === "number" && isFinite(x) ? x : null);
const numArr = (a: any): (number | null)[] => (Array.isArray(a) ? a.slice(0, 12).map(numOrNull) : []);
const str = (x: any, max = 400): string => (typeof x === "string" ? x.slice(0, max) : "");
const bool = (x: any, d: boolean): boolean => (typeof x === "boolean" ? x : d);
const parts = (p: any): CostParts => ({ ext: numOrNull(p?.ext), labor: numOrNull(p?.labor), tool: numOrNull(p?.tool) });

/** 読み込んだデータ（localStorage・PDF）を、今の形にそろえる。足りない欄は空で補う */
export function normalizeData(raw: any): KcData {
  const d = emptyData();
  if (!raw || typeof raw !== "object") return d;
  const p = raw.plan || {};
  const plan = d.plan;
  const v1 = !(raw.v >= 2);
  plan.treeMode = p.treeMode === "rate" ? "rate" : "count";
  if (PERIODS.some((x) => x.key === p.period)) plan.period = p.period;
  if (Number.isInteger(p.startYear) && p.startYear > 2000 && p.startYear < 2100) plan.startYear = p.startYear;
  if (Number.isInteger(p.startMonth) && p.startMonth >= 1 && p.startMonth <= 12) plan.startMonth = p.startMonth;
  plan.manageDay = Number.isInteger(p.manageDay) && p.manageDay >= 1 && p.manageDay <= 31 ? p.manageDay : p.manageDay === null ? null : plan.manageDay;
  for (const k of ["sales", "price", "wins", "winRate", "deals", "dealRate", "leads", "cycle", "margin", "years", "handoffTarget", "handoffs", "mqlDealRate"] as const) plan[k] = numOrNull(p[k]);
  plan.decider = str(p.decider, 80);
  plan.review = str(p.review, 80);
  for (const c of COMMON_KPIS) plan.commonMeasurable[c.key] = bool(p.commonMeasurable?.[c.key], true);
  for (const id of MEASURE_IDS) {
    const src = p.measures?.[id];
    if (!src) continue;
    const mp = plan.measures[id];
    mp.on = bool(src.on, false);
    for (const k of MEASURES[id].kpis) {
      const s = src.kpis?.[k.key];
      if (s) mp.kpis[k.key] = { target: k.kind === "cpl" ? numOrNull(s.target) : null, monthly: numArr(s.monthly), measurable: bool(s.measurable, true) };
    }
    if (v1) {
      // 旧版（1ページの版）：KPIの目標をそのまま「率で入れる」の入力に移す
      mp.mode = "rate";
      for (const k of MEASURES[id].kpis) {
        const t = numOrNull(src.kpis?.[k.key]?.target);
        if ((k.kind === "count" || k.kind === "level") && k.num) mp.counts[k.num] = t;
        else if (k.kind === "rate") {
          const l = LINKS[id].find((x) => x.kpi === k.key);
          if (l) mp.rates[l.b] = t;
        }
      }
    } else {
      mp.mode = src.mode === "rate" ? "rate" : "count";
      for (const f of MEASURES[id].fields) mp.counts[f.key] = numOrNull(src.counts?.[f.key]);
      for (const l of LINKS[id]) mp.rates[l.b] = numOrNull(src.rates?.[l.b] ?? (l.kpi ? src.rates?.[l.kpi] : null)); // 10-23の最初の版は率のKPIの key で持っていた
    }
    mp.others = Array.isArray(src.others)
      ? src.others.slice(0, 5).map((o: any) => ({ name: str(o?.name, 40), after: MEASURES[id].fields.some((f) => f.key === o?.after) ? o.after : "", target: numOrNull(o?.target), monthly: numArr(o?.monthly), measurable: bool(o?.measurable, true) }))
      : [];
    mp.cost = numOrNull(src.cost);
    mp.parts = parts(src.parts);
    mp.start = Number.isInteger(src.start) && src.start >= 0 && src.start <= 11 ? src.start : 0;
    mp.exitAfter = Number.isInteger(src.exitAfter) && src.exitAfter >= 1 && src.exitAfter <= 11 ? src.exitAfter : src.exitAfter === null ? null : 6;
    mp.exitAt =
      src.exitAt === null ? null : Number.isInteger(src.exitAt) && src.exitAt >= 0 && src.exitAt <= 11 ? src.exitAt : mp.exitAfter === null ? null : Math.min(11, mp.start + mp.exitAfter);
    mp.cplCap = numOrNull(src.cplCap);
    mp.cplCapTouched = bool(src.cplCapTouched, false);
  }
  if (Array.isArray(raw.months)) {
    raw.months.slice(0, 12).forEach((rm: any, i: number) => {
      const m = d.months[i];
      for (const id of MEASURE_IDS) {
        const s = rm?.m?.[id];
        if (!s) continue;
        for (const fd of MEASURES[id].fields) m.m[id].f[fd.key] = numOrNull(s.f?.[fd.key]);
        m.m[id].others = numArr(s.others);
        m.m[id].cost = numOrNull(s.cost);
        m.m[id].parts = parts(s.parts);
        m.m[id].did = str(s.did, 400);
      }
      for (const k of Object.keys(m.c) as (keyof CommonMonth)[]) m.c[k] = numOrNull(rm?.c?.[k]);
    });
  }
  if (v1) plan.treeMode = "count"; // 旧版は7項目すべて入っている。件数（売上・受注・商談・リード）を使う
  d.mode = raw.mode === "monthly" ? "monthly" : "first";
  d.reportIndex = Number.isInteger(raw.reportIndex) ? Math.min(11, Math.max(0, raw.reportIndex)) : 0;
  if (typeof raw.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email)) d.email = raw.email;
  return d;
}

// ---------- 小さな計算 ----------
export const selectedMeasures = (plan: Plan): MeasureId[] => MEASURE_IDS.filter((id) => plan.measures[id].on);
const sumParts = (p: CostParts): number | null => (p.ext === null && p.labor === null && p.tool === null ? null : (p.ext || 0) + (p.labor || 0) + (p.tool || 0));
export const hasParts = (p: CostParts): boolean => p.ext !== null || p.labor !== null || p.tool !== null;
/** 費用の合計。内訳を入れたときは内訳の合計 */
export const costOf = (x: { cost: number | null; parts: CostParts }): number | null => sumParts(x.parts) ?? x.cost;

export function monthOf(plan: Plan, i: number): { year: number; month: number } {
  const t = plan.startMonth - 1 + i;
  return { year: plan.startYear + Math.floor(t / 12), month: (t % 12) + 1 };
}
export const monthLabel = (plan: Plan, i: number): string => `${monthOf(plan, i).month}月`;
export const monthLabelLong = (plan: Plan, i: number): string => {
  const { year, month } = monthOf(plan, i);
  return `${year}年${month}月`;
};
export const rangeLabel = (plan: Plan): string => {
  const a = monthOf(plan, 0);
  const b = monthOf(plan, 11);
  return `${a.year}年${a.month}月〜${b.year}年${b.month}月`;
};
export const manageDayLabel = (d: number | null): string => (d === null ? "決めない" : d === 31 ? "毎月末日" : `毎月${d}日`);

/** 月の目標。月別の目標が1つでも入っていればそれ（空の月は0）、なければ目標÷期間の月数。level は割らない */
export function monthlyTargetOf(kind: KpiKind, target: number | null, monthly: (number | null)[], plan: Plan, i: number): number | null {
  if (target === null) return null;
  if (kind === "rate" || kind === "cpl" || kind === "ref") return target;
  const n = periodMonths(plan.period);
  const idx = i % n;
  if (n > 1 && monthly.slice(0, n).some((v) => v !== null)) return monthly[idx] ?? 0;
  if (kind === "level") return target;
  return target / n;
}

/** 欄（件数）の月の目標。count/level のKPIの目標、なければ rate のKPI×分母の目標から出す */
export function fieldMonthlyTarget(plan: Plan, id: MeasureId, field: string, i: number, depth = 0): number | null {
  if (depth > 4) return null;
  const def = MEASURES[id];
  const mp = plan.measures[id];
  const c = def.kpis.find((k) => (k.kind === "count" || k.kind === "level") && k.num === field);
  if (c) return monthlyTargetOf(c.kind, mp.kpis[c.key].target, mp.kpis[c.key].monthly, plan, i);
  const r = def.kpis.find((k) => k.kind === "rate" && k.num === field);
  if (r && r.den) {
    const rt = mp.kpis[r.key].target;
    const dt = fieldMonthlyTarget(plan, id, r.den, i, depth + 1);
    return rt !== null && dt !== null ? (dt * rt) / 100 : null;
  }
  return null;
}

/** 施策の目標のCPL：CPLのKPIの目標（Web広告）、なければ 費用÷リード目標 */
export function targetCplOf(plan: Plan, id: MeasureId): number | null {
  const mp = plan.measures[id];
  const explicit = mp.kpis.cpl?.target ?? null;
  if (explicit !== null) return explicit;
  const cost = costOf(mp);
  const lt = mp.kpis[leadKpi(id).key].target;
  return cost !== null && lt ? cost / lt : null;
}

/** CACの上限・許容CPL（粗利率と取り返す年数があるときだけ） */
export function limitsOf(plan: Plan): { cacLimit: number | null; allowCpl: number | null } {
  if (plan.price === null || plan.margin === null || plan.years === null) return { cacLimit: null, allowCpl: null };
  const lim = cacLimit(plan.price, plan.margin / 100, plan.years);
  const allow = plan.dealRate !== null && plan.winRate !== null ? allowableCpl(lim, plan.dealRate / 100, plan.winRate / 100) : null;
  return { cacLimit: clean(lim), allowCpl: allow === null ? null : clean(allow) };
}

/** CPLの上限（入力がなく、許容CPLが出せるときは許容CPL） */
export function cplCapOf(plan: Plan, id: MeasureId): number | null {
  const mp = plan.measures[id];
  if (mp.cplCapTouched) return mp.cplCap;
  const { allowCpl } = limitsOf(plan);
  return allowCpl === null ? mp.cplCap : Math.round(allowCpl * 10) / 10;
}

// ---------- 一般的な値と、空欄を埋めた plan（2026-10-23） ----------
/** 空欄のときに使う一般的な値（2年目以降の会社の目安。基本モデルの成長期）。画面の薄い文字と同じ。
 *  営業に渡せる割合（MQL化率）37%×商談になる割合40%＝商談化率14.8%（≒15%） */
export const GENERAL = { sales: 3000, price: 250, winRate: 29, dealRate: 15, handoffRate: 37, mqlDealRate: 40, cycle: 3, margin: 40, years: 1.5 } as const;

/** 施策の中の欄のつながり：b ≒ a × r。率で入れるときは、rates[b] で r を置きかえる */
export interface LinkDef {
  a: string;
  b: string;
  r: number; // 一般的な率（0〜1）。perMonth のときは「月あたりの回数」
  label: string; // 率の名前
  kpi?: string; // この率に当たる率のKPI（rate・ref）
  perMonth?: boolean; // a×（期間の月数×r）＝b（メールの配信リスト数→配信数）
}
export const LINKS: Record<MeasureId, LinkDef[]> = {
  expo: [
    { a: "visits", b: "cards", r: 0.15, label: "名刺になる割合" },
    { a: "cards", b: "target", r: 0.4, label: "狙う相手の割合", kpi: "targetRate" },
    { a: "cards", b: "reached", r: 0.7, label: "会期後に連絡がついた割合", kpi: "reachRate" },
  ],
  ads: [
    { a: "imp", b: "clicks", r: 0.015, label: "クリック率", kpi: "ctr" },
    { a: "clicks", b: "leads", r: 0.03, label: "フォーム送信率", kpi: "cvr" },
    { a: "leads", b: "target", r: 0.6, label: "狙う相手の割合", kpi: "targetRate" },
  ],
  site: [
    { a: "organic", b: "leads", r: 0.01, label: "問い合わせ・資料請求の率", kpi: "inqRate" },
    { a: "leads", b: "target", r: 0.5, label: "狙う相手の割合", kpi: "targetRate" },
  ],
  dl: [
    { a: "views", b: "dls", r: 0.06, label: "ダウンロード率", kpi: "dlRate" },
    { a: "dls", b: "target", r: 0.5, label: "狙う相手の割合", kpi: "targetRate" },
    { a: "dls", b: "inquiries", r: 0.15, label: "問い合わせになる割合" },
  ],
  mail: [
    { a: "list", b: "sent", r: 2, label: "月の配信回数", perMonth: true },
    { a: "sent", b: "delivered", r: 0.98, label: "到達率", kpi: "delivRate" },
    { a: "delivered", b: "opened", r: 0.2, label: "開封率（参考）", kpi: "openRate" },
    { a: "delivered", b: "clicks", r: 0.02, label: "クリック率", kpi: "ctr" },
    { a: "clicks", b: "conv", r: 0.05, label: "問い合わせになる割合" },
  ],
  seminar: [
    { a: "apps", b: "attend", r: 0.6, label: "参加率", kpi: "attendRate" },
    { a: "attend", b: "survey", r: 0.8, label: "アンケートの回答率", kpi: "surveyRate" },
    { a: "attend", b: "consult", r: 0.1, label: "相談を希望する割合" },
  ],
};

/** 件数を切り上げる（小数の誤差は切り捨てない） */
const ceilCount = (x: number): number => Math.ceil(clean(x) - 1e-9);
const div = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : a / b);
const round1 = (x: number): number => Math.round(clean(x) * 10) / 10;

/** 率で入れるときの件数の入力欄：一番上の欄だけ（ほかの件数は率から計算） */
export const rateModeCountFields = (id: MeasureId): string[] => [MEASURES[id].fields[0].key];

export interface TreeResolved {
  sales: number;
  price: number | null;
  wins: number;
  winRate: number | null; // %
  deals: number;
  mqlDealRate: number | null; // 営業に渡したうち商談になる割合 %
  handoffs: number;
  handoffRate: number | null; // 営業に渡せる割合 %
  leads: number;
  dealRate: number | null; // 商談化率（商談÷リード）%
  defaults: string[];
}
type TreeKey = "sales" | "price" | "wins" | "winRate" | "deals" | "mqlDealRate" | "handoffs" | "handoffTarget" | "leads";
/** ツリーの空欄を一般的な値で埋める。件数で入れるときは率を、率で入れるときは件数を計算する
 *  売上 →（÷平均単価）受注 →（÷受注率）商談 →（÷商談になる割合）営業に渡す →（÷営業に渡せる割合）リード */
export function resolveTree(p: Plan): TreeResolved {
  const defaults: string[] = [];
  const pick = (k: TreeKey, name: string, gen: () => number): number => {
    const v = p[k];
    if (v !== null && v !== undefined && v > 0) return v;
    defaults.push(name);
    return gen();
  };
  const sales = pick("sales", "sales", () => GENERAL.sales);
  let out: Omit<TreeResolved, "dealRate" | "defaults">;
  if (p.treeMode === "rate") {
    const price = pick("price", "price", () => GENERAL.price);
    const winRate = pick("winRate", "winRate", () => GENERAL.winRate);
    const mqlDealRate = pick("mqlDealRate", "mqlDealRate", () => GENERAL.mqlDealRate);
    const handoffRate = pick("handoffTarget", "handoffRate", () => GENERAL.handoffRate);
    const wins = ceilCount(sales / price);
    const deals = ceilCount(wins / (winRate / 100));
    const handoffs = ceilCount(deals / (mqlDealRate / 100));
    const leads = ceilCount(handoffs / (handoffRate / 100));
    out = { sales, price, wins, winRate, deals, mqlDealRate, handoffs, handoffRate, leads };
  } else {
    const wins = pick("wins", "wins", () => Math.max(1, ceilCount(sales / GENERAL.price)));
    const deals = pick("deals", "deals", () => Math.max(1, ceilCount(wins / (GENERAL.winRate / 100))));
    const handoffs = pick("handoffs", "handoffs", () => Math.max(1, ceilCount(deals / (GENERAL.mqlDealRate / 100))));
    const leads = pick("leads", "leads", () => Math.max(1, ceilCount(handoffs / (GENERAL.handoffRate / 100))));
    // 件数を一般的な値で出したところは、その率も一般的な値のまま
    if (defaults.includes("wins")) defaults.push("price");
    if (defaults.includes("deals")) defaults.push("winRate");
    if (defaults.includes("handoffs")) defaults.push("mqlDealRate");
    if (defaults.includes("leads")) defaults.push("handoffRate");
    const r = (a: number, b: number) => {
      const v = div(a, b);
      return v === null ? null : round1(v * 100);
    };
    const pr = div(sales, wins);
    out = { sales, price: pr === null ? null : round1(pr), wins, winRate: r(wins, deals), deals, mqlDealRate: r(deals, handoffs), handoffs, handoffRate: r(handoffs, leads), leads };
  }
  if (defaults.includes("mqlDealRate") && defaults.includes("handoffRate")) defaults.push("dealRate");
  const dr = div(out.deals, out.leads);
  return { ...out, dealRate: dr === null ? null : round1(dr * 100), defaults };
}

export interface MeasureResolved {
  counts: Record<string, number | null>; // 欄ごとの期間の目標（件数）
  rates: Record<string, number | null>; // つながり（b）ごとの率 0〜1（月の配信回数は回）
  entered: Record<string, boolean>; // 入力した欄（件数）
  targets: Record<string, number | null>; // KPIごとの目標（count・level＝件数、rate・ref＝%）
  leadDefault: boolean; // リード数を入れていない
  defaults: string[]; // 一般的な値のままのKPI
}
/** 施策の欄の空欄を埋める。入れた件数（率で入れるときは一番上の件数と率）から、一般的な率でつないで計算する。
 *  何も入れていない施策は、すべて空（未入力）のまま */
export function resolveMeasure(p: Plan, id: MeasureId, _treeLeads?: number, _nSel?: number): MeasureResolved {
  const def = MEASURES[id];
  const mp = p.measures[id];
  const links = LINKS[id];
  const months = periodMonths(p.period);
  const leadField = leadKpi(id).num!;
  const inputs = mp.mode === "count" ? def.fields.map((f) => f.key) : rateModeCountFields(id);
  const known: Record<string, number | null> = {};
  const entered: Record<string, boolean> = {};
  for (const f of def.fields) {
    const v = inputs.includes(f.key) ? mp.counts[f.key] : null;
    known[f.key] = v !== null && v !== undefined && v >= 0 ? v : null;
    entered[f.key] = known[f.key] !== null;
  }
  const rateEntered = (l: LinkDef) => mp.mode === "rate" && mp.rates[l.b] !== null && mp.rates[l.b] !== undefined;
  const rateOf = (l: LinkDef): number => {
    const v = rateEntered(l) ? mp.rates[l.b]! : null;
    if (l.perMonth) return (v ?? l.r) * months;
    return v !== null ? v / 100 : l.r;
  };
  for (let loop = 0; loop < 8; loop++) {
    let changed = false;
    for (const l of links) {
      const r = rateOf(l);
      if (known[l.b] === null && known[l.a] !== null) {
        known[l.b] = clean(known[l.a]! * r);
        changed = true;
      } else if (known[l.a] === null && known[l.b] !== null && r > 0) {
        known[l.a] = clean(known[l.b]! / r);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const f of def.fields) if (!entered[f.key] && known[f.key] !== null) known[f.key] = ceilCount(known[f.key]!);
  const rates: Record<string, number | null> = {};
  for (const l of links) {
    if (rateEntered(l)) rates[l.b] = l.perMonth ? mp.rates[l.b]! : mp.rates[l.b]! / 100;
    else rates[l.b] = l.perMonth ? div(known[l.b], known[l.a] === null ? null : known[l.a]! * months) : div(known[l.b], known[l.a]);
  }
  const targets: Record<string, number | null> = {};
  const defaults: string[] = [];
  for (const k of def.kpis) {
    if (k.kind === "count" || k.kind === "level") {
      targets[k.key] = known[k.num!];
      if (!entered[k.num!]) defaults.push(k.key);
    } else if (k.kind === "rate" || k.kind === "ref") {
      const link = links.find((l) => l.kpi === k.key);
      if (link && rateEntered(link)) targets[k.key] = mp.rates[link.b];
      else {
        const r = div(known[k.num!], known[k.den!]);
        targets[k.key] = r === null ? null : round1(r * 100);
        const fromInputs = mp.mode === "count" && entered[k.num!] && entered[k.den!];
        if (!fromInputs) defaults.push(k.key);
      }
    } else targets[k.key] = null; // cpl は費用から（resolvePlan）
  }
  return { counts: known, rates, entered, targets, leadDefault: !entered[leadField], defaults };
}

/** 施策の開始月：件数のKPIの月別の目標が最初に入った月（なければ期首） */
export function measureStart(p: Plan, id: MeasureId): number {
  const n = periodMonths(p.period);
  const mp = p.measures[id];
  const arrs = MEASURES[id].kpis.filter((k) => k.kind === "count").map((k) => mp.kpis[k.key].monthly.slice(0, n));
  if (!arrs.some((a) => a.some((v) => v !== null && v !== undefined))) return 0;
  for (let i = 0; i < n; i++) if (arrs.some((a) => (a[i] ?? 0) > 0)) return i;
  return 0;
}

/** 判定・PDF・毎月の計算に使う plan。入力（raw）の空欄を一般的な値で埋め、施策のKPIの目標を入れる */
export function resolvePlan(raw: Plan): Plan {
  const p: Plan = JSON.parse(JSON.stringify(raw));
  const t = resolveTree(raw);
  p.sales = t.sales;
  p.price = t.price;
  p.wins = t.wins;
  p.winRate = t.winRate;
  p.deals = t.deals;
  p.dealRate = t.dealRate;
  p.leads = t.leads;
  p.handoffs = t.handoffs;
  p.handoffTarget = t.handoffRate;
  p.mqlDealRate = t.mqlDealRate;
  const treeDefaults = [...t.defaults];
  for (const k of ["cycle", "margin", "years"] as const) {
    if (raw[k] === null || raw[k] === undefined) {
      p[k] = GENERAL[k];
      treeDefaults.push(k);
    }
  }
  const measureDefaults: Partial<Record<MeasureId, string[]>> = {};
  for (const id of MEASURE_IDS) {
    const mp = p.measures[id];
    if (!mp.on) {
      for (const k of MEASURES[id].kpis) mp.kpis[k.key].target = null;
      continue;
    }
    const r = resolveMeasure(raw, id);
    for (const k of MEASURES[id].kpis) if (k.kind !== "cpl") mp.kpis[k.key].target = r.targets[k.key];
    if (mp.kpis.cpl) {
      // CPLの目標：入れたもの（旧版のデータ）、なければ 費用÷リード目標
      const c = costOf(mp);
      const lt = r.targets[leadKpi(id).key];
      mp.kpis.cpl.target = raw.measures[id].kpis.cpl?.target ?? (c !== null && lt ? clean(c / lt) : null);
    }
    mp.start = measureStart(raw, id);
    mp.exitAfter = mp.exitAt === null || mp.exitAt === undefined ? null : Math.max(1, mp.exitAt - mp.start);
    measureDefaults[id] = r.defaults;
  }
  p.meta = { treeDefaults, measureDefaults };
  return p;
}
export const resolveData = (d: KcData): KcData => ({ ...d, plan: resolvePlan(d.plan) });

/** 入れ方を切りかえるとき、今の計算結果を新しい入れ方の欄に写す（入力したものがあるときだけ） */
export function switchTreeMode(p: Plan, to: InputMode): void {
  if (p.treeMode === to) return;
  const t = resolveTree(p);
  const from: TreeKey[] = p.treeMode === "count" ? ["wins", "deals", "handoffs", "leads"] : ["price", "winRate", "mqlDealRate", "handoffTarget"];
  const any = from.some((k) => p[k] !== null && p[k] !== undefined);
  p.treeMode = to;
  if (!any) return;
  if (to === "rate") {
    p.price = t.price;
    p.winRate = t.winRate;
    p.mqlDealRate = t.mqlDealRate;
    p.handoffTarget = t.handoffRate;
  } else {
    p.wins = t.wins;
    p.deals = t.deals;
    p.handoffs = t.handoffs;
    p.leads = t.leads;
  }
}
export function switchMeasureMode(p: Plan, id: MeasureId, to: InputMode): void {
  const mp = p.measures[id];
  if (mp.mode === to) return;
  const r = resolveMeasure(p, id);
  const any = mp.mode === "count" ? MEASURES[id].fields.some((f) => mp.counts[f.key] !== null) : mp.counts[MEASURES[id].fields[0].key] !== null || Object.values(mp.rates).some((v) => v !== null);
  mp.mode = to;
  if (!any) return;
  if (to === "rate") {
    for (const l of LINKS[id]) {
      const v = r.rates[l.b];
      mp.rates[l.b] = v === null ? null : l.perMonth ? round1(v) : round1(v * 100);
    }
    const top = MEASURES[id].fields[0].key;
    mp.counts[top] = r.counts[top];
  } else {
    for (const f of MEASURES[id].fields) mp.counts[f.key] = r.counts[f.key];
  }
}

// ---------- 表示用の書式 ----------
export const NA = "—";
export function fmtNum(n: number | null, digits = 0): string {
  if (n === null || !isFinite(n)) return NA;
  const v = Math.round(clean(n) * 10 ** digits) / 10 ** digits;
  return v.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
/** 件数：10未満は小数1けたまで、それ以上は整数 */
export const fmtCount = (n: number | null): string => (n === null ? NA : Math.abs(n) < 10 && !Number.isInteger(clean(n)) ? fmtNum(n, 1) : fmtNum(n, 0));
export const fmtPct1 = (r: number | null): string => (r === null || !isFinite(r) ? NA : `${fmtNum(r * 100, 1)}%`);
export const fmtPct0 = (r: number | null): string => (r === null || !isFinite(r) ? NA : `${Math.round(clean(r * 100))}%`);
export const fmtMan1 = (n: number | null): string => (n === null || !isFinite(n) ? NA : fmtNum(n, 1));

// ---------- 初回の判定（仕様 5章） ----------
export type FirstStatus = "ok" | "check" | "fix" | "na";
export const FIRST_LABEL: Record<FirstStatus, string> = { ok: "問題なし", check: "確認が必要", fix: "直す", na: "未入力" };
export interface FirstItem {
  no: number;
  group: "A" | "B" | "C" | "D";
  title: string;
  status: FirstStatus;
  reason: string;
  fix?: string; // 直すところ（PDFの右側）
  link?: { label: string; href: string };
  summary?: string; // 確認・直すの見出し（画面の指摘・結論に使う）
  nodes?: string[]; // 画面のツリーで印を付ける場所："tree.deals" "tree.leads" "gap" "m.<施策>"
  step?: string; // 直すときに戻るステップ（"1"〜"4"）
}
export const FIRST_GROUPS: Record<FirstItem["group"], string> = {
  A: "A. ツリーのつながり",
  B: "B. 数字の現実性",
  C: "C. 施策とKPIの対応",
  D: "D. 計測できるか",
};

export const TREE_FIELDS = ["sales", "price", "wins", "winRate", "deals", "dealRate", "leads"] as const;
export const TREE_LABEL: Record<(typeof TREE_FIELDS)[number], string> = {
  sales: "売上目標",
  price: "平均単価",
  wins: "受注数",
  winRate: "受注率",
  deals: "商談数",
  dealRate: "商談化率",
  leads: "リード数",
};
export const missingTree = (plan: Plan): string[] => TREE_FIELDS.filter((k) => plan[k] === null || plan[k] === 0).map((k) => TREE_LABEL[k]);

const pctDiff = (input: number, calc: number) => (input - calc) / calc;
/** ±5%の境目のすぐ外（5.04%など）が「5%」と見えないよう、そのときだけ小数2けた */
const signedPct = (r: number) => {
  const v = Math.abs(r) * 100;
  const digits = Math.abs(v - RECALC_TOLERANCE * 100) < 0.05 && Math.abs(v - RECALC_TOLERANCE * 100) > 1e-9 ? 2 : 1;
  return `${r >= 0 ? "+" : "−"}${fmtNum(v, digits)}%`;
};

/** 小さい月の目標（10件未満）を持つKPIの名前 */
export function smallKpis(plan: Plan): string[] {
  const out: string[] = [];
  const n = periodMonths(plan.period);
  const isSmall = (vals: (number | null)[]) => vals.some((v) => v !== null && v > 0 && clean(v) < SMALL_THRESHOLD);
  const months = Array.from({ length: n }, (_, i) => i);
  if (plan.deals) if (isSmall(months.map(() => plan.deals! / n))) out.push(`商談数（月${fmtCount(plan.deals / n)}件）`);
  if (plan.wins) if (isSmall(months.map(() => plan.wins! / n))) out.push(`受注数（月${fmtCount(plan.wins / n)}件）`);
  for (const id of selectedMeasures(plan)) {
    const def = MEASURES[id];
    const mp = plan.measures[id];
    for (const k of def.kpis) {
      if (mp.kpis[k.key].target === null) continue;
      let vals: (number | null)[] = [];
      if (k.kind === "count") vals = months.map((i) => monthlyTargetOf("count", mp.kpis[k.key].target, mp.kpis[k.key].monthly, plan, i));
      else if (k.kind === "rate" && k.den) vals = months.map((i) => fieldMonthlyTarget(plan, id, k.den!, i));
      else if (k.kind === "cpl") vals = months.map((i) => fieldMonthlyTarget(plan, id, leadKpi(id).num!, i));
      else continue;
      if (isSmall(vals)) {
        const pos = vals.filter((v): v is number => v !== null && v > 0);
        const label = k.kind === "count" ? `${def.short}の${k.label}（月${fmtCount(Math.min(...pos))}件）` : `${def.short}の${k.label}（分母が月${fmtCount(Math.min(...pos))}件）`;
        out.push(label);
      }
    }
    mp.others.forEach((o) => {
      if (o.target === null) return;
      const vals = months.map((i) => monthlyTargetOf("count", o.target, o.monthly, plan, i));
      if (isSmall(vals)) out.push(`${def.short}の${o.name || "その他のKPI"}`);
    });
  }
  return out;
}

export function firstJudgments(plan: Plan): FirstItem[] {
  const items: FirstItem[] = [];
  const sel = selectedMeasures(plan);

  // 2. 施策のリード目標の合計
  if (!sel.length) {
    items.push({ no: 2, group: "A", title: "施策のリード目標の合計がツリーと合うか", status: "na", reason: "施策を選ぶと判定します" });
  } else {
    const noTarget = sel.filter((id) => plan.measures[id].kpis[leadKpi(id).key].target === null);
    const parts = sel.filter((id) => !noTarget.includes(id)).map((id) => ({ id, v: plan.measures[id].kpis[leadKpi(id).key].target! }));
    const sum = parts.reduce((s, x) => s + x.v, 0);
    const expr = parts.map((x) => `${MEASURES[x.id].short}${fmtNum(x.v)}`).join("＋");
    if (noTarget.length) {
      const names = noTarget.map((id) => `${MEASURES[id].short}の${leadKpi(id).label}`).join("・");
      items.push({ no: 2, group: "A", title: "施策のリード目標の合計がツリーと合うか", status: "fix", reason: `${names}の目標が入っていません`, fix: `${names}の目標を入れます`, summary: `${names}の目標が入っていない`, nodes: noTarget.map((id) => `m.${id}`), step: "3" });
    } else if (plan.leads === null) {
      items.push({ no: 2, group: "A", title: "施策のリード目標の合計がツリーと合うか", status: "na", reason: `${expr}＝${fmtNum(sum)}件。ツリーのリード数を入れると判定します` });
    } else if (plan.leads > 0 && Math.abs(pctDiff(sum, plan.leads)) <= RECALC_TOLERANCE + 1e-9) {
      const d = sum - plan.leads;
      const diff = Math.round(clean(d)) === 0 ? "合っています" : `との差は${fmtNum(Math.abs(d))}件（${signedPct(pctDiff(sum, plan.leads))}）で、±5%以内です`;
      items.push({ no: 2, group: "A", title: "施策のリード目標の合計がツリーと合うか", status: "ok", reason: `${expr}＝${fmtNum(sum)}件。ツリーのリード数${fmtNum(plan.leads)}件${diff}` });
    } else {
      const d = sum - plan.leads;
      items.push({
        no: 2,
        group: "A",
        title: "施策のリード目標の合計がツリーと合うか",
        status: "fix",
        reason: `${expr}＝${fmtNum(sum)}件。ツリーのリード数${fmtNum(plan.leads)}件より${fmtNum(Math.abs(d))}件${d > 0 ? "多く" : "少なく"}（${plan.leads > 0 ? signedPct(pctDiff(sum, plan.leads)) : "—"}）、±5%を超えています`,
        fix: `施策の合計${fmtNum(sum)}件とツリーの${fmtNum(plan.leads)}件が${fmtNum(Math.abs(d))}件ずれています。施策の目標を${d > 0 ? "減らす" : "増やす"}か、ツリーのリード数を${fmtNum(sum)}件に直します`,
        summary: `施策のリード目標の合計が、全体より${fmtNum(Math.abs(d))}件${d > 0 ? "多い" : "少ない"}`,
        nodes: ["tree.leads", "gap"],
        step: "3",
      });
    }
  }

  // 3. その他のKPI
  {
    const hits: string[] = [];
    const repl: string[] = [];
    for (const id of sel) {
      const others = plan.measures[id].others.filter((o) => o.name.trim() || o.target !== null);
      if (!others.length) continue;
      const closest = MEASURES[id].kpis.find((k) => k.key === MEASURES[id].closest)!;
      others.forEach((o) => hits.push(`${MEASURES[id].short}「${o.name.trim() || "その他のKPI"}」`));
      repl.push(`${MEASURES[id].short}は「${closest.label}」`);
    }
    if (hits.length)
      items.push({
        no: 3,
        group: "A",
        title: "受注とつながらない指標を主に置いていないか",
        status: "check",
        reason: `${hits.join("・")}は受注とのつながりを確かめてください。置きかえるなら、${repl.join("、")}です`,
        summary: "受注とつながらないかもしれないKPIを置いている",
        nodes: sel.filter((id) => plan.measures[id].others.some((o) => o.name.trim() || o.target !== null)).map((id) => `m.${id}`),
        step: "3",
      });
    else items.push({ no: 3, group: "A", title: "受注とつながらない指標を主に置いていないか", status: "ok", reason: "その他のKPIは置いていません" });
  }

  // 4. 商談化率・受注率（一般的な値のままなら、自社の数字で直すよう知らせる）
  if (plan.dealRate === null || plan.winRate === null) {
    items.push({ no: 4, group: "B", title: "商談化率・受注率", status: "na", reason: "商談化率と受注率が出せません。ツリーの数字を入れると判定します", step: "1" });
  } else {
    const td = plan.meta?.treeDefaults ?? [];
    const dflt = [td.includes("winRate") ? `受注率（${fmtNum(plan.winRate, 1)}%）` : "", td.includes("dealRate") ? `商談化率（${fmtNum(plan.dealRate, 1)}%）` : ""].filter(Boolean);
    const out: string[] = [];
    const nodes: string[] = [];
    const check = (name: string, v: number, base: number, node: string) => {
      const r = v / 100 / base;
      if (r < 0.5) out.push(`${name}${fmtNum(v, 1)}%は一般的な値${fmtNum(base * 100)}%の${fmtNum(r * 100)}%（半分未満）`);
      else if (r > 2) out.push(`${name}${fmtNum(v, 1)}%は一般的な値${fmtNum(base * 100)}%の${fmtNum(r, 1)}倍（2倍超）`);
      else return;
      nodes.push(node);
    };
    check("商談化率", plan.dealRate, BASE_RATES.deal, "tree.leads");
    check("受注率", plan.winRate, BASE_RATES.win, "tree.deals");
    if (dflt.length) {
      if (td.includes("winRate")) nodes.push("tree.deals");
      if (td.includes("dealRate")) nodes.push("tree.leads");
      items.push({
        no: 4,
        group: "B",
        title: "商談化率・受注率",
        status: "check",
        reason: `${dflt.join("・")}は一般的な値のままです。自社の実績があれば直してください。率が下がると、必要な商談数・リード数が増えます`,
        summary: `${dflt.map((x) => x.replace(/（.*$/, "")).join("・")}が一般的な値のまま`,
        nodes: Array.from(new Set(nodes)),
        step: "1",
      });
    } else if (out.length)
      items.push({
        no: 4,
        group: "B",
        title: "商談化率・受注率",
        status: "check",
        reason: `${out.join("、")}です。実績の率か、目標の置き方を確かめてください`,
        summary: "商談化率・受注率が一般的な値から大きく外れている",
        nodes,
        step: "1",
      });
    else
      items.push({
        no: 4,
        group: "B",
        title: "商談化率・受注率",
        status: "ok",
        reason: `商談化率${fmtNum(plan.dealRate, 1)}%・受注率${fmtNum(plan.winRate, 1)}%。一般的な値（15%・29%）の半分〜2倍の範囲内です`,
      });
  }

  // 5. 月の目標が10件未満のKPI
  {
    const small = smallKpis(plan);
    items.push({
      no: 5,
      group: "B",
      title: "月の目標が10件未満のKPI",
      status: "ok",
      reason: `${small.length ? `${small.join("・")}は、直近3か月の合計で判定します。` : ""}商談化率は、件数にかかわらず直近3か月の合計で判定します`,
    });
  }

  // 6. 受注を月次で判定するか
  if (plan.period !== "month") {
    items.push({ no: 6, group: "B", title: "受注を月次で判定するか", status: "ok", reason: `期間が${periodLabel(plan.period)}のため対象外です` });
  } else if (plan.cycle === null) {
    items.push({ no: 6, group: "B", title: "受注を月次で判定するか", status: "na", reason: "商談から受注までの平均期間を入れると判定します" });
  } else if (plan.cycle >= 2) {
    items.push({
      no: 6,
      group: "B",
      title: "受注を月次で判定するか",
      status: "ok",
      reason: `平均期間が${fmtNum(plan.cycle, 1)}か月のため、受注・受注金額は月次では判定せず、3か月の合計で見ます`,
    });
  } else {
    items.push({ no: 6, group: "B", title: "受注を月次で判定するか", status: "ok", reason: `平均期間が${fmtNum(plan.cycle, 1)}か月のため、月次で見られます` });
  }

  // 7. 施策ごとにKPIがあるか
  if (!sel.length) {
    items.push({ no: 7, group: "C", title: "施策ごとにKPIがあるか", status: "fix", reason: "施策が選ばれていません", fix: "実施する施策を選び、KPIの目標を入れます", summary: "施策が選ばれていない", step: "2" });
  } else {
    const none = sel.filter((id) => !MEASURES[id].kpis.some((k) => k.kind !== "ref" && plan.measures[id].kpis[k.key].target !== null));
    if (none.length) {
      const names = none.map((id) => MEASURES[id].short).join("・");
      items.push({ no: 7, group: "C", title: "施策ごとにKPIがあるか", status: "fix", reason: `${names}に、KPIの目標が1つもありません`, fix: `${names}にKPIの目標を入れます`, summary: `${names}にKPIの目標がない`, nodes: none.map((id) => `m.${id}`), step: "3" });
    } else items.push({ no: 7, group: "C", title: "施策ごとにKPIがあるか", status: "ok", reason: `${sel.length}施策とも設定されています` });
  }

  // 8. CPL・CAC
  {
    const { cacLimit: lim, allowCpl } = limitsOf(plan);
    const withCost = sel.filter((id) => costOf(plan.measures[id]) !== null);
    if (!withCost.length) {
      items.push({ no: 8, group: "C", title: "CPL・CAC", status: "na", reason: "費用が入っていないため、判定していません（STEP4で入れると判定します）", step: "4" });
    } else {
      const cplText: string[] = [];
      const over: string[] = [];
      const overIds: MeasureId[] = [];
      for (const id of withCost) {
        const lt = plan.measures[id].kpis[leadKpi(id).key].target;
        const c = costOf(plan.measures[id])!;
        const v = lt ? c / lt : null;
        cplText.push(`${MEASURES[id].short}${fmtMan1(v)}`);
        if (v !== null && allowCpl !== null && v > allowCpl + 1e-9) {
          over.push(`${MEASURES[id].short}のCPL${fmtMan1(v)}万円が許容CPL${fmtMan1(allowCpl)}万円を超えています`);
          overIds.push(id);
        }
        const t = targetCplOf(plan, id);
        const cap = cplCapOf(plan, id);
        if (t !== null && cap !== null && t > cap + 1e-9 && overIds.push(id))
          over.push(`${MEASURES[id].short}の目標のCPL${fmtMan1(t)}万円が、CPLの上限（撤退の線）${fmtMan1(cap)}万円を超えています（計画の時点で撤退の線を超えています）`);
      }
      const total = withCost.reduce((s, id) => s + costOf(plan.measures[id])!, 0);
      const cacV = plan.wins ? total / plan.wins : null;
      if (cacV !== null && lim !== null && cacV > lim + 1e-9) over.push(`全体のCAC${fmtNum(cacV)}万円がCACの上限${fmtNum(lim)}万円を超えています`);
      let base = `CPL：${cplText.join("・")}万円。CAC（全体）${fmtNum(cacV)}万円`;
      if (lim !== null) base += `／上限${fmtNum(lim)}万円`;
      if (allowCpl !== null) base += `。許容CPL${fmtMan1(allowCpl)}万円`;
      else base += "。粗利率と取り返す年数を入れると、上限と比べます";
      items.push({
        no: 8,
        group: "C",
        title: "CPL・CAC",
        status: over.length ? "check" : "ok",
        reason: over.length ? `${base}。${over.join("。")}` : `${base}。上限の範囲内です`,
        summary: over.length ? "CPL・CACが上限を超えている" : undefined,
        nodes: Array.from(new Set(overIds)).map((id) => `m.${id}`),
        step: "4",
      });
    }
  }

  // 9. 計測できるか
  {
    const list: string[] = [];
    const ids: string[] = [];
    for (const id of sel) {
      const mp = plan.measures[id];
      for (const k of MEASURES[id].kpis)
        if (mp.kpis[k.key].target !== null && !mp.kpis[k.key].measurable) {
          list.push(`${MEASURES[id].short}「${k.label}」`);
          ids.push(`m.${id}`);
        }
      mp.others.forEach((o) => {
        if ((o.name.trim() || o.target !== null) && !o.measurable) list.push(`${MEASURES[id].short}「${o.name.trim() || "その他のKPI"}」`);
      });
    }
    for (const c of COMMON_KPIS) if (!plan.commonMeasurable[c.key]) list.push(`共通「${c.label}」`);
    if (list.length)
      items.push({
        no: 9,
        group: "D",
        title: "今取れていない数字",
        status: "check",
        reason: `${list.join("、")}。判定に使えないため、計測の方法を記事で確かめてください`,
        link: { label: "計測の方法は記事を参照", href: MEASURE_ARTICLE_URL },
        summary: `今は取れていない数字がある（${list.length}つ）`,
        nodes: Array.from(new Set(ids)),
        step: "3",
      });
    else items.push({ no: 9, group: "D", title: "今取れていない数字", status: "ok", reason: "目標を入れたKPIは、すべて取れています" });
  }
  // 旧 判定1（逆算の検算）をやめたので、表示の番号を1から振りなおす
  items.forEach((it, k) => (it.no = k + 1));
  return items;
}

// ---------- 毎月の判定（仕様 6章） ----------
export type MonthStatus = "ok" | "near" | "ng" | "pending" | "unmeasured" | "empty" | "none" | "skip" | "ref" | "notyet";
export const MONTH_LABEL: Record<MonthStatus, string> = {
  ok: "達成",
  near: "やや届かない",
  ng: "届かない",
  pending: "まだ判定できない",
  unmeasured: "計測していない",
  empty: "未入力",
  none: "今月の目標なし",
  skip: "判定しない",
  ref: "参考値",
  notyet: "開始前",
};
export const judgeRatio = (r: number): MonthStatus => (r >= 1 - 1e-9 ? "ok" : r >= 0.9 - 1e-9 ? "near" : "ng");

export type ValueKind = "count" | "rate" | "cpl";
export interface KpiRow {
  key: string; // "expo.visits"／"expo.other0"／"common.dealRate"
  label: string;
  vkind: ValueKind;
  window: boolean; // 直近3か月の合計で判定した
  target: number | null;
  actual: number | null;
  ratio: number | null;
  status: MonthStatus;
  note?: string; // 「決着8件」など
  prev: number | null; // 前月の値（月の値。前月比用）
  cur: number | null; // 今月の値（月の値）
  hasAction: boolean;
  first?: boolean; // 施策の中で上から最初に「届かない」
  actionShown?: boolean; // 打ち手を出したKPI
}
export interface ActionPick {
  rowKey: string;
  label: string;
  actual: number | null;
  target: number | null;
  vkind: ValueKind;
  items: ActionItem[] | null; // null＝打ち手なし（判定のみ）
}
export interface Effect {
  did: string; // 前月に実施したこと
  prevLabel: string;
  changes: string[]; // 「クリック率 1.0%→1.2%（+0.2pt）」
}
export interface MeasureResult {
  id: MeasureId | "common";
  name: string;
  started: boolean;
  rows: KpiRow[];
  picks: ActionPick[];
  effect: Effect | null;
}
export type ExitStatus = "exit" | "keep" | "before" | "none";
export interface ExitResult {
  id: MeasureId;
  name: string;
  status: ExitStatus;
  fromLabel: string; // 判定を始める月
  cpl: number | null;
  cap: number | null;
  leads: number;
  leadTarget: number;
  reason: string;
}
export interface CopyNumbers {
  leads: number | null;
  deals: number | null;
  dealAmt: number | null;
  wins: number | null;
  winAmt: number | null;
  losses: number | null;
  lossAmt: number | null;
  ext: number | null;
  labor: number | null;
  costTotal: number | null; // 内訳がないときの合計
  hasParts: boolean;
}
export interface MonthReport {
  index: number;
  label: string; // 2026年11月
  measures: MeasureResult[];
  exits: ExitResult[];
  copy: CopyNumbers;
  prompt: string;
}

const fieldVal = (d: KcData, i: number, id: MeasureId, f: string): number | null => d.months[i]?.m[id].f[f] ?? null;
export function isMeasureEntered(d: KcData, i: number, id: MeasureId): boolean {
  const mm = d.months[i]?.m[id];
  if (!mm) return false;
  return Object.values(mm.f).some((v) => v !== null) || mm.others.some((v) => v !== null) || costOf(mm) !== null;
}
export function isCommonEntered(d: KcData, i: number): boolean {
  return Object.values(d.months[i].c).some((v) => v !== null);
}
export function isMonthEntered(d: KcData, i: number): boolean {
  return MEASURE_IDS.some((id) => d.plan.measures[id].on && isMeasureEntered(d, i, id)) || isCommonEntered(d, i);
}

const sumOver = (idx: number[], get: (i: number) => number | null): number | null => {
  let any = false;
  let s = 0;
  for (const i of idx) {
    const v = get(i);
    if (v !== null) {
      any = true;
      s += v;
    }
  }
  return any ? s : null;
};

function changeText(label: string, vkind: ValueKind, prev: number | null, cur: number | null): string | null {
  if (prev === null || cur === null) return null;
  if (vkind === "rate") {
    const d = (cur - prev) * 100;
    return `${label} ${fmtPct1(prev)}→${fmtPct1(cur)}（${d >= 0 ? "+" : "−"}${fmtNum(Math.abs(d), 1)}pt）`;
  }
  const v = (x: number) => (vkind === "cpl" ? `${fmtMan1(x)}万円` : fmtCount(x));
  const pct = prev !== 0 ? (cur - prev) / prev : null;
  return `${label} ${v(prev)}→${v(cur)}${pct === null ? "" : `（${pct >= 0 ? "+" : "−"}${fmtNum(Math.abs(pct) * 100)}%）`}`;
}

export function formatValue(vkind: ValueKind, v: number | null): string {
  if (v === null) return NA;
  if (vkind === "rate") return fmtPct1(v);
  if (vkind === "cpl") return fmtMan1(v);
  return fmtCount(v);
}
export const changeCell = (vkind: ValueKind, prev: number | null, cur: number | null): string => {
  if (prev === null || cur === null) return NA;
  if (vkind === "rate") {
    const d = (cur - prev) * 100;
    return `${d >= 0 ? "+" : "−"}${fmtNum(Math.abs(d), 1)}pt`;
  }
  if (prev === 0) return NA;
  const p = (cur - prev) / prev;
  return `${p >= 0 ? "+" : "−"}${fmtNum(Math.abs(p) * 100)}%`;
};

/** 施策の1か月分（または3か月の合計）を判定する */
function measureRows(d: KcData, id: MeasureId, i: number): KpiRow[] {
  const plan = d.plan;
  const def = MEASURES[id];
  const mp = plan.measures[id];
  const rows: KpiRow[] = [];
  const win = Array.from({ length: WINDOW }, (_, k) => i - (WINDOW - 1) + k);
  const windowReady = win[0] >= mp.start && win.every((j) => isMeasureEntered(d, j, id));
  const leadField = leadKpi(id).num!;
  const cost = (j: number) => costOf(d.months[j].m[id]);

  const valueAt = (k: KpiDef, j: number): number | null => {
    if (k.kind === "count" || k.kind === "level") return fieldVal(d, j, id, k.num!);
    if (k.kind === "rate" || k.kind === "ref") {
      const n = fieldVal(d, j, id, k.num!);
      const dn = fieldVal(d, j, id, k.den!);
      return n !== null && dn ? n / dn : null;
    }
    const c = cost(j);
    const l = fieldVal(d, j, id, leadField);
    return c !== null && l ? c / l : null;
  };

  for (const k of def.kpis) {
    const kp = mp.kpis[k.key];
    if (kp.target === null && k.kind !== "ref") continue;
    const vkind: ValueKind = k.kind === "rate" || k.kind === "ref" ? "rate" : k.kind === "cpl" ? "cpl" : "count";
    const row: KpiRow = {
      key: `${id}.${k.key}`,
      label: k.label,
      vkind,
      window: false,
      target: null,
      actual: null,
      ratio: null,
      status: "empty",
      prev: i > 0 && i - 1 >= mp.start ? valueAt(k, i - 1) : null,
      cur: valueAt(k, i),
      hasAction: !!ACTIONS[`${id}.${k.key}`] && k.kind !== "ref",
    };
    if (k.kind === "ref") {
      if (row.cur === null) continue; // 参考値は入っているときだけ出す
      row.actual = row.cur;
      row.status = "ref";
      rows.push(row);
      continue;
    }
    // 月の目標と、3か月の合計にするか
    let small = false;
    let monthT: number | null;
    if (k.kind === "count" || k.kind === "level") {
      monthT = monthlyTargetOf(k.kind, kp.target, kp.monthly, plan, i);
      small = k.kind === "count" && monthT !== null && monthT > 0 && clean(monthT) < SMALL_THRESHOLD;
    } else if (k.kind === "rate") {
      monthT = kp.target! / 100;
      const dt = fieldMonthlyTarget(plan, id, k.den!, i);
      const den = dt !== null ? dt : fieldVal(d, i, id, k.den!);
      small = den !== null && den > 0 && clean(den) < SMALL_THRESHOLD;
    } else {
      monthT = kp.target;
      const lt = fieldMonthlyTarget(plan, id, leadField, i);
      small = lt !== null && lt > 0 && clean(lt) < SMALL_THRESHOLD;
    }

    const measuredNow = k.kind === "cpl" ? true : kp.measurable;
    if (small) {
      row.window = true;
      if (!windowReady) {
        row.status = "pending";
        row.note = i - mp.start < WINDOW - 1 ? `${monthLabel(plan, mp.start + WINDOW - 1)}から判定` : "3か月の数字がそろうと判定";
        row.target = k.kind === "count" ? null : monthT;
        rows.push(row);
        continue;
      }
      if (k.kind === "count") {
        row.target = sumOver(win, (j) => monthlyTargetOf("count", kp.target, kp.monthly, plan, j));
        row.actual = sumOver(win, (j) => fieldVal(d, j, id, k.num!));
      } else if (k.kind === "rate") {
        row.target = monthT;
        const n = sumOver(win, (j) => fieldVal(d, j, id, k.num!));
        const dn = sumOver(win, (j) => fieldVal(d, j, id, k.den!));
        row.actual = n !== null && dn ? n / dn : null;
      } else {
        row.target = monthT;
        const c = sumOver(win, cost);
        const l = sumOver(win, (j) => fieldVal(d, j, id, leadField));
        row.actual = c !== null && l ? c / l : null;
      }
    } else {
      row.target = monthT;
      row.actual = row.cur;
    }

    // 今月の目標が0（展示会のない月など）
    const zeroTarget =
      (k.kind === "count" || k.kind === "level") ? row.target === 0 : k.kind === "rate" && !row.window && fieldMonthlyTarget(plan, id, k.den!, i) === 0;
    if (zeroTarget && (row.actual === null || row.actual === 0)) {
      row.status = "none";
    } else if (row.actual === null) {
      if (k.kind === "cpl") row.status = costOf(d.months[i].m[id]) === null && !row.window ? "skip" : "empty";
      else row.status = measuredNow ? "empty" : "unmeasured";
      if (k.kind === "cpl" && row.status === "skip") row.note = "費用が未入力";
    } else if (row.target === null || row.target === 0) {
      row.status = "none";
    } else {
      row.ratio = k.kind === "cpl" ? row.target / row.actual : row.actual / row.target;
      row.status = judgeRatio(row.ratio);
    }
    rows.push(row);
  }

  // その他のKPI（件数）
  mp.others.forEach((o, n) => {
    if (o.target === null) return;
    const label = o.name.trim() || "その他のKPI";
    const row: KpiRow = {
      key: `${id}.other${n}`,
      label,
      vkind: "count",
      window: false,
      target: null,
      actual: null,
      ratio: null,
      status: "empty",
      prev: i > 0 && i - 1 >= mp.start ? d.months[i - 1].m[id].others[n] ?? null : null,
      cur: d.months[i].m[id].others[n] ?? null,
      hasAction: false,
    };
    const monthT = monthlyTargetOf("count", o.target, o.monthly, plan, i);
    const small = monthT !== null && monthT > 0 && clean(monthT) < SMALL_THRESHOLD;
    if (small) {
      row.window = true;
      if (!windowReady) {
        row.status = "pending";
        rows.push(row);
        return;
      }
      row.target = sumOver(win, (j) => monthlyTargetOf("count", o.target, o.monthly, plan, j));
      row.actual = sumOver(win, (j) => d.months[j].m[id].others[n] ?? null);
    } else {
      row.target = monthT;
      row.actual = row.cur;
    }
    if (row.actual === null) row.status = o.measurable ? "empty" : "unmeasured";
    else if (!row.target) row.status = "none";
    else {
      row.ratio = row.actual / row.target;
      row.status = judgeRatio(row.ratio);
    }
    rows.push(row);
  });
  return rows;
}

function commonRows(d: KcData, i: number): KpiRow[] {
  const plan = d.plan;
  const sel = selectedMeasures(plan);
  const leadsAt = (j: number) => sumOver(sel, (id) => (j >= plan.measures[id].start ? fieldVal(d, j, id, leadKpi(id).num!) : null));
  const c = (j: number) => d.months[j].c;
  const rows: KpiRow[] = [];
  const win = Array.from({ length: WINDOW }, (_, k) => i - (WINDOW - 1) + k);
  const windowReady = win[0] >= 0 && win.every((j) => isCommonEntered(d, j));
  const n = periodMonths(plan.period);
  const leadMonthT = plan.leads !== null ? plan.leads / n : null;
  const smallLeads = leadMonthT !== null && leadMonthT > 0 && clean(leadMonthT) < SMALL_THRESHOLD;

  const rateRow = (
    key: CommonKey,
    label: string,
    target: number | null,
    num: (j: number) => number | null,
    den: (j: number) => number | null,
    alwaysWindow = false,
  ): KpiRow => {
    const useWindow = alwaysWindow || smallLeads;
    const at = (j: number) => {
      const a = num(j);
      const b = den(j);
      return a !== null && b ? a / b : null;
    };
    const row: KpiRow = {
      key: `common.${key}`,
      label,
      vkind: "rate",
      window: useWindow,
      target: target === null ? null : target / 100,
      actual: null,
      ratio: null,
      status: "empty",
      prev: i > 0 ? at(i - 1) : null,
      cur: at(i),
      hasAction: !!ACTIONS[`common.${key}`],
    };
    if (useWindow) {
      if (!windowReady) {
        row.status = "pending";
        row.note = i < WINDOW - 1 ? `${monthLabel(plan, WINDOW - 1)}から判定` : "3か月の数字がそろうと判定";
        return row;
      }
      const a = sumOver(win, num);
      const b = sumOver(win, den);
      row.actual = a !== null && b ? a / b : null;
    } else row.actual = row.cur;
    return row;
  };

  // 営業に渡せる割合（任意）
  {
    const row = rateRow("handoffRate", "営業に渡せる割合", plan.handoffTarget, (j) => c(j).handoff, leadsAt);
    if (c(i).handoff === null) {
      row.status = "skip";
      row.note = "営業に渡した数が未入力";
      row.actual = null;
    } else if (row.status !== "pending") {
      if (row.actual === null) row.status = plan.commonMeasurable.handoffRate ? "empty" : "unmeasured";
      else if (row.target === null) {
        row.status = "skip";
        row.note = "目標が未入力";
      } else {
        row.ratio = row.actual / row.target;
        row.status = judgeRatio(row.ratio);
      }
    }
    rows.push(row);
  }
  // 商談化率＝商談数÷リード数。リードが商談になるまで時間がかかり、展示会の月はリードだけ増えるため、件数にかかわらず常に直近3か月の合計で判定
  {
    const row = rateRow("dealRate", "商談化率", plan.dealRate, (j) => c(j).deals, leadsAt, true);
    if (row.status !== "pending") {
      if (row.actual === null) row.status = plan.commonMeasurable.dealRate ? "empty" : "unmeasured";
      else if (row.target === null) row.status = "none";
      else {
        row.ratio = row.actual / row.target;
        row.status = judgeRatio(row.ratio);
      }
    }
    rows.push(row);
  }
  // 受注率＝受注÷（受注＋失注）。期首からの累計で、決着10件から判定
  {
    const upto = Array.from({ length: i + 1 }, (_, j) => j);
    const wins = sumOver(upto, (j) => c(j).wins) ?? 0;
    const losses = sumOver(upto, (j) => c(j).losses) ?? 0;
    const settled = wins + losses;
    const at = (j: number) => {
      const w = c(j).wins;
      const l = c(j).losses;
      return w !== null || l !== null ? ((w || 0) + (l || 0) > 0 ? (w || 0) / ((w || 0) + (l || 0)) : null) : null;
    };
    const row: KpiRow = {
      key: "common.winRate",
      label: "受注率",
      vkind: "rate",
      window: false,
      target: plan.winRate === null ? null : plan.winRate / 100,
      actual: settled > 0 ? wins / settled : null,
      ratio: null,
      status: "empty",
      note: `期首から・決着${fmtNum(settled)}件`,
      prev: i > 0 ? at(i - 1) : null,
      cur: at(i),
      hasAction: true,
    };
    if (settled < SETTLED_THRESHOLD) {
      row.status = "pending";
      row.note = `決着${fmtNum(settled)}件／${SETTLED_THRESHOLD}件`;
    } else if (row.target === null || row.actual === null) row.status = "none";
    else {
      row.ratio = row.actual / row.target;
      row.status = judgeRatio(row.ratio);
    }
    rows.push(row);
  }
  return rows;
}

/** 打ち手を出す場所：上から最初の「届かない」。打ち手がなければ「打ち手なし」としたうえで、次の「届かない」のうち打ち手のあるもの */
function pickActions(scope: string, rows: KpiRow[], sel: MeasureId[]): ActionPick[] {
  const ng = rows.filter((r) => r.status === "ng");
  if (!ng.length) return [];
  const toPick = (r: KpiRow, items: ActionItem[] | null): ActionPick => ({ rowKey: r.key, label: r.label, actual: r.actual, target: r.target, vkind: r.vkind, items });
  const first = ng[0];
  first.first = true;
  const firstItems = actionsFor(first.key, sel);
  if (firstItems.length) {
    first.actionShown = true;
    return [toPick(first, firstItems)];
  }
  const out = [toPick(first, null)];
  const next = ng.slice(1).find((r) => actionsFor(r.key, sel).length > 0);
  if (next) {
    next.actionShown = true;
    out.push(toPick(next, actionsFor(next.key, sel)));
  }
  return out;
}

function exitOf(d: KcData, id: MeasureId, i: number): ExitResult {
  const plan = d.plan;
  const mp = plan.measures[id];
  const name = MEASURES[id].short;
  const leadField = leadKpi(id).num!;
  const lk = leadKpi(id).key;
  const base: ExitResult = { id, name, status: "none", fromLabel: "", cpl: null, cap: cplCapOf(plan, id), leads: 0, leadTarget: 0, reason: "" };
  const range = Array.from({ length: i - mp.start + 1 }, (_, k) => mp.start + k).filter((j) => j >= 0);
  const anyCost = range.some((j) => costOf(d.months[j].m[id]) !== null) || costOf(mp) !== null;
  if (mp.exitAfter === null) return { ...base, reason: "撤退を判定する月が未入力" };
  const exitIdx = mp.start + mp.exitAfter;
  base.fromLabel = exitIdx <= 11 ? monthLabel(plan, exitIdx) : "";
  if (!anyCost) return { ...base, reason: "費用が入っていないため判定しない" };
  if (exitIdx > 11) return { ...base, reason: "判定する月が期間の外" };
  if (i < exitIdx) return { ...base, status: "before", reason: `${monthLabel(plan, exitIdx)}から判定` };
  const costSum = sumOver(range, (j) => costOf(d.months[j].m[id]));
  const leads = sumOver(range, (j) => fieldVal(d, j, id, leadField)) ?? 0;
  const leadTarget = range.reduce((s, j) => s + (monthlyTargetOf("count", mp.kpis[lk].target, mp.kpis[lk].monthly, plan, j) ?? 0), 0);
  const cplV = costSum !== null && leads > 0 ? costSum / leads : null;
  const r: ExitResult = { ...base, cpl: cplV, leads, leadTarget };
  if (costSum === null) return { ...r, status: "none", reason: "毎月の費用が入っていないため判定しない" };
  if (r.cap === null) return { ...r, status: "none", reason: "CPLの上限が未入力" };
  const cplOver = cplV === null ? costSum > 0 : cplV > r.cap + 1e-9;
  const leadShort = leadTarget > 0 ? leads / leadTarget < 0.9 - 1e-9 : false;
  const status: ExitStatus = cplOver && leadShort ? "exit" : "keep";
  const pct = leadTarget > 0 ? `目標${fmtNum(leadTarget)}件の${fmtNum((leads / leadTarget) * 100)}%` : "目標なし";
  return {
    ...r,
    status,
    reason: `${monthLabel(plan, mp.start)}からの累計　CPL ${fmtMan1(cplV)}万円（上限${fmtMan1(r.cap)}万円）・リード数${fmtNum(leads)}件（${pct}）`,
  };
}

export function computeMonth(d: KcData, i: number): MonthReport {
  const plan = d.plan;
  const sel = selectedMeasures(plan);
  const measures: MeasureResult[] = [];
  for (const id of sel) {
    const mp = plan.measures[id];
    if (i < mp.start) {
      measures.push({ id, name: MEASURES[id].short, started: false, rows: [], picks: [], effect: null });
      continue;
    }
    const rows = measureRows(d, id, i);
    const picks = pickActions(id, rows, sel);
    let effect: Effect | null = null;
    if (i > mp.start) {
      const did = d.months[i - 1].m[id].did.trim();
      const target = picks.filter((p) => p.items).map((p) => p.rowKey);
      const show = rows.filter((r) => target.includes(r.key));
      const list = (show.length ? show : rows.filter((r) => r.key === `${id}.${leadKpi(id).key}`))
        .map((r) => changeText(r.label, r.vkind, r.prev, r.cur))
        .filter((x): x is string => !!x);
      if (did || list.length) effect = { did, prevLabel: monthLabel(plan, i - 1), changes: list };
    }
    measures.push({ id, name: MEASURES[id].short, started: true, rows, picks, effect });
  }
  const crow = commonRows(d, i);
  measures.push({ id: "common", name: "共通（リードになった後）", started: true, rows: crow, picks: pickActions("common", crow, sel), effect: null });

  const exits = sel.map((id) => exitOf(d, id, i)).filter((e) => e.status !== "none" || e.reason !== "撤退を判定する月が未入力");

  // 月次報告メーカーに写す数字
  const m = d.months[i];
  const leads = sumOver(sel, (id) => (i >= plan.measures[id].start ? m.m[id].f[leadKpi(id).num!] ?? null : null));
  const partsAny = sel.some((id) => hasParts(m.m[id].parts));
  const copy: CopyNumbers = {
    leads,
    deals: m.c.deals,
    dealAmt: m.c.dealAmt,
    wins: m.c.wins,
    winAmt: m.c.winAmt,
    losses: m.c.losses,
    lossAmt: m.c.lossAmt,
    ext: partsAny ? sumOver(sel, (id) => (hasParts(m.m[id].parts) ? (m.m[id].parts.ext || 0) + (m.m[id].parts.tool || 0) : m.m[id].cost)) : null,
    labor: partsAny ? sumOver(sel, (id) => m.m[id].parts.labor) ?? 0 : null,
    costTotal: sumOver(sel, (id) => costOf(m.m[id])),
    hasParts: partsAny,
  };

  const report: MonthReport = { index: i, label: monthLabelLong(plan, i), measures, exits, copy, prompt: "" };
  report.prompt = buildPrompt(d, report);
  return report;
}

// ---------- 読者のAIに渡すプロンプト（仕様 10章） ----------
export function buildPrompt(d: KcData, r: MonthReport): string {
  const lines: string[] = [
    "あなたはBtoBマーケティングの改善を手伝うアドバイザーです。",
    "以下は、私の会社のマーケティング施策の今月の結果です。",
    "未達のKPIについて、原因の仮説と、来月試す打ち手を3つまで挙げてください。",
    "打ち手は、マーケ部門だけで実行できるものにしてください。",
    "",
    `期間：${r.label}`,
    "",
    "施策ごとの結果：",
  ];
  for (const m of r.measures) {
    if (!m.started) continue;
    for (const row of m.rows) {
      if (row.status === "ref") continue;
      const t = row.vkind === "cpl" ? `${formatValue("cpl", row.target)}万円` : formatValue(row.vkind, row.target);
      const a = row.vkind === "cpl" ? `${formatValue("cpl", row.actual)}万円` : formatValue(row.vkind, row.actual);
      lines.push(`${m.name}：${row.label}${row.window ? "（直近3か月の合計）" : ""} 目標${t} 実績${a} 判定${MONTH_LABEL[row.status]}`);
    }
  }
  const did = d.plan
    ? selectedMeasures(d.plan)
        .map((id) => (r.index > 0 ? d.months[r.index - 1].m[id].did.trim() : ""))
        .map((t, k) => (t ? `${MEASURES[selectedMeasures(d.plan)[k]].short}：${t}` : ""))
        .filter(Boolean)
    : [];
  lines.push("", `前月に実施したこと：${did.length ? did.join("／") : "なし"}`);
  const cands = r.measures
    .flatMap((m) => m.picks.filter((p) => p.items).map((p) => `${m.name}｜${p.label}：${p.items!.map((x) => x.text).join("／")}`));
  lines.push("", `ツールが出した打ち手の候補：${cands.length ? "" : "なし"}`);
  cands.forEach((c) => lines.push(`- ${c}`));
  return lines.join("\n");
}

// ---------- 記入例（架空の会社。基本モデルの成長期に近い数字） ----------
/** 記入例（サンプル）。期首は今の期の4月、実績は先月まで（最大8か月）。期首から3か月たっていなければ前の期にする */
export function exampleData(now = new Date()): KcData {
  const d = emptyData(now);
  const p = d.plan;
  let y = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  let done = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - 4); // 期首から済んだ月の数
  if (done < 3) {
    y -= 1;
    done = 8;
  }
  const nMonths = Math.min(8, done);
  p.treeMode = "count";
  p.period = "year";
  p.startYear = y;
  p.startMonth = 4;
  p.manageDay = 5;
  Object.assign(p, { sales: 3000, wins: 12, deals: 41, handoffs: 103, leads: 280, cycle: 3, margin: 40, years: 1.5 });
  p.decider = "営業本部長";
  p.review = "毎月10日の経営会議";
  p.commonMeasurable = { handoffRate: true, dealRate: true, winRate: true };
  const y12 = (pairs: Record<number, number>) => Array.from({ length: 12 }, (_, i) => (i in pairs ? pairs[i] : null));

  const expo = p.measures.expo;
  expo.on = true;
  expo.counts = { visits: 800, cards: 120, target: 48, reached: 84 };
  expo.kpis.visits.monthly = y12({ 2: 400, 7: 400 });
  expo.kpis.cards.monthly = y12({ 2: 60, 7: 60 });
  expo.kpis.reachRate.measurable = false;
  expo.cost = 600;
  expo.exitAt = 5;

  const ads = p.measures.ads;
  ads.on = true;
  ads.counts = { imp: 222000, clicks: 3330, leads: 100, target: 60 };
  ads.cost = 420;
  ads.exitAt = 5;
  ads.cplCap = 4;
  ads.cplCapTouched = true;

  const dl = p.measures.dl;
  dl.on = true;
  dl.counts = { views: 1200, dls: 72, target: 36, inquiries: 12 };
  dl.others = [{ name: "Xのフォロワー数", after: "views", target: 600, monthly: [], measurable: true }];
  dl.cost = 120;
  dl.exitAt = 8;

  // 毎月の実績（4月から nMonths か月）
  const ADS = {
    imp: [17000, 18200, 18900, 17600, 18000, 18400, 18600, 19800],
    clicks: [255, 264, 261, 229, 216, 202, 186, 238],
    leads: [9, 8, 7, 7, 6, 7, 7, 7],
    target: [5, 5, 4, 4, 4, 4, 4, 4],
  };
  const DL = {
    views: [98, 105, 92, 110, 101, 99, 104, 108],
    dls: [6, 7, 5, 6, 6, 6, 7, 6],
    target: [3, 4, 3, 3, 3, 3, 3, 2],
    inquiries: [1, 1, 0, 1, 1, 1, 1, 0],
    followers: [40, 55, 50, 45, 60, 50, 48, 52],
  };
  const COMMON = {
    deals: [3, 4, 3, 4, 3, 4, 4, 4],
    wins: [0, 0, 1, 1, 0, 1, 1, 1],
    losses: [0, 0, 0, 1, 0, 0, 1, 1],
  };
  const DID: Record<number, Partial<Record<MeasureId, string>>> = {
    2: { expo: "会期前の案内メールを既存リストに送付した" },
    [nMonths - 2]: { ads: "広告文を検索意図に合わせて3パターンに書き直した", dl: "資料のデータを最新の版に更新した" },
  } as any;
  for (let i = 0; i < nMonths; i++) {
    const m = d.months[i];
    m.m.ads.f = { imp: ADS.imp[i], clicks: ADS.clicks[i], leads: ADS.leads[i], target: ADS.target[i] };
    m.m.ads.cost = 35;
    m.m.dl.f = { views: DL.views[i], dls: DL.dls[i], target: DL.target[i], inquiries: DL.inquiries[i] };
    m.m.dl.others = [DL.followers[i]];
    m.m.dl.cost = 10;
    m.c = {
      handoff: null,
      deals: COMMON.deals[i],
      dealAmt: COMMON.deals[i] * 250,
      wins: COMMON.wins[i],
      winAmt: COMMON.wins[i] * 240,
      losses: COMMON.losses[i],
      lossAmt: COMMON.losses[i] * 250,
    };
    for (const [id, t] of Object.entries(DID[i] || {})) m.m[id as MeasureId].did = t as string;
  }
  if (nMonths > 2) {
    d.months[2].m.expo.f = { visits: 410, cards: 55, target: 24, reached: null };
    d.months[2].m.expo.cost = 300;
  }
  if (nMonths > 7) {
    d.months[7].m.expo.f = { visits: 352, cards: 58, target: 20, reached: null };
    d.months[7].m.expo.cost = 280;
  }
  d.reportIndex = nMonths - 1;
  return d;
}
