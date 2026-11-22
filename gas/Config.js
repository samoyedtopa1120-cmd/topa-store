/**
 * 共用設定。
 *
 * 商品、價格、運送方式、付款設定都在網站上的「商品目錄」：
 *   docs/data/catalog.json（由 site/store.json ＋ 每日同步的買動漫資料產生，GitHub Action 自動更新）
 * Apps Script 下單時讀這份目錄計算金額（快取幾分鐘）；試算表只存「訂單」與「綠界通知紀錄」。
 * 後端不檢查開始 / 截止時間，也不限制購買數量，隨時都能下單與收款；這些只由前端頁面控制。
 */

/** 商品目錄網址；可用指令碼屬性 CATALOG_URL 覆寫。 */
var DEFAULT_CATALOG_URL = 'https://samoyedtopa1120-cmd.github.io/topa-store/data/catalog.json';
/** 商品目錄快取秒數（GitHub Pages 更新後最多這麼久生效） */
var CATALOG_CACHE_SECONDS = 300;

var STATUS = {
  PENDING: '付款中',
  PAID: '已付款',
  FAILED: '付款失敗',
  EXPIRED: '逾期未付',   // 系統自動標記：超過繳費期限，或刷卡頁面放著沒付；之後收到付款仍會改為已付款
  CANCELLED: '已取消',   // 人工標記，系統不會再改狀態
  REFUNDED: '已退款'     // 人工標記，系統不會再改狀態
};
var STATUS_LIST = [STATUS.PENDING, STATUS.PAID, STATUS.FAILED, STATUS.EXPIRED, STATUS.CANCELLED, STATUS.REFUNDED];
var SHIP_STATUS_LIST = ['待出貨', '已出貨', '已送達', '退回'];

/** 運送方式的類型，決定要填哪些欄位 */
var SHIP_TYPE = { CVS: '超商', HOME: '宅配', MEET: '面交', NONE: '免運送' };

/** 沒有繳費期限的付款（例如刷卡頁面放著沒付），超過幾小時標記逾期未付 */
var UNPAID_EXPIRE_HOURS = 2;

var LOG_SHEET = '綠界通知紀錄';
var ORDER_SHEET = '訂單';
/** v2 以前每個活動各一張「訂單_活動代碼」，升級時自動合併到共用分頁 */
var LEGACY_ORDER_PREFIX = '訂單_';

/** 試算表結構版本；程式更新欄位後調高，網頁應用程式會在下一次請求時自動補欄位。 */
var SCHEMA_VERSION = '3';

var ORDER_HEADERS = [
  '訂單編號', '狀態', '建立時間', '活動', '表單版本',
  '暱稱ID', '收件人姓名', '手機', 'Email',
  '取貨方式', '門市名稱', '門市店號',
  '品項明細', '總件數', '商品小計', '運費', '總金額',
  '付款方式', '付款時間', '綠界交易編號', '繳費資訊', '繳費期限',
  '綠界回傳碼', '綠界回傳訊息', '顧客回報付款', '系統備註', '最後更新',
  '查詢碼', '返回網址',
  // v2 新增（舊工作表會自動補在最後面）
  '收件地址', '買家備註', '自訂欄位', '品項代碼', '折扣',
  '出貨狀態', '出貨日期', '物流單號', '管理備註'
];

var LOG_HEADERS = ['時間', '來源', '訂單編號', 'RtnCode', 'RtnMsg', '驗證', '原始資料'];

/** 網頁應用程式的 /exec 網址（綠界回傳用）。指令碼屬性 WEBAPP_URL 有設定時以屬性為準。 */
var DEFAULT_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwJPXzM3ms6IF6wekTZsuFDMbyCONeg0RHYYXt3z1I1zkJE_P68mFmSCgKziR00hw8V/exec';

/** 允許的前端網址（感謝頁）來源，可用指令碼屬性 ALLOWED_ORIGINS 覆寫，逗號分隔。 */
var DEFAULT_ALLOWED_ORIGINS = 'https://*.github.io,http://localhost,http://127.0.0.1';

/** 自訂題目的上限（防止塞爆試算表） */
var EXTRA_MAX_FIELDS = 30;
var EXTRA_MAX_LENGTH = 1000;
