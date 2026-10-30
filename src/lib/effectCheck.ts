// src/lib/effectCheck.ts
//
// 施策効果診断Kit（/tools/kpi-analysis、2026-10-30 作り直し）の状態・読み込み・判定。
// 予算案診断Kit・KPI妥当性診断Kitと同じ型（入口3つ → 入力の画面（左＝入力、右＝判定）→ KPI管理表（Excel）をダウンロード）。
// - 入力はKPI管理表（M-B-04）の3シートと同じ：計画（はじめに入力）・毎月の実績（毎月の実績入力）・施策ログ
//   計画の部分は src/lib/budgetCheck.ts の BudgetState をそのまま使う（KPI妥当性診断Kitと同じ項目）
// - 分析（月別進捗状況・推移・打ち手の効果）は src/lib/kpiAnalysis.ts。画面の入力から Model を作って analyzeModel に渡す
// - 判定：入力の不備（有効リード数＞リード数、施策ログの実施月が空 など）＝直す。
//   計画を下回っている確率（期首から）90%以上＝直す、70〜89%＝確認。打ち手のあと悪くなった・振り返りと数字が合わない＝確認
import {
  CHANNELS,
  ReadError,
  emptyState,
  fmt,
  monthLabels,
  stateFromAi,
  stateFromBook,
  AI_FORMAT,
  type BItem,
  type BudgetState,
  type Status,
} from "@/lib/budgetCheck";
import { calc, validate } from "@/lib/kpi-sheet-maker";
import { KITS } from "@/lib/planKits";
import {
  METRICS,
  analyzeModel,
  buildModel,
  pct,
  verdict,
  type Analysis,
  type Book,
  type Channel,
  type LogItem,
  type Model,
} from "@/lib/kpiAnalysis";

export type Num = number | null;
export const ACT_KEYS = ["leads", "valid", "deals", "wins", "ext", "labor"] as const;
export type ActKey = (typeof ACT_KEYS)[number];
export const ACT_LABEL: Record<ActKey, string> = { leads: "リード数", valid: "有効リード数", deals: "商談数", wins: "受注数", ext: "外部費用", labor: "人件費" };
export type ActCh = Record<ActKey, Num[]>;

export const LOG_KEYS = ["registered", "metric", "channel", "issue", "action", "doMonth", "basis", "status", "hours", "review"] as const;
export type LogKey = (typeof LOG_KEYS)[number];
export const LOG_LABEL: Record<LogKey, string> = {
  registered: "登録月",
  metric: "狙う指標",
  channel: "チャネル",
  issue: "課題",
  action: "打ち手",
  doMonth: "実施月",
  basis: "根拠",
  status: "状態",
  hours: "見込み時間",
  review: "振り返り",
};
export interface LogRow {
  registered: string;
  metric: string;
  channel: string;
  issue: string;
  action: string;
  doMonth: string;
  basis: string;
  status: string;
  hours: Num;
  review: string;
}
/** 施策ログの選ぶ欄（KPI管理表の入力規則と同じ） */
export const LOG_METRICS = ["リード数", "有効リード率", "商談化率", "受注率", "CPL"];
export const LOG_CHANNELS = [...CHANNELS, "共通", "全体"];
export const LOG_STATUS = ["予定", "実施中", "完了", "中止"];
export const LOG_REVIEW = ["効果あり", "効果なし", "判断できない"];
/** KPI管理表の施策ログに入る行数（5〜54行） */
export const LOG_MAX = 50;
export const LOG_FIRST_ROW = 5;

export interface EffectState extends BudgetState {
  /** CHANNELS と同じ順で6つ。12か月は期首の月から。null＝空欄（まだ入れていない）。外部費用・人件費の null＝計画の月額 */
  actual: ActCh[];
  log: LogRow[];
}

