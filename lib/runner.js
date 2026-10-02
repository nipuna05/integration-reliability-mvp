// Executes a "business transaction check": an ordered list of HTTP steps across
// systems, with variable extraction and assertions on the responses.

const TEMPLATE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function render(value, vars) {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
  }
  if (Array.isArray(value)) return value.map((v) => render(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, vars)]));
  }
  return value;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

async function runStep(step, vars, timeoutMs) {
  const started = Date.now();
  const result = { name: step.name, ok: true, failures: [] };
  try {
    const req = render(step, vars);
    const res = await fetch(req.url, {
      method: req.method || 'GET',
      headers: { 'content-type': 'application/json', ...(req.headers || {}) },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    result.status = res.status;

    const expect = req.expect || {};
    if (expect.status !== undefined && res.status !== expect.status) {
      result.failures.push(`expected status ${expect.status}, got ${res.status}`);
    }
    for (const [path, want] of Object.entries(expect.json || {})) {
      const got = getPath(json, path);
      if (String(got) !== String(want)) {
        result.failures.push(`${path}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    }
    for (const [name, path] of Object.entries(step.extract || {})) {
      vars[name] = getPath(json, path);
    }
  } catch (err) {
    result.failures.push(err.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : err.message);
  }
  result.ok = result.failures.length === 0;
  result.ms = Date.now() - started;
  return result;
}

export async function runCheck(check, baseVars = {}, { timeoutMs = 5000 } = {}) {
  const vars = { ...baseVars, runId: Date.now().toString(36) };
  const started = Date.now();
  const steps = [];
  for (const step of check.steps) {
    const r = await runStep(step, vars, timeoutMs);
    steps.push(r);
    if (!r.ok) break; // later steps depend on earlier ones
  }
  const failed = steps.find((s) => !s.ok);
  return {
    id: check.id,
    name: check.name,
    ok: !failed,
    failedStep: failed?.name ?? null,
    failures: failed?.failures ?? [],
    steps,
    ms: Date.now() - started,
    at: new Date().toISOString(),
  };
}

export async function runAll(checks, baseVars, opts) {
  const results = [];
  for (const c of checks) results.push(await runCheck(c, baseVars, opts));
  return results;
}
