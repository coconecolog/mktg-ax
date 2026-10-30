// src/lib/budgetCheck.ts
//
// 予算案診断キット（/tools/budget-checker）の読み込み・判定・状態。画面は src/scripts/budget-checker/app.ts。
// 2026-10-30 作り直し：入口3つ（AIで整えて貼りつける／年間予算表（.xlsx）を読み込む／画面で入力する）→
// 左＝入力・右＝判定の画面でNGを直す → 年間予算表（M-B-03、Excel）に「診断結果」シートを足してダウンロード。
// - 入力の項目は年間予算表（施策別）と同じ（KPI管理表の「はじめに入力」とも同じ）。件数と費用を入れ、率は入れない
// - 計算は src/lib/kpi-sheet-maker.ts の calc、判定は src/lib/kpiCheck.ts の diagnose と同じ（数字の定義の正本は Drive「★数字の定義（KPI・予算）」）
//   予算案で抜けやすいところ（人件費・リードを生まない費用）の判定だけ、このキットで足す
// - 月別のリード数・有効リード数：最初は年間÷12（KPI管理表作成キットと同じ分け方）。月別を直したチャネルは年間を変えても上書きしない
import { CHANNELS, EXAMPLE, calc, splitMonthly, validate, type ChannelInput, type SheetInput, type SheetResult } from "@/lib/kpi-sheet-maker";
import { diagnose, fmt, pct, readPlanSheet, ReadError, type MonthlyPlan, type Status } from "@/lib/kpiCheck";
import type { Book } from "@/lib/kpiAnalysis";

export { CHANNELS, ReadError, fmt, pct, type SheetInput, type ChannelInput, type SheetResult, type Status, type MonthlyPlan };

export const SHEET_BUDGET = "年間予算表（施策別）";

export type Source = "ai" | "xlsx" | "form" | "sample";
export const SOURCE_LABEL: Record<Source, string> = { ai: "AIの案", xlsx: "年間予算表", form: "画面で入力", sample: "記入例（基本モデルの安定期）" };

export interface BudgetState {
  source: Source;
  fileName?: string;
  input: SheetInput;
  /** CHANNELS と同じ順で6つ。12か月は期首の月から */
  monthly: { leads: number[]; valid: number[] }[];
  /** 月別を手で直した（または読み込んだ）チャネル。年間を変えても月別を上書きしない */
  manual: boolean[];
  /** 読み込みのときのお知らせ（AIが変換で行ったこと・除いた費用・空欄のまま・読めなかったもの） */
  notes: string[];
}

// ---------- 作る ----------

/** 基本モデル（安定期）の月別。年間予算表（M-B-03）の記入例と同じ数字 */
const SAMPLE_MONTHLY = [
  { leads: [0, 0, 110, 0, 0, 0, 0, 110, 0, 0, 0, 0], valid: [0, 0, 28, 0, 0, 0, 0, 27, 0, 0, 0, 0] },
  { leads: [0, 13, 0, 13, 0, 13, 0, 13, 0, 14, 0, 14], valid: [0, 8, 0, 8, 0, 8, 0, 8, 0, 9, 0, 9] },
  { leads: [5, 9, 9, 9, 9, 9, 9, 9, 10, 6, 6, 5], valid: [2, 4, 4, 4, 4, 4, 4, 4, 5, 3, 3, 2] },
  { leads: [6, 5, 6, 5, 6, 10, 10, 8, 7, 8, 10, 9], valid: [2, 2, 2, 2, 2, 4, 4, 3, 3, 3, 4, 3] },
  { leads: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], valid: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0] },
  { leads: [1, 2, 1, 2, 1, 2, 2, 2, 2, 1, 2, 2], valid: [0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1] },
];

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** 期首の初期値：今が4月以降なら来年の4月、1〜3月なら今年の4月 */
export function defaultStart(now = new Date()) {
  return { y: now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear(), m: 4 };
}

const zeroCh = (): ChannelInput => ({ leads: 0, valid: 0, deals: 0, wins: 0, ext: 0, labor: 0 });

export function emptyState(): BudgetState {
  const s = defaultStart();
  return {
    source: "form",
    input: { startYear: s.y, startMonth: s.m, goal: NaN, price: NaN, gmPct: NaN, paybackYears: NaN, leadTime: NaN, common: 0, channels: CHANNELS.map(zeroCh) },
    monthly: CHANNELS.map(() => ({ leads: Array(12).fill(0), valid: Array(12).fill(0) })),
    manual: CHANNELS.map(() => false),
    notes: [],
  };
}

