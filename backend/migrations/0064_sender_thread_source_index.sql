-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender_thread_source
  ON messages (account_id, folder, thread_key, message_id, date, id)
  INCLUDE (from_email, is_read, category)
  WHERE is_deleted = false
    AND NOT (message_id IS NULL AND (subject IS NULL OR subject = '(no subject)') AND COALESCE(snippet, '') = '');
