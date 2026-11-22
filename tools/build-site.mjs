#!/usr/bin/env node
// 依 site/store.json（手動設定）＋ docs/data/myacg-products.json（爬蟲結果）產生網站資料：
//   docs/data/store.js      商店頁（docs/index.html）與訂單頁使用的 window.STORE / window.CAMPAIGN
//   docs/data/catalog.json  Apps Script 下單時讀取的商品與價格（只含計價需要的欄位）
//
//   node tools/build-site.mjs           # 產生；內容沒變就不改寫
//   node tools/build-site.mjs --check   # 只檢查設定，不寫檔
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'site/store.json');
const MYACG = path.join(ROOT, 'docs/data/myacg-products.json');
const OUT_JS = path.join(ROOT, 'docs/data/store.js');
const OUT_CATALOG = path.join(ROOT, 'docs/data/catalog.json');
const SHIP_TYPES = ['超商', '宅配', '面交', '免運送'];

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const myacg = JSON.parse(fs.readFileSync(MYACG, 'utf8'));
const byGid = new Map(myacg.products.map((p) => [String(p.gid), p]));
const problems = [];
const warn = (m) => console.error('[build] 注意：' + m);
const fail = (m) => problems.push(m);

const S = config.store;
const cleanTitle = (t) => String(t || '').replace(/^【多帕】/, '').trim();

// ---------------------------------------------------------------- 驗證商店設定

if (!/^[A-Za-z0-9_-]{1,40}$/.test(S.id || '')) fail('store.id 只能用英數字、- 或 _');
if (!/^[A-Z0-9]{4}$/.test(S.orderPrefix || '')) fail('store.orderPrefix 必須剛好 4 碼大寫英數字');
if (!Array.isArray(S.shipping) || !S.shipping.length) fail('store.shipping 至少要有一種取貨方式');
for (const m of S.shipping || []) {
  if (!m.name) fail('取貨方式缺少 name');
  if (!SHIP_TYPES.includes(m.type)) fail(`取貨方式「${m.name}」的 type 必須是 ${SHIP_TYPES.join(' / ')}`);
  if (!(Number(m.fee) >= 0)) fail(`取貨方式「${m.name}」的 fee 必須是 0 以上的數字`);
}

// ---------------------------------------------------------------- 周邊

const skus = new Map();
const prefixes = new Set([S.orderPrefix]);
const collections = [];
const legacy = [];

for (const c of config.collections || []) {
  const gid = String(c.myacgGid || '');
  const src = byGid.get(gid);
  if (!src) { warn(`買動漫資料裡找不到商品 ${gid}（可能已下架），略過`); continue; }
  const title = c.title || cleanTitle(src.title);
  const vcfg = c.variants || {};
  const products = [];
  for (const v of src.variants) {
    const o = vcfg[v.gid] || {};
    if (o.hidden) continue;
    const sku = o.sku || 'G' + v.gid;
    if (skus.has(sku)) fail(`商品代碼 ${sku} 重複（${skus.get(sku)}、${title}）`);
    skus.set(sku, title);
    const price = o.price != null ? Number(o.price) : Number(v.price);
    if (!(price >= 0)) { fail(`${title}「${v.name}」沒有價格`); continue; }
    products.push({
      sku,
      gid: v.gid,
      name: o.name || v.name || title,
      desc: o.desc || '',
      price,
      badge: o.badge || '',
      image: o.image || v.imageLocal || '',
      soldOut: o.soldOut != null ? !!o.soldOut : !!(S.soldOutWhenMyacgEmpty && Number(v.stock) === 0),
      maxQty: Number(o.maxQty) || 0
    });
  }
  if (!products.length) { warn(`${title} 沒有可販售的規格，略過`); continue; }
  const prices = products.map((p) => p.price);
  const col = {
    id: 'g' + gid,
    title,
    summary: c.summary || '',
    image: c.heroImage || src.imageLocal || src.image || '',
    imageAlt: c.heroAlt || title,
    description: c.description != null ? c.description : src.description || '',
    opens: c.opens || '',
    deadline: c.deadline || '',
    hidden: !!c.hidden,
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    products
  };
  collections.push(col);

  if (c.legacyCampaign) {
    const l = c.legacyCampaign;
    if (!/^[A-Z0-9]{4}$/.test(l.orderPrefix || '')) fail(`${title} 的 legacyCampaign.orderPrefix 必須剛好 4 碼`);
    if (prefixes.has(l.orderPrefix)) fail(`訂單前綴 ${l.orderPrefix} 重複`);
    prefixes.add(l.orderPrefix);
    legacy.push({ id: l.id, title, orderPrefix: l.orderPrefix, products });
  }
}

