# MailFlow fork maintenance

## Ownership and baseline

Repository: `KKKKeybird/mailflow`; maintained branch: `main`; upstream: `maathimself/mailflow`.
Current upstream baseline: `v3.9.0`. Sender grouping comes from `feat/sender-grouping-performance` at `84be8b0` (including indexed live-query optimizations), not the older grouping branch or design experiments. Other feature branches are not part of this fork's maintained scope.

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

Publishing is separate from syncing and requires an owner request. Use a fork tag `vX.Y.Z-sender.N`, with an explicitly chosen revision, pointing at the tested main commit. Do not push all fetched tags. A fork tag triggers `.github/workflows/publish.yml`, publishing multi-architecture backend/frontend images in the lowercase `kkkkeybird` GHCR namespace. Stable sender tags update `latest`; beta/RC tags do not. Create a GitHub Release at that exact tag to trigger `publish-apps.yml`; Android requires the fork's own signing secrets. Never overwrite an existing release/tag as routine maintenance.

Compose, server update checks, Electron/Android update URLs and issue links must continue pointing at this fork after upstream merges. Upstream sponsorship automation is guarded to run only in the upstream repository.

## First integration: v3.9.0

Resolved preferences SQL parameter conflicts while retaining both `autoOpenReplyDrafts` and `groupedSenders`; retained both sets of list-render regressions. Added missing nontransactional markers to sender index migrations. Updated benchmark baseline to `v3.9.0`, release/deployment namespaces and native updater URLs for independent fork maintenance.


## Validation record (2026-10-10)

Node 22.23.3 and PostgreSQL 16: backend lint, plugin boundary and syntax checks passed; 2,396 backend tests passed (the upstream suite's 15 optional tests skipped). The preference-conflict regression passed separately with all 16 preferences tests. Frontend lint and production build passed; all 2,775 frontend tests passed, including sender expansion, list navigation, delete/undo, upstream move-picker and reply-draft regressions. Production dependency audits passed the repository's high-severity threshold; existing moderate advisories remain upstream dependencies.

All 67 migrations applied successfully on an empty database, and a second migration run reported the schema up to date. The real mail-list endpoint validation passed with 84,000 fixture messages: flat/threaded views, unread/category combinations, complete paging and sender expansion, NULL-date heads, absent selected senders and the grouping-off baseline. Benchmark fixtures now include upstream's thread references and last-seen columns.
