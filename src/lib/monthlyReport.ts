// マーケ月次報告メーカー（/tools/monthly-report）の計算ロジック。
// 画面（src/pages/tools/monthly-report.astro）から読み込む。すべてブラウザ内で計算し、サーバーには送らない。
// 金額の単位はすべて「万円」。率は 0〜1 の小数で持つ。

export const DATA_VERSION = 1;

/** 実績の受注率に切り替える、決着した商談（受注＋失注）の件数 */
export const SETTLED_THRESHOLD = 10;

export interface Plan {
  startYear: number; // 期首の年
  startMonth: number; // 期首月（1〜12）
  reportDay: number; // 報告日（1〜28、31＝月末）
  target: number | null; // 年間の受注金額目標（マーケ起点、万円）
  annualLeads: number | null; // 年間のリード数の計画
  monthlyLeads: (number | null)[]; // 月別のリード数の計画（任意、12個）
  dealRate: number | null; // 計画の商談化率（0〜1）
  winRate: number | null; // 計画の受注率（0〜1）
  avgDeal: number | null; // 計画の平均受注単価（万円）
  cycle: number | null; // 商談から受注までの平均期間（月）
}

export interface MonthActual {
  leads: number | null;
  deals: number | null; // 新規商談数
  dealAmt: number | null; // 新規商談金額
  wins: number | null; // 受注数
  winAmt: number | null; // 受注金額
  lost: number | null; // 失注数
  lostAmt: number | null; // 失注金額
  open: number | null; // 月末に進行中の商談金額
  revenue: number | null; // 全社の売上（任意）
}

export interface ActionItem {
  text: string;
  checked: boolean;
}

export interface ReportData {
  v: number;
  plan: Plan;
  months: MonthActual[];
  reportIndex: number;
  actions: { stage: string; items: ActionItem[] };
  sentence: { text: string; edited: boolean };
  email?: string;
}

export const MONTH_FIELDS: (keyof MonthActual)[] = [
  "leads",
  "deals",
  "dealAmt",
  "wins",
  "winAmt",
  "lost",
  "lostAmt",
  "open",
  "revenue",
];
export const REQUIRED_MONTH_FIELDS: (keyof MonthActual)[] = [
  "leads",
  "deals",
  "dealAmt",
  "wins",
  "winAmt",
  "lost",
  "lostAmt",
  "open",
];

export function emptyMonth(): MonthActual {
  return { leads: null, deals: null, dealAmt: null, wins: null, winAmt: null, lost: null, lostAmt: null, open: null, revenue: null };
}

export function emptyData(today = new Date()): ReportData {
  // 期首は「直近の4月」を初期値にする
  const y = today.getMonth() + 1 >= 4 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    v: DATA_VERSION,
    plan: {
      startYear: y,
      startMonth: 4,
      reportDay: 10,
      target: null,
      annualLeads: null,
      monthlyLeads: Array(12).fill(null),
      dealRate: null,
      winRate: null,
      avgDeal: null,
      cycle: null,
    },
    months: Array.from({ length: 12 }, emptyMonth),
    reportIndex: 0,
    actions: { stage: "", items: [] },
    sentence: { text: "", edited: false },
  };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** PDFや保存データから読み込んだ値を、欠けや型の崩れがあっても使える形に整える。 */
export function normalizeData(raw: any): ReportData {
  const base = emptyData();
  if (!raw || typeof raw !== "object") return base;
  const p = raw.plan || {};
  const plan: Plan = {
    startYear: num(p.startYear) ?? base.plan.startYear,
    startMonth: Math.min(12, Math.max(1, num(p.startMonth) ?? 4)),
    reportDay: Math.min(31, Math.max(1, num(p.reportDay) ?? 10)),
    target: num(p.target),
    annualLeads: num(p.annualLeads),
    monthlyLeads: Array.from({ length: 12 }, (_, i) => num(p.monthlyLeads?.[i])),
    dealRate: num(p.dealRate),
    winRate: num(p.winRate),
    avgDeal: num(p.avgDeal),
    cycle: num(p.cycle),
  };
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = raw.months?.[i] || {};
    const out = emptyMonth();
    for (const f of MONTH_FIELDS) out[f] = num(m[f]);
    return out;
  });
  const items = Array.isArray(raw.actions?.items)
    ? raw.actions.items
        .filter((a: any) => a && typeof a.text === "string")
        .slice(0, 3)
        .map((a: any) => ({ text: a.text, checked: a.checked !== false }))
    : [];
  return {
    v: DATA_VERSION,
    plan,
    months,
    reportIndex: Math.min(11, Math.max(0, num(raw.reportIndex) ?? 0)),
    actions: { stage: typeof raw.actions?.stage === "string" ? raw.actions.stage : "", items },
    sentence: {
      text: typeof raw.sentence?.text === "string" ? raw.sentence.text : "",
      edited: raw.sentence?.edited === true,
    },
    email: typeof raw.email === "string" ? raw.email : undefined,
  };
}

