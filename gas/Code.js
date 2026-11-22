/**
 * Web App 入口。
 *
 *   GET  ?action=campaign&campaign=活動            活動公開資訊（商品、價格、運送方式），前端顯示用
 *   POST ?action=createOrder        前端送單（body: JSON，Content-Type: text/plain）
 *   POST ?action=reportPaid         贊助頁模式：客戶回報已付款
 *   POST ?action=ecpayNotify        綠界 ReturnURL（伺服器對伺服器，付款結果）
 *   POST ?action=ecpayPaymentInfo   綠界 PaymentInfoURL（ATM / 超商代碼取號結果）
 *   POST ?action=ecpayResult        綠界 OrderResultURL（客戶瀏覽器付款後導回）
 *   GET  ?action=orderStatus&campaign=活動&o=訂單編號&t=查詢碼   （c、sid 為 Apps Script 保留字，勿用）
 */
function doPost(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var body = (e && e.postData && e.postData.contents) || '';
  try { ensureSchema_(); } catch (err) { console.error('ensureSchema_', err && err.stack || err); }
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
  try { ensureSchema_(); } catch (err) { console.error('ensureSchema_', err && err.stack || err); }
  // 注意：c 與 sid 是 Apps Script 保留的參數名稱，不能使用
  if (p.action === 'orderStatus') {
    return json_(safely_(function () { return orderStatus_(p.campaign, p.o, p.t); }));
  }
  if (p.action === 'campaign') {
    return json_(safely_(function () { return campaignInfo_(p.campaign); }));
  }
  // 健康檢查：只回報環境與是否已設定金鑰，不含金鑰內容
  var props = PropertiesService.getScriptProperties().getProperties();
  return json_({
    ok: true,
    service: 'topa-store',
    ecpayEnv: String(props.ECPAY_ENV || 'stage'),
    prodKeysSet: !!(props.ECPAY_MERCHANT_ID && props.ECPAY_HASH_KEY && props.ECPAY_HASH_IV),
    spreadsheetReady: !!props.SPREADSHEET_ID,
    schema: String(props.SCHEMA_VERSION || '')
  });
}

// ---------------------------------------------------------------- 活動公開資訊

function campaignInfo_(id) {
  var c = loadCampaign_(id);
  if (!c) throw userError_('BAD_CAMPAIGN', '找不到這個活動');
  return {
    ok: true,
    id: c.id,
    title: c.title,
    paymentMode: c.paymentMode,
    freeShippingOver: c.freeShippingOver,
    shipping: c.shipping,
    products: readProducts_(c).list.map(function (p) {
      return { sku: p.sku, name: p.name, group: p.group, price: p.price };
    })
  };
}

// ---------------------------------------------------------------- 建立訂單

/**
 * 後端不檢查開始 / 截止時間，也不限制購買數量（由前端控制）。
 * 只檢查：活動存在、商品上架、數量為正整數、依運送方式必填的資料、金額由試算表計算。
 */
