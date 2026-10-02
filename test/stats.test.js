import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStats, formatDuration } from '../lib/stats.js';

const run = (id, ok, at, extra = {}) => ({ id, name: id.toUpperCase(), ok, at, failedStep: ok ? null : 'step 2', failures: ok ? [] : ['salary mismatch'], ...extra });
const ev = (type, check) => ({ type, check });

test('uptime is the share of passing runs in the window, null when nothing ran', () => {
  const s = createStats();
  assert.equal(s.uptime('a', 7).pct, null);
  const now = new Date('2026-10-10T12:00:00Z').getTime();
  s.record([run('a', true, '2026-10-10T10:00:00Z'), run('a', true, '2026-10-10T10:01:00Z'), run('a', true, '2026-10-10T10:02:00Z'), run('a', false, '2026-10-10T10:03:00Z')]);
  assert.deepEqual(s.uptime('a', 7, now), { runs: 4, pct: 75 });
});

test('windows only count their own days; old days drop out of 7d but stay in 30d', () => {
  const s = createStats();
  const now = new Date('2026-10-30T12:00:00Z').getTime();
  s.record([run('a', false, '2026-10-05T10:00:00Z')]);            // 25 days ago, failed
  s.record([run('a', true, '2026-10-29T10:00:00Z')]);             // yesterday, passed
  assert.equal(s.uptime('a', 7, now).pct, 100);
  assert.equal(s.uptime('a', 30, now).pct, 50);
});

test('data older than 35 days is pruned', () => {
  const s = createStats();
  s.record([run('a', true, '2026-08-01T10:00:00Z')]);
  s.record([run('a', true, '2026-10-30T10:00:00Z')]);
  assert.deepEqual(Object.keys(s.toJSON().daily.a), ['2026-10-30']);
});

test('an incident opens when a check fails and closes when it recovers', () => {
  const s = createStats();
  const failed = run('a', false, '2026-10-10T10:00:00Z', { explanation: { text: 'rounded down to the nearest 1000' } });
  s.record([failed], [ev('failed', failed)]);
  let sum = s.summary(['a'], new Date('2026-10-10T10:00:30Z').getTime());
  assert.equal(sum.incidents.length, 1);
  assert.deepEqual([sum.incidents[0].ongoing, sum.incidents[0].durationSec], [true, 30]);
  assert.equal(sum.incidents[0].cause, 'rounded down to the nearest 1000');
  assert.equal(sum.incidents[0].failure, 'salary mismatch');

  const ok = run('a', true, '2026-10-10T10:02:05Z');
  s.record([ok], [ev('recovered', ok)]);
  sum = s.summary(['a'], new Date('2026-10-10T11:00:00Z').getTime());
  assert.deepEqual([sum.incidents[0].ongoing, sum.incidents[0].durationSec], [false, 125]);
});

test('incidents of different checks do not close each other; newest first', () => {
  const s = createStats();
  const a = run('a', false, '2026-10-10T10:00:00Z'), b = run('b', false, '2026-10-10T10:05:00Z');
  s.record([a], [ev('failed', a)]); s.record([b], [ev('failed', b)]);
  const aOk = run('a', true, '2026-10-10T10:10:00Z');
  s.record([aOk], [ev('recovered', aOk)]);
  const inc = s.summary(['a', 'b'], new Date('2026-10-10T10:20:00Z').getTime()).incidents;
  assert.deepEqual(inc.map((i) => [i.checkId, i.ongoing]), [['b', true], ['a', false]]);
});

test('state survives save and load', () => {
  const s = createStats();
  const f = run('a', false, '2026-10-10T10:00:00Z');
  s.record([f], [ev('failed', f)]);
  const again = createStats(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(again.summary(['a']).incidents.length, 1);
  assert.equal(again.uptime('a', 30, new Date('2026-10-10T12:00:00Z').getTime()).runs, 1);
});

test('formatDuration is short and readable', () => {
  assert.deepEqual([5, 60, 125, 3600, 5400, 90000].map(formatDuration), ['5s', '1m', '2m 5s', '1h', '1h 30m', '1d 1h']);
});
