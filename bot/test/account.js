// Тест личного кабинета: вход через Telegram, коды, бонусы, безопасность.
'use strict';
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert');

const STAFF = -1009, USER_CHAT = 777, SITE = 'http://shop.test';
const sent = [], answers = [];
let queue = [], waiters = [], upd = 1, msgId = 100;
const push = u => { u.update_id = upd++; queue.push(u); waiters.splice(0).forEach(w => w()); };
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = b ? JSON.parse(b) : {}, method = req.url.split('/').pop();
    let done = false;
    const ok = r => { if (done) return; done = true; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: r })); };
    if (method === 'getMe') return ok({ id: 1, username: 'lavka_bot' });
    if (method === 'sendMessage') { const m = { message_id: ++msgId, ...body }; sent.push(m); return ok({ message_id: m.message_id, chat: { id: body.chat_id } }); }
    if (method === 'answerCallbackQuery') { answers.push(body); return ok(true); }
    if (method === 'getUpdates') {
      const take = () => { const out = queue.filter(u => u.update_id >= (body.offset || 0)); queue = queue.filter(u => !out.includes(u)); return out; };
      if (queue.length) return ok(take());
      const t = setTimeout(() => ok(take()), 600); waiters.push(() => { if (done) return; clearTimeout(t); ok(take()); });
      return;
    }
    ok(true);
  });
}).listen(9201);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavka-acc-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, BOT_TOKEN: 'T', STAFF_CHAT_ID: String(STAFF), TG_API: 'http://127.0.0.1:9201', PORT: '9202', DATA_DIR: dataDir,
    CATALOG: path.join(__dirname, '..', 'catalog.json'), ALLOWED_ORIGIN: SITE, COOKIE_SECURE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
