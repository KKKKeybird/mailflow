import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStore } from 'zustand/vanilla';
import { backFromMobileMail, installMobileMailHistory } from './mobileMailHistory.js';

function fixture(standalone = false) {
  const dom = new JSDOM('', { url: 'https://mail.example.com/' });
  Object.defineProperty(dom.window.navigator, 'standalone', { value: standalone });
  const store = createStore(set => ({
    selectedMessageId: null, senderListGroup: null, expandedSenders: new Set(),
    setSelectedMessage: selectedMessageId => set({ selectedMessageId }),
    setSenderListGroup: senderListGroup => set({ senderListGroup }),
    setExpandedSenders: expandedSenders => set({ expandedSenders }),
  }));
  const dispose = installMobileMailHistory(store, dom.window);
  const back = () => new Promise(resolve => {
    dom.window.addEventListener('popstate', resolve, { once: true });
    dom.window.history.back();
  });
  return { store, win: dom.window, back, close: () => { dispose(); dom.window.close(); } };
}

test('Android back returns from sender list to inbox without leaving the document', async () => {
  const f = fixture();
  try {
    f.store.setState({ senderListGroup: 'alice', expandedSenders: new Set(['alice']) });
    assert.equal(f.win.history.length, 2);
    assert.equal(f.win.history.state.mailflow, 'sender-group');
    await f.back();
    assert.equal(f.store.getState().senderListGroup, null);
    assert.equal(f.store.getState().expandedSenders.size, 0);
    assert.equal(f.win.location.href, 'https://mail.example.com/');
    f.store.setState({ senderListGroup: 'bob' });
    assert.equal(f.win.history.state.group, 'bob');
    await f.back();
    assert.equal(f.store.getState().senderListGroup, null);
  } finally { f.close(); }
});

for (const standalone of [false, true]) {
  test(`message back preserves group, next back closes it (standalone=${standalone})`, async () => {
    const f = fixture(standalone);
    try {
      f.store.setState({ senderListGroup: 'alice' });
      f.store.setState({ selectedMessageId: 'm1' });
      f.store.setState({ selectedMessageId: 'm2' });
      assert.equal(f.win.history.length, standalone ? 4 : 3);
      await f.back();
      assert.equal(f.store.getState().selectedMessageId, null);
      assert.equal(f.store.getState().senderListGroup, 'alice');
      assert.equal(f.win.history.state.mailflow, 'sender-group');
      await f.back();
      assert.equal(f.store.getState().senderListGroup, null);
      assert.equal(f.win.history.state?.mailflow ?? null, standalone ? 'guard' : null);
    } finally { f.close(); }
  });
}

test('ordinary mail navigation and iOS guard continue working', async () => {
  const f = fixture(true);
  try {
    f.store.setState({ selectedMessageId: 'm1' });
    await f.back();
    assert.equal(f.store.getState().selectedMessageId, null);
    assert.equal(f.win.history.state.mailflow, 'guard');
    await f.back();
    assert.equal(f.win.history.state.mailflow, 'guard');
  } finally { f.close(); }
});

test('native Android back consumes message then sender group before allowing exit', async () => {
  const f = fixture();
  try {
    f.store.setState({ senderListGroup: 'alice', selectedMessageId: 'm1' });
    let popped = new Promise(resolve => f.win.addEventListener('popstate', resolve, { once: true }));
    assert.equal(backFromMobileMail(f.store, f.win), true);
    await popped;
    assert.equal(f.store.getState().selectedMessageId, null);
    assert.equal(f.store.getState().senderListGroup, 'alice');
    popped = new Promise(resolve => f.win.addEventListener('popstate', resolve, { once: true }));
    assert.equal(backFromMobileMail(f.store, f.win), true);
    await popped;
    assert.equal(f.store.getState().senderListGroup, null);
    assert.equal(backFromMobileMail(f.store, f.win), false);
  } finally { f.close(); }
});
