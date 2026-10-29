// 週次の分析レポート（Search Console・GA4 → Notion「分析レポート」DB）
//
// 実行: .github/workflows/weekly-analytics-report.yml（毎週月曜の朝）
// 手動: node scripts/weekly-analytics-report.mjs --dry-run   … Notionに書かず、集計結果だけを表示する
//
// 必要な環境変数
//   GOOGLE_SA_KEY         サービスアカウントのJSON鍵（中身そのもの）
//   GA4_PROPERTY_ID       GA4のプロパティID（数字）
//   NOTION_TOKEN          Notionのインテグレーションのトークン（ビルドと同じもの）
//   NOTION_ANALYTICS_DATABASE_ID  省略時は下の既定値（分析レポートDB）
//   GSC_SITE_URL          省略時は、サービスアカウントが見られるSearch Consoleのサイトから自動で選ぶ
//
// インデックスの状況はURL検査APIで1件ずつ調べる（Search Consoleで「制限付き」以上の権限が要る）。
//
// インデックスの状況: サイトマップの記事URLを、Search ConsoleのURL検査APIで1本ずつ調べる（1日2,000件まで）。
// 期間: Search Consoleのデータは2〜3日遅れるため、3日前を終わりとする直近28日と、その前の28日を比べる。
// 外部のライブラリは使わない（Googleの認証はJWTを自前で署名する）。

import crypto from "node:crypto";
import { notionRequest, resolveDataSourceId } from "./lib/notion-client.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const DEFAULT_ANALYTICS_DATABASE_ID = "10dac08bc1a7425fbf51b1470f95a9c2";

// ブランド名を含む検索（指名検索）の判定
const BRAND_PATTERN = /mktg\s*\.?\s*ax|マーケティング\s*ax/i;
// AI経由の流入として数える参照元（GA4の sessionSource）
const AI_SOURCE_PATTERN =
  /(chatgpt\.com|chat\.openai\.com|openai|perplexity|gemini\.google|bard\.google|claude\.ai|copilot\.microsoft|copilot\.cloud\.microsoft|you\.com|felo\.ai|genspark)/i;
// リライト・記事見直しの候補にする語句の条件
const OPPORTUNITY_MIN_IMPRESSIONS = 20;
const OPPORTUNITY_POSITION_MIN = 8;
const OPPORTUNITY_POSITION_MAX = 30;

// ------------------------------------------------------------
// 日付
// ------------------------------------------------------------

function jstToday() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function buildPeriods() {
  const end = addDays(jstToday(), -3);
  const start = addDays(end, -27);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -27);
  return {
    current: { start: ymd(start), end: ymd(end) },
    previous: { start: ymd(prevStart), end: ymd(prevEnd) },
  };
}

// ------------------------------------------------------------
// Googleの認証（サービスアカウントのJWT → アクセストークン）
// ------------------------------------------------------------

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getGoogleAccessToken(saKeyJson, scopes) {
  const key = JSON.parse(saKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = base64url(signer.sign(key.private_key));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Googleの認証に失敗しました: ${body.error_description || body.error || res.status}`);
  return { token: body.access_token, email: key.client_email };
}

async function googleRequest(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google API error ${res.status} ${url}: ${json.error?.message || res.statusText}`);
  }
  return json;
}

// ------------------------------------------------------------
// Search Console
// ------------------------------------------------------------

async function resolveGscSite(token, email) {
  if (process.env.GSC_SITE_URL) return process.env.GSC_SITE_URL;
  const res = await googleRequest(token, "GET", "https://www.googleapis.com/webmasters/v3/sites");
  const sites = (res.siteEntry || []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
  if (sites.length === 0) {
    throw new Error(
      `Search Consoleのサイトが見つかりません。Search Consoleの「設定」→「ユーザーと権限」に ${email} を追加してください。`,
    );
  }
  const preferred = sites.find((s) => /mktg/i.test(s.siteUrl)) || sites[0];
  return preferred.siteUrl;
}

async function gscQuery(token, siteUrl, period, dimensions, rowLimit = 1000) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await googleRequest(token, "POST", url, {
    startDate: period.start,
    endDate: period.end,
    dimensions,
    rowLimit,
    dataState: "final",
  });
  return res.rows || [];
}