export function sampleState(): BudgetState {
  const input = clone(EXAMPLE);
  return { source: "sample", input, monthly: clone(SAMPLE_MONTHLY), manual: CHANNELS.map(() => true), notes: [] };
}

/** 手で直していないチャネルの月別を、年間÷12にそろえる */
export function syncMonthly(st: BudgetState) {
  st.input.channels.forEach((c, i) => {
    if (st.manual[i]) return;
    st.monthly[i] = { leads: splitMonthly(c.leads), valid: splitMonthly(c.valid) };
  });
}

/** 月別を年間÷12に戻す */
export function resetMonthly(st: BudgetState, i: number) {
  st.manual[i] = false;
  syncMonthly(st);
}

// ---------- 年間予算表（.xlsx）を読む ----------

export function stateFromBook(book: Book, fileName: string): BudgetState {
  const src = readPlanSheet(book, fileName, SHEET_BUDGET, "年間予算表（M-B-03）");
  const st = emptyState();
  st.source = "xlsx";
  st.fileName = fileName;
  st.notes = [...src.warnings];
  const inp = src.input;
  st.input = { ...inp, channels: CHANNELS.map(zeroCh) };
  if (!Number.isFinite(inp.startYear)) {
    const d = defaultStart();
    st.input.startYear = d.y;
    st.input.startMonth = d.m;
    st.notes.push(`期首が読めなかったため、${d.y}年${d.m}月にしています。`);
  }
  const skipped: string[] = [];
  src.names.forEach((name, k) => {
    const i = CHANNELS.indexOf(name as (typeof CHANNELS)[number]);
    if (i < 0) skipped.push(name);
    else st.input.channels[i] = { ...inp.channels[k] };
  });
  if (skipped.length) st.notes.push(`チャネル「${skipped.join("・")}」は、年間予算表の6つのチャネルにないため読み込んでいません。`);
  syncMonthly(st);
  for (const m of src.monthly ?? []) {
    const i = CHANNELS.indexOf(m.name as (typeof CHANNELS)[number]);
    if (i < 0) continue;
    st.monthly[i] = { leads: m.leads.map((v) => Math.max(0, v)), valid: m.valid.map((v) => Math.max(0, v)) };
    st.manual[i] = true;
  }
  return st;
}

// ---------- AIの案（JSON）を読む ----------

export const AI_FORMAT = "mktgax-budget-v2";

export const AI_PROMPT = `あなたは、マーケティング予算案の数字を決まった形に書き直すアシスタントです。

このチャットで作った来期のマーケティング予算案（この上の会話、または下に貼る予算案・資料）を、次のJSONの形に変換してください。

ルール
- 予算案に書かれている数字だけを使う。書かれていない数字は null にする。推測で埋めない
- 金額の単位は万円。月額で書かれている費用は12倍して年額にし、notes にその旨を書く
- チャネルは「展示会」「セミナー」「Web広告」「自社サイト」「SNS」「メール」の6つに振り分ける。同じチャネルに入る施策は足し合わせる。どれにも当てはまらない施策は一番近いチャネルに入れ、notes に書く
  （Web広告＝リスティング・SNS広告などの広告、自社サイト＝自社サイトの問い合わせ・資料請求・資料DL、メール＝メルマガ配信）
- リード数・有効リード数（営業に渡せるリード）・商談数・受注数は件数で入れる。率しか書かれていなければ、件数に直して notes に書く
- 人件費はチャネルごとの年額。総額しかなければ、チャネルにかける時間の比で配って notes に書く。人件費が書かれていなければ null
- ツール費・保守費など、リードを生まない費用は、それを使うチャネルの external_cost に足し、notes に書く
- 予備費・バッファ・調整枠は channels に入れず、excluded に入れる
- どの施策にも配らない費用（ブランディング費など）は common_cost に入れる
- 月別のリード数・有効リード数が書かれていれば、期首の月から12か月の配列で入れる。なければ null
- 出力はJSONのコードブロック1つだけ。説明の文は書かない

{
  "format": "${AI_FORMAT}",
  "start": "期首の年月（例 2027-04）",
  "goal": マーケ経由の売上目標（万円）,
  "price": 平均受注単価（万円）,
  "gross_margin_pct": 粗利率（%）,
  "payback_years": 回収期間（獲得の費用を取り返す年数）,
  "lead_time_months": リードタイム（リード獲得から受注までの月数）,
  "common_cost": 共通費（万円）,
  "channels": [
    { "channel": "展示会", "leads": リード数, "valid_leads": 有効リード数, "deals": 商談数, "wins": 受注数, "external_cost": 外部費用（万円・年額）, "labor_cost": 人件費（万円・年額）, "monthly_leads": null, "monthly_valid_leads": null }
  ],
  "excluded": [
    { "item": "除いた項目", "amount": 金額（万円）, "reason": "理由" }
  ],
  "notes": ["変換で行ったこと"]
}`;

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/[,，\s万円件%か月年]/g, ""));
  return Number.isFinite(x) ? x : null;
};
const arr12 = (v: unknown): number[] | null => {
  if (!Array.isArray(v) || v.length !== 12) return null;
  const a = v.map(n);
  return a.every((x) => x !== null && x >= 0) ? (a as number[]) : null;
};

