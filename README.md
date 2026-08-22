# MKTG.AX サイト運用ガイド

このリポジトリは、Notion に書いた記事を Astro + Tailwind CSS でサイト化し、GitHub Actions 経由で Cloudflare Pages に自動デプロイする仕組みです。

**このガイドは「Git や コマンドラインを使わない」前提で書いています。** ファイルの変更はすべて GitHub のWeb編集画面（ファイルを開いて右上の鉛筆アイコン → 内容を書き換え → 一番下の「Commit changes」）で行います。

---

## 1. 全体の仕組み（ざっくり）

```
Notion（記事を書く）
   ↓ 30分おき or ファイルを保存した直後 or 手動ボタン
GitHub Actions（Notionから記事を取得してビルド）
   ↓ wrangler pages deploy（Cloudflare Pagesの無料ビルド回数を消費しない方式）
Cloudflare Pages（本番サイト）
```

- **記事の中身（Notion）を直しただけなら、GitHubは何も触らなくてOK。** 30分以内に自動で反映されます。今すぐ反映したいときは、GitHubの「Actions」タブ →「Deploy to Cloudflare Pages」→ 右上の「Run workflow」ボタンで即時デプロイできます。
- **コード（見た目や機能）を直したいときだけ、GitHubのWeb編集画面を使います。** 保存すると自動でデプロイが走ります。

---

## 2. 初回セットアップ

### 2-1. Notion側の準備

1. https://www.notion.so/my-integrations で新しいIntegration（連携）を作成し、「Internal Integration Secret」（`secret_` で始まる文字列）を控えておく。
2. ブログ記事用のデータベースを作成し、以下のプロパティ名で用意する（**名前は完全に一致させてください**。ずれると記事が取得できません）。

   | プロパティ名 | 種類 | 用途 |
   | --- | --- | --- |
   | タイトル | タイトル | 記事タイトル |
   | タグ | マルチセレクト | カテゴリ／絞込用 |
   | 公開日 | 日付 | 表示・並び替え・構造化データ用 |
   | 更新日 | 日付（または「最終更新日時」） | 構造化データ用 |
   | サムネイル画像 | ファイル&メディア | 一覧カード・OGP画像のベース |
   | 公開 | チェックボックス | ONの記事だけが公開される |
   | スラッグ | テキスト | 任意。空欄ならページIDがURLになる |
   | ディスクリプション | テキスト | 任意。SEO用の説明文 |

3. データベース右上の「…」→「コネクト」から、作成したIntegrationをこのデータベースに接続する（これをやらないとAPIから見えません）。
4. データベースをブラウザで開き、URLから32桁のID（データベースID）をコピーしておく。
   例: `https://www.notion.so/xxxx/1234567890abcdef1234567890abcdef?v=...` の `1234567890abcdef1234567890abcdef` の部分。

### 2-2. Cloudflareの準備

1. Cloudflareアカウントを作成し、ダッシュボード右側などから「アカウントID」を控えておく。
2. 「Workers & Pages」→「Pages」→「アプリケーションを作成」ではなく、**今回はGitHub Actionsからのdirect uploadで作るので、Pagesプロジェクトを事前に作る必要はありません**（初回デプロイ時に自動作成されます）。プロジェクト名は `mktg-ax` で固定してあります（`.github/workflows/deploy.yml` の一番下の行）。変更したい場合はそこを書き換えてください。
3. 「マイプロフィール」→「APIトークン」→「トークルを作成」→「Cloudflare Pages の編集」テンプレートを使ってAPIトークンを発行し、控えておく。

### 2-3. GitHubの準備

1. このリポジトリの内容を、新しく作った**パブリック**リポジトリにアップロードする（GitHubの「Add file」→「Upload files」で、展開したフォルダの中身をまとめてドラッグ&ドロップすればOK）。
2. リポジトリの Settings → Secrets and variables → Actions →「New repository secret」で、以下を登録する。

   | Secret名 | 値 |
   | --- | --- |
   | `NOTION_TOKEN` | 2-1の手順1で控えたIntegrationトークン |
   | `NOTION_DATABASE_ID` | 2-1の手順4で控えたデータベースID |
   | `CLOUDFLARE_API_TOKEN` | 2-2の手順3で発行したAPIトークン |
   | `CLOUDFLARE_ACCOUNT_ID` | 2-2の手順1で控えたアカウントID |

   （`PUBLIC_SITE_URL` / `PUBLIC_GA4_ID` / `PUBLIC_CLARITY_ID` / `PUBLIC_GSC_VERIFICATION` は任意。設定しなくても `https://mktg-ax.pages.dev` で動きます。詳しくは4章。）

3. Actionsタブ →「Deploy to Cloudflare Pages」→「Run workflow」で初回デプロイを実行する。数分待つと `https://mktg-ax.pages.dev` でサイトが公開されます。

---

## 3. 日常の記事更新（Gitを触らない場合）

Notionでいつもどおり記事を書き、「公開」チェックをONにするだけです。最大30分でサイトに反映されます。すぐ反映したいときはActionsタブから手動実行してください。

**注意: Notionの画像はビルドのたびにサイト側へダウンロードして保存し直しています。** Notionが発行する画像URLは数時間で失効する仕組みのため、毎回ダウンロードしないと画像が数時間後に表示されなくなってしまいます（このサイトではこの対策を最初から組み込んでいます）。

