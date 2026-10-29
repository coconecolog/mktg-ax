// マーケ月次報告メーカーのお知らせメールに付ける「配信停止」リンクの遷移先。
//   GET /api/monthly-report-unsubscribe?token=xxxxx
//
// 必要な環境変数（Cloudflare Pagesダッシュボード → Settings → Environment variables）:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

function renderPage({ title, message }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title} | MeerKitLab</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; background:#FAF9F9; margin:0; padding:0; }
  .card { max-width: 480px; margin: 96px auto; background:#fff; border-radius:16px; padding:40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align:center; }
  h1 { font-size: 18px; color:#0b0b12; margin: 0 0 12px; }
  p { font-size: 14px; color:#525252; line-height:1.7; }
  a { color:#0b0b12; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="/tools/monthly-report">マーケ月次報告メーカーへ</a></p>
  </div>
</body>
</html>`;
}

function htmlResponse(page, status) {
  return new Response(page, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const ERROR_PAGE = { title: "エラーが発生しました", message: "しばらくしてから再度お試しください。" };

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

  if (!token) {
    return htmlResponse(
      renderPage({ title: "リンクが正しくありません", message: "配信停止用のリンクが正しくないようです。お手数ですがお問い合わせください。" }),
      400,
    );
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[monthly-report-unsubscribe] 環境変数が設定されていません。");
    return htmlResponse(renderPage(ERROR_PAGE), 500);
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/monthly_report_subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      },
    );
    if (!res.ok) {
      console.error("[monthly-report-unsubscribe] Supabaseの更新に失敗しました:", res.status, await res.text());
      return htmlResponse(renderPage(ERROR_PAGE), 502);
    }
    const rows = await res.json();
    if (rows.length === 0) {
      return htmlResponse(
        renderPage({ title: "リンクが見つかりません", message: "このリンクはすでに無効か、正しくない可能性があります。" }),
        404,
      );
    }
    return htmlResponse(
      renderPage({
        title: "配信停止が完了しました",
        message: "月次報告のお知らせメールの配信を停止しました。ツールはこれまでどおりお使いいただけます。",
      }),
      200,
    );
  } catch (err) {
    console.error("[monthly-report-unsubscribe] 処理中にエラーが発生しました:", err);
    return htmlResponse(renderPage(ERROR_PAGE), 500);
  }
}
