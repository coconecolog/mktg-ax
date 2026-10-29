// src/scripts/kpi-analysis/app.ts
//
// 施策効果診断キット（/tools/kpi-analysis）の画面。計算は src/lib/kpiAnalysis.ts。
// 入口でファイルを置く／選ぶ → 同じページで結果（まとめ → A 月別進捗状況 → B 推移と打ち手 → C 打ち手の効果 → D 表）に切りかえる。
// ?sample=1 のときは、サンプルの管理表（src/data/kpi-analysis-sample.json）で結果を出す。
// PDF は html2canvas-pro で結果を画像にし、pdf-lib でA4縦のPDFにする（CDNから、使うときだけ読み込む）。
import {
  ReadError,
  analyze,
  fmtValue,
  pct,
  signedPct,
  verdict,
  type Analysis,
  type Effect,
  type Row,
} from "@/lib/kpiAnalysis";
import { readBook } from "./xlsx";

const LIB_PDF = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
const LIB_CANVAS = "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.0/dist/html2canvas-pro.min.js";
const C = { ink: "#0b0b12", sub: "#4f5057", mute: "#74757c", faint: "#a3a3a8", line: "#dedee2", bg: "#f5f5f6", red: "#c81e1e", org: "#c2560c" };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let state: { a: Analysis; file: string; sample: boolean; sel: string | null } | null = null;

// ---------- 入口 ----------

function showError(msg: string) {
  const e = $("ka-err");
  if (e) {
    e.textContent = msg;
    e.hidden = false;
  }
  const b = $("ka-busy");
  if (b) b.hidden = true;
}

async function handleFile(file: File) {
  const e = $("ka-err");
  if (e) e.hidden = true;
  const b = $("ka-busy");
  if (b) b.hidden = false;
  try {
    const book = await readBook(file);
    await new Promise((r) => setTimeout(r, 20)); // 「読み込んでいます」を先に描く
    const a = analyze(book);
    if (a.model.last < 0) throw new ReadError("「毎月の実績入力」に実績（リード数）が入っていません。1か月分以上入れてから読み込んでください。");
    show(a, file.name, false);
  } catch (err) {
    showError(err instanceof ReadError ? err.message : "ファイルを読めませんでした。KPI管理表（M-B-04）の .xlsx か確かめてください。");
    if (!(err instanceof ReadError)) console.error(err);
  }
}

function show(a: Analysis, file: string, sample: boolean) {
  const first = a.rows.find((r) => r.total.prob != null) ?? a.rows[0];
  state = { a, file, sample, sel: first?.key ?? null };
  $("ka-intro")!.hidden = true;
  $("ka-result")!.hidden = false;
  const b = $("ka-busy");
  if (b) b.hidden = true;
  render();
  window.scrollTo({ top: 0 });
}

// ---------- 結果 ----------

function render() {
  if (!state) return;
  const { a, file, sample } = state;
  const { model, summary } = a;
  const st = summary.byStatus;
  const statusText = ["完了", "実施中", "予定", "中止"].filter((k) => st[k]).map((k) => `${k}${st[k]}`).join("・");
  $("ka-meta")!.textContent = `${sample ? "サンプル（架空の会社）" : file}　実績 ${model.months[0]}〜${summary.lastLabel}（${summary.monthsCount}か月）／施策ログ ${summary.logCount}件${statusText ? `（${statusText}）` : ""}`;
  const html: string[] = [];
  html.push(`<div class="ka-pdfhead"><b>施策効果診断キット</b>　${esc(sample ? "サンプル（架空の会社）" : file)}　実績 ${esc(model.months[0])}〜${esc(summary.lastLabel)}　作成日 ${new Date().toLocaleDateString("ja-JP")}</div>`);
  if (sample) html.push(`<p class="ka-sample"><b>サンプル</b>　架空の会社のKPI管理表（10月まで入力）で表示しています。自社のファイルは「別のファイルを読み込む」から。</p>`);
  for (const w of model.warnings) html.push(`<p class="ka-warn">${esc(w)}</p>`);
  html.push(summaryHtml(a));
  html.push(sectionA(a));
  html.push(`<div id="ka-b">${sectionB(a)}</div>`);
  html.push(sectionC(a));
  html.push(sectionD(a));
  html.push(howHtml());
  html.push(`<p class="ka-pdffoot">施策効果診断キット｜MeerKitLab　meerkitlab.com/tools/kpi-analysis　確率はベイズ推定による目安です</p>`);
  $("ka-report")!.innerHTML = html.join("");
  bindReport();
}

