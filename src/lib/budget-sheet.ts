// src/lib/budget-sheet.ts
//
// 予算案診断キット：年間予算表（M-B-03）のひな形に入力を書き込み、「診断結果」シートを作る。
// ひな形: public/files/tools/budget-sheet-template.xlsx（Drive「M-B-03」の書き出しから scripts/build-budget-sheet-template.py で作る）
// - 年間予算表（施策別）：前提（A7〜F7・K7）、チャネル別の計画（B・D・F・H・J・K列の11〜16行）、
//   月別のリード数・有効リード数（38＋6k行・39＋6k行のC〜N列）、月の見出し（30行・37＋6k行）
// - 診断結果：ダウンロードした時点の判定を値で書く（Excelで数字を直しても変わらない。シートの上にその旨を書く）
// - DOMやライブラリに頼らない（xlsxの中のXMLを文字列で書き換える）
import { excelDate, sheetPaths, setCell, CHANNELS } from "@/lib/kpi-sheet-maker";
import { DIAG_SHEET_PATH, S } from "@/lib/budgetSheetStyles";
import { GROUP_LABEL, SHEET_BUDGET, monthLabels, type BudgetDiagnosis, type BudgetState } from "@/lib/budgetCheck";

const MONTH_COLS = ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];
const CH_COLS = { leads: "B", valid: "D", deals: "F", wins: "H", ext: "J", labor: "K" } as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- 診断結果シート ----------
type V = string | number | null;
interface C {
  v: V;
  s: number;
}
class Sheet {
  rows: { cells: (C | null)[]; ht?: number }[] = [];
  merges: string[] = [];
  add(cells: (C | null)[], ht?: number) {
    this.rows.push({ cells, ht });
    return this.rows.length;
  }
  blank() {
    this.rows.push({ cells: [] });
  }
  merge(row: number, from: string, to: string) {
    this.merges.push(`${from}${row}:${to}${row}`);
  }
  xml(): string {
    const COL = "ABCDEFGHIJ";
    const body = this.rows
      .map((r, i) => {
        const n = i + 1;
        const cs = r.cells
          .map((c, k) => {
            if (!c) return "";
            const ref = `${COL[k]}${n}`;
            if (c.v === null || c.v === "") return `<c r="${ref}" s="${c.s}"/>`;
            if (typeof c.v === "number") return `<c r="${ref}" s="${c.s}"><v>${Number.isFinite(c.v) ? c.v : 0}</v></c>`;
            return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
          })
          .join("");
        const ht = r.ht ? ` ht="${r.ht}" customHeight="1"` : "";
        return `<row r="${n}"${ht}>${cs}</row>`;
      })
      .join("");
    return `<sheetData>${body}</sheetData>` + (this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "");
  }
}
const c = (v: V, s: number = S.text): C => ({ v, s });
const num = (v: number | null | undefined, s: number = S.int): C => ({ v: v === null || v === undefined || !Number.isFinite(v) ? "—" : v, s: v === null || v === undefined || !Number.isFinite(v) ? S.center : s });
/** 折り返す文の行の高さ。per＝1行に入る全角の字数の目安（B〜J列の結合で約48字、A〜J列で約58字） */
const lineHt = (text: string, per = 48) => Math.max(1, Math.ceil(text.length / per)) * 15 + 6;

