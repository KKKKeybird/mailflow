import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  imapManager: { clearConnectCooldown: vi.fn(), connectAccount: vi.fn() },
  query: vi.fn(),
  withTransaction: vi.fn(),
  jwtVerify: vi.fn(),
}));

vi.mock('../index.js', () => ({ imapManager: mocks.imapManager }));
vi.mock('../services/db.js', () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock('../services/encryption.js', () => ({ encrypt: (v) => v, decrypt: (v) => v }));
vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: mocks.jwtVerify }));
vi.mock('../services/microsoftBuiltinApp.js', () => ({ MAILFLOW_MS_CLIENT_ID: 'builtin-app-id' }));

import express from 'express';
import oauthRoutes from './oauth.js';
import { noteRefreshFailure, refreshFailureFor } from '../services/accountErrorCode.js';

const realFetch = globalThis.fetch;
const ENV_KEYS = ['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT_ID', 'MS_REDIRECT_URI', 'MS_BUILTIN_APP',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];

// The accounts the signed-in user owns, by id.
const ACCOUNTS = {
  'ms-1': { id: 'ms-1', user_id: 'user-1', email_address: 'Maria.Lopez@outlook.com', imap_host: 'outlook.office365.com', oauth_provider: 'microsoft', oauth_client_id: 'builtin-app-id' },
  'g-1': { id: 'g-1', user_id: 'user-1', email_address: 'maria@gmail.com', imap_host: 'imap.gmail.com', oauth_provider: 'google' },
  'pw-1': { id: 'pw-1', user_id: 'user-1', email_address: 'maria@example.com', imap_host: 'imap.example.com', oauth_provider: null },
};

let session;
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/oauth', oauthRoutes);
  return app;
}

// Answers a SELECT against email_accounts by id (and user) with only the named columns.
function pick(sql, params) {
  const m = sql.match(/SELECT ([\w\s,*]+?) FROM email_accounts WHERE id = \$1 AND user_id = \$2/);
  if (!m) return null;
  const row = ACCOUNTS[params[0]];
  if (!row || row.user_id !== params[1]) return { rows: [] };
  const cols = m[1].split(',').map(c => c.trim());
  return { rows: [cols.includes('*') ? row : Object.fromEntries(cols.map(c => [c, row[c]]))] };
}

