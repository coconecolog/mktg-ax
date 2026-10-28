// src/lib/kpiAnalysis.ts
//
// 施策効果診断キット（旧KPI分析ツール、/tools/kpi-analysis）の計算。画面は src/scripts/kpi-analysis/app.ts。
// - 読むのは KPI管理表（M-B-04）の3シートだけ：「はじめに入力」「毎月の実績入力」「施策ログ」
//   セルの位置は決め打ちせず、見出しの文字を探して読む（2026-10-28）
// - A 課題の地図：課題（チャネル×指標）ごとに、月ごとの計画比と「計画を本当に下回っている確率」
// - B 推移：選んだ課題の実績・計画の線と、打ち手を入れた月
// - C 打ち手の効果：施策ログの打ち手ごとに「実施の後に良くなった確率」（実施月の前3か月と、実施月から最新月まで）
// 確率はベイズ推定（一様な事前分布）。率は「何件中何件」をベータ分布、件数はポアソンの率をガンマ分布で表す。
// A は式で正確に計算し、C は乱数（種を固定）で計算するので、同じファイルなら毎回同じ結果になる。

export type Cells = Record<string, string | number | boolean>;
export type Book = Record<string, Cells>;

export const SHEET_PLAN = "はじめに入力";
export const SHEET_ACTUAL = "毎月の実績入力";
export const SHEET_LOG = "施策ログ";

export type Metric = "リード数" | "有効リード率" | "CPL" | "商談化率" | "受注率";
export const METRICS: Metric[] = ["リード数", "有効リード率", "CPL", "商談化率", "受注率"];

type Num = number | null; // null＝空欄（まだ入れていない）

export interface Channel {
  name: string;
  plan: { leads: number[]; valid: number[]; cost: number[] };
  act: { leads: Num[]; valid: Num[]; deals: Num[]; wins: Num[]; cost: number[] };
}

export interface LogItem {
  row: number;
  registered: string;
  metric: string;
  channel: string;
  issue: string;
  action: string;
  doMonth: string;
  basis: string;
  status: string;
  hours: number | null;
  review: string;
}

export interface Model {
  months: string[]; // 12か月の見出し（4月〜3月など）
  last: number; // 実績が入っている最後の月（0〜11）。-1＝実績なし
  cplCap: number;
  leadTime: number;
  planDealRate: number | null; // 商談化率の計画（商談数÷有効リード数、年間）
  planWinRate: number | null; // 受注率の計画（受注数÷商談数、年間）
  channels: Channel[];
  log: LogItem[];
  warnings: string[];
}

export class ReadError extends Error {}

// ---------- 読み取り ----------

