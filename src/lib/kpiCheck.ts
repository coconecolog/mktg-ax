// src/lib/kpiCheck.ts
//
// KPI妥当性診断キット（/tools/kpi-check）・予算案診断キットの読み込みと判定のもと。2つのキットは src/lib/budgetCheck.ts からこれを使う（画面は src/scripts/budget-checker/app.ts）。
// 2026-10-28 作り直し：新しい数字の定義（6チャネル・有効リード・平均受注単価）にそろえ、期初の診断だけにした
// （毎月の判定とお知らせメールはなくした。毎月の振り返りは KPI管理表（M-B-04）と施策効果診断キットの役割）。
// - 入口は2つ：KPI管理表（M-B-04）の .xlsx を読み込む／画面で入力する。どちらも同じ SheetInput にして判定する
// - 入力の項目は M-B-04「はじめに入力」と同じ。件数（リード数・有効リード数・商談数・受注数）と費用を入れ、率は入れない
// - 計算は KPI管理表作成キット（src/lib/kpi-sheet-maker.ts の calc）と同じ。式の正本は Drive「★数字の定義（KPI・予算）」
// - 判定：A つながり（直す）／B 率の現実性（確認）／C コスト（確認）。色は判定だけ（直す＝赤、確認＝オレンジ）
// - 空欄のチャネルは「使わない」。一般的な値での穴埋めはしない
import { CHANNELS, EXAMPLE, calc, validate, type ChannelInput, type SheetInput, type SheetResult } from "@/lib/kpi-sheet-maker";
import { ReadError, type Book, type Cells } from "@/lib/kpiAnalysis";

export { CHANNELS, EXAMPLE, ReadError, type SheetInput, type ChannelInput, type SheetResult };

export const SHEET_PLAN = "はじめに入力";

/** 率の目安：基本モデルの安定期（有効リード数195÷リード数517、商談数78÷有効リード数195、受注数23÷商談数78） */
export const BASE_RATES = { valid: 0.38, deal: 0.4, win: 0.29 } as const;

/** 月別の計画（.xlsx を読み込んだときだけ） */
export interface MonthlyPlan {
  name: string;
  leads: number[];
  valid: number[];
}

export interface CheckInput {
  source: "xlsx" | "form" | "sample";
  fileName?: string;
  input: SheetInput;
  names: string[]; // チャネル名（input.channels と同じ順）
  monthly: MonthlyPlan[] | null; // null＝月別の計画は確かめない（画面の入力）
  warnings: string[];
}

// ---------- .xlsx（M-B-04「はじめに入力」）の読み取り ----------
// セルの位置は決め打ちにせず、見出しの文字を探して読む（施策効果診断キットと同じ考え方）

type Num = number | null;
const MAX_ROW = 200;
const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const MONTH_COLS = "CDEFGHIJKLMN".split("");

function num(c: Cells, ref: string): Num {
  const v = c[ref];
  if (v === undefined || v === null || v === "" || typeof v === "boolean") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[,，\s万円件か月年%]/g, "");
  if (s === "" || s === "-" || s === "―" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const str = (c: Cells, ref: string): string => {
  const v = c[ref];
  return v === undefined || v === null ? "" : String(v).trim();
};
function findHeader(c: Cells, names: string[]): { row: number; col: Record<string, string> } | null {
  for (let r = 1; r <= MAX_ROW; r++) {
    const col: Record<string, string> = {};
    for (const k of COLS) {
      const v = str(c, `${k}${r}`);
      if (names.includes(v) && !col[v]) col[v] = k;
    }
    if (names.every((n) => col[n])) return { row: r, col };
  }
  return null;
}

const PRE_NAMES = ["マーケ経由の売上目標", "平均受注単価", "粗利率", "回収期間", "リードタイム"];
const CH_NAMES = ["チャネル", "リード数", "有効リード数", "商談数", "受注数", "外部費用", "人件費"];

/** Excelの日付のシリアル値 → 年・月（1900年方式）。読めなければ null */
function serialToYm(v: unknown): { y: number; m: number } | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  }
  const m = /^(\d{4})[\/\-年.](\d{1,2})/.exec(String(v ?? "").trim());
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
}

