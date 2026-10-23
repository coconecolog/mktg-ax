// src/scripts/kpi-check/app.ts
//
// KPI運用チェッカーの画面（2026-10-23 改修：ステップごとのページ）。
// - 入口：/tools/kpi-check（#kc-hub）
// - ① 初回：/tools/kpi-check/setup/1〜6（3は施策ごと /setup/3/<施策>、/setup/3/common）
// - ② 毎月：/tools/kpi-check/monthly/1〜5（2は施策ごと /monthly/2/<施策>）
// 各ページは <div id="kc-app" data-flow data-step data-sub> を置くだけで、中身はここで描く。
// 入力は localStorage（mktgax-kpi-check-v1）に入れ、ページを移っても残す。サンプルは sessionStorage に別に置く。
// 判定・PDFには resolveData()（空欄を一般的な値で埋めたもの）を使う。
import {
  COMMON_KPIS,
  GENERAL,
  LINKS,
  MEASURES,
  MEASURE_IDS,
  PERIODS,
  computeMonth,
  costOf,
  cplCapOf,
  emptyData,
  exampleData,
  firstJudgments,
  fmtCount,
  fmtMan1,
  fmtNum,
  formatValue,
  hasParts,
  isMonthEntered,
  isMeasureEntered,
  leadKpi,
  limitsOf,
  manageDayLabel,
  monthLabel,
  monthLabelLong,
  normalizeData,
  periodLabel,
  periodMonths,
  rateModeCountFields,
  resolveData,
  resolveMeasure,
  resolvePlan,
  resolveTree,
  selectedMeasures,
  switchMeasureMode,
  switchTreeMode,
  type FirstItem,
  type KcData,
  type MeasureId,
  type MonthReport,
} from "@/lib/kpiCheck";
import { esc, exitHtml, makePdf, monthTableHtml, readPdfData, srcText } from "./pdf";

const BASE = "/tools/kpi-check";
const STORAGE_KEY = "mktgax-kpi-check-v1";
const REG_KEY = "mktgax-kpi-check-registered";
const LAST_KEY = "mktgax-kpi-check-last";
const SAMPLE_FLAG = "mktgax-kpi-check-sample";
const SAMPLE_KEY = "mktgax-kpi-check-sample-data";

type Flow = "setup" | "monthly";
const STEPS: Record<Flow, { n: number; label: string }[]> = {
  setup: [
    { n: 1, label: "KPIツリー" },
    { n: 2, label: "施策と期間" },
    { n: 3, label: "施策のKPI" },
    { n: 4, label: "費用と撤退（任意）" },
    { n: 5, label: "判定" },
    { n: 6, label: "PDF" },
  ],
  monthly: [
    { n: 1, label: "準備" },
    { n: 2, label: "施策ごとの実績" },
    { n: 3, label: "全体の数字" },
    { n: 4, label: "判定" },
    { n: 5, label: "PDF" },
  ],
};
const FLOW_NAME: Record<Flow, string> = { setup: "① KPIの妥当性をチェック", monthly: "② 毎月の実績を判定" };

// ---------- 保存 ----------
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* noop */
    }
  },
};
const ss = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      /* noop */
    }
  },
};
const isSample = () => ss.get(SAMPLE_FLAG) === "1";
function loadRaw(): KcData {
  const src = isSample() ? ss.get(SAMPLE_KEY) : ls.get(STORAGE_KEY);
  if (src) {
    try {
      return normalizeData(JSON.parse(src));
    } catch {
      /* noop */
    }
  }
  return isSample() ? exampleData() : emptyData();
}
function save() {
  const json = JSON.stringify(data);
  if (isSample()) ss.set(SAMPLE_KEY, json);
  else ls.set(STORAGE_KEY, json);
}
const getRegistered = () => ls.get(REG_KEY);
const setRegistered = (email: string | null) => ls.set(REG_KEY, email);
function startSample() {
  ss.set(SAMPLE_FLAG, "1");
  ss.set(SAMPLE_KEY, JSON.stringify(exampleData()));
}
function endSample() {
  ss.set(SAMPLE_FLAG, null);
  ss.set(SAMPLE_KEY, null);
}

// URLに ?sample=1 があればサンプルを始める
if (new URLSearchParams(location.search).get("sample") === "1") {
  startSample();
  history.replaceState(null, "", location.pathname);
}

let data: KcData = loadRaw();