function summaryHtml(a: Analysis) {
  const s = a.summary;
  const lines: string[] = [];
  if (s.lasting.length) {
    const t = s.lasting.map((r) => `${esc(r.label)}（期首から${pct(r.total.prob)}・${r.streak}か月続く）`).join("、");
    lines.push(`<div><b class="r">続いている課題 ${s.lasting.length}件</b>　${t}</div>`);
  } else if (a.model.last < 2) {
    lines.push(`<div><b>続いている課題</b>　まだ判断できません（3か月続いたものを「続いている課題」とします）</div>`);
  } else {
    lines.push(`<div><b>続いている課題 0件</b>　3か月以上続けて計画を下回っている課題はありません</div>`);
  }
  const e = s.effects;
  const done = e.good + e.bad + e.mid;
  const parts = [];
  if (done) parts.push(`効いた・たぶん効いた ${e.good}件／まだ分からない ${e.mid}件／悪くなった（可能性を含む） ${e.bad}件`);
  if (e.draft) parts.push(`参考値 ${e.draft}件`);
  if (e.before) parts.push(`実施前 ${e.before}件`);
  if (e.na) parts.push(`比べられない ${e.na}件`);
  lines.push(`<div><b>打ち手</b>　${parts.join("　") || "施策ログに打ち手がありません"}</div>`);
  if (s.mismatch) lines.push(`<div><b class="o">振り返りと数字が合わない ${s.mismatch}件</b>　Dの表で確かめてください</div>`);
  const when =
    a.model.last === 0
      ? "1か月目：今月の課題（A）が見られます。2か月目から推移（B）と打ち手の参考値（C）、実施月の2か月後から打ち手の確定値が出ます"
      : a.model.last === 1
        ? "2か月目：推移（B）と打ち手の参考値（C）が見られます。実施月の2か月後から打ち手の確定値が出ます"
        : "";
  return `<div class="ka-sum">${lines.join("")}</div>${when ? `<p class="ka-when">${when}</p>` : ""}`;
}

function tone(p: number | null) {
  if (p == null) return "g";
  return p >= 0.9 ? "r" : p >= 0.7 ? "o" : "g";
}

function logFor(a: Analysis, key: string) {
  return a.effects.filter((f) => f.rowKey === key);
}

