// Сквозной тест: поддельный Telegram API + реальный server.js
'use strict';
const http = require('node:http');
const { startServer } = require('./target');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

const STAFF = -1001234567890, CUSTOMER = 555001;
const sent = []; const edits = []; const answers = [];
let queue = []; let waiters = []; let upd = 1; let msgId = 100;
function push(u) { u.update_id = upd++; if (srv.hook) return srv.hook(u); queue.push(u); waiters.splice(0).forEach(w => w()); }

const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', async () => {
    const body = b ? JSON.parse(b) : {}; const method = req.url.split('/').pop();
    let done = false;
    const ok = r => { if (done) return; done = true; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: r })); };
    if (method === 'getMe') return ok({ id: 1, is_bot: true, username: 'lavka_test_bot' });
    if (method === 'deleteWebhook') return ok(true);
    if (method === 'sendMessage') { const m = { message_id: ++msgId, ...body }; sent.push(m); return ok({ message_id: m.message_id, chat: { id: body.chat_id } }); }
    if (method === 'editMessageText') { edits.push(body); return ok(true); }
    if (method === 'answerCallbackQuery') { answers.push(body); return ok(true); }
    if (method === 'getUpdates') {
      const take = () => { const out = queue.filter(u => u.update_id >= (body.offset || 0)); queue = queue.filter(u => !out.includes(u)); return out; };
      if (queue.length) return ok(take());
      const t = setTimeout(() => ok(take()), 800); waiters.push(() => { if (done) return; clearTimeout(t); ok(take()); });
      return;
    }
    ok(true);
  });
}).listen(9101);

const dataDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lavka-'));
const srv = startServer(9102, { BOT_TOKEN: 'TEST', STAFF_CHAT_ID: String(STAFF), TG_API: 'http://127.0.0.1:9101', PORT: '9102', DATA_DIR: dataDir, CATALOG: path.join(__dirname, '..', 'catalog.json') });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
const api = async (p, body) => { const r = await fetch('http://127.0.0.1:9102' + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); return { code: r.status, j: await r.json() }; };
const lastStaff = () => [...edits].reverse().find(e => e.chat_id == STAFF) || sent.filter(m => m.chat_id == STAFF)[0];
const press = (data, chat = STAFF, name = 'Сергей') => push({ callback_query: { id: 'q' + upd, data, from: { id: 7, first_name: name }, message: { message_id: staffMsg, chat: { id: chat } } } });
let staffMsg;

(async () => {
  try {
    await srv.ready; await wait(300);
    let h = await api('/health'); assert.equal(h.j.bot, 'lavka_test_bot');

    // 1. bad orders rejected
    let r = await api('/api/orders', { name: '', tel: '1', items: [] }); assert.equal(r.code, 400);
    r = await api('/api/orders', { name: 'Анна', tel: '+79165551240', addr: 'ул. Тест, 1', items: [{ id: 'ribeye-steaks', q: 1 }] }); assert.equal(r.code, 400); assert.match(r.j.error, /согласие/);
    r = await api('/api/orders', { consent: true, name: 'Анна', tel: '+79165551240', addr: 'ул. Тест, 1', items: [{ id: 'nope', q: 1 }] }); assert.equal(r.code, 400);

    // 2. real order, client-side prices are ignored (server recalculates)
    r = await api('/api/orders', { consent: true, name: 'Анна <b>', tel: '+7 916 555-12-40', addr: 'ул. Таллинская, 20', date: 'Сегодня', time: '14:00–16:00', note: 'толщина 3 см',
      items: [{ id: 'ribeye-steaks', q: 2, price: 1 }, { id: 'a5', q: 0.2 }] });
    assert.equal(r.code, 201, JSON.stringify(r.j));
    const o = r.j; console.log('order', o.no, o.total, o.botLink);
    assert.equal(o.total, 2 * 4500 * 0.45 + 28000 * 0.2); // 4050 + 5600, free delivery
    await wait(200);
    const first = sent.find(m => m.chat_id == STAFF); staffMsg = first.message_id;
    assert.match(first.text, /Заказ № \d+/); assert.match(first.text, /Анна &lt;b&gt;/);
    assert.equal(first.reply_markup.inline_keyboard[0][0].callback_data, 'paid:' + o.no);

    // 3. customer links Telegram via deep link
    push({ message: { message_id: 1, chat: { id: CUSTOMER, type: 'private' }, from: { id: CUSTOMER, first_name: 'Анна' }, text: `/start o${o.no}_${o.token}` } });
    await wait(400);
    assert.ok(sent.some(m => m.chat_id == CUSTOMER && /Будем присылать/.test(m.text)));

    // 4. customer says "I paid"
    r = await api(`/api/orders/${o.no}/paid`, { token: o.token }); assert.equal(r.j.status, 'claimed');
    r = await api(`/api/orders/${o.no}/paid`, { token: 'bad' }); assert.equal(r.code, 404);

    // 5. foreign chat cannot press buttons
    press('paid:' + o.no, 999); await wait(300);
    assert.ok(answers.some(a => a.text === 'Нет доступа'));

    // 6. staff flow
    press('paid:' + o.no, STAFF, 'Ирина'); await wait(300);
    press('work:' + o.no); await wait(300);
    press('road:' + o.no); await wait(300); // wrong order of steps → refused
    assert.ok(answers.some(a => /Статус уже/.test(a.text || '')));
    press('weigh:' + o.no); await wait(300);
    const ask = [...sent].reverse().find(m => m.reply_markup?.force_reply);
    assert.ok(ask, 'weigh prompt');
    push({ message: { message_id: 2, chat: { id: STAFF, type: 'supergroup' }, from: { id: 7, first_name: 'Сергей' }, text: '9 480', reply_to_message: { message_id: ask.message_id } } });
    await wait(400);
    press('road:' + o.no, STAFF, 'Дмитрий'); await wait(300);
    press('done:' + o.no, STAFF, 'Дмитрий'); await wait(300);

    r = await api(`/api/orders/${o.no}?token=${o.token}`); assert.equal(r.j.status, 'done'); assert.equal(r.j.fact, 9480);
    const custMsgs = sent.filter(m => m.chat_id == CUSTOMER).map(m => m.text.split('\n').slice(1).join(' '));
    console.log('\nПокупатель получил:\n- ' + custMsgs.join('\n- '));
    assert.ok(custMsgs.some(t => /вернём на карту/.test(t)));
    console.log('\nСообщение в рабочем чате (финал):\n' + lastStaff().text.replace(/<[^>]+>/g, ''));

    // 7. reports
    push({ message: { message_id: 3, chat: { id: STAFF, type: 'supergroup' }, from: { id: 7 }, text: '/today' } }); await wait(300);
    console.log('\n' + sent[sent.length - 1].text.replace(/<[^>]+>/g, ''));
    console.log('\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
  } catch (e) { console.error('ТЕСТ УПАЛ:', e.message, '\n', log); process.exitCode = 1; }
  srv.kill(); mock.close(); fs.rmSync(dataDir, { recursive: true, force: true });
})();
