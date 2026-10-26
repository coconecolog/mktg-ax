// src/lib/kpi-sheet-maker.ts
//
// KPI管理表メーカー（/tools/kpi-sheet-maker）の計算と、Excelのひな形への書き込み。
// ひな形: public/files/tools/kpi-sheet-template.xlsx（Drive「M-B-04_KPI管理表」を書き出し、実績を空にしたもの）
// 式の正本: Googleドライブ「★数字の定義（KPI・予算）」。計算はひな形の「はじめに入力」シートの式と同じにする
// - 金額は万円。入力は件数（リード数・有効リード数・商談数・受注数）で、率は入れない（件数から出す）
// - 計算は丸めない値で行い、表示だけ丸める。例外は「必要な数（逆算）」の切り上げ（シートの ROUNDUP と同じ）
// - ブラウザでもNode.jsでも動くように、DOMやライブラリに頼らない（xlsxの中のXMLを文字列で書き換える）

export const CHANNELS = ["展示会", "セミナー", "Web広告", "自社サイト", "SNS", "メール"] as const;

export interface ChannelInput {
  leads: number; // リード数（年間）
  valid: number; // 有効リード数（年間）
  deals: number; // 商談数（年間）
  wins: number; // 受注数（年間）
  ext: number; // 外部費用（年間・万円）
  labor: number; // 人件費（年間・万円）
}

export interface SheetInput {
  startYear: number; // 期首の年
  startMonth: number; // 期首の月（1〜12）
  goal: number; // マーケ経由の売上目標（万円）
  price: number; // 平均受注単価（万円）
  gmPct: number; // 粗利率（%）
  paybackYears: number; // 回収期間（年）
  leadTime: number; // リードタイム（月）
  common: number; // 共通費（万円）
  channels: ChannelInput[]; // CHANNELS と同じ順で6つ
}

/** 基本モデル（安定期）の記入例。M-B-04_KPI管理表の「はじめに入力」と同じ数字 */
export const EXAMPLE: SheetInput = {
  startYear: 2027,
  startMonth: 4,
  goal: 5750,
  price: 250,
  gmPct: 40,
  paybackYears: 1.5,
  leadTime: 4,
  common: 0,
  channels: [
    { leads: 220, valid: 55, deals: 22, wins: 6, ext: 500, labor: 107 },
    { leads: 80, valid: 50, deals: 20, wins: 6, ext: 90, labor: 80 },
    { leads: 95, valid: 43, deals: 17, wins: 5, ext: 488, labor: 35 },
    { leads: 90, valid: 34, deals: 14, wins: 4, ext: 356, labor: 141 },
    { leads: 12, valid: 5, deals: 2, wins: 1, ext: 12, labor: 42 },
    { leads: 20, valid: 8, deals: 3, wins: 1, ext: 96, labor: 107 },
  ],
};

const div = (a: number, b: number): number | null => (b ? a / b : null);
/** シートの ROUNDUP(x,0)（正の数のみ）。浮動小数の誤差で1件増えないようにわずかに引く */
const roundUp = (x: number): number => Math.ceil(x - 1e-9);

export interface ChannelResult extends ChannelInput {
  name: string;
  validRate: number | null; // 有効リード率
  dealRate: number | null; // 商談化率
  winRate: number | null; // 受注率
  sales: number; // 受注金額
  cpl: number | null;
  cac: number | null;
  paybackMonths: number | null; // 回収期間（か月）
  cplOver: boolean | null; // CPL判定（true＝上限超え）。リード数が0なら null
}

export interface Counts {
  leads: number;
  valid: number;
  deals: number;
  wins: number;
  sales: number;
}

export interface SheetResult {
  monthlyProfit: number; // 1社あたりの月の粗利
  cacLimit: number; // CACの上限
  allowableCpl: number | null; // 許容CPL
  channels: ChannelResult[];
  total: ChannelResult;
  need: Counts; // 必要な数（逆算）
  plan: Counts; // 計画の数
  short: { leads: boolean; valid: boolean; deals: boolean; wins: boolean; sales: boolean }; // 足りない（直す）
  costTotal: number; // コスト合計（外部費用＋人件費＋共通費）
  roi: number | null; // ROI（1年）
}

