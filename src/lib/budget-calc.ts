// src/lib/budget-calc.ts
//
// 予算の計算（予算シミュレーターと予算案チェッカーで共通）
// 式の正本: Googleドライブ「数字の定義（KPI・予算）」（公開後は /standards/metrics）
// - 金額は万円（時間単価だけ円）。率は 0〜1 の小数で受け渡す
// - 計算は丸めない値で行い、表示だけ丸める。例外は「逆算の件数（切り上げ）」と「人件費の配分（万円の整数）」

/** 数字の定義ページ */
export const METRICS_PATH = "/standards/metrics";
/** 数字の定義ページの用語ごとのアンカー（「公開ページの構成（数字の基準）」の3.） */
export const METRIC_ANCHORS = {
  laborCost: "labor-cost",
  laborAllocation: "labor-allocation",
  backcast: "backcast",
  cpl: "cpl",
  cac: "cac",
  roi: "roi",
  payback: "payback",
  cacLimit: "cac-limit",
  allowableCpl: "allowable-cpl",
  judgment: "judgment",
  explain: "explain",
  scenario: "scenario",
} as const;
export type MetricKey = keyof typeof METRIC_ANCHORS;
export const metricUrl = (key: MetricKey): string => `${METRICS_PATH}#${METRIC_ANCHORS[key]}`;

/** シナリオ：商談化率と受注率を −2割／そのまま／＋2割 */
export const SCENARIOS = {
  pess: { label: "悲観", factor: 0.8 },
  base: { label: "標準", factor: 1 },
  opt: { label: "楽観", factor: 1.2 },
} as const;
export type ScenarioKey = keyof typeof SCENARIOS;

/** 防衛：攻撃の目安（事業の段階ごと） */
export const STAGES = {
  intro: { label: "導入期", def: 5, att: 5 },
  growth: { label: "成長期", def: 7, att: 3 },
  stable: { label: "安定期", def: 6, att: 4 },
} as const;
export type StageKey = keyof typeof STAGES;

// ===== 丸め =====

/** 浮動小数の誤差を除く（小数第6位で丸める） */
export const clean = (x: number): number => Math.round(x * 1e6) / 1e6;
/** 逆算の切り上げ（小数第6位で丸めてから切り上げ） */
export const ceilClean = (x: number): number => Math.ceil(clean(x));

// ===== 率 =====

/** 商談化率＝商談数÷リード数 */
export const dealRate = (deals: number, leads: number): number | null => (leads > 0 ? deals / leads : null);
/** 受注率＝受注数÷（受注数＋失注数）。決着した商談だけで出す */
export const winRateSettled = (wins: number, losses: number): number | null => (wins + losses > 0 ? wins / (wins + losses) : null);
/** シナリオの率（1を超えない） */
export const scenarioRate = (rate: number, factor: number): number => Math.min(rate * factor, 1);

// ===== 人件費 =====

/** 人件費（万円）＝ROUND(時間×時間単価÷10,000) */
export const laborFromHours = (hours: number, hourlyYen: number): number => Math.round((hours * hourlyYen) / 10000);

/**
 * 人件費の配分：人件費の総額を施策の時間の比で配り、万円の整数に最大剰余法で丸める（合計＝総額）
 * 時間の合計が0のときは null（配れない）
 */
export function allocateLabor(total: number, hours: number[]): number[] | null {
  const sumH = hours.reduce((a, h) => a + Math.max(h, 0), 0);
  const target = Math.round(total);
  if (target === 0) return hours.map(() => 0);
  if (!(sumH > 0)) return null;
  const raw = hours.map((h) => (target * Math.max(h, 0)) / sumH);
  const base = raw.map((r) => Math.floor(clean(r)));
  let rest = target - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: clean(r - Math.floor(clean(r))) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) base[order[k].i] += 1;
  return base;
}

// ===== 逆算 =====

export interface Backcast {
  mktSales: number; // マーケ経由の売上目標
  wins: number; // 受注件数（切り上げ）
  deals: number; // 商談数（切り上げ）
  leads: number; // リード数（切り上げ）
}
/** 受注件数＝マーケ経由の売上目標÷平均単価 → 商談数＝受注件数÷受注率 → リード数＝商談数÷商談化率（各段で切り上げ） */
export function backcast(target: number, mktShare: number, avgPrice: number, dRate: number, wRate: number): Backcast {
  const mktSales = target * mktShare;
  const wins = ceilClean(mktSales / avgPrice);
  const deals = ceilClean(wins / wRate);
  const leads = ceilClean(deals / dRate);
  return { mktSales, wins, deals, leads };
}

// ===== 指標 =====

/** 1社あたりの月の粗利＝平均単価×粗利率÷12 */
export const monthlyGross = (avgPrice: number, margin: number): number => (avgPrice * margin) / 12;
/** CPL＝費用÷リード数 */
export const cpl = (cost: number, leads: number): number | null => (leads > 0 ? cost / leads : null);
/** CAC＝費用÷受注件数 */
export const cac = (cost: number, wins: number): number | null => (wins > 0 ? cost / wins : null);
/** 回収期間（か月）＝CAC÷1社あたりの月の粗利 */
export const paybackMonths = (cacValue: number | null, mGross: number): number | null =>
  cacValue === null || !(mGross > 0) ? null : cacValue / mGross;
/** ROI（1年）＝（受注金額×粗利率−費用）÷費用 */
export const roi = (revenue: number, margin: number, cost: number): number | null => (cost > 0 ? (revenue * margin - cost) / cost : null);
/** CACの上限＝平均単価×粗利率×取り返す年数 */
export const cacLimit = (avgPrice: number, margin: number, years: number): number => avgPrice * margin * years;
/** 許容CPL＝CACの上限×商談化率×受注率 */
export const allowableCpl = (limit: number, dRate: number, wRate: number): number => limit * dRate * wRate;

export type Judgment = "ok" | "over";
/** 判定：値≦上限なら上限内（値が null なら null） */
export const judge = (value: number | null, limit: number): Judgment | null =>
  value === null ? null : clean(value) <= clean(limit) ? "ok" : "over";
export const JUDGMENT_LABEL: Record<Judgment, string> = { ok: "上限内", over: "上限超え" };

// ===== 表示（予算案チェッカーの仕様 5.4） =====

export const NA = "―";
/** 万円の整数（3桁区切り） */
export const fmtMan = (n: number | null): string => (n === null || !isFinite(n) ? NA : Math.round(clean(n)).toLocaleString("ja-JP"));
/** 小数1桁（CPL・許容CPL・回収期間） */
export const fmt1 = (n: number | null): string =>
  n === null || !isFinite(n)
    ? NA
    : (Math.round(clean(n) * 10) / 10).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** %の整数（ROI・率）。マイナスは「−6%」 */
export const fmtPct = (r: number | null): string => {
  if (r === null || !isFinite(r)) return NA;
  const p = Math.round(clean(r * 100));
  return `${p < 0 ? "−" : ""}${Math.abs(p)}%`;
};
/** 増減付きの整数（差の表示） */
export const fmtSigned = (n: number): string => {
  const v = Math.round(clean(n));
  return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toLocaleString("ja-JP");
};
