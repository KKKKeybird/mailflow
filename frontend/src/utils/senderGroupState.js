import { senderIdentity } from './senderIdentity.js';
import { senderCacheKey } from './messageRowTree.js';
const count = row => Number(row.message_count) || 1;
const unread = row => Number.isFinite(Number(row.unread_count)) ? Number(row.unread_count) : Number(!row.is_read);
const sum = (rows, value) => rows.reduce((n, row) => n + value(row), 0);

export function reconcileSenderHeads(state, caches, roots = state.messages) {
  return roots.flatMap(head => {
    if (!head.sender_group) return [head];
    const key = senderCacheKey(state.senderGroupContext, head.sender_group);
    const before = state.threadMessages[key] || [];
    const after = caches[key] || [];
    const messageCount = Math.max(0, (Number(head.sender_message_count) || sum(before, count)) + sum(after, count) - sum(before, count));
    const unreadCount = Math.max(0, Number(head.sender_unread_count) + sum(after, unread) - sum(before, unread));
    if (!messageCount) return [];
    const preview = after.find(row => row.id === head.preview_message_id) || after[0];
    return [{ ...head, sender_message_count: messageCount, sender_unread_count: unreadCount,
      ...(preview && !after.some(row => row.id === head.preview_message_id) && before.some(row => row.id === head.preview_message_id)
        ? { preview_message_id: preview.id, subject: preview.subject, snippet: preview.snippet, date: preview.date } : {}) }];
  });
}

export function removeSenderMembers(state, ids, scope) {
  const caches = Object.fromEntries(Object.entries(state.threadMessages).map(([key, rows]) => [key, rows.filter(m => !ids.has(m.id))]));
  if (scope?.__list_kind === 'message' && scope.__list_thread) {
    for (const [key, rows] of Object.entries(state.threadMessages)) {
      if (!key.startsWith('sender:')) continue;
      caches[key] = rows.flatMap(row => {
        if (row.thread_id !== scope.__list_thread) return ids.has(row.id) ? [] : [row];
        const members = caches[row.thread_id] || [];
        const remaining = count(row) - 1;
        if (!remaining) return [];
        const replacement = [...members].sort((a,b) => new Date(b.date)-new Date(a.date) || Number(a.is_read)-Number(b.is_read) || a.id.localeCompare(b.id))[0];
        return [{ ...row, message_count: remaining, unread_count: Math.max(0, unread(row) - unread(scope)),
          ...(ids.has(row.id) && replacement ? { id: replacement.id, date: replacement.date, snippet: replacement.snippet } : {}) }];
      });
    }
  }
  const roots = state.messages.map(row => {
    if (!scope?.__list_thread || row.sender_group || row.thread_id !== scope.__list_thread) return row;
    const remaining = count(row) - 1;
    const replacement = caches[row.thread_id]?.[0];
    return { ...row, message_count: remaining, unread_count: Math.max(0, unread(row) - unread(scope)),
      ...(ids.has(row.id) && replacement ? { id: replacement.id, date: replacement.date, snippet: replacement.snippet } : {}) };
  });
  return { threadMessages: caches, messages: reconcileSenderHeads(state, caches, roots) };
}

export function refreshSenderThreadReadState(caches, id, updates, state) {
  if ('unread_count' in updates || !('is_read' in updates)) return caches;
  let category;
  try { category = JSON.parse(state.senderGroupContext || '{}').category; } catch { /* an old cache has no scope */ }
  const inCategory = message => !category || (category === 'primary' ? !message.category || message.category === 'primary' : message.category === category);
  return Object.fromEntries(Object.entries(caches).map(([key, rows]) => [key, !key.startsWith('sender:') ? rows : rows.map(row => {
    if (!row.thread_id || Number(row.message_count) <= 1) return row;
    const previous = (state.threadMessages[row.thread_id] || []).find(m => m.id === id)
      || (row.id === id ? (state.threadMessages[key] || []).find(m => m.id === id) : null);
    if (!previous || !inCategory(previous)) return row;
    const delta = Number(!updates.is_read) - Number(!previous.is_read);
    const unread_count = Math.max(0, unread(row) + delta);
    return { ...row, unread_count };
  })]));
}

export function restoreSenderMembers(state, restored) {
  const caches = { ...state.threadMessages };
  const restoredGroupRows = new Set();
  for (const message of restored) {
    const sender = message.__list_sender || senderIdentity(message.from_email, message.from_name);
    const grouped = !state.searchQuery.trim() && state.selectedFolder === 'INBOX' && state.groupedSenders.includes(sender);
    if (!grouped) continue;
    restoredGroupRows.add(message.id);
    const key = senderCacheKey(state.senderGroupContext, sender);
    const rows = caches[key] || [];
    if (message.__list_thread && message.__list_kind === 'message') {
      const members = caches[message.__list_thread] || [];
      if (members.some(m => m.id === message.id)) continue;
      if (caches[message.__list_thread]) caches[message.__list_thread] = [...members, message].sort((a,b) => new Date(b.date) - new Date(a.date));
      caches[key] = rows.map(row => row.thread_id === message.__list_thread
        ? { ...row, message_count: count(row) + 1, unread_count: unread(row) + unread(message) } : row);
    } else if (!rows.some(row => row.id === message.id)) {
      caches[key] = [...rows, message].sort((a,b) => new Date(b.date) - new Date(a.date));
    }
  }
  let roots = reconcileSenderHeads(state, caches);
  for (const [key, rows] of Object.entries(caches)) {
    const prefix = `sender:${state.senderGroupContext}:`;
    if (!key.startsWith(prefix) || !rows.length) continue;
    const sender = key.slice(prefix.length);
    if (roots.some(m => m.sender_group === sender)) continue;
    const preview = rows[0];
    roots.push({ ...preview, id: `sender:${sender}`, message_id: null, preview_message_id: preview.id,
      sender_group: sender, sender_message_count: sum(rows, count), sender_unread_count: sum(rows, unread) });
  }
  return { threadMessages: caches, messages: roots, restoredGroupRows };
}
