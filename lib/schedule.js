// Per-check schedules: a check may set "every": "30s" | "5m" | "1h" | "1d". Without it, the server default applies.
const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };
export const MAX_EVERY_SEC = 7 * 86400;

// "5m" -> 300. Returns null when the text is not a valid schedule.
export function parseEvery(text) {
  const m = /^(\d{1,6})([smhd])$/.exec(String(text ?? '').trim().toLowerCase());
  return m ? Number(m[1]) * UNITS[m[2]] : null;
}

export function formatEvery(sec) {
  for (const [u, n] of [['d', 86400], ['h', 3600], ['m', 60]]) if (sec % n === 0 && sec >= n) return `${sec / n}${u}`;
  return `${sec}s`;
}

export const intervalFor = (check, defaultSec) => parseEvery(check.every) ?? defaultSec;

// Checks that have never run, or whose interval has passed since their last run.
export function dueChecks(checks, lastRun, now, defaultSec) {
  return checks.filter((c) => {
    const last = lastRun.get(c.id);
    return last === undefined || now - last >= intervalFor(c, defaultSec) * 1000;
  });
}

// Keeps the newest `perCheck` runs of every check so a frequent check cannot push out a rare one.
export function trimHistory(history, perCheck) {
  const seen = new Map();
  return history.filter((h) => {
    const n = (seen.get(h.id) ?? 0) + 1;
    seen.set(h.id, n);
    return n <= perCheck;
  });
}