function summarizeGsc(totalRows) {
  const row = totalRows[0] || { clicks: 0, impressions: 0, position: 0 };
  return { clicks: row.clicks || 0, impressions: row.impressions || 0, position: row.position || 0 };
}

function pathOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
}

async function collectGsc(token, siteUrl, periods) {
  const [curTotal, prevTotal, curPages, prevPages, curQueries] = await Promise.all([
    gscQuery(token, siteUrl, periods.current, [], 1),
    gscQuery(token, siteUrl, periods.previous, [], 1),
    gscQuery(token, siteUrl, periods.current, ["page"]),
    gscQuery(token, siteUrl, periods.previous, ["page"]),
    gscQuery(token, siteUrl, periods.current, ["query"], 5000),
  ]);

  const prevByPage = new Map(prevPages.map((r) => [r.keys[0], r]));
  const pages = curPages.map((r) => {
    const prev = prevByPage.get(r.keys[0]);
    return {
      path: pathOf(r.keys[0]),
      clicks: r.clicks,
      prevClicks: prev?.clicks || 0,
      impressions: r.impressions,
      position: r.position,
    };
  });
  // 前の期間にだけあったページ（クリックが0になったページ）も、下がった記事として拾う
  const currentKeys = new Set(curPages.map((r) => r.keys[0]));
  for (const r of prevPages) {
    if (!currentKeys.has(r.keys[0])) {
      pages.push({ path: pathOf(r.keys[0]), clicks: 0, prevClicks: r.clicks, impressions: 0, position: 0 });
    }
  }

  const brandClicks = curQueries
    .filter((r) => BRAND_PATTERN.test(r.keys[0]))
    .reduce((sum, r) => sum + r.clicks, 0);

  const opportunities = curQueries
    .filter(
      (r) =>
        r.impressions >= OPPORTUNITY_MIN_IMPRESSIONS &&
        r.position >= OPPORTUNITY_POSITION_MIN &&
        r.position <= OPPORTUNITY_POSITION_MAX &&
        !BRAND_PATTERN.test(r.keys[0]),
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30)
    .map((r) => ({ query: r.keys[0], impressions: r.impressions, clicks: r.clicks, position: r.position }));

  return {
    current: summarizeGsc(curTotal),
    previous: summarizeGsc(prevTotal),
    brandClicks,
    topPages: [...pages].sort((a, b) => b.clicks - a.clicks).slice(0, 20),
    droppedPages: pages
      .filter((p) => p.prevClicks >= 3 && p.clicks < p.prevClicks)
      .sort((a, b) => b.prevClicks - b.clicks - (a.prevClicks - a.clicks))
      .slice(0, 15),
    opportunities,
  };
}

// ------------------------------------------------------------
// インデックスの状況（URL検査API。記事ページだけを調べる）
// ------------------------------------------------------------

async function listArticleUrls(siteUrl) {
  // サイトマップから /lab/blog/{記事} のURLを集める（カテゴリ・タグ・ページ送りは除く）
  const origin = siteUrl.startsWith("sc-domain:") ? `https://${siteUrl.slice(10)}` : siteUrl.replace(/\/$/, "");
  const fetchText = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`サイトマップを取得できません: ${url} (${res.status})`);
    return res.text();
  };
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const index = await fetchText(`${origin}/sitemap-index.xml`);
  const urls = [];
  for (const sitemap of locs(index)) urls.push(...locs(await fetchText(sitemap)));
  return urls.filter((u) => /^\/lab\/blog\/(?!\d+$)[^/]+$/.test(new URL(u).pathname));
}

