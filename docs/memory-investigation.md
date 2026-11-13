# Backend container memory investigation (2026-11-05)

This integration addresses reproducible retained allocations in the backend. No production container metrics, heap profile or OOM record were supplied, so it does not establish the complete cause of a particular deployment's memory growth. The frontend image at the time served static files with nginx (Caddy from v4.4.0); browser JavaScript memory is separate from that container.

## Findings and changes

- Spam model cache: expiry used to be checked only on the next lookup of the same user. Idle vocabularies survived indefinitely, with no total budget. It now actively expires idle entries, limits the cache to 32 models and an estimated 64 MiB, and evicts least recently used entries. Concurrent cold loads share one query and model object. Invalidation prevents an older in-flight read from repopulating the cache.
- Image reference cache: a short URL captured from HTML can keep the entire parent string alive in V8. Cached keys and values now own their UTF-16 text. The cache has active five-minute expiry, a 200-entry limit and an estimated 16 MiB budget.
- Avatar cache: a 2,000-entry limit alone permitted approximately 1 GiB of 512 KiB buffers. A 16 MiB buffer-weight budget now supplements the entry limit; existing positive/negative TTLs and privacy settings remain unchanged.

Weights estimate retained data, not total process memory. Large entries remain usable but are not cached. Expiry maintenance runs at most once a minute and does not keep the process alive. Spam classification scores, training records and model persistence are unchanged.

## Reproduction

`backend/benchmarks/memoryRetention.mjs` uses synthetic model/HTML fixtures only, substitutes the database module, and opens no mailbox or database connection. Run the standalone CLI with Node 22 supporting `node:module.registerHooks` and `--expose-gc`:

```sh
node --expose-gc --max-old-space-size=384 backend/benchmarks/memoryRetention.mjs current
```

For the old model comparison, export the pre-change `spamModelStore.js` to an absolute module path, resolve its relative service imports to the checkout's service directory, and pass `baseline /absolute/path/to/exported-module.mjs`. The baseline image-reference phase deliberately reproduces the old sliced-string Map; the current phase uses the production cache and string-copy utility. Run each mode in a separate process.

The comparison below ran inside a built backend image (Node 22.23.4 Alpine), with network disabled, a 512 MiB container limit and one CPU. The build used the repository Dockerfile with the session CA supplied temporarily to npm as a build secret. It did not alter the production Dockerfile or embed credentials. Four rounds each loaded 20 distinct users with 6,000 vocabulary entries. Explicit GC precedes samples; clock advancement and captured expiry callbacks accelerate idle expiry, so this is a module retention regression workload, not a real-time IMAP soak test.

| Measurement | Before | After |
| --- | ---: | ---: |
| Heap after fourth user round | 85.64 MiB | 35.88 MiB |
| Heap after idle expiry and GC | 85.64 MiB | 5.39 MiB |
| 25 concurrent cold reads: queries / distinct model objects | 25 / 25 | 1 / 1 |
| Additional heap for URL references from forty 2 MiB HTML strings | 80.05 MiB | 2.06 MiB |
| RSS after idle expiry and GC | 165.03 MiB | 100.71 MiB |

The fixed process began at approximately 63 MiB RSS. Its RSS stayed above that after objects were freed: V8 and native allocators may retain freed pages. RSS alone cannot distinguish this from live heap growth. Avatar pressure is covered separately by a route regression using 34 synthetic 512 KiB images and verifying eviction/refetch.

## Production follow-up

Compare backend and frontend separately with `docker stats --no-stream`, then observe trends across similar workloads and idle periods. Record the image tag, uptime, account count and any restarts/OOMKilled state. If growth continues after updating, collect process RSS and JavaScript heap/external-memory measurements over time before attributing the remainder to IMAP, nginx or cache retention. No production heap dump or mailbox data is required by this benchmark.
