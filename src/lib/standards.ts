// 「数字の基準」（/standards）のページを、src/content/standards/*.md の原稿から組み立てる。
// 原稿の正本はGoogleドライブ。原稿を差しかえるときは、mdファイルを上書きするだけでよい。
//
// 原稿の決まり（公開ページの構成（数字の基準）7. による）
// - 冒頭の --- で囲んだ部分（title・url・description・last_updated）は、ページのタイトル・URL・説明文・更新日に使い、本文には出さない
// - 見出しの末尾の {#〇〇} は、その見出しのアンカー（id）にする。アンカーは変えない
// - <!-- --> のコメント（TODO）は、公開ページのHTMLに出さない
// - 式（``` で囲んだ部分）は文字のまま、表はHTMLの表で組む
//
// 対応している書き方は、原稿で使っているものだけ（見出し・段落・太字・リンク・箇条書き・番号付きリスト・表・式・引用）。
import { SITE_NAME, SITE_URL } from "@/consts";
import type { TocItem } from "@/lib/types";

const RAW_FILES = import.meta.glob("/src/content/standards/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface StandardTerm {
  name: string;
  anchor: string;
  description: string;
}

export interface StandardPage {
  slug: string; // 例: metrics
  path: string; // 例: /standards/metrics
  title: string;
  description: string;
  lastUpdated: string; // YYYY-MM-DD
  datePublished: string; // 更新履歴の「公開」の日付（なければ lastUpdated）
  introHtml: string; // 最初のH2より前（H1を除く）
  bodyHtml: string; // 最初のH2から最後まで
  h1: string;
  toc: TocItem[];
  terms: StandardTerm[]; // 「判定の指標」（#indicators）の下のH3。DefinedTerm に使う
}

// 一覧（/standards）と llms.txt に並べる順番
const PAGE_ORDER = ["metrics", "model"];

// ---------- frontmatter ----------
function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { data, body: text.slice(m[0].length) };
}

// ---------- inline ----------
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => `<a href="${href}">${text}</a>`);
  return out;
}

