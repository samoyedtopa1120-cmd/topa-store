/**
 * 活動設定（讀試算表）、工作表結構、逾期標記。
 */

/** 讀取活動。找不到回傳 null。 */
function loadCampaign_(id) {
  id = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
  var row = readTable_(sheet_(CAMPAIGN_SHEET)).rows.filter(function (r) {
    return String(r['活動代碼'] || '').trim() === id;
  })[0];
  return row ? campaignFromRow_(row) : null;
}

function allCampaigns_() {
  return readTable_(sheet_(CAMPAIGN_SHEET)).rows
    .filter(function (r) { return /^[A-Za-z0-9_-]{1,40}$/.test(String(r['活動代碼'] || '').trim()); })
    .map(campaignFromRow_);
}

/** 綠界回傳時找活動：優先用 CustomField1（活動代碼），否則比對訂單前綴。 */
function campaignForOrder_(campaignId, orderNo) {
  var c = loadCampaign_(campaignId);
  if (c) return c;
  return allCampaigns_().filter(function (x) {
    return x.orderPrefix && String(orderNo).indexOf(x.orderPrefix) === 0;
  })[0] || null;
}

function campaignFromRow_(r) {
  var id = String(r['活動代碼']).trim();
  var ignore = String(r['隱藏付款方式'] == null ? '' : r['隱藏付款方式']).trim();
  // 超商條碼與超商代碼共用期限參數但單位不同（天 / 分鐘），預設關閉條碼
  if (!ignore) ignore = 'BARCODE';
  if (ignore === '無') ignore = '';
  return {
    id: id,
    title: String(r['活動名稱'] || id).trim(),
    orderPrefix: String(r['訂單前綴'] || '').trim().toUpperCase(),
    paymentMode: String(r['付款模式'] || '').trim().toLowerCase() === 'donate' ? 'donate' : 'aio',
    freeShippingOver: Math.max(0, Number(r['滿額免運']) || 0),
    atmExpireDays: Math.max(1, Math.floor(Number(r['ATM繳費天數']) || 1)),
    cvsExpireMinutes: Math.max(1, Math.floor(Number(r['超商代碼繳費分鐘']) || 1440)),
    ignorePayment: ignore,
    donateUrl: String(r['贊助頁網址'] || '').trim(),
    shipping: shippingFor_(id)
  };
}

function shippingFor_(id) {
  return readTable_(sheet_(SHIPPING_SHEET)).rows
    .filter(function (s) {
      return String(s['活動代碼'] || '').trim() === id && String(s['方式名稱'] || '').trim() && isOn_(s['啟用'], true);
    })
    .sort(function (a, b) { return (Number(a['排序']) || 0) - (Number(b['排序']) || 0); })
    .map(function (s) {
      var type = String(s['類型'] || '').trim();
      var types = [SHIP_TYPE.CVS, SHIP_TYPE.HOME, SHIP_TYPE.MEET, SHIP_TYPE.NONE];
      return {
        name: String(s['方式名稱']).trim(),
        type: types.indexOf(type) >= 0 ? type : SHIP_TYPE.CVS,
        fee: Math.max(0, Number(s['運費']) || 0)
      };
    });
}

/**
 * 確認試算表結構是最新版（新增的工作表 / 欄位 / 下拉選單、舊分頁合併）。
 * 網頁應用程式每次請求都會呼叫；版本相同時只讀一次指令碼屬性。
 */
