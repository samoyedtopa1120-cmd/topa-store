// 以假試算表＋假商品目錄跑完整流程：建單（跨周邊）→ 綠界回傳 → 查詢 → 逾期 / 人工狀態 → 新活動 → 目錄讀不到時的容錯
import assert from 'node:assert/strict';
import { createSandbox } from './gas-sandbox.mjs';

const WEBAPP = 'https://script.google.com/macros/s/TEST/exec';
const KEY = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };
const SHIP = [{ name: '7-11店到店', type: '超商', fee: 60 }, { name: '全家店到店', type: '超商', fee: 60 }];
const PAY = { paymentMode: 'aio', donateUrl: '', atmExpireDays: 1, cvsExpireMinutes: 1440, ignorePayment: 'BARCODE', freeShippingOver: 0 };
const BDAY = [
  { sku: 'BDAY-SET', name: '生日快樂之我全都要', price: 1120 },
  { sku: 'ACRYLIC', name: '防身武器好安心', price: 650 },
  { sku: 'MOUSEPAD', name: '滑鼠也滑狗', price: 520 }
];
const CATALOG = {
  version: 1,
  campaigns: {
    store: {
      id: 'store', title: '多帕周邊', orderPrefix: 'TOPA', ...PAY, shipping: SHIP,
      products: [
        ...BDAY.map((p) => ({ ...p, group: '2026 生日周邊' })),
        { sku: 'G5979743', name: '壓克力吊飾 A款', price: 200, group: '薩摩耶大量發生中' },
        { sku: 'G5903455', name: '多毛冰淇淋搖搖立牌', price: 200, group: '冰淇淋立牌' }
      ]
    },
    '2026Birthday': { id: '2026Birthday', title: '多帕 2026 生日周邊', orderPrefix: 'TB26', ...PAY, shipping: SHIP, products: BDAY }
  }
};
const clone = (o) => JSON.parse(JSON.stringify(o));

const { ctx, sheets, remote, setCatalog } = createSandbox({ props: { WEBAPP_URL: WEBAPP }, catalog: clone(CATALOG) });
const post = (action, body) => ctx.doPost({ parameter: { action }, postData: { contents: body } });
const get = (parameter) => JSON.parse(ctx.doGet({ parameter }).body);
const createOrder = (payload) => JSON.parse(post('createOrder', JSON.stringify(payload)).body);
const signed = (p) => {
  const params = { MerchantID: KEY.merchantId, ...p };
  params.CheckMacValue = ctx.ecpayCheckMac_(params, KEY.hashKey, KEY.hashIV);
  return new URLSearchParams(params).toString();
};
const orderSheet = () => sheets.get('訂單');
const row = (no) => ctx.readObject_(orderSheet(), ctx.findRow_(orderSheet(), no));
const setCell = (no, col, v) => ctx.updateObject_(orderSheet(), ctx.findRow_(orderSheet(), no), { [col]: v });
const status = (no, t, id = 'store') => get({ action: 'orderStatus', campaign: id, o: no, t });

// 0. 第一次請求自動建立工作表；試算表只剩訂單與通知紀錄
assert.equal(get({}).schema, '3');
assert.deepEqual([...sheets.keys()].sort(), ['綠界通知紀錄', '訂單']);
console.log('✓ schema auto-created (orders + log only)');

// 1. 活動公開資訊來自商品目錄，並有快取
const info = get({ action: 'campaign', campaign: 'store' });
assert.equal(info.ok, true);
assert.deepEqual(info.products.map((p) => p.sku), ['BDAY-SET', 'ACRYLIC', 'MOUSEPAD', 'G5979743', 'G5903455']);
assert.equal(info.products[3].group, '薩摩耶大量發生中');
assert.equal(get({ action: 'campaign', campaign: 'Nope' }).ok, false);
ctx.catalogMemo_ = null;
const fetches = remote.fetchCount;
get({ action: 'campaign', campaign: 'store' });
assert.equal(remote.fetchCount, fetches); // 走快取，不重抓
console.log('✓ campaign info from catalog (cached)');

