// Render test for Send later (#543, design 5.1, 5.4 and 7.3): the split Send button and its menu,
// the date and time picker, the phone sheet, and the composer editing a scheduled message (the
// hold, Update, the server's questions and refusals, Unschedule, and closing).
//
// Mounted the way ComposeModal.render.test.js mounts the composer.

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) {
      return { format: 'module', shortCircuit: true, source: [
        'export const useTranslation = () => ({ t: (k) => k, i18n: { language: "en", changeLanguage: () => {} } });',
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
      const out = transform(readFileSync(new URL(url), 'utf8'), { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url });
      return { format: 'module', shortCircuit: true, source: shimViteEnv(out.code) };
    }
    if (url.startsWith('file:') && url.endsWith('.js')) {
      const code = readFileSync(new URL(url), 'utf8');
      if (code.includes('import.meta.env')) return { format: 'module', shortCircuit: true, source: shimViteEnv(code) };
    }
    return nextLoad(url, context);
  },
});

const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example.invalid', pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
  getComputedStyle: dom.window.getComputedStyle, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: true };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

let visibility = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { useStore } = await import('../store/index.js');
const { api } = await import('../utils/api.js');
const ComposeModal = (await import('./ComposeModal.jsx')).default;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT = { id: 'acct', enabled: true, email_address: 'me@example.invalid', name: 'Me', color: '#fff' };
const refusal = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

// Every call the composer makes to the scheduled API and to Drafts, with an answer per test.
const calls = [];
let answers = {};
function answer(name, args) {
  calls.push([name, ...args]);
  const next = answers[name];
  const value = Array.isArray(next) ? next.shift() : next;
  const result = typeof value === 'function' ? value(...args) : value;
  return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
}
const callsTo = (name) => calls.filter(c => c[0] === name);

before(() => {
  api.scheduled.create = (...a) => answer('create', a);
  api.scheduled.update = (...a) => answer('update', a);
  api.scheduled.hold = (...a) => answer('hold', a);
  api.scheduled.release = (...a) => answer('release', a);
  api.scheduled.cancel = (...a) => answer('cancel', a);
  api.scheduled.sendNow = (...a) => answer('sendNow', a);
  api.scheduled.undoSendNow = (...a) => answer('undoSendNow', a);
  api.scheduled.releaseOnUnload = (...a) => { calls.push(['releaseOnUnload', ...a]); };
  api.saveDraft = (...a) => answer('saveDraft', a);
  api.post = (...a) => answer('post', a);
});
beforeEach(() => {
  calls.length = 0;
  answers = {
    create: ({ sendAt }) => ({ id: 's1', sendAt, status: 'scheduled' }),
    update: (id, { sendAt, version }) => ({ id, version: version + 1, sendAt, status: 'scheduled' }),
    hold: { editToken: '11111111-1111-4111-8111-111111111111', version: 3, statusBefore: 'scheduled' },
    release: { status: 'scheduled' },
    cancel: { status: 'cancelled', undoUntil: new Date(Date.now() + 600_000).toISOString() },
    sendNow: () => ({ status: 'scheduled', sendAt: new Date(Date.now() + 10_000).toISOString(), undoToken: 'undo-token', undoUntil: new Date(Date.now() + 10_000).toISOString() }),
    undoSendNow: { status: 'scheduled', sendAt: SEND_AT },
    saveDraft: { uid: 9, folder: 'Drafts', scheduledRemoved: true },
  };
});

const settle = () => React.act(async () => { await new Promise(r => setTimeout(r, 5)); });
const click = (el) => React.act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
const key = (el, k, extra = {}) => React.act(async () => {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
});
const buttons = () => [...document.querySelectorAll('button')];
const button = (text) => buttons().find(b => b.textContent === text);
const chevron = () => document.querySelector('[data-send-later]');
const menuItems = () => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
// A preset by its id: which ones show depends on the time of day the test runs (Later today).
const preset = (id) => document.querySelector(`[role="menu"] [data-preset="${id}"], [role="dialog"] [data-preset="${id}"]`);
async function setInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await React.act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

