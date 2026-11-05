import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
// Synthetic fixtures only: never connects to a mailbox or a database. Run as an isolated CLI.
if (!global.gc) throw new Error('Run with node --expose-gc');
const mode = process.argv[2] || 'current';
const services = new URL('../src/services/', import.meta.url);
const baseline = process.argv[3];
if (!['baseline', 'current'].includes(mode) || (mode === 'baseline' && !baseline)) throw new Error('Use current, or baseline <module path>');
const sweeps = [];
globalThis.setInterval = callback => { sweeps.push(callback); return { unref() {} }; };
let now = Date.now();
Date.now = () => now;
let queries = 0;
globalThis.fixtureQuery = async (_sql, [user]) => {
  queries++;
  const vocabulary = {};
  for (let n = 0; n < 6000; n++) vocabulary[`token-${user}-${n}-${'x'.repeat(30)}`] = { spam: n % 3, ham: n % 4 };
  return { rows: [{ vocabulary, training_records: 200, total_spam: 100, total_ham: 100, prior_spam: 0.5, prior_ham: 0.5 }] };
};
registerHooks({ load(url, context, next) {
  if (url === new URL('db.js', services).href) return { format: 'module', shortCircuit: true,
    source: 'export const query = (...args) => globalThis.fixtureQuery(...args);' };
  return next(url, context);
} });
const { getModelForUser } = await import(mode === 'baseline' ? baseline : new URL('spamModelStore.js', services).href);
function memory(stage) {
  for (let n = 0; n < 3; n++) global.gc();
  const m = process.memoryUsage();
  return { stage, heapMiB: +(m.heapUsed / 1048576).toFixed(2), rssMiB: +(m.rss / 1048576).toFixed(2), externalMiB: +(m.external / 1048576).toFixed(2) };
}
const samples = [memory('start')];
const start = performance.now();
for (let round = 0; round < 4; round++) {
  for (let n = 0; n < 20; n++) await getModelForUser(`round-${round}-${n}`);
  samples.push(memory(`round-${round + 1}`));
}
now += 5 * 60_000 + 60_000;
for (const sweep of sweeps) sweep();
samples.push(memory('expired-idle'));
queries = 0;
const burst = await (async () => {
  const values = await Promise.all(Array.from({ length: 25 }, () => getModelForUser('burst')));
  return { queries, distinctModels: new Set(values).size, memory: memory('concurrent-25') };
})();

const { createBoundedCache, detachCacheString } = await import(new URL('boundedCache.js', services).href);
const imageRefs = mode === 'baseline' ? new Map() : createBoundedCache({ ttlMs: 300000,
  maxEntries: 200, maxWeight: 16 * 1048576, weightOf: refs => [...refs].reduce((n, [k, v]) => n + 96 + 2 * (k.length + v.length), 128) });
const imagesBefore = memory('before-image-refs');
for (let n = 0; n < 40; n++) {
  const url = `https://example.com/image-${n}-${'u'.repeat(100)}.png`;
  const parent = Buffer.from('x'.repeat(2 * 1048576) + url + 'y'.repeat(128)).toString('utf8');
  const raw = parent.slice(2 * 1048576, 2 * 1048576 + url.length);
  const key = mode === 'baseline' ? raw : detachCacheString(raw);
  imageRefs.set(n, new Map([[key, key]]));
}
const imagesAfter = memory('after-image-refs');
console.log(JSON.stringify({ mode, node: process.version, runtime: process.platform, tokensPerModel: 6000,
  rounds: 4, usersPerRound: 20, elapsedMs: Math.round(performance.now() - start), samples, burst,
  imageRefs: { messages: 40, parentHtmlMiB: 2, before: imagesBefore, after: imagesAfter } }));
