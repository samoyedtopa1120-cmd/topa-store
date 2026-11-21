// 以假試算表跑完整流程：setup → 建單 → 綠界回傳 → 查詢
import assert from 'node:assert/strict';
import { createSandbox } from './gas-sandbox.mjs';

const WEBAPP = 'https://script.google.com/macros/s/TEST/exec';
const { ctx, sheets } = createSandbox({ props: { WEBAPP_URL: WEBAPP } });
const KEY = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };

const CAMP = ctx.CAMPAIGNS['2026Birthday'];
const configuredMode = CAMP.paymentMode;
CAMP.paymentMode = 'aio'; // 先測 API 模式，最後再測贊助頁模式
ctx.setup();
const orders = sheets.get('訂單_2026Birthday');
assert.ok(orders && sheets.get('商品_2026Birthday') && sheets.get('綠界通知紀錄'));

const post = (action, body) => ctx.doPost({ parameter: { action }, postData: { contents: body } });
const createOrder = (payload) => JSON.parse(post('createOrder', JSON.stringify(payload)).body);
const signed = (p) => {
  const params = { MerchantID: KEY.merchantId, ...p };
  params.CheckMacValue = ctx.ecpayCheckMac_(params, KEY.hashKey, KEY.hashIV);
  return new URLSearchParams(params).toString();
};
const row = (no) => ctx.readObject_(orders, ctx.findRow_(orders, no));
const status = (no, t) => JSON.parse(ctx.doGet({ parameter: { action: 'orderStatus', campaign: '2026Birthday', o: no, t } }).body);

const base = {
  campaign: '2026Birthday',
  formVersion: '2026Birthday@1',
  buyer: { nickname: '小明', name: '王小明', phone: '0912-345-678', email: '' },
  shipping: { method: '7-11店到店', storeName: '鑫台北門市', storeId: '123456' },
  items: [{ sku: 'BDAY-SET', qty: 1 }, { sku: 'ACRYLIC', qty: 2 }, { sku: 'MOUSEPAD', qty: 0 }],
  agree: true,
  hp: '',
  thanksUrl: 'https://someone.github.io/topa-store/2026Birthday/thanks.html'
};

// 1. 建單
const r1 = createOrder(base);
assert.equal(r1.ok, true, JSON.stringify(r1));
assert.equal(r1.amount, 1120 + 650 * 2 + 60);
assert.equal(r1.orderNo.length, 20);
assert.equal(r1.ecpay.params.TotalAmount, '2480');
assert.equal(r1.ecpay.params.ReturnURL, WEBAPP + '?action=ecpayNotify');
assert.equal(r1.ecpay.params.ClientBackURL,
  `https://someone.github.io/topa-store/2026Birthday/thanks.html?o=${r1.orderNo}&t=${r1.token}`);
assert.ok(ctx.ecpayVerify_(r1.ecpay.params, KEY));
let o = row(r1.orderNo);
assert.equal(o['狀態'], '付款中');
assert.equal(o['手機'], '0912345678');
assert.equal(o['品項明細'], '生日快樂之我全都要 x1\n防身武器好安心 x2');
console.log('✓ createOrder', r1.orderNo, r1.ecpay.params.ItemName);

