// src/lib/budgetFlow.ts
//
// 予算案診断Kitの「② 診断・修正」で使う、判定のカード（2026-11-01）。
// 判定（src/lib/budgetCheck.ts の diagnoseBudget）の「直す」「確認」を、1件ずつのカードにする。
// カードには必ず「何がNGか」「いまの数字」「OKになる条件」「直す欄」を出す（戻ってきても、NGの中身や数字を覚えていなくてよいように）。
// - key：判定の種類ごとに決まった名前。画面をまたいで「修正済み」「確認済み」を覚えるのに使う
// - fields：カードの中に置く入力欄。name は入力の画面（BudgetGrid）と同じ（ch2.leads・goal など）
// - 入力欄に数字を入れたときの状態の変え方（setField）も、入力の画面（app.ts の onInput）と同じにする
import { BASE_RATES, CHANNELS, diagnoseBudget, fmt, pct, syncMonthly, type BudgetDiagnosis, type BudgetState, type ChannelInput } from "@/lib/budgetCheck";
import { KITS, type PlanKit } from "@/lib/planKits";

export type IssueKey = "pre" | "need" | "order" | "monthly" | "rate" | "cpl" | "cac" | "roi" | "labor" | "noLead";

export interface IssueField {
  /** 入力欄の name（BudgetGrid と同じ） */
  name: string;
  label: string;
  unit: string;
}

export interface Issue {
  key: IssueKey;
  status: "fix" | "check";
  /** 何がNGか（短い見出し） */
  title: string;
  /** 詳しい理由 */
  reason: string;
  /** いまの数字 */
  now: string;
  /** OKになる条件 */
  target: string;
  /** 直し方のヒント */
  todo?: string;
  /** カードの中に置く入力欄 */
  fields: IssueField[];
  /** 「年間÷12に戻す」を置くチャネル（月別のカードだけ） */
  resets?: number[];
}

/** 判定の見出し（kpiCheck・budgetCheck の title の書き出し）→ カードの key */
const KEY_BY_TITLE: [string, IssueKey][] = [
  ["計画の数が", "need"],
  ["件数が", "order"],
  ["月別の計画", "monthly"],
  ["全体の率", "rate"],
  ["チャネルのCPL", "cpl"],
  ["全体のCAC", "cac"],
  ["ROI", "roi"],
  ["人件費が", "labor"],
  ["リードを生まない", "noLead"],
];

/** カードの並び（直す → 確認。同じ中では判定の順） */
export const ISSUE_ORDER: IssueKey[] = ["pre", "need", "order", "monthly", "rate", "cpl", "cac", "roi", "labor", "noLead"];

/** 画面の見出し（カードが「修正済み」になったあとも使う） */
export const ISSUE_TITLE: Record<IssueKey, string> = {
  pre: "判定に必要な数字が入っていません",
  need: "計画の数が、売上目標に足りません",
  order: "件数の順番がおかしいチャネルがあります",
  monthly: "月別の合計が、年間と合いません",
  rate: "全体の率が、目安から大きく外れています",
  cpl: "CPLが許容CPLを超えているチャネルがあります",
  cac: "全体のCAC・回収期間が上限を超えています",
  roi: "ROI（1年）がマイナスです",
  labor: "人件費が入っていません",
  noLead: "費用があるのにリード数が0のチャネルがあります",
};

const F_LABEL: Record<keyof ChannelInput, string> = { leads: "リード数", valid: "有効リード数", deals: "商談数", wins: "受注数", ext: "外部費用", labor: "人件費" };
const F_UNIT: Record<keyof ChannelInput, string> = { leads: "件", valid: "件", deals: "件", wins: "件", ext: "万円", labor: "万円" };
const chField = (i: number, k: keyof ChannelInput): IssueField => ({ name: `ch${i}.${k}`, label: `${CHANNELS[i]}の${F_LABEL[k]}`, unit: F_UNIT[k] });

/** 前提の入力欄（validate のエラーの言い方 → 入力欄） */
const PRE_FIELDS: [string, IssueField][] = [
  ["マーケ経由の売上目標", { name: "goal", label: "売上目標", unit: "万円" }],
  ["平均受注単価", { name: "price", label: "平均受注単価", unit: "万円" }],
  ["粗利率", { name: "gmPct", label: "粗利率", unit: "%" }],
  ["回収期間", { name: "paybackYears", label: "回収期間", unit: "年" }],
  ["リードタイム", { name: "leadTime", label: "リードタイム", unit: "か月" }],
  ["共通費", { name: "common", label: "共通費", unit: "万円" }],
];
const PRE_KEYS = ["goal", "price", "gmPct", "paybackYears", "leadTime"] as const;

