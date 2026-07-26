# Diaspora Production Release Runbook

> **Authorization required before ANY step in Part B.** Production Supabase `vhmnajoeicasaigiophh`
> must not be touched until the user grants explicit release authorization (EB-5). This runbook is
> prepared in advance; it is not an instruction to release. Staging project: `eoyenigwevnxwwhyhaer`.

## Part A — Pre-release (no production access)

1. **Dependency state.** PR #81 merged to `main` OR formally accepted as reviewed dependency.
   Program PR retargeted to `main`, rebased, no unrelated files changed (diff stays diaspora-scoped).
2. **CI green (independent).** `backend-and-build`, `playwright`, route validation, build all PASSED
   on the program PR head. Record run IDs in the progress ledger.
3. **Staging integration PASSED.** With `DIASPORA_STAGING_DATABASE_URL` set, the H9 concurrency tests
   (stock, quote acceptance, container approval) and SafeTrade/graph integration tests run against
   `eoyenigwevnxwwhyhaer` and PASS. Record run ID + the four H9 sub-results explicitly.
4. **Security gate (§76) closed.** Credential incident CR-1 closed (rotated, history remediated,
   scanning expanded); advisors reviewed; RLS/RPC grants verified; rate limits + upload security +
   adversarial review done; no unresolved high-severity finding.
5. **Migration plan reviewed (§77).** Ordered, additive/backwards-compatible list with down/
   remediation notes; reconciliation + post-migration verification queries prepared; test data
   (seeds, QA accounts) confirmed excluded from production.
6. **Backup + restore rehearsal completed** on a staging clone.
7. **Feature flags set to safe defaults** (all high-risk external actions OFF; see readiness matrix §81).
8. **Provider matrix (§78) recorded:** each provider sandbox/live state, disable switch, owner.

## Part B — Production release (ONLY after EB-5 authorization)

> Each step is gated; stop and report on any failed gate. Use `apply_migration` only against the
> authorized project after authorization. Capture every command's output as evidence.

1. **Snapshot / backup** production immediately before migration; confirm restorable.
2. **Apply migrations in recorded order** to production. Run advisors; confirm no new high-severity.
3. **Reconciliation queries** vs expected post-migration state; abort+rollback on mismatch.
4. **Deploy backend + web** (Vercel projects `carup`, `carup-backend`).
5. **Production smoke tests (§82)** with synthetic accounts; verify high-risk providers disabled/
   sandbox as approved; clean up synthetic data.
6. **Monitored rollout.** Watch logs, error tracking, audit monitoring, webhook + reconciliation
   alerts, graph projection lag, Drive/quota anomalies (see observability gate §79).
7. **Enable feature flags incrementally** only as each is validated; keep real-money + live Drive +
   live billing OFF until their own EB approvals.
8. **Close-out.** Record release evidence in the progress ledger; update readiness matrix.

## Trade Graph projection activation (Phase 10) — operational steps
The Trade Graph is a **derived, rebuildable** projection; relational tables remain authoritative.
Activation order (all gated by `DIASPORA_TRADE_GRAPH`, default OFF):
1. Apply migration `20260621140000_diaspora_phase10_trade_graph.sql` to staging first; run advisors;
   confirm RLS/grants and that SQL parameter binding + SAVEPOINT semantics behave on **real Postgres**
   (closes risk **TG-1** — the in-memory mock only models these behaviorally).
2. Provision a service-role `pg.Pool` **dead-letter sink** (separate connection) so a poisoned event's
   dead-letter survives a batch rollback (risk **TG-2**). Choose the projection driver: the supported,
   self-contained `projectPendingEvents` (owns `event.id`); if using the eventWorker subscriber, the
   integrator must forward the `domain_events` record (else it fails loud).
3. Backfill: run an admin-only, rate-limited `rebuildTenantGraph` per tenant to populate from
   authoritative tables/events; verify node/edge counts and a few `entities/:id/path` answers.
4. Flip `DIASPORA_TRADE_GRAPH` on for staging; monitor projection lag, dead-letter count, and rebuild
   status. Only then consider production (under EB-5).
AI-ready reads expose **redacted** context only (PII tokenized/redacted, participant ids pseudonymized);
do not enable AI graph insights (`DIASPORA_AI_GRAPH_INSIGHTS`) until redaction is re-verified on prod data.

## Final Completion Loop additions (2026-07-04)

