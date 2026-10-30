// src/scripts/kpi-analysis/app.ts
//
// 施策効果診断Kit（/tools/kpi-analysis）の画面。2026-10-30 作り直し（予算案診断Kit・KPI妥当性診断Kitと同じ型）。
// 状態・読み込み・判定は src/lib/effectCheck.ts、分析は src/lib/kpiAnalysis.ts、Excelは src/lib/effect-sheet.ts、
// 下の診断結果（グラフ）は src/scripts/kpi-analysis/report.ts。#bk の data-mode で動きを分ける
// - intro（/tools/kpi-analysis）：入口3つ（AIで整えて貼りつける／KPI管理表（.xlsx）／画面で入力）。読んだ数字を localStorage に入れて input に移る
// - input（/tools/kpi-analysis/input）：左＝入力（計画（年間）・計画（月別）・毎月の実績・施策ログ）、右＝判定、下＝診断結果。入力のたびに判定し直して保存する
// - sample（/tools/kpi-analysis/sample）：記入例（架空の会社、10月まで入力）を表示する（保存・ダウンロードはしない）
// 入れた数字やファイルはサーバーに送らない
import { calc } from "@/lib/kpi-sheet-maker";
import { KITS, SHEET_BUDGET, SHEET_KPI } from "@/lib/planKits";
import { resetMonthly, syncMonthly, type ChannelInput } from "@/lib/budgetCheck";
import { pct, verdict, SHEET_ACTUAL, SHEET_LOG, type Book } from "@/lib/kpiAnalysis";
import {
  ACT_KEYS,
  ACT_LABEL,
  CHANNELS,
  GROUP_LABEL_EFFECT,
  LOG_CHANNELS,
  LOG_KEYS,
  LOG_LABEL,
  LOG_MAX,
  LOG_METRICS,
  LOG_REVIEW,
  LOG_STATUS,
  ReadError,
  STORE,
  diagnoseEffect,
  emptyEffect,
  emptyLog,
  fmt,
  monthLabels,
  planMonthly,
  sampleEffect,
  stateFromEffectAi,
  stateFromEffectBook,
  type ActKey,
  type EffectDiagnosis,
  type EffectState,
  type LogKey,
} from "@/lib/effectCheck";
import { effectFileName, fillEffectWorkbook } from "@/lib/effect-sheet";
import { readBook } from "@/scripts/kpi-analysis/xlsx";
import { renderReport } from "@/scripts/kpi-analysis/report";

const PATH = "/tools/kpi-analysis";
const INPUT_URL = `${PATH}/input`;
const TEMPLATE = KITS.kpi.template;
const LIB_ZIP = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const KEYS: (keyof ChannelInput)[] = ["leads", "valid", "deals", "wins", "ext", "labor"];
const PRE = ["goal", "price", "gmPct", "paybackYears", "leadTime", "common"] as const;
const READ_SHEETS = [SHEET_KPI, SHEET_ACTUAL, SHEET_LOG, SHEET_BUDGET];
type Tab = "y" | "m" | "a" | "l";
const TAB_NOTE: Record<Tab, string> = {
  y: "いま表示中：計画（年間）。前提とチャネル別の年間の計画を入れます",
  m: "いま表示中：計画（月別）。年間÷12が入っています。直したい月だけ変えてください",
  a: "いま表示中：毎月の実績。終わった月の実績を入れます",
  l: "いま表示中：施策ログ。課題に打った手を1行ずつ入れます",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MODE = (document.getElementById("bk")?.dataset.mode ?? "intro") as "intro" | "input" | "sample";
const SAMPLE = MODE === "sample";
const form = document.getElementById("bk-form") as HTMLFormElement | null;
const field = (name: string) => form!.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let st: EffectState = emptyEffect();
let sampleBook: Book | null = null;
async function loadSample(): Promise<EffectState> {
  sampleBook ??= (await import("@/data/kpi-analysis-sample.json")).default as unknown as Book;
  return sampleEffect(sampleBook);
}

// ---------- 保存 ----------
function save() {
  if (SAMPLE) return;
  try {
    localStorage.setItem(STORE, JSON.stringify(st));
  } catch {
    /* 保存できなくても動く */
  }
}
function restore(): EffectState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!raw || !raw.input || !Array.isArray(raw.monthly) || raw.monthly.length !== CHANNELS.length || !Array.isArray(raw.actual) || raw.actual.length !== CHANNELS.length) return null;
    const s = raw as EffectState;
    for (const k of ["startYear", "startMonth", ...PRE] as const) if (s.input[k] === null) (s.input as any)[k] = NaN;
    if (!Array.isArray(s.manual)) s.manual = CHANNELS.map(() => false);
    if (!Array.isArray(s.notes)) s.notes = [];
    if (!Array.isArray(s.log)) s.log = [];
    s.log = s.log.map((x) => ({ ...emptyLog(), ...x }));
    return s;
  } catch {
    return null;
  }
}