if (problems.length) {
  console.error('[build] 設定有誤，未產生檔案：\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
if (args('--check')) { console.error(`[build] 設定正確：${collections.length} 個周邊、${skus.size} 個商品`); process.exit(0); }

// ---------------------------------------------------------------- 輸出

const payment = {
  paymentMode: S.paymentMode === 'donate' ? 'donate' : 'aio',
  donateUrl: S.donateUrl || '',
  atmExpireDays: Number(S.atmExpireDays) || 1,
  cvsExpireMinutes: Number(S.cvsExpireMinutes) || 1440,
  ignorePayment: S.ignorePayment == null ? 'BARCODE' : String(S.ignorePayment),
  freeShippingOver: Number(S.freeShippingOver) || 0,
  shipping: S.shipping.map((m) => ({ name: m.name, type: m.type, fee: Number(m.fee) }))
};
const lean = (products, group) => products.map((p) => ({ sku: p.sku, name: p.name, price: p.price, group }));

const catalog = {
  version: 1,
  campaigns: {
    [S.id]: {
      id: S.id, title: S.title, orderPrefix: S.orderPrefix, ...payment,
      products: collections.flatMap((c) => lean(c.products, c.title))
    },
    ...Object.fromEntries(legacy.map((l) => [l.id, {
      id: l.id, title: l.title, orderPrefix: l.orderPrefix, ...payment, products: lean(l.products, '')
    }]))
  }
};

const store = {
  id: S.id,
  title: S.title,
  formVersion: S.id + '@' + collections.map((c) => c.id).join('.'),
  gasUrl: config.site.gasUrl,
  baseUrl: config.site.baseUrl,
  paymentMode: payment.paymentMode,
  donateUrl: payment.donateUrl,
  shipping: payment.shipping,
  freeShippingOver: payment.freeShippingOver,
  maxQty: Number(S.maxQty) || 99,
  maxTotal: Number(S.maxTotal) || 0,
  notes: S.notes || [],
  agreeText: S.agreeText || '我已閱讀並接受以上內容',
  footer: S.footer || '',
  questions: S.questions || [],
  note: S.note || null,
  collections
};

const js = '/* 由 tools/build-site.mjs 自動產生，請勿直接修改；設定請改 site/store.json */\n' +
  'window.STORE = ' + JSON.stringify(store, null, 2) + ';\n' +
  '// 訂單狀態頁（thanks.html）共用的設定\n' +
  'window.CAMPAIGN = { id: window.STORE.id, gasUrl: window.STORE.gasUrl, paymentMode: window.STORE.paymentMode, donateUrl: window.STORE.donateUrl };\n';

let changed = 0;
for (const [file, content] of [[OUT_JS, js], [OUT_CATALOG, JSON.stringify(catalog, null, 2) + '\n']]) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (old === content) continue;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  changed++;
  console.error('[build] 已更新', path.relative(ROOT, file));
}
console.error(`[build] ${collections.length} 個周邊、${skus.size} 個商品${changed ? '' : '，內容沒有變動'}`);

function args(flag) { return process.argv.includes(flag); }