const base = {
  campaign: 'store',
  formVersion: 'store@test',
  buyer: { nickname: '小明', name: '王小明', phone: '0912-345-678', email: '' },
  shipping: { method: '7-11店到店', storeName: '鑫台北門市', storeId: '123456' },
  items: [{ sku: 'BDAY-SET', qty: 1 }, { sku: 'ACRYLIC', qty: 2 }, { sku: 'MOUSEPAD', qty: 0 }],
  agree: true,
  hp: '',
  thanksUrl: 'https://someone.github.io/topa-store/thanks.html'
};

// 2. 建單：跨周邊、運費只收一次；後端不鎖時間、不鎖數量
const r1 = createOrder(base);
assert.equal(r1.ok, true, JSON.stringify(r1));
assert.equal(r1.amount, 1120 + 650 * 2 + 60);
assert.equal(r1.orderNo.length, 20);
assert.ok(r1.orderNo.startsWith('TOPA'));
assert.equal(r1.ecpay.params.TotalAmount, '2480');
assert.equal(r1.ecpay.params.ReturnURL, WEBAPP + '?action=ecpayNotify');
assert.equal(r1.ecpay.params.StoreExpireDate, '1440');
assert.equal(r1.ecpay.params.IgnorePayment, 'BARCODE');
assert.equal(r1.ecpay.params.ClientBackURL, `https://someone.github.io/topa-store/thanks.html?o=${r1.orderNo}&t=${r1.token}`);
assert.ok(ctx.ecpayVerify_(r1.ecpay.params, KEY));
let o = row(r1.orderNo);
assert.equal(o['狀態'], '付款中');
assert.equal(o['活動'], 'store');
assert.equal(o['手機'], '0912345678');
assert.equal(o['品項明細'], '【2026 生日周邊】生日快樂之我全都要 x1\n【2026 生日周邊】防身武器好安心 x2');
assert.equal(o['品項代碼'], 'BDAY-SET*1, ACRYLIC*2');
const mix = createOrder({ ...base, items: [{ sku: 'MOUSEPAD', qty: 1 }, { sku: 'G5979743', qty: 3 }, { sku: 'G5903455', qty: 1 }] });
assert.equal(mix.amount, 520 + 600 + 200 + 60); // 三個周邊、運費一次
assert.match(row(mix.orderNo)['品項明細'], /【薩摩耶大量發生中】壓克力吊飾 A款 x3/);
assert.equal(createOrder({ ...base, items: [{ sku: 'ACRYLIC', qty: 500 }] }).ok, true);
console.log('✓ createOrder across collections, one shipping fee', r1.orderNo);

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
assert.equal(createOrder({ ...base, thanksUrl: 'http://localhost:5173/thanks.html' }).ok, true);
assert.equal(createOrder({ ...base, buyer: { ...base.buyer, nickname: '=HYPERLINK("x")' } }).ok, true);
assert.equal(orderSheet().rows.at(-1)[5], '=HYPERLINK("x")'); // 以純文字寫入（假表把開頭 ' 去掉）
console.log('✓ validation');

// 4. 竄改 / 金額不符的通知不會改狀態
post('ecpayNotify', signed({ MerchantTradeNo: r1.orderNo, RtnCode: '1', TradeAmt: '2480' }).replace(/CheckMacValue=[^&]+/, 'CheckMacValue=DEADBEEF'));
assert.equal(row(r1.orderNo)['狀態'], '付款中');
post('ecpayNotify', signed({ MerchantTradeNo: r1.orderNo, RtnCode: '1', TradeAmt: '1' }));
assert.equal(row(r1.orderNo)['狀態'], '付款中');
assert.match(row(r1.orderNo)['系統備註'], /金額不符/);
console.log('✓ rejects tampered / wrong amount');

