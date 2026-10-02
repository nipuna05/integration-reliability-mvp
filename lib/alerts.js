// Alerts fire on state CHANGES only (pass -> fail, fail -> pass), not on every failing run.

export function detectTransitions(lastStatus, results) {
  const events = [];
  for (const r of results) {
    const prev = lastStatus.get(r.id); // undefined = first time we see this check
    if (prev === undefined && r.ok) { lastStatus.set(r.id, true); continue; }
    if (prev !== r.ok) events.push({ type: r.ok ? 'recovered' : 'failed', check: r });
    lastStatus.set(r.id, r.ok);
  }
  return events;
}

export function formatEvent({ type, check }) {
  if (type === 'recovered') return `✅ RECOVERED: ${check.name}`;
  const why = check.explanation ? `\nLikely cause: ${check.explanation.text}` : '';
  return `🔴 FAILED: ${check.name}\nStep: ${check.failedStep}\n${check.failures.join('\n')}${why}`;
}

// Works with Microsoft Teams, Slack and Discord incoming webhooks.
export async function sendWebhook(url, text, fetchFn = fetch) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`webhook returned ${res.status}`);
}

export async function dispatch(events, { webhookUrl, send = sendWebhook } = {}) {
  for (const e of events) {
    const text = formatEvent(e);
    console.log(`ALERT  ${text.replace(/\n/g, ' | ')}`);
    if (webhookUrl) await send(webhookUrl, text).catch((err) => console.error('webhook failed:', err.message));
  }
}
