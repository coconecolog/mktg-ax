---
// src/pages/tools/kpi-check.astro
//
// KPI運用チェッカー（/tools/kpi-check）の入口。
// 仕様: Googleドライブ「MKTG.AX／共有（正本）／04_ツール仕様／KPI運用チェッカー 仕様」（2026-10-18）
// 2026-10-23 改修：1ページの作りをやめ、ステップごとのページに分けた。
// - ① 初回：/tools/kpi-check/setup/1〜6（KPIツリー → 施策と期間 → 施策のKPI → 費用と撤退（任意）→ 判定 → PDF）
// - ② 毎月：/tools/kpi-check/monthly/1〜5（準備 → 施策ごとの実績 → 全体の数字 → 判定 → PDF）
// - 画面は src/scripts/kpi-check/app.ts、PDFは src/scripts/kpi-check/pdf.ts、計算と判定は src/lib/kpiCheck.ts
// - 「得られるもの」の見本（判定画面・PDFのサムネイル）の見せ方は、あとで決める
import BaseLayout from "@/layouts/BaseLayout.astro";
import ToolFooter from "@/components/ToolFooter.astro";
import "@/styles/kpi-check.css";

const TOOL_TITLE = "KPI運用チェッカー";
const TOOL_DESCRIPTION =
  "KPIツリーと施策を入れると目標の妥当性を判定し、毎月は実績を入れると達成・未達、次の打ち手（出典つき）、撤退の判断を出す無料ツールです。結果はA4横のPDFで出せます。";
---

<BaseLayout title={`${TOOL_TITLE}｜KPIの妥当性と月次の打ち手・撤退を判定｜MKTG.AX`} description={TOOL_DESCRIPTION} ogImage="/open-graph/tools/kpi-check.png">
  <div id="kc-hub" class="kc">
    <p class="kc-hint" style="margin:0 0 6px !important;letter-spacing:0.08em"><a href="/tools" style="color:inherit;text-decoration:none">便利ツール</a></p>
    <h1 class="kc-h" style="font-size:1.8rem">{TOOL_TITLE}</h1>
    <p class="kc-lead" style="font-size:1rem">KPIツリーが妥当かを判定し、毎月は実績を入れるだけで、未達のKPI・次の打ち手・撤退の判断を出します。</p>
    <p class="kc-hint">無料・入力した数字はサーバーに送りません（計算はすべてブラウザの中）・結果はA4横のPDFで出せます（PDFの出力にはメール登録が必要）</p>

    <div class="kc-resume" id="kc-resume" hidden></div>

    <div class="kc-hub-ent">
      <div class="kc-ent">
        <span class="no">① 初めて使う・期のはじめ</span>
        <b>KPIの妥当性をチェックする</b>
        <p>売上目標と施策ごとのKPIを入れると、リードの過不足や、受注とつながらないKPIなどを判定します。空欄は一般的な値で計算するので、わかるところだけで進められます。</p>
        <p class="meta">全6ステップ・目安10分</p>
        <a class="kc-btn" href="/tools/kpi-check/setup/1"><span>はじめる</span><span aria-hidden="true">→</span></a>
      </div>
      <div class="kc-ent">
        <span class="no">② 毎月の管理日に</span>
        <b>毎月の実績を判定する</b>
        <p>前回のPDFを読み込み、今月の実績を入れると、達成・未達と次の打ち手（出典つき）、撤退の判断を出します。</p>
        <p class="meta">全5ステップ・目安5分</p>
        <a class="kc-btn2" href="/tools/kpi-check/monthly/1"><span>はじめる</span><span aria-hidden="true">→</span></a>
      </div>
    </div>

    <div class="kc-try">
      <span><b>まず、サンプルで結果を見る</b>架空の会社の数字で、判定の画面をすぐに開きます（あなたの入力は消えません）</span>
      <span style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="kc-btn2" href="/tools/kpi-check/setup/5?sample=1">初回の判定を見る →</a>
        <a class="kc-btn2" href="/tools/kpi-check/monthly/4?sample=1">毎月の判定を見る →</a>
      </span>
    </div>
  </div>

  <ToolFooter path="/tools/kpi-check" />
</BaseLayout>

<script>
  import "@/scripts/kpi-check/app";
</script>
