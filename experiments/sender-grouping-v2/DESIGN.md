Thanks for testing #530 and explaining both the performance and interaction failures. I worked through a second design locally, using synthetic data rather than my live inbox. I would like to discuss this before opening another PR.

**Proposed direction: persist the grouped list result and update affected rows incrementally.** Build it once when grouping is enabled; subsequent page requests read indexed stored rows. New mail, flag changes, deletion/moves and grouping preference changes update affected memberships, heads and counters. Existing unchanged mail is not regrouped on every request.

### Why persistence rather than only the indexed candidate query

I prototyped your suggested ordinary-page + one-head-per-sender approach with a normalized sender B-tree. It matches a separate full grouping reference, and is inexpensive with six senders covering 90% of the inbox. However, the ordinary branch's `NOT IN` can still scan a large portion of the mailbox when almost all mail belongs to grouped senders. `LIMIT 50` limits returned rows, not work performed.

On native PostgreSQL 17.11, 84,000 synthetic messages, six grouped senders, page size 50, the latest run measured the following warm SQL execution times (10 measured runs after two warm-ups; these are a microbenchmark, **not MailFlow endpoint or NAS latency**):

| Query | 90% grouped, p50 / p95 ms | 99.9% grouped, p50 / p95 ms |
|---|---:|---:|
| Ordinary flat source page | 0.011 / 0.037 | 0.010 / 0.195 |
| Ordinary candidates + indexed sender heads | 0.132 / 0.347 | 24.408 / 52.938 |
| Persisted outer flat page | 0.010 / 0.011 | 0.015 / 0.046 |
| Persisted outer thread page | 0.010 / 0.029 | 0.009 / 0.030 |

The persisted thread test uses a **simplified synthetic conversation model**, not MailFlow's current thread deduplication/filter semantics. Its timing demonstrates the indexed read shape; it does not establish that a production threaded endpoint is as fast as the current baseline. Both modes' complete cursor walks matched an independent source-derived reference, including date ties, counts and representatives. Group-member and deep-page queries use their own indexes.

The cost has moved, not disappeared: building both projections plus indexes took 1.10 s and 0.93 s in this run. Earlier runs were faster; these are single build samples, not build percentiles. Preparation must be explicit and outside the inbox request path. A PostgreSQL restart preserved the stored result and checksums without a rebuild.

### Storage and lifecycle

- Keep the ungrouped path unchanged. For grouping, a per-user view descriptor includes authorized account scope, folder, filters, conversation mode, preference revision and semantics version.
- Store compact list leaves (message or conversation identity, representative ID, normalized sender, sort key and counts), plus outer rows (ordinary leaves and one head per non-empty grouped sender). Fetch full mail metadata only for the selected page. Do not duplicate message bodies.
- Index outer rows by `(view_id, date DESC, row_key DESC)` and members by `(view_id, group_key, date DESC, row_key DESC)`. Counts and outer row totals are stored, not computed with a mailbox-wide COUNT/WINDOW on each read. Message count and folded list-row count are separate.
- Enable flow: save a **pending** preference, prepare the persisted view in the background, then publish it atomically and activate grouping. Keep the ordinary inbox usable during preparation. A failed build shows retry/cancel; no silently empty inbox and no fake zero counts. Cancel grouping returns to the ordinary list immediately.
- An initial consistent snapshot needs a durable dirty-key journal for changes committed during preparation. Replay affected keys from current source rows and atomically publish only after catch-up. Do not use `MAX(sequence)` as a commit watermark: transactions can commit out of order.
- For active views, serialize updates per view (or equivalently lock affected rows in deterministic order). Compare old/new leaves; apply counter deltas and use an indexed `LIMIT 1` to replace a group's latest member. Remove empty heads. No rescan of every member merely to sum counts after one flag change.
- New mail affects its leaf/group; an existing conversation reply may affect that conversation's representative and sender classification. Delete, move, restore, flags, category changes and account-scope changes are equally relevant. “Only new mail” is insufficient for correct counts.
- Repeated dirty-key notifications reread current source state, rather than replaying arithmetic deltas from potentially duplicated/out-of-order event payloads. A background reconciliation/repair path handles missed writes and semantics upgrades. A repair rebuild is exceptional, not a normal page request.
- Persist completed projections across process/container restarts. Bound the number of prepared filter views and evict unused ones. New filter scopes may need preparation; do not promise free first access to every arbitrary filter combination.
- An opaque cursor contains scope/semantics revision and the last stable sort key. Sender heads are globally resolved stored rows before cursor filtering; they cannot reappear on later pages. Changed membership invalidates the old cursor or triggers an explicit refreshed snapshot, rather than silently mixing revisions.

