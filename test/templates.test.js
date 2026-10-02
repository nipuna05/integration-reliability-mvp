import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadTemplates, instantiate } from '../lib/templates.js';
import { validateChecks } from '../lib/checks.js';

const dir = fileURLToPath(new URL('../templates', import.meta.url));

test('every shipped template produces a valid check from its defaults', async () => {
  const templates = await loadTemplates(dir);
  assert.ok(templates.length >= 4);
  for (const t of templates) {
    const check = instantiate(t);
    assert.deepEqual(validateChecks([check]), [], `${t.id} is invalid`);
    assert.doesNotMatch(JSON.stringify(check), /<<\w+>>/, `${t.id} has unfilled params`);
  }
});

test('values replace string values and object keys, runtime vars are kept', async () => {
  const t = (await loadTemplates(dir)).find((x) => x.id === 'api-contract');
  const c = instantiate(t, { API_URL: 'https://x.test/s', FIELD: 'data.plan', VALUE: 'pro' });
  assert.equal(c.steps[0].url, 'https://x.test/s');
  assert.deepEqual(c.steps[0].expect.json, { 'data.plan': 'pro' });
  const hr = instantiate((await loadTemplates(dir)).find((x) => x.id === 'hr-to-payroll'));
  assert.match(JSON.stringify(hr), /\{\{empId\}\}/);
  assert.match(JSON.stringify(hr), /\{\{runId\}\}/);
});

test('ids stay unique when the same template is added twice', async () => {
  const t = (await loadTemplates(dir))[0];
  assert.equal(instantiate(t, {}, [t.check.id]).id, `${t.check.id}-2`);
  assert.equal(instantiate(t, {}, [t.check.id, `${t.check.id}-2`]).id, `${t.check.id}-3`);
});
