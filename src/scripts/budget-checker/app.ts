// src/scripts/budget-checker/app.ts
//
// 予算案診断キット・KPI妥当性診断キットの画面。判定と状態は src/lib/budgetCheck.ts、Excelは src/lib/budget-sheet.ts。
// #bk の data-kit でキット（budget／kpi、違いは src/lib/planKits.ts）、data-mode で動きを分ける
// - intro（/tools/budget-checker・/tools/kpi-check）：入口3つ（AIの案／.xlsx／画面で入力）。読み込んだ数字を localStorage に入れて input に移る
// - input（…/input）：入力の画面（左＝入力、右＝判定）。localStorage から始め、入力のたびに判定し直して保存する
// - sample（…/sample）：記入例だけを表示する（保存・ダウンロードはしない）
// 作る系のKit（予算作成Kit data-kit="make"・KPI管理表作成Kit data-kit="kpimake"、2026-10-30）：今期の実績と、自動配分の欄（上書き可）がある（src/lib/budgetMake.ts）
//   予算作成Kitの入口は「画面で作成をはじめる」だけ。KPI管理表作成KitはAI・.xlsxの入口もあり、読んだ数字は toMake で作る系の状態にする
// 2026-11-01 予算案診断Kit（data-kit="budget"）だけ、画面を5ステップに分けた（FLOW）：
//   入口 → 入力（判定は出さない、画面で入力する人だけ）→ ② 診断・修正（/check）→ ③ 最終チェック（/final）→ ④⑤ 完了（/done）
//   AIの案・.xlsxを読み込んだ人は入力を飛ばして /check に移る。②〜⑤の画面は src/scripts/budget-checker/flow.ts
// 入れた数字やファイルはサーバーに送らない
import {
  BASE_RATES,
  CHANNELS,
  ReadError,
  diagnoseBudget,
  emptyState,
  fmt,
  monthLabels,
  pct,
  resetMonthly,
  sampleState,
  stateFromAi,
  stateFromBook,
  syncMonthly,
  type BudgetDiagnosis,
  type BudgetState,
  type ChannelInput,
} from "@/lib/budgetCheck";
import { calc } from "@/lib/kpi-sheet-maker";
import { clearMemo } from "@/lib/budgetFlow";
import { pickSaveTarget, writePlanFile } from "@/scripts/budget-checker/download";
import { KITS, readSheets, type KitId } from "@/lib/planKits";
import { readBook } from "@/scripts/kpi-analysis/xlsx";
import { diagHtml, sheetHtml } from "@/scripts/budget-checker/preview";
import { AUTO_KEYS, applyMake, diagnoseMake, makeEmpty, makeSample, needCounts, rates, resetOvr, toMake, type AutoKey, type MakeState } from "@/lib/budgetMake";

const KIT = KITS[((document.getElementById("bk")?.dataset.kit ?? "budget") as KitId)] ?? KITS.budget;
const MAKE = KIT.maker;
const STORE = KIT.store;
const TEMPLATE = KIT.template;
const KEYS: (keyof ChannelInput)[] = ["leads", "valid", "deals", "wins", "ext", "labor"];
const PRE = ["goal", "price", "gmPct", "paybackYears", "leadTime", "common"] as const;

const INPUT_URL = `${KIT.path}/input`;
/** 予算案診断Kitだけ、入力のあとは ② 診断・修正（/check）に移る */
const FLOW = KIT.id === "budget";
const CHECK_URL = `${KIT.path}/check`;
const NO_MARKS = !!document.querySelector(".bk-grid.is-flow");

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MODE = (document.getElementById("bk")?.dataset.mode ?? "intro") as "intro" | "input" | "sample";
const SAMPLE = MODE === "sample";
const form = $<HTMLFormElement>("bk-form") as HTMLFormElement | null;
const field = (name: string) => form!.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

let st: BudgetState = MAKE ? makeEmpty() : emptyState();
/** 予算作成Kitの状態（MAKE のときだけ使う） */
const ms = () => st as MakeState;
const blank = (): BudgetState => (MAKE ? makeEmpty() : emptyState());
const sample = (): BudgetState => (MAKE ? makeSample() : sampleState());
const diag = (): BudgetDiagnosis => (MAKE ? diagnoseMake(ms(), KIT) : diagnoseBudget(st, KIT));
const ACT_KEYS = ["leads", "valid", "deals", "wins"] as const;

