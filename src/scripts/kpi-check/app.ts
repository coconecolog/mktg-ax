// src/scripts/kpi-check/app.ts
//
// KPI妥当性診断キット（/tools/kpi-check）の画面。計算と判定は src/lib/kpiCheck.ts。2026-10-28 作り直し
// 入口（.xlsxを置く／画面で入力）→ 入力（1ページ）→ 結果 → PDF。1つのページの中で切りかえる。
// - ?sample=1 のときは、基本モデルの安定期の数字（M-B-04の記入例と同じ）で結果を出す
// - 画面の入力は localStorage（mktgax-kpi-check-v3）に置く（消えても動く）。旧版のデータ（v1）は読まずに消す
// - PDF は html2canvas-pro で結果を画像にし、pdf-lib でA4縦のPDFにする（施策効果診断キットと同じ作り。CDNから、使うときだけ読み込む）
import {
  CHANNELS,
  EXAMPLE,
  GROUPS,
  ReadError,
  SHEET_PLAN,
  STATUS_LABEL,
  diagnose,
  fmt,
  formInput,
  pct,
  readPlanSheet,
  sampleInput,
  type ChannelInput,
  type CheckInput,
  type Diagnosis,
  type Group,
  type Item,
  type SheetInput,
} from "@/lib/kpiCheck";
import { validate } from "@/lib/kpi-sheet-maker";
import { metricUrl } from "@/lib/budget-calc";
import { readBook } from "@/scripts/kpi-analysis/xlsx";

const BASE = "/tools/kpi-check";
const STORE = "mktgax-kpi-check-v3";
const OLD_KEYS = ["mktgax-kpi-check-v1", "mktgax-kpi-check-registered", "mktgax-kpi-check-last"];
const LIB_PDF = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
const LIB_CANVAS = "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.0/dist/html2canvas-pro.min.js";
const KPI_SHEET_URL = "/lab/whitepapers/kpi-management-template";
const KEYS: (keyof ChannelInput)[] = ["leads", "valid", "deals", "wins", "ext", "labor"];
const PRE = ["goal", "price", "gmPct", "paybackYears", "leadTime", "common"] as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

let state: { d: Diagnosis } | null = null;

