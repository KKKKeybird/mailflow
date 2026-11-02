import { query } from './db.js';

const junkFlags = flags => Array.isArray(flags) && flags.some(flag => ['$Junk', '\\Junk'].includes(flag));

// Shared suppression for WebSocket (toast, sound, native) and Web Push alerts.
// Keep list refresh candidates intact, including messages tagged spam but not moved.
export async function spamNotificationIds(messages, account, classifiedSpamIds = new Set()) {
  const blocked = new Set(classifiedSpamIds);
  const candidates = new Map(messages.filter(message => message.id).map(message => [message.id, message]));
  const ids = [...candidates.keys()];
  if (!ids.length) return blocked;
  for (const message of messages) if (junkFlags(message.flags)) blocked.add(message.id);
  try {
    const { rows } = await query(`
      SELECT candidate.id, m.spam_verdict, m.spam_user_override, m.is_deleted, m.flags,
        (COALESCE(m.folder, candidate.folder) = $3 OR lower(COALESCE(m.folder, candidate.folder)) IN ('spam', 'junk', '[gmail]/spam', '[google mail]/spam')
          OR EXISTS (SELECT 1 FROM folders f WHERE f.account_id = $1
            AND f.path = COALESCE(m.folder, candidate.folder) AND f.special_use = $4)) AS in_spam_folder
      FROM unnest($2::uuid[], $5::text[]) AS candidate(id, folder)
      LEFT JOIN messages m ON m.account_id = $1 AND m.id = candidate.id`,
    [account.id, ids, account.folder_mappings?.spam || null, '\\Junk', ids.map(id => candidates.get(id).folder || null)]);
    for (const row of rows) {
      if (row.is_deleted || row.in_spam_folder || row.spam_user_override === 'spam') blocked.add(row.id);
      else if (row.spam_user_override === 'ham') blocked.delete(row.id);
      else if (row.spam_verdict === 'spam' || junkFlags(row.flags)) blocked.add(row.id);
    }
  } catch (error) {
    // A failed secondary lookup must not silence ordinary mail. Known spam stays muted.
    console.warn('Spam notification lookup failed:', error.message);
  }
  return blocked;
}
