// Render test for the Categorize submenu's "Always for this sender / domain" (#490).
//
// The harness mirrors MessageList.render.test.js: node --test cannot parse JSX, so the loader
// hook transforms .jsx with sucrase, and react-i18next is stubbed to return the key.

import { test } from 'node:test';
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
});
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.matchMedia = dom.window.matchMedia;
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: true };
globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { useStore } = await import('../store/index.js');

const SenderGroupingSettings = (await import('./SenderGroupingSettings.jsx')).default;
const { api } = await import('../utils/api.js');
test('settings rename, manual merge and split save server-backed rules', async () => {
  const alice = 'shared@example.com\nAlice', bob = 'shared@example.com\nBob';
  const saves = []; const original = api.savePreferences;
  api.savePreferences = async prefs => { saves.push(prefs); };
  useStore.setState({ user: { id: 'u' }, groupedSenders: [alice, bob], senderGroupMappings: {}, senderGroupLabels: { [alice]: 'My notifications' }, senderGroupingSaving: false });
  const root = createRoot(document.getElementById('root'));
  try {
    await React.act(async () => root.render(React.createElement(SenderGroupingSettings)));
    const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text);
    await React.act(async () => button('common.save').click());
    assert.equal(saves.at(-1).senderGroupLabels[alice], 'My notifications');
    const select = document.querySelector('select');
    await React.act(async () => { select.value = bob; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await React.act(async () => button('senderGrouping.merge').click());
    assert.deepEqual(useStore.getState().groupedSenders, [bob]);
    assert.equal(useStore.getState().senderGroupMappings[alice], bob);
    await React.act(async () => button('senderGrouping.split').click());
    assert.ok(useStore.getState().groupedSenders.includes(alice));
    assert.equal(useStore.getState().senderGroupMappings[alice], undefined);
  } finally { await React.act(async () => root.unmount()); api.savePreferences = original; }
});