// "Sign in again" on a broken account (#674) names that account. Signing in to the provider as
// someone else must not add a second account, nor touch the one being repaired.
describe('repairing an account by signing in again', () => {
  let server;
  let base;
  let statements;
  let signedInAs;
  const saved = {};

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    await new Promise(resolve => { server = buildApp().listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    session = { userId: 'user-1', save: (cb) => cb() };
    statements = [];
    signedInAs = 'maria.lopez@outlook.com';
    mocks.query.mockReset().mockImplementation(async (sql, params) => pick(sql, params) || { rows: [] });
    const client = {
      query: vi.fn(async (sql, params) => {
        statements.push([sql, params]);
        if (/INSERT INTO email_accounts/.test(sql)) return { rows: [{ id: 'new-1' }] };
        if (/^SELECT \* FROM email_accounts WHERE id = \$1$/.test(sql)) return { rows: [ACCOUNTS[params[0]] || { id: params[0] }] };
        return pick(sql, params) || { rows: [] };
      }),
    };
    mocks.withTransaction.mockReset().mockImplementation(fn => fn(client));
    mocks.jwtVerify.mockReset().mockImplementation(async () => ({ payload: { email: signedInAs, name: 'Maria', email_verified: true } }));
    mocks.imapManager.connectAccount.mockReset().mockResolvedValue(true);
    mocks.imapManager.clearConnectCooldown.mockReset();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/devicecode')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'K7QWZP2M', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 }) };
      }
      return { ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: 'idt' }) };
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const writes = () => statements.filter(([sql]) => /UPDATE email_accounts|INSERT INTO email_accounts/.test(sql));
  const startDevice = (body) => realFetch(`${base}/oauth/microsoft/device`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const poll = async () => (await realFetch(`${base}/oauth/microsoft/device/poll`)).json();

  it('reports a different address and stores nothing', async () => {
    signedInAs = 'someone.else@hotmail.com';
    expect((await startDevice({ accountId: 'ms-1' })).status).toBe(200);
    expect(await poll()).toEqual({ status: 'wrong_account', signedInAs: 'someone.else@hotmail.com', expected: 'Maria.Lopez@outlook.com' });
    expect(writes()).toEqual([]);
    expect(mocks.imapManager.connectAccount).not.toHaveBeenCalled();
    // The flow is over: a second poll has nothing pending.
    expect((await poll()).status).toBe('error');
  });

  it('updates the account it was started for when the address matches without regard to case', async () => {
    noteRefreshFailure('ms-1', { code: 'oauth_reauth', detail: 'AADSTS700082: expired' });
    await startDevice({ accountId: 'ms-1' });
    expect(await poll()).toEqual({ status: 'checking', accountId: 'ms-1', email: 'maria.lopez@outlook.com' });
    expect(await poll()).toEqual({ status: 'success', accountId: 'ms-1', email: 'maria.lopez@outlook.com', connection: 'connected' });

    const [sql, params] = writes()[0];
    expect(writes()).toHaveLength(1);
    expect(sql).toMatch(/^\s*UPDATE email_accounts SET/);
    expect(sql).toMatch(/sync_error = NULL, sync_error_code = NULL/);
    expect(params[5]).toBe('ms-1');
    // A new sign-in replaces the tokens whose refresh failed.
    expect(refreshFailureFor('ms-1')).toBeNull();
    expect(mocks.imapManager.connectAccount).toHaveBeenCalledWith(ACCOUNTS['ms-1']);
  });

  it('signs a repair in through the client the account was connected with', async () => {
    process.env.MS_CLIENT_ID = 'own-app-id';
    process.env.MS_TENANT_ID = 'organizations';
    await startDevice({ accountId: 'ms-1' });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode');
    expect(init.body.get('client_id')).toBe('builtin-app-id');
  });

  it.each([
    ['another user\'s or a missing account', 'nope'],
    ['an account on another provider', 'g-1'],
    ['a password account', 'pw-1'],
  ])('refuses to start a repair for %s', async (_label, accountId) => {
    const res = await startDevice({ accountId });
    expect(res.status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('still adds or updates by address when no account is named', async () => {
    signedInAs = 'new.person@outlook.com';
    await startDevice({});
    expect((await poll()).status).toBe('checking');
    expect(writes().some(([sql]) => /INSERT INTO email_accounts/.test(sql))).toBe(true);
  });

  it('carries a repair through the Google redirect and refuses a different address', async () => {
    process.env.GOOGLE_CLIENT_ID = 'g-client';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://mail.example/oauth/google/callback';
    const start = await realFetch(`${base}/oauth/google?accountId=g-1`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    expect(session.oauthRepairAccountId).toBe('g-1');

    signedInAs = 'other@gmail.com';
    const cb = await realFetch(`${base}/oauth/google/callback?code=c&state=${session.oauthNonce}`, { redirect: 'manual' });
    const location = new URL(cb.headers.get('location'), base);
    expect(Object.fromEntries(location.searchParams)).toEqual({
      oauth_error: 'wrong_account', oauth_signed_in_as: 'other@gmail.com', oauth_expected: 'maria@gmail.com',
    });
    expect(writes()).toEqual([]);
    expect(session.oauthRepairAccountId).toBeUndefined();
  });

  // After Microsoft approves, the page shows "checking" and the next poll answers with how
  // the first connection went (#674).
  it('reports a mailbox that refuses the first connection, with its recorded error', async () => {
    signedInAs = 'new.person@outlook.com';
    mocks.imapManager.connectAccount.mockResolvedValue(false);
    mocks.query.mockImplementation(async (sql, params) => (/SELECT sync_error, sync_error_code/.test(sql)
      ? { rows: [{ sync_error: 'User is authenticated but not connected.', sync_error_code: 'ms_imap_disabled_personal' }] }
      : pick(sql, params) || { rows: [] }));
    await startDevice({});
    expect((await poll()).status).toBe('checking');
    expect(await poll()).toEqual({
      status: 'success', accountId: 'new-1', email: 'new.person@outlook.com',
      connection: 'failed', code: 'ms_imap_disabled_personal', error: 'User is authenticated but not connected.',
    });
    // The flow is finished.
    expect((await poll()).status).toBe('error');
  });

  it('reports connected as soon as the login is live, while the first sync is still running', async () => {
    signedInAs = 'new.person@outlook.com';
    mocks.imapManager.connectAccount.mockReturnValue(new Promise(() => {}));
    mocks.imapManager.isConnected = vi.fn(() => true);
    try {
      await startDevice({});
      await poll();
      expect(await poll()).toMatchObject({ status: 'success', connection: 'connected' });
    } finally {
      delete mocks.imapManager.isConnected;
    }
  });

  it('carries a repair through the Microsoft redirect', async () => {
    process.env.MS_CLIENT_ID = 'own-app-id';
    process.env.MS_CLIENT_SECRET = 'secret';
    process.env.MS_REDIRECT_URI = 'https://mail.example/oauth/microsoft/callback';
    await realFetch(`${base}/oauth/microsoft?accountId=ms-1`, { redirect: 'manual' });
    expect(session.oauthRepairAccountId).toBe('ms-1');
    const cb = await realFetch(`${base}/oauth/microsoft/callback?code=c&state=${session.oauthNonce}`, { redirect: 'manual' });
    // Back to the page with how the first connection went, for it to report honestly.
    expect(Object.fromEntries(new URL(cb.headers.get('location'), base).searchParams)).toEqual({
      oauth_success: 'microsoft', oauth_account_id: 'ms-1', oauth_email: 'maria.lopez@outlook.com', oauth_connection: 'connected',
    });
    expect(writes()[0][1][5]).toBe('ms-1');
  });
});
