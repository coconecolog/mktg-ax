// src/lib/budgetMake.ts
//
// 予算作成Kit（/tools/budget-simulator）だけの計算。2026-10-30
// - 今期の実績（リード数・有効リード数・商談数・受注数）から率を出す。実績が空欄の段階は、基本モデルの率（BASE_RATES）を使う
// - 来期に必要な数：受注数＝売上目標÷平均受注単価（切り上げ）→ 今期の率で上にさかのぼる（切り上げ）
// - チャネルの有効リード数・商談数・受注数は、リード数から今期の率で自動配分（四捨五入）。手で上書きした欄はそのまま
// 判定は予算案診断キットと同じ（src/lib/budgetCheck.ts の diagnoseBudget）。「計画の数が必要な数に足りるか」だけ、
// 必要な数をこのキットの逆算（今期の率）に差しかえる
import { BASE_RATES, CHANNELS, diagnoseBudget, emptyState, fmt, syncMonthly, type BudgetDiagnosis, type BudgetState } from "@/lib/budgetCheck";
import { EXAMPLE } from "@/lib/kpi-sheet-maker";
import { KITS, type PlanKit } from "@/lib/planKits";

export type Stage = "leads" | "valid" | "deals" | "wins";
export type AutoKey = "valid" | "deals" | "wins";
export const AUTO_KEYS: AutoKey[] = ["valid", "deals", "wins"];

export interface Actual {
  leads: number;
  valid: number;
  deals: number;
  wins: number;
}
export type Ovr = Record<AutoKey, boolean>;

/** 予算作成Kitの状態：予算案診断キットの状態に、今期の実績と上書きの印を足したもの */
export interface MakeState extends BudgetState {
  actual: Actual;
  ovr: Ovr[];
}

export interface Rates {
  valid: number;
  deal: number;
  win: number;
  /** 率ごとに、今期の実績から出したか（false＝基本モデルの率） */
  fromActual: { valid: boolean; deal: boolean; win: boolean };
}

const pos = (x: number) => Number.isFinite(x) && x > 0;
const roundUp = (x: number) => Math.ceil(x - 1e-9);
const noOvr = (): Ovr => ({ valid: false, deals: false, wins: false });

export function makeEmpty(): MakeState {
  return { ...emptyState(), actual: { leads: NaN, valid: NaN, deals: NaN, wins: NaN }, ovr: CHANNELS.map(noOvr) };
}

/** 記入例：基本モデルの安定期の前提・リード数・費用と、今期の実績（架空） */
export const SAMPLE_ACTUAL: Actual = { leads: 400, valid: 152, deals: 61, wins: 18 };
export function makeSample(): MakeState {
  const st = makeEmpty();
  st.source = "sample";
  st.input = JSON.parse(JSON.stringify(EXAMPLE));
  st.actual = { ...SAMPLE_ACTUAL };
  return applyMake(st);
}

/** 今期の率。分子・分母がそろわない率は基本モデルの率 */
export function rates(a: Actual): Rates {
  const r = (num: number, den: number, base: number) => (pos(num) && pos(den) && num <= den ? { v: num / den, ok: true } : { v: base, ok: false });
  const v = r(a.valid, a.leads, BASE_RATES.valid);
  const d = r(a.deals, a.valid, BASE_RATES.deal);
  const w = r(a.wins, a.deals, BASE_RATES.win);
  return { valid: v.v, deal: d.v, win: w.v, fromActual: { valid: v.ok, deal: d.ok, win: w.ok } };
}

/** 来期に必要な数（売上目標・平均受注単価がないときは null） */
export function needCounts(st: MakeState): Record<Stage, number> | null {
  const { goal, price } = st.input;
  if (!pos(goal) || !pos(price)) return null;
  const r = rates(st.actual);
  const wins = roundUp(goal / price);
  const deals = roundUp(wins / r.win);
  const valid = roundUp(deals / r.deal);
  const leads = roundUp(valid / r.valid);
  return { leads, valid, deals, wins };
}

/** 上書きしていない有効リード数・商談数・受注数を、リード数から今期の率で配る。月別もそろえる */
export function applyMake(st: MakeState): MakeState {
  const r = rates(st.actual);
  st.input.channels.forEach((c, i) => {
    const o = (st.ovr[i] ??= noOvr());
    if (!o.valid) c.valid = Math.round((c.leads || 0) * r.valid);
    if (!o.deals) c.deals = Math.round((c.valid || 0) * r.deal);
    if (!o.wins) c.wins = Math.round((c.deals || 0) * r.win);
  });
  syncMonthly(st);
  return st;
}

