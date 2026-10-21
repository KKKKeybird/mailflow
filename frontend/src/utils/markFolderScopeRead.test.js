import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markFolderScopeRead } from './markFolderScopeRead.js';

function fixture() {
  const calls = [], counts = [], folders = [];
  const state = { user: { id: 'owner' }, accounts: [
    { id: 'a', enabled: true }, { id: 'b', enabled: true },
    { id: 'hidden', enabled: true, include_in_unified_inbox: false }, { id: 'disabled', enabled: false },
  ], refreshSenderMembers: () => calls.push('refresh'), setUnreadCounts: value => counts.push(value),
  setFolders: (...value) => folders.push(value) };
  const api = { markAllRead: async (...args) => calls.push(args), getUnreadCounts: async () => ({ total: 7 }),
    getFolders: async id => [{ path: 'INBOX', account_id: id }] };
  globalThis.window = { dispatchEvent() {} };
  globalThis.CustomEvent = class {};
  return { state, api, calls, counts, folders, getState: () => state };
}

test('unified mark-all-read covers complete inboxes and excludes hidden/disabled accounts', async () => {
  const f = fixture();
  const result = await markFolderScopeRead({ ...f, accountId: null, folder: 'INBOX' });
  assert.equal(result.failed, 0);
  assert.deepEqual(f.calls, [['a', 'INBOX'], ['b', 'INBOX'], 'refresh']);
  assert.equal(f.folders.length, 2);
  assert.deepEqual(f.counts, [{ total: 7 }]);
});

test('one-account folder action never marks another folder or account', async () => {
  const f = fixture();
  await markFolderScopeRead({ ...f, accountId: 'hidden', folder: 'Custom/Folder' });
  assert.deepEqual(f.calls, [['hidden', 'Custom/Folder'], 'refresh']);
});

test('partial failure reports the error and refreshes successful accounts', async () => {
  const f = fixture();
  f.api.markAllRead = async id => { if (id === 'b') throw new Error('offline'); };
  const result = await markFolderScopeRead({ ...f, accountId: null });
  assert.deepEqual(result, { failed: 1, errors: ['offline'] });
  assert.deepEqual(f.calls, ['refresh']);
  assert.equal(f.folders.length, 2);
});

test('a response from the previous user cannot replace the new user counters', async () => {
  const f = fixture();
  f.api.markAllRead = async () => { f.state.user = { id: 'new-owner' }; };
  await markFolderScopeRead({ ...f, accountId: 'a', folder: 'INBOX' });
  assert.equal(f.counts.length, 0);
  assert.equal(f.folders.length, 0);
  assert.equal(f.calls.length, 0);
});
