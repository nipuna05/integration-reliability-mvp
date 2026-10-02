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

test('a template check runs end to end and catches the silent bug', async () => {
  const { json: check } = await call(3802, '/api/templates/instantiate', { method: 'POST', body: { templateId: 'hr-to-payroll', values: {} } });
  const run = async () => (await call(3802, '/api/checks/test', { method: 'POST', body: [check] })).json[0];
  assert.equal((await run()).ok, true);
  await call(3802, '/demo/break', { method: 'POST', body: { broken: true } });
  const bad = await run();
  assert.equal(bad.ok, false);
  assert.equal(bad.failedStep, 'Payroll salary matches HR salary');
  await call(3802, '/demo/break', { method: 'POST', body: { broken: false } });
});

test('PUBLIC_DEMO: guests can view and run, but not edit or use the editor APIs', async () => {
  const p = await startServer(3803, { APP_PASSWORD: 'pw123', PUBLIC_DEMO: '1' });
  try {
    assert.equal((await call(3803, '/api/checks')).status, 200);
    assert.equal((await call(3803, '/api/history')).status, 200);
    assert.equal((await call(3803, '/api/run', { method: 'POST' })).status, 200);
    assert.equal((await call(3803, '/api/checks', { method: 'PUT', body: good })).status, 401);
    assert.equal((await call(3803, '/api/checks/test', { method: 'POST', body: good })).status, 401);
    assert.equal((await call(3803, '/api/templates')).status, 401);
    const s = (await call(3803, '/api/session')).json;
    assert.deepEqual([s.authed, s.canEdit, s.publicRead], [false, false, true]);
  } finally { p.kill(); }
});

test('secrets API: names only, locked without login, used by a check', async () => {
  const p = await startServer(3804, { APP_PASSWORD: 'pw123', SECRETS_KEY: 'test-key' });
  try {
    const { json } = await call(3804, '/api/login', { method: 'POST', body: { password: 'pw123' } });
    const h = { authorization: `Bearer ${json.token}` };
    assert.equal((await call(3804, '/api/secrets')).status, 401);
    assert.equal((await call(3804, '/api/secrets/DEMO_KEY', { method: 'PUT', body: { value: 'demo-key-123' } })).status, 401);
    assert.equal((await call(3804, '/api/secrets/DEMO_KEY', { method: 'PUT', body: { value: 'demo-key-123' }, headers: h })).status, 200);
    assert.equal((await call(3804, '/api/secrets/bad name!', { method: 'PUT', body: { value: 'x' }, headers: h })).status, 404);
    const list = (await call(3804, '/api/secrets', { headers: h })).json;
    assert.deepEqual(list, { names: ['DEMO_KEY'], encrypted: true });
    const chk = [{ id: 's', name: 'S', steps: [{ name: 'ping', url: '{{base}}/demo/secure/ping', headers: { authorization: 'Bearer {{secret.DEMO_KEY}}' }, expect: { status: 200 } }] }];
    assert.equal((await call(3804, '/api/checks/test', { method: 'POST', body: chk, headers: h })).json[0].ok, true);
    const unknown = JSON.parse(JSON.stringify(chk).replace('DEMO_KEY', 'NOPE'));
    assert.equal((await call(3804, '/api/checks/test', { method: 'POST', body: unknown, headers: h })).status, 400);
  } finally { p.kill(); }
});

test('a failing run carries a plain-English explanation', async () => {
  const { json: check } = await call(3802, '/api/templates/instantiate', { method: 'POST', body: { templateId: 'hr-to-payroll', values: {} } });
  await call(3802, '/demo/break', { method: 'POST', body: { broken: true } });
  const bad = (await call(3802, '/api/checks/test', { method: 'POST', body: [check] })).json[0];
  await call(3802, '/demo/break', { method: 'POST', body: { broken: false } });
  assert.equal(bad.ok, false);
  assert.match(bad.explanation.text, /rounded down to the nearest 1000/);
});

