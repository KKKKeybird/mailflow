# MailFlow fork maintenance

## Ownership and baseline

Repository: `KKKKeybird/mailflow`; maintained branch: `main`; upstream: `maathimself/mailflow`.
Current upstream baseline: `v4.0.5`. Sender grouping comes from `feat/sender-grouping-performance` at `84be8b0` (including indexed live-query optimizations), not the older grouping branch or design experiments. Other feature branches are not part of this fork's maintained scope.

## Sync policy

Follow ani-rss-openlist's current manual policy. Sync only when the owner requests it, against a selected stable upstream release. Do not schedule polling, automatic sync PRs or automatic merges. Never use GitHub's reset/sync-fork action to overwrite `main`, and never force-push the maintained branch.

Fetch upstream without pushing its tags, create a maintenance branch from the latest fork main, then merge the selected upstream tag using a merge commit. Resolve conflicts by preserving both sender grouping and the upstream feature. Inspect automatically merged code as well as explicit conflicts. Update this baseline, README, benchmark default ref and the CI baseline tag after validation. Open a PR to this fork and merge only after checks pass; retain merge ancestry so later upstream merges can reuse it.

```sh
git remote add upstream https://github.com/maathimself/mailflow.git # once
git fetch origin main
git fetch upstream
git switch -c sync/upstream-vX.Y.Z origin/main
git merge --no-ff vX.Y.Z
```

## Required verification

Use Node 22 and run the CI commands in `.github/workflows/ci.yml`: backend lint, plugin boundary, syntax, tests and production dependency audit; frontend lint, build, tests and production dependency audit. The frontend checks must include sender preferences, sender row-tree navigation, expand/collapse, deletion/undo and conversation controls, alongside upstream list regressions.

Run the actual endpoint validation in `docs/sender-grouping.md` against a dedicated disposable PostgreSQL database. Set `BENCH_BASE_REF` to the selected upstream release, never fork `origin/main`: the baseline must have grouping disabled. Verify full pagination, counts, expanded members, unread/category filters and conversation mode. Preserve SQL account/user isolation and existing request-generation guards.

Run all migrations on an empty database and again on the same database. Both sender indexes use `CREATE INDEX CONCURRENTLY` and require the `-- no-transaction` marker. Migration identity is the complete filename without `.sql`, not the numeric prefix: existing `0063_normalized_sender_index` and `0064_sender_thread_source_index` remain unchanged even when upstream adds different files with the same numeric prefixes. Renaming applied migrations would rerun them. Audit future collisions by full filename and SQL dependencies.

## Publishing

Publishing is separate from syncing and starts only when the owner requests a chosen version. Use **Actions → Release → Run workflow**, select `main`, and enter a fork version such as `v3.9.0-r4`. Alternatively, `./scripts/release.sh v3.9.0-r4` dispatches the same workflow from a clean checkout matching remote main and returns immediately. It does not bump upstream package versions or manually upload files. Pushing an explicitly chosen fork tag also triggers the pipeline.

The Release workflow validates the version and main ancestry, runs the reusable CI workflow, creates the exact tag and a draft release with GitHub-generated notes, then builds versioned backend/frontend images and calls the native app workflow. Tags created with `GITHUB_TOKEN` do not recursively trigger another run. Both images support amd64/arm64. Before publication, Actions verifies both architecture indexes and all six desktop assets, promotes both image `latest` tags, verifies their manifests against the version tags, and publishes the GitHub Release as latest. Releases run serially; version checks reject older versions and published-tag reuse.

A failed build keeps the release as a draft and prevents the publication job from running. Use **Re-run failed jobs** on the same run to resume at its pinned commit; do not create a replacement tag or overwrite a published release. Android is included when the fork's signing secrets exist; when they are absent, the six desktop installers remain required. `Publish Apps` manual dispatch remains available to repair assets for an existing release, but normal releases use the single Release workflow.

The assistant's normal publishing role is to dispatch the requested version and report the workflow link. Actions handles builds, uploads, notes, verification and latest updates; the assistant does not watch or manually manage each release. Investigate failures only when requested. Never push all fetched upstream tags.

Compose, server update checks, Electron/Android update URLs and issue links must continue pointing at this fork after upstream merges. Upstream sponsorship automation is guarded to run only in the upstream repository.

## First integration: v3.9.0

Resolved preferences SQL parameter conflicts while retaining both `autoOpenReplyDrafts` and `groupedSenders`; retained both sets of list-render regressions. Added missing nontransactional markers to sender index migrations. Updated benchmark baseline to `v3.9.0`, release/deployment namespaces and native updater URLs for independent fork maintenance.


## Validation record (2026-10-10)

