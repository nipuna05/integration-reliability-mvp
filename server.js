import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAll, runCheck } from './lib/runner.js';
import { handleDemo } from './lib/demo.js';
import { detectTransitions, dispatch, sendTestAlert, sendWebhook } from './lib/alerts.js';
import { buildDigest } from './lib/digest.js';
import { buildPublicStatus } from './lib/publicStatus.js';
import { createDeviceStore, createPush } from './lib/push.js';
import { createMailer } from './lib/mailer.js';
import { validateChecks } from './lib/checks.js';
import { createAuth, viaProxy } from './lib/auth.js';
import { loadTemplates, instantiate } from './lib/templates.js';
import { createSecretStore } from './lib/secrets.js';
import { createExplainer } from './lib/explain.js';
import { parseCurl, buildCheck, secretNameFor, previewFields, CurlError } from './lib/curl.js';
import { redact } from './lib/secrets.js';
import { dueChecks, trimHistory } from './lib/schedule.js';
import { createStats } from './lib/stats.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CHECKS_FILE = path.join(DATA_DIR, 'checks.json');
const MAX_HISTORY_PER_CHECK = 100;
const MIN_INTERVAL_SEC = Number(process.env.MIN_INTERVAL_SEC || 30); // shortest allowed per-check schedule
const TICK_MS = Number(process.env.TICK_MS || 5000); // how often the scheduler looks for due checks
const templates = await loadTemplates(path.join(root, 'templates'));
const BASE = { base: `http://localhost:${PORT}` };

// User-edited checks live in data/; checks.json in the repo is the starter set.
let checks = JSON.parse(await readFile(existsSync(CHECKS_FILE) ? CHECKS_FILE : path.join(root, 'checks.json'), 'utf8'));
let history = existsSync(HISTORY_FILE) ? JSON.parse(await readFile(HISTORY_FILE, 'utf8')) : [];
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const stats = createStats(existsSync(STATS_FILE) ? JSON.parse(await readFile(STATS_FILE, 'utf8')) : undefined);
// STATUS_PAGE=1 publishes /status for anyone with the link (names, up/down, uptime only). Off by default.
const STATUS_PAGE = process.env.STATUS_PAGE === '1';
const STATUS_TITLE = process.env.STATUS_TITLE || 'Service status';
const DIGEST_FILE =path.join(DATA_DIR, 'digest.json');
const WEEKLY_DIGEST = process.env.WEEKLY_DIGEST === '1';
let lastDigestAt = existsSync(DIGEST_FILE) ? JSON.parse(await readFile(DIGEST_FILE, 'utf8')).lastSentAt : undefined;
const devices = await createDeviceStore(path.join(DATA_DIR, 'devices.json'));
const push = createPush({ store: devices, url: process.env.EXPO_PUSH_URL || undefined });
const secrets = await createSecretStore(path.join(DATA_DIR, 'secrets.json'), process.env.SECRETS_KEY);
const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
const mailer = createMailer();
const auth = createAuth(process.env.APP_PASSWORD);
// PUBLIC_DEMO=1: anyone can view and run checks; only editing needs the password.
const PUBLIC_DEMO = process.env.PUBLIC_DEMO === '1';
const isPublicRead = (req, p) => PUBLIC_DEMO && ((req.method === 'GET' && (p === '/api/checks' || p === '/api/history' || p === '/api/stats')) || (req.method === 'POST' && p === '/api/run'));
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

const explain = createExplainer({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.EXPLAIN_MODEL || undefined, secretValues: () => secrets.values() });
async function addExplanations(results) {
  for (const r of results) if (!r.ok) r.explanation = await explain(r);
  return results;
}

const lastRun = new Map(); // check id -> time of its last run, drives per-check schedules
async function runAndRecord(list = checks) {
  const results = await runAll(list, BASE, { secrets: secrets.values() });
  const now = Date.now();
  for (const r of results) lastRun.set(r.id, now);
  await addExplanations(results);
  history = trimHistory([...results, ...history], MAX_HISTORY_PER_CHECK);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2)).catch(() => {});
  const events = detectTransitions(lastStatus, results);
  stats.record(results, events);
  await writeFile(STATS_FILE, JSON.stringify(stats.toJSON())).catch(() => {});
  await dispatch(events, { webhookUrl: WEBHOOK_URL, mailer, push });
  return results;
}

