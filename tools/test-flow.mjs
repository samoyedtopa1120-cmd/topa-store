// 以假試算表跑完整流程：自動建表 → 建單 → 綠界回傳 → 查詢 → 逾期 / 人工狀態 → 新活動
import assert from 'node:assert/strict';
import { createSandbox } from './gas-sandbox.mjs';

const WEBAPP = 'https://script.google.com/macros/s/TEST/exec';
const { ctx, sheets } = createSandbox({ props: { WEBAPP_URL: WEBAPP } });
const KEY = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };

const post = (action, body) => ctx.doPost({ parameter: { action }, postData: { contents: body } });
const get = (parameter) => JSON.parse(ctx.doGet({ parameter }).body);
const createOrder = (payload) => JSON.parse(post('createOrder', JSON.stringify(payload)).body);
const signed = (p) => {
  const params = { MerchantID: KEY.merchantId, ...p };
  params.CheckMacValue = ctx.ecpayCheckMac_(params, KEY.hashKey, KEY.hashIV);
  return new URLSearchParams(params).toString();
};
const orderSheet = () => sheets.get('訂單');
const row = (no, id) => ctx.readObject_(orderSheet(id), ctx.findRow_(orderSheet(id), no));
const setCell = (no, col, v, id) => ctx.updateObject_(orderSheet(id), ctx.findRow_(orderSheet(id), no), { [col]: v });
const status = (no, t, id = '2026Birthday') => get({ action: 'orderStatus', campaign: id, o: no, t });

// 0. 第一次請求就自動建立所有工作表（不用手動 setup）
const health = get({});
assert.equal(health.schema, '3');
for (const n of ['活動設定', '運送方式', '綠界通知紀錄', '訂單', '商品']) assert.ok(sheets.get(n), n);
assert.deepEqual([...sheets.keys()].filter((n) => n.includes('_')), []); // 分頁名稱不含活動代碼
assert.equal(sheets.get('活動設定').rows.length, 2);
assert.equal(sheets.get('運送方式').rows.length, 3);
assert.equal(sheets.get('商品').rows.length, 4);
assert.equal(sheets.get('商品').rows[1][0], '2026Birthday');
console.log('✓ schema auto-created');

// 1. 活動公開資訊
const info = get({ action: 'campaign', campaign: '2026Birthday' });
assert.equal(info.ok, true);
assert.deepEqual(info.products.map((p) => p.sku), ['BDAY-SET', 'ACRYLIC', 'MOUSEPAD']);
assert.deepEqual(info.shipping, [{ name: '7-11店到店', type: '超商', fee: 60 }, { name: '全家店到店', type: '超商', fee: 60 }]);
assert.equal(get({ action: 'campaign', campaign: 'Nope' }).ok, false);
console.log('✓ campaign info');

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

// 2. 建單（後端不鎖時間、不鎖數量）
const r1 = createOrder(base);
assert.equal(r1.ok, true, JSON.stringify(r1));
assert.equal(r1.amount, 1120 + 650 * 2 + 60);
assert.equal(r1.orderNo.length, 20);
assert.ok(r1.orderNo.startsWith('TB26'));
assert.equal(r1.ecpay.params.TotalAmount, '2480');
assert.equal(r1.ecpay.params.ReturnURL, WEBAPP + '?action=ecpayNotify');
assert.equal(r1.ecpay.params.ExpireDate, '1');
assert.equal(r1.ecpay.params.StoreExpireDate, '1440');
assert.equal(r1.ecpay.params.IgnorePayment, 'BARCODE');
assert.equal(r1.ecpay.params.ClientBackURL,
  `https://someone.github.io/topa-store/2026Birthday/thanks.html?o=${r1.orderNo}&t=${r1.token}`);
assert.ok(ctx.ecpayVerify_(r1.ecpay.params, KEY));
let o = row(r1.orderNo);
assert.equal(o['狀態'], '付款中');
assert.equal(o['手機'], '0912345678');
assert.equal(o['品項明細'], '生日快樂之我全都要 x1\n防身武器好安心 x2');
assert.equal(o['品項代碼'], 'BDAY-SET*1, ACRYLIC*2');
assert.equal(createOrder({ ...base, items: [{ sku: 'ACRYLIC', qty: 500 }] }).ok, true);
console.log('✓ createOrder', r1.orderNo, '(no deadline / qty limit)');

