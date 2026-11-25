// カテゴリごとのミーアキャット（2026-10-29）。カテゴリページとサービスページで共通に使う。
// カテゴリ名の語で決める（2026-11-25：4カテゴリに作り直し）。
const MEERKATS: [string, string][] = [
  ["戦略", "/images/meerkat/standing.svg"],
  ["リード獲得", "/images/meerkat/circle.svg"],
  ["ナーチャリング", "/images/meerkat/parent-child.svg"],
  ["分析", "/images/meerkat/in-flask.svg"],
];

/** カテゴリのミーアキャット画像のパス。該当がなければnull */
export function getCategoryMeerkat(categoryName: string): string | null {
  return MEERKATS.find(([word]) => categoryName.includes(word))?.[1] ?? null;
}

/** ミーアキャット画像の全種類（重複なし） */
export const ALL_MEERKATS: string[] = MEERKATS.map(([, src]) => src);
