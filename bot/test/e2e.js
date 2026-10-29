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
    let body = {}; try { body = b ? JSON.parse(b) : {}; } catch (e) { body = { multipart: true }; }; const method = req.url.split('/').pop();
    let done = false;
    const ok = r => { if (done) return; done = true; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: r })); };
    if (method === 'getMe') return ok({ id: 1, is_bot: true, username: 'lavka_test_bot' });
    if (method === 'deleteWebhook') return ok(true);
    if (method === 'getChat') return ok({ id: body.chat_id, type: 'supergroup', is_forum: true });
    if (method === 'createForumTopic') return ok({ message_thread_id: 700 + (++msgId), name: body.name });
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

    // 6a. возврат 170 ₽: бот спрашивает покупателя, куда вернуть
    const askR = sent.find(m => m.chat_id == CUSTOMER && /Возврат 170/.test(m.text || ''));
    assert.ok(askR, 'вопрос о возврате'); assert.ok(askR.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'rc:' + o.no));
    press('rc:' + o.no, 999); await wait(200);
    press('rc:' + o.no, CUSTOMER, 'Анна'); await wait(300);
    push({ message: { message_id: 10, chat: { id: CUSTOMER, type: 'private' }, from: { id: CUSTOMER }, text: '4111 1111 1111 1112' } }); await wait(300);
    assert.match(sent.at(-1).text, /ошибка/);
    push({ message: { message_id: 11, chat: { id: CUSTOMER, type: 'private' }, from: { id: CUSTOMER }, text: '4111 1111 1111 1111' } }); await wait(400);
    assert.ok(sent.some(m => m.chat_id == CUSTOMER && /•••• 1111/.test(m.text || '')));
    assert.match(lastStaff().text, /4111 1111 1111 1111/);
    press('refunded:' + o.no, STAFF, 'Ирина'); await wait(400);
    assert.doesNotMatch(lastStaff().text, /4111 1111 1111 1111/); assert.match(lastStaff().text, /Возвращено 170/);
    assert.ok(sent.some(m => m.chat_id == CUSTOMER && /Вернули 170/.test(m.text || '')));

    press('road:' + o.no, STAFF, 'Дмитрий'); await wait(300);
    press('done:' + o.no, STAFF, 'Дмитрий'); await wait(300);

    r = await api(`/api/orders/${o.no}?token=${o.token}`); assert.equal(r.j.status, 'done'); assert.equal(r.j.fact, 9480);
    const custMsgs = sent.filter(m => m.chat_id == CUSTOMER && m.text).map(m => m.text.split('\n').slice(1).join(' '));
    console.log('\nПокупатель получил:\n- ' + custMsgs.join('\n- '));
    assert.ok(custMsgs.some(t => /Вернём вам 170/.test(t)));
    console.log('\nСообщение в рабочем чате (финал):\n' + lastStaff().text.replace(/<[^>]+>/g, ''));

    // 8. изменить сумму: до оплаты меняется сумма к оплате, после — считается возврат
    r = await api('/api/orders', { consent: true, name: 'Пётр', tel: '+79160000001', pickup: true, items: [{ id: 'ribeye-steaks', q: 1 }] });
    const o2 = r.j; await wait(300);
    const card2 = sent.find(m => m.chat_id == STAFF && (m.text || '').includes('№ ' + o2.no));
    assert.ok(card2.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'fix:' + o2.no));
    const fix = async (sumText) => {
      press('fix:' + o2.no, STAFF, 'Ирина'); await wait(300);
      const askF = [...sent].reverse().find(m => m.reply_markup?.force_reply && /новой суммой/.test(m.text));
      push({ message: { message_id: 20 + upd, chat: { id: STAFF, type: 'supergroup' }, from: { id: 7, first_name: 'Ирина' }, text: sumText, reply_to_message: { message_id: askF.message_id } } }); await wait(400);
    };
    await fix('1500 ошиблись в цене');
    r = await api(`/api/orders/${o2.no}?token=${o2.token}`); assert.equal(r.j.total, 1500);
    press('paid:' + o2.no, STAFF, 'Ирина'); await wait(300);
    await fix('1300');
    const st2 = [...edits].reverse().find(e => e.chat_id == STAFF && (e.text || '').includes('№ ' + o2.no)).text;
    assert.match(st2, /Сумма изменена: 2 025 ₽ → <b>1 500 ₽<\/b> \(ошиблись в цене\)/); assert.match(st2, /Вернуть 200 ₽/); assert.match(st2, /уточните по телефону/);
    console.log('\nКарточка после правки суммы:\n' + st2.replace(/<[^>]+>/g, ''));

    // 9. меню покупателя
    push({ message: { message_id: 30, chat: { id: CUSTOMER, type: 'private' }, from: { id: CUSTOMER, first_name: 'Анна' }, text: '📦 Мои заказы' } }); await wait(300);
    assert.match(sent.at(-1).text, new RegExp('№ ' + o.no));
    push({ message: { message_id: 31, chat: { id: CUSTOMER, type: 'private' }, from: { id: CUSTOMER, first_name: 'Анна' }, text: '📍 Адрес и часы' } }); await wait(300);
    assert.match(sent.at(-1).text, /Саляма Адиля[\s\S]*Грин Парк[\s\S]*Славич/); assert.ok(sent.at(-1).reply_markup.inline_keyboard[0][0].url.includes('yandex'));

    // 7. reports
    push({ message: { message_id: 3, chat: { id: STAFF, type: 'supergroup' }, from: { id: 7 }, text: '/today' } }); await wait(300);
    console.log('\n' + sent[sent.length - 1].text.replace(/<[^>]+>/g, ''));
    // оплата переводом на карту, номера заказов с 2001
    assert.ok(+o.no >= 2001, 'номера заказов с 2001');
    push({ message: { message_id: 901, chat: { id: STAFF, type: 'supergroup' }, from: { id: 7, first_name: 'Сергей' }, text: '/card 2202 2000 1234 5678, Сергей М., Сбербанк' } }); await wait(300);
    assert.ok(sent.some(m => m.chat_id == STAFF && /Карта для оплаты/.test(m.text || '')), 'карта сохранена');
    r = await api('/api/orders', { consent: true, name: 'Пётр', tel: '+79165551241', addr: 'ул. Тест, 2', items: [{ id: 'ribeye-steaks', q: 2 }] });
    assert.equal(r.code, 201); assert.ok(+r.j.no > +o.no);
    assert.equal(r.j.payCard.num, '2202 2000 1234 5678'); assert.equal(r.j.payCard.name, 'Сергей М., Сбербанк'); await wait(200);
    assert.ok(sent.some(m => m.chat_id == STAFF && (m.text || '').includes(`комментарием <b>${r.j.no}</b>`)), 'в карточке номер для поиска перевода');
    console.log('✓ оплата на карту: номер заказа и карта на сайте и в группе');
    // магазины и темы группы
    push({ message: { message_id: 902, chat: { id: STAFF, type: 'supergroup' }, from: { id: 7, first_name: 'Сергей' }, text: '/topics' } }); await wait(400);
    const topicHello = sent.filter(m => m.chat_id == STAFF && /Сюда приходят заказы этого магазина/.test(m.text || ''));
    assert.equal(topicHello.length, 3, 'три темы магазинов');
    const greenTh = topicHello.find(m => /Грин Парк/.test(m.text)).message_thread_id;
    r = await api('/api/orders', { consent: true, name: 'Ольга', tel: '+79165551242', pickup: true, shop: 'green', items: [{ id: 'ribeye-steaks', q: 2 }] });
    assert.equal(r.code, 201); await wait(300);
    const card = sent.find(m => m.chat_id == STAFF && (m.text || '').includes(`Заказ № ${r.j.no}`));
    assert.equal(card.message_thread_id, greenTh, 'заказ в теме своего магазина');
    assert.match(card.text, /Магазин: <b>ЖК «Грин Парк»<\/b>/); assert.match(card.text, /Самовывоз: Сельскохозяйственная/);
    console.log('✓ заказ уходит в тему выбранного магазина');
    console.log('\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
  } catch (e) { console.error('ТЕСТ УПАЛ:', e.message, '\n', log); process.exitCode = 1; }
  srv.kill(); mock.close(); fs.rmSync(dataDir, { recursive: true, force: true });
})();
