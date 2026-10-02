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

export const subjectFor = ({ type, check }) => (type === 'recovered' ? `✅ Recovered: ${check.name}` : `🔴 Failed: ${check.name}`);

// Short text for a phone notification (the full details are in the email and on the dashboard).
export function pushBody({ type, check }) {
  if (type === 'recovered') return `${check.name} is working again.`;
  return [check.failures?.[0], check.explanation?.text].filter(Boolean).join('\n') || `${check.name} stopped passing.`;
}

export async function dispatch(events, { webhookUrl, send = sendWebhook, mailer, push } = {}) {
  for (const e of events) {
    const text = formatEvent(e);
    console.log(`ALERT  ${text.replace(/\n/g, ' | ')}`);
    if (webhookUrl) await send(webhookUrl, text).catch((err) => console.error('webhook failed:', err.message));
    if (mailer) await mailer.send(subjectFor(e), text).catch((err) => console.error('email failed:', err.message));
    if (push?.enabled()) await push.send(subjectFor(e), pushBody(e), { checkId: e.check.id, type: e.type }).catch((err) => console.error('push failed:', err.message));
  }
}

// Sends one test message through every configured channel and reports what happened to each.
export async function sendTestAlert({ webhookUrl, send = sendWebhook, mailer, push }) {
  const text = '🔔 Test alert from Integration Reliability. If you can read this, alerts work.';
  const out = {};
  out.webhook = !webhookUrl ? 'not configured' : await send(webhookUrl, text).then(() => 'sent', (e) => `failed: ${e.message}`);
  out.email = !mailer ? 'not configured' : await mailer.send('🔔 Test alert', text).then(() => 'sent', (e) => `failed: ${e.message}`);
  if (!push?.enabled()) out.push = 'no phones registered';
  else {
    const r = await push.send('🔔 Test alert', 'If this buzzed your phone, push alerts work.');
    out.push = r.sent ? `sent to ${r.sent} device(s)` : `failed: ${r.errors[0] ?? 'no device accepted it'}`;
  }
  return out;
}
