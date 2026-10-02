// Talks to the Integration Reliability server. Plain fetch, no React Native imports, so it is testable in Node.
import { uniqueCheck } from './format.js';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createApi({ baseUrl, token, fetchFn = fetch, timeoutMs = 15000 }) {
  async function call(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(`Cannot reach ${baseUrl}. Is the server running and is the address right?`, 0);
    } finally { clearTimeout(timer); }
    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    if (!res.ok) throw new ApiError(data?.errors?.join('\n') || data?.error || `The server answered ${res.status}`, res.status);
    return data;
  }

  return {
    session: () => call('/api/session'),
    login: async (password) => (await call('/api/login', { method: 'POST', body: { password } })).token,
    checks: () => call('/api/checks'),
    history: () => call('/api/history'),
    stats: () => call('/api/stats'),
    run: () => call('/api/run', { method: 'POST' }),
    curlImport: (command) => call('/api/curl/import', { method: 'POST', body: { command } }),
    registerDevice: (pushToken, label) => call('/api/devices', { method: 'POST', body: { token: pushToken, label } }),
    unregisterDevice: (pushToken) => call('/api/devices', { method: 'DELETE', body: { token: pushToken } }),
    testAlert: () => call('/api/alerts/test', { method: 'POST' }),
    alerts: () => call('/api/alerts'),

    // Adds one check to the saved list. `picked` = response fields the user ticked as "must stay the same".
    async addCheck(check, picked = []) {
      const list = await call('/api/checks');
      const c = JSON.parse(JSON.stringify(check));
      if (picked.length) c.steps[0].expect.json = Object.fromEntries(picked.map((f) => [f.path, f.value]));
      uniqueCheck(list, c);
      await call('/api/checks', { method: 'PUT', body: [...list, c] });
      return c;
    },
  };
}
