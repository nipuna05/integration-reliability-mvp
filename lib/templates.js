import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadTemplates(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8'))));
}

const fill = (s, values) => s.replace(/<<(\w+)>>/g, (m, k) => (k in values ? String(values[k]) : m));

// Replaces <<KEY>> in string values AND object keys. Runtime {{vars}} are left alone.
function fillDeep(v, values) {
  if (typeof v === 'string') return fill(v, values);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, values));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [fill(k, values), fillDeep(x, values)]));
  return v;
}

// Returns a ready-to-save check with a unique id and every parameter filled in.
export function instantiate(template, values = {}, existingIds = []) {
  const merged = Object.fromEntries(template.params.map((p) => [p.key, values[p.key] !== undefined && values[p.key] !== '' ? values[p.key] : p.default]));
  const check = fillDeep(template.check, merged);
  const base = check.id;
  let id = base, n = 2;
  while (existingIds.includes(id)) id = `${base}-${n++}`;
  return { ...check, id };
}
