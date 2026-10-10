import { createUndoableCommit, UNDO_COMMIT_DELAY_MS, UNDO_WINDOW_MS } from './undoableAction.js';

export async function scheduleSenderGroupAction({ api, getState, sender, params, action, t, schedule, cancel, finish }) {
  if (!['read', 'archive'].includes(action)) throw new Error('Invalid group action');
  const userId = getState().user?.id;
  const scope = { ...params }; delete scope.unreadOnly;
  const { targets } = await api.getSenderGroupTargets({ ...scope, sender });
  if (getState().user?.id !== userId) { finish(); return; }
  const selected = action === 'read' ? targets.filter(row => !row.is_read) : targets;
  if (!selected.length) { finish(); return; }
  const pending = createUndoableCommit({
    delayMs: UNDO_COMMIT_DELAY_MS, schedule, cancel,
    undo: finish,
    commit: async () => {
      let completed = 0, partial = false;
      try {
        for (let offset = 0; offset < selected.length; offset += 500) {
          if (getState().user?.id !== userId) return;
          const batch = selected.slice(offset, offset + 500);
          const result = action === 'read' ? await api.bulkRead(batch.map(row => row.id), true) : await api.bulkArchive(batch.map(row => row.id));
          const done = new Set(action === 'read' ? result.updated || [] : result.archived || []);
          completed += done.size;
          if (getState().user?.id !== userId) return;
          if (action === 'archive') getState().removeMessages([...done]);
          for (const row of batch) if (done.has(row.id)) {
            if (action === 'read') getState().updateMessage(row.id, { is_read: true });
            if (!row.is_read) getState().decrementUnread(row.account_id, 1);
          }
          if (action === 'archive' && (result.noArchiveFolder?.length || done.size < batch.length)) partial = true;
        }
        if (partial) throw new Error(t('senderGrouping.partial', { count: completed }));
      } catch (error) {
        if (getState().user?.id === userId) getState().addNotification({ type: 'error', title: t('common.error'), body: t('senderGrouping.failed', { count: completed, error: error.message }) });
      } finally {
        if (getState().user?.id === userId) { getState().refreshSenderMembers(); finish(); }
      }
    },
  });
  getState().addNotification({ type: 'info', title: t(action === 'read' ? 'senderGrouping.readScheduled' : 'senderGrouping.archiveScheduled', { count: selected.length }), onUndo: pending.undo, undoMs: UNDO_WINDOW_MS });
  return pending;
}