// 5. 正確付款通知
const paid = {
  MerchantTradeNo: r1.orderNo, RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2611201234567890',
  TradeAmt: '2480', PaymentDate: '2026/11/20 21:00:00', PaymentType: 'Credit_CreditCard',
  SimulatePaid: '0', CustomField1: 'store', CustomField2: '', CustomField3: '', CustomField4: ''
};
assert.equal(post('ecpayNotify', signed(paid)).body, '1|OK');
o = row(r1.orderNo);
assert.equal(o['狀態'], '已付款');
assert.equal(o['付款方式'], '信用卡（Credit_CreditCard）');
post('ecpayNotify', signed(paid));
post('ecpayNotify', signed({ ...paid, RtnCode: '10100058' }));
assert.equal(row(r1.orderNo)['狀態'], '已付款');
console.log('✓ notify → 已付款, idempotent');

// 6. OrderResultURL 轉回感謝頁；7. 查詢
assert.ok(post('ecpayResult', signed(paid)).html.includes(JSON.stringify(row(r1.orderNo)['返回網址'])));
const s1 = status(r1.orderNo, r1.token);
assert.equal(s1.ok, true); assert.equal(s1.status, '已付款'); assert.equal(s1.amount, 2480);
assert.equal(s1.pickup, '7-11店到店｜鑫台北門市'); assert.equal(s1.paymentMode, 'aio');
assert.equal(status(r1.orderNo, 'wrong').ok, false);
assert.equal(status(r1.orderNo, r1.token, '2026Birthday').ok, false); // 活動不符
console.log('✓ ecpayResult redirect / orderStatus');

// 8. ATM 取號 → 模擬付款（測試環境）；9. 信用卡失敗
const r2 = createOrder(base);
post('ecpayPaymentInfo', signed({
  MerchantTradeNo: r2.orderNo, RtnCode: '2', RtnMsg: 'Get VirtualAccount Succeeded', TradeNo: '2611200000000001',
  TradeAmt: '2480', PaymentType: 'ATM_TAISHIN', BankCode: '812', vAccount: '9103522175887271', ExpireDate: '2099/11/21'
}));
assert.equal(row(r2.orderNo)['繳費資訊'], 'ATM 轉帳｜銀行代碼 812｜虛擬帳號 9103522175887271');
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r2.orderNo, PaymentType: 'ATM_TAISHIN', SimulatePaid: '1' }));
assert.equal(row(r2.orderNo)['狀態'], '已付款');
const r3 = createOrder(base);
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r3.orderNo, RtnCode: '10100058', RtnMsg: '授權失敗' }));
assert.equal(row(r3.orderNo)['狀態'], '付款失敗');
console.log('✓ ATM / failed payment');

// 10. 逾期未付
const r4 = createOrder(base);
post('ecpayPaymentInfo', signed({
  MerchantTradeNo: r4.orderNo, RtnCode: '10100073', RtnMsg: 'Get CVS Code Succeeded', TradeNo: '2611200000000002',
  TradeAmt: '2480', PaymentType: 'CVS_CVS', PaymentNo: 'LLL22251222', ExpireDate: '2020/01/01 10:00:00'
}));
assert.equal(status(r4.orderNo, r4.token).status, '逾期未付');
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r4.orderNo, PaymentType: 'CVS_CVS' }));
assert.equal(row(r4.orderNo)['狀態'], '已付款');
const r5 = createOrder(base);
setCell(r5.orderNo, '建立時間', new Date(Date.now() - 3 * 3600 * 1000));
createOrder(base);
assert.equal(row(r5.orderNo)['狀態'], '逾期未付');
assert.equal(ctx.sweepExpiredOrders(), 0);
console.log('✓ expiry sweep');

