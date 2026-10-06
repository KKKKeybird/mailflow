import { query } from './db.js';

export async function senderCandidates({ where, values, accounts, senders, sender, threaded, unfiltered, limit, offset }) {
  if (accounts.length === 1 && where.includes('m.account_id = ANY(')) {
    values = [...values, accounts[0]];
    where += ` AND m.account_id = $${values.length}`;
  }
  if (!threaded && !sender && senders.length <= 16) return flatCandidates({ where, values, accounts, senders, limit, offset });
  const deduplication = scope => `SELECT DISTINCT ON (m.thread_key, m.account_id, m.message_id)
    m.id, m.account_id, m.thread_key, m.message_id, m.from_email, m.date, m.is_read
    FROM messages m WHERE ${scope}
    ORDER BY m.thread_key, m.account_id, m.message_id, m.date ASC, m.id`;
  const dedupedSource = threaded && accounts.length > 1 && accounts.length <= 16
    ? accounts.map(account => {
        values = [...values, account];
        return `(${deduplication(`${where} AND m.account_id = $${values.length}`)})`;
      }).join(' UNION ALL ')
    : deduplication(where);
  const n = values.length;
  const groupParam = `$${n + 1}::text[]`;
  const args = [...values, senders, limit + offset, limit, offset];
  const normalized = "lower(btrim(m.from_email))";
  const source = threaded ? `
    deduped AS NOT MATERIALIZED (
      ${dedupedSource}
    ), thread_keys AS MATERIALIZED (
      SELECT thread_key,
        (array_agg(id ORDER BY date DESC, is_read ASC, id))[1] AS id,
        MAX(date) AS date,
        lower(btrim((array_agg(from_email ORDER BY date ASC))[1])) AS sender,
        COUNT(*) FILTER (WHERE NOT is_read)::int AS unread_count,
        COUNT(*) FILTER (WHERE message_id IS NOT NULL)::int AS message_count
      FROM deduped GROUP BY thread_key
    )` : '';
  const rows = threaded ? 'thread_keys' : 'messages m';
  const scope = threaded ? 'true' : where;
  const from = threaded ? 'sender' : normalized;
  const id = threaded ? 'id' : 'm.id';
  const date = threaded ? 'date' : 'm.date';
  const unread = threaded ? 'unread_count' : 'CASE WHEN m.is_read THEN 0 ELSE 1 END';
  if (sender) {
    const result = await query(`WITH ${source ? source + ',' : ''}
      members AS NOT MATERIALIZED (
        SELECT ${id} AS id, ${date} AS date ${threaded ? ', thread_key' : ''}
        FROM ${rows} WHERE ${scope} AND ${from} = $${n + 1}
      ), page AS (
        SELECT * FROM members ORDER BY date DESC, id LIMIT $${n + 2} OFFSET $${n + 3}
      ) SELECT page.*, totals.display_total
        FROM (SELECT COUNT(*)::int AS display_total FROM members) totals
        LEFT JOIN page ON true ORDER BY page.date DESC, page.id`, [...values, sender, limit, offset]);
    return { candidates: result.rows.filter(row => row.id != null), total: result.rows[0]?.display_total ?? 0 };
  }
  let totals = '';
  let messages = '1';
  if (threaded && !unfiltered) {
    const accountParam = `$${args.length + 1}`;
    args.push(accounts);
    totals = `, thread_totals AS (
      SELECT thread_key, COUNT(DISTINCT ${accounts.length === 1 ? 'message_id' : '(account_id, message_id)'})::int AS message_count
      FROM messages WHERE account_id = ANY(${accountParam}) AND folder = 'INBOX'
        AND NOT is_deleted AND message_id IS NOT NULL
        ${accounts.length === 1 ? `AND account_id = (${accountParam}::uuid[])[1]` : ''} GROUP BY thread_key
    )`;
    messages = 'COALESCE(tt.message_count, 1)';
  }
  if (threaded && unfiltered) messages = 'GREATEST(message_count, 1)';
  const accountsParam = `$${args.length + 1}::uuid[]`;
  if (!threaded) args.push(accounts);
  const ordinarySource = threaded ? `
      SELECT id, date, NULL::text AS sender_group, thread_key
      FROM thread_keys WHERE NOT COALESCE(sender = ANY(${groupParam}), false)
      ORDER BY date DESC, id LIMIT $${n + 2}` : `
      SELECT o.*, NULL::text AS sender_group FROM unnest(${accountsParam}) a(account_id)
      CROSS JOIN LATERAL (SELECT m.id, m.date FROM messages m
        WHERE ${where} AND m.account_id = a.account_id AND (${normalized} IS NULL OR ${normalized} <> ALL(${groupParam}))
        ORDER BY m.date DESC, m.id LIMIT $${n + 2}) o` ;
  const headSource = threaded ? `
        SELECT id, date, thread_key FROM thread_keys WHERE sender = s.sender ORDER BY date DESC, id LIMIT 1` : `
        SELECT h.* FROM unnest(${accountsParam}) a(account_id)
        CROSS JOIN LATERAL (SELECT m.id, m.date FROM messages m
          WHERE ${where} AND m.account_id = a.account_id AND ${normalized} = s.sender
          ORDER BY m.date DESC, m.id LIMIT 1) h ORDER BY h.date DESC, h.id LIMIT 1`;
  const cte = `WITH ${source ? source + ',' : ''}
    ordinary AS (${ordinarySource}), heads AS (
      SELECT h.*, s.sender AS sender_group FROM unnest(${groupParam}) s(sender)
      CROSS JOIN LATERAL (${headSource}) h
    ), page AS (
      SELECT * FROM (SELECT * FROM ordinary UNION ALL
        SELECT id, date, sender_group ${threaded ? ', thread_key' : ''} FROM heads) candidates
      ORDER BY date DESC, id LIMIT $${n + 3} OFFSET $${n + 4}
    ) ${totals}, counts AS (
      SELECT CASE WHEN ${from} = ANY(${groupParam}) THEN ${from} END AS sender_group,
        COUNT(*)::int AS list_count, SUM(${messages})::int AS sender_message_count,
        SUM(${unread})::int AS sender_unread_count
      FROM ${rows} ${threaded && !unfiltered ? 'LEFT JOIN thread_totals tt USING (thread_key)' : ''}
      WHERE ${scope} GROUP BY CASE WHEN ${from} = ANY(${groupParam}) THEN ${from} END
    )`;
  const total = '(SELECT COALESCE(SUM(CASE WHEN sender_group IS NULL THEN list_count ELSE 1 END), 0)::int FROM counts)';
  const result = await query(`${cte} SELECT page.*, counts.sender_message_count, counts.sender_unread_count, totals.display_total
    FROM (SELECT ${total} AS display_total) totals LEFT JOIN page ON true
    LEFT JOIN counts USING (sender_group) ORDER BY page.date DESC, page.id`, args);
  return { candidates: result.rows.filter(row => row.id != null), total: result.rows[0]?.display_total ?? 0 };
}

