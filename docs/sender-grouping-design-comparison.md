# Design comparison and measurement boundaries

This feature uses live queries over `messages`, not a persisted grouped inbox. Only grouping preferences add application state. PostgreSQL maintains the two covering indexes automatically; sync, flag, delete, move and restore paths need no grouping-specific writes, journal or repair worker.

## What other clients inform

[Thunderbird's grouped view](https://github.com/mozilla/releases-comm-central/blob/master/mailnews/base/src/nsMsgGroupView.cpp) hashes headers into groups, creates dummy group rows, and responds to header flag changes and deletion. This is a transient view over its local message database. The useful design reference is a distinct group control and explicit member actions. Its local database access and long-lived in-memory view are not an equivalent performance model for a stateless MailFlow HTTP request.

[Mailspring's thread model](https://github.com/Foundry376/Mailspring-Sync/blob/master/MailSync/Models/Thread.cpp) stores thread attributes and updates counts from before/after message snapshots. Its [database documentation](https://foundry376.github.io/Mailspring/guides/Database.html) routes writes through the sync engine. This illustrates why materialized summaries can read quickly when summary maintenance is part of the core data model. Adding another such model just for this feature would require the lifecycle infrastructure the maintainer declined.

These are architectural references, not copied implementations or runtime benchmarks. Conversation threading and Thunderbird's sort grouping also differ from opt-in groups spanning unrelated subjects from selected senders. No claim that MailFlow is faster than either client is made.

## Option tradeoffs

| Design | Read work | Maintenance |
|---|---|---|
| A: full metadata/window aggregation | Scans and ranks full-scope metadata before returning a page | No separate inbox state; slow reads |
| B: indexed live aggregation | Compact candidates and exact counts, followed by metadata only for the chosen page | Native indexes and query logic; no event integration or repair job |
| C: compact persisted projection | Indexed stored page and stored counts | Build, incrementally update every relevant mutation, invalidate scopes, reconcile and repair |

C's small local prototype demonstrated fast prepared reads but not a production maintenance implementation. Its construction and serial update costs must be reported separately from read latency. This PR follows the maintainer's Option B decision.

## Optimizing B

- Check indexed sender presence first. A scope containing no selected sender uses the ordinary query.
- In flat mode, compute exact counts once. For up to 16 selected senders, use complement index intervals when selected mail is the majority; otherwise keep date-ordered bounded per-account candidates. PostgreSQL sorts interval boundaries using the index collation, and NULL senders have their own interval. More senders retain the general query rather than growing an unbounded SQL union.
- In conversation mode, inline compact deduplication and align its order with the covering source index. Up to 16 accounts have separately scoped deduplication branches, avoiding a global initial sort; larger scopes retain the general path. Normalize the originating sender after selecting the first source sender.
- Conversation heads join a shared latest-date/count summary instead of rescanning the thread source once per sender. NULL dates retain native descending-order behavior.
- Expanded sender pages share one conversation source between pagination and count, instead of executing the source twice.
- Preserve full native conversation badge counts for filtered views by summing distinct Message-ID counts per account. Cover `category` so common filtered candidate reads need not fetch full message rows.

Exact totals still require scope-wide counting; conversations still require source deduplication and aggregation. Dense complement reads visit all ordinary candidates before sorting, and OFFSET remains proportional to skipped rows. This is not a constant-time mailbox-independent algorithm.

## Which timings can be compared

The earlier approximately 0.13 ms figure timed only a simplified ordinary-candidate/one-head SQL query. It excluded exact totals, group counts, metadata hydration, native conversation semantics, authorization and HTTP serialization. It is not a complete Option B endpoint result.

The new comparison times the real `/api/mail/messages` route on the same synthetic database with main, previous B and optimized B rotated between samples. All share the same physical indexes. That isolates query changes; it also allows main to benefit from the added source index. Original timing runs on different fixtures or bloated indexes are kept separate rather than presented as a directly attributable speedup.

A native client with SQLite and an in-memory or persisted list, a prepared C read, candidate SQL and a full PostgreSQL HTTP endpoint perform different work. Compare them as designs, not as interchangeable latency numbers. See [endpoint results](sender-grouping-results.md) for the actual fixture, percentiles, filters, valid deep pages, cold-read definition and limits.
