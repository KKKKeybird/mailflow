# Sender grouping design experiments

These are standalone design experiments for issue #529. They do not change MailFlow's runtime, migrations, Docker image or dependencies. No production integration or benchmark against MailFlow's full thread semantics is claimed. [Design and limitations](DESIGN.md).

The current branch starts from upstream `81c24a9`, excluding the closed PR #530 implementation.

## Interaction proof

Open `demo.html` directly in a browser. It is self-contained and uses synthetic messages. Desktop and mobile layouts use the same controller. No mail server connection or credentials are involved.

With Node 22+ and the repository's frontend dependencies installed:

```sh
node --test experiments/sender-grouping-v2/flow/*.test.mjs
```

Regenerate the demo after editing the controller/UI:

```sh
python3 experiments/sender-grouping-v2/flow/build-demo.py
```

The fixture is fully loaded. Production member pagination, remote preference preparation, authorization, concurrency and IMAP actions remain outside this demo. Archive/delete both simulate removing mail from the current view; no permanent deletion is performed.

## SQL proof

Use a **dedicated disposable PostgreSQL database**. `native-probe.mjs` drops and recreates only the `grouping_probe` schema inside the selected database. It contains 84,000 generated mails and a simplified three-message conversation model. Requires the existing backend `pg` dependency; no new package is added.

Set `PGHOST`, `PGPORT`, `PGUSER` and `PGDATABASE` for that disposable instance, then run from any directory:

```sh
node experiments/sender-grouping-v2/native-probe.mjs
node experiments/sender-grouping-v2/incremental-probe.mjs
node experiments/sender-grouping-v2/persistence-probe.mjs
# Restart that dedicated instance; do not rebuild the schema.
node experiments/sender-grouping-v2/persistence-probe.mjs --after
```

The native probe validates stable tied-date pagination across the complete result and compares compact projection rows/counters to an independent source-derived calculation. It records EXPLAIN ANALYZE plans and 10 warm samples after 2 warm-ups. Build time is one sample, not a percentile. Deep-page, member-page and first-page plans are included.

The incremental probe transactionally replaces only changed flat/conversation leaves, applies old/new counter deltas, and replaces affected latest heads using their sender index. It checks source-derived counts and representatives after every operation, including creation/removal of an otherwise empty group and repeated notifications. It deliberately uses serial writes. View-level locking, journal/snapshot races, deduplication, filters, multi-user/account isolation and sync-engine coverage require production integration tests before a PR.

Recorded results are microbenchmarks on local native PostgreSQL 17.11. They are not measurements of the full MailFlow endpoint, body/contact hydration, network or NAS. The source-page baseline is flat; the thread projection has no equivalent real MailFlow baseline here.

A database restart test compares persisted outer-row count/ID/count/unread checksums. `persistence-results.json` records whether stored results survive without rebuilding.
