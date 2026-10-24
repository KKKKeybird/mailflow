import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Every mail route that looks up an account or message through services/ownership.js: another
// user's account or message is refused with the same status and body as before the lookups were
// shared, before anything is written or sent to IMAP, and the owner gets past the check.
const session = vi.hoisted(() => ({ userId: 'owner' }));
const imap = vi.hoisted(() => {
  const fns = {};
  const manager = new Proxy(fns, {
    get(target, prop) {
      if (!(prop in target)) target[prop] = vi.fn(() => Promise.resolve(undefined));
      return target[prop];
    },
  });
  return { fns, manager };
});
vi.mock('../services/db.js', () => ({ query: vi.fn() }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.session = { userId: session.userId }; next(); },
}));
vi.mock('../index.js', () => ({ imapManager: imap.manager }));
vi.mock('../services/imageProxy.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchProxiedImage: vi.fn(() => Promise.reject(Object.assign(new Error('no network'), { status: 502 }))),
}));

import express from 'express';
import mailRoutes from './mail.js';
import { query } from '../services/db.js';
import { fetchProxiedImage } from '../services/imageProxy.js';

const OWNER = 'owner';
const STRANGER = 'stranger';
const ACCOUNT_ID = 'a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';
const MESSAGE_ID = 'b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2';
const IMAGE_URL = 'https://img.example/pic.png';

const account = () => ({ id: ACCOUNT_ID, user_id: OWNER, email_address: 'me@example.com', folder_mappings: {}, protocol: 'imap', enabled: true });
const message = () => ({
  id: MESSAGE_ID, account_id: ACCOUNT_ID, uid: 7, folder: 'INBOX', message_id: '<m1@example.com>',
  subject: 'Hello', from_email: 'a@example.com', is_read: false, is_starred: false, is_deleted: false,
  attachments: [], bcc_addresses: ['b@example.com'], list_unsubscribe: null, list_unsubscribe_post: null,
  body_html: `<p><img src="${IMAGE_URL}"></p>`, user_id: OWNER, folder_mappings: {}, sibling_count: 1,
});

const flat = sql => sql.replace(/\s+/g, ' ').trim();
let writes;
function fakeQuery(rawSql, params = []) {
  const sql = flat(rawSql);
  const result = rows => Promise.resolve({ rows, rowCount: rows.length });
  if (/^(UPDATE|DELETE|INSERT)\b/.test(sql)) writes.push(sql);
  if (/^SELECT .+ FROM email_accounts WHERE id = \$1 AND user_id = \$2/.test(sql)) {
    return result(params[0] === ACCOUNT_ID && params[1] === OWNER ? [account()] : []);
  }
  if (/FROM messages m JOIN email_accounts a ON (m\.account_id = a\.id|a\.id = m\.account_id) WHERE m\.id = \$1 AND a\.user_id = \$2/.test(sql)) {
    return result(params[0] === MESSAGE_ID && params[1] === OWNER ? [message()] : []);
  }
  if (sql.includes('FROM messages m JOIN email_accounts a ON m.account_id = a.id WHERE m.id = ANY($2::uuid[]) AND a.user_id = $1')) {
    return result(params[0] === OWNER && params[1].includes(MESSAGE_ID) ? [message()] : []);
  }
  if (sql.startsWith('SELECT * FROM email_accounts WHERE id = $1')) return result([account()]);
  if (sql.includes('count(*)')) return result([{ inbox_total: 0, bulk_total: 0 }]);
  return result([]);
}

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/mail', mailRoutes);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/mail`;
});
afterAll(() => new Promise(r => server.close(r)));

beforeEach(() => {
  writes = [];
  query.mockReset().mockImplementation(fakeQuery);
  fetchProxiedImage.mockClear();
  for (const key of Object.keys(imap.fns)) delete imap.fns[key];
  Object.assign(imap.fns, {
    broadcast: vi.fn(),
    noteUserActivity: vi.fn(),
    scheduleCountRefresh: vi.fn(),
    ensureFolder: vi.fn(() => Promise.resolve({ path: 'New' })),
    fetchHeaders: vi.fn(() => Promise.resolve('Subject: Hello\r\n')),
    fetchRawMessage: vi.fn(() => Promise.resolve(Buffer.from('Subject: Hello\r\n\r\nBody'))),
    snoozedRows: vi.fn(() => Promise.resolve([])),
    isWakingSnooze: vi.fn(() => false),
  });
});

