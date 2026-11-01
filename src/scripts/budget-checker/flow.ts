// src/scripts/budget-checker/flow.ts
//
// 予算案診断Kitの ② 診断・修正（/check）・③ 最終チェック（/final）・④⑤ 完了（/done）の画面。2026-11-01
// #bk の data-mode で動きを分ける。数字は入力の画面と同じ localStorage（KITS.budget.store）を読み書きする。
// - ② 診断・修正：判定の「直す」「確認」を1件ずつのカードにし、カードの中で数字を直す（src/lib/budgetFlow.ts）
//   カードには「何がNGか」「いまの数字」「OKになる条件」「直す欄」を必ず出す。直すとその場で判定し直し、カードの印が変わる
//   直したせいで別のNGが出たら、そのカードに「新しく出た」を付けて上に足す。確認のカードは「このまま進める」で確認済みにできる
//   ③・④から戻ってきたとき（?back=1）は、未対応の数を上に出し、最初の未対応のカードまで移る
// - ③ 最終チェック：カードの状態の一覧（押すと ② のそのカードへ）＋「診断結果を確認しました」のチェックで、ダウンロードのボタンが押せるようになる
//   NGが残っていてもダウンロードできる（残りはExcelの「診断結果」シートに載る）。保存が終わったら ④⑤ 完了に移る
// - ④⑤ 完了：もう一度ダウンロード／数字を直す（② へ）／次のKit（KPI管理表作成Kitに数字を引き継ぐ）
// 入れた数字はサーバーに送らない
import { CHANNELS, diagnoseBudget, fmt, resetMonthly, sampleState, type BudgetDiagnosis, type BudgetState } from "@/lib/budgetCheck";
import { diagHtml, sheetHtml } from "@/scripts/budget-checker/preview";
import {
  ISSUE_TITLE,
  buildIssues,
  getField,
  issueState,
  readMemo,
  setField,
  writeMemo,
  type FlowMemo,
  type Issue,
  type IssueKey,
  type IssueState,
} from "@/lib/budgetFlow";
import { planFileName } from "@/lib/budget-sheet";
import { AUTO_KEYS, applyMake, diagnoseMake, makeSample, toMake, type AutoKey, type MakeState } from "@/lib/budgetMake";
import { KITS, type KitId } from "@/lib/planKits";
import { pickSaveTarget, writePlanFile } from "@/scripts/budget-checker/download";