const used = (c: ChannelInput) => c.leads > 0 || c.valid > 0 || c.deals > 0 || c.wins > 0 || c.ext > 0 || c.labor > 0;
const ceil = (x: number) => Math.ceil(x - 1e-9);

const STAGES = [
  { k: "wins", label: "受注数" },
  { k: "deals", label: "商談数" },
  { k: "valid", label: "有効リード数" },
  { k: "leads", label: "リード数" },
] as const;

/** 状態から、いまのカード（直す・確認だけ）を作る */
export function buildIssues(st: BudgetState, kit: PlanKit = KITS.budget, d: BudgetDiagnosis = diagnoseBudget(st, kit)): Issue[] {
  const inp = st.input;
  const usedIdx = inp.channels.map((c, i) => (used(c) ? i : -1)).filter((i) => i >= 0);

  // 前提が足りないと判定できない。足りない欄だけのカードを1枚出す
  if (!d.ready || !d.r) {
    const fields: IssueField[] = [];
    const names: string[] = [];
    for (const m of d.missing) {
      const hit = PRE_FIELDS.find(([e]) => e === m);
      if (hit) {
        fields.push(hit[1]);
        names.push(hit[1].label);
      } else if (m.startsWith("チャネル")) {
        names.push("どれかのチャネルのリード数");
        CHANNELS.forEach((_, i) => fields.push(chField(i, "leads")));
      }
    }
    return [
      {
        key: "pre",
        status: "fix",
        title: ISSUE_TITLE.pre,
        reason: "この数字がないと、目標に届くか・コストが上限以内かを判定できません。",
        now: `空欄：${names.join("・")}`,
        target: "すべて入れるとOK（入れると、ほかの判定が出ます）",
        fields,
      },
    ];
  }

  const r = d.r;
  const out: Issue[] = [];
  for (const it of d.items) {
    if (it.status !== "fix" && it.status !== "check") continue;
    const key = KEY_BY_TITLE.find(([p]) => it.title.startsWith(p))?.[1];
    if (!key) continue;
    const base = { key, status: it.status, title: ISSUE_TITLE[key], reason: it.reason, todo: it.todo };

    if (key === "need") {
      // 受注数（売上目標÷平均受注単価）から計画の率でさかのぼるので、いちばん下の足りない段階を直せばそろう
      const s = STAGES.find((x) => r.short[x.k]) ?? STAGES[0];
      const gap = r.need[s.k] - r.plan[s.k];
      out.push({
        ...base,
        now: `${s.label}の計画 ${fmt(r.plan[s.k])}件（必要 ${fmt(r.need[s.k])}件）`,
        target: `${s.label}の合計が ${fmt(r.need[s.k])}件以上でOK（あと${fmt(gap)}件）。売上目標を下げてもそろいます`,
        fields: [...usedIdx.map((i) => chField(i, s.k)), { name: "goal", label: "売上目標", unit: "万円" }],
      });
    } else if (key === "order") {
      const bad = usedIdx.filter((i) => {
        const c = inp.channels[i];
        return !(c.leads >= c.valid && c.valid >= c.deals && c.deals >= c.wins);
      });
      const nows: string[] = [];
      const targets: string[] = [];
      const fields: IssueField[] = [];
      for (const i of bad) {
        const c = inp.channels[i];
        const pairs: [keyof ChannelInput, keyof ChannelInput][] = [
          ["leads", "valid"],
          ["valid", "deals"],
          ["deals", "wins"],
        ];
        for (const [up, low] of pairs) {
          if (c[low] > c[up]) {
            nows.push(`${CHANNELS[i]}：${F_LABEL[low]} ${fmt(c[low])} ＞ ${F_LABEL[up]} ${fmt(c[up])}`);
            targets.push(`${CHANNELS[i]}の${F_LABEL[low]}を${fmt(c[up])}以下にするとOK（または${F_LABEL[up]}を${fmt(c[low])}以上）`);
          }
        }
        (["leads", "valid", "deals", "wins"] as const).forEach((k) => fields.push(chField(i, k)));
      }
      out.push({ ...base, now: nows.join("／"), target: targets.join("／"), fields });
    } else if (key === "monthly") {
      const off = d.monthlyOff.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
      const nows: string[] = [];
      for (const i of off) {
        for (const k of ["leads", "valid"] as const) {
          const m = st.monthly[i][k].reduce((a, b) => a + b, 0);
          const y = inp.channels[i][k];
          if (Math.abs(m - y) > 0.5) nows.push(`${CHANNELS[i]}の${F_LABEL[k]}：月別の合計 ${fmt(m)}・年間 ${fmt(y)}`);
        }
      }
      out.push({
        ...base,
        now: nows.join("／"),
        target: "月別の合計が年間と同じになればOK。「年間÷12に戻す」でもそろいます",
        fields: [],
        resets: off,
      });
    } else if (key === "rate") {
      const t = r.total;
      const rows = [
        ["有効リード率", t.validRate, BASE_RATES.valid],
        ["商談化率", t.dealRate, BASE_RATES.deal],
        ["受注率", t.winRate, BASE_RATES.win],
      ] as const;
      out.push({
        ...base,
        now: rows.map(([l, v]) => `${l} ${pct(v)}`).join("・"),
        target: `目安の半分〜2倍ならOK（${rows.map(([l, , b]) => `${l} ${pct(b / 2)}〜${pct(Math.min(1, b * 2))}`).join("・")}）。実績どおりの率なら、このまま進めてかまいません`,
        // 率はチャネル全部の件数で決まるので、カードには欄を置かず、表全体で直す
        fields: [],
      });
    } else if (key === "cpl") {
      const allow = r.allowableCpl ?? 0;
      const over = r.channels.map((c, i) => (c.cplOver ? i : -1)).filter((i) => i >= 0);
      const totLeads = r.total.leads;
      const K = r.cacLimit * r.total.wins;
      out.push({
        ...base,
        now: over.map((i) => `${CHANNELS[i]}のCPL ${fmt(r.channels[i].cpl, 1)}万円`).join("・") + `（許容CPL ${fmt(allow, 1)}万円）`,
        target:
          over
            .map((i) => {
              const c = inp.channels[i];
              const cost = c.ext + c.labor;
              const maxExt = allow * c.leads - c.labor;
              const parts: string[] = [];
              if (maxExt > 0) parts.push(`外部費用を${fmt(Math.floor(maxExt * 10) / 10, 1)}万円以下`);
              // リード数を増やすと許容CPLも下がるので、ほかのチャネルが今のままのときの件数を出す
              const other = totLeads - c.leads;
              if (K > cost) parts.push(`リード数を${fmt(ceil((cost * other) / (K - cost)))}件以上`);
              return `${CHANNELS[i]}は${parts.length ? parts.join("、または") : "費用を下げる"}`;
            })
            .join("／") + "でOK（ほかの数字が今のままのとき）",
        fields: over.flatMap((i) => [chField(i, "leads"), chField(i, "ext"), chField(i, "labor")]),
      });
    } else if (key === "cac") {
      const t = r.total;
      const cost = t.ext + t.labor;
      const maxCost = r.cacLimit * t.wins;
      const needWins = r.cacLimit ? ceil(cost / r.cacLimit) : NaN;
      out.push({
        ...base,
        now: `CAC ${fmt(t.cac)}万円・回収期間 ${fmt(t.paybackMonths, 1)}か月（上限 ${fmt(r.cacLimit)}万円・${fmt(inp.paybackYears * 12, 1)}か月）`,
        target: `外部費用＋人件費の合計を${fmt(maxCost)}万円以下に（あと${fmt(cost - maxCost)}万円）、または受注数を${fmt(needWins)}件以上にするとOK`,
        fields: usedIdx.map((i) => chField(i, "ext")),
      });
    } else if (key === "roi") {
      const gp = r.total.sales * (inp.gmPct / 100);
      out.push({
        ...base,
        now: `ROI（1年）${pct(r.roi)}：受注金額×粗利率 ${fmt(gp)}万円・コスト合計 ${fmt(r.costTotal)}万円`,
        target: `受注金額×粗利率がコスト合計を上回るとOK（あと${fmt(r.costTotal - gp)}万円）。回収期間が上限以内なら、このまま進めてかまいません`,
        fields: [],
      });
    } else if (key === "labor") {
      const totalLabor = inp.channels.reduce((s, c) => s + c.labor, 0);
      const idx = totalLabor > 0 ? usedIdx.filter((i) => inp.channels[i].ext > 0 && !(inp.channels[i].labor > 0)) : usedIdx;
      out.push({
        ...base,
        now: `人件費 0万円：${idx.map((i) => CHANNELS[i]).join("・")}`,
        target: "そのチャネルの人件費（年額）を入れるとOK。本当にかけないなら、このまま進めてかまいません",
        fields: idx.map((i) => chField(i, "labor")),
      });
    } else if (key === "noLead") {
      const bad = usedIdx.filter((i) => inp.channels[i].ext + inp.channels[i].labor > 0 && !(inp.channels[i].leads > 0));
      out.push({
        ...base,
        now: bad.map((i) => `${CHANNELS[i]}：費用 ${fmt(inp.channels[i].ext + inp.channels[i].labor)}万円・リード数 0件`).join("／"),
        target: "リード数を入れるとOK。リードを生まない費用なら、使うチャネルの外部費用か共通費に移します",
        fields: bad.flatMap((i) => [chField(i, "leads"), chField(i, "ext"), { name: "common", label: "共通費", unit: "万円" }]),
      });
    }
  }
  // 同じ欄を2回出さない
  for (const is of out) is.fields = is.fields.filter((f, i, a) => a.findIndex((x) => x.name === f.name) === i);
  return out.sort((a, b) => (a.status === b.status ? ISSUE_ORDER.indexOf(a.key) - ISSUE_ORDER.indexOf(b.key) : a.status === "fix" ? -1 : 1));
}

