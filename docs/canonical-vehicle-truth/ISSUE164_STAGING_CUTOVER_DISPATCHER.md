# Issue #164 controlled staging truth cutover — dispatcher registration

This file records a narrow control-plane exception to the single programme PR rule.

The product implementation remains exclusively in draft PR #165 / `integration/canonical-vehicle-truth-closure`.
This dispatcher branch contains **no product code, migration SQL, database runner, frontend, backend route,
provider or business-logic change**. It exists only because GitHub registers `workflow_dispatch` from the
default branch, while the canonical staging database credential is intentionally available only to the
owner-governed `staging` GitHub Actions environment.

The precedent is PR #140 (`ci(staging): publication-gate migration dispatcher`), which used the same
separation of control plane from product code.

The workflow pins remediated source candidate:

`52d85aa8ce64603e71ba06a0dc566e9763e13235`

Provenance and Ancestry:

- Historical source anchor: `acaf2e8327ae17776720c34d9a49ee63e5f12bd8` (executed historical cutover against staging project `eoyenigwevnxwwhyhaer`).
- Historical candidate SHA: `4cee0f1172090a8dd1c07fb3de872c79a5bcd125` (source-certified candidate that failed staging runtime due to PG JSONB parameter serialization).
- Historical staging runtime candidate: `db201019a4cba94f1ed43d11af723a77e05bd419` (later staging runtime candidate that pinned all Phase 6 Findings 1–7 remediations, PostgreSQL client forwarding, fail-closed version verification, lazy-client fixes, and JSONB parameter serialization remediation; it successfully refreshed 36/36 and passed post-refresh verification in workflow run `32531178780`, but was subsequently superseded by later source-level findings and remediations). This is a historical staging runtime candidate, **not** the current pin; its staging run executed the `db201019a4…` source only and never executed `52d85aa8ce…`.
- Cutover candidate & workflow pinned SHA: `52d85aa8ce64603e71ba06a0dc566e9763e13235` (current final source-certified candidate authorized for the final Trust refresh certification — the head of `integration/canonical-vehicle-truth-closure` that independently passed exact-head GitHub CI and a fresh no-carry-forward Codex review, and a strict descendant of the historical `db201019a4…` runtime candidate that adds only the later Phase 6 finance remediations plus the normal `main` merge, leaving the trust-refresh writer and post-cutover verifiers reviewed at this exact head).
- Workflow dispatcher head vs PR programme head: Once PR #173 merges, the dispatcher workflow on `main` will pin `CANDIDATE_SHA: 52d85aa8ce64603e71ba06a0dc566e9763e13235`, and PR #165's exact programme head on branch `integration/canonical-vehicle-truth-closure` is also `52d85aa8ce64603e71ba06a0dc566e9763e13235`. Until PR #173 merges, `main` still pins the historical `db201019a4…` runtime candidate.

Migration tree integrity:
`assertCandidateAndMigrationTreeFrozen()` verifies that 12 pre-existing migrations are byte-identical to the Phase 6 source anchor before any connection is opened. Four Issue #164 migrations (`20260818110000_issue164_listing_location_provenance.sql`, `20260819123000_issue164_phase6_finance_truth.sql`, `20260819127000_issue164_phase6_settlement_recovery.sql`, `20260819129000_issue164_phase6_settlement_recovery_fence.sql`) were introduced as part of the Issue #164 canonical truth model and are explicitly exempted from comparison against the historical pre-Issue #164 anchor.

Security properties:

- manual dispatch is owner-only from `main`;
- both original `github.actor` and actual `github.triggering_actor` must be `kudzimusar`;
- the one-time merge-triggered cutover additionally requires `github.run_attempt == 1`, so a rerun cannot repeat the initial apply path;
- GitHub `staging` environment;
- no arbitrary ref, SQL, branch or migration input;
- immutable candidate checkout;
- database identity must positively expose staging ref `eoyenigwevnxwwhyhaer` in host/user identity;
- all other database identities are refused;
- TLS certificate verification is mandatory, using the configured or bundled Supabase CA (system roots only as a verified fallback);
- dependency installation occurs without database credentials in scope;
- canonical migration parser validates every Up section;
- Supabase ledger identity uses the numeric timestamp convention with the full filename recorded as `name`;
- preflight executes all 16 migrations and ledger writes in one transaction and then rolls back;
- apply executes all 16 migrations plus ledger rows atomically and verifies before commit;
- only 0/16 or exact 16/16 ledger states are accepted; partial/mismatched state fails closed;
- postconditions require RLS on the transaction tables, zero anon/auth table or column grants, zero anon/auth executable `issue164_*` RPCs, and service-role RPC authority;
- vehicle/evidence/ownership/finance/escrow row counts are preserved where present;
- `vehicles.trust_score` and legal `vehicles.owner_id` checksums must not change;
- no production, live provider or Gemini activation.

## Initial cutover execution

The connected programme automation cannot invoke GitHub's `workflow_dispatch` endpoint directly. To avoid
turning that tooling limitation into a weaker database path, the dispatcher has a second, one-time entry:
a `push` to `main` runs the initial `apply` sequence only when **all** of these are true:

- `github.actor` is `kudzimusar`;
- `github.triggering_actor` is also `kudzimusar`;
- the target ref is `refs/heads/main`;
- `github.run_attempt == 1`;
- the exact merge commit title is `ci(staging): register Issue #164 truth-cutover dispatcher (#169)`.

The merge is therefore the owner-authorized release action. It still executes only the immutable candidate
above, and `apply` itself runs live-schema preflight/rollback before the atomic commit and then a verify-only
pass afterward. A collaborator rerun cannot satisfy the triggering-actor guard, and a later rerun of the
original push cannot satisfy the run-attempt guard.

Once the initial cutover is complete, the dispatcher remains inert on `main` as an auditable owner-only
verify/recovery tool. Any future candidate change requires another reviewed mainline change because the SHA
is hard-pinned; the workflow cannot be repurposed to execute arbitrary branch code.

Phase 7 remains blocked until the cutover has an evidence-backed PASS receipt.
