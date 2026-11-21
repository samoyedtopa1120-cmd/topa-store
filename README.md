# 多帕周邊預購（topa-store）

GitHub Pages 靜態表單 → Google Apps Script 寫入試算表 → 綠界全方位金流付款 → 回寫付款結果 → 感謝頁。

```
docs/                    GitHub Pages 網站根目錄（Settings → Pages → main / docs）
  index.html, campaigns.js   表單總覽頁（無後綴網址）與活動清單
  assets/                各活動共用：base.css、order-core.js（呼叫後端）、order-form.js（表單邏輯）
  2026Birthday/          多帕 2026 生日周邊：index.html（表單）、thanks.html、config.js
gas/                     Apps Script 原始碼（Config / Campaign / Code / Ecpay / Sheet / Setup）
tools/                   本機測試與預覽
```

**後端（Apps Script 與試算表結構）各活動共用，新增活動不用改程式也不用重新部署。** 後端不檢查開始 / 截止時間，也不限制購買數量，隨時都能下單與收款；截止時間與數量上限只由前端頁面控制。

## 新增一個活動

1. **試算表「活動設定」加一列**

   | 欄位 | 說明 |
   | --- | --- |
   | 活動代碼 | 英數字、`-`、`_`，同時是前端資料夾名稱，例如 `2027Summer` |
   | 活動名稱 | 顯示在綠界付款頁 |
   | 訂單前綴 | **剛好 4 碼英數字**，例如 `TS27`（綠界訂單編號上限 20 碼） |
   | 付款模式 | `aio`（綠界 API，自動回寫）或 `donate`（實況主贊助頁，人工對帳） |
   | 滿額免運 | 商品小計達此金額時運費為 0，空白 = 不免運 |
   | ATM繳費天數 / 超商代碼繳費分鐘 | 空白時為 1 天 / 1440 分鐘 |
   | 隱藏付款方式 | 綠界付款頁要隱藏的方式，`#` 分隔；空白 = `BARCODE`，填「無」= 全部顯示 |
   | 贊助頁網址 | `donate` 模式使用 |

2. **試算表「運送方式」加幾列**（同一個活動代碼）：方式名稱、類型、運費、排序、啟用。類型決定表單要填什麼：

   | 類型 | 必填 |
   | --- | --- |
   | 超商 | 收件人姓名、手機、門市名稱 |
   | 宅配 | 收件人姓名、手機、收件地址 |
   | 面交 | 收件人姓名、手機 |
   | 免運送 | 只要暱稱（電子檔等） |

3. **商品**：第一次有人開啟活動頁面時，會自動建立「商品_活動代碼」與「訂單_活動代碼」工作表。把商品填進「商品_活動代碼」（商品代碼、名稱、內容、單價、上架打勾、排序）。也可以在 Apps Script 編輯器執行 `setup` 立刻建立。
4. **前端**：複製 `docs/2026Birthday/` 成 `docs/<活動代碼>/`，改 `index.html` 的文案、`config.js` 的 `id`、`deadline`、商品圖片 / 標籤、自訂題目（`questions`）與備註欄（`note`）。商品價格與運送方式會自動向後端讀取。
5. **總覽頁**：在 `docs/campaigns.js` 加一筆。

### 自訂題目

在 `config.js` 的 `questions` 加題目即可，後端不用改：

```js
questions: [
  { label: '簽名要寫給誰', type: 'text', required: true, placeholder: '例：小明', maxLength: 30 },
  { label: '喜歡哪個角色', type: 'radio', options: ['多帕', 'Rocks'], required: true },
  { label: '想要的贈品', type: 'checkbox', options: ['貼紙', '小卡'] },
  { label: '尺寸', type: 'select', options: ['S', 'M', 'L'] },
  { label: '想說的話', type: 'textarea' }
],
note: { label: '備註', placeholder: '想對多帕說的話' }
```

答案會存在訂單的「自訂欄位」（一題一行「題目：答案」），備註存在「買家備註」。必填只在前端檢查。

## 付款模式

- **`aio`**：綠界全方位金流 API，自動驗證並回寫付款結果（需特約商店金鑰，見下方）。
- **`donate`**：送單後到訂單頁，顯示應付金額與訂單編號（可一鍵複製），客戶到綠界實況主贊助頁自行填金額、在留言貼訂單編號付款，再按「我已完成付款」。系統只記錄「顧客回報付款」時間，**狀態維持付款中**；多帕對帳後在試算表把狀態手動改成「已付款」。

## 訂單狀態

| 狀態 | 何時 | 誰改 |
| --- | --- | --- |
| 付款中 | 送出表單時建立；ATM／超商代碼取號後仍是付款中，並寫入「繳費資訊」「繳費期限」 | 系統 |
| 已付款 | 綠界通知付款成功（已驗證檢查碼與金額） | 系統 |
| 付款失敗 | 綠界通知付款失敗 | 系統 |
| 逾期未付 | 超過繳費期限，或刷卡頁面超過 2 小時沒付款。之後若收到付款仍會自動改為已付款 | 系統 |
| 已取消 / 已退款 | 人工在試算表選擇。之後收到任何綠界通知都**不會改狀態**，只會在系統備註提醒 | 人工 |

