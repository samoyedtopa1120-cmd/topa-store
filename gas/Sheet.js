/**
 * 試算表存取：以第一列標題對應欄位，調整欄位順序、自行加欄位都不會壞。
 */
function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var s = spreadsheet_().getSheetByName(name);
  if (!s) throw new Error('找不到工作表「' + name + '」，請先執行 setup()');
  return s;
}

function headerMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  var map = {};
  if (!lastCol) return map;
  sheet.getRange(1, 1, 1, lastCol).getValues()[0].forEach(function (name, i) {
    name = String(name).trim();
    if (name && !map[name]) map[name] = i + 1;
  });
  return map;
}

function appendObject_(sheet, obj) {
  var map = headerMap_(sheet);
  var row = [];
  for (var i = 0; i < sheet.getLastColumn(); i++) row.push('');
  Object.keys(obj).forEach(function (k) { if (map[k]) row[map[k] - 1] = obj[k]; });
  sheet.appendRow(row);
}

/** 整張表讀成物件陣列，每筆帶 _row（試算表列號）。 */
function readTable_(sheet) {
  var map = headerMap_(sheet);
  var last = sheet.getLastRow();
  var rows = [];
  if (last >= 2) {
    var keys = Object.keys(map);
    sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues().forEach(function (values, i) {
      var obj = { _row: i + 2 };
      keys.forEach(function (k) { obj[k] = values[map[k] - 1]; });
      rows.push(obj);
    });
  }
  return { map: map, rows: rows };
}

/** 依第一欄（訂單編號）找列號，找不到回傳 0。從最後一列往回找，新訂單較快。 */
function findRow_(sheet, key) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var keys = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = keys.length - 1; i >= 0; i--) {
    if (String(keys[i][0]) === String(key)) return i + 2;
  }
  return 0;
}

function readObject_(sheet, row) {
  var map = headerMap_(sheet);
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var obj = {};
  Object.keys(map).forEach(function (k) { obj[k] = values[map[k] - 1]; });
  return obj;
}

function updateObject_(sheet, row, obj) {
  var map = headerMap_(sheet);
  Object.keys(obj).forEach(function (k) {
    if (map[k]) sheet.getRange(row, map[k]).setValue(obj[k]);
  });
}

/** 使用者輸入一律以純文字寫入：保留手機開頭的 0，並避免被當成公式執行。 */
function asText_(s) {
  s = String(s == null ? '' : s).trim();
  return s ? "'" + s : '';
}

/** 讀取上架中的商品，回傳 { bySku, list }（list 依排序欄位）。 */
function readProducts_(campaign) {
  var list = readTable_(ensureCampaignSheet_(campaign.productSheet, PRODUCT_HEADERS)).rows
    .filter(function (r) { return String(r['商品代碼'] || '').trim() && isOn_(r['上架'], false); })
    .map(function (r) {
      return {
        sku: String(r['商品代碼']).trim(),
        name: String(r['商品名稱'] || '').trim(),
        desc: String(r['內容'] || '').trim(),
        price: Number(r['單價']),
        order: Number(r['排序']) || 0
      };
    })
    .filter(function (p) { return p.name && p.price >= 0 && isFinite(p.price); })
    .sort(function (a, b) { return a.order - b.order; });
  var bySku = {};
  list.forEach(function (p) { bySku[p.sku] = p; });
  return { bySku: bySku, list: list };
}

/** 勾選框 / 是否欄位。blank 時回傳 blankValue。 */
function isOn_(v, blankValue) {
  if (v === true) return true;
  if (v === false) return false;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return blankValue;
  return ['true', '是', 'y', 'yes', '1', 'v', '✓'].indexOf(s) >= 0;
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function logCallback_(source, params, verified) {
  try {
    sheet_(LOG_SHEET).appendRow([
      new Date(), source, asText_(params.MerchantTradeNo), asText_(params.RtnCode),
      asText_(params.RtnMsg), verified ? 'OK' : '失敗', asText_(JSON.stringify(params))
    ]);
  } catch (err) {
    console.error('logCallback_ failed', err);
  }
}
