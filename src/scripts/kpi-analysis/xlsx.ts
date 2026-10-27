// src/scripts/kpi-analysis/xlsx.ts
//
// KPI管理表（.xlsx）から、ツールが読む3シートのセルの値だけを取り出す（ブラウザの中だけで読む。送信しない）。
// - xlsx は zip。JSZip（jsDelivr）を、ファイルを読むときだけ読み込む
// - 式のセルは、保存されている計算後の値を使う（Googleスプレッドシート・Excelとも保存時に値が入る）
// - 形は scripts/build-kpi-analysis-sample.py と同じ：{"シート名": {"A7": 46478, "G7": "文字", ...}}
import { SHEET_ACTUAL, SHEET_LOG, SHEET_PLAN, ReadError, type Book, type Cells } from "@/lib/kpiAnalysis";

const LIB_ZIP = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WANT = [SHEET_PLAN, SHEET_ACTUAL, SHEET_LOG];

let zipLoading: Promise<void> | null = null;
function loadZip() {
  if ((window as any).JSZip) return Promise.resolve();
  if (!zipLoading) {
    zipLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = LIB_ZIP;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        zipLoading = null;
        reject(new ReadError("ファイルを読む部品を読み込めませんでした。通信を確かめて、もう一度お試しください。"));
      };
      document.head.appendChild(s);
    });
  }
  return zipLoading;
}

const parseXml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const textOf = (el: Element) => Array.from(el.getElementsByTagNameNS(NS, "t")).map((t) => t.textContent ?? "").join("");

export async function readBook(file: File): Promise<Book> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new ReadError("Excel（.xlsx）のファイルを選んでください。Googleスプレッドシートは「ファイル → ダウンロード → Microsoft Excel（.xlsx）」で保存できます。");
  }
  await loadZip();
  let zip: any;
  try {
    zip = await (window as any).JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new ReadError("ファイルを開けませんでした。.xlsx として保存し直して、もう一度お試しください。");
  }
  const read = async (path: string) => {
    const f = zip.file(path);
    return f ? ((await f.async("string")) as string) : null;
  };
  const wbXml = await read("xl/workbook.xml");
  const relXml = await read("xl/_rels/workbook.xml.rels");
  if (!wbXml || !relXml) throw new ReadError("Excelのファイルとして読めませんでした。.xlsx として保存し直して、もう一度お試しください。");

  const shared: string[] = [];
  const ssXml = await read("xl/sharedStrings.xml");
  if (ssXml) for (const si of Array.from(parseXml(ssXml).getElementsByTagNameNS(NS, "si"))) shared.push(textOf(si));

  const rels: Record<string, string> = {};
  for (const r of Array.from(parseXml(relXml).getElementsByTagName("Relationship"))) rels[r.getAttribute("Id") ?? ""] = r.getAttribute("Target") ?? "";

  const book: Book = {};
  for (const sh of Array.from(parseXml(wbXml).getElementsByTagNameNS(NS, "sheet"))) {
    const name = sh.getAttribute("name") ?? "";
    if (!WANT.includes(name)) continue;
    let path = rels[sh.getAttributeNS(NS_R, "id") ?? sh.getAttribute("r:id") ?? ""] ?? "";
    path = path.replace(/^\//, "");
    if (!path.startsWith("xl/")) path = `xl/${path}`;
    const xml = await read(path);
    if (!xml) continue;
    const cells: Cells = {};
    for (const c of Array.from(parseXml(xml).getElementsByTagNameNS(NS, "c"))) {
      const ref = c.getAttribute("r") ?? "";
      const m = /^([A-Z])(\d+)$/.exec(ref);
      if (!m || Number(m[2]) > 200) continue;
      const t = c.getAttribute("t");
      const v = c.getElementsByTagNameNS(NS, "v")[0];
      let val: string | number | boolean;
      if (t === "inlineStr") val = textOf(c);
      else if (!v || v.textContent == null || v.textContent === "") continue;
      else if (t === "s") val = shared[Number(v.textContent)] ?? "";
      else if (t === "str" || t === "e") val = v.textContent;
      else if (t === "b") val = v.textContent === "1";
      else {
        const n = Number(v.textContent);
        val = Number.isFinite(n) ? n : v.textContent;
      }
      if (val === "") continue;
      cells[ref] = val;
    }
    book[name] = cells;
  }
  return book;
}
