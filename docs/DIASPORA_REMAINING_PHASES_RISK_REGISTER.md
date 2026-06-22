# Diaspora Remaining Phases — Risk Register

> Severity: **CRITICAL** (blocks production) / **HIGH** / **MED** / **LOW**.
> Status: OPEN / MITIGATING / ACCEPTED / CLOSED. Owner = responsible agent role.
> No secret values are ever reproduced in this document.

## Credential & security

| ID | Sev | Risk | Status | Owner | Mitigation / boundary |
| --- | --- | --- | --- | --- | --- |
| CR-1 | CRITICAL | Hardcoded `postgresql://…:<pw>@…` URIs and forbidden prod project ref `vhmnajoeicasaigiophh` present in tracked scripts (`backend/scripts/*`, `scripts/*`, `database/seeds/*`, some test utils); ≥6 history commits touch such blobs. | OPEN | B | **External boundary:** rotate credentials (DB owner), env-var replacement (in-program), purge history + force re-clone (needs approval). Containment started on `main` (PR #83, migrations `20260619201406`, `20260620232827`). Must close before public production (§76). |
| SEC-1 | HIGH | Frontend feature gating only (role-based); no server entitlement enforcement yet → trivial bypass once Phase 8 lands if any check stays client-side. | OPEN | B/D | Every protected op calls `diasporaEntitlementService` server-side (§31, §64). Tests prove server denial. |
| SA-1 | HIGH→CLOSED | Subscription billing MANAGEMENT endpoints (checkout/portal/change-plan/cancel) used bare `authorizeRole()` (any authenticated user) — a tenant-level financial control was open to ordinary members. | CLOSED | A | Gate S8-A: `assertCanManageSubscription` restricts management to platform-admin OR same-tenant tenant-admin; reviewers + ordinary members read-only; cross-tenant + spoofed-role denied; structured 403. 17 authz tests. UI treats hidden controls as convenience, backend authoritative (adversarial UI review confirmed). |
| SA-2 | MED→CLOSED | SafeTrade reviewer routes' `reviewerAuth` middleware included `dealer` (broader than the service `isPrivileged`); and the live-payment guard threw an untyped 500 (UI couldn't categorize "external-activation-unavailable"). | CLOSED | A | Gate S9-A audit found service authority ALL-CORRECT; tightened route middleware to drop `dealer` (now == service boundary); `assertSafeTradeProductionSafety()` throws typed 403 `EXTERNAL_ACTIVATION_REQUIRED` (money still never moves). Added server-derived available-actions projection so the UI never duplicates the transition table. 41 tests. |
| SEC-2 | HIGH | OAuth/token leakage if Drive goes live without vault. | MITIGATING | C | Tokens never persisted today (only `credential_reference`); live activation blocked until approved vault (EB-2). Redaction tests exist. |
| SEC-3 | MED | Webhook replay / spoof (billing, payment). | OPEN | D/E | Reuse HMAC + idempotency pattern from `paymentRouter.js`; signature verify + replay rejection + idempotent handling; tests required. |
| SEC-4 | MED | RLS/RPC grant regressions on new tables (broad PUBLIC grants, missing `search_path`). | OPEN | A/B | Follow `diaspora_trade_os_can_access_row` + REVOKE PUBLIC + `service_role` grants; run Supabase advisors after each staging apply. |

## Release / evidence

| ID | Sev | Risk | Status | Owner | Mitigation / boundary |
| --- | --- | --- | --- | --- | --- |
| REL-1 | HIGH | "Green-but-skipped" CI masking missing integration proof (H9). | OPEN | B | CI must mark skipped distinctly; H9 must actually run against staging (EB-1) before R0 close. |
| REL-2 | MED | PR #81 unmerged dependency; later `main` merge could drop unrelated files or conflict. | MITIGATING | A | Stacked PR targets `claude/diaspora-phases-3-7-program`; on PR #81 merge, rebase to `main`, prove no unrelated loss, retarget, rerun. |
| REL-3 | MED | Destructive/forward-only migrations applied to prod without rehearsal. | OPEN | A | Additive/backwards-compatible only; staging-first; restore rehearsal in readiness matrix; prod forbidden until EB-5. |

## Domain correctness

