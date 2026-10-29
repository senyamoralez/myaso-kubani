// Мясо Кубани и стейки — запуск на обычном сервере (Node.js 18+, без зависимостей).
// Вся логика — в core.js. Тот же код работает в Cloudflare Workers (папка worker/).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createShop, configFromEnv, emptyDb } = require('./core');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(path.join(__dirname, '.env'));
const E = process.env;
const C = configFromEnv(E);
const port = +(E.PORT || 8080);
const dataDir = path.resolve(__dirname, E.DATA_DIR || 'data');
const catalogFile = path.resolve(__dirname, E.CATALOG || 'catalog.json');
const qrFile = path.join(__dirname, E.PAY_QR_FILE || 'pay-qr.png');

if (!C.token) { console.error('Нет BOT_TOKEN в .env'); process.exit(1); }
fs.mkdirSync(dataDir, { recursive: true });
if (!C.secret) {
  const f = path.join(dataDir, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  C.secret = fs.readFileSync(f, 'utf8').trim();
}
if (C.origins.includes('*')) console.warn('ALLOWED_ORIGIN=* подходит только для проверки. Для работы укажите адрес сайта.');

/* storage: один JSON-файл */
const DB_FILE = path.join(dataDir, 'orders.json');
const db = emptyDb();
try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* first run */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}

let catalog = [];
try { catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8')); } catch (e) { console.error('Не удалось прочитать каталог', catalogFile, e.message); }
const groupPhoto = path.join(__dirname, 'assets', 'group.png');
const imgDir = path.join(dataDir, 'img');
const shop = createShop({ C, db, save, catalog, crypto, Buffer,
  assets: { groupPhoto: fs.existsSync(groupPhoto) ? fs.readFileSync(groupPhoto) : null },
  // фото товаров из панели — файлами в DATA_DIR/img
  imgPut: (id, bytes, type) => { fs.mkdirSync(imgDir, { recursive: true }); fs.writeFileSync(path.join(imgDir, id), bytes); fs.writeFileSync(path.join(imgDir, id + '.type'), type); },
  imgGet: id => { const f = path.join(imgDir, id); return fs.existsSync(f) ? { bytes: fs.readFileSync(f), type: fs.readFileSync(f + '.type', 'utf8') } : null; },
  imgDel: id => { for (const f of [id, id + '.type']) fs.rmSync(path.join(imgDir, f), { force: true }); },
  readQrFile: () => fs.existsSync(qrFile) ? { bytes: fs.readFileSync(qrFile), type: qrFile.endsWith('.svg') ? 'image/svg+xml' : qrFile.endsWith('.jpg') ? 'image/jpeg' : 'image/png' } : null });
console.log('Каталог:', (catalog.items || catalog).length, 'позиций');
if (!shop.staff()) console.warn('Рабочий чат не задан: добавьте бота в группу сотрудников и отправьте там /staff');

function readBody(req, max = 60e3) {
  return new Promise(ok => {
    let s = ''; req.on('data', c => { s += c; if (s.length > max) req.destroy(); });
    req.on('end', () => ok(s)); req.on('error', () => ok(s));
  });
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const r = await shop.handle({
    method: req.method, path: u.pathname, query: u.searchParams, headers: req.headers,
    ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress,
    bodyText: req.method === 'POST' ? await readBody(req, u.pathname === '/api/admin/photo' ? 1.5e6 : 60e3) : '',
  });
  res.writeHead(r.status, r.headers);
  res.end(r.body);
});

async function poll() {
  for (;;) {
    try {
      const ups = await shop.tg('getUpdates', { offset: db.offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const u of ups) await shop.onUpdate(u);
    } catch (e) { console.error('poll', e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
}

(async () => {
  const me = await shop.init();
  if (me) console.log('Бот:', '@' + me.username);
  if (me) await shop.setupBot();
  await shop.tg('deleteWebhook').catch(() => {});
  setInterval(() => shop.daily().catch(e => console.error('daily', e.message)), 30000);
  server.listen(port, () => console.log('API слушает порт', port));
  poll();
})();