// ---------- 保存 ----------
function save() {
  if (SAMPLE) return;
  try {
    localStorage.setItem(STORE, JSON.stringify(st));
  } catch {
    /* 保存できなくても動く */
  }
}
function restore(): BudgetState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!raw || !raw.input || !Array.isArray(raw.monthly) || raw.monthly.length !== CHANNELS.length) return null;
    const s = raw as BudgetState;
    // JSON では NaN が null になるので戻す
    for (const k of ["startYear", "startMonth", ...PRE] as const) if (s.input[k] === null) (s.input as any)[k] = NaN;
    if (!Array.isArray(s.manual)) s.manual = CHANNELS.map(() => false);
    if (!Array.isArray(s.notes)) s.notes = [];
    if (MAKE) {
      const m = s as MakeState;
      const a = (m.actual ?? {}) as Partial<MakeState["actual"]>;
      m.actual = { leads: a.leads ?? NaN, valid: a.valid ?? NaN, deals: a.deals ?? NaN, wins: a.wins ?? NaN };
      if (!Array.isArray(m.ovr) || m.ovr.length !== CHANNELS.length) m.ovr = CHANNELS.map(() => ({ valid: false, deals: false, wins: false }));
      applyMake(m);
    }
    return s;
  } catch {
    return null;
  }
}

// ---------- 状態 → 画面 ----------
const show = (x: number) => (Number.isFinite(x) ? String(x) : "");
const showCh = (x: number) => (Number.isFinite(x) && x !== 0 ? String(x) : "");

function writeForm() {
  const inp = st.input;
  (field("startYear") as HTMLInputElement).value = show(inp.startYear);
  (field("startMonth") as HTMLSelectElement).value = String(inp.startMonth || 4);
  for (const k of PRE) (field(k) as HTMLInputElement).value = k === "common" ? showCh(inp.common) : show(inp[k]);
  inp.channels.forEach((c, i) => KEYS.forEach((k) => ((field(`ch${i}.${k}`) as HTMLInputElement).value = showCh(c[k]))));
  if (MAKE) {
    for (const k of ACT_KEYS) (field(`act.${k}`) as HTMLInputElement).value = show(ms().actual[k]);
    writeAuto();
  }
  writeMonthly();
}
/** 予算作成Kit：自動配分の欄の数字と、上書きの印 */
function writeAuto(skip?: string) {
  if (!MAKE) return;
  st.input.channels.forEach((c, i) =>
    AUTO_KEYS.forEach((k) => {
      const name = `ch${i}.${k}`;
      const f = field(name) as HTMLInputElement | null;
      if (!f) return;
      if (name !== skip) f.value = showCh(c[k]);
      f.closest("td")?.classList.toggle("is-ovr", ms().ovr[i][k]);
    }),
  );
}
function writeMonthly(skip?: string) {
  st.monthly.forEach((m, i) =>
    (["leads", "valid"] as const).forEach((k) =>
      m[k].forEach((v, j) => {
        const name = `m${i}.${k}.${j}`;
        if (name === skip) return;
        (field(name) as HTMLInputElement).value = String(v ?? 0);
      }),
    ),
  );
}

