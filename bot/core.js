// Мясо Кубани и стейки — ядро: заказы, личный кабинет, бонусы и Telegram-бот.
// Не зависит от среды: одинаково работает в Node.js (server.js) и в Cloudflare Workers (worker/).
// Хранилище, crypto и Buffer передаются снаружи.
'use strict';

function configFromEnv(E) {
  return {
    token: E.BOT_TOKEN || '',
    staffChat: E.STAFF_CHAT_ID || '',
    origins: (E.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean),
    api: (E.TG_API || 'https://api.telegram.org').replace(/\/$/, ''),
    shop: E.SHOP_NAME || 'Мясо Кубани и стейки',
    phone: E.SHOP_PHONE || '+7 926 244-37-37',
    pickupAddr: E.PICKUP_ADDRESS || 'Таллинская, 7, ТЦ «Московская ярмарка», 1 этаж',
    deliveryFee: +(E.DELIVERY_FEE || 500),
    freeFrom: +(E.FREE_DELIVERY_FROM || 5000),
    payNote: E.PAY_NOTE || 'Оплата по QR-коду СБП. В назначении платежа укажите номер заказа.',
    summaryAt: E.DAILY_SUMMARY_AT || '21:00',
    tz: E.TZ_NAME || 'Europe/Moscow',
    secret: E.SECRET || '',
    cookieSecure: (E.COOKIE_SECURE || 'true') !== 'false',
    cookieDomain: E.COOKIE_DOMAIN || '',
    welcomeBonus: +(E.WELCOME_BONUS || 300),
    birthdayBonus: +(E.BIRTHDAY_BONUS || 1000),
    maxBonusShare: +(E.MAX_BONUS_SHARE || 0.3),
    levels: JSON.parse(E.LEVELS || '[{"name":"Choice","from":0,"rate":0.03},{"name":"Prime","from":20000,"rate":0.05},{"name":"Вагю A5","from":60000,"rate":0.07}]'),
    sms: { provider: E.SMS_PROVIDER || '', key: E.SMS_API_KEY || '', from: E.SMS_FROM || '' },
  };
}
const emptyDb = () => ({ seq: 1000, orders: {}, pending: {}, offset: 0, lastSummary: '', users: {}, sessions: {}, logins: {}, lastBirthday: '',
  secret: '', staffChat: '', qr: null, webhookUrl: '' });

/**
 * opts: { C, db, save(), catalog: items[], crypto, Buffer, readQrFile?(): {bytes,type}|null, log? }
 */
