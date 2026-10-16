---
// マーケ月次報告メーカー（/tools/monthly-report）
// 仕様: Googleドライブ「MKTG.AX／共有（正本）／04_ツール仕様／マーケ月次報告メーカー 仕様」
// - 計算はすべてブラウザ内（src/lib/monthlyReport.ts）。入力した数字はサーバーに送らない。
// - PDF（A4横1枚）は html2canvas-pro で報告書を画像にし、pdf-lib でPDFにする。入力データはPDFの添付ファイル
//   （mktgax-monthly-report.json）として埋め込み、次回はPDFを読み込ませて前月までの値を入れる。
// - PDFのダウンロード時にメール登録（POST /api/monthly-report-register）。サーバーに置くのはメールアドレスと報告日だけ。
// - ライブラリはCDNから、PDFを作る・読むときだけ読み込む（npm依存は増やさない）。
import BaseLayout from "@/layouts/BaseLayout.astro";
import Breadcrumb from "@/components/Breadcrumb.astro";
import FaqAccordion from "@/components/FaqAccordion.astro";
import MoreExplore from "@/components/MoreExplore.astro";
import ContactCta from "@/components/ContactCta.astro";
import { getAllCategories, getPopularPosts } from "@/lib/posts";

// 本格版（M-B-04 予実管理表＋月次・年間報告テンプレート）の案内先。資料ページのURLが決まったら差し替える。
const FULL_VERSION_URL = "/library";

const TOOL_TITLE = "マーケ月次報告メーカー";
const TOOL_DESCRIPTION =
  "毎月、リード・商談・受注の数字を入れるだけで、期末の着地見込みと足りない段階、打ち手、結論の文までそろった経営報告1枚（A4横のPDF）ができる無料ツールです。";

const breadcrumbItems = [
  { name: "トップ", href: "/" },
  { name: "便利ツール", href: "/tools" },
  { name: TOOL_TITLE, href: "/tools/monthly-report" },
];

const categories = getAllCategories();
const popularPosts = getPopularPosts(3).map((p) => ({ slug: p.slug, title: p.title }));

const faqItems = [
  {
    question: "着地見込みはどのように計算していますか？",
    answer:
      "受注済みの累計＋月末に進行中の商談金額×受注率＋期内に受注できる新規分 で計算しています。期内に受注できる新規分は、残りの月のうち期末まで「商談から受注までの平均期間」以上ある月の、計画の商談金額（計画のリード数×計画の商談化率×計画の平均受注単価）の合計に、計画の受注率を掛けたものです。",
  },
  {
    question: "受注率は計画と実績のどちらを使いますか？",
    answer:
      "進行中の商談には、決着した商談（受注＋失注）が10件たまるまでは計画の受注率を、それ以降は期首からの累計の実績（受注金額÷（受注金額＋失注金額））を使います。進行中の商談を分母に入れると受注の遅れで低く出てしまうため、また件数が少ないと振れが大きいためです。これからの商談（期内に受注できる新規分）には、計画の受注率を使います。",
  },
  {
    question: "「足りない段階」はどう決まりますか？",
    answer:
      "リード数・商談化率・受注率・受注単価の4つの段階について、期首からの累計を計画と比べた達成率を出し、いちばん低い段階を「足りない段階」にします。100%以上は達成、90%以上はやや届かない、90%未満は届かないと判定します。すべて90%以上なら「計画どおり」です。",
  },
  {
    question: "入力した数字はサーバーに保存されますか？",
    answer:
      "いいえ。計算はすべてブラウザの中で行い、数字はサーバーに送りません。入力の途中はこのブラウザにだけ一時保存されます。翌月は、ダウンロードしたPDFを読み込ませると前月までの数字が入った状態から始められます。サーバーに置くのは、登録いただいたメールアドレスと報告日だけです。",
  },
  {
    question: "PDFを読み込んでも数字が入りません。",
    answer:
      "PDFを別のソフトで開いて保存し直すと、埋め込んだデータが消えることがあります。その場合はお手数ですが、前月までの数字を手で入力してください（報告する月を切り替えると、その月の数字を入力できます）。",
  },
];
---

