import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicStatus } from '../lib/publicStatus.js';
import { createStats } from '../lib/stats.js';

const now = new Date('2026-10-10T12:00:00Z').getTime();
const checks = [
  { id: 'hr', name: 'HR to Payroll sync', steps: [{ url: 'https://internal.corp/api/hr?key=SECRET123' }] },
  { id: 'api', name: 'Public API' },
  { id: 'private', name: 'Internal-only check', public: false },
];

function withFailure() {
  const s = createStats();
  const f = { id: 'hr', name: checks[0].name, ok: false, at: '2026-10-10T11:00:00Z', failedStep: 'Call https://internal.corp', failures: ['token=SECRET123 rejected'], explanation: { text: 'the key SECRET123 is wrong' } };
  s.record([f], [{ type: 'failed', check: f }]);
  return s;
}

test('overall status: operational, degraded, outage, unknown', () => {
  const sum = createStats().summary(['hr', 'api', 'private']);
  const b = (m) => buildPublicStatus({ checks, summary: sum, lastStatus: new Map(m), now }).overall;
  assert.equal(b([]), 'unknown');
  assert.equal(b([['hr', true], ['api', true]]), 'operational');
  assert.equal(b([['hr', false], ['api', true]]), 'degraded');
  assert.equal(b([['hr', false], ['api', false]]), 'outage');
});

test('checks marked "public": false never appear, neither as checks nor as incidents', () => {
  const s = createStats();
  const f = { id: 'private', name: 'Internal-only check', ok: false, at: '2026-10-10T11:00:00Z', failedStep: 's', failures: ['x'] };
  s.record([f], [{ type: 'failed', check: f }]);
  const out = buildPublicStatus({ checks, summary: s.summary(['hr', 'api', 'private'], now), lastStatus: new Map([['private', false]]), now });
  assert.deepEqual(out.checks.map((c) => c.name), ['HR to Payroll sync', 'Public API']);
  assert.equal(out.incidents.length, 0);
  assert.equal(JSON.stringify(out).includes('Internal-only'), false);
});

test('NOTHING sensitive can leak: no urls, errors, steps, causes or keys in the output', () => {
  const s = withFailure();
  const out = buildPublicStatus({ checks, summary: s.summary(['hr', 'api', 'private'], now), lastStatus: new Map([['hr', false]]), now });
  const text = JSON.stringify(out);
  for (const secret of ['SECRET123', 'internal.corp', 'rejected', 'Call https', 'the key', 'failedStep', 'cause', 'failure']) {
    assert.equal(text.includes(secret), false, `leaked: ${secret}`);
  }
  assert.deepEqual(Object.keys(out.incidents[0]).sort(), ['durationSec', 'endedAt', 'name', 'ongoing', 'startedAt']);
  assert.equal(out.incidents[0].ongoing, true);
});

test('old resolved incidents (over 14 days) are dropped, ongoing ones are kept', () => {
  const s = createStats();
  const f = { id: 'api', name: 'Public API', ok: false, at: '2026-09-01T00:00:00Z', failedStep: 's', failures: ['x'] };
  s.record([f], [{ type: 'failed', check: f }]);
  const out = buildPublicStatus({ checks, summary: s.summary(['api'], now), lastStatus: new Map(), now });
  assert.equal(out.incidents.length, 1, 'still ongoing, so kept');
  const ok = { id: 'api', name: 'Public API', ok: true, at: '2026-09-01T00:10:00Z' };
  s.record([ok], [{ type: 'recovered', check: ok }]);
  assert.equal(buildPublicStatus({ checks, summary: s.summary(['api'], now), lastStatus: new Map(), now }).incidents.length, 0);
});