// Opens the composer through the store, as every entry point does. Returns an unmount.
async function mount(composeData, { mobile = false } = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: mobile ? 375 : 1280 });
  useStore.setState({
    user: { id: 'u1' }, plaintextEmail: false, accounts: [ACCOUNT], selectedAccountId: 'acct', defaultSender: '',
    composing: false, composeData: null, prepareComposeSwitch: null, notifications: [],
  });
  useStore.getState().openCompose(composeData);
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => { root.render(React.createElement(ComposeModal)); });
  await settle();
  let open = true;
  const unmount = async () => {
    if (!open) return;
    open = false;
    await React.act(async () => root.unmount());
  };
  mounted.push(unmount);
  return unmount;
}
// A test that fails before it unmounts still unmounts, so no hold renewal outlives it.
const mounted = [];
afterEach(async () => { while (mounted.length) await mounted.pop()(); });

const NEW_MESSAGE = {
  accountId: 'acct', to: ['Bob <bob@example.invalid>'], subject: 'Q4 numbers', body: '<p>Here they are.</p>',
  draftUid: 7, draftFolder: 'Drafts', draftAccountId: 'acct',
};

describe('Send later on desktop', () => {
  beforeEach(async () => { await mount({ ...NEW_MESSAGE }); });

  test('the chevron is a menu button, and the menu is keyboard operable', async () => {
    const trigger = chevron();
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(trigger.getAttribute('aria-label'), 'compose.scheduleSend.title');
    await click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const menu = document.querySelector('[role="menu"]');
    assert.equal(menu.getAttribute('aria-label'), 'compose.scheduleSend.title');
    const items = menuItems();
    assert.ok(items.length >= 3 && items.length <= 5, 'two to four presets and Pick');
    assert.equal(document.activeElement, items[0], 'focus starts on the first item');
    assert.ok(items.every(i => i.tabIndex === -1));
    await key(items[0], 'ArrowDown');
    assert.equal(document.activeElement, items[1]);
    await key(items[1], 'End');
    assert.equal(document.activeElement, items.at(-1));
    assert.equal(items.at(-1).dataset.preset, 'pick');
    await key(items.at(-1), 'ArrowDown');
    assert.equal(document.activeElement, items[0], 'wraps around');
    await key(items[0], 'ArrowUp');
    assert.equal(document.activeElement, items.at(-1));
    await key(items.at(-1), 'Home');
    assert.equal(document.activeElement, items[0]);
    await key(items[0], 'Escape');
    assert.equal(document.querySelector('[role="menu"]'), null);
    assert.equal(document.activeElement, trigger, 'focus goes back to the chevron');
  });

  test('each preset shows its day and time, and Ctrl+Shift+Enter opens the menu', async () => {
    const editor = document.querySelector('.ProseMirror');
    await key(editor, 'Enter', { ctrlKey: true, shiftKey: true });
    const morning = preset('tomorrowMorning');
    assert.match(morning.textContent, /^compose\.scheduleSend\.tomorrowMorning[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, 8:00\sAM$/);
    assert.match(preset('tomorrowAfternoon').textContent, /1:00\sPM$/);
    const later = preset('laterToday');
    assert.equal(Boolean(later), new Date().getHours() < 16, 'Later today shows only before 4:00 PM');
    if (later) assert.match(later.textContent, /6:00\sPM$/);
    assert.equal(callsTo('post').length, 0, 'the shortcut sends nothing');
  });

  test('a preset schedules the message with its time zone, key and draft, and closes like Send', async () => {
    await click(chevron());
    await click(preset('tomorrowMorning'));
    await settle();
    const [[, body]] = callsTo('create');
    assert.equal(callsTo('post').length, 0, 'nothing went to /mail/send');
    const at = new Date(body.sendAt);
    assert.equal(at.getHours(), 8);
    assert.equal(at.getMinutes(), 0);
    assert.equal(body.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.match(body.clientKey, UUID);
    assert.deepEqual(body.draft, { uid: 7, folder: 'Drafts', accountId: 'acct' });
    assert.deepEqual(body.to, ['Bob <bob@example.invalid>']);
    assert.equal(body.subject, 'Q4 numbers');
    assert.match(body.body, /Here they are\./);
    assert.equal(body.undoSeconds, undefined);
    assert.equal(useStore.getState().composing, false, 'the composer closed');
    const [toast] = useStore.getState().notifications;
    assert.equal(toast.title, 'compose.scheduleSend.scheduledFor');
    assert.equal(toast.body, 'Q4 numbers');
    toast.onAction();
    assert.equal(useStore.getState().selectedFolder, '__scheduled__');
    assert.equal(useStore.getState().selectedAccountId, null);
  });

  test('the toast offers Undo, which cancels the message and reopens it without its old draft', async () => {
    await click(chevron());
    await click(preset('tomorrowMorning'));
    await settle();
    const [toast] = useStore.getState().notifications;
    assert.equal(typeof toast.onAction, 'function', 'View');
    assert.equal(toast.undoMs, 10_000);
    await React.act(async () => { toast.onUndo(); });
    await settle();
    assert.deepEqual(callsTo('cancel')[0], ['cancel', 's1']);
    const state = useStore.getState();
    assert.equal(state.composing, true, 'the composer is back');
    assert.equal(state.composeData.subject, 'Q4 numbers');
    assert.deepEqual(state.composeData.to, ['Bob <bob@example.invalid>']);
    assert.match(state.composeData.body, /Here they are\./);
    assert.equal(state.composeData.restored, true, 'unsaved, so autosave makes a new draft');
    assert.equal(state.composeData.draftUid, null, 'the server deleted the old draft');
  });

  test('an Undo the server refuses says why', async () => {
    answers.cancel = refusal(409, undefined, 'This message is being sent now.');
    await click(chevron());
    await click(preset('tomorrowMorning'));
    await settle();
    await React.act(async () => { useStore.getState().notifications[0].onUndo(); });
    await settle();
    const [error] = useStore.getState().notifications;
    assert.equal(error.type, 'error');
    assert.equal(error.title, 'compose.scheduleSend.undoFailed');
    assert.equal(error.body, 'This message is being sent now.');
    assert.equal(useStore.getState().composing, false);
  });

  test('a retry after a failure uses the same client key', async () => {
    answers.create = [new TypeError('Failed to fetch'), ({ sendAt }) => ({ id: 's1', sendAt, status: 'scheduled' })];
    await click(chevron());
    await click(preset('tomorrowMorning'));
    await settle();
    assert.equal(useStore.getState().composing, true, 'still open after the failure');
    assert.ok(document.body.textContent.includes('Failed to fetch'));
    await click(chevron());
    await click(preset('tomorrowAfternoon'));
    await settle();
    const [first, second] = callsTo('create').map(c => c[1].clientKey);
    assert.match(first, UUID);
    assert.equal(second, first);
    assert.equal(useStore.getState().composing, false);
  });

  test('a too_soon from a server whose clock is ahead says so', async () => {
    const serverNow = new Date(Date.now() + 10 * 60_000).toISOString();
    answers.create = refusal(400, 'too_soon', 'The scheduled time must be at least a minute from now.', { serverNow });
    await click(chevron());
    await click(preset('tomorrowMorning'));
    await settle();
    assert.ok(document.body.textContent.includes('The scheduled time must be at least a minute from now. compose.scheduleSend.errors.clockBehind'));
  });

  test('the server message for a limit is shown as it is', async () => {
    answers.create = refusal(422, 'too_many', 'You can have at most 100 scheduled messages. Send or delete some first.');
    await click(chevron());
    await click(preset('tomorrowMorning'));
    await settle();
    assert.ok(document.body.textContent.includes('You can have at most 100 scheduled messages.'));
  });

  test('Pick date and time has labeled inputs, a live line and inline errors', async () => {
    await click(chevron());
    await click(menuItems().at(-1));
    const dialog = document.querySelector('[role="dialog"]');
    assert.equal(dialog.getAttribute('aria-label'), 'compose.scheduleSend.pick');
    const date = dialog.querySelector('input[type="date"]');
    const time = dialog.querySelector('input[type="time"]');
    assert.equal(document.activeElement, date, 'focus moves to the date');
    assert.equal(dialog.querySelector(`label[for="${date.id}"]`).textContent, 'compose.scheduleSend.dateLabel');
    assert.equal(dialog.querySelector(`label[for="${time.id}"]`).textContent, 'compose.scheduleSend.timeLabel');
    const status = dialog.querySelector('[data-schedule-status]');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(date.getAttribute('aria-describedby'), status.id);
    assert.equal(status.textContent, 'compose.scheduleSend.sendsAt');
    const submit = [...dialog.querySelectorAll('button[type="submit"]')][0];
    assert.equal(submit.disabled, false);

    await setInput(date, '2020-01-01');
    assert.equal(status.textContent, 'compose.scheduleSend.errors.past');
    assert.equal(date.getAttribute('aria-invalid'), 'true');
    assert.equal(submit.disabled, true);
    const far = new Date(Date.now() + 400 * 86_400_000);
    await setInput(date, `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, '0')}-${String(far.getDate()).padStart(2, '0')}`);
    assert.equal(status.textContent, 'compose.scheduleSend.errors.tooFar');

    const soon = new Date(Date.now() + 2 * 86_400_000);
    await setInput(date, `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`);
    await setInput(time, '17:45');
    assert.equal(submit.disabled, false);
    await key(time, 'Escape');
    assert.ok(document.querySelector('[role="menu"]'), 'Escape goes back to the list');
    await click(menuItems().at(-1));
    const again = document.querySelector('[role="dialog"]');
    await setInput(again.querySelector('input[type="date"]'), `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`);
    await setInput(again.querySelector('input[type="time"]'), '17:45');
    await click(again.querySelector('button[type="submit"]'));
    await settle();
    const at = new Date(callsTo('create')[0][1].sendAt);
    assert.equal(at.getDate(), soon.getDate());
    assert.equal(at.getHours(), 17);
    assert.equal(at.getMinutes(), 45);
  });
});

describe('Send later passes the same warnings as Send', () => {
  test('an empty subject asks first, and Send anyway schedules', async () => {
    const close = await mount({ ...NEW_MESSAGE, subject: '' });
    await click(chevron());
    await click(preset('tomorrowMorning'));
    assert.equal(callsTo('create').length, 0);
    await click(button('compose.emptySubject.sendAnyway'));
    await settle();
    assert.equal(callsTo('create').length, 1);
    assert.equal(callsTo('post').length, 0, 'it carried on with Send later, not Send');
    await close();
  });
});

describe('Send later on a phone', () => {
  test('the clock button opens a sheet with the presets and one date and time input', async () => {
    const close = await mount({ ...NEW_MESSAGE }, { mobile: true });
    const clock = chevron();
    assert.equal(clock.getAttribute('aria-label'), 'compose.scheduleSend.title');
    assert.equal(clock.style.width, '44px');
    assert.equal(clock.style.height, '44px');
    await click(clock);
    const sheet = document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(sheet);
    assert.equal(document.getElementById(sheet.getAttribute('aria-labelledby')).textContent, 'compose.scheduleSend.title');
    assert.equal(document.activeElement, sheet.querySelector('[data-preset]'), 'focus starts on the first choice');
    await click(sheet.querySelector('[data-preset="pick"]'));
    const input = sheet.querySelector('input[type="datetime-local"]');
    assert.equal(sheet.querySelector(`label[for="${input.id}"]`).textContent, 'compose.scheduleSend.dateTimeLabel');
    const soon = new Date(Date.now() + 3 * 86_400_000);
    const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    await setInput(input, `${day}T09:15`);
    await click(sheet.querySelector('button[type="submit"]'));
    await settle();
    const at = new Date(callsTo('create')[0][1].sendAt);
    assert.equal(at.getHours(), 9);
    assert.equal(at.getMinutes(), 15);
    assert.equal(useStore.getState().composing, false);
    await close();
  });

  test('Escape closes the sheet and gives focus back to the clock', async () => {
    const close = await mount({ ...NEW_MESSAGE }, { mobile: true });
    await click(chevron());
    const sheet = document.querySelector('[role="dialog"][aria-modal="true"]');
    await key(sheet.querySelector('button'), 'Escape');
    assert.equal(document.querySelector('[role="dialog"][aria-modal="true"]'), null);
    assert.equal(document.activeElement, chevron());
    await close();
  });
});

// A scheduled message as the Scheduled view opens it (utils/scheduledCompose.js).
const SEND_AT = new Date(Date.now() + 3 * 86_400_000).toISOString();
const SCHEDULED = {
  accountId: 'acct', to: ['Bob <bob@example.invalid>'], subject: 'Q4 numbers', body: '<p>Here they are.</p>',
  scheduled: {
    id: '22222222-2222-4222-8222-222222222222', version: 3, sendAt: SEND_AT, timeZone: 'Europe/Berlin',
    attachments: [
      { index: 0, filename: 'q4.pdf', size: 1000, contentType: 'application/pdf', kind: 'upload' },
      { index: 1, filename: 'notes.txt', size: 20, contentType: 'text/plain', kind: 'upload' },
    ],
  },
};
const TOKEN = '11111111-1111-4111-8111-111111111111';
const ID = SCHEDULED.scheduled.id;
async function editBody(text) {
  const editor = document.querySelector('.ProseMirror').editor;
  await React.act(async () => { editor.commands.insertContent(text); });
}

describe('editing a scheduled message', () => {
  test('holds it, shows when it goes, offers Update, and never autosaves to Drafts', async () => {
    const close = await mount(structuredClone(SCHEDULED));
    assert.deepEqual(callsTo('hold')[0], ['hold', ID, null]);
    assert.ok(document.querySelector('[data-scheduled-strip]').textContent.includes('compose.scheduleSend.scheduledFor'));
    assert.ok(button('compose.scheduleSend.edit.update'), 'Update in place of Send');
    assert.equal(button('compose.send'), undefined);
    assert.equal(button('compose.saveDraft'), undefined);
    assert.ok(document.body.textContent.includes('q4.pdf'));
    await editBody(' More.');
    visibility = 'hidden';
    await React.act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
    visibility = 'visible';
    await settle();
    assert.equal(callsTo('saveDraft').length, 0, 'no Drafts copy');
    await close();
  });

  test('Update saves with the token, the version and the attachments it keeps, then closes', async () => {
    const close = await mount(structuredClone(SCHEDULED));
    // Drop notes.txt.
    const name = [...document.querySelectorAll('span')].find(s => s.textContent === 'notes.txt');
    await click(name.parentElement.querySelector('button'));
    await editBody(' More.');
    await click(button('compose.scheduleSend.edit.update'));
    await settle();
    const [[, id, body]] = callsTo('update');
    assert.equal(id, ID);
    assert.equal(body.editToken, TOKEN);
    assert.equal(body.version, 3);
    assert.equal(body.sendAt, SEND_AT);
    assert.deepEqual(body.keepAttachments, [0]);
    assert.match(body.body, /More\./);
    assert.equal(body.confirm, undefined);
    assert.equal(useStore.getState().composing, false);
    assert.equal(useStore.getState().notifications[0].title, 'compose.scheduleSend.scheduledFor');
    await close();
    assert.equal(callsTo('release').length, 0, 'a saved message is not released');
  });

  test('a preset in its menu saves it for that time', async () => {
    const close = await mount(structuredClone(SCHEDULED));
    await click(chevron());
    assert.equal(chevron().getAttribute('aria-label'), 'compose.scheduleSend.edit.options');
    assert.deepEqual(menuItems().map(i => i.dataset.preset), ['sendNow', 'changeTime', 'unschedule']);
    await click(preset('changeTime'));
    assert.equal(document.querySelector('[role="menu"]').getAttribute('aria-label'), 'compose.scheduleSend.changeTime');
    await key(preset('tomorrowMorning'), 'Escape');
    assert.equal(document.activeElement, preset('changeTime'), 'Escape goes back to the first level');
    await click(preset('changeTime'));
    await click(preset('tomorrowAfternoon'));
    await settle();
    const [[, , body]] = callsTo('update');
    assert.equal(new Date(body.sendAt).getHours(), 13);
    await close();
  });

  test('asks before saving a message that may already have gone out, and resends with confirm', async () => {
    const message = 'This message may already have been delivered: MailFlow stopped while sending it. Check the Sent folder first. Send it again anyway?';
    answers.update = [refusal(409, 'confirm_uncertain', message), (id, { sendAt, version }) => ({ id, version: version + 1, sendAt })];
    const close = await mount(structuredClone(SCHEDULED));
    await click(button('compose.scheduleSend.edit.update'));
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]');
    assert.ok(dialog);
    assert.equal(document.getElementById(dialog.getAttribute('aria-describedby')).textContent, message);
    assert.equal(document.activeElement, button('compose.scheduleSend.confirm.go'));
    await click(button('compose.scheduleSend.confirm.go'));
    await settle();
    const updates = callsTo('update');
    assert.equal(updates.length, 2);
    assert.equal(updates[1][2].confirm, true);
    assert.equal(useStore.getState().composing, false);
    await close();
  });

  test('a restored-backup question can be declined, and nothing is saved', async () => {
    answers.update = refusal(409, 'confirm_restored', 'This was paused when a backup was restored. If the old server still runs, it may send it too. Send it from here?');
    const close = await mount(structuredClone(SCHEDULED));
    await click(button('compose.scheduleSend.edit.update'));
    await settle();
    await click(button('common.cancel'));
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(callsTo('update').length, 1);
    assert.equal(useStore.getState().composing, true);
    await close();
  });

  test('a lost hold and a version conflict say so, and keep the composer open', async () => {
    answers.update = refusal(409, 'hold_lost', 'This message is no longer open for editing here.');
    let close = await mount(structuredClone(SCHEDULED));
    await click(button('compose.scheduleSend.edit.update'));
    await settle();
    assert.ok(document.body.textContent.includes('compose.scheduleSend.errors.holdLost'));
    assert.equal(useStore.getState().composing, true);
    assert.equal(button('compose.scheduleSend.edit.update').disabled, true, 'nothing more to save with');
    await close();
    assert.equal(callsTo('release').length, 0, 'a lost hold is not released');

    calls.length = 0;
    answers.update = refusal(409, 'version_conflict', 'This message was changed elsewhere. Open it again.');
    close = await mount(structuredClone(SCHEDULED));
    await click(button('compose.scheduleSend.edit.update'));
    await settle();
    assert.ok(document.body.textContent.includes('compose.scheduleSend.errors.versionConflict'));
    await close();
  });

  test('a hold the server refuses shows why and disables Update', async () => {
    answers.hold = refusal(409, undefined, 'This message is being sent now.');
    const close = await mount(structuredClone(SCHEDULED));
    assert.ok(document.body.textContent.includes('This message is being sent now.'));
    assert.equal(button('compose.scheduleSend.edit.update').disabled, true);
    await close();
    assert.equal(callsTo('release').length, 0);
  });

  test('closing without changes releases it', async () => {
    const close = await mount(structuredClone(SCHEDULED));
    await click(document.querySelector('button[title="compose.toolbar.close"]'));
    await settle();
    assert.equal(useStore.getState().composing, false);
    await close();
    assert.deepEqual(callsTo('release')[0], ['release', ID, TOKEN]);
  });

  test('closing with changes asks, and Discard changes releases it unsaved', async () => {
    const close = await mount(structuredClone(SCHEDULED));
    await editBody(' More.');
    await click(document.querySelector('button[title="compose.toolbar.close"]'));
    assert.ok(document.querySelector('[role="alertdialog"]'));
    assert.ok(button('compose.scheduleSend.edit.saveChanges'));
    await click(button('compose.scheduleSend.edit.discardChanges'));
    await settle();
    assert.equal(useStore.getState().composing, false);
    await close();
    assert.equal(callsTo('update').length, 0);
    assert.equal(callsTo('release').length, 1);
  });

  test('a page going away releases it with keepalive', async () => {
    const close = await mount(structuredClone(SCHEDULED));
    await React.act(async () => { window.dispatchEvent(new window.Event('pagehide')); });
    assert.deepEqual(callsTo('releaseOnUnload')[0], ['releaseOnUnload', ID, TOKEN]);
    await close();
    assert.equal(callsTo('release').length, 0, 'released once');
  });

  test('Unschedule warns about attachments, then saves a draft from the scheduled message', async () => {
    const close = await mount(structuredClone(SCHEDULED));
    await click(chevron());
    await click(menuItems().at(-1));
    assert.ok(document.body.textContent.includes('compose.draftHasAttachments'));
    assert.equal(callsTo('saveDraft').length, 0);
    await click(button('compose.scheduleSend.edit.unscheduleGo'));
    await settle();
    const [[, body]] = callsTo('saveDraft');
    assert.deepEqual(body.fromScheduled, { id: ID, editToken: TOKEN });
    assert.equal(body.accountId, 'acct');
    assert.equal(body.subject, 'Q4 numbers');
    assert.equal(body.existingUid, undefined, 'a new draft');
    assert.equal(useStore.getState().composing, false);
    assert.equal(useStore.getState().notifications[0].title, 'compose.scheduleSend.edit.unscheduled');
    await close();
    assert.equal(callsTo('release').length, 0);
  });

  test('Unschedule that could not remove the scheduled copy says it is still scheduled', async () => {
    answers.saveDraft = { uid: 9, folder: 'Drafts', scheduledRemoved: false };
    const close = await mount({ ...structuredClone(SCHEDULED), scheduled: { ...SCHEDULED.scheduled, attachments: [] } });
    await click(chevron());
    await click(menuItems().at(-1));
    await settle();
    const [toast] = useStore.getState().notifications;
    assert.equal(toast.type, 'error');
    assert.equal(toast.persistent, true);
    assert.equal(toast.body, 'compose.scheduleSend.edit.unscheduleKept');
    await close();
  });

  test('a time that has passed while open asks for a new one', async () => {
    const close = await mount({ ...structuredClone(SCHEDULED), scheduled: { ...SCHEDULED.scheduled, sendAt: new Date(Date.now() - 60_000).toISOString() } });
    await click(button('compose.scheduleSend.edit.update'));
    assert.equal(callsTo('update').length, 0);
    assert.ok(document.body.textContent.includes('compose.scheduleSend.errors.pickNewTime'));
    assert.ok(document.querySelector('[role="menu"]'), 'the menu opens to pick one');
    await close();
  });
});

describe('Send now while editing', () => {
  test('without changes it releases the message, sends it now, and offers the 10 s Undo', async () => {
    await mount(structuredClone(SCHEDULED));
    await click(chevron());
    await click(preset('sendNow'));
    await settle();
    assert.deepEqual(callsTo('release')[0], ['release', ID, TOKEN]);
    assert.deepEqual(callsTo('sendNow')[0], ['sendNow', ID, false]);
    assert.ok(calls.findIndex(c => c[0] === 'release') < calls.findIndex(c => c[0] === 'sendNow'), 'released first');
    assert.equal(callsTo('update').length, 0);
    assert.equal(useStore.getState().composing, false);
    const [toast] = useStore.getState().notifications;
    assert.equal(toast.title, 'compose.undoSend.sending');
    assert.ok(toast.undoMs > 9000 && toast.undoMs <= 10_000);
    await React.act(async () => { toast.onUndo(); });
    await settle();
    assert.deepEqual(callsTo('undoSendNow')[0], ['undoSendNow', ID, 'undo-token']);
    assert.equal(useStore.getState().notifications[0].title, 'compose.scheduleSend.scheduledFor');
  });

  test('with changes it saves them first, at the time it had, then sends now', async () => {
    await mount(structuredClone(SCHEDULED));
    await editBody(' More.');
    await click(chevron());
    await click(preset('sendNow'));
    await settle();
    const [[, , body]] = callsTo('update');
    assert.equal(body.sendAt, SEND_AT);
    assert.match(body.body, /More\./);
    assert.deepEqual(callsTo('sendNow')[0], ['sendNow', ID, false]);
    assert.equal(callsTo('release').length, 0, 'the save ended the hold');
  });

  test('an Undo of Send now the server refuses says why', async () => {
    answers.undoSendNow = refusal(409, 'undo_expired', 'Too late to undo: the message is going out.');
    await mount(structuredClone(SCHEDULED));
    await click(chevron());
    await click(preset('sendNow'));
    await settle();
    await React.act(async () => { useStore.getState().notifications[0].onUndo(); });
    await settle();
    const [error] = useStore.getState().notifications;
    assert.equal(error.title, 'compose.scheduleSend.sendNow.undoFailed');
    assert.equal(error.body, 'Too late to undo: the message is going out.');
  });

  test('asks before sending one that may already have gone out; No closes, the message as it was', async () => {
    const message = 'This message may already have been delivered: MailFlow stopped while sending it. Check the Sent folder first. Send it again anyway?';
    answers.sendNow = [refusal(409, 'confirm_uncertain', message), () => ({ status: 'scheduled', undoToken: 'u2' })];
    const first = await mount(structuredClone(SCHEDULED));
    await click(chevron());
    await click(preset('sendNow'));
    await settle();
    assert.ok(document.querySelector('[role="alertdialog"]'));
    await click(button('compose.scheduleSend.confirm.go'));
    await settle();
    assert.deepEqual(callsTo('sendNow').map(c => c[2]), [false, true]);
    assert.equal(useStore.getState().composing, false);
    await first();

    calls.length = 0;
    answers.sendNow = refusal(409, 'confirm_restored', 'This was paused when a backup was restored.');
    await mount(structuredClone(SCHEDULED));
    await click(chevron());
    await click(preset('sendNow'));
    await settle();
    await click(button('common.cancel'));
    assert.equal(useStore.getState().composing, false, 'released, so the composer closes');
    assert.equal(callsTo('sendNow').length, 1);
  });

  test('a time that has passed is saved a few minutes ahead first', async () => {
    await mount({ ...structuredClone(SCHEDULED), scheduled: { ...SCHEDULED.scheduled, sendAt: new Date(Date.now() - 60_000).toISOString() } });
    await editBody(' More.');
    await click(chevron());
    await click(preset('sendNow'));
    await settle();
    const ahead = new Date(callsTo('update')[0][2].sendAt).getTime() - Date.now();
    assert.ok(ahead > 4 * 60_000 && ahead <= 5 * 60_000, `saved ${ahead} ms ahead`);
    assert.equal(callsTo('sendNow').length, 1);
  });
});

describe('closing a scheduled message that fell due while open (design 2.3)', () => {
  const DUE = () => ({ ...structuredClone(SCHEDULED), scheduled: { ...SCHEDULED.scheduled, sendAt: new Date(Date.now() - 60_000).toISOString() } });
  const closeButton = () => document.querySelector('button[title="compose.toolbar.close"]');

  test('asks: Send now, Pick a new time, or Keep paused, which releases it paused at once', async () => {
    const unmount = await mount(DUE());
    await click(closeButton());
    const dialog = document.querySelector('[role="alertdialog"]');
    assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'compose.scheduleSend.edit.dueTitle');
    assert.ok(button('compose.scheduleSend.edit.sendNow'));
    assert.ok(button('compose.scheduleSend.edit.pickNewTime'));
    await click(button('compose.scheduleSend.edit.keepPaused'));
    await settle();
    assert.deepEqual(callsTo('release'), [['release', ID, TOKEN, { keepPaused: true }]]);
    assert.equal(useStore.getState().composing, false);
    assert.equal(useStore.getState().notifications[0].title, 'compose.scheduleSend.edit.keptPaused');
    await unmount();
    assert.equal(callsTo('release').length, 1, 'released once, paused');
  });

  test('a Keep paused the server refuses keeps the composer open and says why', async () => {
    answers.release = refusal(409, 'hold_lost', 'This message is no longer open for editing here.');
    const unmount = await mount(DUE());
    await click(closeButton());
    await click(button('compose.scheduleSend.edit.keepPaused'));
    await settle();
    assert.equal(useStore.getState().composing, true);
    assert.ok(document.body.textContent.includes('compose.scheduleSend.errors.holdLost'));
    await unmount();
    assert.equal(callsTo('release').length, 1, 'not tried again on close');
  });

  test('a page going away with a due message does not release it; the lapsed lease pauses it', async () => {
    const unmount = await mount(DUE());
    await React.act(async () => { window.dispatchEvent(new window.Event('pagehide')); });
    await unmount();
    assert.equal(callsTo('release').length + callsTo('releaseOnUnload').length, 0);
  });

  test('Pick a new time opens the times, and Send now sends it', async () => {
    await mount(DUE());
    await click(closeButton());
    await click(button('compose.scheduleSend.edit.pickNewTime'));
    assert.ok(preset('tomorrowMorning'), 'the times are open');
    await key(preset('tomorrowMorning'), 'Escape');
    await click(closeButton());
    await click(button('compose.scheduleSend.edit.sendNow'));
    await settle();
    assert.equal(callsTo('release').length, 1);
    assert.equal(callsTo('sendNow').length, 1);
  });

  test('after Discard changes it offers no new time, which would save the discarded edits', async () => {
    await mount(DUE());
    await editBody(' More.');
    await click(closeButton());
    await click(button('compose.scheduleSend.edit.discardChanges'));
    assert.ok(button('compose.scheduleSend.edit.keepPaused'));
    assert.equal(button('compose.scheduleSend.edit.pickNewTime'), undefined);
    await click(button('compose.scheduleSend.edit.sendNow'));
    await settle();
    assert.equal(callsTo('update').length, 0, 'the stored message is sent, not the edits');
    assert.equal(callsTo('sendNow').length, 1);
  });

  test('one that was paused before it was opened closes and is released without asking', async () => {
    answers.hold = { editToken: TOKEN, version: 3, statusBefore: 'paused' };
    const unmount = await mount(DUE());
    await click(closeButton());
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await unmount();
    assert.equal(callsTo('release').length, 1);
  });
});
