// Turns a failed check result into a plain-English "likely cause + what to check next".
// Built-in rules work offline for free; with ANTHROPIC_API_KEY set, an AI explanation is
// used instead and the rules are the fallback if the AI call fails.
import { redact } from './secrets.js';

const parse = (v) => { try { return JSON.parse(v); } catch { return v; } };

// `single` = the check has one step (one API compared with a value you set), so wording must not talk about two systems syncing
function explainOne(f, stepName, single = false) {
  let m;
  if ((m = /timed out after (\d+)ms/.exec(f))) return `"${stepName}" did not answer within ${m[1]}ms. The system may be down, overloaded or unreachable. Check that service's health and network access first.`;
  if ((m = /expected status (\d+), got (\d+)/.exec(f))) {
    const got = Number(m[2]);
    if (got === 401 || got === 403) return `"${stepName}" was refused (${got}). The API key or token is probably wrong, expired or missing permissions. Check the secret used by this check.`;
    if (got === 404 && single) return `"${stepName}" returned 404: the URL or item was not found. Check the URL is spelled correctly and the item still exists.`;
    if (got === 404) return `"${stepName}" returned 404: the record or URL was not found. If an earlier step created it, the sync may not have happened yet or failed. Check the receiving system's logs for that ID.`;
    if (got === 429) return `"${stepName}" was rate-limited (429). Slow the check's schedule or ask the provider for a higher limit.`;
    if (got >= 500) return `"${stepName}" failed on the server side (${got}). The system itself has a problem. Check its logs or status page.`;
    return `"${stepName}" returned status ${got} instead of ${m[1]}. Check the request URL, method and body.`;
  }
  if ((m = /^(.+?): expected (.+), got (.+)$/.exec(f))) {
    const [, field, e, g] = m;
    const exp = parse(e), got = parse(g);
    if (got === undefined || got === null || g === 'undefined' || g === 'null') return `Field "${field}" is missing in the response (expected ${e}). The record may be incomplete, or the API field was renamed or removed.`;
    const en = Number(exp), gn = Number(got);
    if (Number.isFinite(en) && Number.isFinite(gn) && en !== gn) {
      for (const p of [1000, 100, 10]) {
        if (gn === Math.floor(en / p) * p) return `"${field}" is ${gn} but should be ${en}: the value looks rounded down to the nearest ${p}. ${single ? 'The API is probably truncating or rounding this number.' : 'A system in the sync is probably truncating or rounding numbers.'} Check how it is stored and converted.`;
      }
      if (single) return `"${field}" is ${gn} but the check expects ${en} (difference ${gn - en}). Either the data really changed (if that is expected, update the check) or the API is returning a wrong value. Check what changed in that API.`;
      return `"${field}" is ${gn} but should be ${en} (difference ${gn - en}). The two systems disagree on this number. Check which one is the source of truth and the mapping or conversion between them.`;
    }
    if (typeof exp === 'string' && typeof got === 'string' && exp.trim().toLowerCase() === got.trim().toLowerCase()) return `"${field}" differs only in letter case or spaces (${g} vs ${e}). One system is normalising text. Decide on one format.`;
    if (single) return `"${field}" is ${g} but the check expects ${e}. Either the data really changed (if that is expected, update the check) or the API is returning a wrong value.`;
    return `"${field}" is ${g} but should be ${e}. The data did not arrive as sent. Check the field mapping between the systems.`;
  }
  return `"${stepName}" failed: ${f}. Check that the system is reachable and the check's URL and settings are right.`;
}

export function explainByRules(result) {
  const single = (result.steps || []).length === 1;
  const lines = (result.failures || []).map((f) => explainOne(f, result.failedStep || 'a step', single));
  return lines.join(' ');
}

async function explainByAi(result, { apiKey, model, fetchFn }) {
  const facts = JSON.stringify({ check: result.name, failedStep: result.failedStep, failures: result.failures, stepsRun: result.steps.map((s) => ({ name: s.name, ok: s.ok, status: s.status })) });
  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 300,
      system: 'You help non-experts understand failed integration checks between business systems. Reply in at most 3 short plain-English sentences: the most likely cause, then the first thing to check. Do not invent facts beyond the data given; say "probably" when unsure.',
      messages: [{ role: 'user', content: `A check failed. Data:\n${facts}` }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`AI returned ${res.status}`);
  const text = (await res.json()).content?.find((c) => c.type === 'text')?.text?.trim();
  if (!text) throw new Error('empty AI reply');
  return text;
}

export function createExplainer({ apiKey, model = 'claude-haiku-4-5-20251001', fetchFn = fetch, secretValues = () => ({}) } = {}) {
  const cache = new Map(); // same failure again = no new AI call (keeps cost near zero)
  return async function explain(result) {
    const key = `${result.id}|${result.failedStep}|${(result.failures || []).join('|')}`;
    if (cache.has(key)) return cache.get(key);
    let out = { text: explainByRules(result), source: 'rules' };
    if (apiKey) {
      try { out = { text: redact(await explainByAi(result, { apiKey, model, fetchFn }), secretValues()), source: 'ai' }; }
      catch (e) { console.error('AI explanation failed, using rules:', e.message); }
    }
    cache.set(key, out);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return out;
  };
}