export const STORE = "mktgax-kpi-analysis-v2";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export const emptyAct = (): ActCh => ({ leads: Array(12).fill(null), valid: Array(12).fill(null), deals: Array(12).fill(null), wins: Array(12).fill(null), ext: Array(12).fill(null), labor: Array(12).fill(null) });
export const emptyLog = (): LogRow => ({ registered: "", metric: "", channel: "", issue: "", action: "", doMonth: "", basis: "", status: "", hours: null, review: "" });

export function emptyEffect(): EffectState {
  return { ...emptyState(), actual: CHANNELS.map(emptyAct), log: [] };
}

/** 計画の外部費用・人件費の月額（年額÷12。KPI管理表の式と同じ） */
export const planMonthly = (st: BudgetState, i: number, k: "ext" | "labor") => (st.input.channels[i][k] || 0) / 12;

// ---------- KPI管理表（.xlsx）を読む ----------

export function stateFromEffectBook(book: Book, fileName: string): EffectState {
  const plan = stateFromBook(book, fileName, KITS.kpi);
  const st: EffectState = { ...plan, actual: CHANNELS.map(emptyAct), log: [] };
  if (!book["毎月の実績入力"] || !book["施策ログ"]) {
    st.notes.push("「毎月の実績入力」「施策ログ」のシートがないため、計画だけを読み込みました。実績と打ち手は画面で入れてください。");
    return st;
  }
  const model = buildModel(book);
  const skipped: string[] = [];
  model.channels.forEach((c) => {
    const i = CHANNELS.indexOf(c.name as (typeof CHANNELS)[number]);
    if (i < 0) {
      skipped.push(c.name);
      return;
    }
    const a = st.actual[i];
    a.leads = [...c.act.leads];
    a.valid = [...c.act.valid];
    a.deals = [...c.act.deals];
    a.wins = [...c.act.wins];
    // 費用は外部費用＋人件費の合計で読んでいる。計画の月額と同じなら空欄（計画どおり）、違えば外部費用に入れる
    const pm = planMonthly(st, i, "ext") + planMonthly(st, i, "labor");
    c.act.cost.forEach((v, m) => {
      if (c.act.leads[m] == null) return;
      if (Math.abs(v - pm) > 0.05) {
        a.ext[m] = Math.round((v - planMonthly(st, i, "labor")) * 10) / 10;
      }
    });
  });
  if (skipped.length) st.notes.push(`チャネル「${skipped.join("・")}」の実績は、6つのチャネルにないため読み込んでいません。`);
  st.log = model.log.slice(0, LOG_MAX).map((x) => ({
    registered: x.registered,
    metric: x.metric,
    channel: x.channel,
    issue: x.issue,
    action: x.action,
    doMonth: x.doMonth,
    basis: x.basis,
    status: x.status,
    hours: x.hours,
    review: x.review,
  }));
  if (model.log.length > LOG_MAX) st.notes.push(`施策ログは${LOG_MAX}件まで読み込みます（${model.log.length - LOG_MAX}件は読み込んでいません）。`);
  return st;
}

// ---------- AIの案（JSON）を読む ----------

export const EFFECT_FORMAT = "mktgax-effect-v1";

export const effectPrompt = () => `あなたは、マーケティングのKPIの計画・毎月の実績・施策ログを、決まった形に書き直すアシスタントです。

このチャットにある（または下に貼る）KPIの計画・毎月の実績・打ち手の記録を、次のJSONの形に変換してください。

ルール
- 書かれている数字だけを使う。書かれていない数字は null にする。推測で埋めない
- 金額の単位は万円
- チャネルは「展示会」「セミナー」「Web広告」「自社サイト」「SNS」「メール」の6つに振り分ける。同じチャネルに入る施策は足し合わせる
  （Web広告＝リスティング・SNS広告などの広告、自社サイト＝自社サイトの問い合わせ・資料請求・資料DL、メール＝メルマガ配信）
- 計画（channels）は年間の件数と費用。リード数・有効リード数（営業に渡せるリード）・商談数・受注数は件数で入れる
- 実績（actuals）はチャネルと月ごとに1件。month は「2027-04」の形。商談数・受注数がわからない月は null、ゼロなら0
- 実績の外部費用・人件費は、計画と違う月だけ入れる（計画どおりなら null）
- 打ち手（action_log）の metric は「リード数」「有効リード率」「商談化率」「受注率」「CPL」のどれか。channel は6つのチャネルか「共通」「全体」
- registered（登録月）と month（実施月）は「4月」の形。status は「予定」「実施中」「完了」「中止」、review は「効果あり」「効果なし」「判断できない」か null
- 出力はJSONのコードブロック1つだけ。説明の文は書かない

{
  "format": "${EFFECT_FORMAT}",
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
  "actuals": [
    { "channel": "展示会", "month": "2027-04", "leads": リード数, "valid_leads": 有効リード数, "deals": 商談数, "wins": 受注数, "external_cost": null, "labor_cost": null }
  ],
  "action_log": [
    { "registered": "6月", "metric": "商談化率", "channel": "展示会", "issue": "課題", "action": "打ち手", "month": "7月", "basis": "根拠", "status": "実施中", "hours": 見込み時間, "review": null }
  ],
  "notes": ["変換で行ったこと"]
}`;

