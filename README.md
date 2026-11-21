# 多帕周邊預購（topa-store）

GitHub Pages 靜態表單 → Google Apps Script 寫入試算表 → 綠界全方位金流付款 → 回寫付款結果 → 感謝頁。

```
docs/                    GitHub Pages 網站根目錄（Settings → Pages → main / docs）
  assets/                各活動共用的 CSS 與 order-core.js
  2026Birthday/          多帕 2026 生日周邊：index.html（表單）、thanks.html、config.js
gas/                     Apps Script 原始碼（Config / Code / Ecpay / Sheet / Setup）
tools/                   本機測試與預覽
```

網址：`https://<帳號>.github.io/<repo>/2026Birthday/`。新活動或改版就複製一個資料夾（例如 `2026Birthday-v2/`），並在 `gas/Config.js` 的 `CAMPAIGNS` 加一筆。

## 付款模式

每個活動在 `gas/Config.js` 與 `docs/<活動>/config.js` 設定 `paymentMode`（兩邊要一致）：

- **`aio`（2026Birthday 目前使用）**：綠界全方位金流 API，自動驗證並回寫付款結果（需特約商店金鑰，見下方）。
- **`donate`（備用）**：送單後到訂單頁，顯示應付金額與訂單編號（可一鍵複製），客戶到綠界實況主贊助頁自行填金額、在留言貼訂單編號付款，再按「我已完成付款」。系統只記錄「顧客回報付款」時間，**狀態維持付款中**；多帕到綠界後台的贊助紀錄比對留言與金額後，在試算表把狀態手動改成「已付款」（狀態欄有下拉選單）。

## 訂單狀態

| 狀態 | 何時 |
| --- | --- |
| 付款中 | 送出表單時建立；ATM／超商代碼取號後仍是付款中，並寫入「繳費資訊」「繳費期限」 |
| 已付款 | 綠界通知付款成功（已驗證檢查碼與金額） |
| 付款失敗 | 綠界通知付款失敗 |

已付款的訂單不會再被任何通知改掉；綠界重送通知不會重複處理。所有綠界回傳都記在「綠界通知紀錄」工作表。

## Apps Script API

| 方法 | 網址 | 呼叫者 |
| --- | --- | --- |
| POST | `/exec?action=createOrder` | 表單（JSON，`text/plain`） |
| POST | `/exec?action=ecpayNotify` | 綠界 ReturnURL（付款結果，伺服器對伺服器） |
| POST | `/exec?action=ecpayPaymentInfo` | 綠界 PaymentInfoURL（ATM／超商取號） |
| POST | `/exec?action=ecpayResult` | 綠界 OrderResultURL（客戶瀏覽器付款後導回，再轉到感謝頁） |
| GET | `/exec?action=orderStatus&campaign=&o=&t=` | 感謝頁查詢（需查詢碼 t） |

金額一律由 Apps Script 依「商品_2026Birthday」工作表計算，前端顯示的價格只是參考；改價請同時改工作表與 `config.js`。

## 部署步驟

### 1. 建立試算表與 Apps Script

**方法 A：手動（約 5 分鐘）**

1. 開新的 Google 試算表，命名「多帕周邊訂單」。
2. 擴充功能 → Apps Script。把 `gas/` 裡的 5 個 `.js` 檔各建一個同名檔案貼上（`Code.js` 貼到預設的 `程式碼.gs`）。
3. 專案設定 → 勾選「在編輯器中顯示 appsscript.json」→ 用 `gas/appsscript.json` 取代內容。
4. 上方函式選 `setup` → 執行 → 依指示授權。會建立訂單、商品、通知紀錄三個工作表。

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
- ATM 繳費期限 1 天（`atmExpireDays`）；超商代碼 1 天（`cvsExpireMinutes` = 1440 分鐘）。超商條碼已關閉（`ignorePayment`），因為它和超商代碼共用 `StoreExpireDate`，單位卻是天，無法同時設成 1 天。
- 超過繳費期限仍未付款的訂單會一直是「付款中」，需要的話可另外加排程標記逾期。
