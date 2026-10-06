import { actionableMessageRows } from './messageRowTree.js';
import { useStore } from '../store/index.js';

// Auto-advance the reading pane when the open message leaves the list: select the row that takes
// its place (next in display order, or previous if it was the last, or nothing if the list is now
// empty). Call before removeMessage so the outgoing row is still present for the lookup. No-op
// unless the removed message is the currently selected one. Store-only (no component state), so it's
// a shared list capability that core row-actions and plugins (e.g. GTD "done") both use.
// selectedWithinRemovedRow: when true, advance even if the selected id isn't exactly removedId —
// used by threaded archive, where the open message may be a child of the removed thread head
// (a different id) but still leaves the list, so selection must still advance.
export function advanceSelectionAfterRemoval(removedId, selectedWithinRemovedRow = false) {
  const { selectedMessageId, setSelectedMessage } = useStore.getState();
  if (!selectedWithinRemovedRow && selectedMessageId !== removedId) return;
  const displayMsgs = actionableMessageRows(useStore.getState());
  const idx = displayMsgs.findIndex(m => m.id === removedId);
  if (idx === -1) return;
  const removed = displayMsgs[idx];
  const leavesScope = m => m.id === removedId || (removed.__list_kind === 'thread' && (m.__list_thread === removed.thread_id || m.thread_id === removed.thread_id));
  const next = displayMsgs.slice(idx + 1).find(m => !leavesScope(m)) || displayMsgs.slice(0, idx).reverse().find(m => !leavesScope(m)) || null;
  setSelectedMessage(next?.id ?? null, next?.__list_key);
}
