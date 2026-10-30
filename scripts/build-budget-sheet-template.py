"""予算案診断キット用のExcelひな形を、年間予算表（M-B-03、Googleスプレッドシートの書き出し）から作る。

- 書式・条件付き書式を残すため、XMLを直接書き換える（openpyxlで開き直さない）
- セルの色をサイトのルールにそろえる：入力＝薄い水色、計算式＝灰色（見出しの黒はそのまま）。上の説明の文も合わせて直す
- 式のセルに残っている計算済みの値を消し、開いたときに再計算させる
- 空の「診断結果」シートを足す（中身はキットがダウンロードのときに書く）。使う書式を styles.xml に足し、
  その番号を src/lib/budgetSheetStyles.ts に書き出す
使い方: python3 scripts/build-budget-sheet-template.py <Driveから書き出したxlsx> public/files/tools/budget-sheet-template.xlsx
"""
import re
import sys
import zipfile

SRC, DST = sys.argv[1], sys.argv[2]
STYLES_TS = "src/lib/budgetSheetStyles.ts"
SHEET = "年間予算表（施策別）"
DIAG = "診断結果"

BLUE = "FFDDEBF7"  # 入力
GRAY = "FFEEEEEE"  # 計算式
RED_BG, RED = "FFFBE3E3", "FFC81E1E"
ORG_BG, ORG = "FFFDECD9", "FFC2560C"

zin = zipfile.ZipFile(SRC)
order = zin.namelist()
files = {n: zin.read(n) for n in order}


def get(n):
    return files[n].decode("utf-8")


def put(n, s):
    files[n] = s.encode("utf-8")
    if n not in order:
        order.append(n)


# ---------- シート名 → ファイル ----------
wb = get("xl/workbook.xml")
rels = get("xl/_rels/workbook.xml.rels")
rid_target = {}
for m in re.finditer(r"<Relationship\b[^>]*>", rels):
    i = re.search(r'\bId="([^"]+)"', m.group(0))
    t = re.search(r'\bTarget="([^"]+)"', m.group(0))
    rid_target[i.group(1)] = t.group(1)
sheets = {}
for m in re.finditer(r"<sheet\b[^>]*>", wb):
    name = re.search(r'\bname="([^"]+)"', m.group(0)).group(1)
    rid = re.search(r'\br:id="([^"]+)"', m.group(0)).group(1)
    sheets[name] = "xl/" + rid_target[rid].lstrip("/").replace("xl/", "")
if SHEET not in sheets:
    raise SystemExit(f"シート「{SHEET}」がない: {list(sheets)}")
if len(sheets) != 1:
    raise SystemExit(f"シートは「{SHEET}」1枚だけの想定: {list(sheets)}")
sheet_path = sheets[SHEET]

# ---------- styles.xml ----------
st = get("xl/styles.xml")


def block(tag):
    m = re.search(rf"<{tag}\b[^>]*>(.*?)</{tag}>", st, re.S)
    return m


def items(tag, item):
    m = block(tag)
    return re.findall(rf"<{item}\b[^>]*/>|<{item}\b[^>]*>.*?</{item}>", m.group(1), re.S)


def append(tag, item, new_items):
    """tag の中に item を足し、count を直す。足した最初の番号を返す"""
    global st
    m = block(tag)
    cur = items(tag, item)
    start = len(cur)
    inner = m.group(1) + "".join(new_items)
    head = re.sub(r'count="\d+"', f'count="{start + len(new_items)}"', re.match(rf"<{tag}\b[^>]*>", m.group(0)).group(0))
    st = st[: m.start()] + head + inner + f"</{tag}>" + st[m.end():]
    return start


fills = items("fills", "fill")


def fill_rgb(fid):
    f = fills[int(fid)]
    if "patternType=\"none\"" in f or "patternType=\"gray125\"" in f:
        return None
    m = re.search(r'<fgColor rgb="([0-9A-Fa-f]{8})"', f)
    return m.group(1).upper() if m else None


def solid(rgb):
    return f'<fill><patternFill patternType="solid"><fgColor rgb="{rgb}"/><bgColor rgb="{rgb}"/></patternFill></fill>'


fid_blue = append("fills", "fill", [solid(BLUE), solid(GRAY), solid(RED_BG), solid(ORG_BG)])
fid_gray, fid_redbg, fid_orgbg = fid_blue + 1, fid_blue + 2, fid_blue + 3
fills = items("fills", "fill")