/** i番目（0始まり）の月の「年・月」 */
export function monthOf(plan: Plan, i: number): { year: number; month: number } {
  const total = plan.startMonth - 1 + i;
  return { year: plan.startYear + Math.floor(total / 12), month: (total % 12) + 1 };
}

export function monthLabel(plan: Plan, i: number): string {
  const { year, month } = monthOf(plan, i);
  return `${year}年${month}月`;
}

export function isMonthEntered(m: MonthActual): boolean {
  return REQUIRED_MONTH_FIELDS.every((f) => m[f] !== null);
}

export function isMonthTouched(m: MonthActual): boolean {
  return MONTH_FIELDS.some((f) => m[f] !== null);
}

export function missingPlanFields(plan: Plan): string[] {
  const miss: string[] = [];
  if (!plan.target || plan.target <= 0) miss.push("年間の受注金額目標");
  if (!plan.annualLeads || plan.annualLeads <= 0) miss.push("年間のリード数の計画");
  if (!plan.dealRate || plan.dealRate <= 0) miss.push("計画の商談化率");
  if (!plan.winRate || plan.winRate <= 0) miss.push("計画の受注率");
  if (!plan.avgDeal || plan.avgDeal <= 0) miss.push("計画の平均受注単価");
  if (plan.cycle === null || plan.cycle < 0) miss.push("商談から受注までの平均期間");
  return miss;
}

/** 月別のリード数の計画。入力のある月はその値、空欄の月は「年間の計画 − 入力済みの合計」を等分する。 */
export function planLeadsByMonth(plan: Plan): number[] {
  const annual = plan.annualLeads || 0;
  const filled = plan.monthlyLeads.map((v) => (v === null ? null : Math.max(0, v)));
  const sumFilled = filled.reduce<number>((s, v) => s + (v ?? 0), 0);
  const blanks = filled.filter((v) => v === null).length;
  const each = blanks > 0 ? Math.max(0, annual - sumFilled) / blanks : 0;
  return filled.map((v) => (v === null ? each : v));
}

/** 計画の商談金額（月別）＝計画のリード数×計画の商談化率×計画の平均受注単価 */
export function planDealAmtByMonth(plan: Plan): number[] {
  return planLeadsByMonth(plan).map((l) => l * (plan.dealRate || 0) * (plan.avgDeal || 0));
}

export type Judge = "達成" | "やや届かない" | "届かない";
export function judge(ratio: number): Judge {
  if (ratio >= 1) return "達成";
  if (ratio >= 0.9) return "やや届かない";
  return "届かない";
}

export type StageKey = "leads" | "dealRate" | "winRate" | "unitPrice";
export const STAGE_NAMES: Record<StageKey, string> = {
  leads: "リード数",
  dealRate: "商談化率",
  winRate: "受注率",
  unitPrice: "受注単価",
};

export interface StageResult {
  key: StageKey;
  name: string;
  actual: number | null;
  plan: number;
  ratio: number | null; // 達成率（null＝まだ判定できない）
  judge: Judge | null;
  note?: string;
}

export interface Report {
  index: number;
  label: string;
  monthNo: number; // 期首から何か月目か（1〜12）
  cum: { leads: number; deals: number; dealAmt: number; wins: number; winAmt: number; lost: number; lostAmt: number };
  settled: number;
  winRateUsed: number;
  winRateSource: "actual" | "plan";
  open: number;
  openExpected: number;
  futureNew: number;
  futureMonths: number;
  deadlineIndex: number; // 期内に受注できる商談の期限の月（0始まり。報告月以前なら挽回できる月がない） // 「期内に受注できる新規分」に数えた月の数
  landing: number;
  target: number;
  ratio: number;
  judge: Judge;
  shortfall: number;
  pipeline: { deals: number; dealAmt: number; prevDeals: number | null; prevDealAmt: number | null };
  stages: StageResult[];
  weakStage: StageResult | null; // 足りない段階（打ち手と一文に使う）
  weakIsBelowLine: boolean; // true＝90%未満の段階がある（強調表示する）
  revenue: { month: number; share: number } | null;
  missingMonths: string[]; // 報告月までで、数字が入っていない月
}

const v0 = (n: number | null) => n ?? 0;

