/*
 * 商店頁邏輯：周邊按鈕 → 規格視窗選數量 → 回主頁填資料，一張訂單可以跨周邊、運費只收一次。
 * 需要先載入 data/store.js（window.STORE，由 tools/build-site.mjs 產生）與 order-core.js。
 * 開始 / 截止時間、數量上限只在前端控制，後端不鎖。
 */
(function () {
  'use strict';
  const S = window.STORE;
  const T = window.TopaOrder;
  const $ = (id) => document.getElementById(id);
  const TYPE = { CVS: '超商', HOME: '宅配', MEET: '面交', NONE: '免運送' };
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => T.formatNT(n);

  // ---------- 資料 ----------
  const now = () => Date.now();
  const time = (s) => (s ? new Date(s).getTime() : NaN);
  const fmtTime = (s) => {
    const t = new Date(s);
    const hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    return `${t.getMonth() + 1}/${t.getDate()}（${'日一二三四五六'[t.getDay()]}）${hm}`;
  };
  const collections = S.collections.filter((c) => !c.hidden);
  const bySku = {};
  collections.forEach((c) => c.products.forEach((p) => { bySku[p.sku] = { p, c }; }));
  const qty = {};
  const stateOf = (c) => {
    if (c.opens && now() < time(c.opens)) return 'soon';
    if (c.deadline && now() > time(c.deadline)) return 'closed';
    if (c.products.every((p) => p.soldOut)) return 'soldout';
    return 'open';
  };
  const canBuy = (c) => stateOf(c) === 'open';
  const limitOf = (p) => p.maxQty || S.maxQty || 99;
  const totalQty = () => Object.values(qty).reduce((a, b) => a + b, 0);
  const colQty = (c) => c.products.reduce((a, p) => a + (qty[p.sku] || 0), 0);
  const imgSrc = (src) => (!src ? '' : /^https?:/.test(src) ? src : src);
  const priceText = (c) => (c.priceMin === c.priceMax ? money(c.priceMin) : `${money(c.priceMin)}～${money(c.priceMax).replace('NT$', '')}`);

  // ---------- 靜態文字 ----------
  $('notes').innerHTML = S.notes.map((n) => '<li>' + esc(n).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</li>').join('');
  $('agree-text').textContent = S.agreeText;
  $('footer-text').textContent = S.footer;

  // ---------- 周邊按鈕 ----------
  function stateLabel(c) {
    const st = stateOf(c);
    if (st === 'soon') return ['即將開放', fmtTime(c.opens) + ' 開放'];
    if (st === 'closed') return ['已截止', fmtTime(c.deadline) + ' 截止'];
    if (st === 'soldout') return ['已售完', ''];
    return ['通販中', c.deadline ? fmtTime(c.deadline) + ' 截止' : ''];
  }
  function renderCollections() {
    const box = $('collections');
    box.innerHTML = '';
    collections.forEach((c) => {
      const st = stateOf(c);
      const n = colQty(c);
      const [tag, when] = stateLabel(c);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'col-card is-' + st + (n ? ' picked' : '');
      b.innerHTML =
        '<span class="col-img">' + (c.thumbnail || c.image ? '<img alt="" loading="lazy">' : '') + '</span>' +
        '<span class="col-body"><strong></strong><span class="col-meta"><span class="tag"></span><span class="col-price"></span><span class="col-when"></span></span></span>' +
        '<span class="col-go"></span>';
      if (c.thumbnail || c.image) b.querySelector('img').src = imgSrc(c.thumbnail || c.image);
      b.querySelector('strong').textContent = c.title;
      b.querySelector('.tag').textContent = tag;
      b.querySelector('.col-price').textContent = priceText(c);
      b.querySelector('.col-when').textContent = when;
      b.querySelector('.col-go').textContent = n ? `已選 ${n}` : '選購';
      b.setAttribute('aria-label', `${c.title}，${tag}${n ? `，已選 ${n} 件` : ''}`);
      b.addEventListener('click', (e) => { burst(e.clientX, e.clientY, 8); openSheet(c); });
      box.appendChild(b);
    });
  }

  // ---------- 已選商品 ----------
  function renderCart() {
    const lines = Object.keys(qty).filter((sku) => qty[sku] > 0 && bySku[sku]);
    $('cart-box').hidden = !lines.length;
    $('cart').innerHTML = '';
    lines.forEach((sku) => {
      const { p, c } = bySku[sku];
      const li = document.createElement('li');
      li.innerHTML = '<span class="c-name"><span></span><small></small></span><span class="c-amt"></span>' +
        '<button type="button" data-act="edit">修改</button><button type="button" data-act="del">移除</button>';
      li.querySelector('.c-name span').textContent = `${p.name} × ${qty[sku]}`;
      li.querySelector('small').textContent = c.title;
      li.querySelector('.c-amt').textContent = money(p.price * qty[sku]);
      li.querySelector('[data-act="edit"]').addEventListener('click', () => openSheet(c));
      li.querySelector('[data-act="del"]').addEventListener('click', () => { delete qty[sku]; refresh(); });
      $('cart').appendChild(li);
    });
  }

  // ---------- 規格視窗 ----------
  const sheet = $('sheet');
  let current = null;
  function openSheet(c) {
    current = c;
    const st = stateOf(c);
    const [tag, when] = stateLabel(c);
    renderGallery(c);
    $('sheet-scroll').scrollTop = 0;
    $('sheet-tag').textContent = tag;
    sheet.querySelector('.sheet-inner').className = 'sheet-inner is-' + st;
    $('sheet-when').textContent = when;
    $('sheet-title').textContent = c.title;
    $('sheet-summary').textContent = c.summary || '';
    $('sheet-summary').hidden = !c.summary;
    $('sheet-desc').hidden = !c.description;
    $('sheet-desc').open = false;
    $('sheet-desc-text').textContent = c.description || '';
    renderSheetProducts();
    if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', '');
    $('sheet-done').focus({ preventScroll: true });
  }
  // ---------- 圖庫：左右滑動（scroll-snap），圖片完整顯示不裁切 ----------
  const track = $('gallery-track');
  function renderGallery(c) {
    const imgs = (c.images && c.images.length ? c.images : [c.image]).filter(Boolean);
    $('gallery').hidden = !imgs.length;
    track.innerHTML = '';
    $('gallery-dots').innerHTML = '';
    imgs.forEach((src, i) => {
      const slide = document.createElement('div');
      slide.className = 'gallery-slide';
      const img = document.createElement('img');
      img.src = imgSrc(src);
      img.alt = `${c.imageAlt || c.title}（${i + 1}/${imgs.length}）`;
      img.loading = i ? 'lazy' : 'eager';
      img.draggable = false; // 避免拖曳時拖出圖片
      slide.appendChild(img);
      track.appendChild(slide);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `第 ${i + 1} 張`);
      dot.addEventListener('click', () => goTo(i));
      $('gallery-dots').appendChild(dot);
    });
    const multi = imgs.length > 1;
    $('gallery-dots').hidden = !multi;
    $('gallery-prev').hidden = !multi;
    $('gallery-next').hidden = !multi;
    track.scrollLeft = 0;
    markDot();
  }
  const slideIndex = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  function goTo(i) {
    const n = track.children.length;
    if (!n) return;
    i = (i + n) % n;
    track.scrollTo({ left: i * track.clientWidth, behavior: calm ? 'auto' : 'smooth' });
  }
  function markDot() {
    const i = slideIndex();
    [...$('gallery-dots').children].forEach((d, k) => d.classList.toggle('on', k === i));
  }
  track.addEventListener('scroll', () => requestAnimationFrame(markDot), { passive: true });

  // 滑鼠拖曳換圖（手機本來就能用手指滑）：拖超過 1/6 寬或甩得夠快就換下一張
  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || track.children.length < 2) return;
    drag = { x: e.clientX, left: track.scrollLeft, start: slideIndex(), t: Date.now(), moved: false };
    track.setPointerCapture(e.pointerId);
    track.classList.add('dragging');
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    track.scrollLeft = drag.left - dx;
  });
  const endDrag = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const fast = Math.abs(dx) > 30 && Date.now() - drag.t < 250;
    const step = Math.abs(dx) > track.clientWidth / 6 || fast ? (dx < 0 ? 1 : -1) : 0;
    const target = Math.max(0, Math.min(track.children.length - 1, drag.start + step));
    track.classList.remove('dragging');
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
    const moved = drag.moved;
    drag = null;
    track.scrollTo({ left: target * track.clientWidth, behavior: calm ? 'auto' : 'smooth' });
    if (moved) track.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  $('gallery-prev').addEventListener('click', () => goTo(slideIndex() - 1));
  $('gallery-next').addEventListener('click', () => goTo(slideIndex() + 1));
  sheet.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') goTo(slideIndex() - 1);
    if (e.key === 'ArrowRight') goTo(slideIndex() + 1);
  });

  function closeSheet() {
    if (sheet.close) sheet.close(); else sheet.removeAttribute('open');
  }
  function renderSheetProducts() {
    const c = current;
    const box = $('sheet-products');
    box.innerHTML = '';
    if (!canBuy(c)) {
      const msg = { soon: `這個周邊 ${fmtTime(c.opens)} 才開放購買`, closed: '這個周邊已截止，謝謝大家的支持！', soldout: '這個周邊已售完' }[stateOf(c)];
      box.insertAdjacentHTML('beforeend', `<p class="is-closed-msg">${esc(msg)}</p>`);
    }
    const distinctImgs = new Set(c.products.map((p) => p.image).filter(Boolean)).size > 1;
    c.products.forEach((p) => {
      const off = !canBuy(c) || p.soldOut;
      const el = document.createElement('div');
      el.className = 'product' + (p.soldOut ? ' soldout' : '') + (qty[p.sku] ? ' picked' : '');
      el.innerHTML =
        (distinctImgs && p.image ? '<img alt="" loading="lazy">' : '') +
        '<div class="info"><div class="name"></div><div class="desc"></div><div class="price"></div></div>' +
        '<div class="stepper"><button type="button" data-d="-1" aria-label="減少">−</button>' +
        '<output aria-live="polite">0</output><button type="button" data-d="1" aria-label="增加">＋</button></div>';
      if (distinctImgs && p.image) el.querySelector('img').src = imgSrc(p.image);
      el.querySelector('.name').textContent = p.name;
      const badge = (text, cls) => {
        const b = document.createElement('span');
        b.className = cls; b.textContent = text;
        el.querySelector('.name').appendChild(b);
      };
      if (p.badge) badge(p.badge, 'badge');
      if (p.soldOut) badge('已售完', 'badge badge-out');
      el.querySelector('.desc').textContent = p.desc;
      el.querySelector('.desc').hidden = !p.desc;
      el.querySelector('.price').textContent = money(p.price);
      const out = el.querySelector('output');
      const minus = el.querySelector('[data-d="-1"]');
      const plus = el.querySelector('[data-d="1"]');
      const sync = () => {
        const n = qty[p.sku] || 0;
        out.textContent = n;
        minus.disabled = n === 0;
        plus.disabled = off || n >= limitOf(p) || (S.maxTotal > 0 && totalQty() >= S.maxTotal);
        el.classList.toggle('picked', n > 0);
      };
      [minus, plus].forEach((btn) => btn.addEventListener('click', () => {
        const d = Number(btn.dataset.d);
        const n = Math.max(0, Math.min(limitOf(p), (qty[p.sku] || 0) + d));
        if (d > 0 && (off || (S.maxTotal > 0 && totalQty() >= S.maxTotal))) return;
        if (n) qty[p.sku] = n; else delete qty[p.sku];
        box.querySelectorAll('.product').forEach((x) => x._sync && x._sync());
        updateSheetSum();
      }));
      el._sync = sync;
      sync();
      box.appendChild(el);
    });
    updateSheetSum();
  }
  function updateSheetSum() {
    const c = current;
    const n = colQty(c);
    const sub = c.products.reduce((a, p) => a + p.price * (qty[p.sku] || 0), 0);
    $('sheet-sum').innerHTML = n ? `這個周邊已選 ${n} 件　<b>${esc(money(sub))}</b>` : '還沒有選擇';
    $('sheet-done').textContent = n ? '完成，回到結帳' : '關閉';
  }
  $('sheet-done').addEventListener('click', closeSheet);
  $('sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // 點背景關閉
  sheet.addEventListener('close', () => {
    refresh();
    if (current && colQty(current)) $('items-err').hidden = true;
  });

  // ---------- 運送方式 ----------
  const shipping = S.shipping;
  const freeOver = Number(S.freeShippingOver) || 0;
  function currentMethod() {
    const checked = document.querySelector('input[name="pickup"]:checked');
    return shipping.find((m) => checked && m.name === checked.value) || shipping[0] || null;
  }
  (function renderShipping() {
    const box = $('pickup');
    shipping.forEach((m, i) => {
      const label = document.createElement('label');
      label.className = 'chip';
      label.innerHTML = '<input type="radio" name="pickup" required><span><b></b><small></small></span>';
      const input = label.querySelector('input');
      input.value = m.name;
      input.checked = i === 0;
      label.querySelector('b').textContent = m.name;
      label.querySelector('small').textContent = m.fee ? '運費 ' + money(m.fee) : '免運費';
      input.addEventListener('change', () => { applyShipType(); refresh(); });
      box.appendChild(label);
    });
    const fees = [...new Set(shipping.map((m) => m.fee))];
    const allCvs = shipping.every((m) => m.type === TYPE.CVS);
    let hint = allCvs ? '一律超商店到店，' : '';
    hint += fees.length === 1 ? (fees[0] ? '運費 ' + money(fees[0]) : '免運費') : '運費依取貨方式計算';
    hint += '，整筆訂單只收一次';
    if (freeOver) hint += `；商品滿 ${money(freeOver)} 免運`;
    $('ship-hint').textContent = hint;
    applyShipType();
  })();
  function applyShipType() {
    const m = currentMethod();
    const type = m ? m.type : TYPE.CVS;
    document.querySelectorAll('[data-ship]').forEach((el) => {
      const want = el.dataset.ship;
      el.hidden = want === 'contact' ? type === TYPE.NONE : want !== type;
    });
  }
  const shippingFee = (subtotal) => {
    const m = currentMethod();
    if (!m) return 0;
    return freeOver && subtotal >= freeOver ? 0 : Number(m.fee) || 0;
  };

  // ---------- 自訂題目 ----------
  const questions = (S.questions || []).filter((q) => q && q.label);
  (function renderQuestions() {
    const box = $('questions');
    questions.forEach((q, i) => {
      const id = 'q' + i;
      const field = document.createElement('div');
      field.className = 'field';
      field.dataset.q = i;
      const multi = q.type === 'radio' || q.type === 'checkbox';
      const label = document.createElement(multi ? 'div' : 'label');
      label.className = 'q-label';
      if (!multi) label.htmlFor = id;
      label.textContent = q.label;
      label.insertAdjacentHTML('beforeend', q.required ? '<span class="req" aria-hidden="true">*</span>' : '<span class="opt">選填</span>');
      field.appendChild(label);
      let input;
      if (q.type === 'textarea') { input = document.createElement('textarea'); input.rows = 3; }
      else if (q.type === 'select') {
        input = document.createElement('select');
        input.add(new Option('請選擇', ''));
        (q.options || []).forEach((o) => input.add(new Option(o, o)));
      } else if (multi) {
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
      } else { input = document.createElement('input'); input.type = 'text'; }
      if (!multi) {
        input.id = id;
        if (q.placeholder) input.placeholder = q.placeholder;
        input.maxLength = Number(q.maxLength) || 500;
        input.addEventListener('blur', () => checkQuestion(i));
      } else input.addEventListener('change', () => checkQuestion(i));
      field.appendChild(input);
      if (q.hint) { const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = q.hint; field.appendChild(sub); }
      field.insertAdjacentHTML('beforeend', '<span class="err">請回答這一題</span>');
      box.appendChild(field);
    });
    if (S.note) {
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = '<label for="note"></label><textarea id="note" rows="3" maxlength="500"></textarea>';
      field.querySelector('label').textContent = S.note.label || '備註';
      field.querySelector('label').insertAdjacentHTML('beforeend', '<span class="opt">選填</span>');
      if (S.note.placeholder) field.querySelector('textarea').placeholder = S.note.placeholder;
      box.appendChild(field);
    }
    $('questions-section').hidden = !questions.length && !S.note;
  })();
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

  // ---------- 區塊編號、金額 ----------
  let n = 0;
  document.querySelectorAll('#order > .section').forEach((s) => {
    const num = s.querySelector('h2 .num');
    if (num && !s.hidden) num.textContent = String(++n).padStart(2, '0');
  });
  function refresh() {
    renderCollections();
    renderCart();
    let subtotal = 0, count = 0;
    Object.keys(qty).forEach((sku) => {
      if (!bySku[sku]) return;
      subtotal += bySku[sku].p.price * qty[sku];
      count += qty[sku];
    });
    const fee = shippingFee(subtotal);
    $('total').textContent = money(count ? subtotal + fee : 0);
    $('breakdown').textContent = count
      ? `${count} 件商品 ${money(subtotal)} ＋ ${fee ? '運費 ' + money(fee) : '免運'}`
      : '尚未選擇商品';
    return count;
  }
  refresh();

  // 頁面打開就先喚醒 Apps Script，避免送單時冷啟動要等十幾秒
  if (S.gasUrl) fetch(S.gasUrl, { mode: 'no-cors' }).catch(() => {});

  // ---------- 驗證與送出 ----------
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

  const form = $('order');
  const submit = $('submit');
  const showError = (msg, target) => {
    $('form-err').textContent = msg;
    $('form-err').hidden = false;
    (target || $('form-err')).scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('form-err').hidden = true;

    // 開著頁面時剛好截止的周邊
    const expired = [...new Set(Object.keys(qty).map((sku) => bySku[sku] && bySku[sku].c).filter((c) => c && !canBuy(c)))];
    if (expired.length) {
      refresh();
      return showError(`「${expired.map((c) => c.title).join('、')}」已無法購買，請在「已選商品」移除後再送出`, $('cart-box'));
    }

    const firstBad = Object.keys(rules).filter((id) => !check(id))[0];
    const badQ = questions.map((_, i) => i).filter((i) => !checkQuestion(i))[0];
    const hasItems = refresh() > 0;
    $('items-err').hidden = hasItems;
    const agreed = $('agree').checked;
    $('agree-box').classList.toggle('invalid', !agreed);
    const method = currentMethod();
    if (!method) return showError('目前沒有可選的取貨方式，請稍後再試');
    if (firstBad || badQ !== undefined || !hasItems || !agreed) {
      const target = !hasItems ? $('collections')
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
      const res = await T.createOrder(S.gasUrl, {
        campaign: S.id,
        formVersion: S.formVersion,
        buyer: { nickname: $('nickname').value.trim(), name: shown('name'), phone: shown('phone'), email: $('email').value.trim() },
        shipping: { method: method.name, storeName: shown('storeName'), storeId: shown('storeId'), address: shown('address') },
        items: Object.keys(qty).filter((sku) => qty[sku] > 0 && bySku[sku]).map((sku) => ({ sku, qty: qty[sku] })),
        extra: questions.map((q, i) => ({ q: q.label, a: answer(i) })),
        note: $('note') ? $('note').value.trim() : '',
        agree: true,
        hp: $('hp').value,
        thanksUrl: new URL('thanks.html', location.href).href
      });
      if (!res.ok) throw new Error(res.message || '建立訂單失敗，請稍後再試');
      if (res.payment && res.payment.mode === 'donate') { location.href = res.thanksUrl; return; }
      submit.textContent = '前往綠界付款…';
      T.redirectToEcpay(res.ecpay);
    } catch (err) {
      showError(err.message);
      submit.disabled = false;
      submit.textContent = '前往付款';
    }
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) { submit.disabled = false; submit.textContent = '前往付款'; }
  });

  // ---------- 動態：漂浮的肉球、點擊噴愛心、摸摸多帕 ----------
  const shapes = ['p-heart', 'p-paw', 'p-flake', 'p-star'];
  const colors = ['#5aaee6', '#ff8fb1', '#7fcfa8', '#ffc65c', '#9cc8ec'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const icon = (shape) => `<svg viewBox="0 0 24 24"><use href="#${shape}"></use></svg>`;
  if (!calm) {
    const sky = document.querySelector('.sky');
    for (let i = 0; i < (window.innerWidth < 600 ? 10 : 16); i++) {
      const bit = document.createElement('span');
      const size = 10 + Math.random() * 16;
      bit.className = 'floaty';
      bit.innerHTML = icon(pick(shapes));
      bit.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;color:${pick(colors)};` +
        `animation-duration:${14 + Math.random() * 14}s;animation-delay:${-Math.random() * 28}s;` +
        `--sway:${Math.random() * 80 - 40}px;--spin:${Math.random() * 180 - 90}deg;--alpha:${0.2 + Math.random() * 0.25}`;
      sky.appendChild(bit);
    }
  }
  function burst(x, y, amount) {
    if (calm || !document.body.animate || !x) return;
    for (let i = 0; i < amount; i++) {
      const bit = document.createElement('span');
      bit.className = 'particle';
      bit.innerHTML = icon(pick(['p-heart', 'p-paw', 'p-star']));
      bit.style.left = x + 'px';
      bit.style.top = y + 'px';
      bit.style.color = pick(colors);
      document.body.appendChild(bit);
      const a = Math.random() * Math.PI * 2;
      const d = 40 + Math.random() * 60;
      bit.animate([
        { transform: 'translate(0,0) scale(0)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 24}px) scale(${0.6 + Math.random() * 0.6})`, opacity: 0 }
      ], { duration: 800 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => bit.remove();
    }
  }
  const avatar = document.querySelector('.avatar-btn');
  const bubble = document.querySelector('.bubble');
  const lines = ['汪！', '要買周邊嗎？', 'ともとも！', '謝謝支持～', '(っ´ω`c)', '運費只收一次喔！'];
  let last = -1, hide;
  const say = (text, ms) => {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(hide);
    hide = setTimeout(() => bubble.classList.remove('show'), ms);
  };
  avatar.addEventListener('click', () => {
    let next;
    do { next = Math.floor(Math.random() * lines.length); } while (next === last);
    last = next;
    say(lines[next], 1600);
    avatar.classList.remove('wiggle');
    void avatar.offsetWidth;
    avatar.classList.add('wiggle');
    const box = avatar.getBoundingClientRect();
    burst(box.left + box.width / 2, box.top + box.height / 2, 12);
  });
  setTimeout(() => say('汪！', 1800), 1200);
})();
