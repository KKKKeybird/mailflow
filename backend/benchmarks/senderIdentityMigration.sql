-- Verify conversion, owner/folder isolation and idempotence with temporary fixture tables.
BEGIN;
CREATE TEMP TABLE users(id uuid PRIMARY KEY,preferences jsonb);
CREATE TEMP TABLE email_accounts(id uuid PRIMARY KEY,user_id uuid);
CREATE TEMP TABLE messages(account_id uuid,folder text,is_deleted boolean,from_email text,from_name text);
INSERT INTO users VALUES ('11111111-1111-1111-1111-111111111111','{"theme":"dark","groupedSenders":["SHARED@example.com","absent@example.com","kept@example.com\nCarol"]}'),('22222222-2222-2222-2222-222222222222','{"groupedSenders":["shared@example.com"]}');
INSERT INTO email_accounts VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111'),('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222');
INSERT INTO messages VALUES
('33333333-3333-3333-3333-333333333333','INBOX',false,' SHARED@Example.com ',' Alice '),
('33333333-3333-3333-3333-333333333333','INBOX',false,'shared@example.com','Bob'),
('33333333-3333-3333-3333-333333333333','INBOX',false,'shared@example.com',NULL),
('33333333-3333-3333-3333-333333333333','INBOX',true,'shared@example.com','Deleted'),
('33333333-3333-3333-3333-333333333333','Archive',false,'shared@example.com','Archived'),
('44444444-4444-4444-4444-444444444444','INBOX',false,'shared@example.com','Other owner');
\ir ../migrations/0066_sender_identity_preferences.sql
DO $$ BEGIN
 IF (SELECT preferences->'groupedSenders' FROM users WHERE id='11111111-1111-1111-1111-111111111111') <> '["absent@example.com","kept@example.com\nCarol","shared@example.com","shared@example.com\nAlice","shared@example.com\nBob"]'::jsonb THEN RAISE EXCEPTION 'Identity migration incorrect'; END IF;
 IF (SELECT preferences->>'theme' FROM users WHERE id='11111111-1111-1111-1111-111111111111') <> 'dark' THEN RAISE EXCEPTION 'Unrelated preference lost'; END IF;
 IF (SELECT preferences->'groupedSenders' FROM users WHERE id='22222222-2222-2222-2222-222222222222') <> '["shared@example.com\nOther owner"]'::jsonb THEN RAISE EXCEPTION 'Cross-owner migration'; END IF;
END $$;
\ir ../migrations/0066_sender_identity_preferences.sql
DO $$ BEGIN
 IF (SELECT preferences->'groupedSenders' FROM users WHERE id='11111111-1111-1111-1111-111111111111') <> '["absent@example.com","kept@example.com\nCarol","shared@example.com","shared@example.com\nAlice","shared@example.com\nBob"]'::jsonb THEN RAISE EXCEPTION 'Identity migration incorrect'; END IF;
 IF (SELECT preferences->>'theme' FROM users WHERE id='11111111-1111-1111-1111-111111111111') <> 'dark' THEN RAISE EXCEPTION 'Unrelated preference lost'; END IF;
 IF (SELECT preferences->'groupedSenders' FROM users WHERE id='22222222-2222-2222-2222-222222222222') <> '["shared@example.com\nOther owner"]'::jsonb THEN RAISE EXCEPTION 'Cross-owner migration'; END IF;
END $$;
ROLLBACK;
