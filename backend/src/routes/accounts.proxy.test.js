import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/db.js', () => ({ query: vi.fn() }));
vi.mock('../middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.session = { userId: 'owner' }; next(); } }));
vi.mock('../index.js', () => ({ imapManager: {
  connectAccount: vi.fn().mockResolvedValue(), disconnectAccount: vi.fn().mockResolvedValue(), clearConnectCooldown: vi.fn(),
} }));
vi.mock('../services/connectionPolicy.js', () => ({ getConnectionPolicy: vi.fn().mockResolvedValue({ allowPrivateHosts: true }) }));
import express from 'express';
import routes from './accounts.js';
import { query } from '../services/db.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { imapManager } from '../index.js';
const ID = '44444444-4444-4444-4444-444444444444';
const account = { id: ID, name: 'Mailbox', email_address: 'owner@example.com', protocol: 'imap', enabled: true,
  proxy_type: 'socks5', proxy_host: '127.0.0.1', proxy_port: 1080, proxy_username: 'user' };

describe('account proxy settings', () => {
  let server, base;
  beforeAll(async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'b'.repeat(64));
    const app = express(); app.use(express.json()); app.use('/api/accounts', routes);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/accounts`;
  });
  afterAll(async () => { await new Promise(resolve => server.close(resolve)); vi.unstubAllEnvs(); });
  beforeEach(() => {
    query.mockReset(); vi.clearAllMocks();
    query.mockImplementation(async sql => ({ rows: sql.includes('account_aliases') ? [] : [account] }));
  });
  const put = body => fetch(`${base}/${ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  it('encrypts passwords on create and never includes them in the response', async () => {
    const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...account, proxy_password: 'secret@%' }) });
    expect(response.status).toBe(200);
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO email_accounts'));
    expect(decrypt(insert[1][26])).toBe('secret@%');
    expect(insert[1][26]).toMatch(/^enc:v1:/);
    expect(await response.json()).not.toHaveProperty('proxy_password');
  });
  it('updates and encrypts the password, marks it as stored and reconnects', async () => {
    query.mockResolvedValueOnce({ rows: [account] });
    query.mockResolvedValueOnce({ rows: [{ ...account, proxy_password: encrypt('new-secret') }] });
    const response = await put({ proxy_password: 'new-secret' });
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.proxy_password_set).toBe(true); expect(saved).not.toHaveProperty('proxy_password');
    const [sql, values] = query.mock.calls[1];
    const placeholder = Number(sql.match(/proxy_password = \$(\d+)/)[1]);
    expect(decrypt(values[placeholder - 1])).toBe('new-secret');
    expect(imapManager.disconnectAccount).toHaveBeenCalledWith(ID);
    expect(imapManager.connectAccount).toHaveBeenCalled();
  });
  it('preserves the saved password when editing the endpoint', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...account, proxy_password: encrypt('saved') }] });
    expect((await put({ proxy_port: 1081 })).status).toBe(200);
    expect(query.mock.calls[1][0]).not.toContain('proxy_password =');
  });
  it('can explicitly clear the password and disable the proxy', async () => {
    expect((await put({ proxy_type: 'none', proxy_password: null })).status).toBe(200);
    const [sql, values] = query.mock.calls[1];
    expect(values[Number(sql.match(/proxy_password = \$(\d+)/)[1]) - 1]).toBeNull();
  });
  it('only selects a password presence flag in account lists', async () => {
    const response = await fetch(base); expect(response.status).toBe(200);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('proxy_password IS NOT NULL AS proxy_password_set');
    expect(sql).not.toMatch(/[,\s]proxy_password\s*,/);
  });
  it('rejects incomplete settings before writing', async () => {
    expect((await put({ proxy_host: '' })).status).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('rejects non-owner edits', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await put({ proxy_password: 'secret' })).status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
