# Sender grouping

Sender grouping is opt-in for the inbox. Choose **Group emails from this sender** from a message's existing context menu. The normalized sender preference is saved on the server; grouping results themselves are not persisted. Opening a group navigates to a separate sender list with a back button and ellipsis menu, and loads its own member pages under the same account, unread and category scope. To ungroup, right-click the group card on desktop or use its ellipsis menu on mobile; the group menu only offers ungrouping.

Sender grouping uses the trimmed From display name together with the case-insensitive email address. Names are case-sensitive; missing names form their own group. Subjects do not affect grouping. Existing address-only preferences are migrated into separate choices for the names already present in the user's inbox; new names are not automatically grouped. Sender group cards show the From name (or the email when no name is available), with the full `Name <email>` identity in the tooltip and the email in the separate list header, alongside the latest activity date. Below the sender identity they show the latest message's subject and snippet, following the ordinary message preview setting. A small outlined badge on the right shows the total message count. The unread count is not displayed; unread state still drives the dot and text emphasis. Row spacing, avatars, unread emphasis and theme/hover colors follow ordinary message rows; individual messages retain their ordinary rows in the separate sender list.

## Query and interaction design

The grouping-off path keeps main's SQL unchanged. Grouping uses compact candidate keys, an ordinary candidate page, and one latest head per grouped sender. Flat candidates use bounded per-account lateral queries before the merge. A normalized-sender covering index supports head lookup. Only the selected page is hydrated through the existing mail/conversation query; no message bodies are copied into a second view.

Counts are computed separately from the candidate page. Conversation mode first derives compact deduplicated keys and originating senders under the current filter, then hydrates only selected conversations. Filtered thread badges still count the complete inbox conversation exactly as main does. A thread belongs to its earliest matched sender, so a later reply from another address does not reassign it merely because it is newest.

`LIMIT` bounds returned candidates and metadata hydration, not all database work. Counts and conversation-key aggregation can scan the mailbox. Finding ordinary candidates can also scan many grouped rows when nearly all mail belongs to selected senders. Dense inboxes, deep offsets and first reads after a database restart therefore remain more expensive; this is the documented trade-off of the maintainer-selected indexed-query approach.

A normalized row tree gives sender controls, conversation rows and expanded messages separate keys. Sender heads are never action targets. List navigation, range/bulk selection, shortcuts, reading-pane arrows/swipes and next-selection after removal consume that tree. Conversation-row actions retain conversation scope; expanded-message actions target only that message. Select-all excludes collapsed and not-yet-loaded sender members.

Optimistic changes adjust group totals by member deltas rather than recomputing totals from a partial loaded page. Undo merges restored members with current cached members, preserving intervening arrivals. Successful mail mutations refresh the current page and expanded groups from the server. Existing request-generation guards discard responses from previous scopes. Returning to the inbox retains the reader; navigation resumes at the group's position. Expanded sender state survives a mobile list remount within the same scope.

## Reproducing endpoint validation and timings

Use Node 22 and a **dedicated disposable PostgreSQL database** whose name contains `sender_revision`. The fixtures contain approximately 84,000 generated messages and no real credentials. Do not point these scripts at a production database.

```sh
createdb mailflow_sender_revision
psql mailflow_sender_revision -f backend/benchmarks/senderGrouping.sql
psql mailflow_sender_revision -f backend/migrations/0063_normalized_sender_index.sql
psql mailflow_sender_revision -f backend/migrations/0066_sender_identity_preferences.sql
psql mailflow_sender_revision -f backend/migrations/0067_sender_identity_index.sql
DB_NAME=mailflow_sender_revision DB_HOST=localhost DB_USER="$USER" BENCH_VALIDATE=1 node backend/benchmarks/senderGrouping.mjs
DB_NAME=mailflow_sender_revision DB_HOST=localhost DB_USER="$USER" BENCH_OUTPUT=endpoint-results.json node backend/benchmarks/senderGrouping.mjs
```

Set `DB_PORT` and `DB_PASSWORD` as appropriate for the disposable database. `BENCH_BASE_REF` defaults to `v3.9.0`; fetch it first or set an exact baseline ref.

The driver mounts the **actual `/api/mail/messages` router** and calls it over HTTP. It uses a fixture session but runs normal database authorization, scope resolution, queries and JSON serialization. IMAP body prefetch is stubbed so no external mail server is contacted. The baseline implementation is read from Git and runs against the same database, route and pool. Timings cover flat/threaded mode, grouping off/on, six senders at 90%/99.9% density, and offsets 0/1000, with two warm-ups followed by ten measured requests. The grouping-on parameter is ignored by main because main has no such feature.

Validation adds mixed-sender replies, duplicate copies within/across accounts, tied latest dates, whitespace/case variants, excluded accounts and another owner's mail. It walks every page and each sender's expansion in flat/threaded mode, with unread/category combinations, comparing counts, representatives and member identities against main's source-derived reference.

For a first-read sample, restart only the disposable PostgreSQL instance before each invocation, then run with `BENCH_FIRST_READ=1`, `BENCH_IMPLEMENTATION=main|revision`, `BENCH_THREADED=true|false`, and `BENCH_GROUPING=true|false`. This measures cold **PostgreSQL buffers** with the OS cache unchanged; it is not a cold-disk/OS benchmark and one sample is not a percentile. Local measurements and limitations are recorded in `sender-grouping-results.md`.
