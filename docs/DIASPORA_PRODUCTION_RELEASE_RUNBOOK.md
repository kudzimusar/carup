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

## Promotion order (§80)
local/test → CI → staging DB → staging FE/BE → closed pilot → production migration → production
deploy → smoke → monitored rollout → rollback if any gate fails (see rollback runbook).

## Approvals required (must all be explicit)
EB-1 staging secret · EB-2 Drive OAuth+vault (only if enabling live Drive) · EB-3 live billing ·
EB-4 real-money SafeTrade + legal · **EB-5 production migration/deploy** · CR-1 credential closure.
