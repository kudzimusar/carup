# Issue #164 controlled staging truth cutover — dispatcher registration

This file records a narrow control-plane exception to the single programme PR rule.

The product implementation remains exclusively in draft PR #165 / `integration/canonical-vehicle-truth-closure`.
This dispatcher branch contains **no product code, migration SQL, database runner, frontend, backend route,
provider or business-logic change**. It exists only because GitHub registers `workflow_dispatch` from the
default branch, while the canonical staging database credential is intentionally available only to the
owner-governed `staging` GitHub Actions environment.

The precedent is PR #140 (`ci(staging): publication-gate migration dispatcher`), which used the same
separation of control plane from product code.

The workflow checks out immutable candidate:

`476bd4cf5e0a50ab1d744943c1dd67c693b00b63`

That candidate is a descendant of the Phase 6 certified source anchor
`e2d2f8a873ebb2714dc44587b17f9832d1ef69ed`. Its only post-Phase-6 executable change is the guarded
`backend/scripts/issue164-staging-truth-cutover.mjs`; all 16 migration files are verified byte-identical
to the Phase 6 source anchor before any connection is opened.

Security properties:

- manual dispatch is owner-only from `main`;
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

- the actor is `kudzimusar`;
- the target ref is `refs/heads/main`;
- the exact merge commit title is `ci(staging): register Issue #164 truth-cutover dispatcher (#169)`.

The merge is therefore the owner-authorized release action. It still executes only the immutable candidate
above, and `apply` itself runs live-schema preflight/rollback before the atomic commit and then a verify-only
pass afterward. Later ordinary pushes to `main` do not satisfy the pinned merge-title guard.

Once the initial cutover is complete, the dispatcher remains inert on `main` as an auditable owner-only
verify/recovery tool. Any future candidate change requires another reviewed mainline change because the SHA
is hard-pinned; the workflow cannot be repurposed to execute arbitrary branch code.

Phase 7 remains blocked until the cutover has an evidence-backed PASS receipt.
