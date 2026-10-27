// ページ本文（Notionのブロック）のキャッシュ（2026-10-27追加）
//
// これまでは、コードを1行直しただけのデプロイでも、全記事・全タグ・全カテゴリ・全資料の本文を
// Notionから1件ずつ取り直していた（入れ子のブロックごとにもリクエストが発生するため、
// ビルド時間の大半がここだった）。
//
// そこで、前回取得した本文（Notion APIの生のブロック）を .notion-cache/blocks/<ページID>.json に
// 保存しておき、ページの「最終更新日時」（last_edited_time）が前回と同じなら取り直さずに使い回す。
// 変換（transformBlocks）は毎回やり直すので、記事間リンクのURLやサイト側の表示ロジックの変更は
// これまでどおり毎回反映される。キャッシュするのは「Notionから受け取った中身」だけ。
//
// 安全のための決まりごと:
//  1. Notionの最終更新日時は分単位で丸められる。同じ1分の中で取得と編集が重なると見逃すので、
//     「取得したのが最終更新から2分以上あと」の場合だけ使い回す。
//  2. 画像は署名付きURLの期限が切れているため、ダウンロード済みのファイルが残っている場合だけ
//     使い回す。1枚でも見つからなければ、そのページはNotionから取り直す。
//  3. 他ページのタイトル変更（@メンションの表示名）などは最終更新日時に出ないため、
//     キャッシュは約1日（20〜28時間、ページごとにずらす）で期限切れにして取り直す。
//  4. 環境変数 NOTION_FULL_REFRESH=1 のときはキャッシュを使わず、全ページを取り直す
//     （GitHub Actionsの手動実行で「全部取り直す」を選んだとき）。
//
// 保存先の .notion-cache/blocks/ は、GitHub Actionsのキャッシュでビルドをまたいで持ち越す
// （.github/workflows/deploy.yml。画像フォルダと同じキャッシュに入れているので、
//   画像だけ消えて本文キャッシュが残る、という食い違いは起きない）。

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fetchBlockChildrenRecursive } from "./notion-client.mjs";
import { seedImageDownload, IMAGE_OUT_DIR } from "./transform.mjs";

const BLOCK_CACHE_DIR = path.resolve(process.cwd(), ".notion-cache/blocks");
const MIN_GAP_AFTER_EDIT_MS = 2 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// これより長く使われていないキャッシュファイル（削除・非公開になったページ）は掃除する
const STALE_FILE_MS = 4 * 24 * HOUR_MS;

const FULL_REFRESH = ["1", "true"].includes(String(process.env.NOTION_FULL_REFRESH || "").toLowerCase());

export const blockCacheStats = { hit: 0, miss: 0, reasons: {} };

function countMiss(reason) {
  blockCacheStats.miss++;
  blockCacheStats.reasons[reason] = (blockCacheStats.reasons[reason] || 0) + 1;
}

/** ページごとに20〜28時間の有効期限（同じタイミングで一斉に期限切れにならないようにずらす） */
function ttlFor(pageId) {
  const n = crypto.createHash("sha1").update(pageId).digest().readUInt8(0);
  return (20 + (n % 9)) * HOUR_MS;
}

let localImagesPromise = null;
/** public/images/notion/ にあるファイル名を「拡張子なしの名前 → ファイル名」で引けるようにする */
function localImages() {
  if (!localImagesPromise) {
    localImagesPromise = fs
      .readdir(IMAGE_OUT_DIR)
      .then((names) => {
        const map = new Map();
        for (const name of names) map.set(name.replace(/\.[^.]+$/, ""), name);
        return map;
      })
      .catch(() => new Map());
  }
  return localImagesPromise;
}

/**
 * キャッシュした本文の画像が、すべてダウンロード済みのファイルとして残っているかを確認する。
 * 残っていれば「URL → ローカルパス」を登録して true を返す（transformBlocksが再ダウンロードしなくなる）。
 * idHint は transformBlocks に渡すものと同じ値（ページID）。
 */
async function seedCachedImages(blocks, idHint) {
  const files = await localImages();
  const seeds = [];
  let ok = true;

  const walk = (list) => {
    for (const block of list || []) {
      if (block.type === "image") {
        const img = block.image || {};
        const url = img.type === "external" ? img.external?.url : img.file?.url;
        const filename = files.get(`${idHint}-${block.id}`);
        if (filename) seeds.push([url, `/images/notion/${filename}`]);
        // 外部URLの画像は期限切れにならないので、ファイルが無くてもダウンロードし直せばよい
        else if (img.type !== "external") ok = false;
      }
      walk(block._children);
    }
  };
  walk(blocks);

  if (!ok) return false;
  for (const [url, publicPath] of seeds) seedImageDownload(url, publicPath);
  return true;
}

/**
 * ページ本文（ブロック）を取得する。最終更新日時が前回と同じならキャッシュを使い回す。
 * fetchBlockChildrenRecursive(token, page.id) の置き換えとして使う（戻り値の形は同じ）。
 *
 * @param {string} token
 * @param {object} page queryAllPages で取得したページ（id と last_edited_time を使う）
 */
export async function fetchPageBlocksCached(token, page) {
  const file = path.join(BLOCK_CACHE_DIR, `${page.id}.json`);

  if (FULL_REFRESH) {
    countMiss("全部取り直す指定");
  } else {
    let cached = null;
    try {
      cached = JSON.parse(await fs.readFile(file, "utf-8"));
    } catch {
      countMiss("初回");
    }
    if (cached) {
      const edited = Date.parse(page.last_edited_time);
      if (cached.lastEditedTime !== page.last_edited_time) {
        countMiss("更新あり");
      } else if (!(cached.fetchedAt - edited >= MIN_GAP_AFTER_EDIT_MS)) {
        countMiss("更新直後に取得");
      } else if (Date.now() - cached.fetchedAt > ttlFor(page.id)) {
        countMiss("期限切れ");
      } else if (!(await seedCachedImages(cached.blocks, page.id))) {
        countMiss("画像ファイルなし");
      } else {
        blockCacheStats.hit++;
        // 使ったことを記録（掃除の対象から外す）
        const now = new Date();
        await fs.utimes(file, now, now).catch(() => {});
        return cached.blocks;
      }
    }
  }

  // 取得を始めた時刻を記録する（取得中に編集された場合でも、次回は「更新あり」として取り直される）
  const fetchedAt = Date.now();
  const blocks = await fetchBlockChildrenRecursive(token, page.id);
  await fs.mkdir(BLOCK_CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ lastEditedTime: page.last_edited_time, fetchedAt, blocks }));
  return blocks;
}

/** 何日も使われていないキャッシュファイル（削除・非公開になったページの分）を消す */
export async function pruneStaleBlockCache() {
  let names = [];
  try {
    names = await fs.readdir(BLOCK_CACHE_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    names.map(async (name) => {
      const full = path.join(BLOCK_CACHE_DIR, name);
      try {
        const { mtimeMs } = await fs.stat(full);
        if (now - mtimeMs > STALE_FILE_MS) await fs.unlink(full);
      } catch {
        // 掃除の失敗でビルドは止めない
      }
    }),
  );
}

/** ビルドログ用の1行サマリー */
export function blockCacheSummary() {
  const { hit, miss, reasons } = blockCacheStats;
  const detail = Object.entries(reasons)
    .map(([k, v]) => `${k}${v}`)
    .join("・");
  return `本文キャッシュ: 使い回し${hit}件 / Notionから取得${miss}件${detail ? `（${detail}）` : ""}`;
}