const n = (v: unknown): Num => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/[,，\s万円件%時間]/g, ""));
  return Number.isFinite(x) ? x : null;
};
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
/** 「2027-04」「4月」「4」から月（1〜12） */
const monthOf = (v: unknown): number | null => {
  const t = s(v);
  const m = /^\d{4}\D+(\d{1,2})/.exec(t) ?? /^(\d{1,2})\s*月?$/.exec(t);
  if (!m) return null;
  const x = Number(m[1]);
  return x >= 1 && x <= 12 ? x : null;
};
const monthLabel = (v: unknown) => {
  const m = monthOf(v);
  return m ? `${m}月` : s(v);
};

export function stateFromEffectAi(text: string): EffectState {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new ReadError("読み込めませんでした。AIが返した結果の { から } までを、そのまま貼りつけてください。");
  let j: any;
  try {
    j = JSON.parse(text.slice(a, b + 1));
  } catch {
    throw new ReadError("読み込めませんでした。JSONの形が崩れています。AIに「JSONのコードブロック1つだけで出し直して」と頼んでください。");
  }
  if (!j || j.format !== EFFECT_FORMAT)
    throw new ReadError(`読み込めませんでした。形式が違います（"format": "${EFFECT_FORMAT}" がありません）。上のプロンプトをコピーし直して、AIに変換させた結果を貼りつけてください。`);
  // 計画は予算案診断Kitと同じ読み方
  const plan = stateFromAi(JSON.stringify({ ...j, format: AI_FORMAT }));
  const st: EffectState = { ...plan, actual: CHANNELS.map(emptyAct), log: [] };
  const start = st.input.startMonth || 4;
  const unknown = new Set<string>();
  const acts: any[] = Array.isArray(j.actuals) ? j.actuals : [];
  for (const x of acts) {
    const i = CHANNELS.indexOf(s(x?.channel) as (typeof CHANNELS)[number]);
    if (i < 0) {
      unknown.add(s(x?.channel) || "（名前なし）");
      continue;
    }
    const mo = monthOf(x?.month);
    if (!mo) continue;
    const k = (mo - start + 12) % 12;
    const add = (key: ActKey, v: Num) => {
      if (v === null) return;
      const cur = st.actual[i][key][k];
      st.actual[i][key][k] = (cur ?? 0) + Math.max(0, v);
    };
    add("leads", n(x.leads));
    add("valid", n(x.valid_leads));
    add("deals", n(x.deals));
    add("wins", n(x.wins));
    add("ext", n(x.external_cost));
    add("labor", n(x.labor_cost));
  }
  if (unknown.size) st.notes.push(`実績のチャネル「${[...unknown].join("・")}」は6つのチャネルにないため読み込んでいません。`);
  const logs: any[] = Array.isArray(j.action_log) ? j.action_log : [];
  st.log = logs
    .filter((x) => s(x?.action))
    .slice(0, LOG_MAX)
    .map((x) => ({
      registered: monthLabel(x.registered),
      metric: s(x.metric),
      channel: s(x.channel),
      issue: s(x.issue),
      action: s(x.action),
      doMonth: monthLabel(x.month),
      basis: s(x.basis),
      status: s(x.status),
      hours: n(x.hours),
      review: s(x.review),
    }));
  return st;
}

