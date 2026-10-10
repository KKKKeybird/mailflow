import { query } from './db.js';
import { resolveAccountScope } from './unifiedInbox.js';
import { normalizeSenderIdentity, senderIdentitySql, validSenderGroupMap } from './senderIdentity.js';

// Capture exact inbox membership before an undoable group action is scheduled.
export async function senderGroupTargets({ userId, accountId, sender, category, threaded }) {
  const identity = normalizeSenderIdentity(sender);
  if (!identity) return [];
  const accounts = await query('SELECT id, include_in_unified_inbox FROM email_accounts WHERE user_id = $1 AND enabled = true', [userId]);
  const scope = resolveAccountScope(accounts.rows, accountId);
  if (!scope.accountIds.length || (accountId && !scope.resolvedAccountId)) return [];
  const values = [scope.accountIds];
  const base = "m.account_id = ANY($1::uuid[]) AND m.folder = 'INBOX' AND NOT m.is_deleted";
  let filtered = base + " AND NOT (m.message_id IS NULL AND (m.subject IS NULL OR m.subject = '(no subject)') AND COALESCE(m.snippet, '') = '')";
  if (category) {
    if (category !== 'primary') values.push(category);
    filtered += category === 'primary' ? " AND (m.category IS NULL OR m.category = 'primary')" : ` AND m.category = $${values.length}`;
  }
  const prefs = await query('SELECT preferences FROM users WHERE id=$1', [userId]);
  const mappings = prefs.rows[0]?.preferences?.senderGroupMappings;
  let mappingsParam;
  if (validSenderGroupMap(mappings) && Object.keys(mappings).length) {
    values.push(JSON.stringify(mappings));
    mappingsParam = `$${values.length}`;
  }
  const from = senderIdentitySql('m', mappingsParam);
  values.push(identity);
  const senderParam = `$${values.length}`;
  const threadedView = threaded === true || threaded === 'true';
  const sql = threadedView ? `WITH deduped AS (
      SELECT DISTINCT ON (m.thread_key, m.account_id, m.message_id)
        m.thread_key, m.date, m.id, ${from} AS identity
      FROM messages m WHERE ${filtered}
      ORDER BY m.thread_key, m.account_id, m.message_id, m.date ASC, m.id
    ), origins AS (
      SELECT thread_key, (array_agg(identity ORDER BY date ASC, id))[1] AS identity
      FROM deduped GROUP BY thread_key
    ) SELECT m.id, m.is_read, m.account_id FROM messages m
      WHERE ${base} AND m.thread_key IN (SELECT thread_key FROM origins WHERE identity = ${senderParam})
      ORDER BY m.id` : `SELECT m.id, m.is_read, m.account_id FROM messages m WHERE ${filtered} AND ${from} = ${senderParam} ORDER BY m.id`;
  return (await query(sql, values)).rows;
}