---

## 4. サイトURL・独自ドメインについて

現在のサイトURLは `astro.config.mjs` と `src/consts.ts` の両方に `https://mktg-ax.pages.dev` として設定してあります。**この値は「内部リンクが正しいURLか」の判定などに使われる重要な値なので、絶対に空欄やダミー文字列のままにしないでください。**

独自ドメインを設定したときは、以下の**両方**を新しいURLに書き換えてください（漏れると内部リンク判定やOGP・サイトマップがおかしくなります）。

- `astro.config.mjs` … `const SITE_URL = process.env.PUBLIC_SITE_URL || "https://mktg-ax.pages.dev";` の右側
- `src/consts.ts` … `export const SITE_URL = ... || "https://mktg-ax.pages.dev";` の右側

（GitHub Secretsに `PUBLIC_SITE_URL` を登録する方法でも上書きできますが、ファイルを直接書き換えるほうが分かりやすいのでおすすめです。）

---

## 5. アクセス解析（GA4 / Search Console / Clarity）の設定

リポジトリの Settings → Secrets and variables → Actions で、以下のSecretを追加すると自動で有効になります（未設定なら該当タグは出力されません）。

| Secret名 | 値 |
| --- | --- |
| `PUBLIC_GA4_ID` | GA4の測定ID（`G-XXXXXXXXXX`） |
| `PUBLIC_CLARITY_ID` | Microsoft Clarityのプロジェクトid |
| `PUBLIC_GSC_VERIFICATION` | Search Consoleの「HTMLタグ」確認方法で表示される `content="..."` の値 |

---

## 6. まだ仮実装の部分（次にやること）

- **お問い合わせページ**: 実装方法（Googleフォーム／外部フォーム埋め込みなど）を相談して決める予定です。今はメールリンクだけの仮実装になっています（`src/pages/contact.astro` / `src/consts.ts` の `CONTACT_EMAIL`）。
- **資料一覧・資料ダウンロード**: 今回はダミーデータです（`src/data/resources.ts`）。実データに差し替える、またはNotionの別データベースと連携する方法は別途検討してください。

---

## 7. ファイルを編集するときの注意（重要）

GitHubのWeb編集画面にファイルの中身をまるごと貼り付けて保存する運用のため、次の点に注意してください。

- **`<a ...>` タグは、`<a` と最初の属性（`href="..."`など）を必ず同じ行に書いてください。** `<a` だけを1行にして次の行に `href="..."` を書く形式にすると、Web編集画面への貼り付け時にタグが消えてしまう不具合が過去に発生しています。このリポジトリのコードは最初からその形式で統一してあります。今後コードを追加・編集するときも同じルールを守ってください。
- ファイルを保存すると自動でビルド・デプロイが走ります。Actionsタブで進行状況とエラーの有無を確認できます。
- **ビルドが失敗した場合、前回公開されていたサイトはそのまま残ります**（失敗したビルドで本番を上書きしない設計にしてあります）。焦らずActionsタブのログでエラー内容を確認してください。よくある原因は、Notionのプロパティ名を変えてしまった、Secretsの値が間違っている、などです。

---

## 8. 主要な機能・仕組みの補足

- **タグ絞り込み**: JavaScriptでの絞り込みではなく、`/blog/tag/タグ名` という実際のページを生成する方式にしています（SEO・表示速度の面で有利です）。
- **ページネーション**: 1ページ10件（`src/consts.ts` の `POSTS_PER_PAGE` で変更可）。
- **RSS**: `/rss.xml` で配信されます。
- **OGP画像**: 記事ごとに `/open-graph/blog/記事スラッグ.png` を自動生成します（サムネイル画像を背景に使用）。日本語表示用に `src/fonts/NotoSansJP-Variable.ttf`（Google Fonts「Noto Sans JP」、OFLライセンス）を同梱しています。
- **目次**: 見出し2・見出し3から自動生成し、見出し2の下に見出し3をネスト表示します（見出し1・見出し4は目次に含みません）。
- **画像のalt・キャプション判定**: Notionの画像ブロックのキャプション欄が、①空欄 → alt無し・非表示、②`alt:`で始まる → その文をaltとしてのみ使用（非表示）、③それ以外 → altとしても画面表示のキャプションとしても使用、の3パターンで自動判定されます。
- **コールアウトと引用**: コールアウトは枠線・斜体なしの背景ボックス、引用は枠線＋斜体で表示され、見た目が区別されます。
- **表（テーブル）**: Notion側の「列の見出し」「行の見出し」設定に対応し、セル内の改行・太字などの書式もそのまま反映されます。
- **Notion API**: 2025-09-03以降で必須になった「データソース」経由のクエリに対応しています（`Notion-Version: 2026-03-11`）。

---

## 9. ローカルでの動作確認（開発者向け・任意）

Gitやコマンドラインを使う場合のみ。

```bash
npm install
cp .env.example .env   # .envに実際の値を入れる
npm run dev             # http://localhost:4321 で確認

# Notionをまだ設定していない段階でも、サンプルデータで見た目を確認できます
npm run build:sample
npm run preview
```