/**
 * 「はじめに入力」（M-B-04）と「年間予算表（施策別）」（M-B-03）は同じ表なので、どちらもこれで読む。
 * sheet：読むシート名。fileLabel：見つからないときのメッセージに出す資料名
 */
export function readPlanSheet(book: Book, fileName: string, sheet: string = SHEET_PLAN, fileLabel = "KPI管理表（M-B-04）"): CheckInput {
  const SHEET_PLAN = sheet;
  const P = book[SHEET_PLAN];
  if (!P) throw new ReadError(`「${SHEET_PLAN}」シートが見つかりません。${fileLabel}のファイルか確かめてください（シート名は変えずに使います）。`);
  const warnings: string[] = [];

  // 1. 前提：見出しのすぐ下の行が値
  const pre = findHeader(P, PRE_NAMES);
  if (!pre) throw new ReadError(`「${SHEET_PLAN}」に前提の見出し（${PRE_NAMES.join("・")}）が見つかりません。`);
  const v = (name: string) => num(P, `${pre.col[name]}${pre.row + 1}`);
  const gmRaw = v("粗利率");
  const commonCol = COLS.find((k) => str(P, `${k}${pre.row}`) === "共通費");
  const startCol = COLS.find((k) => str(P, `${k}${pre.row}`) === "期首");
  const start = startCol ? serialToYm(P[`${startCol}${pre.row + 1}`]) : null;
  const input: SheetInput = {
    startYear: start ? start.y : NaN,
    startMonth: start ? start.m : 4,
    goal: v("マーケ経由の売上目標") ?? NaN,
    price: v("平均受注単価") ?? NaN,
    gmPct: gmRaw === null ? NaN : gmRaw <= 1 ? gmRaw * 100 : gmRaw, // パーセント表示のセルは 0.4 で入っている
    paybackYears: v("回収期間") ?? NaN,
    leadTime: v("リードタイム") ?? NaN,
    common: commonCol ? num(P, `${commonCol}${pre.row + 1}`) ?? 0 : 0,
    channels: [],
  };

  // 2. チャネル別の計画（年間）：見出しの下から「合計」の行まで
  const ch = findHeader(P, CH_NAMES);
  if (!ch) throw new ReadError(`「${SHEET_PLAN}」にチャネル別の計画（年間）の見出し（${CH_NAMES.join("・")}）が見つかりません。`);
  const names: string[] = [];
  for (let r = ch.row + 1; r <= ch.row + 30; r++) {
    const name = str(P, `${ch.col["チャネル"]}${r}`);
    if (!name || name === "合計") break;
    const g = (k: string) => num(P, `${ch.col[k]}${r}`) ?? 0;
    names.push(name);
    input.channels.push({ leads: g("リード数"), valid: g("有効リード数"), deals: g("商談数"), wins: g("受注数"), ext: g("外部費用"), labor: g("人件費") });
  }
  if (!names.length) throw new ReadError(`「${SHEET_PLAN}」のチャネル別の計画（年間）にチャネルが入っていません。`);

  // 3. チャネル別の計画（月別）：A列にチャネル名、B列に「リード数」がある行が表の始まり
  const monthly: MonthlyPlan[] = [];
  for (let r = 1; r <= MAX_ROW; r++) {
    const name = str(P, `A${r}`);
    if (!name || name === "チャネル" || str(P, `B${r}`) !== "リード数" || !names.includes(name)) continue;
    let vr = 0;
    for (let k = r + 1; k <= r + 4; k++) if (str(P, `B${k}`) === "有効リード数") vr = k;
    const row = (rr: number) => MONTH_COLS.map((col) => (rr ? num(P, `${col}${rr}`) ?? 0 : 0));
    monthly.push({ name, leads: row(r), valid: row(vr) });
    if (!vr) warnings.push(`月別の計画の${name}の表に「有効リード数」の行が見つからないため、有効リード数は0として確かめています。`);
  }
  if (!monthly.length) warnings.push("月別の計画の表が見つからないため、月別の計画は確かめていません。");

  const { errors } = validate(input);
  const pre5 = errors.filter((e) => ["マーケ経由の売上目標", "平均受注単価", "粗利率", "回収期間", "リードタイム"].includes(e));
  if (pre5.length) throw new ReadError(`「${SHEET_PLAN}」の前提の「${pre5.join("・")}」が空か、読めない値です。入れてから保存し直してください。`);
  if (input.channels.every((c) => !c.leads)) throw new ReadError(`「${SHEET_PLAN}」のチャネル別の計画に、リード数が1つも入っていません。`);

  return { source: "xlsx", fileName, input, names, monthly: monthly.length ? monthly : null, warnings };
}