xfs = items("cellXfs", "xf")


def set_fill(xf, fid):
    xf = re.sub(r'fillId="\d+"', f'fillId="{fid}"', xf)
    if "applyFill=" not in xf:
        xf = xf.replace("<xf ", '<xf applyFill="1" ', 1)
    return xf


# ---------- セルの色：入力＝水色、計算式＝灰色 ----------
sx = get(sheet_path)
CELL_RE = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*?)(/>|>(.*?)</c>)', re.S)
new_xf = []
remap = {}  # (元の番号, 種類) → 新しい番号


def restyle(m):
    attrs, inner = m.group(3), m.group(5)
    s = re.search(r'\ss="(\d+)"', attrs)
    if not s:
        return m.group(0)
    sid = int(s.group(1))
    xf = xfs[sid]
    fid = int(re.search(r'fillId="(\d+)"', xf).group(1))
    rgb = fill_rgb(fid)
    is_formula = inner is not None and "<f" in inner
    kind = None
    if rgb == "FFD9D9D9" and not is_formula:
        kind = "in"
    elif is_formula and rgb in (None, "FFFFFFFF"):
        kind = "calc"
    if kind is None:
        return m.group(0)
    key = (sid, kind)
    if key not in remap:
        remap[key] = len(xfs) + len(new_xf)
        new_xf.append(set_fill(xf, fid_blue if kind == "in" else fid_gray))
    return m.group(0).replace(f's="{sid}"', f's="{remap[key]}"', 1)


sx = CELL_RE.sub(restyle, sx)
append("cellXfs", "xf", new_xf)

# ---------- 式の計算済みの値を消す ----------
def strip_cached(m):
    inner = m.group(5)
    if inner is None or "<f" not in inner:
        return m.group(0)
    attrs = re.sub(r'\s+t="[^"]*"', "", m.group(3))
    inner = re.sub(r"<v>.*?</v>|<v/>", "", inner, flags=re.S)
    return f'<c r="{m.group(1)}{m.group(2)}"{attrs}>{inner}</c>'


sx = CELL_RE.sub(strip_cached, sx)
put(sheet_path, sx)

# ---------- 上の説明の文（共有文字列） ----------
ss = get("xl/sharedStrings.xml")
old = "灰色＝入力　白＝自動計算　単位：万円"
if old not in ss:
    raise SystemExit("説明の文「灰色＝入力…」が見つからない")
put("xl/sharedStrings.xml", ss.replace(old, "水色＝入力　灰色＝自動計算　単位：万円"))

# ---------- 診断結果シートの書式 ----------
fonts = items("fonts", "font")
font0 = fonts[0]
name_m = re.search(r'<name val="([^"]+)"/>', font0)
fname = name_m.group(1) if name_m else "Arial"


def font(sz, bold=False, rgb="FF0B0B12"):
    b = "<b/>" if bold else ""
    return f'<font>{b}<sz val="{sz}"/><color rgb="{rgb}"/><name val="{fname}"/></font>'


fo = append(
    "fonts",
    "font",
    [font(14, True), font(11, True), font(10), font(10, True, "FFFFFFFF"), font(10, True, RED), font(10, True, ORG), font(9, False, "FF74757C"), font(10, True)],
)
F_TITLE, F_SEC, F_TX, F_HEAD, F_RED, F_ORG, F_NOTE, F_BOLD = range(fo, fo + 8)

bo = append(
    "borders",
    "border",
    ['<border><left style="thin"><color rgb="FFDEDEE2"/></left><right style="thin"><color rgb="FFDEDEE2"/></right>'
     '<top style="thin"><color rgb="FFDEDEE2"/></top><bottom style="thin"><color rgb="FFDEDEE2"/></bottom><diagonal/></border>',
     '<border><left/><right/><top/><bottom style="medium"><color rgb="FF0B0B12"/></bottom><diagonal/></border>'],
)
B_CELL, B_SEC = bo, bo + 1

nf_m = block("numFmts")
nf_ids = [int(x) for x in re.findall(r'numFmtId="(\d+)"', nf_m.group(1))] if nf_m else []
NF1 = max([200] + [i + 1 for i in nf_ids])
if nf_m:
    append("numFmts", "numFmt", [f'<numFmt numFmtId="{NF1}" formatCode="#,##0.0"/>'])
else:
    st = st.replace("<fonts", f'<numFmts count="1"><numFmt numFmtId="{NF1}" formatCode="#,##0.0"/></numFmts><fonts', 1)