async function inspectUrls(token, siteUrl, urls) {
  const results = [];
  for (const url of urls) {
    try {
      const res = await googleRequest(token, "POST", "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
        inspectionUrl: url,
        siteUrl,
        languageCode: "ja",
      });
      const status = res.inspectionResult?.indexStatusResult || {};
      results.push({
        path: pathOf(url),
        verdict: status.verdict || "UNKNOWN",
        coverage: status.coverageState || "",
        lastCrawl: status.lastCrawlTime ? status.lastCrawlTime.slice(0, 10) : "",
      });
    } catch (err) {
      results.push({ path: pathOf(url), verdict: "ERROR", coverage: err.message.slice(0, 120), lastCrawl: "" });
    }
  }
  return results;
}

async function collectIndex(token, siteUrl) {
  const urls = await listArticleUrls(siteUrl);
  const results = await inspectUrls(token, siteUrl, urls);
  const indexed = results.filter((r) => r.verdict === "PASS");
  return {
    total: results.length,
    indexed: indexed.length,
    notIndexed: results.filter((r) => r.verdict !== "PASS").sort((a, b) => a.coverage.localeCompare(b.coverage)),
  };
}

// ------------------------------------------------------------
// インデックスの状況（Search ConsoleのURL検査API）
// サイトマップから記事・資料・ツールのURLを集め、1件ずつ検査する（上限は1日2,000件）。
// ------------------------------------------------------------

const INSPECT_PATH_PATTERN = /^\/(blog\/(?!tag\/|category\/|\d+$)[^/]+|resources\/[^/]+|tools\/[^/]+|standards(\/[^/]+)?)$/;

async function fetchSitemapUrls(siteBase) {
  const locs = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`サイトマップを取得できません: ${url} (${res.status})`);
    const xml = await res.text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  };
  const index = await locs(new URL("sitemap-index.xml", siteBase).toString());
  const urls = [];
  for (const sitemap of index) urls.push(...(await locs(sitemap)));
  return urls.filter((u) => INSPECT_PATH_PATTERN.test(pathOf(u)));
}

async function collectIndexStatus(token, siteUrl) {
  const siteBase = siteUrl.startsWith("sc-domain:") ? `https://${siteUrl.slice(10)}/` : siteUrl;
  const urls = await fetchSitemapUrls(siteBase);
  const results = [];
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const res = await googleRequest(
          token,
          "POST",
          "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
          { inspectionUrl: url, siteUrl, languageCode: "ja" },
        );
        const r = res.inspectionResult?.indexStatusResult || {};
        results.push({
          path: pathOf(url),
          verdict: r.verdict || "UNKNOWN",
          coverage: r.coverageState || "-",
          lastCrawl: r.lastCrawlTime ? r.lastCrawlTime.slice(0, 10) : "-",
        });
      } catch (err) {
        results.push({ path: pathOf(url), verdict: "ERROR", coverage: err.message.slice(0, 80), lastCrawl: "-" });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  results.sort((a, b) => a.path.localeCompare(b.path));
  const indexed = results.filter((r) => r.verdict === "PASS").length;
  return { total: results.length, indexed, notIndexed: results.filter((r) => r.verdict !== "PASS") };
}

// ------------------------------------------------------------
// GA4
// ------------------------------------------------------------

async function ga4Report(token, propertyId, body) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const res = await googleRequest(token, "POST", url, body);
  return res.rows || [];
}

function dateRanges(periods) {
  return [
    { startDate: periods.current.start, endDate: periods.current.end, name: "current" },
    { startDate: periods.previous.start, endDate: periods.previous.end, name: "previous" },
  ];
}

// 期間が2つのとき、GA4は dateRange というディメンションを自動で足す（値は "current" / "previous"）
function splitByRange(rows) {
  const out = { current: [], previous: [] };
  for (const r of rows) {
    const values = r.dimensionValues.map((d) => d.value);
    const range = values.pop();
    (out[range] || out.current).push({ dims: values, value: Number(r.metricValues[0].value) });
  }
  return out;
}