<BaseLayout title={TOOL_TITLE} description={TOOL_DESCRIPTION} ogImage="/open-graph/tools/monthly-report.png">
  <Breadcrumb items={breadcrumbItems} />

  <section class="mx-auto max-w-5xl px-5 py-12">
    <h1 class="text-3xl font-extrabold tracking-tight text-ink-950">{TOOL_TITLE}</h1>
    <p class="mt-3 text-neutral-500">
      経営から「それで、売上はどうなったのか」と聞かれたときに答えられる、経営報告1枚（A4横のPDF）を作ります。期初に計画を入れ、毎月はリード・商談・受注の数字を数個入れるだけです。計算はすべてブラウザの中で行い、入力した数字はサーバーに送りません。
    </p>

    <!-- 前回のPDFを読み込む -->
    <div class="mt-8 rounded-2xl border border-dashed border-neutral-300 bg-white p-5 md:p-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="text-sm font-bold text-ink-950">2か月目からは、前回のPDFを読み込む</p>
          <p class="mt-1 text-xs text-neutral-500">このツールで作ったPDFを選ぶと、計画と前月までの数字が入ります。</p>
        </div>
        <label class="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-bold text-ink-950 hover:border-neutral-500">
          PDFを選ぶ
          <input id="mr-pdf-input" type="file" accept="application/pdf,.pdf" class="sr-only" />
        </label>
      </div>
      <p id="mr-load-msg" class="mt-3 hidden text-sm" role="status"></p>
      <p class="mt-2 text-xs text-neutral-400">※PDFを別のソフトで保存し直すと、埋め込んだデータが消えることがあります。その場合は手で入力してください。</p>
    </div>

    <!-- STEP 1 計画 -->
    <div class="mr-step mt-6 rounded-2xl border border-neutral-100 bg-white p-6 md:p-8">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="text-lg font-bold text-ink-950"><span class="mr-step-no">STEP 1</span>期初の計画（初回だけ）</h2>
        <span id="mr-plan-status" class="text-xs font-bold"></span>
      </div>
      <p class="mt-1 text-xs text-neutral-500">金額の単位は万円です。数字はすべてマーケ起点（マーケが獲得したリードから生まれた商談・受注）で入れます。</p>

      <div class="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        <div class="mr-field">
          <span class="mr-label">期首月</span>
          <div class="flex gap-2">
            <select id="plan-startYear" class="mr-input" aria-label="期首の年"></select>
            <select id="plan-startMonth" class="mr-input" aria-label="期首の月"></select>
          </div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="plan-reportDay">報告日（毎月）</label>
          <select id="plan-reportDay" class="mr-input"></select>
          <span class="mr-help">経営に報告する日。登録すると、3営業日前と当日にお知らせメールが届きます。</span>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="plan-target">年間の受注金額目標（マーケ起点）</label>
          <div class="mr-unit"><input id="plan-target" class="mr-input" type="number" inputmode="decimal" min="0" step="any" placeholder="例：12000" /><span>万円</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="plan-annualLeads">年間のリード数の計画</label>
          <div class="mr-unit"><input id="plan-annualLeads" class="mr-input" type="number" inputmode="numeric" min="0" step="1" placeholder="例：1200" /><span>件</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="plan-dealRate">計画の商談化率（商談÷リード）</label>
          <div class="mr-unit"><input id="plan-dealRate" class="mr-input" type="number" inputmode="decimal" min="0" max="100" step="any" placeholder="例：20" /><span>%</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="plan-winRate">計画の受注率（受注÷商談）</label>
          <div class="mr-unit"><input id="plan-winRate" class="mr-input" type="number" inputmode="decimal" min="0" max="100" step="any" placeholder="例：25" /><span>%</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="plan-avgDeal">計画の平均受注単価</label>
          <div class="mr-unit"><input id="plan-avgDeal" class="mr-input" type="number" inputmode="decimal" min="0" step="any" placeholder="例：200" /><span>万円</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="plan-cycle">商談から受注までの平均期間</label>
          <div class="mr-unit"><input id="plan-cycle" class="mr-input" type="number" inputmode="decimal" min="0" max="12" step="any" placeholder="例：3" /><span>か月</span></div>
        </div>
      </div>

      <details class="mt-6 rounded-xl bg-neutral-50 px-4 py-3">
        <summary class="cursor-pointer text-sm font-bold text-ink-950">月別のリード数の計画（任意）</summary>
        <p class="mt-2 text-xs text-neutral-500">空欄の月は、年間の計画から入力済みの月を引いた残りを等分します。すべて空欄なら12等分です。</p>
        <div id="plan-monthly" class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6"></div>
      </details>
    </div>

    <!-- STEP 2 今月の数字 -->
    <div class="mr-step mt-6 rounded-2xl border border-neutral-100 bg-white p-6 md:p-8">
      <h2 class="text-lg font-bold text-ink-950"><span class="mr-step-no">STEP 2</span>毎月の数字</h2>
      <p class="mt-1 text-xs text-neutral-500">報告する月を選んで、その月の数字を入れます。前の月を直したいときも、ここで月を選びます。</p>

      <div class="mt-5 mr-field">
        <span class="mr-label">報告する月</span>
        <div id="mr-month-chips" class="flex flex-wrap gap-2" role="radiogroup" aria-label="報告する月"></div>
      </div>

      <div class="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2" id="mr-month-form">
        <div class="mr-field">
          <label class="mr-label" for="m-leads">リード数</label>
          <div class="mr-unit"><input id="m-leads" class="mr-input" type="number" inputmode="numeric" min="0" step="1" /><span>件</span></div>
        </div>
        <div class="mr-field sm:col-start-1">
          <label class="mr-label" for="m-deals">新規の商談数</label>
          <div class="mr-unit"><input id="m-deals" class="mr-input" type="number" inputmode="numeric" min="0" step="1" /><span>件</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="m-dealAmt">新規の商談金額</label>
          <div class="mr-unit"><input id="m-dealAmt" class="mr-input" type="number" inputmode="decimal" min="0" step="any" /><span>万円</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="m-wins">受注数</label>
          <div class="mr-unit"><input id="m-wins" class="mr-input" type="number" inputmode="numeric" min="0" step="1" /><span>件</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="m-winAmt">受注金額</label>
          <div class="mr-unit"><input id="m-winAmt" class="mr-input" type="number" inputmode="decimal" min="0" step="any" /><span>万円</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="m-lost">失注数</label>
          <div class="mr-unit"><input id="m-lost" class="mr-input" type="number" inputmode="numeric" min="0" step="1" /><span>件</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="m-lostAmt">失注金額</label>
          <div class="mr-unit"><input id="m-lostAmt" class="mr-input" type="number" inputmode="decimal" min="0" step="any" /><span>万円</span></div>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="m-open">月末に進行中の商談金額</label>
          <div class="mr-unit"><input id="m-open" class="mr-input" type="number" inputmode="decimal" min="0" step="any" /><span>万円</span></div>
          <span class="mr-help">受注も失注もしていない、マーケ起点の商談の金額の合計</span>
        </div>
        <div class="mr-field">
          <label class="mr-label" for="m-revenue">全社の売上（任意）</label>
          <div class="mr-unit"><input id="m-revenue" class="mr-input" type="number" inputmode="decimal" min="0" step="any" /><span>万円</span></div>
          <span class="mr-help">入れたときだけ、全社の売上のうちマーケ起点の割合を参考に出します</span>
        </div>
      </div>
    </div>

    <!-- STEP 3 報告書 -->
    <div class="mr-step mt-6 rounded-2xl border border-neutral-100 bg-white p-6 md:p-8">
      <h2 class="text-lg font-bold text-ink-950"><span class="mr-step-no">STEP 3</span>報告書を仕上げる</h2>

      <div id="mr-notice" class="mt-4 hidden rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"></div>

      <div id="mr-editor" class="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p class="text-sm font-bold text-ink-950">打ち手（3つまで）</p>
          <p id="mr-actions-lead" class="mt-1 text-xs text-neutral-500"></p>
          <div id="mr-actions" class="mt-3 space-y-2"></div>
        </div>
        <div class="space-y-4">
          <p class="text-xs text-neutral-500">「課題」と「期限」は数字から自動で入ります。言葉は自由に直せます（報告する月を変えると作り直します）。</p>
          <div class="mr-field">
            <label class="mr-label" for="mr-issue">課題</label>
            <input id="mr-issue" type="text" class="mr-input" />
          </div>
          <div class="mr-field">
            <label class="mr-label" for="mr-deadline">期限</label>
            <input id="mr-deadline" type="text" class="mr-input" />
          </div>
          <div class="mr-field">
            <label class="mr-label" for="mr-ask">経営にお願いしたいこと（任意）</label>
            <input id="mr-ask" type="text" class="mr-input" placeholder="例：営業に渡す条件の見直しの場を設けたい" />
            <span class="mr-help">入れたときだけ報告書に載ります。</span>
          </div>
        </div>
      </div>

      <p class="mt-8 text-sm font-bold text-ink-950">プレビュー（A4横）</p>
      <div id="mr-preview-wrap" class="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
        <div id="mr-preview-scale" style="transform-origin: top left;"></div>
      </div>
    </div>

    <!-- STEP 4 ダウンロード -->
    <div class="mr-step mt-6 rounded-2xl border-2 border-ink-950 bg-white p-6 md:p-8" id="mr-download">
      <h2 class="text-lg font-bold text-ink-950"><span class="mr-step-no">STEP 4</span>PDFをダウンロード</h2>

      <form id="mr-register-form" class="mt-4 space-y-4" novalidate>
        <p class="text-sm text-neutral-600">
          メールアドレスを登録すると、その場でPDFをダウンロードできます。毎月の報告日の3営業日前と当日に、お知らせメールをお送りします（PDFはメールでは送りません）。
        </p>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="mr-field">
            <label class="mr-label" for="reg-email">メールアドレス</label>
            <input id="reg-email" name="email" type="email" autocomplete="email" required class="mr-input" placeholder="you@example.com" />
          </div>
          <div class="mr-field">
            <span class="mr-label">報告日</span>
            <p id="reg-reportday" class="py-2 text-sm font-bold text-ink-950"></p>
            <span class="mr-help">STEP 1 で変えられます</span>
          </div>
        </div>
        <div class="hidden" aria-hidden="true">
          <label>ウェブサイト<input type="text" name="website" id="reg-website" tabindex="-1" autocomplete="off" /></label>
        </div>
        <label class="flex items-start gap-2 text-sm text-neutral-600">
          <input id="reg-consent" type="checkbox" class="mt-1" />
          <span><a href="/privacy" class="underline" target="_blank" rel="noopener">プライバシーポリシー</a>に同意して、お知らせメールを受け取る</span>
        </label>
        <button id="reg-submit" type="submit" class="mr-btn">登録してPDFをダウンロード</button>
        <p id="reg-msg" class="hidden text-sm" role="status"></p>
      </form>

      <div id="mr-registered" class="mt-4 hidden space-y-3">
        <p class="text-sm text-neutral-600">登録済み：<span id="mr-registered-email" class="font-bold text-ink-950"></span></p>
        <button id="mr-download-btn" type="button" class="mr-btn">PDFをダウンロード</button>
        <p id="mr-download-msg" class="hidden text-sm" role="status"></p>
        <button id="mr-reregister" type="button" class="block text-xs text-neutral-500 underline hover:text-ink-950">別のメールアドレス・報告日で登録しなおす</button>
      </div>

      <p class="mt-6 border-t border-neutral-100 pt-4 text-xs text-neutral-500">
        翌月は、ダウンロードしたPDFをこのページで読み込むと、前月までの数字が入った状態から始められます。PDFは保存し直さずに、そのまま保管してください。
      </p>
    </div>

    <!-- 本格版の案内 -->
    <div class="mt-6 rounded-2xl bg-neutral-50 p-6 md:p-8">
      <p class="text-sm font-bold text-ink-950">施策ごとまで管理したいときは</p>
      <p class="mt-2 text-sm text-neutral-600">
        このツールは全体の数字だけで作る入口版です。施策ごとの費用・リード・商談・受注まで管理して、KPIの達成率やROIを月次で見たいときは、予実管理表（KPI達成率×ROI）と月次・年間報告テンプレートをお使いください。
      </p>
      <a href={FULL_VERSION_URL} class="mt-4 inline-flex rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-bold text-ink-950 hover:border-neutral-500">本格版の資料を見る →</a>
    </div>

    <div class="my-16 flex justify-center">
      <a href="/tools" class="rounded-full border border-neutral-200 bg-white px-6 py-3 text-sm font-bold text-ink-950 hover:border-brand-300">
        便利ツール一覧を見る →
      </a>
    </div>

    <FaqAccordion items={faqItems} />

    <MoreExplore
      categories={categories}
      popularPosts={popularPosts}
      categoryHeading="カテゴリから探す"
      popularHeading="💡 あわせて読みたい実践ノウハウ"
    />
  </section>

  <ContactCta />