fills_bk = re.search(r'fillId="(\d+)"', xfs[5]).group(1)  # 見出しの黒（年間予算表の見出しと同じ）


def xf(font_id, fill_id=0, border_id=0, numfmt=0, h=None, wrap=False, v="center"):
    al = f' horizontal="{h}"' if h else ""
    al += ' wrapText="1"' if wrap else ""
    return (
        f'<xf borderId="{border_id}" fillId="{fill_id}" fontId="{font_id}" numFmtId="{numfmt}" xfId="0" applyAlignment="1" applyBorder="1" applyFill="1" applyFont="1" applyNumberFormat="1">'
        f'<alignment vertical="{v}"{al}/></xf>'
    )


STYLE_DEFS = [
    ("title", xf(F_TITLE)),
    ("sec", xf(F_SEC, border_id=B_SEC)),
    ("text", xf(F_TX)),
    ("note", xf(F_NOTE)),
    ("head", xf(F_HEAD, int(fills_bk), B_CELL, h="center", wrap=True)),
    ("label", xf(F_TX, 0, B_CELL)),
    ("labelWrap", xf(F_TX, 0, B_CELL, wrap=True, v="top")),
    ("int", xf(F_TX, 0, B_CELL, 3)),
    ("dec1", xf(F_TX, 0, B_CELL, NF1)),
    ("pct", xf(F_TX, 0, B_CELL, 9)),
    ("center", xf(F_TX, 0, B_CELL, h="center")),
    ("fix", xf(F_RED, fid_redbg, B_CELL, h="center")),
    ("check", xf(F_ORG, fid_orgbg, B_CELL, h="center")),
    ("fixNum", xf(F_RED, fid_redbg, B_CELL, NF1)),
    ("bigFix", xf(F_RED, fid_redbg, B_CELL, 0, h="center")),
    ("bigCheck", xf(F_ORG, fid_orgbg, B_CELL, 0, h="center")),
    ("bigOk", xf(F_BOLD, 0, B_CELL, 0, h="center")),
]
x0 = append("cellXfs", "xf", [d for _, d in STYLE_DEFS])
put("xl/styles.xml", st)

# ---------- 空の「診断結果」シートを足す ----------
diag_path = "xl/worksheets/sheet_diag.xml"
put(
    diag_path,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>'
    '<sheetFormatPr defaultRowHeight="15.75"/>'
    '<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="10" width="12" customWidth="1"/></cols>'
    "<sheetData/>"
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>'
    "</worksheet>",
)
ids = [int(x) for x in re.findall(r'Id="rId(\d+)"', rels)]
new_rid = f"rId{max(ids) + 1}"
rels = rels.replace(
    "</Relationships>",
    f'<Relationship Id="{new_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet_diag.xml"/></Relationships>',
)
put("xl/_rels/workbook.xml.rels", rels)
sheet_ids = [int(x) for x in re.findall(r'sheetId="(\d+)"', wb)]
wb = wb.replace("</sheets>", f'<sheet state="visible" name="{DIAG}" sheetId="{max(sheet_ids) + 1}" r:id="{new_rid}"/></sheets>')
wb = re.sub(r"<calcPr[^>]*/>", '<calcPr fullCalcOnLoad="1"/>', wb)
put("xl/workbook.xml", wb)
ct = get("[Content_Types].xml")
ct = ct.replace(
    "</Types>",
    '<Override PartName="/xl/worksheets/sheet_diag.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
)
put("[Content_Types].xml", ct)

with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as z:
    for n in order:
        z.writestr(n, files[n])

# ---------- 書式の番号を書き出す ----------
lines = [
    "// src/lib/budgetSheetStyles.ts",
    "// scripts/build-budget-sheet-template.py が書き出す（手で直さない）。ひな形 public/files/tools/budget-sheet-template.xlsx の",
    "// 「診断結果」シートで使う書式（styles.xml の cellXfs の番号）と、シートのファイルの場所",
    f'export const DIAG_SHEET_PATH = "{diag_path}";',
    "export const S = {",
]
for i, (k, _) in enumerate(STYLE_DEFS):
    lines.append(f"  {k}: {x0 + i},")
lines.append("} as const;")
open(STYLES_TS, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("ok", DST, "入力の書式", sum(1 for k in remap if k[1] == "in"), "計算の書式", sum(1 for k in remap if k[1] == "calc"))
