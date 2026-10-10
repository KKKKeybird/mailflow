import net from 'node:net';
import { SocksClient } from 'socks';
import { decrypt } from './encryption.js';
import { validateHost, resolveForConnection } from './hostValidation.js';

export const PROXY_FIELDS = ['proxy_type', 'proxy_host', 'proxy_port', 'proxy_username', 'proxy_password'];
const bareHost = host => host?.replace(/^\[|\]$/g, '');

export async function validateMailProxy(input, policy = {}, { passwordEncrypted = false } = {}) {
  const type = input.proxy_type ?? 'none';
  if (!['none', 'http', 'socks5'].includes(type)) throw new Error('Proxy: choose none, HTTP CONNECT or SOCKS5');
  const result = { proxy_type: type };
  for (const key of ['proxy_host', 'proxy_username', 'proxy_password']) {
    const value = input[key];
    if (value != null && (typeof value !== 'string' || value.length > (key === 'proxy_password' && passwordEncrypted ? 8192 : 2048) || /[\r\n\0]/.test(value))) {
      throw new Error('Proxy: invalid host or credentials');
    }
    result[key] = (key === 'proxy_password' ? value : value?.trim()) || null;
  }
  if (input.proxy_port != null && !['number', 'string'].includes(typeof input.proxy_port)) throw new Error('Proxy: invalid port');
  result.proxy_port = input.proxy_port == null || input.proxy_port === '' ? null : Number(input.proxy_port);
  if (result.proxy_port !== null && (!Number.isInteger(result.proxy_port) || result.proxy_port < 1 || result.proxy_port > 65535)) {
    throw new Error('Proxy: port must be between 1 and 65535');
  }
  if (type === 'none') return result;
  const password = passwordEncrypted ? decrypt(result.proxy_password) : result.proxy_password;
  if (type === 'socks5' && [result.proxy_username || '', password || ''].some(value => Buffer.byteLength(value) > 255)) {
    throw new Error('Proxy: SOCKS5 username and password must each be at most 255 bytes');
  }
  const host = bareHost(result.proxy_host);
  if (!host || (!net.isIP(host) && !/^[a-zA-Z0-9._-]+$/.test(host))) {
    throw new Error('Proxy: enter a hostname or IP address without a URL or path');
  }
  if (!result.proxy_port) throw new Error('Proxy: host and port are required');
  const error = await validateHost(host, { allowPrivate: policy.allowPrivateHosts });
  if (error) throw new Error(`Proxy: ${error}`);
  return result;
}

// Pin both tunnel endpoints locally: remote DNS must not bypass the private-host policy.
export function proxyTargetHost(resolved) {
  const host = bareHost(resolved.host);
  if (!net.isIP(host)) throw new Error('Proxy: mail server DNS lookup failed');
  return host;
}

export async function resolveMailProxy(account, policy) {
  if (!account.proxy_type || account.proxy_type === 'none') return undefined;
  const config = await validateMailProxy(account, policy, { passwordEncrypted: true });
  const endpoint = await resolveForConnection(config.proxy_host, { allowPrivate: policy.allowPrivateHosts });
  const host = bareHost(endpoint.host);
  if (!net.isIP(host)) throw new Error('Proxy: proxy server DNS lookup failed');
  const password = decrypt(config.proxy_password);
  if (config.proxy_password && !password) throw new Error('Proxy: password is corrupted; re-enter it in account settings');
  const url = new URL(`${config.proxy_type}://${net.isIPv6(host) ? `[${host}]` : host}:${config.proxy_port}`);
  if (config.proxy_username) url.username = encodeURIComponent(config.proxy_username);
  if (password) url.password = encodeURIComponent(password);
  return url.href;
}

// A bounded SMTP socket hook handles authenticated SOCKS5 and IPv6 CONNECT targets.
export function proxySocketFactory(proxyUrl, timeout) {
  return (options, callback) => {
    const proxy = new URL(proxyUrl);
    let target;
    try { target = proxyTargetHost({ host: options.host }); }
    catch (err) { callback(err); return; }
    const username = decodeURIComponent(proxy.username);
    const password = decodeURIComponent(proxy.password);
    if (proxy.protocol === 'socks5:') {
      SocksClient.createConnection({
        proxy: { host: bareHost(proxy.hostname), port: Number(proxy.port), type: 5, userId: username, password },
        command: 'connect', destination: { host: target, port: Number(options.port) }, timeout,
      }, (err, info) => {
        // socks errors carry connection options, including credentials.
        if (err) { delete err.options; delete err.input; callback(err); }
        else callback(null, { connection: info.socket });
      });
      return;
    }
    const socket = net.connect({ host: bareHost(proxy.hostname), port: Number(proxy.port) });
    let buffer = Buffer.alloc(0);
    let finished = false;
    const timer = setTimeout(() => finish(new Error('Proxy connection timed out')), timeout);
    const finish = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      if (err) { socket.destroy(); callback(err); }
      else {
        socket.pause();
        if (buffer.length) socket.unshift(buffer);
        callback(null, { connection: socket });
      }
    };
    const onError = err => finish(err);
    const onClose = () => finish(new Error('Proxy connection closed during handshake'));
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end >= 0) {
        const status = buffer.subarray(0, end).toString('latin1').match(/^HTTP\/1\.[01] (\d{3})\b/);
        if (!status || Number(status[1]) < 200 || Number(status[1]) >= 300) {
          finish(new Error(`Proxy CONNECT failed${status ? ` (${status[1]})` : ''}`));
          return;
        }
        if (end > 65536) { finish(new Error('Proxy response headers too large')); return; }
        buffer = buffer.subarray(end + 4);
        finish();
      } else if (buffer.length > 65536) finish(new Error('Proxy response headers too large'));
    };
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.on('data', onData);
    socket.once('connect', () => {
      const authority = `${net.isIPv6(target) ? `[${target}]` : target}:${options.port}`;
      const auth = username || password ? `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}\r\n` : '';
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`);
    });
  };
}