test('curl import: calls the API once, stores the key as a secret, returns a runnable check', async () => {
  const p = await startServer(3805, { APP_PASSWORD: 'pw123' });
  try {
    const { json } = await call(3805, '/api/login', { method: 'POST', body: { password: 'pw123' } });
    const h = { authorization: `Bearer ${json.token}` };
    const cmd = `curl http://localhost:3805/demo/secure/ping -H 'Authorization: Bearer demo-key-123'`;
    assert.equal((await call(3805, '/api/curl/import', { method: 'POST', body: { command: cmd } })).status, 401);
    const r = await call(3805, '/api/curl/import', { method: 'POST', body: { command: cmd }, headers: h });
    assert.equal(r.status, 200);
    assert.equal(r.json.preview.status, 200);
    assert.deepEqual(r.json.preview.fields, [{ path: 'status', value: 'ok' }]);
    assert.equal(JSON.stringify(r.json).includes('demo-key-123'), false, 'key leaked in the response');
    assert.equal(r.json.secretsSaved.length, 1);
    const run = await call(3805, '/api/checks/test', { method: 'POST', body: [r.json.check], headers: h });
    assert.equal(run.json[0].ok, true);
    const bad = await call(3805, '/api/curl/import', { method: 'POST', body: { command: 'curl -F a=b http://x.test' }, headers: h });
    assert.equal(bad.status, 400);
  } finally { p.kill(); }
});

import { fakeSmtp } from '../test-support/fake-smtp.js';