let jar = '';
async function api(p, body, opts = {}) {
  const r = await fetch('http://127.0.0.1:9202' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: opts.origin || SITE, ...(jar && !opts.nocookie ? { cookie: jar } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && !opts.nocookie) jar = sc.split(';')[0];
  return { code: r.status, j: await r.json().catch(() => ({})), cookie: sc };
}
const msg = (text, extra = {}) => push({ message: { message_id: upd + 50, chat: { id: USER_CHAT, type: 'private' }, from: { id: USER_CHAT, first_name: 'Анна' }, text, ...extra } });
let staffMsg = {};
const press = (data) => push({ callback_query: { id: 'q' + upd, data, from: { id: 5, first_name: 'Ирина' }, message: { message_id: staffMsg[data.split(':')[1]], chat: { id: STAFF } } } });
const ok = (name) => console.log('✓', name);

(async () => {
  try {
    await wait(600);
    const PHONE = '8 (916) 555-12-40';

    // --- 1. first login: confirm number via Telegram contact
    let r = await api('/api/auth/start', { phone: PHONE }); assert.equal(r.code, 400); ok('без согласия на обработку ПД вход не начинается');
    r = await api('/api/auth/start', { consent: true, phone: PHONE });
    assert.equal(r.j.method, 'telegram_link'); assert.match(r.j.link, /start=login_/);
    const nonce = r.j.nonce; ok('новый номер → ссылка на бота');
    r = await api('/api/auth/poll', { nonce }); assert.equal(r.j.waiting, true); ok('пока номер не подтверждён — вход не выполнен');
    msg('/start login_' + nonce); await wait(300);
    assert.ok(sent.at(-1).reply_markup.keyboard[0][0].request_contact); ok('бот просит поделиться номером');
    msg('', { contact: { phone_number: '+79165551240', user_id: 999999 } }); await wait(300);
    assert.match(sent.at(-1).text, /свой номер/); ok('чужой контакт отклонён');
    msg('', { contact: { phone_number: '+79000000000', user_id: USER_CHAT } }); await wait(300);
    assert.match(sent.at(-1).text, /не совпадает/); ok('другой номер в Telegram — отказ');
    msg('/start login_' + nonce); await wait(200);
    msg('', { contact: { phone_number: '79165551240', user_id: USER_CHAT } }); await wait(300);
    assert.match(sent.at(-1).text, /вход выполнен/);
    r = await api('/api/auth/poll', { nonce }); assert.equal(r.j.ok, true); assert.match(r.cookie, /HttpOnly/); ok('номер подтверждён → сессия в HttpOnly-cookie');
    r = await api('/api/auth/poll', { nonce }); assert.equal(r.code, 400); ok('одноразовая ссылка не срабатывает повторно');

    r = await api('/api/me'); assert.equal(r.j.phone, '+79165551240'); assert.equal(r.j.bonus, 300); assert.equal(r.j.level.name, 'Choice'); ok('кабинет: 300 приветственных бонусов, уровень Choice');
    r = await api('/api/me', null, { nocookie: true }); assert.equal(r.code, 401); ok('без входа кабинет закрыт');

    // --- 2. second login: code in Telegram, brute force protection
    await api('/api/auth/logout', {}); jar = '';
    r = await api('/api/auth/start', { consent: true, phone: '+7 916 555 12 40' }); assert.equal(r.j.method, 'telegram_code');
    const n2 = r.j.nonce; const code = sent.at(-1).text.match(/<b>(\d{6})<\/b>/)[1]; ok('повторный вход → код в Telegram');
    for (let i = 0; i < 5; i++) { r = await api('/api/auth/verify', { nonce: n2, code: '000000' === code ? '111111' : '000000' }); }
    r = await api('/api/auth/verify', { nonce: n2, code }); assert.equal(r.code, 429); ok('после 5 неверных кодов — блокировка, даже верный код не проходит');
    r = await api('/api/auth/start', { consent: true, phone: PHONE }); const n3 = r.j.nonce, code3 = sent.at(-1).text.match(/<b>(\d{6})<\/b>/)[1];
    r = await api('/api/auth/verify', { nonce: n3, code: code3 }); assert.equal(r.j.ok, true); ok('новый код → вход');

    // --- 3. foreign site cannot act
    r = await api('/api/orders', { name: 'x' }, { origin: 'https://evil.example' }); assert.equal(r.code, 403); ok('запрос с чужого сайта отклонён');

    // --- 4. profile
    r = await api('/api/me', { name: 'Анна', birthday: '15.03', note: 'стейки 3 см' }); assert.equal(r.j.birthday, '15.03');
    r = await api('/api/me', { birthday: '01.01' }); assert.equal(r.j.birthday, '15.03'); ok('день рождения задаётся один раз');

    // --- 5. order with bonuses → done → cashback goes to the linked Telegram automatically
    r = await api('/api/orders', { consent: true, name: 'Анна', tel: PHONE, addr: 'ул. Таллинская, 20', date: 'Сегодня', time: '14:00–16:00', items: [{ id: 'ribeye-steaks', q: 2 }], useBonus: 5000 });
    assert.equal(r.code, 201); const o = r.j;
    assert.equal(o.bonusUsed, 300); assert.equal(o.total, 4050 + 500 - 300); assert.equal(o.telegramLinked, true); ok('списано 300 бонусов (не больше баланса), заказ привязан к Telegram');
    await wait(200);
    staffMsg[o.no] = sent.find(m => m.chat_id == STAFF && /Заказ № /.test(m.text) && m.text.includes(o.no)).message_id;
    assert.match(sent.find(m => m.message_id === staffMsg[o.no]).text, /Списано бонусов/);
    for (const a of ['paid', 'work', 'packed', 'road', 'done']) { press(`${a}:${o.no}`); await wait(250); }
    r = await api('/api/me');
    const cb = Math.floor((4050 - 300) * 0.03);
    assert.equal(r.j.bonus, cb); assert.equal(r.j.orders[0].cashback, cb); assert.equal(r.j.orders[0].status, 'done');
    assert.ok(sent.some(m => m.chat_id == USER_CHAT && /Начислили \d+ бонусов/.test(m.text))); ok(`кешбэк 3%: +${cb} бонусов, покупатель получил уведомление`);

    // --- 6. cancel returns bonuses
    r = await api('/api/orders', { consent: true, name: 'Анна', tel: PHONE, pickup: true, items: [{ id: 'chuck', q: 1 }], useBonus: 999 });
    const o2 = r.j; assert.equal(o2.bonusUsed, cb); await wait(200);
    staffMsg[o2.no] = sent.filter(m => m.chat_id == STAFF && m.text?.includes('№ ' + o2.no))[0].message_id;
    press(`cancel:${o2.no}`); await wait(300);
    r = await api('/api/me'); assert.equal(r.j.bonus, cb); ok('отмена заказа возвращает бонусы');

    // --- 7. staff tools, sessions
    push({ message: { message_id: 9000, chat: { id: STAFF, type: 'supergroup' }, from: { id: 5 }, text: '/client 89165551240' } }); await wait(300);
    assert.match(sent.at(-1).text, /Бонусы: \d+/); ok('/client показывает покупателя сотрудникам');
    r = await api('/api/me'); assert.ok(r.j.sessions.some(s => s.current));
    await api('/api/auth/logout', { all: true }); r = await api('/api/me'); assert.equal(r.code, 401); ok('«Выйти на всех устройствах» закрывает сессии');

    console.log('\nВСЕ ПРОВЕРКИ КАБИНЕТА ПРОЙДЕНЫ');
  } catch (e) { console.error('ТЕСТ УПАЛ:', e.stack, '\n', log); process.exitCode = 1; }
  srv.kill(); mock.close(); fs.rmSync(dataDir, { recursive: true, force: true });
})();
