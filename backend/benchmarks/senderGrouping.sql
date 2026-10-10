CREATE TABLE users(id uuid PRIMARY KEY, username text, preferences jsonb, is_admin boolean DEFAULT false,last_seen_at timestamptz);
CREATE TABLE email_accounts(id uuid PRIMARY KEY,user_id uuid,enabled boolean DEFAULT true,include_in_unified_inbox boolean DEFAULT true,name text,email_address text,color text);
CREATE TABLE contacts(id uuid, user_id uuid,primary_email text,photo_data text);
CREATE TABLE folders(account_id uuid,path text,total_count int,unread_count int);
CREATE TABLE messages(id uuid PRIMARY KEY,account_id uuid,uid bigint,folder text,message_id text,thread_id text,thread_key text,subject text,from_name text,from_email text,to_addresses jsonb,cc_addresses jsonb,reply_to jsonb,in_reply_to text,thread_references text[],date timestamptz,snippet text,is_read boolean,is_starred boolean DEFAULT false,is_deleted boolean DEFAULT false,has_attachments boolean DEFAULT false,category text,list_unsubscribe text,list_unsubscribe_post text,delivery_addresses jsonb,spam_verdict text,spam_user_override text,spam_score_ml float,body_text text,body_html text);
INSERT INTO users(id,username,preferences,is_admin) VALUES('11111111-1111-1111-1111-111111111111','fixture','{"groupedSenders":["sender0@example.com","sender1@example.com","sender2@example.com","sender3@example.com","sender4@example.com","sender5@example.com"]}',false);
INSERT INTO email_accounts VALUES('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',true,true,'Fixture','fixture@example.com','#111111');
INSERT INTO messages(id,account_id,uid,folder,message_id,thread_id,thread_key,subject,from_name,from_email,date,snippet,is_read,category)
SELECT md5('fixture:'||i)::uuid,'22222222-2222-2222-2222-222222222222',i,'INBOX','<fixture-'||i||'>','thread-'||((i-1)/3),'thread-'||((i-1)/3),'Fixture subject '||i,'Sender',CASE WHEN ((i-1)/3)%10=0 THEN 'person'||((i-1)/3)||'@example.com' ELSE 'sender'||((i-1)/3)%6||'@example.com' END,'2026-10-01'::timestamptz+(i/3)*interval '1 second','Fixture snippet',i%4<>0,CASE WHEN i%3=0 THEN 'automated' ELSE 'primary' END FROM generate_series(1,84000)i;
INSERT INTO folders SELECT account_id,'INBOX',count(*)::int,count(*) FILTER(WHERE NOT is_read)::int FROM messages GROUP BY account_id;
CREATE INDEX idx_messages_date ON messages(date DESC);
CREATE INDEX idx_messages_list ON messages(account_id,folder,date DESC) WHERE NOT is_deleted;
CREATE INDEX idx_messages_thread_key ON messages(account_id,folder,thread_key,date DESC) WHERE NOT is_deleted;
CREATE INDEX idx_messages_thread_key_dedup ON messages(account_id,folder,thread_key,message_id,date) WHERE NOT is_deleted;
CREATE INDEX idx_messages_thread_key_lookup ON messages(account_id,thread_key);
ANALYZE;
