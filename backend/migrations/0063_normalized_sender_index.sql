-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_normalized_sender
  ON messages (account_id, folder, lower(btrim(from_email)), date DESC, id)
  INCLUDE (from_email, is_read, thread_key, message_id, category)
  WHERE is_deleted = false
    AND NOT (message_id IS NULL AND (subject IS NULL OR subject = '(no subject)') AND COALESCE(snippet, '') = '');
