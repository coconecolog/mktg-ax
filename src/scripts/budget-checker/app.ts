// src/scripts/budget-checker/app.ts
//
// 予算案診断キット（/tools/budget-checker）の画面。判定と状態は src/lib/budgetCheck.ts、Excelは src/lib/budget-sheet.ts。
// - 入口3つ（AIの案／年間予算表の.xlsx／画面で入力）→ 同じ入力の画面（左＝入力、右＝判定）。入力のたびに判定し直す
// - 入力の途中は localStorage に保存する（消えても動く）。入れた数字やファイルはサーバーに送らない
import {
  CHANNELS,
  ReadError,
  SHEET_BUDGET,
  SOURCE_LABEL,
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
import { budgetFileName, fillBudgetWorkbook } from "@/lib/budget-sheet";
import { readBook } from "@/scripts/kpi-analysis/xlsx";
import { diagHtml, sheetHtml } from "@/scripts/budget-checker/preview";

const STORE = "mktgax-budget-checker-v2";
const TEMPLATE = "/files/tools/budget-sheet-template.xlsx";
const LIB_ZIP = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const KEYS: (keyof ChannelInput)[] = ["leads", "valid", "deals", "wins", "ext", "labor"];
const PRE = ["goal", "price", "gmPct", "paybackYears", "leadTime", "common"] as const;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const intro = $("bk-intro");
const work = $("bk-work");
const form = $<HTMLFormElement>("bk-form");
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

let st: BudgetState = emptyState();

// ---------- 保存 ----------
function save() {
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
  writeMonthly();
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
  } else if ((m = /^ch(\d)\.(\w+)$/.exec(name))) {
    const v = num(t.value);
    inp.channels[Number(m[1])][m[2] as keyof ChannelInput] = Number.isFinite(v) ? v : 0;
    if (m[2] === "leads" || m[2] === "valid") {
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
  const el = form.querySelector<HTMLElement>(`[data-out="${key}"]`);
  if (el) el.textContent = text;
}

function updateMonthLabels() {
  const labels = monthLabels(st.input.startMonth || 4);
  form.querySelectorAll<HTMLElement>("[data-mlabel]").forEach((th) => (th.textContent = labels[Number(th.dataset.mlabel)]));
}

function update() {
  const d = diagnoseBudget(st);
  lastDiag = d;

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
  form.querySelectorAll("td.is-fix, td.is-check").forEach((td) => td.classList.remove("is-fix", "is-check"));
  document.querySelectorAll(".bk-mblock").forEach((b) => b.classList.remove("is-fix", "is-check"));
  let mdot: "fix" | "check" | null = null;
  for (const [key, s] of Object.entries(d.marks)) {
    if (key.startsWith("m:")) {
      $(`bk-m${key.slice(2)}`)?.classList.add(`is-${s}`);
      if (mdot !== "fix") mdot = s;
      continue;
    }
    const td = (field(key)?.closest("td") as HTMLElement | null) ?? form.querySelector<HTMLElement>(`[data-out="${key}"]`);
    td?.classList.add(`is-${s}`);
  }
  const dot = $("bk-mdot");
  dot.hidden = !mdot;
  dot.classList.toggle("check", mdot === "check");

  renderPanel(d);
  if (view === "sheet") renderSheet();
  save();
}

// ---------- 表示の切り替え（診断画面／年間予算表の完成イメージ） ----------
let view: "diag" | "sheet" = "diag";
let sheetTab: "main" | "diag" = "main";

function renderSheet() {
  const d = lastDiag ?? diagnoseBudget(st);
  $("bk-sheet").innerHTML = sheetTab === "main" ? sheetHtml(st) : diagHtml(st, d);
  $("bk-s-main").setAttribute("aria-selected", String(sheetTab === "main"));
  $("bk-s-diag").setAttribute("aria-selected", String(sheetTab === "diag"));
}

function setView(v: "diag" | "sheet") {
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
  $("bk-m-fix").textContent = String(c.fix);
  $("bk-m-check").textContent = String(c.check);
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
  const box = $("bk-notes");
  if (!st.notes.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = `<button type="button" class="bk-link" id="bk-notes-x">閉じる</button><b>読み込みのときのお知らせ</b><ul>${st.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  $("bk-notes-x").addEventListener("click", () => (box.hidden = true));
}

function openWork(next: BudgetState, v: "diag" | "sheet" = "diag") {
  st = next;
  intro.hidden = true;
  work.hidden = false;
  $("bk-src").textContent = `読み込み元：${SOURCE_LABEL[st.source]}${st.fileName ? `（${st.fileName}）` : ""}`;
  writeForm();
  updateMonthLabels();
  renderNotes();
  tab("y");
  sheetTab = "main";
  setView(v);
  update();
  window.scrollTo({ top: Math.max(0, work.getBoundingClientRect().top + window.scrollY - 84), behavior: "smooth" });
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
    const book = await readBook(file, [SHEET_BUDGET]);
    openWork(stateFromBook(book, file.name));
  } catch (e) {
    showIntroError(e instanceof ReadError ? e.message : "ファイルを読めませんでした。年間予算表（.xlsx）を選んでください。");
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
  const d = lastDiag ?? diagnoseBudget(st);
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
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "作っています…";
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
    const changed = fillBudgetWorkbook(files, st, d);
    for (const [n, xml] of Object.entries(changed)) zip.file(n, xml);
    const blob: Blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = budgetFileName(st);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    console.error(e);
    err.textContent = "ファイルを作れませんでした。通信を確かめて、もう一度お試しください。";
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
const PRE_HINT_KEY: Record<string, string> = { goal: "売上目標", price: "平均受注単価", gmPct: "粗利率", paybackYears: "回収期間", leadTime: "リードタイム", common: "共通費" };

// ---------- つなぐ ----------
form.addEventListener("input", onInput);
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
$("bk-tab-y").addEventListener("click", () => tab("y"));
$("bk-tab-m").addEventListener("click", () => tab("m"));
$("bk-panel").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-jump]");
  if (b?.dataset.jump) jump(b.dataset.jump);
});
$("bk-mopen").addEventListener("click", () => $("bk-panel").scrollIntoView({ behavior: "smooth", block: "start" }));
$("bk-dl").addEventListener("click", download);
$("bk-dl2").addEventListener("click", download);
$("bk-v-diag").addEventListener("click", () => setView("diag"));
$("bk-v-sheet").addEventListener("click", () => setView("sheet"));
$("bk-back-diag").addEventListener("click", () => {
  setView("diag");
  window.scrollTo({ top: Math.max(0, work.getBoundingClientRect().top + window.scrollY - 84), behavior: "smooth" });
});
$("bk-s-main").addEventListener("click", () => {
  sheetTab = "main";
  renderSheet();
});
$("bk-s-diag").addEventListener("click", () => {
  sheetTab = "diag";
  renderSheet();
});

$("bk-example").addEventListener("click", () => openWork(sampleState()));
$("bk-clear").addEventListener("click", () => {
  if (!window.confirm("入力をすべて消します。よろしいですか？")) return;
  openWork(emptyState());
});
$("bk-home").addEventListener("click", () => {
  work.hidden = true;
  intro.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

$("bk-start").addEventListener("click", () => {
  const saved = restore();
  openWork(saved ? { ...saved, notes: [] } : emptyState());
});

// AIの案
const aiOpen = $<HTMLButtonElement>("bk-ai-open");
aiOpen.addEventListener("click", () => {
  const p = $("bk-ai");
  p.hidden = !p.hidden;
  aiOpen.setAttribute("aria-expanded", String(!p.hidden));
  if (!p.hidden) p.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
$("bk-copy").addEventListener("click", async () => {
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
$("bk-import").addEventListener("click", () => {
  showIntroError("");
  const text = $<HTMLTextAreaElement>("bk-paste").value;
  if (!text.trim()) {
    showIntroError("AIが返した結果を貼りつけてください。");
    return;
  }
  try {
    openWork(stateFromAi(text));
  } catch (e) {
    showIntroError(e instanceof ReadError ? e.message : "読み込めませんでした。");
  }
});

// 年間予算表（.xlsx）
const fileInput = $<HTMLInputElement>("bk-file");
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) handleFile(f);
  fileInput.value = "";
});
const drop = $("bk-drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("is-over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("is-over");
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
});

// 記入例のURL
{
  const q = new URLSearchParams(location.search);
  if (q.get("sample") === "1") openWork(sampleState(), q.get("view") === "sheet" ? "sheet" : "diag");
}
