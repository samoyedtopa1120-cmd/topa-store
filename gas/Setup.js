/**
 * 第一次使用：在 Apps Script 編輯器選 setup 後按「執行」，授權後會：
 *   1. 使用此指令碼所屬的試算表（若是獨立專案則新建一份「多帕周邊訂單」）
 *   2. 建立「訂單」「綠界通知紀錄」工作表（商品與價格在網站的 data/catalog.json）
 *   3. 設定預設指令碼屬性（測試環境）
 * 可重複執行，不會覆蓋既有資料。程式更新欄位後，網頁應用程式也會在下一次請求時自動補上。
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

  ensureSchema_(true);

  // 新建試算表時預設的空白工作表
  var blank = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  if (!props.getProperty('ECPAY_ENV')) props.setProperty('ECPAY_ENV', 'stage');
  if (!props.getProperty('ALLOWED_ORIGINS')) props.setProperty('ALLOWED_ORIGINS', DEFAULT_ALLOWED_ORIGINS);

  console.log('完成。試算表：' + ss.getUrl());
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

/**
 * 授權並測試讀取商品目錄：第一次使用「讀取外部網址」權限時，在編輯器選這個函式按「執行」並授權。
 */
function testCatalog() {
  CacheService.getScriptCache().removeAll(['catalog', 'catalog_backup']);
  try {
    var all = allCampaigns_();
    console.log('商品目錄讀取成功：' + all.map(function (c) { return c.id + '（' + c.products.length + ' 個商品）'; }).join('、'));
  } catch (err) {
    console.log('已授權，但目前讀不到商品目錄（網站可能還沒更新）：' + err.message);
  }
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
    SPREADSHEET_ID: p.SPREADSHEET_ID || '(未設定)',
    SCHEMA_VERSION: p.SCHEMA_VERSION || '(未建立)',
    CATALOG_URL: p.CATALOG_URL || DEFAULT_CATALOG_URL
  }, null, 2));
}
