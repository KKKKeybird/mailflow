import { describe, it, expect, vi } from 'vitest';
import net from 'node:net';
import { once } from 'node:events';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { validateMailProxy, resolveMailProxy, proxySocketFactory, proxyTargetHost } from './mailProxy.js';
import { encrypt } from './encryption.js';

const config = { proxy_type: 'http', proxy_host: '127.0.0.1', proxy_port: 8080 };
const policy = { allowPrivateHosts: true };
const serve = async handler => {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); handler(socket);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { port: server.address().port, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  } };
};
const connect = (url, host = '127.0.0.1', timeout = 100) => new Promise((resolve, reject) => {
  proxySocketFactory(url, timeout)({ host, port: 465 }, (err, result) => err ? reject(err) : resolve(result.connection));
});

describe('mail proxy policy and credentials', () => {
  it('leaves existing accounts on direct connections', async () => {
    expect(await resolveMailProxy({}, {})).toBeUndefined();
    expect((await validateMailProxy({})).proxy_type).toBe('none');
  });
  it.each([
    { proxy_type: 'https' }, { proxy_port: 0 }, { proxy_port: 65536 },
    { proxy_host: 'http://example.com' }, { proxy_username: 'user\r\nheader' },
    { proxy_password: {} }, { proxy_host: '' }, { proxy_port: true },
  ])('rejects invalid config %j', async patch => {
    await expect(validateMailProxy({ ...config, ...patch }, policy)).rejects.toThrow('Proxy:');
  });
  it('rejects oversized SOCKS authentication before saving', async () => {
    await expect(validateMailProxy({ ...config, proxy_type: 'socks5', proxy_password: '界'.repeat(86) }, policy)).rejects.toThrow(/255 bytes/);
  });
  it('blocks private endpoints until enabled by the administrator', async () => {
    await expect(validateMailProxy(config)).rejects.toThrow(/private/);
    expect(await validateMailProxy(config, policy)).toMatchObject(config);
  });
  it('decrypts and percent-encodes credentials, including IPv6 endpoints', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
    const url = new URL(await resolveMailProxy({ ...config, proxy_type: 'socks5', proxy_host: '::1',
      proxy_username: 'user@name', proxy_password: encrypt('p:a%ss') }, policy));
    expect(url.hostname).toBe('[::1]');
    expect(decodeURIComponent(url.username)).toBe('user@name');
    expect(decodeURIComponent(url.password)).toBe('p:a%ss');
    vi.unstubAllEnvs();
  });
  it('never sends an unresolved target to remote DNS', () => {
    expect(() => proxyTargetHost({ host: 'unresolved.example' })).toThrow(/DNS/);
    expect(proxyTargetHost({ host: '[::1]' })).toBe('::1');
  });
});

describe('HTTP CONNECT socket', () => {
  it('authenticates, brackets IPv6 and preserves bytes following CONNECT headers', async () => {
    let request;
    const server = await serve(socket => socket.once('data', chunk => {
      request = chunk.toString(); socket.write('HTTP/1.1 200 OK\r\n\r\n220 greeting\r\n');
    }));
    try {
      const socket = await connect(`http://user%40name:p%3Aa%25ss@127.0.0.1:${server.port}`, '::1');
      const data = once(socket, 'data'); socket.resume();
      expect((await data)[0].toString()).toBe('220 greeting\r\n');
      expect(request).toContain('CONNECT [::1]:465 HTTP/1.1');
      expect(request).toContain(`Proxy-Authorization: Basic ${Buffer.from('user@name:p:a%ss').toString('base64')}`);
      socket.destroy();
    } finally { await server.close(); }
  });
  it.each(['reject', 'close', 'stall', 'large'])('fails safely when the proxy %s', async behavior => {
    const server = await serve(socket => socket.once('data', () => {
      if (behavior === 'reject') socket.write('HTTP/1.1 407 Authentication Required\r\n\r\n');
      if (behavior === 'close') socket.end();
      if (behavior === 'large') socket.write('x'.repeat(70000));
    }));
    try { await expect(connect(`http://127.0.0.1:${server.port}`)).rejects.toThrow(/Proxy/); }
    finally { await server.close(); }
  });
});

