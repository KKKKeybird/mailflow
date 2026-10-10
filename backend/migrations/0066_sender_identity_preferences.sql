-- Existing address-wide choices become separate choices for each currently known From name.
-- New names arriving later are not automatically opted into grouping.
UPDATE users u
SET preferences = jsonb_set(u.preferences, '{groupedSenders}', (
  SELECT COALESCE(jsonb_agg(identity ORDER BY identity), '[]'::jsonb)
  FROM (
    SELECT DISTINCT lower(btrim(old.sender)) || CASE
      WHEN btrim(COALESCE(names.from_name, '')) = '' THEN ''
      ELSE chr(10) || btrim(names.from_name) END AS identity
    FROM jsonb_array_elements_text(u.preferences->'groupedSenders') old(sender)
    LEFT JOIN LATERAL (
      SELECT DISTINCT m.from_name FROM messages m
      JOIN email_accounts a ON a.id = m.account_id
      WHERE a.user_id = u.id AND m.folder = 'INBOX' AND NOT m.is_deleted
        AND lower(btrim(m.from_email)) = lower(btrim(old.sender))
    ) names ON position(chr(10) IN old.sender) = 0
    WHERE position(chr(10) IN old.sender) = 0
    UNION
    SELECT old.sender FROM jsonb_array_elements_text(u.preferences->'groupedSenders') old(sender)
    WHERE position(chr(10) IN old.sender) > 0
  ) identities
))
WHERE jsonb_typeof(u.preferences->'groupedSenders') = 'array'
  AND jsonb_array_length(u.preferences->'groupedSenders') > 0;
