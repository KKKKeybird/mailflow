import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));

const { query } = await import('./db.js');
import { listMessages, normalizeGroupedSenders } from './messageService.js';

beforeEach(() => {
  query.mockClear();
});

describe('listMessages — account scope', () => {
  it('returns empty result immediately when user has no enabled accounts', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await listMessages({ userId: 'user-1' });

    expect(result).toEqual({ messages: [], total: 0 });
    expect(query).toHaveBeenCalledOnce();
  });

  it('falls back to unified inbox when accountId is not owned by the user', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })           // accounts
      .mockResolvedValueOnce({ rows: [{ n: 5 }] })                  // folder count
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1', folder: 'INBOX' }] }); // messages

    const result = await listMessages({ userId: 'user-1', accountId: 'acc-other' });

    // Unified inbox returns the cached total from the folder sum query
    expect(result.total).toBe(5);
    expect(result.resolvedAccountId).toBeNull();

    // The folder count query should have used total_count (not unread_count)
    const countSql = query.mock.calls[1][0];
    expect(countSql).toContain('total_count');
    expect(countSql).not.toContain('unread_count');
  });

  it('uses only opted-in accounts for the unified inbox', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          { id: 'acc-included', include_in_unified_inbox: true },
          { id: 'acc-excluded', include_in_unified_inbox: false },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listMessages({ userId: 'user-1' });

    expect(query.mock.calls[1][1]).toEqual([['acc-included']]);
    expect(query.mock.calls[2][1][0]).toEqual(['acc-included']);
  });

  it('keeps an opted-out account available in its direct account view', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'acc-excluded', include_in_unified_inbox: false }],
      })
      .mockResolvedValueOnce({ rows: [{ total_count: 2, unread_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] });

    const result = await listMessages({
      userId: 'user-1',
      accountId: 'acc-excluded',
    });

    expect(result.resolvedAccountId).toBe('acc-excluded');
    expect(query.mock.calls[1][1]).toEqual(['acc-excluded', 'INBOX']);
  });
});

describe('listMessages — total count selection', () => {
  it('sums unread_count across accounts for unified inbox when unreadOnly=true', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }, { id: 'acc-2' }] }) // accounts
      .mockResolvedValueOnce({ rows: [{ n: 7 }] })                          // folder count
      .mockResolvedValueOnce({ rows: [] });                                  // messages

    const result = await listMessages({ userId: 'user-1', unreadOnly: 'true' });

    expect(result.total).toBe(7);

    const countSql = query.mock.calls[1][0];
    expect(countSql).toContain('unread_count');
    expect(countSql).not.toContain('total_count');
  });

  it('sums total_count across accounts for unified inbox when unreadOnly is not set', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }, { id: 'acc-2' }] }) // accounts
      .mockResolvedValueOnce({ rows: [{ n: 42 }] })                         // folder count
      .mockResolvedValueOnce({ rows: [] });                                  // messages

    const result = await listMessages({ userId: 'user-1' });

    expect(result.total).toBe(42);

    const countSql = query.mock.calls[1][0];
    expect(countSql).toContain('total_count');
    expect(countSql).not.toContain('unread_count');
  });

  it('reads unread_count from folder row for specific account when unreadOnly=true', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })                       // accounts
      .mockResolvedValueOnce({ rows: [{ total_count: 100, unread_count: 3 }] })  // folder row
      .mockResolvedValueOnce({ rows: [] });                                        // messages

    const result = await listMessages({ userId: 'user-1', accountId: 'acc-1', unreadOnly: 'true' });

    expect(result.total).toBe(3);
    expect(result.resolvedAccountId).toBe('acc-1');
  });

  it('reads total_count from folder row for specific account when unreadOnly is not set', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })                       // accounts
      .mockResolvedValueOnce({ rows: [{ total_count: 100, unread_count: 3 }] })  // folder row
      .mockResolvedValueOnce({ rows: [] });                                        // messages

    const result = await listMessages({ userId: 'user-1', accountId: 'acc-1' });

    expect(result.total).toBe(100);
  });
});