// ---------- 小物 ----------
const url = (flow: Flow, step: number, sub?: string) => `${BASE}/${flow}/${step}${sub ? `/${sub}` : ""}`;
const sel = () => selectedMeasures(data.plan);
const numStr = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
function parseNum(s: string): { v: number | null; bad: boolean } {
  const t = s.replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，\s]/g, "").replace(/ー/g, "-");
  if (t === "") return { v: null, bad: false };
  const n = Number(t);
  return isFinite(n) && n >= 0 ? { v: n, bad: false } : { v: null, bad: true };
}
function getAt(path: string): any {
  return path.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), data as any);
}
function setAt(path: string, v: any) {
  const ks = path.split(".");
  let o: any = data;
  for (let n = 0; n < ks.length - 1; n++) {
    const k = ks[n];
    if (Array.isArray(o[k]) && (ks[n + 1] ?? "").match(/^\d+$/)) while (o[k].length < 12) o[k].push(null);
    o = o[k];
  }
  o[ks[ks.length - 1]] = v;
}
/** 入力欄。ph は薄い文字（空欄のときに使う値） */
function inp(path: string, unit: string, ph: string, opts: { label?: string; cls?: string } = {}) {
  const v = getAt(path);
  return `<div class="kc-in${opts.cls ? ` ${opts.cls}` : ""}"><input data-p="${path}" inputmode="decimal" value="${esc(numStr(v))}" placeholder="${esc(ph)}"${opts.label ? ` aria-label="${esc(opts.label)}"` : ""} />${unit ? `<span>${unit}</span>` : ""}</div>`;
}
function txt(path: string, ph: string, max = 40) {
  return `<div class="kc-in"><input data-p="${path}" data-t="text" maxlength="${max}" value="${esc(getAt(path) || "")}" placeholder="${esc(ph)}" /></div>`;
}
const calc = (v: string, unit: string) => `<div class="kc-calc"><b>${v}</b><span>${unit}</span></div>`;
const rc = (label: string, v: string) => `<span class="kc-rc">${label ? `${esc(label)} ` : ""}${v} <em>計算</em></span>`;
const seg = (act: string, cur: string, opts: [string, string][], extra = "") =>
  `<div class="kc-seg" role="group">${opts.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${v}"${extra} aria-pressed="${v === cur}">${l}</button>`).join("")}</div>`;
const pct1 = (v: number | null) => (v === null ? "—" : fmtNum(v, 1));
const legend = (toggle: string) =>
  `<div class="kc-legend"><div class="kc-lgs"><span class="kc-lg"><i class="kc-sw-in"></i>入力する</span><span class="kc-lg"><i class="kc-sw-calc"></i>自動で計算</span><span class="kc-lg"><span class="kc-sw-ph">250</span>＝一般的な値（空欄ならこの値）</span></div>${toggle}</div>`;
const monthOpts = (selIdx: number, from = 0) =>
  Array.from({ length: 12 - from }, (_, k) => k + from)
    .map((i) => `<option value="${i}"${i === selIdx ? " selected" : ""}>${esc(monthLabelLong(data.plan, i))}</option>`)
    .join("");

// ---------- ページの部品 ----------
interface View {
  html: string;
  wide?: boolean;
  back?: { href: string; label: string };
  next?: { href: string; label: string; disabled?: boolean; reason?: string };
  redirect?: string;
}

function sampleBanner(): string {
  if (!isSample()) return "";
  return `<div class="kc-sample"><span><b>サンプル（架空の会社）を表示しています。</b>あなたの入力とは別に保存しています。</span><div><a class="kc-link" href="${url("setup", 5)}">初回の判定</a><a class="kc-link" href="${url("monthly", 4)}">毎月の判定</a><button type="button" class="kc-link" data-act="sample-end">サンプルを終える</button></div></div>`;
}

function progress(flow: Flow, step: number): string {
  const steps = STEPS[flow];
  const cur = steps.find((s) => s.n === step)!;
  const anyCost = sel().some((id) => costOf(data.plan.measures[id]) !== null);
  const items = steps
    .map((s) => {
      let label = s.label;
      if (flow === "setup" && s.n === 4 && step > 4 && !anyCost) label = "費用と撤退（飛ばした）";
      if (s.n === step) return `<span class="kc-st cur" aria-current="step"><i></i>${esc(label)}</span>`;
      if (s.n < step) return `<a class="kc-st" href="${stepHref(flow, s.n)}"><i></i>${esc(label)}</a>`;
      return `<span class="kc-st"><i></i>${esc(label)}</span>`;
    })
    .join("");
  return `<div class="kc-prog"><div class="kc-prog-top"><b><em>STEP ${step}／${steps.length}</em>${esc(cur.label)}</b><span>${FLOW_NAME[flow]}</span></div><div class="kc-steps" style="grid-template-columns:repeat(${steps.length},minmax(0,1fr))">${items}</div></div>`;
}
function stepHref(flow: Flow, n: number): string {
  if (flow === "setup" && n === 3) return sel().length ? url("setup", 3, sel()[0]) : url("setup", 2);
  if (flow === "monthly" && n === 2) {
    const first = sel()[0];
    return first ? url("monthly", 2, first) : url("monthly", 1);
  }
  return url(flow, n);
}
function navHtml(v: View): string {
  const back = v.back ? `<a class="kc-back" href="${v.back.href}">← ${esc(v.back.label)}</a>` : "<span></span>";
  const next = v.next
    ? `<a class="kc-btn" href="${v.next.href}"${v.next.disabled ? ' aria-disabled="true" tabindex="-1"' : ""}><span>${esc(v.next.label)}</span><span aria-hidden="true">→</span></a>`
    : "";
  const msg = v.next?.disabled && v.next.reason ? `<p class="kc-navmsg">${esc(v.next.reason)}</p>` : "";
  return `<div class="kc-nav">${back}${next}${msg}</div>`;
}

// ========== ① 初回 ==========
function setup1(): View {
  const p = data.plan;
  const t = resolveTree(p);
  const count = p.treeMode === "count";
  const toggle = `<div class="kc-tg">入れ方${seg("tree-mode", p.treeMode, [["count", "件数"], ["rate", "率"]])}</div>`;
  const nodeIn = (key: "wins" | "deals" | "leads", label: string, v: number) =>
    `<div class="kc-nd in"><p class="lb">${label}</p>${inp(`plan.${key}`, "件", fmtNum(v), { label })}</div>`;
  const nodeCalc = (label: string, v: number) => `<div class="kc-nd c"><p class="lb">${label}</p><p class="num">${fmtNum(v)}<small>件</small></p></div>`;
  const linkCalc = (label: string, v: string) => `<div class="kc-lk"><div class="op">${label} ${rc("", v)}</div></div>`;
  const linkIn = (label: string, key: "price" | "winRate" | "dealRate", unit: string, ph: string) =>
    `<div class="kc-lk"><div class="op">÷ ${label} ${inp(`plan.${key}`, unit, ph, { label })}</div></div>`;
  const tree = count
    ? [
        linkCalc("平均単価", `${fmtNum(t.price)}万円`),
        nodeIn("wins", "受注数", t.wins),
        linkCalc("受注率", `${pct1(t.winRate)}%`),
        nodeIn("deals", "商談数", t.deals),
        linkCalc("商談化率", `${pct1(t.dealRate)}%`),
        nodeIn("leads", "リード数", t.leads),
      ]
    : [
        linkIn("平均単価", "price", "万円", fmtNum(GENERAL.price)),
        nodeCalc("受注数", t.wins),
        linkIn("受注率", "winRate", "%", fmtNum(GENERAL.winRate)),
        nodeCalc("商談数", t.deals),
        linkIn("商談化率", "dealRate", "%", fmtNum(GENERAL.dealRate)),
        nodeCalc("リード数", t.leads),
      ];
  const ids = sel();
  const rp = ids.length ? resolvePlan(p) : null;
  const leaves = ids.length
    ? ids.map((id) => `<div class="kc-bk">${esc(TINY[id])}<b>${fmtNum(rp!.measures[id].kpis[leadKpi(id).key].target)}</b></div>`)
    : ["施策A", "施策B", "施策C"].map((x) => `<div class="kc-bk ph">${x}</div>`);
  const html = `
    <p class="kc-h">売上目標から、必要なリード数を確かめます</p>
    <p class="kc-lead">黒い枠の欄だけ入れてください。灰色の欄はツールが計算します。薄い文字は一般的な値で、空欄のまま進むとその値で計算します。率がわかるときは、「入れ方」を「率」に切りかえてください。</p>
    ${legend(toggle)}
    <div class="kc-vt">
      <div class="kc-nd top"><p class="lb">売上目標（マーケ経由・期間の合計）</p>${inp("plan.sales", "万円", fmtNum(GENERAL.sales), { label: "売上目標" })}</div>
      ${tree.join("")}
      <div class="kc-br"><div class="hl" style="left:${100 / (leaves.length * 2)}%;right:${100 / (leaves.length * 2)}%"></div>${leaves.join("")}</div>
      <p class="kc-hint" style="text-align:center">${ids.length ? "施策ごとのリード数（STEP3で入れます）" : "施策ごとの内訳は、STEP2で施策を選び、STEP3で入れます"}</p>
    </div>`;
  return { html, back: { href: BASE, label: "ツールの入口へ" }, next: { href: url("setup", 2), label: "次へ：施策と期間" } };
}

const MEASURE_DESC: Record<MeasureId, string> = {
  expo: "業界の展示会に出展し、ブースで名刺を集める",
  ads: "検索広告などから、フォームで問い合わせ・資料請求を受ける",
  site: "検索から来た人の問い合わせ・資料請求",
  dl: "ホワイトペーパーをダウンロードしてもらう",
  mail: "配信リストに送り、問い合わせ・申込を受ける",
  seminar: "セミナー・ウェビナーを開いて申込を集める",
};
function setup2(): View {
  const p = data.plan;
  const t = resolveTree(p);
  const nowY = new Date().getFullYear();
  const starts: string[] = [];
  for (let y = nowY - 2; y <= nowY + 1; y++)
    for (let m = 1; m <= 12; m++) starts.push(`<option value="${y}-${m}"${y === p.startYear && m === p.startMonth ? " selected" : ""}>${y}年${m}月</option>`);
  if (p.startYear < nowY - 2 || p.startYear > nowY + 1) starts.unshift(`<option value="${p.startYear}-${p.startMonth}" selected>${p.startYear}年${p.startMonth}月</option>`);
  const cards = MEASURE_IDS.map((id) => {
    const def = MEASURES[id];
    const on = p.measures[id].on;
    const lk = leadKpi(id);
    const kpis = def.kpis.filter((k) => k.kind !== "cpl").map((k) => k.label.replace(/（参考値）/, "")).join(" → ");
    return `<button type="button" class="kc-mc" data-act="toggle-measure" data-id="${id}" aria-pressed="${on}"><i class="cb"></i><b>${esc(def.name)}</b><span class="d">${esc(MEASURE_DESC[id])}</span><span class="k">リードの数え方：<em>${esc(id === "ads" ? "フォーム送信数" : lk.label)}</em>${on ? `<br />見るKPI：${esc(kpis)}` : ""}</span></button>`;
  }).join("");
  const ids = sel();
  const html = `
    <p class="kc-h">この目標の期間と、リードを取る施策を選んでください</p>
    <div class="kc-row sb" style="margin-top:16px">
      <div class="kc-row">
        <div class="kc-fld"><span class="kc-lb">期間</span>${seg("period", p.period, PERIODS.map((x) => [x.key, x.key === "year" ? "1年" : x.label] as [string, string]))}</div>
        <div class="kc-fld"><label for="kc-start">期首</label><div class="kc-in" style="width:170px"><select id="kc-start" data-t="start">${starts.join("")}</select></div></div>
      </div>
      <div class="kc-fld"><label for="kc-cycle">商談から受注までの平均期間</label><div style="width:210px">${inp("plan.cycle", "か月", fmtNum(GENERAL.cycle))}</div></div>
    </div>
    <p class="kc-hint">STEP1の売上目標${fmtNum(t.sales)}万円・リード${fmtNum(t.leads)}件は、この期間（${esc(periodLabel(p.period))}、期首 ${p.startYear}年${p.startMonth}月）の目標として扱います</p>
    <p class="kc-sec">施策（いくつでも）</p>
    <div class="kc-mg">${cards}</div>
    <p class="kc-hint">紹介・営業の開拓はマーケ経由ではないため、ここには入りません</p>`;
  return {
    html,
    back: { href: url("setup", 1), label: "戻る" },
    next: { href: ids.length ? url("setup", 3, ids[0]) : "#", label: `次へ：施策のKPI${ids.length ? `（${ids.length}つ）` : ""}`, disabled: !ids.length, reason: "施策を1つ以上選んでください" },
  };
}

/** ツリーの枝に書く短い名前 */
const TINY: Record<MeasureId, string> = { expo: "展示会", ads: "Web広告", site: "自社サイト", dl: "資料DL", mail: "メール", seminar: "セミナー" };
const MEASURE_NOTE: Record<MeasureId, string> = {
  expo: "名刺の獲得数（リード数）と狙う相手の割合が、この施策の成果です。立ち寄り数は、名刺が足りないときに原因を探すための数字です。",
  ads: "リード数と狙う相手の割合が、この施策の成果です。表示回数とクリック数は、リードが足りないときに原因を探すための数字です。",
  site: "リード数（問い合わせ・資料請求）と狙う相手の割合が、この施策の成果です。自然検索の流入数は、リードが足りないときに原因を探すための数字です。",
  dl: "ダウンロード数と、その後の問い合わせ・相談の数が成果です。閲覧数は、ダウンロードが足りないときに原因を探すための数字です。",
  mail: "問い合わせ・申込の数が成果です。開封率は実際より高く出るため参考値にし、判定はクリック率で行います。",
  seminar: "申込数と個別相談の希望数が成果です。参加率・アンケートの回答率は、相談が少ないときに原因を探すための数字です。",
};

function subChips(flow: Flow, step: number, cur: string, withCommon: boolean): string {
  const ids = sel();
  const list: [string, string][] = ids.map((id) => [id, MEASURES[id].short]);
  if (withCommon) list.push(["common", "リードの後"]);
  const ci = list.findIndex(([k]) => k === cur);
  return `<div class="kc-subp">${list
    .map(([k, l], i) => (k === cur ? `<span class="cur">${esc(l)}</span>` : `<a href="${url(flow, step, k)}"${i < ci ? ' class="done"' : ""}>${i < ci ? "✓ " : ""}${esc(l)}</a>`))
    .join("")}</div>`;
}

function allocBar(cur: MeasureId | null): string {
  const rp = resolvePlan(data.plan);
  const total = rp.leads || 0;
  const ids = sel();
  const parts = ids.map((id) => ({ id, v: rp.measures[id].kpis[leadKpi(id).key].target || 0 }));
  const sum = parts.reduce((s, x) => s + x.v, 0);
  const base = Math.max(total, sum) || 1;
  const segs = parts
    .map((x) => {
      const w = (x.v / base) * 100;
      const pct = total ? Math.round((x.v / total) * 100) : 0;
      const label = w >= 9 ? `${esc(MEASURES[x.id].short)} ${fmtNum(x.v)}件<small>${pct}%</small>` : "";
      return `<i class="${x.id === cur ? "cur" : "oth"}" style="width:${w}%" title="${esc(MEASURES[x.id].short)} ${fmtNum(x.v)}件（${pct}%）">${label}</i>`;
    })
    .join("");
  const rest = total - sum;
  const restSeg =
    rest > 0
      ? `<i class="rest" style="flex:1">${(rest / base) * 100 >= 9 ? `残り ${fmtNum(rest)}件<small>${Math.round((rest / total) * 100)}%</small>` : ""}</i>`
      : rest < 0
        ? `<i class="over" style="flex:1"></i>`
        : "";
  const foot = rest < 0 ? `全体より${fmtNum(-rest)}件多くなっています` : parts.map((x) => `${MEASURES[x.id].short} ${fmtNum(x.v)}件`).join("＋") + (rest > 0 ? `　残り ${fmtNum(rest)}件` : "");
  return `<div class="kc-alloc"><div class="hd"><b>全体のリード数 ${fmtNum(total)}件</b><span>施策の合計 ${fmtNum(sum)}件</span></div><div class="kc-bar">${segs}${restSeg}</div><p class="ft">${esc(foot)}</p></div>`;
}

function setup3(sub: string): View {
  const ids = sel();
  if (!ids.length) return { html: "", redirect: url("setup", 2) };
  if (sub === "common") return setup3common();
  const id = sub as MeasureId;
  if (!MEASURES[id] || !data.plan.measures[id].on) return { html: "", redirect: url("setup", 3, ids[0]) };
  const p = data.plan;
  const def = MEASURES[id];
  const mp = p.measures[id];
  const t = resolveTree(p);
  const r = resolveMeasure(p, id, t.leads, ids.length);
  const base = `plan.measures.${id}`;
  const count = mp.mode === "count";
  const inputs = count ? def.fields.map((f) => f.key) : rateModeCountFields(id);
  const leadField = leadKpi(id).num!;
  const flabel = (k: string) => def.fields.find((f) => f.key === k)!.label.replace(/（リード数）$/, "");
  const fieldUnit = (k: string) => def.fields.find((f) => f.key === k)!.unit;
  const rows: string[] = [];
  def.fields.forEach((f, i) => {
    if (i > 0) {
      for (const l of LINKS[id].filter((x) => x.b === f.key)) {
        const prev = def.fields[i - 1].key;
        const from = l.a !== prev ? `${flabel(l.a)}の ` : "";
        const kpiDef = l.kpi ? def.kpis.find((k) => k.key === l.kpi) : null;
        let body: string;
        if (l.perMonth) body = rc(`${l.label}`, `${fmtNum(r.rates[l.b] === null ? null : r.rates[l.b]!, 1)}回`);
        else if (!count && kpiDef) body = `${esc(from)}× ${esc(l.label)} ${inp(`${base}.rates.${l.kpi}`, "%", fmtNum(l.r * 100, 1), { label: l.label })}`;
        else body = rc(`${from}${l.label}`, `${r.rates[l.b] === null ? "—" : fmtNum(r.rates[l.b]! * 100, 1)}%`);
        rows.push(`<div class="kc-fl${l.a !== prev ? " br" : ""}">${body}</div>`);
      }
    }
    const isIn = inputs.includes(f.key);
    const v = r.counts[f.key];
    const name = `${esc(flabel(f.key))}${f.key === leadField ? "<small>この施策で取る分（リード数）</small>" : ""}`;
    const box = isIn ? inp(`${base}.counts.${f.key}`, fieldUnit(f.key), fmtNum(v), { label: flabel(f.key) }) : calc(fmtNum(v), fieldUnit(f.key));
    rows.push(`<div class="kc-fs"><span class="nm">${name}</span>${box}</div>`);
  });

  // 今は取れていない数字
  const unmeas = def.kpis
    .filter((k) => k.kind !== "cpl")
    .map((k) => `<button type="button" class="kc-chip" data-act="unmeasured" data-path="${base}.kpis.${k.key}.measurable" aria-pressed="${!mp.kpis[k.key].measurable}">${esc(k.label)}</button>`)
    .join("");
  // その他のKPI
  const others = mp.others
    .map(
      (o, j) =>
        `<div class="kc-oth"><div class="kc-in"><input data-p="${base}.others.${j}.name" data-t="text" maxlength="30" value="${esc(o.name)}" placeholder="KPIの名前" aria-label="その他のKPIの名前" /></div>${inp(`${base}.others.${j}.target`, "件", "目標", { label: "その他のKPIの目標" })}<button type="button" class="kc-del" data-act="del-other" data-id="${id}" data-j="${j}" aria-label="削除">×</button></div>`,
    )
    .join("");
  // 月別の目標
  const n = periodMonths(p.period);
  let monthly = "";
  if (n > 1) {
    const rp = resolvePlan(p);
    const targets = def.kpis
      .filter((k) => k.kind === "count" && rp.measures[id].kpis[k.key].target !== null)
      .map((k) => ({ label: k.label, path: `${base}.kpis.${k.key}.monthly`, target: rp.measures[id].kpis[k.key].target!, monthly: mp.kpis[k.key].monthly }))
      .concat(mp.others.map((o, j) => ({ label: o.name || "その他のKPI", path: `${base}.others.${j}.monthly`, target: o.target as number, monthly: o.monthly })).filter((x) => x.target !== null));
    const blocks = targets
      .map((tg) => {
        const entered = tg.monthly.slice(0, n).some((v) => v !== null && v !== undefined);
        const sum = tg.monthly.slice(0, n).reduce((s: number, v) => s + (v || 0), 0);
        const okSum = Math.abs(sum - tg.target) < 1e-6;
        const line = entered ? `<small class="${okSum ? "" : "ng"}">合計 ${fmtCount(sum)}／目標 ${fmtCount(tg.target)}${okSum ? " ✓" : "（合っていません）"}</small>` : `<small>未入力（各月 ${fmtCount(tg.target / n)}）</small>`;
        const cells = Array.from({ length: n }, (_, i) => {
          const v = tg.monthly[i];
          return `<label>${esc(monthLabel(p, i))}<input data-p="${tg.path}.${i}" inputmode="decimal" value="${esc(numStr(v ?? null))}" placeholder="${esc(entered ? "0" : fmtCount(tg.target / n))}" /></label>`;
        }).join("");
        return `<p class="kc-mgl">${esc(tg.label)}${line}</p><div class="kc-mgr">${cells}</div>`;
      })
      .join("");
    monthly = `<details class="kc-det" data-k="${id}-monthly"${openSet.has(`${id}-monthly`) ? " open" : ""}><summary>月別の目標<small>任意。入れないと期間の月数で均等に割ります（展示会など月に偏る施策に）</small></summary>${blocks}</details>`;
  }

  const k = ids.indexOf(id);
  const nextHref = k < ids.length - 1 ? url("setup", 3, ids[k + 1]) : url("setup", 3, "common");
  const nextLabel = k < ids.length - 1 ? `次へ：${MEASURES[ids[k + 1]].short}` : "次へ：リードの後";
  const html = `
    ${subChips("setup", 3, id, true)}
    <p class="kc-h">${esc(def.short)}：リードをどこまで取るか</p>
    ${allocBar(id)}
    <div class="kc-fun">
      <div>${rows.join("")}</div>
      <div class="kc-side">
        <div class="tgr"><div class="kc-tg">入れ方${seg("m-mode", mp.mode, [["count", "件数"], ["rate", "率"]], ` data-id="${id}"`)}</div></div>
        <div class="kc-box"><b>${esc(def.short)}で見るところ</b>${esc(MEASURE_NOTE[id])}<br />${count ? "率は、件数から自動で出します。" : "件数は、率から自動で出します。"}薄い文字は一般的な値で、空欄のまま進むとその値で計算します。リード数が空欄のときは、全体のリード数の残りを、空欄の施策で分けます。</div>
        <div><p class="kc-mgl" style="margin-top:0 !important">今は取れていない数字<small>あれば選ぶ</small></p><div class="kc-chips" style="margin-top:6px">${unmeas}</div></div>
        <div><p class="kc-mgl" style="margin-top:0 !important">この施策に足すKPI<small>任意・件数</small></p>${others}${mp.others.length < 5 ? `<button type="button" class="kc-add" data-act="add-other" data-id="${id}">＋ KPIを足す</button>` : ""}</div>
      </div>
    </div>
    ${monthly}`;
  return { html, wide: true, back: { href: k > 0 ? url("setup", 3, ids[k - 1]) : url("setup", 2), label: k > 0 ? MEASURES[ids[k - 1]].short : "施策と期間" }, next: { href: nextHref, label: nextLabel } };
}

function setup3common(): View {
  const p = data.plan;
  const ids = sel();
  const t = resolveTree(p);
  const chips = COMMON_KPIS.map(
    (c) => `<button type="button" class="kc-chip" data-act="unmeasured" data-path="plan.commonMeasurable.${c.key}" aria-pressed="${!p.commonMeasurable[c.key]}">${esc(c.label)}</button>`,
  ).join("");
  const html = `
    ${subChips("setup", 3, "common", true)}
    <p class="kc-h">リードになった後（全体で1組）</p>
    <p class="kc-lead">商談化率・受注率はSTEP1のツリーの値を使います。営業に渡せる割合（リードのうち、営業に渡した割合）は任意です。</p>
    <div class="kc-g3">
      <div class="kc-fld"><span class="kc-lb">営業に渡せる割合<small>任意</small></span>${inp("plan.handoffTarget", "%", "目標がなければ空欄")}</div>
      <div class="kc-fld"><span class="kc-lb">商談化率<small>STEP1</small></span>${calc(pct1(t.dealRate), "%")}</div>
      <div class="kc-fld"><span class="kc-lb">受注率<small>STEP1</small></span>${calc(pct1(t.winRate), "%")}</div>
    </div>
    <p class="kc-sec">今は取れていない数字<small style="font-weight:400;margin-left:6px">あれば選ぶ</small></p>
    <div class="kc-chips">${chips}</div>`;
  return { html, back: { href: url("setup", 3, ids[ids.length - 1]), label: MEASURES[ids[ids.length - 1]].short }, next: { href: url("setup", 4), label: "次へ：費用と撤退（任意）" } };
}

function setup4(): View {
  const ids = sel();
  if (!ids.length) return { html: "", redirect: url("setup", 2) };
  const p = data.plan;
  const rp = resolvePlan(p);
  const { cacLimit: lim, allowCpl } = limitsOf(rp);
  const blocks = ids
    .map((id) => {
      const mp = p.measures[id];
      const base = `plan.measures.${id}`;
      const cost = costOf(mp);
      const lt = rp.measures[id].kpis[leadKpi(id).key].target;
      const cpl = cost !== null && lt ? cost / lt : null;
      const partsOn = hasParts(mp.parts);
      const capPh = allowCpl !== null ? fmtMan1(Math.round(allowCpl * 10) / 10) : "未入力";
      const exitOpts = [`<option value=""${mp.exitAfter === null ? " selected" : ""}>決めない</option>`]
        .concat(
          Array.from({ length: 11 }, (_, k) => k + 1).map((k) => {
            const idx = mp.start + k;
            return `<option value="${k}"${mp.exitAfter === k ? " selected" : ""}>開始から${k}か月後（${idx <= 11 ? monthLabel(p, idx) : "期間の外"}）</option>`;
          }),
        )
        .join("");
      const costBox = partsOn ? calc(fmtNum(cost, 1), "万円") : inp(`${base}.cost`, "万円", "未入力", { label: `${MEASURES[id].short}の費用` });
      const capIn = `<div class="kc-in"><input data-p="${base}.cplCap" inputmode="decimal" value="${esc(mp.cplCapTouched ? numStr(mp.cplCap) : "")}" placeholder="${esc(capPh)}" aria-label="CPLの上限" /><span>万円</span></div>`;
      return `<div class="kc-cost"><h3>${esc(MEASURES[id].name)}</h3>
        <div class="kc-g3">
          <div class="kc-fld"><span class="kc-lb">費用<small>期間の合計</small></span>${costBox}</div>
          <div class="kc-fld"><span class="kc-lb">CPL（1件あたりの費用）</span>${calc(cpl === null ? "—" : fmtMan1(cpl), "万円")}</div>
          <div class="kc-fld"><span class="kc-lb">CPLの上限<small>撤退の線</small></span>${capIn}</div>
          <div class="kc-fld"><span class="kc-lb">開始月</span><div class="kc-in"><select data-p="${base}.start" data-t="int">${monthOpts(mp.start)}</select></div></div>
          <div class="kc-fld"><span class="kc-lb">撤退を判定する月</span><div class="kc-in"><select data-p="${base}.exitAfter" data-t="intnull">${exitOpts}</select></div></div>
        </div>
        <details class="kc-det" data-k="${id}-parts"${openSet.has(`${id}-parts`) || partsOn ? " open" : ""}><summary>費用の内訳<small>任意。入れると費用は内訳の合計になります</small></summary>
          <div class="kc-g3" style="margin-top:10px">
            <div class="kc-fld"><span class="kc-lb">外部に払う費用</span>${inp(`${base}.parts.ext`, "万円", "")}</div>
            <div class="kc-fld"><span class="kc-lb">人件費</span>${inp(`${base}.parts.labor`, "万円", "0でも可")}</div>
            <div class="kc-fld"><span class="kc-lb">ツール代</span>${inp(`${base}.parts.tool`, "万円", "")}</div>
          </div>
        </details></div>`;
    })
    .join("");
  const html = `
    <p class="kc-h">費用と、撤退の線を決めます（任意）</p>
    <p class="kc-lead">入れなくても判定に進めます。費用を入れた施策だけ、CPL・CACの判定と、毎月の撤退の判断をします。</p>
    ${legend("")}
    <div class="kc-g2" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="kc-fld"><span class="kc-lb">粗利率</span>${inp("plan.margin", "%", fmtNum(GENERAL.margin))}</div>
      <div class="kc-fld"><span class="kc-lb">取り返す年数</span>${inp("plan.years", "年", fmtNum(GENERAL.years, 1))}</div>
      <div class="kc-fld"><span class="kc-lb">CACの上限</span>${calc(lim === null ? "—" : fmtNum(lim), "万円")}</div>
      <div class="kc-fld"><span class="kc-lb">許容CPL</span>${calc(allowCpl === null ? "—" : fmtMan1(allowCpl), "万円")}</div>
    </div>
    <p class="kc-hint">CACの上限＝平均単価×粗利率×取り返す年数。許容CPL＝CACの上限×商談化率×受注率。CPLの上限が空欄のときは、許容CPLを使います</p>
    ${blocks}`;
  return { html, back: { href: url("setup", 3, "common"), label: "リードの後" }, next: { href: url("setup", 5), label: "次へ：判定" } };
}

function stepLinkOf(it: FirstItem): string {
  const ids = sel();
  if (it.step === "3") {
    const m = (it.nodes || []).find((x) => x.startsWith("m."));
    return url("setup", 3, m ? m.slice(2) : ids[0] || undefined);
  }
  return url("setup", Number(it.step || 1));
}

function setup5(): View {
  const ids = sel();
  if (!ids.length) return { html: "", redirect: url("setup", 2) };
  const rp = resolvePlan(data.plan);
  const items = firstJudgments(rp);
  const fixes = items.filter((x) => x.status === "fix");
  const checks = items.filter((x) => x.status === "check");
  const oks = items.filter((x) => x.status === "ok");
  const nas = items.filter((x) => x.status === "na");
  let m: string;
  let s: string;
  if (fixes.length) {
    m = `${fixes[0].summary}。`;
    s = `${fixes[0].fix || fixes[0].reason}。${fixes.length > 1 ? `ほかに直すところが${fixes.length - 1}つ、` : ""}${checks.length ? `確認が${checks.length}つあります。` : fixes.length > 1 ? "あります。" : ""}`;
  } else if (checks.length) {
    m = `直すところはありません。確認が${checks.length}つあります。`;
    s = checks.map((c) => c.summary).join("／");
  } else {
    m = "問題はありません。この目標で運用を始められます。";
    s = "PDFにして、経営との合意に使えます。";
  }
  const cnt = `<div class="kc-cnt"><span class="kc-c-fix">直す ${fixes.length}</span><span class="kc-c-check">確認 ${checks.length}</span><span class="kc-c-ok">問題なし ${oks.length}</span>${nas.length ? `<span class="kc-c-na">判定していない ${nas.length}</span>` : ""}</div>`;

  // ツリーの印
  const marks: Record<string, { nos: number[]; st: "fix" | "check" }> = {};
  for (const it of [...fixes, ...checks])
    for (const nd of it.nodes || []) {
      const cur = marks[nd] || { nos: [], st: it.status as "fix" | "check" };
      cur.nos.push(it.no);
      if (it.status === "fix") cur.st = "fix";
      marks[nd] = cur;
    }
  const mk = (key: string) => (marks[key] ? `<i class="kc-mk ${marks[key].st}">${marks[key].nos.join(",")}</i>` : "");
  const cls = (key: string) => (marks[key] ? ` ${marks[key].st}` : "");
  const td = rp.meta?.treeDefaults ?? [];
  const dfl = (k: string) => (td.includes(k) ? "（一般的な値）" : "");
  const parts = ids.map((id) => ({ id, v: rp.measures[id].kpis[leadKpi(id).key].target || 0 }));
  const sum = parts.reduce((a, x) => a + x.v, 0);
  const diff = (rp.leads || 0) - sum;
  const leaves = parts.map((x) => `<div class="kc-rk${cls(`m.${x.id}`)}">${esc(TINY[x.id])}<b>${fmtNum(x.v)}</b>${mk(`m.${x.id}`)}</div>`);
  if (Math.round(diff) !== 0) leaves.push(`<div class="kc-rk gap${marks.gap ? "" : " okgap"}">${diff > 0 ? "足りない" : "多い"}<b>${fmtNum(Math.abs(diff))}</b></div>`);
  const tree = `<div class="kc-panel"><p class="ph">全体のツリー<small>番号＝右の指摘</small></p><div class="kc-rt">
      <div class="kc-rn top"><span>売上目標</span><b>${fmtNum(rp.sales)}万円</b></div>
      <div class="kc-rl"><span>平均単価 ${fmtNum(rp.price)}万円${dfl("price")}</span></div>
      <div class="kc-rn${cls("tree.wins")}"><span>受注数</span><b>${fmtNum(rp.wins)}件</b>${mk("tree.wins")}</div>
      <div class="kc-rl"><span>受注率 ${pct1(rp.winRate)}%${dfl("winRate")}</span></div>
      <div class="kc-rn${cls("tree.deals")}"><span>商談数</span><b>${fmtNum(rp.deals)}件</b>${mk("tree.deals")}</div>
      <div class="kc-rl"><span>商談化率 ${pct1(rp.dealRate)}%${dfl("dealRate")}</span></div>
      <div class="kc-rn${cls("tree.leads")}"><span>リード数</span><b>${fmtNum(rp.leads)}件</b>${mk("tree.leads")}</div>
      <div class="kc-rbr"><div class="hl" style="left:${100 / (leaves.length * 2)}%;right:${100 / (leaves.length * 2)}%"></div>${leaves.join("")}</div>
      <p class="kc-rsum">施策の合計 ${fmtNum(sum)}件／全体 ${fmtNum(rp.leads)}件${rp.leads ? `（${sum >= (rp.leads || 0) ? "+" : "−"}${fmtNum((Math.abs(sum - rp.leads!) / rp.leads!) * 100)}%）` : ""}</p>
    </div></div>`;
  const itemHtml = (it: FirstItem) => {
    const btn = it.link
      ? `<a class="kc-btn2" href="${it.link.href}">${esc(it.link.label)} →</a>`
      : it.step
        ? `<a class="kc-btn2" href="${stepLinkOf(it)}">STEP${it.step}で直す →</a>`
        : "";
    return `<div class="kc-it ${it.status}"><span class="n">${it.no}</span><div><p class="lv">${it.status === "fix" ? "直す" : "確認"}</p><p class="t">${esc(it.summary || it.title)}</p><p class="r">${esc(it.reason)}</p>${btn}</div></div>`;
  };
  const okl = `<div class="kc-okl"><b>問題なし ${oks.length}</b>　${oks.map((x) => esc(x.title)).join("／")}${nas.length ? `<span class="na">判定していない ${nas.length}　${nas.map((x) => `${esc(x.title)}（${esc(x.reason)}）`).join("／")}</span>` : ""}</div>`;
  const html = `
    <div class="kc-concl"><p class="h">判定の結論</p><p class="m">${esc(m)}</p><p class="s">${esc(s)}</p>${cnt}</div>
    <div class="kc-rg">${tree}<div>${[...fixes, ...checks].map(itemHtml).join("")}${okl}</div></div>`;
  return { html, wide: true, back: { href: url("setup", 4), label: "費用と撤退" }, next: { href: url("setup", 6), label: "次へ：PDFにする" } };
}

function regBlock(kind: "first" | "monthly", ok: boolean, what: string): string {
  const email = getRegistered();
  const body = email
    ? `<p class="kc-hint" style="margin-top:0 !important">登録済み：<b>${esc(email)}</b></p>
       <button type="button" class="kc-btn" data-act="download" data-kind="${kind}"${ok ? "" : " disabled"}><span>PDFをダウンロード</span><span aria-hidden="true">↓</span></button>
       <p class="kc-msg" id="kc-dl-msg" role="status"${flash.dl ? "" : " hidden"}>${esc(flash.dl || "")}</p>
       <button type="button" class="kc-link" data-act="reregister" style="margin-top:10px">別のメールアドレスで登録しなおす</button>`
    : `<form id="kc-reg-form" data-kind="${kind}" novalidate>
        <p class="kc-hint" style="margin-top:0 !important;margin-bottom:10px !important">メールアドレスを登録すると、その場でPDFをダウンロードできます（PDFはメールでは送りません）。管理日を決めた場合は、3営業日前と当日にお知らせメールが届きます。</p>
        <div class="kc-fld"><label for="reg-email">メールアドレス</label><div class="kc-in"><input id="reg-email" type="email" autocomplete="email" placeholder="you@example.com" /></div></div>
        <div class="kc-hp" aria-hidden="true"><label>ウェブサイト<input type="text" id="reg-website" tabindex="-1" autocomplete="off" /></label></div>
        <label class="kc-check"><input id="reg-consent" type="checkbox" /><span><a href="/privacy" target="_blank" rel="noopener">プライバシーポリシー</a>に同意して、お知らせメールを受け取る</span></label>
        <button type="submit" class="kc-btn" id="reg-submit"${ok ? "" : " disabled"}><span>登録してPDFをダウンロード</span><span aria-hidden="true">↓</span></button>
        <p class="kc-msg" id="reg-msg" role="status" hidden></p>
      </form>`;
  return `<div class="kc-dl">${body}<p class="kc-hint" style="margin-top:12px !important">${esc(what)}</p><p class="kc-hint">※PDFを別のソフトで保存し直すと、埋め込んだデータが消えることがあります（その場合は手で入力してください）。メンバーとの共有はPDFを渡して行えます。</p></div>`;
}

function setup6(): View {
  const ids = sel();
  if (!ids.length) return { html: "", redirect: url("setup", 2) };
  const p = data.plan;
  const days = [null, ...Array.from({ length: 28 }, (_, i) => i + 1), 31];
  const dayOpts = days.map((d) => `<option value="${d === null ? "" : d}"${d === p.manageDay ? " selected" : ""}>${manageDayLabel(d)}</option>`).join("");
  const html = `
    <p class="kc-h">PDFにして、経営との合意に使います</p>
    <p class="kc-lead">PDFはA4横の3ページです（判定／KPIツリーと施策の目標／経営との合意用の1枚）。次の2つは合意用の1枚に入ります。</p>
    <div class="kc-g3">
      <div class="kc-fld"><label>判断する人</label>${txt("plan.decider", "例：営業本部長")}</div>
      <div class="kc-fld"><label>振り返りの日</label>${txt("plan.review", "例：毎月10日の経営会議")}</div>
      <div class="kc-fld"><label for="kc-day">管理日<small>毎月の数字を入れる日</small></label><div class="kc-in"><select id="kc-day" data-p="plan.manageDay" data-t="day">${dayOpts}</select></div></div>
    </div>
    <p class="kc-sec">ダウンロード</p>
    ${regBlock("first", true, "翌月からは、このPDFを「② 毎月の実績を判定する」で読み込むと、目標が入ります。")}
    <a class="kc-next" href="${url("monthly", 1)}"><span><b>毎月の管理は「② 毎月の実績を判定する」で</b>このPDFを読み込み、実績を入れると、達成・未達と次の打ち手、撤退の判断を出します</span><span aria-hidden="true">毎月の判定へ →</span></a>`;
  return { html, back: { href: url("setup", 5), label: "判定" } };
}

// ========== ② 毎月 ==========
function noPlanHtml(): string {
  return `<div class="kc-box"><b>目標が入っていません</b>前回のPDFを読み込むか、「① KPIの妥当性をチェックする」で目標を入れてください。<br /><a href="${url("setup", 1)}">① KPIの妥当性をチェックする →</a></div>`;
}
function monthly1(): View {
  const p = data.plan;
  const ids = sel();
  const i = data.reportIndex;
  const chips = Array.from({ length: 12 }, (_, k) => {
    const done = isMonthEntered(data, k);
    return `<button type="button" class="kc-chip${done ? " done" : ""}" data-act="month" data-i="${k}" aria-pressed="${k === i}">${esc(monthLabel(p, k))}</button>`;
  }).join("");
  const load = `<div class="kc-load"><p class="kc-mgl" style="margin-top:0 !important">前回のPDFを読み込む<small>このツールで作ったPDF</small></p>
      <p class="kc-hint" style="margin-bottom:10px !important">読み込むと、目標と前月までの実績が入ります。続けてこのブラウザで入れている場合は不要です。</p>
      <label class="kc-btn2 kc-file">PDFを選ぶ<input id="kc-pdf-input" type="file" accept="application/pdf,.pdf" class="kc-sr" /></label>
      <p class="kc-msg${flash.loadOk === false ? " ng" : " ok"}" id="kc-load-msg" role="status"${flash.load ? "" : " hidden"}>${esc(flash.load || "")}</p></div>`;
  const html = `
    <p class="kc-h">今月の数字を入れる準備</p>
    ${load}
    ${
      ids.length
        ? `<p class="kc-sec">報告する月</p><div class="kc-months">${chips}</div><p class="kc-hint">太い枠の月は入力済みです。報告する月：<b>${esc(monthLabelLong(p, i))}</b>（期首 ${p.startYear}年${p.startMonth}月・${esc(periodLabel(p.period))}）。施策：${ids.map((id) => esc(MEASURES[id].short)).join("・")}</p>`
        : `<div style="margin-top:16px">${noPlanHtml()}</div>`
    }`;
  return {
    html,
    back: { href: BASE, label: "ツールの入口へ" },
    next: { href: ids.length ? url("monthly", 2, ids[0]) : "#", label: `次へ：${ids.length ? `${monthLabel(p, i)}の` : ""}施策ごとの実績`, disabled: !ids.length, reason: "目標を入れると進めます" },
  };
}
function monthBadge(): string {
  return `<p class="kc-hint" style="margin:-12px 0 14px !important">報告する月：<b>${esc(monthLabelLong(data.plan, data.reportIndex))}</b>（<a href="${url("monthly", 1)}">変える</a>）</p>`;
}
function monthly2(sub: string): View {
  const ids = sel();
  if (!ids.length) return { html: "", redirect: url("monthly", 1) };
  const id = sub as MeasureId;
  if (!MEASURES[id] || !data.plan.measures[id].on) return { html: "", redirect: url("monthly", 2, ids[0]) };
  const p = data.plan;
  const i = data.reportIndex;
  const def = MEASURES[id];
  const mp = p.measures[id];
  const base = `months.${i}.m.${id}`;
  const k = ids.indexOf(id);
  let body: string;
  if (i < mp.start) body = `<div class="kc-box"><b>開始前の施策です</b>${esc(monthLabel(p, mp.start))}に開始する施策です。この月は入力しません。</div>`;
  else {
    const mm = data.months[i].m[id];
    const fields = def.fields.map((f) => `<div class="kc-fld"><span class="kc-lb">${esc(f.label)}</span>${inp(`${base}.f.${f.key}`, f.unit, "", { label: f.label })}</div>`).join("");
    const others = mp.others
      .map((o, j) => (o.target === null ? "" : `<div class="kc-fld"><span class="kc-lb">${esc(o.name || "その他のKPI")}</span>${inp(`${base}.others.${j}`, "件", "")}</div>`))
      .join("");
    const partsOn = hasParts(mm.parts);
    body = `<p class="kc-lead">件数で入れてください。率とCPLはツールが計算します。取れていない数字は空欄のままにします。</p>
      <div class="kc-g2">${fields}${others}
        <div class="kc-fld"><span class="kc-lb">費用<small>任意・この月の分</small></span>${partsOn ? calc(fmtNum(costOf(mm), 1), "万円") : inp(`${base}.cost`, "万円", "")}</div>
      </div>
      <details class="kc-det" data-k="m-${id}-parts"${openSet.has(`m-${id}-parts`) || partsOn ? " open" : ""}><summary>費用の内訳<small>任意</small></summary>
        <div class="kc-g3" style="margin-top:10px">
          <div class="kc-fld"><span class="kc-lb">外部に払う費用</span>${inp(`${base}.parts.ext`, "万円", "")}</div>
          <div class="kc-fld"><span class="kc-lb">人件費</span>${inp(`${base}.parts.labor`, "万円", "0でも可")}</div>
          <div class="kc-fld"><span class="kc-lb">ツール代</span>${inp(`${base}.parts.tool`, "万円", "")}</div>
        </div></details>
      <div class="kc-fld" style="margin-top:16px"><span class="kc-lb">今月実施したこと<small>来月の判定で、数字の変化と並べて出します</small></span><div class="kc-in kc-ta"><textarea data-p="${base}.did" data-t="text" maxlength="300" rows="2" aria-label="今月実施したこと">${esc(mm.did)}</textarea></div></div>`;
  }
  const html = `${subChips("monthly", 2, id, false)}<p class="kc-h">${esc(def.short)}の実績</p>${monthBadge()}${body}`;
  return {
    html,
    back: { href: k > 0 ? url("monthly", 2, ids[k - 1]) : url("monthly", 1), label: k > 0 ? MEASURES[ids[k - 1]].short : "準備" },
    next: { href: k < ids.length - 1 ? url("monthly", 2, ids[k + 1]) : url("monthly", 3), label: k < ids.length - 1 ? `次へ：${MEASURES[ids[k + 1]].short}` : "次へ：全体の数字" },
  };
}
function monthly3(): View {
  const ids = sel();
  if (!ids.length) return { html: "", redirect: url("monthly", 1) };
  const c = `months.${data.reportIndex}.c`;
  const fields = [
    ["deals", "商談数", "件"],
    ["dealAmt", "商談金額", "万円"],
    ["wins", "受注数", "件"],
    ["winAmt", "受注金額", "万円"],
    ["losses", "失注数", "件"],
    ["lossAmt", "失注金額", "万円"],
    ["handoff", "営業に渡した数<small>任意</small>", "件"],
  ]
    .map(([k, l, u]) => `<div class="kc-fld"><span class="kc-lb">${l}</span>${inp(`${c}.${k}`, u, "", { label: l.replace(/<[^>]+>/g, "") })}</div>`)
    .join("");
  const html = `<p class="kc-h">全体の数字（マーケ経由）</p>${monthBadge()}
    <p class="kc-lead">施策ごとには分けません。受注率は決着した商談（受注＋失注）だけで出し、決着が10件たまってから判定します。営業に渡した数が空のときは「営業に渡せる割合」を判定しません。</p>
    <div class="kc-g2">${fields}</div>`;
  return { html, back: { href: url("monthly", 2, ids[ids.length - 1]), label: MEASURES[ids[ids.length - 1]].short }, next: { href: url("monthly", 4), label: "次へ：判定" } };
}

function actionsHtml(r: MonthReport) {
  const blocks: string[] = [];
  for (const m of r.measures) {
    if (!m.started) continue;
    const parts: string[] = [];
    for (const pk of m.picks) {
      const val = `${formatValue(pk.vkind, pk.actual)}${pk.vkind === "cpl" ? "万円" : ""}／目標${formatValue(pk.vkind, pk.target)}${pk.vkind === "cpl" ? "万円" : ""}`;
      if (!pk.items) {
        parts.push(`<p class="kc-act-h">${esc(m.name)}｜${esc(pk.label)}<small>${esc(val)}</small></p><p class="kc-none">打ち手なし（判定のみ）。裏づけのある打ち手が見つかりしだい足します</p>`);
        continue;
      }
      parts.push(
        `<p class="kc-act-h">${esc(m.name)}｜${esc(pk.label)}<small>${esc(val)}</small></p>` +
          pk.items.map((it) => `<p class="kc-act-box">${esc(it.text)}</p><p class="kc-basis">裏づけ：${esc(it.basis)}（${srcText(it.src, true)}）</p>`).join(""),
      );
    }
    if (m.effect)
      parts.push(
        `<div class="kc-fx"><div><b>${esc(m.effect.prevLabel)}に実施したこと</b>${m.effect.did ? esc(m.effect.did) : "記入なし"}</div><div><b>数字の変化（前月比）</b>${m.effect.changes.length ? m.effect.changes.map(esc).join("<br />") : "前月の数字がありません"}</div></div>`,
      );
    if (parts.length) blocks.push(`<div class="kc-act">${m.picks.length ? "" : `<p class="kc-act-h">${esc(m.name)}<small>届かないKPIはありません</small></p>`}${parts.join("")}</div>`);
  }
  return blocks.length ? blocks.join("") : '<p class="kc-none">「届かない」のKPIはありません。今の打ち手を続けます。</p>';
}
function copyHtml(r: MonthReport) {
  const c = r.copy;
  const cell = (l: string, v: string) => `<div><small>${l}</small>${v}</div>`;
  const cnt = (v: number | null) => (v === null ? "—" : `<b>${fmtNum(v)}</b> 件`);
  const man = (v: number | null) => (v === null ? "—" : `<b>${fmtNum(v, 1)}</b> 万円`);
  const cost = c.hasParts ? cell("外部に払う費用", man(c.ext)) + cell("人件費", man(c.labor)) : cell("費用（合計）", man(c.costTotal));
  return `<div class="kc-copy">${cell("リード数", cnt(c.leads))}${cell("商談数", cnt(c.deals))}${cell("商談金額", man(c.dealAmt))}${cell("受注数", cnt(c.wins))}${cell("受注金額", man(c.winAmt))}${cell("失注数", cnt(c.losses))}${cell("失注金額", man(c.lossAmt))}${cost}</div>`;
}
function monthly4(): View {
  const ids = sel();
  if (!ids.length) return { html: "", redirect: url("monthly", 1) };
  const rd = resolveData(data);
  const i = data.reportIndex;
  const r = computeMonth(rd, i);
  const ng = r.measures.flatMap((m) => m.rows.filter((x) => x.status === "ng").map((x) => `${m.name}の${x.label}`));
  const exits = r.exits.filter((e) => e.status === "exit").map((e) => e.name);
  const entered = isMonthEntered(data, i);
  const concl = !entered
    ? `${monthLabel(data.plan, i)}の実績が入っていません。`
    : exits.length
      ? `${exits.join("・")}は撤退を検討してください。`
      : ng.length
        ? `届かないKPIが${ng.length}つあります。下の打ち手を試してください。`
        : "届かないKPIはありません。今の打ち手を続けます。";
  const html = `
    <div class="kc-concl"><p class="h">${esc(r.label)}の判定</p><p class="m">${esc(concl)}</p>${ng.length ? `<p class="s">届かない：${esc(ng.join("／"))}</p>` : ""}</div>
    <div class="kc-blk" style="margin-top:0"><p class="ph">KPIごとの達成・未達<small>◇＝直近3か月の合計で判定</small></p><div class="kc-tw">${monthTableHtml(rd, r, "kc")}</div>
      <p class="kc-legendt">達成＝100%以上、やや届かない＝90%以上、届かない＝90%未満（CPLは目標÷実績）。うすい赤＝施策の中で上から最初に「届かない」になったKPI。「打ち手」＝打ち手を出したKPI</p></div>
    <div class="kc-blk"><p class="ph">次の打ち手と、前月に実施したことの効果</p>${actionsHtml(r)}</div>
    <div class="kc-blk"><p class="ph">撤退の判断<small>判定する月以降、開始月からの累計</small></p>${exitHtml(r, "kc")}</div>
    <div class="kc-blk"><p class="ph">月次報告メーカーに写す数字<small>同じ順番・同じ名前</small></p>${copyHtml(r)}
      <a class="kc-next" href="/tools/monthly-report"><span><b>経営への報告は、マーケ月次報告メーカーで</b>この数字を写すと、期末の着地見込みまでそろった報告1枚を作れます</span><span aria-hidden="true">月次報告メーカー →</span></a></div>
    <div class="kc-blk"><p class="ph"><span>AIに相談するプロンプト</span><button type="button" class="kc-btn2" data-act="copy-prompt" style="min-height:34px">コピー</button></p>
      <pre class="kc-prompt" id="kc-prompt">${esc(r.prompt)}</pre><p class="kc-hint">数字と判定だけが入ります。会社名・顧客名は入りません。お使いのAIのチャットに貼ってください（このサイトではAIを使いません）</p></div>`;
  return { html, wide: true, back: { href: url("monthly", 3), label: "全体の数字" }, next: { href: url("monthly", 5), label: "次へ：PDFにする" } };
}
function monthly5(): View {
  const ids = sel();
  if (!ids.length) return { html: "", redirect: url("monthly", 1) };
  const i = data.reportIndex;
  const ok = isMonthEntered(data, i);
  const html = `<p class="kc-h">${esc(monthLabelLong(data.plan, i))}のPDF</p>
    <p class="kc-lead">A4横の1ページです（9pt未満になるときは2ページに分けます）。左にKPIごとの達成・未達、右に次の打ち手と撤退の判断が入ります。</p>
    ${ok ? "" : `<p class="kc-msg ng" style="margin-bottom:12px !important">この月の実績を入れるとダウンロードできます。</p>`}
    ${regBlock("monthly", ok, "翌月は、このPDFを「準備」で読み込んでください。目標と今月までの実績が入ります。")}`;
  return { html, back: { href: url("monthly", 4), label: "判定" } };
}

// ---------- 描画 ----------
const flash: { load?: string; loadOk?: boolean; dl?: string } = {};
const openSet = new Set<string>();
let app: HTMLElement | null = null;
let flow: Flow = "setup";
let step = 1;
let sub = "";

function viewOf(): View {
  if (flow === "setup") {
    if (step === 1) return setup1();
    if (step === 2) return setup2();
    if (step === 3) return setup3(sub);
    if (step === 4) return setup4();
    if (step === 5) return setup5();
    return setup6();
  }
  if (step === 1) return monthly1();
  if (step === 2) return monthly2(sub);
  if (step === 3) return monthly3();
  if (step === 4) return monthly4();
  return monthly5();
}

function render(keepFocus = false) {
  if (!app) return;
  const v = viewOf();
  if (v.redirect) {
    location.replace(v.redirect);
    return;
  }
  const active = document.activeElement as HTMLInputElement | null;
  const ap = keepFocus ? active?.dataset?.p : undefined;
  const pos = ap && active && "selectionStart" in active ? active.selectionStart : null;
  app.className = `kc${v.wide ? " kc-wide" : ""}`;
  app.innerHTML = sampleBanner() + progress(flow, step) + v.html + navHtml(v);
  if (ap) {
    const again = app.querySelector<HTMLInputElement>(`[data-p="${ap}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      try {
        if (pos !== null) again.setSelectionRange(pos, pos);
      } catch {
        /* noop */
      }
    }
  }
}
let timer: number | undefined;
function scheduleRender() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => render(true), 350);
}

