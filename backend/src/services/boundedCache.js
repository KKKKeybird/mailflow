// Idle expiration and a hard budget for large process-local caches. Weight is an estimate of
// retained data, not V8 heap size. Oversized entries are served without keeping a cached copy.
export function createBoundedCache({ ttlMs, maxEntries, maxWeight, weightOf, now = () => Date.now() }) {
  const entries = new Map();
  let weight = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return false;
    entries.delete(key);
    weight -= entry.weight;
    return true;
  }
  function prune() {
    const at = now();
    for (const [key, entry] of entries) if (entry.expires <= at) remove(key);
  }
  const timer = setInterval(prune, Math.min(ttlMs, 60_000));
  timer.unref?.();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) { remove(key); return undefined; }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, { ttlMs: entryTtl = ttlMs } = {}) {
      remove(key);
      prune();
      const size = weightOf(value);
      if (!Number.isFinite(size) || size < 0 || size > maxWeight) return false;
      while (entries.size >= maxEntries || weight + size > maxWeight) remove(entries.keys().next().value);
      entries.set(key, { value, weight: size, expires: now() + entryTtl });
      weight += size;
      return true;
    },
    delete: remove,
    clear() { entries.clear(); weight = 0; },
    close() { clearInterval(timer); entries.clear(); weight = 0; },
    stats() { return { entries: entries.size, weight }; },
  };
}

// Regex captures/slices can keep an entire email HTML string alive behind a short URL. Copy
// UTF-16 code units so cached references own only their text, including non-BMP/lone surrogates.
export function detachCacheString(value) {
  return Buffer.from(value, 'utf16le').toString('utf16le');
}
