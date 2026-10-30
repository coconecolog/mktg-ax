// src/scripts/budget-checker/preview.ts
//
// 予算案診断キット・KPI妥当性診断キット：ダウンロードするExcelの完成イメージを、画面にHTMLで出す。
// - 「年間予算表（施策別）」「はじめに入力」（同じ表）：ひな形の式と同じ計算で、同じ並びの表を出す
// - 「診断結果」：src/lib/budget-sheet.ts の診断結果シートと同じ中身
import { CHANNELS, fmt, groupLabel, monthLabels, pct, type BudgetDiagnosis, type BudgetState } from "@/lib/budgetCheck";
import { KITS, type PlanKit } from "@/lib/planKits";
import { calc } from "@/lib/kpi-sheet-maker";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const NA = "—";
const z = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? 0 : v);

type Cell = { v: string; k?: "in" | "calc" | "lb" | "fix" | "check" | "head" };
const td = (c: Cell) => (c.k === "head" ? `<th>${esc(c.v)}</th>` : `<td class="${c.k ?? ""}">${esc(c.v)}</td>`);
const table = (rows: Cell[][], cls = "") => `<div class="bk-tw"><table class="bk-t bk-pv ${cls}"><tbody>${rows.map((r) => `<tr>${r.map(td).join("")}</tr>`).join("")}</tbody></table></div>`;
const H = (v: string): Cell => ({ v, k: "head" });
const I = (v: string): Cell => ({ v, k: "in" });
const C = (v: string): Cell => ({ v, k: "calc" });
const L = (v: string): Cell => ({ v, k: "lb" });

