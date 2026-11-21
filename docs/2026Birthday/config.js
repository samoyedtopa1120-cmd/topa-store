/* 多帕 2026 生日周邊。價格以 Apps Script 試算表「商品_2026Birthday」為準，這裡只用於顯示，兩邊請保持一致。 */
window.CAMPAIGN = {
  id: '2026Birthday',
  formVersion: '2026Birthday@1',
  // Apps Script 網頁應用程式的 /exec 網址
  gasUrl: 'https://script.google.com/macros/s/AKfycbwJPXzM3ms6IF6wekTZsuFDMbyCONeg0RHYYXt3z1I1zkJE_P68mFmSCgKziR00hw8V/exec',
  deadline: '2026-11-22T23:59:59+08:00',
  // 'aio'：綠界全方位金流 API；'donate'：綠界實況主贊助頁（需與 gas/Config.js 一致）
  paymentMode: 'aio',
  donateUrl: 'https://payment.ecpay.com.tw/Broadcaster/Donate/85C7382313C1128C863B7826B020375C',
  shippingFee: 60,
  maxQty: 10,
  pickupMethods: ['7-11店到店', '全家店到店'],
  products: [
    {
      sku: 'BDAY-SET',
      name: '生日快樂之我全都要',
      desc: '厚壓克力磚＋親簽明信片＋大滑鼠墊',
      price: 1120,
      badge: '套組',
      image: ''
    },
    {
      sku: 'ACRYLIC',
      name: '防身武器好安心',
      desc: '雙層印刷厚壓克力磚（15×10×2cm）',
      price: 650,
      image: ''
    },
    {
      sku: 'MOUSEPAD',
      name: '滑鼠也滑狗',
      desc: '大滑鼠墊（700×400×4mm）',
      price: 520,
      image: ''
    }
  ]
};