test('server: test alert goes out by email, status endpoint shows masked address, guests cannot trigger it', async () => {
  const { server, log, port } = await fakeSmtp();
  const p = await startServer(3806, { APP_PASSWORD: 'pw123', PUBLIC_DEMO: '1', SMTP_HOST: 'localhost', SMTP_PORT: String(port), SMTP_SECURE: '0', ALERT_EMAIL_FROM: 'alerts@x.test', ALERT_EMAIL_TO: 'alice@example.test' });
  try {
    assert.equal((await call(3806, '/api/alerts/test', { method: 'POST' })).status, 401);
    const { json } = await call(3806, '/api/login', { method: 'POST', body: { password: 'pw123' } });
    const h = { authorization: `Bearer ${json.token}` };
    assert.deepEqual((await call(3806, '/api/alerts', { headers: h })).json, { weeklyDigest: false, webhook: false, email: { enabled: true, to: ['a***@example.test'] } });
    const t = await call(3806, '/api/alerts/test', { method: 'POST', headers: h });
    assert.equal(t.json.email, 'sent');
    assert.ok(log.cmds.includes('RCPT TO:<alice@example.test>'));
    assert.match(Buffer.from(log.data.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString(), /Test alert/);
  } finally { p.kill(); server.close(); }
});

test('stats: a break and a fix produce an incident with a duration and lowered uptime; guests can read it', async () => {
  const p = await startServer(3807, { APP_PASSWORD: 'pw123', PUBLIC_DEMO: '1' });
  try {
    const { json } = await call(3807, '/api/login', { method: 'POST', body: { password: 'pw123' } });
    const h = { authorization: `Bearer ${json.token}` };
    const checkId = (await call(3807, '/api/checks')).json[0].id;
    await call(3807, '/api/run', { method: 'POST' });
    await call(3807, '/demo/break', { method: 'POST', body: { broken: true } });
    await call(3807, '/api/run', { method: 'POST' });
    await call(3807, '/api/run', { method: 'POST' });
    await new Promise((r) => setTimeout(r, 1100));
    await call(3807, '/demo/break', { method: 'POST', body: { broken: false } });
    await call(3807, '/api/run', { method: 'POST' });

    const guest = await call(3807, '/api/stats'); // no login: public demo
    assert.equal(guest.status, 200);
    const s = guest.json;
    assert.equal(s.incidents.length, 1, 'two failing runs in a row are ONE incident');
    const i = s.incidents[0];
    assert.equal(i.checkId, checkId);
    assert.equal(i.ongoing, false);
    assert.ok(i.durationSec >= 1);
    assert.match(i.failure, /monthlySalary/);
    assert.match(i.cause, /rounded down/);
    const up = s.checks[checkId].uptime7d;
    assert.equal(up.runs >= 4, true);
    assert.equal(up.pct < 100 && up.pct > 0, true);
  } finally { p.kill(); }
});

test('weekly report: signed-in users can send it by email now; guests cannot', async () => {
  const { server, log, port } = await fakeSmtp();
  const p = await startServer(3808, { APP_PASSWORD: 'pw123', PUBLIC_DEMO: '1', WEEKLY_DIGEST: '1', SMTP_HOST: 'localhost', SMTP_PORT: String(port), SMTP_SECURE: '0', ALERT_EMAIL_FROM: 'alerts@x.test', ALERT_EMAIL_TO: 'alice@example.test' });
  try {
    assert.equal((await call(3808, '/api/digest/send', { method: 'POST' })).status, 401);
    const { json } = await call(3808, '/api/login', { method: 'POST', body: { password: 'pw123' } });
    const h = { authorization: `Bearer ${json.token}` };
    assert.equal((await call(3808, '/api/alerts', { headers: h })).json.weeklyDigest, true);
    await call(3808, '/api/run', { method: 'POST' });
    const r = await call(3808, '/api/digest/send', { method: 'POST', headers: h });
    assert.equal(r.json.email, 'sent');
    assert.ok(log.cmds.includes('RCPT TO:<alice@example.test>'));
    const body = Buffer.from(log.data.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString();
    assert.match(body, /Reliability report/);
    assert.match(body, /Uptime \(last 7 days\)/);
  } finally { p.kill(); server.close(); }
});

test('public status page: off by default; when on, readable by anyone, shows outage, leaks nothing, respects "public": false', async () => {
  const off = await startServer(3809, { APP_PASSWORD: 'pw123' });
  const on = await startServer(3810, { APP_PASSWORD: 'pw123', STATUS_PAGE: '1', STATUS_TITLE: 'Acme status' });
  try {
    assert.equal((await fetch('http://localhost:3809/status')).status, 404);
    assert.equal((await call(3809, '/api/public-status')).status, 404);

    const page = await fetch('http://localhost:3810/status');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Service status/);

    const { json } = await call(3810, '/api/login', { method: 'POST', body: { password: 'pw123' } });
    const h = { authorization: `Bearer ${json.token}` };
    const secretCheck = { id: 'internal', name: 'Hidden check', public: false, steps: [{ name: 's', url: '{{base}}/demo/secure/ping', headers: { authorization: 'Bearer demo-key-123' }, expect: { status: 200 } }] };
    const shown = { id: 'hr', name: 'Payroll sync', steps: [{ name: 'Check salary', url: '{{base}}/demo/hr/employees/E999', expect: { status: 200 } }] };
    assert.equal((await call(3810, '/api/checks', { method: 'PUT', headers: h, body: [shown, secretCheck] })).status, 200);
    await call(3810, '/api/run', { method: 'POST', headers: h });

    const pub = await call(3810, '/api/public-status'); // no login at all
    assert.equal(pub.status, 200);
    assert.equal(pub.json.title, 'Acme status');
    assert.deepEqual(pub.json.checks.map((c) => c.name), ['Payroll sync']);
    assert.equal(pub.json.checks[0].status, 'failing');
    assert.equal(pub.json.overall, 'outage');
    const text = JSON.stringify(pub.json);
    for (const leak of ['demo-key-123', 'E999', '/demo/', 'Hidden check', 'expected status', '404']) assert.equal(text.includes(leak), false, `leaked: ${leak}`);
    assert.equal((await call(3810, '/api/session', { headers: h })).json.statusPage, true);
    assert.equal((await call(3810, '/api/checks', { method: 'PUT', headers: h, body: [{ ...shown, public: 'yes' }] })).status, 400);
  } finally { off.kill(); on.kill(); }
});
