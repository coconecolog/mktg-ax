// 資料ダウンロードフォーム（src/pages/resources/[slug].astro）の送信を受け取る
// Cloudflare Pages Function。
//   POST /api/resource-download
//
// 処理の流れ:
//   1. 入力チェック（お名前・メールアドレス・同意チェックボックスなど）
//   2. Supabase（service_roleキー経由）にリード情報を保存
//   3. Resend経由で、ダウンロードリンク・配信停止リンクを記載したメールを送信
//
// 必要な環境変数（Cloudflare Pagesダッシュボード → 対象プロジェクト →
// Settings → Environment variables で設定する。GitHub Actions Secretsとは
//別物なので注意。Production/Previewの両方に設定しておくこと）:
//   SUPABASE_URL              例: https://xxxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY Supabase → Settings → API → service_role キー
//   RESEND_API_KEY            Resend → API Keys
//   RESEND_FROM_ADDRESS       例: MKTG.AX <notify@mktg.ax>（Resendで検証済みドメインのアドレス）
//   PUBLIC_SITE_URL           例: https://mktg.ax （末尾にスラッシュを付けない）

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const name = (body.name || "").toString().trim();
  const company = (body.company || "").toString().trim();
  const email = (body.email || "").toString().trim();
  const consent = body.consent === true;
  const resourceSlug = (body.resourceSlug || "").toString().trim();
  const resourceTitle = (body.resourceTitle || "").toString().trim();
  const downloadUrl = (body.downloadUrl || "").toString().trim();
  // 送信フォームには表示していないハニーポット項目。人間には見えないが、
  // 自動投稿botはよく埋めてしまうため、値が入っていたら黙って成功扱いにして無視する。
  const honeypot = (body.website || "").toString().trim();

  if (honeypot) {
    return Response.json({ ok: true });
  }

  if (
    !name ||
    !isValidEmail(email) ||
    !consent ||
    !resourceSlug ||
    !downloadUrl.startsWith("/files/resources/")
  ) {
    return Response.json({ ok: false, error: "入力内容をご確認ください。" }, { status: 400 });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_ADDRESS, PUBLIC_SITE_URL } = env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !RESEND_FROM_ADDRESS || !PUBLIC_SITE_URL) {
    console.error(
      "[resource-download] 環境変数が設定されていません。Cloudflare Pagesの環境変数設定を確認してください。",
    );
    return Response.json(
      { ok: false, error: "サーバー設定エラーです。しばらくしてから再度お試しください。" },
      { status: 500 },
    );
  }

  // 1. Supabaseにリードを保存
  let lead;
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/resource_leads`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify([
        {
          name,
          company: company || null,
          email,
          resource_slug: resourceSlug,
          resource_title: resourceTitle || null,
          consent: true,
        },
      ]),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error("[resource-download] Supabaseへの保存に失敗しました:", insertRes.status, errText);
      return Response.json(
        { ok: false, error: "送信に失敗しました。時間をおいて再度お試しください。" },
        { status: 502 },
      );
    }

    const rows = await insertRes.json();
    lead = rows[0];
  } catch (err) {
    console.error("[resource-download] Supabaseへの保存中にエラーが発生しました:", err);
    return Response.json({ ok: false, error: "送信に失敗しました。時間をおいて再度お試しください。" }, { status: 502 });
  }

  // 2. Resend経由でダウンロードリンクをメール送信
  const downloadAbsoluteUrl = `${PUBLIC_SITE_URL}${downloadUrl}`;
  const unsubscribeUrl = `${PUBLIC_SITE_URL}/api/unsubscribe?token=${encodeURIComponent(lead.unsubscribe_token)}`;
  const safeTitle = escapeHtml(resourceTitle || "資料");
  const safeName = escapeHtml(name);

  const html = `
    <p>${safeName} 様</p>
    <p>この度は「${safeTitle}」にお申し込みいただき、ありがとうございます。<br />
    以下のリンクより資料をダウンロードいただけます。</p>
    <p><a href="${downloadAbsoluteUrl}">${safeTitle}をダウンロードする</a></p>
    <p>今後のご案内が不要な場合は、以下より配信停止いただけます。<br />
    <a href="${unsubscribeUrl}">配信停止はこちら</a></p>
    <hr />
    <p style="color:#888;font-size:12px;">MKTG.AX（${PUBLIC_SITE_URL}）</p>
  `;

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_ADDRESS,
        to: email,
        subject: `【MKTG.AX】${resourceTitle || "資料"}のダウンロードリンク`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      // メール送信に失敗しても、リード自体は保存済み（手動フォロー可能）なので
      // ログには残しつつ、ユーザーには正直にエラーを返す（成功扱いにしない）。
      console.error("[resource-download] Resend経由のメール送信に失敗しました:", emailRes.status, errText);
      return Response.json(
        { ok: false, error: "資料の送付メールを送信できませんでした。お手数ですがお問い合わせください。" },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[resource-download] メール送信中にエラーが発生しました:", err);
    return Response.json(
      { ok: false, error: "資料の送付メールを送信できませんでした。お手数ですがお問い合わせください。" },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
