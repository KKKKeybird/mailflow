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

const McpSettings = (await import('./McpSettings.jsx')).default;
const { api } = await import('../utils/api.js');
test('MCP settings default to read-only, send only explicitly selected mailbox grants, show a token once and revoke it', async () => {
  const ACCOUNT = '22222222-2222-4222-8222-222222222222';
  const SECOND = '33333333-3333-4333-8333-333333333333';
  const TOKEN = '44444444-4444-4444-8444-444444444444';
  const secret = 'mf_mcp_' + 'A'.repeat(43);
  let tokens = [], creations = [], revocations = [];
  const original = api.mcp;
  api.mcp = {
    listTokens: async () => ({ tokens }), events: async () => ({ events: [] }),
    createToken: async body => { creations.push(body); tokens = [{ id: TOKEN, name: body.name, account_ids: body.accountIds, allow_send: body.allowSend, expires_at: '2030-01-01T00:00:00Z' }]; return { ...tokens[0], token: secret }; },
    revokeToken: async id => { revocations.push(id); tokens = tokens.map(token => ({ ...token, revoked_at: '2026-10-10T00:00:00Z' })); },
  };
  useStore.setState({ accounts: [{ id: ACCOUNT, name: 'One', email_address: 'one@example.com' }, { id: SECOND, name: 'Two', email_address: 'two@example.com' }] });
  const root = createRoot(document.getElementById('root'));
  const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text);
  try {
    await React.act(async () => root.render(React.createElement(McpSettings)));
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    assert.equal(boxes.length, 3);
    assert.ok(boxes.every(box => !box.checked), 'mailbox access and sending both need an explicit selection');
    assert.equal(button('mcp.create').disabled, true);
    await React.act(async () => boxes[0].click());
    await React.act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.deepEqual(creations[0], { name: 'Codex', accountIds: [ACCOUNT], allowSend: false, expiresInDays: 90 });
    assert.equal(document.querySelector('textarea').value, secret);
    assert.ok(document.querySelector('pre').textContent.includes('https://mail.example.invalid/api/mcp'));
    assert.ok(document.querySelector('pre').textContent.includes('bearer_token_env_var'));
    assert.equal(document.querySelector('pre').textContent.includes(secret), false);
    await React.act(async () => button('mcp.hide').click());
    assert.equal(document.querySelector('textarea'), null);
    await React.act(async () => boxes[2].click());
    await React.act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(creations[1].allowSend, true);
    assert.equal(boxes[2].checked, false, 'the next token defaults back to read-only');
    await React.act(async () => button('mcp.revoke').click());
    assert.deepEqual(revocations, [TOKEN]);
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(button('mcp.revoke'), undefined);
  } finally {
    api.mcp = original;
    await React.act(async () => root.unmount());
  }
});