// ---------- 入力欄の値 ----------

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** 入力欄の今の値（入力の画面と同じ見せ方：チャネル・共通費は0を空欄にする） */
export function getField(st: BudgetState, name: string): string {
  const inp = st.input;
  const m = /^ch(\d)\.(\w+)$/.exec(name);
  const show = (x: number) => (Number.isFinite(x) ? String(x) : "");
  if (m) {
    const v = inp.channels[Number(m[1])][m[2] as keyof ChannelInput];
    return Number.isFinite(v) && v !== 0 ? String(v) : "";
  }
  if (name === "common") return Number.isFinite(inp.common) && inp.common !== 0 ? String(inp.common) : "";
  if ((PRE_KEYS as readonly string[]).includes(name)) return show(inp[name as (typeof PRE_KEYS)[number]]);
  return "";
}

/** 入力欄に数字を入れたときの状態の変え方（入力の画面 app.ts の onInput と同じ） */
export function setField(st: BudgetState, name: string, raw: string) {
  const inp = st.input;
  const v = num(raw);
  const m = /^ch(\d)\.(\w+)$/.exec(name);
  if (m) {
    inp.channels[Number(m[1])][m[2] as keyof ChannelInput] = Number.isFinite(v) ? v : 0;
    if (m[2] === "leads" || m[2] === "valid") syncMonthly(st);
  } else if (name === "common") inp.common = Number.isFinite(v) ? v : 0;
  else if ((PRE_KEYS as readonly string[]).includes(name)) (inp as any)[name] = v;
}

