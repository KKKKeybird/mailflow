import { query } from './db.js';

export async function senderCandidates({ where, values, accounts, senders, sender, threaded, unfiltered, limit, offset }) {
  const n = values.length;
  const groupParam = `$${n + 1}::text[]`;
  const args = [...values, senders, limit + offset, limit, offset];
  const normalized = "lower(btrim(m.from_email))";
  const source = threaded ? `
    deduped AS MATERIALIZED (
      SELECT DISTINCT ON (m.account_id, m.thread_key, m.message_id)
        m.id, m.account_id, m.thread_key, m.message_id, m.from_email, m.date, m.is_read
      FROM messages m WHERE ${where}
      ORDER BY m.account_id, m.thread_key, m.message_id, m.date ASC, m.id
    ), thread_keys AS MATERIALIZED (
      SELECT thread_key,
        (array_agg(id ORDER BY date DESC, is_read ASC, id))[1] AS id,
        MAX(date) AS date,
        (array_agg(lower(btrim(from_email)) ORDER BY date ASC))[1] AS sender,
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
    const sql = `${threaded ? `WITH ${source}` : ''}
      SELECT ${id} AS id, ${date} AS date ${threaded ? ', thread_key' : ''}
      FROM ${rows} WHERE ${scope} AND ${from} = $${n + 1}
      ORDER BY ${date} DESC, ${id} LIMIT $${n + 2} OFFSET $${n + 3}`;
    const result = await query(sql, [...values, sender, limit, offset]);
    const count = await query(`${threaded ? `WITH ${source}` : ''} SELECT COUNT(*)::int AS total FROM ${rows} WHERE ${scope} AND ${from} = $${n + 1}`, [...values, sender]);
    return { candidates: result.rows, total: count.rows[0]?.total ?? 0 };
  }
  let totals = '';
  let messages = '1';
  if (threaded && !unfiltered) {
    const accountParam = `$${args.length + 1}`;
    args.push(accounts);
    totals = `, thread_totals AS (
      SELECT thread_key, COUNT(DISTINCT (account_id, message_id))::int AS message_count
      FROM messages WHERE account_id = ANY(${accountParam}) AND folder = 'INBOX'
        AND NOT is_deleted AND message_id IS NOT NULL GROUP BY thread_key
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