function currentIndex(): number {
  const now = new Date();
  const diff = (now.getFullYear() - data.plan.startYear) * 12 + (now.getMonth() + 1 - data.plan.startMonth) - 1;
  return Math.min(11, Math.max(0, diff));
}

function bindApp(root: HTMLElement) {
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const path = el.dataset?.p;
    if (!path) return;
    const t = el.dataset.t;
    if (t === "text") setAt(path, el.value);
    else if (t === "start" || t === "int" || t === "intnull" || t === "day") return;
    else {
      const { v, bad } = parseNum(el.value);
      el.closest(".kc-in")?.classList.toggle("kc-bad", bad);
      if (bad) return;
      setAt(path, v);
      if (/\.cplCap$/.test(path)) setAt(path.replace(/cplCap$/, "cplCapTouched"), v !== null);
    }
    save();
    if (t !== "text") scheduleRender();
  });
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.id === "kc-pdf-input") return void onPdfFile(el as HTMLInputElement);
    const t = (el as HTMLElement).dataset?.t;
    if (t === "start") {
      const [y, m] = el.value.split("-").map(Number);
      data.plan.startYear = y;
      data.plan.startMonth = m;
    } else {
      const path = (el as HTMLElement).dataset?.p;
      if (!path) return;
      if (t === "int") setAt(path, Number(el.value));
      else if (t === "intnull" || t === "day") setAt(path, el.value === "" ? null : Number(el.value));
      else return;
    }
    save();
    render();
  });
  root.addEventListener(
    "toggle",
    (e) => {
      const d = e.target as HTMLDetailsElement;
      const k = d.dataset?.k;
      if (!k) return;
      if (d.open) openSet.add(k);
      else openSet.delete(k);
    },
    true,
  );
  root.addEventListener("click", async (e) => {
    const a = (e.target as HTMLElement).closest("a[aria-disabled='true']");
    if (a) {
      e.preventDefault();
      return;
    }
    const el = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!el) return;
    const act = el.dataset.act!;
    const id = el.dataset.id as MeasureId;
    if (act === "tree-mode") switchTreeMode(data.plan, el.dataset.v as any);
    else if (act === "m-mode") switchMeasureMode(data.plan, id, el.dataset.v as any);
    else if (act === "period") data.plan.period = el.dataset.v as any;
    else if (act === "toggle-measure") data.plan.measures[id].on = !data.plan.measures[id].on;
    else if (act === "unmeasured") setAt(el.dataset.path!, !getAt(el.dataset.path!));
    else if (act === "add-other") data.plan.measures[id].others.push({ name: "", target: null, monthly: [], measurable: true });
    else if (act === "del-other") {
      const j = Number(el.dataset.j);
      data.plan.measures[id].others.splice(j, 1);
      data.months.forEach((m) => m.m[id].others.splice(j, 1));
    } else if (act === "month") data.reportIndex = Number(el.dataset.i);
    else if (act === "sample-end") {
      endSample();
      location.href = BASE;
      return;
    } else if (act === "reregister") setRegistered(null);
    else if (act === "copy-prompt") return void copyPrompt(el);
    else if (act === "download") return void download(el as HTMLButtonElement, el.dataset.kind as any);
    else return;
    save();
    render();
  });
  root.addEventListener("submit", (e) => {
    const form = e.target as HTMLFormElement;
    if (form.id !== "kc-reg-form") return;
    e.preventDefault();
    void register(form);
  });
}