// ---------- 画面をまたいで覚えること ----------

export interface FlowMemo {
  /** これまでに出たカード（修正済みを出すため） */
  seen: IssueKey[];
  /** 「このまま進める」を押した確認のカード */
  ack: IssueKey[];
}

export const flowKey = (kit: PlanKit = KITS.budget) => `${kit.store}-flow`;

export function readMemo(kit: PlanKit = KITS.budget): FlowMemo {
  try {
    const raw = JSON.parse(localStorage.getItem(flowKey(kit)) || "null");
    if (raw && Array.isArray(raw.seen) && Array.isArray(raw.ack)) return { seen: raw.seen, ack: raw.ack };
  } catch {
    /* 読めなければ空から */
  }
  return { seen: [], ack: [] };
}

export function writeMemo(memo: FlowMemo, kit: PlanKit = KITS.budget) {
  try {
    localStorage.setItem(flowKey(kit), JSON.stringify(memo));
  } catch {
    /* 保存できなくても動く */
  }
}

export function clearMemo(kit: PlanKit = KITS.budget) {
  try {
    localStorage.removeItem(flowKey(kit));
  } catch {
    /* なにもしない */
  }
}

/** カードの状態：未対応／確認済み（このまま進める）／修正済み（判定から消えた） */
export type IssueState = "open" | "ack" | "done";

export function issueState(key: IssueKey, current: Issue[], memo: FlowMemo): IssueState {
  const cur = current.find((i) => i.key === key);
  if (!cur) return "done";
  if (cur.status === "check" && memo.ack.includes(key)) return "ack";
  return "open";
}
