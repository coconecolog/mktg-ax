// ツールDB（Notion）のデータ層。.notion-cache/tools.json（scripts/fetch-notion-tools.mjs が生成）を読む。
// ツールDBが未設定・取得失敗・0件のときは、下の FALLBACK_TOOLS（従来の5ツール）で表示を続ける。
// ↑ DB運用が安定したら FALLBACK_TOOLS は削除して構わない（その場合 getAllTools() は空配列を返す）。
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolsCache } from "./types";
import { getAllCategories } from "./posts";

const CACHE_PATH = path.resolve(process.cwd(), ".notion-cache/tools.json");

export const DEFAULT_TOOL_ICON = "/images/tool-icons/icon-default.svg";

function loadCache(): ToolsCache {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as ToolsCache;
    const tools = (parsed.tools || []).map((t) => ({
      ...t,
      shortDescription: t.shortDescription || "",
      categories: t.categories || (t.category ? [t.category] : []),
      tags: t.tags || (t.tag ? [t.tag] : []),
    }));
    return { ...parsed, tools };
  } catch {
    return { generatedAt: new Date().toISOString(), tools: [] };
  }
}

const cache = loadCache();

function fallback(
  slug: string,
  title: string,
  shortDescription: string,
  description: string,
  ctaLabel: string,
  duration: string,
  tag: string,
  icon: string | null,
): Tool {
  return {
    id: `fallback-${slug}`,
    slug,
    href: `/tools/${slug}`,
    title,
    description,
    shortDescription,
    ctaLabel,
    duration,
    icon,
    category: null,
    categories: [],
    tag,
    tags: [tag],
    order: null,
  };
}

const FALLBACK_TOOLS: Tool[] = [
  fallback(
    "budget-simulator",
    "マーケティング予算策定・投資計画書",
    "来期の予算計画書を自動作成",
    "今期実績と来期施策（人件費・ツール費・広告費等）を入力するだけで、逆算パイプライン・費用内訳・ROI試算まで含めた役員提出用の予算計画書を自動作成します。",
    "計画書を作成する →",
    "所要3分",
    "予算・投資計画",
    "/images/tool-icons/icon-budget-simulator.svg",
  ),
  fallback(
    "kpi-benchmark",
    "広告宣伝費 業界ベンチマーク診断",
    "同業種と広告宣伝費を比較して診断",
    "業種・年間売上高・年間広告宣伝費を入力するだけで、同業種の実データと比べて広告宣伝費が多いか少ないかを診断します。予算の逆算にも対応。",
    "診断を開始 →",
    "所要1分",
    "広告宣伝費・予算診断",
    null,
  ),
  fallback(
    "roas-cac-simulator",
    "広告費用対効果（ROAS/CAC）シミュレーター",
    "LTV/CAC比率と投資回収期間を診断",
    "月額単価・粗利率・解約率・獲得単価（CAC）を入力するだけで、LTV/CAC比率と投資回収期間（Payback）を診断します。",
    "シミュレーションを開始 →",
    "所要1分",
    "広告運用・収益化",
    "/images/tool-icons/icon-roas-cac-simulator.svg",
  ),
  fallback(
    "seo-aeo-aio-check",
    "簡易SEO・AEO・AIO診断チェックリスト",
    "AI検索時代の対応状況を簡易診断",
    "全15項目のチェックだけで、従来のSEOに加えてAEO（AI検索最適化）・AIO/GEO（生成AI最適化）への対応状況を簡易診断します。",
    "診断をチェックする →",
    "所要2分",
    "SEO・生成AI",
    "/images/tool-icons/icon-seo-aeo-aio-check.svg",
  ),
  fallback(
    "inhouse-vs-outsource",
    "内製 vs 外注 コスト比較シミュレーター",
    "採用と外注、コストで比較する",
    "マーケティング担当者を採用するか、外注に任せるか。月次・年間コストを試算して比較します。",
    "コスト比較を開始 →",
    "所要2分",
    "組織・コスト",
    "/images/tool-icons/icon-inhouse-vs-outsource.svg",
  ),
];

/** 「並び順」昇順の全ツール。DBが空のときは組み込みの初期ツール一覧。 */
export function getAllTools(): Tool[] {
  return cache.tools.length > 0 ? [...cache.tools] : FALLBACK_TOOLS;
}

/** NotionページIDからツールを引く（記事の「CTAツール」リレーション用。DBに無い／非公開なら undefined）。 */
export function getToolById(id: string): Tool | undefined {
  return cache.tools.find((t) => t.id === id);
}

/** 指定カテゴリに属するツール（複数カテゴリのいずれかが一致すれば対象）。 */
export function getToolsByCategory(name: string): Tool[] {
  return getAllTools().filter((t) => t.categories.includes(name));
}

/** ツールが1件以上あるカテゴリ名（マスターカテゴリDBの並び順に従う）。ツール一覧のフィルター用。 */
export function getToolCategories(): string[] {
  const used = new Set<string>();
  for (const t of getAllTools()) for (const c of t.categories) used.add(c);
  const ordered = getAllCategories()
    .map((c) => c.name)
    .filter((n) => used.has(n));
  for (const n of used) if (!ordered.includes(n)) ordered.push(n);
  return ordered;
}

function shorten(text: string, max = 32): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export interface ToolNavItem {
  href: string;
  icon: string;
  label: string;
  description: string;
}

/** ヘッダーのプルダウン・フッター・トップページ用。「短い説明」があればそれを、無ければ説明文の冒頭を使う。 */
export function getToolNavItems(): ToolNavItem[] {
  return getAllTools().map((t) => ({
    href: t.href,
    icon: t.icon || DEFAULT_TOOL_ICON,
    label: t.title,
    description: t.shortDescription || shorten(t.description),
  }));
}
