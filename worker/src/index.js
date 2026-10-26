// Cloudflare Worker «Мясо Кубани и стейки».
// Запросы сайта и вебхук Telegram обрабатывает один Durable Object `Shop`: он хранит базу и выполняет
// запросы по очереди, как один процесс Node.js. Логика целиком в ../../bot/core.js.
import { DurableObject } from 'cloudflare:workers';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import core from '../../bot/core.js';
import catalog from '../../tools/catalog.json';
import groupPhoto from '../../bot/assets/group.png';

const { createShop, configFromEnv, emptyDb } = core;
const COLL = ['orders', 'users', 'sessions', 'logins', 'pending'];

export class Shop extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => this.load());
  }

  async load() {
    const db = emptyDb();
    const snap = new Map();
    for (const [k, v] of await this.ctx.storage.list()) {
      snap.set(k, v);
      const i = k.indexOf('/');
      if (i > 0 && COLL.includes(k.slice(0, i))) db[k.slice(0, i)][k.slice(i + 1)] = JSON.parse(v);
      else if (k === 'meta') Object.assign(db, JSON.parse(v));
      else if (k === 'qr') db.qr = JSON.parse(v);
    }
    this.db = db;
    this.snap = snap;
    this.dirty = false;
    this.C = configFromEnv(this.env);
    this.shop = createShop({ C: this.C, db, catalog, crypto, Buffer, assets: { groupPhoto: new Uint8Array(groupPhoto) }, save: () => { this.dirty = true; } });
  }

  // База лежит по ключам: orders/1001, users/+7…, meta, qr. Пишем только изменившиеся ключи.
  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const cur = new Map();
    const meta = {};
    for (const [k, v] of Object.entries(this.db)) {
      if (COLL.includes(k)) for (const [id, x] of Object.entries(v)) cur.set(`${k}/${id}`, JSON.stringify(x));
      else if (k === 'qr') { if (v) cur.set('qr', JSON.stringify(v)); }
      else meta[k] = v;
    }
    cur.set('meta', JSON.stringify(meta));
    const put = [], del = [];
    for (const [k, v] of cur) if (this.snap.get(k) !== v) put.push([k, v]);
    for (const k of this.snap.keys()) if (!cur.has(k)) del.push(k);
    for (let i = 0; i < put.length; i += 128) await this.ctx.storage.put(Object.fromEntries(put.slice(i, i + 128)));
    for (let i = 0; i < del.length; i += 128) await this.ctx.storage.delete(del.slice(i, i + 128));
    this.snap = cur;
  }

  hookPath() { return this.shop.sha('webhook-path').slice(0, 32); }
  hookToken() { return this.shop.sha('webhook-token').slice(0, 48); }

  // Подключает вебхук Telegram к адресу этого воркера (один раз, и заново — если адрес или токен сменились).
  async ensureWebhook(selfUrl) {
    if (!this.C.token || !selfUrl) return;
    if (!this.shop.me) await this.shop.init();
    const url = `${selfUrl}/tg/${this.hookPath()}`;
    const mark = url + '#' + this.shop.sha(this.C.token).slice(0, 8);
    if (this.shop.me) await this.shop.setupBot();
    if (this.db.webhookUrl === mark) return;
    try {
      await this.shop.tg('setWebhook', { url, secret_token: this.hookToken(), allowed_updates: ['message', 'callback_query'], max_connections: 5 });
      this.db.webhookUrl = mark;
      this.db.selfUrl = selfUrl;
      this.dirty = true;
    } catch (e) { console.error('setWebhook', e.message); }
  }

  async api(r) {
    await this.ensureWebhook(r.selfUrl);
    const res = await this.shop.handle({ ...r, query: new URLSearchParams(r.query || '') });
    await this.flush();
    return res;
  }

  async telegram(path, token, bodyText) {
    if (path !== this.hookPath() || token !== this.hookToken()) return { ok: false };
    let u;
    try { u = JSON.parse(bodyText); } catch (e) { return { ok: true }; }
    if (!this.shop.me) await this.shop.init();
    await this.shop.onUpdate(u);
    await this.flush();
    return { ok: true };
  }

  async cron() {
    await this.ensureWebhook(this.db.selfUrl);
    await this.shop.daily();
    await this.flush();
  }
}

const stubOf = env => env.SHOP.get(env.SHOP.idFromName('main'));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stub = stubOf(env);
    if (url.pathname.startsWith('/tg/')) {
      if (request.method !== 'POST') return new Response('ok');
      const r = await stub.telegram(url.pathname.slice(4), request.headers.get('x-telegram-bot-api-secret-token') || '', await request.text());
      return new Response(r.ok ? 'ok' : 'forbidden', { status: r.ok ? 200 : 403 });
    }
    const h = request.headers;
    const r = await stub.api({
      method: request.method, path: url.pathname, query: url.search,
      headers: { origin: h.get('origin') || '', cookie: h.get('cookie') || '', authorization: h.get('authorization') || '', 'user-agent': h.get('user-agent') || '' },
      ip: h.get('cf-connecting-ip') || '',
      bodyText: request.method === 'POST' ? (await request.text()).slice(0, 60000) : '',
      selfUrl: url.origin,
    });
    return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stubOf(env).cron());
  },
};
