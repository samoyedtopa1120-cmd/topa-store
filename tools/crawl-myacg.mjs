#!/usr/bin/env node
// 買動漫（myacg.com.tw）賣場商品爬蟲：抓「薩摩耶之家」所有商品與規格，輸出 JSON。
//
//   node tools/crawl-myacg.mjs                     # 預設賣家 552667，輸出 docs/data/myacg-products.json
//   node tools/crawl-myacg.mjs --seller 552667
//   node tools/crawl-myacg.mjs --gid 7819462       # 只給商品編號，自動找出賣家
//   node tools/crawl-myacg.mjs --out path.json --limit 2
//
// 禮貌規則：
//   - 先讀 robots.txt，只抓允許的路徑，請求間隔 = max(Crawl-delay, 5) 秒
//   - 每一頁只抓一次，失敗最多重試 2 次
//   - 只有商品內容有變動時才改寫輸出檔（每日排程不會因為時間戳產生空 commit）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.myacg.com.tw';
const UA = 'Mozilla/5.0 (compatible; topa-store-sync/1.0; +https://github.com/samoyedtopa1120-cmd/topa-store)';

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(ROOT, args.out || 'docs/data/myacg-products.json');
const LIMIT = Number(args.limit) || Infinity;
const MIN_DELAY_MS = 5000;

// ---------------------------------------------------------------- 工具

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith('--')) out[list[i].slice(2)] = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : true;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[crawl]', ...a);

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
}

/** HTML 片段轉純文字：<br>、</p>、</li> 變換行，其餘標籤拿掉。 */
function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s*[\r\n]+\s*/g, ' ') // 原始碼裡的換行在 HTML 只是空白
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|dd|dt|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

const first = (re, s, i = 1) => { const m = re.exec(s); return m ? m[i] : ''; };
const text = (re, s) => htmlToText(first(re, s));

// ---------------------------------------------------------------- robots.txt 與限速

let delayMs = MIN_DELAY_MS;
let rules = [];
let lastRequest = 0;

async function loadRobots() {
  const res = await fetch(BASE + '/robots.txt', { headers: { 'User-Agent': UA } });
  if (!res.ok) { log('robots.txt', res.status, '→ 視為全部允許'); return; }
  let inStar = false;
  for (const raw of (await res.text()).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') inStar = val === '*';
    else if (inStar && key === 'crawl-delay') delayMs = Math.max(MIN_DELAY_MS, Number(val) * 1000 || 0);
    else if (inStar && (key === 'allow' || key === 'disallow') && val) rules.push({ allow: key === 'allow', path: val });
  }
  log(`robots.txt：${rules.length} 條規則，請求間隔 ${delayMs / 1000} 秒`);
}

/** 最長比對優先（Allow 與 Disallow 同長時 Allow 優先），支援 * 與 $。 */
function allowed(urlPath) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, (c) => (c === '$' ? '$' : '\\' + c)).replace(/\*/g, '.*'));
    if (re.test(urlPath) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

async function request(url, { method = 'GET', body, referer, json = false } = {}) {
  const u = new URL(url, BASE);
  if (u.origin === BASE && !allowed(u.pathname + u.search)) throw new Error('robots.txt 不允許：' + u.pathname);
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const res = await fetch(u, {
        method,
        body,
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-TW,zh;q=0.9',
          ...(referer ? { Referer: referer } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } : {})
        },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = await res.text();
      return json ? JSON.parse(t) : t;
    } catch (err) {
      if (attempt >= 2) throw new Error(`${u.pathname}${u.search}：${err.message}`);
      log('重試', u.pathname, err.message);
    }
  }
}

// ---------------------------------------------------------------- 賣場清單

async function findSellerByGid(gid) {
  const html = await request(`/goods_detail.php?gid=${gid}`);
  const seller = first(/seller_market\.php\?seller=(\d+)/, html);
  if (!seller) throw new Error('商品頁找不到賣家');
  return seller;
}

async function listSellerGoods(seller) {
  const referer = `${BASE}/seller_market.php?seller=${seller}`;
  const seen = new Map();
  for (let page = 1; page <= 50; page++) {
    const html = await request(`/seller_market_show_act.php?show_v1=listv1&seller=${seller}&pageID=${page}`, { referer });
    if (html.includes('無法搜尋到您想要的商品')) break;
    const cards = html.split(/<li class="list_content"/).slice(1);
    let added = 0;
    for (const card of cards) {
      const gid = first(/goods_detail\.php\?gid=(\d+)/, card);
      if (!gid || seen.has(gid)) continue;
      seen.set(gid, {
        gid,
        listPrice: text(/class="price_onInformation"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/, card),
        thumbnail: first(/data-original="([^"]+)"/, card).replace(/\?.*$/, ''),
        sales: Number(first(/sales_symbol[^>]*>:<\/span>\s*([\d,]+)/, card).replace(/,/g, '')) || 0
      });
      added++;
    }
    log(`清單第 ${page} 頁：${added} 個新商品`);
    if (!added) break;
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- 商品頁與規格

function parseDetail(html, gid) {
  const title = decodeEntities(first(/<title>([\s\S]*?)<\/title>/, html)).split(' | ')[0].trim();
  const summary = (label) => text(new RegExp(`<p class="fw_900[^"]*">${label}</p>\\s*<p[^>]*>([\\s\\S]*?)</p>`), html);
  const pickupBlock = first(/data-online="pickup_method_web">([\s\S]*?)<\/ul>/, html);
  return {
    gid,
    url: `${BASE}/goods_detail.php?gid=${gid}`,
    title,
    groupId: first(/var g_gg_id = (\d+);/, html) || '0',
    seller: {
      id: first(/seller_market\.php\?seller=(\d+)/, html),
      name: decodeEntities(first(/<meta name="keywords" content="([^|"]+)\|/, html)).trim()
    },
    category: summary('分類'),
    listedAt: text(/data-online="added_time"[^>]*>([\s\S]*?)<\/p>/, html),
    lastEditedAt: text(/data-online="last_edit_page"[^>]*>([\s\S]*?)<\/p>/, html),
    publishAmount: Number(summary('刊登數量')) || null,
    buyRule: text(/data-online="rule">([\s\S]*?)<\/p>/, html),
    pickup: [...pickupBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => htmlToText(m[1])).filter(Boolean),
    image: first(/class="_main_pic" data-pic="([^"]+)"/, html) || first(/<meta property="og:image" content="([^"]+)"/, html),
    // 頁面 CSS 也有 [data-ui="product_details"]，要比對 <div 開頭的那個
    description: text(/<div data-ui="product_details"[^>]*>([\s\S]*?)<!-- product_details end -->/, html)
  };
}

