// node tools/test-ecpay.mjs          → 檢查碼演算法測試
// node tools/test-ecpay.mjs --live   → 另外把一筆測試訂單送到綠界測試環境，確認檢查碼被接受
import assert from 'node:assert/strict';
import { createSandbox } from './gas-sandbox.mjs';

const { ctx } = createSandbox();

// 綠界技術文件中的 CheckMacValue 範例（測試商店 3002607）
const docExample = {
  ChoosePayment: 'ALL',
  EncryptType: '1',
  ItemName: 'Apple iphone 15',
  MerchantID: '3002607',
  MerchantTradeDate: '2023/03/12 15:30:23',
  MerchantTradeNo: 'ecpay20230312153023',
  PaymentType: 'aio',
  ReturnURL: 'https://www.ecpay.com.tw/receive.php',
  TotalAmount: '30000',
  TradeDesc: '促銷方案'
};
const mac = ctx.ecpayCheckMac_(docExample, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs');
console.log('doc example CheckMacValue:', mac);

assert.equal(ctx.ecpayUrlEncode_("a b~'(x)*!-_."), "a+b%7e%27(x)*!-_.");
const roundTrip = { ...docExample, CheckMacValue: mac };
assert.ok(ctx.ecpayVerify_(roundTrip, { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' }));
assert.ok(!ctx.ecpayVerify_({ ...roundTrip, TotalAmount: '1' }, { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' }));
console.log('local checks passed');

if (process.argv.includes('--live')) {
  const cfg = ctx.ecpayConfig_();
  const order = {
    orderNo: 'TEST' + Date.now().toString().slice(-12) + 'ZZZZ',
    campaignId: '2026Birthday',
    campaign: { title: '多帕2026生日周邊', atmExpireDays: 1, cvsExpireMinutes: 1440, ignorePayment: 'BARCODE' },
    total: 1180,
    itemName: '生日快樂之我全都要 NT$1120 x 1#運費 NT$60 x 1',
    createdAt: new Date(),
    thanksUrl: 'https://example.github.io/topa-store/2026Birthday/thanks.html?o=X&t=Y'
  };
  const params = ctx.ecpayBuildAioParams_(order, cfg, 'https://script.google.com/macros/s/EXAMPLE/exec');
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    redirect: 'manual'
  });
  const body = await res.text();
  const err = body.match(/(CheckMacValue[^<"]{0,80}|\d{8}[^<"]{0,60}Error[^<"]{0,40})/i);
  console.log('ECPay stage HTTP', res.status, res.headers.get('location') || '');
  console.log(err ? 'ECPay says: ' + err[0] : 'no CheckMacValue error found in response (' + body.length + ' bytes)');
}
