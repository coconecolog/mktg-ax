// KPI運用チェッカーのお知らせメールを送る（毎日1回、GitHub Actionsから実行）。
//   .github/workflows/kpi-check-reminders.yml
//
// 登録者ごとの「管理日」の3営業日前と当日に、お知らせメールを送る（配信停止リンク付き）。
// - 営業日＝土日と日本の祝日を除いた日（祝日は holidays-jp の公開データを使う。取れなければ土日だけで判定）
// - 管理日が休日のときは、その前の営業日を管理日とみなす。管理日が29〜31日で、その月に無い日なら月末。管理日が null の登録者には送らない。
// - 同じお知らせを二重に送らないよう、送った記録（last_reminder_key）を残す。
//
// 使い方:
//   node scripts/send-kpi-check-reminders.mjs                 本番（今日の日本時間で判定して送る）
//   node scripts/send-kpi-check-reminders.mjs --dry-run       送らずに、送る予定だけ表示
//   node scripts/send-kpi-check-reminders.mjs --date=2026-11-05 --dry-run   日付を指定して確かめる
//
// 必要な環境変数: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_ADDRESS, PUBLIC_SITE_URL

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const dateArg = args.find((a) => a.startsWith("--date="))?.slice(7);

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_ADDRESS } = process.env;
const SITE = (process.env.PUBLIC_SITE_URL || "https://mktg.ax").replace(/\/+$/, "");
const TOOL_URL = `${SITE}/tools/kpi-check`;
const BEFORE_DAYS = 3;

// ---------- 日付（すべて "YYYY-MM-DD" の文字列で扱う） ----------
function todayJst() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};

async function loadHolidays() {
  try {
    const res = await fetch("https://holidays-jp.github.io/api/v1/date.json");
    if (!res.ok) throw new Error(String(res.status));
    return new Set(Object.keys(await res.json()));
  } catch (err) {
    console.warn("[reminders] 祝日データを取得できませんでした。土日だけで営業日を判定します:", err.message);
    return new Set();
  }
}

function makeCalendar(holidays) {
  const isBusinessDay = (s) => {
    const w = toDate(s).getUTCDay();
    return w !== 0 && w !== 6 && !holidays.has(s);
  };
  const prevBusinessDayOrSame = (s) => {
    let d = s;
    while (!isBusinessDay(d)) d = addDays(d, -1);
    return d;
  };
  const minusBusinessDays = (s, n) => {
    let d = s;
    let left = n;
    while (left > 0) {
      d = addDays(d, -1);
      if (isBusinessDay(d)) left--;
    }
    return d;
  };
  /** その年月の管理日（休日なら前の営業日） */
  const reportDateOf = (year, month, day) => {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const d = Math.min(day, last);
    return prevBusinessDayOrSame(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  };
  return { reportDateOf, minusBusinessDays };
}

/** 今日送るお知らせ（無ければ null）。3営業日前が前月にかかる場合に備えて、今月と来月の管理日を見る。 */
function reminderFor(today, reportDay, cal) {
  const [y, m] = today.split("-").map(Number);
  for (const offset of [0, 1]) {
    const total = m - 1 + offset;
    const year = y + Math.floor(total / 12);
    const month = (total % 12) + 1;
    const reportDate = cal.reportDateOf(year, month, reportDay);
    if (reportDate === today) return { kind: "day", reportDate };
    if (cal.minusBusinessDays(reportDate, BEFORE_DAYS) === today) return { kind: "before", reportDate };
  }
  return null;
}

// ---------- メール ----------
const jpDate = (s) => {
  const d = toDate(s);
  const w = "日月火水木金土"[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${w}）`;
};

function buildEmail(sub, rem) {
  const unsubscribeUrl = `${SITE}/api/kpi-check-unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}`;
  const date = jpDate(rem.reportDate);
  const subject =
    rem.kind === "before"
      ? `【MKTG.AX】KPIの管理日まであと${BEFORE_DAYS}営業日です（${date}）`
      : `【MKTG.AX】今日はKPIの管理日です（${date}）`;
  const lead =
    rem.kind === "before"
      ? `管理日の${date}まで、あと${BEFORE_DAYS}営業日です。<br />施策ごとの実績の数字と、今月実施したことをそろえておきましょう。`
      : `今日（${date}）はKPIの管理日です。<br />まだの場合は、今月の実績を入れて、達成・未達と次の打ち手、撤退の判断を確かめましょう。`;
  const html = `
    <p>${lead}</p>
    <p>前回ダウンロードしたPDFをツールで読み込むと、目標と前月までの実績が入った状態から始められます。</p>
    <p><a href="${TOOL_URL}">KPI運用チェッカーを開く</a></p>
    <p style="color:#888;font-size:12px;">管理日を変えたいときは、ツールで管理日を変えて登録し直してください。<br />
    このお知らせが不要な場合は、こちらから配信を停止できます：<a href="${unsubscribeUrl}">配信停止</a></p>
    <hr />
    <p style="color:#888;font-size:12px;">MKTG.AX（${SITE}）</p>`;
  const text = `${lead.replace(/<br \/>/g, "\n")}\n\n前回ダウンロードしたPDFをツールで読み込むと、目標と前月までの実績が入った状態から始められます。\n${TOOL_URL}\n\n配信停止：${unsubscribeUrl}\n\nMKTG.AX（${SITE}）`;
  return {
    from: RESEND_FROM_ADDRESS,
    to: sub.email,
    subject,
    html,
    text,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
  };
}

// ---------- Supabase ----------
const sbHeaders = () => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
});

async function fetchSubscribers() {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kpi_check_subscribers?select=id,email,manage_day,unsubscribe_token,last_reminder_key&unsubscribed_at=is.null&consent=eq.true&manage_day=not.is.null&order=id`,
      { headers: { ...sbHeaders(), Range: `${from}-${from + page - 1}` } },
    );
    if (!res.ok) throw new Error(`登録者を取得できませんでした: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

async function markSent(ids, key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kpi_check_subscribers?id=in.(${ids.join(",")})`, {
    method: "PATCH",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ last_reminder_key: key }),
  });
  if (!res.ok) console.error("[reminders] 送信記録を残せませんでした:", res.status, await res.text());
}

