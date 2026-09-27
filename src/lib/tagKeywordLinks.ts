// ブログ記事本文の「タグキーワード自動リンク」。
//
// 仕様:
// ・サイトに存在するタグ（＝タグページがあるタグ。getAllLibraryTagNames()）の名前が記事本文に出てきたら、
//   タグごとに「本文で最初に出てきた1箇所だけ」をそのタグページへのリンクにする。2回目以降はリンクしない。
// ・その記事に付いているタグだけでなく、サイト内の全タグが対象。
// ・リンク先は getTagPath()（マスタータグDBの英字Slugがあれば英字URL）。
// ・対象外: 見出し（H1〜H4）の文言、コードブロック、数式、すでにリンクが付いている文字列（Notion側の手動リンク・@メンション）。
//   見出しの下の子ブロック（トグル見出しの中身）や、表のセル・箇条書き・コールアウト・引用は対象。
// ・同じ位置で複数のタグが一致する場合は長いタグ名を優先（例:「STP分析」を「STP」より先に判定）。
// ・英数字だけのタグ（例: ROI）は、前後が英数字のときは一致とみなさない（「ROIC」の中の「ROI」にはリンクしない）。
//
// ビルド時（fetch-notion）ではなくページ描画時に処理するため、「公開後の編集中」でスナップショットを使っている記事や、
// タグの追加・Slug変更にもコード修正なしで追従する。元の post.blocks は変更しない（目次・FAQ構造化データはそのまま）。
import type { BlockNode, RichTextItem } from "./types";
import { getTagPath } from "./posts";
import { getAllLibraryTagNames } from "./library";
import { toRouteSlug } from "./routeSlug";

interface Term {
  name: string;
  path: string;
  /** 旧方式（fetch-notion時点の自動リンク）で付いていたhref。スナップショット記事の互換用。 */
  legacyPath: string;
  asciiStart: boolean;
  asciiEnd: boolean;
}

const SKIP_OWN_TEXT_TYPES = new Set(["heading_1", "heading_2", "heading_3", "heading_4", "code", "equation"]);
const ASCII_ALNUM = /[A-Za-z0-9]/;

function isAsciiAlnum(ch: string | undefined): boolean {
  return !!ch && ASCII_ALNUM.test(ch);
}

function buildTerms(): Term[] {
  return getAllLibraryTagNames()
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((name) => ({
      name,
      path: getTagPath(name),
      legacyPath: `/blog/tag/${encodeURIComponent(toRouteSlug(name))}`,
      asciiStart: isAsciiAlnum(name[0]),
      asciiEnd: isAsciiAlnum(name[name.length - 1]),
    }));
}

// text の from 以降で term が「単語として」出現する最初の位置を返す（無ければ -1）。
function findTerm(text: string, term: Term, from: number): number {
  let index = text.indexOf(term.name, from);
  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + term.name.length];
    const okStart = !term.asciiStart || !isAsciiAlnum(before);
    const okEnd = !term.asciiEnd || !isAsciiAlnum(after);
    if (okStart && okEnd) return index;
    index = text.indexOf(term.name, index + 1);
  }
  return -1;
}

function linkifyRichText(items: RichTextItem[] | undefined, terms: Term[], linked: Set<string>): RichTextItem[] | undefined {
  if (!items || items.length === 0) return items;

  const result: RichTextItem[] = [];
  for (const item of items) {
    if (!item.text) {
      result.push(item);
      continue;
    }

    if (item.href) {
      // 旧方式の自動リンク（日本語URL）が残っている場合は、そのタグの「最初の1箇所」として扱い、URLだけ新方式に直す。
      const legacy = terms.find((t) => item.href === t.legacyPath && item.text.trim() === t.name);
      if (legacy && !linked.has(legacy.name)) {
        linked.add(legacy.name);
        result.push({ ...item, href: legacy.path });
      } else {
        result.push(item);
      }
      continue;
    }

    const text = item.text;
    let cursor = 0;
    let changed = false;
    while (cursor < text.length) {
      let bestIndex = -1;
      let bestTerm: Term | null = null;
      for (const term of terms) {
        if (linked.has(term.name)) continue;
        const index = findTerm(text, term, cursor);
        if (index === -1) continue;
        // terms は長い順に並んでいるので、同じ位置なら先に見つかった（長い）方を採用する
        if (bestIndex === -1 || index < bestIndex) {
          bestIndex = index;
          bestTerm = term;
        }
      }
      if (bestIndex === -1 || !bestTerm) break;

      if (bestIndex > cursor) result.push({ ...item, text: text.slice(cursor, bestIndex) });
      result.push({ ...item, text: bestTerm.name, href: bestTerm.path });
      linked.add(bestTerm.name);
      cursor = bestIndex + bestTerm.name.length;
      changed = true;
    }

    if (!changed) {
      result.push(item);
    } else if (cursor < text.length) {
      result.push({ ...item, text: text.slice(cursor) });
    }
  }
  return result;
}

function linkifyBlocks(blocks: BlockNode[], terms: Term[], linked: Set<string>): BlockNode[] {
  return blocks.map((block) => {
    const next: BlockNode = { ...block };
    if (block.richText && !SKIP_OWN_TEXT_TYPES.has(block.type)) {
      next.richText = linkifyRichText(block.richText, terms, linked);
    }
    if (block.rows) {
      next.rows = block.rows.map((row) => ({
        cells: row.cells.map((cell) => linkifyRichText(cell, terms, linked) ?? cell),
      }));
    }
    if (block.children && block.children.length > 0) {
      next.children = linkifyBlocks(block.children, terms, linked);
    }
    return next;
  });
}

/**
 * 記事本文のブロック配列を受け取り、タグ名の初出1箇所ずつをタグページへのリンクにした新しい配列を返す。
 */
export function autoLinkTagKeywords(blocks: BlockNode[] | undefined): BlockNode[] {
  if (!blocks || blocks.length === 0) return blocks ?? [];
  const terms = buildTerms();
  if (terms.length === 0) return blocks;
  return linkifyBlocks(blocks, terms, new Set<string>());
}
