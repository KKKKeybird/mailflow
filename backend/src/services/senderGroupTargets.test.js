import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./db.js', () => ({ query: vi.fn() }));
import { query } from './db.js';
import { senderGroupTargets } from './senderGroupTargets.js';
import { validSenderGroupMap } from './senderIdentity.js';
beforeEach(() => query.mockReset());
it('refuses an unowned account instead of using unified inbox', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 'mine' }] });
  expect(await senderGroupTargets({ userId: 'u', accountId: 'foreign', sender: 'a@example.com' })).toEqual([]); expect(query).toHaveBeenCalledTimes(1);
});
it('captures all members in owned unified accounts with canonical aliases', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'excluded', include_in_unified_inbox: false }] }).mockResolvedValueOnce({ rows: [{ preferences: { senderGroupMappings: { 'b@example.com': 'a@example.com' } } }] }).mockResolvedValueOnce({ rows: Array.from({ length: 700 }, (_, id) => ({ id })) });
  expect(await senderGroupTargets({ userId: 'u', sender: 'a@example.com', category: 'primary' })).toHaveLength(700);
  const [sql, params] = query.mock.calls[2]; expect(params).toEqual([['a'], '{"b@example.com":"a@example.com"}', 'a@example.com']); expect(sql).toContain("m.folder = 'INBOX'"); expect(sql).toContain('NOT m.is_deleted'); expect(sql).not.toContain('LIMIT'); expect(sql).toContain('COALESCE($2::jsonb');
});
it('threaded targets use the original sender and include matching conversations', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 'a' }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  await senderGroupTargets({ userId: 'u', sender: 'a@example.com', threaded: true, category: 'automated' });
  const [sql, params] = query.mock.calls[2]; expect(params).toEqual([['a'], 'automated', 'a@example.com']); expect(sql).toContain('array_agg(identity ORDER BY date ASC, id)'); expect(sql).toContain('thread_key IN (SELECT thread_key FROM origins');
});
it('rejects mapping cycles, chains, noncanonical identities and invalid labels', () => {
  expect(validSenderGroupMap({ 'a@example.com': 'b@example.com' })).toBe(true);
  expect(validSenderGroupMap({ 'a@example.com': 'b@example.com', 'b@example.com': 'a@example.com' })).toBe(false);
  expect(validSenderGroupMap({ 'a@example.com': 'b@example.com', 'b@example.com': 'c@example.com' })).toBe(false);
  expect(validSenderGroupMap({ 'A@example.com': 'b@example.com' })).toBe(false);
  expect(validSenderGroupMap({ 'a@example.com': 'x\ny' }, true)).toBe(false);
});