// ---------- 状態 → 画面 ----------
const show = (x: number) => (Number.isFinite(x) ? String(x) : "");
const showCh = (x: number) => (Number.isFinite(x) && x !== 0 ? String(x) : "");
const showN = (x: number | null) => (x === null || x === undefined || !Number.isFinite(x) ? "" : String(x));

function writeForm() {
  const inp = st.input;
  (field("startYear") as HTMLInputElement).value = show(inp.startYear);
  (field("startMonth") as HTMLSelectElement).value = String(inp.startMonth || 4);
  for (const k of PRE) (field(k) as HTMLInputElement).value = k === "common" ? showCh(inp.common) : show(inp[k]);
  inp.channels.forEach((c, i) => KEYS.forEach((k) => ((field(`ch${i}.${k}`) as HTMLInputElement).value = showCh(c[k]))));
  writeMonthly();
  st.actual.forEach((a, i) => ACT_KEYS.forEach((k) => a[k].forEach((v, m) => ((field(`a${i}.${k}.${m}`) as HTMLInputElement).value = showN(v)))));
  writePlaceholders();
  renderLog();
}
function writeMonthly(skip?: string) {
  st.monthly.forEach((m, i) =>
    (["leads", "valid"] as const).forEach((k) =>
      m[k].forEach((v, j) => {
        const name = `m${i}.${k}.${j}`;
        if (name !== skip) (field(name) as HTMLInputElement).value = String(v ?? 0);
      }),
    ),
  );
}
/** 実績の外部費用・人件費の空欄に、計画の月額を薄く出す */
function writePlaceholders() {
  CHANNELS.forEach((_, i) =>
    (["ext", "labor"] as const).forEach((k) => {
      const pm = planMonthly(st, i, k);
      for (let m = 0; m < 12; m++) {
        const f = field(`a${i}.${k}.${m}`) as HTMLInputElement | null;
        if (f) f.placeholder = pm ? fmt(pm, 1) : "";
      }
    }),
  );
}

// 施策ログの表（行の数が変わるので、ここで作る）
function options(list: string[], value: string) {
  const all = value && !list.includes(value) ? [...list, value] : list;
  return `<option value=""></option>${all.map((v) => `<option${v === value ? " selected" : ""}>${esc(v)}</option>`).join("")}`;
}
function renderLog() {
  const tb = document.getElementById("ef-log");
  if (!tb) return;
  const months = monthLabels(st.input.startMonth || 4);
  const n = SAMPLE ? st.log.length : Math.min(LOG_MAX, Math.max(st.log.length, 5));
  while (st.log.length < n) st.log.push(emptyLog());
  const sel = (j: number, k: LogKey, list: string[]) => `<td class="in"><select name="l${j}.${k}" aria-label="${j + 1}行目の${LOG_LABEL[k]}">${options(list, String(st.log[j][k] ?? ""))}</select></td>`;
  const txt = (j: number, k: LogKey) => `<td class="in"><input type="text" name="l${j}.${k}" value="${esc(st.log[j][k] ?? "")}" aria-label="${j + 1}行目の${LOG_LABEL[k]}" /></td>`;
  tb.innerHTML = st.log
    .map(
      (_, j) =>
        `<tr data-l="${j}"><td class="ef-n">${j + 1}</td>${sel(j, "registered", months)}${sel(j, "metric", LOG_METRICS)}${sel(j, "channel", LOG_CHANNELS)}${txt(j, "issue")}${txt(j, "action")}${sel(j, "doMonth", months)}${txt(j, "basis")}${sel(j, "status", LOG_STATUS)}<td class="in"><input type="number" name="l${j}.hours" min="0" step="any" inputmode="decimal" value="${esc(showN(st.log[j].hours))}" aria-label="${j + 1}行目の見込み時間" /></td>${sel(j, "review", LOG_REVIEW)}</tr>`,
    )
    .join("");
  const add = document.getElementById("ef-addrow") as HTMLButtonElement | null;
  if (add) add.hidden = st.log.length >= LOG_MAX;
}