// Sends the reliability report by email and chat webhook (whichever are configured).
async function sendDigest() {
  const { subject, text } = buildDigest({ checks, summary: stats.summary(checks.map((c) => c.id)) });
  const out = {};
  out.email = !mailer ? 'not configured' : await mailer.send(subject, text).then(() => 'sent', (e) => `failed: ${e.message}`);
  out.webhook = !WEBHOOK_URL ? 'not configured' : await sendWebhook(WEBHOOK_URL, `${subject}\n\n${text}`).then(() => 'sent', (e) => `failed: ${e.message}`);
  return out;
}
async function saveDigestTime(t) {
  lastDigestAt = t;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DIGEST_FILE, JSON.stringify({ lastSentAt: t })).catch(() => {});
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
    if (pathname === '/status' || pathname === '/api/public-status') {
      if (!STATUS_PAGE) return send(res, 404, { error: 'not found' });
      if (pathname === '/status') return send(res, 200, await readFile(path.join(root, 'public', 'status.html'), 'utf8'), 'text/html', { 'cache-control': 'no-store' });
      return send(res, 200, buildPublicStatus({ checks, summary: stats.summary(checks.map((c) => c.id)), lastStatus, title: STATUS_TITLE }), 'application/json', { 'cache-control': 'no-store' });
    }
    if (pathname === '/') return send(res, 200, await readFile(path.join(root, 'public', 'index.html'), 'utf8'), 'text/html', { 'cache-control': 'no-store' });

    if (pathname === '/api/session') return send(res, 200, { authRequired: auth.enabled, authed: auth.isAuthed(req), canEdit: canEdit(req), publicRead: PUBLIC_DEMO, statusPage: STATUS_PAGE, defaultIntervalSec: intervalSec, minIntervalSec: MIN_INTERVAL_SEC });
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

    if (pathname.startsWith('/api/') && !auth.isAuthed(req) && !isPublicRead(req, pathname)) return send(res, 401, { error: 'login required' });

    if (pathname === '/api/checks' && req.method === 'GET') return send(res, 200, checks);
    if (pathname === '/api/checks' && req.method === 'PUT') {
      if (!canEdit(req)) return send(res, 403, { error: 'editing is disabled here: set APP_PASSWORD and log in' });
      const next = await readJson(req);
      const errors = validateChecks(next, secrets.names(), { minSec: MIN_INTERVAL_SEC });
      if (errors.length) return send(res, 400, { errors });
      checks = next;
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(CHECKS_FILE, JSON.stringify(checks, null, 2));
      return send(res, 200, { saved: checks.length });
    }
    if (pathname === '/api/checks/test' && req.method === 'POST') {
      if (!canEdit(req)) return send(res, 403, { error: 'editing is disabled here: set APP_PASSWORD and log in' });
      const next = await readJson(req);
      const errors = validateChecks(next, secrets.names(), { minSec: MIN_INTERVAL_SEC });
      if (errors.length) return send(res, 400, { errors });
      const results = [];
      for (const c of next) results.push(await runCheck(c, BASE, { secrets: secrets.values() })); // not recorded in history
      return send(res, 200, await addExplanations(results));
    }
    if (pathname === '/api/templates' && req.method === 'GET') return send(res, 200, templates.map(({ id, title, description, params }) => ({ id, title, description, params })));
    if (pathname === '/api/templates/instantiate' && req.method === 'POST') {
      const { templateId, values } = await readJson(req);
      const t = templates.find((x) => x.id === templateId);
      if (!t) return send(res, 404, { error: 'unknown template' });
      return send(res, 200, instantiate(t, values, checks.map((c) => c.id)));
    }
    if (pathname === '/api/secrets' && req.method === 'GET') return send(res, 200, { names: secrets.names(), encrypted: secrets.encrypted });
    const sm = pathname.match(/^\/api\/secrets\/([A-Za-z0-9_]+)$/);
    if (sm) {
      if (!canEdit(req)) return send(res, 403, { error: 'editing is disabled here: set APP_PASSWORD and log in' });
      if (req.method === 'PUT') {
        try { await secrets.set(sm[1], (await readJson(req)).value); } catch (e) { return send(res, 400, { error: e.message }); }
        return send(res, 200, { saved: sm[1] });
      }
      if (req.method === 'DELETE') { await secrets.remove(sm[1]); return send(res, 200, { deleted: sm[1] }); }
    }
    if (pathname === '/api/curl/import' && req.method === 'POST') {
      if (!canEdit(req)) return send(res, 403, { error: 'editing is disabled here: set APP_PASSWORD and log in' });
      let parsed;
      try { parsed = parseCurl((await readJson(req)).command || ''); }
      catch (e) { if (e instanceof CurlError) return send(res, 400, { error: e.message }); throw e; }
      let probe;
      try { // one real request so the user sees the result straight away
        const r = await fetch(parsed.url, { method: parsed.method, headers: parsed.headers, body: parsed.body === undefined ? undefined : JSON.stringify(parsed.body), signal: AbortSignal.timeout(8000) });
        const text = await r.text();
        let json; try { json = JSON.parse(text); } catch { /* not JSON */ }
        probe = { status: r.status, fields: previewFields(json) };
      } catch (e) { return send(res, 400, { error: `Could not reach ${parsed.host}: ${e.name === 'TimeoutError' ? 'no answer within 8 seconds. The address must be reachable from the computer running this server.' : e.cause?.code || e.message}` }); }
      const taken = secrets.names(), secretNames = [];
      try {
        for (const item of parsed.sensitive) {
          const name = secretNameFor(parsed.host, item, taken);
          await secrets.set(name, item.value);
          taken.push(name);
          secretNames.push({ item, name });
        }
      } catch (e) { return send(res, 400, { error: e.message }); }
      const check = buildCheck(parsed, { status: probe.status, secretNames, existingIds: checks.map((c) => c.id) });
      return send(res, 200, redact({ check, preview: probe, secretsSaved: secretNames.map((s) => s.name) }, secrets.values()));
    }
    if (pathname === '/api/digest/send' && req.method === 'POST') {
      if (!canEdit(req)) return send(res, 403, { error: 'editing is disabled here: set APP_PASSWORD and log in' });
      return send(res, 200, await sendDigest());
    }
    if (pathname === '/api/alerts' && req.method === 'GET') return send(res, 200, { weeklyDigest: WEEKLY_DIGEST, push: { devices: devices.count() }, webhook: Boolean(WEBHOOK_URL), email: mailer ? { enabled: true, to: mailer.maskedTo } : { enabled: false } });
    if (pathname === '/api/alerts/test' && req.method === 'POST') {
      if (!canEdit(req)) return send(res, 403, { error: 'editing is disabled here: set APP_PASSWORD and log in' });
      return send(res, 200, await sendTestAlert({ webhookUrl: WEBHOOK_URL, mailer, push }));
    }
    if (pathname === '/api/devices' && (req.method === 'POST' || req.method === 'DELETE')) {
      const { token, label } = await readJson(req); // any signed-in user may register their own phone
      try {
        if (req.method === 'POST') await devices.add(token, label); else await devices.remove(token);
      } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 200, { devices: devices.count() });
    }
    if (pathname === '/api/stats' && req.method === 'GET') return send(res, 200, stats.summary(checks.map((c) => c.id)));
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
  // weekly report: first one goes out 7 days after the feature is switched on, then every 7 days
  if (WEEKLY_DIGEST) setInterval(async () => {
    if (!mailer && !WEBHOOK_URL) return;
    if (lastDigestAt === undefined) return saveDigestTime(Date.now());
    if (Date.now() - lastDigestAt >= 7 * 86400_000) { await saveDigestTime(Date.now()); await sendDigest(); }
  }, 60_000);
  let busy = false; // never start a new round while the previous one is still running
  setInterval(async () => {
    if (busy) return;
    const due = dueChecks(checks, lastRun, Date.now(), intervalSec);
    if (!due.length) return;
    busy = true;
    try { await runAndRecord(due); } catch (e) { console.error(e); } finally { busy = false; }
  }, TICK_MS);
});
