// src/lib/effect-sheet.ts
//
// 施策効果診断Kit：KPI管理表（M-B-04）のひな形に、計画・毎月の実績・施策ログを書き込み、「診断結果」シートを作る。
// ひな形は KPI妥当性診断Kitと同じ public/files/tools/kpi-check-template.xlsx（scripts/build-kpi-check-template.py で作る）
// - はじめに入力：src/lib/budget-sheet.ts の fillPlanWorkbook（KPI妥当性診断Kitと同じ書き込み）
// - 毎月の実績入力：チャネルの表（16＋8k行から リード数・有効リード数・商談数・受注数・外部費用・人件費、C〜N列）
//   外部費用・人件費は、画面で入れた月だけ値にする（入れていない月は計画の月額の式のまま）
// - 施策ログ：5〜54行（A登録月 B狙う指標 Cチャネル D課題 G打ち手 L実施月 M根拠 N状態 O見込み時間 P振り返り）
// - 診断結果：ダウンロードした時点の判定を値で書く
// - KPI診断・月次レポートの対象月は、実績が入っている最後の月にする
import { CHANNELS, monthLabels } from "@/lib/budgetCheck";
import { diagnoseBudget } from "@/lib/budgetCheck";
import { Sheet, fillPlanWorkbook, lineHt } from "@/lib/budget-sheet";
import { setCell, sheetPaths } from "@/lib/kpi-sheet-maker";
import { S } from "@/lib/kpiCheckSheetStyles";
import { KITS, type PlanKit } from "@/lib/planKits";
import { pct, signedPct, verdict, type Effect } from "@/lib/kpiAnalysis";
import { GROUP_LABEL_EFFECT, LOG_FIRST_ROW, LOG_MAX, type EffectDiagnosis, type EffectState } from "@/lib/effectCheck";

export const EFFECT_KIT: PlanKit = {
  ...KITS.kpi,
  name: "施策効果診断Kit",
  path: "/tools/kpi-analysis",
  rediag: "施策効果診断Kit",
  diagTitle: "施策効果の診断",
  subject: "KPI管理表",
  store: "mktgax-kpi-analysis-v2",
  extraCells: () => [],
};

const MONTH_COLS = ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];
const ACT_ROWS = { leads: 0, valid: 1, deals: 2, wins: 3, ext: 4, labor: 5 } as const;
const LOG_COLS = { registered: "A", metric: "B", channel: "C", issue: "D", action: "G", doMonth: "L", basis: "M", status: "N", hours: "O", review: "P" } as const;

type V = string | number | null;
const c = (v: V, s: number = S.text) => ({ v, s });
const num = (v: number | null | undefined, s: number = S.int) =>
  v === null || v === undefined || !Number.isFinite(v) ? { v: "—", s: S.center } : { v, s };

function fmtSide(f: Effect, v: number | null) {
  if (v == null) return "—";
  if (f.item.metric === "リード数") return `計画比${pct(v)}`;
  if (f.item.metric === "CPL") return `${v.toFixed(1)}万円`;
  return pct(v);
}

