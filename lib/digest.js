// Builds the weekly reliability report (plain text, works in email and chat).
import { formatDuration } from './stats.js';

const DAY_MS = 86400_000;
const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function buildDigest({ checks, summary, now = Date.now(), days = 7 }) {
  const since = now - days * DAY_MS;
  const incidents = summary.incidents.filter((i) => new Date(i.startedAt).getTime() >= since || i.ongoing);
  const ongoing = incidents.filter((i) => i.ongoing).length;
  const lines = [];
  lines.push(`Reliability report: ${fmtDay(since)} to ${fmtDay(now)}`, '');
  lines.push(incidents.length
    ? `${checks.length} check(s), ${incidents.length} incident(s) this week${ongoing ? `, ${ongoing} still ongoing` : ', all resolved'}.`
    : `${checks.length} check(s), no incidents this week. All quiet.`, '');

  lines.push('Uptime (last 7 days)');
  const width = Math.min(48, Math.max(10, ...checks.map((c) => c.name.length)));
  for (const c of checks) {
    const u = summary.checks[c.id]?.uptime7d ?? { pct: null, runs: 0 };
    const name = c.name.length > width ? `${c.name.slice(0, width - 1)}…` : c.name.padEnd(width);
    lines.push(`  ${name}  ${u.pct === null ? 'no data yet' : `${u.pct}%  (${u.runs} runs)`}`);
  }

  if (incidents.length) {
    lines.push('', 'Incidents');
    for (const i of incidents) {
      lines.push(`  - ${i.name}`, `    ${fmtDate(new Date(i.startedAt).getTime())}, ${i.ongoing ? 'broken for' : 'lasted'} ${formatDuration(i.durationSec)}${i.ongoing ? ' (ongoing)' : ''}`);
      if (i.failure) lines.push(`    ${i.failedStep ? `${i.failedStep}: ` : ''}${i.failure}`);
      if (i.cause) lines.push(`    Likely cause: ${i.cause}`);
    }
  }
  return { subject: `📊 Weekly reliability report: ${incidents.length ? `${incidents.length} incident(s)` : 'all quiet'}`, text: lines.join('\n') };
}
