// Phone push notifications through Expo's push service (which delivers via Firebase on Android).
// The phone app registers its Expo push token; on a failure/recovery we ask Expo to deliver a message.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{10,}\]$/;
const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100; // Expo accepts up to 100 messages per request

export async function createDeviceStore(file) {
  let devices = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : [];
  const save = async () => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(devices, null, 2)); };
  return {
    count: () => devices.length,
    tokens: () => devices.map((d) => d.token),
    async add(token, label = '') {
      if (!TOKEN_RE.test(token)) throw new Error('that does not look like an Expo push token');
      if (!devices.some((d) => d.token === token)) devices.push({ token, label: String(label).slice(0, 60), addedAt: new Date().toISOString() });
      await save();
    },
    async remove(token) { devices = devices.filter((d) => d.token !== token); await save(); },
  };
}

export function createPush({ store, fetchFn = fetch, url = EXPO_URL }) {
  return {
    enabled: () => store.count() > 0,
    // Returns { sent, removed, errors }. Never throws: a failed push must not break checking or other alerts.
    async send(title, body, data = {}) {
      const tokens = store.tokens();
      const out = { sent: 0, removed: 0, errors: [] };
      for (let i = 0; i < tokens.length; i += CHUNK) {
        const batch = tokens.slice(i, i + CHUNK);
        try {
          const res = await fetchFn(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(batch.map((to) => ({ to, title, body: body.slice(0, 300), data, sound: 'default', priority: 'high', channelId: 'alerts' }))),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) { out.errors.push(`Expo returned ${res.status}`); continue; }
          const tickets = (await res.json()).data ?? [];
          for (const [j, t] of tickets.entries()) {
            if (t.status === 'ok') out.sent++;
            else if (t.details?.error === 'DeviceNotRegistered') { await store.remove(batch[j]); out.removed++; } // app uninstalled
            else out.errors.push(t.message || t.details?.error || 'unknown push error');
          }
        } catch (e) { out.errors.push(e.message); }
      }
      return out;
    },
  };
}