// ---------- 見本（基本モデルの安定期。M-B-04の記入例と同じ数字） ----------
const SAMPLE_MONTHLY: MonthlyPlan[] = [
  { name: "展示会", leads: [0, 0, 110, 0, 0, 0, 0, 110, 0, 0, 0, 0], valid: [0, 0, 27, 0, 0, 0, 0, 28, 0, 0, 0, 0] },
  { name: "セミナー", leads: [0, 13, 0, 13, 0, 13, 0, 13, 0, 14, 0, 14], valid: [0, 8, 0, 8, 0, 8, 0, 8, 0, 9, 0, 9] },
  { name: "Web広告", leads: [5, 9, 9, 9, 9, 9, 9, 9, 10, 6, 6, 5], valid: [2, 4, 4, 4, 4, 4, 4, 4, 5, 3, 3, 2] },
  { name: "自社サイト", leads: [6, 5, 6, 5, 6, 10, 10, 8, 7, 8, 10, 9], valid: [2, 2, 2, 2, 2, 4, 4, 3, 3, 3, 4, 3] },
  { name: "SNS", leads: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], valid: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0] },
  { name: "メール", leads: [1, 2, 1, 2, 1, 2, 2, 2, 2, 1, 2, 2], valid: [0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1] },
];
export const sampleInput = (): CheckInput => ({
  source: "sample",
  input: JSON.parse(JSON.stringify(EXAMPLE)),
  names: [...CHANNELS],
  monthly: SAMPLE_MONTHLY,
  warnings: [],
});
export const formInput = (input: SheetInput): CheckInput => ({ source: "form", input, names: [...CHANNELS], monthly: null, warnings: [] });

// ---------- 書式 ----------
export const NA = "—";
export const fmt = (v: number | null | undefined, d = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? NA : v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number | null | undefined, d = 0): string => (v === null || v === undefined || !Number.isFinite(v) ? NA : `${(v * 100).toFixed(d)}%`);

// ---------- 判定 ----------
export type Status = "ok" | "check" | "fix" | "na";
export const STATUS_LABEL: Record<Status, string> = { ok: "問題なし", check: "確認", fix: "直す", na: "対象外" };
export const GROUPS = { A: "A. つながり", B: "B. 率の現実性", C: "C. コスト" } as const;
export type Group = keyof typeof GROUPS;

export interface Item {
  group: Group;
  title: string;
  status: Status;
  reason: string;
  summary?: string; // 結論の文に使う短い言い方（確認・直すのとき）
  todo?: string; // 直し方
}

export interface MonthlyDiff {
  name: string;
  leadsYear: number;
  leadsMonthly: number;
  validYear: number;
  validMonthly: number;
}

export interface Diagnosis {
  src: CheckInput;
  r: SheetResult;
  /** 表に出すチャネル（リード数か費用が入っているもの） */
  rows: (SheetResult["channels"][number] & { idx: number })[];
  monthly: MonthlyDiff[] | null;
  items: Item[];
  counts: Record<Status, number>;
  conclusion: string;
}

