import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./db.js', () => ({ query: vi.fn() }));
import { query } from './db.js';
import { spamNotificationIds } from './spamNotificationPolicy.js';
import { newMailAlerts } from './inboxRules.js';

const account = { id: 'a', folder_mappings: { spam: 'Custom Junk' } };
beforeEach(() => { query.mockReset().mockResolvedValue({ rows: [] }); });
describe('spam notification suppression', () => {
  it('silences classified, persisted, manually marked and server-filed spam, retaining ham', async () => {
    const messages = ['classified', 'tagged', 'manual', 'folder', 'flag', 'ham', 'unsure', 'override', 'deleted'].map(id => ({ id }));
    query.mockResolvedValue({ rows: [
      { id: 'tagged', spam_verdict: 'spam' }, { id: 'manual', spam_user_override: 'spam' },
      { id: 'folder', in_spam_folder: true }, { id: 'flag', flags: ['$Junk'] },
      { id: 'ham', spam_verdict: 'ham' }, { id: 'unsure', spam_verdict: 'unsure' },
      { id: 'override', spam_verdict: 'spam', spam_user_override: 'ham' }, { id: 'deleted', is_deleted: true },
    ] });
    const blocked = await spamNotificationIds(messages, account, new Set(['classified', 'override']));
    expect([...blocked].sort()).toEqual(['classified', 'tagged', 'manual', 'folder', 'flag', 'deleted'].sort());
    const alerts = newMailAlerts({ remaining: messages, mutedIds: blocked,
      notifyMessages: [messages[0]].filter(m => !blocked.has(m.id)) });
    expect(alerts.alertMessages.map(m => m.id)).toEqual(['ham', 'unsure', 'override']);
    expect(alerts.alertCount).toBe(3);
    expect(alerts.send).toBe(true);
    expect(query.mock.calls[0][1]).toEqual(['a', messages.map(m => m.id), 'Custom Junk', '\\Junk', messages.map(() => null)]);
    expect(query.mock.calls[0][0]).toContain('m.account_id = $1');
  });
  it('still emits a list refresh when every new message is spam', async () => {
    const messages = [{ id: 'spam' }];
    const mutedIds = await spamNotificationIds(messages, account, new Set(['spam']));
    expect(newMailAlerts({ remaining: messages, mutedIds })).toMatchObject({ send: true, alertCount: 0, alertMessages: [] });
  });
  it('a database failure preserves known spam suppression without dropping ordinary mail', async () => {
    query.mockRejectedValue(new Error('offline'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect([...await spamNotificationIds([{ id: 'normal' }, { id: 'flagged', flags: ['\\Junk'] }], account, new Set(['spam']))].sort())
        .toEqual(['flagged', 'spam']);
    } finally { warning.mockRestore(); }
  });
});