function sectionA(a: Analysis) {
  const { model, rows } = a;
  if (!rows.length) return `<h2 class="ka-h2">A. 月別進捗状況</h2><p class="ka-note">計画を下回っている課題も、施策ログの課題もありません。</p>`;
  const h: string[] = [];
  h.push(`<h2 class="ka-h2">A. 月別進捗状況（1年分）<small>行を選ぶとBが切りかわります</small></h2>`);
  h.push(
    `<p class="ka-legend">上段＝計画比（CPLは許容÷実績）、下段＝計画を下回っている確率（CPLは上限を超えている確率）。<span class="ka-sw r"></span>90%以上<span class="ka-sw o"></span>70〜89%<span class="ka-sw g"></span>70%未満<span class="ka-sw e"></span>これから<span class="ka-sw pin"></span>打ち手を実施した月（白抜き＝予定）</p>`,
  );
  h.push(`<div class="ka-scroll"><div class="ka-hm" role="table"><div></div>${model.months.map((m) => `<div class="hd">${esc(m)}</div>`).join("")}`);
  for (const r of rows) {
    const pins = new Map<number, string[]>();
    for (const f of logFor(a, r.key)) {
      const m = model.months.indexOf(f.item.doMonth);
      if (m < 0) continue;
      const list = pins.get(m) ?? [];
      list.push(`${f.item.action}（${f.item.status || "状態なし"}）`);
      pins.set(m, list);
    }
    const sub =
      r.total.prob == null
        ? `<small>期首から：—</small>`
        : `<small class="${(r.total.prob ?? 0) >= 0.9 ? "r" : ""}">期首から：${pct(r.total.prob)}${r.thin ? "・件数が少なく判断しにくい" : ""}</small>`;
    h.push(`<button type="button" class="lb" data-row="${esc(r.key)}" aria-pressed="${state?.sel === r.key}">${esc(r.label)}${sub}</button>`);
    r.cells.forEach((c, m) => {
      const pin = pins.get(m);
      const planned = pin && m > model.last;
      const pinCls = pin ? ` pin${planned ? " plan" : ""}` : "";
      const title = pin ? ` title="${esc(pin.join("\n"))}"` : "";
      if (m > model.last) {
        h.push(`<div class="c e${pinCls}"${title}></div>`);
      } else if (c.ratio == null && c.prob == null) {
        h.push(`<div class="c n${pinCls}"${title}>${esc(c.note ?? "—")}</div>`);
      } else {
        h.push(`<div class="c ${tone(c.prob)}${pinCls}"${title}>${pct(c.ratio)}<span>${pct(c.prob)}</span></div>`);
      }
    });
  }
  h.push(`</div></div>`);
  h.push(`<p class="ka-legend">赤が横に続く行＝続いている課題。■（打ち手）のあとも赤のままなら、打ち手が効いていない可能性があります。1か月ずつだと件数が少なく確率は上がりにくいので、行の左の「期首から」で判断します。</p>`);
  return h.join("");
}

