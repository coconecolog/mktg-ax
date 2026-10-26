"""KPI管理表メーカー用のExcelひな形を、M-B-04_KPI管理表（Googleスプレッドシートの書き出し）から作る。

- 書式・条件付き書式・入力規則を残すため、XMLを直接書き換える（openpyxlで開き直さない）
- 実績の入力セル（毎月の実績入力、全体の商談数・受注数）を空にする
- 式のセルに残っている計算済みの値を消し、開いたときに再計算させる
- 「使い方」の文を、ツールで作ったファイル向けに直す
使い方: python3 build_template.py <元のxlsx> <出力するxlsx>
"""
import re
import sys
import zipfile
from xml.sax.saxutils import escape

SRC, DST = sys.argv[1], sys.argv[2]

zin = zipfile.ZipFile(SRC)
files = {n: zin.read(n) for n in zin.namelist()}

def get(n):
    return files[n].decode("utf-8")

def put(n, s):
    files[n] = s.encode("utf-8")

# シート名 → ファイル
wb = get("xl/workbook.xml")
rels = get("xl/_rels/workbook.xml.rels")
rid_target = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels))
rid_target.update({k: v for v, k in re.findall(r'<Relationship[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"', rels)})
sheets = {}
for name, rid in re.findall(r'<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', wb):
    t = rid_target[rid]
    sheets[name] = "xl/" + t.lstrip("/").replace("xl/", "")

CELL_RE = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*?)(/>|>(.*?)</c>)', re.S)

def col_num(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n

def blank_cells(xml, pred):
    """pred(col, row) が真のセルの値を消す（スタイルは残す）。"""
    def rep(m):
        col, row, attrs = m.group(1), int(m.group(2)), m.group(3)
        if not pred(col, row):
            return m.group(0)
        if m.group(5) is not None and "<f" in m.group(5):
            raise SystemExit(f"式のセルを消そうとした: {col}{row}")
        attrs = re.sub(r'\s+t="[^"]*"', "", attrs)
        return f'<c r="{col}{row}"{attrs}/>'
    return CELL_RE.sub(rep, xml)

def strip_cached(xml):
    """式のセルの計算済みの値を消す。"""
    def rep(m):
        inner = m.group(5)
        if inner is None or "<f" not in inner:
            return m.group(0)
        attrs = re.sub(r'\s+t="[^"]*"', "", m.group(3))
        inner = re.sub(r"<v>.*?</v>|<v/>", "", inner, flags=re.S)
        return f'<c r="{m.group(1)}{m.group(2)}"{attrs}>{inner}</c>'
    return CELL_RE.sub(rep, xml)

# 1) 毎月の実績入力：各チャネルのリード数・有効リード数・外部費用（C〜N列）を空にする
ACT_ROWS = {r for base in (12, 18, 24, 30, 36, 42) for r in (base, base + 1, base + 2)}
p = sheets["毎月の実績入力"]
put(p, blank_cells(get(p), lambda c, r: r in ACT_ROWS and 3 <= col_num(c) <= 14))

# 2) 全体：期末に入れる商談数・受注数を空にする
p = sheets["全体"]
put(p, blank_cells(get(p), lambda c, r: r == 6 and c in ("F", "H")))

# 3) すべてのシートで、式の計算済みの値を消す
for p in sheets.values():
    put(p, strip_cached(get(p)))

# 4) 開いたときにすべて再計算する
wb = re.sub(r"<calcPr[^>]*/>", '<calcPr fullCalcOnLoad="1"/>', wb)
put("xl/workbook.xml", wb)

# 5) 使い方の文を直す（共有文字列の該当箇所を置き換える）
REPLACE = {
    "1. 期のはじめに「はじめに入力」の灰色のセルを入れる（前提、チャネル別の計画（年間））。年間予算表を作った人は同じ数字を入れる":
        "1. 「はじめに入力」の灰色のセルには、KPI管理表メーカーで入れた数字が入っています。計画を変えるときは、灰色のセルを書き換える",
    "2. 期のはじめに、各チャネルのシートの「1. 計画」に月別のリード数・有効リード数を入れる。外部費用・人件費は年額÷12が自動で入るので、月ごとに違う場合だけ上書きする":
        "2. 各チャネルのシートの「1. 計画」の月別のリード数・有効リード数は、年間を12か月に分けて入っています。展示会のように月によって違う場合は書き換える。外部費用・人件費は年額÷12が自動で入るので、月ごとに違う場合だけ上書きする",
    "記入例": "入っている数字",
    "入っている数字はすべて架空の記入例（10月まで入力した状態）です。使うときは灰色のセルを自社の数字に書き換えてください":
        "「はじめに入力」と月別の計画は、KPI管理表メーカーで入れた数字です。実績は空なので、毎月入れてください。Excelで開いて数字が出ないときは「編集を有効にする」を押してください",
}
ss = get("xl/sharedStrings.xml")
def si_rep(m):
    body = m.group(1)
    text = "".join(re.findall(r"<t[^>]*>(.*?)</t>", body, re.S))
    if text in REPLACE:
        return f'<si><t xml:space="preserve">{escape(REPLACE[text])}</t></si>'
    return m.group(0)
ss2, n = re.subn(r"<si>(.*?)</si>", si_rep, ss, flags=re.S)
if n == 0 or sum(1 for k in REPLACE if escape(REPLACE[k]) in ss2) != len(REPLACE):
    raise SystemExit("使い方の文の置き換えに失敗")
put("xl/sharedStrings.xml", ss2)

# 共有文字列の数（count）は同じなのでそのまま。書き出す
with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in zin.namelist():
        zout.writestr(n, files[n])
print("ok", DST, {k: v for k, v in sheets.items()})