async function collectGa4(token, propertyId, periods) {
  const [sourceRows, eventRows, aiLandingRows, toolRows] = await Promise.all([
    ga4Report(token, propertyId, {
      dateRanges: dateRanges(periods),
      dimensions: [{ name: "sessionSource" }],
      metrics: [{ name: "sessions" }],
      limit: 1000,
    }),
    ga4Report(token, propertyId, {
      dateRanges: dateRanges(periods),
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["resource_download", "contact_form_submit", "tool_use"] },
        },
      },
    }),
    ga4Report(token, propertyId, {
      dateRanges: [dateRanges(periods)[0]],
      dimensions: [{ name: "sessionSource" }, { name: "landingPage" }],
      metrics: [{ name: "sessions" }],
      limit: 1000,
    }),
    ga4Report(token, propertyId, {
      dateRanges: [dateRanges(periods)[0]],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "tool_use" } } },
      limit: 100,
    }),
  ]);

  const sources = splitByRange(sourceRows);
  const aiBySource = (list) => {
    const map = new Map();
    for (const r of list) {
      if (!AI_SOURCE_PATTERN.test(r.dims[0])) continue;
      map.set(r.dims[0], (map.get(r.dims[0]) || 0) + r.value);
    }
    return map;
  };
  const aiCurrent = aiBySource(sources.current);
  const aiPrevious = aiBySource(sources.previous);
  const sum = (map) => [...map.values()].reduce((a, b) => a + b, 0);

  const events = splitByRange(eventRows);
  const eventCount = (list, name) => list.filter((r) => r.dims[0] === name).reduce((a, r) => a + r.value, 0);

  const aiLanding = new Map();
  for (const r of aiLandingRows) {
    const [source, landing] = r.dimensionValues.map((d) => d.value);
    if (!AI_SOURCE_PATTERN.test(source)) continue;
    aiLanding.set(landing, (aiLanding.get(landing) || 0) + Number(r.metricValues[0].value));
  }

  return {
    aiSessions: { current: sum(aiCurrent), previous: sum(aiPrevious) },
    aiSources: [...aiCurrent.entries()].sort((a, b) => b[1] - a[1]).map(([source, sessions]) => ({
      source,
      sessions,
      prevSessions: aiPrevious.get(source) || 0,
    })),
    aiLandingPages: [...aiLanding.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([path, sessions]) => ({
      path,
      sessions,
    })),
    downloads: {
      current: eventCount(events.current, "resource_download"),
      previous: eventCount(events.previous, "resource_download"),
    },
    contacts: {
      current: eventCount(events.current, "contact_form_submit"),
      previous: eventCount(events.previous, "contact_form_submit"),
    },
    toolUse: {
      current: eventCount(events.current, "tool_use"),
      previous: eventCount(events.previous, "tool_use"),
    },
    toolPages: toolRows
      .map((r) => ({ path: r.dimensionValues[0].value, count: Number(r.metricValues[0].value) }))
      .sort((a, b) => b.count - a.count),
  };
}

// ------------------------------------------------------------
// Notionのブロック
// ------------------------------------------------------------

const text = (content) => [{ type: "text", text: { content: String(content).slice(0, 2000) } }];
const heading = (content) => ({ object: "block", type: "heading_2", heading_2: { rich_text: text(content) } });
const paragraph = (content) => ({ object: "block", type: "paragraph", paragraph: { rich_text: text(content) } });
const bullet = (content) => ({
  object: "block",
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: text(content) },
});

function table(headers, rows) {
  if (rows.length === 0) return paragraph("該当なし");
  return {
    object: "block",
    type: "table",
    table: {
      table_width: headers.length,
      has_column_header: true,
      has_row_header: false,
      children: [headers, ...rows].map((cells) => ({
        object: "block",
        type: "table_row",
        table_row: { cells: cells.map((c) => text(c)) },
      })),
    },
  };
}

const fmt = (n) => Math.round(n).toLocaleString("ja-JP");
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const pct = (n) => `${(n * 100).toFixed(1)}%`;
function diff(cur, prev) {
  if (!prev) return cur ? "（前期間 0）" : "";
  const d = (cur - prev) / prev;
  return `（${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)}%）`;
}