// ---------- 記入例 ----------

/** 記入例：架空の会社のKPI管理表（基本モデルの安定期、10月まで入力）。src/data/kpi-analysis-sample.json */
export function sampleEffect(book: Book): EffectState {
  const st = stateFromEffectBook(book, "");
  st.source = "sample";
  st.fileName = undefined;
  st.notes = [];
  return st;
}

// ---------- 画面の入力 → 分析の Model ----------

const used = (st: EffectState, i: number) => {
  const c = st.input.channels[i];
  return c.leads > 0 || c.ext > 0 || c.labor > 0 || st.actual[i].leads.some((v) => v != null);
};

export function toModel(st: EffectState): Model {
  const inp = st.input;
  const months = monthLabels(inp.startMonth || 4);
  const r = calc(inp);
  const channels: Channel[] = [];
  CHANNELS.forEach((name, i) => {
    if (!used(st, i)) return;
    const a = st.actual[i];
    const pe = planMonthly(st, i, "ext");
    const pl = planMonthly(st, i, "labor");
    channels.push({
      name,
      plan: { leads: st.monthly[i].leads.map((v) => v || 0), valid: st.monthly[i].valid.map((v) => v || 0), cost: Array(12).fill(pe + pl) },
      act: {
        leads: [...a.leads],
        valid: [...a.valid],
        deals: [...a.deals],
        wins: [...a.wins],
        cost: Array.from({ length: 12 }, (_, m) => (a.ext[m] ?? pe) + (a.labor[m] ?? pl)),
      },
    });
  });
  let last = -1;
  for (let m = 0; m < 12; m++) if (channels.some((c) => c.act.leads[m] != null)) last = m;
  const log: LogItem[] = st.log
    .map((x, j) => ({ ...x, row: LOG_FIRST_ROW + j }))
    .filter((x) => x.action.trim())
    .map((x) => ({ row: x.row, registered: x.registered, metric: x.metric, channel: x.channel, issue: x.issue, action: x.action, doMonth: x.doMonth, basis: x.basis, status: x.status, hours: x.hours, review: x.review }));
  const warnings: string[] = [];
  const tv = r.total.valid;
  const td = r.total.deals;
  return {
    months,
    last,
    cplCap: r.allowableCpl ?? 0,
    leadTime: Number.isFinite(inp.leadTime) ? inp.leadTime : 0,
    planDealRate: tv && td >= 0 ? td / tv : null,
    planWinRate: td ? r.total.wins / td : null,
    channels,
    log,
    warnings,
  };
}

// ---------- 判定 ----------

export interface EffectDiagnosis {
  /** 判定できる（計画の前提と、1か月以上の実績がある） */
  ready: boolean;
  /** 判定に足りないもの */
  missing: string[];
  a: Analysis | null;
  items: BItem[];
  counts: Record<Status, number>;
  conclusion: string;
  /** 欄の色（name 属性 → 判定）。"a:3" は実績のタブのチャネル、"l:2" は施策ログの行 */
  marks: Record<string, "fix" | "check">;
}

const PLAN_HINT: Record<string, string> = {
  "チャネル（どれか1つはリード数を入れてください）": "計画のリード数",
  マーケ経由の売上目標: "売上目標",
};

