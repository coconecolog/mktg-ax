// メール本文中の「配信停止はこちら」リンクの遷移先。
//   GET /api/unsubscribe?token=xxxxx
//
// 必要な環境変数（Cloudflare Pagesダッシュボード → Settings → Environment
// variablesで設定。resource-download.jsと共通）:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

function renderPage({ title, message }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} | MKTG.AX</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; background:#f6f9fb; margin:0; padding:0; }
  .card { max-width: 480px; margin: 96px auto; background:#fff; border-radius:16px; padding:40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align:center; }
  h1 { font-size: 18px; color:#153649; margin: 0 0 12px; }
  p { font-size: 14px; color:#525252; line-height:1.7; }
  a { color:#337ea9; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="/">トップページへ戻る</a></p>
  </div>
</body>
</html>`;
}

function htmlResponse(page, status) {
  return new Response(page, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

  if (!token) {
    return htmlResponse(
      renderPage({
        title: "リンクが正しくありません",
        message: "配信停止用のリンクが正しくないようです。お手数ですがお問い合わせください。",
      }),
      400,
    );
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[unsubscribe] 環境変数が設定されていません。Cloudflare Pagesの環境変数設定を確認してください。");
    return htmlResponse(
      renderPage({ title: "エラーが発生しました", message: "しばらくしてから再度お試しください。" }),
      500,
    );
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/resource_leads?unsubscribe_token=eq.${encodeURIComponent(token)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ unsubscribed_at: new Date().toISOString() }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[unsubscribe] Supabaseの更新に失敗しました:", res.status, errText);
      return htmlResponse(
        renderPage({ title: "エラーが発生しました", message: "しばらくしてから再度お試しください。" }),
        502,
      );
    }

    const rows = await res.json();
    if (rows.length === 0) {
      return htmlResponse(
        renderPage({
          title: "リンクが見つかりません",
          message: "このリンクはすでに無効か、正しくない可能性があります。",
        }),
        404,
      );
    }

    return htmlResponse(
      renderPage({
        title: "配信停止が完了しました",
        message: "今後のご案内メールの配信を停止しました。ご利用ありがとうございました。",
      }),
      200,
    );
  } catch (err) {
    console.error("[unsubscribe] 処理中にエラーが発生しました:", err);
    return htmlResponse(
      renderPage({ title: "エラーが発生しました", message: "しばらくしてから再度お試しください。" }),
      500,
    );
  }
}