// ---------- 保存 ----------
const store = {
  get(): any {
    try {
      const s = localStorage.getItem(STORE);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  },
  set(v: unknown) {
    try {
      if (v === null) localStorage.removeItem(STORE);
      else localStorage.setItem(STORE, JSON.stringify(v));
    } catch {
      /* noop */
    }
  },
};
function dropOld() {
  try {
    OLD_KEYS.forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem("mktgax-kpi-check-sample");
    sessionStorage.removeItem("mktgax-kpi-check-sample-data");
  } catch {
    /* noop */
  }
}

// ---------- 画面の切りかえ ----------
type View = "intro" | "input" | "result";
function view(v: View) {
  $("kc-intro")!.hidden = v !== "intro";
  $("kc-input")!.hidden = v !== "input";
  $("kc-result")!.hidden = v !== "result";
  window.scrollTo({ top: 0 });
}
function clearSampleUrl() {
  if (location.search) history.replaceState(null, "", BASE);
}

// ---------- 入口：.xlsx ----------
function showError(id: string, msg: string) {
  const e = $(id);
  if (e) {
    e.textContent = msg;
    e.hidden = false;
  }
}
async function handleFile(file: File) {
  $("kc-err")!.hidden = true;
  const b = $("kc-busy")!;
  b.hidden = false;
  try {
    const book = await readBook(file, [SHEET_PLAN]);
    const src = readPlanSheet(book, file.name);
    b.hidden = true;
    show(src);
  } catch (err) {
    b.hidden = true;
    const isRead = err instanceof ReadError;
    showError("kc-err", isRead ? (err as Error).message : "ファイルを読めませんでした。KPI管理表（M-B-04）の .xlsx か確かめてください。");
    if (!isRead) console.error(err);
  }
}

// ---------- 入力 ----------
const form = () => $<HTMLFormElement>("kc-form")!;
const field = (name: string) => form().elements.namedItem(name) as HTMLInputElement;
const parse = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** 画面の入力 → SheetInput。チャネルの空欄は0（使わない）、前提の空欄は NaN（入力が必要）、共通費の空欄は0 */
function readForm(): SheetInput {
  const v = (n: string) => parse(field(n).value);
  return {
    startYear: NaN,
    startMonth: 4,
    goal: v("goal"),
    price: v("price"),
    gmPct: v("gmPct"),
    paybackYears: v("paybackYears"),
    leadTime: v("leadTime"),
    common: field("common").value.trim() === "" ? 0 : v("common"),
    channels: CHANNELS.map((_, i) => {
      const c = {} as ChannelInput;
      for (const k of KEYS) {
        const s = field(`ch${i}.${k}`).value;
        c[k] = s.trim() === "" ? 0 : Number(s);
      }
      return c;
    }),
  };
}
function writeForm(inp: SheetInput | null) {
  const set = (n: string, v: number | undefined) => (field(n).value = v === undefined || v === null || !Number.isFinite(v) ? "" : String(v));
  for (const k of PRE) set(k, inp ? (k === "common" && !inp.common ? undefined : inp[k]) : undefined);
  CHANNELS.forEach((_, i) => {
    const c = inp?.channels[i];
    for (const k of KEYS) set(`ch${i}.${k}`, c && c[k] ? c[k] : undefined);
  });
  updateRates();
}
function saveForm() {
  const raw: Record<string, string> = {};
  for (const el of Array.from(form().elements) as HTMLInputElement[]) if (el.name) raw[el.name] = el.value;
  store.set(raw);
}
function loadForm() {
  const raw = store.get();
  if (!raw || typeof raw !== "object") return;
  for (const el of Array.from(form().elements) as HTMLInputElement[]) if (el.name && typeof raw[el.name] === "string") el.value = raw[el.name];
  updateRates();
}
/** チャネルの下に、件数から出した率を小さく出す */
function updateRates() {
  const inp = readForm();
  inp.channels.forEach((c, i) => {
    const el = form().querySelector<HTMLElement>(`[data-rates="${i}"]`);
    if (!el) return;
    if (!c.leads) {
      el.textContent = "";
      return;
    }
    const r = (a: number, b: number) => (b ? pct(a / b) : "—");
    const cost = c.ext + c.labor;
    el.textContent = `有効リード率 ${r(c.valid, c.leads)}・商談化率 ${r(c.deals, c.valid)}・受注率 ${r(c.wins, c.deals)}${cost ? `・CPL ${fmt(cost / c.leads, 1)}万円` : ""}`;
  });
}
function submitForm(e: Event) {
  e.preventDefault();
  const ferr = $("kc-ferr")!;
  ferr.hidden = true;
  form().querySelectorAll(".kc-ip.is-bad").forEach((x) => x.classList.remove("is-bad"));
  const inp = readForm();
  const { errors } = validate(inp);
  if (errors.length) {
    const preMap: Record<string, string> = { マーケ経由の売上目標: "goal", 平均受注単価: "price", 粗利率: "gmPct", 回収期間: "paybackYears", リードタイム: "leadTime", 共通費: "common" };
    for (const er of errors) {
      const n = preMap[er];
      if (n) field(n).closest(".kc-ip")?.classList.add("is-bad");
      const ci = CHANNELS.indexOf(er as (typeof CHANNELS)[number]);
      if (ci >= 0) form().querySelectorAll<HTMLElement>(`[name^="ch${ci}."]`).forEach((x) => x.closest(".kc-ip")?.classList.add("is-bad"));
    }
    showError("kc-ferr", `次の項目を入れてください（0以上の数字）：${errors.join("・")}`);
    ferr.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  saveForm();
  show(formInput(inp));
}

// ---------- 結果 ----------
function show(src: CheckInput) {
  state = { d: diagnose(src) };
  if (src.source !== "sample") clearSampleUrl();
  render();
  view("result");
}

const canEdit = (src: CheckInput) => src.names.length === CHANNELS.length && src.names.every((n, i) => n === CHANNELS[i]);

function render() {
  if (!state) return;
  const { d } = state;
  const { src, r } = d;
  const inp = src.input;
  const from = src.source === "sample" ? "見本（基本モデルの安定期）" : src.source === "xlsx" ? src.fileName ?? "KPI管理表" : "画面で入力した数字";
  $("kc-meta")!.textContent = `${from}　チャネル${d.rows.length}つ・リード数${fmt(r.total.leads)}件・受注数${fmt(r.total.wins)}件`;
  $("kc-edit")!.hidden = !canEdit(src);

  const h: string[] = [];
  h.push(`<div class="kc-pdfhead"><b>KPI妥当性診断キット</b>　${esc(from)}　作成日 ${new Date().toLocaleDateString("ja-JP")}</div>`);
  if (src.source === "sample")
    h.push(`<p class="kc-sample"><b>見本</b>　架空の会社（基本モデルの安定期）の計画で表示しています。KPI管理表（M-B-04）の記入例と同じ数字です。自社の数字は「入口に戻る」から。</p>`);
  for (const w of src.warnings) h.push(`<p class="kc-warn">${esc(w)}</p>`);

  // 結論
  const chips = (["fix", "check", "ok", "na"] as const)
    .filter((s) => d.counts[s])
    .map((s) => `<span class="${s}">${STATUS_LABEL[s]} ${d.counts[s]}</span>`)
    .join("");
  h.push(
    `<div class="kc-sum"><p class="kc-concl">${esc(d.conclusion)}</p><div class="kc-chips">${chips}</div>` +
      `<p class="kc-pre">前提：売上目標${fmt(inp.goal)}万円・平均受注単価${fmt(inp.price)}万円・粗利率${fmt(inp.gmPct)}%・回収期間${fmt(inp.paybackYears, 1)}年・リードタイム${fmt(inp.leadTime)}か月` +
      `　→　CACの上限${fmt(r.cacLimit)}万円・許容CPL ${fmt(r.allowableCpl, 1)}万円</p></div>`,
  );

  // A
  h.push(`<h2 class="kc-h2">${GROUPS.A}<small>直す＝計画を直さないと売上目標に届かない</small></h2>`);
  h.push(needTable(d));
  h.push(itemsHtml(d.items, "A"));
  if (d.monthly) h.push(monthlyTable(d));
  // B
  h.push(`<h2 class="kc-h2">${GROUPS.B}<small>確認＝根拠があればそのままでよい</small></h2>`);
  h.push(itemsHtml(d.items, "B"));
  // C
  h.push(`<h2 class="kc-h2">${GROUPS.C}<small>CPL・CAC・回収期間は外部費用＋人件費で計算</small></h2>`);
  h.push(channelTable(d));
  h.push(itemsHtml(d.items, "C"));

  h.push(nextHtml(d));
  h.push(howHtml());
  h.push(`<p class="kc-pdffoot">KPI妥当性診断キット｜MKTG.AX　mktg.ax/tools/kpi-check　数字の定義：mktg.ax/standards/metrics</p>`);
  $("kc-report")!.innerHTML = h.join("");
}

function itemsHtml(items: Item[], g: Group) {
  return `<div class="kc-items">${items
    .filter((i) => i.group === g)
    .map(
      (i) =>
        `<div class="kc-it"><span class="kc-st-b ${i.status}">${STATUS_LABEL[i.status]}</span><div><b>${esc(i.title)}</b><p>${esc(i.reason)}</p>${
          i.todo && (i.status === "fix" || i.status === "check") ? `<p class="todo">${esc(i.todo)}</p>` : ""
        }</div></div>`,
    )
    .join("")}</div>`;
}

function needTable(d: Diagnosis) {
  const { r } = d;
  const t = r.total;
  const cols = [
    { k: "leads", label: "リード数" },
    { k: "validRate", label: "有効リード率" },
    { k: "valid", label: "有効リード数" },
    { k: "dealRate", label: "商談化率" },
    { k: "deals", label: "商談数" },
    { k: "winRate", label: "受注率" },
    { k: "wins", label: "受注数" },
    { k: "sales", label: "受注金額" },
  ] as const;
  const rate = { validRate: t.validRate, dealRate: t.dealRate, winRate: t.winRate } as Record<string, number | null>;
  const cell = (row: "need" | "plan", k: string) => (k in rate ? pct(rate[k]) : fmt((r[row] as any)[k]));
  const judge = cols.map((c) => (c.k in rate ? `<td>—</td>` : (r.short as any)[c.k] ? `<td class="fix">直す</td>` : `<td>足りる</td>`)).join("");
  return `<div class="kc-scroll"><table class="kc-tbl"><thead><tr><th></th>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead><tbody>
<tr><td>必要な数（逆算）</td>${cols.map((c) => `<td>${cell("need", c.k)}</td>`).join("")}</tr>
<tr><td>計画の数</td>${cols.map((c) => `<td>${cell("plan", c.k)}</td>`).join("")}</tr>
<tr class="tot"><td>判定</td>${judge}</tr></tbody></table></div>
<p class="kc-cap">必要な数＝受注数（売上目標÷平均受注単価、切り上げ）から、計画の率でさかのぼった数。受注金額は万円</p>`;
}

function monthlyTable(d: Diagnosis) {
  const rows = d.monthly!
    .map((m) => {
      const c = (y: number, mo: number) => (Math.abs(y - mo) > 0.5 ? `<td class="fix">${fmt(mo - y)}</td>` : `<td>0</td>`);
      return `<tr><td>${esc(m.name)}</td><td>${fmt(m.leadsYear)}</td><td>${fmt(m.leadsMonthly)}</td>${c(m.leadsYear, m.leadsMonthly)}<td>${fmt(m.validYear)}</td><td>${fmt(m.validMonthly)}</td>${c(m.validYear, m.validMonthly)}</tr>`;
    })
    .join("");
  return `<div class="kc-scroll"><table class="kc-tbl"><thead><tr><th>月別の計画</th><th>リード数 年間</th><th>月別の合計</th><th>差</th><th>有効リード数 年間</th><th>月別の合計</th><th>差</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function channelTable(d: Diagnosis) {
  const { r } = d;
  const row = (c: (typeof d.rows)[number] | typeof r.total, tot = false) => {
    const judge = c.cplOver === null ? `<td>—</td>` : c.cplOver ? `<td class="check">上限超え</td>` : `<td>上限内</td>`;
    return `<tr${tot ? ' class="tot"' : ""}><td>${esc(c.name)}</td><td>${fmt(c.leads)}</td><td>${pct(c.validRate)}</td><td>${pct(c.dealRate)}</td><td>${pct(c.winRate)}</td><td>${fmt(c.ext + c.labor)}</td><td>${fmt(c.cpl, 1)}</td><td>${fmt(c.cac)}</td><td>${fmt(c.paybackMonths, 1)}</td>${judge}</tr>`;
  };
  return `<div class="kc-scroll"><table class="kc-tbl"><thead><tr><th>チャネル</th><th>リード数</th><th>有効リード率</th><th>商談化率</th><th>受注率</th><th>費用</th><th>CPL</th><th>CAC</th><th>回収期間<br>（か月）</th><th>CPL判定</th></tr></thead><tbody>
${d.rows.map((c) => row(c)).join("")}${row(r.total, true)}</tbody></table></div>
<p class="kc-cap">金額は万円。CPL判定＝CPLが許容CPL（${fmt(r.allowableCpl, 1)}万円）以下なら上限内。ROI（1年）とコスト合計は共通費を含む</p>`;
}

function nextHtml(d: Diagnosis) {
  const steps: string[] = [];
  if (d.counts.fix) steps.push(d.src.source === "xlsx" ? "KPI管理表の「はじめに入力」で、直すところを直して、もう一度読み込みます" : "「数字を直す」から直すところを直して、もう一度診断します");
  if (d.src.source === "xlsx") steps.push("毎月、KPI管理表の「毎月の実績入力」に件数を入れ、月次レポートで報告します");
  else steps.push(`この計画を<a href="/tools/kpi-sheet-maker">KPI管理表作成キット</a>に入れるか、<a href="${KPI_SHEET_URL}">KPI管理表</a>に写して、毎月の予実を管理します`);
  steps.push(`毎月の振り返りは、KPI管理表を<a href="/tools/kpi-analysis">施策効果診断キット</a>で読み込み、続いている課題と打ち手の効果を確かめます`);
  return `<div class="kc-next"><b>このあと</b><ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol></div>`;
}

function howHtml() {
  return `<details class="kc-how"><summary>判定の基準</summary><ul>
<li>A 必要な数：受注数＝売上目標÷平均受注単価（切り上げ）。そこから計画の率（受注率・商談化率・有効リード率）でさかのぼり、計画の件数が下回れば「直す」</li>
<li>A 件数の順：リード数 ≥ 有効リード数 ≥ 商談数 ≥ 受注数 でなければ「直す」。月別の計画：リード数・有効リード数の月別の合計が年間と合わなければ「直す」（.xlsxのときだけ）</li>
<li>B 率：全体の有効リード率・商談化率・受注率が、目安（基本モデルの安定期 38%・40%・29%）の半分未満か2倍超なら「確認」</li>
<li>C CPL：（外部費用＋人件費）÷リード数が許容CPL（CACの上限×受注数÷リード数）を超えたら「確認」。CAC：全体のCACがCACの上限（平均受注単価×粗利率×回収期間）を超えたら「確認」。ROI（1年）がマイナスなら「確認」</li>
<li>式は<a href="${metricUrl("backcast")}">数字の定義</a>と同じです。撤退の判断は、期が始まってから KPI管理表で見ます</li></ul></details>`;
}

// ---------- PDF ----------
const loaded: Record<string, Promise<void>> = {};
function loadScript(src: string) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        delete loaded[src];
        reject(new Error("PDFの部品を読み込めませんでした。通信を確かめて、もう一度お試しください。"));
      };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

async function makePdf() {
  if (!state) return;
  const btn = $<HTMLButtonElement>("kc-pdf")!;
  const err = $("kc-perr")!;
  err.hidden = true;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "PDFを作っています…";
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-20000px;top:0;";
  try {
    await Promise.all([loadScript(LIB_PDF), loadScript(LIB_CANVAS)]);
    const w = window as any;
    const h2c = w.html2canvas?.default || w.html2canvas;
    const node = document.createElement("div");
    node.className = "kc kc-pdf";
    node.innerHTML = $("kc-report")!.innerHTML;
    holder.appendChild(node);
    document.body.appendChild(holder);
    await new Promise((r) => setTimeout(r, 50));
    // ページの切れ目：見出しの上と、指摘・表の行の上で切る
    const top = node.getBoundingClientRect().top;
    const breaks = Array.from(node.querySelectorAll<HTMLElement>(".kc-h2, .kc-it, .kc-scroll, .kc-pdffoot"))
      .map((el) => el.getBoundingClientRect().top - top)
      .filter((y) => y > 0)
      .sort((a, b) => a - b);
    const scale = 2;
    const canvas: HTMLCanvasElement = await h2c(node, { scale, backgroundColor: "#ffffff", width: 1000, logging: false });
    const pageH = Math.floor((1000 * 297) / 210);
    const totalH = node.scrollHeight;
    const cuts: number[] = [0];
    let start = 0;
    while (totalH - start > pageH) {
      const limit = start + pageH;
      const cands = breaks.filter((y) => y > start + pageH * 0.4 && y <= limit);
      const next = cands.length ? cands[cands.length - 1] : limit;
      cuts.push(next);
      start = next;
    }
    cuts.push(totalH);
    const PDFLib = w.PDFLib;
    const pdf = await PDFLib.PDFDocument.create();
    for (let i = 0; i < cuts.length - 1; i++) {
      const y0 = cuts[i];
      const h = cuts[i + 1] - y0;
      if (h <= 2) continue;
      const pc = document.createElement("canvas");
      pc.width = 1000 * scale;
      pc.height = pageH * scale;
      const ctx = pc.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pc.width, pc.height);
      ctx.drawImage(canvas, 0, y0 * scale, 1000 * scale, h * scale, 0, 0, 1000 * scale, h * scale);
      const png = await (await fetch(pc.toDataURL("image/png"))).arrayBuffer();
      const page = pdf.addPage([595.28, 841.89]);
      const img = await pdf.embedPng(png);
      page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const t = new Date();
    a.download = `KPI妥当性診断_${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) {
    err.textContent = e instanceof Error && /PDFの部品/.test(e.message) ? e.message : "PDFを作れませんでした。もう一度お試しください。";
    err.hidden = false;
    console.error(e);
  } finally {
    holder.remove();
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------- はじめ ----------
function init() {
  const root = $("kc");
  if (!root) return;
  dropOld();
  const file = $<HTMLInputElement>("kc-file")!;
  const drop = $("kc-drop")!;
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (f) handleFile(f);
    file.value = "";
  });
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

  loadForm();
  form().addEventListener("input", () => {
    updateRates();
    saveForm();
  });
  form().addEventListener("submit", submitForm);
  $("kc-start")!.addEventListener("click", () => view("input"));
  $("kc-home")!.addEventListener("click", () => view("intro"));
  $("kc-example")!.addEventListener("click", () => {
    writeForm(EXAMPLE);
    saveForm();
  });
  $("kc-clear")!.addEventListener("click", () => {
    writeForm(null);
    store.set(null);
  });
  $("kc-edit")!.addEventListener("click", () => {
    if (state && state.d.src.source !== "form") {
      writeForm(state.d.src.input);
      saveForm();
    }
    clearSampleUrl();
    view("input");
  });
  $("kc-again")!.addEventListener("click", () => {
    clearSampleUrl();
    state = null;
    $("kc-report")!.innerHTML = "";
    view("intro");
  });
  $("kc-pdf")!.addEventListener("click", makePdf);

  if (new URLSearchParams(location.search).get("sample") === "1") show(sampleInput());
}

init();