// 3. 驗證錯誤
const bad = (patch, code) => {
  const r = createOrder({ ...base, ...patch });
  assert.equal(r.ok, false, JSON.stringify(patch)); assert.equal(r.code, code, JSON.stringify(r));
};
bad({ items: [{ sku: 'ACRYLIC', qty: 0 }] }, 'INVALID');
bad({ items: [{ sku: 'ACRYLIC', qty: 1.5 }] }, 'INVALID');
bad({ items: [{ sku: 'ACRYLIC', qty: -1 }] }, 'INVALID');
bad({ items: [{ sku: 'NOPE', qty: 1 }] }, 'INVALID');
bad({ buyer: { ...base.buyer, phone: '12345' } }, 'INVALID');
bad({ shipping: { ...base.shipping, method: '宅配' } }, 'INVALID');
bad({ shipping: { ...base.shipping, storeName: '' } }, 'INVALID');
bad({ agree: false }, 'INVALID');
bad({ hp: 'bot' }, 'BAD_REQUEST');
bad({ thanksUrl: 'https://evil.example.com/x' }, 'BAD_REQUEST');
bad({ thanksUrl: 'https://someone.github.io/a/</script><script>alert(1)</script>' }, 'BAD_REQUEST');
bad({ thanksUrl: 'https://someone.github.io/a"onmouseover="x' }, 'BAD_REQUEST');
bad({ thanksUrl: 'javascript:alert(1)//someone.github.io/' }, 'BAD_REQUEST');
bad({ thanksUrl: 'https://someone.github.io.evil.com/x' }, 'BAD_REQUEST');
bad({ campaign: 'Nope' }, 'BAD_CAMPAIGN');
bad({ campaign: '../x' }, 'BAD_CAMPAIGN');
assert.equal(createOrder({ ...base, thanksUrl: 'http://localhost:5173/2026Birthday/thanks.html' }).ok, true);
assert.equal(createOrder({ ...base, buyer: { ...base.buyer, nickname: '=HYPERLINK("x")' } }).ok, true);
assert.equal(orderSheet().rows.at(-1)[5], '=HYPERLINK("x")'); // 以純文字寫入（假表把開頭 ' 去掉）
console.log('✓ validation');

// 4. 竄改 / 金額不符的通知不會改狀態
post('ecpayNotify', signed({ MerchantTradeNo: r1.orderNo, RtnCode: '1', TradeAmt: '2480', CustomField1: '2026Birthday' })
  .replace(/CheckMacValue=[^&]+/, 'CheckMacValue=DEADBEEF'));
assert.equal(row(r1.orderNo)['狀態'], '付款中');
post('ecpayNotify', signed({ MerchantTradeNo: r1.orderNo, RtnCode: '1', TradeAmt: '1', CustomField1: '2026Birthday' }));
assert.equal(row(r1.orderNo)['狀態'], '付款中');
assert.match(row(r1.orderNo)['系統備註'], /金額不符/);
console.log('✓ rejects tampered / wrong amount');

// 5. 正確付款通知
const paid = {
  MerchantTradeNo: r1.orderNo, RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2611201234567890',
  TradeAmt: '2480', PaymentDate: '2026/11/20 21:00:00', PaymentType: 'Credit_CreditCard',
  SimulatePaid: '0', CustomField1: '2026Birthday', CustomField2: '', CustomField3: '', CustomField4: ''
};
assert.equal(post('ecpayNotify', signed(paid)).body, '1|OK');
o = row(r1.orderNo);
assert.equal(o['狀態'], '已付款');
assert.equal(o['付款方式'], '信用卡（Credit_CreditCard）');
assert.equal(o['付款時間'], '2026/11/20 21:00:00');
post('ecpayNotify', signed(paid));
post('ecpayNotify', signed({ ...paid, RtnCode: '10100058' }));
assert.equal(row(r1.orderNo)['狀態'], '已付款');
console.log('✓ notify → 已付款, idempotent');

// 6. OrderResultURL 轉回感謝頁
const page = post('ecpayResult', signed(paid)).html;
assert.ok(page.includes(JSON.stringify(row(r1.orderNo)['返回網址'])));
console.log('✓ ecpayResult redirect');

// 7. 查詢
const s1 = status(r1.orderNo, r1.token);
assert.equal(s1.ok, true); assert.equal(s1.status, '已付款'); assert.equal(s1.amount, 2480);
assert.equal(s1.pickup, '7-11店到店｜鑫台北門市'); assert.equal(s1.paymentMode, 'aio');
assert.equal(status(r1.orderNo, 'wrong').ok, false);
console.log('✓ orderStatus');