// 2. 驗證錯誤
const bad = (patch, code) => {
  const r = createOrder({ ...base, ...patch });
  assert.equal(r.ok, false); assert.equal(r.code, code, JSON.stringify(r));
};
bad({ items: [{ sku: 'ACRYLIC', qty: 0 }] }, 'INVALID');
bad({ items: [{ sku: 'ACRYLIC', qty: 99 }] }, 'INVALID');
bad({ items: [{ sku: 'NOPE', qty: 1 }] }, 'INVALID');
bad({ buyer: { ...base.buyer, phone: '12345' } }, 'INVALID');
bad({ shipping: { ...base.shipping, method: '宅配' } }, 'INVALID');
bad({ agree: false }, 'INVALID');
bad({ hp: 'bot' }, 'BAD_REQUEST');
bad({ thanksUrl: 'https://evil.example.com/x' }, 'BAD_REQUEST');
bad({ thanksUrl: 'https://someone.github.io/a/</script><script>alert(1)</script>' }, 'BAD_REQUEST');
bad({ thanksUrl: 'https://someone.github.io/a"onmouseover="x' }, 'BAD_REQUEST');
bad({ thanksUrl: 'javascript:alert(1)//someone.github.io/' }, 'BAD_REQUEST');
bad({ thanksUrl: 'https://someone.github.io.evil.com/x' }, 'BAD_REQUEST');
bad({ campaign: 'Nope' }, 'BAD_CAMPAIGN');
assert.equal(createOrder({ ...base, thanksUrl: 'http://localhost:5173/2026Birthday/thanks.html' }).ok, true);
assert.equal(createOrder({ ...base, buyer: { ...base.buyer, nickname: '=HYPERLINK("x")' } }).ok, true);
assert.equal(orders.rows.at(-1)[5], '=HYPERLINK("x")'); // 以純文字寫入（假表把開頭 ' 去掉）
console.log('✓ validation');

// 3. 竄改的通知不會改狀態
post('ecpayNotify', signed({ MerchantTradeNo: r1.orderNo, RtnCode: '1', TradeAmt: '2480', CustomField1: '2026Birthday' })
  .replace(/CheckMacValue=[^&]+/, 'CheckMacValue=DEADBEEF'));
assert.equal(row(r1.orderNo)['狀態'], '付款中');
// 金額不符
post('ecpayNotify', signed({ MerchantTradeNo: r1.orderNo, RtnCode: '1', TradeAmt: '1', CustomField1: '2026Birthday' }));
assert.equal(row(r1.orderNo)['狀態'], '付款中');
assert.match(row(r1.orderNo)['系統備註'], /金額不符/);
console.log('✓ rejects tampered / wrong amount');

// 4. 正確付款通知
const paid = {
  MerchantTradeNo: r1.orderNo, RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2611201234567890',
  TradeAmt: '2480', PaymentDate: '2026/11/20 21:00:00', PaymentType: 'Credit_CreditCard',
  SimulatePaid: '0', CustomField1: '2026Birthday', CustomField2: '', CustomField3: '', CustomField4: ''
};
const notifyRes = post('ecpayNotify', signed(paid));
assert.equal(notifyRes.body, '1|OK');
o = row(r1.orderNo);
assert.equal(o['狀態'], '已付款');
assert.equal(o['付款方式'], '信用卡（Credit_CreditCard）');
assert.equal(o['付款時間'], '2026/11/20 21:00:00');
// 重送 / 之後的失敗通知都不會把已付款改掉
post('ecpayNotify', signed(paid));
post('ecpayNotify', signed({ ...paid, RtnCode: '10100058' }));
assert.equal(row(r1.orderNo)['狀態'], '已付款');
console.log('✓ notify → 已付款, idempotent');

// 5. OrderResultURL 轉回感謝頁
const page = post('ecpayResult', signed(paid)).html;
assert.ok(page.includes(JSON.stringify(row(r1.orderNo)['返回網址'])));
console.log('✓ ecpayResult redirects to', row(r1.orderNo)['返回網址']);

// 6. 查詢
const s1 = status(r1.orderNo, r1.token);
assert.equal(s1.ok, true); assert.equal(s1.status, '已付款'); assert.equal(s1.amount, 2480);
assert.equal(status(r1.orderNo, 'wrong').ok, false);
console.log('✓ orderStatus', s1.status, s1.pickup);

