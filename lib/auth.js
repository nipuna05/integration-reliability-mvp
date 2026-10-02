import { randomBytes, timingSafeEqual } from 'node:crypto';

const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createAuth(password) {
  const tokens = new Set();
  const fails = new Map(); // ip -> { n, since }

  const tooMany = (ip) => {
    const f = fails.get(ip);
    if (!f || Date.now() - f.since > 60_000) return false;
    return f.n >= 10;
  };

  return {
    enabled: Boolean(password),
    login(input, ip = '') {
      if (!password) return null;
      if (tooMany(ip)) return 'RATE_LIMITED';
      if (typeof input === 'string' && safeEqual(input, password)) {
        const t = randomBytes(24).toString('hex');
        tokens.add(t);
        return t;
      }
      const f = fails.get(ip);
      fails.set(ip, f && Date.now() - f.since <= 60_000 ? { n: f.n + 1, since: f.since } : { n: 1, since: Date.now() });
      return null;
    },
    tokenFrom(req) {
      const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const cookie = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      return bearer || cookie || '';
    },
    isAuthed(req) { return !password || tokens.has(this.tokenFrom(req)); },
    logout(req) { tokens.delete(this.tokenFrom(req)); },
  };
}

// Requests arriving through a tunnel/proxy carry these headers; direct local ones do not.
export const viaProxy = (req) => Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
