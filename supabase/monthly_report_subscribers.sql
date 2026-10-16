-- マーケ月次報告メーカー（/tools/monthly-report）の登録者。
-- Supabaseダッシュボード → SQL Editor にこのファイルの中身を貼って「Run」する（1回だけ）。
-- サーバーに置くのはメールアドレスと報告日だけ（入力した数字は保存しない）。

create table if not exists monthly_report_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  -- 報告日（毎月）。1〜28日、31＝月末
  report_day smallint not null check (report_day between 1 and 31),
  consent boolean not null default false,
  -- 配信停止リンク用のトークン
  unsubscribe_token text not null default (gen_random_uuid()::text),
  unsubscribed_at timestamptz,
  -- 同じお知らせを二重に送らないための記録（例: 2026-11-10:before）
  last_reminder_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- service_role キー（サーバー側）からだけ読み書きする。公開キーからは読めないようにする。
alter table monthly_report_subscribers enable row level security;
