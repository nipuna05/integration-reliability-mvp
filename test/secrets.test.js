import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSecretStore, redact } from '../lib/secrets.js';
import { validateChecks } from '../lib/checks.js';
import { runCheck } from '../lib/runner.js';
import http from 'node:http';
import { handleDemo } from '../lib/demo.js';

const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'sec-')), 'secrets.json');

test('store keeps values, validates names, and encrypts at rest when a key is set', async () => {
  const file = tmp();
  const s = await createSecretStore(file, 'k1');
  await s.set('API_TOKEN', 'super-secret-value');
  assert.deepEqual(s.names(), ['API_TOKEN']);
  assert.ok(!readFileSync(file, 'utf8').includes('super-secret-value'), 'plaintext leaked to disk');
  assert.equal((await createSecretStore(file, 'k1')).values().API_TOKEN, 'super-secret-value');
  await assert.rejects(createSecretStore(file, 'wrong-key'));
  await assert.rejects(createSecretStore(file, undefined), /SECRETS_KEY/);
  await assert.rejects(s.set('bad name', 'x'), /UPPER_SNAKE_CASE/);
  await assert.rejects(s.set('OK', ''), /value must be/);
  await s.remove('API_TOKEN');
  assert.deepEqual(s.names(), []);
});

test('without a key the store works but is plaintext (UI warns about it)', async () => {
  const file = tmp();
  const s = await createSecretStore(file);
  assert.equal(s.encrypted, false);
  await s.set('A_B', 'v1234');
  assert.equal((await createSecretStore(file)).values().A_B, 'v1234');
});

test('redact removes secret values from nested strings', () => {
  const out = redact({ a: 'got Bearer abc123xyz', b: [{ c: 'x abc123xyz y' }], n: 5 }, { T: 'abc123xyz' });
  assert.equal(JSON.stringify(out).includes('abc123xyz'), false);
  assert.equal(out.n, 5);
});

test('validateChecks flags a check that uses an undefined secret', () => {
  const chk = [{ id: 'a', name: 'A', steps: [{ name: 's', url: 'https://x.test', headers: { authorization: 'Bearer {{secret.MISSING}}' } }] }];
  assert.match(validateChecks(chk, ['OTHER']).join(), /secret "MISSING"/);
  assert.deepEqual(validateChecks(chk, ['MISSING']), []);
});

test('runner sends the secret but never returns it, even when the API echoes it back', async () => {
  const server = http.createServer((req, res) => handleDemo(req, res, new URL(req.url, 'http://x').pathname));
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const ok = { id: 'k', name: 'K', steps: [{ name: 'ping', url: '{{base}}/demo/secure/ping', headers: { authorization: 'Bearer {{secret.KEY}}' }, expect: { status: 200 } }] };
    assert.equal((await runCheck(ok, { base }, { secrets: { KEY: 'demo-key-123' } })).ok, true);
    assert.equal((await runCheck(ok, { base }, { secrets: { KEY: 'wrong-key-000' } })).ok, false);

    const echo = { id: 'e', name: 'E', steps: [{ name: 'echo', url: '{{base}}/demo/secure/echo', headers: { authorization: 'Bearer {{secret.KEY}}' }, expect: { json: { received: 'nope' } } }] };
    const r = await runCheck(echo, { base }, { secrets: { KEY: 'topsecret-987' } });
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(r).includes('topsecret-987'), false, 'secret leaked into the result');
    assert.match(JSON.stringify(r), /\*\*\*/);
  } finally { server.close(); }
});