// ---------- 画面 → 状態 ----------
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function onInput(e: Event) {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const name = t.name;
  if (!name) return;
  const inp = st.input;
  let m: RegExpExecArray | null;
  if ((m = /^l(\d+)\.(\w+)$/.exec(name))) {
    const j = Number(m[1]);
    const k = m[2] as LogKey;
    if (!st.log[j]) return;
    if (k === "hours") {
      const v = num(t.value);
      st.log[j].hours = Number.isFinite(v) ? v : null;
    } else (st.log[j] as any)[k] = t.value.trim();
  } else if ((m = /^a(\d)\.(\w+)\.(\d+)$/.exec(name))) {
    const v = num(t.value);
    st.actual[Number(m[1])][m[2] as ActKey][Number(m[3])] = Number.isFinite(v) && v >= 0 ? v : null;
  } else if ((m = /^m(\d)\.(leads|valid)\.(\d+)$/.exec(name))) {
    const i = Number(m[1]);
    const v = num(t.value);
    st.monthly[i][m[2] as "leads" | "valid"][Number(m[3])] = Number.isFinite(v) && v > 0 ? v : 0;
    st.manual[i] = true;
  } else if ((m = /^ch(\d)\.(\w+)$/.exec(name))) {
    const v = num(t.value);
    const i = Number(m[1]);
    inp.channels[i][m[2] as keyof ChannelInput] = Number.isFinite(v) ? v : 0;
    if (m[2] === "leads" || m[2] === "valid") {
      syncMonthly(st);
      writeMonthly();
    }
    if (m[2] === "ext" || m[2] === "labor") writePlaceholders();
  } else if (name === "startMonth") {
    inp.startMonth = Number(t.value);
    updateMonthLabels();
    renderLog();
  } else if (name === "startYear") {
    inp.startYear = num(t.value);
  } else if (name === "common") {
    const v = num(t.value);
    inp.common = Number.isFinite(v) ? v : 0;
  } else if ((PRE as readonly string[]).includes(name)) {
    (inp as any)[name] = num(t.value);
  }
  update();
}

// ---------- 判定の表示 ----------
let lastDiag: EffectDiagnosis | null = null;
let timer = 0;

function setOut(key: string, text: string) {
  const el = form!.querySelector<HTMLElement>(`[data-out="${key}"]`);
  if (el) el.textContent = text;
}
function updateMonthLabels() {
  const labels = monthLabels(st.input.startMonth || 4);
  form!.querySelectorAll<HTMLElement>("[data-mlabel]").forEach((th) => (th.textContent = labels[Number(th.dataset.mlabel)]));
}
function safeCalc() {
  try {
    const inp = st.input;
    if (![inp.price, inp.gmPct, inp.paybackYears].every((v) => Number.isFinite(v) && v > 0)) return null;
    return calc(inp);
  } catch {
    return null;
  }
}

/** すぐ出す計算（合計・率）。判定と診断結果は少し待ってから（打ち手の効果の計算が重いため） */
function update() {
  const r = safeCalc();
  setOut("monthlyProfit", r ? fmt(r.monthlyProfit, 1) : "—");
  setOut("cacLimit", r ? fmt(r.cacLimit, 1) : "—");
  setOut("allowableCpl", r ? fmt(r.allowableCpl, 1) : "—");
  CHANNELS.forEach((_, i) => {
    const c = r?.channels[i];
    const used = st.input.channels[i].leads > 0 || st.input.channels[i].ext > 0 || st.input.channels[i].labor > 0;
    setOut(`cpl${i}`, c && used ? fmt(c.cpl, 1) : "—");
    setOut(`cac${i}`, c && used ? fmt(c.cac, 0) : "—");
  });
  for (const k of KEYS) setOut(`total.${k}`, r ? fmt(r.total[k], 0) : fmt(st.input.channels.reduce((s, c) => s + (c[k] || 0), 0)));
  setOut("total.cpl", r ? fmt(r.total.cpl, 1) : "—");
  setOut("total.cac", r ? fmt(r.total.cac, 0) : "—");
  st.monthly.forEach((m, i) =>
    (["leads", "valid"] as const).forEach((k) => {
      const s = m[k].reduce((a, b) => a + b, 0);
      setOut(`m${i}.${k}.sum`, fmt(s));
      setOut(`m${i}.${k}.diff`, fmt(s - (st.input.channels[i][k] || 0)));
    }),
  );
  st.actual.forEach((a, i) => {
    const sum = (k: ActKey) => a[k].reduce<number>((s, v) => s + (v ?? 0), 0);
    for (const k of ACT_KEYS) {
      const any = a[k].some((v) => v != null);
      setOut(`a${i}.${k}.sum`, any ? fmt(sum(k), k === "ext" || k === "labor" ? 1 : 0) : "—");
    }
    for (let m = 0; m < 12; m++) {
      const l = a.leads[m];
      const v = a.valid[m];
      setOut(`a${i}.rate.${m}`, l && v != null ? pct(v / l) : "");
    }
    const tl = sum("leads");
    setOut(`a${i}.rate.sum`, tl && a.valid.some((v) => v != null) ? pct(sum("valid") / tl) : "—");
  });
  save();
  window.clearTimeout(timer);
  timer = window.setTimeout(judge, 250);
}

