/**
 * 試算表存取：以第一列標題對應欄位，調整欄位順序不會壞掉。
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
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  header.forEach(function (name, i) { if (name) map[name] = i + 1; });
  return map;
}

function appendObject_(sheet, obj) {
  var map = headerMap_(sheet);
  var row = [];
  for (var i = 0; i < sheet.getLastColumn(); i++) row.push('');
  Object.keys(obj).forEach(function (k) { if (map[k]) row[map[k] - 1] = obj[k]; });
  sheet.appendRow(row);
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

function readProducts_(campaign) {
  var sheet = sheet_(campaign.productSheet);
  var last = sheet.getLastRow();
  var products = {};
  if (last < 2) return products;
  var map = headerMap_(sheet);
  sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues().forEach(function (r) {
    var sku = String(r[map['商品代碼'] - 1] || '').trim();
    var active = r[map['上架'] - 1];
    if (!sku || !(active === true || String(active).toUpperCase() === 'TRUE')) return;
    products[sku] = {
      sku: sku,
      name: String(r[map['商品名稱'] - 1]),
      price: Number(r[map['單價'] - 1])
    };
  });
  return products;
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
