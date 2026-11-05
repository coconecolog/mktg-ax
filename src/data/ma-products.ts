// MAツール選定チェック（/tools/ma-selection）の製品データ（2026-11-05）。
// 正本は Drive「02_ツール仕様／MAツール選定_製品一覧（正本）」。料金を直すときは、正本と同じ日にここも直し、MA_SURVEY_DATE を変える（半年に1回）。
// 仕様は Drive「02_ツール仕様／MAツール選定チェック 仕様（ma-selection）」。

export const MA_SURVEY_DATE = "2026年11月5日";

/** 使う前に告知する10製品（導入サイト数の順）。note は候補に出さない製品に添える */
export const MA_ANNOUNCE: { name: string; note?: string }[] = [
  { name: "HubSpot" },
  { name: "BowNow" },
  { name: "Account Engagement" },
  { name: "Adobe Marketo Engage" },
  { name: "b→dash", note: "BtoC向け" },
  { name: "KASIKA", note: "住宅・不動産向け" },
  { name: "SATORI" },
  { name: "List Finder" },
  { name: "Kairos3 Marketing" },
  { name: "SHANON MARKETING PLATFORM" },
];

/** basic＝基本の機能のMA、link＝営業との連携まで使うMA */
export type MaStage = "basic" | "link";
/** 使っているCRM */
export type MaCrm = "none" | "sf" | "kintone" | "other";

export interface MaPlan {
  product: string;
  plan: string;
  /** 月額（税別・円）。null＝料金は問い合わせ */
  monthly: number | null;
  /** 初期費用（税別・円）。null＝問い合わせ（月額だけで比べる） */
  initial: number | null;
  /** 月額が下限の金額（利用量で変わる） */
  from?: boolean;
  stage: MaStage;
  crm: MaCrm[];
  note: string;
}

const ALL: MaCrm[] = ["none", "sf", "kintone", "other"];

export const MA_PLANS: MaPlan[] = [
  { product: "HubSpot", plan: "Starter", monthly: 2400, initial: 0, stage: "basic", crm: ALL, note: "CRMと一体。スコアリングはなし（Professionalから）" },
  { product: "HubSpot", plan: "Professional", monthly: 96000, initial: 360000, stage: "link", crm: ["none", "other"], note: "CRMと一体。項目の追加から営業への引き渡しまで、マーケが組める。初期費用は必須の導入支援" },
  { product: "Kairos3 Marketing", plan: "スタンダード", monthly: 20000, initial: null, from: true, stage: "basic", crm: ALL, note: "リード数・PV・メールの送信数で月額が変わる。シナリオは件数の制限あり" },
  { product: "Kairos3 Marketing", plan: "＋Kairos3 Sales", monthly: 45000, initial: null, from: true, stage: "link", crm: ["none"], note: "同じ会社のSFAと組み合わせ、マーケから営業までを管理できる" },
  { product: "List Finder", plan: "ライト", monthly: 45000, initial: 100000, stage: "basic", crm: ALL, note: "スコアリングあり。シナリオはプレミアムのみ" },
  { product: "List Finder", plan: "プレミアム", monthly: 92000, initial: 100000, stage: "link", crm: ["sf", "other"], note: "Salesforce連携・外部ツール連携・シナリオあり" },
  { product: "SHANON MARKETING PLATFORM", plan: "デジタル", monthly: 60000, initial: 100000, stage: "basic", crm: ALL, note: "スコアリング・シナリオあり。リード5,000件を超えると加算" },
  { product: "SHANON MARKETING PLATFORM", plan: "デジタル", monthly: 60000, initial: 100000, stage: "link", crm: ["none", "sf", "kintone"], note: "SFA（商談管理）を内蔵。Salesforce・kintoneと連携できる" },
  { product: "SATORI", plan: "基本プラン", monthly: 148000, initial: 300000, stage: "basic", crm: ALL, note: "匿名の訪問者へのアプローチに強い。年間契約の前払い" },
  { product: "Account Engagement", plan: "Growth+", monthly: 150000, initial: null, stage: "link", crm: ["sf"], note: "Salesforceとつないで使う。年間契約" },
  { product: "BowNow", plan: "スタンダード", monthly: null, initial: null, stage: "basic", crm: ALL, note: "料金は資料請求後の打ち合わせで提示される" },
  { product: "BowNow", plan: "上位プラン", monthly: null, initial: null, stage: "link", crm: ["sf", "kintone"], note: "SalesCloud・kintone連携は上位プラン。料金は資料請求後の打ち合わせで提示される" },
  { product: "Adobe Marketo Engage", plan: "Growth", monthly: null, initial: null, stage: "link", crm: ["sf", "other"], note: "Salesforce・Microsoft Dynamicsなどとネイティブ連携" },
];
