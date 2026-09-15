#!/usr/bin/env python3
"""
中小企業実態基本調査（中小企業庁／e-Stat）から
「産業別・売上高階級別表」の売上高・広告宣伝費データを取得し、
サイトで使う軽量JSON（benchmark-data.json）に変換するスクリプト。

■ 使い方
1. 無料のe-Stat APIアプリケーションIDを取得する（登録5分・無料）
   https://www.e-stat.go.jp/api/ の「利用登録」から取得
2. 取得したappIdを環境変数に設定して実行する

   Windows(PowerShell):
     $env:ESTAT_APP_ID="ここに取得したID"
     python scripts\\fetch_benchmark_data.py

   Mac/Linux:
     export ESTAT_APP_ID="ここに取得したID"
     python3 scripts/fetch_benchmark_data.py

3. 実行すると src/data/benchmark-data.json が生成/更新される
4. 生成されたJSONの中身を一度確認してからコミットする
   （統計表の年度が変わったときは、このスクリプトを再実行するだけでよい）

■ 何をしているか（3ステップ）
  Step 1: getStatsList で「中小企業実態基本調査」の該当統計表IDを検索
  Step 2: getStatsData でその統計表の実データ（JSON）を取得
  Step 3: 産業（中分類）×売上高階級ごとに
          「売上高」「広告宣伝費」を取り出し、比率（％）を計算してJSON化

■ 注意
  - appIdは「取得したら誰でも使える公開APIキー」に近いもので、
    最終的にサイトに埋め込む必要は一切ない（このスクリプトを動かす時だけ使う）。
  - 実行後にできる benchmark-data.json だけをリポジトリにコミットすればよい。
"""

import json
import os
import sys
import urllib.parse
import urllib.request

APP_ID = os.environ.get("ESTAT_APP_ID", "").strip()
BASE_URL = "https://api.e-stat.go.jp/rest/3.0/app/json"

# 中小企業実態基本調査「産業別・売上高階級別表」を検索するキーワード。
# e-Statの表記ゆれに対応できるよう複数候補を順に試す。
SEARCH_CANDIDATES = [
    "中小企業実態基本調査 売上高及び営業費用 産業別 売上高階級別",
    "中小企業実態基本調査 売上高及び営業費用 産業別",
    "中小企業実態基本調査 広告宣伝費",
]

OUTPUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "data", "benchmark-data.json",
)


def api_get(path, params):
    params = {**params, "appId": APP_ID}
    url = f"{BASE_URL}/{path}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def find_stats_data_id():
    """getStatsListで統計表IDを探す。候補ワードを順に試し、
    タイトルに『中小企業実態基本調査』を含む最初の結果を採用する。"""
    for word in SEARCH_CANDIDATES:
        data = api_get("getStatsList", {"searchWord": word, "limit": 20})
        result = data.get("GET_STATS_LIST", {}).get("DATALIST_INF", {})
        tables = result.get("TABLE_INF", [])
        if isinstance(tables, dict):
            tables = [tables]
        for t in tables:
            title = t.get("STATISTICS_NAME", "") + t.get("TITLE", {}).get("$", "")
            if "中小企業実態基本調査" in title and (
                "売上高" in title or "営業費用" in title
            ):
                print(f"[OK] 候補テーブル発見: {t.get('@id')} / {title}")
                return t.get("@id"), title
    return None, None


def fetch_stats_data(stats_data_id):
    data = api_get("getStatsData", {"statsDataId": stats_data_id})
    return data.get("GET_STATS_DATA", {}).get("STATISTICAL_DATA", {})


def build_benchmark_json(stat_data, source_title, stats_data_id):
    """
    e-Statの生データは表側・表頭のコード体系が年度により変わることがあるため、
    ここでは『とにかく産業名と数値項目名を突き合わせて拾う』シンプルな作りにしている。
    実行後、生成JSONを開いて数値が想定通りか必ず目視確認すること。
    """
    class_objs = stat_data.get("CLASS_INF", {}).get("CLASS_OBJ", [])
    code_maps = {}
    for obj in class_objs:
        obj_id = obj.get("@id")
        items = obj.get("CLASS", [])
        if isinstance(items, dict):
            items = [items]
        code_maps[obj_id] = {i.get("@code"): i.get("@name") for i in items}

    values = stat_data.get("DATA_INF", {}).get("VALUE", [])
    if isinstance(values, dict):
        values = [values]

    # 業種コードの軸(cat01等)と項目コードの軸を自動判定する
    industry_axis = None
    item_axis = None
    for axis_id, mapping in code_maps.items():
        names = " ".join(mapping.values())
        if "製造業" in names or "卸売業" in names or "サービス業" in names:
            industry_axis = axis_id
        if "売上高" in names or "広告宣伝費" in names or "営業費用" in names:
            item_axis = axis_id

    records = []
    if industry_axis and item_axis:
        by_industry = {}
        for v in values:
            ind_code = v.get(industry_axis)
            item_code = v.get(item_axis)
            if ind_code is None or item_code is None:
                continue
            ind_name = code_maps[industry_axis].get(ind_code, ind_code)
            item_name = code_maps[item_axis].get(item_code, item_code)
            by_industry.setdefault(ind_name, {})[item_name] = v.get("$")

        for ind_name, items in by_industry.items():
            sales = next((val for key, val in items.items() if "売上高" in key and "営業" not in key), None)
            ad = next((val for key, val in items.items() if "広告宣伝費" in key), None)
            if sales and ad:
                try:
                    sales_f = float(sales)
                    ad_f = float(ad)
                    ratio = round(ad_f / sales_f * 100, 3) if sales_f else None
                except ValueError:
                    ratio = None
                records.append({
                    "industry": ind_name,
                    "salesRaw": sales,
                    "adSpendRaw": ad,
                    "adToSalesRatioPercent": ratio,
                })

    return {
        "sourceTitle": source_title,
        "statsDataId": stats_data_id,
        "note": "中小企業庁「中小企業実態基本調査」（e-Stat経由）に基づく業種別ベンチマーク。数値は原則法人企業ベース。",
        "generatedFields": ["industry", "adToSalesRatioPercent"],
        "industries": records,
    }


def main():
    if not APP_ID:
        print("エラー: 環境変数 ESTAT_APP_ID が未設定です。スクリプト冒頭の説明を参照してください。")
        sys.exit(1)

    stats_data_id, title = find_stats_data_id()
    if not stats_data_id:
        print("エラー: 該当する統計表が見つかりませんでした。SEARCH_CANDIDATESを見直してください。")
        print("手動確認用URL: https://www.e-stat.go.jp/stat-search/files?toukei=00553010&tstat=000001019842")
        sys.exit(1)

    stat_data = fetch_stats_data(stats_data_id)
    result = build_benchmark_json(stat_data, title, stats_data_id)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[完了] {OUTPUT_PATH} を生成しました。業種データ件数: {len(result['industries'])}")
    if len(result["industries"]) == 0:
        print("[警告] 業種データが0件です。統計表の軸名が想定と違う可能性があります。")
        print("       生成されたJSONではなく、この画面に出たエラー内容をClaudeに貼って相談してください。")


if __name__ == "__main__":
    main()
