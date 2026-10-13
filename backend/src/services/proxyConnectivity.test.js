import { describe, it, expect, vi } from 'vitest';
import net from 'node:net';
import { once, EventEmitter } from 'node:events';
import { testProxyConnectivity } from './proxyConnectivity.js';

const config = { proxy_type: 'http', proxy_host: '127.0.0.1', proxy_port: 8080 };
const policy = { allowPrivateHosts: true };
describe('proxy endpoint connectivity', () => {
  it('connects from the server without sending credentials or protocol data, then closes the socket', async () => {
    let bytes = 0;
    const sockets = new Set();
    const server = net.createServer(socket => {
      sockets.add(socket); socket.on('data', data => { bytes += data.length; });
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = server.address().port;
    try {
      const result = await testProxyConnectivity({ ...config, proxy_port: port, proxy_password: 'never sent' }, policy);
      expect(result.ok).toBe(true); expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(bytes).toBe(0);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
    expect(await testProxyConnectivity({ ...config, proxy_port: port }, policy)).toEqual({ ok: false, reason: 'refused' });
  });
  it('keeps the private host policy and validates host/port syntax before opening a socket', async () => {
    await expect(testProxyConnectivity(config, {})).rejects.toThrow(/private/);
    await expect(testProxyConnectivity({ ...config, proxy_port: 65536 }, policy)).rejects.toThrow(/port/);
    await expect(testProxyConnectivity({ ...config, proxy_host: 'http://127.0.0.1' }, policy)).rejects.toThrow(/hostname/);
    await expect(testProxyConnectivity({ proxy_type: 'none' }, policy)).rejects.toThrow(/select/);
  });
  it('bounds a stalled connection and destroys its socket', async () => {
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    const connect = vi.spyOn(net, 'connect').mockReturnValue(socket);
    try {
      expect(await testProxyConnectivity(config, policy, 20)).toEqual({ ok: false, reason: 'timeout' });
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    } finally { connect.mockRestore(); }
  });
});