export function computeReport(data: ReportData, index = data.reportIndex): Report {
  const { plan, months } = data;
  const idx = Math.min(11, Math.max(0, index));
  const planLeads = planLeadsByMonth(plan);
  const planDealAmt = planDealAmtByMonth(plan);

  const cum = { leads: 0, deals: 0, dealAmt: 0, wins: 0, winAmt: 0, lost: 0, lostAmt: 0 };
  let planLeadsCum = 0;
  const missingMonths: string[] = [];
  for (let i = 0; i <= idx; i++) {
    const m = months[i];
    if (!isMonthEntered(m)) missingMonths.push(monthLabel(plan, i));
    cum.leads += v0(m.leads);
    cum.deals += v0(m.deals);
    cum.dealAmt += v0(m.dealAmt);
    cum.wins += v0(m.wins);
    cum.winAmt += v0(m.winAmt);
    cum.lost += v0(m.lost);
    cum.lostAmt += v0(m.lostAmt);
    planLeadsCum += planLeads[i];
  }

  // 受注率：決着した商談（受注＋失注）が10件たまるまでは計画、以降は累計の実績（金額ベース）。
  // 実績の受注率は「進行中の商談」にだけ使う。期内に受注できる新規分は計画の受注率で計算する。
  const settled = cum.wins + cum.lost;
  const useActual = settled >= SETTLED_THRESHOLD && cum.winAmt + cum.lostAmt > 0;
  const planWinRate = plan.winRate || 0;
  const winRateUsed = useActual ? cum.winAmt / (cum.winAmt + cum.lostAmt) : plan.winRate || 0;

  const open = v0(months[idx].open);
  const openExpected = open * winRateUsed;

  // 期内に受注できる新規分：残りの月のうち、期末まで「平均期間」以上ある月の計画の商談金額×計画の受注率
  const cycle = Math.max(0, plan.cycle ?? 0);
  let futurePlan = 0;
  let futureMonths = 0;
  for (let j = idx + 1; j < 12; j++) {
    if (11 - j >= cycle) {
      futurePlan += planDealAmt[j];
      futureMonths++;
    }
  }
  const futureNew = futurePlan * planWinRate;
  // 期限の月（この月までの商談なら期内に受注できる）＝期末−平均期間
  const deadlineIndex = Math.floor(11 - cycle);

  const landing = cum.winAmt + openExpected + futureNew;
  const target = plan.target || 0;
  const ratio = target > 0 ? landing / target : 0;

  // 段階の達成率（期首からの累計、計画比）
  const stage = (key: StageKey, actual: number | null, planV: number, note?: string): StageResult => {
    const r = actual !== null && planV > 0 ? actual / planV : null;
    return { key, name: STAGE_NAMES[key], actual, plan: planV, ratio: r, judge: r === null ? null : judge(r), note };
  };
  const stages: StageResult[] = [
    stage("leads", cum.leads, planLeadsCum),
    stage("dealRate", cum.leads > 0 ? cum.deals / cum.leads : null, plan.dealRate || 0, cum.leads > 0 ? undefined : "リードがまだありません"),
    stage("winRate", useActual ? winRateUsed : null, plan.winRate || 0, useActual ? undefined : `決着した商談が${settled}件（${SETTLED_THRESHOLD}件で判定）`),
    stage("unitPrice", cum.wins > 0 ? cum.winAmt / cum.wins : null, plan.avgDeal || 0, cum.wins > 0 ? undefined : "受注がまだありません"),
  ];

  const judged = stages.filter((s) => s.ratio !== null);
  const lowest = judged.length > 0 ? judged.reduce((a, b) => ((b.ratio as number) < (a.ratio as number) ? b : a)) : null;
  const weakIsBelowLine = !!lowest && (lowest.ratio as number) < 0.9;
  // すべて90%以上でも着地見込みが計画に届かないときは、いちばん低い段階を原因として扱う
  const weakStage = lowest && (weakIsBelowLine || (ratio < 1 && (lowest.ratio as number) < 1)) ? lowest : null;

  const cur = months[idx];
  const prev = idx > 0 ? months[idx - 1] : null;
  const pipeline = {
    deals: v0(cur.deals),
    dealAmt: v0(cur.dealAmt),
    prevDeals: prev && isMonthEntered(prev) ? v0(prev.deals) : null,
    prevDealAmt: prev && isMonthEntered(prev) ? v0(prev.dealAmt) : null,
  };

  const revenue =
    cur.revenue !== null && cur.revenue > 0 ? { month: cur.revenue, share: v0(cur.winAmt) / cur.revenue } : null;

  return {
    index: idx,
    label: monthLabel(plan, idx),
    monthNo: idx + 1,
    cum,
    settled,
    winRateUsed,
    winRateSource: useActual ? "actual" : "plan",
    open,
    openExpected,
    futureNew,
    futureMonths,
    deadlineIndex,
    landing,
    target,
    ratio,
    judge: judge(ratio),
    shortfall: Math.max(0, target - landing),
    pipeline,
    stages,
    weakStage,
    weakIsBelowLine,
    revenue,
    missingMonths,
  };
}