// loaded = false：第一次載入（回傳規格清單）；true：切換規格時呼叫（回傳該規格的價格）
async function specApi(gid, groupId, loaded = false) {
  const body = new URLSearchParams({ act: 'finish_load', gid, g_gg_id: groupId, goods_version: 'v1', load_finsh: loaded ? '1' : '0' });
  return request('/goods_detail_spec_api.php', { method: 'POST', body, referer: `${BASE}/goods_detail.php?gid=${gid}`, json: true });
}

const priceOf = (spec) => Number(first(/content="(\d+)"/, spec.my_price_x1 || '')) || null;
/** g_overage 有時是物件、有時是 JSON 字串：{ "g商品編號": 庫存 } */
const stockOf = (spec, gid) => {
  let o = spec.g_overage;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  const n = o && typeof o === 'object' ? Number(o['g' + gid]) : NaN;
  return Number.isFinite(n) ? n : null;
};

async function crawlProduct(gid) {
  const html = await request(`/goods_detail.php?gid=${gid}`);
  const p = parseDetail(html, gid);
  let main = await specApi(gid, p.groupId);
  if (priceOf(main) == null) main = { ...main, ...(await specApi(gid, p.groupId, true)) };

  // 規格：每個規格在買動漫是獨立的商品編號，價格 / 庫存要逐一查
  const specHtml = main.my_new_spec_item_show || '';
  const items = [...specHtml.matchAll(/<div class="spec_[^"]*"\s+data_item_gid="(\d+)"[\s\S]*?data_mid_img="([^"]*)"[\s\S]*?data_g_amount\s*=\s*"(\d+)"[\s\S]*?<div class="no_sel"[^>]*>([\s\S]*?)<\/div>/g)];
  const variants = [];
  for (const [, vgid, img, amount, name] of items) {
    const spec = vgid === String(gid) ? main : await specApi(vgid, p.groupId, true);
    variants.push({
      gid: vgid,
      name: htmlToText(name),
      price: priceOf(spec),
      stock: stockOf(spec, vgid) ?? Number(amount),
      image: /gt_good_no_pic/.test(img) ? null : img || null
    });
  }
  if (!variants.length) {
    variants.push({ gid: String(gid), name: '', price: priceOf(main), stock: stockOf(main, gid), image: null });
  }
  p.variants = variants;
  const prices = variants.map((v) => v.price).filter((n) => n != null);
  p.priceMin = prices.length ? Math.min(...prices) : null;
  p.priceMax = prices.length ? Math.max(...prices) : null;
  p.priceRange = p.priceMin == null ? null : p.priceMin === p.priceMax ? String(p.priceMin) : `${p.priceMin}~${p.priceMax}`;
  p.totalStock = variants.reduce((a, v) => a + (Number(v.stock) || 0), 0);
  p.soldOut = p.totalStock === 0;
  return p;
}

// ---------------------------------------------------------------- 主程式

async function main() {
  await loadRobots();
  const seller = String(args.seller || (args.gid ? await findSellerByGid(args.gid) : '552667'));
  log('賣家', seller);

  const list = (await listSellerGoods(seller)).slice(0, LIMIT);
  log(`共 ${list.length} 個商品，開始抓商品頁（約 ${Math.ceil(list.length * 3 * delayMs / 60000)} 分鐘）`);

  const products = [];
  const errors = [];
  for (const item of list) {
    try {
      const p = await crawlProduct(item.gid);
      products.push({ ...p, thumbnail: item.thumbnail || null, sales: item.sales, listPrice: item.listPrice });
      log(`✓ ${item.gid} ${p.title}（${p.variants.length} 個規格）`);
    } catch (err) {
      errors.push({ gid: item.gid, error: err.message });
      log(`✗ ${item.gid} ${err.message}`);
    }
  }
  if (!products.length) throw new Error('一個商品都沒抓到，不更新輸出檔');

  const data = {
    source: `${BASE}/seller_market.php?seller=${seller}`,
    seller: { id: seller, name: products[0].seller.name },
    count: products.length,
    products,
    errors
  };

  // 內容沒變就不改寫（避免每日排程產生只有時間戳的 commit）
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  const strip = (d) => d && JSON.stringify({ ...d, crawledAt: undefined });
  if (previous && strip(previous) === strip(data)) {
    log('內容沒有變動，不改寫', path.relative(ROOT, OUT));
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ crawledAt: new Date().toISOString(), ...data }, null, 2) + '\n');
  log(`已寫入 ${path.relative(ROOT, OUT)}：${products.length} 個商品${errors.length ? `，${errors.length} 個失敗` : ''}`);
  if (errors.length) process.exitCode = 2;
}

main().catch((err) => {
  log('失敗：', err.message);
  process.exit(1);
});