async function call(userId, { method = 'GET', path, body }) {
  session.userId = userId;
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

const imapCalls = () => Object.entries(imap.fns)
  .filter(([name, fn]) => name !== 'noteUserActivity' && fn.mock?.calls.length)
  .map(([name]) => name);

const accountNotFound = { status: 404, json: { error: 'Account not found' } };
const messageNotFound = { status: 404, json: { error: 'Message not found' } };
const until = () => new Date(Date.now() + 86_400_000).toISOString();

// [name, request, refusal for another user's resource, what the owner gets past the check]. Some
// owner answers are refusals of their own (no Trash folder, nothing snoozed): the mocks stop
// there, and getting that far is what shows the owner passed the ownership check.
const cases = [
  ['POST /sync', { method: 'POST', path: '/sync', body: { accountId: ACCOUNT_ID } }, accountNotFound, { status: 200 }],
  ['POST /sync-folders', { method: 'POST', path: '/sync-folders', body: { accountId: ACCOUNT_ID } }, accountNotFound, { status: 200 }],
  ['POST /sync-folder', { method: 'POST', path: '/sync-folder', body: { accountId: ACCOUNT_ID, folder: 'INBOX' } }, accountNotFound, { status: 200 }],
  ['POST /mark-all-read', { method: 'POST', path: '/mark-all-read', body: { accountId: ACCOUNT_ID } }, accountNotFound, { status: 200 }],
  ['POST /folders', { method: 'POST', path: '/folders', body: { accountId: ACCOUNT_ID, name: 'New' } }, accountNotFound, { status: 200, json: { ok: true, path: 'New' } }],
  ['POST /folders/delete', { method: 'POST', path: '/folders/delete', body: { accountId: ACCOUNT_ID, path: 'Old' } }, accountNotFound, { status: 200 }],
  ['POST /folders/rename', { method: 'POST', path: '/folders/rename', body: { accountId: ACCOUNT_ID, oldPath: 'Old', newName: 'New' } }, accountNotFound, { status: 200, json: { ok: true, newPath: 'New' } }],
  ['POST /folders/empty', { method: 'POST', path: '/folders/empty', body: { accountId: ACCOUNT_ID, path: 'Old' } }, accountNotFound, { status: 202 }],
  ['GET /mailbox-usage', { path: `/mailbox-usage?accountId=${ACCOUNT_ID}` }, accountNotFound, { status: 200 }],
  ['GET /cleanup-preview', { path: `/cleanup-preview?accountId=${ACCOUNT_ID}&fromEmail=a@example.com` }, accountNotFound, { status: 200, json: { accountId: ACCOUNT_ID, fromEmail: 'a@example.com', count: 0, ids: [] } }],
  ['GET /messages/:id', { path: `/messages/${MESSAGE_ID}` }, messageNotFound, { status: 200 }],
  ['GET /messages/:id/headers', { path: `/messages/${MESSAGE_ID}/headers` }, messageNotFound, { status: 200 }],
  ['GET /messages/:id/bcc', { path: `/messages/${MESSAGE_ID}/bcc` }, messageNotFound, { status: 200, json: { bcc: ['b@example.com'] } }],
  ['GET /messages/:id/attachments.zip', { path: `/messages/${MESSAGE_ID}/attachments.zip` }, messageNotFound, { status: 404, json: { error: 'No attachments' } }],
  ['GET /messages/:id/attachments/:part', { path: `/messages/${MESSAGE_ID}/attachments/2` }, messageNotFound, { status: 404, json: { error: 'Attachment not found' } }],
  ['GET /messages/:id/image', { path: `/messages/${MESSAGE_ID}/image?u=${encodeURIComponent(IMAGE_URL)}` }, { status: 404, text: '' }, { status: 502, fetchesImage: true }],
  ['GET /messages/:id/raw.eml', { path: `/messages/${MESSAGE_ID}/raw.eml` }, messageNotFound, { status: 200 }],
  ['PATCH /messages/:id/read', { method: 'PATCH', path: `/messages/${MESSAGE_ID}/read`, body: { read: true } }, messageNotFound, { status: 200 }],
  ['PATCH /messages/:id/star', { method: 'PATCH', path: `/messages/${MESSAGE_ID}/star`, body: { starred: true } }, messageNotFound, { status: 200, json: { ok: true, is_starred: true } }],
  ['POST /messages/bulk-read', { method: 'POST', path: '/messages/bulk-read', body: { ids: [MESSAGE_ID], read: true } }, { status: 200, json: { ok: true, updated: [] } }, { status: 200 }],
  ['POST /messages/bulk-star', { method: 'POST', path: '/messages/bulk-star', body: { ids: [MESSAGE_ID], starred: true } }, { status: 200, json: { ok: true, updated: [] } }, { status: 200 }],
  ['POST /messages/bulk-delete', { method: 'POST', path: '/messages/bulk-delete', body: { ids: [MESSAGE_ID] } }, { status: 200, json: { ok: true, deleted: [] } }, { status: 200, calls: ['_guardMoveUid'] }],
  ['POST /messages/bulk-move', { method: 'POST', path: '/messages/bulk-move', body: { ids: [MESSAGE_ID], folder: 'Archive' } }, { status: 200, json: { ok: true, moved: [] } }, { status: 200, calls: ['_guardMoveUid'] }],
  ['POST /messages/bulk-archive', { method: 'POST', path: '/messages/bulk-archive', body: { ids: [MESSAGE_ID] } }, { status: 200, json: { ok: true, archived: [], noArchiveFolder: [] } }, { status: 200 }],
  ['POST /messages/:id/copy', { method: 'POST', path: `/messages/${MESSAGE_ID}/copy`, body: { folder: 'Label' } }, messageNotFound, { status: 400, json: { error: 'Folder is not a copy target' } }],
  ['POST /messages/:id/snooze', { method: 'POST', path: `/messages/${MESSAGE_ID}/snooze`, body: { until: until() } }, messageNotFound, { status: 200, json: { ok: true } }],
  ['PATCH /messages/:id/snooze', { method: 'PATCH', path: `/messages/${MESSAGE_ID}/snooze`, body: { until: until() } }, messageNotFound, { status: 404, json: { error: 'Message is not snoozed' } }],
  ['POST /messages/:id/unsnooze', { method: 'POST', path: `/messages/${MESSAGE_ID}/unsnooze` }, messageNotFound, { status: 404, json: { error: 'Message is not snoozed' } }],
  ['DELETE /messages/:id', { method: 'DELETE', path: `/messages/${MESSAGE_ID}` }, messageNotFound, { status: 422, json: { error: 'No Trash folder configured for this account' } }],
  ['POST /messages/:id/spam', { method: 'POST', path: `/messages/${MESSAGE_ID}/spam` }, messageNotFound, { status: 422, json: { error: 'No spam folder configured for this account' } }],
  ['POST /messages/:id/ham', { method: 'POST', path: `/messages/${MESSAGE_ID}/ham` }, messageNotFound, { status: 400, json: { error: 'Message is not in the spam folder' } }],
  ['POST /messages/:id/unsubscribe', { method: 'POST', path: `/messages/${MESSAGE_ID}/unsubscribe` }, messageNotFound, { status: 400, json: { error: 'No unsubscribe header' } }],
];

describe('mail routes refuse another user\'s account or message', () => {
  it.each(cases)('%s', async (_name, request, refusal) => {
    const res = await call(STRANGER, request);
    expect(res.status).toBe(refusal.status);
    if ('json' in refusal) expect(res.json).toEqual(refusal.json);
    if ('text' in refusal) expect(res.text).toBe(refusal.text);
    expect(writes).toEqual([]);
    expect(imapCalls()).toEqual([]);
    expect(fetchProxiedImage).not.toHaveBeenCalled();
  });
});

describe('mail routes still serve the owner', () => {
  it.each(cases)('%s', async (_name, request, refusal, owner) => {
    const res = await call(OWNER, request);
    // A bulk route answers an empty result either way; the IMAP guard it took shows it got the rows.
    if (!owner.calls) expect({ status: res.status, json: res.json }).not.toEqual({ status: refusal.status, json: refusal.json ?? null });
    expect(res.status).toBe(owner.status);
    if (owner.json) expect(res.json).toEqual(owner.json);
    for (const name of owner.calls || []) expect(imapCalls()).toContain(name);
    if (owner.fetchesImage) expect(fetchProxiedImage).toHaveBeenCalledWith(IMAGE_URL);
  });
});