逾期標記會在有人下單或查詢訂單時順便執行；想要定時執行，可在 Apps Script 左側「觸發條件」新增：函式 `sweepExpiredOrders`、時間驅動、每小時。

已付款的訂單不會再被任何通知改掉；綠界重送通知不會重複處理。所有綠界回傳都記在「綠界通知紀錄」工作表。

訂單工作表另有「出貨狀態、出貨日期、物流單號、管理備註、折扣」等欄位給人工使用，系統不會寫入。你也可以自行加欄位或調整欄位順序，系統依第一列標題找欄位，不會壞。

## Apps Script API

| 方法 | 網址 | 呼叫者 |
| --- | --- | --- |
| POST | `/exec?action=createOrder` | 表單（JSON，`text/plain`） |
| POST | `/exec?action=ecpayNotify` | 綠界 ReturnURL（付款結果，伺服器對伺服器） |
| POST | `/exec?action=ecpayPaymentInfo` | 綠界 PaymentInfoURL（ATM／超商取號） |
| POST | `/exec?action=ecpayResult` | 綠界 OrderResultURL（客戶瀏覽器付款後導回，再轉到感謝頁） |
| GET | `/exec?action=orderStatus&campaign=&o=&t=` | 感謝頁查詢（需查詢碼 t） |
| GET | `/exec?action=campaign&campaign=` | 表單頁讀取商品、價格、運送方式（公開資訊） |

金額一律由 Apps Script 依「商品_活動代碼」工作表計算；表單頁也會從同一份資料讀價格，改價只要改試算表。

## 部署步驟

### 1. 建立試算表與 Apps Script

**方法 A：手動（約 5 分鐘）**

1. 開新的 Google 試算表，命名「多帕周邊訂單」。
2. 擴充功能 → Apps Script。把 `gas/` 裡的 6 個 `.js` 檔各建一個同名檔案貼上（`Code.js` 貼到預設的 `程式碼.gs`）。
3. 專案設定 → 勾選「在編輯器中顯示 appsscript.json」→ 用 `gas/appsscript.json` 取代內容。
4. 上方函式選 `setup` → 執行 → 依指示授權。會建立活動設定、運送方式、訂單、商品、通知紀錄等工作表。

**方法 B：clasp（由 Claude 代為建立）**

1. 到 https://script.google.com/home/usersettings 開啟「Google Apps Script API」。
2. 在終端機執行 `npx @google/clasp login` 並登入 Google。
3. 之後由 Claude 執行建立、推送程式碼；你只要在編輯器執行一次 `setup` 授權。

### 2. 部署成網頁應用程式

1. 部署 → 新增部署作業 → 類型「網頁應用程式」。執行身分：**我**；誰可以存取：**所有人**。
2. 複製 `/exec` 網址：
   - 專案設定 → 指令碼屬性 → 新增 `WEBAPP_URL` = 該網址
   - 貼到 `docs/2026Birthday/config.js` 的 `gasUrl`
3. 之後改程式碼要「管理部署作業 → 編輯 → 版本：新版本」，網址才會維持不變。

### 3. 測試 → 上線

預設 `ECPAY_ENV=stage`，使用綠界公開測試商店，不會真的扣款。測試信用卡 `4311-9522-2222-2222`、任意未過期日期、安全碼 `222`，簡訊驗證碼 `1234`。

上線時到指令碼屬性設定：

| 屬性 | 值 |
| --- | --- |
| `ECPAY_ENV` | `prod` |
| `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` | 綠界廠商後台 → 系統開發管理 → 系統介接設定 |
| `ALLOWED_ORIGINS` | 改成你的網址，例如 `https://<帳號>.github.io` |

在編輯器執行 `showConfig` 可檢查設定（不會顯示金鑰）。

## 本機開發

```bash
npm run dev      # http://localhost:5173/2026Birthday/，用真正的 gas 程式碼 + 假試算表，送單會進綠界測試頁
npm test         # 檢查碼與完整流程測試
```

本機預覽時可開 `http://localhost:5173/gas/simulate?o=<訂單編號>` 模擬付款成功並跳到感謝頁。

## 已知限制

- Apps Script 回應會先 302 轉址，綠界可能讀不到 `1|OK` 而重送通知。寫入已在第一次完成，重送不影響資料；若綠界後台持續顯示通知失敗，可在前面加一個 Cloudflare Worker 代為回 `1|OK`。
- `ecpayResult` 的自動跳轉頁在 Apps Script 沙盒中執行，若瀏覽器擋下自動跳轉，頁面上有「查看訂單」按鈕。
- 超商條碼預設關閉：它和超商代碼共用綠界的 `StoreExpireDate` 參數，單位卻是天（代碼是分鐘），無法同時設成 1 天。
- 試算表結構有更新時（`gas/Config.js` 的 `SCHEMA_VERSION`），網頁應用程式會在下一次請求時自動補欄位，不會動到既有資料。