The local incremental prototype verified eleven source changes against an independent full calculation after every transaction: flags, deletion of a representative/whole conversation, restore, sender changes, arrival, transaction rollback, creation/removal of an empty group, and an idempotent repeated notification. After fixing queries that omitted the leading part of a composite index, measured handler durations were 1.38–20.72 ms. These are serial prototype operations, not proof of production concurrency or complete sync-event coverage.

### One interaction model for all list actions

- Give controls and mail distinct identities: `sender:<address>`, `thread:<key>`, `message:<id>` and a distinct expanded-child row key. A group head never borrows a real message ID. A conversation head and its representative child can show the same mail while retaining different operation scopes.
- Derive `visibleRows` and `actionableRows` from one normalized tree. Navigation, j/k, Enter, Delete/archive/read shortcuts, range selection, toolbar actions, the reading pane and next-selection-after-removal all use that tree. Sender heads are controls and are excluded from mail action targets.
- Expanding loads the first member page; load more is explicit. Hidden/unloaded members are excluded from select-all. No implicit “delete the entire sender” action.
- A thread-row action follows existing conversation scope; an expanded message action targets only that message. Resolve IDs on the server under the authenticated scope, not from a head's representative alone.
- Collapse preserves the currently open reader. Subsequent next/previous navigation resumes at the group's position and skips hidden members. Delete/archiving chooses the next surviving visible actionable row, or the preceding row at the end.
- Optimistic operations overlay a versioned server snapshot. Counters, membership and selection update together. Failure restores that operation without overwriting concurrent arrivals or stealing a newer user selection. Overlapping operations on the same entities wait; unrelated operations can proceed. Late responses from previous filters/revisions are discarded.
- Mark-all-read captures its server-side scope at execution; mail arriving afterward stays unread. This includes collapsed/unloaded groups. Never derive complete group counters solely from the currently loaded member page.
- Use the existing row menu for “Group this sender” / “Ungroup”, with an explicit group header and unread count. Do not repeat large ungroup buttons on every member. Phone flow is inbox → reading page → return to the same expanded group; reading actions and undo remain reachable in both views.

I implemented a separate interaction controller and a responsive, runnable local demo. **16 tests pass**, including real DOM keyboard/click sequences, member delete → next selection, concurrent arrival → undo, collapse navigation, range/select-all scope, read-all and late-response rejection. I also checked desktop and a 390 px mobile viewport in a browser; a second iteration moved undo out of the hidden mobile list and added reader actions. A regression mutation that excluded expanded group members made six controller tests fail; restoring the controller passed. This is an interaction proof, not a React/store integration or a complete end-to-end MailFlow test suite.

The opt-in sender interaction draws on [Spark's sender grouping](https://sparkmailapp.com/help/manage-your-inbox/group-emails-by-sender). Separating ordered list membership/state from entity hydration draws on the [JMAP client model](https://jmap.io/client.html); this proposal does not change MailFlow's mail protocol.

### Scope before another PR

The persistence approach adds write/storage complexity. I would like your view on whether that fits the project, or whether you prefer the smaller indexed candidate approach with a documented dense-inbox limitation. If persistence fits, the next implementation must preserve MailFlow's exact deduplication, mixed-sender conversation, unread/category and unified-account semantics; cover every source write path, concurrency/build races and owner isolation; and pass the existing backend/frontend suites, lint and plugin-boundary checks plus endpoint-level performance tests. None of those production integration checks are claimed by the prototypes above.

Prototype source, query plans, measured results and runnable demo: https://github.com/KKKKeybird/mailflow/tree/design/sender-grouping-persistence/experiments/sender-grouping-v2
