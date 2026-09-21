// タグページ本文の「似た用語との違い」「関連用語」セクションに出てくる用語名を、
// 同じ名前のタグページが存在すれば自動でリンクにする。
//
// 対象は、Notion本文中の見出し（H2）が「似た用語との違い」または「関連用語」であるセクションのみ
// （mktgax-tag-page-writerスキルが生成する解説エリアの固定見出し。記事本文中に同名の見出しがあっても
// 対象外）。セクションの範囲は、その見出しから次のH2見出し（または本文末尾）までとする。
//
// その範囲内にある表のセル・箇条書き・段落のテキストを走査し、実際にタグページが存在するタグ名が
// そのまま含まれていれば、その部分だけをリンク（RichTextItem.href）に差し替える。
// ・自分自身のタグ名（今表示しているページのタグ）はリンクしない。
// ・同じ用語は、1セクションにつき最初の1回だけリンクする（同じ表・箇条書きの中で何度も出てきても、
//   リンクだらけにならないようにするため）。「似た用語との違い」と「関連用語」の両方に出てきた場合は、
//   セクションごとに別々に判定するので、両方からリンクされる。
// ・すでにリンク（href）が設定されている文字列は対象外（Notion側で手動リンクした部分を上書きしない）。
import type { BlockNode, RichTextItem } from "./types";
import { getTagPath } from "./posts";
import { getAllLibraryTagNames } from "./library";

const TARGET_HEADINGS = ["似た用語との違い", "関連用語"];

interface Term {
  name: string;
  path: string;
}

function headingText(block: BlockNode): string {
  return (block.richText || []).map((r) => r.text).join("").trim();
}

// 1つのRichTextItem配列の中から用語名を探し、見つかった部分だけをリンク付きの別要素に分割する。
function linkifyRichText(
  items: RichTextItem[] | undefined,
  terms: Term[],
  linkedInSection: Set<string>,
): RichTextItem[] | undefined {
  if (!items || items.length === 0) return items;

  const result: RichTextItem[] = [];
  for (const item of items) {
    if (item.href || !item.text) {
      result.push(item);
      continue;
    }

    let remaining = item.text;
    let changed = false;
    while (remaining.length > 0) {
      // 現在位置から最も手前にマッチする用語を探す（同じ位置なら、より長い用語名を優先）
      let bestIndex = -1;
      let bestTerm: Term | null = null;
      for (const term of terms) {
        if (linkedInSection.has(term.name)) continue;
        const index = remaining.indexOf(term.name);
        if (index === -1) continue;
        if (
          bestIndex === -1 ||
          index < bestIndex ||
          (index === bestIndex && term.name.length > (bestTerm?.name.length ?? 0))
        ) {
          bestIndex = index;
          bestTerm = term;
        }
      }
      if (bestIndex === -1 || !bestTerm) break;

      if (bestIndex > 0) {
        result.push({ ...item, text: remaining.slice(0, bestIndex) });
      }
      result.push({ ...item, text: bestTerm.name, href: bestTerm.path });
      linkedInSection.add(bestTerm.name);
      remaining = remaining.slice(bestIndex + bestTerm.name.length);
      changed = true;
    }

    if (changed) {
      if (remaining.length > 0) result.push({ ...item, text: remaining });
    } else {
      result.push(item);
    }
  }
  return result;
}

// ブロック（表・箇条書き・段落など）を再帰的に処理し、見つかったテキストにリンクを差し込む。
function linkifySection(blocks: BlockNode[], terms: Term[], linkedInSection: Set<string>): BlockNode[] {
  return blocks.map((block) => {
    const next: BlockNode = { ...block };
    if (block.richText) {
      next.richText = linkifyRichText(block.richText, terms, linkedInSection);
    }
    if (block.rows) {
      next.rows = block.rows.map((row) => ({
        cells: row.cells.map((cell) => linkifyRichText(cell, terms, linkedInSection) ?? cell),
      }));
    }
    if (block.children && block.children.length > 0) {
      next.children = linkifySection(block.children, terms, linkedInSection);
    }
    return next;
  });
}

/**
 * タグページ本文のブロック配列を受け取り、「似た用語との違い」「関連用語」セクション内の
 * 用語名を自動でリンク化したブロック配列を返す（元の配列・ブロックは変更しない）。
 * currentTagName には表示中のページ自身のタグ名を渡す（自分自身へはリンクしない）。
 */
export function autoLinkRelatedTerms(blocks: BlockNode[] | undefined, currentTagName: string | null): BlockNode[] {
  if (!blocks || blocks.length === 0) return blocks ?? [];

  const terms = getAllLibraryTagNames()
    .filter((name) => name !== currentTagName)
    // 長い用語名を優先してマッチさせる（例:「STP分析」を「STP」より先に判定する）
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ name, path: getTagPath(name) }));
  if (terms.length === 0) return blocks;

  const result: BlockNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    result.push(block);
    if (block.type === "heading_2" && TARGET_HEADINGS.includes(headingText(block))) {
      const linkedInSection = new Set<string>();
      let j = i + 1;
      while (j < blocks.length && blocks[j].type !== "heading_2") {
        result.push(...linkifySection([blocks[j]], terms, linkedInSection));
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return result;
}