/** 「はじめに入力」シートと同じ計算 */
export function calc(inp: SheetInput): SheetResult {
  const gm = inp.gmPct / 100;
  const monthlyProfit = (inp.price * gm) / 12;
  const cacLimit = inp.price * gm * inp.paybackYears;

  const sum = (k: keyof ChannelInput) => inp.channels.reduce((s, c) => s + (c[k] || 0), 0);
  const tot: ChannelInput = {
    leads: sum("leads"),
    valid: sum("valid"),
    deals: sum("deals"),
    wins: sum("wins"),
    ext: sum("ext"),
    labor: sum("labor"),
  };
  // 許容CPL＝CACの上限×受注数÷リード数（合計）
  const allowableCpl = tot.leads ? (cacLimit * tot.wins) / tot.leads : null;

  const row = (name: string, c: ChannelInput): ChannelResult => {
    const cost = c.ext + c.labor;
    const cpl = div(cost, c.leads);
    const cac = div(cost, c.wins);
    return {
      name,
      ...c,
      validRate: div(c.valid, c.leads),
      dealRate: div(c.deals, c.valid),
      winRate: div(c.wins, c.deals),
      sales: c.wins * inp.price,
      cpl,
      cac,
      paybackMonths: cac !== null && monthlyProfit ? cac / monthlyProfit : null,
      cplOver: cpl === null || allowableCpl === null ? null : cpl > allowableCpl,
    };
  };
  const channels = inp.channels.map((c, i) => row(CHANNELS[i], c));
  const total = row("合計", tot);

  // 必要な数（逆算）：受注数＝売上目標÷平均受注単価（切り上げ）→ 計画の率で上にさかのぼる
  const plan: Counts = { leads: tot.leads, valid: tot.valid, deals: tot.deals, wins: tot.wins, sales: total.sales };
  const nWins = inp.price ? roundUp(inp.goal / inp.price) : 0;
  const nDeals = plan.wins ? roundUp((nWins * plan.deals) / plan.wins) : 0;
  const nValid = plan.deals ? roundUp((nDeals * plan.valid) / plan.deals) : 0;
  const nLeads = plan.valid ? roundUp((nValid * plan.leads) / plan.valid) : 0;
  const need: Counts = { leads: nLeads, valid: nValid, deals: nDeals, wins: nWins, sales: inp.goal };

  const costTotal = tot.ext + tot.labor + inp.common;
  return {
    monthlyProfit,
    cacLimit,
    allowableCpl,
    channels,
    total,
    need,
    plan,
    short: {
      leads: plan.leads < need.leads,
      valid: plan.valid < need.valid,
      deals: plan.deals < need.deals,
      wins: plan.wins < need.wins,
      sales: plan.sales < need.sales,
    },
    costTotal,
    roi: costTotal ? (total.sales * gm - costTotal) / costTotal : null,
  };
}

/** 年間の件数を12か月に分ける（整数。余りは期首に近い月から1件ずつ足す。合計は年間と一致する） */
export function splitMonthly(annual: number): number[] {
  const n = Math.max(0, Math.round(annual));
  const base = Math.floor(n / 12);
  const rest = n - base * 12;
  return Array.from({ length: 12 }, (_, i) => base + (i < rest ? 1 : 0));
}

/** 入力の確認。errors＝ダウンロードできない、warnings＝確認（ダウンロードはできる） */
export function validate(inp: SheetInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pos = (v: number) => Number.isFinite(v) && v > 0;
  if (!pos(inp.goal)) errors.push("マーケ経由の売上目標");
  if (!pos(inp.price)) errors.push("平均受注単価");
  if (!pos(inp.gmPct) || inp.gmPct > 100) errors.push("粗利率");
  if (!pos(inp.paybackYears)) errors.push("回収期間");
  if (!Number.isFinite(inp.leadTime) || inp.leadTime < 0) errors.push("リードタイム");
  if (!Number.isFinite(inp.common) || inp.common < 0) errors.push("共通費");
  inp.channels.forEach((c, i) => {
    const vals = [c.leads, c.valid, c.deals, c.wins, c.ext, c.labor];
    if (vals.some((v) => !Number.isFinite(v) || v < 0)) errors.push(CHANNELS[i]);
    else if (!(c.leads >= c.valid && c.valid >= c.deals && c.deals >= c.wins))
      warnings.push(`${CHANNELS[i]}：リード数 ≥ 有効リード数 ≥ 商談数 ≥ 受注数 になっていません`);
  });
  if (inp.channels.every((c) => !c.leads)) errors.push("チャネル（どれか1つはリード数を入れてください）");
  return { errors, warnings };
}