export function diagSheetXml(template: string, st: BudgetState, d: BudgetDiagnosis, today: Date): string {
  const inp = st.input;
  const sh = new Sheet();
  const ymd = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  sh.add([c("来期マーケティング予算案の診断", S.title)], 24);
  const r2 = sh.add([c(`期首 ${inp.startYear}/${inp.startMonth}/1　単位 万円　診断日 ${ymd}（${SOURCE_NOTE[st.source]}）`, S.note)]);
  sh.merge(r2, "A", "J");
  const r3 = sh.add([c("この日に診断した結果です。年間予算表のシートで数字を直したあとは、予算案診断キットで読み込んで診断し直してください。", S.note)]);
  sh.merge(r3, "A", "J");
  sh.blank();

  if (!d.ready || !d.r) {
    const rr = sh.add([c(`前提（${d.missing.join("・")}）が入っていないため、診断していません。`, S.text)]);
    sh.merge(rr, "A", "J");
  } else {
    const r = d.r;
    sh.add([c(`直す ${d.counts.fix}`, d.counts.fix ? S.bigFix : S.bigOk), c(`確認 ${d.counts.check}`, d.counts.check ? S.bigCheck : S.bigOk), c(`問題なし ${d.counts.ok}`, S.bigOk)], 22);
    const rc = sh.add([c(`結論：${d.conclusion}`, S.labelWrap)], lineHt(d.conclusion, 58));
    sh.merge(rc, "A", "J");
    sh.blank();

    sh.add([c("目標に届くか", S.sec)]);
    sh.add(["", "リード数", "有効リード数", "商談数", "受注数", "受注金額"].map((h) => c(h, S.head)), 20);
    sh.add([c("必要な数（逆算）", S.label), num(r.need.leads), num(r.need.valid), num(r.need.deals), num(r.need.wins), num(r.need.sales)]);
    sh.add([c("計画の数", S.label), num(r.plan.leads), num(r.plan.valid), num(r.plan.deals), num(r.plan.wins), num(r.plan.sales)]);
    const j = (short: boolean) => c(short ? "直す" : "足りる", short ? S.fix : S.center);
    sh.add([c("判定", S.label), j(r.short.leads), j(r.short.valid), j(r.short.deals), j(r.short.wins), j(r.short.sales)]);
    sh.blank();

    sh.add([c("コストは上限以内か", S.sec)]);
    sh.add(["外部費用", "人件費", "共通費", "コスト合計", "CAC", "CACの上限", "回収期間（か月）", "回収期間の上限（か月）", "ROI（1年）"].map((h) => c(h, S.head)), 32);
    const cacOver = r.total.cac !== null && r.total.cac > r.cacLimit + 1e-9;
    sh.add([
      num(r.total.ext),
      num(r.total.labor),
      num(inp.common),
      num(r.costTotal),
      num(r.total.cac, cacOver ? S.fixNum : S.int),
      num(r.cacLimit),
      num(r.total.paybackMonths, cacOver ? S.fixNum : S.dec1),
      num(inp.paybackYears * 12, S.dec1),
      r.roi === null ? c("—", S.center) : c(r.roi, S.pct),
    ]);
    sh.blank();

    sh.add([c("チャネル別の計画（年間）", S.sec)]);
    sh.add(["チャネル", "リード数", "有効リード数", "商談数", "受注数", "外部費用", "人件費", "CPL", "許容CPL", "判定"].map((h) => c(h, S.head)), 20);
    const row = (name: string, x: (typeof r.channels)[number]) => {
      const over = x.cplOver === true;
      sh.add([
        c(name, S.label),
        num(x.leads),
        num(x.valid),
        num(x.deals),
        num(x.wins),
        num(x.ext),
        num(x.labor),
        num(x.cpl, over ? S.fixNum : S.dec1),
        num(r.allowableCpl, S.dec1),
        x.cplOver === null ? c("—", S.center) : c(over ? "上限超え" : "上限内", over ? S.check : S.center),
      ]);
    };
    r.channels.forEach((x, i) => row(CHANNELS[i], x));
    row("合計", r.total);
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
        const text = `【${GROUP_LABEL[it.group]}】${it.reason}${it.todo ? `　→ ${it.todo}` : ""}`;
        const rr = sh.add([c(it.status === "fix" ? "直す" : "確認", it.status === "fix" ? S.fix : S.check), c(text, S.labelWrap)], lineHt(text));
        sh.merge(rr, "B", "J");
      }
    }
    const oks = d.items.filter((it) => it.status === "ok");
    if (oks.length) {
      sh.blank();
      sh.add([c("問題なし", S.sec)]);
      for (const it of oks) {
        const text = `【${GROUP_LABEL[it.group]}】${it.title}：${it.reason}`;
        const rr = sh.add([c("問題なし", S.center), c(text, S.labelWrap)], lineHt(text));
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
  const rf = sh.add([c("判定の基準は MeerKitLab「数字の定義」（meerkitlab.com/standards/metrics）による。CPL・CAC・回収期間は外部費用＋人件費で計算する。作成：予算案診断キット（meerkitlab.com/tools/budget-checker）", S.note)]);
  sh.merge(rf, "A", "J");

  return template.replace(/<sheetData\s*\/>|<sheetData>[\s\S]*?<\/sheetData>/, sh.xml());
}

const SOURCE_NOTE: Record<BudgetState["source"], string> = {
  ai: "AIの案を読み込んで作成",
  xlsx: "年間予算表を読み込んで作成",
  form: "画面で入力して作成",
  sample: "記入例（基本モデルの安定期）",
};

// ---------- 年間予算表（施策別） ----------

export function fillBudgetWorkbook(files: Record<string, string>, st: BudgetState, d: BudgetDiagnosis, today = new Date()): Record<string, string> {
  const paths = sheetPaths(files["xl/workbook.xml"], files["xl/_rels/workbook.xml.rels"]);
  const p = paths[SHEET_BUDGET];
  if (!p || files[p] === undefined) throw new Error(`ひな形にシート「${SHEET_BUDGET}」がありません`);
  if (files[DIAG_SHEET_PATH] === undefined) throw new Error("ひな形に「診断結果」シートがありません");
  const inp = st.input;
  const v = (x: number) => (Number.isFinite(x) ? x : 0);

  let x = files[p];
  x = setCell(x, "A7", excelDate(inp.startYear, inp.startMonth));
  x = setCell(x, "B7", v(inp.goal));
  x = setCell(x, "C7", v(inp.price));
  x = setCell(x, "D7", v(inp.gmPct) / 100);
  x = setCell(x, "E7", v(inp.paybackYears));
  x = setCell(x, "F7", v(inp.leadTime));
  x = setCell(x, "K7", v(inp.common));
  inp.channels.forEach((ch, i) => {
    const r = 11 + i;
    for (const [k, col] of Object.entries(CH_COLS)) x = setCell(x, `${col}${r}`, v(ch[k as keyof typeof CH_COLS]));
  });
  const labels = monthLabels(inp.startMonth);
  MONTH_COLS.forEach((col, k) => (x = setCell(x, `${col}30`, labels[k])));
  CHANNELS.forEach((_, i) => {
    const head = 37 + i * 6;
    MONTH_COLS.forEach((col, k) => {
      x = setCell(x, `${col}${head}`, labels[k]);
      x = setCell(x, `${col}${head + 1}`, v(st.monthly[i].leads[k]));
      x = setCell(x, `${col}${head + 2}`, v(st.monthly[i].valid[k]));
    });
  });

  return { [p]: x, [DIAG_SHEET_PATH]: diagSheetXml(files[DIAG_SHEET_PATH], st, d, today) };
}

export const budgetFileName = (st: BudgetState) => `年間予算表_${st.input.startYear}年度.xlsx`;

