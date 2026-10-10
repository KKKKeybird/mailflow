import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSenderGroupAction } from './senderGroupActions.js';
function fixture(count = 1201) {
  const targets = Array.from({ length: count }, (_, id) => ({ id, is_read: id % 2 === 0, account_id: 'a' }));
  let commit, cancelled = false;
  const calls = [], notices = [];
  const state = { user: { id: 'u' }, removeMessages: ids => calls.push(['remove', ids]), updateMessage() {}, decrementUnread() {}, refreshSenderMembers() {}, addNotification: notice => notices.push(notice) };
  const api = { getSenderGroupTargets: async scope => { calls.push(['snapshot', scope]); return { targets }; }, bulkArchive: async ids => { calls.push(['archive', ids]); return { archived: ids }; }, bulkRead: async ids => { calls.push(['read', ids]); return { updated: ids }; } };
  const options = { api, getState: () => state, sender: 'a@example.com', params: { accountId: 'a', unreadOnly: true }, action: 'archive', t: (key, args) => `${key}:${JSON.stringify(args)}`, schedule: fn => { commit = fn; return 1; }, cancel: () => { cancelled = true; }, finish: () => calls.push(['finish']) };
  return { options, state, calls, notices, run: async () => { if (!cancelled) await commit(); } };
}
test('archive covers unloaded members in bounded batches and ignores the unread display filter', async () => {
  const f = fixture(); await scheduleSenderGroupAction(f.options);
  assert.deepEqual(f.calls[0], ['snapshot', { accountId: 'a', sender: 'a@example.com' }]);
  assert.equal(f.calls.filter(([kind]) => kind === 'archive').length, 0);
  await f.run(); assert.deepEqual(f.calls.filter(([kind]) => kind === 'archive').map(([, ids]) => ids.length), [500, 500, 201]);
});
test('undo prevents all mail mutations', async () => {
  const f = fixture(); const pending = await scheduleSenderGroupAction(f.options);
  assert.equal(pending.undo(), true); await f.run(); assert.deepEqual(f.calls.map(([kind]) => kind), ['snapshot', 'finish']);
});
test('mark read targets only unread messages', async () => {
  const f = fixture(); await scheduleSenderGroupAction({ ...f.options, action: 'read' }); await f.run();
  const ids = f.calls.filter(([kind]) => kind === 'read').flatMap(([, ids]) => ids);
  assert.equal(ids.length, 600); assert.ok(ids.every(id => id % 2 === 1));
});
test('switching user before commit prevents writes', async () => {
  const f = fixture(); await scheduleSenderGroupAction(f.options); f.state.user = { id: 'other' }; await f.run();
  assert.equal(f.calls.filter(([kind]) => kind === 'archive').length, 0);
});
test('partial archive reports failure and removes only confirmed messages', async () => {
  const f = fixture(3); f.options.api.bulkArchive = async () => ({ archived: [1], noArchiveFolder: [2] });
  await scheduleSenderGroupAction(f.options); await f.run(); assert.deepEqual(f.calls.find(([kind]) => kind === 'remove'), ['remove', [1]]); assert.equal(f.notices.at(-1).type, 'error');
});

test('archive continues later batches when an account cannot archive', async () => {
  const f = fixture(1001); let batches = 0;
  f.options.api.bulkArchive = async ids => { batches++; return batches === 1 ? { archived: ids.slice(1), noArchiveFolder: ['a'] } : { archived: ids }; };
  await scheduleSenderGroupAction(f.options); await f.run();
  assert.equal(batches, 3); assert.equal(f.notices.at(-1).type, 'error');
  assert.equal(f.calls.filter(([kind]) => kind === 'remove').flatMap(([, ids]) => ids).length, 1000);
});
