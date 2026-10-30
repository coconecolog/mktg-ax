// src/lib/budgetSheetStyles.ts
// scripts/build-budget-sheet-template.py が書き出す（手で直さない）。ひな形 public/files/tools/budget-sheet-template.xlsx の
// 「診断結果」シートで使う書式（styles.xml の cellXfs の番号）と、シートのファイルの場所
export const DIAG_SHEET_PATH = "xl/worksheets/sheet_diag.xml";
export const S = {
  title: 82,
  sec: 83,
  text: 84,
  note: 85,
  head: 86,
  label: 87,
  labelWrap: 88,
  int: 89,
  dec1: 90,
  pct: 91,
  center: 92,
  fix: 93,
  check: 94,
  fixNum: 95,
  bigFix: 96,
  bigCheck: 97,
  bigOk: 98,
} as const;