// Threaded mode: 4 query calls — accounts, folder cache, thread CTE, thread count
describe('listMessages — threaded mode', () => {
  it('returns thread count as total, ignoring the cached folder count', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })                       // accounts
      .mockResolvedValueOnce({ rows: [{ total_count: 99, unread_count: 2 }] })  // folder cache (not used)
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] })                       // thread CTE
      .mockResolvedValueOnce({ rows: [{ total: 5 }] });                          // thread count

    const result = await listMessages({ userId: 'user-1', accountId: 'acc-1', threaded: 'true' });

    expect(result.total).toBe(5);
    expect(result.threaded).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  it('counts a thread message per account, not per Message-ID (#476)', async () => {
    // One email delivered to two connected accounts is two messages in the conversation, so
    // the thread badge must count both. Counting DISTINCT message_id alone reported 1 beside
    // a conversation holding 2. Verified against a live database: the same thread goes from
    // message_count 1 to 2 while the same-account Sent twin still collapses.
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: 10, unread_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listMessages({ userId: 'user-1', accountId: 'acc-1', folder: 'INBOX', threaded: 'true' });

    const cteSql = query.mock.calls[2][0];
    expect(cteSql).toContain('COUNT(DISTINCT (m.account_id, m.message_id))');
    expect(cteSql).not.toContain('COUNT(DISTINCT m.message_id)');
  });

  it('keeps the per-thread message rows scoped per account so both copies survive (#476)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: 10, unread_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listMessages({ userId: 'user-1', accountId: 'acc-1', folder: 'INBOX', threaded: 'true' });

    expect(query.mock.calls[2][0]).toContain('DISTINCT ON (m.account_id, m.thread_key, m.message_id)');
  });

  it('scopes thread_totals to INBOX when viewing a specific account INBOX', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: 10, unread_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listMessages({ userId: 'user-1', accountId: 'acc-1', folder: 'INBOX', threaded: 'true' });

    const cteSql = query.mock.calls[2][0];
    expect(cteSql).toContain('AND folder = $2');
  });

  it('counts thread messages across all folders when viewing a non-INBOX folder', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: 10, unread_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listMessages({ userId: 'user-1', accountId: 'acc-1', folder: 'Sent', threaded: 'true' });

    // thread_totals must not be scoped to a specific folder so the badge reflects true thread size
    const cteSql = query.mock.calls[2][0];
    expect(cteSql).not.toContain('AND folder = $2');
    expect(cteSql).not.toContain("AND folder = 'INBOX'");
  });

  it('scopes thread_totals to INBOX for unified inbox threaded view', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }, { id: 'acc-2' }] })
      .mockResolvedValueOnce({ rows: [{ n: 20 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listMessages({ userId: 'user-1', threaded: 'true' });

    const cteSql = query.mock.calls[2][0];
    expect(cteSql).toContain("AND folder = 'INBOX'");
  });
});

describe('listMessages — message shape', () => {
  it('selects delivery_addresses in the flat query', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: 1, unread_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listMessages({ userId: 'user-1', accountId: 'acc-1' });

    expect(query.mock.calls[2][0]).toContain('delivery_addresses');
  });

  it('selects delivery_addresses in the threaded query', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: 1, unread_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listMessages({ userId: 'user-1', accountId: 'acc-1', threaded: 'true' });

    expect(query.mock.calls[2][0]).toContain('delivery_addresses');
  });
});

describe('listMessages — ghost row suppression (#407)', () => {
  it('excludes hollow UID-only placeholder rows in the flat query', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: 1, unread_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listMessages({ userId: 'user-1', accountId: 'acc-1' });

    const sql = query.mock.calls[2][0];
    expect(sql).toContain('NOT (m.message_id IS NULL');
    expect(sql).toContain("m.subject = '(no subject)'");
  });

  it('excludes hollow placeholder rows in the threaded query too (consistent pagination)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'acc-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: 1, unread_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listMessages({ userId: 'user-1', accountId: 'acc-1', threaded: 'true' });

    // CTE (call 2) and thread-count (call 3) both share `where`, so both exclude ghosts.
    expect(query.mock.calls[2][0]).toContain('NOT (m.message_id IS NULL');
    expect(query.mock.calls[3][0]).toContain('NOT (m.message_id IS NULL');
  });
});

