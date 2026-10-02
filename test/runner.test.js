import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { runCheck, render, getPath } from '../lib/runner.js';
import { handleDemo, state } from '../lib/demo.js';

test('render fills known vars and leaves unknown ones', () => {
  assert.equal(render('a-{{x}}-{{y}}', { x: 1 }), 'a-1-{{y}}');
});

test('getPath reads nested values', () => {
  assert.equal(getPath({ a: { b: 2 } }, 'a.b'), 2);
  assert.equal(getPath({}, 'a.b'), undefined);
});

async function withDemoServer(fn) {
  const server = http.createServer((req, res) => handleDemo(req, res, new URL(req.url, 'http://x').pathname));
  await new Promise((r) => server.listen(0, r));
  try { await fn(`http://localhost:${server.address().port}`); } finally { server.close(); }
}

test('sample check passes when sync is healthy and fails when it silently breaks', async () => {
  const [check] = JSON.parse(await readFile(new URL('../checks.json', import.meta.url), 'utf8'));
  await withDemoServer(async (base) => {
    state.broken = false;
    const ok = await runCheck(check, { base });
    assert.equal(ok.ok, true);

    state.broken = true;
    const bad = await runCheck(check, { base });
    assert.equal(bad.ok, false);
    assert.equal(bad.failedStep, 'Payroll salary matches HR salary');
    state.broken = false;
  });
});

test('unreachable system fails the step instead of throwing', async () => {
  const r = await runCheck({ id: 'x', name: 'x', steps: [{ name: 's', url: 'http://localhost:1/nope' }] }, {}, { timeoutMs: 500 });
  assert.equal(r.ok, false);
});

import { detectTransitions, dispatch } from '../lib/alerts.js';

const res = (ok) => ({ id: 'c', name: 'C', ok, failedStep: ok ? null : 's', failures: ok ? [] : ['bad'] });

test('alerts fire only on status changes', () => {
  const last = new Map();
  assert.equal(detectTransitions(last, [res(true)]).length, 0);   // first pass: quiet
  assert.equal(detectTransitions(last, [res(false)])[0].type, 'failed');
  assert.equal(detectTransitions(last, [res(false)]).length, 0);  // still failing: no spam
  assert.equal(detectTransitions(last, [res(true)])[0].type, 'recovered');
});

test('first-ever failure alerts, and webhook receives the message', async () => {
  const events = detectTransitions(new Map(), [res(false)]);
  assert.equal(events.length, 1);
  const sent = [];
  await dispatch(events, { webhookUrl: 'http://x', send: async (u, t) => sent.push(t) });
  assert.match(sent[0], /FAILED: C/);
});
