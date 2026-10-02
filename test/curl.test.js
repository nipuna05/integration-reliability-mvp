import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCurl, buildCheck, secretNameFor, previewFields, CurlError } from '../lib/curl.js';
import { validateChecks } from '../lib/checks.js';

test('parses method, headers, JSON body, line continuations and quotes', () => {
  const p = parseCurl(`curl -s -X POST 'https://api.test.io/v1/users?x=1' \\
    -H "Content-Type: application/json" \\
    -H 'X-Trace: a b' \\
    -d '{"name":"Bob","n":2}'`);
  assert.equal(p.method, 'POST');
  assert.equal(p.url, 'https://api.test.io/v1/users?x=1');
  assert.equal(p.headers['x-trace'], 'a b');
  assert.deepEqual(p.body, { name: 'Bob', n: 2 });
});

test('body without -X means POST; no body means GET; scheme added when missing', () => {
  assert.equal(parseCurl(`curl api.test.io/a -d '{"a":1}'`).method, 'POST');
  const g = parseCurl('curl api.test.io/a');
  assert.equal(g.method, 'GET');
  assert.equal(g.url, 'https://api.test.io/a');
});

test("Chrome-style $'...' quoting works, including an escaped quote", () => {
  assert.deepEqual(parseCurl(`curl https://x.test -d $'{"a":"it\\'s"}'`).body, { a: "it's" });
});

test('clear errors for things we cannot import', () => {
  assert.throws(() => parseCurl('wget x'), CurlError);
  assert.throws(() => parseCurl('curl -F a=b https://x.test'), /Multipart/);
  assert.throws(() => parseCurl(`curl https://x.test -d 'a=1&b=2'`), /JSON/);
  assert.throws(() => parseCurl('curl -X TRACE https://x.test'), /not supported/);
  assert.throws(() => parseCurl('curl'), CurlError);
});

test('keys in headers, -u and the query string are flagged as sensitive', () => {
  const p = parseCurl(`curl 'https://x.test/a?api_key=K123&page=2' -H 'Authorization: Bearer T0K' -H 'X-Api-Key: abc' -u bob:pw`);
  const keys = p.sensitive.map((s) => `${s.where}:${s.key}`).sort();
  assert.deepEqual(keys, ['header:authorization', 'header:x-api-key', 'query:api_key']);
});

test('buildCheck replaces sensitive values with {{secret.X}} and the result validates', () => {
  const p = parseCurl(`curl 'https://x.test/a?api_key=K123&page=2' -H 'Authorization: Bearer T0K'`);
  const names = p.sensitive.map((item) => ({ item, name: secretNameFor(p.host, item, []) }));
  const check = buildCheck(p, { status: 200, secretNames: names, existingIds: ['x-test-a'] });
  const text = JSON.stringify(check);
  assert.equal(text.includes('T0K') || text.includes('K123'), false, 'key leaked into the check');
  assert.match(check.steps[0].url, /api_key=\{\{secret\.X_TEST_API_KEY\}\}&page=2/);
  assert.equal(check.id, 'x-test-a-2');
  assert.deepEqual(validateChecks([check], names.map((n) => n.name)), []);
});

test('previewFields lists stable-looking simple fields only', () => {
  const f = previewFields({ status: 'ok', n: 3, big: 'x'.repeat(100), list: [1], nested: { plan: 'pro' } });
  assert.deepEqual(f.map((x) => x.path), ['status', 'n', 'nested.plan']);
});
