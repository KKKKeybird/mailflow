# Sender grouping endpoint results

Baseline: `462eb84a289a0595e94cfaeda4b698f023b64b28`. PostgreSQL 17.11, Node 22, local macOS. Approximately 84,000 synthetic mails, six grouped senders, page size 50. Actual HTTP mail route with fixture-session authorization and no external IMAP connection.

Warm buffers: two warm-ups, ten measurements. All values are milliseconds. Grouping results are computed live, so grouping-on is expected to cost more than main; the unchanged grouping-off path is also included.

| Density | Mode | Offset | Main p50 / p95 | Revision off p50 / p95 | Revision on p50 / p95 |
|---|---|---:|---:|---:|---:|
| 90% | Flat | 0 | 2.1 / 2.8 | 1.0 / 1.1 | 19.5 / 20.9 |
| 90% | Flat | 1000 | 1.7 / 1.8 | 1.6 / 2.1 | 23.1 / 24.2 |
| 90% | Threaded | 0 | 39.0 / 40.9 | 39.6 / 40.7 | 122.4 / 235.6 |
| 90% | Threaded | 1000 | 40.1 / 42.9 | 41.4 / 47.5 | 123.1 / 132.5 |
| 99.9% | Flat | 0 | 1.1 / 1.2 | 0.9 / 1.1 | 40.2 / 42.8 |
| 99.9% | Flat | 1000 | 1.6 / 1.8 | 1.6 / 1.8 | 49.6 / 51.5 |
| 99.9% | Threaded | 0 | 41.1 / 42.4 | 40.7 / 43.2 | 122.2 / 124.2 |
| 99.9% | Threaded | 1000 | 41.4 / 52.7 | 42.9 / 45.1 | 121.9 / 124.4 |

The offset-1000 grouped dense-inbox cases can return an empty page because the folded list is shorter than 1,000 rows. Totals still describe the complete folded scope.

First reads after separate PostgreSQL restarts, with OS caches not flushed. These are single samples on the dense fixture, not percentiles:

| Mode | Main off | Revision on |
|---|---:|---:|
| Flat | 52.8 | 322.2 |
| Threaded | 117.8 | 458.9 |

First reads remain slower than the warmed path. Earlier exploratory samples with a concurrently starting preview were slower still (up to about 1 second); the table uses the final isolated readings. No guarantee of constant-time dense-inbox access or NAS latency is claimed.

Correctness: eight complete pagination/expansion scenarios passed against main-derived flat/conversation rows, including unread/category filters. The validation fixture also covered mixed-sender replies, within-account deduplication, cross-account delivery copies, tied dates, normalized sender variants, unified-inbox opt-outs and owner isolation.