function judge() {
  const d = diagnoseEffect(st);
  lastDiag = d;
  // 欄の色
  form!.querySelectorAll("td.is-fix, td.is-check").forEach((td) => td.classList.remove("is-fix", "is-check"));
  form!.querySelectorAll(".bk-mblock.is-fix, .bk-mblock.is-check, tr.is-fix, tr.is-check").forEach((b) => b.classList.remove("is-fix", "is-check"));
  const dots: Partial<Record<Tab, "fix" | "check">> = {};
  const dot = (t: Tab, s: "fix" | "check") => {
    if (dots[t] !== "fix") dots[t] = s;
  };
  for (const [key, s] of Object.entries(d.marks)) {
    let mm: RegExpExecArray | null;
    if ((mm = /^a:(\d)$/.exec(key))) {
      $(`ef-a${mm[1]}`)?.classList.add(`is-${s}`);
      dot("a", s);
    } else if ((mm = /^l:(\d+)$/.exec(key))) {
      form!.querySelector(`tr[data-l="${mm[1]}"]`)?.classList.add(`is-${s}`);
      dot("l", s);
    } else {
      const td = field(key)?.closest("td") as HTMLElement | null;
      td?.classList.add(`is-${s}`);
      if (key.startsWith("a")) dot("a", s);
      else if (key.startsWith("l")) {
        dot("l", s);
        td?.closest("tr")?.classList.add(`is-${s}`);
      }
    }
  }
  (["y", "m", "a", "l"] as Tab[]).forEach((t) => {
    const el = document.getElementById(`ef-dot-${t}`);
    if (!el) return;
    el.hidden = !dots[t];
    el.classList.toggle("check", dots[t] === "check");
  });
  renderPanel(d);
  renderBottom(d);
  if (view === "sheet") renderSheet();
}

const PANEL_MAX = 6;
function renderPanel(d: EffectDiagnosis) {
  const c = d.counts;
  $("bk-c-fix").textContent = String(c.fix);
  $("bk-c-check").textContent = String(c.check);
  $("bk-c-ok").textContent = String(c.ok);
  $("bk-m-fix").textContent = String(c.fix);
  $("bk-m-check").textContent = String(c.check);
  document.querySelectorAll(".bk-counts .fix, .bk-mbar .fix").forEach((e) => e.classList.toggle("on", c.fix > 0));
  document.querySelectorAll(".bk-counts .check, .bk-mbar .check").forEach((e) => e.classList.toggle("on", c.check > 0));
  const wait = $("bk-wait");
  const res = $("bk-res");
  const remain = $("bk-remain");
  if (!d.ready || !d.a) {
    wait.hidden = false;
    wait.textContent = `${d.missing.join("・")}を入れると判定します。`;
    res.hidden = true;
    remain.hidden = true;
    return;
  }
  wait.hidden = true;
  res.hidden = false;
  const a = d.a;

  const rows = a.rows.filter((r) => (r.total.prob ?? 0) >= 0.7);
  $("ef-issues").innerHTML = rows.length
    ? rows
        .slice(0, PANEL_MAX)
        .map((r) => {
          const p = r.total.prob ?? 0;
          return `<div class="bk-row ef-r ${p >= 0.9 ? "is-fix" : "is-check"}"><span>${esc(r.label)}</span><span>${pct(p)}</span></div>`;
        })
        .join("") + (rows.length > PANEL_MAX ? `<p class="ef-empty">ほか${rows.length - PANEL_MAX}件</p>` : "") + `<p class="bk-hint">数字＝期首から計画を下回っている確率（90%以上＝直す、70〜89%＝確認）</p>`
    : `<p class="ef-empty">期首から計画を下回っている確率が70%以上の課題はありません。</p>`;

  const effs = a.effects.filter((f) => f.state === "ok" || f.state === "draft");
  const waiting = a.effects.filter((f) => f.state === "before").length;
  $("ef-effects").innerHTML = effs.length
    ? effs
        .slice(0, PANEL_MAX)
        .map((f) => {
          const v = verdict(f.prob);
          const cls = f.state === "ok" && v.tone === "bad" ? " is-check" : "";
          return `<div class="bk-row ef-r ef-e${cls}"><span>${esc(cut(f.item.action, 40))}</span><span>${esc(v.label)}${f.state === "draft" ? "（参考）" : ""} ${pct(f.prob)}</span></div>`;
        })
        .join("") +
      (effs.length > PANEL_MAX ? `<p class="ef-empty">ほか${effs.length - PANEL_MAX}件</p>` : "") +
      (waiting ? `<p class="ef-empty">実施前 ${waiting}件</p>` : "") +
      `<p class="bk-hint">数字＝打ち手のあとに良くなった確率</p>`
    : `<p class="ef-empty">${a.effects.length ? "打ち手の実施月の実績が入ると出ます。" : "施策ログに打ち手と実施月を入れると出ます。"}</p>`;

  const list = (status: "fix" | "check", head: string) => {
    const its = d.items.filter((i) => i.status === status);
    if (!its.length) return "";
    return (
      `<p class="bk-li-h">${head}</p>` +
      its
        .map(
          (it) =>
            `<button type="button" class="bk-item" ${it.jump ? `data-jump="${esc(it.jump)}"` : "disabled"}><span class="bk-tg ${status}">${status === "fix" ? "直す" : "確認"}</span>${esc(it.reason)}${
              it.jump ? ` <span class="bk-go">→ 該当の欄へ</span>` : ""
            }</button>`,
        )
        .join("")
    );
  };
  $("bk-list").innerHTML = list("fix", "直すところ") + list("check", "確認するところ") || `<p class="bk-li-h">直すところ</p><p class="bk-none">直すところも、確認するところもありません。</p>`;
  remain.hidden = !c.fix;
  remain.textContent = c.fix ? `直すところが${c.fix}つ残っています（このままでもダウンロードできます）` : "";
}

