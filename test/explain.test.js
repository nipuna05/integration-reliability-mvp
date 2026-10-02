import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainByRules, createExplainer } from '../lib/explain.js';

const fail = (failures, failedStep = 'Payroll salary matches HR salary') => ({ id: 'c', name: 'C', failedStep, failures, steps: [{ name: failedStep, ok: false, status: 200 }] });

test('rules: truncated number is called out as rounding', () => {
  const t = explainByRules(fail(['monthlySalary: expected 125750, got 125000']));
  assert.match(t, /rounded down to the nearest 1000/);
  assert.match(t, /monthlySalary/);
});

test('rules: other numeric mismatch shows the difference', () => {
  assert.match(explainByRules(fail(['total: expected 100, got 130'])), /difference 30/);
});

test('rules: missing field, auth, not found, server error, timeout, case difference', () => {
  assert.match(explainByRules(fail(['name: expected "Bob", got undefined'])), /missing in the response/);
  assert.match(explainByRules(fail(['expected status 200, got 401'])), /API key or token/);
  assert.match(explainByRules(fail(['expected status 200, got 404'])), /not found/);
  assert.match(explainByRules(fail(['expected status 200, got 503'])), /server side/);
  assert.match(explainByRules(fail(['timed out after 5000ms'])), /did not answer within 5000ms/);
  assert.match(explainByRules(fail(['email: expected "A@x.com", got "a@x.com"'])), /letter case/);
});

test('without an API key the rules are used and the result is cached', async () => {
  const explain = createExplainer({});
  const r = fail(['monthlySalary: expected 125750, got 125000']);
  const a = await explain(r);
  assert.equal(a.source, 'rules');
  assert.equal(await explain(r), a);
});

test('with an API key the AI answer is used, called once per distinct failure, key never in the text', async () => {
  let calls = 0, sent;
  const fetchFn = async (url, opts) => { calls++; sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Probably rounding. Check Payroll. key=sk-secret-1' }] }) }; };
  const explain = createExplainer({ apiKey: 'sk-test', fetchFn, secretValues: () => ({ K: 'sk-secret-1' }) });
  const r = fail(['monthlySalary: expected 125750, got 125000']);
  const a = await explain(r);
  await explain(r);
  assert.equal(a.source, 'ai');
  assert.equal(calls, 1);
  assert.equal(a.text.includes('sk-secret-1'), false);
  assert.match(sent.messages[0].content, /monthlySalary/);
});

test('if the AI call fails, the rules still explain it', async () => {
  const explain = createExplainer({ apiKey: 'sk-test', fetchFn: async () => ({ ok: false, status: 500 }) });
  const a = await explain(fail(['expected status 200, got 401']));
  assert.equal(a.source, 'rules');
  assert.match(a.text, /API key or token/);
});

test('single-step checks never talk about two systems syncing', () => {
  const one = (failures) => ({ id: 'c', name: 'C', failedStep: 'Call API', failures, steps: [{ name: 'Call API', ok: false }] });
  const num = explainByRules(one(['userId: expected "2", got 1']));
  assert.match(num, /check expects/);
  assert.doesNotMatch(num, /two systems|sync|receiving system/);
  assert.doesNotMatch(explainByRules(one(['name: expected "A", got "B"'])), /two systems|between the systems/);
  assert.doesNotMatch(explainByRules(one(['expected status 200, got 404'])), /sync|earlier step/);
  assert.match(explainByRules(one(['x: expected 125750, got 125000'])), /API is probably truncating/);
});
