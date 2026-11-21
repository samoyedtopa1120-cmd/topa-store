/**
 * 綠界全方位金流 (AIO) 共用函式：設定、檢查碼、參數組裝。
 */
var ECPAY_ENDPOINTS = {
  stage: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
  prod: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
};

// 綠界官方公開的測試商店，只在 stage 使用。正式環境請設定 ECPAY_* 指令碼屬性。
var ECPAY_STAGE_MERCHANT = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };

function ecpayConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  var env = String(p.ECPAY_ENV || 'stage').toLowerCase() === 'prod' ? 'prod' : 'stage';
  var cfg = env === 'prod'
    ? { merchantId: p.ECPAY_MERCHANT_ID, hashKey: p.ECPAY_HASH_KEY, hashIV: p.ECPAY_HASH_IV }
    : ECPAY_STAGE_MERCHANT;
  if (!cfg.merchantId || !cfg.hashKey || !cfg.hashIV) {
    throw new Error('正式環境需設定指令碼屬性 ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV');
  }
  return {
    env: env,
    endpoint: ECPAY_ENDPOINTS[env],
    merchantId: cfg.merchantId,
    hashKey: cfg.hashKey,
    hashIV: cfg.hashIV
  };
}

/** 與 .NET HttpUtility.UrlEncode 相同的編碼結果（綠界規格），並轉小寫。 */
function ecpayUrlEncode_(s) {
  return encodeURIComponent(s)
    .toLowerCase()
    .replace(/'/g, '%27')
    .replace(/~/g, '%7e')
    .replace(/%20/g, '+');
}

function ecpayCheckMac_(params, hashKey, hashIV) {
  var keys = Object.keys(params)
    .filter(function (k) { return k !== 'CheckMacValue'; })
    .sort(function (a, b) {
      a = a.toLowerCase(); b = b.toLowerCase();
      return a < b ? -1 : a > b ? 1 : 0;
    });
  var raw = 'HashKey=' + hashKey + '&' +
    keys.map(function (k) { return k + '=' + params[k]; }).join('&') +
    '&HashIV=' + hashIV;
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, ecpayUrlEncode_(raw), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('').toUpperCase();
}

function ecpayVerify_(params, cfg) {
  if (!params || !params.CheckMacValue) return false;
  if (String(params.MerchantID) !== String(cfg.merchantId)) return false;
  return ecpayCheckMac_(params, cfg.hashKey, cfg.hashIV) === String(params.CheckMacValue).toUpperCase();
}

/**
 * 組出送往綠界的表單參數（含 CheckMacValue）。
 * order: { orderNo, campaignId, campaign, total, itemName, createdAt, thanksUrl }
 */
function ecpayBuildAioParams_(order, cfg, webAppUrl) {
  var params = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: order.orderNo,
    MerchantTradeDate: Utilities.formatDate(order.createdAt, 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'),
    PaymentType: 'aio',
    TotalAmount: String(order.total),
    TradeDesc: order.campaign.title,
    ItemName: order.itemName,
    ReturnURL: webAppUrl + '?action=ecpayNotify',
    OrderResultURL: webAppUrl + '?action=ecpayResult',
    PaymentInfoURL: webAppUrl + '?action=ecpayPaymentInfo',
    ClientBackURL: order.thanksUrl,
    ChoosePayment: 'ALL',
    ExpireDate: String(order.campaign.atmExpireDays || 3),
    // 超商代碼以「分鐘」計；超商條碼共用此參數但以「天」計，因此條碼要在 IgnorePayment 關掉
    StoreExpireDate: String(order.campaign.cvsExpireMinutes || 10080),
    NeedExtraPaidInfo: 'N',
    EncryptType: '1',
    CustomField1: order.campaignId
  };
  if (order.campaign.ignorePayment) params.IgnorePayment = order.campaign.ignorePayment;
  params.CheckMacValue = ecpayCheckMac_(params, cfg.hashKey, cfg.hashIV);
  return params;
}

var ECPAY_PAYMENT_LABELS = [
  ['Credit', '信用卡'], ['WebATM', '網路 ATM'], ['ATM', 'ATM 轉帳'],
  ['CVS', '超商代碼'], ['BARCODE', '超商條碼'], ['TWQR', '台灣 Pay'],
  ['ApplePay', 'Apple Pay'], ['BNPL', '無卡分期'], ['DigitalPayment', '行動支付']
];

function ecpayPaymentLabel_(type) {
  type = String(type || '');
  for (var i = 0; i < ECPAY_PAYMENT_LABELS.length; i++) {
    if (type.indexOf(ECPAY_PAYMENT_LABELS[i][0]) === 0) return ECPAY_PAYMENT_LABELS[i][1] + '（' + type + '）';
  }
  return type;
}

/** 解析綠界 POST 的 application/x-www-form-urlencoded 內容（不含網址上的 ?action=）。 */
function parseFormBody_(contents) {
  var out = {};
  String(contents || '').split('&').forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf('=');
    var k = i < 0 ? pair : pair.slice(0, i);
    var v = i < 0 ? '' : pair.slice(i + 1);
    out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
  });
  return out;
}