function renderBottom(d: EffectDiagnosis) {
  const el = document.getElementById("ef-report");
  const wait = document.getElementById("ef-report-wait");
  if (!el || !wait) return;
  if (!d.ready || !d.a) {
    wait.hidden = false;
    wait.textContent = `${d.missing.join("・")}を入れると、ここに月別進捗状況・推移と打ち手・打ち手の効果のグラフが出ます。`;
    el.innerHTML = "";
    return;
  }
  wait.hidden = true;
  renderReport(el, d.a);
}

// ---------- タブと移動 ----------
let curTab: Tab = "y";
function tab(which: Tab) {
  curTab = which;
  (["y", "m", "a", "l"] as Tab[]).forEach((t) => {
    $(`bk-tab-${t}`).setAttribute("aria-selected", String(t === which));
    $(`bk-pane-${t}`).hidden = t !== which;
  });
  $("bk-tab-n").textContent = TAB_NOTE[which];
}
function flash(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("is-flash");
  void el.offsetWidth;
  el.classList.add("is-flash");
}
function jump(key: string) {
  if (view !== "diag") setView("diag");
  let m: RegExpExecArray | null;
  if (key === "log") {
    tab("l");
    $("bk-pane-l").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if ((m = /^a:(\d)$/.exec(key))) {
    tab("a");
    $(`ef-a${m[1]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if ((m = /^l:(\d+)$/.exec(key))) {
    tab("l");
    flash(form!.querySelector<HTMLElement>(`tr[data-l="${m[1]}"]`));
    return;
  }
  tab(key.startsWith("a") ? "a" : key.startsWith("l") ? "l" : "y");
  const f = field(key) as HTMLInputElement | null;
  const td = (f?.closest("td") as HTMLElement | null) ?? null;
  if (!f || !td) return;
  flash(td);
  window.setTimeout(() => f.focus({ preventScroll: true }), 350);
}

// ---------- 表示の切り替え（サンプル画面：診断画面／KPI管理表の完成イメージ） ----------
let view: "diag" | "sheet" = "diag";
let sheetTab: "act" | "log" | "diag" = "act";

function sheetActHtml() {
  const labels = monthLabels(st.input.startMonth || 4);
  let h = `<p class="bk-pv-title">毎月の実績入力</p><p class="bk-pv-n">水色＝入力　灰色＝自動計算　単位：万円</p>`;
  CHANNELS.forEach((name, i) => {
    const a = st.actual[i];
    if (!a.leads.some((v) => v != null)) return;
    const rows = ACT_KEYS.map((k) => {
      const cells = a[k]
        .map((v, m) => {
          if ((k === "ext" || k === "labor") && v == null) return `<td class="calc">${a.leads[m] != null ? fmt(planMonthly(st, i, k), 1) : ""}</td>`;
          return `<td class="in">${v == null ? "" : fmt(v, k === "ext" || k === "labor" ? 1 : 0)}</td>`;
        })
        .join("");
      return `<tr><td class="lb">${ACT_LABEL[k]}</td>${cells}</tr>`;
    }).join("");
    h += `<p class="bk-pv-h">${esc(name)}</p><div class="bk-tw"><table class="bk-t bk-pv bk-pv-m ef-pv-a"><tbody><tr><th></th>${labels.map((l) => `<th>${l}</th>`).join("")}</tr>${rows}</tbody></table></div>`;
  });
  return h;
}
function sheetLogHtml() {
  const head = ["登録月", "狙う指標", "チャネル", "課題", "打ち手", "実施月", "根拠", "状態", "見込み時間", "振り返り"];
  const rows = st.log
    .filter((x) => x.action)
    .map((x) => `<tr>${LOG_KEYS.map((k) => `<td class="in">${esc(k === "hours" ? showN(x.hours) : (x as any)[k])}</td>`).join("")}</tr>`)
    .join("");
  return `<p class="bk-pv-title">施策ログ</p><p class="bk-pv-n">水色＝入力　単位：時間</p><div class="bk-tw"><table class="bk-t bk-pv bk-pv-wide ef-sheet-log"><tbody><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr>${rows}</tbody></table></div>`;
}
function sheetDiagHtml() {
  const d = lastDiag ?? diagnoseEffect(st);
  if (!d.ready || !d.a) return `<p class="bk-pv-title">診断結果</p><p class="bk-pv-p">${esc(d.missing.join("・"))}が入っていないため、診断していません。</p>`;
  const a = d.a;
  let h = `<p class="bk-pv-title">施策効果の診断</p><p class="bk-pv-n">ダウンロードした日の判定を値で書きます。翌月の実績を入れたあとは、施策効果診断Kitで読み込んで診断し直してください</p>`;
  h += `<div class="bk-pv-cnt"><span class="${d.counts.fix ? "fix" : ""}">直す ${d.counts.fix}</span><span class="${d.counts.check ? "check" : ""}">確認 ${d.counts.check}</span><span>問題なし ${d.counts.ok}</span></div><p class="bk-pv-p">結論：${esc(d.conclusion)}</p>`;
  h += `<p class="bk-pv-h">計画を下回っている課題（期首から）</p><div class="bk-tw"><table class="bk-t bk-pv"><tbody><tr><th>課題</th><th>計画比</th><th>下回っている確率</th><th>続いた月数</th><th>判定</th></tr>`;
  for (const r of a.rows.filter((x) => x.total.prob != null)) {
    const p = r.total.prob ?? 0;
    const k = p >= 0.9 ? "fix" : p >= 0.7 ? "check" : "calc";
    h += `<tr><td class="lb">${esc(r.label)}</td><td class="calc">${pct(r.total.ratio)}</td><td class="calc">${pct(p)}</td><td class="calc">${r.streak}</td><td class="${k}">${p >= 0.9 ? "直す" : p >= 0.7 ? "確認" : "—"}</td></tr>`;
  }
  h += `</tbody></table></div><p class="bk-pv-h">打ち手の効果</p><div class="bk-tw"><table class="bk-t bk-pv bk-pv-wide ef-sheet-log"><tbody><tr><th>実施月</th><th>打ち手</th><th>チャネル・狙う指標</th><th>良くなった確率</th><th>見立て</th><th>振り返り</th></tr>`;
  for (const f of a.effects) {
    const v = verdict(f.prob);
    const j = f.state === "ok" ? v.label : f.state === "draft" ? `${v.label}（参考値）` : f.state === "before" ? "実施前" : "比べられない";
    h += `<tr><td class="calc">${esc(f.item.doMonth || "—")}</td><td class="lb">${esc(f.item.action)}</td><td class="calc">${esc(`${f.item.channel}・${f.item.metric}`)}</td><td class="calc">${f.prob == null ? "—" : pct(f.prob)}</td><td class="${f.state === "ok" && v.tone === "bad" ? "check" : "calc"}">${esc(j)}</td><td class="${f.mismatch ? "check" : "calc"}">${esc(f.item.review || f.item.status)}</td></tr>`;
  }
  h += `</tbody></table></div><p class="bk-pv-h">直すところ・確認するところ</p><ul class="bk-pv-list">`;
  const list = d.items.filter((it) => it.status === "fix" || it.status === "check");
  h += list.length
    ? list.map((it) => `<li><span class="bk-tg ${it.status}">${it.status === "fix" ? "直す" : "確認"}</span>【${esc(GROUP_LABEL_EFFECT[it.group])}】${esc(it.reason)}${it.todo ? `　→ ${esc(it.todo)}` : ""}</li>`).join("")
    : "<li>直すところも、確認するところもありません。</li>";
  return h + "</ul>";
}
function renderSheet() {
  $("bk-sheet").innerHTML = sheetTab === "act" ? sheetActHtml() : sheetTab === "log" ? sheetLogHtml() : sheetDiagHtml();
  (["act", "log", "diag"] as const).forEach((t) => document.getElementById(`ef-s-${t}`)?.setAttribute("aria-selected", String(sheetTab === t)));
}
function setView(v: "diag" | "sheet") {
  if (!document.getElementById("bk-v-diag")) return;
  view = v;
  $("bk-v-diag").setAttribute("aria-selected", String(v === "diag"));
  $("bk-v-sheet").setAttribute("aria-selected", String(v === "sheet"));
  $("bk-diagview").hidden = v !== "diag";
  $("ef-report-wrap").hidden = v !== "diag";
  $("bk-mbar").hidden = v !== "diag";
  $("bk-sheetview").hidden = v !== "sheet";
  $("bk-v-note").textContent = v === "diag" ? "水色の欄を直すと、右の判定と下の診断結果がすぐ変わります" : "ダウンロードするExcelと同じ中身です";
  if (v === "sheet") renderSheet();
}

// ---------- 入口 → 入力の画面 ----------
function renderNotes() {
  const box = document.getElementById("bk-notes");
  if (!box) return;
  if (!st.notes.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = `<button type="button" class="bk-link" id="bk-notes-x">閉じる</button><b>読み込みのときのお知らせ</b><ul>${st.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  $("bk-notes-x").addEventListener("click", () => {
    box.hidden = true;
    st.notes = [];
    save();
  });
}
function goInput(next: EffectState) {
  st = next;
  save();
  location.href = INPUT_URL;
}
function openWork(next: EffectState, v: "diag" | "sheet" = "diag", t: Tab = "y") {
  st = next;
  writeForm();
  updateMonthLabels();
  renderNotes();
  tab(t);
  setView(v);
  update();
}
function showIntroError(msg: string) {
  const el = $("bk-err");
  el.textContent = msg;
  el.hidden = !msg;
}
async function handleFile(file: File) {
  showIntroError("");
  $("bk-busy").hidden = false;
  try {
    const book = await readBook(file, READ_SHEETS);
    goInput(stateFromEffectBook(book, file.name));
  } catch (e) {
    showIntroError(e instanceof ReadError ? e.message : "ファイルを読めませんでした。KPI管理表（M-B-04）の .xlsx か確かめてください。");
    console.error(e);
  } finally {
    $("bk-busy").hidden = true;
  }
}

// ---------- ダウンロード ----------
let zipLib: Promise<any> | null = null;
function loadZip(): Promise<any> {
  if ((window as any).JSZip) return Promise.resolve((window as any).JSZip);
  zipLib ??= new Promise((ok, ng) => {
    const s = document.createElement("script");
    s.src = LIB_ZIP;
    s.onload = () => ok((window as any).JSZip);
    s.onerror = () => {
      zipLib = null;
      ng(new Error("zip"));
    };
    document.head.appendChild(s);
  });
  return zipLib;
}

async function download() {
  const err = $("bk-dlerr");
  err.hidden = true;
  window.clearTimeout(timer);
  const d = diagnoseEffect(st);
  lastDiag = d;
  const inp = st.input;
  const bad: string[] = [];
  if (!(Number.isInteger(inp.startYear) && inp.startYear >= 2000 && inp.startYear <= 2100)) bad.push("期首");
  bad.push(...d.missing.filter((m) => !m.startsWith("毎月の実績")));
  if (bad.length) {
    err.textContent = `${bad.join("・")}を入れてから、ダウンロードしてください。`;
    err.hidden = false;
    jump(bad[0] === "期首" ? "startYear" : "goal");
    return;
  }
  const btn = $<HTMLButtonElement>("bk-dl");
  let handle: any = null;
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      handle = await picker({ suggestedName: effectFileName(st), types: [{ description: "Excel", accept: { [XLSX_MIME]: [".xlsx"] } }] });
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
      handle = null;
    }
  }
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "作っています…";
  let saved = false;
  try {
    const [JSZip, buf] = await Promise.all([
      loadZip(),
      fetch(TEMPLATE).then((r) => {
        if (!r.ok) throw new Error("template");
        return r.arrayBuffer();
      }),
    ]);
    const zip = await JSZip.loadAsync(buf);
    const files: Record<string, string> = {};
    for (const n of Object.keys(zip.files)) if (/\.(xml|rels)$/.test(n)) files[n] = await zip.file(n).async("string");
    const changed = fillEffectWorkbook(files, st, d);
    for (const [n, xml] of Object.entries(changed)) zip.file(n, xml);
    const blob: Blob = await zip.generateAsync({ type: "blob", mimeType: XLSX_MIME, compression: "DEFLATE" });
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = effectFileName(st);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    saved = true;
  } catch (e) {
    console.error(e);
    err.textContent = "ファイルを作れませんでした。通信を確かめて、もう一度お試しください。";
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = saved && handle ? "保存しました" : label;
    if (saved && handle) window.setTimeout(() => (btn.textContent = label), 2500);
  }
}

// ---------- つなぐ（入力の画面・サンプル画面） ----------
const hasData = () => {
  const inp = st.input;
  return (
    [inp.goal, inp.price, inp.gmPct, inp.paybackYears, inp.leadTime].some((v) => Number.isFinite(v)) ||
    inp.channels.some((c) => KEYS.some((k) => c[k] > 0)) ||
    st.actual.some((a) => ACT_KEYS.some((k) => a[k].some((v) => v != null))) ||
    st.log.some((x) => x.action)
  );
};

if (form) {
  form.addEventListener("input", (e) => {
    if ((e.target as HTMLElement).tagName !== "SELECT") onInput(e);
  });
  form.addEventListener("change", (e) => {
    if ((e.target as HTMLElement).tagName === "SELECT") onInput(e);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-reset]");
    if (!b) return;
    resetMonthly(st, Number(b.dataset.reset));
    writeMonthly();
    update();
  });
  form.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab as Tab)));
  $("ef-addrow")?.addEventListener("click", () => {
    if (st.log.length >= LOG_MAX) return;
    st.log.push(emptyLog());
    renderLog();
    save();
    form!.querySelector<HTMLElement>(`tr[data-l="${st.log.length - 1}"] select`)?.focus();
  });
  $("bk-panel")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-jump]");
    if (b?.dataset.jump) jump(b.dataset.jump);
  });
  $("bk-mopen")?.addEventListener("click", () => $("bk-panel").scrollIntoView({ behavior: "smooth", block: "start" }));
  $("bk-dl")?.addEventListener("click", download);
  $("bk-v-diag")?.addEventListener("click", () => setView("diag"));
  $("bk-v-sheet")?.addEventListener("click", () => setView("sheet"));
  (["act", "log", "diag"] as const).forEach((t) =>
    document.getElementById(`ef-s-${t}`)?.addEventListener("click", () => {
      sheetTab = t;
      renderSheet();
    }),
  );
  $("bk-example")?.addEventListener("click", async () => {
    if (hasData() && !window.confirm("いまの入力を、記入例（架空の会社のKPI管理表）に置きかえます。よろしいですか？")) return;
    openWork(await loadSample(), "diag", curTab);
  });
  $("bk-clear")?.addEventListener("click", () => {
    if (!window.confirm("入力をすべて消します。よろしいですか？")) return;
    openWork(emptyEffect());
  });
}

