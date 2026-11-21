/**
 * 活動設定。新增活動或改版時，在 CAMPAIGNS 加一筆，再執行一次 setup()。
 * 商品價格以試算表「商品_<活動>」為準（seedProducts 只在第一次建立工作表時寫入）。
 */
var CAMPAIGNS = {
  '2026Birthday': {
    title: '多帕2026生日周邊',
    orderPrefix: 'TB26',               // 訂單編號前綴，4 碼英數
    orderSheet: '訂單_2026Birthday',
    productSheet: '商品_2026Birthday',
    shippingFee: 60,
    deadline: '2026-11-22T23:59:59+08:00',
    maxQtyPerItem: 10,
    pickupMethods: ['7-11店到店', '全家店到店'],
    atmExpireDays: 1,                  // ATM 虛擬帳號繳費期限（天）
    // 付款方式：'donate' = 導到綠界實況主贊助頁，客戶自行輸入金額並在留言貼訂單編號，人工對帳
    //           'aio'    = 綠界全方位金流 API，自動回寫付款結果（需特約商店金鑰）
    paymentMode: 'aio',
    donateUrl: 'https://payment.ecpay.com.tw/Broadcaster/Donate/85C7382313C1128C863B7826B020375C',
    seedProducts: [
      // 商品代碼, 商品名稱, 內容, 單價, 上架, 排序
      ['BDAY-SET', '生日快樂之我全都要', '雙層印刷厚壓克力磚＋親簽明信片＋大滑鼠墊', 1120, true, 1],
      ['ACRYLIC', '防身武器好安心', '雙層印刷厚壓克力磚（15×10×2cm）', 650, true, 2],
      ['MOUSEPAD', '滑鼠也滑狗', '大滑鼠墊（700×400×4mm）', 520, true, 3]
    ]
  }
};

var STATUS = { PENDING: '付款中', PAID: '已付款', FAILED: '付款失敗' };

var LOG_SHEET = '綠界通知紀錄';

var ORDER_HEADERS = [
  '訂單編號', '狀態', '建立時間', '活動', '表單版本',
  '暱稱ID', '收件人姓名', '手機', 'Email',
  '取貨方式', '門市名稱', '門市店號',
  '品項明細', '總件數', '商品小計', '運費', '總金額',
  '付款方式', '付款時間', '綠界交易編號', '繳費資訊', '繳費期限',
  '綠界回傳碼', '綠界回傳訊息', '顧客回報付款', '系統備註', '最後更新',
  '查詢碼', '返回網址'
];

var PRODUCT_HEADERS = ['商品代碼', '商品名稱', '內容', '單價', '上架', '排序'];

var LOG_HEADERS = ['時間', '來源', '訂單編號', 'RtnCode', 'RtnMsg', '驗證', '原始資料'];

/** 網頁應用程式的 /exec 網址（綠界回傳用）。指令碼屬性 WEBAPP_URL 有設定時以屬性為準。 */
var DEFAULT_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwJPXzM3ms6IF6wekTZsuFDMbyCONeg0RHYYXt3z1I1zkJE_P68mFmSCgKziR00hw8V/exec';

/** 允許的前端網址（感謝頁）來源，可用指令碼屬性 ALLOWED_ORIGINS 覆寫，逗號分隔。 */
var DEFAULT_ALLOWED_ORIGINS = 'https://*.github.io,http://localhost,http://127.0.0.1';
