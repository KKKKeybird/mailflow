export const senderCacheKey = (context, sender) => `sender:${context}:${sender}`;

export function messageRowTree(state) {
  let roots = state.searchQuery?.trim() ? state.searchResults : state.messages;
  if (!state.searchQuery?.trim() && state.senderListGroup) {
    const group = roots?.find(message => message.sender_group && senderCacheKey(state.senderGroupContext, message.sender_group) === state.senderListGroup);
    if (group) roots = [group];
  }
  const mailNode = (message, parent = '', sender = null) => {
    const thread = !state.searchQuery?.trim() && state.threadedView && Number(message.message_count) > 1 && message.thread_id;
    const key = `${parent}/${thread ? 'thread:' + message.thread_id : 'message:' + message.id}`;
    const kind = thread ? 'thread' : 'message';
    const children = thread && (state.includeCachedChildren || state.expandedThreadId === message.thread_id)
      ? (state.threadMessages[message.thread_id] || []).map(m => ({ key: `${key}/child:${m.id}`, kind: 'message',
        message: { ...m, __list_key: `${key}/child:${m.id}`, __list_kind: 'message', __list_thread: message.thread_id, __list_sender: sender }, children: [] })) : [];
    return { key, kind, message: { ...message, __list_key: key, __list_kind: kind, __list_sender: sender }, children };
  };
  return (roots || []).map(message => {
    if (!message.sender_group) return mailNode(message);
    const key = senderCacheKey(state.senderGroupContext, message.sender_group);
    return { key, kind: 'sender', message, children: state.expandedSenders?.has(key)
      ? (state.threadMessages[key] || []).map(m => mailNode(m, key, message.sender_group)) : [] };
  });
}

export function actionableMessageRows(state) {
  if (!(state.messages || []).some(m => m.sender_group) || state.searchQuery?.trim()) {
    return state.searchQuery?.trim() ? state.searchResults : state.messages;
  }
  const rows = [];
  const visit = node => { if (node.kind !== 'sender') rows.push(node.message); node.children.forEach(visit); };
  messageRowTree(state).forEach(visit);
  return rows;
}

export function selectedListMessage(state) {
  const rows = actionableMessageRows(state) || [];
  const visible = rows.find(m => m.__list_key === state.selectedListRowKey && m.id === state.selectedMessageId);
  if (visible) return visible;
  if (state.selectedListRowKey) {
    const cached = [];
    const visit = node => { if (node.kind !== 'sender') cached.push(node.message); node.children.forEach(visit); };
    const expanded = new Set((state.messages || []).filter(m => m.sender_group).map(m => senderCacheKey(state.senderGroupContext, m.sender_group)));
    messageRowTree({ ...state, expandedSenders: expanded, includeCachedChildren: true }).forEach(visit);
    const exact = cached.find(m => m.__list_key === state.selectedListRowKey && m.id === state.selectedMessageId);
    if (exact) return exact;
    if (state.selectedListRowKey.endsWith(`/child:${state.selectedMessageId}`)) {
      const child = cached.find(m => m.id === state.selectedMessageId && m.__list_thread);
      if (child) return child;
    }
  }
  return rows.find(m => m.id === state.selectedMessageId);
}

export function uniqueActionRows(rows, selectedKey) {
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id) || row.__list_key === selectedKey) byId.set(row.id, row);
  }
  return [...byId.values()];
}

export function neighborMessageRow(state, direction, wrap = true) {
  const rows = actionableMessageRows(state) || [];
  if (!rows.length) return null;
  const selected = selectedListMessage(state);
  let index = selected ? rows.findIndex(row => row.id === selected.id && row.__list_key === selected.__list_key) : -1;
  if (index < 0) {
    const hiddenGroup = messageRowTree(state).find(node => node.kind === 'sender'
      && (state.threadMessages[node.key] || []).some(m => m.id === state.selectedMessageId
        || (state.threadMessages[m.thread_id] || []).some(child => child.id === state.selectedMessageId)));
    if (hiddenGroup) {
      const all = [];
      const visit = node => { all.push(node); node.children.forEach(visit); };
      messageRowTree(state).forEach(visit);
      const position = all.findIndex(node => node.key === hiddenGroup.key);
      for (let i = position + direction; i >= 0 && i < all.length; i += direction) {
        if (all[i].kind !== 'sender') return all[i].message;
      }
      return wrap ? (direction > 0 ? rows[0] : rows.at(-1)) : null;
    }
  }
  if (index < 0 && !wrap) return null;
  if (direction > 0) return rows[index + 1] || (wrap ? rows[0] : null);
  return index <= 0 ? (wrap ? rows.at(-1) : null) : rows[index - 1];
}
