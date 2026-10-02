// What the PUBLIC status page may show. Deliberately tiny: check names, up/down, uptime and outage times.
// Never URLs, request/response data, error text, failing step names, likely causes or secrets.
const DAY_MS = 86400_000;

export function buildPublicStatus({ checks, summary, lastStatus, title = 'Service status', now = Date.now() }) {
  const shown = checks.filter((c) => c.public !== false); // a check can opt out with "public": false
  const items = shown.map((c) => {
    const ok = lastStatus.get(c.id);
    return {
      name: c.name,
      status: ok === undefined ? 'unknown' : ok ? 'operational' : 'failing',
      uptime7d: summary.checks[c.id]?.uptime7d?.pct ?? null,
    };
  });
  const failing = items.filter((i) => i.status === 'failing').length;
  const known = items.filter((i) => i.status !== 'unknown').length;
  const overall = !items.length || !known ? 'unknown' : failing === 0 ? 'operational' : failing === items.length ? 'outage' : 'degraded';

  const visible = new Set(shown.map((c) => c.id));
  const incidents = summary.incidents
    .filter((i) => visible.has(i.checkId) && (i.ongoing || new Date(i.startedAt).getTime() >= now - 14 * DAY_MS))
    .slice(0, 10)
    .map((i) => ({ name: i.name, startedAt: i.startedAt, endedAt: i.endedAt, ongoing: i.ongoing, durationSec: i.durationSec }));

  return { title, overall, updatedAt: new Date(now).toISOString(), checks: items, incidents };
}
