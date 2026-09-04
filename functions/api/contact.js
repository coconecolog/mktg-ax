// お問い合わせフォーム（src/pages/contact.astro）の送信を受け取る
// Cloudflare Pages Function。
//   POST /api/contact
//
// 処理の流れ:
//   1. 入力チェック（お名前・メールアドレス・お問い合わせ種別・内容・同意チェックボックスなど）
//   2. Supabase（service_roleキー経由）に問い合わせ内容を保存（本体の記録。ここが失敗したらエラーを返す）
//   3. Resend経由で、運営者宛の通知メールを送信（返信先=問い合わせ者のメールアドレス）
//      ※ 2で保存済みのため、3が失敗してもユーザーにはエラーを返さない（サーバー側にログのみ残す）
//
// 必要な環境変数（Cloudflare Pagesダッシュボード → 対象プロジェクト →
// Settings → Environment variables で設定する。resource-download.js /
// unsubscribe.js と共通のものはそのまま流用可能。プロジェクト単位の設定なので追加の登録は不要）:
//   SUPABASE_URL              既存のものを流用
//   SUPABASE_SERVICE_ROLE_KEY 既存のものを流用
//   RESEND_API_KEY             既存のものを流用
//   RESEND_FROM_ADDRESS        既存のものを流用
//   CONTACT_NOTIFY_TO          お問い合わせ通知の送り先（新規追加が必要）
//
// 事前準備: Supabaseの「SQL Editor」で supabase/contact_messages.sql を実行し、
// contact_messages テーブルを作成しておくこと。

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

const INQUIRY_TYPES = ["一般のお問い合わせ", "サービス・ご相談について", "資料掲載について", "記事・取材について", "その他"];

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
  const inquiryType = (body.inquiryType || "").toString().trim();
  const message = (body.message || "").toString().trim();
  const consent = body.consent === true;
  // 送信フォームには表示していないハニーポット項目。人間には見えないが、
  // 自動投稿botはよく埋めてしまうため、値が入っていたら黙って成功扱いにして無視する。
  const honeypot = (body.website || "").toString().trim();

  if (honeypot) {
    return Response.json({ ok: true });
  }

  if (
    !name ||
    !isValidEmail(email) ||
    !INQUIRY_TYPES.includes(inquiryType) ||
    !message ||
    !consent
  ) {
    return Response.json({ ok: false, error: "入力内容をご確認ください。" }, { status: 400 });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_ADDRESS, CONTACT_NOTIFY_TO } = env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !RESEND_FROM_ADDRESS || !CONTACT_NOTIFY_TO) {
    console.error("[contact] 環境変数が設定されていません。Cloudflare Pagesの環境変数設定を確認してください。");
    return Response.json(
      { ok: false, error: "サーバー設定エラーです。しばらくしてから再度お試しください。" },
      { status: 500 },
    );
  }

  // 1. Supabaseに問い合わせ内容を保存（本体の記録）
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([
        {
          name,
          company: company || null,
          email,
          inquiry_type: inquiryType,
          message,
        },
      ]),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error("[contact] Supabaseへの保存に失敗しました:", insertRes.status, errText);
      return Response.json(
        { ok: false, error: "送信に失敗しました。時間をおいて再度お試しください。" },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[contact] Supabaseへの保存中にエラーが発生しました:", err);
    return Response.json({ ok: false, error: "送信に失敗しました。時間をおいて再度お試しください。" }, { status: 502 });
  }

  const safeName = escapeHtml(name);
  const safeCompany = escapeHtml(company || "（未入力）");
  const safeEmail = escapeHtml(email);
  const safeType = escapeHtml(inquiryType);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br />");

  const html = `
    <p>サイトのお問い合わせフォームから送信がありました。</p>
    <table cellpadding="6" style="border-collapse:collapse;">
      <tr><td style="color:#888;">お名前</td><td>${safeName}</td></tr>
      <tr><td style="color:#888;">会社名</td><td>${safeCompany}</td></tr>
      <tr><td style="color:#888;">メールアドレス</td><td>${safeEmail}</td></tr>
      <tr><td style="color:#888;">お問い合わせ種別</td><td>${safeType}</td></tr>
    </table>
    <p style="color:#888;">お問い合わせ内容</p>
    <p>${safeMessage}</p>
  `;

  // 2. Resend経由で運営者に通知メールを送信（あくまで通知。1で保存済みのため、
  //    ここが失敗してもユーザーには成功を返す。失敗はログにのみ残す）
  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_ADDRESS,
        to: CONTACT_NOTIFY_TO,
        // 通知メールにそのまま「返信」すれば問い合わせ者本人に届くようにする
        reply_to: email,
        subject: `【MKTG.AX お問い合わせ】${inquiryType}（${name} 様）`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("[contact] Resend経由の通知メール送信に失敗しました（問い合わせ自体はSupabaseに保存済み）:", emailRes.status, errText);
    }
  } catch (err) {
    console.error("[contact] 通知メール送信中にエラーが発生しました（問い合わせ自体はSupabaseに保存済み）:", err);
  }

  return Response.json({ ok: true });
}
