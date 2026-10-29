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
    shops: JSON.parse(E.SHOPS || 'null') || DEFAULT_SHOPS,
    pickupAddr: E.PICKUP_ADDRESS || 'Таллинская, 7, ТЦ «Московская ярмарка», 1 этаж',
    deliveryFee: +(E.DELIVERY_FEE || 500),
    freeFrom: +(E.FREE_DELIVERY_FROM || 5000),
    payCard: (E.PAY_CARD || '').replace(/\D/g, ''), payCardName: E.PAY_CARD_NAME || '', payPhone: E.PAY_PHONE || '',
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
    siteUrl: E.SITE_URL || 'http://lidmasterapp.ru/myaso-kubani/',
    mapUrl: E.MAP_URL || 'https://yandex.ru/maps/org/myaso_kubani_i_steyki/72276710971/',
    hours: E.SHOP_HOURS || 'Вт–Вс, 10:00–20:00',
    whatsapp: E.WHATSAPP_URL || 'https://wa.me/79262443737',
    vk: E.VK_URL || 'https://vk.ru/steykribaykupit',
    adminLogin: (E.ADMIN_LOGIN || 'admin').toLowerCase(),
    adminHash: E.ADMIN_HASH || '',
    welcomePhoto: E.WELCOME_PHOTO != null ? E.WELCOME_PHOTO : (E.SITE_URL || 'http://lidmasterapp.ru/myaso-kubani/') + 'img/hero-ribeye.jpg',
  };
}
// Магазины лавки. Те же id и координаты — в tools/tail.js (SHOPS), держать одинаковыми.
const DEFAULT_SHOPS = [
  { id: 'patriot', name: 'ТЦ «Патриот»', addr: 'ул. Саляма Адиля, 4, ТЦ «Патриот», −1 этаж', lat: 55.7747, lon: 37.4676 },
  { id: 'green', name: 'ЖК «Грин Парк»', addr: 'Сельскохозяйственная ул., 39, ЖК «Грин Парк», между 2 и 3 подъездом', lat: 55.8555, lon: 37.6235 },
  { id: 'slavich', name: 'ТЦ «Славич»', addr: 'бульвар Маршала Рокоссовского, 31, ТЦ «Славич»', lat: 55.8157, lon: 37.7156 },
];
const emptyDb = () => ({ seq: 1000, orders: {}, pending: {}, offset: 0, lastSummary: '', users: {}, sessions: {}, logins: {}, lastBirthday: '',
  secret: '', staffChat: '', qr: null, webhookUrl: '', custWait: {},
  ov: {}, admins: {}, asess: {}, alog: [] });

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
  // Правки из панели управления (цены, наличие, метки) лежат в db.ov и накладываются на каталог.
  for (const k of ['ov', 'admins', 'asess']) if (!db[k] || typeof db[k] !== 'object') db[k] = {};
  if (!Array.isArray(db.alog)) db.alog = [];
  const item = id => { const b = CATALOG[id]; if (!b) return null; const o = db.ov[id]; return o ? Object.assign({}, b, o) : b; };
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
  // Тема форума, из которой пришло текущее сообщение/кнопка: ответы бота идут туда же.
  let curThread = null;
  async function tg(method, body = {}) {
    if (!C.token) throw new Error('нет BOT_TOKEN');
    if (curThread && !body._nt && body.message_thread_id === undefined && /^send/.test(method) && body.chat_id != null && String(body.chat_id) === staff())
      body = { ...body, message_thread_id: curThread };
    const payload = { ...body }; delete payload._nt;
    const r = await fetch(`${C.api}/bot${C.token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({ ok: false, description: 'bad json' }));
    // группа стала супергруппой — у неё новый ID: запоминаем и повторяем
    const mig = j.parameters?.migrate_to_chat_id;
    if (!j.ok && mig && body.chat_id != null && String(body.chat_id) === staff()) {
      db.staffChat = String(mig); C.staffChat = ''; save();
      const nb = { ...body, chat_id: db.staffChat };
      if (nb.reply_to_message_id) { delete nb.reply_to_message_id; }
      return tg(method, nb);
    }
    if (!j.ok && body.message_thread_id && /thread|topic/i.test(j.description || '')) {
      const nb = { ...body, _nt: true }; delete nb.message_thread_id; return tg(method, nb);
    }
    if (!j.ok && /message to be replied not found/i.test(j.description || '') && body.reply_to_message_id) {
      const nb = { ...body }; delete nb.reply_to_message_id; return tg(method, nb);
    }
    if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
    return j.result;
  }
  let ME = null;
  async function init() {
    if (!C.token) { log.error('Нет BOT_TOKEN'); return null; }
    try { ME = await tg('getMe'); } catch (e) { log.error('Telegram недоступен или неверный BOT_TOKEN:', e.message); }
    return ME;
  }
  // Загрузка файла (фото группы) через multipart
  async function tgUpload(method, fields, field, bytes, filename, type) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    fd.append(field, new Blob([bytes], { type }), filename);
    const r = await fetch(`${C.api}/bot${C.token}/${method}`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({ ok: false, description: 'bad json' }));
    if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
    return j.result;
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
  const STATUS_PUBLIC = { new: 'Ждёт оплаты', claimed: 'Проверяем оплату', paid: 'Оплачен', work: 'В работе', packed: 'Собран', road: 'В пути', done: 'Выполнен', cancel: 'Отменён' };
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
  const site = (hash = '') => C.siteUrl + hash;
  const urlBtn = (text, url) => ({ text, url });
  const fmtCard = d => d.replace(/(\d{4})(?=\d)/g, '$1 ');
  const luhn = d => { let s = 0; for (let i = 0; i < d.length; i++) { let x = +d[d.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } s += x; } return s % 10 === 0; };
  const BANKS = ['Сбербанк', 'Т-Банк', 'Альфа-Банк', 'ВТБ', 'Райффайзенбанк', 'Озон Банк', 'Яндекс Банк'];
  const PAID_STATES = ['claimed', 'paid', 'work', 'packed', 'road', 'done'];

  /* ---------- деньги: изменение суммы, возврат, доплата ---------- */
  // Покупатель заплатил o.total (если статус не «new»). o.final — сколько заказ стоит в итоге (после взвешивания или правки).
  function moneyDue(o) {
    if (!PAID_STATES.includes(o.status) && o.status !== 'cancel') return 0;
    if (o.status === 'cancel' && !o.wasPaid) return 0;
    const final = o.status === 'cancel' ? 0 : (o.final != null ? o.final : o.total);
    return o.total - (o.refunded || 0) - final;
  }
  // Пересчитывает возврат/доплату. Возвращает текст для покупателя.
  function settleMoney(o, reason) {
    const due = moneyDue(o);
    if (due > 0) {
      const keep = o.refund && o.refund.status !== 'done' ? o.refund : null;
      o.refund = { amount: due, reason, status: keep && keep.method ? 'ready' : 'ask', method: keep?.method || null, bank: keep?.bank || null, card: keep?.card || null, at: iso() };
      o.extra = 0;
      return `Вернём вам ${rub(due)}.`;
    }
    if (o.refund && o.refund.status !== 'done') o.refund = null;
    o.extra = due < 0 ? -due : 0;
    return due < 0 ? `Нужна доплата ${rub(-due)} — мы свяжемся с вами.` : '';
  }
  function refundLine(o) {
    const r = o.refund;
    if (!r) return '';
    if (r.status === 'done') return `↩️ Возвращено ${rub(r.amount)}${r.method === 'card' ? ` на карту •••• ${r.last4}` : r.bank ? ` по СБП, ${esc(r.bank)}` : ''}`;
    const head = `↩️ <b>Вернуть ${rub(r.amount)}</b>${r.reason ? ` (${esc(r.reason)})` : ''}`;
    if (r.method === 'sbp') return `${head}\n    СБП на <code>${esc(o.customer.tel)}</code> · ${esc(r.bank)}`;
    if (r.method === 'card') return `${head}\n    Карта <code>${fmtCard(r.card)}</code>`;
    return `${head}\n    ${customerChat(o) ? 'ждём реквизиты от покупателя в боте' : 'покупатель без Telegram — уточните по телефону'}`;
  }

  function orderText(o) {
    const s = ST[o.status];
    const L = [];
    L.push(`${s.e} <b>Заказ № ${o.no}</b> · ${esc(s.t)}`);
    L.push('');
    L.push(`👤 ${esc(o.customer.name)} · <code>${esc(o.customer.tel)}</code>${o.user ? ' · кабинет' : ''}`);
    if (shopOf(o)) L.push(`🏬 Магазин: <b>${esc(shopOf(o).name)}</b>`);
    L.push(o.pickup ? `🏪 Самовывоз: ${esc(pickupOf(o))}` : `🚚 ${esc(o.addr)}`);
    L.push(`🕑 ${esc(o.date)}, ${esc(o.time)}`);
    L.push('');
    for (const i of o.items) L.push(`• ${esc(i.name)} × ${esc(i.qty)} — ${rub(i.sum)}`);
    if (o.delivery) L.push(`• Доставка — ${rub(o.delivery)}`);
    if (o.bonusUsed) L.push(`• Списано бонусов — −${rub(o.bonusUsed)}`);
    const paidNow = o.wasPaid || ['paid', 'work', 'packed', 'road', 'done'].includes(o.status);
    L.push(`<b>${paidNow ? 'Оплачено' : 'К оплате'}: ${rub(o.total)}</b>`);
    if (!paidNow && payCard()) L.push(`💳 Ищите перевод на карту с комментарием <b>${o.no}</b>`);
    if (o.note) L.push(`💬 ${esc(o.note)}`);
    if (o.fact != null) L.push(`⚖️ После взвешивания: товары на ${rub(o.fact)}`);
    for (const f of o.fixes || []) L.push(`✏️ Сумма изменена: ${rub(f.from)} → <b>${rub(f.to)}</b>${f.reason ? ` (${esc(f.reason)})` : ''} — ${esc(f.by)}`);
    if (o.final != null && o.final !== o.total) L.push(`🧾 Итог заказа: <b>${rub(o.final)}</b>`);
    if (o.extra) L.push(`💰 <b>Доплата ${rub(o.extra)}</b> — свяжитесь с покупателем`);
    const rl = refundLine(o); if (rl) L.push(rl);
    if (o.history.length) {
      L.push('');
      for (const h of o.history.slice(-8)) L.push(`<i>${hm(h.at)} · ${esc(h.text)}</i>`);
    }
    return L.join('\n');
  }
  function keyboard(o) {
    const b = (text, a) => ({ text, callback_data: `${a}:${o.no}` });
    let rows;
    switch (o.status) {
      case 'new': case 'claimed': rows = [[b('✅ Оплата получена', 'paid')], [b('Отменить заказ', 'cancel')]]; break;
      case 'paid': rows = [[b('🔪 Взять в работу', 'work')], [b('Отменить заказ', 'cancel')]]; break;
      case 'work': rows = [[b('⚖️ Ввести сумму после взвешивания', 'weigh')], [b('📦 Собран, вес как в заказе', 'packed')]]; break;
      case 'packed': rows = [[o.pickup ? b('🤝 Выдан покупателю', 'done') : b('🚚 Передан курьеру', 'road')]]; break;
      case 'road': rows = [[b('✅ Доставлен', 'done')]]; break;
      default: rows = [];
    }
    if (!['done', 'cancel'].includes(o.status)) rows.push([b('✏️ Изменить сумму', 'fix')]);
    if (o.refund && o.refund.status !== 'done') rows.push([b(`↩️ Возврат ${rub(o.refund.amount)} сделан`, 'refunded')]);
    return rows;
  }
  const shopOf = o => C.shops.find(s => s.id === o.shop) || null;
  const topicOf = o => (o.shop && db.topics && db.topics[o.shop]) || null;
  const pickupOf = o => shopOf(o)?.addr || C.pickupAddr;
  async function renderStaff(o) {
    if (!staff()) return;
    const body = { chat_id: staff(), text: orderText(o), parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard(o) } };
    try {
      if (o.staffMsgId && o.staffChat === staff()) {
        try { await tg('editMessageText', { ...body, message_id: o.staffMsgId }); return; }
        catch (e) { if (/not modified/.test(e.message)) return; log.error('staff edit', e.message); }
      }
      const th = topicOf(o);
      const m = await tg('sendMessage', { ...body, chat_id: staff(), ...(th ? { message_thread_id: th } : {}) }); o.staffMsgId = m.message_id; o.staffChat = staff(); save();
    } catch (e) { if (!/not modified/.test(e.message)) log.error('staff', e.message); }
  }
  function customerChat(o) {
    return o.customerChat || (o.user && db.users[o.user]?.chat) || null;
  }
  function progress(o) {
    if (['new', 'claimed', 'cancel'].includes(o.status)) return '';
    const steps = o.pickup ? [['paid', 'Оплачен'], ['work', 'Режем'], ['packed', 'Собран'], ['done', 'Выдан']] : [['paid', 'Оплачен'], ['work', 'Режем'], ['packed', 'Собран'], ['road', 'В пути'], ['done', 'Доставлен']];
    const at = steps.findIndex(s => s[0] === o.status);
    return steps.map((s, i) => (i < at ? '✓ ' : i === at ? '● ' : '○ ') + s[1]).join('  ');
  }
  function customerButtons(o) {
    if (o.status === 'packed' && o.pickup) return [[urlBtn('📍 Как добраться', C.mapUrl)]];
    if (o.status === 'done') return [[urlBtn('🛒 Заказать снова', site('#catalog'))]];
    if (o.status === 'cancel') return [[urlBtn('💬 Написать в WhatsApp', C.whatsapp)]];
    return null;
  }
  async function notifyCustomer(o, extra = '') {
    const chat = customerChat(o);
    if (!chat) return;
    const pr = progress(o);
    const kb = customerButtons(o);
    try {
      await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true,
        text: `<b>Заказ № ${o.no}</b> · ${STATUS_PUBLIC[o.status]}\n${CUSTOMER_TEXT[o.status]}${extra ? '\n' + extra : ''}${pr ? '\n\n' + pr : ''}`,
        ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) });
    } catch (e) { log.error('customer', e.message); }
    await askRefund(o);
  }
  // Спросить у покупателя, куда вернуть деньги
  async function askRefund(o) {
    const r = o.refund, chat = customerChat(o);
    if (!r || r.status !== 'ask' || r.asked || !chat) return;
    r.asked = true; save();
    const b = (text, i) => ({ text, callback_data: `rb:${o.no}:${i}` });
    const rows = [];
    for (let i = 0; i < BANKS.length; i += 2) rows.push(BANKS.slice(i, i + 2).map((n, j) => b(n, i + j)));
    rows.push([b('Другой банк', 'x')], [{ text: '💳 Вернуть на карту', callback_data: `rc:${o.no}` }]);
    await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: { inline_keyboard: rows },
      text: `↩️ <b>Возврат ${rub(r.amount)} по заказу № ${o.no}</b>\nКуда перевести деньги?\n\nПо СБП — на ваш номер <code>${esc(o.customer.tel)}</code>, выберите банк. Или на карту.` }).catch(e => log.error('askRefund', e.message));
  }
  function settleLoyalty(o) {
    const u = o.user && db.users[o.user];
    if (!u) return '';
    if (o.status === 'cancel' && o.bonusUsed && !o.bonusRefunded) {
      o.bonusRefunded = true; bonus(u, o.bonusUsed, 'Возврат бонусов за отменённый заказ', o.no);
      return `Списанные бонусы (${o.bonusUsed}) вернули на счёт.`;
    }
    if (o.status === 'done' && !o.cashback) {
      const paidGoods = o.final != null ? o.final - o.delivery : o.goods - (o.bonusUsed || 0);
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
    if (PAID_STATES.includes(status) && status !== 'claimed') o.wasPaid = true;
    o.status = status;
    o.history.push({ at: iso(), text: `${text}${by ? ' — ' + by : ''}` });
    if (status === 'cancel') { const t = settleMoney(o, 'заказ отменён'); if (o.refund) extra = [extra, t].filter(Boolean).join('\n'); }
    const loyal = settleLoyalty(o);
    save();
    await renderStaff(o);
    await notifyCustomer(o, [extra, loyal].filter(Boolean).join('\n'));
  }

  const NEXT = { paid: ['new', 'claimed'], cancel: ['new', 'claimed', 'paid', 'work', 'packed'], work: ['paid'], weigh: ['work'], packed: ['work'], road: ['packed'], done: ['packed', 'road'],
    fix: ['new', 'claimed', 'paid', 'work', 'packed', 'road'] };
  async function onCallback(q) {
    const [action, no, arg] = String(q.data || '').split(':');
    const o = db.orders[no];
    const chat = String(q.message?.chat?.id || '');
    const answer = text => tg('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(() => {});

    // ---- кнопки покупателя: куда вернуть деньги
    if (action === 'rb' || action === 'rc') {
      if (!o || !o.refund || chat !== String(customerChat(o))) return answer('Заказ не найден');
      if (o.refund.status === 'done') return answer('Деньги уже вернули');
      await answer();
      if (action === 'rc') {
        db.custWait[chat] = { no, kind: 'card', at: Date.now() }; save();
        return tg('sendMessage', { chat_id: chat, text: 'Пришлите номер карты одним сообщением — только цифры, 16–19 знаков.\nПосле возврата номер удалим.',
          reply_markup: { force_reply: true, input_field_placeholder: '2200 0000 0000 0000' } });
      }
      if (arg === 'x') {
        db.custWait[chat] = { no, kind: 'bank', at: Date.now() }; save();
        return tg('sendMessage', { chat_id: chat, text: 'Напишите название банка, привязанного к номеру ' + o.customer.tel, reply_markup: { force_reply: true, input_field_placeholder: 'Например, Газпромбанк' } });
      }
      const bank = BANKS[+arg];
      if (!bank) return;
      return refundChosen(o, chat, { method: 'sbp', bank });
    }

    if (!o || !staff() || chat !== staff()) return answer('Нет доступа');
    if (action === 'refunded') {
      if (!o.refund || o.refund.status === 'done') return answer('Возврат уже отмечен');
      await answer();
      const r = o.refund, by = who(q.from);
      o.refunded = (o.refunded || 0) + r.amount;
      if (r.card) { r.last4 = r.card.slice(-4); delete r.card; }
      r.status = 'done'; r.doneAt = iso();
      o.history.push({ at: iso(), text: `возврат ${rub(r.amount)} сделан — ${by}` });
      save();
      await renderStaff(o);
      const chatC = customerChat(o);
      if (chatC) await tg('sendMessage', { chat_id: chatC, parse_mode: 'HTML', text: `↩️ <b>Заказ № ${o.no}</b>\nВернули ${rub(r.amount)}${r.method === 'card' ? ` на карту •••• ${r.last4}` : r.bank ? ` по СБП в ${esc(r.bank)}` : ''}. Деньги обычно приходят в течение нескольких минут, иногда до суток.` }).catch(() => {});
      return;
    }
    if (!NEXT[action] || !NEXT[action].includes(o.status)) return answer(`Статус уже: ${ST[o.status].t}`);
    const by = who(q.from);
    await answer();
    if (action === 'paid') return setStatus(o, 'paid', by, `оплата ${rub(o.total)} подтверждена`);
    if (action === 'cancel') return setStatus(o, 'cancel', by, 'заказ отменён');
    if (action === 'work') return setStatus(o, 'work', by, 'взял в работу');
    if (action === 'packed') return setStatus(o, 'packed', by, 'собран, вес как в заказе', o.pickup ? `Ждём вас: ${pickupOf(o)}.` : 'Скоро передадим курьеру.');
    if (action === 'road') return setStatus(o, 'road', by, 'передан курьеру');
    if (action === 'done') return setStatus(o, 'done', by, o.pickup ? 'выдан покупателю' : 'доставлен');
    if (action === 'weigh' || action === 'fix') {
      const text = action === 'weigh'
        ? `⚖️ Заказ № ${o.no}: ответьте на это сообщение фактической суммой товаров в рублях (без доставки). Сейчас в заказе ${rub(o.goods)}.`
        : `✏️ Заказ № ${o.no}: ответьте на это сообщение новой суммой к оплате (вместе с доставкой). Можно добавить причину через пробел.\nСейчас: ${rub(o.final != null ? o.final : o.total)}.\n\nНапример: 4800 ошиблись в цене рибая`;
      const m = await tg('sendMessage', { chat_id: staff(), ...(topicOf(o) ? { message_thread_id: topicOf(o) } : {}), text,
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: action === 'weigh' ? 'Например, 5240' : 'Например, 4800 ошиблись в цене' }, reply_to_message_id: o.staffMsgId });
      db.pending[m.message_id] = { no: o.no, by, kind: action };
      save();
    }
  }

  async function refundChosen(o, chat, how) {
    Object.assign(o.refund, how, { status: 'ready' });
    o.history.push({ at: iso(), text: how.method === 'card' ? `покупатель указал карту •••• ${how.card.slice(-4)}` : `покупатель выбрал возврат по СБП, ${how.bank}` });
    delete db.custWait[chat];
    save();
    await renderStaff(o);
    if (staff()) await tg('sendMessage', { chat_id: staff(), ...(topicOf(o) ? { message_thread_id: topicOf(o) } : {}), text: `↩️ Заказ № ${o.no}: реквизиты для возврата ${rub(o.refund.amount)} получены.`, reply_to_message_id: o.staffMsgId }).catch(() => {});
    return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: mainKb(chat),
      text: how.method === 'card' ? `Спасибо! Вернём ${rub(o.refund.amount)} на карту •••• ${how.card.slice(-4)}. Сообщим, когда деньги уйдут.` : `Спасибо! Вернём ${rub(o.refund.amount)} по СБП на номер ${esc(o.customer.tel)} в ${esc(how.bank)}. Сообщим, когда деньги уйдут.` });
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

  /* ---------- оформление бота и группы ---------- */
  const BOT_UI = 'ui-2';
  async function setupBot() {
    if (!C.token || db.botUi === BOT_UI) return;
    const P = { type: 'all_private_chats' };
    const steps = [
      ['setMyCommands', { scope: P, commands: [{ command: 'start', description: 'Главное меню' }, { command: 'orders', description: 'Мои заказы' }, { command: 'bonus', description: 'Бонусы' }, { command: 'contacts', description: 'Адрес и контакты' }] }],
      ['setMyCommands', { scope: { type: 'all_group_chats' }, commands: [] }],
      ['setMyShortDescription', { short_description: `Статусы заказов, коды для входа и бонусы лавки «${C.shop}». ${C.phone}` }],
      ['setMyDescription', { description: `Бот лавки «${C.shop}».\n\nМраморная говядина, вагю и фермерское мясо с Кубани. Москва, ${C.pickupAddr}.\n\nЗдесь приходят статусы заказов и коды для входа на сайт, видны бонусы. Нажмите «Старт».` }],
      ['setChatMenuButton', { menu_button: { type: 'commands' } }],
    ];
    for (const [m, b] of steps) await tg(m, b).catch(e => log.error('setupBot', e.message));
    db.botUi = BOT_UI; save();
  }
  const STAFF_GUIDE = () => `📌 <b>Как работать с заказами</b>

1. Заказ с сайта приходит сюда карточкой. 🟡 — ждёт оплаты, 🟠 — покупатель нажал «Я оплатил».
2. Проверьте поступление в банке: в комментарии к переводу покупатель пишет номер заказа. Нашли → <b>✅ Оплата получена</b>.
3. <b>🔪 Взять в работу</b> → нарежьте, взвесьте.
4. Вес другой → <b>⚖️ Ввести сумму после взвешивания</b> и ответьте числом. Бот сам посчитает возврат или доплату.
5. <b>📦 Собран</b> → <b>🚚 Передан курьеру</b> → <b>✅ Доставлен</b> (или <b>🤝 Выдан</b> при самовывозе).

✏️ <b>Изменить сумму</b> — если ошиблись в цене. Ответьте новой суммой к оплате и причиной: <code>4800 ошиблись в цене</code>.
↩️ <b>Возврат</b>: бот спросит покупателя, куда вернуть — банк для СБП или карта. Реквизиты появятся в карточке. Переведите и нажмите <b>Возврат сделан</b> — номер карты сотрётся.

Покупатель получает уведомление о каждом шаге.

<b>Команды</b>
/orders — открытые заказы
/today — итоги дня (сами приходят в ${C.summaryAt})
/client +79001234567 — карточка покупателя
/card — карта для оплаты переводом
/topics — создать темы «Заказы · магазин»
/qr — с картинкой: новый QR для оплаты
/setup — обновить оформление группы`;
  async function setupGroup(chat) {
    const res = [];
    const step = async (label, fn) => { try { await fn(); res.push('✅ ' + label); } catch (e) { res.push('⚠️ ' + label + (/rights|admin|not enough/i.test(e.message) ? ' — нужны права администратора' : ': ' + e.message.slice(0, 80))); } };
    await step('Название', () => tg('setChatTitle', { chat_id: chat, title: `${C.shop.replace(' и стейки', '')} · Заказы` }));
    await step('Описание', () => tg('setChatDescription', { chat_id: chat, description: `Рабочий чат лавки «${C.shop}». Заказы с сайта приходят сюда — кнопки под заказом меняют статус, покупатель получает уведомления. Шпаргалка — в закрепе.` }));
    if (opts.assets?.groupPhoto) await step('Аватар', () => tgUpload('setChatPhoto', { chat_id: chat }, 'photo', opts.assets.groupPhoto, 'group.png', 'image/png'));
    await step('Команды', () => tg('setMyCommands', { scope: { type: 'chat', chat_id: chat }, commands: [
      { command: 'orders', description: 'Открытые заказы' }, { command: 'today', description: 'Итоги дня' }, { command: 'client', description: 'Карточка покупателя: /client +7…' },
      { command: 'card', description: 'Карта для оплаты переводом' }, { command: 'topics', description: 'Темы для магазинов' }, { command: 'qr', description: 'С картинкой — новый QR для оплаты' }, { command: 'setup', description: 'Обновить оформление группы' }] }));
    await step('Шпаргалка в закрепе', async () => {
      const m = await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: STAFF_GUIDE() });
      if (db.guideMsg && db.guideMsg !== m.message_id) await tg('unpinChatMessage', { chat_id: chat, message_id: db.guideMsg }).catch(() => {});
      db.guideMsg = m.message_id; save();
      await tg('pinChatMessage', { chat_id: chat, message_id: m.message_id, disable_notification: true });
    });
    const needAdmin = res.some(r => r.includes('администратора'));
    return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: `<b>Оформление группы</b>\n${res.join('\n')}${needAdmin ? '\n\nСделайте бота администратором (права: изменение профиля группы, закрепление сообщений) и отправьте /setup ещё раз.' : ''}` });
  }

  /* ---------- клиентское меню ---------- */
  const BTN = { order: '🛒 Заказать', orders: '📦 Мои заказы', bonus: '🎁 Бонусы', where: '📍 Адрес и часы', contact: '💬 Связаться', phone: '📱 Подключить номер' };
  const linkedUser = chat => Object.values(db.users).find(u => u.chat === String(chat));
  function mainKb(chat) {
    const rows = [[{ text: BTN.order }, { text: BTN.orders }], [{ text: BTN.bonus }, { text: BTN.where }], [{ text: BTN.contact }]];
    if (!linkedUser(chat)) rows.push([{ text: BTN.phone, request_contact: true }]);
    return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Выберите в меню' };
  }
  async function welcome(chat, m) {
    const linked = linkedUser(chat);
    const name = linked?.name || str(m.from?.first_name, 40);
    const caption = `<b>${esc(C.shop)}</b>\n${name ? `Здравствуйте, ${esc(name)}! ` : ''}Мраморная говядина, вагю и фермерское мясо с Кубани. Режем стейк нужной толщины и привозим по Москве в холоде.\n\nЗдесь будут:\n• статусы ваших заказов\n• коды для входа на сайт\n• бонусы — до 7% с каждого заказа\n\n<a href="${site('#catalog')}">Открыть каталог →</a>` +
      (linked ? '' : `\n\nНажмите «${BTN.phone}» внизу, чтобы видеть заказы и бонусы.`);
    const body = { chat_id: chat, parse_mode: 'HTML', reply_markup: mainKb(chat) };
    if (C.welcomePhoto) {
      try {
        const r = await tg('sendPhoto', { ...body, photo: db.welcomePhotoId || C.welcomePhoto, caption });
        const id = r?.photo?.at?.(-1)?.file_id;
        if (id && id !== db.welcomePhotoId) { db.welcomePhotoId = id; save(); }
        return r;
      } catch (e) { log.error('welcome photo', e.message); db.welcomePhotoId = ''; }
    }
    return tg('sendMessage', { ...body, text: caption, disable_web_page_preview: true });
  }
  function ordersOf(chat) {
    const u = linkedUser(chat);
    return Object.values(db.orders).filter(o => String(o.customerChat) === String(chat) || (u && o.user === u.phone))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function customerMenu(chat, text, m) {
    const send = (t, extra = {}) => tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true, text: t, ...extra });
    const inline = rows => ({ reply_markup: { inline_keyboard: rows } });
    const u = linkedUser(chat);
    if (text === BTN.order) return send(`🛒 <b>Каталог и заказ — на сайте</b>\n\nДоставка по Москве ${rub(C.deliveryFee)}, бесплатно от ${rub(C.freeFrom)}. Самовывоз: ${esc(C.pickupAddr)}.\nОплата по QR-коду СБП, статус заказа придёт сюда.`,
      inline([[urlBtn('🛒 Открыть каталог', site('#catalog'))], [urlBtn('🥩 Стейки', site('#steaks')), urlBtn('🐄 Мясо', site('#meat'))], [urlBtn('🧀 Сыры', site('#cheese')), urlBtn('🐟 Рыба и икра', site('#fish'))]]));
    if (text === BTN.orders || /^\/orders/.test(text)) {
      const list = ordersOf(chat).slice(0, 5);
      if (!list.length) return send(u ? 'Заказов пока нет. Самое время выбрать стейк 🙂' : `Заказов пока нет.\n\nЕсли заказывали на сайте — нажмите «${BTN.phone}» внизу, и мы покажем заказы по вашему номеру.`, inline([[urlBtn('🛒 Открыть каталог', site('#catalog'))]]));
      const lines = list.map(o => `${ST[o.status].e} <b>№ ${o.no}</b> · ${day(o.createdAt).slice(0, 5)} · ${rub(o.final != null ? o.final : o.total)}\n${STATUS_PUBLIC[o.status]}${o.refund && o.refund.status !== 'done' ? ` · ↩️ возврат ${rub(o.refund.amount)}` : ''}`);
      return send(`📦 <b>Ваши заказы</b>\n\n${lines.join('\n\n')}`, inline([[urlBtn('👤 Все заказы в личном кабинете', site('#account'))]]));
    }
    if (text === BTN.bonus || /^\/bonus/.test(text)) {
      if (!u) return send(`🎁 <b>Бонусы</b>\n\n300 бонусов за регистрацию, кешбэк 3–7% с каждого заказа и 1 000 в день рождения. Бонусами можно оплатить до ${Math.round(C.maxBonusShare * 100)}% заказа.\n\nНажмите «${BTN.phone}» внизу, чтобы подключить бонусы.`, { reply_markup: mainKb(chat) });
      const L = levelOf(u.spent);
      return send(`🎁 <b>На счёте ${u.bonus} бонусов</b>\n\nУровень <b>${esc(L.name)}</b> — кешбэк ${Math.round(L.rate * 100)}%.${L.next ? `\nДо уровня ${esc(L.next.name)} (${Math.round(L.next.rate * 100)}%): покупки ещё на ${rub(L.next.need)}.` : ''}\n\n1 бонус = 1 ₽. Можно оплатить до ${Math.round(C.maxBonusShare * 100)}% заказа.${u.birthday ? '' : '\nУкажите день рождения в кабинете — подарим 1 000 бонусов.'}`,
        inline([[urlBtn('👤 Личный кабинет', site('#account'))]]));
    }
    if (text === BTN.where || /^\/contacts/.test(text)) return send(`📍 <b>${esc(C.shop)}</b> — ${C.shops.length} магазина в Москве:\n\n${C.shops.map(s => `• <b>${esc(s.name)}</b>\n   ${esc(s.addr)}`).join('\n')}\n\n🕑 ${esc(C.hours)}\n📞 ${esc(C.phone)}`,
      inline([[urlBtn('🗺 Маршрут в Яндекс Картах', C.mapUrl)], [urlBtn('💬 WhatsApp', C.whatsapp), urlBtn('ВКонтакте', C.vk)]]));
    if (text === BTN.contact) return send(`💬 <b>Связаться с лавкой</b>\n\n📞 ${esc(C.phone)} — позвоните, подскажем с выбором и толщиной стейка.\nИли напишите в WhatsApp — ответим в рабочее время (${esc(C.hours)}).`,
      inline([[urlBtn('💬 Написать в WhatsApp', C.whatsapp)], [urlBtn('ВКонтакте', C.vk)]]));
    return null;
  }

  async function onMessage(m) {
    const chat = String(m.chat.id);
    if (m.migrate_to_chat_id && chat === staff()) { db.staffChat = String(m.migrate_to_chat_id); C.staffChat = ''; save(); return; }
    const text = (m.text || m.caption || '').trim();
    if (/^\/id(@\w+)?$/.test(text)) return tg('sendMessage', { chat_id: chat, text: `ID этого чата: ${chat}` });

    // привязка рабочего чата: первая группа, где написали /staff
    if (/^\/staff(@\w+)?$/.test(text) && m.chat.type !== 'private') {
      if (staff() && staff() !== chat) return tg('sendMessage', { chat_id: chat, text: 'Рабочий чат уже назначен.' });
      if (!staff()) { db.staffChat = chat; save(); }
      await tg('sendMessage', { chat_id: chat, text: 'Готово: это рабочий чат лавки. Сюда будут приходить заказы.\n\nДальше: отправьте сюда картинку QR-кода для оплаты с подписью /qr' });
      return setupGroup(chat);
    }

    // ответ сотрудника: вес или новая сумма
    const p = m.reply_to_message && db.pending[m.reply_to_message.message_id];
    if (p && chat === staff()) {
      const o = db.orders[p.no];
      const v = parseInt((text.match(/\d[\d\s]*/) || [''])[0].replace(/\s/g, ''), 10);
      if (!o) return;
      if (!v || v < 1) return tg('sendMessage', { chat_id: chat, text: 'Нужна сумма числом, например 5240', reply_to_message_id: m.message_id });
      const by = who(m.from);
      if (p.kind === 'fix') {
        if (['done', 'cancel'].includes(o.status)) return;
        delete db.pending[m.reply_to_message.message_id];
        const reason = str(text.replace(/^[^\d]*\d[\d\s]*/, '').replace(/^[\s,.—–-]+/, ''), 120);
        const from = o.final != null ? o.final : o.total;
        (o.fixes = o.fixes || []).push({ at: iso(), from, to: v, reason, by });
        let extra;
        if (o.status === 'new') { o.total = v; o.final = null; extra = `Сумма к оплате изменена: ${rub(from)} → ${rub(v)}${reason ? ` (${reason})` : ''}. Оплатите новую сумму по QR-коду.`; }
        else { o.final = v; extra = `Сумма заказа изменена: ${rub(from)} → ${rub(v)}${reason ? ` (${reason})` : ''}. ` + settleMoney(o, reason || 'изменение суммы'); }
        o.history.push({ at: iso(), text: `сумма ${rub(from)} → ${rub(v)} — ${by}` });
        save();
        await renderStaff(o);
        const cc = customerChat(o);
        if (cc) await tg('sendMessage', { chat_id: cc, parse_mode: 'HTML', text: `✏️ <b>Заказ № ${o.no}</b>\n${esc(extra)}\nИзвините за неудобство!` }).catch(() => {});
        return askRefund(o);
      }
      if (o.status !== 'work') return;
      delete db.pending[m.reply_to_message.message_id];
      o.fact = v;
      o.final = v + o.delivery - (o.bonusUsed || 0);
      const d = o.goods - v;
      const money = settleMoney(o, 'вес меньше заказанного');
      const extra = `Фактическая сумма после взвешивания: ${rub(v)}. ` + (d === 0 ? 'Вес совпал с заказом.' : money);
      return setStatus(o, 'packed', by, `взвешено ${rub(v)}`, extra);
    }

    if (staff() && chat === staff()) {
      if (/^\/qr(@\w+)?\b/.test(text)) return saveQr(m);
      if (/^\/card(@\w+)?\b/.test(text)) return setCard(text);
      if (/^\/topics(@\w+)?\b/.test(text)) return makeTopics(chat);
      if (/^\/setup/.test(text)) return setupGroup(chat);
      if (/^\/today/.test(text)) return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: summary(day(now())) });
      if (/^\/orders/.test(text)) return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true, text: openOrders() });
      const cm = text.match(/^\/client(?:@\w+)?\s+(.+)/);
      if (cm) return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: clientCard(cm[1]) });
      if (/^\/help|^\/start/.test(text)) return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: STAFF_GUIDE() });
      return;
    }
    if (m.chat.type !== 'private') return;

    // ввод покупателя: карта или банк для возврата
    const w = db.custWait[chat];
    if (w && !m.contact && !Object.values(BTN).includes(text) && !text.startsWith('/')) {
      const o = db.orders[w.no];
      if (!o || !o.refund || o.refund.status === 'done' || Date.now() - w.at > 3 * 864e5) { delete db.custWait[chat]; save(); }
      else if (w.kind === 'card') {
        const d = text.replace(/[\s-]/g, '');
        await tg('deleteMessage', { chat_id: chat, message_id: m.message_id }).catch(() => {});
        if (!/^\d{16,19}$/.test(d) || !luhn(d)) return tg('sendMessage', { chat_id: chat, text: 'Похоже, в номере ошибка. Пришлите 16–19 цифр карты ещё раз.', reply_markup: { force_reply: true, input_field_placeholder: '2200 0000 0000 0000' } });
        return refundChosen(o, chat, { method: 'card', card: d, bank: null });
      } else {
        return refundChosen(o, chat, { method: 'sbp', bank: str(text, 40) });
      }
    }

    // shared contact: confirms the phone number belongs to this Telegram user
    if (m.contact) {
      if (String(m.contact.user_id) !== String(m.from?.id))
        return tg('sendMessage', { chat_id: chat, text: 'Отправьте, пожалуйста, свой номер кнопкой «Поделиться номером».' });
      const phone = normPhone(m.contact.phone_number);
      if (!phone) return tg('sendMessage', { chat_id: chat, text: 'Не удалось распознать номер.', reply_markup: mainKb(chat) });
      const entry = Object.entries(db.logins).filter(([, l]) => l.chat === chat && !l.confirmed && l.exp > Date.now()).sort((a, b) => b[1].exp - a[1].exp)[0];
      if (entry && entry[1].phone && entry[1].phone !== phone)
        return tg('sendMessage', { chat_id: chat, text: `Номер в Telegram (${maskPhone(phone)}) не совпадает с номером, который вы ввели на сайте. Проверьте номер и попробуйте снова.`, reply_markup: mainKb(chat) });
      for (const u of Object.values(db.users)) if (u.chat === chat && u.phone !== phone) u.chat = null;
      const u = getUser(phone, true);
      u.chat = chat;
      if (entry?.[1].consentAt && !u.consentAt) u.consentAt = entry[1].consentAt;
      if (!u.name) u.name = str(m.from?.first_name, 60);
      if (entry) entry[1].confirmed = phone;
      save();
      return tg('sendMessage', { chat_id: chat, reply_markup: mainKb(chat), parse_mode: 'HTML', text: entry
        ? '✅ Номер подтверждён, вход выполнен. Вернитесь на сайт.\nДальше коды для входа будут приходить сюда.'
        : `✅ Номер подтверждён. Коды для входа на сайт и статусы заказов будут приходить сюда.\n\n🎁 На счёте ${u.bonus} бонусов.` });
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
      return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: mainKb(chat), text: `Здравствуйте, ${esc(o.customer.name)}!\nБудем присылать сюда статус <b>заказа № ${o.no}</b>.\n\nСейчас: ${CUSTOMER_TEXT[o.status]}` });
    }
    if (/^\/start/.test(text)) return welcome(chat, m);
    const menu = await customerMenu(chat, text, m);
    if (menu !== null) return menu;
    return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: mainKb(chat),
      text: `Я бот лавки и пока не умею отвечать на сообщения 🙂\nВыберите в меню внизу или позвоните: ${esc(C.phone)}.` });
  }

  function summary(d) {
    const list = Object.values(db.orders).filter(o => day(o.createdAt) === d);
    const by = {}; list.forEach(o => (by[o.status] = (by[o.status] || 0) + 1));
    const paid = list.filter(o => ['paid', 'work', 'packed', 'road', 'done'].includes(o.status));
    const sum = paid.reduce((s, o) => s + (o.final != null ? o.final : o.total), 0);
    const avg = paid.length ? sum / paid.length : 0;
    const refunds = Object.values(db.orders).filter(o => o.refund && o.refund.status !== 'done');
    return [`📊 <b>Итоги ${d}</b>`, '', `Заказов: <b>${list.length}</b>, оплачено: <b>${paid.length}</b>`, `Выручка: <b>${rub(sum)}</b>${paid.length ? ` · средний чек ${rub(avg)}` : ''}`, '',
      ...Object.entries(by).map(([k, v]) => `${ST[k].e} ${ST[k].t}: ${v}`),
      ...(refunds.length ? ['', `↩️ Ждут возврата: ${refunds.length} на ${rub(refunds.reduce((s, o) => s + o.refund.amount, 0))}`] : [])].join('\n');
  }
  function cardLink(o) {
    const c = staff();
    return o.staffMsgId && /^-100\d+$/.test(c) ? `https://t.me/c/${c.slice(4)}/${o.staffMsgId}` : null;
  }
  function openOrders() {
    const list = Object.values(db.orders).filter(o => !['done', 'cancel'].includes(o.status) || (o.refund && o.refund.status !== 'done'))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!list.length) return 'Открытых заказов нет. 🎉';
    return '<b>Открытые заказы</b>\n\n' + list.map(o => {
      const l = cardLink(o), no = l ? `<a href="${l}">№ ${o.no}</a>` : `№ ${o.no}`;
      return `${ST[o.status].e} ${no} · ${esc(o.customer.name)} · ${rub(o.final != null ? o.final : o.total)}\n      ${esc(o.date)} ${esc(o.time)}${o.refund && o.refund.status !== 'done' ? ` · ↩️ вернуть ${rub(o.refund.amount)}` : ''}${o.extra ? ` · 💰 доплата ${rub(o.extra)}` : ''}`;
    }).join('\n');
  }
  function clientCard(q) {
    const phone = normPhone(q);
    const u = phone && db.users[phone];
    if (!u) return 'Покупатель не найден.';
    const L = levelOf(u.spent);
    const orders = Object.values(db.orders).filter(o => o.user === phone);
    return [`👤 <b>${esc(u.name || 'Без имени')}</b>, <code>${phone}</code>`, `Уровень: ${L.name} (${Math.round(L.rate * 100)}%)`, `Бонусы: ${u.bonus}`,
      `Покупок на ${rub(u.spent)}, заказов: ${orders.length}`, u.birthday ? `День рождения: ${u.birthday}` : '', u.chat ? 'Telegram подключён' : 'Telegram не подключён'].filter(Boolean).join('\n');
  }

  /** Одно обновление от Telegram (из getUpdates или вебхука). Повторы отбрасываются. */
  async function onUpdate(u) {
    if (typeof u.update_id === 'number') {
      if (u.update_id < (db.offset || 0)) return;
      db.offset = u.update_id + 1; save();
    }
    try {
      const msg = u.callback_query ? u.callback_query.message : u.message;
      curThread = msg && msg.is_topic_message && staff() && String(msg.chat?.id) === staff() ? msg.message_thread_id : null;
      if (u.callback_query) await onCallback(u.callback_query);
      else if (u.message) await onMessage(u.message);
    } catch (e) { log.error('update', e.message); }
    finally { curThread = null; }
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
          if (u.chat) await tg('sendMessage', { chat_id: u.chat, text: `🎂 С днём рождения! Дарим ${C.birthdayBonus} бонусов на стейк к праздничному столу.` }).catch(() => {});
        }
      }
      for (const [k, l] of Object.entries(db.logins)) if (l.exp < Date.now() - 3600e3) delete db.logins[k];
      for (const [k, s] of Object.entries(db.sessions)) if (Date.now() - new Date(s.seen).getTime() > 90 * 864e5) delete db.sessions[k];
      for (const [k, w] of Object.entries(db.custWait)) if (Date.now() - w.at > 3 * 864e5) delete db.custWait[k];
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
      const p = item(it.id), q = +it.q;
      if (!p || p.hidden) throw httpErr(400, 'Товар не найден: ' + str(p ? p.name : it.id, 60));
      if (p.price == null && p.pp == null) throw httpErr(400, 'Цену уточняем по телефону: ' + p.name);
      if (p.stock === 'out') throw httpErr(400, 'Нет в наличии: ' + p.name + '. Уберите его из корзины.');
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
    if (db.seq < 2000) db.seq = 2000; // номера заказов: 2001, 2002, …
    const no = String(++db.seq);
    const o = { no, token: crypto.randomBytes(6).toString('hex'), createdAt: iso(), consentAt: iso(), status: 'new',
      customer: { name, tel }, user: u?.phone || null, pickup, shop: C.shops.some(s => s.id === b.shop) ? b.shop : (C.shops.length === 1 ? C.shops[0].id : null), addr: pickup ? '' : str(b.addr, 200), date: str(b.date, 40), time: str(b.time, 40), note: str(b.note, 400),
      items, goods, delivery, bonusUsed, total: goods + delivery - bonusUsed, fact: null, staffMsgId: null, customerChat: null, cashback: 0,
      history: [{ at: iso(), text: 'заказ с сайта' + (u ? ' (личный кабинет)' : '') }] };
    if (bonusUsed) bonus(u, -bonusUsed, 'Оплата бонусами', no);
    if (u && !pickup && o.addr && !u.addresses.includes(o.addr)) u.addresses = [o.addr, ...u.addresses].slice(0, 5);
    if (u && !u.name) u.name = name;
    db.orders[no] = o; save();
    await renderStaff(o);
    return o;
  }
  // Оплата переводом по номеру карты: /card в рабочей группе или PAY_CARD в настройках.
  const payCard = () => db.payCard || (C.payCard ? { num: C.payCard, name: C.payCardName } : null);
  function setCard(text) {
    const arg = text.replace(/^\/card(@\w+)?/, '').trim();
    if (/^(off|удалить|нет)$/i.test(arg)) { db.payCard = null; save(); return tg('sendMessage', { chat_id: staff(), text: 'Карта убрана с сайта. Покупатели снова видят QR-код.' }); }
    const m = arg.match(/^([\d\s-]{16,26})(.*)$/), num = m ? m[1].replace(/\D/g, '') : '';
    if (!m || num.length < 16 || num.length > 19) {
      const c = payCard();
      return tg('sendMessage', { chat_id: staff(), parse_mode: 'HTML', text: (c ? `💳 Сейчас на сайте: <code>${fmtCard(c.num)}</code>${c.name ? ', ' + esc(c.name) : ''}\n\n` : 'Карта для оплаты не задана.\n\n') +
        'Задать: <code>/card 2202 2000 1234 5678 Сергей М., Сбербанк</code>\nУбрать: <code>/card off</code>' });
    }
    db.payCard = { num, name: str(m[2].replace(/^[\s,—-]+/, ''), 80), at: iso() }; save();
    return tg('sendMessage', { chat_id: staff(), parse_mode: 'HTML', text: `✅ Карта для оплаты: <code>${fmtCard(num)}</code>${db.payCard.name ? ', ' + esc(db.payCard.name) : ''}\nПокупатели увидят её при оформлении и номер заказа для комментария к переводу.` });
  }
  // Темы в рабочей группе: «Заказы · <магазин>». Группе нужно включить «Темы», боту — право управлять темами.
  async function makeTopics(chat) {
    const info = await tg('getChat', { chat_id: chat }).catch(() => null);
    if (!info || !info.is_forum) return tg('sendMessage', { chat_id: chat, _nt: true, parse_mode: 'HTML', text: '⚠️ В группе не включены темы.\n\nОткройте группу → ✏️ Изменить → включите <b>Темы</b>. Боту дайте права администратора с пунктом «Управление темами». Потом снова отправьте /topics.\n\n(Если ID группы после этого поменяется, бот сам его подхватит.)' });
    db.topics = db.topics || {};
    const res = [];
    for (const s of C.shops) {
      if (db.topics[s.id]) { res.push(`• ${esc(s.name)} — уже есть`); continue; }
      try {
        const t = await tg('createForumTopic', { chat_id: chat, name: `Заказы · ${s.name}`.slice(0, 128) });
        db.topics[s.id] = t.message_thread_id; save();
        await tg('sendMessage', { chat_id: chat, message_thread_id: t.message_thread_id, parse_mode: 'HTML', text: `🏬 <b>${esc(s.name)}</b>\n${esc(s.addr)}\n\nСюда приходят заказы этого магазина.` }).catch(() => {});
        res.push(`• ${esc(s.name)} — создана`);
      } catch (e) { res.push(`• ${esc(s.name)} — ⚠️ ${esc(e.message)}`); }
    }
    return tg('sendMessage', { chat_id: chat, _nt: true, parse_mode: 'HTML', text: `<b>Темы для магазинов</b>\n${res.join('\n')}\n\nЗаказы без выбранного магазина и итоги дня приходят в общую тему.` });
  }
  function qr() {
    if (db.qr) return { bytes: Buffer.from(db.qr.b64, 'base64'), type: db.qr.type };
    return opts.readQrFile ? opts.readQrFile() : null;
  }
  const publicOrder = o => ({ no: o.no, token: o.token, status: o.status, statusText: CUSTOMER_TEXT[o.status], total: o.total, goods: o.goods, delivery: o.delivery, bonusUsed: o.bonusUsed || 0, fact: o.fact,
    items: o.items.map(({ name, qty, sum }) => ({ name, qty, sum })),
    payCard: payCard() ? { num: fmtCard(payCard().num), name: payCard().name || '', phone: C.payPhone } : null,
    payQr: db.qr || (opts.readQrFile && opts.readQrFile()) ? '/pay-qr' + (db.qr ? '?v=' + Date.parse(db.qr.at) : '') : null, payNote: C.payNote,
    botLink: customerChat(o) ? null : ME ? `https://t.me/${ME.username}?start=o${o.no}_${o.token}` : null,
    telegramLinked: !!customerChat(o) });

  /* ---------- панель управления ---------- */
  const ITER = 20000;
  function hashPw(pw, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    return `pbkdf2$${ITER}$${salt}$${crypto.pbkdf2Sync(String(pw), salt, ITER, 32, 'sha256').toString('hex')}`;
  }
  function checkPw(pw, stored) {
    const m = String(stored || '').match(/^pbkdf2\$(\d+)\$([0-9a-f]+)\$([0-9a-f]{64})$/);
    if (!m) return false;
    const h = crypto.pbkdf2Sync(String(pw), m[2], +m[1], 32, 'sha256');
    const want = Buffer.from(m[3], 'hex');
    return h.length === want.length && crypto.timingSafeEqual(h, want);
  }
  // Владелец задаётся в настройках сервера (ADMIN_LOGIN, ADMIN_HASH), пока не сменит пароль в панели.
  const adminOf = login => db.admins[login] || (login === C.adminLogin && C.adminHash ? { hash: C.adminHash, role: 'owner', name: 'Владелец' } : null);
  const ROLE = { owner: 'Владелец', staff: 'Сотрудник' };
  // Логин-телефон в любом виде (8-901-…, +7 (901) …, 901…) → 8XXXXXXXXXX.
  const normLogin = v => {
    const l = str(v, 40).trim().toLowerCase(), d = l.replace(/[\s()+-]/g, '');
    if (/^\d{10,11}$/.test(d)) return '8' + d.slice(-10);
    return l;
  };
  function adminSess(req) {
    const m = (req.headers.authorization || '').match(/^Admin\s+([A-Za-z0-9_-]{30,})$/);
    if (!m) return null;
    const h = sha('adm:' + m[1]), s = db.asess[h];
    if (!s) return null;
    const a = adminOf(s.login);
    if (!a || Date.now() - Date.parse(s.seen) > 30 * 86400e3) { delete db.asess[h]; save(); return null; }
    if (Date.now() - Date.parse(s.seen) > 3600e3) { s.seen = iso(); save(); }
    return { hash: h, login: s.login, a };
  }
  const needAdmin = req => { const s = adminSess(req); if (!s) throw httpErr(401, 'Войдите в панель управления'); return s; };
  function adminLogin(b, ip) {
    if (hit('adm:' + ip, 8, 15 * 60e3) || hit('adm:all', 60, 3600e3)) throw httpErr(429, 'Слишком много попыток. Подождите 15 минут.');
    const login = normLogin(b.login), a = adminOf(login);
    if (!a || !checkPw(String(b.password || ''), a.hash)) throw httpErr(401, 'Неверный логин или пароль');
    const token = crypto.randomBytes(24).toString('base64url');
    for (const [h, x] of Object.entries(db.asess)) if (Date.now() - Date.parse(x.seen) > 30 * 86400e3) delete db.asess[h];
    db.asess[sha('adm:' + token)] = { login, at: iso(), seen: iso() };
    save();
    return { token, me: { login, name: a.name, role: a.role } };
  }
  const priceOf = p => (p.unit === 'pc' && p.pp != null ? p.pp : p.price);
  const priceKey = p => (p.unit === 'pc' && CATALOG[p.id].pp != null ? 'pp' : 'price');
  const money = v => (v == null ? 'по запросу' : rub(v));
  const BADGE = { '': '', hit: 'Хит', new: 'Новинка', sale: 'Скидка' };
  function numOrNull(v, what) {
    if (v === null || v === '') return null;
    const n = Math.round(+v);
    if (!(n >= 1 && n <= 5e6)) throw httpErr(400, 'Неверная ' + what);
    return n;
  }
  async function adminSave(sess, b) {
    const ch = b && b.changes;
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) throw httpErr(400, 'Нет изменений');
    const ids = Object.keys(ch);
    if (!ids.length || ids.length > 500) throw httpErr(400, 'Нет изменений');
    const lines = [], who = sess.a.name || sess.login;
    for (const id of ids) {
      const base = CATALOG[id];
      if (!base) throw httpErr(400, 'Товар не найден: ' + str(id, 60));
      const c = ch[id] || {}, cur = item(id), next = Object.assign({}, db.ov[id] || {}), what = [];
      if ('price' in c) {
        const k = priceKey(base), v = numOrNull(c.price, 'цена: ' + base.name);
        if (v !== priceOf(cur)) what.push(`цена ${money(priceOf(cur))} → ${money(v)}`);
        next[k] = v;
      }
      if ('stock' in c) {
        if (!['in', 'out'].includes(c.stock)) throw httpErr(400, 'Неверное наличие');
        if ((cur.stock || 'in') !== c.stock) what.push(c.stock === 'out' ? 'нет в наличии' : 'в наличии');
        next.stock = c.stock;
      }
      if ('hidden' in c) {
        const v = !!c.hidden;
        if (!!cur.hidden !== v) what.push(v ? 'скрыт с сайта' : 'снова на сайте');
        next.hidden = v;
      }
      if ('badge' in c) {
        const v = String(c.badge || '');
        if (!(v in BADGE)) throw httpErr(400, 'Неверная метка');
        if ((cur.badge || '') !== v) what.push(v ? 'метка «' + BADGE[v] + '»' : 'без метки');
        next.badge = v;
      }
      if ('old' in c) {
        const v = numOrNull(c.old, 'старая цена: ' + base.name);
        if ((cur.old || null) !== v) what.push(v ? 'старая цена ' + rub(v) : 'без старой цены');
        next.old = v;
      }
      // в правке храним только то, что отличается от исходного каталога
      for (const [k, def] of [['price', base.price], ['pp', base.pp], ['stock', base.stock || 'in'], ['hidden', !!base.hidden], ['badge', base.badge || ''], ['old', base.old || null]])
        if (k in next && (next[k] === def || (next[k] == null && def == null))) delete next[k];
      if (Object.keys(next).length) db.ov[id] = next; else delete db.ov[id];
      if (what.length) { db.alog.unshift({ at: iso(), by: who, id, name: base.name, text: what.join(', ') }); lines.push(`• ${base.name}: ${what.join(', ')}`); }
    }
    db.alog = db.alog.slice(0, 300);
    db.ovAt = iso();
    save();
    if (lines.length && staff()) {
      const more = lines.length > 15 ? `\n…и ещё ${lines.length - 15}` : '';
      await tg('sendMessage', { chat_id: staff(), text: `🛠 ${esc(who)} изменил каталог:\n${esc(lines.slice(0, 15).join('\n'))}${more}`, parse_mode: 'HTML', disable_notification: true }).catch(() => {});
    }
    return { ok: true, changed: lines.length, ov: db.ov };
  }
  function adminState(sess) {
    const users = sess.a.role === 'owner'
      ? Object.entries(Object.assign(C.adminHash && !db.admins[C.adminLogin] ? { [C.adminLogin]: { role: 'owner', name: 'Владелец' } } : {}, db.admins))
        .map(([login, a]) => ({ login, name: a.name, role: a.role, roleName: ROLE[a.role] })) : null;
    return { me: { login: sess.login, name: sess.a.name, role: sess.a.role }, ov: db.ov, log: db.alog.slice(0, 150), users };
  }
  function adminPassword(sess, b) {
    if (!checkPw(String(b.old || ''), sess.a.hash)) throw httpErr(400, 'Старый пароль неверный');
    const pw = String(b.password || '');
    if (pw.length < 8) throw httpErr(400, 'Новый пароль — не короче 8 символов');
    db.admins[sess.login] = Object.assign({}, sess.a, { hash: hashPw(pw) });
    for (const [h, x] of Object.entries(db.asess)) if (x.login === sess.login && h !== sess.hash) delete db.asess[h];
    save();
    return { ok: true };
  }
  function adminUsers(sess, b) {
    if (sess.a.role !== 'owner') throw httpErr(403, 'Доступами управляет владелец');
    const login = normLogin(b.login);
    if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw httpErr(400, 'Логин: латиница, цифры, точка, дефис, от 3 символов, или телефон');
    if (b.action === 'add') {
      if (adminOf(login)) throw httpErr(400, 'Такой логин уже есть');
      const pw = String(b.password || '');
      if (pw.length < 8) throw httpErr(400, 'Пароль — не короче 8 символов');
      db.admins[login] = { hash: hashPw(pw), role: b.role === 'owner' ? 'owner' : 'staff', name: str(b.name, 60) || login, at: iso(), by: sess.login };
    } else if (b.action === 'del') {
      if (login === sess.login) throw httpErr(400, 'Себя удалить нельзя');
      if (login === C.adminLogin) throw httpErr(400, 'Главного владельца удалить нельзя');
      delete db.admins[login];
      for (const [h, x] of Object.entries(db.asess)) if (x.login === login) delete db.asess[h];
    } else throw httpErr(400, 'Неизвестное действие');
    save();
    return adminState(sess);
  }

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
      if (P === '/api/catalog') return reply(200, { ov: db.ov, at: db.ovAt || null });
      if (P === '/api/admin/login' && M === 'POST') return reply(200, adminLogin(parseBody(req), ip));
      if (P.startsWith('/api/admin/')) {
        const s = needAdmin(req);
        if (P === '/api/admin/state') return reply(200, adminState(s));
        if (M !== 'POST') return reply(405, { error: 'POST' });
        const b = parseBody(req);
        if (P === '/api/admin/save') return reply(200, await adminSave(s, b));
        if (P === '/api/admin/password') return reply(200, adminPassword(s, b));
        if (P === '/api/admin/users') return reply(200, adminUsers(s, b));
        if (P === '/api/admin/logout') { delete db.asess[s.hash]; save(); return reply(200, { ok: true }); }
        return reply(404, { error: 'not found' });
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

  return { handle, onUpdate, daily, init, setupBot, tg, sha, hashPw, get me() { return ME; }, staff };
}

module.exports = { createShop, configFromEnv, emptyDb };