function buildBlocks({ periods, siteUrl, gsc, ga4, index }) {
  const g = gsc.current;
  const gp = gsc.previous;
  return [
    paragraph(
      `期間：${periods.current.start}〜${periods.current.end}（前の期間：${periods.previous.start}〜${periods.previous.end}）／Search Console：${siteUrl}`,
    ),
    heading("全体"),
    table(
      ["指標", "今回", "前の期間", "増減"],
      [
        ["検索の表示回数", fmt(g.impressions), fmt(gp.impressions), diff(g.impressions, gp.impressions)],
        ["検索のクリック数", fmt(g.clicks), fmt(gp.clicks), diff(g.clicks, gp.clicks)],
        ["検索のクリック率", g.impressions ? pct(g.clicks / g.impressions) : "-", gp.impressions ? pct(gp.clicks / gp.impressions) : "-", ""],
        ["平均順位", fmt1(g.position), fmt1(gp.position), ""],
        ["指名検索のクリック数", fmt(gsc.brandClicks), "-", ""],
        ["インデックス済みのページ", index ? `${index.indexed} / ${index.total}` : "取得できず", "-", ""],
        ["インデックス済みの記事", index ? `${index.indexed} / ${index.total}` : "取得失敗", "-", ""],
        ["AI経由のセッション", fmt(ga4.aiSessions.current), fmt(ga4.aiSessions.previous), diff(ga4.aiSessions.current, ga4.aiSessions.previous)],
        ["ツール利用（tool_use）", fmt(ga4.toolUse.current), fmt(ga4.toolUse.previous), diff(ga4.toolUse.current, ga4.toolUse.previous)],
        ["資料DL", fmt(ga4.downloads.current), fmt(ga4.downloads.previous), diff(ga4.downloads.current, ga4.downloads.previous)],
        ["お問い合わせ", fmt(ga4.contacts.current), fmt(ga4.contacts.previous), diff(ga4.contacts.current, ga4.contacts.previous)],
      ],
    ),
    heading("インデックスされていない記事"),
    paragraph("Googleに登録されていない記事は、需要の有無に関係なく検索に出ない。公開から数週間たっても残る記事は、内容の重複や内部リンクの不足を疑う。"),
    index
      ? table(
          ["ページ", "状態", "最終クロール"],
          index.notIndexed.map((r) => [r.path, r.coverage || r.verdict, r.lastCrawl || "-"]),
        )
      : paragraph("取得に失敗しました（Actionsのログを確認）。"),
    heading("インデックスされていないページ"),
    paragraph(
      index
        ? "記事・資料・ツールのうち、Googleの検索結果に載っていないもの。「検出 - インデックス未登録」「クロール済み - インデックス未登録」が続くページは、内容の重複や薄さを疑う。"
        : "URL検査APIを使えなかったため取得できませんでした。",
    ),
    table(
      ["ページ", "状態", "最後のクロール"],
      (index?.notIndexed || []).map((r) => [r.path, r.coverage, r.lastCrawl]),
    ),
    heading("AI経由の流入"),
    table(
      ["参照元", "セッション", "前の期間"],
      ga4.aiSources.map((s) => [s.source, fmt(s.sessions), fmt(s.prevSessions)]),
    ),
    paragraph("AIから来た人が最初に開いたページ"),
    table(["ページ", "セッション"], ga4.aiLandingPages.map((p) => [p.path, fmt(p.sessions)])),
    heading("見直しの候補（表示はあるが8〜30位の語句）"),
    paragraph(
      `表示回数${OPPORTUNITY_MIN_IMPRESSIONS}以上・平均順位${OPPORTUNITY_POSITION_MIN}〜${OPPORTUNITY_POSITION_MAX}位。記事リストの見直しとリライトの材料にする。`,
    ),
    table(
      ["語句", "表示回数", "クリック数", "平均順位"],
      gsc.opportunities.map((o) => [o.query, fmt(o.impressions), fmt(o.clicks), fmt1(o.position)]),
    ),
    heading("クリックが減ったページ"),
    table(
      ["ページ", "クリック数", "前の期間", "平均順位"],
      gsc.droppedPages.map((p) => [p.path, fmt(p.clicks), fmt(p.prevClicks), p.position ? fmt1(p.position) : "-"]),
    ),
    heading("クリックが多いページ"),
    table(
      ["ページ", "クリック数", "表示回数", "平均順位"],
      gsc.topPages.map((p) => [p.path, fmt(p.clicks), fmt(p.impressions), fmt1(p.position)]),
    ),
    heading("ツール別の利用"),
    table(["ページ", "回数"], ga4.toolPages.map((t) => [t.path, fmt(t.count)])),
    heading("メモ"),
    bullet("AI定点確認は、プロパティ「AI定点確認」に手で書く。"),
  ];
}