async function sendBatch(emails) {
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(emails),
  });
  if (!res.ok) throw new Error(`Resendでの送信に失敗しました: ${res.status} ${await res.text()}`);
}

// ---------- 本体 ----------
async function main() {
  const today = dateArg || todayJst();
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", ...(DRY_RUN ? [] : ["RESEND_API_KEY", "RESEND_FROM_ADDRESS"])].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    console.error(`[reminders] 環境変数が足りません: ${missing.join(", ")}`);
    process.exit(1);
  }

  const cal = makeCalendar(await loadHolidays());
  const subs = await fetchSubscribers();

  // お知らせの種類（管理日＋前/当日）ごとにまとめる
  const groups = new Map();
  for (const sub of subs) {
    if (sub.manage_day === null) continue;
    const rem = reminderFor(today, Number(sub.manage_day), cal);
    if (!rem) continue;
    const key = `${rem.reportDate}:${rem.kind}`;
    if (sub.last_reminder_key === key) continue; // 送信済み
    if (!groups.has(key)) groups.set(key, { rem, subs: [] });
    groups.get(key).subs.push(sub);
  }

  let total = 0;
  for (const [key, { rem, subs: list }] of groups) {
    console.log(`[reminders] ${today} ${key}: ${list.length}件${DRY_RUN ? "（dry-run・送信しない）" : ""}`);
    if (DRY_RUN) continue;
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      await sendBatch(chunk.map((s) => buildEmail(s, rem)));
      await markSent(
        chunk.map((s) => s.id),
        key,
      );
      total += chunk.length;
      await new Promise((r) => setTimeout(r, 600)); // Resendの送信レート制限に配慮
    }
  }
  console.log(`[reminders] 完了：登録者 ${subs.length}件中、${DRY_RUN ? "送信予定" : "送信"} ${DRY_RUN ? [...groups.values()].reduce((s, g) => s + g.subs.length, 0) : total}件`);
}

// テスト用に関数を公開（node -e で import して確かめられる）
export { makeCalendar, reminderFor };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[reminders]", err);
    process.exit(1);
  });
}
