/**
 * 共用設定。
 *
 * 活動、運送方式、商品都放在試算表裡，新增活動不用改程式：
 *   「活動設定」        一個活動一列（活動代碼 = 前端網址資料夾名稱）
 *   「運送方式」        每個活動可有多種運送方式，各自設定類型與運費
 *   「商品_<活動代碼>」  第一次有人開啟該活動頁面時自動建立，再把商品填進去
 * 後端不檢查開始 / 截止時間，也不限制購買數量，隨時都能下單與收款；
 * 截止時間與數量上限只由前端頁面控制。
 */

/** 第一次建立「活動設定」時寫入的活動（之後以試算表為準，改這裡不會生效）。 */
var SEED_CAMPAIGNS = [
  {
    row: {
      '活動代碼': '2026Birthday',
      '活動名稱': '多帕2026生日周邊',
      '訂單前綴': 'TB26',
      '付款模式': 'aio',
      '滿額免運': '',
      'ATM繳費天數': 1,
      '超商代碼繳費分鐘': 1440,
      '隱藏付款方式': 'BARCODE',
      '贊助頁網址': 'https://payment.ecpay.com.tw/Broadcaster/Donate/85C7382313C1128C863B7826B020375C',
      '備註': '2026 生日周邊，前端截止 11/22 23:59'
    },
    shipping: [
      // 方式名稱, 類型, 運費, 排序, 啟用
      ['7-11店到店', '超商', 60, 1, true],
      ['全家店到店', '超商', 60, 2, true]
    ],
    products: [
      // 商品代碼, 商品名稱, 內容, 單價, 上架, 排序
      ['BDAY-SET', '生日快樂之我全都要', '雙層印刷厚壓克力磚＋親簽明信片＋大滑鼠墊', 1120, true, 1],
      ['ACRYLIC', '防身武器好安心', '雙層印刷厚壓克力磚（15×10×2cm）', 650, true, 2],
      ['MOUSEPAD', '滑鼠也滑狗', '大滑鼠墊（700×400×4mm）', 520, true, 3]
    ]
  }
];

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

var CAMPAIGN_SHEET = '活動設定';
var SHIPPING_SHEET = '運送方式';
var LOG_SHEET = '綠界通知紀錄';
var ORDER_SHEET_PREFIX = '訂單_';
var PRODUCT_SHEET_PREFIX = '商品_';

/** 試算表結構版本；程式更新欄位後調高，網頁應用程式會在下一次請求時自動補欄位。 */
var SCHEMA_VERSION = '2';

var CAMPAIGN_HEADERS = [
  '活動代碼', '活動名稱', '訂單前綴', '付款模式', '滿額免運',
  'ATM繳費天數', '超商代碼繳費分鐘', '隱藏付款方式', '贊助頁網址', '備註'
];

var SHIPPING_HEADERS = ['活動代碼', '方式名稱', '類型', '運費', '排序', '啟用'];

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

var PRODUCT_HEADERS = ['商品代碼', '商品名稱', '內容', '單價', '上架', '排序'];

var LOG_HEADERS = ['時間', '來源', '訂單編號', 'RtnCode', 'RtnMsg', '驗證', '原始資料'];

/** 網頁應用程式的 /exec 網址（綠界回傳用）。指令碼屬性 WEBAPP_URL 有設定時以屬性為準。 */
var DEFAULT_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwJPXzM3ms6IF6wekTZsuFDMbyCONeg0RHYYXt3z1I1zkJE_P68mFmSCgKziR00hw8V/exec';

/** 允許的前端網址（感謝頁）來源，可用指令碼屬性 ALLOWED_ORIGINS 覆寫，逗號分隔。 */
var DEFAULT_ALLOWED_ORIGINS = 'https://*.github.io,http://localhost,http://127.0.0.1';

/** 自訂題目的上限（防止塞爆試算表） */
var EXTRA_MAX_FIELDS = 30;
var EXTRA_MAX_LENGTH = 1000;
