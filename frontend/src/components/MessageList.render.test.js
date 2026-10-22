// Render test for MessageList's drag source (#130).
//
// Drag-to-folder was reported broken in Edge, with message rows selecting text instead of
// dragging. Selecting text is what a browser does when an element is NOT draggable, so the
// first question is whether we render the attribute at all. Every other test of this feature
// is a util test and none of them mount a row, so none could answer that.
//
// The harness mirrors MessagePane.render.test.js: node --test cannot parse JSX, so the loader
// hook transforms .jsx with sucrase, and react-i18next is stubbed because the component only
// needs t() to return something.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) {
      return { format: 'module', shortCircuit: true, source: [
        'export const useTranslation = () => ({ t: (k, d) => (typeof d === "string" ? d : d?.defaultValue ?? k), i18n: { language: "en", changeLanguage: () => {} } });',
        'export const initReactI18next = { type: "3rdParty", init: () => {} };',
        'export const Trans = ({ children }) => children ?? null;',
        'export const I18nextProvider = ({ children }) => children ?? null;',
        'export default { useTranslation, initReactI18next };',
      ].join('\n') };
    }
    if (url.endsWith('.json')) {
      return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(new URL(url), 'utf8')}` };
    }
    const shimViteEnv = (code) => code.replaceAll('import.meta.env', 'globalThis.__VITE_ENV__');
    if (url.endsWith('.jsx')) {
      const code = readFileSync(new URL(url), 'utf8');
      const out = transform(code, { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url });
      return { format: 'module', shortCircuit: true, source: shimViteEnv(out.code) };
    }
    if (url.startsWith('file:') && url.endsWith('.js')) {
      const code = readFileSync(new URL(url), 'utf8');
      if (code.includes('import.meta.env')) {
        return { format: 'module', shortCircuit: true, source: shimViteEnv(code) };
      }
    }
    return nextLoad(url, context);
  },
});

const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example.invalid', pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
  getComputedStyle: dom.window.getComputedStyle,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
});
// useMobile() reads window.innerWidth first, then subscribes to matchMedia. jsdom defaults
// innerWidth to 1024, which is the desktop case the bug report is about.
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.matchMedia = dom.window.matchMedia;
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: true };
// MessageList loads its own messages on mount and overwrites anything seeded in the store,
// so the fetch stub has to serve the row rather than the store. Only the messages endpoint
// needs a real shape; everything else can be an empty object, unless a test serves a path
// through ROUTES as [status, body].
let SERVED = [];
let SENDER_ROWS = [];
let REQUESTS = [];
let ROUTES = {};
let CALLS = [];
globalThis.fetch = async (url, opts = {}) => {
  REQUESTS.push({ url: String(url), method: opts.method || 'GET' });
  if (String(url).includes('sender=')) {
    const params = new URL(String(url), 'https://mail.example.invalid').searchParams;
    const members = params.get('unreadOnly') === 'true' ? SENDER_ROWS.filter(row => !row.is_read) : SENDER_ROWS;
    const offset = Number(params.get('offset') || 0), limit = Number(params.get('limit') || 50);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ messages: members.slice(offset, offset + limit), total: members.length }) };
  }
  const path = String(url);
  let sent = null;
  try { sent = typeof opts.body === 'string' ? JSON.parse(opts.body) : null; } catch { /* not JSON */ }
  CALLS.push({ path, method: opts.method || 'GET', body: sent });
  const [status, body] = Object.entries(ROUTES).find(([p]) => path.endsWith(p))?.[1]
    ?? [200, path.includes('/mail/messages?') ? { messages: SERVED, total: SERVED.length } : {}];
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { useStore } = await import('../store/index.js');
const defaultMobileAvatars = useStore.getState().showMobileAvatars;
const { shortcutBus } = await import('../utils/shortcutBus.js');
const { resolveConversationSelection } = await import('../utils/conversation.js');
const { openAdjacentRow } = await import('../utils/listSelection.js');
const MessageList = (await import('./MessageList.jsx')).default;

const ACCOUNT = { id: 'acct-1', email_address: 'a@example.com', name: 'A', color: '#6366f1', include_in_unified_inbox: true };
const MESSAGE = {
  id: 'msg-1', account_id: 'acct-1', folder: 'INBOX', uid: 1,
  subject: 'Draggable subject', snippet: 'preview text', message_id: '<m1@example.com>',
  from_name: 'Sender', from_address: 's@example.com', date: new Date().toISOString(),
  is_read: false, is_starred: false, is_deleted: false, has_attachments: false,
};

// A conversation row: threading renders these through ThreadRow instead of MessageRow.
const THREAD = { ...MESSAGE, id: 'msg-2', thread_id: 'thr-1', message_count: 3, unread_count: 2 };

let container, root;

// Mount fresh for each scenario. MessageList refetches on mount and overwrites anything seeded
// in the store, so the fixture is served through fetch rather than set as state.
async function mount({ rows, threadedView, folder = 'INBOX', accountId = 'acct-1', accounts = [ACCOUNT] }) {
  SERVED = rows;
  if (root) await React.act(async () => root.unmount());
  container = dom.window.document.getElementById('root');
  useStore.setState({
    accounts, accountsReady: true,
    selectedAccountId: accountId, selectedFolder: folder,
    messages: rows, messagesTotal: rows.length, hasMoreMessages: false, loadingMessages: false,
    searchQuery: '', threadedView, groupedSenders: rows.filter(m=>m.sender_group).map(m=>m.sender_group), senderGroupMappings: {}, senderGroupLabels: {}, senderViewState: {}, threadMessages: {}, senderListGroup: null, selectedMessageId: null, selectedListRowKey: null, markReadBehavior: 'manual', notifications: [],
    folders: { 'acct-1': [{ path: 'INBOX', name: 'INBOX' }, { path: 'Archive', name: 'Archive' }, { path: 'Drafts', name: 'Drafts', special_use: '\\Drafts' }] },
  });
  await React.act(async () => {
    root = createRoot(container);
    root.render(React.createElement(MessageList));
  });
}

const draggableIn = (msgid) => {
  const row = container.querySelector(`[data-msgid="${msgid}"]`);
  assert.ok(row, `expected a row for ${msgid}`);
  return row.querySelector('[draggable]');
};

describe('MessageList — drag source (#130)', () => {
  test('an ordinary message row is draggable', async () => {
    await mount({ rows: [MESSAGE], threadedView: false });
    const el = draggableIn('msg-1');
    assert.ok(el, 'expected a draggable element inside the message row');
    assert.equal(el.getAttribute('draggable'), 'true');
  });

  test('a conversation row is draggable too', async () => {
    // The actual #130 bug. Threading renders rows through ThreadRow, which had no draggable
    // attribute and no onDragStart, so with conversations on nothing could be dragged and the
    // browser fell back to selecting the row's text. Asserting only on the non-threaded row
    // is what let this pass while the feature was broken for anyone using threading.
    await mount({ rows: [THREAD], threadedView: true });
    const el = draggableIn('msg-2');
    assert.ok(el, 'expected a conversation row to be draggable');
    assert.equal(el.getAttribute('draggable'), 'true');
  });
});

// The server never groups the Snoozed view (#269): each snoozed message is its own row with when it
// comes back. Drawn as conversation rows, with conversations on, unread mail showed as read and the
// rows of one snoozed conversation shared a key.
describe('MessageList — the Snoozed view with conversations on', () => {
  test('lists each snoozed message on its own, with when it comes back', async () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const a = { ...MESSAGE, id: 'sz-a', folder: 'Snoozed', thread_id: 'thr-s', snooze_until: until };
    const b = { ...MESSAGE, id: 'sz-b', folder: 'Snoozed', thread_id: 'thr-s', snooze_until: until, message_id: '<m2@example.com>' };
    await mount({ rows: [a, b], threadedView: true, folder: 'Snoozed' });
    assert.ok(container.querySelector('[data-msgid="sz-a"]') && container.querySelector('[data-msgid="sz-b"]'), 'both rows');
    const shown = container.querySelectorAll('[title^="messageList.snoozedUntil"]').length;
    assert.equal(shown, 2, 'each row says when it comes back');
    // Unread, so the sender is bold; a conversation row read that from a count this view lacks.
    const sender = [...container.querySelector('[data-msgid="sz-a"]').querySelectorAll('*')]
      .find(el => el.children.length === 0 && el.textContent === 'Sender');
    assert.ok(sender, 'the sender is shown');
    assert.equal(sender.style.fontWeight, '600', 'and shown unread');
  });
});

describe('MessageList — selected-row shortcuts', () => {
  test('mark unread updates a selected GTD rail copy and its section row', async () => {
    await mount({ rows: [MESSAGE], threadedView: false });
    const rail = { ...MESSAGE, id: 'rail-copy', message_id: '<rail@example.com>', is_read: true };
    await React.act(async () => {
      useStore.setState({ gtdSections: { reference: { threads: [rail] } } });
      useStore.getState().setSelectedMessage(rail.id);
    });
    await React.act(async () => { shortcutBus.emit('markUnread'); });
    assert.equal(useStore.getState().gtdSections.reference.threads[0].is_read, false);
    await React.act(async () => { useStore.setState({ gtdSections: null, selectedMessageId: null }); });
  });

  test('forward and Reply All act on the selected row; no selection does nothing', async () => {
    await mount({ rows: [MESSAGE], threadedView: false });
    const drafts = [];
    useStore.setState({ openCompose: draft => drafts.push(draft) });
    await React.act(async () => { useStore.getState().setSelectedMessage('msg-1'); });
    await React.act(async () => { shortcutBus.emit('forward'); await new Promise(r => setTimeout(r, 10)); });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].isForward, true);
    assert.equal(useStore.getState().selectedMessageId, 'msg-1');
    await React.act(async () => { shortcutBus.emit('replyAllFromSelection'); await new Promise(r => setTimeout(r, 10)); });
    assert.equal(drafts.length, 2);
    assert.equal(drafts[1].isReplyAll, true);
    useStore.getState().setSelectedMessage(null);
    await React.act(async () => { shortcutBus.emit('forward'); shortcutBus.emit('replyAllFromSelection'); await new Promise(r => setTimeout(r, 10)); });
    assert.equal(drafts.length, 2);
  });
});

describe('MessageList — modifier-click enters multi-select (#220)', () => {
  // Before this, modifiers only worked once ALREADY in selection mode; entering it took the
  // avatar or the toolbar button. A Ctrl/Cmd- or Shift-click on a row must now enter it in
  // one action, seeded with the open message as anchor, instead of opening the clicked mail.
  const M2 = { ...MESSAGE, id: 'msg-b', uid: 2, message_id: '<m2@example.com>', subject: 'Second' };
  const M3 = { ...MESSAGE, id: 'msg-c', uid: 3, message_id: '<m3@example.com>', subject: 'Third' };
  // Checked and unchecked checkboxes draw the same polyline; stroke-width 3 vs 2.5 is what
  // distinguishes a CHECKED row's checkmark.
  const CHECK = 'svg[stroke-width="3"] polyline[points="20 6 9 17 4 12"]';

  const clickRow = async (msgid, init = {}) => {
    // The click handler sits on the inner draggable element, and DOM events bubble upward,
    // so the dispatch has to start there, not on the [data-msgid] wrapper.
    const row = container.querySelector(`[data-msgid="${msgid}"]`);
    assert.ok(row, `expected a row for ${msgid}`);
    const target = row.querySelector('[draggable]') || row;
    await React.act(async () => {
      target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    });
  };
  const checkedRows = () => [...container.querySelectorAll('[data-msgid]')]
    .filter(r => r.querySelector(CHECK)).map(r => r.getAttribute('data-msgid'));

  test('ctrl-click seeds {open message, clicked row} and does not open the clicked mail', async () => {
    await mount({ rows: [MESSAGE, M2, M3], threadedView: false });
    await React.act(async () => { useStore.getState().setSelectedMessage('msg-1'); });

    await clickRow('msg-c', { ctrlKey: true });

    assert.equal(useStore.getState().selectedMessageId, 'msg-1'); // clicked mail did NOT open
    assert.deepEqual(checkedRows().sort(), ['msg-1', 'msg-c']);   // anchor + clicked selected
  });

  test('shift-click seeds the whole range from the open message', async () => {
    await mount({ rows: [MESSAGE, M2, M3], threadedView: false });
    await React.act(async () => { useStore.getState().setSelectedMessage('msg-1'); });

    await clickRow('msg-c', { shiftKey: true });

    assert.deepEqual(checkedRows().sort(), ['msg-1', 'msg-b', 'msg-c']);
  });

  test('threaded view: ctrl-click on a ThreadRow enters selection too', async () => {
    // The browser smoke caught ThreadRow missing the modifier branch — dev defaults to
    // conversations on, so every earlier assertion here (threadedView: false) passed while
    // the shipped default was broken. Conversations render through ThreadRow, not MessageRow.
    const T1 = { ...MESSAGE, id: 'thr-a', thread_id: 't-a', message_count: 2, unread_count: 1 };
    const T2 = { ...MESSAGE, id: 'thr-b', uid: 9, message_id: '<t2@example.com>', thread_id: 't-b', message_count: 3, unread_count: 0 };
    await mount({ rows: [T1, T2], threadedView: true });
    await React.act(async () => { useStore.getState().setSelectedMessage('thr-a'); });

    await clickRow('thr-b', { ctrlKey: true });

    assert.deepEqual(checkedRows().sort(), ['thr-a', 'thr-b']);
  });

  test('a plain click still just opens the message', async () => {
    await mount({ rows: [MESSAGE, M2], threadedView: false });
    await clickRow('msg-b');
    assert.equal(useStore.getState().selectedMessageId, 'msg-b');
    assert.deepEqual(checkedRows(), []); // no selection mode entered
  });
});

describe('MessageList — Ctrl+Z undo shortcut (#449)', () => {
  // The shortcut runs the same onUndo the visible toast button runs, newest first, and is
  // a no-op once nothing is pending — the keyboard can never undo more than the toasts offer.
  test('undoAction fires the newest pending undo, then the next, then nothing', async () => {
    await mount({ rows: [MESSAGE], threadedView: false });
    const undone = [];
    await React.act(async () => {
      useStore.getState().addNotification({ title: 'older', onUndo: () => undone.push('older') });
      useStore.getState().addNotification({ title: 'newer', onUndo: () => undone.push('newer') });
    });

    await React.act(async () => { shortcutBus.emit('undoAction'); });
    assert.deepEqual(undone, ['newer']);
    assert.deepEqual(useStore.getState().notifications.filter(n => n.onUndo).map(n => n.title), ['older']);

    await React.act(async () => { shortcutBus.emit('undoAction'); });
    await React.act(async () => { shortcutBus.emit('undoAction'); }); // nothing left — no throw, no change
    assert.deepEqual(undone, ['newer', 'older']);
  });
});

describe('MessageList — undo bar length', () => {
  // Undo send holds a message for 10 s, longer than the standard window, and its bar must stay
  // up (and its progress run) for exactly that long, or Undo vanishes while it would still work.
  test('a bar lasts as long as its notification asks, the rest the standard window', async () => {
    await mount({ rows: [MESSAGE], threadedView: false });
    await React.act(async () => {
      useStore.setState({ notifications: [] });
      useStore.getState().addNotification({ title: 'standard', onUndo: () => {} });
      useStore.getState().addNotification({ title: 'held send', onUndo: () => {}, undoMs: 9876 });
    });
    const progress = [...container.querySelectorAll('div')]
      .map(el => el.style.animation)
      .filter(a => a.startsWith('action-bar-progress'));
    assert.deepEqual(progress.sort(), ['action-bar-progress 4500ms linear forwards', 'action-bar-progress 9876ms linear forwards']);
    await React.act(async () => { useStore.setState({ notifications: [] }); });
  });
});

describe('MessageList — configurable hover quick actions (#440)', () => {
  // The stubbed t() returns key paths, so button titles ARE their i18n keys here.
  const TITLES = {
    markRead: 'contextMenu.markRead', star: 'contextMenu.star',
    archive: 'shortcuts.actions.archive.label', snooze: 'contextMenu.snooze.label',
    delete: 'common.delete', move: 'contextMenu.moveToFolder',
  };
  const hoverTitles = async (msgid) => {
    const row = container.querySelector(`[data-msgid="${msgid}"]`);
    assert.ok(row, `expected a row for ${msgid}`);
    await React.act(async () => {
      row.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
    });
    return [...row.querySelectorAll('button[title]')].map(b => b.getAttribute('title'));
  };

  test('the configured set picks which buttons render, in canonical order', async () => {
    await mount({ rows: [MESSAGE], threadedView: false });
    await React.act(async () => { useStore.setState({ hoverActionSet: ['archive', 'snooze', 'delete'] }); });
    const titles = await hoverTitles('msg-1');
    assert.deepEqual(titles, [TITLES.archive, TITLES.snooze, TITLES.delete]);
  });

  test('the default set is the pre-#440 cluster exactly', async () => {
    await mount({ rows: [MESSAGE], threadedView: false });
    await React.act(async () => { useStore.setState({ hoverActionSet: ['markRead', 'star', 'delete', 'move'] }); });
    const titles = await hoverTitles('msg-1');
    assert.deepEqual(titles, [TITLES.markRead, TITLES.star, TITLES.delete, TITLES.move]);
  });
});

describe('MessageList — reopening a saved draft keeps its Bcc', () => {
  // The Bcc lives only in the draft on the server, and saving a reopened draft replaces that copy.
  // Compose used to open with an empty Bcc, so the next save erased the recipients for good.
  const DRAFT = { ...MESSAGE, id: 'draft-1', folder: 'Drafts', uid: 7, is_read: true, subject: 'Draft subject',
    to_addresses: [{ name: '', email: 'alice@example.com' }], cc_addresses: [],
    in_reply_to: '<parent@example.com>', thread_references: '<root@example.com> <parent@example.com>' };

  const openDraft = async ({ bcc }) => {
    ROUTES = { '/mail/messages/draft-1/body': [200, { html: '<p>hello</p>', text: 'hello' }], '/mail/messages/draft-1/bcc': bcc };
    const opened = [];
    await React.act(async () => { useStore.setState({ openCompose: d => opened.push(d), notifications: [], selectedMessageId: null }); });
    await mount({ rows: [DRAFT], threadedView: false, folder: 'Drafts' });
    const row = container.querySelector('[data-msgid="draft-1"]');
    assert.ok(row, 'expected a row for the draft');
    await React.act(async () => {
      (row.querySelector('[draggable]') || row).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 10));
    });
    ROUTES = {};
    return opened;
  };

  test('compose opens with the Bcc, as recipients rather than text to re-split', async () => {
    const bcc = [{ name: 'Doe, Jane', email: 'jane@example.com' }];
    const opened = await openDraft({ bcc: [200, { bcc }] });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].draftUid, 7);
    assert.deepEqual(opened[0].bcc, bcc);
    assert.equal(opened[0].inReplyTo, DRAFT.in_reply_to);
    assert.equal(opened[0].references, DRAFT.thread_references);
  });

  test('a draft whose Bcc cannot be read opens read-only, with an error, never in compose', async () => {
    const opened = await openDraft({ bcc: [502, { error: "Could not read this draft's Bcc recipients from the mail server." }] });
    assert.equal(opened.length, 0);
    assert.equal(useStore.getState().selectedMessageId, 'draft-1');
    assert.ok(useStore.getState().notifications.some(n => n.type === 'error' && n.title === 'messageList.draftBcc.failTitle'));
    await React.act(async () => { useStore.setState({ selectedMessageId: null, notifications: [] }); });
  });
});


describe('MessageList — sender grouping', () => {
  test('group card and detail menus expose group actions', async () => {
    const sender = 'shared@example.com\nAlice';
    const head = { ...MESSAGE, id: `sender:${sender}`, message_id: null, from_email: 'shared@example.com', from_name: 'Alice', sender_group: sender, sender_message_count: 2, sender_unread_count: 1 };
    SENDER_ROWS = [{ ...MESSAGE, id: 'alice-member', from_email: 'shared@example.com', from_name: 'Alice' }];
    await mount({ rows: [head], threadedView: false });
    await React.act(async () => container.querySelector('[data-sender-group] button').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })));
    assert.ok(container.textContent.includes('contextMenu.ungroupSender'));
    assert.ok(!container.textContent.includes('contextMenu.archive'));
    assert.ok(container.textContent.includes('senderGrouping.readAll'));
    assert.ok(container.textContent.includes('senderGrouping.archiveAll'));
    await React.act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await React.act(async () => container.querySelector('[data-sender-group] button').click());
    assert.ok(!container.querySelector('[data-sender-list]').textContent.includes('contextMenu.ungroupSender'));
    await React.act(async () => container.querySelector('[data-sender-list] button[aria-haspopup="menu"]').click());
    assert.ok(container.textContent.includes('contextMenu.ungroupSender'));
    assert.ok(!container.textContent.includes('contextMenu.archive'));
    assert.ok(container.textContent.includes('senderGrouping.readAll'));
    assert.ok(container.textContent.includes('senderGrouping.archiveAll'));
    const item = [...container.querySelectorAll('span')].find(el => el.textContent === 'contextMenu.ungroupSender');
    assert.ok(item);
    await React.act(async () => item.click());
    assert.ok(!useStore.getState().groupedSenders.includes(sender));
    assert.equal(useStore.getState().senderListGroup, null);
  });

  test('same mailbox names have distinct cards, labels and member requests', async () => {
    const alice = 'shared@example.com\nAlice', bob = 'shared@example.com\nBob';
    const head = (key, name) => ({ ...MESSAGE, id: `sender:${key}`, message_id: null, from_email: 'shared@example.com', from_name: name,
      sender_group: key, sender_message_count: 2, sender_unread_count: 1, subject: 'Latest invoice', snippet: 'Latest invoice preview' });
    SENDER_ROWS = [{ ...MESSAGE, id: 'alice-1', from_email: 'shared@example.com', from_name: 'Alice', subject: 'Invoice' }];
    await mount({ rows: [head(alice, 'Alice'), head(bob, 'Bob')], threadedView: false });
    const groups = [...container.querySelectorAll('[data-sender-group]')];
    assert.equal(groups.length, 2);
    const aliceCard = groups.find(group => group.getAttribute('data-sender-group') === alice);
    const bobCard = groups.find(group => group.getAttribute('data-sender-group') === bob);
    assert.ok(aliceCard.querySelector('[title="Alice <shared@example.com>"]'));
    assert.ok(aliceCard.querySelector('button').textContent.includes('Alice'));
    assert.ok(bobCard.querySelector('[title="Bob <shared@example.com>"]'));
    assert.ok(bobCard.querySelector('button').textContent.includes('Bob'));
    assert.ok(aliceCard.textContent.includes('Latest invoice'));
    assert.ok(aliceCard.textContent.includes('Latest invoice preview'));
    assert.equal(aliceCard.querySelector('[data-sender-count]').textContent, '2');
    assert.ok(!aliceCard.textContent.includes('messageList.senderGroupCounts'));
    REQUESTS = [];
    await React.act(async () => aliceCard.querySelector('button').click());
    assert.ok(REQUESTS.some(request => new URL(request.url, 'http://localhost').searchParams.get('sender') === alice));
    assert.ok(container.querySelector('[data-sender-list]'));
    assert.equal(container.querySelectorAll('[data-sender-group]').length, 1);
    await React.act(async () => container.querySelector('[data-sender-list] button[aria-label="common.back"]').click());
    assert.equal(container.querySelectorAll('[data-sender-group]').length, 2);
  });

  test('expansion is read-only and exposes messages across different subjects', async () => {
    const latest = { ...MESSAGE, from_email: 'alerts@example.com', sender_group: 'alerts@example.com', sender_message_count: 2, sender_unread_count: 2 };
    SENDER_ROWS = [
      { ...MESSAGE, id: 'alert-1', from_email: 'alerts@example.com', subject: 'Build failed' },
      { ...MESSAGE, id: 'alert-2', from_email: 'alerts@example.com', subject: 'New release' },
    ];
    await mount({ rows: [latest], threadedView: false });
    const group = container.querySelector('[data-sender-group="alerts@example.com"]');
    assert.ok(group);
    assert.equal(group.querySelector('button').getAttribute('aria-expanded'), 'false');
    assert.equal(container.querySelector('[data-msgid="alert-1"]'), null);
    REQUESTS = [];
    await React.act(async () => group.querySelector('button').click());
    assert.ok(container.querySelector('[data-msgid="alert-1"]'));
    assert.ok(container.querySelector('[data-msgid="alert-2"]'));
    assert.equal(useStore.getState().selectedMessageId, null);
    assert.ok(REQUESTS.some(r => r.url.includes('sender=alerts%40example.com')));
    assert.ok(REQUESTS.every(r => r.method === 'GET'), 'expansion must not mutate mail flags or folders');
    await React.act(async () => container.querySelector('[data-sender-list] button[aria-label="common.back"]').click());
    assert.equal(container.querySelector('[data-msgid="alert-1"]'), null);
  });

  test('conversations inside a sender group retain their thread controls', async () => {
    const head = { ...MESSAGE, from_email: 'alerts@example.com', sender_group: 'alerts@example.com', sender_message_count: 3, sender_unread_count: 2 };
    SENDER_ROWS = [{ ...THREAD, from_email: 'alerts@example.com' }];
    await mount({ rows: [head], threadedView: true });
    const button = container.querySelector('[data-sender-group] button');
    await React.act(async () => button.click());
    assert.ok(draggableIn(THREAD.id));
    assert.ok(container.querySelector('[data-sender-list]'));
  });
});


describe('sender group navigation enhancements', () => {
  const sender = 'alerts@example.com';
  const head = { ...MESSAGE, id: `sender:${sender}`, message_id: null, preview_message_id: 'one', sender_group: sender, sender_message_count: 2, sender_unread_count: 1 };
  test('restores inbox and group positions, and separates All and Unread caches', async () => {
    SENDER_ROWS = [{ ...MESSAGE, id: 'one', is_read: false }, { ...MESSAGE, id: 'two', is_read: true }];
    await mount({ rows: [head], threadedView: false });
    const inbox = container.querySelector('div[tabindex="0"]');
    inbox.scrollTop = 280;
    await React.act(async () => container.querySelector('[data-sender-group] button').click());
    let list = container.querySelector('[data-sender-list] div[tabindex="0"]');
    list.scrollTop = 140;
    await React.act(async () => list.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })));
    const unread = [...container.querySelectorAll('button')].find(button => button.textContent === 'senderGrouping.unread');
    await React.act(async () => unread.click());
    assert.ok(container.querySelector('[data-msgid="one"]'));
    assert.equal(container.querySelector('[data-msgid="two"]'), null);
    assert.ok(REQUESTS.some(request => request.url.includes('unreadOnly=true')));
    await React.act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'senderGrouping.all').click());
    assert.equal(container.querySelector('[data-sender-list] div[tabindex="0"]').scrollTop, 140);
    await React.act(async () => container.querySelector('button[aria-label="common.back"]').click());
    assert.equal(container.querySelector('div[tabindex="0"]').scrollTop, 280);
    await React.act(async () => container.querySelector('[data-sender-group] button').click());
    assert.equal(container.querySelector('[data-sender-list] div[tabindex="0"]').scrollTop, 140);
  });
  test('new mail refresh keeps the list open and offers a jump to the latest mail', async () => {
    SENDER_ROWS = [{ ...MESSAGE, id: 'one' }];
    await mount({ rows: [head], threadedView: false });
    await React.act(async () => container.querySelector('[data-sender-group] button').click());
    SENDER_ROWS = [{ ...MESSAGE, id: 'new', subject: 'New arrival' }, ...SENDER_ROWS];
    await React.act(async () => useStore.setState({ messages: [{ ...head, preview_message_id: 'new', date: new Date(Date.now() + 60000).toISOString(), subject: 'New arrival' }] }));
    assert.ok(container.querySelector('[data-sender-list]'));
    assert.ok(container.querySelector('[data-msgid="new"]'));
    const jump = [...container.querySelectorAll('button')].find(button => button.textContent === 'senderGrouping.newMail');
    assert.ok(jump);
    await React.act(async () => jump.click());
    assert.ok(!container.textContent.includes('senderGrouping.newMail'));
  });
  test('refresh fetches enough pages to retain the visible mail after a burst of arrivals', async () => {
    SENDER_ROWS = Array.from({ length: 60 }, (_, i) => ({ ...MESSAGE, id: `old-${i}`, date: new Date(Date.now() - i * 1000).toISOString() }));
    await mount({ rows: [{ ...head, sender_message_count: 60 }], threadedView: false });
    await React.act(async () => container.querySelector('[data-sender-group] button').click());
    container.querySelector('[data-msgid="old-49"]').getBoundingClientRect = () => ({ top: -10, bottom: 10 });
    SENDER_ROWS = [...Array.from({ length: 12 }, (_, i) => ({ ...MESSAGE, id: `new-${i}`, date: new Date(Date.now() + (12-i) * 1000).toISOString() })), ...SENDER_ROWS];
    REQUESTS = [];
    await React.act(async () => useStore.setState({ messages: [{ ...head, preview_message_id: 'new-0', sender_message_count: 72, date: SENDER_ROWS[0].date }] }));
    assert.ok(container.querySelector('[data-msgid="old-49"]'));
    assert.ok(REQUESTS.some(request => request.url.includes('offset=50')));
  });
  test('unified group rows identify their receiving account', async () => {
    SENDER_ROWS = [{ ...MESSAGE, id: 'one', account_name: 'Work inbox', account_email: 'work@example.com' }];
    await mount({ rows: [head], threadedView: false });
    await React.act(async () => useStore.setState({ selectedAccountId: null }));
    await React.act(async () => container.querySelector('[data-sender-group] button').click());
    assert.equal(container.querySelector('[data-msgid="one"] [title="work@example.com"]').textContent, 'work@example.com');
  });
});

describe('sender grouping — actual list actions', () => {
  test('keyboard navigation reaches members, deletion advances and undo restores the count', async () => {
    const head = { ...MESSAGE, id: 'sender:alerts@example.com', message_id: null, preview_message_id: 'alert-1', from_email: 'alerts@example.com', sender_group: 'alerts@example.com', sender_message_count: 2, sender_unread_count: 2 };
    SENDER_ROWS = [{ ...MESSAGE, id: 'alert-1', from_email: 'alerts@example.com', subject: 'First alert' }, { ...MESSAGE, id: 'alert-2', from_email: 'alerts@example.com', subject: 'Second alert' }];
    await mount({ rows: [head, { ...MESSAGE, id: 'outside' }], threadedView: false });
    await React.act(async () => container.querySelector('[data-sender-group] button').click());
    await React.act(async () => shortcutBus.emit('nextMessage'));
    assert.equal(useStore.getState().selectedMessageId, 'alert-1');
    await React.act(async () => shortcutBus.emit('nextMessage'));
    assert.equal(useStore.getState().selectedMessageId, 'alert-2');
    await React.act(async () => shortcutBus.emit('prevMessage'));
    assert.equal(useStore.getState().selectedMessageId, 'alert-1');
    await React.act(async () => { shortcutBus.emit('delete'); await new Promise(r => setTimeout(r, 10)); });
    assert.equal(useStore.getState().selectedMessageId, 'alert-2');
    assert.equal(useStore.getState().messages[0].sender_message_count, 1);
    const notice = useStore.getState().notifications.find(n => typeof n.onUndo === 'function');
    assert.ok(notice);
    await React.act(async () => notice.onUndo());
    assert.equal(useStore.getState().messages[0].sender_message_count, 2);
    await React.act(async () => container.querySelector('[data-sender-group] button').click());
    await React.act(async () => shortcutBus.emit('nextMessage'));
    assert.equal(useStore.getState().selectedMessageId, 'outside');
  });
});

describe('MessageList — bulk move picker offers Recent and Favorites (#551)', () => {
  // The single-message pickers list recent and favorite folders above the full list; the bulk
  // picker listed only the full list. Both now read the same helpers.
  const M2 = { ...MESSAGE, id: 'msg-b', uid: 2, message_id: '<m2@example.com>', subject: 'Second' };
  const FOLDERS = [
    { path: 'INBOX', name: 'INBOX' },
    { path: 'Archive', name: 'Archive' },
    { path: 'Work/Receipts', name: 'Receipts' },
    { path: 'Clients', name: 'Clients' },
  ];

  // Selection by modifier-click is desktop-only, so a phone test selects first and then
  // narrows the window through the matchMedia listener useMobile subscribes to.
  const openBulkPicker = async ({ phone = false } = {}) => {
    const listeners = new Set();
    const desktopMatchMedia = dom.window.matchMedia;
    dom.window.matchMedia = () => ({ matches: false, addEventListener: (_, h) => listeners.add(h), removeEventListener: (_, h) => listeners.delete(h), addListener() {}, removeListener() {} });
    try {
      await mount({ rows: [MESSAGE, M2], threadedView: false });
    } finally {
      dom.window.matchMedia = desktopMatchMedia;
    }
    useStore.setState({
      recentFolders: [{ accountId: 'acct-1', path: 'Archive' }, { accountId: 'other', path: 'Clients' }],
      favoriteFolders: [{ accountId: 'acct-1', path: 'Work/Receipts', label: 'Tax 2026' }, { accountId: 'acct-1', path: 'Archive' }],
    });
    ROUTES = { '/accounts/acct-1/folders': [200, FOLDERS] };
    await React.act(async () => { useStore.getState().setSelectedMessage('msg-1'); });
    const row = container.querySelector('[data-msgid="msg-b"]');
    await React.act(async () => {
      (row.querySelector('[draggable]') || row).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    });
    if (phone) await React.act(async () => { for (const h of listeners) h({ matches: true }); });
    const moveBtn = container.querySelector('[title="messageList.moveToFolder"]');
    assert.ok(moveBtn, 'expected the bulk Move button');
    await React.act(async () => { moveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  };
  // The picker's rows in order: section headings as "# key", folders by their label text.
  const pickerLines = () => {
    const input = [...container.ownerDocument.querySelectorAll('input')].find(i => i.placeholder === 'contextMenu.folders.search');
    assert.ok(input, 'expected the picker search box');
    const list = input.parentElement.nextElementSibling;
    return [...list.children].map(el => el.tagName === 'BUTTON' ? el.textContent.trim()
      : el.textContent.trim() ? `# ${el.textContent.trim()}` : '---');
  };

  test('lists Recent, then Favorites without repeats, then every folder but the current one', async () => {
    await openBulkPicker();
    assert.deepEqual(pickerLines(), [
      '# contextMenu.folders.recent', 'Archive', '---',
      '# contextMenu.folders.favorites', 'Tax 2026', '---',
      '# messageList.moveToFolder', 'Archive', 'Work / Receipts', 'Clients',
    ]);
  });

  test('the phone bottom sheet lists the same sections, then the full list under Folders', async () => {
    await openBulkPicker({ phone: true });
    assert.deepEqual(pickerLines(), [
      '# contextMenu.folders.recent', 'Archive',
      '# contextMenu.folders.favorites', 'Tax 2026',
      '# messageList.foldersHeading', 'Archive', 'Work / Receipts', 'Clients',
    ]);
  });

  test('a search shows only the matching folders, without the sections', async () => {
    await openBulkPicker();
    const input = [...container.ownerDocument.querySelectorAll('input')].find(i => i.placeholder === 'contextMenu.folders.search');
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'arch');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.deepEqual(pickerLines(), ['Archive']);
  });
});

