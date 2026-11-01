// src/scripts/budget-checker/download.ts
//
// 年間予算表・KPI管理表（Excel）を作って保存する（2026-11-01、app.ts から切り出し）。
// 入力の画面（app.ts）と、予算案診断Kitの最終チェック・完了の画面（flow.ts）で使う。
// - Chrome・Edge：保存先を選ぶ画面を先に開く（押した直後でないと開けないため、await の前に呼ぶ）
// - ほかのブラウザ：通常のダウンロード
// ファイルはブラウザの中で作り、サーバーには送らない
import type { BudgetDiagnosis, BudgetState } from "@/lib/budgetCheck";
import { fillPlanWorkbook, planFileName } from "@/lib/budget-sheet";
import type { PlanKit } from "@/lib/planKits";

const LIB_ZIP = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

/**
 * 保存先を選ぶ（Chrome・Edge）。ボタンを押した直後に、ほかの await より先に呼ぶ。
 * 戻り値：handle（保存先）／null（選べない環境。通常のダウンロードにする）／"abort"（保存をやめた）
 */
export async function pickSaveTarget(st: BudgetState, kit: PlanKit): Promise<any | null | "abort"> {
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker !== "function") return null;
  try {
    return await picker({ suggestedName: planFileName(st, kit), types: [{ description: "Excel", accept: { [XLSX_MIME]: [".xlsx"] } }] });
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return "abort";
    return null; // 開けない環境（埋め込みなど）は通常のダウンロード
  }
}

/** Excelを作って保存する。handle があればそこへ、なければ通常のダウンロード。失敗したら例外 */
export async function writePlanFile(st: BudgetState, d: BudgetDiagnosis, kit: PlanKit, handle: any | null): Promise<void> {
  const [JSZip, buf] = await Promise.all([
    loadZip(),
    fetch(kit.template).then((r) => {
      if (!r.ok) throw new Error("template");
      return r.arrayBuffer();
    }),
  ]);
  const zip = await JSZip.loadAsync(buf);
  const files: Record<string, string> = {};
  for (const n of Object.keys(zip.files)) if (/\.(xml|rels)$/.test(n)) files[n] = await zip.file(n).async("string");
  const changed = fillPlanWorkbook(files, st, d, kit);
  for (const [n, xml] of Object.entries(changed)) zip.file(n, xml);
  const blob: Blob = await zip.generateAsync({ type: "blob", mimeType: XLSX_MIME, compression: "DEFLATE" });
  if (handle) {
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = planFileName(st, kit);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