/**
 * AIの案・年間予算表（.xlsx）から読んだ状態を、作る系のKitの状態にする（KPI管理表作成Kit）
 * - 今期の実績は空（基本モデルの率で逆算）。読んだ有効リード数・商談数・受注数は「上書き」として残す（↺で自動に戻せる）
 */
export function toMake(st: BudgetState): MakeState {
  const m: MakeState = { ...st, actual: { leads: NaN, valid: NaN, deals: NaN, wins: NaN }, ovr: CHANNELS.map(noOvr) };
  m.input.channels.forEach((c, i) => {
    m.ovr[i] = { valid: c.valid > 0, deals: c.deals > 0, wins: c.wins > 0 };
  });
  if (m.input.channels.some((c) => c.valid > 0 || c.deals > 0 || c.wins > 0))
    m.notes = [
      ...m.notes,
      "読み込んだ有効リード数・商談数・受注数は、上書きした数字（水色）として入れています。↺を押すと、リード数から率で自動に配り直します。",
      "「2. 今期の実績」を入れると、来期に必要な数を今期の率で出します（空欄のときは基本モデルの率）。",
    ];
  return applyMake(m);
}

/** 上書きをやめて自動に戻す */
export function resetOvr(st: MakeState, i: number, k: AutoKey) {
  st.ovr[i][k] = false;
  applyMake(st);
}

const STAGES = [
  { k: "wins", label: "受注数" },
  { k: "deals", label: "商談数" },
  { k: "valid", label: "有効リード数" },
  { k: "leads", label: "リード数" },
] as const;

/** 判定：予算案診断キットと同じ。必要な数だけ、今期の率で逆算した数にする */
export function diagnoseMake(st: MakeState, kit: PlanKit = KITS.make): BudgetDiagnosis {
  const d = diagnoseBudget(st, kit);
  const need = needCounts(st);
  if (!d.ready || !d.r || !need) return d;
  const r = d.r;
  for (const s of STAGES) {
    r.need[s.k] = need[s.k];
    r.short[s.k] = r.plan[s.k] < need[s.k];
  }
  for (const k of ["leads", "valid", "deals", "wins"] as const) delete d.marks[`total.${k}`];

  const it = d.items.find((x) => x.title.startsWith("計画の数が"));
  if (it) {
    const before = it.status;
    const short = STAGES.filter((s) => r.short[s.k]);
    if (!short.length && !r.short.sales) {
      it.status = "ok";
      it.reason = `受注数は売上目標${fmt(st.input.goal)}万円÷平均受注単価${fmt(st.input.price)}万円＝${fmt(need.wins)}件が必要で、計画は${fmt(r.plan.wins)}件。リード数から受注数まで、すべて足りています`;
      delete it.summary;
      delete it.todo;
      delete it.jump;
    } else {
      const list = short.map((s) => `${s.label}が${fmt(need[s.k] - r.plan[s.k])}件（必要${fmt(need[s.k])}・計画${fmt(r.plan[s.k])}）`);
      if (r.short.sales && !short.length) list.push(`受注金額が${fmt(r.need.sales - r.plan.sales)}万円`);
      const first = short[0];
      it.status = "fix";
      it.reason = `足りません：${list.join("、")}。必要な数は、受注数（売上目標÷平均受注単価、切り上げ）から今期の率でさかのぼった数です`;
      it.summary = first ? `${first.label}が売上目標に${fmt(need[first.k] - r.plan[first.k])}件足りない` : "受注金額が売上目標に足りない";
      it.todo = "チャネルのリード数を増やして、合計を必要な数に近づけます。増やせないときは売上目標を見直します";
      it.jump = "ch0.leads";
      for (const s of short) d.marks[`total.${s.k}`] = "fix";
    }
    if (before !== it.status) {
      d.counts[before]--;
      d.counts[it.status]++;
    }
  }
  // 結論の文を数え直す
  const c = d.counts;
  const sums = (s: "fix" | "check") => d.items.filter((i) => i.status === s && i.summary).map((i) => i.summary!);
  if (c.fix) d.conclusion = `直すところが${c.fix}つあります（${sums("fix").join("／")}）。${c.check ? `ほかに確認が${c.check}つあります。` : ""}`;
  else if (c.check) d.conclusion = `直すところはありません。確認が${c.check}つあります（${sums("check").join("／")}）。`;
  else d.conclusion = `直すところも、確認するところもありません。この${kit.subject}で${kit.doc}を仕上げられます。`;
  return d;
}
