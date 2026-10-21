import { isAccountInUnifiedInbox } from './unifiedInbox.js';

// Use the server's folder-wide operation: loaded rows, categories and grouping
// must not limit which unread messages are marked. Never include hidden accounts.
export async function markFolderScopeRead({ api, getState, accountId, folder }) {
  const state = getState();
  const userId = state.user?.id;
  const accounts = accountId ? state.accounts.filter(account => account.id === accountId)
    : state.accounts.filter(isAccountInUnifiedInbox);
  const targetFolder = accountId ? folder : 'INBOX';
  const results = await Promise.allSettled(accounts.map(account => api.markAllRead(account.id, targetFolder)));
  if (getState().user?.id !== userId) return { failed: 0, errors: [] };
  // A partial failure still refreshes the successful accounts. Refresh from the
  // server instead of zeroing counters that may include another folder or new mail.
  getState().refreshSenderMembers();
  window.dispatchEvent(new CustomEvent('mailflow:refresh'));
  await Promise.allSettled([
    api.getUnreadCounts().then(counts => { if (getState().user?.id === userId) getState().setUnreadCounts(counts); }),
    ...accounts.map(account => api.getFolders(account.id).then(folders => {
      if (getState().user?.id === userId) getState().setFolders(account.id, folders);
    })),
  ]);
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
  return { failed: errors.length, errors };
}
