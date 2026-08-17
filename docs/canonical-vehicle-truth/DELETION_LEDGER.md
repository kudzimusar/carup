# Deletion / deprecation ledger — Issue #164

Every removal this programme makes, with the evidence that made it safe. Entries are added as
they are authorised, not in advance.

---

## 1. `public.vehicle_listing_summaries` — REMOVED (authorised 2026-08-17)

**Migration:** `database/migrations/20260817120000_issue164_drop_dead_vehicle_listing_summaries.sql`
**Preflight:** `backend/scripts/issue164-drop-listing-summaries-preflight.mjs`
**Guard:** `backend/tests/issue164-dead-listing-summary.test.js` (10 invariants)

### Why

Created by `20260603132036_marketplace_listing_summary_infra.sql` as a future materialized
listing-card model. The refresh workers were deferred and never written, so it has stood empty
while the live read path resolved listings from `public.vehicles`.

The risk is not the empty table — it is that the table is a **second declaration of the public
listing contract**, carrying its own `duty_cleared`, `cid_clear`, `passport_verified`,
`plate_verified` and `trust_score` columns, and it is **publicly readable** (RLS policy plus
`SELECT` to `anon` and `authenticated`). Issue #164 exists because CarUp had several competing
sources of vehicle truth; a dormant one invites a future writer to populate it and republish an
unreconciled second set of trust claims straight to anonymous callers.

### Conditions required by the product-owner decision, and how each is met

| # | Condition | How it is enforced |
|---|---|---|
| 1 | No `CASCADE` | The `DROP TABLE` is plain (RESTRICT default). A test asserts `CASCADE` appears nowhere in the executable SQL, so an unanticipated dependent aborts the drop instead of being silently removed. |
| 2 | Zero rows | `count(*)` — not `reltuples`, which is a planner estimate that reads 0 on an unanalysed table. Any row raises. |
| 3 | No dependent views / functions / FKs | Three separate guards: dependent views (incl. materialized), inbound foreign keys, and routines whose body names the table. Each raises. |
| 4 | No application references | Not checkable in SQL. A source scan over `backend`, `web/src`, `shared`, `mobile` fails the build if any code path queries the relation. |
| 5 | Canonical staging guard before applying | The preflight positively identifies staging ref `eoyenigwevnxwwhyhaer` and exits BLOCKED on an unset, forbidden, or unrecognised target — "not production" is not sufficient. |
| 6 | Stop, do not delete, if a future preflight finds rows/dependencies | Every guard `RAISE`s, which aborts the runner's transaction and leaves the table exactly as it was. A refusal is a correct outcome. |

### Evidence

Measured on staging (`eoyenigwevnxwwhyhaer`, PostgreSQL 17.6) before authoring:
**0 rows · 0 dependent views · 0 inbound FKs · 0 triggers**; own objects only (1 RLS policy,
4 indexes, 1 outbound FK to `vehicles(vin)`), all removed by `DROP TABLE` itself without CASCADE.

Behavioural proof against real PostgreSQL (PGlite, 19 assertions, all passing):

| Scenario | Result |
|---|---|
| Empty table, no dependents | drops |
| Table holds 1 row | **REFUSES**, row not deleted, table intact |
| Dependent view exists | **REFUSES**, view not dropped, table intact |
| Inbound foreign key exists | **REFUSES**, table intact |
| Routine references the table | **REFUSES**, table intact |
| Table absent (fresh DB) | clean no-op |
| Re-applied after a real drop | clean no-op |

Repo migration harness (`database/test/migration_pglite_check.mjs`): **overall PASS**.

### Deliberately NOT removed — recorded as debt

`backend/services/trustGovernance/trustPermissionService.js:30` holds the string
`'vehicle_listing_summaries_refresh'` in `SUMMARY_FACTS`. That is a trust-fact **permission label**,
not table access; no code reads or writes the relation, so dropping it cannot break anything.

It is now debt — a governance permission to refresh something that no longer exists. Removing it
changes the governance permission set, which has its own blast radius and belongs in a separate
reviewed change. The guard pins it by exact set equality, so it cannot be quietly forgotten.

### Not reversible by rollback, by design

The `Down` section is non-executable. Recreating the table would restore the competing listing
contract this removes, and would restore the shape without data (there was none). If a materialized
listing read model is ever genuinely wanted, the forward path is a **new** migration that creates it
deliberately alongside the refresh workers that were never written, derived from the canonical fact
model rather than carrying duplicate boolean columns.

### Status

Migration authored, proven and committed. **Not yet applied to any database** — application is a
guarded staging run, preceded by the preflight. Production remains untouched.
