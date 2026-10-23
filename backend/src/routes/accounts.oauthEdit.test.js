import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/db.js', () => ({ query: vi.fn() }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.session = { userId: 'user-1' }; next(); },
}));
vi.mock('../index.js', () => ({ imapManager: { connectAccount: vi.fn().mockResolvedValue(undefined), disconnectAccount: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../services/connectionPolicy.js', () => ({
  getConnectionPolicy: vi.fn().mockResolvedValue({ allowPrivateHosts: true, allowInsecureTls: false, allowNonstandardPorts: false }),
}));
vi.mock('../services/encryption.js', () => ({ encrypt: (v) => v }));
vi.mock('../services/hostValidation.js', () => ({ validateHost: vi.fn(async () => null) }));

import express from 'express';
import accountRoutes, { OAUTH_OWNED_FIELDS } from './accounts.js';
import { query } from '../services/db.js';

const ID = '44444444-4444-4444-4444-444444444444';

// A Microsoft or Google sign-in owns the account's server and login (#674): editing the
// account's other settings can neither change nor wipe them, whatever the request carries.
describe('PUT /api/accounts/:id for an OAuth account', () => {
  let server;
  let base;
  let provider;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/accounts', accountRoutes);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/accounts`;
  });
  afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
  beforeEach(() => {
    query.mockReset().mockImplementation(async (sql) => {
      if (/^SELECT id, oauth_provider FROM email_accounts/.test(sql)) return { rows: [{ id: ID, oauth_provider: provider }] };
      if (/^UPDATE email_accounts/.test(sql)) return { rows: [{ id: ID }] };
      return { rows: [] };
    });
  });

  const put = (body) => fetch(`${base}/${ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const updateSql = () => query.mock.calls.find(([sql]) => /^UPDATE email_accounts/.test(sql))?.[0] || '';
  const everything = {
    name: 'Maria', imap_host: 'evil.example.com', imap_port: 993, imap_skip_tls_verify: true,
    smtp_host: 'evil.example.com', smtp_port: 587, smtp_tls: 'STARTTLS',
    auth_user: 'someone@else.example', auth_pass: 'pw', smtp_auth_user: null, smtp_auth_pass: null,
  };

  it.each(['microsoft', 'google'])('a %s account keeps its server and login; other settings save', async (p) => {
    provider = p;
    expect((await put(everything)).status).toBe(200);
    const sql = updateSql();
    expect(sql).toMatch(/name = \$/);
    for (const field of OAUTH_OWNED_FIELDS) expect(sql).not.toMatch(new RegExp(`\\b${field} = \\$`));
  });

  it('a password account still changes them', async () => {
    provider = null;
    expect((await put(everything)).status).toBe(200);
    expect(updateSql()).toMatch(/imap_host = \$/);
    expect(updateSql()).toMatch(/auth_user = \$/);
  });
});
