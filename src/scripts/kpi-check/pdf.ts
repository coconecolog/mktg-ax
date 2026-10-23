// src/scripts/kpi-check/pdf.ts
//
// KPI運用チェッカーのPDF（A4横）を作る・読む。画面（src/scripts/kpi-check/app.ts）から使う。
// - 初回：3ページ（判定／KPIツリーと施策の目標／経営との合意）。毎月：1ページ（9pt未満になるなら分ける）
// - html2canvas-pro で各ページを画像にし、pdf-lib でPDFにする（CDNから、使うときだけ読み込む）
// - 入力データ（raw）はPDFの添付ファイル（mktgax-kpi-check.json）に入れ、次回はPDFを読み込む
// - 渡す KcData は resolveData() で空欄を埋めたもの（rd）と、入力そのもの（raw）の2つ
import {
  FIRST_GROUPS,
  FIRST_LABEL,
  MEASURES,
  MONTH_LABEL,
  SOURCES,
  computeMonth,
  costOf,
  cplCapOf,
  firstJudgments,
  fmtCount,
  fmtMan1,
  fmtNum,
  fmtPct0,
  formatValue,
  hasParts,
  leadKpi,
  limitsOf,
  manageDayLabel,
  monthLabel,
  monthOf,
  monthlyTargetOf,
  periodLabel,
  periodMonths,
  rangeLabel,
  selectedMeasures,
  smallKpis,
  targetCplOf,
  type FirstItem,
  type KcData,
  type MeasureId,
  type MonthReport,
} from "@/lib/kpiCheck";

export const ATTACH_NAME = "mktgax-kpi-check.json";
const LIB_PDF = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
const LIB_CANVAS = "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.0/dist/html2canvas-pro.min.js";
const FOOT = "KPI運用チェッカー｜MKTG.AX　mktg.ax/tools/kpi-check";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const badge = (status: string, label: string) => `<span class="kp-bd kp-b-${status}">${esc(label)}</span>`;
function counts(items: FirstItem[]) {
  return { ok: items.filter((x) => x.status === "ok").length, check: items.filter((x) => x.status === "check").length, fix: items.filter((x) => x.status === "fix").length };
}

function firstItemsHtml(items: FirstItem[]) {
  let html = "";
  let g = "";
  for (const it of items) {
    if (it.group !== g) {
      g = it.group;
      html += `<p class="kp-jg">${esc(FIRST_GROUPS[it.group])}</p>`;
    }
    const link = it.link ? `。${esc(it.link.label)}（mktg.ax${esc(it.link.href)}）` : "";
    html += `<div class="kp-jr"><span class="n">${it.no}</span><div><p class="t">${esc(it.title)}</p><p class="r">${esc(it.reason)}${link}</p></div>${badge(it.status, FIRST_LABEL[it.status])}</div>`;
  }
  return html;
}

function pageWrap(inner: string, title: string, sub: string, pageNo: string, extraClass = "") {
  return `<div class="kp ${extraClass}"><div class="kp-h"><h2>${esc(title)}</h2><p>${sub}</p></div><div class="kp-fit">${inner}</div><div class="kp-f"><span>${esc(FOOT)}　※このPDFを次回読み込むと、目標と実績が入ります</span><span>${pageNo}</span></div></div>`;
}