function plainText(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

// ---------- table ----------
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

// 数値のセル（右寄せにする）。例: 1,280 / 12.8 / −6% / 12件 / 12.8か月 / ―
const NUMERIC_CELL = /^([−-]?[\d,]+(\.\d+)?(%|件|か月)?|―)$/;

function renderTable(lines: string[], caption: string | null): string {
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow);
  const thead = `<thead><tr>${header.map((h) => `<th scope="col">${inline(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map((r) => {
      const cells = header.map((_, i) => r[i] ?? "");
      return `<tr>${cells
        .map((c, i) => {
          if (i === 0) return `<th scope="row">${inline(c)}</th>`;
          return `<td${NUMERIC_CELL.test(c) ? ' class="num"' : ""}>${inline(c)}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("")}</tbody>`;
  const cap = caption ? `<caption>${inline(caption)}</caption>` : "";
  return `<div class="table-wrap"><table>${cap}${thead}${tbody}</table></div>`;
}

// ---------- block ----------
interface ParsedBody {
  h1: string;
  introHtml: string;
  bodyHtml: string;
  toc: TocItem[];
  terms: StandardTerm[];
}

function parseBody(md: string): ParsedBody {
  // コメント（<!-- TODO -->など）は出力しない
  const lines = md.replace(/<!--[\s\S]*?-->/g, "").split("\n");

  const out: string[] = [];
  let h1 = "";
  let introEnd = -1; // out の中で最初のH2が入る位置
  const toc: TocItem[] = [];
  const terms: StandardTerm[] = [];
  let currentH2Anchor = "";
  let pendingTerm: { name: string; anchor: string } | null = null;
  let pendingCaption: string | null = null;

  const flushCaption = () => {
    if (pendingCaption !== null) {
      out.push(`<p><strong>${inline(pendingCaption)}</strong></p>`);
      pendingCaption = null;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    // 式（コードブロック）
    if (trimmed.startsWith("```")) {
      flushCaption();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++; // 閉じの ```
      out.push(`<pre class="formula"><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // 見出し
    const hm = trimmed.match(/^(#{1,4})\s+(.+?)\s*(?:\{#([A-Za-z0-9_-]+)\})?\s*$/);
    if (hm) {
      flushCaption();
      const level = hm[1].length;
      const text = hm[2];
      const anchor = hm[3];
      if (level === 1) {
        h1 = plainText(text);
      } else {
        if (level === 2 && introEnd < 0) introEnd = out.length;
        out.push(`<h${level}${anchor ? ` id="${anchor}"` : ""}>${inline(text)}</h${level}>`);
        if (anchor && level === 2) {
          toc.push({ anchor, text: plainText(text), level, children: [] });
          currentH2Anchor = anchor;
        } else if (anchor && level === 3 && toc.length > 0) {
          toc[toc.length - 1].children.push({ anchor, text: plainText(text), level, children: [] });
        }
        pendingTerm = level === 3 && anchor && currentH2Anchor === "indicators" ? { name: plainText(text), anchor } : null;
        if (level === 2) pendingTerm = null;
      }
      i++;
      continue;
    }

    // 表
    if (trimmed.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) buf.push(lines[i++]);
      out.push(renderTable(buf, pendingCaption));
      pendingCaption = null;
      continue;
    }

    // 箇条書き・番号付きリスト
    const ulm = trimmed.match(/^[-*]\s+(.*)$/);
    const olm = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ulm || olm) {
      flushCaption();
      const tag = ulm ? "ul" : "ol";
      const re = ulm ? /^[-*]\s+(.*)$/ : /^\d+\.\s+(.*)$/;
      const items: string[] = [];
      while (i < lines.length) {
        const mm = lines[i].trim().match(re);
        if (!mm) break;
        items.push(`<li>${inline(mm[1])}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    // 引用
    if (trimmed.startsWith(">")) {
      flushCaption();
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) buf.push(lines[i++].trim().replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${inline(buf.join(""))}</p></blockquote>`);
      continue;
    }

    // 段落（次の空行・ブロックの始まりまで）
    flushCaption();
    const buf: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === "" || t.startsWith("```") || /^#{1,4}\s/.test(t) || t.startsWith("|") || /^[-*]\s/.test(t) || /^\d+\.\s/.test(t) || t.startsWith(">")) break;
      buf.push(t);
      i++;
    }
    const para = buf.join("");
    // 「**表1 …**」だけの段落の直後に表が来るときは、表のタイトル（caption）にする
    const cap = para.match(/^\*\*(表\d+[^*]*)\*\*$/);
    let k = i;
    while (k < lines.length && lines[k].trim() === "") k++;
    if (cap && k < lines.length && lines[k].trim().startsWith("|")) {
      pendingCaption = cap[1];
      continue;
    }
    out.push(`<p>${inline(para)}</p>`);
    if (pendingTerm) {
      terms.push({ ...pendingTerm, description: plainText(para) });
      pendingTerm = null;
    }
  }
  flushCaption();

  const split = introEnd < 0 ? out.length : introEnd;
  return {
    h1,
    introHtml: out.slice(0, split).join("\n"),
    bodyHtml: out.slice(split).join("\n"),
    toc,
    terms,
  };
}

// ---------- pages ----------
function buildPage(raw: string, file: string): StandardPage {
  const { data, body } = parseFrontmatter(raw);
  const required = ["title", "url", "description", "last_updated"];
  for (const key of required) {
    if (!data[key]) throw new Error(`[standards] ${file} の冒頭に ${key} がありません`);
  }
  const path = new URL(data.url).pathname.replace(/\/+$/, "");
  const m = path.match(/^\/standards\/([a-z0-9-]+)$/);
  if (!m) throw new Error(`[standards] ${file} の url は /standards/〇〇 にしてください（今: ${data.url}）`);
  const parsed = parseBody(body);
  const published = body.match(/\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*公開\s*\|/);
  return {
    slug: m[1],
    path,
    title: data.title,
    description: data.description,
    lastUpdated: data.last_updated,
    datePublished: published ? published[1] : data.last_updated,
    ...parsed,
    h1: parsed.h1 || data.title,
  };
}

let cache: StandardPage[] | null = null;

export function getStandardPages(): StandardPage[] {
  if (cache) return cache;
  const pages = Object.entries(RAW_FILES).map(([file, raw]) => buildPage(raw, file));
  pages.sort((a, b) => {
    const ia = PAGE_ORDER.indexOf(a.slug);
    const ib = PAGE_ORDER.indexOf(b.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  cache = pages;
  return pages;
}

// ---------- 構造化データ ----------
const iso = (d: string) => `${d}T00:00:00+09:00`;

const author = { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: SITE_NAME, url: SITE_URL };

// 数字の定義ページ：DefinedTermSet（各指標を DefinedTerm にし、url はアンカー付き）
export function buildDefinedTermSetSchema(page: StandardPage) {
  const url = new URL(page.path, SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": `${url}#termset`,
    name: page.title,
    description: page.description,
    url,
    inLanguage: "ja",
    datePublished: iso(page.datePublished),
    dateModified: iso(page.lastUpdated),
    author,
    publisher: author,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    hasDefinedTerm: page.terms.map((t) => ({
      "@type": "DefinedTerm",
      "@id": `${url}#${t.anchor}`,
      name: t.name,
      description: t.description,
      url: `${url}#${t.anchor}`,
      inDefinedTermSet: { "@id": `${url}#termset` },
    })),
  };
}

// 基本モデルページ：Article
export function buildStandardArticleSchema(page: StandardPage) {
  const url = new URL(page.path, SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.description,
    url,
    inLanguage: "ja",
    datePublished: iso(page.datePublished),
    dateModified: iso(page.lastUpdated),
    author,
    publisher: author,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}
