import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
const database = vi.hoisted(() => ({ client: null }));
vi.mock('./db.js', () => ({ query: (sql, params) => database.client.query(sql, params) }));
import { spamNotificationIds } from './spamNotificationPolicy.js';

const account = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
describe.skipIf(!process.env.MAILFLOW_TEST_DATABASE_URL)('spam notification policy PostgreSQL', () => {
  beforeAll(async () => {
    database.client = new pg.Client({ connectionString: process.env.MAILFLOW_TEST_DATABASE_URL });
    await database.client.connect();
    await database.client.query(`
      CREATE TEMP TABLE messages (id uuid, account_id uuid, folder text, spam_verdict text,
        spam_user_override text, is_deleted boolean DEFAULT false, flags jsonb DEFAULT '[]');
      CREATE TEMP TABLE folders (account_id uuid, path text, special_use text);
      INSERT INTO folders VALUES ('${account}', 'Localized Spam', '\\Junk'), ('${other}', 'Foreign Only', '\\Junk');
      INSERT INTO messages (id, account_id, folder, spam_verdict, spam_user_override) VALUES
        ('${id(1)}', '${account}', 'INBOX', 'spam', NULL),
        ('${id(2)}', '${account}', 'INBOX', 'spam', 'ham'),
        ('${id(3)}', '${account}', 'INBOX', 'ham', 'spam'),
        ('${id(4)}', '${account}', 'Mapped Junk', 'ham', NULL),
        ('${id(5)}', '${account}', 'Localized Spam', 'ham', NULL),
        ('${id(6)}', '${account}', '[Gmail]/Spam', 'ham', NULL),
        ('${id(7)}', '${other}', 'INBOX', 'spam', NULL),
        ('${id(8)}', '${account}', 'Foreign Only', 'ham', NULL),
        ('${id(9)}', '${account}', 'INBOX', 'unsure', NULL)`);
  });
  afterAll(async () => { await database.client?.end(); });
  it('uses persisted intent and mapped/special-use folders under the same account only', async () => {
    const blocked = await spamNotificationIds(Array.from({ length: 9 }, (_, n) => ({ id: id(n + 1) })),
      { id: account, folder_mappings: { spam: 'Mapped Junk' } }, new Set([id(2)]));
    expect([...blocked].sort()).toEqual([1, 3, 4, 5, 6].map(id).sort());
    // A rule moved the message to a localized spam folder without a new UID: the old row is gone.
    expect([...await spamNotificationIds([{ id: id(10), folder: 'Localized Spam' }], { id: account })]).toEqual([id(10)]);
  });
});
