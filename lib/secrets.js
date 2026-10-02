import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

const keyFrom = (k) => scryptSync(k, 'irm-secrets-v1', 32);
function encrypt(obj, key) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(key), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function decrypt(b64, key) {
  const buf = Buffer.from(b64, 'base64');
  const d = createDecipheriv('aes-256-gcm', keyFrom(key), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}

// Secrets live on the server only. With SECRETS_KEY set they are encrypted at rest (AES-256-GCM).
export async function createSecretStore(file, encryptionKey) {
  let values = {};
  if (existsSync(file)) {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw.encrypted) {
      if (!encryptionKey) throw new Error('secrets file is encrypted: set SECRETS_KEY to the key used to create it');
      values = decrypt(raw.data, encryptionKey);
    } else values = raw.data || {};
  }
  const save = async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const body = encryptionKey ? { encrypted: true, data: encrypt(values, encryptionKey) } : { encrypted: false, data: values };
    await writeFile(file, JSON.stringify(body));
  };
  return {
    encrypted: Boolean(encryptionKey),
    names: () => Object.keys(values).sort(),
    values: () => ({ ...values }),
    async set(name, value) {
      if (!SECRET_NAME.test(name)) throw new Error('name must be UPPER_SNAKE_CASE (A-Z, 0-9, _), starting with a letter');
      if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('value must be 1-4096 characters');
      values[name] = value;
      await save();
    },
    async remove(name) { delete values[name]; await save(); },
  };
}

// Replaces every secret value found in any string of `obj` (deep) with ***.
export function redact(obj, secretValues) {
  const list = Object.values(secretValues).filter((v) => v && v.length >= 3).sort((a, b) => b.length - a.length);
  if (!list.length) return obj;
  const clean = (s) => list.reduce((acc, v) => acc.split(v).join('***'), s);
  const walk = (v) => {
    if (typeof v === 'string') return clean(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(obj);
}
