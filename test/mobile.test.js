import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApi, ApiError } from '../mobile/src/api.js';
import { fmtDuration, fmtAgo, normalizeUrl, overallState, uniqueCheck, scheduleLabel, lastRunFor } from '../mobile/src/format.js';

test('formatting helpers', () => {
  assert.deepEqual([5, 125, 3600, 5400, 90000].map(fmtDuration), ['5s', '2m 5s', '1h', '1h 30m', '1d']);
  const now = new Date('2026-10-10T12:00:00Z').getTime();
  assert.deepEqual(['2026-10-10T11:59:50Z', '2026-10-10T11:50:00Z', '2026-10-10T09:00:00Z', '2026-10-07T12:00:00Z'].map((t) => fmtAgo(t, now)), ['just now', '10 min ago', '3 h ago', '3 d ago']);
  assert.deepEqual(['192.168.1.5:3000/', ' https://x.test/// ', 'http://a.test', '', null].map(normalizeUrl), ['http://192.168.1.5:3000', 'https://x.test', 'http://a.test', '', '']);
  assert.deepEqual([{}, { every: '5m' }, { every: '2h' }, { every: '1d' }, { every: '90s' }].map((c) => scheduleLabel(c, 60)), ['every 1m', 'every 5m', 'every 2h', 'every 1d', 'every 90s']);
});

test('overallState: unknown until something ran, bad if any check is failing', () => {
  const checks = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(overallState(checks, []), { state: 'unknown', failing: 0, total: 2 });
  assert.deepEqual(overallState(checks, [{ id: 'a', ok: true }]), { state: 'ok', failing: 0, total: 2 });
  assert.deepEqual(overallState(checks, [{ id: 'b', ok: false }, { id: 'a', ok: true }, { id: 'b', ok: true }]), { state: 'bad', failing: 1, total: 2 });
  assert.equal(lastRunFor([{ id: 'x', n: 2 }, { id: 'x', n: 1 }], 'x').n, 2, 'history is newest-first');
});

test('uniqueCheck numbers duplicate ids and names', () => {
  const list = [{ id: 'a', name: 'A' }, { id: 'a-2', name: 'A (2)' }];
  const c = uniqueCheck(list, { id: 'a', name: 'A' });
  assert.deepEqual([c.id, c.name], ['a-3', 'A (3)']);
});

test('api: unreachable server and error responses become readable ApiErrors', async () => {
  const down = createApi({ baseUrl: 'http://x.test', fetchFn: async () => { throw new Error('boom'); } });
  await assert.rejects(down.checks(), (e) => e instanceof ApiError && e.status === 0 && /Cannot reach http:\/\/x.test/.test(e.message));
  const bad = createApi({ baseUrl: 'http://x.test', fetchFn: async () => ({ ok: false, status: 400, json: async () => ({ errors: ['line one', 'line two'] }) }) });
  await assert.rejects(bad.checks(), /line one\nline two/);
  const html = createApi({ baseUrl: 'http://x.test', fetchFn: async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }) });
  await assert.rejects(html.checks(), /answered 502/);
});

test('api: sends the token as a Bearer header only when signed in', async () => {
  const seen = [];
  const fetchFn = async (url, o) => { seen.push(o.headers); return { ok: true, json: async () => ({}) }; };
  await createApi({ baseUrl: 'http://x.test', fetchFn }).checks();
  await createApi({ baseUrl: 'http://x.test', token: 'T0K', fetchFn }).checks();
  assert.equal(seen[0].authorization, undefined);
  assert.equal(seen[1].authorization, 'Bearer T0K');
});

// ---- the same client against the REAL server, to prove the contract the phone app relies on ----
let server;
const PORT = 3813;
const base = `http://localhost:${PORT}`;
before(async () => {
  server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'mob-')), APP_PASSWORD: 'phone-pw', PUBLIC_DEMO: '1', INTERVAL_SEC: '3600' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
});
after(() => server.kill());

test('real server: guest can read and run, cannot edit; sign-in unlocks everything the app needs', async () => {
  const guest = createApi({ baseUrl: base });
  const s = await guest.session();
  assert.deepEqual([s.authRequired, s.authed, s.publicRead, s.canEdit], [true, false, true, false]);
  assert.ok((await guest.checks()).length >= 1);
  assert.ok(Array.isArray(await guest.run()));
  assert.ok((await guest.stats()).incidents);
  await assert.rejects(guest.curlImport('curl http://x.test'), (e) => e.status === 401);

  await assert.rejects(createApi({ baseUrl: base }).login('wrong'), (e) => e.status === 401);
  const token = await createApi({ baseUrl: base }).login('phone-pw');
  const api = createApi({ baseUrl: base, token });
  assert.equal((await api.session()).canEdit, true);

  // add a check from a pasted curl command, ticking one response field
  const imp = await api.curlImport(`curl ${base}/demo/secure/ping -H 'Authorization: Bearer demo-key-123'`);
  assert.equal(imp.preview.status, 200);
  assert.equal(JSON.stringify(imp).includes('demo-key-123'), false);
  const before2 = (await api.checks()).length;
  const added = await api.addCheck(imp.check, imp.preview.fields);
  assert.equal((await api.checks()).length, before2 + 1);
  assert.deepEqual(added.steps[0].expect.json, { status: 'ok' });
  const again = await api.addCheck(imp.check);               // same check twice must not collide
  assert.notEqual(again.id, added.id);
  assert.equal((await api.run()).every((r) => r.ok), true);

  // phone registration
  const phone = 'ExponentPushToken[abcdefghijklmnop]';
  assert.equal((await api.registerDevice(phone, 'Test phone')).devices, 1);
  await assert.rejects(api.registerDevice('nonsense'), (e) => e.status === 400);
  assert.equal((await api.alerts()).push.devices, 1);
  assert.equal((await api.unregisterDevice(phone)).devices, 0);
});