/** 年間予算表（施策別）の完成イメージ */
export function sheetHtml(st: BudgetState, kit: PlanKit = KITS.budget): string {
  const inp = st.input;
  const r = calc({ ...inp, goal: z(inp.goal), price: z(inp.price), gmPct: z(inp.gmPct), paybackYears: z(inp.paybackYears), leadTime: z(inp.leadTime) });
  const labels = monthLabels(inp.startMonth || 4);
  const ratio = (a: number | null) => (a === null ? "0%" : pct(a));
  const f1 = (v: number | null) => fmt(z(v), 1);
  const f0 = (v: number | null) => fmt(z(v), 0);
  let h = `<p class="bk-pv-title">${kit.id === "kpi" ? "はじめに入力" : "年間予算表"}</p><p class="bk-pv-n">水色＝入力　灰色＝自動計算　単位：万円</p>`;

  h += `<p class="bk-pv-h1">【1】年間予算計画を立てる</p><p class="bk-pv-h">1. 前提の入力</p>`;
  h += table([
    ["期首", "マーケ経由の売上目標", "平均受注単価", "粗利率", "回収期間", "リードタイム", "1社あたりの月の粗利", "CACの上限", "許容CPL", "共通費"].map(H),
    [
      I(`${inp.startYear}/${inp.startMonth}/1`),
      I(f0(inp.goal)),
      I(f0(inp.price)),
      I(`${fmt(z(inp.gmPct), 0)}%`),
      I(fmt(z(inp.paybackYears), 1)),
      I(f0(inp.leadTime)),
      C(f1(r.monthlyProfit)),
      C(f1(r.cacLimit)),
      C(f1(r.allowableCpl)),
      I(f0(inp.common)),
    ],
  ]);

  h += `<p class="bk-pv-h">2. チャネル別の計画（年間）の入力</p>`;
  const chRow = (name: string, c: (typeof r.channels)[number], isSum: boolean): Cell[] => {
    const K = isSum ? C : I;
    return [
      L(name),
      K(f0(c.leads)),
      C(ratio(c.validRate)),
      K(f0(c.valid)),
      C(ratio(c.dealRate)),
      K(f0(c.deals)),
      C(ratio(c.winRate)),
      K(f0(c.wins)),
      C(f0(c.sales)),
      K(f0(c.ext)),
      K(f0(c.labor)),
      C(f1(c.cpl)),
      C(f0(c.cac)),
      C(f1(c.paybackMonths)),
      c.leads ? { v: c.cplOver ? "上限超え" : "上限内", k: c.cplOver ? "check" : "calc" } : C(""),
    ];
  };
  h += table(
    [
      ["チャネル", "リード数", "有効リード率", "有効リード数", "商談化率", "商談数", "受注率", "受注数", "受注金額", "外部費用", "人件費", "CPL", "CAC", "回収期間", "CPL判定"].map(H),
      ...r.channels.map((c, i) => chRow(CHANNELS[i], c, false)),
      chRow("合計", r.total, true),
    ],
    "bk-pv-wide",
  );
  h += `<p class="bk-pv-n">判定＝CPLが許容CPL以下なら「上限内」、超えたら「上限超え」。CPL・CAC・回収期間は外部費用＋人件費で計算する</p>`;

  h += `<p class="bk-pv-h">3. 計画の妥当性の確認：目標　／　4. 計画の妥当性の確認：コスト</p>`;
  const need = r.need;
  const plan = r.plan;
  const rate = (a: number, b: number) => (b ? pct(a / b) : "0%");
  const judge = (short: boolean): Cell => ({ v: short ? "直す" : "足りる", k: short ? "fix" : "calc" });
  h += table(
    [
      ["", "リード数", "有効リード率", "有効リード数", "商談化率", "商談数", "受注率", "受注数", "受注金額", "コスト合計", "ROI（1年）"].map(H),
      [L("必要な数（逆算）"), C(f0(need.leads)), C(rate(need.valid, need.leads)), C(f0(need.valid)), C(rate(need.deals, need.valid)), C(f0(need.deals)), C(rate(need.wins, need.deals)), C(f0(need.wins)), C(f0(need.sales)), C(f0(r.costTotal)), C(r.roi === null ? "0%" : pct(r.roi))],
      [L("計画の数"), C(f0(plan.leads)), C(rate(plan.valid, plan.leads)), C(f0(plan.valid)), C(rate(plan.deals, plan.valid)), C(f0(plan.deals)), C(rate(plan.wins, plan.deals)), C(f0(plan.wins)), C(f0(plan.sales)), C(""), C("")],
      [L("判定"), judge(r.short.leads), C("-"), judge(r.short.valid), C("-"), judge(r.short.deals), C("-"), judge(r.short.wins), judge(r.short.sales), C(""), C("")],
    ],
    "bk-pv-wide",
  );

  // 【2】月別
  h += `<p class="bk-pv-h1">【2】月別予算計画を立てる</p><p class="bk-pv-h">1. 年間計画（月別）の合計</p>`;
  const sumM = (k: "leads" | "valid") => Array.from({ length: 12 }, (_, m) => st.monthly.reduce((s, x) => s + z(x[k][m]), 0));
  const tl = sumM("leads");
  const tv = sumM("valid");
  const lt = Math.floor(z(inp.leadTime));
  const per = r.total.valid ? r.total.wins / r.total.valid : 0;
  const fc = Array.from({ length: 12 }, (_, m) => tv[(((m - lt) % 12) + 12) % 12] * per);
  const total = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const head = H("");
  h += table(
    [
      [head, ...labels.map(H), H("年間"), H("計画との差")],
      [L("リード数"), ...tl.map((v) => C(f0(v))), C(f0(total(tl))), C(f0(total(tl) - r.total.leads))],
      [L("有効リード数"), ...tv.map((v) => C(f0(v))), C(f0(total(tv))), C(f0(total(tv) - r.total.valid))],
      [L("受注数の見込み"), ...fc.map((v) => C(fmt(v, 1))), C(fmt(total(fc), 1)), C(fmt(total(fc) - r.total.wins, 1))],
    ],
    "bk-pv-m",
  );
  h += `<p class="bk-pv-n">受注数の見込み＝リードを獲得した月からリードタイムの月数あとに計上する。期首からリードタイム分の月は、前期の同じ月のリードを今期と同じとみなして見込む。期末のリードタイム分の受注は翌期に入る</p>`;

  h += `<p class="bk-pv-h">2. チャネル別の計画（月別）の入力</p>`;
  CHANNELS.forEach((name, i) => {
    const c = inp.channels[i];
    const m = st.monthly[i];
    const ext = c.ext / 12;
    const lab = c.labor / 12;
    h += table(
      [
        [H("チャネル"), H(name), ...labels.map(H), H("年間"), H("計画との差")],
        [L(name), L("リード数"), ...m.leads.map((v) => I(f0(v))), C(f0(total(m.leads))), C(f0(total(m.leads) - c.leads))],
        [L(""), L("有効リード数"), ...m.valid.map((v) => I(f0(v))), C(f0(total(m.valid))), C(f0(total(m.valid) - c.valid))],
        [L(""), L("外部費用"), ...labels.map(() => C(fmt(ext, 1))), C(fmt(c.ext, 1)), C("0.0")],
        [L(""), L("人件費"), ...labels.map(() => C(fmt(lab, 1))), C(fmt(c.labor, 1)), C("0.0")],
      ],
      "bk-pv-m bk-pv-m2",
    );
  });
  return h;
}