async function flatCandidates({ where, values, accounts, senders, limit, offset }) {
  const n = values.length;
  const grouped = `$${n + 1}::text[]`;
  const account = `$${n + 2}::uuid[]`;
  const normalized = 'lower(btrim(m.from_email))';
  const args = [...values, senders, accounts, limit + offset, limit, offset];
  // Complement ranges avoid walking grouped mail to find rare ordinary rows.
  // Sort the boundaries in PostgreSQL so they use the index's collation.
  const ranges = Array.from({ length: senders.length + 1 }, (_, i) => {
    const tests = [];
    if (i) tests.push(`${normalized} > (SELECT ordered[${i}] FROM boundaries)`);
    if (i < senders.length) tests.push(`${normalized} < (SELECT ordered[${i + 1}] FROM boundaries)`);
    return `SELECT m.id, m.date, NULL::text AS sender_group FROM messages m
      WHERE ${where} AND (SELECT dense FROM stats) AND ${tests.join(' AND ')}`;
  });
  ranges.push(`SELECT m.id, m.date, NULL::text AS sender_group FROM messages m
    WHERE ${where} AND (SELECT dense FROM stats) AND ${normalized} IS NULL`);
  const sql = `WITH selected AS (SELECT sender FROM unnest(${grouped}) s(sender)),
    counts AS MATERIALIZED (
      SELECT s.sender AS sender_group, c.list_count,
        c.list_count AS sender_message_count, c.sender_unread_count
      FROM selected s CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS list_count,
          COUNT(*) FILTER(WHERE NOT m.is_read)::int AS sender_unread_count
        FROM messages m WHERE ${where} AND ${normalized} = s.sender
      ) c
    ), stats AS MATERIALIZED (
      SELECT raw_total - grouped_total + nonempty_groups AS display_total,
        grouped_total > raw_total / 2 AS dense
      FROM (SELECT (SELECT COUNT(*)::int FROM messages m WHERE ${where}) AS raw_total,
        COALESCE(SUM(list_count), 0)::int AS grouped_total,
        COUNT(*) FILTER(WHERE list_count > 0)::int AS nonempty_groups FROM counts) totals
    ), boundaries AS (SELECT array_agg(sender ORDER BY sender) AS ordered FROM selected),
    ordinary AS MATERIALIZED (
      ${ranges.join(' UNION ALL ')}
      UNION ALL
      SELECT o.*, NULL::text AS sender_group FROM unnest(${account}) a(account_id)
      CROSS JOIN LATERAL (
        SELECT m.id, m.date FROM messages m WHERE ${where} AND m.account_id = a.account_id
          AND NOT (SELECT dense FROM stats)
          AND (${normalized} IS NULL OR ${normalized} <> ALL(${grouped}))
        ORDER BY m.date DESC, m.id LIMIT $${n + 3}
      ) o
    ), heads AS (
      SELECT h.*, s.sender AS sender_group FROM selected s CROSS JOIN LATERAL (
        SELECT h.* FROM unnest(${account}) a(account_id) CROSS JOIN LATERAL (
          SELECT m.id, m.date FROM messages m WHERE ${where} AND m.account_id = a.account_id
            AND ${normalized} = s.sender ORDER BY m.date DESC, m.id LIMIT 1
        ) h ORDER BY h.date DESC, h.id LIMIT 1
      ) h
    ), page AS (
      SELECT * FROM (SELECT * FROM ordinary UNION ALL SELECT * FROM heads) candidates
      ORDER BY date DESC, id LIMIT $${n + 4} OFFSET $${n + 5}
    ) SELECT page.*, counts.sender_message_count, counts.sender_unread_count, stats.display_total
      FROM stats LEFT JOIN page ON true LEFT JOIN counts USING(sender_group)
      ORDER BY page.date DESC, page.id`;
  const result = await query(sql, args);
  return { candidates: result.rows.filter(row => row.id != null), total: result.rows[0]?.display_total ?? 0 };
}
