import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseEvery, formatEvery, dueChecks, trimHistory, intervalFor } from '../lib/schedule.js';
import { validateChecks } from '../lib/checks.js';

test('parseEvery understands s/m/h/d and rejects everything else', () => {
  assert.equal(parseEvery('30s'), 30);
  assert.equal(parseEvery('5m'), 300);
  assert.equal(parseEvery('2h'), 7200);
  assert.equal(parseEvery('1d'), 86400);
  assert.equal(parseEvery(' 5M '), 300);
  for (const bad of ['soon', '5', 'm5', '5 minutes', '', '-5m', '1.5h', null, undefined]) assert.equal(parseEvery(bad), null, String(bad));
});

test('formatEvery gives short readable text', () => {
  assert.deepEqual([30, 60, 300, 3600, 7200, 86400, 90].map(formatEvery), ['30s', '1m', '5m', '1h', '2h', '1d', '90s']);
});

test('dueChecks: never-run checks are due; others when their own interval has passed', () => {
  const checks = [{ id: 'fast', every: '1m' }, { id: 'slow', every: '1h' }, { id: 'default' }, { id: 'new' }];
  const last = new Map([['fast', 0], ['slow', 0], ['default', 0]]);
  const ids = (now) => dueChecks(checks, last, now, 300).map((c) => c.id);
  assert.deepEqual(ids(30_000), ['new']);                         // only the never-run one
  assert.deepEqual(ids(60_000), ['fast', 'new']);                 // fast is due after 1m
  assert.deepEqual(ids(300_000), ['fast', 'default', 'new']);     // default (300s) is due now
  assert.deepEqual(ids(3_600_000), ['fast', 'slow', 'default', 'new']);
  assert.equal(intervalFor({ every: '5m' }, 60), 300);
  assert.equal(intervalFor({}, 60), 60);
});

test('trimHistory keeps the newest runs of every check separately', () => {
  const h = [...Array(5)].map((_, i) => ({ id: 'a', n: i })).concat([{ id: 'b', n: 0 }, { id: 'a', n: 9 }]);
  const out = trimHistory(h, 3);
  assert.equal(out.filter((x) => x.id === 'a').length, 3);
  assert.equal(out.filter((x) => x.id === 'b').length, 1, 'rare check must survive');
  assert.deepEqual(out.filter((x) => x.id === 'a').map((x) => x.n), [0, 1, 2]); // newest-first order preserved
});

test('validateChecks refuses bad schedules with a clear message', () => {
  const mk = (every) => [{ id: 'a', name: 'A', every, steps: [{ name: 's', url: 'https://x.test' }] }];
  assert.deepEqual(validateChecks(mk('5m')), []);
  assert.deepEqual(validateChecks([{ id: 'a', name: 'A', steps: [{ name: 's', url: 'https://x.test' }] }]), []);
  assert.match(validateChecks(mk('soon')).join(), /must look like 30s, 5m, 1h or 1d/);
  assert.match(validateChecks(mk('5s')).join(), /at least 30s/);
  assert.match(validateChecks(mk('8d')).join(), /at most 7d/);
  assert.deepEqual(validateChecks(mk('5s'), undefined, { minSec: 1 }), []);
});

test('server runs each check on its own schedule', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sched-'));
  const port = 3811;
  const p = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, APP_PASSWORD: 'pw', INTERVAL_SEC: '3600', MIN_INTERVAL_SEC: '1', TICK_MS: '200' }, stdio: 'ignore' });
  const call = (p2, o = {}) => fetch(`http://localhost:${port}${p2}`, { ...o, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());
  try {
    await new Promise((r) => setTimeout(r, 1200));
    const { token } = await call('/api/login', { method: 'POST', body: { password: 'pw' } });
    const h = { authorization: `Bearer ${token}` };
    const step = [{ name: 's', url: '{{base}}/demo/state' }];
    const saved = await call('/api/checks', { method: 'PUT', headers: h, body: [
      { id: 'fast', name: 'Fast', every: '1s', steps: step },
      { id: 'slow', name: 'Slow (default 1h)', steps: step },
    ] });
    assert.equal(saved.saved, 2);
    const bad = await call('/api/checks', { method: 'PUT', headers: h, body: [{ id: 'x', name: 'X', every: '500ms', steps: step }] });
    assert.ok(bad.errors, 'bad schedule must be refused');
    await new Promise((r) => setTimeout(r, 4500));
    const hist = await call('/api/history', { headers: h });
    const count = (id) => hist.filter((x) => x.id === id).length;
    assert.ok(count('fast') >= 3, `fast check should have run several times, ran ${count('fast')}`);
    assert.equal(count('slow'), 1, `slow check should have run exactly once, ran ${count('slow')}`);
    const sess = await call('/api/session', { headers: h });
    assert.deepEqual([sess.defaultIntervalSec, sess.minIntervalSec], [3600, 1]);
  } finally { p.kill(); }
});