function ensureSchema_(force) {
  var props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!force && props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION) return;
    var ss = spreadsheet_();
    mergeLegacySheets_(ss, LEGACY_ORDER_PREFIX, ORDER_SHEET, '活動');
    mergeLegacySheets_(ss, LEGACY_PRODUCT_PREFIX, PRODUCT_SHEET, '活動代碼');

    var camp = ensureSheet_(ss, CAMPAIGN_SHEET, CAMPAIGN_HEADERS);
    var ship = ensureSheet_(ss, SHIPPING_SHEET, SHIPPING_HEADERS);
    var products = ensureSheet_(ss, PRODUCT_SHEET, PRODUCT_HEADERS);
    ensureSheet_(ss, ORDER_SHEET, ORDER_HEADERS).setTabColor('#287bb9');
    ensureSheet_(ss, LOG_SHEET, LOG_HEADERS);

    var existing = readTable_(camp).rows.map(function (r) { return String(r['活動代碼'] || '').trim(); });
    var withProducts = readTable_(products).rows.map(function (r) { return String(r['活動代碼'] || '').trim(); });
    SEED_CAMPAIGNS.forEach(function (seed) {
      var id = seed.row['活動代碼'];
      if (existing.indexOf(id) >= 0) return;
      appendObject_(camp, seed.row);
      seed.shipping.forEach(function (s) {
        appendObject_(ship, { '活動代碼': id, '方式名稱': s[0], '類型': s[1], '運費': s[2], '排序': s[3], '啟用': s[4] });
      });
      if (withProducts.indexOf(id) >= 0) return;
      seed.products.forEach(function (p) {
        appendObject_(products, {
          '活動代碼': id, '商品代碼': p[0], '商品名稱': p[1], '內容': p[2], '單價': p[3], '上架': p[4], '排序': p[5]
        });
      });
    });
    props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
  } finally {
    lock.releaseLock();
  }
}

/**
 * v2 以前每個活動各有「訂單_活動代碼」「商品_活動代碼」分頁，合併到共用分頁：
 * 共用分頁還不存在時，直接把第一張改名（資料、格式、篩選都保留）；
 * 其餘逐列搬過去，舊分頁改名為「（已合併）…」保留備查，不刪除。
 */
function mergeLegacySheets_(ss, prefix, target, idCol) {
  ss.getSheets().forEach(function (old) {
    var name = old.getName();
    if (name.indexOf(prefix) !== 0) return;
    var id = name.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return;
    var dest = ss.getSheetByName(target);
    if (!dest) {
      old.setName(target);
      fillIdColumn_(old, idCol, id);
      return;
    }
    var table = readTable_(old);
    var destMap = headerMap_(dest);
    var missing = Object.keys(table.map).filter(function (h) { return !destMap[h]; });
    if (!destMap[idCol]) missing.push(idCol);
    if (missing.length) {
      dest.getRange(1, dest.getLastColumn() + 1, 1, missing.length).setValues([missing])
        .setFontWeight('bold').setBackground('#e6f3fc');
    }
    table.rows.forEach(function (r) {
      var obj = {};
      Object.keys(table.map).forEach(function (k) { obj[k] = r[k]; });
      if (!String(obj[idCol] || '').trim()) obj[idCol] = id;
      appendObject_(dest, obj);
    });
    old.setName('（已合併）' + name);
  });
}

/** 補上「活動代碼」欄並把空白的格子填入活動代碼。 */
function fillIdColumn_(sheet, col, id) {
  var map = headerMap_(sheet);
  if (!map[col]) {
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col).setFontWeight('bold').setBackground('#e6f3fc');
    map = headerMap_(sheet);
  }
  var last = sheet.getLastRow();
  if (last < 2) return;
  var range = sheet.getRange(2, map[col], last - 1, 1);
  var values = range.getValues();
  var changed = false;
  values.forEach(function (v) {
    if (!String(v[0]).trim()) { v[0] = id; changed = true; }
  });
  if (changed) range.setValues(values);
}

