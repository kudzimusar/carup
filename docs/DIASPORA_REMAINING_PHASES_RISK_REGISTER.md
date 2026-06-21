# Diaspora Remaining Phases — Risk Register

> Severity: **CRITICAL** (blocks production) / **HIGH** / **MED** / **LOW**.
> Status: OPEN / MITIGATING / ACCEPTED / CLOSED. Owner = responsible agent role.
> No secret values are ever reproduced in this document.

## Credential & security

| ID | Sev | Risk | Status | Owner | Mitigation / boundary |
| --- | --- | --- | --- | --- | --- |
| CR-1 | CRITICAL | Hardcoded `postgresql://…:<pw>@…` URIs and forbidden prod project ref `vhmnajoeicasaigiophh` present in tracked scripts (`backend/scripts/*`, `scripts/*`, `database/seeds/*`, some test utils); ≥6 history commits touch such blobs. | OPEN | B | **External boundary:** rotate credentials (DB owner), env-var replacement (in-program), purge history + force re-clone (needs approval). Containment started on `main` (PR #83, migrations `20260619201406`, `20260620232827`). Must close before public production (§76). |
| SEC-1 | HIGH | Frontend feature gating only (role-based); no server entitlement enforcement yet → trivial bypass once Phase 8 lands if any check stays client-side. | OPEN | B/D | Every protected op calls `diasporaEntitlementService` server-side (§31, §64). Tests prove server denial. |
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
| DOM-4 | MED | AI mutating authoritative state or graph edges directly. | MITIGATING | F | Preserve AI boundary (`diasporaAiCommandService`); graph writes only from domain events; AI reads redacted context (§59). |
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
