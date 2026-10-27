// Notion REST APIへの薄いラッパー。
// @notionhq/client のような公式SDKは使わず、素のfetchで直接呼んでいます。
// 理由: SDKのメジャーバージョンによってメソッド名や返り値の形が変わりやすく、
//       将来Notion側の仕様変更に追従しにくいため。エンドポイントとヘッダーだけ
//       合わせれば動く素のfetchのほうが、長期的にメンテしやすいと判断しました。

// 2026-08時点での最新版。データベースは「データソース」経由でのクエリが必須になった
// 2025-09-03以降のバージョンを使う必要があります（それより古いバージョンを指定すると
// 従来の /v1/databases/{id}/query が使えてしまいますが、将来的に廃止される可能性があります）。
import fs from "node:fs/promises";
import path from "node:path";

export const NOTION_API_VERSION = "2026-03-11";
const NOTION_API_BASE = "https://api.notion.com/v1";

class NotionApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "NotionApiError";
    this.status = status;
    this.body = body;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------
// 同時に投げるリクエスト数の上限（2026-10-27追加）
//
// 記事・タグ・資料の処理を並列化したため、Notionへのリクエストが一度に大量に飛ばないよう
// プロセス全体で同時実行数をここで絞る。Notion APIのレート制限は平均3リクエスト/秒
// （短いバーストは許容）なので3並列にしておき、それでも429が返った場合は下のリトライで待つ。
// ------------------------------------------------------------
const MAX_CONCURRENT_REQUESTS = 3;
let activeRequests = 0;
const waitingRequests = [];

async function acquireSlot() {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return;
  }
  await new Promise((resolve) => waitingRequests.push(resolve));
}

function releaseSlot() {
  const next = waitingRequests.shift();
  if (next) next(); // 枠をそのまま次の待ちに渡す（activeRequestsは変えない）
  else activeRequests--;
}

// ビルドログに出す集計用（何回Notionに問い合わせたか）
export const requestStats = { count: 0, rateLimited: 0 };

/**
 * Notion APIを叩く共通関数。429（レート制限）は自動リトライします。
 */
export async function notionRequest(token, method, path, body) {
  await acquireSlot();
  try {
    return await notionRequestUnlimited(token, method, path, body);
  } finally {
    releaseSlot();
  }
}

async function notionRequestUnlimited(token, method, path, body) {
  const url = `${NOTION_API_BASE}/${path}`;
  const maxRetries = 5;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    requestStats.count++;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      requestStats.rateLimited++;
      const retryAfter = Number(res.headers.get("retry-after")) || 1;
      console.warn(
        `  [notion] レート制限。${retryAfter}秒待って再試行します… (${attempt + 1}/${maxRetries})`,
      );
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status >= 500 && attempt < maxRetries) {
      const backoff = 2 ** attempt * 500;
      console.warn(`  [notion] サーバーエラー(${res.status})。${backoff}ms後に再試行します…`);
      await sleep(backoff);
      continue;
    }

    if (!res.ok) {
      let errBody = null;
      try {
        errBody = await res.json();
      } catch {
        // ignore
      }
      throw new NotionApiError(
        `Notion API error ${res.status} ${method} ${path}: ${errBody?.message || res.statusText}`,
        res.status,
        errBody,
      );
    }

    return res.json();
  }

  throw new NotionApiError(`Notion API: リトライ上限に達しました (${method} ${path})`, 0, null);
}

/**
 * データベースIDから、単一データソースのIDを取得する。
 * 2025-09-03以降のNotion APIでは、データベース本体ではなく
 * 「データソース」に対してクエリを投げる必要があるため必須の手順。
 */
export async function resolveDataSourceId(token, databaseId) {
  const db = await notionRequest(token, "GET", `databases/${databaseId}`);
  const dataSources = db.data_sources || [];
  if (dataSources.length === 0) {
    throw new Error(
      `データベース ${databaseId} にデータソースが見つかりません。データベースIDが正しいか確認してください。`,
    );
  }
  if (dataSources.length > 1) {
    console.warn(
      `  [notion] データベース ${databaseId} は複数のデータソースを持っています。最初のもの（${dataSources[0].name}）を使用します。`,
    );
  }
  return dataSources[0].id;
}

/**
 * データソース内の全ページを取得する（ページネーション込み）。
 * filter/sort に失敗した場合は呼び出し側でフォールバックできるよう、そのままthrowする。
 */
export async function queryAllPages(token, dataSourceId, { filter, sorts } = {}) {
  const pages = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;

    const res = await notionRequest(token, "POST", `data_sources/${dataSourceId}/query`, body);
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return pages;
}

/**
 * ブロックの子要素を再帰的にすべて取得する。
 * child_page / child_database はサブページへのリンクなので中身までは追わない。
 */