// Notionはテーブルを含むブロックの追加を1回100件までしか受け付けないので、分けて送る
async function appendBlocks(token, pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 50) {
    await notionRequest(token, "PATCH", `blocks/${pageId}/children`, { children: blocks.slice(i, i + 50) });
  }
}

// ------------------------------------------------------------
// 本体
// ------------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が設定されていません。`);
  return value;
}

async function main() {
  const saKey = requireEnv("GOOGLE_SA_KEY");
  const propertyId = requireEnv("GA4_PROPERTY_ID").replace(/^properties\//, "");
  const periods = buildPeriods();

  const { token, email } = await getGoogleAccessToken(saKey, [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/analytics.readonly",
  ]);
  const siteUrl = await resolveGscSite(token, email);
  console.log(`Search Console: ${siteUrl} / GA4: ${propertyId}`);
  console.log(`期間: ${periods.current.start}〜${periods.current.end}`);

  const [gsc, ga4] = await Promise.all([
    collectGsc(token, siteUrl, periods),
    collectGa4(token, propertyId, periods).catch((err) => {
      throw new Error(`${err.message}\nGA4の「プロパティのアクセス管理」に ${email} を「閲覧者」で追加してください。`);
    }),
  ]);
  // インデックスの状況は失敗してもレポート全体は止めない
  const index = await collectIndex(token, siteUrl).catch((err) => {
    console.warn(`インデックスの状況を取得できませんでした: ${err.message}`);
    return null;
  });
  const report = { periods, siteUrl, gsc, ga4, index };

  if (DRY_RUN) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const notionToken = requireEnv("NOTION_TOKEN");
  const databaseId = process.env.NOTION_ANALYTICS_DATABASE_ID || DEFAULT_ANALYTICS_DATABASE_ID;
  const dataSourceId = await resolveDataSourceId(notionToken, databaseId);

  const title = `${periods.current.end}までの28日`;
  const page = await notionRequest(notionToken, "POST", "pages", {
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: {
      週: { title: text(title) },
      期間: { date: { start: periods.current.start, end: periods.current.end } },
      表示回数: { number: Math.round(gsc.current.impressions) },
      クリック数: { number: Math.round(gsc.current.clicks) },
      平均順位: { number: Math.round(gsc.current.position * 10) / 10 },
      指名検索クリック: { number: Math.round(gsc.brandClicks) },
      AI経由セッション: { number: ga4.aiSessions.current },
      資料DL: { number: ga4.downloads.current },
      問い合わせ: { number: ga4.contacts.current },
      ツール利用: { number: ga4.toolUse.current },
      ...(index ? { インデックス済み記事: { number: index.indexed } } : {}),
    },
  });
  await appendBlocks(notionToken, page.id, buildBlocks(report));
  console.log(`Notionにレポートを作りました: ${page.url}`);
}

main().catch((err) => {
  console.error(err.message);
  if (/Could not find|object_not_found/i.test(err.message)) {
    console.error("Notionの「分析レポート」DBに、ビルドで使っているインテグレーションを接続してください（DB右上の「…」→「コネクト」）。");
  }
  process.exit(1);
});
