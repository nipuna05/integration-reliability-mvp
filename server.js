import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAll, runCheck } from './lib/runner.js';
import { handleDemo } from './lib/demo.js';
import { detectTransitions, dispatch } from './lib/alerts.js';
import { validateChecks } from './lib/checks.js';
import { createAuth, viaProxy } from './lib/auth.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CHECKS_FILE = path.join(DATA_DIR, 'checks.json');
const MAX_HISTORY = 200;
const BASE = { base: `http://localhost:${PORT}` };

// User-edited checks live in data/; checks.json in the repo is the starter set.
let checks = JSON.parse(await readFile(existsSync(CHECKS_FILE) ? CHECKS_FILE : path.join(root, 'checks.json'), 'utf8'));
let history = existsSync(HISTORY_FILE) ? JSON.parse(await readFile(HISTORY_FILE, 'utf8')) : [];
const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
const auth = createAuth(process.env.APP_PASSWORD);
// newest run per check, so alerts only fire when status changes
const lastStatus = new Map();
for (const h of [...history].reverse()) lastStatus.set(h.id, h.ok);

function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error('body too large');
  }
  return data ? JSON.parse(data) : {};
}

async function runAndRecord() {
  const results = await runAll(checks, BASE);
  history = [...results, ...history].slice(0, MAX_HISTORY);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2)).catch(() => {});
  await dispatch(detectTransitions(lastStatus, results), { webhookUrl: WEBHOOK_URL });
  return results;
}

// Editing checks makes the server call arbitrary URLs, so it needs a login. With no
// password configured it is only allowed for direct local use, never through a tunnel.
const canEdit = (req) => (auth.enabled ? auth.isAuthed(req) : !viaProxy(req));

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress || '';
  try {
    if (pathname.startsWith('/demo/')) return await handleDemo(req, res, pathname);
    if (pathname === '/healthz') return send(res, 200, { ok: true });
    if (pathname === '/') return send(res, 200, await readFile(path.join(root, 'public', 'index.html'), 'utf8'), 'text/html');

    if (pathname === '/api/session') return send(res, 200, { authRequired: auth.enabled, authed: auth.isAuthed(req), canEdit: canEdit(req) });
    if (pathname === '/api/login' && req.method === 'POST') {
      const token = auth.login((await readJson(req)).password, ip);
      if (token === 'RATE_LIMITED') return send(res, 429, { error: 'too many attempts, wait a minute' });
      if (!token) return send(res, 401, { error: 'wrong password' });
      return send(res, 200, { token }, 'application/json', { 'set-cookie': `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      auth.logout(req);
      return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': 'session=; Max-Age=0; Path=/' });
    }

    if (pathname.startsWith('/api/') && !auth.isAuthed(req)) return send(res, 401, { error: 'login required' });

    if (pathname === '/api/checks' && req.method === 'GET') return send(res, 200, checks);
    if (pathname === '/api/checks' && req.method === 'PUT') {
      if (!canEdit(req)) return send(res, 403, { error: 'editing is disabled here: set APP_PASSWORD and log in' });
      const next = await readJson(req);
      const errors = validateChecks(next);
      if (errors.length) return send(res, 400, { errors });
      checks = next;
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(CHECKS_FILE, JSON.stringify(checks, null, 2));
      return send(res, 200, { saved: checks.length });
    }
    if (pathname === '/api/checks/test' && req.method === 'POST') {
      if (!canEdit(req)) return send(res, 403, { error: 'editing is disabled here: set APP_PASSWORD and log in' });
      const next = await readJson(req);
      const errors = validateChecks(next);
      if (errors.length) return send(res, 400, { errors });
      const results = [];
      for (const c of next) results.push(await runCheck(c, BASE)); // not recorded in history
      return send(res, 200, results);
    }
    if (pathname === '/api/history') return send(res, 200, history);
    if (pathname === '/api/run' && req.method === 'POST') return send(res, 200, await runAndRecord());
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, err instanceof SyntaxError ? 400 : 500, { error: err.message });
  }
});

const intervalSec = Number(process.env.INTERVAL_SEC || 60);
server.listen(PORT, () => {
  console.log(`Integration Reliability MVP on http://localhost:${PORT}  (scheduled run every ${intervalSec}s, login ${auth.enabled ? 'ON' : 'OFF'})`);
  setInterval(() => runAndRecord().catch(console.error), intervalSec * 1000);
});
