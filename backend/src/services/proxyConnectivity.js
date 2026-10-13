import net from 'node:net';
import { validateMailProxy } from './mailProxy.js';
import { resolveForConnection } from './hostValidation.js';

// Probe the proxy endpoint from the backend, without using mailbox credentials,
// changing an account, or claiming that an open port proves a working tunnel.
export async function testProxyConnectivity(input, policy, timeoutMs = 10000) {
  let socket, timer, finished = false;
  const started = Date.now();
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
  });
  const check = (async () => {
    const proxy = await validateMailProxy({ proxy_type: input.proxy_type,
      proxy_host: input.proxy_host, proxy_port: input.proxy_port }, policy);
    if (proxy.proxy_type === 'none') throw new Error('Proxy: select a proxy type');
    const endpoint = await resolveForConnection(proxy.proxy_host, { allowPrivate: policy.allowPrivateHosts });
    if (finished) return;
    const host = endpoint.host?.replace(/^\[|\]$/g, '');
    if (!net.isIP(host)) return { ok: false, reason: 'dns' };
    return await new Promise(resolve => {
      const options = { host, port: proxy.proxy_port };
      if (endpoint.lookup && endpoint.servername) Object.assign(options, {
        host: endpoint.servername, lookup: endpoint.lookup,
        autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250,
      });
      socket = net.connect(options);
      socket.once('connect', () => resolve({ ok: true, latencyMs: Date.now() - started }));
      socket.once('error', err => resolve({ ok: false, reason:
        err.code === 'ECONNREFUSED' ? 'refused' : err.code === 'ETIMEDOUT' ? 'timeout' : 'unreachable' }));
      socket.once('close', () => resolve({ ok: false, reason: 'unreachable' }));
    });
  })();
  try { return await Promise.race([check, timeout]); }
  finally {
    finished = true;
    clearTimeout(timer);
    socket?.destroy();
  }
}