function createOrder_(data) {
  var c = loadCampaign_(data.campaign);
  if (!c) throw userError_('BAD_CAMPAIGN', '找不到這個活動');
  if (!/^[A-Z0-9]{4}$/.test(c.orderPrefix)) {
    throw userError_('BAD_CAMPAIGN', '活動設定有誤（訂單前綴需為 4 碼英數字），請聯絡多帕');
  }
  if (data.hp) throw userError_('BAD_REQUEST', '送出失敗，請重新整理後再試');

  var buyer = data.buyer || {};
  var shipping = data.shipping || {};
  var nickname = clean_(buyer.nickname, 50);
  var name = clean_(buyer.name, 30);
  var phone = clean_(buyer.phone, 20).replace(/[\s-]/g, '');
  var email = clean_(buyer.email, 100);
  var storeName = clean_(shipping.storeName, 50);
  var storeId = clean_(shipping.storeId, 10);
  var address = clean_(shipping.address, 200);
  var note = cleanMultiline_(data.note, 500);

  var method = c.shipping.filter(function (m) { return m.name === clean_(shipping.method, 40); })[0];
  if (!method) throw userError_('INVALID', '請選擇取貨方式');
  var needContact = method.type !== SHIP_TYPE.NONE;

  if (!nickname) throw userError_('INVALID', '請填寫你是誰（暱稱 / ID）');
  if (needContact && !name) throw userError_('INVALID', '請填寫收件人本名');
  if ((needContact || phone) && !/^09\d{8}$/.test(phone)) throw userError_('INVALID', '手機號碼格式不正確（例：0912345678）');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw userError_('INVALID', 'Email 格式不正確');
  if (method.type === SHIP_TYPE.CVS) {
    if (!storeName) throw userError_('INVALID', '請填寫取貨門市名稱');
    if (storeId && !/^\d{4,8}$/.test(storeId)) throw userError_('INVALID', '門市店號應為數字');
  } else {
    storeName = '';
    storeId = '';
  }
  if (method.type === SHIP_TYPE.HOME) {
    if (!address) throw userError_('INVALID', '請填寫收件地址');
  } else {
    address = '';
  }
  if (data.agree !== true) throw userError_('INVALID', '請先同意預購須知');

  var products = readProducts_(c).bySku;
  var lines = [];
  var subtotal = 0;
  var totalQty = 0;
  (data.items || []).forEach(function (item) {
    var qty = Number(item && item.qty);
    if (!qty) return;
    var p = products[String(item.sku)];
    if (!p) throw userError_('INVALID', '商品已下架或不存在，請重新整理頁面');
    if (!(qty > 0 && Math.floor(qty) === qty && qty <= 1e6)) throw userError_('INVALID', '商品數量不正確');
    // 跨周邊的訂單：品名前面加上周邊名稱，方便出貨對照
    lines.push({ sku: p.sku, name: (p.group ? '【' + p.group + '】' : '') + p.name, price: p.price, qty: qty });
    subtotal += p.price * qty;
    totalQty += qty;
  });
  if (!totalQty) throw userError_('INVALID', '請至少選擇一項商品');
  var shippingFee = c.freeShippingOver && subtotal >= c.freeShippingOver ? 0 : method.fee;
  var total = subtotal + shippingFee;
  if (c.paymentMode === 'aio' && total < 1) throw userError_('INVALID', '訂單金額不正確');

  var extra = extraAnswers_(data.extra);
  var thanksBase = allowedThanksUrl_(data.thanksUrl);
  var createdAt = new Date();
  var token = Utilities.getUuid().replace(/-/g, '');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var orderNo, thanksUrl;
  try {
    var sheet = sheet_(ORDER_SHEET);
    try { sweepExpired_(c, sheet, createdAt); } catch (err) { console.error('sweepExpired_', err && err.stack || err); }
    do { orderNo = newOrderNo_(c.orderPrefix, createdAt); } while (findRow_(sheet, orderNo));
    thanksUrl = thanksBase + '?o=' + orderNo + '&t=' + token;
    appendObject_(sheet, {
      '訂單編號': orderNo,
      '狀態': STATUS.PENDING,
      '建立時間': createdAt,
      '活動': c.id,
      '表單版本': asText_(clean_(data.formVersion, 40)),
      '暱稱ID': asText_(nickname),
      '收件人姓名': asText_(name),
      '手機': asText_(phone),
      'Email': asText_(email),
      '取貨方式': asText_(method.name),
      '門市名稱': asText_(storeName),
      '門市店號': asText_(storeId),
      '收件地址': asText_(address),
      '品項明細': asText_(lines.map(function (l) { return l.name + ' x' + l.qty; }).join('\n')),
      '品項代碼': asText_(lines.map(function (l) { return l.sku + '*' + l.qty; }).join(', ')),
      '總件數': totalQty,
      '商品小計': subtotal,
      '運費': shippingFee,
      '總金額': total,
      '買家備註': asText_(note),
      '自訂欄位': asText_(extra),
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
    .concat(shippingFee ? ['運費 NT$' + shippingFee + ' x 1'] : []).join('#');

  var params = ecpayBuildAioParams_({
    orderNo: orderNo,
    campaignId: c.id,
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

/** 自訂題目：前端送 [{ q: 題目, a: 答案 }]（或 { 題目: 答案 }），存成「題目：答案」一行一題。 */
function extraAnswers_(raw) {
  var pairs = [];
  if (Array.isArray(raw)) {
    raw.forEach(function (x) { if (x) pairs.push([x.q, x.a]); });
  } else if (raw && typeof raw === 'object') {
    Object.keys(raw).forEach(function (k) { pairs.push([k, raw[k]]); });
  }
  return pairs.slice(0, EXTRA_MAX_FIELDS).map(function (p) {
    var q = clean_(p[0], 60);
    var a = Array.isArray(p[1]) ? p[1].map(function (v) { return clean_(v, 200); }).join('、') : p[1];
    a = cleanMultiline_(a, EXTRA_MAX_LENGTH);
    return q && a ? q + '：' + a : '';
  }).filter(String).join('\n');
}

/** 贊助頁模式：客戶按「我已完成付款」。只記錄回報時間，狀態維持付款中，由多帕對帳後手動改為已付款。 */
function reportPaid_(data) {
  var c = campaignOrDefault_(data.campaign);
  if (!c.id || !data.orderNo || !data.token) throw userError_('NOT_FOUND', '查無此訂單');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = sheet_(ORDER_SHEET);
    var row = findRow_(sheet, String(data.orderNo));
    if (!row) throw userError_('NOT_FOUND', '查無此訂單');
    var o = readObject_(sheet, row);
    if (String(o['查詢碼']) !== String(data.token) || String(o['活動']) !== c.id) throw userError_('NOT_FOUND', '查無此訂單');
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
 * 處理三種綠界回傳。可重複呼叫（綠界可能重送）。
 * 回傳 { ok, redirect } 給 ecpayResult 使用。
 */
function handleEcpayCallback_(kind, params) {
  var verified = false;
  try {
    var cfg = ecpayConfig_();
    verified = ecpayVerify_(params, cfg);
    logCallback_(kind, params, verified);
    if (!verified) return { ok: false };

    // 付款通知只靠訂單編號找訂單，不依賴商品目錄，目錄暫時讀不到也能正常收款
    var orderNo = String(params.MerchantTradeNo || '');

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sheet = sheet_(ORDER_SHEET);
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

/**
 * 狀態規則：
 *   已付款                 → 不再變動（重送的通知）
 *   付款中 / 付款失敗 / 逾期未付 + 付款成功 → 已付款
 *   已取消 / 已退款（人工）  → 狀態不變，只記錄付款資料並在系統備註提醒
 *   付款失敗通知            → 只有付款中會改為付款失敗
 */
function paymentResultUpdates_(params, order, cfg) {
  var status = String(order['狀態'] || '');
  if (status === STATUS.PAID) return null;

  var rtn = String(params.RtnCode);
  var simulated = String(params.SimulatePaid) === '1';
  var base = {
    '綠界回傳碼': asText_(rtn),
    '綠界回傳訊息': asText_(params.RtnMsg),
    '綠界交易編號': asText_(params.TradeNo),
    '付款方式': ecpayPaymentLabel_(params.PaymentType)
  };
  var manual = status === STATUS.CANCELLED || status === STATUS.REFUNDED;

  if (simulated && cfg.env === 'prod') {
    return { '系統備註': appendNote_(order, '收到綠界後台「模擬付款」通知，非真實付款，未變更狀態') };
  }
  if (Number(params.TradeAmt) !== Number(order['總金額'])) {
    base['系統備註'] = appendNote_(order, '金額不符：綠界回傳 ' + params.TradeAmt + '，請人工確認');
    return base;
  }
  if (rtn === '1') {
    base['付款時間'] = asText_(params.PaymentDate);
    if (manual) {
      base['系統備註'] = appendNote_(order, '收到付款成功通知，但訂單已標為「' + status + '」，請人工確認');
      return base;
    }
    base['狀態'] = STATUS.PAID;
    if (simulated) base['系統備註'] = appendNote_(order, '測試環境模擬付款');
    return base;
  }
  // ATM / 超商取號成功也會帶 2 或 10100073，此時尚未付款
  if (rtn === '2' || rtn === '10100073') return manual ? null : base;
  if (status !== STATUS.PENDING) return null;
  base['狀態'] = STATUS.FAILED;
  return base;
}

function paymentInfoUpdates_(params, order) {
  var status = String(order['狀態'] || '');
  if (status !== STATUS.PENDING && status !== STATUS.EXPIRED) return null;
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
  var updates = {
    '付款方式': ecpayPaymentLabel_(type),
    '綠界交易編號': asText_(params.TradeNo),
    '綠界回傳碼': asText_(params.RtnCode),
    '綠界回傳訊息': asText_(params.RtnMsg),
    '繳費資訊': asText_(info),
    '繳費期限': asText_(params.ExpireDate)
  };
  if (status === STATUS.EXPIRED) updates['狀態'] = STATUS.PENDING;
  return updates;
}

function appendNote_(order, text) {
  var note = String(order['系統備註'] || '').trim();
  return asText_(note && note.indexOf(text) < 0 ? note + '\n' + text : text);
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
      'background:#287bb9;color:#fff;border-radius:999px;text-decoration:none">查看訂單</a></p></div>' +
      '<script>try{window.top.location.replace(' + JSON.stringify(url).replace(/</g, '\\u003c') + ');}catch(e){}</script>'
    : '<div style="font-family:sans-serif;text-align:center;padding:48px 16px;line-height:1.7">' +
      '<p>我們暫時無法確認這筆付款，請稍後用訂單頁的連結查詢，或聯絡多帕。</p></div>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('付款完成')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------- 查詢訂單

function orderStatus_(campaignId, orderNo, token) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(campaignId || '')) || !orderNo || !token) throw userError_('NOT_FOUND', '查無此訂單');
  var c = campaignOrDefault_(campaignId);
  var sheet = sheet_(ORDER_SHEET);
  var row = findRow_(sheet, String(orderNo));
  if (!row) throw userError_('NOT_FOUND', '查無此訂單');
  var o = readObject_(sheet, row);
  if (String(o['查詢碼']) !== String(token) || String(o['活動']) !== c.id) throw userError_('NOT_FOUND', '查無此訂單');

  // 查詢時順便標記逾期（重新在鎖內讀一次，避免蓋掉同時進來的付款通知）
  var now = new Date();
  var due = o['狀態'] === STATUS.PENDING ? paymentDue_(o, c) : null;
  if (due && now.getTime() > due.getTime()) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      o = readObject_(sheet, row);
      due = o['狀態'] === STATUS.PENDING ? paymentDue_(o, c) : null;
      if (due && now.getTime() > due.getTime()) {
        var upd = expiredUpdates_(o, now);
        updateObject_(sheet, row, upd);
        o['狀態'] = upd['狀態'];
      }
    } finally {
      lock.releaseLock();
    }
  }

  var fmt = function (v) {
    return isDate_(v) ? Utilities.formatDate(v, 'Asia/Taipei', 'yyyy/MM/dd HH:mm') : String(v || '');
  };
  var store = String(o['門市名稱'] || '');
  return {
    ok: true,
    orderNo: String(o['訂單編號']),
    status: String(o['狀態']),
    createdAt: fmt(o['建立時間']),
    items: String(o['品項明細']),
    subtotal: Number(o['商品小計']),
    shippingFee: Number(o['運費']),
    amount: Number(o['總金額']),
    pickup: String(o['取貨方式']) + (store ? '｜' + store : ''),
    paymentMode: c.paymentMode,
    donateUrl: c.paymentMode === 'donate' ? c.donateUrl : '',
    paymentType: String(o['付款方式'] || ''),
    paidAt: String(o['付款時間'] || ''),
    paymentInfo: String(o['繳費資訊'] || ''),
    paymentExpire: String(o['繳費期限'] || ''),
    reportedAt: fmt(o['顧客回報付款']),
    shipStatus: String(o['出貨狀態'] || '')
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

/** 允許換行的文字（備註、自訂題目） */
function cleanMultiline_(s, max) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
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
