import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

// Routes check that an account, message, alias, contact or address book is the signed-in user's
// through services/ownership.js, where each of those checks is written once. This fails when a
// route file writes one of them by hand again, so a missed or miswritten user_id condition can't
// creep back in one route at a time. Scoped writes (UPDATE/DELETE ... WHERE id AND user_id) are
// not lookups and are not matched.
//
// The exceptions below are lookups a shared helper would obscure; each names a fragment of its
// statement and why it stays. An exception that no longer matches anything fails too, so the list
// cannot outlive what it excuses.
const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const ID = String.raw`(?:\$\d+|ANY\(\$\d+(?:::uuid\[\])?\))`;
const PATTERNS = [
  ['account', new RegExp(String.raw`FROM\s+email_accounts\b[^\x60'"]{0,300}?\bWHERE\s+(?:\w+\.)?id\s*=\s*${ID}\s+AND\s+(?:\w+\.)?user_id\s*=\s*\$\d+`, 'g')],
  ['message', new RegExp(String.raw`\bm\.id\s*=\s*${ID}\s+AND\s+a\.user_id\s*=\s*\$\d+`, 'g')],
  ['alias', /\ba\.id\s*=\s*\$\d+\s+AND\s+e\.user_id\s*=\s*\$\d+/g],
  ['contact', /\bc\.id\s*=\s*\$\d+\s+AND\s+c\.user_id\s*=\s*\$\d+/g],
  ['address book', /FROM\s+address_books\s+WHERE\s+id\s*=\s*\$\d+\s+AND\s+user_id\s*=\s*\$\d+/g],
];

const EXCEPTIONS = [
  { file: 'routes/mail.js', near: 'u.preferences FROM messages m', reason: 'message body: joins users for the reader\'s preferences in the same read' },
  { file: 'routes/mail.js', near: '($3::uuid IS NULL OR m.account_id = $3)', reason: 'resolve-message: optional account filter on the legacy UUID fallback, mirroring the Message-ID lookup above it' },
  { file: 'routes/draft.js', near: "AND m.is_deleted = false AND m.folder = 'INBOX'`, [ids, userId]", reason: 'reply drafts: INBOX seed rows of enabled accounts for the thread walk' },
  { file: 'routes/draft.js', near: 'WHERE id = ANY($1::uuid[]) AND user_id = $2 AND enabled = true', reason: 'reply drafts: the enabled accounts of the rows already found' },
  { file: 'routes/categories.js', near: "(u.preferences->>'categorizationEnabled')", reason: 'recategorize: ownership and the categorization setting (account or user) in one condition' },
];

function routeFiles() {
  const routes = readdirSync(join(SRC, 'routes'))
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map(f => join(SRC, 'routes', f));
  const plugins = readdirSync(join(SRC, 'plugins'), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .flatMap(d => readdirSync(join(SRC, 'plugins', d.name))
      .filter(f => f === 'routes.js')
      .map(f => join(SRC, 'plugins', d.name, f)));
  return [...routes, ...plugins];
}

// Every hand-written ownership lookup in a source text, with the text around it.
function findOwnershipLookups(text) {
  const hits = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      hits.push({
        kind,
        line: text.slice(0, m.index).split('\n').length,
        around: text.slice(Math.max(0, m.index - 600), m.index + m[0].length + 200),
      });
    }
  }
  return hits;
}

describe('route ownership lookups', () => {
  it('go through services/ownership.js, apart from the documented exceptions', () => {
    const used = new Set();
    const stray = [];
    for (const path of routeFiles()) {
      const file = relative(SRC, path).split('\\').join('/');
      for (const hit of findOwnershipLookups(readFileSync(path, 'utf8'))) {
        const exception = EXCEPTIONS.find(e => e.file === file && hit.around.includes(e.near));
        if (exception) used.add(exception);
        else stray.push(`${file}:${hit.line} hand-written ${hit.kind} ownership lookup; use services/ownership.js`);
      }
    }
    expect(stray).toEqual([]);
    expect(EXCEPTIONS.filter(e => !used.has(e)).map(e => `${e.file}: ${e.near}`)).toEqual([]);
  });

  it('recognizes the hand-written forms the routes used to have', () => {
    const kinds = sql => findOwnershipLookups(sql).map(h => h.kind);
    expect(kinds("query('SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2', [id, userId])")).toEqual(['account']);
    expect(kinds(`query(\`SELECT ea.id FROM email_accounts ea
      JOIN users u ON u.id = ea.user_id
      WHERE ea.id = $1 AND ea.user_id = $2\`)`)).toEqual(['account']);
    expect(kinds(`SELECT m.*, a.user_id FROM messages m
      JOIN email_accounts a ON m.account_id = a.id
      WHERE m.id = $1 AND a.user_id = $2`)).toEqual(['message']);
    expect(kinds('WHERE m.id = ANY($2::uuid[]) AND a.user_id = $1')).toEqual(['message']);
    expect(kinds('WHERE a.id = $1 AND e.user_id = $2 AND e.id = $3')).toEqual(['alias']);
    expect(kinds('WHERE c.id = $1 AND c.user_id = $2')).toEqual(['contact']);
    expect(kinds("'SELECT * FROM address_books WHERE id = $1 AND user_id = $2'")).toEqual(['address book']);
    // Scoped writes and per-user listings are not ownership lookups.
    expect(kinds("'DELETE FROM inbox_rules WHERE id = $1 AND user_id = $2 RETURNING id'")).toEqual([]);
    expect(kinds("'SELECT id FROM email_accounts WHERE user_id = $1 AND enabled = true'")).toEqual([]);
  });
});