export function firstPages(rd: KcData): string[] {
  const p = rd.plan;
  const items = firstJudgments(p);
  const c = counts(items);
  const today = new Date();
  const sub = `期間：${esc(periodLabel(p.period))}（期首 ${p.startYear}年${p.startMonth}月）<br />作成日：${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const fixes = items.filter((x) => x.status === "fix");
  const checks = items.filter((x) => x.status === "check");
  const right =
    `<div class="kp-bx" style="border-color:#c81e1e"><p class="kp-bxh" style="color:#c81e1e">直すところ<small>${fixes.length}件</small></p>${fixes.length ? fixes.map((f) => `<div class="kp-fix"><b>${f.no}. ${esc(f.title)}</b><br />${esc(f.fix || f.reason)}</div>`).join("") : '<p class="kp-note">ありません</p>'}</div>` +
    `<div class="kp-bx" style="margin-top:12px"><p class="kp-bxh">確認するところ<small>${checks.length}件</small></p>${checks.length ? checks.map((f) => `<p style="font-size:10.5px;line-height:1.6;margin-top:3px"><b>${f.no}. ${esc(f.title)}</b>　${esc(f.reason)}${f.link ? `（${esc(f.link.label)}：mktg.ax${esc(f.link.href)}）` : ""}</p>`).join("") : '<p class="kp-note">ありません</p>'}</div>` +
    `<div class="kp-bx" style="margin-top:12px"><p class="kp-bxh">判定の基準</p><p style="font-size:9.5px;line-height:1.7;color:#4f5057">施策のリード目標の合計：ツリーのリード数との差が±5%以内なら問題なし<br />率：一般的な値（商談化率15%・受注率29%）の半分未満または2倍超、または一般的な値のままなら確認<br />件数が少ないKPI：月の目標10件未満は直近3か月の合計で判定（商談化率は常に3か月の合計）<br />許容CPL＝CACの上限×商談化率×受注率　CACの上限＝平均単価×粗利率×取り返す年数</p></div>`;
  const page1 = pageWrap(
    `<div class="kp-c2"><div><div class="kp-sum"><div class="kp-s-ok"><b>${c.ok}</b>問題なし</div><div class="kp-s-check"><b>${c.check}</b>確認が必要</div><div class="kp-s-fix"><b>${c.fix}</b>直す</div></div>${firstItemsHtml(items)}</div><div>${right}</div></div>`,
    "KPIツリーの妥当性の判定",
    sub,
    "1 / 3",
  );

  // 2ページ目：ツリーと施策ごとの目標
  const n = periodMonths(p.period);
  const node = (label: string, v: string, dark = false) => `<div class="kp-node${dark ? " dark" : ""}"><small>${label}</small><b>${v}</b></div>`;
  const arr = (t: string) => `<div class="kp-arr">${t}<b>→</b></div>`;
  const sel = selectedMeasures(p);
  const leadList = sel.map((id) => `${esc(MEASURES[id].short)} ${fmtCount(p.measures[id].kpis[leadKpi(id).key].target)}件`).join("<br />");
  const tree = `<div class="kp-tree">${node("売上（マーケ経由）", fmtNum(p.sales), true)}${arr(`÷平均単価 ${fmtNum(p.price)}`)}${node("受注数", `${fmtCount(p.wins)}件`)}${arr(`÷受注率 ${fmtNum(p.winRate, 1)}%`)}${node("商談数", `${fmtCount(p.deals)}件`)}${arr(`÷商談化率 ${fmtNum(p.dealRate, 1)}%`)}${node("リード数", `${fmtCount(p.leads)}件`)}<div class="kp-arr" style="width:36px">＝</div><div style="font-size:10.5px;line-height:1.6">${leadList}</div></div>`;
  const smallSet = new Set(smallKpis(p).map((s) => s.replace(/（.*$/, "")));
  const card = (id: MeasureId) => {
    const def = MEASURES[id];
    const mp = p.measures[id];
    const cost = costOf(mp);
    const cap = cplCapOf(p, id);
    const exitIdx = mp.exitAfter === null ? null : mp.start + mp.exitAfter;
    const meta = [cost !== null ? `費用${fmtNum(cost, 1)}` : "", cap !== null ? `CPL上限${fmtMan1(cap)}` : "", exitIdx !== null && exitIdx <= 11 && cost !== null ? `撤退判定${monthLabel(p, exitIdx)}` : ""]
      .filter(Boolean)
      .join("・");
    const rows = def.kpis
      .filter((k) => mp.kpis[k.key].target !== null)
      .map((k) => {
        const kp = mp.kpis[k.key];
        const unit = k.kind === "rate" || k.kind === "ref" ? "%" : "";
        let m = "—";
        if (k.kind === "count" || k.kind === "level") {
          const entered = kp.monthly.slice(0, n).some((v) => v !== null && v !== undefined);
          if (entered) {
            const nz = kp.monthly.slice(0, n).map((v, i) => ({ v: v || 0, i })).filter((x) => x.v > 0);
            m = nz.length <= 2 ? nz.map((x) => `${monthLabel(p, x.i)} ${fmtCount(x.v)}`).join("・") : "月別";
          } else m = fmtCount(monthlyTargetOf(k.kind, kp.target, kp.monthly, p, 0));
        }
        const sm = smallSet.has(`${def.short}の${k.label}`) ? " ◇" : "";
        const ms = kp.measurable ? "" : " ※";
        return `<tr><td>${esc(k.label)}${ms}</td><td>${k.kind === "cpl" ? fmtMan1(kp.target) : fmtNum(kp.target, unit ? 1 : 0)}${unit}</td><td>${esc(m)}${sm}</td></tr>`;
      })
      .concat(
        mp.others
          .filter((o) => o.target !== null)
          .map((o) => `<tr><td>その他：${esc(o.name || "その他のKPI")}${o.measurable ? "" : " ※"}</td><td>${fmtNum(o.target)}</td><td>${fmtCount(monthlyTargetOf("count", o.target, o.monthly, p, 0))}</td></tr>`),
      )
      .join("");
    const t = targetCplOf(p, id);
    return `<div class="kp-bx"><p class="kp-bxh">${esc(def.short)}<small>${esc(meta)}</small></p><table class="kp-t"><tr><th>KPI</th><th>目標</th><th>月</th></tr>${rows}</table>${t !== null ? `<p class="kp-note">目標のCPL ${fmtMan1(t)}万円</p>` : ""}</div>`;
  };
  const cm = p.commonMeasurable;
  const common = `<div class="kp-bx"><p class="kp-bxh">共通（リードになった後）</p><table class="kp-t"><tr><th>KPI</th><th>目標</th><th>月</th></tr>
    <tr><td>営業に渡せる割合${cm.handoffRate ? "" : " ※"}</td><td>${p.handoffTarget === null ? "—" : fmtNum(p.handoffTarget, 1) + "%"}</td><td>—</td></tr>
    <tr><td>商談化率／商談数${cm.dealRate ? "" : " ※"}</td><td>${fmtNum(p.dealRate, 1)}%／${fmtCount(p.deals)}件</td><td>${p.deals === null ? "—" : fmtCount(p.deals / n)} ◇</td></tr>
    <tr><td>受注率／受注数${cm.winRate ? "" : " ※"}</td><td>${fmtNum(p.winRate, 1)}%／${fmtCount(p.wins)}件</td><td>${p.wins === null ? "—" : fmtCount(p.wins / n)}${smallSet.has("受注数") ? " ◇" : ""}</td></tr></table></div>`;
  const cards = sel.map(card).concat(common);
  const page2 = pageWrap(
    `${tree}<div class="kp-c3">${cards.join("")}</div><p class="kp-note" style="margin-top:8px">◇＝月の目標が10件未満（直近3か月の合計で判定）　※＝今は取れていない数字　金額は万円</p>`,
    "KPIツリーと施策ごとの目標",
    `期間：${esc(periodLabel(p.period))}（期首 ${p.startYear}年${p.startMonth}月）<br />単位：万円`,
    "2 / 3",
    sel.length > 5 ? "dense" : "",
  );

  // 3ページ目：経営との合意
  const { cacLimit: lim, allowCpl } = limitsOf(p);
  const totalCost = sel.reduce((s, id) => s + (costOf(p.measures[id]) || 0), 0);
  const leadsTxt = sel
    .map((id) => {
      const k = leadKpi(id);
      const t = targetCplOf(p, id);
      return `${esc(MEASURES[id].short)}＝${esc(k.label)}${fmtCount(p.measures[id].kpis[k.key].target)}件${t !== null ? `・CPL${fmtMan1(t)}万円` : ""}`;
    })
    .join("、");
  const exitTxt = sel
    .map((id) => {
      const mp = p.measures[id];
      const cap = cplCapOf(p, id);
      const idx = mp.exitAfter === null ? null : mp.start + mp.exitAfter;
      if (costOf(mp) === null) return `${esc(MEASURES[id].short)}：費用なし（撤退の判断なし）`;
      if (idx === null || idx > 11) return `${esc(MEASURES[id].short)}：判定する月なし`;
      return `${esc(MEASURES[id].short)}：${monthLabel(p, idx)}から（CPL上限${cap === null ? "未入力" : fmtMan1(cap) + "万円"}）`;
    })
    .join("　");
  const costTxt =
    totalCost > 0
      ? `合計${fmtNum(totalCost, 1)}万円${lim !== null ? `　CACの上限${fmtNum(lim)}万円（粗利率${fmtNum(p.margin, 1)}%・${fmtNum(p.years, 1)}年で取り返す）` : ""}${allowCpl !== null ? `　許容CPL${fmtMan1(allowCpl)}万円` : ""}`
      : "費用は入っていません";
  const partsRows = sel.filter((id) => hasParts(p.measures[id].parts));
  const partsTxt = partsRows.length
    ? "<br />" +
      partsRows
        .map((id) => {
          const pp = p.measures[id].parts;
          return `${esc(MEASURES[id].short)}：外部${fmtNum(pp.ext || 0, 1)}・人件費${fmtNum(pp.labor || 0, 1)}・ツール${fmtNum(pp.tool || 0, 1)}`;
        })
        .join("　")
    : "";
  const page3 = pageWrap(
    `<div class="kp-agree">
      <div>判断する人</div><div>${esc(p.decider) || "（未記入）"}</div>
      <div>振り返りの日</div><div>${esc(p.review) || "（未記入）"}（管理日：${esc(manageDayLabel(p.manageDay))}に数字を入れる）</div>
      <div>見る指標</div><div><b>売上（マーケ経由）${fmtNum(p.sales)}万円</b>　受注${fmtCount(p.wins)}件・商談${fmtCount(p.deals)}件・リード${fmtCount(p.leads)}件<br />施策ごと：${leadsTxt || "—"}</div>
      <div>判定の線</div><div>実績÷目標が100%以上＝達成、90%以上＝やや届かない、90%未満＝届かない（CPLは目標÷実績）<br />月の目標が10件未満のKPIと商談化率は、直近3か月の合計で判定する。受注率は決着した商談が10件たまってから判定する</div>
      <div>撤退の基準</div><div>判定する月以降、開始月からの累計で、施策のCPLが上限を超え、かつリード数が目標の90%未満なら撤退を検討する<br />${exitTxt || "—"}</div>
      <div>費用の目安</div><div>${costTxt}${partsTxt}</div>
    </div><div class="kp-sign"><div>判断する人</div><div>マーケ責任者</div></div>`,
    "KPIの運用についての合意",
    sub,
    "3 / 3",
  );
  return [page1, page2, page3];
}

// ---------- 毎月のPDF ----------
const COL_GAP = 20;
const COL_W = (1123 - 72 - COL_GAP) / 2;
const ratioClass = (r: number | null) => (r === null ? "" : r >= 1 - 1e-9 ? "c-ok" : r >= 0.9 - 1e-9 ? "c-near" : "c-ng");

export function monthTableHtml(rd: KcData, r: MonthReport, prefix: "kc" | "kp", measures = r.measures) {
  const rows: string[] = [];
  const pdf = prefix === "kp";
  const bd = (status: string, label: string) => `<span class="${prefix}-bd ${prefix}-b-${status}">${esc(label)}</span>`;
  for (const m of measures) {
    const startIdx = m.id !== "common" ? rd.plan.measures[m.id].start : 0;
    rows.push(`<tr class="grp"><td colspan="${pdf ? 5 : 6}">${esc(m.name)}${!m.started ? `<small>${esc(monthLabel(rd.plan, startIdx))}から</small>` : ""}</td></tr>`);
    if (!m.started) continue;
    if (!m.rows.length) rows.push(`<tr><td colspan="${pdf ? 5 : 6}">目標の入ったKPIがありません</td></tr>`);
    for (const row of m.rows) {
      const tag = row.actionShown ? `<span class="${prefix}-tag">打ち手</span>` : "";
      const label = `${esc(row.label)}${row.window ? " ◇" : ""}${tag}${row.note && !pdf ? `<span class="nt">${esc(row.note)}</span>` : row.note && pdf && row.status === "pending" ? `（${esc(row.note)}）` : ""}`;
      const tgt = row.status === "pending" && row.target === null ? "—" : formatValue(row.vkind, row.target);
      const change = pdf ? "" : `<td>${changeCellOf(row.vkind, row.prev, row.cur)}</td>`;
      rows.push(
        `<tr${row.first ? ' class="first"' : ""}><td>${label}</td><td class="plan">${tgt}</td><td class="act">${formatValue(row.vkind, row.actual)}</td><td class="${ratioClass(row.ratio)}">${row.ratio === null ? "—" : fmtPct0(row.ratio)}</td>${change}<td>${bd(row.status, MONTH_LABEL[row.status])}</td></tr>`,
      );
    }
  }
  return `<table class="${prefix}-t"><tr><th>KPI</th><th>目標</th><th>実績</th><th>達成率</th>${pdf ? "" : "<th>前月比</th>"}<th style="text-align:center">判定</th></tr>${rows.join("")}</table>`;
}
function changeCellOf(vkind: string, prev: number | null, cur: number | null): string {
  if (prev === null || cur === null) return "—";
  if (vkind === "rate") {
    const d = (cur - prev) * 100;
    return `${d >= 0 ? "+" : "−"}${fmtNum(Math.abs(d), 1)}pt`;
  }
  if (prev === 0) return "—";
  const p = (cur - prev) / prev;
  return `${p >= 0 ? "+" : "−"}${fmtNum(Math.abs(p) * 100)}%`;
}

export const srcText = (keys: string[], link: boolean) =>
  keys.map((k) => (link ? `<a href="${SOURCES[k].url}" target="_blank" rel="noopener">出典${k}：${esc(SOURCES[k].name)}</a>` : `出典${k} ${esc(SOURCES[k].name)}`)).join("／");

export function exitHtml(r: MonthReport, prefix: "kc" | "kp") {
  const strong = r.exits.filter((e) => e.status === "exit");
  const rest = r.exits.filter((e) => e.status !== "exit");
  const box = strong.map((e) => `<div class="${prefix}-exit"><b>${esc(e.name)}：撤退を検討</b>（${esc(e.fromLabel)}から判定）<br />${esc(e.reason)}</div>`).join("");
  const lines = rest
    .map((e) => (e.status === "keep" ? `${esc(e.name)}：続ける（${esc(e.reason.replace(/^.*?累計　/, ""))}）` : `${esc(e.name)}：${esc(e.reason)}`))
    .join("<br />");
  if (!box && !lines) return `<p class="${prefix === "kc" ? "kc-none" : "kp-exit-s"}">撤退を判定する施策はありません（費用と撤退を判定する月を入れた施策が対象です）</p>`;
  return box + (lines ? `<p class="${prefix}-exit-s">${lines}</p>` : "");
}

function monthActionBlocks(r: MonthReport): string[] {
  const acts: string[] = [];
  for (const m of r.measures) {
    if (!m.started) continue;
    for (const pk of m.picks) {
      if (!pk.items) {
        acts.push(`<div class="kp-ab"><p class="k">${esc(m.name)}｜${esc(pk.label)}</p><p class="x">打ち手なし（判定のみ）</p></div>`);
        continue;
      }
      const eff =
        m.effect && (m.effect.did || m.effect.changes.length)
          ? `<p class="e">${esc(m.effect.prevLabel)}に実施：${esc(m.effect.did || "記入なし")}${m.effect.changes.length ? ` → ${m.effect.changes.map(esc).join("、")}` : ""}</p>`
          : "";
      const srcs = Array.from(new Set(pk.items.flatMap((x) => x.src)));
      acts.push(`<div class="kp-ab"><p class="k">${esc(m.name)}｜${esc(pk.label)}</p><p class="a">${pk.items.map((x) => esc(x.text)).join("／")}</p><p class="s">${srcText(srcs, false)}</p>${eff}</div>`);
    }
  }
  return acts;
}
const H_TABLE = '<p class="kp-bxh">1. KPIごとの達成・未達<small>◇＝直近3か月の合計</small></p>';
const LEGEND = '<p class="kp-note">達成＝100%以上　やや届かない＝90%以上　届かない＝90%未満（CPLは目標÷実績）。うすい赤＝施策の中で上から最初に「届かない」になったKPI</p>';
const H_ACT = '<p class="kp-bxh">2. 次の打ち手と、前月に実施したことの効果</p>';
const H_EXIT = '<p class="kp-bxh" style="margin-top:10px">3. 撤退の判断</p>';
const NO_ACT = '<p class="kp-note">「届かない」のKPIはありません</p>';

function probe(htmls: string[], width: number): number[] {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-20000px;top:0;z-index:-1;";
  holder.innerHTML = `<div class="kp km" style="height:auto"><div style="width:${width}px">${htmls.map((h) => `<div class="kp-probe" style="display:flow-root">${h}</div>`).join("")}</div></div>`;
  document.body.appendChild(holder);
  const hs = Array.from(holder.querySelectorAll<HTMLElement>(".kp-probe")).map((e) => e.offsetHeight);
  holder.remove();
  return hs;
}
function pageFits(html: string): { fits: boolean; avail: number } {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-20000px;top:0;width:1123px;height:794px;z-index:-1;";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const fit = holder.querySelector<HTMLElement>(".kp-fit")!;
  const avail = 794 - fit.offsetTop - 34;
  const fits = fit.scrollHeight <= avail;
  holder.remove();
  return { fits, avail };
}
function pack(blocks: string[], heights: number[], avail: number): string[][] {
  const cols: string[][] = [[]];
  let h = 0;
  blocks.forEach((b, k) => {
    if (h > 0 && h + heights[k] > avail) {
      cols.push([]);
      h = 0;
    }
    cols[cols.length - 1].push(b);
    h += heights[k];
  });
  return cols;
}

/** 毎月のPDF。本文は12px（＝9pt）以上。1枚に収まらなければ縮めずにページを分ける */
export function monthPages(rd: KcData, r: MonthReport): string[] {
  const p = rd.plan;
  const title = `KPIの運用｜${r.label}`;
  const sub = `運用：${esc(rangeLabel(p))}（${r.index + 1}か月目）<br />判断する人：${esc(p.decider || "—")}　振り返りの日：${esc(p.review || "—")}`;
  const acts = monthActionBlocks(r);
  const exit = exitHtml(r, "kp");
  const single = pageWrap(
    `<div class="kp-c2m"><div>${H_TABLE}${monthTableHtml(rd, r, "kp")}${LEGEND}</div><div>${H_ACT}${acts.join("") || NO_ACT}${H_EXIT}${exit}</div></div>`,
    title,
    sub,
    "1 / 1",
    "km",
  );
  const one = pageFits(single);
  if (one.fits) return [single];
  const [hHead, hLegend] = probe([H_TABLE, LEGEND], COL_W);
  const tBlocks = r.measures.map((m) => monthTableHtml(rd, r, "kp", [m]));
  const tCols = pack(tBlocks, probe(tBlocks, COL_W), one.avail - hHead - hLegend - 4);
  const aBlocks = [H_ACT, ...(acts.length ? acts : [NO_ACT]), `${H_EXIT}${exit}`];
  const aCols = pack(aBlocks, probe(aBlocks, COL_W), one.avail - 4);
  const bodies: string[] = [];
  for (let k = 0; k < tCols.length; k += 2) {
    const last = k + 2 >= tCols.length;
    const legendCol = tCols[k + 1] ? 1 : 0;
    const cols = [tCols[k], tCols[k + 1] || []].map((c, n) => `<div>${c.join("")}${last && n === legendCol ? LEGEND : ""}</div>`);
    bodies.push(`${H_TABLE}<div class="kp-c2e">${cols.join("")}</div>`);
  }
  for (let k = 0; k < aCols.length; k += 2) bodies.push(`<div class="kp-c2e"><div>${aCols[k].join("")}</div><div>${(aCols[k + 1] || []).join("")}</div></div>`);
  return bodies.map((b, k) => pageWrap(b, title, sub, `${k + 1} / ${bodies.length}`, "km"));
}

// ---------- ライブラリ ----------
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

function fitPage(pageEl: HTMLElement) {
  const fit = pageEl.querySelector<HTMLElement>(".kp-fit");
  if (!fit) return;
  const avail = 794 - fit.offsetTop - 34;
  const h = fit.scrollHeight;
  if (h <= avail) return;
  const s = Math.max(0.6, avail / h);
  const w = fit.clientWidth;
  fit.style.width = `${w / s}px`;
  fit.style.transform = `scale(${s})`;
  fit.style.transformOrigin = "top left";
}

async function renderPages(pages: string[]): Promise<ArrayBuffer[]> {
  const w = window as any;
  const h2c = w.html2canvas?.default || w.html2canvas;
  const out: ArrayBuffer[] = [];
  if ((document as any).fonts?.ready) await (document as any).fonts.ready;
  for (const html of pages) {
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-20000px;top:0;width:1123px;height:794px;z-index:-1;";
    holder.innerHTML = html;
    document.body.appendChild(holder);
    fitPage(holder.firstElementChild as HTMLElement);
    try {
      const canvas: HTMLCanvasElement = await h2c(holder.firstElementChild, { scale: 2, backgroundColor: "#ffffff", width: 1123, height: 794, logging: false });
      out.push(
        await new Promise<ArrayBuffer>((resolve, reject) =>
          canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error("画像を作れませんでした"))), "image/png"),
        ),
      );
    } finally {
      holder.remove();
    }
  }
  return out;
}

/** PDFを作ってダウンロードする。kind＝"first"（初回3ページ）／"monthly"（その月） */
export async function makePdf(raw: KcData, rd: KcData, kind: "first" | "monthly", email: string | null): Promise<void> {
  await Promise.all([loadScript(LIB_PDF), loadScript(LIB_CANVAS)]);
  const PDFLib = (window as any).PDFLib;
  let pages: string[];
  let title: string;
  let fileName: string;
  if (kind === "first") {
    pages = firstPages(rd);
    title = `KPIツリーの妥当性の判定（期首 ${rd.plan.startYear}年${rd.plan.startMonth}月）`;
    fileName = `kpi-check-plan-${rd.plan.startYear}-${String(rd.plan.startMonth).padStart(2, "0")}.pdf`;
  } else {
    const r = computeMonth(rd, rd.reportIndex);
    pages = monthPages(rd, r);
    const { year, month } = monthOf(rd.plan, rd.reportIndex);
    title = `KPIの運用 ${r.label}`;
    fileName = `kpi-check-${year}-${String(month).padStart(2, "0")}.pdf`;
  }
  const images = await renderPages(pages);
  const pdf = await PDFLib.PDFDocument.create();
  for (const png of images) {
    const page = pdf.addPage([841.89, 595.28]);
    const img = await pdf.embedPng(png);
    page.drawImage(img, { x: 0, y: 0, width: 841.89, height: 595.28 });
  }
  pdf.setTitle(title);
  pdf.setCreator("MKTG.AX KPI運用チェッカー（mktg.ax/tools/kpi-check）");
  pdf.setProducer("MKTG.AX");
  pdf.setLanguage("ja-JP");
  const payload = { ...raw, mode: kind, email: email || undefined };
  await pdf.attach(new TextEncoder().encode(JSON.stringify(payload)), ATTACH_NAME, {
    mimeType: "application/json",
    description: "KPI運用チェッカーの入力データ（次回このPDFを読み込むと、目標と前月までの実績が入ります）",
    creationDate: new Date(),
    modificationDate: new Date(),
  });
  const bytes: Uint8Array = await pdf.save({ useObjectStreams: false });
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** このツールで作ったPDFから、添付した入力データを取り出す。見つからなければ null */
export async function readPdfData(file: File): Promise<any> {
  await loadScript(LIB_PDF);
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, decodePDFRawStream } = (window as any).PDFLib;
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const ef = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  if (!ef) return null;
  const pairs: [string, any][] = [];
  const walk = (node: any) => {
    const arr = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (arr) for (let i = 0; i + 1 < arr.size(); i += 2) pairs.push([arr.lookup(i).decodeText?.() ?? "", arr.lookup(i + 1, PDFDict)]);
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i, PDFDict));
  };
  walk(ef);
  const hit = pairs.find(([n]) => n === ATTACH_NAME);
  if (!hit) return null;
  const stream = hit[1].lookupMaybe(PDFName.of("EF"), PDFDict)?.lookupMaybe(PDFName.of("F"), PDFStream);
  if (!stream) return null;
  return JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
}
