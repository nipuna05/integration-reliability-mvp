// Small pure helpers shared by the screens (no React Native imports, so they can be unit-tested in Node).

export function fmtDuration(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)}m` : ''}`;
  return `${Math.floor(s / 86400)}d`;
}

export function fmtAgo(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// "192.168.1.5:3000" -> "http://192.168.1.5:3000"; trailing slashes removed. Returns '' for blank input.
export function normalizeUrl(input) {
  let u = String(input ?? '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

// Newest run of a check (history is newest-first).
export const lastRunFor = (history, id) => history.find((h) => h.id === id);

// Overall state for the banner on the Status screen.
export function overallState(checks, history) {
  let failing = 0, known = 0;
  for (const c of checks) {
    const last = lastRunFor(history, c.id);
    if (!last) continue;
    known++;
    if (!last.ok) failing++;
  }
  if (!known) return { state: 'unknown', failing: 0, total: checks.length };
  return { state: failing ? 'bad' : 'ok', failing, total: checks.length };
}

// When the same check is added twice, number both its id and its name so they can be told apart.
export function uniqueCheck(list, check) {
  let n = 1;
  const base = check.name;
  while (list.some((c) => c.id === check.id)) { n++; check.id = `${check.id.replace(/-\d+$/, '')}-${n}`; check.name = `${base} (${n})`; }
  return check;
}

export const scheduleLabel = (check, defaultSec = 60) => {
  const m = /^(\d+)([smhd])$/.exec(check.every || '');
  const sec = m ? Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] : defaultSec;
  return sec % 86400 === 0 ? `every ${sec / 86400}d` : sec % 3600 === 0 ? `every ${sec / 3600}h` : sec % 60 === 0 ? `every ${sec / 60}m` : `every ${sec}s`;
};
