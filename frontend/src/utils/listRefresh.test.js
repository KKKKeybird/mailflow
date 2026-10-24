import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { refreshListWindow } from './listRefresh.js';

describe('refreshListWindow (#682)', () => {
  test('a list that loaded 1 message still refreshes a whole page', () => {
    // A new account: the first load caught 1 message, then 8 more arrived. Refreshing with
    // limit=1 kept the list at one row until a reload.
    assert.deepEqual(refreshListWindow({ scrollMode: 'infinite', pageSize: 50, loadedCount: 1 }), { limit: 50, offset: 0 });
  });

  test('a short folder grows when new mail arrives', () => {
    assert.deepEqual(refreshListWindow({ scrollMode: 'infinite', pageSize: 50, loadedCount: 7 }), { limit: 50, offset: 0 });
  });

  test('an empty list refreshes a page', () => {
    assert.deepEqual(refreshListWindow({ scrollMode: 'infinite', pageSize: 25, loadedCount: 0 }), { limit: 25, offset: 0 });
  });

  test('keeps everything already scrolled into view', () => {
    assert.deepEqual(refreshListWindow({ scrollMode: 'infinite', pageSize: 50, loadedCount: 150 }), { limit: 150, offset: 0 });
  });

  test('never asks for more than the backend serves', () => {
    assert.deepEqual(refreshListWindow({ scrollMode: 'infinite', pageSize: 50, loadedCount: 900 }), { limit: 500, offset: 0 });
  });

  test('paginated mode reloads the page on screen', () => {
    assert.deepEqual(refreshListWindow({ scrollMode: 'paginated', currentPage: 3, pageSize: 50, loadedCount: 2 }), { limit: 50, offset: 100 });
  });
});