- **Migration `20260704090000_diaspora_payment_milestone_idempotency.sql` (ledger #16)** is purely
  **additive** (one nullable column + one partial unique index on `diaspora_payment_milestones`) with a
  clean `-- +migrate Down`. Apply in recorded ledger order — staging first (EB-1,
  `eoyenigwevnxwwhyhaer`), then production (EB-5). No data backfill, no downtime, no feature flag.
- **No other migration** was added by this loop — W4 (DB-sourced XLSX export) and W5a (atomic workbook
  draft execution via compensating rollback) are **pure code**, no schema change.
- **Rollback:** all Final Completion changes are code-level or additive-migration; `migrate.js --rollback`
  reverses #16 in a transaction. The workbook draft executor's own compensating rollback (REC-1) needs no
  operator action — it self-heals a failed draft run to zero partial state.

## Promotion order (§80)
local/test → CI → staging DB → staging FE/BE → closed pilot → production migration → production
deploy → smoke → monitored rollout → rollback if any gate fails (see rollback runbook).

## Approvals required (must all be explicit)
EB-1 staging secret · EB-2 Drive OAuth+vault (only if enabling live Drive) · EB-3 live billing ·
EB-4 real-money SafeTrade + legal · **EB-5 production migration/deploy** · CR-1 credential closure.

## Owner-controlled merge plan (prepared 2026-07-26 — DO NOT execute without owner authorization)

**Release candidate:** PR #90 head `300528a` (branch `claude/diaspora-phases-8-10-production-program`,
base = `claude/diaspora-phases-3-7-program`). **Depends on** PR #81 head `bbcf421` (base `main`).
Both draft + MERGEABLE, 0 unresolved review threads, CI green. Do NOT merge, retarget, rebase, squash or
force-push without explicit owner authorization.

### A. PR #81 (Diaspora Phases 3–7) → main — merge FIRST
- **Final head:** `bbcf421`; **base:** `main` (`d7ce28b`).
- **Diff vs main:** 74 files (diaspora phases 3–7 + referral + the diaspora wiring in `web/src/App.tsx`,
  `useCarUpApi.ts`, `types/index.ts`, `featureRegistry.ts`, `shared/navigation/feature-manifest.json`,
  `backend/env.example`). No unrelated files.
- **CI:** Lint·Types·Build·Tests ✅, Secret scan ✅, Dependency audit ✅, all 4 Vercel deploys ✅.
- **Review:** resolve/approve per policy (reviewDecision currently empty → needs owner approval).
- **Merge method:** **merge commit** (preserve history; no squash/rebase per freeze constraints).
- **Rollback point:** `main@d7ce28b` (revert the merge commit if needed).
- **Post-merge verification:** `git fetch && git checkout main && npm ci && npm run build`; backend
  `node --test backend/tests/diaspora-*.test.js`; confirm Vercel production build green; do NOT deploy
  production Supabase migrations yet (EB-5 / CR-1).

### B. PR #90 (Phases 8–10 + gap closure) — AFTER PR #81 merges
- **Expected new base:** `main` (once PR #81 is in main). **Retargeting alone is sufficient IF** GitHub
  shows PR #90 MERGEABLE against main after PR #81 merges (the branch already contains PR #81's commits as
  ancestors, so the delta is only the phase 8–10 + gap-closure commits).
- **If GitHub reports conflicts:** a **non-destructive rebase** onto `main` is required — but only with
  owner authorization; expected conflict files are the shared wiring touched by both PRs
  (`web/src/App.tsx`, `web/src/hooks/useCarUpApi.ts`, `web/src/types/index.ts`,
  `shared/navigation/feature-manifest.json`). Resolve by keeping BOTH PRs' additive entries (union), never
  dropping either side's routes/hooks/types.
- **No unrelated-work loss:** PR #90's diff over PR #81 is exclusively diaspora phase 8–10 migrations,
  services, the seller merchandising editor, the realpg + staging test harnesses, and docs — verify with
  `git diff bbcf421...300528a --name-only` before retarget.
- **CI + staging rerun after retarget/rebase:** re-run the Diaspora Phases 3-7 Validation gate; re-run the
  deployed-browser suite against the redeployed aliased staging with `STAGING_EXPECTED_BUNDLE` pinned to
  the new bundle (must stay 42/0/0).
- **Production migration ordering (EB-5, separate authorization):** apply ledger **#11 → #18 in order** to
  production Supabase (`vhmnajoeicasaigiophh`) via the official mechanism BEFORE promoting the PR #90
  frontend/backend. **BLOCKED by CR-1** (hardcoded prod-ref + `postgres://` URIs in tracked files) and by
  staging DB password rotation — both must close first.
- **Rollback point:** `main` prior to the PR #90 merge; production migrations #11–#18 have no destructive
  down (restore-from-backup posture — see the rollback runbook).

## Canonical staging promotion record (2026-07-26)

RC application SHA `91645006f4d3d025ad62a8bcede0aab2cb1175af` (tag `rc/diaspora-9164500`) promoted to the
**staging** Vercel projects' production target (NOT the `carup`/`carup-backend` production projects):
- Frontend `carup-staging.vercel.app` — `dpl_4KyUxUD8R3GENj4jqGHcJq3QbCDr`, bundle `index-yYPmJ_bE.js`,
  built with `VITE_API_URL=https://carup-backend-staging.vercel.app/api` (0 production-backend refs).
- Backend `carup-backend-staging.vercel.app` — `dpl_E9LERYkM8Md9fhFUTvPEKbjmke3n`, `/api/health` UP,
  Supabase `eoyenigwevnxwwhyhaer`.
Canonical deployed Chromium UAT (both viewports, acceptance mode): **42/0/0/0**. Production untouched;
CR-1 OPEN. Owner merge of PR #90 is the next gate (`APPROVE MERGE PR #90`); production cutover (EB-5) and
CR-1 history rewrite remain separately unauthorized.
