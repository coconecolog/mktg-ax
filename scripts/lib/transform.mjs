/**
 * buildNotionLinkMap() の結果（NotionページID → サイト内URL）から、記事DBの公開記事を
 * 指しているページIDだけを「/blog/xxxx」のxxxx部分（スラッグ）に変換する。該当しなければ""。
 */
function resolveBlogSlugFromLinkMap(pageId, linkMap) {
  if (!pageId) return "";
  const url = linkMap?.get(pageId);
  const prefix = "/blog/";
  return url && url.startsWith(prefix) ? url.slice(prefix.length) : "";
}

/**
 * マスターカテゴリDB・マスタータグDBの「代表記事」プロパティを解決する。
 *
 * このプロパティは運用の変遷により、実際には3通りの書き方がありうる。
 *   (a) 記事の「Slug」をそのまま手入力したプレーンテキスト（旧「代表記事（Slug）」運用）
 *   (b) テキストプロパティ内でNotionの「@」から記事ページを直接選んでメンションしたもの
 *   (c) プロパティ自体を記事DBとの「リレーション」型に変更し、直接記事ページを選ぶもの
 *       （プロパティ名が2026-09-08に「代表記事（Slug）」→「代表記事」に変わったのは、
 *       スラッグを手入力する運用から、記事を直接指定する運用への移行を示唆している）
 * (b)・(c)のどちらも、単純に getRichTextPlain() 相当でプレーンテキストだけを抜き出すと
 * 「メンション・関連先の記事のタイトル」が返ってしまい、記事の「Slug」プロパティ値とは
 * 一致しないため getPostBySlug() が常にヒットせず、代表記事ブロックが表示されない不具合に
 * なっていた（2026-09-10発覚）。
 *
 * ここではプロパティの実際の型を見て、メンション先／リレーション先のページIDを
 * buildNotionLinkMap() の結果（NotionページID → サイト内URL）で引き、"/blog/xxxx" 形式の
 * URLからスラッグ部分を取り出す。解決できない場合（リンク先が記事DBの公開記事でない、
 * プロパティが空、など）は、可能な範囲で従来通りプレーンテキストとして扱う（後方互換）。
 */
export function resolveRepresentativeSlug(page, name, linkMap) {
  const prop = getProperty(page, name);
  if (!prop) return "";

  // (c) リレーション型（記事DBと直接リレーションを組んで選ぶ運用）。単一選択想定で先頭の1件を使う。
  if (prop.type === "relation") {
    const relatedId = (prop.relation || [])[0]?.id;
    return resolveBlogSlugFromLinkMap(relatedId, linkMap);
  }

  // (a)(b) テキスト型。
  if (prop.type === "rich_text") {
    const richText = prop.rich_text || [];
    const mention = richText.find(
      (t) => t.type === "mention" && t.mention?.type === "page" && t.mention.page?.id,
    );
    if (mention) {
      const resolved = resolveBlogSlugFromLinkMap(mention.mention.page.id, linkMap);
      if (resolved) return resolved;
    }
    return richText.map((t) => t.plain_text).join("");
  }

  return "";
}
