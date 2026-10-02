import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeviceStore, createPush, TOKEN_RE } from '../lib/push.js';
import { dispatch, sendTestAlert } from '../lib/alerts.js';

const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'push-')), 'devices.json');
const tok = (n) => `ExponentPushToken[abcdefghij${String(n).padStart(4, '0')}]`;

test('token format: accepts Expo tokens, rejects everything else', () => {
  assert.ok(TOKEN_RE.test('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'));
  assert.ok(TOKEN_RE.test('ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]'));
  for (const bad of ['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'https://evil.test', null, undefined]) assert.equal(TOKEN_RE.test(bad), false, String(bad));
});

test('device store: add (no duplicates), persist, remove, refuse bad tokens', async () => {
  const file = tmp();
  const s = await createDeviceStore(file);
  await s.add(tok(1), 'Pixel'); await s.add(tok(1)); await s.add(tok(2));
  assert.equal(s.count(), 2);
  await assert.rejects(s.add('nonsense'), /Expo push token/);
  assert.equal((await createDeviceStore(file)).count(), 2, 'survives restart');
  await s.remove(tok(1));
  assert.deepEqual(s.tokens(), [tok(2)]);
});

test('push: sends one message per device with title/body/data, counts successes', async () => {
  const store = await createDeviceStore(tmp());
  await store.add(tok(1)); await store.add(tok(2));
  let seen;
  const fetchFn = async (url, o) => { seen = { url, body: JSON.parse(o.body) }; return { ok: true, json: async () => ({ data: seen.body.map(() => ({ status: 'ok' })) }) }; };
  const r = await createPush({ store, fetchFn }).send('🔴 Failed: Salary sync', 'monthlySalary: expected 125750, got 125000', { checkId: 'hr' });
  assert.equal(r.sent, 2);
  assert.equal(seen.url, 'https://exp.host/--/api/v2/push/send');
  assert.deepEqual(seen.body.map((m) => m.to), [tok(1), tok(2)]);
  assert.equal(seen.body[0].title, '🔴 Failed: Salary sync');
  assert.equal(seen.body[0].data.checkId, 'hr');
  assert.equal(seen.body[0].priority, 'high');
});

test('push: a device that uninstalled the app is removed automatically', async () => {
  const store = await createDeviceStore(tmp());
  await store.add(tok(1)); await store.add(tok(2));
  const fetchFn = async () => ({ ok: true, json: async () => ({ data: [{ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }, { status: 'ok' }] }) });
  const r = await createPush({ store, fetchFn }).send('t', 'b');
  assert.deepEqual([r.sent, r.removed], [1, 1]);
  assert.deepEqual(store.tokens(), [tok(2)]);
});

test('push: more than 100 devices are sent in batches of 100', async () => {
  const store = await createDeviceStore(tmp());
  for (let i = 0; i < 230; i++) await store.add(tok(i));
  const sizes = [];
  const fetchFn = async (u, o) => { const b = JSON.parse(o.body); sizes.push(b.length); return { ok: true, json: async () => ({ data: b.map(() => ({ status: 'ok' })) }) }; };
  const r = await createPush({ store, fetchFn }).send('t', 'b');
  assert.deepEqual(sizes, [100, 100, 30]);
  assert.equal(r.sent, 230);
});

test('push never throws: network errors and HTTP errors are reported, not raised', async () => {
  const store = await createDeviceStore(tmp());
  await store.add(tok(1));
  const down = await createPush({ store, fetchFn: async () => { throw new Error('network down'); } }).send('t', 'b');
  assert.match(down.errors[0], /network down/);
  const http = await createPush({ store, fetchFn: async () => ({ ok: false, status: 503 }) }).send('t', 'b');
  assert.match(http.errors[0], /503/);
  assert.equal(store.count(), 1, 'a temporary failure must not drop the device');
});

test('dispatch pushes on failure and recovery, and a broken push does not stop email/chat', async () => {
  const pushed = [], hooks = [];
  const push = { enabled: () => true, send: async (t, b, d) => pushed.push([t, b, d]) };
  const ev = (type) => ({ type, check: { id: 'hr', name: 'Salary sync', failedStep: 's', failures: ['bad'], explanation: { text: 'rounded' } } });
  await dispatch([ev('failed'), ev('recovered')], { webhookUrl: 'http://x', send: async (u, t) => hooks.push(t), push });
  assert.deepEqual(pushed.map((p) => p[0]), ['🔴 Failed: Salary sync', '✅ Recovered: Salary sync']);
  assert.match(pushed[0][1], /bad/);
  assert.equal(pushed[0][2].checkId, 'hr');
  const broken = { enabled: () => true, send: async () => { throw new Error('push exploded'); } };
  await dispatch([ev('failed')], { webhookUrl: 'http://x', send: async (u, t) => hooks.push(t), push: broken });
  assert.equal(hooks.length, 3, 'chat alert still sent');
});

test('test alert reports the push channel too', async () => {
  const push = { enabled: () => true, send: async () => ({ sent: 2, removed: 0, errors: [] }) };
  assert.equal((await sendTestAlert({ push })).push, 'sent to 2 device(s)');
  assert.equal((await sendTestAlert({})).push, 'no phones registered');
  const bad = { enabled: () => true, send: async () => ({ sent: 0, removed: 0, errors: ['Expo returned 503'] }) };
  assert.match((await sendTestAlert({ push: bad })).push, /failed: Expo returned 503/);
});