describe('MessageList reply draft indicators', () => {
  test('renders the action in both message and collapsed conversation rows', async () => {
    for (const [row, threadedView] of [[MESSAGE, false], [THREAD, true]]) {
      useStore.setState({ replyDrafts: { [row.id]: { exists: true } } });
      await mount({ rows: [row], threadedView });
      assert.ok(container.querySelector(`[data-msgid="${row.id}"] [aria-label="Open reply draft"]`));
    }
  });
  test('hides indicators outside the inbox', async () => {
    useStore.setState({ replyDrafts: { [MESSAGE.id]: { exists: true } } });
    await mount({ rows: [{ ...MESSAGE, folder: 'Archive' }], threadedView: false, folder: 'Archive' });
    assert.equal(container.querySelector('[aria-label="Open reply draft"]'), null);

  });
});


describe('mobile sender avatars and bundled brands', () => {
  const apple = { ...MESSAGE, from_email: 'notice@email.apple.com', from_name: 'Apple', has_contact_photo: false };
  const phone = async (rows, threadedView = false) => {
    dom.window.innerWidth = 375;
    useStore.setState({ showMobileAvatars: true, gravatarAvatars: false, senderFavicons: false, senderFaviconsLoaded: false });
    await mount({ rows, threadedView });
  };
  const reset = async () => {
    if (root) { await React.act(async () => root.unmount()); root = null; }
    dom.window.innerWidth = 1024;
    useStore.setState({ showMobileAvatars: defaultMobileAvatars });
  };
  test('new users see mobile avatars by default', () => {
    assert.equal(defaultMobileAvatars, true);
  });
  test('ordinary and conversation rows show a local logo, even with external lookups off', async () => {
    try {
      for (const threadedView of [false, true]) {
        const row = threadedView ? { ...THREAD, ...apple, id: THREAD.id, thread_id: THREAD.thread_id, message_count: 3 } : apple;
        await phone([row], threadedView);
        const image = container.querySelector(`[data-msgid="${row.id}"] img[src="/sender-brands/v1/apple.svg"]`);
        assert.ok(image, 'the mobile row has its brand icon');
        assert.equal(image.parentElement.style.width, '36px');
        assert.equal(image.style.objectFit, 'contain');
      }
    } finally { await reset(); }
  });
  test('group cards and their independent message lists use the same avatars', async () => {
    try {
      const key = 'notice@email.apple.com\nApple';
      const head = { ...apple, id: `sender:${key}`, sender_group: key, sender_message_count: 2, sender_unread_count: 1 };
      SENDER_ROWS = [apple];
      await phone([head]);
      const card = container.querySelector('[data-sender-group]');
      const image = card.querySelector('img[src="/sender-brands/v1/apple.svg"]');
      assert.ok(image);
      assert.equal(image.parentElement.style.width, '36px');
      await React.act(async () => image.click());
      assert.ok(container.querySelector('[data-sender-list] img[src="/sender-brands/v1/apple.svg"]'));
    } finally { await reset(); }
  });
  test('a saved hidden preference removes mobile avatars', async () => {
    try {
      await phone([apple]);
      await React.act(async () => useStore.setState({ showMobileAvatars: false }));
      assert.equal(container.querySelector(`[data-msgid="${apple.id}"] img`), null);
    } finally { await reset(); }
  });
  test('contact photos win, then a failed photo falls back to the brand, then initials', async () => {
    try {
      await phone([{ ...apple, has_contact_photo: true }]);
      const row = container.querySelector(`[data-msgid="${apple.id}"]`);
      const photo = row.querySelector('img');
      assert.ok(photo.src.includes('/api/contacts/photo'));
      await React.act(async () => photo.dispatchEvent(new dom.window.Event('error', { bubbles: true })));
      const brand = row.querySelector('img');
      assert.ok(brand.src.endsWith('/sender-brands/v1/apple.svg'));
      await React.act(async () => brand.dispatchEvent(new dom.window.Event('error', { bubbles: true })));
      assert.equal(row.querySelector('img'), null);
      assert.ok(row.textContent.includes('Apple'));
    } finally { await reset(); }
  });
  test('personal mail and a misleading display name keep the initial avatar', async () => {
    try {
      await phone([{ ...apple, from_email: 'someone@gmail.com' }]);
      assert.equal(container.querySelector(`[data-msgid="${apple.id}"] img`), null);
    } finally { await reset(); }
  });
});

