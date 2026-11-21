/**
 * 第一次使用：在 Apps Script 編輯器選 setup 後按「執行」，授權後會：
 *   1. 使用此指令碼所屬的試算表（若是獨立專案則新建一份「多帕周邊訂單」）
 *   2. 建立每個活動的「訂單_」「商品_」工作表與「綠界通知紀錄」
 *   3. 設定預設指令碼屬性（測試環境）
 * 可重複執行，不會覆蓋既有資料。
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var id = props.getProperty('SPREADSHEET_ID');
    ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('多帕周邊訂單');
  }
  ss.setSpreadsheetTimeZone('Asia/Taipei');
  props.setProperty('SPREADSHEET_ID', ss.getId());

  Object.keys(CAMPAIGNS).forEach(function (id) {
    var c = CAMPAIGNS[id];
    var orders = ensureSheet_(ss, c.orderSheet, ORDER_HEADERS);
    orders.setTabColor('#e8590c');
    var products = ensureSheet_(ss, c.productSheet, PRODUCT_HEADERS);
    if (products.getLastRow() < 2 && c.seedProducts.length) {
      products.getRange(2, 1, c.seedProducts.length, PRODUCT_HEADERS.length).setValues(c.seedProducts);
    }
  });
  ensureSheet_(ss, LOG_SHEET, LOG_HEADERS);

  // 新建試算表時預設的空白工作表
  var blank = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  if (!props.getProperty('ECPAY_ENV')) props.setProperty('ECPAY_ENV', 'stage');
  if (!props.getProperty('ALLOWED_ORIGINS')) props.setProperty('ALLOWED_ORIGINS', DEFAULT_ALLOWED_ORIGINS);

  console.log('完成。試算表：' + ss.getUrl());
  console.log('下一步：部署 → 新增部署作業 → 網頁應用程式，複製 /exec 網址，' +
    '到「專案設定 → 指令碼屬性」新增 WEBAPP_URL');
  return ss.getUrl();
}

/** 部署後把 /exec 網址記下來（綠界回傳網址會用到）。供 clasp run 使用；在編輯器裡請改到「專案設定 → 指令碼屬性」新增 WEBAPP_URL。 */
function setWebAppUrl(url) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(String(url))) {
    throw new Error('請貼上部署後的 /exec 網址');
  }
  PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', url);
  console.log('WEBAPP_URL = ' + url);
}

/** 檢查目前設定（不會顯示金鑰）。 */
function showConfig() {
  var p = PropertiesService.getScriptProperties().getProperties();
  console.log(JSON.stringify({
    ECPAY_ENV: p.ECPAY_ENV || 'stage',
    ECPAY_MERCHANT_ID: p.ECPAY_MERCHANT_ID || '(未設定，測試環境使用 3002607)',
    ECPAY_HASH_KEY: p.ECPAY_HASH_KEY ? '已設定' : '未設定',
    ECPAY_HASH_IV: p.ECPAY_HASH_IV ? '已設定' : '未設定',
    WEBAPP_URL: p.WEBAPP_URL || '(未設定)',
    ALLOWED_ORIGINS: p.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS,
    SPREADSHEET_ID: p.SPREADSHEET_ID || '(未設定)'
  }, null, 2));
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#fff1e6');
    sheet.setFrozenRows(1);
  } else {
    // 舊工作表缺少的新欄位補在最後面
    var existing = headerMap_(sheet);
    var missing = headers.filter(function (h) { return !existing[h]; });
    if (missing.length) {
      sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing])
        .setFontWeight('bold').setBackground('#fff1e6');
    }
  }
  if (headers === ORDER_HEADERS) {
    var col = headerMap_(sheet)['狀態'];
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.PENDING, STATUS.PAID, STATUS.FAILED], true)
      .setAllowInvalid(false).build();
    sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  }
  return sheet;
}