export function effectDiagXml(template: string, st: EffectState, d: EffectDiagnosis, today: Date): string {
  const sh = new Sheet();
  const ymd = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  const src = ({ ai: "AIの案を読み込んで作成", xlsx: "ファイルを読み込んで作成", form: "画面で入力して作成", sample: "記入例（架空の会社）" } as const)[st.source] ?? "";
  sh.add([c("施策効果の診断", S.title)], 24);
  const a = d.a;
  const span = a && a.model.last >= 0 ? `実績 ${a.model.months[0]}〜${a.model.months[a.model.last]}` : "実績なし";
  const r2 = sh.add([c(`期首 ${st.input.startYear}/${st.input.startMonth}/1　${span}　診断日 ${ymd}（${src}）`, S.note)]);
  sh.merge(r2, "A", "J");
  const r3 = sh.add([c("この日に診断した結果です。翌月の実績を入れたあとは、施策効果診断Kitで読み込んで診断し直してください。確率はベイズ推定による目安です。", S.note)]);
  sh.merge(r3, "A", "J");
  sh.blank();

  if (!d.ready || !a) {
    const rr = sh.add([c(`${d.missing.join("・")}が入っていないため、診断していません。`, S.text)]);
    sh.merge(rr, "A", "J");
  } else {
    sh.add([c(`直す ${d.counts.fix}`, d.counts.fix ? S.bigFix : S.bigOk), c(`確認 ${d.counts.check}`, d.counts.check ? S.bigCheck : S.bigOk), c(`問題なし ${d.counts.ok}`, S.bigOk)], 22);
    const rc = sh.add([c(`結論：${d.conclusion}`, S.labelWrap)], lineHt(d.conclusion, 58));
    sh.merge(rc, "A", "J");
    sh.blank();

    sh.add([c("計画を下回っている課題（期首から）", S.sec)]);
    const rows = a.rows.filter((r) => r.total.prob != null);
    if (!rows.length) {
      const rr = sh.add([c("計画を下回っている課題も、施策ログの課題もありません。", S.text)]);
      sh.merge(rr, "A", "J");
    } else {
      const rh = sh.add([c("課題", S.head), c("", S.head), c("", S.head), c("計画比", S.head), c("下回っている確率", S.head), c("続いた月数", S.head), c("判定", S.head), c("打ち手", S.head)], 20);
      sh.merge(rh, "A", "C");
      for (const r of rows) {
        const p = r.total.prob ?? 0;
        const tone = p >= 0.9 ? "直す" : p >= 0.7 ? "確認" : "—";
        const acts = a.effects.filter((f) => f.rowKey === r.key).length;
        const rr = sh.add([
          c(r.label + (r.thin ? "（件数が少ない）" : ""), S.label),
          null,
          null,
          r.total.ratio == null ? c("—", S.center) : c(r.total.ratio, S.pct),
          c(p, S.pct),
          num(r.streak),
          c(tone, p >= 0.9 ? S.fix : p >= 0.7 ? S.check : S.center),
          c(acts ? `${acts}件` : "なし", S.center),
        ]);
        sh.merge(rr, "A", "C");
      }
    }
    sh.blank();

    sh.add([c("打ち手の効果", S.sec)]);
    const effs = a.effects;
    if (!effs.length) {
      const rr = sh.add([c("施策ログに打ち手がありません。", S.text)]);
      sh.merge(rr, "A", "J");
    } else {
      const rh = sh.add(["実施月", "打ち手", "", "", "チャネル・狙う指標", "前", "後", "良くなった確率", "見立て", "振り返り"].map((h) => c(h, S.head)), 20);
      sh.merge(rh, "B", "D");
      for (const f of effs) {
        const v = verdict(f.prob);
        const judge =
          f.state === "ok"
            ? v.label
            : f.state === "draft"
              ? `${v.label}（参考値）`
              : f.state === "before"
                ? "実施前"
                : `比べられない（${f.reason ?? ""}）`;
        const js = f.state === "ok" && v.tone === "bad" ? S.check : f.mismatch ? S.check : S.center;
        const range = f.lo != null && f.hi != null ? `　変化の幅 ${signedPct(f.lo)}〜${signedPct(f.hi)}` : "";
        const text = f.item.action;
        const rr = sh.add(
          [
            c(f.item.doMonth || "—", S.center),
            c(text + range, S.labelWrap),
            null,
            null,
            c(`${f.item.channel}・${f.item.metric}`, S.label),
            c(fmtSide(f, f.before), S.center),
            c(fmtSide(f, f.after), S.center),
            f.prob == null ? c("—", S.center) : c(f.prob, S.pct),
            c(judge, js),
            c(f.item.review ? `${f.item.review}${f.mismatch ? "（数字と合わない）" : ""}` : f.item.status, f.mismatch ? S.check : S.center),
          ],
          lineHt(text + range, 22),
        );
        sh.merge(rr, "B", "D");
      }
    }
    sh.blank();

    sh.add([c("直すところ・確認するところ", S.sec)]);
    const list = d.items.filter((it) => it.status === "fix" || it.status === "check");
    if (!list.length) {
      const rr = sh.add([c("直すところも、確認するところもありません。", S.text)]);
      sh.merge(rr, "A", "J");
    } else {
      const rh = sh.add([c("判定", S.head), c("内容と直し方", S.head)]);
      sh.merge(rh, "B", "J");
      for (const it of list) {
        const text = `【${GROUP_LABEL_EFFECT[it.group]}】${it.reason}${it.todo ? `　→ ${it.todo}` : ""}`;
        const rr = sh.add([c(it.status === "fix" ? "直す" : "確認", it.status === "fix" ? S.fix : S.check), c(text, S.labelWrap)], lineHt(text));
        sh.merge(rr, "B", "J");
      }
    }
  }

  if (st.notes.length) {
    sh.blank();
    sh.add([c("読み込みのときのお知らせ", S.sec)]);
    for (const note of st.notes) {
      const rr = sh.add([c(note, S.labelWrap)], lineHt(note, 58));
      sh.merge(rr, "A", "J");
    }
  }
  sh.blank();
  const rf = sh.add([
    c(
      "計画を下回っている確率＝期首からの実績で、計画を本当に下回っている確率（ベイズ推定）。90%以上＝直す、70〜89%＝確認。良くなった確率＝打ち手の実施月の前3か月と、実施月から最新月までを比べた確率。作成：施策効果診断Kit（meerkitlab.com/tools/kpi-analysis）",
      S.note,
    ),
  ], 36);
  sh.merge(rf, "A", "J");
  return template.replace(/<sheetData\s*\/>|<sheetData>[\s\S]*?<\/sheetData>/, sh.xml());
}

