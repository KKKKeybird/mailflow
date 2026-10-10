import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatMailTime, formatMessageDate } from './formatDate.js';

test('mail timestamps use zero for midnight and preserve noon and AM/PM', () => {
  for (const [hour, expected] of [[0, '0:03 AM'], [1, '1:03 AM'], [12, '12:03 PM'], [13, '1:03 PM'], [23, '11:03 PM']]) {
    const date = new Date();
    date.setHours(hour, 3, 0, 0);
    assert.equal(formatMailTime(date), expected);
    assert.equal(formatDate(date.toISOString()), expected);
    assert.ok(formatMessageDate(date.toISOString(), true).endsWith(', ' + expected));
    assert.ok(formatMessageDate(date.toISOString(), false).endsWith(', ' + expected));
  }
});

test('malformed and missing mail dates remain safe', () => {
  assert.equal(formatDate(null), '');
  assert.equal(formatDate('invalid'), '');
  assert.equal(formatMessageDate(null), '');
  assert.equal(formatMessageDate('invalid'), '');
  assert.equal(formatMailTime('invalid'), '');
});