describe('MessageList — a conversation another account also received (#476)', () => {
  // One email delivered to two of the reader's accounts is two mailbox items, and the thread
  // route returns both so the conversation can show them. In acct-1's own view its row
  // stands for acct-1's copies only, so that is all a conversation action may touch.
  // Each test uses its own thread number: the read and delete guards are module state. The thread
  // route marks every message is_draft.
  const ACCOUNT_B = { ...ACCOUNT, id: 'acct-2', email_address: 'b@example.com', name: 'B' };
  const conversation = (n, { unified = false } = {}) => {
    const date = new Date(Date.now() - n * 60_000).toISOString();
    const older = { ...MESSAGE, id: `a-old-${n}`, uid: 100 + n, message_id: `<old-${n}@example.com>`, thread_id: `thr-${n}`, date: new Date(Date.now() - n * 60_000 - 3_600_000).toISOString() };
    const newest = { ...MESSAGE, id: `a-new-${n}`, uid: 200 + n, message_id: `<new-${n}@example.com>`, thread_id: `thr-${n}`, date };
    const copy = { ...newest, id: `b-new-${n}`, account_id: 'acct-2' };
    ROUTES[`/mail/thread?id=thr-${n}&folder=INBOX${unified ? '&unified=true' : ''}`] = [200, { messages: [older, newest, copy].map(m => ({ ...m, is_draft: false })) }];
    return { ...newest, message_count: 2, unread_count: 2 };
  };
  const settle = () => React.act(async () => { await new Promise(r => setTimeout(r, 30)); });
  // ThreadRow shows its hover cluster from the header's onMouseEnter, so the event starts there.
  const hoverClick = async (msgid, title) => {
    const header = container.querySelector(`[data-msgid="${msgid}"] [draggable]`);
    await React.act(async () => { header.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })); });
    const button = container.querySelector(`[data-msgid="${msgid}"] button[title="${title}"]`);
    assert.ok(button, `expected a ${title} button on ${msgid}`);
    await React.act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await settle();
  };
  const idsSentTo = pattern => CALLS.filter(c => pattern.test(c.path)).flatMap(c => c.body?.ids || []).sort();
  // Unmounting sends a pending delete at once instead of after the 4.5 s undo window. Its undo
  // toast is dropped too, or the next mount renders it with a timer that outlives the file.
  const flushDeletes = async () => {
    await React.act(async () => root.unmount());
    root = null;
    useStore.setState({ notifications: [] });
    await settle();
    const single = CALLS.filter(c => c.method === 'DELETE').map(c => c.path.split('/').pop());
    return [...idsSentTo(/bulk-delete/), ...single].sort();
  };
  const start = async (rows, opts = {}) => {
    await mount({ rows, threadedView: true, accounts: [ACCOUNT, ACCOUNT_B], ...opts });
    await React.act(async () => { useStore.setState({ hoverQuickActions: true, hoverActionSet: ['markRead', 'star', 'delete', 'move'] }); });
    CALLS = [];
  };

  test('mark read sends only the row account\'s copies', async () => {
    const row = conversation(1);
    await start([row]);
    await hoverClick(row.id, 'contextMenu.markRead');
    assert.deepEqual(idsSentTo(/bulk-read/), ['a-new-1', 'a-old-1']);
  });

  test('star sends only the row account\'s copies', async () => {
    const row = conversation(2);
    await start([row]);
    await hoverClick(row.id, 'contextMenu.star');
    const starred = CALLS.map(c => c.path.match(/messages\/([^/]+)\/star$/)?.[1]).filter(Boolean).sort();
    assert.deepEqual(starred, ['a-new-2', 'a-old-2']);
  });

  test('delete from the keyboard sends only the row account\'s copies', async () => {
    const row = conversation(3);
    await start([row]);
    await React.act(async () => { useStore.getState().setSelectedMessage(row.id); });
    await React.act(async () => { shortcutBus.emit('delete'); });
    await settle();
    assert.deepEqual(await flushDeletes(), ['a-new-3', 'a-old-3']);
  });

  test('deleting selected conversation rows sends only each row account\'s copies', async () => {
    const one = conversation(4);
    const two = conversation(5);
    await start([one, two]);
    await React.act(async () => { useStore.getState().setSelectedMessage(one.id); });
    const header = container.querySelector(`[data-msgid="${two.id}"] [draggable]`);
    await React.act(async () => {
      header.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    });
    await React.act(async () => { shortcutBus.emit('delete'); });
    await settle();
    assert.deepEqual(await flushDeletes(), ['a-new-4', 'a-new-5', 'a-old-4', 'a-old-5']);
  });

  test('an expanded conversation shows the other account\'s copy as the server left it', async () => {
    const row = conversation(6);
    await start([row]);
    const toggle = container.querySelector(`[data-msgid="${row.id}"] button[aria-expanded]`);
    await React.act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await settle();
    await hoverClick(row.id, 'contextMenu.markRead');
    await hoverClick(row.id, 'contextMenu.star');
    const cached = id => useStore.getState().threadMessages['thr-6'].find(m => m.id === id);
    assert.equal(cached('a-old-6').is_read, true, 'the row account\'s copies show as read');
    assert.equal(cached('a-old-6').is_starred, true, 'and as starred');
    assert.equal(cached('b-new-6').is_read, false, 'the copy the server left unread is not shown as read');
    assert.equal(cached('b-new-6').is_starred, false, 'nor as starred');
  });

  test('in the unified inbox a conversation row still marks every account\'s copy read', async () => {
    const row = conversation(7, { unified: true });
    await start([row], { accountId: null });
    await hoverClick(row.id, 'contextMenu.markRead');
    assert.deepEqual(idsSentTo(/bulk-read/), ['a-new-7', 'a-old-7', 'b-new-7']);
  });

  test('in the unified inbox marking a row read still shows every cached copy read', async () => {
    // A sent reply refreshes the cached conversation across every enabled account (ComposeModal),
    // so it can hold a copy from an account left out of the unified inbox, which the unified
    // action never fetches. Left unread, that copy would turn the row unread again on the next echo.
    const row = conversation(8, { unified: true });
    await start([row], { accountId: null });
    const served = ROUTES['/mail/thread?id=thr-8&folder=INBOX&unified=true'][1].messages;
    const leftOut = { ...served[1], id: 'c-new-8', account_id: 'acct-3' };
    await React.act(async () => { useStore.getState().setThreadMessages('thr-8', [...served, leftOut]); });
    await hoverClick(row.id, 'contextMenu.markRead');
    const unread = useStore.getState().threadMessages['thr-8'].filter(m => !m.is_read).map(m => m.id);
    assert.deepEqual(unread, [], 'every cached copy shows as read');
    // The WebSocket echo of the mark-read, for a copy that is not the row.
    await React.act(async () => { useStore.getState().updateMessage('a-old-8', { is_read: true }); });
    const after = useStore.getState().messages.find(m => m.id === row.id);
    assert.equal(after.unread_count, 0, 'and the row stays read');
  });

  test('in the unified inbox starring a row still shows every cached copy starred', async () => {
    // The unified row stars every unified account's copy on the server, so the cached conversation
    // shows them all starred, the other account's included.
    const row = conversation(12, { unified: true });
    await start([row], { accountId: null });
    const served = ROUTES['/mail/thread?id=thr-12&folder=INBOX&unified=true'][1].messages;
    await React.act(async () => { useStore.getState().setThreadMessages('thr-12', served); });
    await hoverClick(row.id, 'contextMenu.star');
    const starred = CALLS.map(c => c.path.match(/messages\/([^/]+)\/star$/)?.[1]).filter(Boolean).sort();
    assert.deepEqual(starred, ['a-new-12', 'a-old-12', 'b-new-12'], 'every copy is starred on the server');
    const unstarred = useStore.getState().threadMessages['thr-12'].filter(m => !m.is_starred).map(m => m.id);
    assert.deepEqual(unstarred, [], 'and every cached copy shows as starred');
  });

  test('picking the other account\'s copy under the row ends what an earlier notification parked', async () => {
    // A notification tap parks the copy it opens under __dl_<id>, and the entry outlives the
    // open. Left in place, picking the same copy under acct-1's row later still counted as parked,
    // and the reading pane acted for acct-2's conversation from acct-1's row.
    const row = conversation(9);
    await start([row]);
    const copy = ROUTES['/mail/thread?id=thr-9&folder=INBOX'][1].messages[2];
    await React.act(async () => { useStore.getState().setThreadMessages(`__dl_${copy.id}`, [copy]); });
    const toggle = container.querySelector(`[data-msgid="${row.id}"] button[aria-expanded]`);
    await React.act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await settle();
    // The expanded block lists the cached conversation in order: older, newest, then the copy.
    const subRows = container.querySelector(`[data-msgid="${row.id}"]`).lastElementChild.children;
    await React.act(async () => { subRows[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await settle();
    const { selectedMessageId, messages, threadMessages } = useStore.getState();
    assert.equal(selectedMessageId, copy.id, 'the copy is selected');
    const { parked } = resolveConversationSelection({ selectedMessageId, pool: messages, threadMessages });
    assert.equal(parked, false, 'it stands for the row it was picked under');
  });

  // Every other pick of a row ends a leftover park the same way. While the row is listed the entry
  // does nothing, but once a refresh drops the row (another account's message an undo put in this
  // list), the entry alone would still count the open message as parked.
  const park = message => React.act(async () => { useStore.getState().setThreadMessages(`__dl_${message.id}`, [message]); });
  const stillParked = id => {
    const { selectedMessageId, threadMessages } = useStore.getState();
    assert.equal(selectedMessageId, id, `${id} is picked`);
    return resolveConversationSelection({ selectedMessageId, pool: [], threadMessages }).parked;
  };

  test('opening a row\'s reply draft picks the row as a click does', async (t) => {
    // The server here has no draft to open, which the reader is told; later tests expect no notices.
    t.after(() => React.act(async () => { useStore.setState({ notifications: [], replyDrafts: {} }); }));
    for (const [row, threadedView] of [[{ ...MESSAGE, id: 'b-row', account_id: 'acct-2' }, false], [conversation(14), true]]) {
      await start([row], { threadedView });
      await React.act(async () => { useStore.setState({ replyDrafts: { [row.id]: { exists: true } } }); });
      await park(row);
      const draftButton = container.querySelector(`[data-msgid="${row.id}"] [aria-label="Open reply draft"]`);
      await React.act(async () => { draftButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
      await settle();
      assert.equal(stillParked(row.id), false, threadedView ? 'from a conversation row' : 'from a message row');
    }
  });

  test('j, k and o pick a row as a click does', async () => {
    const rows = [{ ...MESSAGE, id: 'b-j1', account_id: 'acct-2' }, { ...MESSAGE, id: 'b-j2', account_id: 'acct-2', uid: 2, message_id: '<j2@example.com>' }];
    await start(rows, { threadedView: false });
    await React.act(async () => { useStore.getState().setSelectedMessage(null); });
    for (const [key, id] of [['openMessage', 'b-j1'], ['nextMessage', 'b-j2'], ['prevMessage', 'b-j1']]) {
      await park(rows.find(r => r.id === id));
      await React.act(async () => { shortcutBus.emit(key); });
      assert.equal(stillParked(id), false, key);
    }
  });

  test('in Drafts the move to the next row picks it from the list too', async () => {
    // In Drafts a click opens the composer, so the list's row opener, behind the advance after a
    // removal and a swipe, only selects the row.
    const drafts = [{ ...MESSAGE, id: 'd-1', folder: 'Drafts' }, { ...MESSAGE, id: 'd-2', uid: 2, folder: 'Drafts', message_id: '<d2@example.com>' }];
    await start(drafts, { threadedView: false, folder: 'Drafts' });
    await React.act(async () => { useStore.getState().setSelectedMessage('d-1'); });
    await park(drafts[1]);
    await React.act(async () => { openAdjacentRow('next'); });
    assert.equal(stillParked('d-2'), false);
  });

  test('in Drafts a draft that cannot open in the composer is picked from the list too', async (t) => {
    // A click opens the composer. When the draft's Bcc cannot be read, or its body cannot be fetched
    // at all, the draft is selected instead, and that is a pick from the list as much as the click.
    t.mock.method(console, 'error', () => {});
    const draft = { ...MESSAGE, id: 'd-9', folder: 'Drafts' };
    const failures = {
      'its Bcc cannot be read': { '/mail/messages/d-9/bcc': [502, { error: 'Bcc unreadable' }] },
      'its body cannot be fetched': {
        '/mail/messages/d-9/body?remoteImages=1': [500, { error: 'Body unavailable' }],
        '/mail/messages/d-9/bcc': [200, { bcc: [] }],
      },
    };
    t.after(() => React.act(async () => {
      for (const routes of Object.values(failures)) for (const path of Object.keys(routes)) delete ROUTES[path];
      useStore.setState({ notifications: [], selectedMessageId: null });
    }));
    for (const [when, routes] of Object.entries(failures)) {
      Object.assign(ROUTES, routes);
      await start([draft], { threadedView: false, folder: 'Drafts' });
      await park(draft);
      const row = container.querySelector('[data-msgid="d-9"]');
      await React.act(async () => {
        (row.querySelector('[draggable]') || row).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await settle();
      assert.equal(stillParked('d-9'), false, when);
      for (const path of Object.keys(routes)) delete ROUTES[path];
    }
  });

  // A notification tap parks the copy it opens, and the reading pane acts for that copy's account
  // even when the row's cached conversation holds it too. 'e' must not archive the row instead.
  const archiveParked = async (row, parked) => {
    const toggle = container.querySelector(`[data-msgid="${row.id}"] button[aria-expanded]`);
    await React.act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await settle();
    await React.act(async () => {
      useStore.getState().setThreadMessages(`__dl_${parked.id}`, [parked]);
      useStore.getState().setSelectedMessage(parked.id);
    });
    await React.act(async () => { shortcutBus.emit('archive'); });
    await settle();
  };

  test('archive from the keyboard leaves the row alone when the opened copy is another account\'s, and says so', async (t) => {
    t.after(() => React.act(async () => { useStore.setState({ notifications: [] }); }));
    const row = conversation(10);
    await start([row]);
    await archiveParked(row, ROUTES['/mail/thread?id=thr-10&folder=INBOX'][1].messages[2]);
    assert.ok(useStore.getState().messages.some(m => m.id === row.id), 'acct-1\'s row is not archived');
    // A notice and nothing else: no undo toast, so nothing is pending.
    assert.deepEqual(useStore.getState().notifications.map(n => n.title), ['message.archived.otherAccountMessage']);
  });

  test('archive from the keyboard still archives the row when the opened copy is the row account\'s', async () => {
    const row = conversation(11);
    await start([row]);
    await archiveParked(row, ROUTES['/mail/thread?id=thr-11&folder=INBOX'][1].messages[0]);
    assert.ok(!useStore.getState().messages.some(m => m.id === row.id), 'the row is archived');
    // Taken back, so the archive does not commit after the file has finished.
    const toast = useStore.getState().notifications.find(n => n.onUndo);
    await React.act(async () => { toast.onUndo(); useStore.setState({ notifications: [] }); });
    await settle();
  });

  test('in the unified inbox archive from the keyboard archives the row whichever account\'s copy is opened', async () => {
    // A unified row stands for every unified account's copies, as the reading pane's Archive does there.
    const row = conversation(13, { unified: true });
    await start([row], { accountId: null });
    await archiveParked(row, ROUTES['/mail/thread?id=thr-13&folder=INBOX&unified=true'][1].messages[2]);
    assert.ok(!useStore.getState().messages.some(m => m.id === row.id), 'the row is archived');
    assert.ok(!useStore.getState().notifications.some(n => n.title === 'message.archived.otherAccountMessage'), 'and nothing is refused');
    const toast = useStore.getState().notifications.find(n => n.onUndo);
    await React.act(async () => { toast.onUndo(); useStore.setState({ notifications: [] }); });
    await settle();
  });
});

describe('MessageList — mark entire folder read', () => {
  test('the shortcut sits immediately before Unread and uses the full-folder endpoint', async () => {
    ROUTES = {};
    await mount({ rows: [MESSAGE], threadedView: false });
    const button = container.querySelector('button[aria-label="sidebar.folderMenu.markAllRead"]');
    assert.ok(button);
    assert.equal(button.nextElementSibling.textContent, 'messageList.unread');
    CALLS = [];
    await React.act(async () => { button.click(); await new Promise(r => setTimeout(r, 20)); });
    const request = CALLS.find(call => call.path.endsWith('/mail/mark-all-read'));
    assert.deepEqual(request.body, { accountId: ACCOUNT.id, folder: 'INBOX' });
    assert.ok(!CALLS.some(call => call.path.endsWith('/mail/bulk-read')));
  });
});

describe('MessageList — mobile sender card swipes', () => {
  const sender = 'shared@example.com\nAlice';
  const head = { ...MESSAGE, id: `sender:${sender}`, message_id: null, from_email: 'shared@example.com', from_name: 'Alice', sender_group: sender, sender_message_count: 650, sender_unread_count: 640 };
  const touch = (element, type, x, y = 20) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }] });
    element.dispatchEvent(event);
  };
  async function mobileScenario(run) {
    const originalWidth = dom.window.innerWidth, originalMedia = dom.window.matchMedia;
    const originalAction = useStore.getState().performSenderGroupAction;
    const actions = [];
    dom.window.innerWidth = 390;
    dom.window.matchMedia = query => ({ matches: !query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} });
    useStore.setState({ performSenderGroupAction: async (...args) => { actions.push(args); return {}; }, senderGroupActionPending: {} });
    try {
      await mount({ rows: [head], threadedView: false });
      const card = container.querySelector('[data-sender-group] button[aria-expanded]');
      assert.ok(card);
      await run(card, actions);
    } finally {
      await React.act(async () => root.unmount()); root = null;
      dom.window.innerWidth = originalWidth; dom.window.matchMedia = originalMedia;
      useStore.setState({ performSenderGroupAction: originalAction, senderGroupActionPending: {} });
    }
  }
  test('right swipe reads the whole group without opening it or acting on its preview', async () => {
    await mobileScenario(async (card, actions) => {
      await React.act(async () => { touch(card, 'touchstart', 20); touch(card, 'touchmove', 140); touch(card, 'touchend', 140); card.click(); });
      assert.equal(card.style.transform, 'translateX(96px)');
      assert.equal(card.style.opacity, '1');
      await React.act(async () => { await new Promise(r => setTimeout(r, 220)); });
      assert.deepEqual(actions, [[sender, { accountId: ACCOUNT.id, folder: 'INBOX' }, 'read']]);
      assert.ok(!container.querySelector('[data-sender-list]'));
    });
  });
  test('both drag directions and completion stay inside the 96px stop', async () => {
    await mobileScenario(async (card, actions) => {
      await React.act(async () => { touch(card, 'touchstart', 200); touch(card, 'touchmove', 900); });
      assert.equal(card.style.transform, 'translateX(96px)');
      await React.act(async () => { touch(card, 'touchcancel', 900); });
      assert.equal(card.style.transform, 'translateX(0)');
      await React.act(async () => { touch(card, 'touchstart', 200); touch(card, 'touchmove', -500); });
      assert.equal(card.style.transform, 'translateX(-96px)');
      await React.act(async () => { touch(card, 'touchend', -500); });
      assert.equal(card.style.transform, 'translateX(-96px)');
      assert.equal(card.style.opacity, '0');
      await React.act(async () => { await new Promise(r => setTimeout(r, 220)); });
      assert.equal(actions.length, 1);
      assert.equal(actions[0][2], 'archive');
    });
  });
  test('reversing into a disabled direction cancels the previous action', async () => {
    await mobileScenario(async (card, actions) => {
      await React.act(async () => { useStore.setState({ messages: [{ ...head, sender_unread_count: 0 }] }); });
      await React.act(async () => {
        touch(card, 'touchstart', 200); touch(card, 'touchmove', 60); touch(card, 'touchmove', 400); touch(card, 'touchend', 400);
        await new Promise(r => setTimeout(r, 220));
      });
      assert.equal(card.style.transform, 'translateX(0)');
      assert.equal(actions.length, 0);
    });
  });
  test('left swipe archives the whole group and collapses the card', async () => {
    await mobileScenario(async (card, actions) => {
      await React.act(async () => { touch(card, 'touchstart', 200); touch(card, 'touchmove', 60); touch(card, 'touchend', 60); await new Promise(r => setTimeout(r, 220)); });
      assert.equal(actions.length, 1);
      assert.equal(actions[0][2], 'archive');
      assert.equal(container.querySelector('[data-sender-group]').style.maxHeight, '0px');
    });
  });
  test('undo makes a dismissed group visible again', async () => {
    await mobileScenario(async (card) => {
      await React.act(async () => useStore.setState({ performSenderGroupAction: async () => {
        useStore.setState({ senderGroupActionPending: { [sender]: true } });
        return { undo() {} };
      } }));
      await React.act(async () => { touch(card, 'touchstart', 200); touch(card, 'touchmove', 60); touch(card, 'touchend', 60); await new Promise(r => setTimeout(r, 220)); });
      assert.equal(container.querySelector('[data-sender-group]').style.maxHeight, '0px');
      await React.act(async () => useStore.setState({ senderGroupActionPending: { [sender]: false } }));
      assert.equal(container.querySelector('[data-sender-group]').getAttribute('aria-hidden'), null);
      assert.equal(card.disabled, false);
    });
  });
  test('a failed group snapshot restores the card and reports an error', async () => {
    await mobileScenario(async (card) => {
      await React.act(async () => useStore.setState({ performSenderGroupAction: async () => { throw new Error('offline'); } }));
      await React.act(async () => { touch(card, 'touchstart', 200); touch(card, 'touchmove', 60); touch(card, 'touchend', 60); await new Promise(r => setTimeout(r, 220)); });
      assert.equal(card.style.opacity, '1');
      assert.equal(container.querySelector('[data-sender-group]').getAttribute('aria-hidden'), null);
      assert.ok(useStore.getState().notifications.some(n => n.type === 'error' && n.body === 'offline'));
    });
  });
  test('scrolling, short drags and cancelled gestures never apply group actions', async () => {
    await mobileScenario(async (card, actions) => {
      await React.act(async () => {
        touch(card, 'touchstart', 20); touch(card, 'touchmove', 25, 160); touch(card, 'touchend', 25, 160);
        touch(card, 'touchstart', 20); touch(card, 'touchmove', 45); touch(card, 'touchend', 45);
        touch(card, 'touchstart', 20); touch(card, 'touchmove', 140); touch(card, 'touchcancel', 140);
        await new Promise(r => setTimeout(r, 220));
      });
      assert.equal(actions.length, 0);
      assert.ok(!container.querySelector('[data-sender-list]'));
    });
  });
});