const KIT = KITS[((document.getElementById("bk")?.dataset.kit ?? "budget") as KitId)] ?? KITS.budget;
const BASE = KIT.path;
const URL_CHECK = `${BASE}/check`;
const URL_FINAL = `${BASE}/final`;
const URL_DONE = `${BASE}/done`;
const URL_INPUT = `${BASE}/input`;
const MODE = (document.getElementById("bk")?.dataset.mode ?? "check") as "check" | "final" | "done" | "sample";
/** サンプル画面（/sample、2026-11-01）：記入例で ② 診断・修正の画面を見せる。保存しない */
const SAMPLE = MODE === "sample";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// ---------- 状態（入力の画面 app.ts と同じ置き場所・読み方） ----------
function restore(): BudgetState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KIT.store) || "null");
    if (!raw || !raw.input || !Array.isArray(raw.monthly) || raw.monthly.length !== CHANNELS.length) return null;
    const s = raw as BudgetState;
    for (const k of ["startYear", "startMonth", "goal", "price", "gmPct", "paybackYears", "leadTime", "common"] as const)
      if ((s.input as any)[k] === null) (s.input as any)[k] = NaN;
    if (!Array.isArray(s.manual)) s.manual = CHANNELS.map(() => false);
    if (!Array.isArray(s.notes)) s.notes = [];
    // 作る系のKit（予算作成Kit・KPI管理表作成Kit）：今期の実績と上書きの印を戻し、自動配分し直す
    if (KIT.maker) {
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
function save() {
  if (SAMPLE) return;
  try {
    localStorage.setItem(KIT.store, JSON.stringify(st));
  } catch {
    /* 保存できなくても動く */
  }
}

const loaded = SAMPLE ? sampleFor() : restore();
/** サンプル画面の数字：基本モデルの安定期の記入例から、展示会の商談数・受注数を減らした案（入口の見本と同じ） */
function sampleFor(): BudgetState {
  const s = KIT.maker ? makeSample() : sampleState();
  s.input.channels[0].deals = 15;
  s.input.channels[0].wins = 4;
  if (KIT.maker) {
    const m = s as MakeState;
    m.ovr[0].deals = true;
    m.ovr[0].wins = true;
    applyMake(m);
  }
  return s;
}
let st = loaded as BudgetState;
let memo: FlowMemo = SAMPLE ? { seen: [], ack: [] } as unknown as FlowMemo : readMemo(KIT);
let d: BudgetDiagnosis;
let issues: Issue[] = [];

function recompute() {
  d = KIT.maker ? diagnoseMake(st as MakeState, KIT) : diagnoseBudget(st, KIT);
  issues = buildIssues(st, KIT, d);
  // これまでに出たカードを覚える（直したあとも「修正済み」で出すため）
  let changed = false;
  for (const i of issues)
    if (!memo.seen.includes(i.key)) {
      memo.seen.push(i.key);
      changed = true;
    }
  if (changed && !SAMPLE) writeMemo(memo, KIT);
}

const stateOf = (key: IssueKey): IssueState => issueState(key, issues, memo);
const openIssues = () => issues.filter((i) => stateOf(i.key) === "open");
const STATE_TAG: Record<IssueState, [string, string]> = { open: ["", ""], ack: ["ok", "確認済み"], done: ["ok", "修正済み"] };
const tagOf = (key: IssueKey) => {
  const s = stateOf(key);
  if (s !== "open") return STATE_TAG[s];
  const cur = issues.find((i) => i.key === key)!;
  return cur.status === "fix" ? ["fix", "直す"] : ["check", "確認"];
};

/** 目標に届くか・コストは上限以内か（② の上の数字と ③ の一覧で使う） */
function headline() {
  if (!d.ready || !d.r) return { goal: ["—", ""], cost: ["—", ""] };
  const need = issues.find((i) => i.key === "need");
  const r = d.r;
  const gap = r.need.wins - r.plan.wins;
  const goal = need ? [`届かない（受注数あと${fmt(gap)}件）`, "fix"] : ["届く", "ok"];
  const over = issues.filter((i) => i.key === "cpl" || i.key === "cac");
  const cost = over.length ? [`上限超え ${over.length}件`, over.every((i) => stateOf(i.key) === "ack") ? "ok" : "check"] : ["上限以内", "ok"];
  return { goal, cost };
}

function noData() {
  const box = $("bk-flow");
  box.innerHTML = `<div class="bk-empty"><b>${KIT.subject}の数字がまだありません</b><p>入口でAIの案を貼りつけるか、${KIT.doc}（.xlsx）を読み込むか、画面で入力してください。</p><a class="bk-btn" href="${BASE}">入口へ<span aria-hidden="true">→</span></a></div>`;
}

// =====================================================================
// ② 診断・修正
// =====================================================================
const cards = new Map<IssueKey, HTMLElement>();
/** この画面を開いたときに出ていたカード（それ以外は「新しく出た」） */
let atLoad = new Set<IssueKey>();

function fieldsHtml(is: Issue) {
  if (!is.fields.length && !is.resets?.length) return "";
  const f = is.fields
    .map(
      (x) =>
        `<label class="bk-ck-in"><span>${esc(x.label)}</span><span class="bk-ck-v"><input type="number" inputmode="decimal" min="0" step="any" name="${esc(x.name)}" value="${esc(
          getField(st, x.name),
        )}" /><em>${esc(x.unit)}</em></span></label>`,
    )
    .join("");
  const r = (is.resets ?? [])
    .map((i) => `<button type="button" class="bk-btn-o" data-reset="${i}">${esc(CHANNELS[i])}の月別を年間÷12に戻す</button>`)
    .join("");
  const head = is.key === "need" ? "直す欄（どれか1つを直せばOK）" : "直す欄";
  return `<p class="bk-ck-fh">${head}</p><div class="bk-ck-f">${f}</div>${r ? `<div class="bk-ck-r">${r}</div>` : ""}<p class="bk-ck-total" data-total hidden></p>`;
}

/** 目標に届くかのカードだけ：受注数の合計と必要な数（直すたびに書きかえる） */
function totalText(key: IssueKey) {
  if (key !== "need" || !d.r) return "";
  return `受注数の合計 ${fmt(d.r.plan.wins)}件 ／ 必要 ${fmt(d.r.need.wins)}件`;
}

function cardHtml(key: IssueKey) {
  const is = issues.find((i) => i.key === key);
  const [tone, label] = tagOf(key);
  const table = key === "monthly" ? `${URL_INPUT}?from=check&tab=m` : `${URL_INPUT}?from=check`;
  const canAck = is?.status === "check";
  return `
    <div class="bk-ck-h"><span class="bk-tg ${tone}" data-tag>${label}</span><span class="bk-new" data-new hidden>新しく出た</span><b data-title>${esc(is?.title ?? ISSUE_TITLE[key])}</b><span class="bk-ck-no" data-no></span></div>
    <div class="bk-ck-b">
      <dl class="bk-ck-d">
        <dt>いま</dt><dd data-now>${esc(is?.now ?? "OKになりました")}</dd>
        <dt data-target-h${is ? "" : " hidden"}>OKになる条件</dt><dd data-target${is ? "" : " hidden"}>${esc(is?.target ?? "")}</dd>
        <dt data-todo-h${is?.todo ? "" : " hidden"}>直し方</dt><dd class="todo" data-todo${is?.todo ? "" : " hidden"}>${esc(is?.todo ?? "")}</dd>
      </dl>
      <div class="bk-ck-fx">
        ${is ? fieldsHtml(is) : ""}
        <div class="bk-ck-a">
          ${canAck ? `<span class="bk-ck-an" data-ack-n>数字はそのままで進めてもよい項目です</span><button type="button" class="bk-btn-o" data-ack>このまま進める（確認済みにする）</button>` : ""}
          ${is?.key === "rate" || is?.key === "monthly" || is?.key === "roi" ? `<a class="bk-link" href="${table}">表全体で直す →</a>` : ""}
        </div>
        ${is?.reason ? `<details class="bk-is-why"><summary>くわしい理由</summary><p data-reason>${esc(is.reason)}</p></details>` : ""}
      </div>
    </div>`;
}

function makeCard(key: IssueKey) {
  const el = document.createElement("article");
  el.className = "bk-is bk-ck";
  el.id = `issue-${key}`;
  el.dataset.key = key;
  el.innerHTML = cardHtml(key);
  cards.set(key, el);
  return el;
}

/** カードの中身を、いまの判定に合わせて書きかえる（入力欄は作り直さない＝入力中のカーソルを消さない） */
function refreshCard(key: IssueKey) {
  const el = cards.get(key);
  if (!el) return;
  const is = issues.find((i) => i.key === key);
  const s = stateOf(key);
  const [tone, label] = tagOf(key);
  const tag = el.querySelector<HTMLElement>("[data-tag]")!;
  tag.className = `bk-tg ${tone}`;
  tag.textContent = label;
  el.classList.toggle("is-ok", s !== "open");
  el.dataset.tone = s !== "open" ? "ok" : is?.status ?? "ok";
  const todo = el.querySelector<HTMLElement>("[data-todo]");
  if (todo) {
    todo.textContent = is?.todo ?? "";
    todo.hidden = !is?.todo;
    el.querySelector<HTMLElement>("[data-todo-h]")!.hidden = !is?.todo;
  }
  const tot = el.querySelector<HTMLElement>("[data-total]");
  if (tot) {
    tot.textContent = is ? totalText(key) : "";
    tot.hidden = !tot.textContent;
    tot.classList.toggle("is-ng", !!is && is.status === "fix");
  }
  el.querySelector<HTMLElement>("[data-title]")!.textContent = is?.title ?? ISSUE_TITLE[key];
  el.querySelector<HTMLElement>("[data-now]")!.textContent = is ? is.now : "OKになりました";
  const tgt = el.querySelector<HTMLElement>("[data-target]")!;
  tgt.textContent = is ? is.target : "";
  tgt.hidden = !is; // 修正済み：OKになったので条件は出さない
  el.querySelector<HTMLElement>("[data-target-h]")!.hidden = !is;
  const why = el.querySelector<HTMLElement>("[data-reason]");
  if (why && is) why.textContent = is.reason;
  const ack = el.querySelector<HTMLButtonElement>("[data-ack]");
  if (ack) {
    ack.hidden = !is || is.status !== "check";
    ack.textContent = s === "ack" ? "確認済みを取り消す" : "このまま進める（確認済みにする）";
    const an = el.querySelector<HTMLElement>("[data-ack-n]");
    if (an) an.hidden = ack.hidden;
  }
  // 状態が変わって、カードに入力欄がない（修正済みのカードが同じ判定で戻ってきた）ときは作り直す
  if (is && is.fields.length && !el.querySelector("input")) el.innerHTML = cardHtml(key);
}

function renderSummary() {
  const open = openIssues();
  const fix = open.filter((i) => i.status === "fix").length;
  const check = open.filter((i) => i.status === "check").length;
  const okItems = d.items.filter((i) => i.status === "ok");
  $("bk-s-fix").textContent = String(fix);
  $("bk-s-check").textContent = String(check);
  $("bk-s-ok").textContent = String(okItems.length);
  $("bk-s-fix").parentElement!.classList.toggle("on", fix > 0);
  $("bk-s-check").parentElement!.classList.toggle("on", check > 0);
  const g = $("bk-s-goal");
  if (!d.ready || !d.r) {
    g.textContent = "—";
    g.className = "";
  } else {
    const gap = d.r.need.wins - d.r.plan.wins;
    g.textContent = gap > 0 ? `受注数が ${fmt(gap)}件足りない（計画${fmt(d.r.plan.wins)}・必要${fmt(d.r.need.wins)}）` : `届く（受注数 計画${fmt(d.r.plan.wins)}・必要${fmt(d.r.need.wins)}）`;
    g.className = gap > 0 ? "is-fix" : "";
  }
  $("bk-s-next").innerHTML = `残り：<span class="is-fix">直す ${fix}</span>・<span class="is-check">確認 ${check}</span>`;
  $("bk-okall").hidden = issues.length > 0 || memo.seen.length > 0;
  // 問題なしの一覧
  const okl = $("bk-okl");
  okl.hidden = !okItems.length;
  $("bk-okl-n").textContent = String(okItems.length);
  $("bk-okl-l").innerHTML = okItems.map((i) => `<li>✓ ${esc(i.title)}</li>`).join("");
  // カードの番号（未対応のカードだけ、上から n / N）
  const list = Array.from($("bk-issues").children) as HTMLElement[];
  list.forEach((el, n) => {
    const no = el.querySelector<HTMLElement>("[data-no]");
    if (no) no.textContent = `${n + 1} / ${list.length}`;
  });
  $("bk-resolved-l").querySelectorAll<HTMLElement>("[data-no]").forEach((no) => (no.textContent = ""));
}

function placeCards() {
  const list = $("bk-issues");
  const doneBox = $("bk-resolved");
  const doneList = $("bk-resolved-l");
  // 開いたとき：未対応を上に、対応済み（確認済み・修正済み）は下にたたむ
  const open = openIssues().map((i) => i.key);
  const resolved = memo.seen.filter((k) => !open.includes(k));
  for (const k of open) list.appendChild(cards.get(k) ?? makeCard(k));
  for (const k of resolved) doneList.appendChild(cards.get(k) ?? makeCard(k));
  for (const k of [...open, ...resolved]) refreshCard(k);
  doneBox.hidden = resolved.length === 0;
  $("bk-resolved-n").textContent = String(resolved.length);
}

function announce(msg: string) {
  const el = $("bk-live");
  el.textContent = msg;
  el.hidden = !msg;
}

/** 数字を直したあと：判定し直して、カードを書きかえる。新しく出たNGは上に足す */
function afterEdit(skipName?: string) {
  save();
  recompute();
  const list = $("bk-issues");
  const fresh: Issue[] = [];
  for (const is of issues) {
    let el = cards.get(is.key);
    if (!el) {
      el = makeCard(is.key);
      list.prepend(el);
      fresh.push(is);
    } else if (el.parentElement?.id === "bk-resolved-l" && stateOf(is.key) === "open") {
      // 修正済みだった判定がまた出た：未対応の列に戻す
      list.prepend(el);
      fresh.push(is);
    }
    if (!atLoad.has(is.key)) el.querySelector<HTMLElement>("[data-new]")!.hidden = false;
  }
  for (const k of cards.keys()) refreshCard(k);
  // 同じ欄が別のカードにもあれば、数字をそろえる
  document.querySelectorAll<HTMLInputElement>("#bk-flow input[name]").forEach((inp) => {
    if (inp.name !== skipName && document.activeElement !== inp) inp.value = getField(st, inp.name);
  });
  const resolvedN = $("bk-resolved-l").children.length;
  $("bk-resolved").hidden = resolvedN === 0;
  $("bk-resolved-n").textContent = String(resolvedN);
  renderSummary();
  if (fresh.length)
    announce(`数字を直したため、新しく${fresh.map((f) => `「${f.status === "fix" ? "直す" : "確認"}」`).join("")}が出ました：${fresh.map((f) => f.title).join("／")}`);
}

function renderNotes() {
  const box = $("bk-notes");
  if (!st.notes.length) {
    box.hidden = true;
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

function flash(el: HTMLElement) {
  const det = el.closest("details");
  if (det) det.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("is-flash");
  void el.offsetWidth;
  el.classList.add("is-flash");
}

function initCheck() {
  recompute();
  atLoad = new Set(issues.map((i) => i.key));
  renderNotes();
  placeCards();
  renderSummary();

  const q = new URLSearchParams(location.search);
  const back = q.get("back") === "1";
  const open = openIssues();
  if (back) {
    // ③・④から戻ってきた：何が残っているかを先に見せる
    const b = $("bk-back-msg");
    b.hidden = false;
    b.textContent = open.length
      ? `未対応が${open.length}件あります。上のカードから順に、「OKになる条件」を見ながら直してください。`
      : "未対応はありません。数字を変えると、その場で判定し直します。";
  }
  const hashKey = location.hash.replace(/^#issue-/, "") as IssueKey;
  const target = (hashKey && cards.get(hashKey)) || (back && open.length ? cards.get(open[0].key) : null);
  if (target) window.setTimeout(() => flash(target), 150);

  const root = $("bk-flow");
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.name) return;
    setField(st, t.name, t.value);
    if (KIT.maker) {
      // 自動配分の欄（有効リード数・商談数・受注数）を直したら上書き。空にしたら自動に戻す。ほかの欄でも配り直す
      const m = /^ch(\d)\.(\w+)$/.exec(t.name);
      if (m && (AUTO_KEYS as string[]).includes(m[2])) (st as MakeState).ovr[Number(m[1])][m[2] as AutoKey] = t.value.trim() !== "";
      applyMake(st as MakeState);
    }
    afterEdit(t.name);
  });
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const r = t.closest<HTMLElement>("[data-reset]");
    if (r) {
      resetMonthly(st, Number(r.dataset.reset));
      afterEdit();
      return;
    }
    const a = t.closest<HTMLElement>("[data-ack]");
    if (a) {
      const key = a.closest<HTMLElement>(".bk-is")!.dataset.key as IssueKey;
      memo.ack = memo.ack.includes(key) ? memo.ack.filter((k) => k !== key) : [...memo.ack, key];
      if (!SAMPLE) writeMemo(memo, KIT);
      afterEdit();
    }
  });
}