Node 22.23.3 and PostgreSQL 16: backend lint, plugin boundary and syntax checks passed; 2,396 backend tests passed (the upstream suite's 15 optional tests skipped). The preference-conflict regression passed separately with all 16 preferences tests. Frontend lint and production build passed; all 2,775 frontend tests passed, including sender expansion, list navigation, delete/undo, upstream move-picker and reply-draft regressions. Production dependency audits passed the repository's high-severity threshold; existing moderate advisories remain upstream dependencies.

All 67 migrations applied successfully on an empty database, and a second migration run reported the schema up to date. The real mail-list endpoint validation passed with 84,000 fixture messages: flat/threaded views, unread/category combinations, complete paging and sender expansion, NULL-date heads, absent selected senders and the grouping-off baseline. Benchmark fixtures now include upstream's thread references and last-seen columns.

If a release fails because its workflow needs a fix, merge the workflow fix on main and dispatch the same unpublished version again. Release resolves an existing draft to its original tag commit and validates/builds that exact commit with the repaired workflow. It does not move the tag. Without a draft, a tag pointing to another commit is rejected; published releases are never overwritten. The draft discovery and desktop setup jobs need contents: write because GitHub hides drafts from read-only tokens.

Manual Publish Apps repairs preserve whether the existing release is a draft; attaching assets must not publish an unfinished draft.

## Integration: v4.0.1 (2026-10-16)

Merged the selected upstream tag with ancestry preserved. Preference updates retain both sender grouping fields and upstream's `afterRemove` / `darkEmailBodies`; account updates retain both the new icon and mailbox proxy settings. List selection and removal use upstream's deep-link cleanup and after-remove preference while retaining sender row identities. The app-language date formatter keeps the fork's zero-hour midnight display. Android retains the fork's browser chooser and updater URL alongside upstream's local setup page and host-switch fixes.

The live endpoint baseline and CI now use `v4.0.1`. Baseline modules resolve their relative imports against the backend source tree; the disposable fixture includes the flags, folder-role metadata and account mappings required by upstream's draft-aware conversation counts. All 72 migrations applied on an empty PostgreSQL 16 database and a second run made no changes. Production dependency audits meet the high-severity threshold; existing moderate upstream dependency advisories remain.

## Integration: v4.0.2 (2026-10-19)

Merged the stable upstream tag with ancestry preserved. Android OIDC login/logout uses upstream's embedded provider window while ordinary external web links retain the fork's complete browser picker, including Edge. The merged mail paths retain proxy-side target DNS, certificate-verified Gmail proxy recovery, sender identities and account isolation, and scoped read-only-by-default MCP tokens. Upstream's CardDAV merge fixes, conversation attachments, reading-pane refitting, Gmail Sent deduplication and OAuth relinking are included.

The live endpoint benchmark and CI baseline now use `v4.0.2`. No migration was renamed or added by this integration. All 72 migrations applied on a fresh PostgreSQL 16 database and the second run reported the schema up to date. Proxy documentation now matches the existing implementation: mailbox domains are passed to the proxy for resolution. Production dependency audits pass `--audit-level=high`; moderate upstream dependency advisories remain.


## Integration: v4.0.4 (2026-10-22)

Merged stable v4.0.4 with ancestry preserved, including v4.0.3. Retained sender identity grouping, its separate list and shared 160px swipe limit, the borderless mark-all-read toolbar button, pending spam-move guards, model-first spam decisions, complete proxy account context and scoped MCP access. Upstream image repair and per-user AI access are integrated alongside these features.

Upstream migrations `0067_users_ai_enabled` and `0068_split_same_sender_subject_threads` keep their full filenames; existing fork migrations with the same number prefixes are unchanged. Conversation splitting changes thread membership for unrelated same-subject receipts/alerts, independently of the opt-in sender grouping preference. Existing cached image bodies may be fetched once again when opened. The endpoint benchmark and CI baseline use v4.0.4. Database-backed regression tests also cover the upstream split and AI-access migrations. Android validation now also runs when frontend package metadata changes.

Validation for this integration used Node 22 and an isolated PostgreSQL 16 instance: all 74 migrations applied to an empty database and reran without changes; an existing 72-migration fork schema applied only the two new upstream migrations and reran without changes. All 610 selected backend and real-database regression tests passed, as did the 84,000-message endpoint comparison against v4.0.4 with the additional identity, alias and account-isolation fixtures. Backend lint, plugin boundary, syntax, frontend lint and production build passed. The complete frontend suite passed all 3,427 tests locally; the backend CI suite passed 3,027 tests, with database-only cases also exercised in the PostgreSQL job. Production dependency audits passed the high-severity threshold; existing moderate upstream advisories remain.


## Integration: v4.0.5 (2026-10-24)

Merged the stable upstream tag with ancestry preserved. Account creation retains proxy fields alongside upstream's OAuth-owned server/token restrictions; reconnect passes the full account to the engine. The new provider chooser and admin Email providers settings coexist with the MCP Apps settings, proxy connection tests and Android browser chooser. GTD move-picker sections and inbox indicators coexist with sender grouping, shared swipe limits and the borderless mark-all-read control. The model-first spam policy and pending move guards remain intact.

Keep the complete names of new `0069_email_accounts_oauth_client` and `0070_email_accounts_sync_error_code` migrations, alongside the existing `0069_mcp_tokens`. The upstream baseline for live endpoint checks is v4.0.5. Database regressions include route, service and utility PostgreSQL tests. Dependency updates retain the MCP SDK and the IMAP proxy postinstall patch. For a custom reverse proxy, allow at least 60 seconds for `/oauth/` requests as documented upstream.

Local validation: all 76 migrations applied on an empty PostgreSQL 16 database and repeated without changes; 64 database-backed regression tests and the 84,000-message endpoint comparison against v4.0.5 passed. The complete backend suite passed 3,300 tests before the final dependency refresh. Selected frontend interaction and locale tests passed 2,005 tests; an additional signed-in account proxy render regression also passed. Fix the MCP SDK's compatible transitive `body-parser` and `fast-uri` resolutions beyond upstream's dependency updates: the backend production audit then reports no vulnerabilities. The frontend audit passes the high-severity threshold with moderate React Router advisories; avoid a forced major router upgrade in this integration.