export async function fetchBlockChildrenRecursive(token, blockId, depth = 0) {
  if (depth > 12) {
    console.warn(`  [notion] ネストが深すぎるため打ち切ります (blockId=${blockId})`);
    return [];
  }

  const blocks = [];
  let cursor = undefined;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);
    const res = await notionRequest(token, "GET", `blocks/${blockId}/children?${qs.toString()}`);
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  // 子ブロック（トグル・表・入れ子の箇条書きなど）は並列に取りに行く（同時実行数はnotionRequest側で制御）。
  await Promise.all(
    blocks.map(async (block) => {
      const isTrashed = block.in_trash || block.archived;
      if (isTrashed) return;
      if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
        block._children = await fetchBlockChildrenRecursive(token, block.id, depth + 1);
      } else {
        block._children = [];
      }
    }),
  );

  return blocks.filter((b) => !(b.in_trash || b.archived));
}

// ------------------------------------------------------------
// リレーションプロパティの名前解決
//
// タグ・メインタグ・カテゴリ等が「マスタータグ」「マスターカテゴリ」のような
// 別データベースとのリレーションになっている場合、プロパティの値には
// 関連ページのID（relation配列）しか入っておらず、表示名（タイトル）が直接は取れない。
// そのため関連ページを個別に取得してタイトルを解決する。
//
// 同じページを何度も取得しないよう、プロセス内（1回のnpm run実行内）でキャッシュする。
// 万が一取得に失敗しても、記事・資料本体のビルドは止めたくないため、
// 失敗時は警告を出してnull/空配列にフォールバックする（例外を投げない）。
// ------------------------------------------------------------

const relationTitleCache = new Map();

function titleOfPage(page) {
  const titleProp = Object.values(page.properties || {}).find((p) => p.type === "title");
  return (titleProp?.title || []).map((t) => t.plain_text).join("").trim() || null;
}

// ------------------------------------------------------------
// リレーション先の名前の事前登録（2026-10-27追加）
//
// タグ・カテゴリ・執筆者などのマスターDBは、fetch-notion.mjs が一覧取得（queryAllPages）で
// 全ページ分のタイトルを既に受け取っている。それを先にキャッシュへ入れておけば、記事ごとに
// 関連ページを1件ずつ GET し直さずに済む（名前の変更も一覧取得の時点で反映されるので鮮度は同じ）。
// 後続の fetch-notion-resources / fetch-notion-tools は別プロセスなので、ファイル経由で受け渡す。
// ------------------------------------------------------------
const RELATION_TITLES_FILE = path.resolve(process.cwd(), ".notion-cache/meta/relation-titles.json");

/** queryAllPages の結果（ページの配列）を、ID → タイトルとして登録する。 */
export function primeRelationTitles(pages) {
  for (const page of pages || []) relationTitleCache.set(page.id, titleOfPage(page));
}

/** 今回のビルドで登録したリレーション名をファイルに書き出す（fetch-notion.mjs の最後に呼ぶ）。 */
export async function saveRelationTitles() {
  await fs.mkdir(path.dirname(RELATION_TITLES_FILE), { recursive: true });
  const entries = [...relationTitleCache].filter(([, title]) => title !== null);
  await fs.writeFile(
    RELATION_TITLES_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), titles: Object.fromEntries(entries) }),
  );
}

/**
 * fetch-notion.mjs が書き出したリレーション名を読み込む（resources / tools の最初に呼ぶ）。
 * 同じビルドの直前に書かれたものだけを信用する（古いファイルが残っていても使わない）。
 */
export async function loadRelationTitles(maxAgeMs = 60 * 60 * 1000) {
  try {
    const data = JSON.parse(await fs.readFile(RELATION_TITLES_FILE, "utf-8"));
    if (Date.now() - Date.parse(data.generatedAt) > maxAgeMs) return 0;
    const titles = Object.entries(data.titles || {});
    for (const [id, title] of titles) {
      if (!relationTitleCache.has(id)) relationTitleCache.set(id, title);
    }
    return titles.length;
  } catch {
    return 0;
  }
}

/**
 * ページIDからタイトルプロパティの文字列を取得する（リレーション先ページの名前解決用）。
 */
export async function getPageTitleById(token, pageId) {
  if (relationTitleCache.has(pageId)) return relationTitleCache.get(pageId);
  try {
    const page = await notionRequest(token, "GET", `pages/${pageId}`);
    const title = titleOfPage(page);
    relationTitleCache.set(pageId, title);
    return title;
  } catch (err) {
    console.warn(`  [notion] リレーション先ページ(${pageId})の名前取得に失敗しました: ${err.message}`);
    relationTitleCache.set(pageId, null);
    return null;
  }
}

/**
 * relation型プロパティの関連ページ名を配列で取得する（複数選択のタグ等を想定）。
 * プロパティが存在しない・relation型でない場合は空配列を返す。
 */
export async function getRelationNames(token, page, propertyName) {
  const prop = page.properties?.[propertyName];
  if (!prop || prop.type !== "relation") return [];
  const ids = (prop.relation || []).map((r) => r.id);
  const names = await Promise.all(ids.map((id) => getPageTitleById(token, id)));
  return names.filter((n) => !!n);
}

/**
 * relation型プロパティの先頭1件だけ名前を取得する（メインタグ・カテゴリ等、単一選択想定のものに使う）。
 */
export async function getFirstRelationName(token, page, propertyName) {
  const names = await getRelationNames(token, page, propertyName);
  return names[0] || null;
}

export { NotionApiError };
