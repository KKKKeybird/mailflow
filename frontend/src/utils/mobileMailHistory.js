// Keep mobile drill-down views in browser history so Android back and iOS
// gestures unwind the mail UI before leaving the application.
export function backFromMobileMail(store, win = window) {
  const state = store.getState();
  if (state.selectedMessageId) {
    if (win.history.state?.mailflow === 'message') win.history.back();
    else state.setSelectedMessage(null);
    return true;
  }
  if (state.senderListGroup) {
    if (win.history.state?.mailflow === 'sender-group') win.history.back();
    else {
      state.setSenderListGroup(null);
      state.setExpandedSenders(new Set());
    }
    return true;
  }
  return false;
}

export function installMobileMailHistory(store, win = window) {
  const history = win.history;
  let previous = store.getState();
  let navigatingBack = false;
  const unsubscribe = store.subscribe(state => {
    const before = previous;
    previous = state;
    if (navigatingBack) return;
    if (state.senderListGroup && state.senderListGroup !== before.senderListGroup) {
      history.pushState({ mailflow: 'sender-group', group: state.senderListGroup }, '', '/');
    }
    if (state.selectedMessageId && !before.selectedMessageId) {
      history.pushState({ mailflow: 'message' }, '', '/');
    }
  });
  if (win.navigator.standalone && !['guard', 'sender-group', 'message'].includes(history.state?.mailflow)) {
    history.pushState({ mailflow: 'guard' }, '', '/');
  }
  const onPopState = event => {
    navigatingBack = true;
    try {
      const state = store.getState();
      if (state.selectedMessageId) state.setSelectedMessage(null);
      if (state.senderListGroup && event.state?.mailflow !== 'sender-group') {
        state.setSenderListGroup(null);
        state.setExpandedSenders(new Set());
      }
    } finally {
      navigatingBack = false;
    }
    // Re-arm the iOS standalone baseline only after backing past all in-app
    // entries; pushing on return to a group interrupts the native back gesture.
    if (win.navigator.standalone && !['guard', 'sender-group', 'message'].includes(event.state?.mailflow)) {
      history.pushState({ mailflow: 'guard' }, '', '/');
    }
  };
  win.addEventListener('popstate', onPopState);
  return () => {
    unsubscribe();
    win.removeEventListener('popstate', onPopState);
  };
}
