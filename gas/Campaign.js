/**
 * 商品目錄（docs/data/catalog.json）、工作表結構、逾期標記。
 */

var catalogMemo_ = null;

/**
 * 讀商品目錄：先看快取（CATALOG_CACHE_SECONDS），過期才向 GitHub Pages 抓；
 * 抓不到時改用 6 小時的備份快取，兩個都沒有才回錯誤。
 */
function catalog_() {
  if (catalogMemo_) return catalogMemo_;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('catalog');
  if (!raw) {
    try {
      var url = PropertiesService.getScriptProperties().getProperty('CATALOG_URL') || DEFAULT_CATALOG_URL;
      var res = UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 60000),
        { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
      raw = res.getContentText();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.campaigns) throw new Error('商品目錄格式不正確');
      cache.put('catalog', raw, CATALOG_CACHE_SECONDS);
      cache.put('catalog_backup', raw, 21600);
    } catch (err) {
      console.error('讀取商品目錄失敗', err && err.message);
      raw = cache.get('catalog_backup');
      if (!raw) throw userError_('SERVER_ERROR', '系統忙碌中（暫時讀不到商品資料），請稍後再試');
    }
  }
  catalogMemo_ = JSON.parse(raw);
  return catalogMemo_;
}

/** 讀取活動。找不到回傳 null。 */
function loadCampaign_(id) {
  id = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
  var raw = catalog_().campaigns[id];
  return raw ? normalizeCampaign_(id, raw) : null;
}

function allCampaigns_() {
  var all = catalog_().campaigns;
  return Object.keys(all).map(function (id) { return normalizeCampaign_(id, all[id]); });
}

/** 不需要商品資料的地方（查詢、逾期標記）用：讀不到目錄時退回預設值，不影響收款流程。 */
function campaignOrDefault_(id) {
  try {
    var c = loadCampaign_(id);
    if (c) return c;
  } catch (err) {
    console.error('campaignOrDefault_', err && err.message);
  }
  return { id: String(id || ''), paymentMode: 'aio', donateUrl: '', shipping: [], products: [] };
}

function normalizeCampaign_(id, r) {
  var ignore = r.ignorePayment == null ? 'BARCODE' : String(r.ignorePayment).trim();
  if (ignore === '無') ignore = '';
  var types = [SHIP_TYPE.CVS, SHIP_TYPE.HOME, SHIP_TYPE.MEET, SHIP_TYPE.NONE];
  return {
    id: id,
    title: String(r.title || id).trim(),
    orderPrefix: String(r.orderPrefix || '').trim().toUpperCase(),
    paymentMode: String(r.paymentMode || '').toLowerCase() === 'donate' ? 'donate' : 'aio',
    freeShippingOver: Math.max(0, Number(r.freeShippingOver) || 0),
    atmExpireDays: Math.max(1, Math.floor(Number(r.atmExpireDays) || 1)),
    cvsExpireMinutes: Math.max(1, Math.floor(Number(r.cvsExpireMinutes) || 1440)),
    ignorePayment: ignore,
    donateUrl: String(r.donateUrl || '').trim(),
    shipping: (r.shipping || []).filter(function (m) { return m && m.name; }).map(function (m) {
      return {
        name: String(m.name).trim(),
        type: types.indexOf(m.type) >= 0 ? m.type : SHIP_TYPE.CVS,
        fee: Math.max(0, Number(m.fee) || 0)
      };
    }),
    products: (r.products || []).filter(function (p) {
      return p && p.sku && p.name && Number(p.price) >= 0;
    }).map(function (p) {
      return { sku: String(p.sku), name: String(p.name), group: String(p.group || ''), price: Number(p.price) };
    })
  };
}

/**
 * 確認試算表結構是最新版（訂單 / 通知紀錄分頁、欄位、下拉選單、舊分頁合併）。
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
    ensureSheet_(ss, ORDER_SHEET, ORDER_HEADERS).setTabColor('#287bb9');
    ensureSheet_(ss, LOG_SHEET, LOG_HEADERS);
    props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
  } finally {
    lock.releaseLock();
  }
}

/**
 * v2 以前每個活動各有「訂單_活動代碼」分頁，合併到共用分頁：
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
  if (headers === ORDER_HEADERS) {
    list('狀態', STATUS_LIST, true);
    list('出貨狀態', SHIP_STATUS_LIST, false);
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
    var ids = {};
    readTable_(sheet).rows.forEach(function (o) {
      if (o['狀態'] === STATUS.PENDING) ids[String(o['活動'] || '').trim()] = true;
    });
    Object.keys(ids).forEach(function (id) { total += sweepExpired_(campaignOrDefault_(id), sheet, now); });
    console.log('標記逾期未付：' + total + ' 筆');
    return total;
  } finally {
    lock.releaseLock();
  }
}