// ===== xlsx（XML）への書き込み =====

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** セルの値を書き換える。スタイル（s）は残す。ひな形にないセルはエラーにする */
export function setCell(xml: string, ref: string, value: number | string): string {
  const re = new RegExp(`<c r="${ref}"(?=[\\s/>])([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(xml);
  if (!m) throw new Error(`ひな形にセル ${ref} がありません`);
  const s = /\ss="(\d+)"/.exec(m[1]);
  const style = s ? ` s="${s[1]}"` : "";
  const cell =
    typeof value === "number"
      ? `<c r="${ref}"${style}><v>${Number.isFinite(value) ? value : 0}</v></c>`
      : `<c r="${ref}"${style} t="inlineStr"><is><t>${escXml(value)}</t></is></c>`;
  return xml.slice(0, m.index) + cell + xml.slice(m.index + m[0].length);
}

/** Excelの日付のシリアル値（1900年方式） */
export function excelDate(y: number, m: number, d = 1): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** workbook.xml と rels から、シート名 → シートのXMLのパス */
export function sheetPaths(workbookXml: string, relsXml: string): Record<string, string> {
  const target: Record<string, string> = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0]);
    const t = /\bTarget="([^"]+)"/.exec(m[0]);
    if (id && t) target[id[1]] = t[1];
  }
  const out: Record<string, string> = {};
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(m[0]);
    const rid = /\br:id="([^"]+)"/.exec(m[0]);
    if (!name || !rid || !target[rid[1]]) continue;
    const t = target[rid[1]].replace(/^\/?(xl\/)?/, "");
    out[name[1].replace(/&amp;/g, "&")] = `xl/${t}`;
  }
  return out;
}

const COLS = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]; // 各チャネルのシートの月（期首から12か月）

/**
 * ひな形のXMLに入力を書き込む。files はパス → XML文字列（必要なものだけ書き換えて返す）
 * - はじめに入力：前提（A5〜F5・K5）と、チャネル別の計画（B・D・F・H・J・K列の9〜14行）
 * - 各チャネルのシート：1. 計画の月別のリード数（7行）・有効リード数（8行）を年間÷12で
 * - 全体：対象月（B11）を期首の月に
 */
export function fillWorkbook(files: Record<string, string>, inp: SheetInput): Record<string, string> {
  const paths = sheetPaths(files["xl/workbook.xml"], files["xl/_rels/workbook.xml.rels"]);
  const need = ["はじめに入力", "全体", ...CHANNELS];
  for (const n of need) if (!paths[n] || files[paths[n]] === undefined) throw new Error(`ひな形にシート「${n}」がありません`);
  const out: Record<string, string> = {};

  let x = files[paths["はじめに入力"]];
  x = setCell(x, "A5", excelDate(inp.startYear, inp.startMonth));
  x = setCell(x, "B5", inp.goal);
  x = setCell(x, "C5", inp.price);
  x = setCell(x, "D5", inp.gmPct / 100);
  x = setCell(x, "E5", inp.paybackYears);
  x = setCell(x, "F5", inp.leadTime);
  x = setCell(x, "K5", inp.common);
  inp.channels.forEach((c, i) => {
    const r = 9 + i;
    x = setCell(x, `B${r}`, c.leads);
    x = setCell(x, `D${r}`, c.valid);
    x = setCell(x, `F${r}`, c.deals);
    x = setCell(x, `H${r}`, c.wins);
    x = setCell(x, `J${r}`, c.ext);
    x = setCell(x, `K${r}`, c.labor);
  });
  out[paths["はじめに入力"]] = x;

  CHANNELS.forEach((name, i) => {
    let s = files[paths[name]];
    const leads = splitMonthly(inp.channels[i].leads);
    const valid = splitMonthly(inp.channels[i].valid);
    COLS.forEach((col, k) => {
      s = setCell(s, `${col}7`, leads[k]);
      s = setCell(s, `${col}8`, valid[k]);
    });
    out[paths[name]] = s;
  });

  out[paths["全体"]] = setCell(files[paths["全体"]], "B11", `${inp.startMonth}月`);
  return out;
}

/** ダウンロードするファイル名 */
export const fileName = (inp: SheetInput) => `KPI管理表_${inp.startYear}年度.xlsx`;
