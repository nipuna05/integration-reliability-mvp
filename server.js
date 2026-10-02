import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAll } from './lib/runner.js';
import { handleDemo } from './lib/demo.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HISTORY_FILE = path.join(root, 'data', 'history.json');
const MAX_HISTORY = 200;

const checks = JSON.parse(await readFile(path.join(root, 'checks.json'), 'utf8'));
let history = existsSync(HISTORY_FILE) ? JSON.parse(await readFile(HISTORY_FILE, 'utf8')) : [];

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function runAndRecord() {
  const results = await runAll(checks, { base: `http://localhost:${PORT}` });
  history = [...results, ...history].slice(0, MAX_HISTORY);
  await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await writeFile(HISTORY_FILE,JSON.stringify(history, null, 2)).catch(() => {});
  const failed = results.filter((r) => !r.ok);
  for (const f of failed) console.log(`ALERT  ${f.name} — failed at "${f.failedStep}": ${f.failures.join('; ')}`);
  return results;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname.startsWith('/demo/')) return await handleDemo(req, res, pathname);
    if (pathname === '/healthz') return send(res, 200, { ok: true });
    if (pathname === '/api/checks') return send(res, 200, checks);
    if (pathname === '/api/history') return send(res, 200, history);
    if (pathname === '/api/run' && req.method === 'POST') return send(res, 200, await runAndRecord());
    if (pathname === '/') return send(res, 200, await readFile(path.join(root, 'public', 'index.html'), 'utf8'), 'text/html');
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

const intervalSec = Number(process.env.INTERVAL_SEC || 60);
server.listen(PORT, () => {
  console.log(`Integration Reliability MVP on http://localhost:${PORT}  (scheduled run every ${intervalSec}s)`);
  setInterval(() => runAndRecord().catch(console.error), intervalSec * 1000);
});
