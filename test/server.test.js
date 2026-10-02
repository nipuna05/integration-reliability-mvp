import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateChecks } from '../lib/checks.js';

const good = [{ id: 'a', name: 'A', steps: [{ name: 's', url: '{{base}}/demo/state' }] }];

test('validateChecks accepts a good check and explains bad ones', () => {
  assert.deepEqual(validateChecks(good), []);
  assert.match(validateChecks('x')[0], /array/);
  const errs = validateChecks([{ id: 'a', steps: [{ url: 'ftp://x', method: 'FETCH' }] }]).join('\n');
  assert.match(errs, /"name" is required/);
  assert.match(errs, /url must start with/);
  assert.match(errs, /unknown method/);
  assert.match(validateChecks([...good, ...good]).join(), /duplicate id/);
});

function startServer(port, env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'irm-'));
  const proc = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, INTERVAL_SEC: '3600', ...env }, stdio: 'ignore' });
  return new Promise((r) => setTimeout(() => r(proc), 1200));
}
const call = (port, p, { method = 'GET', body, headers = {} } = {}) =>
  fetch(`http://localhost:${port}${p}`, { method, body: body && JSON.stringify(body), headers }).then(async (r) => ({ status: r.status, json: await r.json() }));

let locked, open;
before(async () => { [locked, open] = await Promise.all([startServer(3801, { APP_PASSWORD: 'pw123' }), startServer(3802, {})]); });
after(() => { locked.kill(); open.kill(); });

test('with a password: API is locked until login, then checks can be edited', async () => {
  assert.equal((await call(3801, '/api/checks')).status, 401);
  assert.equal((await call(3801, '/api/checks', { method: 'PUT', body: good })).status, 401);
  assert.equal((await call(3801, '/api/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  const { json } = await call(3801, '/api/login', { method: 'POST', body: { password: 'pw123' } });
  const h = { authorization: `Bearer ${json.token}` };
  assert.equal((await call(3801, '/api/checks', { headers: h })).status, 200);
  assert.equal((await call(3801, '/api/checks', { method: 'PUT', body: [{}], headers: h })).status, 400);
  assert.equal((await call(3801, '/api/checks', { method: 'PUT', body: good, headers: h })).json.saved, 1);
  const test = await call(3801, '/api/checks/test', { method: 'POST', body: good, headers: h });
  assert.equal(test.json[0].ok, true);
});

test('without a password: editing works locally but is refused through a proxy/tunnel', async () => {
  assert.equal((await call(3802, '/api/checks')).status, 200); // reading stays open for demos
  assert.equal((await call(3802, '/api/checks', { method: 'PUT', body: good })).status, 200);
  assert.equal((await call(3802, '/api/checks', { method: 'PUT', body: good, headers: { 'cf-connecting-ip': '1.2.3.4' } })).status, 403);
  assert.equal((await call(3802, '/api/checks/test', { method: 'POST', body: good, headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 403);
});