// ---------- B ----------
function sectionB(a: Analysis) {
  const row = a.rows.find((r) => r.key === state?.sel) ?? a.rows[0];
  if (!row) return "";
  const { model } = a;
  const W = 680;
  const H = 210;
  const L = 52;
  const R = 664;
  const T = 30;
  const B = 172;
  const xs = (m: number) => L + 22 + ((R - L - 44) * m) / 11;
  const vals = [...row.series.actual, ...row.series.plan].filter((v): v is number => v != null && Number.isFinite(v));
  let max = Math.max(...vals, 0);
  if (row.unit === "rate") max = Math.min(1, Math.max(0.1, max * 1.2));
  else max = max * 1.2 || 1;
  const ys = (v: number) => B - ((B - T) * v) / max;
  const ticks = [0, max / 2, max];
  const fmtTick = (v: number) => (row.unit === "rate" ? `${Math.round(v * 100)}%` : row.unit === "man" ? `${v.toFixed(1)}` : `${Math.round(v)}`);
  const s: string[] = [];
  s.push(`<svg class="ka-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(row.label)}の推移">`);
  for (const t of ticks) s.push(`<line x1="${L}" y1="${ys(t)}" x2="${R}" y2="${ys(t)}" stroke="${C.line}" stroke-width="0.8"/><text x="${L - 6}" y="${ys(t) + 4}" font-size="11" text-anchor="end" fill="${C.mute}">${fmtTick(t)}</text>`);
  model.months.forEach((m, i) => s.push(`<text x="${xs(i)}" y="${H - 18}" font-size="11" text-anchor="middle" fill="${C.mute}">${esc(m)}</text>`));
  s.push(`<text x="${L}" y="${H - 2}" font-size="11" fill="${C.mute}">${row.unit === "rate" ? "率" : row.unit === "man" ? "万円（開始月からの累計のCPL）" : "件"}</text>`);
  // 打ち手の縦線
  const effects = logFor(a, row.key);
  const used: number[] = [];
  effects.forEach((f) => {
    const m = model.months.indexOf(f.item.doMonth);
    if (m < 0) return;
    const x = xs(m);
    const dash = f.item.status === "予定" || m > model.last ? ` stroke-dasharray="3 3"` : "";
    const lv = used.filter((u) => Math.abs(u - x) < 120).length;
    used.push(x);
    s.push(`<line x1="${x}" y1="${T - 6}" x2="${x}" y2="${B}" stroke="${C.ink}" stroke-width="1"${dash}/>`);
    const anchor = x > W - 170 ? "end" : "start";
    s.push(`<text x="${anchor === "end" ? x - 4 : x + 4}" y="${T - 14 + lv * 13}" font-size="11" text-anchor="${anchor}" fill="${C.ink}">${esc(`${f.item.doMonth} ${cut(f.item.action, 16)}${f.item.status === "予定" ? "（予定）" : ""}`)}</text>`);
  });
  // 計画（点線）
  const segs = (arr: (number | null)[], upto: number) => {
    const out: string[] = [];
    let cur: string[] = [];
    arr.forEach((v, i) => {
      if (i > upto || v == null || !Number.isFinite(v)) {
        if (cur.length) out.push(cur.join(" "));
        cur = [];
        return;
      }
      cur.push(`${xs(i)},${ys(v)}`);
    });
    if (cur.length) out.push(cur.join(" "));
    return out;
  };
  for (const p of segs(row.series.plan, 11)) {
    if (p.includes(" ")) s.push(`<polyline fill="none" stroke="${C.sub}" stroke-width="1.2" stroke-dasharray="5 4" points="${p}"/>`);
    else {
      const [x, y] = p.split(",");
      s.push(`<line x1="${Number(x) - 8}" y1="${y}" x2="${Number(x) + 8}" y2="${y}" stroke="${C.sub}" stroke-width="1.2" stroke-dasharray="3 2"/>`);
    }
  }
  // 実績
  const color = (row.total.prob ?? 0) >= 0.9 ? C.red : C.ink;
  for (const p of segs(row.series.actual, model.last)) if (p.includes(" ")) s.push(`<polyline fill="none" stroke="${color}" stroke-width="2" points="${p}"/>`);
  row.series.actual.forEach((v, i) => {
    if (i > model.last || v == null || !Number.isFinite(v)) return;
    s.push(`<rect x="${xs(i) - 3.5}" y="${ys(v) - 3.5}" width="7" height="7" fill="${color}"/>`);
  });
  const nPoints = row.series.actual.filter((v, i) => i <= model.last && v != null).length;
  if (nPoints <= 1) s.push(`<text x="${(L + R) / 2}" y="${(T + B) / 2 + 20}" font-size="12" text-anchor="middle" fill="${C.faint}">${esc(model.months[Math.min(11, model.last + 1)])}の実績を入れると線になります</text>`);
  s.push(`</svg>`);
  const legend = `実線＝実績、点線＝計画${row.unit === "man" ? "（許容CPL）" : ""}、縦線＝打ち手（点線＝予定）`;
  return `<h2 class="ka-h2">B. ${esc(row.label)}の推移<small>${legend}</small></h2><div class="ka-scroll">${s.join("")}</div>`;
}

