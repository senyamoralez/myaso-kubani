// Тест панели управления: вход, цены, наличие, метки, скрытие, доступы, проверка заказа на сервере.
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert');
const { startServer } = require('./target');

const STAFF = -1009, SITE = 'http://shop.test';
const sent = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const method = req.url.split('/').pop(); let body = {}; try { body = b ? JSON.parse(b) : {}; } catch (e) { /* multipart */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (method === 'getMe') return res.end(JSON.stringify({ ok: true, result: { id: 1, username: 'lavka_bot' } }));
    if (method === 'sendMessage') { sent.push(body); return res.end(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: body.chat_id } } })); }
    if (method === 'getUpdates') return setTimeout(() => res.end(JSON.stringify({ ok: true, result: [] })), 500);
    res.end(JSON.stringify({ ok: true, result: true }));
  });
}).listen(9301);

const PW = 'test-owner-pass';
const salt = crypto.randomBytes(16).toString('hex');
const HASH = `pbkdf2$20000$${salt}$${crypto.pbkdf2Sync(PW, salt, 20000, 32, 'sha256').toString('hex')}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavka-adm-'));
const srv = startServer(9302, { BOT_TOKEN: 'T', STAFF_CHAT_ID: String(STAFF), TG_API: 'http://127.0.0.1:9301', PORT: '9302', DATA_DIR: dataDir,
  CATALOG: path.join(__dirname, '..', 'catalog.json'), ALLOWED_ORIGIN: SITE, COOKIE_SECURE: 'false', ADMIN_LOGIN: 'admin', ADMIN_HASH: HASH });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function api(p, body, tok) {
  const h = { 'content-type': 'application/json', origin: SITE };
  if (tok) h.authorization = 'Admin ' + tok;
  const r = await fetch('http://127.0.0.1:9302' + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
  return { code: r.status, j: await r.json().catch(() => ({})) };
}
const ok = name => console.log('✓', name);
const order = items => api('/api/orders', { consent: true, name: 'Анна', tel: '+7 916 555-12-40', pickup: true, items });

(async () => {
  try {
    await srv.ready; await wait(300);
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog.json'), 'utf8')).items;
    const noPrice = cat.find(p => p.price == null && p.unit === 'kg');
    const kgItem = cat.find(p => p.price != null && p.unit === 'kg' && !p.hidden);
    const pcItem = cat.find(p => p.unit === 'pc' && p.pp != null);

    let r = await api('/api/catalog'); assert.equal(r.code, 200); assert.deepEqual(r.j.ov, {}); ok('публичный каталог правок пуст');
    r = await api('/api/admin/state'); assert.equal(r.code, 401); ok('без входа панель закрыта');
    r = await api('/api/admin/login', { login: 'admin', password: 'wrong' }); assert.equal(r.code, 401); ok('неверный пароль не пускает');
    r = await api('/api/admin/login', { login: 'ADMIN', password: PW }); assert.equal(r.code, 200); assert.ok(r.j.token);
    const tok = r.j.token; assert.equal(r.j.me.role, 'owner'); ok('владелец входит по логину и паролю');
    r = await api('/api/admin/state', null, tok); assert.equal(r.j.me.login, 'admin'); assert.ok(Array.isArray(r.j.users)); ok('состояние панели загружается');

    r = await order([{ id: noPrice.id, q: 1 }]); assert.equal(r.code, 400); ok('товар без цены не заказать');
    r = await api('/api/admin/save', { changes: {
      [noPrice.id]: { price: 650 },
      [kgItem.id]: { stock: 'out' },
      [pcItem.id]: { price: 999, badge: 'sale', old: 1200 },
    } }, tok);
    assert.equal(r.code, 200); assert.equal(r.j.changed, 3);
    assert.equal(r.j.ov[noPrice.id].price, 650); assert.equal(r.j.ov[pcItem.id].pp, 999); assert.equal(r.j.ov[kgItem.id].stock, 'out');
    ok('цена, наличие, метка и старая цена сохраняются (штучный товар — цена за штуку)');
    await wait(200);
    assert.ok(sent.some(m => m.chat_id == STAFF && /изменил каталог/.test(m.text))); ok('сводка изменений ушла в рабочую группу');
    r = await api('/api/catalog'); assert.equal(r.j.ov[noPrice.id].price, 650); ok('покупатели видят новые цены');

    r = await order([{ id: noPrice.id, q: 1 }]); assert.equal(r.code, 201); assert.equal(r.j.goods, 650); ok('товар с новой ценой заказывается по новой цене');
    r = await order([{ id: pcItem.id, q: 2 }]); assert.equal(r.j.goods, 1998); ok('штучный товар считается по новой цене');
    r = await order([{ id: kgItem.id, q: 1 }]); assert.equal(r.code, 400); assert.match(r.j.error, /Нет в наличии/); ok('товар «нет в наличии» не заказать');

    r = await api('/api/admin/save', { changes: { [kgItem.id]: { stock: 'in' }, [noPrice.id]: { hidden: true } } }, tok);
    assert.equal(r.j.ov[kgItem.id], undefined); assert.equal(r.j.ov[noPrice.id].hidden, true); ok('возврат к исходному значению убирает правку');
    r = await order([{ id: noPrice.id, q: 1 }]); assert.equal(r.code, 400); ok('скрытый товар не заказать');
    r = await api('/api/admin/save', { changes: { [noPrice.id]: { price: -5 } } }, tok); assert.equal(r.code, 400); ok('неверная цена отклоняется');
    r = await api('/api/admin/save', { changes: { nope: { price: 5 } } }, tok); assert.equal(r.code, 400); ok('несуществующий товар отклоняется');

    r = await api('/api/admin/users', { action: 'add', login: 'ivan', name: 'Иван', password: 'ivan-pass-1' }, tok); assert.equal(r.code, 200);
    assert.ok(r.j.users.find(u => u.login === 'ivan' && u.role === 'staff')); ok('владелец добавляет сотрудника');
    r = await api('/api/admin/login', { login: 'ivan', password: 'ivan-pass-1' }); const tIvan = r.j.token; assert.ok(tIvan); ok('сотрудник входит');
    r = await api('/api/admin/save', { changes: { [kgItem.id]: { badge: 'hit' } } }, tIvan); assert.equal(r.code, 200); ok('сотрудник меняет товары');
    r = await api('/api/admin/users', { action: 'add', login: 'petr', password: 'petr-pass-1' }, tIvan); assert.equal(r.code, 403); ok('сотрудник не управляет доступами');
    r = await api('/api/admin/state', null, tok); assert.ok(r.j.log.length >= 4); assert.equal(r.j.log[0].by, 'Иван'); ok('история хранит, кто и что менял');
    r = await api('/api/admin/users', { action: 'del', login: 'ivan' }, tok); assert.equal(r.code, 200);
    r = await api('/api/admin/state', null, tIvan); assert.equal(r.code, 401); ok('удалённый сотрудник сразу теряет доступ');
    r = await api('/api/admin/users', { action: 'add', login: '8-901-102-07-37', password: 'phone-pass-1' }, tok); assert.equal(r.code, 200);
    assert.ok(r.j.users.find(u => u.login === '89011020737'));
    r = await api('/api/admin/login', { login: '+7 (901) 102-07-37', password: 'phone-pass-1' }); assert.ok(r.j.token); ok('вход по телефону в любом виде');
    r = await api('/api/admin/users', { action: 'del', login: '89011020737' }, tok); assert.equal(r.code, 200);

    r = await api('/api/admin/password', { old: 'bad', password: 'new-owner-pass' }, tok); assert.equal(r.code, 400);
    r = await api('/api/admin/password', { old: PW, password: 'new-owner-pass' }, tok); assert.equal(r.code, 200);
    r = await api('/api/admin/login', { login: 'admin', password: PW }); assert.equal(r.code, 401);
    r = await api('/api/admin/login', { login: 'admin', password: 'new-owner-pass' }); assert.equal(r.code, 200); ok('смена пароля: старый больше не подходит');
    r = await api('/api/admin/logout', {}, r.j.token); assert.equal(r.code, 200); ok('выход из панели');
    for (let i = 0; i < 8; i++) await api('/api/admin/login', { login: 'admin', password: 'x' + i });
    r = await api('/api/admin/login', { login: 'admin', password: 'new-owner-pass' }); assert.equal(r.code, 429); ok('подбор пароля упирается в лимит попыток');

    console.log('\nВСЕ ПРОВЕРКИ ПАНЕЛИ ПРОЙДЕНЫ');
    srv.kill(); mock.close(); process.exit(0);
  } catch (e) {
    console.error('✗', e.message, '\n', log.slice(-3000)); srv.kill(); mock.close(); process.exit(1);
  }
})();
