// Turns a pasted curl command into a check. Keys/tokens found in headers or the URL
// query are returned as `sensitive` so the server can store them as secrets instead.

export class CurlError extends Error {}

export function tokenize(input) {
  const s = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ').trim();
  const out = [];
  let cur = '', has = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || (c === '$' && s[i + 1] === "'")) {
      const ansi = c === '$';
      i += ansi ? 2 : 1; has = true;
      while (i < s.length && s[i] !== "'") {
        if (ansi && s[i] === '\\' && i + 1 < s.length) {
          const n = s[++i];
          cur += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
        } else cur += s[i];
        i++;
      }
      i++;
    } else if (c === '"') {
      i++; has = true;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && /["\\$`]/.test(s[i + 1] || '')) i++;
        cur += s[i++];
      }
      i++;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = ''; has = false; i++;
    } else if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; has = true; i += 2; }
    else { cur += c; has = true; i++; }
  }
  if (has || cur) out.push(cur);
  return out;
}

const TAKES_ARG = new Set(['-o', '--output', '-m', '--max-time', '--connect-timeout', '-e', '--referer', '--retry', '-w', '--write-out', '-x', '--proxy', '--cacert', '--cert', '-T', '--upload-file', '-K', '--config']);
const BODY_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode']);
const SENSITIVE_NAME = /(authorization|api[-_]?key|apikey|token|secret|password|passwd|cookie|auth|signature|sig)$/i;

export function parseCurl(command) {
  const t = tokenize(command);
  if (!t.length || t[0].toLowerCase() !== 'curl') throw new CurlError('Paste a command that starts with "curl".');
  let method, url, body, i = 1;
  const headers = {};
  const need = (flag) => { if (i + 1 >= t.length) throw new CurlError(`${flag} needs a value.`); return t[++i]; };
  for (; i < t.length; i++) {
    const a = t[i];
    if (a === '-X' || a === '--request') method = need(a).toUpperCase();
    else if (a === '-H' || a === '--header') {
      const h = need(a), k = h.indexOf(':');
      if (k > 0) headers[h.slice(0, k).trim().toLowerCase()] = h.slice(k + 1).trim();
    } else if (BODY_FLAGS.has(a)) body = body === undefined ? need(a) : `${body}&${need(a)}`;
    else if (a === '--json') { body = need(a); headers['content-type'] ??= 'application/json'; headers.accept ??= 'application/json'; }
    else if (a === '-u' || a === '--user') headers.authorization = `Basic ${Buffer.from(need(a)).toString('base64')}`;
    else if (a === '-A' || a === '--user-agent') headers['user-agent'] = need(a);
    else if (a === '-b' || a === '--cookie') headers.cookie = need(a);
    else if (a === '--url') url = need(a);
    else if (a === '-F' || a === '--form') throw new CurlError('Multipart forms (-F) are not supported yet.');
    else if (a === '-I' || a === '--head') throw new CurlError('HEAD requests are not supported yet.');
    else if (TAKES_ARG.has(a)) i++;
    else if (a.startsWith('-')) continue; // harmless flag like -s -L --compressed -k
    else if (!url) url = a;
  }
  if (!url) throw new CurlError('No URL found in the curl command.');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let u;
  try { u = new URL(url); } catch { throw new CurlError(`"${url}" is not a valid URL.`); }
  if (!method) method = body !== undefined ? 'POST' : 'GET';
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new CurlError(`Method ${method} is not supported.`);

  let parsedBody;
  if (body !== undefined) {
    try { parsedBody = JSON.parse(body); } catch { throw new CurlError('Only JSON request bodies are supported for now (the -d value is not valid JSON).'); }
    headers['content-type'] ??= 'application/json';
  }
  delete headers['content-length']; delete headers.host;

  const sensitive = [];
  for (const [k, v] of Object.entries(headers)) if (SENSITIVE_NAME.test(k) && v) sensitive.push({ where: 'header', key: k, value: v });
  for (const [k, v] of u.searchParams) if (SENSITIVE_NAME.test(k) && v) sensitive.push({ where: 'query', key: k, value: v });

  return { method, url: u.toString(), host: u.host, pathname: u.pathname, headers, body: parsedBody, sensitive };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'check';
const upper = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// secretNames: [{ item, name }] decided by the caller. Returns the check with {{secret.NAME}} placeholders.
export function buildCheck(parsed, { status, secretNames = [], existingIds = [] }) {
  const headers = { ...parsed.headers };
  const url = new URL(parsed.url);
  let queryChanged = false;
  for (const { item, name } of secretNames) {
    if (item.where === 'header') headers[item.key] = `{{secret.${name}}}`;
    else { url.searchParams.set(item.key, `SECRETPH_${name}_ENDPH`); queryChanged = true; } // letters only, so URL encoding leaves it intact
  }
  let finalUrl = url.toString();
  if (queryChanged) finalUrl = finalUrl.replace(/SECRETPH_([A-Z0-9_]+?)_ENDPH/g, '{{secret.$1}}');
  const base = slug(`${parsed.host}${parsed.pathname}`);
  let id = base, n = 2;
  while (existingIds.includes(id)) id = `${base}-${n++}`;
  const step = { name: `${parsed.method} ${parsed.host}${parsed.pathname}`, method: parsed.method, url: finalUrl, expect: { status } };
  if (Object.keys(headers).length) step.headers = headers;
  if (parsed.body !== undefined) step.body = parsed.body;
  return { id, name: `${parsed.method} ${parsed.host}${parsed.pathname} responds correctly`, steps: [step] };
}

export function secretNameFor(host, item, taken) {
  const base = `${upper(host.split(':')[0])}_${upper(item.key)}`.replace(/^[^A-Z]+/, 'S_').slice(0, 60);
  let name = base, n = 2;
  while (taken.includes(name)) name = `${base}_${n++}`;
  return name;
}

// Top-level (and one nested level) simple fields from a JSON response, offered as optional assertions.
export function previewFields(json) {
  const out = [];
  const add = (path, v) => {
    if (out.length >= 8) return;
    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 60)) out.push({ path, value: v });
  };
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    for (const [k, v] of Object.entries(json)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) add(`${k}.${k2}`, v2);
      else add(k, v);
    }
  }
  return out;
}