function createShop(opts) {
  const { C, db, crypto, Buffer } = opts;
  const save = opts.save || (() => {});
  const log = opts.log || console;
  if (!C.secret) { if (!db.secret) { db.secret = crypto.randomBytes(32).toString('hex'); save(); } C.secret = db.secret; }

  /* ---------- catalog ---------- */
  const CATALOG = {};
  for (const p of (opts.catalog && (opts.catalog.items || opts.catalog)) || []) CATALOG[p.id] = p;
  const piece = p => (p.pp != null ? p.pp : p.price * (p.w || 1));
  const lineSum = (p, q) => (p.unit === 'kg' ? p.price * q : piece(p) * q);
  const qLabel = (p, q) => (p.unit === 'kg' ? `${String(+q.toFixed(2)).replace('.', ',')} кг` : `${q} шт`);

  /* ---------- helpers ---------- */
  const rub = n => Math.round(n).toLocaleString('ru-RU').replace(/\s/g, ' ') + ' ₽';
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const now = () => new Date();
  const iso = () => now().toISOString();
  const hm = d => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: C.tz });
  const day = d => new Date(d).toLocaleDateString('ru-RU', { timeZone: C.tz });
  const who = u => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || 'сотрудник';
  const sha = s => crypto.createHmac('sha256', C.secret).update(s).digest('hex');
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  const staff = () => String(C.staffChat || db.staffChat || '');
  function normPhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
    else if (d.length === 10) d = '7' + d;
    return /^7\d{10}$/.test(d) ? '+' + d : null;
  }
  const maskPhone = p => p.replace(/^\+7(\d{3})\d{3}(\d{2})(\d{2})$/, '+7 $1 ***-$2-$3');

  /* ---------- loyalty ---------- */
  function levelOf(spent) {
    let L = C.levels[0];
    for (const l of C.levels) if (spent >= l.from) L = l;
    const i = C.levels.indexOf(L), next = C.levels[i + 1] || null;
    return { name: L.name, rate: L.rate, next: next ? { name: next.name, rate: next.rate, need: next.from - spent } : null };
  }
  function bonus(u, delta, reason, orderNo) {
    if (!delta) return;
    u.bonus = Math.max(0, (u.bonus || 0) + delta);
    u.ledger.unshift({ at: iso(), delta, reason, order: orderNo || null });
    u.ledger = u.ledger.slice(0, 200);
    save();
  }
  function getUser(phone, create) {
    let u = db.users[phone];
    if (!u && create) {
      u = db.users[phone] = { phone, name: '', birthday: '', note: '', addresses: [], chat: null, bonus: 0, spent: 0, ledger: [], createdAt: iso() };
      if (C.welcomeBonus) bonus(u, C.welcomeBonus, 'Приветственные бонусы');
    }
    return u;
  }

  /* ---------- Telegram ---------- */
  async function tg(method, body = {}) {
    if (!C.token) throw new Error('нет BOT_TOKEN');
    const r = await fetch(`${C.api}/bot${C.token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ ok: false, description: 'bad json' }));
    if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
    return j.result;
  }
  let ME = null;
  async function init() {
    if (!C.token) { log.error('Нет BOT_TOKEN'); return null; }
    try { ME = await tg('getMe'); } catch (e) { log.error('Telegram недоступен или неверный BOT_TOKEN:', e.message); }
    return ME;
  }

  const ST = {
    new:    { t: 'Ждёт оплаты',          e: '🟡' },
    claimed:{ t: 'Покупатель оплатил, проверьте поступление', e: '🟠' },
    paid:   { t: 'Оплачен',              e: '🟢' },
    work:   { t: 'В работе у мясника',    e: '🔪' },
    packed: { t: 'Собран',               e: '📦' },
    road:   { t: 'У курьера',            e: '🚚' },
    done:   { t: 'Выполнен',             e: '✅' },
    cancel: { t: 'Отменён',              e: '⛔' },
  };
  const CUSTOMER_TEXT = {
    new: 'Заказ создан и ждёт оплаты.',
    claimed: 'Спасибо! Проверяем поступление оплаты, обычно это 5–10 минут.',
    paid: 'Оплата получена, заказ передан мяснику.',
    work: 'Мясник режет и взвешивает ваш заказ.',
    packed: 'Заказ собран.',
    road: 'Курьер забрал заказ и едет к вам.',
    done: 'Заказ выполнен. Спасибо, что выбрали нас!',
    cancel: 'Заказ отменён. Если это ошибка, позвоните нам.',
  };

  function orderText(o) {
    const s = ST[o.status];
    const L = [];
    L.push(`<b>Заказ № ${o.no}</b>  ${s.e} ${esc(s.t)}`);
    L.push('');
    L.push(`👤 ${esc(o.customer.name)}, ${esc(o.customer.tel)}${o.user ? ' · личный кабинет' : ''}`);
    L.push(o.pickup ? `🏪 Самовывоз: ${esc(C.pickupAddr)}` : `📍 ${esc(o.addr)}`);
    L.push(`🕑 ${esc(o.date)}, ${esc(o.time)}`);
    L.push('');
    for (const i of o.items) L.push(`• ${esc(i.name)} × ${esc(i.qty)} — ${rub(i.sum)}`);
    if (o.delivery) L.push(`• Доставка — ${rub(o.delivery)}`);
    if (o.bonusUsed) L.push(`• Списано бонусов — −${rub(o.bonusUsed)}`);
    L.push(`<b>К оплате: ${rub(o.total)}</b>`);
    if (o.note) L.push(`💬 ${esc(o.note)}`);
    if (o.fact != null) {
      const d = o.goods - o.fact;
      L.push(`⚖️ После взвешивания: ${rub(o.fact)} · ${d >= 0 ? 'вернуть ' + rub(d) : 'доплата ' + rub(-d)}`);
    }
    if (o.history.length) {
      L.push('');
      for (const h of o.history.slice(-8)) L.push(`<i>${hm(h.at)} · ${esc(h.text)}</i>`);
    }
    return L.join('\n');
  }
  function keyboard(o) {
    const b = (text, a) => ({ text, callback_data: `${a}:${o.no}` });
    switch (o.status) {
      case 'new': case 'claimed': return [[b('✅ Оплата получена', 'paid')], [b('Отменить заказ', 'cancel')]];
      case 'paid': return [[b('🔪 Взять в работу', 'work')]];
      case 'work': return [[b('⚖️ Ввести сумму после взвешивания', 'weigh')], [b('Собран, вес как в заказе', 'packed')]];
      case 'packed': return [[o.pickup ? b('🤝 Выдан покупателю', 'done') : b('🚚 Передан курьеру', 'road')]];
      case 'road': return [[b('✅ Доставлен', 'done')]];
      default: return [];
    }
  }
  async function renderStaff(o) {
    if (!staff()) return;
    const body = { chat_id: staff(), text: orderText(o), parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard(o) } };
    try {
      if (o.staffMsgId) await tg('editMessageText', { ...body, message_id: o.staffMsgId });
      else { const m = await tg('sendMessage', body); o.staffMsgId = m.message_id; save(); }
    } catch (e) { if (!/not modified/.test(e.message)) log.error('staff', e.message); }
  }
  function customerChat(o) {
    return o.customerChat || (o.user && db.users[o.user]?.chat) || null;
  }
  async function notifyCustomer(o, extra = '') {
    const chat = customerChat(o);
    if (!chat) return;
    try {
      await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML',
        text: `<b>Заказ № ${o.no}</b>\n${CUSTOMER_TEXT[o.status]}${extra ? '\n' + extra : ''}` });
    } catch (e) { log.error('customer', e.message); }
  }
  function settleLoyalty(o) {
    const u = o.user && db.users[o.user];
    if (!u) return '';
    if (o.status === 'cancel' && o.bonusUsed && !o.bonusRefunded) {
      o.bonusRefunded = true; bonus(u, o.bonusUsed, 'Возврат бонусов за отменённый заказ', o.no);
      return `Списанные бонусы (${o.bonusUsed}) вернули на счёт.`;
    }
    if (o.status === 'done' && !o.cashback) {
      const paidGoods = (o.fact != null ? o.fact : o.goods) - (o.bonusUsed || 0);
      const lvl = levelOf(u.spent);
      o.cashback = Math.floor(Math.max(0, paidGoods) * lvl.rate);
      u.spent += Math.max(0, paidGoods);
      bonus(u, o.cashback, `Кешбэк ${Math.round(lvl.rate * 100)}% за заказ`, o.no);
      const L = levelOf(u.spent);
      return `Начислили ${o.cashback} бонусов. На счёте: ${u.bonus}.` + (L.name !== lvl.name ? ` Новый уровень: ${L.name}!` : '');
    }
    return '';
  }
  async function setStatus(o, status, by, text, extra) {
    o.status = status;
    o.history.push({ at: iso(), text: `${text}${by ? ' — ' + by : ''}` });
    const loyal = settleLoyalty(o);
    save();
    await renderStaff(o);
    await notifyCustomer(o, [extra, loyal].filter(Boolean).join('\n'));
  }

  const NEXT = { paid: ['new', 'claimed'], cancel: ['new', 'claimed', 'paid', 'work', 'packed'], work: ['paid'], weigh: ['work'], packed: ['work'], road: ['packed'], done: ['packed', 'road'] };
  async function onCallback(q) {
    const [action, no] = String(q.data || '').split(':');
    const o = db.orders[no];
    const chat = String(q.message?.chat?.id || '');
    if (!o || !staff() || chat !== staff()) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа' }).catch(() => {});
    if (!NEXT[action] || !NEXT[action].includes(o.status))
      return tg('answerCallbackQuery', { callback_query_id: q.id, text: `Статус уже: ${ST[o.status].t}` }).catch(() => {});
    const by = who(q.from);
    await tg('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    if (action === 'paid') return setStatus(o, 'paid', by, `оплата ${rub(o.total)} подтверждена`);
    if (action === 'cancel') return setStatus(o, 'cancel', by, 'заказ отменён');
    if (action === 'work') return setStatus(o, 'work', by, 'взял в работу');
    if (action === 'packed') return setStatus(o, 'packed', by, 'собран, вес как в заказе', o.pickup ? `Ждём вас: ${C.pickupAddr}.` : 'Скоро передадим курьеру.');
    if (action === 'road') return setStatus(o, 'road', by, 'передан курьеру');
    if (action === 'done') return setStatus(o, 'done', by, o.pickup ? 'выдан покупателю' : 'доставлен');
    if (action === 'weigh') {
      const m = await tg('sendMessage', { chat_id: staff(), text: `Заказ № ${o.no}: ответьте на это сообщение фактической суммой товаров в рублях (без доставки). Сейчас в заказе ${rub(o.goods)}.`,
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Например, 5240' }, reply_to_message_id: o.staffMsgId });
      db.pending[m.message_id] = { no: o.no, by };
      save();
    }
  }

  async function saveQr(m) {
    const f = m.photo ? m.photo[m.photo.length - 1] : m.document && /^image\/(png|jpeg)$/.test(m.document.mime_type || '') ? m.document : null;
    if (!f) return tg('sendMessage', { chat_id: staff(), text: 'Пришлите QR-код картинкой (фото или файл PNG/JPG) с подписью /qr' });
    if (f.file_size > 1e6) return tg('sendMessage', { chat_id: staff(), text: 'Картинка слишком большая, нужна меньше 1 МБ.' });
    const file = await tg('getFile', { file_id: f.file_id });
    const r = await fetch(`${C.api}/file/bot${C.token}/${file.file_path}`);
    if (!r.ok) throw new Error('getFile download ' + r.status);
    const bytes = Buffer.from(await r.arrayBuffer());
    const type = /\.png$/i.test(file.file_path) || m.document?.mime_type === 'image/png' ? 'image/png' : 'image/jpeg';
    db.qr = { b64: bytes.toString('base64'), type, at: iso() }; save();
    return tg('sendMessage', { chat_id: staff(), text: '✅ QR-код для оплаты сохранён. Покупатели увидят его при оформлении заказа.' });
  }

  const removeKb = { remove_keyboard: true };
  async function onMessage(m) {
    const chat = String(m.chat.id);
    const text = (m.text || m.caption || '').trim();
    if (/^\/id(@\w+)?$/.test(text)) return tg('sendMessage', { chat_id: chat, text: `ID этого чата: ${chat}` });

    // привязка рабочего чата: первая группа, где написали /staff
    if (/^\/staff(@\w+)?$/.test(text) && m.chat.type !== 'private') {
      if (staff() && staff() !== chat) return tg('sendMessage', { chat_id: chat, text: 'Рабочий чат уже назначен.' });
      if (!staff()) { db.staffChat = chat; save(); }
      return tg('sendMessage', { chat_id: chat, text: 'Готово: это рабочий чат лавки. Сюда будут приходить заказы.\n\nДальше: отправьте сюда картинку QR-кода для оплаты с подписью /qr\n\nКоманды: /orders /today /client /help' });
    }

    // weight reply in staff chat
    const p = m.reply_to_message && db.pending[m.reply_to_message.message_id];
    if (p && chat === staff()) {
      const o = db.orders[p.no];
      const v = parseInt(text.replace(/[^\d]/g, ''), 10);
      if (!o || o.status !== 'work') return;
      if (!v || v < 1) return tg('sendMessage', { chat_id: chat, text: 'Нужна сумма числом, например 5240', reply_to_message_id: m.message_id });
      delete db.pending[m.reply_to_message.message_id];
      o.fact = v;
      const d = o.goods - v;
      const extra = `Фактическая сумма после взвешивания: ${rub(v)}. ` + (d > 0 ? `Разницу ${rub(d)} вернём на карту, с которой была оплата.` : d < 0 ? `Доплата ${rub(-d)}, менеджер свяжется с вами.` : 'Вес совпал с заказом.');
      return setStatus(o, 'packed', who(m.from), `взвешено ${rub(v)}`, extra);
    }

    if (staff() && chat === staff()) {
      if (/^\/qr(@\w+)?\b/.test(text)) return saveQr(m);
      if (/^\/today/.test(text)) return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: summary(day(now())) });
      if (/^\/orders/.test(text)) return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: openOrders() });
      const cm = text.match(/^\/client(?:@\w+)?\s+(.+)/);
      if (cm) return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: clientCard(cm[1]) });
      if (/^\/help|^\/start/.test(text)) return tg('sendMessage', { chat_id: chat, text: 'Команды:\n/orders — открытые заказы\n/today — итоги дня\n/client +79001234567 — бонусы и заказы покупателя\n/qr — с картинкой: сменить QR-код для оплаты\n/id — ID чата' });
      return;
    }
    if (m.chat.type !== 'private') return;

    // shared contact: confirms the phone number belongs to this Telegram user
    if (m.contact) {
      if (String(m.contact.user_id) !== String(m.from?.id))
        return tg('sendMessage', { chat_id: chat, text: 'Отправьте, пожалуйста, свой номер кнопкой «Поделиться номером».' });
      const phone = normPhone(m.contact.phone_number);
      if (!phone) return tg('sendMessage', { chat_id: chat, text: 'Не удалось распознать номер.', reply_markup: removeKb });
      const entry = Object.entries(db.logins).filter(([, l]) => l.chat === chat && !l.confirmed && l.exp > Date.now()).sort((a, b) => b[1].exp - a[1].exp)[0];
      if (entry && entry[1].phone && entry[1].phone !== phone)
        return tg('sendMessage', { chat_id: chat, text: `Номер в Telegram (${maskPhone(phone)}) не совпадает с номером, который вы ввели на сайте. Проверьте номер и попробуйте снова.`, reply_markup: removeKb });
      for (const u of Object.values(db.users)) if (u.chat === chat && u.phone !== phone) u.chat = null;
      const u = getUser(phone, true);
      u.chat = chat;
      if (entry?.[1].consentAt && !u.consentAt) u.consentAt = entry[1].consentAt;
      if (!u.name) u.name = str(m.from?.first_name, 60);
      if (entry) entry[1].confirmed = phone;
      save();
      return tg('sendMessage', { chat_id: chat, reply_markup: removeKb, text: entry
        ? 'Номер подтверждён, вход выполнен. Вернитесь на сайт.\nДальше коды для входа будут приходить сюда.'
        : 'Номер подтверждён. Коды для входа на сайт и статусы заказов будут приходить сюда.' });
    }

    const lg = text.match(/^\/start\s+login_([a-f0-9]{16,64})/);
    if (lg) {
      const l = db.logins[lg[1]];
      if (!l || l.exp < Date.now() || l.confirmed) return tg('sendMessage', { chat_id: chat, text: 'Ссылка для входа устарела. Запросите новую на сайте.' });
      l.chat = chat; save();
      return tg('sendMessage', { chat_id: chat, text: `Чтобы войти на сайт «${C.shop}», подтвердите номер телефона кнопкой ниже.`,
        reply_markup: { keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], one_time_keyboard: true, resize_keyboard: true } });
    }
    const mm = text.match(/^\/start\s+o(\d+)_([a-f0-9]+)/);
    if (mm) {
      const o = db.orders[mm[1]];
      if (!o || o.token !== mm[2]) return tg('sendMessage', { chat_id: chat, text: 'Заказ не найден. Позвоните нам: ' + C.phone });
      o.customerChat = chat; save();
      return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: `Здравствуйте, ${esc(o.customer.name)}!\nБудем присылать сюда статус <b>заказа № ${o.no}</b>.\n\nСейчас: ${CUSTOMER_TEXT[o.status]}` });
    }
    const linked = Object.values(db.users).find(u => u.chat === chat);
    if (/^\/bonus/.test(text) && linked) {
      const L = levelOf(linked.spent);
      return tg('sendMessage', { chat_id: chat, text: `На счёте ${linked.bonus} бонусов. Уровень ${L.name}, кешбэк ${Math.round(L.rate * 100)}%.` });
    }
    return tg('sendMessage', { chat_id: chat, text: `Это бот лавки «${C.shop}». Заказ можно оформить на сайте, вопросы — по телефону ${C.phone}.${linked ? '\n/bonus — баланс бонусов' : ''}` });
  }

  function summary(d) {
    const list = Object.values(db.orders).filter(o => day(o.createdAt) === d);
    const by = {}; list.forEach(o => (by[o.status] = (by[o.status] || 0) + 1));
    const paid = list.filter(o => ['paid', 'work', 'packed', 'road', 'done'].includes(o.status));
    const sum = paid.reduce((s, o) => s + (o.fact != null ? o.fact + o.delivery - (o.bonusUsed || 0) : o.total), 0);
    return [`<b>Итоги ${d}</b>`, `Заказов: ${list.length}, оплачено: ${paid.length}`, `Выручка: ${rub(sum)}`, '',
      ...Object.entries(by).map(([k, v]) => `${ST[k].e} ${ST[k].t}: ${v}`)].join('\n');
  }
  function openOrders() {
    const list = Object.values(db.orders).filter(o => !['done', 'cancel'].includes(o.status));
    if (!list.length) return 'Открытых заказов нет.';
    return '<b>Открытые заказы</b>\n' + list.map(o => `${ST[o.status].e} № ${o.no} · ${esc(o.customer.name)} · ${rub(o.total)} · ${esc(o.date)} ${esc(o.time)}`).join('\n');
  }
  function clientCard(q) {
    const phone = normPhone(q);
    const u = phone && db.users[phone];
    if (!u) return 'Покупатель не найден.';
    const L = levelOf(u.spent);
    const orders = Object.values(db.orders).filter(o => o.user === phone);
    return [`<b>${esc(u.name || 'Без имени')}</b>, ${phone}`, `Уровень: ${L.name} (${Math.round(L.rate * 100)}%)`, `Бонусы: ${u.bonus}`,
      `Покупок на ${rub(u.spent)}, заказов: ${orders.length}`, u.birthday ? `День рождения: ${u.birthday}` : ''].filter(Boolean).join('\n');
  }

  /** Одно обновление от Telegram (из getUpdates или вебхука). Повторы отбрасываются. */
  async function onUpdate(u) {
    if (typeof u.update_id === 'number') {
      if (u.update_id < (db.offset || 0)) return;
      db.offset = u.update_id + 1; save();
    }
    try {
      if (u.callback_query) await onCallback(u.callback_query);
      else if (u.message) await onMessage(u.message);
    } catch (e) { log.error('update', e.message); }
  }

  /** Раз в минуту: итоги дня, бонусы на день рождения, уборка. */
  async function daily() {
    const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: C.tz });
    const d = day(now());
    if (staff() && t >= C.summaryAt && db.lastSummary !== d) {
      db.lastSummary = d; save();
      await tg('sendMessage', { chat_id: staff(), parse_mode: 'HTML', text: summary(d) }).catch(e => log.error('summary', e.message));
    }
    if (db.lastBirthday !== d) {
      db.lastBirthday = d;
      const [dd, mm, yy] = d.split('.');
      for (const u of Object.values(db.users)) {
        if (!u.birthday || C.birthdayBonus <= 0) continue;
        const [bd, bm] = u.birthday.split('.');
        if (bd === dd && bm === mm && u.birthdayYear !== yy) {
          u.birthdayYear = yy;
          bonus(u, C.birthdayBonus, 'Подарок на день рождения');
          if (u.chat) await tg('sendMessage', { chat_id: u.chat, text: `С днём рождения! Дарим ${C.birthdayBonus} бонусов на стейк к праздничному столу.` }).catch(() => {});
        }
      }
      for (const [k, l] of Object.entries(db.logins)) if (l.exp < Date.now() - 3600e3) delete db.logins[k];
      for (const [k, s] of Object.entries(db.sessions)) if (Date.now() - new Date(s.seen).getTime() > 90 * 864e5) delete db.sessions[k];
      save();
    }
  }

  /* ---------- auth ---------- */
  const LIMITS = new Map();
  function hit(key, max, windowMs) {
    const t = Date.now(), a = (LIMITS.get(key) || []).filter(x => t - x < windowMs);
    a.push(t); LIMITS.set(key, a); return a.length > max;
  }
  async function sendSms(phone, text) {
    if (C.sms.provider === 'smsru') {
      const u = new URL('https://sms.ru/sms/send');
      u.search = new URLSearchParams({ api_id: C.sms.key, to: phone.replace('+', ''), msg: text, json: '1', ...(C.sms.from ? { from: C.sms.from } : {}) });
      const j = await fetch(u).then(r => r.json());
      if (j.status !== 'OK') throw new Error('SMS не отправлено');
      return true;
    }
    return false;
  }
  async function authStart(body, ip) {
    const phone = normPhone(body.phone);
    if (!phone) throw httpErr(400, 'Введите номер телефона в формате +7 900 000-00-00');
    if (body.consent !== true) throw httpErr(400, 'Подтвердите согласие на обработку персональных данных');
    if (hit('ip:' + ip, 20, 3600e3)) throw httpErr(429, 'Слишком много попыток. Попробуйте через час.');
    if (hit('ph:' + phone, 5, 3600e3)) throw httpErr(429, 'Слишком много запросов кода на этот номер. Попробуйте через час.');
    const nonce = crypto.randomBytes(16).toString('hex');
    const u = db.users[phone];
    const l = { phone, exp: Date.now() + 10 * 60e3, attempts: 0, code: null, chat: null, confirmed: null, consentAt: iso() };
    db.logins[nonce] = l;
    if (u?.chat) {
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      l.code = sha(nonce + code); l.exp = Date.now() + 5 * 60e3;
      save();
      await tg('sendMessage', { chat_id: u.chat, parse_mode: 'HTML', text: `Код для входа на сайт «${esc(C.shop)}»: <b>${code}</b>\nДействует 5 минут. Никому его не сообщайте — сотрудники лавки код не спрашивают.` });
      return { nonce, method: 'telegram_code', hint: 'Код отправлен в Telegram от бота лавки.' };
    }
    if (C.sms.provider) {
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      l.code = sha(nonce + code); l.exp = Date.now() + 5 * 60e3;
      save();
      await sendSms(phone, `Код для входа: ${code}. Никому его не сообщайте.`);
      return { nonce, method: 'sms_code', hint: 'Код отправлен по SMS.' };
    }
    save();
    if (!ME) await init();
    if (!ME) throw httpErr(503, 'Вход временно недоступен. Позвоните нам: ' + C.phone);
    return { nonce, method: 'telegram_link', link: `https://t.me/${ME.username}?start=login_${nonce}`,
      hint: 'Откройте бота и подтвердите номер кнопкой «Поделиться номером». Это нужно один раз.' };
  }
  // Сессия: токен уходит и в HttpOnly-cookie (если сайт и сервер на одном домене),
  // и в ответе — сайт хранит его и шлёт в заголовке Authorization (нужно, когда домены разные: Safari блокирует чужие cookie).
  function newSession(out, phone, ua) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.sessions[sha(token)] = { phone, created: iso(), seen: iso(), ua: str(ua, 120) };
    save();
    out.cookie = cookie('sid', token, 90 * 86400);
    return token;
  }
  function cookie(name, val, maxAge) {
    return [`${name}=${val}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAge}`, C.cookieSecure ? 'Secure' : '', C.cookieSecure ? 'SameSite=None' : 'SameSite=Lax',
      C.cookieDomain ? `Domain=${C.cookieDomain}` : ''].filter(Boolean).join('; ');
  }
  function authVerify(body, out, ua) {
    const l = db.logins[str(body.nonce, 64)];
    if (!l || l.exp < Date.now() || !l.code) throw httpErr(400, 'Код устарел. Запросите новый.');
    if (l.attempts >= 5) throw httpErr(429, 'Слишком много неверных попыток. Запросите новый код.');
    l.attempts++;
    const code = String(body.code || '').replace(/\D/g, '');
    const ok = code.length === 6 && crypto.timingSafeEqual(Buffer.from(sha(str(body.nonce, 64) + code)), Buffer.from(l.code));
    if (!ok) { save(); throw httpErr(400, `Неверный код. Осталось попыток: ${5 - l.attempts}.`); }
    delete db.logins[str(body.nonce, 64)];
    const nu = getUser(l.phone, true);
    if (!nu.consentAt) { nu.consentAt = l.consentAt || iso(); save(); }
    return { ok: true, token: newSession(out, l.phone, ua) };
  }
  function authPoll(body, out, ua) {
    const key = str(body.nonce, 64), l = db.logins[key];
    if (!l || l.exp < Date.now()) throw httpErr(400, 'Ссылка устарела. Начните вход заново.');
    if (!l.confirmed) return { ok: false, waiting: true };
    delete db.logins[key];
    return { ok: true, token: newSession(out, l.confirmed, ua) };
  }
  function sessionOf(req) {
    const b = (req.headers.authorization || '').match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/);
    const m = b || (req.headers.cookie || '').match(/(?:^|;\s*)sid=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const h = sha(m[1]), s = db.sessions[h];
    if (!s || !db.users[s.phone]) return null;
    if (Date.now() - new Date(s.seen).getTime() > 3600e3) { s.seen = iso(); save(); }
    return { hash: h, s, user: db.users[s.phone] };
  }

  /* ---------- account API ---------- */
  const STATUS_PUBLIC = { new: 'Ждёт оплаты', claimed: 'Проверяем оплату', paid: 'Оплачен', work: 'В работе', packed: 'Собран', road: 'В пути', done: 'Выполнен', cancel: 'Отменён' };
  function me(sess) {
    const u = sess.user, L = levelOf(u.spent);
    const orders = Object.values(db.orders).filter(o => o.user === u.phone).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    return {
      phone: u.phone, name: u.name, birthday: u.birthday, note: u.note, addresses: u.addresses, telegram: !!u.chat,
      bonus: u.bonus, spent: u.spent, level: L, levels: C.levels, maxBonusShare: C.maxBonusShare,
      ledger: u.ledger.slice(0, 30),
      orders: orders.map(o => ({ no: o.no, at: o.createdAt, status: o.status, statusText: STATUS_PUBLIC[o.status], total: o.total, bonusUsed: o.bonusUsed || 0, cashback: o.cashback || 0,
        items: o.items.map(({ id, name, qty, q }) => ({ id, name, qty, q })), pickup: o.pickup, addr: o.addr, payable: o.status === 'new' })),
      sessions: Object.entries(db.sessions).filter(([, s]) => s.phone === u.phone).map(([h, s]) => ({ id: h.slice(0, 8), current: h === sess.hash, created: s.created, seen: s.seen, ua: s.ua })),
    };
  }
  function updateMe(sess, b) {
    const u = sess.user;
    if (b.name != null) u.name = str(b.name, 60);
    if (b.note != null) u.note = str(b.note, 300);
    if (b.birthday && !u.birthday) {
      const m = String(b.birthday).match(/^(\d{2})\.(\d{2})$/);
      if (!m || +m[1] < 1 || +m[1] > 31 || +m[2] < 1 || +m[2] > 12) throw httpErr(400, 'Дата рождения в формате ДД.ММ');
      u.birthday = b.birthday;
    }
    if (Array.isArray(b.addresses)) u.addresses = b.addresses.slice(0, 5).map(a => str(a, 200)).filter(Boolean);
    save();
  }

  /* ---------- orders ---------- */
  function httpErr(code, msg) { const e = new Error(msg); e.code = code; return e; }
  async function createOrder(b, sess) {
    const name = str(b.name, 60), tel = str(b.tel, 30), pickup = !!b.pickup;
    if (!name || tel.replace(/\D/g, '').length < 10) throw httpErr(400, 'Укажите имя и телефон');
    if (!pickup && !str(b.addr, 200)) throw httpErr(400, 'Укажите адрес доставки');
    if (b.consent !== true) throw httpErr(400, 'Подтвердите согласие на обработку персональных данных');
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 60) throw httpErr(400, 'Корзина пуста');
    const items = [];
    for (const it of b.items) {
      const p = CATALOG[it.id], q = +it.q;
      if (!p) throw httpErr(400, 'Товар не найден: ' + str(it.id, 40));
      if (!(q > 0 && q <= 50)) throw httpErr(400, 'Неверное количество: ' + p.name);
      const qq = p.unit === 'kg' ? Math.round(q * 100) / 100 : Math.round(q);
      items.push({ id: p.id, name: p.name, qty: qLabel(p, qq), q: qq, sum: Math.round(lineSum(p, qq)) });
    }
    const goods = items.reduce((s, i) => s + i.sum, 0);
    const delivery = pickup || goods >= C.freeFrom ? 0 : C.deliveryFee;
    let bonusUsed = 0;
    const u = sess?.user;
    if (u && +b.useBonus > 0) {
      bonusUsed = Math.min(Math.floor(+b.useBonus), u.bonus, Math.floor(goods * C.maxBonusShare));
    }
    const no = String(++db.seq);
    const o = { no, token: crypto.randomBytes(6).toString('hex'), createdAt: iso(), consentAt: iso(), status: 'new',
      customer: { name, tel }, user: u?.phone || null, pickup, addr: pickup ? '' : str(b.addr, 200), date: str(b.date, 40), time: str(b.time, 40), note: str(b.note, 400),
      items, goods, delivery, bonusUsed, total: goods + delivery - bonusUsed, fact: null, staffMsgId: null, customerChat: null, cashback: 0,
      history: [{ at: iso(), text: 'заказ с сайта' + (u ? ' (личный кабинет)' : '') }] };
    if (bonusUsed) bonus(u, -bonusUsed, 'Оплата бонусами', no);
    if (u && !pickup && o.addr && !u.addresses.includes(o.addr)) u.addresses = [o.addr, ...u.addresses].slice(0, 5);
    if (u && !u.name) u.name = name;
    db.orders[no] = o; save();
    await renderStaff(o);
    return o;
  }
  function qr() {
    if (db.qr) return { bytes: Buffer.from(db.qr.b64, 'base64'), type: db.qr.type };
    return opts.readQrFile ? opts.readQrFile() : null;
  }
  const publicOrder = o => ({ no: o.no, token: o.token, status: o.status, statusText: CUSTOMER_TEXT[o.status], total: o.total, goods: o.goods, delivery: o.delivery, bonusUsed: o.bonusUsed || 0, fact: o.fact,
    items: o.items.map(({ name, qty, sum }) => ({ name, qty, sum })),
    payQr: db.qr || (opts.readQrFile && opts.readQrFile()) ? '/pay-qr' + (db.qr ? '?v=' + Date.parse(db.qr.at) : '') : null, payNote: C.payNote,
    botLink: customerChat(o) ? null : ME ? `https://t.me/${ME.username}?start=o${o.no}_${o.token}` : null,
    telegramLinked: !!customerChat(o) });

  /* ---------- HTTP ---------- */
  function corsHeaders(req) {
    const o = req.headers.origin;
    const allow = o && (C.origins.includes('*') || C.origins.includes(o)) ? o : C.origins[0] === '*' ? '*' : C.origins[0];
    return { 'access-control-allow-origin': allow, 'access-control-allow-credentials': 'true', vary: 'origin',
      'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-max-age': '600' };
  }
  function originOk(req) {
    const o = req.headers.origin;
    return !o || C.origins.includes('*') || C.origins.includes(o);
  }
  function parseBody(req) {
    if (req.method !== 'POST') return {};
    const s = req.bodyText || '';
    if (s.length > 50e3) throw httpErr(413, 'Слишком большой запрос');
    try { return JSON.parse(s || '{}'); } catch (e) { throw httpErr(400, 'Неверный запрос'); }
  }

  /**
   * req: { method, path, query: URLSearchParams, headers: {origin, cookie, authorization, 'user-agent'}, ip, bodyText }
   * returns { status, headers, body }  (body: string | Buffer)
   */
  async function handle(req) {
    const out = { cookie: null };
    const reply = (status, obj, type = 'application/json') => {
      const headers = { 'content-type': type + (type.startsWith('image/') ? '' : '; charset=utf-8'), 'cache-control': type.startsWith('image/') ? 'public, max-age=300' : 'no-store', ...corsHeaders(req) };
      if (out.cookie) headers['set-cookie'] = out.cookie;
      return { status, headers, body: typeof obj === 'string' || (obj && obj.byteLength !== undefined) ? obj : JSON.stringify(obj) };
    };
    const P = req.path, M = req.method, ip = req.ip || '';
    try {
      if (M === 'OPTIONS') return reply(204, '');
      if (M === 'POST' && !originOk(req)) throw httpErr(403, 'Запрос с чужого сайта');
      if (P === '/health' || P === '/') return reply(200, { ok: true, bot: ME?.username || null, staffChat: !!staff(), payQr: !!qr(), orders: Object.keys(db.orders).length, users: Object.keys(db.users).length });
      if (P === '/pay-qr') { const q = qr(); return q ? reply(200, q.bytes, q.type) : reply(404, { error: 'no qr' }); }
      if (P === '/api/auth/start' && M === 'POST') return reply(200, await authStart(parseBody(req), ip));
      if (P === '/api/auth/verify' && M === 'POST') {
        if (hit('vip:' + ip, 30, 3600e3)) throw httpErr(429, 'Слишком много попыток. Попробуйте через час.');
        return reply(200, authVerify(parseBody(req), out, req.headers['user-agent']));
      }
      if (P === '/api/auth/poll' && M === 'POST') return reply(200, authPoll(parseBody(req), out, req.headers['user-agent']));
      if (P === '/api/auth/logout' && M === 'POST') {
        const s = sessionOf(req), b = parseBody(req);
        if (s) {
          if (b.all) { for (const [h, x] of Object.entries(db.sessions)) if (x.phone === s.s.phone) delete db.sessions[h]; }
          else delete db.sessions[s.hash];
          save();
        }
        out.cookie = cookie('sid', '', 0);
        return reply(200, { ok: true });
      }
      if (P === '/api/me') {
        const s = sessionOf(req);
        if (!s) return reply(401, { error: 'Войдите в личный кабинет' });
        if (M === 'POST') updateMe(s, parseBody(req));
        return reply(200, me(s));
      }
      if (P === '/api/orders' && M === 'POST') {
        if (hit('ord:' + ip, 12, 10 * 60e3)) throw httpErr(429, 'Слишком много заказов, позвоните нам: ' + C.phone);
        const o = await createOrder(parseBody(req), sessionOf(req));
        return reply(201, publicOrder(o));
      }
      const m = P.match(/^\/api\/orders\/(\d+)(\/paid)?$/);
      if (m) {
        const o = db.orders[m[1]];
        const body = parseBody(req);
        const token = body.token || (req.query && req.query.get('token'));
        const s = sessionOf(req);
        if (!o || (o.token !== token && !(s && o.user === s.user.phone))) return reply(404, { error: 'Заказ не найден' });
        if (m[2] && M === 'POST' && o.status === 'new') {
          o.status = 'claimed'; o.history.push({ at: iso(), text: 'покупатель сообщил об оплате' }); save();
          await renderStaff(o);
          if (staff()) await tg('sendMessage', { chat_id: staff(), text: `💳 Заказ № ${o.no}: покупатель сообщил об оплате ${rub(o.total)}. Проверьте поступление.`, reply_to_message_id: o.staffMsgId }).catch(() => {});
        }
        return reply(200, publicOrder(o));
      }
      return reply(404, { error: 'not found' });
    } catch (e) {
      if (!e.code) log.error(e);
      return reply(e.code || 400, { error: e.message || 'Ошибка' });
    }
  }

  return { handle, onUpdate, daily, init, tg, sha, get me() { return ME; }, staff };
}

module.exports = { createShop, configFromEnv, emptyDb };
