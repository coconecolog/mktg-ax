#!/usr/bin/env node
/**
 * 中小企業実態基本調査（中小企業庁／e-Stat）から
 * 「産業別・売上高階級別表」の売上高・広告宣伝費データを取得し、
 * サイトで使う軽量JSON（src/data/benchmark-data.json）に変換するスクリプト。
 *
 * ■ 使い方（Node.js 18以上。追加インストール不要）
 *   Windows (PowerShell):
 *     $env:ESTAT_APP_ID="取得したappId"
 *     node scripts/fetch-benchmark-data.mjs
 *
 *   Mac/Linux:
 *     export ESTAT_APP_ID="取得したappId"
 *     node scripts/fetch-benchmark-data.mjs
 *
 * ■ 何をしているか（3ステップ）
 *   Step 1: getStatsList で「中小企業実態基本調査」の該当統計表IDを検索
 *   Step 2: getStatsData でその統計表の実データ（JSON）を取得
 *   Step 3: 産業（中分類）×項目ごとに「売上高」「広告宣伝費」を取り出し、
 *           比率（％）を計算してJSON化
 *
 * ■ 注意
 *   - appIdは実行時に一度使うだけで、完成したサイトに埋め込む必要はない。
 *   - 実行後にできる src/data/benchmark-data.json だけをコミットすればよい。
 */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP_ID = (process.env.ESTAT_APP_ID || "").trim();
const BASE_URL = "https://api.e-stat.go.jp/rest/3.0/app/json";

// 2026-09-15時点でe-Statのファイル検索から確認した最新版。
// 「中小企業実態基本調査 令和6年確報（令和5年度決算実績）
//   統計表3．売上高及び営業費用 (2)産業中分類別表 1)法人企業」
// 公開日: 2025-07-30 （旧データは2016年度分だったため、7年分新しくなる）
// まずこのIDを直接試し、失敗したときだけ検索にフォールバックする。
const KNOWN_LATEST_STATS_DATA_ID = "000040303383";

// 直接IDがうまくいかなかった場合のフォールバック検索キーワード
const SEARCH_CANDIDATES = ["中小企業実態基本調査"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "src", "data", "benchmark-data.json");

async function apiGet(endpoint, params) {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set("appId", APP_ID);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`e-Stat APIへのリクエストに失敗しました（HTTP ${res.status}）: ${url}`);
  }
  return res.json();
}

function tableTitle(t) {
  const statName = typeof t.STATISTICS_NAME === "string" ? t.STATISTICS_NAME : (t.STATISTICS_NAME?.$ || "");
  const title = t.TITLE?.$ ?? (typeof t.TITLE === "string" ? t.TITLE : "");
  return `${statName}｜${title}`;
}

async function findStatsDataId() {
  const allTables = [];

  for (const word of SEARCH_CANDIDATES) {
    const data = await apiGet("getStatsList", { searchWord: word, limit: 100 });

    const status = data?.GET_STATS_LIST?.RESULT?.STATUS;
    const errorMsg = data?.GET_STATS_LIST?.RESULT?.ERROR_MSG;
    if (status !== undefined && status !== 0) {
      console.error(`[APIエラー] STATUS=${status} ERROR_MSG=${errorMsg}`);
      continue;
    }

    const result = data?.GET_STATS_LIST?.DATALIST_INF ?? {};
    let tables = result.TABLE_INF ?? [];
    if (!Array.isArray(tables)) tables = [tables];
    allTables.push(...tables);

    for (const t of tables) {
      const title = tableTitle(t);
      if (title.includes("売上高") && title.includes("営業費用") && (title.includes("産業") || title.includes("業種"))) {
        console.log(`[OK] 候補テーブル発見: ${t["@id"]} / ${title}`);
        return { statsDataId: t["@id"], title };
      }
    }
  }

  // 自動マッチしなかった場合：見つかった統計表を全部表示して、目視で選べるようにする
  console.log(`\n[情報] 自動マッチしませんでした。見つかった統計表は${allTables.length}件です。`);
  console.log('（「産業別・売上高階級別表」「売上高及び営業費用」に近い名前のものを探しています）\n');
  allTables.forEach((t, i) => {
    console.log(`${i + 1}. [id=${t["@id"]}] ${tableTitle(t)}`);
  });

  const debugPath = path.join(__dirname, "debug-search-results.json");
  await writeFile(debugPath, JSON.stringify(allTables, null, 2), "utf-8");
  console.log(`\n[情報] 一覧を ${debugPath} にも保存しました。件数が多くて画面で見づらい場合は、このファイルをClaudeに送ってください。`);

  return { statsDataId: null, title: null };
}