// 11. 人工狀態不會被付款通知蓋掉
const r6 = createOrder(base);
setCell(r6.orderNo, '狀態', '已取消');
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: r6.orderNo }));
assert.equal(row(r6.orderNo)['狀態'], '已取消');
assert.match(row(r6.orderNo)['系統備註'], /已標為「已取消」/);
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

// 13. 舊的 2026Birthday 頁面（舊商品代碼）仍可下單
const b1 = createOrder({ ...base, campaign: '2026Birthday', thanksUrl: 'https://someone.github.io/topa-store/2026Birthday/thanks.html' });
assert.equal(b1.ok, true, JSON.stringify(b1));
assert.ok(b1.orderNo.startsWith('TB26'));
assert.equal(row(b1.orderNo)['品項明細'], '生日快樂之我全都要 x1\n防身武器好安心 x2');
console.log('✓ legacy 2026Birthday campaign');

// 14. 目錄加一個活動就能用：宅配 / 面交 / 免運送、滿額免運、自訂題目
const cat2 = clone(CATALOG);
cat2.campaigns.Test2027 = {
  id: 'Test2027', title: '測試活動', orderPrefix: 'tx27', ...PAY, freeShippingOver: 1000,
  shipping: [{ name: '宅配', type: '宅配', fee: 120 }, { name: '面交', type: '面交', fee: 0 }, { name: '電子檔', type: '免運送', fee: 0 }],
  products: [{ sku: 'A', name: '小卡', price: 300 }]
};
setCatalog(cat2);
const t = { ...base, campaign: 'Test2027', items: [{ sku: 'A', qty: 1 }] };
assert.equal(createOrder({ ...t, shipping: { method: '宅配' } }).code, 'INVALID');
const h1 = createOrder({ ...t, shipping: { method: '宅配', address: '台北市信義區市府路1號' }, note: '請小心包裝',
  extra: [{ q: '簽名寫給誰', a: '小明' }, { q: '喜歡的顏色', a: ['藍', '白'] }, { q: '空白題', a: '' }] });
assert.equal(h1.ok, true, JSON.stringify(h1));
assert.ok(h1.orderNo.startsWith('TX27'));
assert.equal(h1.amount, 420);
o = row(h1.orderNo);
assert.equal(o['收件地址'], '台北市信義區市府路1號');
assert.equal(o['買家備註'], '請小心包裝');
assert.equal(o['自訂欄位'], '簽名寫給誰：小明\n喜歡的顏色：藍、白');
assert.equal(createOrder({ ...t, items: [{ sku: 'A', qty: 4 }], shipping: { method: '宅配', address: 'x' } }).amount, 1200);
const e1 = createOrder({ ...t, buyer: { nickname: '只填暱稱' }, shipping: { method: '電子檔' } });
assert.equal(e1.ok, true, JSON.stringify(e1));
assert.equal(e1.ecpay.params.ItemName, '小卡 NT$300 x 1');
console.log('✓ new campaign from catalog only (home / meetup / none, free shipping, extra answers)');

// 15. 贊助頁模式
cat2.campaigns.Test2027.paymentMode = 'donate';
cat2.campaigns.Test2027.donateUrl = 'https://example.com/donate';
setCatalog(cat2);
const d = createOrder({ ...t, shipping: { method: '面交' } });
assert.equal(d.payment.mode, 'donate'); assert.equal(d.ecpay, undefined);
const report = (tk) => JSON.parse(post('reportPaid', JSON.stringify({ campaign: 'Test2027', orderNo: d.orderNo, token: tk })).body);
assert.equal(report('wrong').ok, false);
assert.equal(report(d.token).ok, true);
setCell(d.orderNo, '建立時間', new Date(Date.now() - 30 * 3600 * 1000));
const ds = status(d.orderNo, d.token, 'Test2027');
assert.equal(ds.status, '付款中'); assert.ok(ds.reportedAt); assert.equal(ds.paymentMode, 'donate');
console.log('✓ donate mode');

