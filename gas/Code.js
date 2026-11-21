/**
 * Web App 入口。
 *
 *   POST ?action=createOrder        前端送單（body: JSON，Content-Type: text/plain）
 *   POST ?action=ecpayNotify        綠界 ReturnURL（伺服器對伺服器，付款結果）
 *   POST ?action=ecpayPaymentInfo   綠界 PaymentInfoURL（ATM / 超商代碼取號結果）
 *   POST ?action=ecpayResult        綠界 OrderResultURL（客戶瀏覽器付款後導回）
 *   GET  ?action=orderStatus&campaign=活動&o=訂單編號&t=查詢碼   （c、sid 為 Apps Script 保留字，勿用）
 */
function doPost(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var body = (e && e.postData && e.postData.contents) || '';
  switch (action) {
    case 'createOrder':
      return json_(safely_(function () { return createOrder_(JSON.parse(body || '{}')); }));
    case 'reportPaid':
      return json_(safely_(function () { return reportPaid_(JSON.parse(body || '{}')); }));
    case 'ecpayNotify':
      handleEcpayCallback_('notify', parseFormBody_(body));
      return text_('1|OK');
    case 'ecpayPaymentInfo':
      handleEcpayCallback_('paymentInfo', parseFormBody_(body));
      return text_('1|OK');
    case 'ecpayResult':
      return resultPage_(handleEcpayCallback_('result', parseFormBody_(body)));
    default:
      return json_({ ok: false, code: 'UNKNOWN_ACTION' });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'orderStatus') {
    // 注意：c 與 sid 是 Apps Script 保留的參數名稱，不能使用
    return json_(safely_(function () { return orderStatus_(p.campaign, p.o, p.t); }));
  }
  // 健康檢查：只回報環境與是否已設定金鑰，不含金鑰內容
  var props = PropertiesService.getScriptProperties().getProperties();
  return json_({
    ok: true,
    service: 'topa-store',
    ecpayEnv: String(props.ECPAY_ENV || 'stage'),
    prodKeysSet: !!(props.ECPAY_MERCHANT_ID && props.ECPAY_HASH_KEY && props.ECPAY_HASH_IV),
    spreadsheetReady: !!props.SPREADSHEET_ID
  });
}

// ---------------------------------------------------------------- 建立訂單

