// 外部リンクの判定（ビルド時のコンポーネントとブラウザ側のスクリプトで共通）。
// 自サイトのドメイン（旧ドメイン mktg.ax は転送先が自サイトなので含む）は内部リンクとみなす。
export const INTERNAL_HOSTS = ["meerkitlab.com", "www.meerkitlab.com", "mktg.ax", "www.mktg.ax"];

export function isExternalHref(href: string | null | undefined, base: string): boolean {
  if (!href) return false;
  if (!/^https?:\/\//i.test(href) && !href.startsWith("//")) return false;
  try {
    const url = new URL(href, base);
    if (url.host === new URL(base).host) return false;
    return !INTERNAL_HOSTS.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
