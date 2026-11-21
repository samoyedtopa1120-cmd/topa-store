// 在 Node 裡載入 gas/*.js，並提供最小的 Apps Script 假物件，用來做本機測試。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const GAS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gas');

function chainable() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : chainable()),
    apply: () => chainable()
  });
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  appendRow(values) { this.rows.push(values.map(normalize)); return this; }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return new Proxy({}, {
      get(_, k) {
        if (k === 'getValues') return () => {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const src = sheet.rows[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] ?? '');
            out.push(line);
          }
          return out;
        };
        if (k === 'getValue') return () => (sheet.rows[row - 1] || [])[col - 1] ?? '';
        if (k === 'setValues') return (vals) => {
          vals.forEach((line, r) => line.forEach((v, c) => sheet.set(row + r, col + c, v)));
          return chainable();
        };
        if (k === 'setValue') return (v) => { sheet.set(row, col, v); return chainable(); };
        return chainable();
      }
    });
  }
  set(row, col, v) {
    while (this.rows.length < row) this.rows.push([]);
    const r = this.rows[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = normalize(v);
  }
}
// 模擬試算表把開頭的 ' 視為「純文字」標記
function normalize(v) { return typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; }
for (const m of ['setFrozenRows', 'setColumnWidth', 'setTabColor', 'autoResizeColumns', 'hideColumns']) {
  FakeSheet.prototype[m] = function () { return this; };
}

export function createSandbox({ props = {} } = {}) {
  const sheets = new Map();
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    getId: () => 'FAKE_SS',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/FAKE_SS',
    setSpreadsheetTimeZone: () => {},
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.getName())
  };
  const store = { ...props };
  const ctx = {
    console,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(new Int8Array(crypto.createHash(alg).update(s, 'utf8').digest())),
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).formatToParts(d).map((x) => [x.type, x.value]));
        return fmt.replace('yyyy', p.year).replace('yy', p.year.slice(2)).replace('MM', p.month)
          .replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
      },
      getUuid: () => crypto.randomUUID()
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...store }),
        getProperty: (k) => store[k] ?? null,
        setProperty: (k, v) => { store[k] = String(v); },
        setProperties: (o) => Object.assign(store, o)
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      create: () => ss,
      newDataValidation: () => chainable()
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ScriptApp: { getService: () => ({ getUrl: () => store.WEBAPP_URL || '' }) },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: (s) => ({ body: s, setMimeType() { return this; } })
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutput: (s) => ({
        html: s, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; }
      })
    },
    Logger: { log: () => {} }
  };
  vm.createContext(ctx);
  for (const f of fs.readdirSync(GAS_DIR).filter((f) => f.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, sheets, props: store };
}
