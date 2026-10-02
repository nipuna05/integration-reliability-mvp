// Uptime and incident tracking. Daily counters (kept 35 days) give uptime %; incidents record each
// failure from the moment a check starts failing until it recovers.
const DAY_MS = 86400_000;
const KEEP_DAYS = 35;
const MAX_INCIDENTS = 200;
const dayOf = (iso) => iso.slice(0, 10); // UTC date of the run

export function createStats(saved) {
  const state = { daily: saved?.daily ?? {}, incidents: saved?.incidents ?? [] };

  function record(results, events = []) {
    for (const r of results) {
      const days = (state.daily[r.id] ??= {});
      const d = (days[dayOf(r.at)] ??= { runs: 0, fails: 0 });
      d.runs++;
      if (!r.ok) d.fails++;
    }
    for (const e of events) {
      const c = e.check;
      if (e.type === 'failed') {
        state.incidents.push({
          id: `${c.id}-${c.at}`, checkId: c.id, name: c.name, startedAt: c.at, endedAt: null,
          failedStep: c.failedStep, failure: c.failures?.[0] ?? '', cause: c.explanation?.text ?? '',
        });
      } else {
        const open = [...state.incidents].reverse().find((i) => i.checkId === c.id && !i.endedAt);
        if (open) open.endedAt = c.at;
      }
    }
    prune(results.length ? new Date(results.at(-1).at).getTime() : Date.now());
  }

  function prune(now) {
    const oldest = dayOf(new Date(now - KEEP_DAYS * DAY_MS).toISOString());
    for (const days of Object.values(state.daily)) for (const day of Object.keys(days)) if (day < oldest) delete days[day];
    if (state.incidents.length > MAX_INCIDENTS) state.incidents = state.incidents.slice(-MAX_INCIDENTS);
  }

  // Share of runs that passed in the last `days` days; pct is null when nothing has run yet.
  function uptime(checkId, days, now = Date.now()) {
    const since = dayOf(new Date(now - (days - 1) * DAY_MS).toISOString());
    let runs = 0, fails = 0;
    for (const [day, v] of Object.entries(state.daily[checkId] ?? {})) if (day >= since) { runs += v.runs; fails += v.fails; }
    return { runs, pct: runs ? Math.round(((runs - fails) / runs) * 1000) / 10 : null };
  }

  function summary(checkIds, now = Date.now(), limit = 30) {
    const checks = Object.fromEntries(checkIds.map((id) => [id, { uptime7d: uptime(id, 7, now), uptime30d: uptime(id, 30, now) }]));
    const incidents = [...state.incidents].reverse().slice(0, limit).map((i) => ({
      ...i, ongoing: !i.endedAt,
      durationSec: Math.max(0, Math.round(((i.endedAt ? new Date(i.endedAt).getTime() : now) - new Date(i.startedAt).getTime()) / 1000)),
    }));
    return { checks, incidents };
  }

  return { record, uptime, summary, toJSON: () => state };
}

export function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`.replace(/ 0s$/, '');
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`.replace(/ 0m$/, '');
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`.replace(/ 0h$/, '');
}