const STAGES = [
  { k: "wins", label: "受注数" },
  { k: "deals", label: "商談数" },
  { k: "valid", label: "有効リード数" },
  { k: "leads", label: "リード数" },
] as const;

const used = (c: ChannelInput) => c.leads > 0 || c.valid > 0 || c.deals > 0 || c.wins > 0 || c.ext > 0 || c.labor > 0;
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export function diagnose(src: CheckInput): Diagnosis {
  const inp = src.input;
  const r = calc(inp);
  r.channels.forEach((c, i) => (c.name = src.names[i] ?? c.name));
  const rows = r.channels.map((c, idx) => ({ ...c, idx })).filter((c) => used(inp.channels[c.idx]));
  const items: Item[] = [];

  // ---- A1 計画の数が、必要な数（逆算）に足りるか ----
  {
    const short = STAGES.filter((s) => r.short[s.k]);
    const salesShort = r.short.sales;
    if (!short.length && !salesShort) {
      items.push({
        group: "A",
        title: "計画の数が、売上目標から逆算した必要な数に足りるか",
        status: "ok",
        reason: `受注数は売上目標${fmt(inp.goal)}万円÷平均受注単価${fmt(inp.price)}万円＝${fmt(r.need.wins)}件が必要で、計画は${fmt(r.plan.wins)}件。リード数から受注数まで、すべて足りています`,
      });
    } else {
      const list = short.map((s) => `${s.label}が${fmt(r.need[s.k] - r.plan[s.k])}件（必要${fmt(r.need[s.k])}・計画${fmt(r.plan[s.k])}）`);
      if (salesShort && !short.length) list.push(`受注金額が${fmt(r.need.sales - r.plan.sales)}万円`);
      const first = short.length ? short[0] : null;
      items.push({
        group: "A",
        title: "計画の数が、売上目標から逆算した必要な数に足りるか",
        status: "fix",
        reason: `足りません：${list.join("、")}。必要な数は、受注数（売上目標÷平均受注単価、切り上げ）から計画の率でさかのぼった数です`,
        summary: first ? `${first.label}が売上目標に${fmt(r.need[first.k] - r.plan[first.k])}件足りない` : "受注金額が売上目標に足りない",
        todo: "足りないチャネルの件数を増やすか、売上目標を見直します。率を上げて合わせるときは、根拠のある打ち手があるかを確かめます",
      });
    }
  }

  // ---- A2 件数の順（リード数 ≥ 有効リード数 ≥ 商談数 ≥ 受注数） ----
  {
    const bad = rows.filter((c) => !(c.leads >= c.valid && c.valid >= c.deals && c.deals >= c.wins)).map((c) => c.name);
    if (bad.length)
      items.push({
        group: "A",
        title: "件数が リード数 ≥ 有効リード数 ≥ 商談数 ≥ 受注数 の順になっているか",
        status: "fix",
        reason: `${bad.join("・")}は、下の段階の件数が上の段階より多くなっています`,
        summary: `${bad.join("・")}の件数の順がおかしい`,
        todo: "上の段階ほど件数が多くなるように直します（率が100%を超える計画はできません）",
      });
    else items.push({ group: "A", title: "件数が リード数 ≥ 有効リード数 ≥ 商談数 ≥ 受注数 の順になっているか", status: "ok", reason: `${rows.length}チャネルとも、順になっています` });
  }

  // ---- A3 月別の計画の合計が、年間と合うか（.xlsxだけ） ----
  let monthly: MonthlyDiff[] | null = null;
  {
    const title = "月別の計画の合計が、年間の計画と合うか";
    if (!src.monthly) {
      items.push({
        group: "A",
        title,
        status: "na",
        reason: src.source === "form" ? "画面の入力では、月別の計画は確かめません（KPI管理表の.xlsxを読み込むと確かめます）" : "月別の計画の表が見つからないため、確かめていません",
      });
    } else {
      monthly = src.names
        .map((name, i) => {
          const m = src.monthly!.find((x) => x.name === name);
          const c = inp.channels[i];
          return { name, leadsYear: c.leads, leadsMonthly: m ? sum(m.leads) : 0, validYear: c.valid, validMonthly: m ? sum(m.valid) : 0, used: used(c) || !!m };
        })
        .filter((x) => x.used)
        .map(({ used: _u, ...x }) => x);
      const off = monthly.filter((m) => Math.abs(m.leadsYear - m.leadsMonthly) > 0.5 || Math.abs(m.validYear - m.validMonthly) > 0.5);
      if (off.length) {
        const t = off
          .map((m) => {
            const parts: string[] = [];
            if (Math.abs(m.leadsYear - m.leadsMonthly) > 0.5) parts.push(`リード数 月別${fmt(m.leadsMonthly)}・年間${fmt(m.leadsYear)}`);
            if (Math.abs(m.validYear - m.validMonthly) > 0.5) parts.push(`有効リード数 月別${fmt(m.validMonthly)}・年間${fmt(m.validYear)}`);
            return `${m.name}（${parts.join("、")}）`;
          })
          .join("、");
        items.push({
          group: "A",
          title,
          status: "fix",
          reason: `合っていません：${t}`,
          summary: `${off.map((m) => m.name).join("・")}の月別の計画が年間と合わない`,
          todo: "「はじめに入力」の月別の計画で、「計画との差」が0になるように直します。毎月の予実は月別の計画と比べるため、ずれたままだと判定がずれます",
        });
      } else items.push({ group: "A", title, status: "ok", reason: `${monthly.length}チャネルとも、リード数・有効リード数の月別の合計が年間と合っています` });
    }
  }

  // ---- B4 率の現実性（全体） ----
  {
    const t = r.total;
    const checks = [
      { label: "有効リード率", v: t.validRate, base: BASE_RATES.valid },
      { label: "商談化率", v: t.dealRate, base: BASE_RATES.deal },
      { label: "受注率", v: t.winRate, base: BASE_RATES.win },
    ];
    const out: string[] = [];
    for (const c of checks) {
      if (c.v === null) continue;
      const ratio = c.v / c.base;
      if (ratio < 0.5 - 1e-9) out.push(`${c.label}${pct(c.v)}は目安${pct(c.base)}の半分未満`);
      else if (ratio > 2 + 1e-9) out.push(`${c.label}${pct(c.v)}は目安${pct(c.base)}の2倍超`);
    }
    const now = checks.map((c) => `${c.label}${pct(c.v)}`).join("・");
    if (out.length)
      items.push({
        group: "B",
        title: "全体の率が、目安（基本モデルの安定期）から大きく外れていないか",
        status: "check",
        reason: `${out.join("、")}です。今期の実績の率か、計画の置き方を確かめてください`,
        summary: `${out.map((x) => x.replace(/\d.*$/, "")).join("・")}が目安から大きく外れている`,
        todo: "率は今期の実績を使います。実績より高い率で計画しているなら、その差を埋める打ち手を決めておきます",
      });
    else
      items.push({
        group: "B",
        title: "全体の率が、目安（基本モデルの安定期）から大きく外れていないか",
        status: "ok",
        reason: `${now}。目安（${pct(BASE_RATES.valid)}・${pct(BASE_RATES.deal)}・${pct(BASE_RATES.win)}）の半分〜2倍の範囲です`,
      });
  }

  // ---- C5 チャネル別のCPL ----
  const anyCost = rows.some((c) => c.ext + c.labor > 0);
  {
    const title = "チャネルのCPLが、許容CPL以下か";
    if (!anyCost) items.push({ group: "C", title, status: "na", reason: "費用（外部費用・人件費）が入っていないため、判定していません" });
    else if (r.allowableCpl === null) items.push({ group: "C", title, status: "na", reason: "許容CPLが出せないため、判定していません" });
    else {
      const over = rows.filter((c) => c.cplOver);
      if (over.length)
        items.push({
          group: "C",
          title,
          status: "check",
          reason: `${over.map((c) => `${c.name}のCPL ${fmt(c.cpl, 1)}万円`).join("、")}が、許容CPL ${fmt(r.allowableCpl, 1)}万円を超えています`,
          summary: `${over.map((c) => c.name).join("・")}のCPLが許容CPLを超えている`,
          todo: "リード数を増やすか、費用を下げる計画にします。超えたまま始めるなら、撤退を検討する線（開始月から6か月）を決めておきます",
        });
      else items.push({ group: "C", title, status: "ok", reason: `すべてのチャネルが、許容CPL ${fmt(r.allowableCpl, 1)}万円以下です` });
    }
  }

  // ---- C6 全体のCAC・回収期間 ----
  {
    const title = "全体のCAC・回収期間が、上限以内か";
    const t = r.total;
    const limitMonths = inp.paybackYears * 12;
    if (!anyCost) items.push({ group: "C", title, status: "na", reason: "費用が入っていないため、判定していません" });
    else if (t.cac === null) items.push({ group: "C", title, status: "na", reason: "受注数が0のため、CACが出せません" });
    else if (t.cac > r.cacLimit + 1e-9)
      items.push({
        group: "C",
        title,
        status: "check",
        reason: `全体のCAC ${fmt(t.cac)}万円（回収期間${fmt(t.paybackMonths, 1)}か月）が、CACの上限${fmt(r.cacLimit)}万円（${fmt(limitMonths, 1)}か月）を超えています`,
        summary: "全体の回収期間が上限を超えている",
        todo: "CPLが上限を超えているチャネルの費用を見直すか、率（有効リード率・商談化率・受注率）を上げる打ち手を決めます",
      });
    else
      items.push({
        group: "C",
        title,
        status: "ok",
        reason: `全体のCAC ${fmt(t.cac)}万円・回収期間${fmt(t.paybackMonths, 1)}か月。上限（${fmt(r.cacLimit)}万円・${fmt(limitMonths, 1)}か月）以内です`,
      });
  }

  // ---- C7 ROI（1年） ----
  {
    const title = "ROI（1年）がマイナスになっていないか";
    if (!r.costTotal) items.push({ group: "C", title, status: "na", reason: "費用が入っていないため、判定していません" });
    else if (r.roi !== null && r.roi < 0)
      items.push({
        group: "C",
        title,
        status: "check",
        reason: `ROI（1年）が${pct(r.roi)}です。受注金額×粗利率${fmt(r.total.sales * (inp.gmPct / 100))}万円が、コスト合計${fmt(r.costTotal)}万円（共通費を含む）を下回っています`,
        summary: "ROI（1年）がマイナス",
        todo: "回収期間が上限以内なら、2年目以降に取り返す計画として説明します。経営への説明は回収期間を主役にします",
      });
    else items.push({ group: "C", title, status: "ok", reason: `ROI（1年）${pct(r.roi)}。コスト合計${fmt(r.costTotal)}万円（共通費を含む）` });
  }

  const counts: Record<Status, number> = { ok: 0, check: 0, fix: 0, na: 0 };
  for (const it of items) counts[it.status]++;
  const sums = (s: Status) => items.filter((i) => i.status === s && i.summary).map((i) => i.summary!);
  let conclusion: string;
  if (counts.fix) {
    conclusion = `直すところが${counts.fix}つあります（${sums("fix").join("／")}）。`;
    if (counts.check) conclusion += `ほかに確認が${counts.check}つあります。`;
  } else if (counts.check) conclusion = `直すところはありません。確認が${counts.check}つあります（${sums("check").join("／")}）。`;
  else conclusion = "直すところも、確認するところもありません。このKPIで期をはじめられます。";

  return { src, r, rows, monthly, items, counts, conclusion };
}