/** 診断結果シートの完成イメージ（budget-sheet.ts の diagSheetXml と同じ中身） */
export function diagHtml(st: BudgetState, d: BudgetDiagnosis, today = new Date(), kit: PlanKit = KITS.budget): string {
  const inp = st.input;
  const ymd = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  let h = `<p class="bk-pv-title">${esc(kit.diagTitle)}</p><p class="bk-pv-n">期首 ${inp.startYear}/${inp.startMonth}/1　単位 万円　診断日 ${ymd}</p>
<p class="bk-pv-n">この日に診断した結果です。${esc(kit.sheet)}のシートで数字を直したあとは、${esc(kit.name)}で読み込んで診断し直してください。</p>`;
  if (!d.ready || !d.r) return h + `<p class="bk-pv-p">前提（${esc(d.missing.join("・"))}）が入っていないため、診断していません。</p>`;
  const r = d.r;
  h += `<div class="bk-pv-cnt"><span class="${d.counts.fix ? "fix" : ""}">直す ${d.counts.fix}</span><span class="${d.counts.check ? "check" : ""}">確認 ${d.counts.check}</span><span>問題なし ${d.counts.ok}</span></div>`;
  h += `<p class="bk-pv-p">結論：${esc(d.conclusion)}</p>`;
  h += `<p class="bk-pv-h">目標に届くか</p>`;
  const j = (s: boolean): Cell => ({ v: s ? "直す" : "足りる", k: s ? "fix" : undefined });
  h += table([
    ["", "リード数", "有効リード数", "商談数", "受注数", "受注金額"].map(H),
    [L("必要な数（逆算）"), { v: fmt(r.need.leads) }, { v: fmt(r.need.valid) }, { v: fmt(r.need.deals) }, { v: fmt(r.need.wins) }, { v: fmt(r.need.sales) }],
    [L("計画の数"), { v: fmt(r.plan.leads) }, { v: fmt(r.plan.valid) }, { v: fmt(r.plan.deals) }, { v: fmt(r.plan.wins) }, { v: fmt(r.plan.sales) }],
    [L("判定"), j(r.short.leads), j(r.short.valid), j(r.short.deals), j(r.short.wins), j(r.short.sales)],
  ]);
  h += `<p class="bk-pv-h">コストは上限以内か</p>`;
  const over = r.total.cac !== null && r.total.cac > r.cacLimit + 1e-9;
  h += table(
    [
      ["外部費用", "人件費", "共通費", "コスト合計", "CAC", "CACの上限", "回収期間（か月）", "回収期間の上限（か月）", "ROI（1年）"].map(H),
      [
        { v: fmt(r.total.ext) },
        { v: fmt(r.total.labor) },
        { v: fmt(inp.common) },
        { v: fmt(r.costTotal) },
        { v: fmt(r.total.cac), k: over ? "fix" : undefined },
        { v: fmt(r.cacLimit) },
        { v: fmt(r.total.paybackMonths, 1), k: over ? "fix" : undefined },
        { v: fmt(inp.paybackYears * 12, 1) },
        { v: pct(r.roi) },
      ],
    ],
    "bk-pv-wide",
  );
  h += `<p class="bk-pv-h">チャネル別の計画（年間）</p>`;
  const row = (name: string, x: (typeof r.channels)[number]): Cell[] => [
    L(name),
    { v: fmt(x.leads) },
    { v: fmt(x.valid) },
    { v: fmt(x.deals) },
    { v: fmt(x.wins) },
    { v: fmt(x.ext) },
    { v: fmt(x.labor) },
    { v: x.cpl === null ? NA : fmt(x.cpl, 1), k: x.cplOver ? "fix" : undefined },
    { v: fmt(r.allowableCpl, 1) },
    x.cplOver === null ? { v: NA } : { v: x.cplOver ? "上限超え" : "上限内", k: x.cplOver ? "check" : undefined },
  ];
  h += table(
    [["チャネル", "リード数", "有効リード数", "商談数", "受注数", "外部費用", "人件費", "CPL", "許容CPL", "判定"].map(H), ...r.channels.map((x, i) => row(CHANNELS[i], x)), row("合計", r.total)],
    "bk-pv-wide",
  );
  h += `<p class="bk-pv-h">直すところ・確認するところ</p>`;
  const list = d.items.filter((it) => it.status === "fix" || it.status === "check");
  h += list.length
    ? `<ul class="bk-pv-list">${list
        .map(
          (it) =>
            `<li><span class="bk-tg ${it.status}">${it.status === "fix" ? "直す" : "確認"}</span>【${esc(groupLabel(it.group, kit))}】${esc(it.reason)}${it.todo ? `　→ ${esc(it.todo)}` : ""}</li>`,
        )
        .join("")}</ul>`
    : `<p class="bk-pv-p">直すところも、確認するところもありません。</p>`;
  const oks = d.items.filter((it) => it.status === "ok");
  if (oks.length) {
    h += `<p class="bk-pv-h">問題なし</p><ul class="bk-pv-list">${oks.map((it) => `<li>【${esc(groupLabel(it.group, kit))}】${esc(it.title)}：${esc(it.reason)}</li>`).join("")}</ul>`;
  }
  if (st.notes.length) h += `<p class="bk-pv-h">読み込みのときのお知らせ</p><ul class="bk-pv-list">${st.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  return h;
}