async function copyPrompt(btn: HTMLElement) {
  const text = document.getElementById("kc-prompt")?.textContent || "";
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* noop */
    }
    ta.remove();
  }
  btn.textContent = "コピーしました";
  window.setTimeout(() => (btn.textContent = "コピー"), 2000);
}

function showMsg(el: HTMLElement | null, text: string, ok: boolean) {
  if (!el) return;
  el.textContent = text;
  el.className = `kc-msg ${ok ? "ok" : "ng"}`;
  el.hidden = false;
}

async function download(btn: HTMLButtonElement, kind: "first" | "monthly") {
  const msg = document.getElementById("kc-dl-msg");
  btn.disabled = true;
  showMsg(msg, "PDFを作っています…", true);
  try {
    await makePdf(data, resolveData(data), kind, getRegistered());
    flash.dl = "PDFをダウンロードしました。";
    showMsg(msg, flash.dl, true);
  } catch (err: any) {
    console.error(err);
    showMsg(msg, err?.message || "PDFを作れませんでした。", false);
  } finally {
    btn.disabled = false;
  }
}

async function register(form: HTMLFormElement) {
  const kind = form.dataset.kind as "first" | "monthly";
  const msg = document.getElementById("reg-msg");
  const btn = document.getElementById("reg-submit") as HTMLButtonElement;
  const emailEl = document.getElementById("reg-email") as HTMLInputElement;
  const email = emailEl.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailEl.closest(".kc-in")?.classList.add("kc-bad");
    showMsg(msg, "メールアドレスを確かめてください。", false);
    return;
  }
  emailEl.closest(".kc-in")?.classList.remove("kc-bad");
  if (!(document.getElementById("reg-consent") as HTMLInputElement).checked) {
    showMsg(msg, "プライバシーポリシーへの同意にチェックを入れてください。", false);
    return;
  }
  btn.disabled = true;
  showMsg(msg, "登録しています…", true);
  try {
    const res = await fetch("/api/kpi-check-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, manageDay: data.plan.manageDay, consent: true, website: (document.getElementById("reg-website") as HTMLInputElement).value }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || "登録に失敗しました。時間をおいて再度お試しください。");
    setRegistered(email);
    showMsg(msg, "登録しました。PDFを作っています…", true);
    await makePdf(data, resolveData(data), kind, email);
    flash.dl = "PDFをダウンロードしました。";
    render();
  } catch (err: any) {
    showMsg(msg, err?.message || "エラーが発生しました。", false);
    btn.disabled = false;
  }
}

