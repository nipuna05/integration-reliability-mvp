// Renders the phone app (mobile/App.js, via React Native Web) in headless Edge against a real server and clicks through it.
// Run:  cd mobile && npx expo export --platform web --output-dir dist-web   then   node scripts/mobile-web-smoke.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const DIST = path.resolve('mobile/dist-web');
if (!EDGE || !existsSync(DIST)) { console.error('Need Edge and mobile/dist-web (run the expo web export first)'); process.exit(2); }
const API_PORT = 3902, WEB_PORT = 3903, CDP = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };

const api = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(API_PORT), APP_PASSWORD: 'phone-pw', PUBLIC_DEMO: '1', DATA_DIR: mkdtempSync(path.join(tmpdir(), 'mw-')), INTERVAL_SEC: '3600' }, stdio: 'ignore' });

// Same-origin stand-in for "phone -> server": serves the web build and forwards /api and /demo to the real server (no CORS needed).
const web = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.startsWith('/api/') || pathname.startsWith('/demo/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await fetch(`http://127.0.0.1:${API_PORT}${req.url}`, { method: req.method, headers: { 'content-type': 'application/json', ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  let file = path.join(DIST, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(DIST) || !existsSync(file)) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => web.listen(WEB_PORT, r));
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--window-size=480,1000', `--remote-debugging-port=${CDP}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'edge-'))}`, 'about:blank'], { stdio: 'ignore' });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`); if (!ok) failures++; };

async function main() {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ } }
  if (!target) throw new Error('could not attach to Edge');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const pageErrors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const run = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed'); return r.result.result.value; };
  const body = () => run('document.body.innerText');
  const has = async (text) => (await body()).includes(text);
  const waitText = async (text, label = text, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await has(text)) return true; } catch { /* loading */ } await sleep(150); } check(`wait: ${label}`, false, `never saw "${text}"; page says: ${(await body()).slice(0, 200).replace(/\n/g, ' | ')}`); return false; };
  const type = (placeholder, value) => run(`(() => { const el = [...document.querySelectorAll('input,textarea')].find((e) => (e.placeholder || '').includes(${JSON.stringify(placeholder)})); if (!el) throw new Error('no field: ${placeholder}'); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const pressNow = (text) => run(`(() => { const els = [...document.querySelectorAll('div,span,a')].filter((e) => e.innerText && e.innerText.trim() === ${JSON.stringify(text)}); if (!els.length) throw new Error('nothing to press: ${text}'); els[els.length - 1].click(); })()`);
  // a button may briefly read "Running…" or not be on screen yet, so retry for a few seconds like a person would
  const press = async (text) => { const end = Date.now() + 6000; for (;;) { try { return await pressNow(text); } catch (e) { if (Date.now() > end) throw e; await sleep(150); } } };

  await send('Page.navigate', { url: WEB });
  await waitText('Connect to your server');

  // 1. unreachable server -> readable error
  await type('192.168', 'http://127.0.0.1:1');
  await press('Connect');
  await waitText('Cannot reach http://127.0.0.1:1', 'unreachable server message');
  check('unreachable server shows a readable error', await has('Is the server running'));

  // 2. guest mode (no password) against the public demo server
  await type('192.168', WEB);
  await press('Connect');
  await waitText('Viewing as guest');
  check('guest sees the status screen with the demo check', await has('New employee in HR reaches Payroll'));
  check('guest sees the four tabs', (await Promise.all(['Status', 'Incidents', 'Add', 'Settings'].map(has))).every(Boolean));
  await press('Add');
  await waitText('Sign in to add checks');
  check('guest cannot add checks (asked to sign in)', true);

  // 3. sign in: wrong then right password
  await press('Settings');
  await waitText('Guest (read only)');
  await type('Server password', 'wrong');
  await press('Sign in');
  await waitText('wrong password');
  check('wrong password is refused with a message', true);
  await type('Server password', 'phone-pw');
  await press('Sign in');
  await waitText('Signed in');
  check('right password signs in', !(await has('Guest (read only)')));

  // 4. add a check by pasting curl (the key must be hidden as a secret)
  await press('Add');
  await waitText('Paste a curl command');
  await type('curl https://api.example.com', `curl http://127.0.0.1:${API_PORT}/demo/secure/ping -H 'Authorization: Bearer demo-key-123'`);
  await press('Try it');
  await waitText('The API answered with status 200');
  check('curl import shows the status and that the key was stored as a secret', await has('Saved 1 key(s) as secrets'));
  check('the key itself is not shown anywhere', !(await has('demo-key-123')));
  await press('☐');                      // tick the "status = ok" field
  check('a response field can be ticked', await has('☑'));
  await press('Add this check');
  await waitText('Added "GET 127.0.0.1');
  check('the check is added', true);

  // 5. status: new check is listed; run it
  await press('Status');
  await waitText('GET 127.0.0.1:' + API_PORT);
  await press('Run checks now');
  await waitText('All checks passing');
  check('after running, the banner says all checks pass', true);

  // 6. break the demo -> failing banner, likely cause, incident; then fix -> resolved
  await run(`fetch('/demo/break', { method: 'POST', body: JSON.stringify({ broken: true }) })`);
  await press('Run checks now');
  await waitText('1 of 2 checks failing');
  check('a failure turns the banner red with the count', true);
  check('the failing card shows the error and the likely cause', (await has('monthlySalary: expected 125750, got 125000')) && (await has('rounded down to the nearest 1000')));
  check('the Status tab label shows the failing count', await has('Status (1)'));
  await press('Incidents');
  await waitText('ONGOING');
  check('Incidents shows the outage as ONGOING', true);
  await run(`fetch('/demo/break', { method: 'POST', body: JSON.stringify({ broken: false }) })`);
  await press('Status (1)'); // while a check is failing the tab is labelled with the count
  await press('Run checks now');
  await waitText('All checks passing');
  await press('Incidents');
  await waitText('RESOLVED');
  check('after the fix the incident shows as RESOLVED with its duration', (await has('lasted')));

  // 7. phone alerts: a browser is not a phone, so it must say so politely instead of crashing
  await press('Settings');
  await waitText('Turn on phone alerts');
  await press('Turn on phone alerts');
  await waitText('only work in the installed phone app');
  check('in a browser, phone alerts explain they need the installed phone app (no crash, no silent hang)', true);

  // 8. sign out returns to the connect screen
  await press('Change server / sign out');
  await waitText('Connect to your server');
  check('sign out returns to the connect screen', true);

  check('no JavaScript errors on the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  ws.close();
}

try { await main(); } catch (e) { console.error('SMOKE TEST ERROR:', e.message); failures++; }
finally { edge.kill(); api.kill(); web.close(); }
console.log(failures ? `\n${failures} problem(s)` : '\nAll phone-app UI checks passed');
process.exit(failures ? 1 : 0);