// A local tunnel endpoint speaks just enough IMAP/SMTP to exercise the real libraries.
// The destination is unreachable: success proves no direct socket was opened.
describe.each(['http', 'socks5'])('%s real mail connections', protocol => {
  async function mailProxy(kind) {
    const seen = [];
    const server = await serve(socket => {
      let phase = protocol === 'http' ? 'http' : 'greeting';
      let buffer = Buffer.alloc(0);
      const welcome = () => socket.write(kind === 'smtp' ? '220 proxy fixture ESMTP\r\n' : '* OK proxy fixture\r\n');
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length) {
          if (phase === 'http') {
            const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return;
            seen.push(buffer.subarray(0, end).toString()); buffer = buffer.subarray(end + 4);
            socket.write('HTTP/1.1 200 OK\r\n\r\n'); phase = 'mail'; welcome();
          } else if (phase === 'greeting') {
            if (buffer.length < 2 + buffer[1]) return;
            buffer = buffer.subarray(2 + buffer[1]); socket.write(Buffer.from([5, 2])); phase = 'auth';
          } else if (phase === 'auth') {
            if (buffer.length < 2 + buffer[1] + 1) return;
            const size = 3 + buffer[1] + buffer[2 + buffer[1]]; if (buffer.length < size) return;
            seen.push(buffer.subarray(2, 2 + buffer[1]).toString());
            seen.push(buffer.subarray(3 + buffer[1], size).toString());
            buffer = buffer.subarray(size); socket.write(Buffer.from([1, 0])); phase = 'target';
          } else if (phase === 'target') {
            if (buffer.length < 10) return;
            seen.push([...buffer.subarray(4, 8)].join('.')); buffer = buffer.subarray(10);
            socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); phase = 'mail'; welcome();
          } else {
            const end = buffer.indexOf('\r\n'); if (end < 0) return;
            const line = buffer.subarray(0, end).toString(); buffer = buffer.subarray(end + 2); seen.push(line);
            if (kind === 'smtp') {
              if (line.startsWith('EHLO')) socket.write('250-proxy fixture\r\n250 AUTH PLAIN\r\n');
              else if (line.startsWith('AUTH')) socket.write('235 Authenticated\r\n');
              else if (line === 'QUIT') socket.end('221 Bye\r\n');
            } else {
              const [tag, cmd] = line.split(' ');
              if (cmd === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
              else if (cmd === 'LOGIN') socket.write(`${tag} OK authenticated\r\n`);
              else if (cmd === 'LOGOUT') socket.end(`* BYE\r\n${tag} OK bye\r\n`);
              else socket.write(`${tag} OK done\r\n`);
            }
          }
        }
      });
    });
    return { ...server, seen, url: `${protocol}://user%40name:p%3Aa%25ss@127.0.0.1:${server.port}` };
  }
  it('connects and authenticates SMTP through the tunnel', async () => {
    const server = await mailProxy('smtp');
    const transport = nodemailer.createTransport({ host: '192.0.2.1', port: 587, secure: false,
      ignoreTLS: true, auth: { user: 'mailuser', pass: 'mailpass' },
      getSocket: proxySocketFactory(server.url, 1000), greetingTimeout: 1000 });
    try {
      expect(await transport.verify()).toBe(true);
      expect(server.seen.some(line => line.startsWith('AUTH'))).toBe(true);
      if (protocol === 'socks5') expect(server.seen.slice(0, 3)).toEqual(['user@name', 'p:a%ss', '192.0.2.1']);
    } finally { transport.close(); await server.close(); }
  });
  it('connects and authenticates IMAP through the tunnel', async () => {
    const server = await mailProxy('imap');
    const client = new ImapFlow({ host: '192.0.2.1', port: 143, secure: false, doSTARTTLS: false,
      auth: { user: 'mailuser', pass: 'mailpass' }, proxy: server.url, logger: false, connectionTimeout: 1000 });
    client.on('error', () => {});
    try {
      await client.connect();
      expect(server.seen.some(line => line.includes(' LOGIN '))).toBe(true);
      if (protocol === 'socks5') expect(server.seen.slice(0, 3)).toEqual(['user@name', 'p:a%ss', '192.0.2.1']);
    } finally { client.close(); await server.close(); }
  });
});
