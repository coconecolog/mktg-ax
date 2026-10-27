"""KPI分析ツール（/tools/kpi-analysis）の「結果の見本」用のデータを、KPI管理表（M-B-04）のxlsxから作る。

使い方:
  python3 scripts/build-kpi-analysis-sample.py <M-B-04をxlsxで書き出したファイル> src/data/kpi-analysis-sample.json

ツールが読む3シート（はじめに入力・毎月の実績入力・施策ログ）のセルの値（式は計算後の値）だけを取り出す。
形: {"シート名": {"A7": 46478, "B11": 220, "G7": "文字", ...}}
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
SHEETS = ["はじめに入力", "毎月の実績入力", "施策ログ"]


def main(src, out):
    z = zipfile.ZipFile(src)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    result = {}
    for sh in wb.find("m:sheets", NS):
        name = sh.get("name")
        if name not in SHEETS:
            continue
        path = target[sh.get(RID)].lstrip("/")
        if not path.startswith("xl/"):
            path = "xl/" + path
        cells = {}
        for c in ET.fromstring(z.read(path)).iter("{%s}c" % NS["m"]):
            ref = c.get("r")
            t = c.get("t")
            v = c.find("m:v", NS)
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            elif v is None or v.text is None:
                continue
            elif t == "s":
                val = shared[int(v.text)]
            elif t in ("str", "e"):
                val = v.text
            elif t == "b":
                val = v.text == "1"
            else:
                f = float(v.text)
                val = int(f) if f.is_integer() else round(f, 6)
            if val == "":
                continue
            row = int(re.sub(r"[A-Z]+", "", ref))
            col = re.sub(r"\d+", "", ref)
            if len(col) > 1 or row > 200:
                continue
            cells[ref] = val
        result[name] = cells
    with open(out, "w", encoding="utf-8") as fp:
        json.dump(result, fp, ensure_ascii=False, separators=(",", ":"))
    print(out, {k: len(v) for k, v in result.items()})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
