// Drives the dashboard in a real (headless) Edge: sign in -> curl import -> template -> test -> save -> remove.
// Run manually: node scripts/ui-smoke.mjs   (needs Microsoft Edge installed; not part of `npm test`)
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
if (!EDGE) { console.error('Edge not found'); process.exit(2); }
const PORT = 3901, CDP = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT), APP_PASSWORD: 'smoke-pw', DATA_DIR: mkdtempSync(path.join(tmpdir(), 'smoke-')), INTERVAL_SEC: '3600' }, stdio: 'ignore' });
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'edge-'))}`, 'about:blank'], { stdio: 'ignore' });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`); if (!ok) failures++; };

async function main() {
  let target, lastErr = '';
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) { lastErr = e.message; /* edge still starting */ }
  }
  if (!target) throw new Error(`could not attach to Edge (${lastErr})`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const pageErrors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  const run = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed'); return r.result.result.value; };
  const waitFor = async (expr, label, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await run(expr)) return true; } catch { /* page not ready */ } await sleep(150); } check(`wait: ${label}`, false, 'timed out'); return false; };
  const click = (sel) => run(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const setValue = (sel, v) => run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input')); })()`);
  const text = (sel) => run(`document.querySelector(${JSON.stringify(sel)}).innerText`);
  const visible = (sel) => `!document.querySelector(${JSON.stringify(sel)}).classList.contains('hidden')`;

  await waitFor(`document.readyState === 'complete' && ${visible('#login')}`, 'login box shown to a guest');
  check('guest sees the sign-in box and no editor button', await run(`${visible('#login')} && document.querySelector('#editToggle').classList.contains('hidden')`));

  await setValue('#pw', 'wrong'); await click('#signin');
  await waitFor(`document.querySelector('#loginErr').innerText.length > 0`, 'wrong password message');
  check('wrong password is rejected', (await text('#loginErr')).includes('wrong password'));

  await setValue('#pw', 'smoke-pw'); await click('#signin');
  await waitFor(`${visible('#editToggle')}`, 'editor button after sign-in');
  check('signing in shows "Add or change checks"', (await text('#editToggle')).includes('Add or change checks'));

  await click('#editToggle');
  await waitFor(`${visible('#editor')} && document.querySelectorAll('#draftList .chk').length >= 1`, 'editor open with the saved check listed');
  check('editor lists the existing check as a readable row (not JSON)', (await text('#draftList')).includes('New employee in HR'));
  check('secrets, alerts and advanced JSON start collapsed', await run(`[...document.querySelectorAll('#editor details')].every((d) => !d.open) && document.querySelectorAll('#editor details').length === 3`));

  await setValue('#curlCmd', `curl http://127.0.0.1:${PORT}/demo/secure/ping -H 'Authorization: Bearer demo-key-123'`);
  await click('#curlGo');
  await waitFor(`${visible('#curlAdd')}`, 'curl import result');
  check('curl import reports the API status', (await text('#curlOut')).includes('status 200'));
  check('curl import saved the key as a secret', (await text('#curlOut')).includes('Saved 1 key'));
  await run(`document.querySelector('#curlFields input') && document.querySelector('#curlFields input').click()`);
  await click('#curlAdd');
  await waitFor(`document.querySelectorAll('#draftList .chk').length === 2`, 'curl check appears in the list');
  check('curl check appears in the list', (await text('#draftList')).includes('/demo/secure/ping'));
  check('unsaved-changes marker shows', (await text('#dirty')).includes('unsaved'));
  check('the API key is not in the JSON', !(await run(`document.querySelector('#json').value`)).includes('demo-key-123'));

  await click('#tabTpl');
  check('template tab shows its form', await run(`${visible('#paneTpl')} && document.querySelectorAll('#tplParams input').length > 0`));
  await run(`document.querySelector('#tplSel').value = 'hr-to-payroll'; document.querySelector('#tplSel').dispatchEvent(new Event('change'))`);
  await click('#tplAdd');
  await waitFor(`document.querySelectorAll('#draftList .chk').length === 3`, 'template check appears in the list');
  check('template added a third check', true);
  await click('#tplAdd'); // same template again: must not collide
  await waitFor(`document.querySelectorAll('#draftList .chk').length === 4`, 'second copy of the template');
  check('adding the same template twice numbers the second one', (await text('#draftList')).includes('(2)'));

  check('every check row has a schedule picker defaulting to the server default', await run(`document.querySelectorAll('#draftList select[data-every]').length === 4 && document.querySelector('#draftList select[data-every]').selectedOptions[0].text.startsWith('default')`));
  await run(`(() => { const s = document.querySelector('#draftList select[data-every="1"]'); s.value = '5m'; s.dispatchEvent(new Event('change')); })()`);
  check('choosing "every 5 minutes" writes it into the check', (await run(`JSON.parse(document.querySelector('#json').value)[1].every`)) === '5m');

  await click('#test');
  await waitFor(`document.querySelector('#editOut').innerText.includes('passed')`, 'test results');
  check('Test reports all four passing', (await text('#editOut')).startsWith('4 passed, 0 failed'));

  await click('#save');
  await waitFor(`document.querySelector('#editOut').innerText.startsWith('Saved')`, 'save message');
  check('Save confirms and clears the unsaved marker', (await text('#editOut')).startsWith('Saved 4') && (await text('#dirty')) === '');

  await waitFor(`document.querySelectorAll('#list .card').length === 4`, 'dashboard cards after save');
  check('dashboard cards show each check\'s schedule', await run(`[...document.querySelectorAll('#list .card')].some((c) => c.innerText.includes('runs every 5m')) && [...document.querySelectorAll('#list .card')].some((c) => c.innerText.includes('runs every 1h'))`));

  await run(`document.querySelectorAll('#draftList [data-rm]')[3].click()`);
  check('Remove drops a check and marks unsaved', (await run(`document.querySelectorAll('#draftList .chk').length`)) === 3 && (await text('#dirty')).includes('unsaved'));

  await run(`document.querySelector('#editor details:nth-of-type(3) summary').click()`);
  await setValue('#json', '[ not json');
  check('a JSON mistake shows a clear message instead of breaking the page', (await text('#draftList')).includes('mistake'));

  check('no JavaScript errors on the page', pageErrors.length === 0, pageErrors.join(' | '));
  ws.close();
}

try { await main(); } catch (e) { console.error('SMOKE TEST ERROR:', e.message); failures++; }
finally { edge.kill(); server.kill(); }
console.log(failures ? `\n${failures} problem(s)` : '\nAll UI checks passed');
process.exit(failures ? 1 : 0);
