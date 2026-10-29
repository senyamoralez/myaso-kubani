// Проверки, специфичные для Cloudflare Worker: вебхук, /staff, QR через бота, вход по токену, сохранность базы, cron.
// Основные сценарии (заказ, кабинет, бонусы) — в bot/test, запуск: npm run test:worker
'use strict';
const http = require('node:http');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startServer } = require('../bot/test/target');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const sent = [], hooks = [], calls = [];
let msgId = 10;
const mock = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.endsWith('/photos/qr.png')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    let body = {}; try { body = b ? JSON.parse(b) : {}; } catch (e) { body = { multipart: true }; } const method = req.url.split('/').pop(); calls.push({ method, body });
    const ok = r => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: r })); };
    if (method === 'getMe') return ok({ id: 1, is_bot: true, username: 'lavka_cf_bot' });
    if (method === 'setWebhook') { hooks.push(body); return ok(true); }
    if (method === 'getFile') return ok({ file_id: body.file_id, file_path: 'photos/qr.png' });
    if (method === 'sendMessage') { sent.push(body); return ok({ message_id: ++msgId, chat: { id: body.chat_id } }); }
    ok(true);
  });
}).listen(9301);

const PORT = 9302, SITE = 'http://site.test';
const ENV = { BOT_TOKEN: 'T', TG_API: 'http://127.0.0.1:9301', ALLOWED_ORIGIN: SITE, DAILY_SUMMARY_AT: '00:00' };
const hmac = s => crypto.createHmac('sha256', 'test-secret').update(s).digest('hex');
const HOOK = `/tg/${hmac('webhook-path').slice(0, 32)}`, TOKEN = hmac('webhook-token').slice(0, 48);
const wait = ms => new Promise(r => setTimeout(r, ms));
const ok = n => console.log('✓', n);
let upd = 1;
const tgPost = (u, path = HOOK, token = TOKEN) => fetch('http://127.0.0.1:' + PORT + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': token }, body: JSON.stringify({ update_id: upd++, ...u }) });
const msg = (chat, text, extra = {}) => tgPost({ message: { message_id: upd + 100, chat: { id: chat, type: chat < 0 ? 'supergroup' : 'private' }, from: { id: Math.abs(chat), first_name: 'Анна' }, text, ...extra } });
async function api(p, body, auth) {
  const r = await fetch('http://127.0.0.1:' + PORT + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: SITE, ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = r.headers.get('content-type') || '';
  return { code: r.status, j: t.includes('json') ? await r.json() : null, buf: t.startsWith('image') ? Buffer.from(await r.arrayBuffer()) : null, h: r.headers };
}

(async () => {
  let srv = startServer(PORT, ENV, { worker: true });
  let log = ''; const tap = s => { s.stdout.on('data', d => log += d); s.stderr.on('data', d => log += d); }; tap(srv);
  try {
    await srv.ready;
    let r = await api('/health');
    assert.equal(r.j.bot, 'lavka_cf_bot'); assert.equal(r.j.staffChat, false);
    assert.equal(hooks.length, 1); assert.match(hooks[0].url, /\/tg\/[a-f0-9]{32}$/); assert.equal(hooks[0].secret_token, TOKEN);
    ok('вебхук Telegram подключается сам при первом запросе');
    await api('/health'); assert.equal(hooks.length, 1); ok('повторно вебхук не переподключается');

    assert.equal((await tgPost({ message: {} }, '/tg/wrong')).status, 403);
    assert.equal((await tgPost({ message: {} }, HOOK, 'bad')).status, 403);
    ok('чужие запросы на вебхук отклоняются');

    assert.ok(calls.some(c => c.method === 'setMyDescription') && calls.some(c => c.method === 'setMyCommands' && c.body.scope?.type === 'all_private_chats'));
    ok('описание и меню команд бота настраиваются сами');
    await msg(-100500, '/staff'); assert.ok(sent.some(m => /рабочий чат лавки/.test(m.text)));
    for (const m of ['setChatTitle', 'setChatDescription', 'setChatPhoto', 'pinChatMessage']) assert.ok(calls.some(c => c.method === m), m);
    assert.ok(calls.find(c => c.method === 'setChatPhoto').body.multipart);
    assert.match(sent.at(-1).text, /✅ Аватар/); assert.match(sent.at(-1).text, /✅ Шпаргалка/);
    ok('группа оформляется: название, описание, аватар, команды, шпаргалка в закрепе');
    r = await api('/health'); assert.equal(r.j.staffChat, true);
    await msg(-100777, '/staff'); assert.match(sent.at(-1).text, /уже назначен/);
    ok('/staff назначает рабочий чат один раз');

    await msg(-100500, '', { caption: '/qr', photo: [{ file_id: 'small', file_size: 100 }, { file_id: 'big', file_size: 900 }] });
    assert.match(sent.at(-1).text, /QR-код для оплаты сохранён/);
    r = await api('/pay-qr'); assert.equal(r.code, 200); assert.equal(r.h.get('content-type'), 'image/png'); assert.ok(r.buf.equals(PNG));
    ok('QR-код загружается через бота и отдаётся сайту');

    // вход: номер → бот → контакт → токен (без cookie, как в Safari)
    r = await api('/api/auth/start', { consent: true, phone: '+7 916 555-12-40' }); const nonce = r.j.nonce;
    assert.match(r.j.link, /t\.me\/lavka_cf_bot\?start=login_/);
    await msg(777, '/start login_' + nonce);
    await msg(777, '', { contact: { phone_number: '79165551240', user_id: 777 } });
    r = await api('/api/auth/poll', { nonce }); assert.equal(r.j.ok, true); assert.ok(r.j.token.length > 30);
    const T = r.j.token;
    r = await api('/api/me'); assert.equal(r.code, 401);
    r = await api('/api/me', null, T); assert.equal(r.code, 200); assert.equal(r.j.bonus, 300);
    ok('вход по токену в заголовке Authorization (работает при разных доменах сайта и сервера)');

    r = await api('/api/orders', { consent: true, name: 'Анна', tel: '+79165551240', pickup: true, items: [{ id: 'chuck', q: 1 }] }, T);
    assert.equal(r.code, 201); assert.match(r.j.payQr, /^\/pay-qr\?v=\d+$/); assert.equal(r.j.telegramLinked, true);
    assert.equal(sent.filter(m => String(m.chat_id) === '-100500' && /Заказ № 2001/.test(m.text)).length, 1);
    ok('заказ уходит в рабочий чат, назначенный через /staff');

    // перезапуск: база сохраняется
    const dir = srv.persist(); srv.kill(true); await srv.exited;
    srv = startServer(PORT, ENV, { worker: true, persist: dir }); tap(srv); await srv.ready;
    r = await api('/api/me', null, T); assert.equal(r.code, 200); assert.equal(r.j.orders.length, 1);
    r = await api('/health'); assert.equal(r.j.orders, 1); assert.equal(r.j.staffChat, true); assert.equal(r.j.payQr, true);
    ok('после перезапуска заказы, сессии, рабочий чат и QR на месте');

    // cron: итоги дня
    const before = sent.length;
    await fetch(`http://127.0.0.1:${PORT}/__scheduled?cron=*/5+*+*+*+*`); await wait(1500);
    assert.ok(sent.slice(before).some(m => String(m.chat_id) === '-100500' && /Итоги/.test(m.text)));
    ok('по расписанию приходят итоги дня');
    console.log('\nВСЕ ПРОВЕРКИ WORKER ПРОЙДЕНЫ');
  } catch (e) { console.error('ТЕСТ УПАЛ:', e.stack, '\n', log.slice(-3000)); process.exitCode = 1; }
  srv.kill(); mock.close();
})();