function createOrder_(data) {
  var campaignId = String(data.campaign || '');
  var c = CAMPAIGNS[campaignId];
  if (!c) throw userError_('BAD_CAMPAIGN', '找不到這個活動');
  if (Date.now() > new Date(c.deadline).getTime()) throw userError_('CLOSED', '預購已截止，謝謝大家的支持！');
  if (data.hp) throw userError_('BAD_REQUEST', '送出失敗，請重新整理後再試');

  var buyer = data.buyer || {};
  var shipping = data.shipping || {};
  var nickname = clean_(buyer.nickname, 50);
  var name = clean_(buyer.name, 30);
  var phone = clean_(buyer.phone, 20).replace(/[\s-]/g, '');
  var email = clean_(buyer.email, 100);
  var pickup = clean_(shipping.method, 20);
  var storeName = clean_(shipping.storeName, 50);
  var storeId = clean_(shipping.storeId, 10);

  if (!nickname) throw userError_('INVALID', '請填寫你是誰（暱稱 / ID）');
  if (!name) throw userError_('INVALID', '請填寫收件人本名');
  if (!/^09\d{8}$/.test(phone)) throw userError_('INVALID', '手機號碼格式不正確（例：0912345678）');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw userError_('INVALID', 'Email 格式不正確');
  if (c.pickupMethods.indexOf(pickup) < 0) throw userError_('INVALID', '請選擇取貨方式');
  if (!storeName) throw userError_('INVALID', '請填寫取貨門市名稱');
  if (storeId && !/^\d{4,8}$/.test(storeId)) throw userError_('INVALID', '門市店號應為數字');
  if (data.agree !== true) throw userError_('INVALID', '請先同意預購須知');

  var products = readProducts_(c);
  var lines = [];
  var subtotal = 0;
  var totalQty = 0;
  (data.items || []).forEach(function (item) {
    var qty = Number(item && item.qty);
    if (!qty) return;
    var p = products[String(item.sku)];
    if (!p) throw userError_('INVALID', '商品已下架或不存在，請重新整理頁面');
    if (!(qty > 0 && qty <= c.maxQtyPerItem && Math.floor(qty) === qty)) {
      throw userError_('INVALID', '每項商品數量需為 1–' + c.maxQtyPerItem);
    }
    lines.push({ name: p.name, price: p.price, qty: qty });
    subtotal += p.price * qty;
    totalQty += qty;
  });
  if (!totalQty) throw userError_('INVALID', '請至少選擇一項商品');
  var total = subtotal + c.shippingFee;

  var thanksBase = allowedThanksUrl_(data.thanksUrl);
  var createdAt = new Date();
  var token = Utilities.getUuid().replace(/-/g, '');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var orderNo;
  try {
    var sheet = sheet_(c.orderSheet);
    do { orderNo = newOrderNo_(c.orderPrefix, createdAt); } while (findRow_(sheet, orderNo));
    var thanksUrl = thanksBase + '?o=' + orderNo + '&t=' + token;
    appendObject_(sheet, {
      '訂單編號': orderNo,
      '狀態': STATUS.PENDING,
      '建立時間': createdAt,
      '活動': campaignId,
      '表單版本': asText_(clean_(data.formVersion, 40)),
      '暱稱ID': asText_(nickname),
      '收件人姓名': asText_(name),
      '手機': asText_(phone),
      'Email': asText_(email),
      '取貨方式': pickup,
      '門市名稱': asText_(storeName),
      '門市店號': asText_(storeId),
      '品項明細': lines.map(function (l) { return l.name + ' x' + l.qty; }).join('\n'),
      '總件數': totalQty,
      '商品小計': subtotal,
      '運費': c.shippingFee,
      '總金額': total,
      '最後更新': createdAt,
      '查詢碼': token,
      '返回網址': thanksUrl
    });
  } finally {
    lock.releaseLock();
  }

  if (c.paymentMode === 'donate') {
    return {
      ok: true,
      orderNo: orderNo,
      token: token,
      amount: total,
      thanksUrl: thanksUrl,
      payment: { mode: 'donate', url: c.donateUrl }
    };
  }

  var webAppUrl = webAppUrl_();
  var cfg = ecpayConfig_();
  var itemName = lines.map(function (l) { return l.name + ' NT$' + l.price + ' x ' + l.qty; })
    .concat(['運費 NT$' + c.shippingFee + ' x 1']).join('#');

  var params = ecpayBuildAioParams_({
    orderNo: orderNo,
    campaignId: campaignId,
    campaign: c,
    total: total,
    itemName: itemName.slice(0, 200),
    createdAt: createdAt,
    thanksUrl: thanksUrl
  }, cfg, webAppUrl);

  return {
    ok: true,
    orderNo: orderNo,
    token: token,
    amount: total,
    thanksUrl: thanksUrl,
    payment: { mode: 'aio' },
    ecpay: { action: cfg.endpoint, params: params }
  };
}

