---
// 「数字の基準」ページの表。1列目は行の見出し。
// title：表の上に出す表題（「表3 …」）。strongCols：太字にする列（0始まり）。total：最後の行を合計行（太字）にする。
// size：sm で文字を14pxにする（列の多い表）。stickyFirst：横スクロールのとき1列目を固定する（列の多い表）
interface Props {
  head: string[];
  rows: string[][];
  title?: string;
  widths?: string[];
  strongCols?: number[];
  total?: boolean;
  size?: "md" | "sm";
  minWidth?: string;
  stickyFirst?: boolean;
  caption?: string;
}
const {
  head,
  rows,
  title,
  widths,
  strongCols = [],
  total = false,
  size = "md",
  minWidth = "36rem",
  stickyFirst = false,
  caption,
} = Astro.props;
const text = size === "sm" ? "text-sm" : "text-base";
const pad = size === "sm" ? "px-3" : "px-4";
const stickyHead = stickyFirst ? "sticky left-0 z-10 bg-std-bg" : "";
const stickyCell = stickyFirst ? "sticky left-0 z-10 bg-white" : "";
---

<div>
  {title && <p class="mb-3 text-sm font-bold text-ink-950" aria-hidden="true">{title}</p>}
  <div class="overflow-x-auto">
    <table class={`w-full border-collapse text-left leading-[1.7] ${text}`} style={`min-width:${minWidth}`}>
      {(title || caption) && <caption class="sr-only">{title ?? caption}</caption>}
      {
        widths && (
          <colgroup>
            {widths.map((w) => (
              <col style={w ? `width:${w}` : undefined} />
            ))}
          </colgroup>
        )
      }
      <thead>
        <tr class="bg-std-bg">
          {head.map((h, hi) => (
            <th
              scope="col"
              class={`${pad} py-3.5 text-[0.8125rem] font-bold leading-[1.6] text-std-sub ${hi === 0 ? stickyHead : "whitespace-nowrap"}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {
          rows.map((row, ri) => {
            const isTotal = total && ri === rows.length - 1;
            return (
              <tr class="border-b border-std-line">
                {row.map((cell, ci) =>
                  ci === 0 ? (
                    <th scope="row" class={`${pad} py-4 align-middle text-ink-950 ${stickyCell} ${isTotal ? "font-bold" : "font-medium"}`}>
                      {cell}
                    </th>
                  ) : (
                    <td
                      class={`${pad} py-4 align-middle text-ink-950 tabular-nums ${isTotal || strongCols.includes(ci) ? "font-bold" : ""}`}
                    >
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            );
          })
        }
      </tbody>
    </table>
  </div>
</div>
