// src/lib/kpiCheckSheetStyles.ts
// scripts/build-kpi-check-template.py が書き出す（手で直さない）。ひな形 public/files/tools/kpi-check-template.xlsx の
// 「診断結果」シートで使う書式（styles.xml の cellXfs の番号）と、シートのファイルの場所
export const DIAG_SHEET_PATH = "xl/worksheets/sheet_diag.xml";
export const S = {
  title: 182,
  sec: 183,
  text: 184,
  note: 185,
  head: 186,
  label: 187,
  labelWrap: 188,
  int: 189,
  dec1: 190,
  pct: 191,
  center: 192,
  fix: 193,
  check: 194,
  fixNum: 195,
  bigFix: 196,
  bigCheck: 197,
  bigOk: 198,
} as const;
