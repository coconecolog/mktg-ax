// サイト全体の外部リンクに、新しいタブで開く設定と外部リンクのマーク（.is-external）を付ける。
// Kitの画面などで後から追加されるリンクにも付くよう、DOMの変化も監視する。
import { isExternalHref } from "@/lib/externalLink";

function mark(a: HTMLAnchorElement) {
  if (a.dataset.extChecked) return;
  a.dataset.extChecked = "1";
  if (a.hasAttribute("download")) return;
  if (!isExternalHref(a.getAttribute("href"), location.href)) return;
  a.target = "_blank";
  const rel = new Set((a.rel || "").split(/\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  a.rel = [...rel].join(" ");
  if (!a.querySelector("img, svg, picture")) a.classList.add("is-external");
}

function scan(root: ParentNode) {
  if (root instanceof HTMLAnchorElement) mark(root);
  root.querySelectorAll?.("a[href]").forEach((a) => mark(a as HTMLAnchorElement));
}

scan(document);
new MutationObserver((records) => {
  for (const r of records) {
    r.addedNodes.forEach((n) => {
      if (n.nodeType === 1) scan(n as Element);
    });
    if (r.type === "attributes" && r.target instanceof HTMLAnchorElement) {
      const a = r.target;
      if (a.classList.contains("is-external") && !isExternalHref(a.getAttribute("href"), location.href)) {
        a.classList.remove("is-external");
        a.removeAttribute("target");
      }
      delete a.dataset.extChecked;
      mark(a);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
