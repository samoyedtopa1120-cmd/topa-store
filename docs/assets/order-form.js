/*
 * 預購頁共用邏輯（所有活動共用）。
 * 需要頁面先載入 config.js（window.CAMPAIGN）與 order-core.js（window.TopaOrder）。
 *
 * 商品、價格、運送方式：先用 config.js 顯示，再以 Apps Script（試算表）回傳的資料覆蓋。
 * 截止時間與數量上限只在前端控制，後端不鎖。
 */
(function () {
  'use strict';
  const C = window.CAMPAIGN;
  const T = window.TopaOrder;
  const $ = (id) => document.getElementById(id);
  const TYPE = { CVS: '超商', HOME: '宅配', MEET: '面交', NONE: '免運送' };

  // 區塊編號 01、02…（中間有隱藏的區塊時自動跳過）
  function numberSections() {
    let n = 0;
    document.querySelectorAll('#order > .section').forEach((s) => {
      const num = s.querySelector('h2 .num');
      if (num && !s.hidden) num.textContent = String(++n).padStart(2, '0');
    });
  }

  // ---------- 截止（只有前端） ----------
  if (C.deadline && Date.now() > new Date(C.deadline).getTime()) {
    $('closed').hidden = false;
    $('order').hidden = true;
    $('checkout').hidden = true;
    return;
  }

  const maxQty = Number(C.maxQty) || 99;
  const extras = Object.fromEntries((C.products || []).map((p) => [p.sku, p])); // 圖片、標籤
  let products = (C.products || []).slice();
  let shipping = (C.shipping || []).slice();
  let freeOver = Number(C.freeShippingOver) || 0;
  const qty = {};

  // ---------- 商品 ----------
  const list = $('products');
  function renderProducts() {
    list.innerHTML = '';
    products.forEach((p) => {
      if (!(p.sku in qty)) qty[p.sku] = 0;
      const extra = extras[p.sku] || {};
      const image = p.image || extra.image;
      const badge = p.badge || extra.badge;
      const el = document.createElement('div');
      el.className = 'product';
      el.dataset.sku = p.sku;
      el.innerHTML =
        (image ? '<img alt="" loading="lazy">' : '') +
        '<div class="info"><div class="name"></div><div class="desc"></div><div class="price"></div></div>' +
        '<div class="stepper">' +
        '<button type="button" data-d="-1" aria-label="減少">−</button>' +
        '<output aria-live="polite">0</output>' +
        '<button type="button" data-d="1" aria-label="增加">＋</button></div>';
      if (image) el.querySelector('img').src = image;
      el.querySelector('.name').textContent = p.name;
      if (badge) {
        const b = document.createElement('span');
        b.className = 'badge'; b.textContent = badge;
        el.querySelector('.name').appendChild(b);
      }
      el.querySelector('.desc').textContent = p.desc || extra.desc || '';
      el.querySelector('.price').textContent = T.formatNT(p.price);
      el.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
        qty[p.sku] = Math.max(0, Math.min(maxQty, qty[p.sku] + Number(btn.dataset.d)));
        render();
      }));
      list.appendChild(el);
    });
    if (!products.length) list.innerHTML = '<p class="hint">商品準備中，請稍後再來看看！</p>';
  }

  // ---------- 運送方式 ----------
  function currentMethod() {
    const checked = document.querySelector('input[name="pickup"]:checked');
    return shipping.find((m) => checked && m.name === checked.value) || shipping[0] || null;
  }
  function renderShipping() {
    const prev = currentMethod();
    const box = $('pickup');
    box.innerHTML = '';
    shipping.forEach((m, i) => {
      const label = document.createElement('label');
      label.className = 'chip';
      label.innerHTML = '<input type="radio" name="pickup" required><span><b></b><small></small></span>';
      const input = label.querySelector('input');
      input.value = m.name;
      input.checked = prev ? prev.name === m.name : i === 0;
      label.querySelector('b').textContent = m.name;
      label.querySelector('small').textContent = m.fee ? '運費 ' + T.formatNT(m.fee) : '免運費';
      input.addEventListener('change', () => { applyShipType(); render(); });
      box.appendChild(label);
    });
    if (!box.querySelector('input:checked') && box.querySelector('input')) box.querySelector('input').checked = true;

    const fees = [...new Set(shipping.map((m) => m.fee))];
    const allCvs = shipping.length && shipping.every((m) => m.type === TYPE.CVS);
    let hint = allCvs ? '一律超商店到店，' : '';
    hint += fees.length === 1 ? (fees[0] ? '運費固定 ' + T.formatNT(fees[0]) : '免運費') : '運費依取貨方式計算';
    if (freeOver) hint += `，商品滿 ${T.formatNT(freeOver)} 免運`;
    $('ship-hint').textContent = hint;
    applyShipType();
  }
  function applyShipType() {
    const m = currentMethod();
    const type = m ? m.type : TYPE.CVS;
    document.querySelectorAll('[data-ship]').forEach((el) => {
      const want = el.dataset.ship;
      el.hidden = want === 'contact' ? type === TYPE.NONE : want !== type;
    });
  }
  function shippingFee(subtotal) {
    const m = currentMethod();
    if (!m) return 0;
    return freeOver && subtotal >= freeOver ? 0 : Number(m.fee) || 0;
  }

  // ---------- 自訂題目 ----------
  const questions = (C.questions || []).filter((q) => q && q.label);
  function renderQuestions() {
    const box = $('questions');
    questions.forEach((q, i) => {
      const id = 'q' + i;
      const field = document.createElement('div');
      field.className = 'field';
      field.dataset.q = i;
      const label = document.createElement(q.type === 'radio' || q.type === 'checkbox' ? 'div' : 'label');
      label.className = 'q-label';
      if (label.tagName === 'LABEL') label.htmlFor = id;
      label.textContent = q.label;
      if (q.required) label.insertAdjacentHTML('beforeend', '<span class="req" aria-hidden="true">*</span>');
      else label.insertAdjacentHTML('beforeend', '<span class="opt">選填</span>');
      field.appendChild(label);
      let input;
      if (q.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 3;
      } else if (q.type === 'select') {
        input = document.createElement('select');
        input.innerHTML = '<option value="">請選擇</option>';
        (q.options || []).forEach((o) => input.add(new Option(o, o)));
      } else if (q.type === 'radio' || q.type === 'checkbox') {
        input = document.createElement('div');
        input.className = 'options';
        (q.options || []).forEach((o) => {
          const l = document.createElement('label');
          l.className = 'option';
          l.innerHTML = `<input type="${q.type}" name="${id}"><span></span>`;
          l.querySelector('input').value = o;
          l.querySelector('span').textContent = o;
          input.appendChild(l);
        });
      } else {
        input = document.createElement('input');
        input.type = 'text';
      }
      if (input.tagName !== 'DIV') {
        input.id = id;
        if (q.placeholder) input.placeholder = q.placeholder;
        input.maxLength = Number(q.maxLength) || 500;
        input.addEventListener('blur', () => checkQuestion(i));
      } else {
        input.addEventListener('change', () => checkQuestion(i));
      }
      field.appendChild(input);
      if (q.hint) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = q.hint;
        field.appendChild(sub);
      }
      field.insertAdjacentHTML('beforeend', '<span class="err">請回答這一題</span>');
      box.appendChild(field);
    });
    if (C.note) {
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = '<label for="note"></label><textarea id="note" rows="3" maxlength="500"></textarea>';
      field.querySelector('label').textContent = C.note.label || '備註';
      field.querySelector('label').insertAdjacentHTML('beforeend', '<span class="opt">選填</span>');
      if (C.note.placeholder) field.querySelector('textarea').placeholder = C.note.placeholder;
      box.appendChild(field);
    }
    $('questions-section').hidden = !questions.length && !C.note;
  }
  function answer(i) {
    const q = questions[i];
    if (q.type === 'radio' || q.type === 'checkbox') {
      const vals = [...document.querySelectorAll(`input[name="q${i}"]:checked`)].map((x) => x.value);
      return q.type === 'radio' ? (vals[0] || '') : vals;
    }
    return $('q' + i).value.trim();
  }
  function checkQuestion(i) {
    const a = answer(i);
    const ok = !questions[i].required || (Array.isArray(a) ? a.length > 0 : !!a);
    document.querySelector(`[data-q="${i}"]`).classList.toggle('invalid', !ok);
    return ok;
  }

  // ---------- 金額 ----------
  function render() {
    let subtotal = 0, count = 0;
    products.forEach((p) => {
      const el = list.querySelector(`[data-sku="${CSS.escape(p.sku)}"]`);
      if (!el) return;
      el.querySelector('output').textContent = qty[p.sku];
      el.classList.toggle('picked', qty[p.sku] > 0);
      el.querySelector('[data-d="-1"]').disabled = qty[p.sku] === 0;
      el.querySelector('[data-d="1"]').disabled = qty[p.sku] >= maxQty;
      subtotal += p.price * qty[p.sku];
      count += qty[p.sku];
    });
    if (count) $('items-err').hidden = true;
    const fee = shippingFee(subtotal);
    $('total').textContent = T.formatNT(count ? subtotal + fee : 0);
    $('breakdown').textContent = count
      ? `${count} 件商品 ${T.formatNT(subtotal)} ＋ ${fee ? '運費 ' + T.formatNT(fee) : '免運'}`
      : '尚未選擇商品';
    return count;
  }

  renderProducts();
  renderShipping();
  renderQuestions();
  numberSections();
  render();

  // ---------- 向後端讀最新的商品 / 運送方式（同時喚醒 Apps Script，避免送單時冷啟動） ----------
  if (C.gasUrl && T.getCampaign) {
    T.getCampaign(C.gasUrl, C.id).then((info) => {
      if (!info || !info.ok) return;
      products = info.products.map((p) => Object.assign({}, extras[p.sku] || {}, p, { desc: p.desc || (extras[p.sku] || {}).desc || '' }));
      Object.keys(qty).forEach((sku) => { if (!products.some((p) => p.sku === sku)) delete qty[sku]; });
      if (info.shipping && info.shipping.length) shipping = info.shipping;
      freeOver = Number(info.freeShippingOver) || 0;
      renderProducts();
      renderShipping();
      render();
    }).catch(() => {});
  }

  // ---------- 驗證 ----------
  const rules = {
    nickname: (v) => v.length > 0,
    name: (v) => v.length > 0,
    phone: (v) => /^09\d{8}$/.test(v.replace(/[\s-]/g, '')),
    storeName: (v) => v.length > 0,
    storeId: (v) => !v || /^\d{4,8}$/.test(v),
    address: (v) => v.length > 4,
    email: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
  };
  const visible = (el) => !el.closest('[hidden]');
  function check(id) {
    const input = $(id);
    if (!visible(input)) return true;
    const ok = rules[id](input.value.trim());
    input.closest('.field').classList.toggle('invalid', !ok);
    return ok;
  }
  Object.keys(rules).forEach((id) => $(id).addEventListener('blur', () => check(id)));
  $('agree').addEventListener('change', () => $('agree-box').classList.remove('invalid'));

  // ---------- 送出 ----------
  const form = $('order');
  const submit = $('submit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('form-err').hidden = true;

    const firstBad = Object.keys(rules).filter((id) => !check(id))[0];
    const badQ = questions.map((_, i) => i).filter((i) => !checkQuestion(i))[0];
    const hasItems = render() > 0;
    $('items-err').hidden = hasItems;
    const agreed = $('agree').checked;
    $('agree-box').classList.toggle('invalid', !agreed);
    const method = currentMethod();
    if (!method) {
      $('form-err').textContent = '目前沒有可選的取貨方式，請稍後再試';
      $('form-err').hidden = false;
      return;
    }
    if (firstBad || badQ !== undefined || !hasItems || !agreed) {
      const target = !hasItems ? $('products')
        : firstBad ? $(firstBad)
        : badQ !== undefined ? document.querySelector(`[data-q="${badQ}"]`)
        : $('agree-box');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (firstBad) $(firstBad).focus({ preventScroll: true });
      return;
    }

    const shown = (id) => (visible($(id)) ? $(id).value.trim() : '');
    submit.disabled = true;
    submit.textContent = '建立訂單中…';
    try {
      const res = await T.createOrder(C.gasUrl, {
        campaign: C.id,
        formVersion: C.formVersion,
        buyer: {
          nickname: $('nickname').value.trim(),
          name: shown('name'),
          phone: shown('phone'),
          email: $('email').value.trim()
        },
        shipping: {
          method: method.name,
          storeName: shown('storeName'),
          storeId: shown('storeId'),
          address: shown('address')
        },
        items: products.map((p) => ({ sku: p.sku, qty: qty[p.sku] || 0 })).filter((i) => i.qty > 0),
        extra: questions.map((q, i) => ({ q: q.label, a: answer(i) })),
        note: $('note') ? $('note').value.trim() : '',
        agree: true,
        hp: $('hp').value,
        thanksUrl: new URL('thanks.html', location.href).href
      });
      if (!res.ok) throw new Error(res.message || '建立訂單失敗，請稍後再試');
      if (res.payment && res.payment.mode === 'donate') {
        location.href = res.thanksUrl; // 付款說明在訂單頁
        return;
      }
      submit.textContent = '前往綠界付款…';
      T.redirectToEcpay(res.ecpay);
    } catch (err) {
      $('form-err').textContent = err.message;
      $('form-err').hidden = false;
      $('form-err').scrollIntoView({ behavior: 'smooth', block: 'center' });
      submit.disabled = false;
      submit.textContent = '前往付款';
    }
  });

  // 從綠界按「上一頁」回來時，恢復按鈕
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) { submit.disabled = false; submit.textContent = '前往付款'; }
  });
})();
