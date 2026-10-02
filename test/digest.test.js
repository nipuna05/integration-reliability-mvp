import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../lib/digest.js';
import { createStats } from '../lib/stats.js';

const now = new Date('2026-10-10T12:00:00Z').getTime();
const checks = [{ id: 'hr', name: 'New employee in HR reaches Payroll' }, { id: 'api', name: 'API responds' }];

test('a quiet week says so and still lists uptime for every check', () => {
  const s = createStats();
  s.record([{ id: 'hr', ok: true, at: '2026-10-09T10:00:00Z' }, { id: 'hr', ok: true, at: '2026-10-09T10:01:00Z' }]);
  const d = buildDigest({ checks, summary: s.summary(checks.map((c) => c.id), now), now });
  assert.match(d.subject, /all quiet/);
  assert.match(d.text, /no incidents this week/);
  assert.match(d.text, /New employee in HR reaches Payroll\s+100%\s+\(2 runs\)/);
  assert.match(d.text, /API responds\s+no data yet/);
});

test('incidents appear with duration, failing step and cause; ongoing ones are flagged', () => {
  const s = createStats();
  const f = { id: 'hr', name: checks[0].name, ok: false, at: '2026-10-08T09:00:00Z', failedStep: 'Payroll salary matches', failures: ['monthlySalary: expected 125750, got 125000'], explanation: { text: 'rounded down to the nearest 1000' } };
  s.record([f], [{ type: 'failed', check: f }]);
  const ok = { id: 'hr', name: f.name, ok: true, at: '2026-10-08T09:05:30Z' };
  s.record([ok], [{ type: 'recovered', check: ok }]);
  const f2 = { id: 'api', name: 'API responds', ok: false, at: '2026-10-10T11:00:00Z', failedStep: 'call', failures: ['timed out after 5000ms'] };
  s.record([f2], [{ type: 'failed', check: f2 }]);
  const d = buildDigest({ checks, summary: s.summary(checks.map((c) => c.id), now), now });
  assert.match(d.subject, /2 incident\(s\)/);
  assert.match(d.text, /2 incident\(s\) this week, 1 still ongoing/);
  assert.match(d.text, /lasted 5m 30s/);
  assert.match(d.text, /monthlySalary: expected 125750, got 125000/);
  assert.match(d.text, /Likely cause: rounded down to the nearest 1000/);
  assert.match(d.text, /broken for 1h \(ongoing\)/);
});

test('incidents older than the window are left out', () => {
  const s = createStats();
  const f = { id: 'hr', name: 'HR', ok: false, at: '2026-09-01T09:00:00Z', failedStep: 's', failures: ['x'] };
  s.record([f], [{ type: 'failed', check: f }]);
  const ok = { id: 'hr', name: 'HR', ok: true, at: '2026-09-01T09:01:00Z' };
  s.record([ok], [{ type: 'recovered', check: ok }]);
  const d = buildDigest({ checks, summary: s.summary(['hr', 'api'], now), now });
  assert.match(d.text, /no incidents this week/);
});