/** 期首から報告月までの、各月時点の着地見込み（推移グラフ用）。数字の入っていない月は null。 */
export function landingTrend(data: ReportData): (number | null)[] {
  return Array.from({ length: 12 }, (_, i) =>
    i <= data.reportIndex && isMonthEntered(data.months[i]) ? computeReport(data, i).landing : null,
  );
}

// ---- 打ち手の候補・一文 ----

export const ACTION_CANDIDATES: Record<StageKey | "ok", string[]> = {
  leads: [
    "成果の出ているチャネルに予算を寄せる",
    "次の展示会・セミナーを前倒しする",
    "事例や資料など、問い合わせにつながるページを増やす",
  ],
  dealRate: [
    "営業に渡す条件を営業と見直す",
    "渡してから連絡するまでの期限を営業と確かめる",
    "対象外の業種・規模からのリードを減らす",
  ],
  winRate: ["失注の理由を営業から集める", "商談で使う事例・比較資料を用意する", "狙う業種・規模を絞る"],
  unitPrice: ["単価の高い業種・規模に予算を寄せる", "上位の製品や大口の事例を発信する"],
  ok: ["今の配分を続ける"],
};

export function actionStageKey(r: Report): StageKey | "ok" {
  return r.weakStage ? r.weakStage.key : "ok";
}

/** 金額（万円）を「1億2,340万円」「850万円」の形にする */
export function fmtMan(v: number): string {
  const sign = v < 0 ? "-" : "";
  const raw = Math.abs(v);
  const a = raw < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
  if (a >= 10000) {
    const oku = Math.floor(a / 10000);
    const man = a - oku * 10000;
    return man > 0
      ? `${sign}${oku.toLocaleString("ja-JP")}億${man.toLocaleString("ja-JP")}万円`
      : `${sign}${oku.toLocaleString("ja-JP")}億円`;
  }
  return `${sign}${a.toLocaleString("ja-JP")}万円`;
}

export function fmtPct(r: number, digits = 0): string {
  return `${(r * 100).toFixed(digits)}%`;
}

/** 結論の文（3行）。plan は月名・単価・率の計算に使う。 */
export function buildSentence(r: Report, actions: string[], plan: Plan): string {
  const known = r.cum.winAmt + r.openExpected;
  const perDeal = (plan.avgDeal || 0) * (plan.winRate || 0);
  const dealRate = plan.dealRate || 0;
  const monthName = (i: number) => `${monthOf(plan, i).month}月`;
  const canRecover = r.deadlineIndex > r.index;

  // 1行目：見込み
  const l1 =
    r.futureNew > 0
      ? `期末の着地見込みは${fmtMan(r.landing)}（計画比${fmtPct(r.ratio)}）。うち受注済みと進行中の商談で${fmtMan(known)}、残り${fmtMan(r.futureNew)}はこれからの商談次第です。`
      : `期末の着地見込みは${fmtMan(r.landing)}（計画比${fmtPct(r.ratio)}）。すべて受注済みと進行中の商談によるものです。`;

  // 2行目：差と必要量
  let l2: string;
  const lateNote = r.deadlineIndex < 11 ? `${monthName(r.deadlineIndex + 1)}以降の商談は期内の受注に間に合いません。` : "";
  if (r.ratio >= 1) {
    const rest = Math.max(0, r.target - known);
    if (rest <= 0 || !canRecover || perDeal <= 0) {
      l2 = "受注済みと進行中の商談で、計画に届く見込みです。";
    } else {
      l2 = `残りは${monthName(r.deadlineIndex)}までの商談${Math.ceil(rest / perDeal)}件で届きます。`;
    }
  } else if (!canRecover || perDeal <= 0) {
    l2 = `期内の挽回は難しく、差${fmtMan(r.shortfall)}は来期の計画で扱います。`;
  } else {
    const deals = Math.ceil(r.shortfall / perDeal);
    const leads = dealRate > 0 ? Math.ceil(deals / dealRate) : null;
    l2 = `計画まで${fmtMan(r.shortfall)}。取り戻すには、${monthName(r.deadlineIndex)}までに商談をあと${deals}件${
      leads !== null ? `（リードで${leads}件）` : ""
    }。${lateNote}`;
  }

  // 3行目：打ち手
  const act = actions.length > 0 ? actions.map((a) => `「${a}」`).join("") : "打ち手";
  let l3 = r.weakStage
    ? `${r.weakStage.name}が計画を下回っているため、${act}を行います。`
    : "すべての段階が計画の90%以上のため、今の配分を続けます。";
  if (r.revenue) l3 += `全社の売上のうち、マーケ起点は${fmtPct(r.revenue.share)}です。`;

  return [l1, l2, l3].join("\n");
}