export function diagnoseEffect(st: EffectState): EffectDiagnosis {
  const inp = st.input;
  const marks: EffectDiagnosis["marks"] = {};
  const counts: Record<Status, number> = { ok: 0, check: 0, fix: 0, na: 0 };
  const missing = validate(inp)
    .errors.filter((e) => !CHANNELS.includes(e as (typeof CHANNELS)[number]))
    .map((e) => PLAN_HINT[e] ?? e);
  const hasAct = st.actual.some((a) => a.leads.some((v) => v != null));
  if (!hasAct) missing.push("毎月の実績（どれかの月のリード数）");
  if (missing.length) return { ready: false, missing, a: null, items: [], counts, conclusion: "", marks };

  const items: BItem[] = [];
  const months = monthLabels(inp.startMonth || 4);

  // ---- 入力：実績 ----
  {
    const bad: string[] = [];
    let first = "";
    st.actual.forEach((a, i) =>
      a.leads.forEach((l, m) => {
        const pairs: [ActKey, ActKey][] = [["valid", "leads"]];
        for (const [hi, lo] of pairs) {
          const h = a[hi][m];
          const o = a[lo][m];
          if (h != null && (o == null || h > o)) {
            marks[`a${i}.${hi}.${m}`] = "fix";
            bad.push(`${CHANNELS[i]}の${months[m]}`);
            first ||= `a${i}.${hi}.${m}`;
          }
        }
        void l;
      }),
    );
    const title = "実績の件数の順";
    if (bad.length)
      items.push({
        group: "A",
        title,
        status: "fix",
        reason: `有効リード数がリード数より多い月があります（${bad.slice(0, 3).join("・")}${bad.length > 3 ? `ほか${bad.length - 3}件` : ""}）`,
        summary: "有効リード数がリード数より多い月がある",
        todo: "その月のリード数・有効リード数を確かめます",
        jump: first,
      });
    else items.push({ group: "A", title, status: "ok", reason: "有効リード数がリード数を超える月はありません" });
  }
  {
    // 実績の抜け：あとの月に実績があるのに、リード数が空欄の月
    const gaps: string[] = [];
    let first = "";
    st.actual.forEach((a, i) => {
      if (!used(st, i)) return;
      const lastM = a.leads.reduce((p, v, m) => (v != null ? m : p), -1);
      if (lastM < 0) return;
      for (let m = 0; m < lastM; m++)
        if (a.leads[m] == null) {
          marks[`a${i}.leads.${m}`] = "check";
          gaps.push(`${CHANNELS[i]}の${months[m]}`);
          first ||= `a${i}.leads.${m}`;
        }
    });
    if (gaps.length)
      items.push({
        group: "A",
        title: "実績の抜け",
        status: "check",
        reason: `リード数が空欄の月があります（${gaps.slice(0, 3).join("・")}${gaps.length > 3 ? `ほか${gaps.length - 3}件` : ""}）。空欄の月は計算に入りません`,
        summary: "リード数が空欄の月がある",
        todo: "その月が0件なら0を入れます",
        jump: first,
      });
  }

  // ---- 入力：施策ログ ----
  {
    const probs: string[] = [];
    let first = "";
    st.log.forEach((x, j) => {
      if (!x.action.trim() || x.status === "中止") return;
      const miss: string[] = [];
      if (!months.includes(x.doMonth)) {
        miss.push("実施月");
        marks[`l${j}.doMonth`] = "fix";
        first ||= `l${j}.doMonth`;
      }
      if (!(METRICS as string[]).includes(x.metric)) {
        miss.push("狙う指標");
        marks[`l${j}.metric`] = "fix";
        first ||= `l${j}.metric`;
      }
      if ((x.metric === "リード数" || x.metric === "有効リード率" || x.metric === "CPL") && !x.channel) {
        miss.push("チャネル");
        marks[`l${j}.channel`] = "fix";
        first ||= `l${j}.channel`;
      }
      if (miss.length) probs.push(`${j + 1}行目の${miss.join("・")}`);
    });
    const title = "施策ログの入力";
    if (probs.length)
      items.push({
        group: "B",
        title,
        status: "fix",
        reason: `施策ログに空欄があります（${probs.slice(0, 3).join("・")}${probs.length > 3 ? `ほか${probs.length - 3}件` : ""}）。打ち手の効果を計算できません`,
        summary: "施策ログに空欄がある",
        todo: "実施月・狙う指標・チャネルを選びます",
        jump: first,
      });
    else if (st.log.some((x) => x.action.trim())) items.push({ group: "B", title, status: "ok", reason: "打ち手には、実施月・狙う指標が入っています" });
  }

  // ---- 分析 ----
  const a = analyzeModel(toModel(st));
  const chIndex = (name: string) => CHANNELS.indexOf(name as (typeof CHANNELS)[number]);
  const hasLog = (key: string) => a.effects.some((f) => f.rowKey === key);
  for (const r of a.rows) {
    const p = r.total.prob;
    if (p == null || p < 0.7) continue;
    const status: Status = p >= 0.9 ? "fix" : "check";
    const i = chIndex(r.channel);
    if (i >= 0) marks[`a:${i}`] = marks[`a:${i}`] === "fix" ? "fix" : status;
    const streak = r.streak >= 3 ? `・${r.streak}か月続く` : "";
    items.push({
      group: "C",
      title: r.label,
      status,
      reason: `${r.label}：計画を下回っている確率 ${pct(p)}（期首から${streak}）${r.thin ? "。件数が少なく判断しにくい" : ""}`,
      summary: `${r.label}が計画を下回っている`,
      todo: hasLog(r.key) ? "打ち手が効いているかを、下の「C 打ち手の効果」で確かめます" : "施策ログに、この課題の打ち手を入れます",
      jump: hasLog(r.key) ? "log" : i >= 0 ? `a:${i}` : "log",
    });
  }
  if (!a.rows.some((r) => (r.total.prob ?? 0) >= 0.7))
    items.push({ group: "C", title: "計画を下回っている課題", status: "ok", reason: "期首から計画を下回っている確率が70%以上の課題はありません" });

  for (const f of a.effects) {
    const j = f.item.row - LOG_FIRST_ROW;
    if (f.state === "ok" && verdict(f.prob).tone === "bad") {
      marks[`l:${j}`] = "check";
      items.push({
        group: "D",
        title: f.item.action,
        status: "check",
        reason: `打ち手「${f.item.action}」のあと、${f.item.metric}が悪くなった可能性があります（良くなった確率 ${pct(f.prob)}）`,
        summary: "悪くなった可能性のある打ち手がある",
        todo: "続けるか、やめるかを決めて、施策ログの状態・振り返りを直します",
        jump: `l:${j}`,
      });
    } else if (f.mismatch) {
      marks[`l:${j}`] = "check";
      items.push({
        group: "D",
        title: f.item.action,
        status: "check",
        reason: `打ち手「${f.item.action}」は、振り返り（${f.item.review}）と数字が合いません（良くなった確率 ${pct(f.prob)}）`,
        summary: "振り返りと数字が合わない打ち手がある",
        todo: "数字を見て、振り返りを直すか、打ち手を見直します",
        jump: `l:${j}`,
      });
    } else if (f.state === "ok" && verdict(f.prob).tone === "good") {
      items.push({ group: "D", title: f.item.action, status: "ok", reason: `打ち手「${f.item.action}」は${verdict(f.prob).label}（良くなった確率 ${pct(f.prob)}）` });
    }
  }

  for (const it of items) counts[it.status]++;
  const sums = (s: Status) => [...new Set(items.filter((i) => i.status === s && i.summary).map((i) => i.summary!))];
  let conclusion: string;
  if (counts.fix) {
    conclusion = `直すところが${counts.fix}つあります（${sums("fix").join("／")}）。`;
    if (counts.check) conclusion += `ほかに確認が${counts.check}つあります。`;
  } else if (counts.check) conclusion = `直すところはありません。確認が${counts.check}つあります（${sums("check").join("／")}）。`;
  else conclusion = "直すところも、確認するところもありません。計画どおりに進んでいます。";
  return { ready: true, missing: [], a, items, counts, conclusion, marks };
}

export const GROUP_LABEL_EFFECT: Record<string, string> = { A: "毎月の実績", B: "施策ログ", C: "計画を下回っている課題", D: "打ち手の効果" };

export { CHANNELS, ReadError, fmt, monthLabels, clone };
