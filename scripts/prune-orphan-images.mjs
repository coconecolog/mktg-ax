// scripts/prune-orphan-images.mjs
//
// 1) 極小画像ブロックの除去
//    Notion本文に紛れ込んだアイコン画像（Googleドキュメント等から貼り付けた際に入る
//    Googleドライブのアイコン等、64×64px程度）は、サイトでは本文幅いっぱいに拡大され
//    ぼやけた巨大ロゴになる。縦横どちらも MAX_ICON_SIDE px 以下の画像ブロックを
//    .notion-cache/*.json から取り除く。
//
// 2) 未参照画像の削除
//    public/images/notion/ と public/images/generated/ のうち、
//    .notion-cache/*.json のどこからも参照されていないファイルを削除する。
//    （この2つは actions/cache でビルドをまたいで持ち越されるため、放っておくと
//     Notion側で消した画像も本番にアップロードされ続ける）
//
// 実行位置: fetch-notion / fetch-notion-resources / fetch-notion-tools の後、astro build の前。
// 安全策: 参照が1件も見つからない場合は何も消さない。エラーでもビルドは止めない。

import { readdir, readFile, writeFile, unlink, stat, open } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, ".notion-cache");
const PUBLIC_DIR = path.join(ROOT, "public");
const TARGET_DIRS = ["notion", "generated"]; // public/images/ 配下
const REF_RE = /\/images\/(notion|generated)\/([^"'\s)?#\\]+)/g;
const MAX_ICON_SIDE = 96; // これ以下（縦横とも）の画像ブロックはアイコンとみなして除去

async function listFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

// ---------- 画像サイズの読み取り（PNG / GIF / JPEG / WebP。依存ライブラリなし） ----------

async function readHead(file, bytes = 256 * 1024) {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function imageSize(buf) {
  if (buf.length < 24) return null;
  // PNG
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.toString("ascii", 0, 3) === "GIF") {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  // WebP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const sizeCache = new Map();
async function isTinyLocalImage(src) {
  if (typeof src !== "string" || !src.startsWith("/images/notion/")) return false;
  if (sizeCache.has(src)) return sizeCache.get(src);
  let tiny = false;
  try {
    const file = path.join(PUBLIC_DIR, decodeURIComponent(src.split(/[?#]/)[0]));
    const size = imageSize(await readHead(file));
    tiny = !!size && size.w <= MAX_ICON_SIDE && size.h <= MAX_ICON_SIDE;
  } catch {
    tiny = false;
  }
  sizeCache.set(src, tiny);
  return tiny;
}

// ---------- 1) 極小画像ブロックの除去 ----------

async function stripTinyImages(node, removed) {
  if (Array.isArray(node)) {
    const kept = [];
    for (const item of node) {
      if (item && typeof item === "object" && item.type === "image" && (await isTinyLocalImage(item.src))) {
        removed.push(`${item.id ?? "(id不明)"} ${item.src}`);
        continue;
      }
      kept.push(await stripTinyImages(item, removed));
    }
    return kept;
  }
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      node[key] = await stripTinyImages(node[key], removed);
    }
  }
  return node;
}

async function removeTinyImageBlocks() {
  const jsonFiles = (await listFiles(CACHE_DIR)).filter((f) => f.endsWith(".json"));
  for (const f of jsonFiles) {
    const full = path.join(CACHE_DIR, f);
    let data;
    try {
      data = JSON.parse(await readFile(full, "utf8"));
    } catch {
      continue;
    }
    const removed = [];
    const next = await stripTinyImages(data, removed);
    if (removed.length > 0) {
      await writeFile(full, JSON.stringify(next, null, 2));
      for (const r of removed) console.log(`[prune-orphan-images] 極小画像ブロックを除去: ${f} ${r}`);
    }
  }
}

// ---------- 2) 未参照画像の削除 ----------

async function collectReferences() {
  const refs = new Set();
  const jsonFiles = (await listFiles(CACHE_DIR)).filter((f) => f.endsWith(".json"));
  for (const f of jsonFiles) {
    const text = await readFile(path.join(CACHE_DIR, f), "utf8");
    for (const m of text.matchAll(REF_RE)) {
      let name = m[2];
      try {
        name = decodeURIComponent(name);
      } catch {
        /* そのまま使う */
      }
      refs.add(`${m[1]}/${name}`);
    }
  }
  return { refs, jsonCount: jsonFiles.length };
}

async function pruneOrphans() {
  const { refs, jsonCount } = await collectReferences();
  if (jsonCount === 0 || refs.size === 0) {
    console.warn(
      `[prune-orphan-images] 参照が見つからないため削除をスキップします（json: ${jsonCount}件, 参照: ${refs.size}件）`
    );
    return;
  }

  let removed = 0;
  let kept = 0;
  for (const sub of TARGET_DIRS) {
    const dir = path.join(PUBLIC_DIR, "images", sub);
    for (const name of await listFiles(dir)) {
      if (name.startsWith(".")) continue; // .gitkeep 等は残す
      if (refs.has(`${sub}/${name}`)) {
        kept++;
        continue;
      }
      const full = path.join(dir, name);
      const { size } = await stat(full);
      await unlink(full);
      removed++;
      console.log(`[prune-orphan-images] 削除: /images/${sub}/${name} (${size} bytes)`);
    }
  }
  console.log(`[prune-orphan-images] 完了: 削除 ${removed}件 / 保持 ${kept}件（参照 ${refs.size}件）`);
}

async function main() {
  try {
    await removeTinyImageBlocks();
  } catch (err) {
    console.warn("[prune-orphan-images] 極小画像ブロックの除去でエラー（続行します）:", err);
  }
  await pruneOrphans();
}

main().catch((err) => {
  // 掃除の失敗でデプロイを止めない
  console.warn("[prune-orphan-images] エラーのため削除を中断しました:", err);
});