// 8. ATM 取號 → 付款中 + 繳費資訊 → 模擬付款完成（測試環境）
const r2 = createOrder(base);
post('ecpayPaymentInfo', signed({
  MerchantTradeNo: r2.orderNo, RtnCode: '2', RtnMsg: 'Get VirtualAccount Succeeded', TradeNo: '2611200000000001',
  TradeAmt: '2480', PaymentType: 'ATM_TAISHIN', TradeDate: '2026/11/20 21:05:00',
  BankCode: '812', vAccount: '9103522175887271', ExpireDate: '2099/11/21', CustomField1: '2026Birthday'
}));
o = row(r2.orderNo);
assert.equal(o['狀態'], '付款中');
assert.equal(o['繳費資訊'], 'ATM 轉帳｜銀行代碼 812｜虛擬帳號 9103522175887271');
assert.equal(status(r2.orderNo, r2.token).paymentExpire, '2099/11/21');
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r2.orderNo, PaymentType: 'ATM_TAISHIN', SimulatePaid: '1' }));
assert.equal(row(r2.orderNo)['狀態'], '已付款');
console.log('✓ ATM paymentInfo then simulated pay (stage)');

// 9. 信用卡失敗
const r3 = createOrder(base);
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r3.orderNo, RtnCode: '10100058', RtnMsg: '授權失敗' }));
assert.equal(row(r3.orderNo)['狀態'], '付款失敗');
console.log('✓ failed payment');

// 10. 逾期未付：超過繳費期限 / 刷卡頁面放著 → 查詢或下一筆建單時標記；之後付款仍改為已付款
const r4 = createOrder(base);
post('ecpayPaymentInfo', signed({
  MerchantTradeNo: r4.orderNo, RtnCode: '10100073', RtnMsg: 'Get CVS Code Succeeded', TradeNo: '2611200000000002',
  TradeAmt: '2480', PaymentType: 'CVS_CVS', PaymentNo: 'LLL22251222', ExpireDate: '2020/01/01 10:00:00', CustomField1: '2026Birthday'
}));
assert.equal(status(r4.orderNo, r4.token).status, '逾期未付');
assert.match(row(r4.orderNo)['系統備註'], /超過繳費期限/);
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r4.orderNo, PaymentType: 'CVS_CVS' }));
assert.equal(row(r4.orderNo)['狀態'], '已付款');
const r5 = createOrder(base);
setCell(r5.orderNo, '建立時間', new Date(Date.now() - 3 * 3600 * 1000));
createOrder(base); // 下一筆建單時順便掃描
assert.equal(row(r5.orderNo)['狀態'], '逾期未付');
assert.match(row(r5.orderNo)['系統備註'], /小時未完成付款/);
assert.equal(ctx.sweepExpiredOrders(), 0);
console.log('✓ expiry sweep');

// 11. 人工狀態（已取消 / 已退款）不會被付款通知蓋掉
const r6 = createOrder(base);
setCell(r6.orderNo, '狀態', '已取消');
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r6.orderNo }));
assert.equal(row(r6.orderNo)['狀態'], '已取消');
assert.match(row(r6.orderNo)['系統備註'], /已標為「已取消」/);
setCell(r1.orderNo, '狀態', '已退款');
post('ecpayNotify', signed(paid));
assert.equal(row(r1.orderNo)['狀態'], '已退款');
console.log('✓ manual statuses are kept');

// 12. 正式環境不接受模擬付款
ctx.PropertiesService.getScriptProperties().setProperties({ ECPAY_ENV: 'prod', ECPAY_MERCHANT_ID: 'M1', ECPAY_HASH_KEY: 'k', ECPAY_HASH_IV: 'v' });
const r7 = createOrder(base);
assert.ok(r7.ecpay.action.startsWith('https://payment.ecpay.com.tw/'));
const simProd = { ...paid, MerchantID: 'M1', MerchantTradeNo: r7.orderNo, SimulatePaid: '1' };
simProd.CheckMacValue = ctx.ecpayCheckMac_(simProd, 'k', 'v');
post('ecpayNotify', new URLSearchParams(simProd).toString());
assert.equal(row(r7.orderNo)['狀態'], '付款中');
ctx.PropertiesService.getScriptProperties().setProperties({ ECPAY_ENV: 'stage' });
console.log('✓ prod ignores SimulatePaid');