// ---------- C ----------
function sectionC(a: Analysis) {
  const list = a.effects.filter((f) => f.state !== "skip");
  const h: string[] = [];
  h.push(`<h2 class="ka-h2">C. 打ち手ごとの「良くなった確率」<small>棒を選ぶとDの表のその行へ</small></h2>`);
  if (!list.length) return h.join("") + `<p class="ka-note">施策ログに打ち手がありません。施策ログに打ち手と実施月を入れると、ここに効果が出ます。</p>`;
  h.push(
    `<p class="ka-legend">棒＝50%（どちらとも言えない）からの差。<span class="ka-sw" style="background:${C.ink}"></span>80%以上＝効いた<span class="ka-sw" style="background:${C.faint}"></span>まだ分からない<span class="ka-sw" style="background:${C.red}"></span>20%以下＝悪くなった　点線の棒＝参考値（実施後が1か月だけ）　<span style="color:${C.org}">▲</span>＝振り返りと数字が合わない</p>`,
  );
  const W = 680;
  const RH = 26;
  const X0 = 330;
  const X1 = 640;
  const xp = (p: number) => X0 + (X1 - X0) * p;
  const H = list.length * RH + 30;
  const s: string[] = [];
  s.push(`<svg class="ka-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="打ち手ごとの良くなった確率">`);
  for (const t of [0, 0.2, 0.5, 0.8, 1]) s.push(`<line x1="${xp(t)}" y1="2" x2="${xp(t)}" y2="${H - 26}" stroke="${t === 0.5 ? C.ink : C.line}" stroke-width="${t === 0.5 ? 1 : 0.8}"/><text x="${xp(t)}" y="${H - 10}" font-size="11" text-anchor="middle" fill="${C.mute}">${t * 100}%</text>`);
  list.forEach((f, i) => {
    const y = 4 + i * RH;
    const label = `${cut(f.item.action, 15)}（${f.item.doMonth || "—"}）`;
    s.push(`<g class="ka-c-hit" data-go="${f.item.row}" role="button" tabindex="0" aria-label="${esc(f.item.action)}">`);
    s.push(`<rect x="0" y="${y - 2}" width="${W}" height="${RH}" fill="transparent"/>`);
    s.push(`<text x="${X0 - 26}" y="${y + 13}" font-size="12" text-anchor="end" fill="${C.ink}">${esc(label)}</text>`);
    if (f.mismatch) s.push(`<text x="${X0 - 10}" y="${y + 13}" font-size="12" text-anchor="middle" fill="${C.org}">▲</text>`);
    if (f.state === "ok" || f.state === "draft") {
      const p = f.prob ?? 0.5;
      const col = p >= 0.8 ? C.ink : p <= 0.2 ? C.red : C.faint;
      const x = Math.min(xp(p), xp(0.5));
      const w = Math.max(1, Math.abs(xp(p) - xp(0.5)));
      if (f.state === "ok") s.push(`<rect class="bar" x="${x}" y="${y + 2}" width="${w}" height="14" fill="${col}"/>`);
      else s.push(`<rect class="bar" x="${x}" y="${y + 2}" width="${w}" height="14" fill="none" stroke="${col}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      const tx = p >= 0.5 ? xp(p) + 4 : xp(p) - 4;
      s.push(`<text x="${tx}" y="${y + 13}" font-size="11" text-anchor="${p >= 0.5 ? "start" : "end"}" fill="${C.sub}">${pct(p)}${f.state === "draft" ? " 参考" : ""}</text>`);
    } else if (f.state === "before") {
      s.push(`<rect x="${xp(0)}" y="${y + 2}" width="${xp(1) - xp(0)}" height="14" fill="none" stroke="${C.faint}" stroke-dasharray="4 3"/>`);
      s.push(`<text x="${xp(0.5)}" y="${y + 13}" font-size="11" text-anchor="middle" fill="${C.mute}">実施前（${esc(f.item.doMonth)}の実績を入れると出ます）</text>`);
    } else {
      s.push(`<text x="${xp(0.5)}" y="${y + 13}" font-size="11" text-anchor="middle" fill="${C.mute}">比べられない（${esc(f.reason ?? "")}）</text>`);
    }
    s.push(`</g>`);
  });
  s.push(`</svg>`);
  h.push(`<div class="ka-scroll">${s.join("")}</div>`);
  const waiting = list.filter((f) => f.state === "before" || f.state === "draft");
  if (waiting.length) {
    const befores = waiting.filter((f) => f.state === "before").sort((x, y) => a.model.months.indexOf(x.item.doMonth) - a.model.months.indexOf(y.item.doMonth));
    const first = befores[0];
    const msg = first ? `<p>${esc(first.item.doMonth)}以降、実施月の実績を入れるとグラフが出ます（効いたら右、悪くなったら左に伸びます）。</p>` : "";
    const need = waiting
      .map((f) => `${esc(cut(f.item.action, 18))}：${f.needMonths === "hard" ? "1年では見分けにくい" : f.needMonths ? `実施から約${f.needMonths}か月` : "—"}`)
      .join("／");
    h.push(`<div class="ka-note">${msg}<b>効果を見分けるまでの目安</b>（30%の変化を80%の確からしさで。計画の件数から計算）　${need}</div>`);
  }
  return h.join("");
}

// ---------- D ----------
function fmtSide(f: Effect, v: number | null) {
  if (v == null) return "—";
  if (f.item.metric === "リード数") return `計画比${pct(v)}`;
  if (f.item.metric === "CPL") return `${v.toFixed(1)}万円`;
  return pct(v);
}
function sectionD(a: Analysis) {
  const list = a.effects;
  if (!list.length) return "";
  const metrics = [...new Set(list.map((f) => f.item.metric).filter(Boolean))];
  const chs = [...new Set(list.map((f) => f.item.channel).filter(Boolean))];
  const h: string[] = [];
  h.push(`<h2 class="ka-h2">D. 打ち手の一覧<small>前＝実施月の前3か月、後＝実施月から最新月まで</small></h2>`);
  h.push(
    `<div class="ka-filters"><label>狙う指標 <select id="ka-f-m"><option value="">すべて</option>${metrics.map((m) => `<option>${esc(m)}</option>`).join("")}</select></label><label>チャネル <select id="ka-f-c"><option value="">すべて</option>${chs.map((m) => `<option>${esc(m)}</option>`).join("")}</select></label><label><input type="checkbox" id="ka-f-x" /> 振り返りと合わないものだけ</label></div>`,
  );
  h.push(`<div class="ka-scroll"><table class="ka-tbl"><thead><tr><th>実施</th><th>打ち手（チャネル・狙う指標）</th><th>前</th><th>後</th><th>良くなった確率</th><th>変化の幅（80%）</th><th>見立て</th><th>振り返り</th></tr></thead><tbody>`);
  for (const f of list) {
    const v = verdict(f.prob);
    let judge = "";
    if (f.state === "ok") judge = `<span class="${v.tone === "good" ? "g" : v.tone === "bad" ? "r" : ""}">${v.label}</span>`;
    else if (f.state === "draft") judge = `<span>${v.label}</span><span class="sub">参考値（実施後1か月）</span>`;
    else if (f.state === "before") judge = `<span class="sub">実施前</span>`;
    else judge = `<span class="sub">${esc(f.state === "na" ? "比べられない" : "計算しない")}（${esc(f.reason ?? "")}）</span>`;
    const range = f.lo != null && f.hi != null ? `${signedPct(f.lo)}〜${signedPct(f.hi)}` : "—";
    const review = f.item.review ? `${f.mismatch ? `<span class="o">${esc(f.item.review)} ▲</span><span class="sub">数字と合わない</span>` : esc(f.item.review)}` : `<span class="sub">${esc(f.item.status || "")}</span>`;
    h.push(
      `<tr id="ka-d-${f.item.row}" data-m="${esc(f.item.metric)}" data-c="${esc(f.item.channel)}" data-x="${f.mismatch ? 1 : 0}"><td>${esc(f.item.doMonth || "—")}</td><td>${esc(f.item.action)}<span class="sub">${esc(f.item.channel)}・${esc(f.item.metric)}　施策ログ ${f.item.row}行目</span></td><td class="n">${fmtSide(f, f.before)}</td><td class="n">${fmtSide(f, f.after)}</td><td class="n">${f.prob == null ? "—" : pct(f.prob)}</td><td class="n">${range}</td><td>${judge}</td><td>${review}</td></tr>`,
    );
  }
  h.push(`</tbody></table></div>`);
  return h.join("");
}

function howHtml() {
  return `<details class="ka-how"><summary>計算のしかた</summary><ul>
<li>A：月ごとに、実績から「計画を本当に下回っている確率」を出します（ベイズ推定）。リード数は件数、有効リード率は「リード何件中、有効リード何件」、商談化率・受注率は全体の3か月の合計、CPLは開始月からの累計で見ます。</li>
<li>A：「続いている課題」＝期首からの合計で下回っている確率が90%以上、かつ最新の月まで3か月以上続けて70%以上の課題です。</li>
<li>C：打ち手の実施月の前3か月と、実施月から最新月までを比べ、指標が良くなった確率を出します。リード数は計画比で比べるので、展示会のように開催月がばらつくチャネルも比べられます。CPLは下がると「良くなった」です。</li>
<li>C：実施後が1か月だけのものは参考値です。「振り返りと合わない」は、振り返りが「効果あり」なのに確率が20%以下、「効果なし」なのに80%以上のものです（確定値だけ）。</li>
<li>件数が少ないと、確率は50%に近づき「まだ分からない」になります。ほかの打ち手や季節の影響も含むので、判断の目安として使ってください。</li>
</ul></details>`;
}

// ---------- 操作 ----------
function bindReport() {
  const rep = $("ka-report")!;
  rep.querySelectorAll<HTMLButtonElement>(".ka-hm .lb").forEach((b) =>
    b.addEventListener("click", () => {
      if (!state) return;
      state.sel = b.dataset.row ?? null;
      rep.querySelectorAll<HTMLButtonElement>(".ka-hm .lb").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      $("ka-b")!.innerHTML = sectionB(state.a);
    }),
  );
  const go = (row: string) => {
    const tr = $(`ka-d-${row}`);
    if (!tr) return;
    rep.querySelectorAll(".ka-tbl tr.hit").forEach((x) => x.classList.remove("hit"));
    tr.hidden = false;
    tr.classList.add("hit");
    tr.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  rep.querySelectorAll<SVGGElement>(".ka-c-hit").forEach((g) => {
    g.addEventListener("click", () => go(g.dataset.go ?? ""));
    g.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") go(g.dataset.go ?? "");
    });
  });
  const fm = $<HTMLSelectElement>("ka-f-m");
  const fc = $<HTMLSelectElement>("ka-f-c");
  const fx = $<HTMLInputElement>("ka-f-x");
  const filter = () => {
    rep.querySelectorAll<HTMLTableRowElement>(".ka-tbl tbody tr").forEach((tr) => {
      const ok = (!fm?.value || tr.dataset.m === fm.value) && (!fc?.value || tr.dataset.c === fc.value) && (!fx?.checked || tr.dataset.x === "1");
      tr.hidden = !ok;
    });
  };
  [fm, fc, fx].forEach((el) => el?.addEventListener("change", filter));
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
  const btn = $<HTMLButtonElement>("ka-pdf")!;
  const err = $("ka-perr")!;
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
    node.className = "ka ka-pdf";
    node.innerHTML = $("ka-report")!.innerHTML;
    node.querySelectorAll<HTMLElement>(".ka-tbl tbody tr").forEach((tr) => (tr.hidden = false));
    holder.appendChild(node);
    document.body.appendChild(holder);
    await new Promise((r) => setTimeout(r, 50));
    // ページの切れ目：見出し（.ka-h2）の上と、表の行の上で切る（見出しだけが前のページに残らないように）
    const top = node.getBoundingClientRect().top;
    const breaks = Array.from(node.querySelectorAll<HTMLElement>(":scope > .ka-h2, :scope > div > .ka-h2, :scope > .ka-how, :scope > .ka-pdffoot, .ka-tbl tbody tr"))
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
    const ym = state.a.summary.lastLabel || "";
    a.download = `施策効果診断_${ym}.pdf`;
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
  const input = $<HTMLInputElement>("ka-file");
  const drop = $("ka-drop");
  if (!input || !drop) return;
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) handleFile(f);
    input.value = "";
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
  $("ka-again")?.addEventListener("click", () => {
    if (state?.sample) history.replaceState(null, "", "/tools/kpi-analysis");
    state = null;
    $("ka-result")!.hidden = true;
    $("ka-intro")!.hidden = false;
    $("ka-report")!.innerHTML = "";
    window.scrollTo({ top: 0 });
    input.click();
  });
  $("ka-pdf")?.addEventListener("click", makePdf);
  if (new URLSearchParams(location.search).get("sample") === "1") {
    import("@/data/kpi-analysis-sample.json").then((m) => show(analyze((m as any).default ?? m), "", true));
  }
}

init();