async function onPdfFile(input: HTMLInputElement) {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  showMsg(document.getElementById("kc-load-msg"), "読み込んでいます…", true);
  try {
    const raw = await readPdfData(file);
    if (!raw || !raw.plan || !Array.isArray(raw.months)) {
      flash.load = "このPDFには入力データが見つかりませんでした。別のソフトで保存し直したPDFは読み込めないことがあります。お手数ですが手で入力してください。";
      flash.loadOk = false;
      render();
      return;
    }
    data = normalizeData(raw);
    let last = -1;
    for (let k = 0; k < 12; k++) if (isMonthEntered(data, k)) last = k;
    data.reportIndex = last >= 0 ? Math.min(11, last + 1) : currentIndex();
    if (data.email && !getRegistered()) setRegistered(data.email);
    save();
    flash.load =
      last >= 0
        ? `${monthLabel(data.plan, last)}までの実績を読み込みました。${monthLabel(data.plan, data.reportIndex)}の数字を入れてください。`
        : `目標を読み込みました。${monthLabel(data.plan, data.reportIndex)}の数字を入れてください。`;
    flash.loadOk = true;
    render();
  } catch (err) {
    console.error(err);
    flash.load = "PDFを読み込めませんでした。このツールで作ったPDFか確かめてください。";
    flash.loadOk = false;
    render();
  }
}

