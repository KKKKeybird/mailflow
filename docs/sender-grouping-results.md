# Indexed sender grouping: endpoint results

Code tested: `7bcac45221163003bf1bc6b48efe68fa6d0daeb0`; main: `308f216f69e45700fc121375c91483c01b69e627`; previous B: `0e4f6f2a9e0160da32578f369cb58cac95dde44e` (closed #561).

Apple A18 Pro, 8 GiB RAM, macOS 27.2; PostgreSQL 17.11, Node 22.23.3, JIT off, shared_buffers 128 MiB, work_mem 4 MiB. Database files are outside the Documents sync directory. No NAS latency claim is made.

84,000 synthetic messages, 28,000 conversations of three messages each, six selected sender addresses, 25% unread, two primary-category messages and one automated-category message per conversation. Dates are unique in timing fixtures. Relevant baseline indexes plus migrations 0063/0064 are shared by all implementations. Contacts are empty and bodies are not fetched. Two-account timings split complete conversations between two owned enabled accounts, keeping the total at 84,000.

The real `/api/mail/messages` route runs with a fixture session and real user/account authorization. External IMAP/prefetch is stubbed. Timings include response JSON parsing, not session-store lookup, TLS, a WAN or DOM rendering. Implementations rotate between rounds: two warm-ups and 30 measured requests per cell. p50/p95 use sorted sample indices 14/28. No other local test suite runs during measurement.

## Unfiltered endpoint

Values are **p50 / p95 milliseconds**. Deep offsets are valid positions near 80% of the folded list. Main uses the same numeric offset, which does not represent the same mailbox fraction or messages. At 99.9%, the threaded list has only 34 rows, so no deep page exists.

|Density|Mode / offset|Main off|Revision off|Previous B on|Optimized B on|
|---|---|---:|---:|---:|---:|
|90%|Flat / 0|1.38 / 1.90|1.28 / 1.65|21.99 / 34.87|16.46 / 17.98|
|90%|Flat / 6700|6.83 / 7.66|6.63 / 7.80|50.63 / 54.57|15.98 / 18.27|
|90%|Threaded / 0|25.43 / 30.23|25.73 / 32.01|135.58 / 163.26|82.62 / 98.69|
|90%|Threaded / 2200|26.25 / 31.60|27.16 / 37.01|136.93 / 146.53|83.21 / 92.67|
|99.9%|Flat / 0|1.25 / 1.46|1.15 / 2.30|43.44 / 50.59|15.46 / 17.54|
|99.9%|Flat / 50|1.19 / 2.73|1.07 / 1.66|56.56 / 66.96|14.86 / 16.48|
|99.9%|Threaded / 0|25.25 / 29.01|25.83 / 30.37|135.82 / 156.33|82.53 / 94.89|

The local acceptance target for the first screen was flat p50 ≤30 ms and threaded p50 ≤100 ms / p95 ≤150 ms on this fixture. The optimized unfiltered cases meet it, including valid dense deep pages. This is an explicit local budget, not a numerical SLA supplied by the maintainer and not parity with main. Exact grouping still costs more than the ungrouped path.

## Filters, expansion and unified accounts

Each table below uses the 90% full-mailbox fixture. Filtering can change the grouped coverage of the matched subset: the unread subset is approximately 93.3% grouped because sender/read allocation is correlated. Full conversation message badges include messages outside the matched filter, as on main. Main flat totals remain its native cached folder counts; grouped totals are exact folded-scope counts.

### Primary category

|Mode / offset|Main off|Revision off|Previous B on|Optimized B on|
|---|---:|---:|---:|---:|
|Flat / 0|1.14 / 1.99|1.11 / 1.82|25.53 / 27.82|15.71 / 17.94|
|Flat / 4450|5.22 / 7.57|5.01 / 7.12|50.85 / 55.37|17.37 / 19.03|
|Threaded / 0|23.86 / 25.78|24.12 / 28.92|144.69 / 150.68|78.74 / 83.53|
|Threaded / 2200|24.51 / 27.39|24.48 / 28.01|144.60 / 151.66|79.69 / 94.40|

### Unread only

|Mode / offset|Main off|Revision off|Previous B on|Optimized B on|
|---|---:|---:|---:|---:|
|Flat / 0|1.29 / 2.02|1.19 / 3.07|15.00 / 16.71|14.82 / 18.75|
|Flat / 1100|2.74 / 4.55|2.54 / 4.45|29.53 / 34.90|16.37 / 20.63|
|Threaded / 0|17.71 / 19.20|17.43 / 19.55|94.85 / 122.46|55.86 / 60.03|
|Threaded / 1100|18.68 / 25.94|18.51 / 22.87|95.05 / 105.23|56.57 / 65.85|

### Primary + unread

|Mode / offset|Main off|Revision off|Previous B on|Optimized B on|
|---|---:|---:|---:|---:|
|Flat / 0|1.31 / 1.60|1.25 / 1.42|12.68 / 17.64|15.45 / 16.91|
|Flat / 1100|2.85 / 3.37|2.49 / 3.52|24.92 / 28.56|15.11 / 17.31|
|Threaded / 0|16.30 / 19.60|16.25 / 19.41|81.96 / 86.71|44.70 / 56.11|
|Threaded / 1100|16.63 / 18.13|16.52 / 20.25|78.53 / 82.82|42.85 / 45.08|

### Expanded sender0

|Mode / offset|Main off|Revision off|Previous B on|Optimized B on|
|---|---:|---:|---:|---:|
|Flat / 0|—|—|3.12 / 4.89|2.20 / 3.29|
|Flat / 8950|—|—|3.02 / 3.89|2.67 / 4.09|
|Threaded / 0|—|—|224.49 / 255.83|71.30 / 92.77|
|Threaded / 2950|—|—|226.82 / 240.50|71.87 / 78.70|

### Two unified accounts

|Mode / offset|Main off|Revision off|Previous B on|Optimized B on|
|---|---:|---:|---:|---:|
|Flat / 0|1.26 / 2.00|1.12 / 2.42|55.54 / 59.11|14.38 / 16.26|
|Flat / 6700|6.66 / 7.42|6.50 / 8.09|75.03 / 82.83|15.14 / 18.27|
|Threaded / 0|38.24 / 40.28|38.54 / 41.99|130.47 / 139.09|81.63 / 85.05|
|Threaded / 2200|38.78 / 40.24|38.39 / 43.84|130.35 / 139.38|80.98 / 96.08|

Main has no equivalent sender expansion API, so it is not included as an expansion baseline. The previous/optimized expansion calls perform the same operation.

## Sparse coverage and very deep offsets

|Density|Mode / offset|Main off|Revision off|Previous B on|Optimized B on|
|---|---|---:|---:|---:|---:|
|0%|Flat / 0|1.07 / 1.86|1.06 / 1.48|27.77 / 29.43|1.23 / 1.71|
|0%|Flat / 67200|56.52 / 61.26|56.18 / 60.75|74.40 / 79.36|56.02 / 60.43|
|0%|Threaded / 0|25.49 / 31.47|25.54 / 30.90|134.51 / 145.73|25.96 / 31.06|
|0%|Threaded / 22400|27.55 / 30.68|27.05 / 29.39|137.05 / 147.84|27.25 / 28.57|
|1%|Flat / 0|1.01 / 1.65|1.00 / 1.81|28.78 / 31.93|7.93 / 9.20|
|1%|Flat / 66500|54.46 / 58.18|55.09 / 57.94|85.03 / 88.22|71.89 / 78.66|
|1%|Threaded / 0|25.32 / 30.03|25.43 / 30.86|133.69 / 153.00|83.69 / 91.67|
|1%|Threaded / 22150|26.66 / 29.31|27.05 / 34.38|134.26 / 147.22|83.74 / 93.25|
|50%|Flat / 0|1.03 / 1.58|1.04 / 1.44|31.07 / 34.03|10.58 / 11.86|
|50%|Flat / 33600|28.62 / 32.56|28.51 / 31.11|63.60 / 67.98|45.60 / 52.00|
|50%|Threaded / 0|25.36 / 28.49|25.40 / 30.99|136.46 / 152.60|83.71 / 89.63|
|50%|Threaded / 11200|26.94 / 31.26|27.26 / 31.68|134.41 / 139.44|82.45 / 90.92|

At 0% selected coverage the optimized path reads the ordinary inbox after an indexed presence check. At low coverage, very deep OFFSET requests still cost tens of milliseconds on main itself. They are reported rather than presented as ordinary first-screen latency. A cursor/API redesign is outside this change. More than 16 senders/accounts retain the general live query instead of constructing an unbounded union; no large >16-scope performance guarantee is claimed.

## First inbox reads after restarts

99.9% coverage, one account, no filters. Each sample follows a separate PostgreSQL restart and a fresh benchmark process. The version probe opens a connection before the timer. PostgreSQL shared buffers are reset; macOS file caches are not flushed. Three samples per cell are shown as median (min–max), **not p95**.

|Mode|Main|Previous B|Optimized B|
|---|---:|---:|---:|
|Flat|12.71 (12.18–24.43)|57.33 (56.83–62.13)|35.27 (33.70–35.72)|
|Threaded|41.01 (37.73–41.46)|129.95 (129.27–144.99)|87.24 (84.87–88.21)|

## Costs and limitations

- After reindexing the dense timing fixture, the normalized-sender index occupies 13.51 MiB and the conversation-source index 11.27 MiB. The latter is an additional native index, maintained transactionally by PostgreSQL. Covering category/flags adds storage and write amplification; an isolated production write-throughput comparison was not performed.
- Exact counts remain proportional to the scope, and conversation mode still deduplicates/aggregates source rows. No persisted membership, cached grouping result, mutation hooks, dirty-key journal or repair job was added.
- The timing fixture has short metadata, no contact photos, no fetched bodies, no concurrent users and only one/two accounts. A million-message mailbox, larger account scopes, real IMAP traffic and NAS hardware are not covered by these numbers.
- Representative date ties, mixed senders, duplicates, filtered scopes and ownership are covered by the separate validation fixture. Main does not specify a secondary key for the earliest originating sender on identical dates; this change preserves that behavior rather than redefining the ungrouped query.
- An earlier run in the Documents sync directory coincided with FileProvider using a CPU core and large baseline variance (e.g. main threaded p50 110 ms). Those raw results were retained locally as `*-noisy.json`, not mixed into these tables. Moving the synthetic cluster outside the sync directory stabilized the comparison.

## Validation

- Backend: 119 files / 2,132 tests pass; lint and plugin boundary pass. Frontend lint/build pass.
- Frontend: 2,526 tests pass with `navigator.platform="Linux"` to match Linux CI. Native macOS Node 22 exposes a Mac platform and five unchanged Ctrl-based shortcut expectations fail; no product shortcut code was changed.
- A separate ~600-message fixture walks the full folded list and every expanded sender against a main-derived reference in flat/threaded mode with unread/category combinations. It includes mixed-sender replies, within-account duplicate IDs, cross-account delivery copies, date ties, case/space variants, unified opt-outs and owner isolation. NULL-date heads, 17 selected senders and absent selected senders also pass.
- Production dependency audits currently fail on unchanged main lockfiles (backend proxy-addr/source-map-js; frontend Capacitor Android/source-map-js, among others). This PR adds no dependency or lockfile change. CI audit remains a merge blocker independently of the feature checks.

## Reproduction

Use a disposable PostgreSQL database whose name contains `sender_revision`. Create a fresh database, apply `backend/benchmarks/senderGrouping.sql`, then migrations `0063_normalized_sender_index.sql` and `0064_sender_thread_source_index.sql`. Set DB_HOST, DB_PORT, DB_NAME and DB_USER to that fixture. The benchmark updates synthetic messages and reindexes them; do not run it on live mail.

Fetch the old PR head for the comparison source:

```sh
git fetch origin pull/561/head:bench-previous-b
BENCH_BASE_REF=308f216f69e45700fc121375c91483c01b69e627 BENCH_COMPARE_REF=bench-previous-b BENCH_OUTPUT=/tmp/grouping-default.json node backend/benchmarks/senderGrouping.mjs
```

Additional parameters to that command: `BENCH_PARAMS='{"category":"primary"}'`, `BENCH_PARAMS='{"unreadOnly":true}'`, their combination, or `BENCH_PARAMS='{"sender":"sender0@example.com"}'`; `BENCH_DENSITIES=90` restricts those runs. Use `BENCH_ACCOUNTS=2` for unified scopes and `BENCH_DENSITIES=0,1,50` for sparse coverage. `BENCH_VALIDATE=1` walks the validation scenarios; use a separate fresh smaller fixture for it.

For first reads, restart PostgreSQL before each invocation, then set `BENCH_FIRST_READ=1`, `BENCH_IMPLEMENTATION=main|previous-B|revision`, `BENCH_THREADED=true|false`, and `BENCH_GROUPING=false` for main / `true` for B. Prepare the intended density first; first-read mode does not mutate it.

All measured cells are in [sender-grouping-timings.csv](sender-grouping-timings.csv). The script writes the individual samples when BENCH_OUTPUT is set. [Design comparison](sender-grouping-design-comparison.md) explains why candidate-only SQL, prepared projection reads and other native clients are not interchangeable endpoint benchmarks.