export function stateFromAi(text: string): BudgetState {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new ReadError("読み込めませんでした。AIが返した結果の { から } までを、そのまま貼りつけてください。");
  let j: any;
  try {
    j = JSON.parse(text.slice(s, e + 1));
  } catch {
    throw new ReadError("読み込めませんでした。JSONの形が崩れています。AIに「JSONのコードブロック1つだけで出し直して」と頼んでください。");
  }
  if (!j || j.format !== AI_FORMAT)
    throw new ReadError(`読み込めませんでした。形式が違います（"format": "${AI_FORMAT}" がありません）。上のプロンプトをコピーし直して、AIに変換させた結果を貼りつけてください。`);

  const st = emptyState();
  st.source = "ai";
  const blank: string[] = [];
  const pre = (key: string, label: string): number => {
    const v = n(j[key]);
    if (v === null) blank.push(label);
    return v === null ? NaN : v;
  };
  const sm = /^(\d{4})\D+(\d{1,2})/.exec(String(j.start ?? ""));
  if (sm) {
    st.input.startYear = Number(sm[1]);
    st.input.startMonth = Math.min(12, Math.max(1, Number(sm[2])));
  } else blank.push("期首");
  st.input.goal = pre("goal", "売上目標");
  st.input.price = pre("price", "平均受注単価");
  st.input.gmPct = pre("gross_margin_pct", "粗利率");
  st.input.paybackYears = pre("payback_years", "回収期間");
  st.input.leadTime = pre("lead_time_months", "リードタイム");
  st.input.common = n(j.common_cost) ?? 0;

  const chs: any[] = Array.isArray(j.channels) ? j.channels : [];
  const unknown: string[] = [];
  const monthly: (null | { leads: number[] | null; valid: number[] | null })[] = CHANNELS.map(() => null);
  for (const c of chs) {
    const i = CHANNELS.indexOf(String(c?.channel ?? "").trim() as (typeof CHANNELS)[number]);
    if (i < 0) {
      unknown.push(String(c?.channel ?? "（名前なし）"));
      continue;
    }
    const cur = st.input.channels[i];
    const fields: [keyof ChannelInput, string, string][] = [
      ["leads", "leads", "リード数"],
      ["valid", "valid_leads", "有効リード数"],
      ["deals", "deals", "商談数"],
      ["wins", "wins", "受注数"],
      ["ext", "external_cost", "外部費用"],
      ["labor", "labor_cost", "人件費"],
    ];
    const miss: string[] = [];
    for (const [k, key, label] of fields) {
      const v = n(c[key]);
      if (v === null) miss.push(label);
      else cur[k] += Math.max(0, v);
    }
    if (miss.length && miss.length < fields.length) blank.push(`${CHANNELS[i]}の${miss.join("・")}`);
    monthly[i] = { leads: arr12(c.monthly_leads), valid: arr12(c.monthly_valid_leads) };
  }
  if (unknown.length) st.notes.push(`チャネル「${unknown.join("・")}」は6つのチャネルにないため読み込んでいません。AIに6つのチャネルへ振り分け直させてください。`);
  if (st.input.channels.every((c) => !c.leads && !c.ext && !c.labor)) throw new ReadError("読み込めませんでした。チャネル別の数字が1つも入っていません。");

  syncMonthly(st);
  monthly.forEach((m, i) => {
    if (!m || (!m.leads && !m.valid)) return;
    if (m.leads) st.monthly[i].leads = m.leads;
    if (m.valid) st.monthly[i].valid = m.valid;
    st.manual[i] = true;
  });

  const ai: string[] = Array.isArray(j.notes) ? j.notes.filter((x: unknown) => typeof x === "string" && x.trim()) : [];
  if (ai.length) st.notes.push(`AIが変換で行ったこと：${ai.join("／")}`);
  const ex: any[] = Array.isArray(j.excluded) ? j.excluded : [];
  for (const x of ex) {
    const amt = n(x?.amount);
    st.notes.push(`${String(x?.item ?? "除いた費用")}${amt !== null ? `（${fmt(amt)}万円）` : ""}は入れていません。期中に足りなくなったら、追加予算の稟議で扱います。`);
  }
  if (blank.length) st.notes.push(`AIの案に書かれていなかったため空欄のままです：${blank.join("、")}。数字を入れてください。`);
  return st;
}