// =====================================================================
// ③ 最終チェック
// =====================================================================
const STATE_LABEL: Record<IssueState, string> = { open: "未対応", ack: "確認済み", done: "修正済み" };

function initFinal() {
  recompute();
  const h = headline();
  const rows: string[] = [];
  rows.push(`<li class="bk-fin-r"><div><span>目標に届くか</span><span class="bk-fin-v is-${h.goal[1]}">${esc(h.goal[0])}</span></div></li>`);
  rows.push(`<li class="bk-fin-r"><div><span>コストは上限以内か</span><span class="bk-fin-v is-${h.cost[1]}">${esc(h.cost[0])}</span></div></li>`);
  const keys = [...memo.seen].sort((a, b) => {
    const rank = (k: IssueKey) => (stateOf(k) === "open" ? 0 : 1);
    return rank(a) - rank(b);
  });
  for (const k of keys) {
    const s = stateOf(k);
    const is = issues.find((i) => i.key === k);
    const tone = s === "open" ? (is!.status === "fix" ? "fix" : "check") : "ok";
    const kind = s === "open" ? (is!.status === "fix" ? "直す・" : "確認・") : "";
    rows.push(
      `<li class="bk-fin-r"><a href="${URL_CHECK}?back=1#issue-${k}"><span>${esc(is?.title ?? ISSUE_TITLE[k])}</span><span class="bk-fin-v"><span class="bk-tg ${tone}">${kind}${STATE_LABEL[s]}</span><span class="bk-go">②で見る →</span></span></a></li>`,
    );
  }
  if (!memo.seen.length && d.ready) rows.push(`<li class="bk-fin-r"><div><span>直すところ・確認するところ</span><span class="bk-fin-v is-ok">ありません</span></div></li>`);
  $("bk-fin-l").innerHTML = rows.join("");
  const fixN = openIssues().filter((i) => i.status === "fix").length;
  const checkN = openIssues().filter((i) => i.status === "check").length;
  $("bk-f-fix").textContent = String(fixN);
  $("bk-f-check").textContent = String(checkN);
  $("bk-f-ok").textContent = String(d.items.filter((i) => i.status === "ok").length);
  $("bk-f-fix").parentElement!.classList.toggle("on", fixN > 0);
  $("bk-f-check").parentElement!.classList.toggle("on", checkN > 0);
  $("bk-fin-name").textContent = planFileName(st, KIT);

  const open = openIssues();
  const agree = $<HTMLInputElement>("bk-agree");
  const btn = $<HTMLButtonElement>("bk-dl");
  const err = $("bk-dlerr");
  $("bk-agree-t").textContent = "診断結果を確認しました";
  $("bk-fin-lead").textContent = open.length
    ? `未対応が${open.length}件あります。直す場合は、行を押すと ② のそのカードに戻ります。問題なければチェックを入れてダウンロードします。`
    : `未対応の項目はありません。チェックを入れて、${KIT.doc}（Excel）をダウンロードします。`;

  const yearOk = Number.isInteger(st.input.startYear) && st.input.startYear >= 2000 && st.input.startYear <= 2100;
  if (!d.ready || !yearOk) {
    agree.disabled = true;
    err.hidden = false;
    err.innerHTML = !d.ready
      ? `判定に必要な数字が足りないため、まだダウンロードできません。<a href="${URL_CHECK}?back=1">② 診断・修正に戻る →</a>`
      : `期首（年）が入っていないため、まだダウンロードできません。<a href="${URL_INPUT}">入力の画面で期首を入れる →</a>`;
  }
  agree.addEventListener("change", () => {
    btn.disabled = !agree.checked;
  });
  btn.addEventListener("click", async () => {
    if (!agree.checked) return;
    err.hidden = true;
    const handle = await pickSaveTarget(st, KIT);
    if (handle === "abort") return;
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.textContent = "作っています…";
    try {
      await writePlanFile(st, d, KIT, handle);
      // 保存が終わったら、自動で ④ 次へ（通常のダウンロードが始まりきるよう少しだけ待つ）
      window.setTimeout(() => (location.href = URL_DONE), 600);
    } catch (e) {
      console.error(e);
      err.textContent = "ファイルを作れませんでした。通信を確かめて、もう一度お試しください。";
      err.hidden = false;
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });
}

// =====================================================================
// ④⑤ 完了
// =====================================================================
function initDone() {
  recompute();
  $("bk-done-file").textContent = planFileName(st, KIT);
  const open = openIssues();
  const left = $("bk-done-left");
  left.hidden = !open.length;
  left.textContent = open.length ? `。未対応の${open.length}件も「診断結果」シートに載っています` : "";

  const again = $<HTMLButtonElement>("bk-again");
  const err = $("bk-dlerr");
  again.addEventListener("click", async () => {
    err.hidden = true;
    const handle = await pickSaveTarget(st, KIT);
    if (handle === "abort") return;
    again.disabled = true;
    try {
      await writePlanFile(st, d, KIT, handle);
    } catch (e) {
      console.error(e);
      err.textContent = "ファイルを作れませんでした。通信を確かめて、もう一度お試しください。";
      err.hidden = false;
    } finally {
      again.disabled = false;
    }
  });

  // 次のKit：この数字のまま、KPI管理表作成Kitの入力の画面に移る（アップロード不要）
  document.getElementById("bk-to-kpi")?.addEventListener("click", () => {
    const store = KITS.kpimake.store;
    let has = false;
    try {
      has = !!localStorage.getItem(store);
    } catch {
      /* 読めなければ確認しない */
    }
    if (has && !window.confirm("KPI管理表作成Kitで入力中の数字を、いま作った年間予算表の数字に置きかえます。よろしいですか？")) return;
    const copy: BudgetState = JSON.parse(JSON.stringify(st));
    copy.notes = [];
    const m = toMake(copy);
    m.notes = ["予算案診断Kitで作った年間予算表の数字を引き継ぎました。", ...m.notes];
    try {
      localStorage.setItem(store, JSON.stringify(m));
    } catch {
      /* 保存できなければ、空の画面から始まる */
    }
    location.href = `${KITS.kpimake.path}/input`;
  });
}

// ---------- サンプル画面 ----------
function initSample() {
  initCheck();
  let sheetTab: "main" | "diag" = "main";
  const renderSheet = () => {
    $("bk-sheet").innerHTML = sheetTab === "main" ? sheetHtml(st, KIT) : diagHtml(st, d, new Date(), KIT);
    $("bk-s-main").setAttribute("aria-selected", String(sheetTab === "main"));
    $("bk-s-diag").setAttribute("aria-selected", String(sheetTab === "diag"));
  };
  const show = (v: string) => {
    document.querySelectorAll<HTMLElement>("[data-smp]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.smp === v)));
    $("bk-smp-sheet").hidden = v !== "sheet";
    $("bk-flow").hidden = v !== "check";
    if (v === "sheet") renderSheet();
  };
  document.querySelectorAll<HTMLElement>("[data-smp]").forEach((b) => b.addEventListener("click", () => show(b.dataset.smp!)));
  $("bk-s-main").addEventListener("click", () => {
    sheetTab = "main";
    renderSheet();
  });
  $("bk-s-diag").addEventListener("click", () => {
    sheetTab = "diag";
    renderSheet();
  });
  if (new URLSearchParams(location.search).get("tab") === "sheet") show("sheet");
}

// ---------- はじめ ----------
if (!loaded) noData();
else if (MODE === "check") initCheck();
else if (MODE === "sample") initSample();
else if (MODE === "final") initFinal();
else initDone();