/** 建立或更新工作表：補上缺少的標題欄、設定下拉選單 / 勾選框。不會動到既有資料。 */
function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#e6f3fc');
    sheet.setFrozenRows(1);
  } else {
    var existing = headerMap_(sheet);
    var missing = headers.filter(function (h) { return !existing[h]; });
    if (missing.length) {
      sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing])
        .setFontWeight('bold').setBackground('#e6f3fc');
    }
  }
  var map = headerMap_(sheet);
  var rows = Math.max(1, sheet.getMaxRows() - 1);
  var list = function (col, values, strict) {
    if (!map[col]) return;
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(!strict).build();
    sheet.getRange(2, map[col], rows, 1).setDataValidation(rule);
  };
  var checkbox = function (col) {
    if (!map[col]) return;
    sheet.getRange(2, map[col], rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  };
  if (headers === ORDER_HEADERS) {
    list('狀態', STATUS_LIST, true);
    list('出貨狀態', SHIP_STATUS_LIST, false);
  } else if (headers === PRODUCT_HEADERS) {
    checkbox('上架');
  } else if (headers === SHIPPING_HEADERS) {
    list('類型', [SHIP_TYPE.CVS, SHIP_TYPE.HOME, SHIP_TYPE.MEET, SHIP_TYPE.NONE], true);
    checkbox('啟用');
  } else if (headers === CAMPAIGN_HEADERS) {
    list('付款模式', ['aio', 'donate'], true);
  }
  return sheet;
}

// ---------------------------------------------------------------- 逾期未付

/** 綠界繳費期限（yyyy/MM/dd HH:mm:ss 或 yyyy/MM/dd，台灣時間）轉成 Date。 */
function parseEcpayDate_(v) {
  if (isDate_(v)) return v;
  var m = String(v || '').trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  var pad = function (n) { return ('0' + n).slice(-2); };
  var time = m[4] ? pad(m[4]) + ':' + m[5] + ':' + (m[6] || '00') : '23:59:59';
  var d = new Date(m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + 'T' + time + '+08:00');
  return isNaN(d.getTime()) ? null : d;
}

/** 付款中訂單的付款期限；沒有期限（例如贊助頁模式）回傳 null。 */
function paymentDue_(o, c) {
  var exp = parseEcpayDate_(o['繳費期限']);
  if (exp) return exp;
  if (c.paymentMode === 'donate' || String(o['繳費資訊'] || '').trim()) return null;
  var created = isDate_(o['建立時間']) ? o['建立時間'] : null;
  return created ? new Date(created.getTime() + UNPAID_EXPIRE_HOURS * 3600 * 1000) : null;
}

function expiredUpdates_(o, now) {
  var why = String(o['繳費期限'] || '').trim()
    ? '超過繳費期限仍未付款'
    : '付款頁面超過 ' + UNPAID_EXPIRE_HOURS + ' 小時未完成付款';
  var note = String(o['系統備註'] || '').trim();
  return {
    '狀態': STATUS.EXPIRED,
    '系統備註': asText_((note ? note + '\n' : '') + why + '（系統自動標記；之後若收到付款會自動改為已付款）'),
    '最後更新': now
  };
}

/** 把逾期的付款中訂單標成逾期未付。呼叫端需持有 ScriptLock。 */
function sweepExpired_(c, sheet, now) {
  var count = 0;
  readTable_(sheet).rows.forEach(function (o) {
    if (o['狀態'] !== STATUS.PENDING || String(o['活動'] || '').trim() !== c.id) return;
    var due = paymentDue_(o, c);
    if (due && now.getTime() > due.getTime()) {
      updateObject_(sheet, o._row, expiredUpdates_(o, now));
      count++;
    }
  });
  return count;
}

/** 可手動執行，或在 Apps Script「觸發條件」設定每小時執行：標記所有活動的逾期訂單。 */
function sweepExpiredOrders() {
  ensureSchema_();
  var now = new Date();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var total = 0;
    var sheet = sheet_(ORDER_SHEET);
    allCampaigns_().forEach(function (c) { total += sweepExpired_(c, sheet, now); });
    console.log('標記逾期未付：' + total + ' 筆');
    return total;
  } finally {
    lock.releaseLock();
  }
}
