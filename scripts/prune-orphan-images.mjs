// scripts/prune-orphan-images.mjs
//
// public/images/notion/ と public/images/generated/ のうち、
// .notion-cache/*.json のどこからも参照されていないファイルを削除する。
//
// 背景: この2つのディレクトリは GitHub Actions の actions/cache（notion-build-assets-）で
// ビルドをまたいで持ち越されるため、Notion側でブロックを消しても古い画像ファイルが
// キャッシュに残り続け、Cloudflare Pages に毎回アップロードされてURLで見えてしまう。
//
// 実行位置: fetch-notion / fetch-notion-resources の後、astro build の前。
// 安全策: 参照が1件も見つからない（キャッシュ生成に失敗した等）場合は何も消さない。

import { readdir, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, ".notion-cache");
const TARGET_DIRS = ["notion", "generated"]; // public/images/ 配下
const REF_RE = /\/images\/(notion|generated)\/([^"'\s)?#\\]+)/g;

async function listFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

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

async function main() {
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
    const dir = path.join(ROOT, "public", "images", sub);
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

main().catch((err) => {
  // 掃除の失敗でデプロイを止めない
  console.warn("[prune-orphan-images] エラーのため削除を中断しました:", err);
});