/** 贊助頁模式：客戶按「我已完成付款」。只記錄回報時間，狀態維持付款中，由多帕對帳後手動改為已付款。 */
function reportPaid_(data) {
  var c = CAMPAIGNS[String(data.campaign || '')];
  if (!c || !data.orderNo || !data.token) throw userError_('NOT_FOUND', '查無此訂單');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = sheet_(c.orderSheet);
    var row = findRow_(sheet, String(data.orderNo));
    if (!row) throw userError_('NOT_FOUND', '查無此訂單');
    var o = readObject_(sheet, row);
    if (String(o['查詢碼']) !== String(data.token)) throw userError_('NOT_FOUND', '查無此訂單');
    if (o['狀態'] === STATUS.PENDING && !o['顧客回報付款']) {
      var now = new Date();
      updateObject_(sheet, row, { '顧客回報付款': now, '最後更新': now });
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function newOrderNo_(prefix, date) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var rand = '';
  for (var i = 0; i < 4; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
  // 4 + 12 + 4 = 20 碼（綠界 MerchantTradeNo 上限）
  return prefix + Utilities.formatDate(date, 'Asia/Taipei', 'yyMMddHHmmss') + rand;
}

// ---------------------------------------------------------------- 綠界回傳

/**
 * 處理三種綠界回傳。可重複呼叫（綠界可能重送），已付款的訂單不會被改回。
 * 回傳 { ok, redirect } 給 ecpayResult 使用。
 */
function handleEcpayCallback_(kind, params) {
  var verified = false;
  try {
    var cfg = ecpayConfig_();
    verified = ecpayVerify_(params, cfg);
    logCallback_(kind, params, verified);
    if (!verified) return { ok: false };

    var orderNo = String(params.MerchantTradeNo || '');
    var c = CAMPAIGNS[params.CustomField1] || campaignByOrderNo_(orderNo);
    if (!c) return { ok: false };

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sheet = sheet_(c.orderSheet);
      var row = findRow_(sheet, orderNo);
      if (!row) return { ok: false };
      var order = readObject_(sheet, row);
      var updates = kind === 'paymentInfo'
        ? paymentInfoUpdates_(params, order)
        : paymentResultUpdates_(params, order, cfg);
      if (updates) {
        updates['最後更新'] = new Date();
        updateObject_(sheet, row, updates);
      }
      return { ok: true, redirect: String(order['返回網址'] || '') };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error('handleEcpayCallback_', kind, err && err.stack || err);
    return { ok: false };
  }
}

function paymentResultUpdates_(params, order, cfg) {
  var rtn = String(params.RtnCode);
  var simulated = String(params.SimulatePaid) === '1';
  var base = {
    '綠界回傳碼': asText_(rtn),
    '綠界回傳訊息': asText_(params.RtnMsg),
    '綠界交易編號': asText_(params.TradeNo),
    '付款方式': ecpayPaymentLabel_(params.PaymentType)
  };

  if (order['狀態'] === STATUS.PAID) return null; // 重送的通知，不再更動

  if (simulated && cfg.env === 'prod') {
    return { '系統備註': '收到綠界後台「模擬付款」通知，非真實付款，未變更狀態' };
  }
  if (Number(params.TradeAmt) !== Number(order['總金額'])) {
    base['系統備註'] = '金額不符：綠界回傳 ' + params.TradeAmt + '，請人工確認';
    return base;
  }
  if (rtn === '1') {
    base['狀態'] = STATUS.PAID;
    base['付款時間'] = asText_(params.PaymentDate);
    if (simulated) base['系統備註'] = '測試環境模擬付款';
    return base;
  }
  // ATM / 超商取號成功也會帶 2 或 10100073，此時尚未付款
  if (rtn === '2' || rtn === '10100073') return base;
  base['狀態'] = STATUS.FAILED;
  return base;
}

function paymentInfoUpdates_(params, order) {
  if (order['狀態'] === STATUS.PAID) return null;
  var type = String(params.PaymentType || '');
  var info;
  if (type.indexOf('ATM') === 0) {
    info = 'ATM 轉帳｜銀行代碼 ' + params.BankCode + '｜虛擬帳號 ' + params.vAccount;
  } else if (type.indexOf('CVS') === 0) {
    info = '超商代碼 ' + params.PaymentNo;
  } else if (type.indexOf('BARCODE') === 0) {
    info = '超商條碼｜' + [params.Barcode1, params.Barcode2, params.Barcode3].join(' / ');
  } else {
    info = type;
  }
  return {
    '付款方式': ecpayPaymentLabel_(type),
    '綠界交易編號': asText_(params.TradeNo),
    '綠界回傳碼': asText_(params.RtnCode),
    '綠界回傳訊息': asText_(params.RtnMsg),
    '繳費資訊': asText_(info),
    '繳費期限': asText_(params.ExpireDate)
  };
}

function campaignByOrderNo_(orderNo) {
  for (var id in CAMPAIGNS) {
    if (orderNo.indexOf(CAMPAIGNS[id].orderPrefix) === 0) return CAMPAIGNS[id];
  }
  return null;
}

/** OrderResultURL：客戶瀏覽器付款後導回這裡，再轉往 GitHub Pages 的感謝頁。 */
function resultPage_(result) {
  var url = result.ok && result.redirect ? result.redirect : '';
  var safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  var html = url
    ? '<base target="_top">' +
      '<div style="font-family:sans-serif;text-align:center;padding:48px 16px;line-height:1.7">' +
      '<p>付款結果已收到，正在前往訂單頁面…</p>' +
      '<p><a href="' + safeUrl + '" target="_top" style="display:inline-block;padding:12px 24px;' +
      'background:#e8590c;color:#fff;border-radius:999px;text-decoration:none">查看訂單</a></p></div>' +
      '<script>try{window.top.location.replace(' + JSON.stringify(url).replace(/</g, '\\u003c') + ');}catch(e){}</script>'
    : '<div style="font-family:sans-serif;text-align:center;padding:48px 16px;line-height:1.7">' +
      '<p>我們暫時無法確認這筆付款，請稍後用訂單頁的連結查詢，或聯絡多帕。</p></div>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('付款完成')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------- 查詢訂單

function orderStatus_(campaignId, orderNo, token) {
  var c = CAMPAIGNS[campaignId];
  if (!c || !orderNo || !token) throw userError_('NOT_FOUND', '查無此訂單');
  var sheet = sheet_(c.orderSheet);
  var row = findRow_(sheet, String(orderNo));
  if (!row) throw userError_('NOT_FOUND', '查無此訂單');
  var o = readObject_(sheet, row);
  if (String(o['查詢碼']) !== String(token)) throw userError_('NOT_FOUND', '查無此訂單');
  return {
    ok: true,
    orderNo: String(o['訂單編號']),
    status: String(o['狀態']),
    createdAt: o['建立時間'] instanceof Date
      ? Utilities.formatDate(o['建立時間'], 'Asia/Taipei', 'yyyy/MM/dd HH:mm') : String(o['建立時間']),
    items: String(o['品項明細']),
    subtotal: Number(o['商品小計']),
    shippingFee: Number(o['運費']),
    amount: Number(o['總金額']),
    pickup: String(o['取貨方式']) + '｜' + String(o['門市名稱']),
    paymentType: String(o['付款方式'] || ''),
    paidAt: String(o['付款時間'] || ''),
    paymentInfo: String(o['繳費資訊'] || ''),
    paymentExpire: String(o['繳費期限'] || ''),
    reportedAt: o['顧客回報付款'] instanceof Date
      ? Utilities.formatDate(o['顧客回報付款'], 'Asia/Taipei', 'yyyy/MM/dd HH:mm') : String(o['顧客回報付款'] || '')
  };
}

// ---------------------------------------------------------------- 工具

function webAppUrl_() {
  var url = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL') || DEFAULT_WEBAPP_URL ||
    ScriptApp.getService().getUrl();
  if (!url) throw new Error('尚未設定 WEBAPP_URL（部署後的 /exec 網址）');
  return url;
}

/** 檢查前端送來的感謝頁網址屬於允許的網站，避免被拿去做任意轉址。 */
function allowedThanksUrl_(raw) {
  // 路徑只允許安全字元，避免網址被塞入 HTML / JS 片段
  var m = String(raw || '').match(/^(https?):\/\/([A-Za-z0-9.-]+)(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?(?:[?#].*)?$/);
  if (!m) throw userError_('BAD_REQUEST', '頁面網址異常，請重新整理後再試');
  var origin = m[1] + '://' + m[2];
  var allowed = (PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGINS') || DEFAULT_ALLOWED_ORIGINS)
    .split(',').map(function (s) { return s.trim(); }).filter(String);
  var ok = allowed.some(function (a) {
    if (a.indexOf('://*.') > 0) {
      var parts = a.split('://*.');
      return m[1] === parts[0] && (m[2] === parts[1] || m[2].slice(-(parts[1].length + 1)) === '.' + parts[1]);
    }
    return a === origin;
  });
  if (!ok) throw userError_('BAD_REQUEST', '此網址未被允許下單');
  return m[1] + '://' + m[2] + (m[3] || '') + (m[4] || '/');
}

function clean_(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function userError_(code, message) {
  var err = new Error(message);
  err.userCode = code;
  return err;
}

function safely_(fn) {
  try {
    return fn();
  } catch (err) {
    if (err && err.userCode) return { ok: false, code: err.userCode, message: err.message };
    console.error(err && err.stack || err);
    return { ok: false, code: 'SERVER_ERROR', message: '系統忙碌中，請稍後再試一次' };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function text_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