// 7. ATM 取號 → 付款中 + 繳費資訊 → 模擬付款完成（測試環境）
const r2 = createOrder(base);
post('ecpayPaymentInfo', signed({
  MerchantTradeNo: r2.orderNo, RtnCode: '2', RtnMsg: 'Get VirtualAccount Succeeded', TradeNo: '2611200000000001',
  TradeAmt: '2480', PaymentType: 'ATM_TAISHIN', TradeDate: '2026/11/20 21:05:00',
  BankCode: '812', vAccount: '9103522175887271', ExpireDate: '2026/11/21', CustomField1: '2026Birthday'
}));
o = row(r2.orderNo);
assert.equal(o['狀態'], '付款中');
assert.equal(o['繳費資訊'], 'ATM 轉帳｜銀行代碼 812｜虛擬帳號 9103522175887271');
assert.equal(status(r2.orderNo, r2.token).paymentExpire, '2026/11/21');
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r2.orderNo, PaymentType: 'ATM_TAISHIN', SimulatePaid: '1' }));
assert.equal(row(r2.orderNo)['狀態'], '已付款');
console.log('✓ ATM paymentInfo then simulated pay (stage)');

// 8. 信用卡失敗
const r3 = createOrder(base);
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r3.orderNo, RtnCode: '10100058', RtnMsg: '授權失敗' }));
assert.equal(row(r3.orderNo)['狀態'], '付款失敗');
console.log('✓ failed payment');

// 9. 正式環境不接受模擬付款
ctx.PropertiesService.getScriptProperties().setProperties({ ECPAY_ENV: 'prod', ECPAY_MERCHANT_ID: 'M1', ECPAY_HASH_KEY: 'k', ECPAY_HASH_IV: 'v' });
const prodKey = { merchantId: 'M1', hashKey: 'k', hashIV: 'v' };
const r4 = createOrder(base);
assert.ok(r4.ecpay.action.startsWith('https://payment.ecpay.com.tw/'));
const simProd = { ...paid, MerchantID: 'M1', MerchantTradeNo: r4.orderNo, SimulatePaid: '1' };
simProd.CheckMacValue = ctx.ecpayCheckMac_(simProd, prodKey.hashKey, prodKey.hashIV);
post('ecpayNotify', new URLSearchParams(simProd).toString());
assert.equal(row(r4.orderNo)['狀態'], '付款中');
console.log('✓ prod ignores SimulatePaid');

// 10. 贊助頁模式：建單不產生綠界參數，客戶回報付款只記時間、狀態不變
CAMP.paymentMode = 'donate';
const d = createOrder(base);
assert.equal(d.ok, true, JSON.stringify(d));
assert.equal(d.payment.mode, 'donate');
assert.equal(d.payment.url, CAMP.donateUrl);
assert.equal(d.ecpay, undefined);
assert.equal(d.thanksUrl, `https://someone.github.io/topa-store/2026Birthday/thanks.html?o=${d.orderNo}&t=${d.token}`);
assert.equal(row(d.orderNo)['狀態'], '付款中');
const report = (t) => JSON.parse(post('reportPaid', JSON.stringify({ campaign: '2026Birthday', orderNo: d.orderNo, token: t })).body);
assert.equal(report('wrong').ok, false);
assert.equal(report(d.token).ok, true);
const firstReport = row(d.orderNo)['顧客回報付款'];
assert.equal(Object.prototype.toString.call(firstReport), '[object Date]');
assert.equal(row(d.orderNo)['狀態'], '付款中');
assert.equal(report(d.token).ok, true);
assert.equal(row(d.orderNo)['顧客回報付款'], firstReport); // 重複回報不覆蓋
assert.ok(status(d.orderNo, d.token).reportedAt);
console.log('✓ donate mode: order + reportPaid (status stays 付款中)');
assert.equal(configuredMode, 'aio', 'Config.js 目前應為 aio 模式');

// 11. 舊工作表缺欄位時 setup 會補上
const old = sheets.get('訂單_2026Birthday');
old.rows[0] = old.rows[0].filter((h) => h !== '顧客回報付款');
ctx.setup();
assert.ok(ctx.headerMap_(old)['顧客回報付款']);
console.log('✓ setup adds missing columns');

console.log('\nall flow tests passed; log rows:', sheets.get('綠界通知紀錄').rows.length - 1);
