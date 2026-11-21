// 本機預覽：node tools/dev-server.mjs [port]
// - 提供 docs/ 靜態檔
// - /gas 以真正的 gas/*.js 程式碼（搭配假試算表）模擬 Apps Script，送單會導到綠界「測試環境」
// - /gas/simulate?o=訂單編號  模擬綠界付款成功通知（只在本機）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './gas-sandbox.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const GAS = `http://localhost:${PORT}/gas`;
const { ctx, sheets } = createSandbox({ props: { WEBAPP_URL: GAS } });
ctx.setup();

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/gas/simulate') {
    const no = url.searchParams.get('o');
    const sheet = sheets.get('訂單_2026Birthday');
    const row = ctx.findRow_(sheet, no);
    if (!row) return send(res, 404, 'no such order');
    const o = ctx.readObject_(sheet, row);
    const p = {
      MerchantID: '3002607', MerchantTradeNo: no, RtnCode: '1', RtnMsg: '交易成功', TradeNo: 'SIM' + Date.now(),
      TradeAmt: String(o['總金額']), PaymentDate: new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/'),
      PaymentType: 'Credit_CreditCard', SimulatePaid: '1', CustomField1: '2026Birthday'
    };
    p.CheckMacValue = ctx.ecpayCheckMac_(p, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs');
    const out = ctx.doPost({ parameter: { action: 'ecpayResult' }, postData: { contents: new URLSearchParams(p).toString() } });
    return send(res, 200, out.html, 'text/html; charset=utf-8');
  }
  if (url.pathname === '/gas') {
    const parameter = Object.fromEntries(url.searchParams);
    let out;
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      out = ctx.doPost({ parameter, postData: { contents: body } });
    } else {
      out = ctx.doGet({ parameter });
    }
    return out.html !== undefined
      ? send(res, 200, out.html, 'text/html; charset=utf-8')
      : send(res, 200, out.body, 'application/json; charset=utf-8');
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, 'not found');
  let content = fs.readFileSync(file);
  if (path.basename(file) === 'config.js') {
    content = content.toString().replace(/gasUrl:\s*'[^']*'/, `gasUrl: '${GAS}'`);
  }
  send(res, 200, content, TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`dev server: http://localhost:${PORT}/2026Birthday/`));