export function fillEffectWorkbook(files: Record<string, string>, st: EffectState, d: EffectDiagnosis, today = new Date()): Record<string, string> {
  const kit = EFFECT_KIT;
  const out = fillPlanWorkbook(files, st, diagnoseBudget(st, KITS.kpi), kit, today);
  const paths = sheetPaths(files["xl/workbook.xml"], files["xl/_rels/workbook.xml.rels"]);
  const get = (name: string) => {
    const p = paths[name];
    if (!p || files[p] === undefined) throw new Error(`ひな形にシート「${name}」がありません`);
    return p;
  };

  // 毎月の実績入力
  const pa = get("毎月の実績入力");
  let x = out[pa] ?? files[pa];
  CHANNELS.forEach((_, i) => {
    const base = 16 + i * 8;
    const a = st.actual[i];
    for (const [k, off] of Object.entries(ACT_ROWS)) {
      const arr = a[k as keyof typeof ACT_ROWS];
      MONTH_COLS.forEach((col, m) => {
        const v = arr[m];
        if (v === null || v === undefined || !Number.isFinite(v)) return;
        x = setCell(x, `${col}${base + off}`, v);
      });
    }
  });
  out[pa] = x;

  // 施策ログ
  const pl = get("施策ログ");
  let y = out[pl] ?? files[pl];
  st.log.slice(0, LOG_MAX).forEach((row, j) => {
    const r = LOG_FIRST_ROW + j;
    for (const [k, col] of Object.entries(LOG_COLS)) {
      const v = row[k as keyof typeof LOG_COLS];
      if (v === null || v === undefined || v === "") continue;
      y = setCell(y, `${col}${r}`, typeof v === "number" ? v : String(v));
    }
  });
  out[pl] = y;

  // KPI診断・月次レポートの対象月＝実績が入っている最後の月
  const last = d.a?.model.last ?? -1;
  const label = monthLabels(st.input.startMonth)[Math.max(0, last)];
  for (const [name, ref] of [
    ["KPI診断", "B14"],
    ["月次レポート", "J1"],
  ] as const) {
    const q = get(name);
    out[q] = setCell(out[q] ?? files[q], ref, label);
  }

  out[kit.diagPath] = effectDiagXml(files[kit.diagPath], st, d, today);
  return out;
}

export const effectFileName = (st: EffectState) => `KPI管理表_${st.input.startYear}年度.xlsx`;
