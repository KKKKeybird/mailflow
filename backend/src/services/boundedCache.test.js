import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundedCache, detachCacheString } from './boundedCache.js';
const caches = [];
function cache(opts = {}) {
  const value = createBoundedCache({ ttlMs: 100, maxEntries: 2, maxWeight: 10, weightOf: v => v.length, ...opts });
  caches.push(value);
  return value;
}
afterEach(() => { for (const c of caches.splice(0)) c.close(); vi.useRealTimers(); });
describe('bounded retained cache data', () => {
  it('releases expired entries while the application is idle', () => {
    vi.useFakeTimers();
    const c = cache();
    c.set('body', '12345');
    expect(c.stats()).toEqual({ entries: 1, weight: 5 });
    vi.advanceTimersByTime(101);
    expect(c.stats()).toEqual({ entries: 0, weight: 0 });
  });
  it('evicts least recently used entries and enforces weight as well as count', () => {
    const c = cache();
    c.set('a', '111'); c.set('b', '222'); c.get('a'); c.set('c', '333');
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe('111');
    c.set('large', '12345678');
    expect(c.stats()).toEqual({ entries: 1, weight: 8 });
    expect(c.get('c')).toBeUndefined();
    expect(c.set('huge', '1'.repeat(11))).toBe(false);
    expect(c.stats()).toEqual({ entries: 1, weight: 8 });
  });
  it('replacement, deletion and close release the previous weight', () => {
    const c = cache(); c.set('x', '123456'); c.set('x', '1');
    expect(c.stats().weight).toBe(1);
    c.delete('x'); expect(c.stats().weight).toBe(0);
    c.set('x', '1'); c.close(); expect(c.stats().entries).toBe(0);
  });
  it('does not extend expiration indefinitely by reading an entry', () => {
    vi.useFakeTimers();
    const c = cache(); c.set('x', '1'); vi.advanceTimersByTime(90); c.get('x');
    vi.advanceTimersByTime(11); expect(c.stats().entries).toBe(0);
  });
  it('keeps negative cache entries on their shorter expiry', () => {
    vi.useFakeTimers(); const c = cache({ ttlMs: 1000 });
    c.set('hit', '1'); c.set('miss', '1', { ttlMs: 50 });
    vi.advanceTimersByTime(51);
    expect(c.get('miss')).toBeUndefined(); expect(c.get('hit')).toBe('1');
  });

});


it('detached URL text preserves Unicode and exact cache lookup keys', () => {
  for (const value of ['https://example.com/图片/😀?a=1&b=2', '\ud800', '']) {
    expect(detachCacheString(value)).toBe(value);
  }
});