// ---------- 判定 ----------

export type Group = "A" | "B" | "C" | "D";
export const GROUP_LABEL: Record<Group, string> = { A: "つながり", B: "率の現実性", C: "コスト", D: "予算案で抜けやすいところ" };

export interface BItem {
  group: Group;
  title: string;
  status: Status;
  reason: string;
  summary?: string;
  todo?: string;
  /** 押したときに移る入力欄（name 属性）。"m:3" は月別のタブのチャネル */
  jump?: string;
}

export interface BudgetDiagnosis {
  ready: boolean; // 前提がそろっていて判定できる
  missing: string[]; // 判定に足りない前提
  r: SheetResult | null;
  items: BItem[];
  counts: Record<Status, number>;
  conclusion: string;
  /** 欄の色（name 属性 → 判定）。"cpl3" はチャネルのCPLのセル */
  marks: Record<string, "fix" | "check">;
  monthlyOff: boolean[]; // 月別の合計が年間と合わないチャネル
}

const used = (c: ChannelInput) => c.leads > 0 || c.valid > 0 || c.deals > 0 || c.wins > 0 || c.ext > 0 || c.labor > 0;
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export function diagnoseBudget(st: BudgetState): BudgetDiagnosis {
  const inp = st.input;
  const { errors } = validate(inp);
  const missing = errors.filter((e) => !CHANNELS.includes(e as (typeof CHANNELS)[number]));
  const marks: BudgetDiagnosis["marks"] = {};
  const monthlyOff = st.monthly.map((m, i) => Math.abs(sum(m.leads) - inp.channels[i].leads) > 0.5 || Math.abs(sum(m.valid) - inp.channels[i].valid) > 0.5);
  if (missing.length) {
    return { ready: false, missing, r: null, items: [], counts: { ok: 0, check: 0, fix: 0, na: 0 }, conclusion: "", marks, monthlyOff };
  }

  const monthly: MonthlyPlan[] = CHANNELS.map((name, i) => ({ name, leads: st.monthly[i].leads, valid: st.monthly[i].valid }));
  const d = diagnose({ source: "xlsx", input: inp, names: [...CHANNELS], monthly, warnings: [] });
  const r = d.r;
  const items: BItem[] = d.items.map((it) => ({ ...it }));
  const usedIdx = inp.channels.map((c, i) => (used(c) ? i : -1)).filter((i) => i >= 0);

  // 欄の色と、押したときに移る欄
  for (const it of items) {
    if (it.status !== "fix" && it.status !== "check") continue;
    const s = it.status;
    if (it.title.startsWith("計画の数が")) {
      it.jump = "goal";
      const stages = [
        ["leads", "leads"],
        ["valid", "valid"],
        ["deals", "deals"],
        ["wins", "wins"],
      ] as const;
      for (const [k, f] of stages) if (r.short[k]) marks[`total.${f}`] = s;
    } else if (it.title.startsWith("件数が")) {
      const bad = usedIdx.filter((i) => {
        const c = inp.channels[i];
        return !(c.leads >= c.valid && c.valid >= c.deals && c.deals >= c.wins);
      });
      bad.forEach((i) => {
        const c = inp.channels[i];
        if (c.valid > c.leads) marks[`ch${i}.valid`] = s;
        if (c.deals > c.valid) marks[`ch${i}.deals`] = s;
        if (c.wins > c.deals) marks[`ch${i}.wins`] = s;
      });
      if (bad.length) it.jump = `ch${bad[0]}.valid`;
    } else if (it.title.startsWith("月別の計画")) {
      const off = monthlyOff.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
      off.forEach((i) => (marks[`m:${i}`] = s));
      if (off.length) it.jump = `m:${off[0]}`;
      it.todo = "「月別」のタブで、そのチャネルの月別の合計を年間に合わせます（「年間÷12に戻す」でもそろいます）";
    } else if (it.title.startsWith("チャネルのCPL")) {
      const over = r.channels.map((c, i) => (c.cplOver ? i : -1)).filter((i) => i >= 0);
      over.forEach((i) => (marks[`cpl${i}`] = s));
      if (over.length) it.jump = `ch${over[0]}.ext`;
    } else if (it.title.startsWith("全体のCAC")) {
      marks["total.cac"] = s;
    }
  }

  // ---- D 予算案で抜けやすいところ ----
  {
    const title = "人件費が入っているか";
    const totalCost = sum(inp.channels.map((c) => c.ext));
    const totalLabor = sum(inp.channels.map((c) => c.labor));
    const noLabor = usedIdx.filter((i) => inp.channels[i].ext > 0 && !(inp.channels[i].labor > 0));
    if (totalCost > 0 && !(totalLabor > 0)) {
      usedIdx.forEach((i) => (marks[`ch${i}.labor`] = "check"));
      items.push({
        group: "D",
        title,
        status: "check",
        reason: "人件費が入っていません。人件費を入れないと、CAC・回収期間が実際より良く見えます",
        summary: "人件費が入っていない",
        todo: "チャネルごとに、マーケ担当がかける時間の人件費（年額）を入れます。営業が施策に協力する時間（展示会の立ち会い・登壇など）も含めます",
        jump: usedIdx.length ? `ch${usedIdx[0]}.labor` : undefined,
      });
    } else if (noLabor.length) {
      noLabor.forEach((i) => (marks[`ch${i}.labor`] = "check"));
      items.push({
        group: "D",
        title,
        status: "check",
        reason: `${noLabor.map((i) => CHANNELS[i]).join("・")}は、外部費用があるのに人件費が0です`,
        summary: `${noLabor.map((i) => CHANNELS[i]).join("・")}の人件費が0`,
        todo: "そのチャネルにかける時間の人件費を入れます。本当にかけないなら0のままでかまいません",
        jump: `ch${noLabor[0]}.labor`,
      });
    } else if (totalCost > 0 || totalLabor > 0) items.push({ group: "D", title, status: "ok", reason: `人件費${fmt(totalLabor)}万円が入っています` });
  }
  {
    const title = "リードを生まない費用だけのチャネルがないか";
    const bad = usedIdx.filter((i) => inp.channels[i].ext + inp.channels[i].labor > 0 && !(inp.channels[i].leads > 0));
    if (bad.length) {
      bad.forEach((i) => (marks[`ch${i}.leads`] = "check"));
      items.push({
        group: "D",
        title,
        status: "check",
        reason: `${bad.map((i) => CHANNELS[i]).join("・")}は、費用があるのにリード数が0です`,
        summary: `${bad.map((i) => CHANNELS[i]).join("・")}のリード数が0`,
        todo: "ツール費・保守費など、リードを生まない費用は、それを使うチャネルの外部費用に入れます。どの施策にも配らない費用は共通費に入れます",
        jump: `ch${bad[0]}.leads`,
      });
    } else items.push({ group: "D", title, status: "ok", reason: "費用のあるチャネルには、すべてリード数が入っています" });
  }

  const counts: Record<Status, number> = { ok: 0, check: 0, fix: 0, na: 0 };
  for (const it of items) counts[it.status]++;
  const sums = (s: Status) => items.filter((i) => i.status === s && i.summary).map((i) => i.summary!);
  let conclusion: string;
  if (counts.fix) {
    conclusion = `直すところが${counts.fix}つあります（${sums("fix").join("／")}）。`;
    if (counts.check) conclusion += `ほかに確認が${counts.check}つあります。`;
  } else if (counts.check) conclusion = `直すところはありません。確認が${counts.check}つあります（${sums("check").join("／")}）。`;
  else conclusion = "直すところも、確認するところもありません。この予算案で年間予算表を仕上げられます。";

  return { ready: true, missing: [], r, items, counts, conclusion, marks, monthlyOff };
}

/** 期首の月から12か月の見出し（「4月」…） */
export const monthLabels = (startMonth: number) => Array.from({ length: 12 }, (_, k) => `${((startMonth - 1 + k) % 12) + 1}月`);
