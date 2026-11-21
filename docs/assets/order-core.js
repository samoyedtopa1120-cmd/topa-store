/* 各活動共用：呼叫 Apps Script、導向綠界、查詢訂單。 */
(function () {
  'use strict';

  function formatNT(n) {
    return 'NT$' + Number(n || 0).toLocaleString('zh-TW');
  }

  async function callGas(url, options) {
    if (!url) throw new Error('尚未設定 Apps Script 網址（config.js 的 gasUrl）');
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      throw new Error('網路連線失敗，請確認網路後再試一次');
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error('伺服器回應異常，請稍後再試');
    }
    return data;
  }

  /** 送出訂單。用 text/plain 避免跨網域預檢（Apps Script 不支援 OPTIONS）。 */
  function createOrder(gasUrl, payload) {
    return callGas(gasUrl + '?action=createOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  }

  /** 綠界全方位金流需以瀏覽器表單 POST 進入，這裡建立隱藏表單後自動送出。 */
  function redirectToEcpay(ecpay) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = ecpay.action;
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';
    Object.keys(ecpay.params).forEach(function (k) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = ecpay.params[k];
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }

  function getStatus(gasUrl, campaign, orderNo, token) {
    // c、sid 是 Apps Script 保留的參數名稱，不能使用
    const q = new URLSearchParams({ action: 'orderStatus', campaign: campaign, o: orderNo, t: token });
    return callGas(gasUrl + '?' + q.toString(), { method: 'GET' });
  }

  /** 活動公開資訊（商品、價格、運送方式），以試算表為準。 */
  function getCampaign(gasUrl, campaign) {
    const q = new URLSearchParams({ action: 'campaign', campaign: campaign });
    return callGas(gasUrl + '?' + q.toString(), { method: 'GET' });
  }

  function reportPaid(gasUrl, campaign, orderNo, token) {
    return callGas(gasUrl + '?action=reportPaid', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ campaign, orderNo, token })
    });
  }

  window.TopaOrder = { formatNT, createOrder, redirectToEcpay, getStatus, getCampaign, reportPaid };
})();
