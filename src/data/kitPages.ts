// src/data/kitPages.ts
//
// 診断系Kitの画面の文言（2026-11-01）。画面の形は予算案診断Kitで決めた形（3ステップ：入力 → 診断・修正 → 最終チェック・ダウンロード → 完了）を共通の部品
// （src/components/kit-flow/）にし、Kitごとに違う文言・リンクだけをここに持つ。計算・判定・Excelの違いは src/lib/planKits.ts。
// 対象：予算案診断Kit（budget）・KPI妥当性診断Kit（kpi）・予算作成Kit（make）・KPI管理表作成Kit（kpimake）。施策効果診断Kit（effect。計算は src/lib/effectCheck.ts）
import type { KitId } from "@/lib/planKits";

export interface KitPage {
  /** Kitの名前（H1） */
  title: string;
  /** H1の下の問いかけ（1行） */
  question: string;
  /** 問いかけの下の説明（HTML可：<b> だけ使う） */
  lead: string;
  /** H1まわりの下の一言（中の画面のH1の下） */
  catch: string;
  /** ページの title・description */
  metaTitle: string;
  description: string;
  ogImage: string;
  /** planKits にないKit（施策効果診断Kit）だけ：出力する資料・入口のURL・入口の右の見本の画像・必要な数字の行 */
  doc?: string;
  path?: string;
  demoImg?: string;
  needRows?: [string, string[]][];
  needNote?: string;
  /** 3ステップの名前（省略時：入力する／診断して直す／ダウンロード） */
  stepTitles?: [string, string, string];
  /** 入口：入口3つ（all）か、画面で入力だけ（form） */
  entries?: "all" | "form";
  /** 入口の見出し（省略時：診断をはじめる）と説明 */
  startHead?: string;
  startSub?: string;
  /** ファイルの入口で置く資料の名前（省略時：出力する資料と同じ） */
  fileDoc?: string;
  /** 「診断でわかること」の見出し */
  knowHead?: string;
  /** 入力の画面の見出し */
  inputHead?: string;
  /** 3ステップの説明（STEP 1〜3の一言） */
  steps: [string, string, string];
  /** 3ステップの見出し（「予算案が年間予算表になります」など） */
  stepsHead: string;
  /** 入口の真ん中のカード（ファイルを置く） */
  fileLabel: string;
  fileNote?: string;
  /** AIの手順①の文 */
  aiStep: string;
  /** 診断でわかること A〜C */
  know: [string, string][];
  /** 完成イメージの画像と見本のリンク */
  shot: string;
  /** スプレッドシートで入力したい方への資料 */
  sheetUrl: string;
  /** 完了の画面：次に使うKit */
  next: { head: string; name: string; desc: string; cta: string; href?: string; handoff?: "kpimake" };
  /** 完了の画面：資料 */
  resources: { href: string; name: string; note: string }[];
}

