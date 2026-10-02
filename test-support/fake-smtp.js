import net from 'node:net';

// A tiny fake SMTP server that records what the client says.
export function fakeSmtp({ rejectAuth = false } = {}) {
  const log = { cmds: [], data: '' };
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let inData = false, buf = '';
    sock.write('220 fake ready\r\n');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else log.data += line + '\n';
          continue;
        }
        log.cmds.push(line);
        if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (log.cmds.at(-2) === 'AUTH LOGIN') sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (log.cmds.at(-3) === 'AUTH LOGIN') sock.write(rejectAuth ? '535 bad credentials\r\n' : '235 ok\r\n');
        else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) sock.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('500 what\r\n');
      }
    });
  });
  return new Promise((r) => server.listen(0, () => r({ server, log, port: server.address().port })));
}
