// マーケ月次報告メーカー（/tools/monthly-report）の登録を受け取る Cloudflare Pages Function。
//   POST /api/monthly-report-register   { email, reportDay, consent, website }
//
// サーバーに置くのは「メールアドレス」と「報告日」だけ（入力した数字は受け取らない）。
// 同じメールアドレスで登録し直したときは、報告日を上書きし、配信停止を解除する（upsert）。
// PDFはメールで送らない（登録が成功したら、ブラウザ側でその場でPDFを作ってダウンロードする）。
//
// 必要な環境変数（Cloudflare Pagesダッシュボード → Settings → Environment variables。Production/Preview両方）:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 必要なテーブル: supabase/monthly_report_subscribers.sql

function isValidEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const email = (body.email || "").toString().trim().toLowerCase();
  const reportDay = Number(body.reportDay);
  const consent = body.consent === true;
  // ハニーポット（画面には見えない項目）。値が入っていたらbotとみなし、黙って成功扱いにする。
  const honeypot = (body.website || "").toString().trim();
  if (honeypot) return Response.json({ ok: true });

  if (!isValidEmail(email) || !consent || !Number.isInteger(reportDay) || reportDay < 1 || reportDay > 31) {
    return Response.json({ ok: false, error: "入力内容をご確認ください。" }, { status: 400 });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[monthly-report-register] 環境変数が設定されていません。Cloudflare Pagesの環境変数設定を確認してください。");
    return Response.json({ ok: false, error: "サーバー設定エラーです。しばらくしてから再度お試しください。" }, { status: 500 });
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/monthly_report_subscribers?on_conflict=email`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          email,
          report_day: reportDay,
          consent: true,
          unsubscribed_at: null,
          updated_at: new Date().toISOString(),
        },
      ]),
    });

    if (!res.ok) {
      console.error("[monthly-report-register] Supabaseへの保存に失敗しました:", res.status, await res.text());
      return Response.json({ ok: false, error: "登録に失敗しました。時間をおいて再度お試しください。" }, { status: 502 });
    }
  } catch (err) {
    console.error("[monthly-report-register] Supabaseへの保存中にエラーが発生しました:", err);
    return Response.json({ ok: false, error: "登録に失敗しました。時間をおいて再度お試しください。" }, { status: 502 });
  }

  return Response.json({ ok: true });
}
