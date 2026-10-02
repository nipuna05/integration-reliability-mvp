// Minimal SMTP client (no dependencies). Use port 465 (implicit TLS) for real providers such as
// Gmail/Brevo/Mailgun; secure=false is for local relays and tests only.
import net from 'node:net';
import tls from 'node:tls';

const clean = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

function connect({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setEncoding('utf8');
    sock.setTimeout(15_000, () => sock.destroy(new Error('SMTP timeout')));
    sock.once(secure ? 'secureConnect' : 'connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

function reader(sock) {
  let buf = '';
  const lines = [], waiters = [];
  const pump = () => {
    while (waiters.length) {
      const end = lines.findIndex((l) => /^\d{3} /.test(l));
      if (end < 0) break;
      const chunk = lines.splice(0, end + 1);
      waiters.shift().resolve({ code: Number(chunk[end].slice(0, 3)), text: chunk.map((l) => l.slice(4)).join(' ') });
    }
  };
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
    pump();
  });
  const fail = (e) => waiters.splice(0).forEach((w) => w.reject(e));
  sock.on('error', fail);
  sock.on('close', () => fail(new Error('SMTP connection closed')));
  return () => new Promise((resolve, reject) => { waiters.push({ resolve, reject }); pump(); });
}

export function buildMessage({ from, to, subject, text }) {
  const body = b64(text).match(/.{1,76}/g)?.join('\r\n') ?? '';
  return [
    `From: ${clean(from)}`, `To: ${to.map(clean).join(', ')}`, `Subject: ${encodeWord(clean(subject))}`,
    `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body,
  ].join('\r\n');
}

export async function smtpSend(cfg, { to, subject, text }) {
  const sock = await connect(cfg);
  const read = reader(sock);
  const cmd = async (line, ok) => {
    if (line !== null) sock.write(`${line}\r\n`);
    const r = await read();
    if (!ok.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text}`);
    return r;
  };
  try {
    await cmd(null, [220]);
    await cmd('EHLO localhost', [250]);
    if (cfg.user) {
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(cfg.user), [334]);
      await cmd(b64(cfg.pass), [235]);
    }
    await cmd(`MAIL FROM:<${clean(cfg.from)}>`, [250]);
    for (const r of to) await cmd(`RCPT TO:<${clean(r)}>`, [250, 251]);
    await cmd('DATA', [354]);
    await cmd(`${buildMessage({ from: cfg.from, to, subject, text })}\r\n.`, [250]);
    await cmd('QUIT', [221]).catch(() => {});
  } finally { sock.destroy(); }
}

// Returns null when email is not configured.
export function createMailer(env = process.env, send = smtpSend) {
  const to = (env.ALERT_EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!env.SMTP_HOST || !to.length) return null;
  const port = Number(env.SMTP_PORT || 465);
  const cfg = {
    host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === '1' : port === 465,
    user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.ALERT_EMAIL_FROM || env.SMTP_USER || 'alerts@localhost',
  };
  return {
    to,
    maskedTo: to.map((a) => a.replace(/^(.).*(@.*)$/, '$1***$2')),
    send: (subject, text) => send(cfg, { to, subject, text }),
  };
}