function num(c: Cells, ref: string): Num {
  const v = c[ref];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return null;
  const s = String(v).replace(/[,，\s万円件%]/g, "");
  if (s === "" || s === "-" || s === "―" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function str(c: Cells, ref: string): string {
  const v = c[ref];
  return v === undefined || v === null ? "" : String(v).trim();
}
const z = (v: Num) => (v == null ? 0 : v);

// セルの位置は決め打ちにせず、見出しの文字を探して読む（説明の行を足したり消したりしても読めるように）。2026-10-28
const MAX_ROW = 400;
function colName(i: number) {
  let s = "";
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
const ALL_COLS = Array.from({ length: 40 }, (_, i) => colName(i));
// 見出しの行を探し、見出し名→列の表を返す
function findHeader(c: Cells, names: string[]): { row: number; col: Record<string, string> } | null {
  for (let r = 1; r <= MAX_ROW; r++) {
    const col: Record<string, string> = {};
    for (const k of ALL_COLS) {
      const v = str(c, `${k}${r}`);
      if (names.includes(v) && !col[v]) col[v] = k;
    }
    if (names.every((n) => col[n])) return { row: r, col };
  }
  return null;
}
// 12か月の見出しが並ぶ最初の行（C〜N列）
function findMonths(c: Cells): string[] | null {
  for (let r = 1; r <= MAX_ROW; r++) {
    const m = MONTH_COLS.map((k) => str(c, `${k}${r}`));
    if (m.every((x) => /月$/.test(x))) return m;
  }
  return null;
}
const MONTH_COLS = "CDEFGHIJKLMN".split(""); // 12か月
// チャネル別の表：A列にチャネル名、B列に「リード数」がある行が表の始まり。項目名（B列）→行の表を返す
function findBlocks(c: Cells, labels: string[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (let r = 1; r <= MAX_ROW; r++) {
    const name = str(c, `A${r}`);
    if (!name || name === "チャネル" || str(c, `B${r}`) !== "リード数") continue;
    const rows: Record<string, number> = {};
    for (let k = r; k < r + labels.length + 3; k++) {
      const lb = str(c, `B${k}`);
      if (labels.includes(lb) && !rows[lb]) rows[lb] = k;
    }
    out.set(name, rows);
  }
  return out;
}

export function buildModel(book: Book): Model {
  for (const s of [SHEET_PLAN, SHEET_ACTUAL, SHEET_LOG]) {
    if (!book[s]) throw new ReadError(`「${s}」シートが見つかりません。KPI管理表（M-B-04）のファイルか確かめてください（シート名は変えずに使います）。`);
  }
  const P = book[SHEET_PLAN];
  const A = book[SHEET_ACTUAL];
  const L = book[SHEET_LOG];
  const warnings: string[] = [];

  const months = findMonths(A);
  if (!months) throw new ReadError("「毎月の実績入力」に月の見出し（C〜N列の4月〜3月）が見つかりません。列を足したり消したりしていないか確かめてください。");

  const ACT_LABELS = ["リード数", "有効リード数", "商談数", "受注数", "外部費用", "人件費"];
  const PLAN_LABELS = ["リード数", "有効リード数", "外部費用", "人件費"];
  const actBlocks = findBlocks(A, ACT_LABELS);
  const planBlocks = findBlocks(P, PLAN_LABELS);
  if (!actBlocks.size) throw new ReadError("「毎月の実績入力」にチャネル別の表（A列にチャネル名、B列に「リード数」）が見つかりません。");

  const row = (c: Cells, r: number | undefined): Num[] => MONTH_COLS.map((col) => (r ? num(c, `${col}${r}`) : null));
  const channels: Channel[] = [];
  for (const [name, a] of actBlocks) {
    const miss = ACT_LABELS.filter((l) => !a[l]);
    if (miss.length) throw new ReadError(`「毎月の実績入力」の${name}の表に「${miss.join("・")}」の行が見つかりません。`);
    const p = planBlocks.get(name);
    if (!p) throw new ReadError(`「はじめに入力」の月別の計画に「${name}」の表が見つかりません。チャネル名が2つのシートで同じか確かめてください。`);
    const pmiss = PLAN_LABELS.filter((l) => !p[l]);
    if (pmiss.length) throw new ReadError(`「はじめに入力」の${name}の月別の計画に「${pmiss.join("・")}」の行が見つかりません。`);
    const pc = row(P, p["外部費用"]).map(z);
    const pl = row(P, p["人件費"]).map(z);
    const ac = row(A, a["外部費用"]).map(z);
    const al = row(A, a["人件費"]).map(z);
    channels.push({
      name,
      plan: { leads: row(P, p["リード数"]).map(z), valid: row(P, p["有効リード数"]).map(z), cost: pc.map((v, k) => v + pl[k]) },
      act: { leads: row(A, a["リード数"]), valid: row(A, a["有効リード数"]), deals: row(A, a["商談数"]), wins: row(A, a["受注数"]), cost: ac.map((v, k) => v + al[k]) },
    });
  }

  let last = -1;
  for (let m = 0; m < 12; m++) if (channels.some((c) => c.act.leads[m] != null)) last = m;

  // 前提（はじめに入力 1.）：見出しのすぐ下の行が値
  const pre = findHeader(P, ["許容CPL", "リードタイム"]);
  const cplCap = pre ? num(P, `${pre.col["許容CPL"]}${pre.row + 1}`) ?? 0 : 0;
  const leadTime = pre ? num(P, `${pre.col["リードタイム"]}${pre.row + 1}`) ?? 0 : 0;
  if (!cplCap) warnings.push("「はじめに入力」の許容CPLが空のため、CPLは判定していません。");

  // チャネル別の計画（年間）の「合計」の行
  let planDealRate: number | null = null;
  let planWinRate: number | null = null;
  const yh = findHeader(P, ["チャネル", "有効リード数", "商談数", "受注数"]);
  if (yh) {
    for (let r = yh.row + 1; r <= yh.row + 30; r++) {
      if (str(P, `${yh.col["チャネル"]}${r}`) !== "合計") continue;
      const v = num(P, `${yh.col["有効リード数"]}${r}`);
      const d = num(P, `${yh.col["商談数"]}${r}`);
      const w = num(P, `${yh.col["受注数"]}${r}`);
      planDealRate = v && d != null ? d / v : null;
      planWinRate = d && w != null ? w / d : null;
      break;
    }
  }

  // 施策ログ
  const LOG_NAMES = ["登録月", "狙う指標", "チャネル", "課題", "打ち手", "実施月", "根拠", "状態", "見込み時間", "振り返り"];
  const lh = findHeader(L, ["登録月", "打ち手", "実施月"]);
  if (!lh) throw new ReadError("「施策ログ」に表の見出し（登録月・打ち手・実施月）が見つかりません。");
  const cell = (n: string, r: number) => (lh.col[n] ? `${lh.col[n]}${r}` : "");
  for (const n of LOG_NAMES) if (!lh.col[n]) {
    // 見出し行の残りの列も拾う（findHeaderは必須の3つだけで探しているため）
    for (const k of ALL_COLS) if (str(L, `${k}${lh.row}`) === n) { lh.col[n] = k; break; }
  }
  const log: LogItem[] = [];
  for (let r = lh.row + 1; r <= lh.row + 300; r++) {
    const action = str(L, cell("打ち手", r));
    if (!action) continue;
    log.push({
      row: r,
      registered: str(L, cell("登録月", r)),
      metric: str(L, cell("狙う指標", r)),
      channel: str(L, cell("チャネル", r)),
      issue: str(L, cell("課題", r)),
      action,
      doMonth: str(L, cell("実施月", r)),
      basis: str(L, cell("根拠", r)),
      status: str(L, cell("状態", r)),
      hours: lh.col["見込み時間"] ? num(L, cell("見込み時間", r)) : null,
      review: str(L, cell("振り返り", r)),
    });
  }
  const noMonth = log.filter((x) => x.status !== "中止" && !months.includes(x.doMonth));
  if (noMonth.length) {
    warnings.push(`施策ログの${noMonth.length}件は実施月が空か読めないため、効果を計算していません（${noMonth.map((x) => `${x.row}行目`).join("・")}）。`);
  }

  return { months, last, cplCap, leadTime, planDealRate, planWinRate, channels, log, warnings };
}

// ---------- 確率 ----------

// 種つき乱数（mulberry32）
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(r: () => number) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
// ガンマ分布（形 k≥1、尺度1）Marsaglia–Tsang
function gamma(k: number, r: () => number) {
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(r);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// 対数のガンマ関数と二項分布の上側確率（Aの正確な計算）
const LNF: number[] = [0, 0];
function lnFact(n: number) {
  for (let i = LNF.length; i <= n; i++) LNF[i] = LNF[i - 1] + Math.log(i);
  return LNF[n];
}
// Beta(a,b)（a,bは整数）が t より小さい確率 = Binomial(a+b-1, t) が a 以上の確率
function betaBelow(a: number, b: number, t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const n = a + b - 1;
  const lf = lnFact(n);
  let s = 0;
  for (let k = a; k <= n; k++) s += Math.exp(lf - lnFact(k) - lnFact(n - k) + k * Math.log(t) + (n - k) * Math.log(1 - t));
  return Math.min(1, s);
}
// Gamma(k,1)（kは整数）が x より小さい確率 = 1 − Σ_{i<k} e^-x x^i / i!
function gammaBelow(k: number, x: number) {
  if (x <= 0) return 0;
  let term = Math.exp(-x);
  let s = term;
  for (let i = 1; i < k; i++) {
    term *= x / i;
    s += term;
  }
  return Math.max(0, Math.min(1, 1 - s));
}

// ---------- 課題（A・B） ----------

export interface Row {
  key: string; // "Web広告|有効リード率"
  channel: string; // チャネル名 or "全体" or "全チャネル"
  metric: Metric;
  label: string;
  unit: "count" | "rate" | "man";
  cells: Cell[]; // 12か月
  total: { ratio: number | null; prob: number | null }; // 期首から最新月までの合計
  streak: number; // 最新月から続けて「たぶん下回っている（70%以上）」の月数
  thin: boolean; // 件数が少なく判断しにくい
  series: { actual: (number | null)[]; plan: (number | null)[] };
  fromLog: boolean;
}
export interface Cell {
  ratio: number | null; // 計画比（CPLは 許容÷実績）
  prob: number | null; // 計画を下回っている確率（CPLは上限を超えている確率）
  note?: string;
}

interface Win {
  ms: number[];
}

function sumAt(a: (number | null)[], ms: number[]) {
  let s = 0;
  let any = false;
  for (const m of ms) if (a[m] != null) {
    s += a[m] as number;
    any = true;
  }
  return any ? s : null;
}

// 1つの課題について、ある月の集まり（ms）の「実績・計画・確率」を出す
function evalWindow(model: Model, channel: string, metric: Metric, ms: number[]): { actual: number | null; plan: number | null; ratio: number | null; prob: number | null; n: number } {
  const chs = channel === "全体" || channel === "全チャネル" ? model.channels : model.channels.filter((c) => c.name === channel);
  if (!chs.length || !ms.length) return { actual: null, plan: null, ratio: null, prob: null, n: 0 };
  const tot = (pick: (c: Channel) => (number | null)[]) => {
    let s = 0;
    let any = false;
    for (const c of chs) {
      const v = sumAt(pick(c), ms);
      if (v != null) {
        s += v;
        any = true;
      }
    }
    return any ? s : null;
  };
  const leads = tot((c) => c.act.leads);
  const pLeads = tot((c) => c.plan.leads);
  if (metric === "リード数") {
    if (leads == null || !pLeads) return { actual: leads, plan: pLeads || null, ratio: null, prob: null, n: leads ?? 0 };
    return { actual: leads, plan: pLeads, ratio: leads / pLeads, prob: gammaBelow(Math.round(leads) + 1, pLeads), n: leads };
  }
  if (metric === "有効リード率") {
    const valid = tot((c) => c.act.valid);
    const pValid = tot((c) => c.plan.valid);
    if (leads == null || valid == null || !leads || !pLeads || pValid == null) return { actual: null, plan: pLeads && pValid != null ? pValid / pLeads : null, ratio: null, prob: null, n: 0 };
    const v = Math.min(Math.round(valid), Math.round(leads));
    const pr = pValid / pLeads;
    return { actual: valid / leads, plan: pr, ratio: pr ? valid / leads / pr : null, prob: betaBelow(v + 1, Math.round(leads) - v + 1, pr), n: Math.round(leads) };
  }
  if (metric === "CPL") {
    const cost = tot((c) => c.act.cost.map((v, m) => (c.act.leads[m] == null ? null : v)));
    if (leads == null || cost == null || !model.cplCap) return { actual: null, plan: model.cplCap || null, ratio: null, prob: null, n: 0 };
    if (!leads) return { actual: null, plan: model.cplCap, ratio: 0, prob: cost > 0 ? 1 : null, n: 0, };
    const cpl = cost / leads;
    // CPLが上限を超えている確率＝リードの率が（費用÷上限）より小さい確率
    return { actual: cpl, plan: model.cplCap, ratio: model.cplCap / cpl, prob: gammaBelow(Math.round(leads) + 1, cost / model.cplCap), n: leads };
  }
  // 商談化率・受注率（全体）：商談数（受注数）を入れた月だけ
  const isDeal = metric === "商談化率";
  const plan = isDeal ? model.planDealRate : model.planWinRate;
  let num = 0;
  let den = 0;
  let any = false;
  for (const m of ms) {
    let nm = 0;
    let dn = 0;
    let ok = true;
    for (const c of chs) {
      const a = isDeal ? c.act.deals[m] : c.act.wins[m];
      const b = isDeal ? c.act.valid[m] : c.act.deals[m];
      if (a == null || b == null) {
        ok = false;
        break;
      }
      nm += a;
      dn += b;
    }
    if (!ok) continue;
    any = true;
    num += nm;
    den += dn;
  }
  if (!any || !den || plan == null) return { actual: null, plan, ratio: null, prob: null, n: 0 };
  const x = Math.min(Math.round(num), Math.round(den));
  return { actual: num / den, plan, ratio: plan ? num / den / plan : null, prob: betaBelow(x + 1, Math.round(den) - x + 1, plan), n: Math.round(den) };
}

const ROLLING = new Set<Metric>(["商談化率", "受注率"]); // 3か月の合計で見る

function unitOf(m: Metric): Row["unit"] {
  return m === "リード数" ? "count" : m === "CPL" ? "man" : "rate";
}
// CPLは開始月（計画のリード数が最初に入った月）からの累計で見る（展示会のように毎月はリードが出ないチャネルがあるため）
function startOf(model: Model, channel: string) {
  const c = model.channels.find((x) => x.name === channel);
  if (!c) return 0;
  const i = c.plan.leads.findIndex((v) => v > 0);
  return i < 0 ? 0 : i;
}
function windowFor(model: Model, channel: string, metric: Metric, m: number): number[] {
  if (metric === "CPL") {
    const s = startOf(model, channel);
    return m < s ? [] : Array.from({ length: m - s + 1 }, (_, k) => s + k);
  }
  if (!ROLLING.has(metric)) return [m];
  if (m < 2) return [];
  return [m - 2, m - 1, m];
}

export function buildRow(model: Model, channel: string, metric: Metric, fromLog: boolean): Row {
  const cells: Cell[] = [];
  const actual: (number | null)[] = [];
  const plan: (number | null)[] = [];
  for (let m = 0; m < 12; m++) {
    if (m > model.last) {
      cells.push({ ratio: null, prob: null });
      actual.push(null);
      plan.push(planOnly(model, channel, metric, m));
      continue;
    }
    const w = windowFor(model, channel, metric, m);
    const e = evalWindow(model, channel, metric, w);
    const note = !w.length ? (metric === "CPL" ? "開始前" : "3か月そろってから") : e.ratio == null && metric === "リード数" ? "計画なし" : undefined;
    cells.push({ ratio: e.ratio, prob: e.prob, note });
    actual.push(e.actual);
    plan.push(e.plan ?? planOnly(model, channel, metric, m));
  }
  const s0 = metric === "CPL" ? startOf(model, channel) : 0;
  const all = model.last < s0 || (ROLLING.has(metric) && model.last < 2) ? [] : Array.from({ length: model.last - s0 + 1 }, (_, i) => s0 + i);
  const t = evalWindow(model, channel, metric, all);
  let streak = 0;
  for (let m = model.last; m >= 0; m--) {
    const p = cells[m].prob;
    if (p == null) {
      if (cells[m].ratio == null && metric === "リード数") continue; // 計画のない月（展示会のない月など）は飛ばす
      break;
    }
    if (p >= 0.7) streak++;
    else break;
  }
  // 1か月あたりの件数が少ない（分母が月平均5件未満）＝判断しにくい
  const months = Math.max(1, model.last + 1);
  const thin = metric !== "商談化率" && metric !== "受注率" && t.n / months < 5 && (t.prob ?? 0) < 0.9;
  const label = `${channel === "全チャネル" ? "全チャネル" : channel}・${metric}${ROLLING.has(metric) ? "（3か月）" : ""}`;
  return { key: `${channel}|${metric}`, channel, metric, label, unit: unitOf(metric), cells, total: { ratio: t.ratio, prob: t.prob }, streak, thin, series: { actual, plan }, fromLog };
}

function planOnly(model: Model, channel: string, metric: Metric, m: number): number | null {
  const chs = channel === "全体" || channel === "全チャネル" ? model.channels : model.channels.filter((c) => c.name === channel);
  if (metric === "リード数") {
    const s = chs.reduce((a, c) => a + c.plan.leads[m], 0);
    return s || null;
  }
  if (metric === "有効リード率") {
    const l = chs.reduce((a, c) => a + c.plan.leads[m], 0);
    const v = chs.reduce((a, c) => a + c.plan.valid[m], 0);
    return l ? v / l : null;
  }
  if (metric === "CPL") return model.cplCap || null;
  return metric === "商談化率" ? model.planDealRate : model.planWinRate;
}

// 施策ログの「チャネル」を課題の行に合わせる（共通→全チャネル、全体の率はそのまま全体）
function rowChannel(channel: string, metric: string) {
  if (metric === "商談化率" || metric === "受注率") return "全体";
  if (channel === "共通" || channel === "全体") return "全チャネル";
  return channel;
}
function isMetric(s: string): s is Metric {
  return (METRICS as string[]).includes(s);
}

// Aに出す行：施策ログにある課題＋期首からの合計で「たぶん下回っている（70%以上）」課題
export function buildRows(model: Model): Row[] {
  const keys = new Map<string, { channel: string; metric: Metric; fromLog: boolean }>();
  for (const x of model.log) {
    if (!isMetric(x.metric)) continue;
    const ch = rowChannel(x.channel, x.metric);
    if (ch !== "全体" && ch !== "全チャネル" && !model.channels.some((c) => c.name === ch)) continue;
    keys.set(`${ch}|${x.metric}`, { channel: ch, metric: x.metric, fromLog: true });
  }
  const cand: { channel: string; metric: Metric }[] = [];
  for (const c of model.channels) for (const m of ["リード数", "有効リード率", "CPL"] as Metric[]) cand.push({ channel: c.name, metric: m });
  cand.push({ channel: "全体", metric: "商談化率" }, { channel: "全体", metric: "受注率" });
  const rows: Row[] = [];
  for (const k of cand) {
    const key = `${k.channel}|${k.metric}`;
    if (keys.has(key)) continue;
    const r = buildRow(model, k.channel, k.metric, false);
    if ((r.total.prob ?? 0) >= 0.7) rows.push(r);
  }
  for (const k of keys.values()) rows.push(buildRow(model, k.channel, k.metric, true));
  // 並び：期首からの合計で下回っている確率の高い順
  rows.sort((a, b) => (b.total.prob ?? -1) - (a.total.prob ?? -1));
  return rows;
}

// ---------- 打ち手の効果（C） ----------

export interface Effect {
  item: LogItem;
  rowKey: string | null;
  state: "ok" | "draft" | "before" | "na" | "skip"; // 確定／参考（後が1か月）／実施前／比べられない／計算しない
  prob: number | null; // 良くなった確率
  lo: number | null; // 変化の幅（10%点、相対）
  hi: number | null; // 変化の幅（90%点、相対）
  before: number | null;
  after: number | null;
  beforeMonths: number;
  afterMonths: number;
  mismatch: boolean; // 振り返りと数字が合わない
  needMonths: number | null | "hard"; // 30%の変化を見分けるまでの目安（実施月からの月数）
  reason?: string;
}

const SAMPLES = 20000;

function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// 前と後の「件数」をそろえる
interface Side {
  kind: "count" | "rate";
  x: number; // 件数（率なら分子）
  n: number; // 露出（件数なら計画の件数 or 費用、率なら分母）
  value: number | null; // 表示用の値
}

function sideOf(model: Model, channel: string, metric: Metric, ms: number[]): Side | null {
  const chs = channel === "全体" || channel === "全チャネル" ? model.channels : model.channels.filter((c) => c.name === channel);
  if (!chs.length || !ms.length) return null;
  const tot = (pick: (c: Channel) => (number | null)[]) => {
    let s = 0;
    let any = false;
    for (const c of chs) {
      const v = sumAt(pick(c), ms);
      if (v != null) {
        s += v;
        any = true;
      }
    }
    return any ? s : null;
  };
  const leads = tot((c) => c.act.leads);
  if (metric === "リード数") {
    const pl = tot((c) => c.plan.leads);
    if (leads == null || !pl) return null;
    return { kind: "count", x: Math.round(leads), n: pl, value: leads / pl };
  }
  if (metric === "CPL") {
    const cost = tot((c) => c.act.cost.map((v, m) => (c.act.leads[m] == null ? null : v)));
    if (leads == null || !cost) return null;
    return { kind: "count", x: Math.round(leads), n: cost, value: leads ? cost / leads : null };
  }
  if (metric === "有効リード率") {
    const valid = tot((c) => c.act.valid);
    if (leads == null || valid == null || !leads) return null;
    return { kind: "rate", x: Math.min(Math.round(valid), Math.round(leads)), n: Math.round(leads), value: valid / leads };
  }
  const e = evalWindow(model, "全体", metric, ms);
  if (e.actual == null || !e.n) return null;
  const x = Math.round(e.actual * e.n);
  return { kind: "rate", x, n: e.n, value: e.actual };
}

function drawSide(s: Side, r: () => number) {
  if (s.kind === "count") return gamma(s.x + 1, r) / s.n;
  const a = gamma(s.x + 1, r);
  const b = gamma(s.n - s.x + 1, r);
  return a / (a + b);
}

// 30%の変化を、80%の確からしさで見分けるまでの月数（目安）。前は3か月、後はmか月として、
// 変化の対数の分散 c/(3x) + c/(m·x) が (ln1.3 / 0.8416)^2 ≒ 0.097 以下になる m を求める。
// x＝1か月あたりの件数（率なら分子の件数）、c＝1（件数）または 1−率（率）
function needMonths(perMonth: number, kind: "count" | "rate", rate: number): number | "hard" {
  const LIMIT = 0.097;
  const x = kind === "count" ? perMonth : perMonth * rate;
  const c = kind === "count" ? 1 : 1 - rate;
  if (x <= 0) return "hard";
  const rest = LIMIT - c / (3 * x);
  if (rest <= 0) return "hard";
  const m = Math.ceil(c / (x * rest));
  return m > 12 ? "hard" : Math.max(1, m);
}

export function buildEffects(model: Model): Effect[] {
  const out: Effect[] = [];
  for (const item of model.log) {
    const base: Effect = { item, rowKey: null, state: "skip", prob: null, lo: null, hi: null, before: null, after: null, beforeMonths: 0, afterMonths: 0, mismatch: false, needMonths: null };
    if (item.status === "中止") continue;
    if (!isMetric(item.metric)) {
      out.push({ ...base, state: "skip", reason: "狙う指標が読めない" });
      continue;
    }
    const j = model.months.indexOf(item.doMonth);
    if (j < 0) {
      out.push({ ...base, state: "skip", reason: "実施月が空" });
      continue;
    }
    const metric = item.metric;
    const ch = rowChannel(item.channel, metric);
    base.rowKey = `${ch}|${metric}`;
    const bms = Array.from({ length: Math.min(3, j) }, (_, k) => j - Math.min(3, j) + k).filter((m) => m <= model.last);
    const b = sideOf(model, ch, metric, bms);
    // 月あたりの量（目安の計算用）
    const chs = ch === "全体" || ch === "全チャネル" ? model.channels : model.channels.filter((c) => c.name === ch);
    const months = Math.max(1, model.last + 1);
    const totLeads = chs.reduce((s, c) => s + (sumAt(c.act.leads, Array.from({ length: months }, (_, i) => i)) ?? 0), 0);
    const planLeadsYear = chs.reduce((s, c) => s + c.plan.leads.reduce((a, v) => a + v, 0), 0);
    let perMonth = planLeadsYear ? planLeadsYear / 12 : totLeads / months;
    let rate = 0.5;
    if (metric === "有効リード率") {
      const pl = chs.reduce((s2, c) => s2 + c.plan.leads.reduce((a2, v) => a2 + v, 0), 0);
      const pv = chs.reduce((s2, c) => s2 + c.plan.valid.reduce((a2, v) => a2 + v, 0), 0);
      rate = pl ? pv / pl : b?.value ?? 0.3;
    }
    if (metric === "商談化率" || metric === "受注率") {
      // 計画の件数で見積もる（分母＝商談化率は有効リード数、受注率は商談数）
      const pv = model.channels.reduce((s2, c) => s2 + c.plan.valid.reduce((a2, v) => a2 + v, 0), 0);
      const dr = model.planDealRate ?? 0.3;
      perMonth = metric === "商談化率" ? pv / 12 : (pv * dr) / 12;
      rate = metric === "商談化率" ? dr : model.planWinRate ?? 0.3;
    }
    const kind: "count" | "rate" = metric === "リード数" || metric === "CPL" ? "count" : "rate";

    if (j > model.last) {
      out.push({ ...base, state: "before", beforeMonths: bms.length, needMonths: needMonths(perMonth, kind, rate), before: b?.value ?? null });
      continue;
    }
    const ams = Array.from({ length: model.last - j + 1 }, (_, k) => j + k);
    const a = sideOf(model, ch, metric, ams);
    if (!b || !a) {
      out.push({ ...base, state: "na", beforeMonths: bms.length, afterMonths: ams.length, before: b?.value ?? null, after: a?.value ?? null, reason: !b ? "実施前の実績がない" : "実施後の実績がない" });
      continue;
    }
    const r = rng(hashSeed(`${item.row}|${item.action}|${item.doMonth}`));
    let better = 0;
    const ch2: number[] = new Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const vb = drawSide(b, r);
      const va = drawSide(a, r);
      // CPLは「費用あたりのリード」が増えた＝良くなった。変化はCPLの変化（小さいほど良い）として出す
      if (metric === "CPL") {
        if (va > vb) better++;
        ch2[i] = vb / va - 1;
      } else {
        if (va > vb) better++;
        ch2[i] = va / vb - 1;
      }
    }
    ch2.sort((x, y) => x - y);
    const prob = better / SAMPLES;
    const state = ams.length >= 2 ? "ok" : "draft";
    const mismatch = state === "ok" && ((item.review === "効果あり" && prob <= 0.2) || (item.review === "効果なし" && prob >= 0.8));
    out.push({
      ...base,
      state,
      prob,
      lo: ch2[Math.floor(SAMPLES * 0.1)],
      hi: ch2[Math.floor(SAMPLES * 0.9)],
      before: b.value,
      after: a.value,
      beforeMonths: bms.length,
      afterMonths: ams.length,
      mismatch,
      needMonths: state === "draft" ? needMonths(perMonth, kind, rate) : null,
    });
  }
  // 並び：確率の高い順 → 参考 → 実施前 → 比べられない
  const order = { ok: 0, draft: 1, before: 2, na: 3, skip: 4 } as const;
  out.sort((x, y) => (x.state === "ok" || x.state === "draft") && (y.state === "ok" || y.state === "draft") ? (y.prob ?? 0) - (x.prob ?? 0) : order[x.state] - order[y.state]);
  return out;
}

export function verdict(p: number | null): { label: string; tone: "good" | "bad" | "mid" } {
  if (p == null) return { label: "—", tone: "mid" };
  if (p >= 0.9) return { label: "効いた", tone: "good" };
  if (p >= 0.8) return { label: "たぶん効いた", tone: "good" };
  if (p <= 0.1) return { label: "悪くなった", tone: "bad" };
  if (p <= 0.2) return { label: "悪くなった可能性", tone: "bad" };
  return { label: "まだ分からない", tone: "mid" };
}

// ---------- まとめ ----------

export interface Summary {
  lastLabel: string;
  monthsCount: number;
  logCount: number;
  byStatus: Record<string, number>;
  lasting: Row[]; // 続いている課題（期首からの合計で90%以上 かつ 3か月以上続く）
  effects: { good: number; bad: number; mid: number; draft: number; before: number; na: number };
  mismatch: number;
}

export function summarize(model: Model, rows: Row[], effects: Effect[]): Summary {
  const byStatus: Record<string, number> = {};
  for (const x of model.log) byStatus[x.status || "未入力"] = (byStatus[x.status || "未入力"] ?? 0) + 1;
  const e = { good: 0, bad: 0, mid: 0, draft: 0, before: 0, na: 0 };
  for (const f of effects) {
    if (f.state === "ok") e[verdict(f.prob).tone]++;
    else if (f.state === "draft") e.draft++;
    else if (f.state === "before") e.before++;
    else if (f.state === "na") e.na++;
  }
  return {
    lastLabel: model.last >= 0 ? model.months[model.last] : "",
    monthsCount: model.last + 1,
    logCount: model.log.length,
    byStatus,
    lasting: rows.filter((r) => (r.total.prob ?? 0) >= 0.9 && r.streak >= 3),
    effects: e,
    mismatch: effects.filter((f) => f.mismatch).length,
  };
}

export function analyze(book: Book) {
  const model = buildModel(book);
  const rows = buildRows(model);
  const effects = buildEffects(model);
  return { model, rows, effects, summary: summarize(model, rows, effects) };
}
export type Analysis = ReturnType<typeof analyze>;

// ---------- 表示用 ----------
export function fmtValue(v: number | null, unit: Row["unit"]) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "rate") return `${Math.round(v * 100)}%`;
  if (unit === "man") return `${v.toFixed(1)}万円`;
  return `${Math.round(v * 10) / 10}件`;
}
export const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`);
export const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`);
