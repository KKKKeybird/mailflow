import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageRowTree, actionableMessageRows, selectedListMessage, uniqueActionRows, neighborMessageRow } from './messageRowTree.js';
import { reconcileSenderHeads, removeSenderMembers, restoreSenderMembers, refreshSenderThreadReadState } from './senderGroupState.js';
const sender = 'alerts@example.com', key = `sender:{}:${sender}`;
const one = { id: 'one', from_email: sender, is_read: false, date: '2026-01-01' };
const two = { ...one, id: 'two', date: '2026-01-02' };
const head = { id: `sender:${sender}`, sender_group: sender, preview_message_id: 'two', sender_message_count: 2, sender_unread_count: 2 };
const state = () => ({ messages: [head, { id: 'outside' }], searchResults: [], searchQuery: '', selectedFolder: 'INBOX', senderGroupContext: '{}', groupedSenders: [sender], expandedSenders: new Set([key]), threadMessages: { [key]: [two, one] } });
test('one tree supplies expanded order and excludes controls and unloaded members from actions', () => {
  const s = state(); assert.equal(messageRowTree(s)[0].kind, 'sender');
  assert.deepEqual(actionableMessageRows(s).map(m=>m.id), ['two','one','outside']);
  s.expandedSenders.clear(); assert.deepEqual(actionableMessageRows(s).map(m=>m.id), ['outside']);
});
test('conversation controls and representative children have distinct keys and action scopes', () => {
  const s = state(); s.threadedView = true; s.expandedThreadId = 'thread';
  s.threadMessages[key] = [{ ...two, thread_id: 'thread', message_count: 2, unread_count: 2 }]; s.threadMessages.thread = [two, one];
  const rows = actionableMessageRows(s);
  assert.equal(rows[0].__list_kind, 'thread'); assert.equal(rows[1].__list_kind, 'message');
  assert.notEqual(rows[0].__list_key, rows[1].__list_key);
  s.selectedMessageId = 'two'; s.selectedListRowKey = rows[1].__list_key;
  assert.equal(selectedListMessage(s).__list_kind, 'message');
  s.expandedSenders.clear();
  assert.equal(selectedListMessage(s).__list_kind, 'message');
  assert.equal(selectedListMessage(s).__list_thread, 'thread');
  assert.equal(uniqueActionRows(rows, s.selectedListRowKey).filter(m=>m.id==='two').length, 1);
});
test('removal updates complete counts, keeps unseen members and supports undo after an arrival', () => {
  const s = state(); const removed = removeSenderMembers(s, new Set(['two']));
  assert.equal(removed.messages[0].sender_message_count, 1); assert.equal(removed.messages[0].sender_unread_count, 1);
  const arrived = { ...one, id: 'new', date: '2026-01-03' };
  const current = { ...s, ...removed, messages: [{ ...removed.messages[0], sender_message_count: 2, sender_unread_count: 2 }, { id: 'outside' }], threadMessages: { [key]: [arrived, one] } };
  const restored = restoreSenderMembers(current, [two]);
  assert.equal(restored.messages[0].sender_message_count, 3);
  assert.deepEqual(restored.threadMessages[key].map(m=>m.id), ['new','two','one']);
  const unseen = { ...s, messages: [{ ...head, sender_message_count: 50 }] };
  assert.equal(removeSenderMembers(unseen, new Set(['two'])).messages[0].sender_message_count, 49);
});
test('removing and undoing the last member removes and recreates its head', () => {
  const s = state(); s.messages = [{ ...head, sender_message_count: 1, sender_unread_count: 1 }]; s.threadMessages[key] = [two];
  const removed = removeSenderMembers(s, new Set(['two'])); assert.equal(removed.messages.length, 0);
  const restored = restoreSenderMembers({ ...s, ...removed }, [two]);
  assert.equal(restored.messages[0].id, `sender:${sender}`); assert.equal(restored.messages[0].sender_message_count, 1);
});
test('single-child removal reduces a conversation without deleting its surviving member', () => {
  const s = state(); s.threadMessages[key] = [{ ...two, thread_id: 'thread', message_count: 2, unread_count: 2 }]; s.threadMessages.thread = [two, one];
  const removed = removeSenderMembers(s, new Set(['two']), { ...two, __list_kind: 'message', __list_thread: 'thread' });
  assert.equal(removed.messages[0].sender_message_count, 1);
  assert.equal(removed.threadMessages[key][0].id, 'one');
});
test('read updates use deltas against server group totals rather than loaded page totals', () => {
  const s = state(); s.messages = [{ ...head, sender_message_count: 50, sender_unread_count: 40 }];
  const caches = { [key]: [{ ...two, is_read: true }, one] };
  assert.equal(reconcileSenderHeads(s, caches)[0].sender_unread_count, 39);
});

test('navigation after collapse resumes at that control while preserving the reader', () => {
  const s = state(); s.messages.unshift({ id: 'before' }); s.selectedMessageId = 'one'; s.expandedSenders.clear();
  assert.equal(neighborMessageRow(s,1).id, 'outside'); assert.equal(neighborMessageRow(s,-1).id, 'before');
  assert.equal(s.selectedMessageId, 'one');
});

test('reader arrows do not wrap at list boundaries', () => {
  const s=state();s.selectedMessageId='two'; assert.equal(neighborMessageRow(s,-1,false),null);
  s.selectedMessageId='outside';assert.equal(neighborMessageRow(s,1,false),null);
});

test('reading one representative changes only that conversation’s unread total', () => {
  const s=state();const first={...one,thread_id:'first',message_count:3,unread_count:2},second={...two,thread_id:'second',message_count:3,unread_count:2};
  s.threadMessages[key]=[first,second];
  const after=refreshSenderThreadReadState({[key]:[{...first,is_read:true},second]},'one',{is_read:true},s);
  assert.equal(after[key][0].unread_count,1);assert.equal(after[key][1].unread_count,2);
});
