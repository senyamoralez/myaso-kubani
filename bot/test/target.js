// Запуск сервера для тестов: обычный Node (server.js) или Cloudflare Worker в wrangler dev (TARGET=worker).
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const WORKER = process.env.TARGET === 'worker';
const ROOT = path.join(__dirname, '..', '..');

function startServer(port, env, opts = {}) {
  let proc, persist;
  const WORKER = opts.worker != null ? opts.worker : module.exports.WORKER;
  if (!WORKER) {
    proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    env = { ...env, SECRET: 'test-secret' };
    delete env.DATA_DIR; delete env.CATALOG; delete env.PORT;
    const wdir = path.join(ROOT, 'worker');
    fs.writeFileSync(path.join(wdir, '.dev.vars'), Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join('\n'));
    persist = opts.persist || fs.mkdtempSync(path.join(os.tmpdir(), 'lavka-wr-'));
    proc = spawn(path.join(wdir, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist, '--show-interactive-dev-session=false', '--test-scheduled'],
      { cwd: wdir, env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const hmac = s => crypto.createHmac('sha256', 'test-secret').update(s).digest('hex');
  let chain = Promise.resolve();
  const srv = {
    proc, worker: WORKER,
    stdout: proc.stdout, stderr: proc.stderr,
    ready: (async () => {
      for (let i = 0; i < 120; i++) {
        try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break; } catch (e) { /* not yet */ }
        await new Promise(r => setTimeout(r, 500));
      }
      if (WORKER) fs.rmSync(path.join(ROOT, 'worker', '.dev.vars'), { force: true });
    })(),
    // TARGET=worker: обновления Telegram приходят вебхуком, по очереди
    hook: WORKER ? u => { chain = chain.then(() => fetch(`http://127.0.0.1:${port}/tg/${hmac('webhook-path').slice(0, 32)}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': hmac('webhook-token').slice(0, 48) }, body: JSON.stringify(u) }).then(r => r.text()).catch(() => {})); } : null,
    persist: () => persist,
    kill(keep) { proc.kill(); if (persist && !keep) fs.rmSync(persist, { recursive: true, force: true }); },
    exited: new Promise(r => proc.on('exit', r)),
  };
  return srv;
}
module.exports = { startServer, WORKER };
