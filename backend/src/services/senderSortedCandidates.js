import { query } from './db.js';
import { senderIdentitySql } from './senderIdentity.js';
import { draftMessageSql } from '../utils/mailUtils.js';

// Non-default folder orders require sorting the complete candidate set before paging.
// The optimized newest-first path remains in senderGrouping.js.
export async function senderSortedCandidates({ where, values, accounts, senders, sender,
  threaded, limit, offset, mappingsParam, order, labels = {} }) {
  const args = [...values];
  const bind = value => { args.push(value); return `$${args.length}`; };
  const groups = bind(senders), selected = bind(sender || null), accountIds = threaded ? bind(accounts) : null;
  const labelMap = bind(JSON.stringify(labels)), pageLimit = bind(limit), pageOffset = bind(offset);
  const identity = senderIdentitySql('m', mappingsParam);
  const direction = order.dir === 'asc' ? 'ASC' : 'DESC';
  const sortKey = order.sort === 'from' ? 'sort_from' : order.sort === 'subject' ? 'sort_subject' : null;
  const ordering = [order.starredFirst ? 'sort_starred DESC' : null,
    sortKey ? `${sortKey} ${direction} NULLS LAST, date DESC` : `date ${direction}`, 'id'].filter(Boolean).join(', ');
  const source = threaded ? `
    deduped AS (
      SELECT DISTINCT ON (thread_key, account_id, message_id) * FROM scoped
      ORDER BY thread_key, account_id, message_id, date ASC, id
    ), source AS (
      SELECT (array_agg(id ORDER BY date DESC, is_read ASC, id))[1] AS id, thread_key,
        MAX(date) AS date, (array_agg(sender ORDER BY date ASC, id))[1] AS sender,
        (array_agg(sort_from ORDER BY date ASC, id))[1] AS sort_from,
        (array_agg(sort_subject ORDER BY date ASC, id))[1] AS sort_subject,
        bool_or(is_starred) AS sort_starred,
        COUNT(*) FILTER (WHERE NOT is_read)::int AS unread_count
      FROM deduped GROUP BY thread_key
    ), thread_totals AS (
      SELECT m.thread_key, COUNT(DISTINCT (m.account_id, m.message_id))::int AS message_count
      FROM messages m WHERE m.account_id = ANY(${accountIds}::uuid[]) AND NOT m.is_deleted
        AND m.message_id IS NOT NULL AND NOT ${draftMessageSql('m')}
        AND m.thread_key IN (SELECT thread_key FROM source)
      GROUP BY m.thread_key
    )` : `source AS (
      SELECT id, thread_key, date, sender, sort_from, sort_subject, is_starred AS sort_starred,
        CASE WHEN is_read THEN 0 ELSE 1 END AS unread_count FROM scoped
    )`;
  const result = await query(`WITH scoped AS (
      SELECT m.id, m.thread_key, m.account_id, m.message_id, m.date, m.is_read, m.is_starred,
        ${identity} AS sender,
        nullif(lower(coalesce(nullif(m.from_name, ''), m.from_email)), '') AS sort_from,
        nullif(m.normalized_subject, '') AS sort_subject
      FROM messages m WHERE ${where}
    ), ${source}, group_counts AS (
      SELECT sender, SUM(unread_count)::int AS sender_unread_count,
        SUM(${threaded ? 'COALESCE(t.message_count, 1)' : '1'})::int AS sender_message_count,
        bool_or(sort_starred) AS group_starred
      FROM source s ${threaded ? 'LEFT JOIN thread_totals t USING (thread_key)' : ''}
      WHERE sender = ANY(${groups}::text[]) GROUP BY sender
    ), group_heads AS (
      SELECT DISTINCT ON (s.sender) s.* FROM source s
      WHERE s.sender = ANY(${groups}::text[]) ORDER BY s.sender, date DESC, id
    ), candidates AS (
      SELECT s.*, NULL::text AS sender_group, NULL::int AS sender_message_count,
        NULL::int AS sender_unread_count, NULL::boolean AS group_starred
      FROM source s WHERE (${selected}::text IS NOT NULL AND s.sender = ${selected})
        OR (${selected}::text IS NULL AND NOT COALESCE(s.sender = ANY(${groups}::text[]), false))
      UNION ALL
      SELECT h.id, h.thread_key, h.date, h.sender,
        lower(coalesce(nullif(${labelMap}::jsonb->>h.sender, ''),
          nullif(split_part(h.sender, chr(10), 2), ''), split_part(h.sender, chr(10), 1))) AS sort_from,
        h.sort_subject, c.group_starred AS sort_starred, h.unread_count,
        h.sender AS sender_group, c.sender_message_count, c.sender_unread_count, c.group_starred
      FROM group_heads h JOIN group_counts c USING (sender) WHERE ${selected}::text IS NULL
    ), page AS (SELECT * FROM candidates ORDER BY ${ordering} LIMIT ${pageLimit} OFFSET ${pageOffset})
    SELECT page.*, totals.display_total FROM (SELECT COUNT(*)::int AS display_total FROM candidates) totals
    LEFT JOIN page ON true ORDER BY ${ordering}`, args);
  return { candidates: result.rows.filter(row => row.id != null), total: result.rows[0]?.display_total ?? 0 };
}