if (MODE === "intro") {
  $("bk-start")?.addEventListener("click", () => {
    const saved = restore();
    goInput(saved ? { ...saved, notes: [] } : emptyEffect());
  });
  const aiOpen = document.getElementById("bk-ai-open") as HTMLButtonElement | null;
  aiOpen?.addEventListener("click", () => {
    const p = $("bk-ai");
    p.hidden = !p.hidden;
    aiOpen.setAttribute("aria-expanded", String(!p.hidden));
    if (!p.hidden) p.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("bk-copy")?.addEventListener("click", async () => {
    const btn = $("bk-copy");
    const text = $("bk-prompt").textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const range = document.createRange();
      range.selectNodeContents($("bk-prompt"));
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand("copy");
    }
    btn.textContent = "コピーしました";
    window.setTimeout(() => (btn.textContent = "プロンプトをコピー"), 2500);
  });
  $("bk-import")?.addEventListener("click", () => {
    showIntroError("");
    const text = $<HTMLTextAreaElement>("bk-paste").value;
    if (!text.trim()) {
      showIntroError("AIが返した結果を貼りつけてください。");
      return;
    }
    try {
      goInput(stateFromEffectAi(text));
    } catch (e) {
      showIntroError(e instanceof ReadError ? e.message : "読み込めませんでした。");
    }
  });
  const fileInput = document.getElementById("bk-file") as HTMLInputElement | null;
  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) handleFile(f);
    fileInput.value = "";
  });
  const drop = document.getElementById("bk-drop");
  drop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop?.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
}

// はじめの表示
(async () => {
  const q = new URLSearchParams(location.search);
  if (SAMPLE) openWork(await loadSample(), q.get("tab") === "sheet" ? "sheet" : "diag", "a");
  else if (MODE === "input") openWork(q.get("sample") === "1" ? await loadSample() : (restore() ?? emptyEffect()));
  else if (q.get("sample") === "1") location.replace(`${INPUT_URL}?sample=1`);
})();
