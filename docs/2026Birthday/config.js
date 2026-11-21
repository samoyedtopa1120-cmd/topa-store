/*
 * 多帕 2026 生日周邊（前端設定）。
 *
 * 商品、價格、運送方式以 Apps Script 試算表為準（「活動設定」「運送方式」「商品_2026Birthday」），
 * 頁面打開後會向後端讀取並覆蓋這裡的資料；這裡的內容只在後端還沒回應時先顯示，以及提供圖片 / 標籤。
 *
 * 新活動：複製整個資料夾，改 id、文字與這個檔案，再到試算表「活動設定」加一列即可。
 */
window.CAMPAIGN = {
  id: '2026Birthday',
  formVersion: '2026Birthday@2',
  // Apps Script 網頁應用程式的 /exec 網址（所有活動共用）
  gasUrl: 'https://script.google.com/macros/s/AKfycbwJPXzM3ms6IF6wekTZsuFDMbyCONeg0RHYYXt3z1I1zkJE_P68mFmSCgKziR00hw8V/exec',
  // 前端截止時間：過了就顯示「預購已截止」（後端不鎖時間）。不設定則不截止。
  deadline: '2026-11-22T23:59:59+08:00',
  // 前端每項商品數量上限（後端不限制）
  maxQty: 10,
  // 'aio'：綠界全方位金流 API；'donate'：綠界實況主贊助頁（以後端「活動設定」為準）
  paymentMode: 'aio',
  donateUrl: 'https://payment.ecpay.com.tw/Broadcaster/Donate/85C7382313C1128C863B7826B020375C',
  // 類型：超商（填門市）、宅配（填地址）、面交、免運送（不需收件資料）
  shipping: [
    { name: '7-11店到店', type: '超商', fee: 60 },
    { name: '全家店到店', type: '超商', fee: 60 }
  ],
  freeShippingOver: 0,
  // 商品圖片與標籤只在前端設定，用商品代碼對應
  products: [
    { sku: 'BDAY-SET', name: '生日快樂之我全都要', desc: '厚壓克力磚＋親簽明信片＋大滑鼠墊', price: 1120, badge: '套組', image: '' },
    { sku: 'ACRYLIC', name: '防身武器好安心', desc: '雙層印刷厚壓克力磚（15×10×2cm）', price: 650, image: '' },
    { sku: 'MOUSEPAD', name: '滑鼠也滑狗', desc: '大滑鼠墊（700×400×4mm）', price: 520, image: '' }
  ],
  // 自訂題目（選填）：type 可用 text / textarea / select / radio / checkbox
  // 例：{ label: '簽名要寫給誰', type: 'text', required: true, placeholder: '例：小明', maxLength: 30 }
  questions: [],
  // 買家備註欄（選填）：{ label: '備註', placeholder: '想對多帕說的話' }
  note: null
};
