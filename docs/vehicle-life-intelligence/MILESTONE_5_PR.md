# Milestone 5 PR — Governance, Review, Dispute & Correction

**Branch:** `feat/vehicle-life-m5-governance` → base `feat/vehicle-life-m3-ai-temporal-disclosure`
**Program:** Vehicle Life Intelligence (master plan PR #89, §11)
**Status:** Draft. **Do not merge** without explicit `merge this PR now`.

> Base note: built on M3 (parallel to M4). M4 and M5 are independent siblings on M3; retarget/rebase order is M1→M2→M3→{M4,M5}→M6. Identified here per master plan §18.

## Exact scope

A defensible human-governance layer over evidence, AI findings, source conflicts, and seller
disputes: a unified review queue, the full decision set (confirm/reject/amend/request-more/
inconclusive/publish/unpublish/supersede/escalate), reviewer accountability, dispute submission
→ response → independent review → resolution → appeal, corrections that supersede public findings
while retaining history, and **trust-score separation** (AI confidence can never become trust;
only a governed rule writes `trust_change_log`).

## Migrations

`database/migrations/20260621160000_governance_disputes_corrections.sql` (additive, reversible):
`review_tasks`, `review_decisions` (append-only trigger), `disputes`, `dispute_events`
(append-only), `trust_change_log`. RLS; not exposed to anon. Reuses (does not duplicate)
`trust_audit_events` / `trust_fact_requests`. Decision→state mappings reconciled against the
real CHECK constraints on M3 tables (`reviewer_state` has no 'escalated'; escalate is a decision
+ `review_tasks.status='escalated'`).

## Changed files

- **Services:** `governance/governanceService.js` (unified queue, `applyDecision`,
  `recordGovernedTrustChange` as the ONLY trust path, `publicSafeDisputeState`),
  `governance/disputeService.js` (submit/respond/assign-independent/resolve/appeal; immutable events).
- **Routes/wiring:** `routes/governanceRoutes.js` (8 endpoints, role-enforced), `server.js`.
- **Frontend:** governance review-queue + dispute UI (+ `types/index.ts` governance types).
- **Tests:** `governance-workflow.test.js`, `governance-routes.test.js`.
- **Docs:** this file + reviewer handbook.

## Test results

- `node --test`: **24 pass** (governance-workflow + governance-routes + server boot), verified
  independently in-repo. Master-plan §11.8 invariants all covered.

## Security / privacy / governance invariants (tested)

- Unauthorized/spoofed roles blocked (403); roles enforced server-side, not UI.
- Every decision writes an append-only `review_decisions` row + a `trust_audit_events` row.
- `applyDecision` alone NEVER changes a trust score; trust changes require
  `recordGovernedTrustChange` (governed rule + backing review decision id).
- Disputed/superseded findings are never rendered as confirmed-public; superseded stays auditable.
- Reviewer accountability (id, role, notes, before/after, correlation id, conflict-of-interest) captured.

## Rollout / rollback

- **Rollout:** apply migration (additive). Decisions/disputes are opt-in reviewer/seller actions.
- **Rollback:** migration `-- +migrate Down`; revert branch. No impact on M1–M4.

## Remaining follow-ups

- Reviewer UI delivered in this PR (built in-repo after the workflow agent hit an account session
  limit). Independent-reviewer assignment policy can be tightened per jurisdiction later.