// 16. 前綴錯誤的活動會被擋下
cat2.campaigns.Test2027 = { ...cat2.campaigns.Test2027, orderPrefix: 'TOOLONG', paymentMode: 'aio' };
setCatalog(cat2);
assert.equal(createOrder({ ...t, shipping: { method: '面交' } }).code, 'BAD_CAMPAIGN');
console.log('✓ bad prefix rejected');

// 17. 目錄讀不到：先用備份快取；備份也沒有時不能下單，但付款通知與查詢照常
setCatalog(clone(CATALOG));
get({ action: 'campaign', campaign: 'store' }); // 存好備份
const pending = createOrder(base);
remote.status = 500;
ctx.CacheService.getScriptCache().remove('catalog'); // 主快取過期
ctx.catalogMemo_ = null;
assert.equal(createOrder(base).ok, true); // 用備份
ctx.CacheService.getScriptCache().removeAll(['catalog', 'catalog_backup']);
ctx.catalogMemo_ = null;
const down = createOrder(base);
assert.equal(down.ok, false); assert.equal(down.code, 'SERVER_ERROR');
post('ecpayNotify', signed({ ...paid, MerchantTradeNo: pending.orderNo }));
assert.equal(row(pending.orderNo)['狀態'], '已付款');
assert.equal(status(pending.orderNo, pending.token).status, '已付款');
remote.status = 200;
console.log('✓ catalog outage: backup cache, payments and lookups unaffected');

// 18. 舊工作表缺欄位時，結構版本提升後會自動補上
const old = orderSheet();
old.rows[0] = old.rows[0].filter((h) => h !== '管理備註' && h !== '自訂欄位');
ctx.PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', '2');
get({});
assert.ok(ctx.headerMap_(old)['管理備註'] && ctx.headerMap_(old)['自訂欄位']);
console.log('✓ schema upgrade adds missing columns');

// 19. 從 v2（每個活動一張訂單分頁）升級：第一張改名、其他逐列合併，舊分頁保留
{
  const sb = createSandbox({ props: { WEBAPP_URL: WEBAPP, SCHEMA_VERSION: '2' }, catalog: clone(CATALOG) });
  const ins = (name, rows) => { const sh = sb.ss.insertSheet(name); rows.forEach((r) => sh.appendRow(r)); return sh; };
  const OLD_ORDER = ['訂單編號', '狀態', '建立時間', '活動', '總金額', '查詢碼', '管理備註'];
  ins('訂單_2026Birthday', [OLD_ORDER, ['TB26A', '已付款', new Date(), '2026Birthday', 580, 'tok1', '已寄出']]);
  ins('訂單_Old', [OLD_ORDER, ['OLD1B', '付款中', new Date(), '', 100, 'tok2', '']]);
  const g = (p) => JSON.parse(sb.ctx.doGet({ parameter: p }).body);
  assert.equal(g({}).schema, '3');
  const names = [...sb.sheets.keys()];
  assert.ok(names.includes('訂單') && !names.includes('訂單_2026Birthday') && names.includes('（已合併）訂單_Old'));
  const orders = sb.ctx.readTable_(sb.sheets.get('訂單')).rows;
  assert.deepEqual(JSON.parse(JSON.stringify(orders.map((x) => [x['訂單編號'], x['活動'], x['管理備註']]))),
    [['TB26A', '2026Birthday', '已寄出'], ['OLD1B', 'Old', '']]);
  assert.equal(g({ action: 'orderStatus', campaign: '2026Birthday', o: 'TB26A', t: 'tok1' }).status, '已付款');
  assert.equal(g({ action: 'orderStatus', campaign: 'Old', o: 'OLD1B', t: 'tok2' }).ok, true); // 目錄沒有的舊活動也查得到
  console.log('✓ legacy per-campaign order tabs merged');
}

console.log('\nall flow tests passed; log rows:', sheets.get('綠界通知紀錄').rows.length - 1);