export const KIT_PAGES: Partial<Record<KitId | "effect", KitPage>> = {
  budget: {
    title: "予算案診断Kit",
    question: "その予算案、目標に届く？コストは上限以内？",
    lead: "予算案の数字を入れると、すぐに判定して<b>直すところ</b>を示します。直した数字は、そのまま稟議に使える年間予算表（Excel）で持ち帰れます。",
    catch: "作った予算案を、診断して直し、年間予算表に仕上げる。",
    metaTitle: "予算案診断Kit｜予算案を診断して直し、年間予算表に仕上げる｜MeerKitLab",
    description:
      "AIや自社で作ったマーケティング予算案を取りこみ、目標に届くか・コストが上限以内かを診断する無料のツール（Kit）です。画面でNGを直すと、そのまま稟議に使える年間予算表（Excel）になります。",
    ogImage: "/open-graph/default.png",
    steps: ["AIの案・Excel・画面入力のどれかで数字を入れる", "NGは「OKになる条件」を見ながら、その場で直す", "稟議に使える年間予算表（Excel）で持ち帰る"],
    stepsHead: "3ステップで、予算案が年間予算表になります",
    fileLabel: "年間予算表に入力済み",
    aiStep: "① このプロンプトをコピーして、予算案を作ったAIのチャットに貼る（手元の資料があれば一緒に貼る）",
    know: [
      ["目標に届くか", "計画の数で、売上目標に届くかを判定します"],
      ["コストは上限以内か", "CPL・CACが上限を超えていないかを判定します"],
      ["直すところと、OKになる条件", "NGを1件ずつ示し、その場で数字を直せます。最後に年間予算表（Excel）を持ち帰れます"],
    ],
    shot: "/images/tools/budget-checker-sheet.png",
    sheetUrl: "/lab/whitepapers/kgi-kpi-backcast-sheet",
    next: {
      head: "次は、この予算をKPIにして毎月追いかける",
      name: "KPI管理表作成Kit",
      desc: "いま作った年間予算表の数字を引き継いで、KPI管理表（M-B-04）を作ります。ファイルのアップロードは不要です。",
      cta: "この数字でKPI管理表を作る",
      handoff: "kpimake",
    },
    resources: [
      { href: "/lab/whitepapers/kpi-management-template", name: "KPI管理表（無料）", note: "スプレッドシートで自分で入力したい方へ" },
      { href: "/lab/whitepapers/budget-justification-sheet", name: "予算の根拠整理シート（3つのWhy）", note: "稟議で予算の根拠を説明するときに" },
    ],
  },
  kpi: {
    title: "KPI妥当性診断Kit",
    question: "そのKPI、目標に届く？率に無理はない？",
    lead: "KPIの数字を入れると、すぐに判定して<b>直すところ</b>を示します。直した数字は、そのまま期初から使えるKPI管理表（Excel）で持ち帰れます。",
    catch: "作ったKPIを、診断して直し、KPI管理表に仕上げる。",
    metaTitle: "KPI妥当性診断Kit｜期初のKPIを診断して直し、KPI管理表に仕上げる｜MeerKitLab",
    description:
      "自分やAIで作ったKPIを取りこみ、売上目標とつながっているか・率やコストに無理がないかを、期のはじめに診断する無料のKitです。画面でNGを直すと、そのまま期初から使えるKPI管理表（Excel）になります。",
    ogImage: "/open-graph/tools/kpi-check.png",
    steps: ["AIの案・Excel・画面入力のどれかで数字を入れる", "NGは「OKになる条件」を見ながら、その場で直す", "期初から使えるKPI管理表（Excel）で持ち帰る"],
    stepsHead: "3ステップで、KPIがKPI管理表になります",
    fileLabel: "KPI管理表に入力済み",
    fileNote: "年間予算表も読めます",
    aiStep: "① このプロンプトをコピーして、KPIを作ったAIのチャットに貼る（手元の資料があれば一緒に貼る）",
    know: [
      ["目標に届くか", "計画の数で、売上目標に届くかを判定します"],
      ["率は目安の範囲か", "有効リード率・商談化率・受注率が目安から外れていないかを判定します"],
      ["直すところと、OKになる条件", "NGを1件ずつ示し、その場で数字を直せます。最後にKPI管理表（Excel）を持ち帰れます"],
    ],
    shot: "/images/tools/kpi-check-sheet.png",
    sheetUrl: "/lab/whitepapers/kpi-management-template",
    next: {
      head: "次は、毎月の実績を入れて打ち手の効果を確かめる",
      name: "施策効果診断Kit",
      desc: "毎月の実績と施策ログを入れたKPI管理表を読み込んで、計画とのずれと打ち手の効果を診断します。",
      cta: "施策効果診断Kitを見る",
      href: "/tools/kpi-analysis",
    },
    resources: [
      { href: "/lab/whitepapers/kpi-management-template", name: "KPI管理表（無料）", note: "スプレッドシートで自分で入力したい方へ" },
      { href: "/lab/whitepapers/kgi-kpi-backcast-sheet", name: "年間予算表（無料）", note: "予算もあわせて作るときに" },
    ],
  },
  make: {
    title: "予算作成Kit",
    question: "その売上目標、いくらの予算で届く？",
    lead: "売上目標と今期の実績を入れると、必要なリード数を逆算し、チャネルに分けた予算が<b>目標に届くか・上限以内か</b>をすぐに判定します。作った予算は、そのまま稟議に使える年間予算表（Excel）で持ち帰れます。",
    catch: "売上目標から逆算して、年間予算表を作る。",
    metaTitle: "予算作成Kit｜売上目標から逆算して、年間予算表を作る｜MeerKitLab",
    description:
      "売上目標と今期の実績から、必要なリード数を逆算する無料のツール（Kit）です。チャネルごとにリード数と費用を配るだけで、CPL・CACまで判定し、そのまま稟議に使える年間予算表（Excel）になります。",
    ogImage: "/open-graph/default.png",
    stepTitles: ["目標と実績を入れる", "チャネルに分けて直す", "ダウンロード"],
    steps: ["売上目標と今期の実績から、必要な数を逆算する", "リード数と費用を分け、NGは「OKになる条件」を見て直す", "稟議に使える年間予算表（Excel）で持ち帰る"],
    stepsHead: "3ステップで、売上目標から年間予算表ができます",
    entries: "form",
    startHead: "作成をはじめる",
    startSub: "前提・今期の実績・チャネル別の数字を、画面の表に入れます。",
    fileLabel: "",
    aiStep: "",
    knowHead: "このKitでわかること",
    inputHead: "予算の数字を入れる",
    know: [
      ["必要な数", "売上目標と今期の実績から、必要なリード数・有効リード数・商談数・受注数を逆算します"],
      ["目標に届くか・コストは上限以内か", "チャネルに分けた数で目標に届くか、CPL・CACが上限以内かを判定します"],
      ["直すところと、OKになる条件", "NGを1件ずつ示し、その場で数字を直せます。最後に年間予算表（Excel）を持ち帰れます"],
    ],
    shot: "/images/tools/budget-simulator-sheet.png",
    sheetUrl: "/lab/whitepapers/kgi-kpi-backcast-sheet",
    next: {
      head: "次は、この予算をKPIにして毎月追いかける",
      name: "KPI管理表作成Kit",
      desc: "いま作った年間予算表の数字を引き継いで、KPI管理表（M-B-04）を作ります。ファイルのアップロードは不要です。",
      cta: "この数字でKPI管理表を作る",
      handoff: "kpimake",
    },
    resources: [
      { href: "/lab/whitepapers/kpi-management-template", name: "KPI管理表（無料）", note: "スプレッドシートで自分で入力したい方へ" },
      { href: "/lab/whitepapers/budget-justification-sheet", name: "予算の根拠整理シート（3つのWhy）", note: "稟議で予算の根拠を説明するときに" },
    ],
  },
  kpimake: {
    title: "KPI管理表作成Kit",
    question: "その売上目標、毎月何件のリードが必要？",
    lead: "売上目標と今期の実績を入れると、必要な件数を逆算し、チャネル別・月別のKPIに分けます。<b>目標に届くか・上限以内か</b>も判定し、そのまま期初から使えるKPI管理表（Excel）で持ち帰れます。",
    catch: "売上目標から逆算して、KPI管理表を作る。",
    metaTitle: "KPI管理表作成Kit｜売上目標から逆算して、KPI管理表を作る｜MeerKitLab",
    description:
      "売上目標と今期の実績から、必要なリード数を逆算する無料のツール（Kit）です。リード数と費用をチャネルに分割するだけで、CPL・CACまで判定し、そのまま期初から使えるKPI管理表（Excel）になります。",
    ogImage: "/open-graph/default.png",
    stepTitles: ["目標と実績を入れる", "チャネルに分けて直す", "ダウンロード"],
    steps: ["AIの案・Excel・画面入力のどれかで数字を入れる", "リード数と費用を分け、NGは「OKになる条件」を見て直す", "期初から使えるKPI管理表（Excel）で持ち帰る"],
    stepsHead: "3ステップで、売上目標からKPI管理表ができます",
    startHead: "作成をはじめる",
    startSub: "手元の状態に合うものを1つ選んでください。どれを選んでも、作るものは同じです。",
    fileLabel: "年間予算表に入力済み",
    fileDoc: "年間予算表",
    fileNote: "KPI管理表も読めます",
    aiStep: "① このプロンプトをコピーして、KPIの案を作ったAIのチャットに貼る（手元の資料があれば一緒に貼る）",
    knowHead: "このKitでわかること",
    inputHead: "KPIの数字を入れる",
    know: [
      ["必要な数", "売上目標と今期の実績から、必要なリード数・有効リード数・商談数・受注数を逆算します"],
      ["目標に届くか・コストは上限以内か", "チャネルに分けた数で目標に届くか、CPL・CACが上限以内かを判定します"],
      ["直すところと、OKになる条件", "NGを1件ずつ示し、その場で数字を直せます。最後にKPI管理表（Excel）を持ち帰れます"],
    ],
    shot: "/images/tools/kpi-sheet-maker-sheet.png",
    sheetUrl: "/lab/whitepapers/kpi-management-template",
    next: {
      head: "次は、毎月の実績を入れて打ち手の効果を確かめる",
      name: "施策効果診断Kit",
      desc: "毎月の実績と施策ログを入れたKPI管理表を読み込んで、計画とのずれと打ち手の効果を診断します。",
      cta: "施策効果診断Kitを見る",
      href: "/tools/kpi-analysis",
    },
    resources: [
      { href: "/lab/whitepapers/kpi-management-template", name: "KPI管理表（無料）", note: "スプレッドシートで自分で入力したい方へ" },
      { href: "/lab/whitepapers/kgi-kpi-backcast-sheet", name: "年間予算表（無料）", note: "予算もあわせて作るときに" },
    ],
  },
  effect: {
    title: "施策効果診断Kit",
    question: "その打ち手、効いている？計画を下回っている課題は？",
    lead: "毎月の実績と施策ログを入れると、計画を下回っている課題と、<b>打ち手が効いたか</b>を確率で判定します。そのまま翌月も使えるKPI管理表（Excel）で持ち帰れます。",
    catch: "毎月の振り返りを、勘ではなく数字で。",
    metaTitle: "施策効果診断Kit｜続いている課題と打ち手の効果を診断し、KPI管理表に仕上げる｜MeerKitLab",
    description:
      "KPI管理表の毎月の実績と施策ログから、計画を下回っている課題と、打ち手が効いたかを確率で診断する無料のKitです。画面で直すと、そのまま翌月も使えるKPI管理表（Excel）になります。",
    ogImage: "/open-graph/tools/kpi-analysis.png",
    doc: "KPI管理表",
    path: "/tools/kpi-analysis",
    demoImg: "/images/tools/kpi-analysis-screen.png",
    needRows: [
      ["計画", ["期首", "売上目標", "平均受注単価", "粗利率", "回収期間", "リードタイム", "チャネル別の年間の計画"]],
      ["毎月の実績（チャネル別）", ["リード数", "有効リード数", "商談数", "受注数", "外部費用・人件費（計画と違う月だけ）"]],
      ["施策ログ", ["狙う指標", "チャネル", "課題", "打ち手", "実施月", "状態", "振り返り"]],
    ],
    needNote: "率は入れません（件数から出します）。判定は1か月目の実績から出ます",
    stepTitles: ["入力する", "診断を見て直す", "ダウンロード"],
    steps: ["計画・毎月の実績・施策ログを入れる", "課題と打ち手の効果を見て、記録の抜けを直す", "翌月も使えるKPI管理表（Excel）で持ち帰る"],
    stepsHead: "3ステップで、毎月の振り返りがKPI管理表に残ります",
    fileLabel: "KPI管理表に記録している",
    aiStep: "① このプロンプトをコピーして、AIのチャットに貼る（計画・実績・打ち手の記録を一緒に貼る）",
    know: [
      ["月別進捗状況", "指標ごとに、計画を下回っている確率を月別に色分けします"],
      ["推移と打ち手", "実績・計画の推移に、打ち手を入れた月を重ねて表示します"],
      ["打ち手の効果", "打ち手ごとに、実施後に良くなった確率を表示します。最後にKPI管理表（Excel）を持ち帰れます"],
    ],
    knowHead: "このKitでわかること",
    shot: "/images/tools/kpi-analysis-sheet.png",
    sheetUrl: "/lab/whitepapers/kpi-management-template",
    next: {
      head: "次は、来月の実績を足して同じように診断する",
      name: "施策効果診断Kit",
      desc: "いまダウンロードしたKPI管理表に来月の実績と施策ログを書き足し、もう一度読み込むだけで続きから診断できます。",
      cta: "KPI管理表を読み込む",
      href: "/tools/kpi-analysis#start",
    },
    resources: [
      { href: "/lab/whitepapers/kpi-management-template", name: "KPI管理表（無料）", note: "月次レポートのシートで経営に報告するときに" },
      { href: "/lab/whitepapers/budget-justification-sheet", name: "予算の根拠整理シート（3つのWhy）", note: "打ち手の見直しで予算を動かすときに" },
    ],
  },
};

export const kitPage = (id: KitId | "effect"): KitPage => {
  const p = KIT_PAGES[id];
  if (!p) throw new Error(`kitPages: ${id} がありません`);
  return p;
};
