import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPendingSpamMove, completeSpamMove, clearSpamMove, applySpamMoveGuard } from './pendingSpamMoves.js';
const message = { id: 'mail', account_id: 'gmail', folder: 'INBOX' };

test('refresh cannot resurrect mail during Undo or a slow proxy move; destination remains visible', () => {
  setPendingSpamMove(message);
  const spam = { ...message, folder: '[Gmail]/Spam' };
  const otherAccount = { ...message, account_id: 'other' };
  assert.deepEqual(applySpamMoveGuard([message, spam, otherAccount]), [spam, otherAccount]);
  completeSpamMove(message);
  assert.deepEqual(applySpamMoveGuard([message, spam]), [spam]);
  clearSpamMove(message);
});
test('undo or a failed move makes the source visible again', () => {
  setPendingSpamMove(message);
  clearSpamMove(message);
  assert.deepEqual(applySpamMoveGuard([message]), [message]);
});
test('a completed move guard expires instead of hiding mail moved back later', () => {
  completeSpamMove(message);
  const original = Date.now;
  try {
    Date.now = () => original() + 10001;
    assert.deepEqual(applySpamMoveGuard([message]), [message]);
  } finally { Date.now = original; clearSpamMove(message); }
});