// ---------- 画面 → 状態 ----------
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function onInput(e: Event) {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const name = t.name;
  if (!name) return;
  const inp = st.input;
  let m: RegExpExecArray | null;
  if ((m = /^m(\d)\.(leads|valid)\.(\d+)$/.exec(name))) {
    const i = Number(m[1]);
    const v = num(t.value);
    st.monthly[i][m[2] as "leads" | "valid"][Number(m[3])] = Number.isFinite(v) && v > 0 ? v : 0;
    st.manual[i] = true;
  } else if ((m = /^act\.(leads|valid|deals|wins)$/.exec(name)) && MAKE) {
    ms().actual[m[1] as (typeof ACT_KEYS)[number]] = num(t.value);
    applyMake(ms());
    writeAuto();
    writeMonthly();
  } else if ((m = /^ch(\d)\.(\w+)$/.exec(name))) {
    const v = num(t.value);
    const i = Number(m[1]);
    inp.channels[i][m[2] as keyof ChannelInput] = Number.isFinite(v) ? v : 0;
    if (MAKE) {
      // 自動配分の欄を手で入れたら上書き。空にしたら自動に戻す
      if ((AUTO_KEYS as string[]).includes(m[2])) ms().ovr[i][m[2] as AutoKey] = t.value.trim() !== "";
      applyMake(ms());
      writeAuto(name);
      writeMonthly();
    } else if (m[2] === "leads" || m[2] === "valid") {
      syncMonthly(st);
      writeMonthly();
    }
  } else if (name === "startMonth") {
    inp.startMonth = Number(t.value);
    updateMonthLabels();
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
let lastDiag: BudgetDiagnosis | null = null;

function setOut(key: string, text: string) {
  const el = form!.querySelector<HTMLElement>(`[data-out="${key}"]`);
  if (el) el.textContent = text;
}

function updateMonthLabels() {
  const labels = monthLabels(st.input.startMonth || 4);
  form!.querySelectorAll<HTMLElement>("[data-mlabel]").forEach((th) => (th.textContent = labels[Number(th.dataset.mlabel)]));
}

function update() {
  const d = diag();
  lastDiag = d;
  if (MAKE) updateMake();

  // 自動計算の欄（前提がそろわなくても、出せるものは出す）
  const r = d.r ?? safeCalc();
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

  // 欄の色
  form!.querySelectorAll("td.is-fix, td.is-check").forEach((td) => td.classList.remove("is-fix", "is-check"));
  document.querySelectorAll(".bk-mblock").forEach((b) => b.classList.remove("is-fix", "is-check"));
  let mdot: "fix" | "check" | null = null;
  // 予算案診断Kitの入力の画面（判定なし）では、欄に色を付けない（判定は ② 診断・修正で出す）
  const marks = NO_MARKS ? {} : d.marks;
  for (const [key, s] of Object.entries(marks)) {
    if (key.startsWith("m:")) {
      $(`bk-m${key.slice(2)}`)?.classList.add(`is-${s}`);
      if (mdot !== "fix") mdot = s;
      continue;
    }
    const td = (field(key)?.closest("td") as HTMLElement | null) ?? form!.querySelector<HTMLElement>(`[data-out="${key}"]`);
    td?.classList.add(`is-${s}`);
  }
  const dot = $("bk-mdot");
  dot.hidden = !mdot;
  dot.classList.toggle("check", mdot === "check");

  renderPanel(d);
  if (view === "sheet") renderSheet();
  save();
}

// 予算作成Kit：今期の率・来期に必要な数・必要との差
function updateMake() {
  const m = ms();
  const r = rates(m.actual);
  const p = (v: number, ok: boolean) => (ok ? pct(v) : "—");
  setOut("act.validRate", p(r.valid, r.fromActual.valid));
  setOut("act.dealRate", p(r.deal, r.fromActual.deal));
  setOut("act.winRate", p(r.win, r.fromActual.win));
  const need = needCounts(m);
  const tot = (k: (typeof ACT_KEYS)[number]) => st.input.channels.reduce((s, c) => s + (c[k] || 0), 0);
  for (const k of ACT_KEYS) {
    setOut(`need.${k}`, need ? fmt(need[k]) : "—");
    const el = form!.querySelector<HTMLElement>(`[data-out="diff.${k}"]`);
    if (!el) continue;
    const diff = need ? tot(k) - need[k] : null;
    el.textContent = diff === null ? "—" : `${diff >= 0 ? "+" : ""}${fmt(diff)}`;
    el.classList.toggle("is-short", diff !== null && diff < 0);
  }
  const all = r.fromActual.valid && r.fromActual.deal && r.fromActual.win;
  const none = !r.fromActual.valid && !r.fromActual.deal && !r.fromActual.win;
  $("bk-rate-n").textContent =
    "受注数＝売上目標÷平均受注単価。そこから今期の率でさかのぼります。" +
    (all
      ? ""
      : none
        ? `今期の実績が空欄なので、基本モデルの率（${pct(BASE_RATES.valid)}・${pct(BASE_RATES.deal)}・${pct(BASE_RATES.win)}）を使っています`
        : "今期の実績が足りない率は、基本モデルの率を使っています");
}

// ---------- 表示の切り替え（診断画面／年間予算表の完成イメージ） ----------
let view: "diag" | "sheet" = "diag";
let sheetTab: "main" | "diag" = "main";

function renderSheet() {
  const d = lastDiag ?? diag();
  $("bk-sheet").innerHTML = sheetTab === "main" ? sheetHtml(st, KIT) : diagHtml(st, d, new Date(), KIT);
  $("bk-s-main").setAttribute("aria-selected", String(sheetTab === "main"));
  $("bk-s-diag").setAttribute("aria-selected", String(sheetTab === "diag"));
}

function setView(v: "diag" | "sheet") {
  if (!document.getElementById("bk-v-diag")) return;
  view = v;
  $("bk-v-diag").setAttribute("aria-selected", String(v === "diag"));
  $("bk-v-sheet").setAttribute("aria-selected", String(v === "sheet"));
  $("bk-diagview").hidden = v !== "diag";
  $("bk-mbar").hidden = v !== "diag";
  $("bk-sheetview").hidden = v !== "sheet";
  $("bk-v-note").textContent = v === "diag" ? "水色の欄を直すと、右の判定がすぐ変わります" : "ダウンロードするExcelと同じ中身です";
  if (v === "sheet") renderSheet();
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

const PRE_HINT: Record<string, string> = {
  "チャネル（どれか1つはリード数を入れてください）": "どれかのチャネルのリード数",
  マーケ経由の売上目標: "売上目標",
  平均受注単価: "平均受注単価",
  粗利率: "粗利率",
  回収期間: "回収期間",
  リードタイム: "リードタイム",
  共通費: "共通費",
};

function meter(label: string, now: string, ref: string, ratio: number, tone: "" | "fix" | "check") {
  const w = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100;
  return `<div class="bk-row"><span>${esc(label)}</span><span>${esc(now)} ／ ${esc(ref)}</span></div><div class="bk-meter ${tone}"><i style="width:${w}%"></i></div>`;
}

function renderPanel(d: BudgetDiagnosis) {
  const c = d.counts;
  $("bk-c-fix").textContent = String(c.fix);
  $("bk-c-check").textContent = String(c.check);
  $("bk-c-ok").textContent = String(c.ok);
  // 下の帯（スマホ）は、予算案診断Kitの入力の画面にはない
  const mf = document.getElementById("bk-m-fix");
  const mc = document.getElementById("bk-m-check");
  if (mf) mf.textContent = String(c.fix);
  if (mc) mc.textContent = String(c.check);
  document.querySelectorAll(".bk-counts .fix, .bk-mbar .fix").forEach((e) => e.classList.toggle("on", c.fix > 0));
  document.querySelectorAll(".bk-counts .check, .bk-mbar .check").forEach((e) => e.classList.toggle("on", c.check > 0));

  const wait = $("bk-wait");
  const res = $("bk-res");
  const remain = $("bk-remain");
  if (!d.ready || !d.r) {
    wait.hidden = false;
    wait.innerHTML = `${d.missing.map((m) => esc(PRE_HINT[m] ?? m)).join("・")}を入れると判定します。`;
    res.hidden = true;
    remain.hidden = true;
    return;
  }
  wait.hidden = true;
  res.hidden = false;
  const r = d.r;
  const inp = st.input;

  $("bk-goal").innerHTML = (
    [
      ...(MAKE ? ([["リード数", "leads"]] as const) : []),
      ["有効リード数", "valid"],
      ["商談数", "deals"],
      ["受注数", "wins"],
    ] as const
  )
    .map(([label, k]) => meter(label, fmt(r.plan[k]), `必要 ${fmt(r.need[k])}`, r.need[k] ? r.plan[k] / r.need[k] : 1, r.short[k] ? "fix" : ""))
    .join("");

  const limitMonths = inp.paybackYears * 12;
  const cacOver = r.total.cac !== null && r.total.cac > r.cacLimit + 1e-9;
  $("bk-cost").innerHTML =
    (r.total.cac === null
      ? `<div class="bk-row"><span>CAC</span><span>—</span></div>`
      : meter("CAC", fmt(r.total.cac), `上限 ${fmt(r.cacLimit)}`, r.cacLimit ? r.total.cac / r.cacLimit : 0, cacOver ? "check" : "") +
        meter("回収期間", fmt(r.total.paybackMonths, 1), `${fmt(limitMonths, 1)}か月`, limitMonths ? (r.total.paybackMonths ?? 0) / limitMonths : 0, cacOver ? "check" : "")) +
    `<div class="bk-row"><span>ROI（1年）</span><span>${esc(pct(r.roi))}</span></div>`;

  // 率は目安の範囲か（KPI妥当性診断キットだけ。目安は基本モデルの安定期、半分未満・2倍超で「確認」）
  const rateBox = document.getElementById("bk-rate");
  if (rateBox) {
    const rows = [
      ["有効リード率", r.total.validRate, BASE_RATES.valid],
      ["商談化率", r.total.dealRate, BASE_RATES.deal],
      ["受注率", r.total.winRate, BASE_RATES.win],
    ] as const;
    rateBox.innerHTML = rows
      .map(([label, v, base]) => {
        const out = v !== null && (v / base < 0.5 - 1e-9 || v / base > 2 + 1e-9);
        return `<div class="bk-row${out ? " is-check" : ""}"><span>${esc(label)}</span><span>${esc(pct(v))} ／ 目安 ${esc(pct(base))}</span></div>`;
      })
      .join("");
  }

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
  const html = list("fix", "直すところ") + list("check", "確認するところ");
  $("bk-list").innerHTML = html || `<p class="bk-li-h">直すところ</p><p class="bk-none">直すところも、確認するところもありません。</p>`;

  remain.hidden = !c.fix;
  remain.textContent = c.fix ? `直すところが${c.fix}つ残っています（このままでもダウンロードできます）` : "";
}

// ---------- タブと移動 ----------
function tab(which: "y" | "m") {
  $("bk-tab-y").setAttribute("aria-selected", String(which === "y"));
  $("bk-tab-m").setAttribute("aria-selected", String(which === "m"));
  $("bk-pane-y").hidden = which !== "y";
  $("bk-pane-m").hidden = which !== "m";
  $("bk-tab-n").textContent =
    which === "y" ? "いま表示中：年間。入力が終わったら「2 月別で調整」を押してください" : "いま表示中：月別。年間÷12が入っています。直したい月だけ変えてください";
}

function jump(key: string) {
  if (view !== "diag") setView("diag");
  let target: HTMLElement | null;
  if (key.startsWith("m:")) {
    tab("m");
    target = $(`bk-m${key.slice(2)}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  tab("y");
  const f = field(key) as HTMLInputElement | null;
  target = (f?.closest("td") as HTMLElement | null) ?? null;
  if (!f || !target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("is-flash");
  void target.offsetWidth;
  target.classList.add("is-flash");
  window.setTimeout(() => f.focus({ preventScroll: true }), 350);
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

// 入口：読み込んだ数字を保存して、入力の画面に移る（予算案診断Kitで読み込んだときは ② 診断・修正へ）
function goInput(next: BudgetState, to = INPUT_URL) {
  st = next;
  save();
  if (FLOW && next.source !== "form") clearMemo(KIT); // 新しい予算案。前の「修正済み」「確認済み」は消す
  location.href = to;
}

// 入力の画面・見本：数字を画面に入れて判定する
function openWork(next: BudgetState, v: "diag" | "sheet" = "diag") {
  st = next;
  writeForm();
  updateMonthLabels();
  renderNotes();
  tab("y");
  sheetTab = "main";
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
    const book = await readBook(file, readSheets(KIT));
    const read = stateFromBook(book, file.name, KIT);
    goInput(MAKE ? toMake(read) : read, FLOW ? CHECK_URL : INPUT_URL);
  } catch (e) {
    showIntroError(e instanceof ReadError ? e.message : `ファイルを読めませんでした。${KIT.doc}（.xlsx）を選んでください。`);
    console.error(e);
  } finally {
    $("bk-busy").hidden = true;
  }
}

// ---------- ダウンロード ----------
async function download() {
  const err = $("bk-dlerr");
  err.hidden = true;
  const d = lastDiag ?? diag();
  const inp = st.input;
  const bad: string[] = [];
  if (!(Number.isInteger(inp.startYear) && inp.startYear >= 2000 && inp.startYear <= 2100)) bad.push("期首");
  if (!d.ready) bad.push(...d.missing.map((m) => PRE_HINT[m] ?? m));
  if (bad.length) {
    err.textContent = `${bad.join("・")}を入れてから、ダウンロードしてください。`;
    err.hidden = false;
    jump(bad[0] === "期首" ? "startYear" : PRE.find((k) => PRE_HINT_KEY[k] === bad[0]) ?? "goal");
    return;
  }
  const btn = $<HTMLButtonElement>("bk-dl");
  const handle = await pickSaveTarget(st, KIT);
  if (handle === "abort") return; // 保存をやめた
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "作っています…";
  let saved = false;
  try {
    await writePlanFile(st, d, KIT, handle);
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
const PRE_HINT_KEY: Record<string, string> = { goal: "売上目標", price: "平均受注単価", gmPct: "粗利率", paybackYears: "回収期間", leadTime: "リードタイム", common: "共通費" };

// ---------- つなぐ（入力の画面・見本） ----------
const hasData = () => {
  const inp = st.input;
  return (
    [inp.goal, inp.price, inp.gmPct, inp.paybackYears, inp.leadTime].some((v) => Number.isFinite(v)) ||
    inp.common > 0 ||
    inp.channels.some((c) => KEYS.some((k) => c[k] > 0)) ||
    (MAKE && ACT_KEYS.some((k) => Number.isFinite(ms().actual[k])))
  );
};

if (form) {
  form.addEventListener("input", onInput);
  form.addEventListener("change", (e) => {
    if ((e.target as HTMLElement).tagName === "SELECT") onInput(e);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("click", (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>("[data-ovr]");
    if (o && MAKE) {
      const [i, k] = (o.dataset.ovr ?? "").split(".");
      resetOvr(ms(), Number(i), k as AutoKey);
      writeAuto();
      writeMonthly();
      update();
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-reset]");
    if (!b) return;
    resetMonthly(st, Number(b.dataset.reset));
    writeMonthly();
    update();
  });
  $("bk-tab-y")?.addEventListener("click", () => tab("y"));
  $("bk-tab-m")?.addEventListener("click", () => tab("m"));
  $("bk-panel")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-jump]");
    if (b?.dataset.jump) jump(b.dataset.jump);
  });
  $("bk-mopen")?.addEventListener("click", () => $("bk-panel").scrollIntoView({ behavior: "smooth", block: "start" }));
  $("bk-dl")?.addEventListener("click", download);
  // 予算案診断Kit：入力が終わったら ② 診断・修正へ
  document.querySelectorAll<HTMLElement>("[data-go-check]").forEach((b) =>
    b.addEventListener("click", () => {
      save();
      location.href = CHECK_URL;
    }),
  );
  $("bk-v-diag")?.addEventListener("click", () => setView("diag"));
  $("bk-v-sheet")?.addEventListener("click", () => setView("sheet"));
  $("bk-s-main")?.addEventListener("click", () => {
    sheetTab = "main";
    renderSheet();
  });
  $("bk-s-diag")?.addEventListener("click", () => {
    sheetTab = "diag";
    renderSheet();
  });
  $("bk-example")?.addEventListener("click", () => {
    if (hasData() && !window.confirm("いまの入力を、記入例（基本モデルの安定期）に置きかえます。よろしいですか？")) return;
    openWork(sample());
  });
  $("bk-clear")?.addEventListener("click", () => {
    if (!window.confirm("入力をすべて消します。よろしいですか？")) return;
    openWork(blank());
  });
}

if (MODE === "intro") {
// 画面で入力する：前回の入力があれば、そこから続ける
$("bk-start")?.addEventListener("click", () => {
  const saved = restore();
  goInput(saved ? { ...saved, notes: [] } : blank());
});

// AIの案
const aiOpen = $<HTMLButtonElement>("bk-ai-open");
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
    const read = stateFromAi(text);
    goInput(MAKE ? toMake(read) : read, FLOW ? CHECK_URL : INPUT_URL);
  } catch (e) {
    showIntroError(e instanceof ReadError ? e.message : "読み込めませんでした。");
  }
});

// 年間予算表（.xlsx）
const fileInput = $<HTMLInputElement>("bk-file");
fileInput?.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) handleFile(f);
  fileInput.value = "";
});
const drop = $("bk-drop");
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
{
  const q = new URLSearchParams(location.search);
  if (SAMPLE) openWork(sample(), q.get("tab") === "sheet" ? "sheet" : "diag");
  else if (MODE === "input") {
    openWork(q.get("sample") === "1" ? sample() : (restore() ?? blank()));
    if (q.get("tab") === "m") tab("m"); // ② 診断・修正の「月別を表で直す」から
  }
  else if (q.get("sample") === "1") location.replace(`${INPUT_URL}?sample=1`);
}