</BaseLayout>

<style is:global>
  .mr-step-no { display: inline-block; margin-right: 0.6rem; font-size: 0.7rem; letter-spacing: 0.08em; color: #737373; vertical-align: 0.15em; }
  .mr-field { display: flex; flex-direction: column; gap: 0.35rem; }
  .mr-label { font-size: 0.85rem; font-weight: 600; color: #404040; }
  .mr-help { font-size: 0.72rem; color: #8a8a8a; line-height: 1.5; }
  .mr-input { width: 100%; min-width: 0; border: 1px solid #d4d4d4; border-radius: 0.6rem; background: #fff; padding: 0.55rem 0.75rem; font-size: 0.95rem; color: #0b0b12; }
  .mr-input:focus { outline: 2px solid #0b0b12; outline-offset: 0; border-color: #0b0b12; }
  .mr-input.mr-invalid { border-color: #b91c1c; background: #fef2f2; }
  .mr-unit { display: flex; align-items: center; gap: 0.5rem; }
  .mr-unit > span { flex-shrink: 0; font-size: 0.85rem; color: #737373; min-width: 2.2em; }
  .mr-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 0.75rem; background: #0b0b12; color: #fff; padding: 0.8rem 1.5rem; font-size: 0.95rem; font-weight: 700; }
  .mr-btn:hover { opacity: 0.9; }
  .mr-btn:disabled { opacity: 0.5; cursor: wait; }
  .mr-chip { border: 1px solid #d4d4d4; border-radius: 999px; background: #fff; padding: 0.35rem 0.8rem; font-size: 0.8rem; color: #404040; }
  .mr-chip[data-entered="1"]::after { content: " ✓"; color: #15803d; font-weight: 700; }
  .mr-chip[aria-checked="true"] { background: #0b0b12; border-color: #0b0b12; color: #fff; }
  .mr-chip[aria-checked="true"][data-entered="1"]::after { color: #86efac; }

  /* ===== 報告書（A4横 1123×794px）。PDF化（html2canvas）のため、色は16進のみ・Tailwindのクラスは使わない ===== */
  .mr-report { width: 1123px; height: 794px; box-sizing: border-box; padding: 28px 34px 18px; background: #ffffff; color: #0b0b12; font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif; display: flex; flex-direction: column; line-height: 1.4; font-variant-numeric: tabular-nums; }
  .mr-report * { box-sizing: border-box; }
  .mr-report p { margin: 0; }
  .mr-report .ng { color: #b91c1c; }
  .mr-report .ok { color: #15803d; }
  .mr-report .mid { color: #4b5563; }
  .mr-report .na { color: #8a8a8a; font-weight: 400 !important; }
  .mr-report .r-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0b0b12; padding-bottom: 7px; }
  .mr-report .r-title { font-size: 22px; font-weight: 800; }
  .mr-report .r-sub { font-size: 11px; color: #525252; margin-top: 2px; }
  .mr-report .r-meta { font-size: 10.5px; color: #525252; text-align: right; }
  .mr-report .r-top { display: grid; grid-template-columns: 1fr 1.08fr; gap: 12px; margin-top: 9px; }
  .mr-report .r-box { border: 1px solid #e5e5e5; border-radius: 8px; padding: 9px 12px; }
  .mr-report .r-h { font-size: 11.5px; font-weight: 800; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
  .mr-report .r-h small { font-weight: 400; color: #737373; font-size: 10px; }
  .mr-report .r-cells { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .mr-report .r-cell { background: #f6f6f6; border-radius: 6px; padding: 4px 10px; }
  .mr-report .r-cell .l { font-size: 10px; color: #525252; font-weight: 700; }
  .mr-report .r-cell .v { font-size: 17px; font-weight: 800; line-height: 1.25; }
  .mr-report .r-cell .v span { font-size: 13px; font-weight: 700; margin-left: 6px; }
  .mr-report .r-cell .s { font-size: 10px; color: #525252; }
  .mr-report .r-dark { background: #0b0b12; color: #ffffff; border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; justify-content: space-between; }
  .mr-report .kg { display: grid; grid-template-columns: 44px 1.35fr 0.8fr 1.1fr; row-gap: 6px; column-gap: 10px; align-items: end; }
  .mr-report .kg .rl { font-size: 10px; font-weight: 800; color: #0b0b12; background: #d4d4d4; border-radius: 3px; text-align: center; padding: 1px 0; align-self: center; }
  .mr-report .kg .kl { font-size: 10.5px; color: #bdbdbd; font-weight: 700; }
  .mr-report .kg .kv { font-size: 20px; font-weight: 800; line-height: 1.2; white-space: nowrap; }
  .mr-report .chip { display: inline-block; border-radius: 4px; padding: 2px 7px; font-size: 11px; font-weight: 800; color: #ffffff; margin-left: 8px; vertical-align: 4px; }
  .mr-report .j-ok { background: #15803d; }
  .mr-report .j-mid { background: #6b7280; }
  .mr-report .j-ng { background: #b91c1c; }
  .mr-report .r-bar { display: flex; gap: 2px; height: 18px; margin: 10px 0 5px; }
  .mr-report .r-bar div { height: 100%; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; border-radius: 2px; color: #ffffff; overflow: hidden; white-space: nowrap; }
  .mr-report .r-lg { display: flex; gap: 12px; font-size: 10px; color: #d4d4d4; }
  .mr-report .r-lg i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  .mr-report table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 9px; font-size: 10.5px; }
  .mr-report th, .mr-report td { padding: 2.2px 8px; text-align: right; border-bottom: 1px solid #ececec; white-space: nowrap; }
  .mr-report th { font-size: 9.5px; color: #404040; font-weight: 700; }
  .mr-report td.n, .mr-report th.n { text-align: left; font-weight: 800; }
  .mr-report tr.g th { border: 0; padding: 4px 8px; font-size: 10.5px; }
  .mr-report tr.g th.gh { background: #0b0b12; color: #ffffff; text-align: center; border-left: 6px solid #ffffff; }
  .mr-report tr.sh th { background: #ffffff; border-bottom: 1px solid #0b0b12; }
  .mr-report tr.sh th.pl { background: #ededed; }
  .mr-report .sep { border-left: 6px solid #ffffff; }
  .mr-report td.act { font-weight: 800; }
  .mr-report td.pl { background: #ededed; color: #525252; }
  .mr-report td.pc { font-weight: 800; }
  .mr-report tr.grp td { background: #ffffff; font-size: 9px; color: #737373; font-weight: 700; text-align: left; padding: 1px 8px; }
  .mr-report tr.weak td { background: #fef2f2; }
  .mr-report tr.weak td.pl { background: #f3e3e3; }
  .mr-report tr.weak td.n { box-shadow: inset 3px 0 0 #b91c1c; color: #b91c1c; }
  .mr-report .tag { display: inline-block; margin-left: 6px; font-size: 9px; color: #ffffff; background: #b91c1c; border-radius: 3px; padding: 0 4px; vertical-align: 1px; }
  .mr-report .tlg { display: flex; gap: 14px; justify-content: flex-end; font-size: 9px; color: #737373; margin-top: 3px; }
  .mr-report .tlg i { display: inline-block; width: 10px; height: 9px; vertical-align: -1px; margin-right: 4px; border: 1px solid #d4d4d4; }
  .mr-report .r-bottom { flex: 1; display: grid; grid-template-columns: 1.05fr 1fr; gap: 12px; margin-top: 9px; min-height: 0; overflow: hidden; }
  .mr-report .r-chart { display: flex; flex-direction: column; min-height: 0; }
  .mr-report .r-chart svg { flex: 1; width: 100%; min-height: 0; }
  .mr-report .lg2 { display: flex; gap: 12px; font-size: 9.5px; color: #525252; }
  .mr-report .lg2 i { display: inline-block; width: 14px; vertical-align: 3px; margin-right: 4px; }
  .mr-report .issue { border: 1px solid #0b0b12; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  .mr-report .ih { background: #0b0b12; color: #ffffff; font-size: 11.5px; font-weight: 800; padding: 6px 13px; }
  .mr-report .ib { display: grid; grid-template-columns: 62px 1fr; padding: 2px 13px 4px; overflow: hidden; }
  .mr-report .ib > * { padding: 7px 0; border-bottom: 1px solid #ececec; }
  .mr-report .ib > *:nth-last-child(-n + 2) { border-bottom: 0; }
  .mr-report .il { font-size: 10px; font-weight: 800; color: #737373; padding-top: 9px !important; }
  .mr-report .il span { display: block; font-weight: 400; font-size: 9px; }
  .mr-report .it { font-size: 12.5px; font-weight: 800; }
  .mr-report .is { font-size: 10.5px; color: #525252; margin-top: 1px; }
  .mr-report .ix { font-size: 11.5px; }
  .mr-report .ul { margin: 0; padding: 0; list-style: none; font-size: 11.5px; }
  .mr-report .ul li { padding: 1px 0; }
  .mr-report .ul li::before { content: "→ "; font-weight: 800; }
  .mr-report .r-foot { display: flex; justify-content: space-between; gap: 16px; font-size: 9px; color: #8a8a8a; border-top: 1px solid #e5e5e5; padding-top: 5px; margin-top: 9px; }
  .mr-report .r-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #8a8a8a; font-size: 16px; text-align: center; line-height: 1.8; }
</style>

<script>
  import {
    ACTION_CANDIDATES,
    DATA_VERSION,
    emptyTexts,
    SETTLED_THRESHOLD,
    MONTH_FIELDS,
    actionStageKey,
    buildDeadline,
    buildIssue,
    buildTable,
    cumulativeSeries,
    computeReport,
    emptyData,
    fmtMan,
    fmtPct,
    isMonthEntered,
    isMonthTouched,
    missingPlanFields,
    monthLabel,
    monthOf,
    normalizeData,
    planLeadsByMonth,
    type MonthActual,
    type Report,
    type RowKind,
    type TableRow,
    type ReportData,
  } from "@/lib/monthlyReport";

  const STORAGE_KEY = "mktgax-monthly-report-v1";
  const REG_KEY = "mktgax-monthly-report-registered";
  const ATTACH_NAME = "mktgax-monthly-report.json";
  const LIB_PDF = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
  const LIB_CANVAS = "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.0/dist/html2canvas-pro.min.js";

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const esc = (s: string) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

  // ---------- 状態 ----------
  let data: ReportData = loadDraft();

  function loadDraft(): ReportData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeData(JSON.parse(raw));
    } catch {
      /* 保存できない環境では何もしない */
    }
    return emptyData();
  }
  function saveDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* noop */
    }
  }
  function getRegistered(): string | null {
    try {
      return localStorage.getItem(REG_KEY);
    } catch {
      return null;
    }
  }
  function setRegistered(email: string | null) {
    try {
      if (email) localStorage.setItem(REG_KEY, email);
      else localStorage.removeItem(REG_KEY);
    } catch {
      /* noop */
    }
  }

  // ---------- 入力欄の準備 ----------
  const yearSel = $<HTMLSelectElement>("plan-startYear");
  const monthSel = $<HTMLSelectElement>("plan-startMonth");
  const daySel = $<HTMLSelectElement>("plan-reportDay");
  const thisYear = new Date().getFullYear();
  for (let y = thisYear - 2; y <= thisYear + 1; y++) yearSel.add(new Option(`${y}年`, String(y)));
  for (let m = 1; m <= 12; m++) monthSel.add(new Option(`${m}月`, String(m)));
  for (let d = 1; d <= 28; d++) daySel.add(new Option(`${d}日`, String(d)));
  daySel.add(new Option("月末", "31"));

  const reportDayLabel = (d: number) => (d >= 29 ? "毎月 月末" : `毎月 ${d}日`);

  const planNum: { id: string; key: "target" | "annualLeads" | "dealRate" | "winRate" | "avgDeal" | "cycle"; pct?: boolean }[] = [
    { id: "plan-target", key: "target" },
    { id: "plan-annualLeads", key: "annualLeads" },
    { id: "plan-dealRate", key: "dealRate", pct: true },
    { id: "plan-winRate", key: "winRate", pct: true },
    { id: "plan-avgDeal", key: "avgDeal" },
    { id: "plan-cycle", key: "cycle" },
  ];

  const toNum = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const showNum = (n: number | null, pct = false) => {
    if (n === null) return "";
    const v = pct ? Math.round(n * 100 * 1000) / 1000 : n;
    return String(v);
  };

  function fillPlanInputs() {
    const p = data.plan;
    if (![...yearSel.options].some((o) => o.value === String(p.startYear))) yearSel.add(new Option(`${p.startYear}年`, String(p.startYear)));
    yearSel.value = String(p.startYear);
    monthSel.value = String(p.startMonth);
    daySel.value = String(p.reportDay >= 29 ? 31 : p.reportDay);
    for (const f of planNum) $<HTMLInputElement>(f.id).value = showNum(p[f.key], f.pct);
    renderMonthlyPlanInputs();
  }

  function renderMonthlyPlanInputs() {
    const box = $("plan-monthly");
    const auto = planLeadsByMonth(data.plan);
    box.innerHTML = data.plan.monthlyLeads
      .map((v, i) => {
        const { month } = monthOf(data.plan, i);
        const ph = data.plan.annualLeads ? String(Math.round(auto[i] * 10) / 10) : "";
        return `<label class="mr-field"><span class="mr-help">${month}月</span><input class="mr-input" data-ml="${i}" type="number" inputmode="numeric" min="0" step="1" value="${v === null ? "" : v}" placeholder="${ph}" /></label>`;
      })
      .join("");
  }

  function updateMonthlyPlaceholders() {
    const auto = planLeadsByMonth(data.plan);
    document.querySelectorAll<HTMLInputElement>("[data-ml]").forEach((el) => {
      const i = Number(el.dataset.ml);
      el.placeholder = data.plan.annualLeads ? String(Math.round(auto[i] * 10) / 10) : "";
    });
  }

  yearSel.addEventListener("change", () => {
    data.plan.startYear = Number(yearSel.value);
    renderMonthlyPlanInputs();
    update();
  });
  monthSel.addEventListener("change", () => {
    data.plan.startMonth = Number(monthSel.value);
    renderMonthlyPlanInputs();
    update();
  });
  daySel.addEventListener("change", () => {
    data.plan.reportDay = Number(daySel.value);
    update();
  });
  for (const f of planNum) {
    $<HTMLInputElement>(f.id).addEventListener("input", (e) => {
      const n = toNum((e.target as HTMLInputElement).value);
      data.plan[f.key] = n === null ? null : f.pct ? n / 100 : n;
      if (f.key === "annualLeads") updateMonthlyPlaceholders();
      update();
    });
  }
  $("plan-monthly").addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.ml) return;
    data.plan.monthlyLeads[Number(el.dataset.ml)] = toNum(el.value);
    updateMonthlyPlaceholders();
    update();
  });

  // 毎月の数字
  function renderMonthChips() {
    const box = $("mr-month-chips");
    box.innerHTML = data.months
      .map((m, i) => {
        const { month } = monthOf(data.plan, i);
        const sel = i === data.reportIndex;
        return `<button type="button" class="mr-chip" role="radio" aria-checked="${sel}" data-mi="${i}" data-entered="${isMonthEntered(m) ? 1 : 0}" title="${monthLabel(data.plan, i)}">${month}月</button>`;
      })
      .join("");
  }
  $("mr-month-chips").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-mi]");
    if (!btn) return;
    data.reportIndex = Number(btn.dataset.mi);
    data.texts = { ...emptyTexts(), ask: data.texts.ask };
    fillMonthInputs();
    update();
  });

  function fillMonthInputs() {
    const m = data.months[data.reportIndex];
    for (const f of MONTH_FIELDS) $<HTMLInputElement>(`m-${f}`).value = showNum(m[f]);
  }
  for (const f of MONTH_FIELDS) {
    $<HTMLInputElement>(`m-${f}`).addEventListener("input", (e) => {
      const n = toNum((e.target as HTMLInputElement).value);
      (data.months[data.reportIndex] as MonthActual)[f] = n === null ? null : Math.max(0, n);
      update();
    });
  }

  // ---------- 打ち手・一文 ----------
  function syncActions(r: Report) {
    const key = actionStageKey(r);
    if (data.actions.stage !== key || data.actions.items.length === 0) {
      data.actions = { stage: key, items: ACTION_CANDIDATES[key].map((text) => ({ text, checked: true })) };
    }
  }

  function renderActionsEditor(r: Report | null) {
    const lead = $("mr-actions-lead");
    const box = $("mr-actions");
    if (!r) {
      lead.textContent = "計画と今月の数字を入れると、足りない段階に合わせた候補が出ます。";
      box.innerHTML = "";
      delete box.dataset.sig;
      return;
    }
    const key = actionStageKey(r);
    lead.textContent =
      key === "ok"
        ? "すべての段階が90%以上です。"
        : `足りない段階は「${r.weakStage!.name}」です。報告に載せる打ち手を選び、言葉を直せます。`;
    // 入力中のテキストを壊さないよう、項目が変わったときだけ描き直す
    const sig = `${key}:${data.actions.items.length}`;
    if (box.dataset.sig === sig && box.children.length === data.actions.items.length) return;
    box.dataset.sig = sig;
    box.innerHTML = data.actions.items
      .map(
        (a, i) => `<div class="flex items-center gap-2">
          <input type="checkbox" data-ac="${i}" ${a.checked ? "checked" : ""} aria-label="打ち手${i + 1}を報告に載せる" />
          <input type="text" class="mr-input" data-at="${i}" value="${esc(a.text)}" aria-label="打ち手${i + 1}" />
        </div>`,
      )
      .join("");
  }
  $("mr-actions").addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.at) data.actions.items[Number(el.dataset.at)].text = el.value;
    if (el.dataset.ac) data.actions.items[Number(el.dataset.ac)].checked = el.checked;
    update();
  });
  $("mr-actions").addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.ac) {
      data.actions.items[Number(el.dataset.ac)].checked = el.checked;
      update();
    }
  });

  const issueEl = $<HTMLInputElement>("mr-issue");
  const deadlineEl = $<HTMLInputElement>("mr-deadline");
  const askEl = $<HTMLInputElement>("mr-ask");
  issueEl.addEventListener("input", () => {
    data.texts.issue = { text: issueEl.value, edited: true };
    update();
  });
  deadlineEl.addEventListener("input", () => {
    data.texts.deadline = { text: deadlineEl.value, edited: true };
    update();
  });
  askEl.addEventListener("input", () => {
    data.texts.ask = askEl.value;
    update();
  });

  const selectedActions = () => data.actions.items.filter((a) => a.checked && a.text.trim()).map((a) => a.text.trim());

  // ---------- 報告書 ----------
  function judgeClass(j: string | null) {
    return j === "達成" ? "j-ok" : j === "やや届かない" ? "j-mid" : "j-ng";
  }
  function ratioClass(r: number | null) {
    return r === null ? "na" : r >= 1 ? "ok" : r >= 0.9 ? "mid" : "ng";
  }
  const fmtNum = (v: number) => Math.round(v).toLocaleString("ja-JP");
  const sign = (d: number) => (d > 0 ? "+" : d < 0 ? "−" : "±");
  function cellValue(kind: RowKind, v: number | null) {
    if (v === null) return "—";
    if (kind === "rate") return `${(v * 100).toFixed(1)}%`;
    return fmtNum(v);
  }
  const pct = (r: number | null) => `<b class="${ratioClass(r)}">${r === null ? "—" : fmtPct(r)}</b>`;
  function cellDiff(kind: RowKind, cur: number | null, prev: number | null) {
    if (cur === null || prev === null) return "—";
    if (kind === "rate") {
      const d = (cur - prev) * 100;
      return `${sign(d)}${Math.abs(d).toFixed(1)}pt`;
    }
    const d = cur - prev;
    if (prev > 0) {
      const p = Math.round((d / prev) * 100);
      return `${sign(p)}${Math.abs(p)}%`;
    }
    return `${sign(d)}${fmtNum(Math.abs(d))}`;
  }

  function chartSvg(r: Report): string {
    const s = cumulativeSeries(data, r);
    const W = 580;
    const H = 200;
    const L = 46;
    const R = 104;
    const T = 10;
    const B = 22;
    const max = Math.max(r.target, r.landing, ...s.planCum, ...s.actualCum.map((v) => v ?? 0)) * 1.08 || 1;
    const x = (i: number) => L + ((W - L - R) / 11) * i;
    const y = (v: number) => T + (H - T - B) * (1 - v / max);
    const step = (W - L - R) / 11;
    const axis = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}億` : v > 0 ? `${fmtNum(v)}万` : "0");
    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => `<line x1="${L}" x2="${W - R + 4}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#ececec"/><text x="${L - 6}" y="${y(max * f) + 3}" font-size="9" fill="#8a8a8a" text-anchor="end">${axis(max * f)}</text>`)
      .join("");
    const bars = s.monthly
      .map((v, i) => (v === null || v <= 0 ? "" : `<rect x="${x(i) - step * 0.3}" y="${y(v)}" width="${step * 0.6}" height="${y(0) - y(v)}" fill="#e2e2e2"/>`))
      .join("");
    const planPts = s.planCum.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const actPts = s.actualCum.flatMap((v, i) => (v === null ? [] : [`${x(i)},${y(v)}`])).join(" ");
    const dots = s.actualCum.map((v, i) => (v === null ? "" : `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="#0b0b12"/>`)).join("");
    const lastA = s.actualCum[r.index] ?? 0;
    const fc =
      r.index < 11
        ? `<polyline points="${x(r.index)},${y(lastA)} ${x(11)},${y(r.landing)}" fill="none" stroke="#b91c1c" stroke-width="2" stroke-dasharray="4 3"/><circle cx="${x(11)}" cy="${y(r.landing)}" r="3.5" fill="#b91c1c"/>`
        : "";
    const labels = Array.from(
      { length: 12 },
      (_, i) =>
        `<text x="${x(i)}" y="${H - 6}" font-size="9" fill="${i === r.index ? "#0b0b12" : "#8a8a8a"}" font-weight="${i === r.index ? 700 : 400}" text-anchor="middle">${monthOf(data.plan, i).month}月</text>`,
    ).join("");
    let yPlan = y(s.planCum[11]);
    let yLand = y(r.landing);
    if (Math.abs(yPlan - yLand) < 24) {
      if (yPlan <= yLand) yLand = yPlan + 24;
      else yPlan = yLand + 24;
    }
    const ex = x(11) + 8;
    const endLabels = `<text x="${ex}" y="${yPlan - 2}" font-size="9.5" fill="#6b7280">計画</text><text x="${ex}" y="${yPlan + 10}" font-size="10" font-weight="700" fill="#6b7280">${esc(fmtMan(s.planCum[11]))}</text>${
      r.index < 11
        ? `<text x="${ex}" y="${yLand - 2}" font-size="9.5" fill="#b91c1c">着地見込み</text><text x="${ex}" y="${yLand + 10}" font-size="10" font-weight="700" fill="#b91c1c">${esc(fmtMan(r.landing))}</text>`
        : ""
    }`;
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" font-family="Noto Sans JP, sans-serif">${grid}${bars}<polyline points="${planPts}" fill="none" stroke="#9ca3af" stroke-width="1.5"/><polyline points="${actPts}" fill="none" stroke="#0b0b12" stroke-width="2.5"/>${dots}${fc}${labels}${endLabels}</svg>`;
  }

  function reportHtml(r: Report | null, problems: string[]): string {
    const p = data.plan;
    const today = new Date();
    const made = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
    const head = `<div class="r-head">
        <div><p class="r-title">マーケティング月次報告　${r ? esc(r.label) : ""}</p>
        <p class="r-sub">期間 ${esc(monthLabel(p, 0))}〜${esc(monthLabel(p, 11))}${r ? `（${r.monthNo}か月目）` : ""}・数字はすべてマーケ起点</p></div>
        <div class="r-meta">作成日 ${made}<br />単位：万円・件</div>
      </div>`;
    const footLeft = (extra: string) =>
      `着地見込み＝受注済みの累計＋進行中の商談×受注率＋期内に受注できる新規分（計画）。${extra}`;
    if (!r) {
      return `<div class="mr-report">${head}<div class="r-empty">${problems.map(esc).join("<br />")}</div><div class="r-foot"><span>${footLeft("")}</span><span>MKTG.AX マーケ月次報告メーカー｜mktg.ax/tools/monthly-report</span></div></div>`;
    }

    const rows = buildTable(data, r);
    const row = (k: string) => rows.find((x) => x.key === k)!;
    const cur = data.months[r.index];
    const mName = `${monthOf(p, r.index).month}月`;

    // 今月の動き（件数と金額を分ける）
    const ld = row("leads");
    const dc = row("deals");
    const da = row("dealAmt");
    const wa = row("winAmt");
    const prevDeals = dc.month.prev;
    const moves = `<div class="r-box"><p class="r-h">今月（${mName}）の動き<small>計画比・前月比</small></p>
      <div class="r-cells">
        <div class="r-cell"><p class="l">新規リード</p><p class="v">${fmtNum(ld.month.actual ?? 0)}件</p>
          <p class="s">計画比 ${pct(ld.month.ratio)}・前月比 ${cellDiff("count", ld.month.actual, ld.month.prev)}</p></div>
        <div class="r-cell"><p class="l">新規商談</p><p class="v">${fmtNum(dc.month.actual ?? 0)}件<span>${fmtMan(da.month.actual ?? 0)}</span></p>
          <p class="s">計画比 ${pct(dc.month.ratio)}・前月比 ${prevDeals === null ? "—" : `${sign((dc.month.actual ?? 0) - prevDeals)}${fmtNum(Math.abs((dc.month.actual ?? 0) - prevDeals))}件／${cellDiff("amount", da.month.actual, da.month.prev)}`}</p></div>
        <div class="r-cell"><p class="l">受注</p><p class="v">${fmtNum(cur.wins ?? 0)}件<span>${fmtMan(wa.month.actual ?? 0)}</span></p>
          <p class="s">計画比 ${pct(wa.month.ratio)}・前月比 ${cellDiff("amount", wa.month.actual, wa.month.prev)}</p></div>
        <div class="r-cell"><p class="l">失注</p><p class="v">${fmtNum(cur.lost ?? 0)}件<span>${fmtMan(cur.lostAmt ?? 0)}</span></p>
          <p class="s">月末に進行中の商談 ${fmtMan(r.open)}</p></div>
      </div></div>`;

    // 実績と見込み（黒い枠）
    const progress = r.target > 0 ? r.cum.winAmt / r.target : 0;
    const base = Math.max(r.target, r.landing) || 1;
    const seg = (v: number, bg: string, fg: string, label: string, extra = "") => {
      const w = (v / base) * 100;
      return w <= 0 ? "" : `<div style="width:${w}%;background:${bg};color:${fg};${extra}">${w >= 6 ? label : ""}</div>`;
    };
    const segPct = (v: number) => (r.target > 0 ? fmtPct(v / r.target) : "");
    const lack = Math.max(0, r.target - r.landing);
    const bar = `<div class="r-bar">${seg(r.cum.winAmt, "#ffffff", "#0b0b12", segPct(r.cum.winAmt))}${seg(r.openExpected, "#a3a3a3", "#0b0b12", segPct(r.openExpected))}${seg(r.futureNew, "#5b5b66", "#ffffff", segPct(r.futureNew))}${seg(lack, "transparent", "#f87171", `不足 ${segPct(lack)}`, "border:1px dashed #f87171;")}</div>`;
    const wrLabel = `受注率${fmtPct(r.winRateUsed)}${r.winRateSource === "plan" ? "（計画）" : ""}`;
    const gapCell =
      r.shortfall > 0
        ? `<div><p class="kl">計画まで</p><p class="kv" style="color:#f87171">${fmtMan(r.shortfall)}</p></div>`
        : `<div><p class="kl">計画を上回る</p><p class="kv" style="color:#86efac">${fmtMan(r.landing - r.target)}</p></div>`;
    const dark = `<div class="r-dark">
        <div class="kg">
          <p class="rl">実績</p>
          <div><p class="kl">期首からの受注</p><p class="kv">${fmtMan(r.cum.winAmt)}</p></div>
          <div><p class="kl">年間目標の</p><p class="kv">${fmtPct(progress)}</p></div>
          <div><p class="kl">年間目標</p><p class="kv">${fmtMan(r.target)}</p></div>
          <p class="rl">見込み</p>
          <div><p class="kl">期末の着地見込み</p><p class="kv">${fmtMan(r.landing)}<span class="chip ${judgeClass(r.judge)}">${r.judge}</span></p></div>
          <div><p class="kl">計画比</p><p class="kv">${fmtPct(r.ratio)}</p></div>
          ${gapCell}
        </div>
        ${bar}
        <div class="r-lg"><span><i style="background:#ffffff"></i>受注済み ${fmtNum(r.cum.winAmt)}</span><span><i style="background:#a3a3a3"></i>進行中の商談×${wrLabel} ${fmtNum(r.openExpected)}</span><span><i style="background:#5b5b66"></i>期内に受注できる新規分 ${fmtNum(r.futureNew)}</span><span style="margin-left:auto">年間目標＝100%</span></div>
      </div>`;

    // 予実表（件数・率／金額）
    const weakKey = r.weakStage?.key;
    const rowHtml = (x: TableRow) => {
      const weak = !!x.stage && x.stage === weakKey;
      const flow = x.kind === "count" || x.kind === "amount";
      const cumRatio = x.cum.ratio === null && x.cum.note ? `<span class="na">判定前</span>` : pct(x.cum.ratio);
      return `<tr class="${weak ? "weak" : ""}">
          <td class="n">${x.name}${weak ? `<span class="tag">足りない段階</span>` : ""}</td>
          <td class="sep act">${cellValue(x.kind, x.month.actual)}</td><td class="pl">${cellValue(x.kind, x.month.plan)}</td><td class="pc">${pct(x.month.ratio)}</td><td>${cellDiff(x.kind, x.month.actual, x.month.prev)}</td>
          <td class="sep act">${cellValue(x.kind, x.cum.actual)}</td><td class="pl">${cellValue(x.kind, x.cum.plan)}</td><td class="pc">${cumRatio}</td>
          <td class="sep pl">${cellValue(x.kind, x.annual.plan)}</td><td class="pc">${flow && x.annual.progress !== null ? `<b>${fmtPct(x.annual.progress)}</b>` : "—"}</td>
        </tr>`;
    };
    const order1 = ["leads", "deals", "dealRate", "wins", "winRate"];
    const order2 = ["dealAmt", "winAmt", "unitPrice"];
    const table = `<table>
        <thead>
          <tr class="g"><th class="n"></th><th colspan="4" class="gh">今月（${mName}）</th><th colspan="3" class="gh">期首からの累計</th><th colspan="2" class="gh">年間</th></tr>
          <tr class="sh"><th class="n">項目</th><th class="sep">実績</th><th class="pl">計画</th><th>達成率</th><th>前月比</th><th class="sep">実績</th><th class="pl">計画</th><th>達成率</th><th class="sep pl">計画</th><th>進捗率</th></tr>
        </thead>
        <tbody>
          <tr class="grp"><td colspan="10">件数・率</td></tr>${order1.map((k) => rowHtml(row(k))).join("")}
          <tr class="grp"><td colspan="10">金額（万円）</td></tr>${order2.map((k) => rowHtml(row(k))).join("")}
        </tbody>
      </table>
      <p class="tlg"><span><i style="background:#ededed"></i>計画（毎月変わらない）</span><span><i style="background:#fef2f2;border-color:#f3b4b4"></i>足りない段階</span><span>達成率：<b class="ok">緑＝100%以上</b>／<b class="mid">灰＝90%以上</b>／<b class="ng">赤＝90%未満</b></span></p>`;

    // 推移グラフ
    const chart = `<div class="r-box r-chart"><p class="r-h">受注金額の累計の推移と着地見込み</p>
        <p class="lg2"><span><i style="border-top:2.5px solid #0b0b12"></i>実績の累計</span><span><i style="border-top:1.5px solid #9ca3af"></i>計画の累計</span><span><i style="border-top:2px dashed #b91c1c"></i>着地見込み</span><span><i style="border-top:8px solid #e2e2e2;width:9px"></i>月の受注金額</span></p>
        ${chartSvg(r)}
      </div>`;

    // 足りない段階と打ち手
    const issue = buildIssue(r);
    const deadline = buildDeadline(r, p);
    const acts = selectedActions();
    const ask = data.texts.ask.trim();
    const issueBox = `<div class="issue"><p class="ih">${r.weakStage ? "足りない段階と打ち手" : "段階の達成状況と打ち手"}</p>
        <div class="ib">
          <p class="il">課題</p><div><p class="it">${esc(data.texts.issue.text)}</p>${issue.sub ? `<p class="is">${esc(issue.sub)}</p>` : ""}</div>
          <p class="il">打ち手</p><ul class="ul">${acts.length ? acts.map((a) => `<li>${esc(a)}</li>`).join("") : "<li>—</li>"}</ul>
          <p class="il">期限</p><div><p class="it">${esc(data.texts.deadline.text)}</p>${deadline.sub ? `<p class="is">${esc(deadline.sub)}</p>` : ""}</div>
          ${ask ? `<p class="il">お願い</p><div><p class="ix">${esc(ask)}</p></div>` : ""}
        </div>
      </div>`;

    const extras: string[] = [];
    if (r.revenue) extras.push(`全社の売上のうちマーケ起点は${fmtPct(r.revenue.share, 1)}（参考）。`);
    if (r.winRateSource === "plan") extras.push(`進行中の商談の受注率は、決着した商談が${SETTLED_THRESHOLD}件たまるまで計画の値。`);

    return `<div class="mr-report">${head}
        <div class="r-top">${moves}${dark}</div>
        ${table}
        <div class="r-bottom">${chart}${issueBox}</div>
        <div class="r-foot"><span>${esc(footLeft(extras.join("")))}</span><span>MKTG.AX マーケ月次報告メーカー｜mktg.ax/tools/monthly-report</span></div>
      </div>`;
  }

  // ---------- 描画 ----------
  let lastReport: Report | null = null;

  function problemsOf(): string[] {
    const probs: string[] = [];
    const miss = missingPlanFields(data.plan);
    if (miss.length) probs.push(`STEP 1 の「${miss.join("」「")}」を入れてください。`);
    const m = data.months[data.reportIndex];
    if (!isMonthEntered(m)) probs.push(`STEP 2 で ${monthLabel(data.plan, data.reportIndex)} の数字を入れてください（全社の売上以外）。`);
    return probs;
  }

  function update() {
    const probs = problemsOf();
    const r = probs.length === 0 ? computeReport(data) : null;
    lastReport = r;

    if (r) {
      syncActions(r);
      if (!data.texts.issue.edited) data.texts.issue.text = buildIssue(r).main;
      if (!data.texts.deadline.edited) data.texts.deadline.text = buildDeadline(r, data.plan).main;
    }
    for (const [el, v] of [
      [issueEl, data.texts.issue.text],
      [deadlineEl, data.texts.deadline.text],
      [askEl, data.texts.ask],
    ] as [HTMLInputElement, string][]) {
      if (document.activeElement !== el) el.value = v;
      el.disabled = !r;
    }
    renderActionsEditor(r);

    // 注意書き
    const notice = $("mr-notice");
    const notes: string[] = [...probs];
    if (r && r.missingMonths.length > 0) {
      notes.push(`${r.missingMonths.join("・")} の数字が入っていません（0として計算しています）。前回のPDFを読み込むか、月を選んで入力してください。`);
    }
    notice.innerHTML = notes.map(esc).join("<br />");
    notice.classList.toggle("hidden", notes.length === 0);

    // 計画の状態
    const ps = $("mr-plan-status");
    const planMiss = missingPlanFields(data.plan).length;
    ps.textContent = planMiss ? `未入力 ${planMiss}項目` : "入力済み ✓";
    ps.style.color = planMiss ? "#b45309" : "#15803d";

    renderMonthChips();
    $("reg-reportday").textContent = reportDayLabel(data.plan.reportDay);
    $("mr-preview-scale").innerHTML = reportHtml(r, probs);
    fitPreview();
    setDownloadEnabled(!!r);
    saveDraft();
  }

  function fitPreview() {
    const wrap = $("mr-preview-wrap");
    const inner = $("mr-preview-scale");
    const s = wrap.clientWidth / 1123;
    inner.style.transform = `scale(${s})`;
    inner.style.width = "1123px";
    wrap.style.height = `${794 * s}px`;
  }
  window.addEventListener("resize", fitPreview);

  function setDownloadEnabled(ok: boolean) {
    ($("reg-submit") as HTMLButtonElement).disabled = !ok;
    ($("mr-download-btn") as HTMLButtonElement).disabled = !ok;
    ($("reg-submit") as HTMLButtonElement).title = ok ? "" : "STEP 1・2 の数字を入れると押せます";
    ($("mr-download-btn") as HTMLButtonElement).title = ok ? "" : "STEP 1・2 の数字を入れると押せます";
  }

  // ---------- ライブラリ ----------
  const loaded: Record<string, Promise<void>> = {};
  function loadScript(src: string) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
          delete loaded[src];
          reject(new Error(`ライブラリを読み込めませんでした: ${src}`));
        };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  // ---------- PDFを作る ----------
  async function makePdf(): Promise<void> {
    if (!lastReport) throw new Error("STEP 1・2 の数字を入れてください。");
    await Promise.all([loadScript(LIB_PDF), loadScript(LIB_CANVAS)]);
    const w = window as any;
    const h2c = w.html2canvas?.default || w.html2canvas;
    const PDFLib = w.PDFLib;

    // 縮小表示していない報告書を画面外に置いて画像にする
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-20000px;top:0;width:1123px;height:794px;z-index:-1;";
    holder.innerHTML = reportHtml(lastReport, []);
    document.body.appendChild(holder);
    let canvas: HTMLCanvasElement;
    try {
      if ((document as any).fonts?.ready) await (document as any).fonts.ready;
      canvas = await h2c(holder.firstElementChild, { scale: 2, backgroundColor: "#ffffff", width: 1123, height: 794, logging: false });
    } finally {
      holder.remove();
    }
    const pngBytes = await new Promise<ArrayBuffer>((resolve, reject) =>
      canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error("画像を作れませんでした"))), "image/png"),
    );

    const pdf = await PDFLib.PDFDocument.create();
    const W = 841.89;
    const H = 595.28; // A4横（pt）
    const page = pdf.addPage([W, H]);
    const img = await pdf.embedPng(pngBytes);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
    pdf.setTitle(`マーケティング月次報告 ${lastReport.label}`);
    pdf.setCreator("MKTG.AX マーケ月次報告メーカー（mktg.ax/tools/monthly-report）");
    pdf.setProducer("MKTG.AX");
    pdf.setLanguage("ja-JP");

    const payload = { ...data, v: DATA_VERSION, email: getRegistered() || undefined };
    await pdf.attach(new TextEncoder().encode(JSON.stringify(payload)), ATTACH_NAME, {
      mimeType: "application/json",
      description: "マーケ月次報告メーカーの入力データ（次回このPDFを読み込むと前月までの数字が入ります）",
      creationDate: new Date(),
      modificationDate: new Date(),
    });
    const bytes: Uint8Array = await pdf.save({ useObjectStreams: false });

    const { year, month } = monthOf(data.plan, data.reportIndex);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `marketing-monthly-report-${year}-${String(month).padStart(2, "0")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------- PDFを読む ----------
  async function readPdfData(file: File): Promise<any> {
    await loadScript(LIB_PDF);
    const PDFLib = (window as any).PDFLib;
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, decodePDFRawStream } = PDFLib;
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
    const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    const ef = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
    if (!ef) return null;

    const pairs: [string, any][] = [];
    const walk = (node: any) => {
      const arr = node.lookupMaybe(PDFName.of("Names"), PDFArray);
      if (arr) for (let i = 0; i + 1 < arr.size(); i += 2) pairs.push([arr.lookup(i).decodeText?.() ?? "", arr.lookup(i + 1, PDFDict)]);
      const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
      if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i, PDFDict));
    };
    walk(ef);
    const hit = pairs.find(([n]) => n === ATTACH_NAME) || pairs[0];
    if (!hit) return null;
    const efDict = hit[1].lookupMaybe(PDFName.of("EF"), PDFDict);
    const stream = efDict?.lookupMaybe(PDFName.of("F"), PDFStream);
    if (!stream) return null;
    const raw = decodePDFRawStream(stream).decode();
    return JSON.parse(new TextDecoder().decode(raw));
  }

  const loadMsg = $("mr-load-msg");
  function showMsg(el: HTMLElement, text: string, ok: boolean) {
    el.textContent = text;
    el.style.color = ok ? "#15803d" : "#b91c1c";
    el.classList.remove("hidden");
  }

  $<HTMLInputElement>("mr-pdf-input").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    showMsg(loadMsg, "読み込んでいます…", true);
    try {
      const raw = await readPdfData(file);
      if (!raw || !raw.plan || !Array.isArray(raw.months)) {
        showMsg(loadMsg, "このPDFには入力データが見つかりませんでした。別のソフトで保存し直したPDFは読み込めないことがあります。お手数ですが手で入力してください。", false);
        return;
      }
      data = normalizeData(raw);
      // 次の月へ進める（数字の入った最後の月の翌月）
      let last = -1;
      data.months.forEach((m, i) => {
        if (isMonthTouched(m)) last = i;
      });
      data.reportIndex = Math.min(11, last + 1);
      data.actions = { stage: "", items: [] };
      data.texts = emptyTexts();
      if (data.email && !getRegistered()) setRegistered(data.email);
      fillPlanInputs();
      fillMonthInputs();
      renderRegistration();
      update();
      const lastLabel = last >= 0 ? monthLabel(data.plan, last) : "";
      showMsg(
        loadMsg,
        last >= 0 ? `${lastLabel}までの数字を読み込みました。${monthLabel(data.plan, data.reportIndex)}の数字を入れてください。` : "計画を読み込みました。",
        true,
      );
    } catch (err) {
      console.error(err);
      showMsg(loadMsg, "PDFを読み込めませんでした。このツールで作ったPDFか確かめてください。", false);
    }
  });

  // ---------- 登録とダウンロード ----------
  function renderRegistration() {
    const email = getRegistered();
    $("mr-register-form").classList.toggle("hidden", !!email);
    $("mr-registered").classList.toggle("hidden", !email);
    $("mr-registered-email").textContent = email || "";
  }

  $("mr-reregister").addEventListener("click", () => {
    setRegistered(null);
    renderRegistration();
  });

  $("mr-register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("reg-msg");
    const btn = $<HTMLButtonElement>("reg-submit");
    const emailEl = $<HTMLInputElement>("reg-email");
    const email = emailEl.value.trim();
    const consent = $<HTMLInputElement>("reg-consent").checked;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailEl.classList.add("mr-invalid");
      showMsg(msg, "メールアドレスを確かめてください。", false);
      return;
    }
    emailEl.classList.remove("mr-invalid");
    if (!consent) {
      showMsg(msg, "プライバシーポリシーへの同意にチェックを入れてください。", false);
      return;
    }
    btn.disabled = true;
    showMsg(msg, "登録しています…", true);
    try {
      const res = await fetch("/api/monthly-report-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          reportDay: data.plan.reportDay,
          consent: true,
          website: $<HTMLInputElement>("reg-website").value,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "登録に失敗しました。時間をおいて再度お試しください。");
      setRegistered(email);
      showMsg(msg, "登録しました。PDFを作っています…", true);
      await makePdf();
      renderRegistration();
      showMsg($("mr-download-msg"), "PDFをダウンロードしました。", true);
    } catch (err: any) {
      showMsg(msg, err?.message || "エラーが発生しました。", false);
    } finally {
      btn.disabled = !lastReport;
    }
  });

  $("mr-download-btn").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("mr-download-btn");
    const msg = $("mr-download-msg");
    btn.disabled = true;
    showMsg(msg, "PDFを作っています…", true);
    try {
      await makePdf();
      showMsg(msg, "PDFをダウンロードしました。", true);
    } catch (err: any) {
      console.error(err);
      showMsg(msg, err?.message || "PDFを作れませんでした。", false);
    } finally {
      btn.disabled = !lastReport;
    }
  });

  // ---------- 初期化 ----------
  // 下書きがなければ、今日が含まれる月を報告する月にする（期首からの月数）
  if (!data.months.some(isMonthTouched)) {
    const now = new Date();
    const diff = (now.getFullYear() - data.plan.startYear) * 12 + (now.getMonth() + 1 - data.plan.startMonth) - 1;
    data.reportIndex = Math.min(11, Math.max(0, diff));
  }
  fillPlanInputs();
  fillMonthInputs();
  renderRegistration();
  update();
</script>
