// 「この結果を、次の一手に」（ToolNextStep.astro）の表示を切り替える（ブラウザ側、2026-11-02）。
// variant = tool-next-steps.ts の variants のキー。slots = 説明文の {名前} に入れる文字。

export function setNextStep(variant: string, slots: Record<string, string> = {}): void {
  const root = document.querySelector<HTMLElement>("[data-tool-next]");
  if (!root) return;
  root.querySelectorAll<HTMLElement>("[data-next-variant]").forEach((el) => {
    el.hidden = el.dataset.nextVariant !== variant;
  });
  root.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => {
    const key = el.dataset.slot || "";
    if (key in slots) el.textContent = slots[key];
  });
}

/** ベンチマークのように、結果を出したあとで枠ごと表示するとき */
export function showNextStep(): void {
  document.querySelector<HTMLElement>("[data-tool-next]")?.removeAttribute("hidden");
}