| ID | Sev | Risk | Status | Owner | Mitigation / boundary |
| --- | --- | --- | --- | --- | --- |
| DOM-1 | HIGH | SafeTrade releasing money/escrow on a frontend click; auto compliance/shipment/delivery/reputation. | MITIGATING | E | State machine + release policy engine; reviewer approval for high-risk; sandbox-only provider; non-negotiables enforced + tested (§50, 47 tests). Adversarial review PASSED money-safety/state-audit/tenant dims. |
| ST-1 | HIGH→CLOSED | Seller could set the buyer-only delivery-confirmation gate via `transition()`/`/commit` (CONFIRM_DELIVERY actorRoles not enforced). | CLOSED | E | Fixed: `transition()` now enforces `descriptor.actorRoles` against server-derived party role (buyer-only for CONFIRM_DELIVERY); 6 new tests prove seller rejected (403), buyer/reviewer allowed. |
| ST-2 | MED→CLOSED | Forgeable `eligible=true` release evaluation row (table granted INSERT to `authenticated`). | CLOSED | E | Fixed: REVOKE INSERT/UPDATE/DELETE on `diaspora_safetrade_release_evaluations` from `authenticated` (service_role only); RPC requires evaluation `evaluated_by` set by a privileged reviewer (`EVALUATION_NOT_REVIEWED`). |
| ST-3 | MED | Phase 9 tracked hardening to close **before EB-4 live activation**: (a) auxiliary dispute/delivery transitions audit best-effort AFTER row commit (not in-txn) on non-RPC paths; (b) high-risk release is single-actor (no maker-checker — evaluator can self-approve); (c) sandbox provider money op runs before the atomic RPC (provider state can lead DB on RPC reject); (d) webhook idempotency ledger is process-memory only (not durable across instances). | OPEN | E | Core money/status path is atomic + sandbox-only + privileged-gated, so none can leak real money today. Close each before live payment (EB-4). |
| DOM-2 | HIGH | Quota double-count or permanent consumption on failed domain op. | OPEN | D | Atomic reserve→commit/release with idempotency + rollback; tests (§35). |
| DOM-3 | MED | Workbook import overwriting stock directly / bypassing gates. | MITIGATING | C | Existing import is draft-only via ledger RPC; preserve invariant for XLSX path; tests (§17). |
| DOM-4 | MED→CLOSED | AI mutating authoritative state or graph edges directly. | CLOSED | F | Phase 10 holistic review confirmed: no graph write path from AI/frontend; edges written only by the projection service from domain events; AI reads role-redacted context only. |
| TG-1 | MED | Phase 10 **real-Postgres validation** outstanding (in-memory mock models behaviorally): SQL parameter binding (the CRITICAL `$6/$7` revocation bug the mock had masked, now fixed + a 29-query param audit), per-event SAVEPOINT/ROLLBACK-TO-SAVEPOINT rollback semantics, and `FOR UPDATE SKIP LOCKED` outbox locking. | OPEN | A/F | **Owner: Program Integrator.** Close under EB-1 staging (apply migration to `eoyenigwevnxwwhyhaer`, run advisors, exercise projection/rebuild against live PG). Code fix is the exact change real PG requires; staging is a validation step, not an expected failure. Until then the mock binds by real `$N` position so binding bugs are caught in CI. |
| TG-2 | LOW | Phase 10 durable dead-letter pool + optional eventWorker subscriber wiring are integrator steps; the supported, self-contained driver `projectPendingEvents` owns `event.id`. The worker-subscriber path fails loud (`TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID`) if a record id is absent. | OPEN | A | Wire a service-role `pg.Pool` dead-letter sink + (if used) forward the domain_events record to the subscriber when Trade Graph is activated. Feature flag `DIASPORA_TRADE_GRAPH` OFF until then. |
| DOM-5 | MED→MITIGATING | Cross-tenant leakage in new subscription/SafeTrade/graph tables. | MITIGATING | A | Phase 10 tenant-isolation adversarially verified PASS (neighbor-tenant re-assertion on every traversal JOIN; server-derived tenant; spoofed headers denied). RLS on all 7 graph tables as defense-in-depth (app-layer primary since reads use a service-role pool). |
| DOM-5 | MED | Cross-tenant leakage in new subscription/SafeTrade/graph tables. | OPEN | A | RLS + tenant scoping on every new table; explicit cross-tenant denial tests. |
| DOM-6 | MED | Duplicate subscription/audit/event systems instead of reuse. | OPEN | A | Reuse `domain_events`, `paymentRouter` pattern, audit utils; discovery flags reuse points. |

## Process / isolation

| ID | Sev | Risk | Status | Owner | Mitigation / boundary |
| --- | --- | --- | --- | --- | --- |
| PROC-1 | MED | Unrelated workstream leakage (nav WIP, stashes, `*.exit`/`*.txt` artifacts). | MITIGATING | A | Isolated worktree; primary checkout untouched; `stash@{0}` not touched; verify diffs stay diaspora-scoped each commit. |
| PROC-2 | LOW | Concurrent edits to integration-owned shared files. | OPEN | A | Specialists patch isolated files; Agent A integrates shared files serially. |

## External approval boundaries (Section 85) → tracked as EB-1…EB-5, PD-1 in Discovery §8.
These are not "risks to mitigate" but hard stops requiring the user: staging secret (EB-1),
Google OAuth + vault (EB-2), live billing (EB-3), real-money SafeTrade + legal (EB-4),
production migration/deploy (EB-5), Phase 8 granularity decision (PD-1).