async function fetchStatsData(statsDataId) {
  const data = await apiGet("getStatsData", { statsDataId });

  const status = data?.GET_STATS_DATA?.RESULT?.STATUS;
  const errorMsg = data?.GET_STATS_DATA?.RESULT?.ERROR_MSG;
  if (status !== undefined && status !== 0) {
    throw new Error(`getStatsDataがエラーを返しました STATUS=${status} ERROR_MSG=${errorMsg}`);
  }

  return data?.GET_STATS_DATA?.STATISTICAL_DATA ?? {};
}

function extractTitleFromStatsData(statData) {
  const tableInf = statData?.TABLE_INF ?? {};
  const statName = typeof tableInf.STATISTICS_NAME === "string" ? tableInf.STATISTICS_NAME : (tableInf.STATISTICS_NAME?.$ || "");
  const title = tableInf.TITLE?.$ ?? (typeof tableInf.TITLE === "string" ? tableInf.TITLE : "");
  return statName || title ? `${statName}｜${title}` : null;
}

// 既知の最新統計表IDをまず直接試す。CLASS_INF・DATA_INFが取れれば成功とみなす。
async function tryKnownTable() {
  try {
    const statData = await fetchStatsData(KNOWN_LATEST_STATS_DATA_ID);
    const hasClass = (statData?.CLASS_INF?.CLASS_OBJ?.length ?? 0) > 0 || !!statData?.CLASS_INF?.CLASS_OBJ;
    const hasValues = !!statData?.DATA_INF?.VALUE;
    if (!hasClass || !hasValues) {
      console.warn("[情報] 既知の最新統計表IDではデータが取得できませんでした。検索にフォールバックします。");
      return null;
    }
    const title = extractTitleFromStatsData(statData) || "中小企業実態基本調査 令和6年確報（令和5年度決算実績） 産業中分類別表（法人企業）";
    console.log(`[OK] 既知の最新統計表を使用: ${KNOWN_LATEST_STATS_DATA_ID} / ${title}`);
    return { statData, title, statsDataId: KNOWN_LATEST_STATS_DATA_ID };
  } catch (err) {
    console.warn(`[情報] 既知の最新統計表IDの取得に失敗しました（${err.message}）。検索にフォールバックします。`);
    return null;
  }
}

