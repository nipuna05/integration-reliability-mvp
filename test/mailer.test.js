import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smtpSend, buildMessage, createMailer } from '../lib/mailer.js';
import { fakeSmtp } from '../test-support/fake-smtp.js';
import { dispatch, sendTestAlert, subjectFor } from '../lib/alerts.js';

const decodeBody = (data) => Buffer.from(data.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString('utf8');

test('sends a real SMTP conversation: auth, sender, recipients, subject and body', async () => {
  const { server, log, port } = await fakeSmtp();
  try {
    const cfg = { host: 'localhost', port, secure: false, user: 'me@x.test', pass: 's3cret', from: 'me@x.test' };
    await smtpSend(cfg, { to: ['a@y.test', 'b@y.test'], subject: '🔴 Failed: Salary sync', text: 'line1\n.\nline3 with a lone dot above' });
    assert.ok(log.cmds.includes('AUTH LOGIN'));
    assert.ok(log.cmds.includes(Buffer.from('me@x.test').toString('base64')));
    assert.ok(log.cmds.includes(Buffer.from('s3cret').toString('base64')));
    assert.ok(log.cmds.includes('MAIL FROM:<me@x.test>'));
    assert.ok(log.cmds.includes('RCPT TO:<a@y.test>') && log.cmds.includes('RCPT TO:<b@y.test>'));
    assert.match(log.data, /Subject: =\?UTF-8\?B\?/);
    assert.equal(decodeBody(log.data), 'line1\n.\nline3 with a lone dot above');
  } finally { server.close(); }
});

test('a rejected login is reported as an error, not silently ignored', async () => {
  const { server, port } = await fakeSmtp({ rejectAuth: true });
  try {
    await assert.rejects(smtpSend({ host: 'localhost', port, secure: false, user: 'u', pass: 'wrong', from: 'u@x.test' }, { to: ['a@y.test'], subject: 's', text: 't' }), /535/);
  } finally { server.close(); }
});

test('header injection is neutralised (no extra headers from a subject with line breaks)', () => {
  const msg = buildMessage({ from: 'a@x.test', to: ['b@y.test'], subject: 'Hi\r\nBcc: evil@z.test', text: 'x' });
  assert.equal(/^Bcc:/m.test(msg), false);
});

test('createMailer is off without SMTP_HOST and ALERT_EMAIL_TO, masks addresses, defaults to TLS on 465', () => {
  assert.equal(createMailer({}), null);
  assert.equal(createMailer({ SMTP_HOST: 'h' }), null);
  let seen;
  const m = createMailer({ SMTP_HOST: 'smtp.x.test', SMTP_USER: 'u@x.test', SMTP_PASS: 'p', ALERT_EMAIL_TO: 'alice@example.test, bob@example.test' }, async (cfg, msg) => { seen = { cfg, msg }; });
  assert.deepEqual(m.maskedTo, ['a***@example.test', 'b***@example.test']);
  return m.send('s', 't').then(() => {
    assert.equal(seen.cfg.secure, true);
    assert.equal(seen.cfg.port, 465);
    assert.equal(seen.cfg.from, 'u@x.test');
    assert.deepEqual(seen.msg.to, ['alice@example.test', 'bob@example.test']);
  });
});

test('dispatch emails on failure and recovery; a broken mailer does not stop other alerts', async () => {
  const sent = [], hooks = [];
  const mailer = { send: async (s, t) => sent.push([s, t]) };
  const ev = (type) => ({ type, check: { name: 'Salary sync', failedStep: 's', failures: ['bad'] } });
  await dispatch([ev('failed'), ev('recovered')], { webhookUrl: 'http://x', send: async (u, t) => hooks.push(t), mailer });
  assert.deepEqual(sent.map((s) => s[0]), ['🔴 Failed: Salary sync', '✅ Recovered: Salary sync']);
  assert.equal(hooks.length, 2);
  const broken = { send: async () => { throw new Error('smtp down'); } };
  await dispatch([ev('failed')], { webhookUrl: 'http://x', send: async (u, t) => hooks.push(t), mailer: broken });
  assert.equal(hooks.length, 3);
  assert.equal(subjectFor(ev('failed')).startsWith('🔴'), true);
});

test('test alert reports each channel separately', async () => {
  const out = await sendTestAlert({ webhookUrl: undefined, mailer: { send: async () => {} } });
  assert.deepEqual(out, { webhook: 'not configured', email: 'sent' });
  const bad = await sendTestAlert({ mailer: { send: async () => { throw new Error('535 bad credentials'); } } });
  assert.match(bad.email, /failed: 535/);
});

import { brevoSend } from '../lib/mailer.js';

test('Brevo: correct endpoint, api-key header and body; errors show the provider message', async () => {
  let seen;
  const ok = async (url, opts) => { seen = { url, opts, body: JSON.parse(opts.body) }; return { ok: true }; };
  await brevoSend({ apiKey: 'KEY1', from: 'Alerts <alerts@x.test>' }, { to: ['a@y.test'], subject: '🔴 Failed\r\nBcc: z', text: 'hello' }, ok);
  assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(seen.opts.headers['api-key'], 'KEY1');
  assert.deepEqual(seen.body.sender, { name: 'Alerts', email: 'alerts@x.test' });
  assert.deepEqual(seen.body.to, [{ email: 'a@y.test' }]);
  assert.equal(seen.body.textContent, 'hello');
  assert.equal(/[\r\n]/.test(seen.body.subject), false);

  const fail = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found' }) });
  await assert.rejects(brevoSend({ apiKey: 'bad', from: 'a@x.test' }, { to: ['a@y.test'], subject: 's', text: 't' }, fail), /Brevo 401: Key not found/);
});

test('createMailer prefers Brevo when its key, sender and recipient are set; needs a sender', async () => {
  const calls = [];
  const fetchFn = async (url, o) => { calls.push(url); return { ok: true }; };
  const env = { BREVO_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@x.test', ALERT_EMAIL_TO: 'bob@y.test', SMTP_HOST: 'smtp.x.test' };
  const m = createMailer(env, async () => { throw new Error('should not use SMTP'); }, fetchFn);
  assert.equal(m.provider, 'brevo');
  assert.deepEqual(m.maskedTo, ['b***@y.test']);
  await m.send('s', 't');
  assert.deepEqual(calls, ['https://api.brevo.com/v3/smtp/email']);
  assert.equal(createMailer({ BREVO_API_KEY: 'k', ALERT_EMAIL_TO: 'bob@y.test' }), null, 'no sender, no smtp -> off');
});
