// src/data/kitPages.ts
//
// 診断系Kitの画面の文言（2026-11-01）。画面の形は予算案診断Kitで決めた形（3ステップ：入力 → 診断・修正 → 最終チェック・ダウンロード → 完了）を共通の部品
// （src/components/kit-flow/）にし、Kitごとに違う文言・リンクだけをここに持つ。計算・判定・Excelの違いは src/lib/planKits.ts。
// 対象：予算案診断Kit（budget）・KPI妥当性診断Kit（kpi）。作る系（make・kpimake）・施策効果診断Kitはあとで足す
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

export const KIT_PAGES: Partial<Record<KitId, KitPage>> = {
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
};

export const kitPage = (id: KitId): KitPage => {
  const p = KIT_PAGES[id];
  if (!p) throw new Error(`kitPages: ${id} がありません`);
  return p;
};
