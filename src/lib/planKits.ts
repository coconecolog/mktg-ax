// src/lib/planKits.ts
//
// 診断系キットのうち、年間の計画（前提＋チャネル別の件数・費用＋月別のリード数・有効リード数）を診断して直し、
// Excelに仕上げる2つのキットの違いをまとめる。画面・判定・Excelの書き込みは共通（src/lib/budgetCheck.ts・src/lib/budget-sheet.ts・
// src/scripts/budget-checker/app.ts）で、キットごとに違うのはここだけ。
// - 予算案診断キット（/tools/budget-checker）：出力は年間予算表（M-B-03）の「年間予算表（施策別）」＋「診断結果」
// - KPI妥当性診断キット（/tools/kpi-check）：出力はKPI管理表（M-B-04）の全シート（はじめに入力を埋めたもの）＋「診断結果」
// 「年間予算表（施策別）」とKPI管理表の「はじめに入力」は同じ表（セルの位置も同じ）なので、どちらのキットもどちらのファイルも読める。
import { DIAG_SHEET_PATH as BUDGET_DIAG, S as BUDGET_S } from "@/lib/budgetSheetStyles";
import { DIAG_SHEET_PATH as KPI_DIAG, S as KPI_S } from "@/lib/kpiCheckSheetStyles";

export type KitId = "budget" | "kpi";
export type SheetStyles = Record<keyof typeof BUDGET_S, number>;

export const SHEET_BUDGET = "年間予算表（施策別）";
export const SHEET_KPI = "はじめに入力";

export interface PlanKit {
  id: KitId;
  /** キットの名前 */
  name: string;
  /** 入口のURL */
  path: string;
  /** 出力する資料の名前（年間予算表／KPI管理表） */
  doc: string;
  /** 入力を書き込むシート */
  sheet: string;
  /** Excelのひな形 */
  template: string;
  /** 画面の入力を置く localStorage のキー */
  store: string;
  /** 診断結果シートのファイルの場所と書式 */
  diagPath: string;
  styles: SheetStyles;
  /** 診断結果シートの題 */
  diagTitle: string;
  /** 診断するもの（「予算案」「KPI」） */
  subject: string;
  /** 判定のDグループの名前 */
  groupD: string;
  /** AIのプロンプトで、変換するものの書き方 */
  aiWhat: string;
  aiSource: string;
  /** 入力のほかに書き込むセル（シート名・セル・値）。対象月の初期値など */
  extraCells: (startMonth: number) => [string, string, string][];
  fileName: (year: number) => string;
}

export const KITS: Record<KitId, PlanKit> = {
  budget: {
    id: "budget",
    name: "予算案診断キット",
    path: "/tools/budget-checker",
    doc: "年間予算表",
    sheet: SHEET_BUDGET,
    template: "/files/tools/budget-sheet-template.xlsx",
    store: "mktgax-budget-checker-v2",
    diagPath: BUDGET_DIAG,
    styles: BUDGET_S,
    diagTitle: "来期マーケティング予算案の診断",
    subject: "予算案",
    groupD: "予算案で抜けやすいところ",
    aiWhat: "マーケティング予算案",
    aiSource: "来期のマーケティング予算案（この上の会話、または下に貼る予算案・資料）",
    extraCells: () => [],
    fileName: (y) => `年間予算表_${y}年度.xlsx`,
  },
  kpi: {
    id: "kpi",
    name: "KPI妥当性診断キット",
    path: "/tools/kpi-check",
    doc: "KPI管理表",
    sheet: SHEET_KPI,
    template: "/files/tools/kpi-check-template.xlsx",
    store: "mktgax-kpi-check-v4",
    diagPath: KPI_DIAG,
    styles: KPI_S,
    diagTitle: "期初のKPIの診断",
    subject: "KPI",
    groupD: "計画で抜けやすいところ",
    aiWhat: "マーケティングのKPI計画（チャネル別の件数と費用）",
    aiSource: "来期のKPI計画（この上の会話、または下に貼るKPI・資料）",
    // KPI診断・月次レポートの対象月（選ぶ欄）を期首の月にしておく
    extraCells: (m) => [
      ["KPI診断", "B14", `${m}月`],
      ["月次レポート", "J1", `${m}月`],
    ],
    fileName: (y) => `KPI管理表_${y}年度.xlsx`,
  },
};

/** 読み込むシート（キットの資料を先に探す） */
export const readSheets = (kit: PlanKit) => (kit.id === "kpi" ? [SHEET_KPI, SHEET_BUDGET] : [SHEET_BUDGET, SHEET_KPI]);
/** 読み込んだシートの資料名 */
export const sheetLabel = (sheet: string) => (sheet === SHEET_KPI ? "KPI管理表（M-B-04）" : "年間予算表（M-B-03）");