// 13. 只改試算表就能開新活動：宅配 / 面交 / 免運送、滿額免運、自訂題目
const camp = sheets.get('活動設定');
const ship = sheets.get('運送方式');
ctx.appendObject_(camp, { '活動代碼': 'Test2027', '活動名稱': '測試活動', '訂單前綴': 'tx27', '付款模式': 'aio', '滿額免運': 1000 });
for (const [n, ty, fee, sort] of [['宅配', '宅配', 120, 1], ['面交', '面交', 0, 2], ['電子檔', '免運送', 0, 3], ['停用', '宅配', 1, 4]]) {
  ctx.appendObject_(ship, { '活動代碼': 'Test2027', '方式名稱': n, '類型': ty, '運費': fee, '排序': sort, '啟用': n !== '停用' });
}
const i2 = get({ action: 'campaign', campaign: 'Test2027' });
assert.equal(i2.ok, true); assert.deepEqual(i2.products, []);
assert.deepEqual(i2.shipping.map((m) => m.name), ['宅配', '面交', '電子檔']);
const prod = (o) => ctx.appendObject_(sheets.get('商品'), { '活動代碼': 'Test2027', ...o });
prod({ '商品代碼': 'A', '商品名稱': '小卡', '單價': 300, '上架': true, '排序': 1 });
prod({ '商品代碼': 'B', '商品名稱': '下架品', '單價': 1, '上架': false, '排序': 2 });
prod({ '商品代碼': 'ACRYLIC', '商品名稱': '別的活動同代碼', '單價': 9, '上架': true, '排序': 3 });
assert.deepEqual(get({ action: 'campaign', campaign: 'Test2027' }).products.map((p) => p.sku), ['A', 'ACRYLIC']);
assert.equal(get({ action: 'campaign', campaign: '2026Birthday' }).products.find((p) => p.sku === 'ACRYLIC').price, 650);
const t = { ...base, campaign: 'Test2027', items: [{ sku: 'A', qty: 1 }], thanksUrl: 'https://someone.github.io/topa-store/Test2027/thanks.html' };
assert.equal(createOrder({ ...t, shipping: { method: '宅配' } }).code, 'INVALID'); // 缺地址
const h1 = createOrder({ ...t, shipping: { method: '宅配', address: '台北市信義區市府路1號' }, note: '請小心包裝',
  extra: [{ q: '簽名寫給誰', a: '小明' }, { q: '喜歡的顏色', a: ['藍', '白'] }, { q: '空白題', a: '' }] });
assert.equal(h1.ok, true, JSON.stringify(h1));
assert.ok(h1.orderNo.startsWith('TX27'));
assert.equal(h1.amount, 300 + 120);
o = row(h1.orderNo, 'Test2027');
assert.equal(o['收件地址'], '台北市信義區市府路1號');
assert.equal(o['門市名稱'], '');
assert.equal(o['買家備註'], '請小心包裝');
assert.equal(o['自訂欄位'], '簽名寫給誰：小明\n喜歡的顏色：藍、白');
assert.equal(createOrder({ ...t, items: [{ sku: 'A', qty: 4 }], shipping: { method: '宅配', address: 'x' } }).amount, 1200); // 滿額免運
assert.equal(createOrder({ ...t, items: [{ sku: 'B', qty: 1 }], shipping: { method: '面交' } }).code, 'INVALID'); // 下架
assert.equal(createOrder({ ...t, shipping: { method: '停用' } }).code, 'INVALID');
const e1 = createOrder({ ...t, buyer: { nickname: '只填暱稱' }, shipping: { method: '電子檔' } });
assert.equal(e1.ok, true, JSON.stringify(e1));
assert.equal(e1.ecpay.params.ItemName, '小卡 NT$300 x 1'); // 免運費時不列運費
assert.equal(status(h1.orderNo, h1.token, 'Test2027').pickup, '宅配');
assert.equal(status(h1.orderNo, h1.token, '2026Birthday').ok, false); // 活動不符查不到
assert.equal(row(h1.orderNo)['活動'], 'Test2027');
console.log('✓ new campaign from sheet only (home / meetup / none, free shipping, extra answers)');

