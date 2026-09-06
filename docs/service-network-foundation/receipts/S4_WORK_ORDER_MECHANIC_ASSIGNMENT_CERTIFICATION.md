# S4 — Work Order and Mechanic Assignment Convergence — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

## 1. What S4 builds

The existing `mechanic_work_orders` table remains **the** work-order authority — plan §6.3
forbids a second work-order table — and is evolved **additively**, in the style of
`20260808150000_mechanic_work_orders_convergence.sql`.

**Schema** — `20260904150000_service_network_s4_work_order_assignment.sql`:
- Additive nullable columns: `service_case_id`, `branch_id`, `service_category`,
  `completed_at`, `cancelled_at`, `cancellation_reason_code`, `currency`. No column is
  renamed, retyped or repurposed; the status CHECK is **not** mutated.
- `uq_mechanic_work_orders_service_case` — partial unique index: **one work order per
  Service Case**, a database guarantee rather than a convention.
- `work_order_assignments` — durable, attributable assignment history
  (`mechanic_user_id`, `assigned_by_user_id`, `assigned_at`, `unassigned_at`,
  `unassigned_by_user_id`, `unassign_reason_code`), with
  `uq_work_order_assignments_live` (partial unique on `work_order_id WHERE unassigned_at
  IS NULL`) so a race cannot produce two "current" mechanics. Service-role-only, FORCE
  RLS, zero policies.

**Service** — `backend/services/serviceNetwork/workOrderAssignmentService.js`.
**Routes** — `backend/routes/serviceWorkOrderRoutes.js`, mounted alongside the untouched
legacy `/api/mechanic/work-orders` routes.

## 2. Measured schema truth (a real finding, not an assumption)

The harness initially asserted that the DB would refuse a status outside the Title-Case
vocabulary. **It did not.** Investigation established why, and the assertion was corrected
to record the truth rather than the assumption:

> `CHECK (status IN ('In Progress','Completed','Cancelled'))` exists **only** in
> `009_phase4_schema.sql`, which is **RETIRED_UNAPPLIABLE**. The legacy `006_domain1.sql`
> shape declares `status TEXT DEFAULT 'pending'` with **no constraint**. Over the
> legacy-derived shape, the database does not constrain work-order status at all.

Consequences, all deliberate:
- S4 does **not** add a CHECK. It would be unsafe: legacy rows can legitimately hold
  `'pending'`, outside the API vocabulary, so the constraint could fail to apply or
  invalidate real history — and the S0 freeze forbids mutating a CHECK other consumers rely on.
- The vocabulary, the transition guard and terminal-state immutability are therefore
  **service-layer obligations**, held by `service-network-s4-work-order.test.js`.
- The harness now pins the schema fact itself, so a future change that silently assumed
  database enforcement is caught rather than trusted.
- Reads tolerate legacy values (`'pending'`) instead of crashing — asserted by test.

## 3. Authority decisions honoured

| Rule | How S4 satisfies it |
|---|---|
| No second work-order table (§6.3) | Additive columns on `mechanic_work_orders`; the legacy routes still work unchanged |
| Creator ≠ mechanic (§6.4) | Intake does **not** stamp `mechanic_id`; a work order may begin unassigned, and an unassigned one reports `assigned:false` with `null` rather than guessing |
| Assignment is durable and attributable | `work_order_assignments` records who assigned, when, who unassigned and why; reassignment retains both rows as history |
| Tenant safety | Mechanics must be members of the acting garage (`tenant_users` verified); another tenant's work order reads **404**, never 403 |
| Terminal states remain historical (§7.6, Invariant 12) | Completed/cancelled work orders cannot be reopened, restatused or reassigned |
| Explicit, idempotent case link (§7.3) | Partial unique index + insert-and-lose-the-race handling; a retry returns the same work order |
| Money (§24.4) | A recorded cost **requires** an ISO-4217 currency (no USD assumption); a completion with no cost recorded gains no fabricated zero |
| Timestamps (§24.5) | `completed_at`/`cancelled_at` are their own server-stamped columns, never derived from `updated_at` |
| Legacy compatibility | Every added column nullable; legacy rows keep content and gain no fabricated case, completion time or currency — proven over the **006** shape |

## 4. Verification — commands and results

| Gate | Command | Result |
|---|---|---|
| S4 migration proof (real PostgreSQL, legacy shape) | `node database/test/service_network_s4_check.mjs` | **PASS** — applied over legacy 006 + the real convergence migration; nullable columns, legacy row intact, measured no-status-CHECK fact, 23505 on a second work order per case and on a second live assignment, assignment history accumulating, FK rejection, RLS posture, Down preserving work orders, re-Up idempotent |
| S4 service contracts | `node --test backend/tests/service-network-s4-work-order.test.js` | **PASS** — 15/15 |
| Full backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4414 tests, **4393 pass, 0 fail**, 21 skipped, 48 suites. S3 baseline was 4398/0 fail → +16 tests, **zero regressions** |

CI-wired via `backend/tests/service-network-s4-work-order-migration.test.js`;
`mockSupabase.UNIQUE_INDEXES` registers both new partial-unique constraints.

## 5. Deliberately NOT in S4

Service records, mileage observations, parts and evidence binding (S5); Passport
projection of the richer work order (S6); Intelligence instrumentation (S7); any change to
the legacy `/api/mechanic/work-orders` behaviour; and any status-CHECK migration.

## 6. `[#194-sensitive]` items for the rebase

- #194 adds three new `mechanic_work_orders` consumers (`canonicalVehicleLifecycleService`,
  `serviceIntelligenceService`, `passportServicePartsProjection`) with frozen column selects.
  S4 adds only nullable columns and renames nothing, so those selects remain valid — but the
  S0 re-run must confirm it against the merged code.
- `passportServicePartsProjection`'s frozen `SERVICE_AUTHORITIES` set must be extended, never
  forked, when S6 projects assignment-derived provenance.
