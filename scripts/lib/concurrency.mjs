// 配列の要素を、同時に limit 件まで並列で処理する（2026-10-27追加）。
// 結果は元の配列と同じ順番で返す（記事の並び順などが変わらないように）。
// Notionへのリクエスト数そのものは notion-client.mjs 側でも絞っているので、
// ここでは画像のダウンロード・PDFの画像化・サムネイル生成なども含めた「ページ単位の作業」を並べる。
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 経過秒数（ビルドログ用） */
export function elapsedSeconds(startMs) {
  return ((Date.now() - startMs) / 1000).toFixed(1);
}