function buildBenchmarkJson(statData, sourceTitle, statsDataId) {
  const classObjsRaw = statData?.CLASS_INF?.CLASS_OBJ ?? [];
  const axisList = Array.isArray(classObjsRaw) ? classObjsRaw : [classObjsRaw];

  const asArray = (x) => (Array.isArray(x) ? x : [x]);

  // 業種の軸・項目の軸・年度の軸を、中身の名前から自動判定する
  const industryObj = axisList.find((a) =>
    asArray(a.CLASS).some((c) => (c["@name"] || "").includes("製造業") || (c["@name"] || "").includes("卸売業"))
  );
  const itemObj = axisList.find((a) =>
    asArray(a.CLASS).some((c) => (c["@name"] || "") === "売上高" || (c["@name"] || "").includes("広告宣伝費"))
  );
  const timeObj = axisList.find((a) => a["@id"] === "time" || (a["@name"] || "").includes("時間軸"));

  const emptyResult = {
    sourceTitle,
    statsDataId,
    note: "中小企業庁「中小企業実態基本調査」（e-Stat経由）に基づく業種別ベンチマーク。数値は原則法人企業ベース。",
    generatedFields: ["industry", "adToSalesRatioPercent"],
    industries: [],
  };

  if (!industryObj || !itemObj) return emptyResult;

  const industryAxis = industryObj["@id"]; // 例: "cat01"
  const itemAxis = itemObj["@id"]; // 例: "cat02"
  const timeAxis = timeObj ? timeObj["@id"] : null; // 例: "time"

  const industryClasses = asArray(industryObj.CLASS);
  const itemClasses = asArray(itemObj.CLASS);

  // 業種は大分類の合計行（@level "2"）だけを使う（小分類まで含めると細かすぎるため）
  const majorIndustries = industryClasses.filter((c) => c["@level"] === "2");

  const salesItem = itemClasses.find((c) => c["@name"] === "売上高");
  const adItem = itemClasses.find((c) => (c["@name"] || "").includes("広告宣伝費"));

  if (!salesItem || !adItem || majorIndustries.length === 0) return emptyResult;

  let values = statData?.DATA_INF?.VALUE ?? [];
  values = asArray(values);

  // e-StatのVALUE配列は、キーに軸IDそのままではなく "@"を付けたもの（例: "@cat01"）を使う
  const industryKey = `@${industryAxis}`;
  const itemKey = `@${itemAxis}`;
  const timeKey = timeAxis ? `@${timeAxis}` : null;

  // 年度が複数含まれる場合は、最新（コードの数字が一番大きいもの）だけを使う
  let latestTime = null;
  if (timeKey) {
    const timeCodes = [...new Set(values.map((v) => v[timeKey]).filter(Boolean))];
    timeCodes.sort();
    latestTime = timeCodes[timeCodes.length - 1] ?? null;
  }

  const findValue = (industryCode, itemCode) =>
    values.find(
      (v) =>
        v[industryKey] === industryCode &&
        v[itemKey] === itemCode &&
        (!timeKey || v[timeKey] === latestTime)
    );

  const records = [];
  for (const ind of majorIndustries) {
    const salesV = findValue(ind["@code"], salesItem["@code"]);
    const adV = findValue(ind["@code"], adItem["@code"]);
    if (!salesV || !adV) continue;

    const salesF = parseFloat(salesV["$"]);
    const adF = parseFloat(adV["$"]);
    const ratio = salesF ? Math.round((adF / salesF) * 100 * 1000) / 1000 : null;

    records.push({
      industry: (ind["@name"] || "").replace(/_計$/, ""),
      salesRaw: salesV["$"],
      adSpendRaw: adV["$"],
      adToSalesRatioPercent: ratio,
    });
  }

  return {
    sourceTitle,
    statsDataId,
    surveyYearCode: latestTime,
    note: "中小企業庁「中小企業実態基本調査」（e-Stat経由）に基づく業種別ベンチマーク。数値は原則法人企業ベース。単位は百万円。",
    generatedFields: ["industry", "adToSalesRatioPercent"],
    industries: records,
  };
}

async function main() {
  if (!APP_ID) {
    console.error("エラー: 環境変数 ESTAT_APP_ID が未設定です。スクリプト冒頭の説明を参照してください。");
    process.exit(1);
  }

  // まず既知の最新統計表（令和6年確報＝令和5年度決算実績）を直接試す
  let statsDataId, title, statData;
  const known = await tryKnownTable();

  if (known) {
    ({ statsDataId, title, statData } = known);
  } else {
    const found = await findStatsDataId();
    if (!found.statsDataId) {
      console.error("エラー: 該当する統計表が見つかりませんでした。");
      console.error("手動確認用URL: https://www.e-stat.go.jp/stat-search/files?toukei=00553010&tstat=000001019842");
      process.exit(1);
    }
    statsDataId = found.statsDataId;
    title = found.title;
    statData = await fetchStatsData(statsDataId);
  }

  const result = buildBenchmarkJson(statData, title, statsDataId);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2), "utf-8");

  console.log(`[完了] ${OUTPUT_PATH} を生成しました。業種データ件数: ${result.industries.length}`);
  if (result.industries.length === 0) {
    console.warn("[警告] 業種データが0件です。統計表の軸名・項目名が想定と違う可能性があります。");

    // 原因調査用に、軸の定義(CLASS_INF)とデータの先頭サンプルだけを書き出す。
    // （DATA_INF.VALUEは件数が多いことがあるため、全部ではなく先頭30件だけ保存する）
    const classObjs = statData?.CLASS_INF?.CLASS_OBJ ?? [];
    let sampleValues = statData?.DATA_INF?.VALUE ?? [];
    if (!Array.isArray(sampleValues)) sampleValues = [sampleValues];
    sampleValues = sampleValues.slice(0, 30);

    const debugPath = path.join(__dirname, "debug-stats-data.json");
    await writeFile(
      debugPath,
      JSON.stringify({ CLASS_INF: { CLASS_OBJ: classObjs }, SAMPLE_VALUES: sampleValues }, null, 2),
      "utf-8"
    );
    console.warn(`[警告] 調査用に ${debugPath} を保存しました。このファイルをClaudeに送ってください（Cursorのファイル一覧からscriptsフォルダを開くと出てきます）。`);
  }
}

main().catch((err) => {
  console.error("[エラー]", err.message);
  process.exit(1);
});