// 14. 贊助頁模式：建單不產生綠界參數，客戶回報付款只記時間；不會被標逾期
ctx.updateObject_(camp, 3, { '付款模式': 'donate', '贊助頁網址': 'https://example.com/donate' });
const d = createOrder({ ...t, shipping: { method: '面交' } });
assert.equal(d.ok, true, JSON.stringify(d));
assert.equal(d.payment.mode, 'donate');
assert.equal(d.payment.url, 'https://example.com/donate');
assert.equal(d.ecpay, undefined);
const report = (tk) => JSON.parse(post('reportPaid', JSON.stringify({ campaign: 'Test2027', orderNo: d.orderNo, token: tk })).body);
assert.equal(report('wrong').ok, false);
assert.equal(report(d.token).ok, true);
setCell(d.orderNo, '建立時間', new Date(Date.now() - 30 * 3600 * 1000), 'Test2027');
const ds = status(d.orderNo, d.token, 'Test2027');
assert.equal(ds.status, '付款中'); assert.ok(ds.reportedAt); assert.equal(ds.paymentMode, 'donate');
console.log('✓ donate mode');

// 15. 前綴錯誤的活動會被擋下
ctx.updateObject_(camp, 3, { '訂單前綴': 'TOOLONG', '付款模式': 'aio' });
assert.equal(createOrder({ ...t, shipping: { method: '面交' } }).code, 'BAD_CAMPAIGN');
console.log('✓ bad prefix rejected');

// 16. 舊工作表缺欄位時，結構版本提升後會自動補上
const old = orderSheet();
old.rows[0] = old.rows[0].filter((h) => h !== '管理備註' && h !== '自訂欄位');
ctx.PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', '2');
get({});
assert.ok(ctx.headerMap_(old)['管理備註'] && ctx.headerMap_(old)['自訂欄位']);
assert.equal(sheets.get('活動設定').rows.length, 3); // 不會重複寫入種子活動
console.log('✓ schema upgrade adds missing columns');

// 17. 從 v2（每個活動一張分頁）升級：第一張改名成共用分頁，其他逐列合併，舊分頁保留
{
  const sb = createSandbox({ props: { WEBAPP_URL: WEBAPP, SCHEMA_VERSION: '2' } });
  const ins = (name, rows) => { const sh = sb.ss.insertSheet(name); rows.forEach((r) => sh.appendRow(r)); return sh; };
  const OLD_ORDER = ['訂單編號', '狀態', '建立時間', '活動', '總金額', '查詢碼', '管理備註'];
  ins('活動設定', [sb.ctx.CAMPAIGN_HEADERS, ['2026Birthday', '多帕2026生日周邊', 'TB26', 'aio'], ['Old', '舊活動', 'OLD1', 'aio']]);
  ins('運送方式', [sb.ctx.SHIPPING_HEADERS, ['2026Birthday', '7-11店到店', '超商', 60, 1, true]]);
  ins('訂單_2026Birthday', [OLD_ORDER, ['TB26A', '已付款', new Date(), '2026Birthday', 580, 'tok1', '已寄出']]);
  ins('訂單_Old', [OLD_ORDER, ['OLD1B', '付款中', new Date(), '', 100, 'tok2', '']]);
  ins('商品_2026Birthday', [['商品代碼', '商品名稱', '內容', '單價', '上架', '排序'], ['MOUSEPAD', '滑鼠也滑狗', '', 520, true, 1]]);
  const g = (p) => JSON.parse(sb.ctx.doGet({ parameter: p }).body);
  assert.equal(g({}).schema, '3');
  const names = [...sb.sheets.keys()];
  assert.ok(names.includes('訂單') && names.includes('商品'));
  assert.ok(!names.includes('訂單_2026Birthday') && !names.includes('商品_2026Birthday'));
  assert.ok(names.includes('（已合併）訂單_Old'));
  const orders = sb.ctx.readTable_(sb.sheets.get('訂單')).rows;
  assert.deepEqual(JSON.parse(JSON.stringify(orders.map((o) => [o['訂單編號'], o['活動'], o['管理備註']]))),
    [['TB26A', '2026Birthday', '已寄出'], ['OLD1B', 'Old', '']]);
  assert.equal(g({ action: 'orderStatus', campaign: '2026Birthday', o: 'TB26A', t: 'tok1' }).status, '已付款');
  assert.equal(g({ action: 'orderStatus', campaign: 'Old', o: 'OLD1B', t: 'tok2' }).ok, true);
  assert.deepEqual(g({ action: 'campaign', campaign: '2026Birthday' }).products.map((p) => p.sku), ['MOUSEPAD']);
  assert.equal(sb.ctx.readTable_(sb.sheets.get('商品')).rows.length, 1); // 不會重複寫入種子商品
  console.log('✓ legacy per-campaign tabs merged into shared tabs');
}

console.log('\nall flow tests passed; log rows:', sheets.get('綠界通知紀錄').rows.length - 1);