// ---------- 入口（/tools/kpi-check） ----------
function initHub(hub: HTMLElement) {
  const resume = hub.querySelector<HTMLElement>("#kc-resume");
  const raw = loadRaw();
  const last = ls.get(LAST_KEY);
  const started = !isSample() && (selectedMeasures(raw.plan).length > 0 || raw.plan.sales !== null);
  if (resume && started) {
    const monthDone = raw.months.some((_, k) => isMonthEntered(raw, k));
    const where = last && last.startsWith(BASE) ? last : url("setup", 1);
    resume.hidden = false;
    resume.innerHTML = `<span>前回の続きがあります（${monthDone ? "毎月の実績まで入力済み" : "初回の入力中"}）。このブラウザに保存しています。</span><span style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><button type="button" class="kc-link" id="kc-clear">入力をすべて消す</button><a class="kc-btn2" href="${where}">続きから →</a></span>`;
    const clearBtn = resume.querySelector<HTMLButtonElement>("#kc-clear")!;
    let tm: number | undefined;
    clearBtn.addEventListener("click", () => {
      if (clearBtn.dataset.armed !== "1") {
        clearBtn.dataset.armed = "1";
        clearBtn.textContent = "もう一度押すと消えます";
        tm = window.setTimeout(() => {
          clearBtn.dataset.armed = "";
          clearBtn.textContent = "入力をすべて消す";
        }, 4000);
        return;
      }
      window.clearTimeout(tm);
      ls.set(STORAGE_KEY, null);
      ls.set(LAST_KEY, null);
      resume.hidden = true;
    });
  }
  // 入口に来たらサンプルは終える（サンプルのボタンから入り直す）
  if (isSample()) endSample();
}

// ---------- 起動 ----------
const hub = document.getElementById("kc-hub");
if (hub) initHub(hub);
app = document.getElementById("kc-app");
if (app) {
  flow = (app.dataset.flow as Flow) || "setup";
  step = Number(app.dataset.step || 1);
  sub = app.dataset.sub || "";
  if (flow === "monthly" && step === 1 && !data.months.some((_, k) => isMonthEntered(data, k)) && !isSample()) data.reportIndex = currentIndex();
  if (!isSample()) ls.set(LAST_KEY, location.pathname);
  bindApp(app);
  render();
}
