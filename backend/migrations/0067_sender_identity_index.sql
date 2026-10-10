-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender_identity
  ON messages (account_id, folder,
    (lower(btrim(from_email)) || CASE WHEN btrim(COALESCE(from_name, '')) = '' THEN '' ELSE chr(10) || btrim(from_name) END),
    date DESC, id)
  INCLUDE (from_email, from_name, is_read, thread_key, message_id, category)
  WHERE is_deleted = false
    AND NOT (message_id IS NULL AND (subject IS NULL OR subject = '(no subject)') AND COALESCE(snippet, '') = '');