describe('listMessages — sender grouping', () => {
  it('pages compact candidates and hydrates only the selected page', async () => {
    query.mockImplementation(async sql => {
      if (sql.startsWith('SELECT id, include')) return { rows: [{ id: 'acc-1' }] };
      if (sql.startsWith('SELECT preferences')) return { rows: [{ preferences: { groupedSenders: [' Alerts@Example.com '] } }] };
      if (sql.includes('SELECT page.*')) return { rows: [{ id: 'latest', sender_group: 'alerts@example.com', sender_message_count: 75, sender_unread_count: 3, display_total: 16 }] };
      if (sql.includes('FROM folders')) return { rows: [{ n: 90 }] };
      return { rows: [{ id: 'latest', from_email: 'alerts@example.com', subject: 'Latest' }] };
    });
    const result = await listMessages({ userId: 'user-1', groupSenders: true, limit: 10, offset: 10 });
    expect(result.total).toBe(16);
    expect(result.messages[0]).toMatchObject({ id: 'sender:alerts@example.com', preview_message_id: 'latest', sender_message_count: 75 });
    const [candidateSql, candidateValues] = query.mock.calls.find(([sql]) => sql.includes('SELECT page.*'));
    expect(candidateSql).not.toContain('m.to_addresses');
    expect(candidateSql).toContain('CROSS JOIN LATERAL');
    expect(candidateValues).toEqual([['acc-1'], ['alerts@example.com'], 20, 10, 10, ['acc-1']]);
    const [hydrateSql, hydrateValues] = query.mock.calls.find(([sql]) => sql.includes('m.to_addresses'));
    expect(hydrateSql).toContain('m.id = ANY');
    expect(hydrateValues).toEqual([['acc-1'], ['latest'], 1, 0]);
  });
  it('expands a sender under the same unread and category scope', async () => {
    query.mockImplementation(async sql => {
      if (sql.startsWith('SELECT id, include')) return { rows: [{ id: 'acc-1' }] };
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 2 }] };
      if (sql.includes('FROM folders')) return { rows: [{ total_count: 2 }] };
      return { rows: [{ id: 'member' }] };
    });
    const result = await listMessages({ userId: 'user-1', accountId: 'acc-1', sender: ' Alerts@Example.com ', unreadOnly: true, category: 'automated' });
    expect(result.total).toBe(2);
    const [sql, values] = query.mock.calls[1];
    expect(sql).toContain('m.is_read = false');
    expect(sql).toContain('lower(btrim(m.from_email)) = $4');
    expect(values).toEqual(['acc-1', 'INBOX', 'automated', 'alerts@example.com', 50, 0]);
  });
});

describe('normalizeGroupedSenders', () => {
  it('canonicalizes case, strips whitespace and rejects malformed entries', () => {
    expect(normalizeGroupedSenders(['Alerts@Example.com', ' alerts@example.com ', null, 'not-an-email', 'a b@example.com'])).toEqual(['alerts@example.com']);
    expect(normalizeGroupedSenders(null)).toEqual([]);
  });
});

describe('listMessages — sender conversation expansion', () => {
  it('pages conversation keys before hydrating full conversation metadata', async () => {
    query.mockImplementation(async sql => {
      if (sql.startsWith('SELECT id, include')) return { rows: [{ id: 'acc-1' }] };
      if (sql.includes('COUNT(*)') && !sql.includes('deduped AS')) return { rows: [{ total: 1 }] };
      if (sql.includes('AS total')) return { rows: [{ total: 1 }] };
      if (sql.includes('FROM folders')) return { rows: [{ n: 10 }] };
      return { rows: [{ id: 'thread-rep', thread_key: 'thread', thread_id: 'thread' }] };
    });
    const result = await listMessages({ userId: 'user-1', sender: 'alerts@example.com', threaded: true });
    expect(result.total).toBe(1);
    expect(query.mock.calls[1][0]).toContain('array_agg(lower(btrim(from_email)) ORDER BY date ASC)');
    const hydration = query.mock.calls.find(([sql]) => sql.includes('m.to_addresses'));
    expect(hydration[0]).toContain('m.thread_key = ANY');
    expect(hydration[0]).toContain('LIMIT $');
  });
});
