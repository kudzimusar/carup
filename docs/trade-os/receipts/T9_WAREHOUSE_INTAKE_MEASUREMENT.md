# Trade OS T9 — Warehouse intake & measurement · Receipt

**Status: `T9-PARTIAL` — OWNER ACCEPTANCE REMAINS.** Candidate `27a2a558`. T10 not started.
Production untouched. PR #207 Draft.

## 1. T9.0 — the audit

**No warehouse authority existed anywhere in the repository.** No warehouse, yard, CFS, intake,
receipt or measurement table. Every near-match belonged to a different domain:

| table | actual domain |
|---|---|
| `dealer_branches`, `garage_branches`, `organization_branches` | party locations |
| `vid_inspections` | vehicle roadworthiness |
| `diaspora_workbook_import_receipts` | spreadsheet imports |

So T9 creates its authority, exactly as T5 created the corridor authority from nothing.

### What already owns the ESTIMATE

| fact | authority — untouched by T9 |
|---|---|
| booking estimate | `diaspora_cargo_reservations.estimated_volume` / `.estimated_weight` |
| intake estimate | `diaspora_logistics_request_items.estimated_volume_cbm` / `.estimated_weight_kg` |
| capacity ledger | `diaspora_container_shipments.*_capacity_volume` — **frozen by T5** |

## 2. T9.1 — the authority, and the boundary it exists to hold

Migration `20260911090000` creates `diaspora_warehouses`, `diaspora_warehouse_intakes` and
`diaspora_warehouse_measurements`.

**ESTIMATED ≠ ACTUAL.** The estimate is not touched — not one column of it. Actuals live in their own
table with who measured, when, and by what method. Both are true statements about different moments,
and collapsing them destroys the only record of the disagreement. The gate proves the customer's
**3.0 CBM survives a 3.8 CBM measurement**, and that the **+0.8 difference is derivable from both**.

**A receipt is an attributed act, not a status.** `RECEIVED` without a receiver *and* a time is
refused by the database. An exception outcome must say why — a refusal without a reason is unusable
to the customer it affects. A second live intake for the same cargo is refused, because a re-receipt
is a correction rather than a new arrival.

**Unknown stays unknown.** `storage_location` is NULL until actually assigned; no invented bay.

**Condition is an observation, from a bounded vocabulary** (`good`, `minor_damage`, `major_damage`,
`incomplete`, `unverifiable`) — the receiver's own, never an inference from an image.

**What the schema deliberately cannot express:** `LOADED`, `SHIPPED`, `DEPARTED`, `CUSTOMS_CLEARED`,
or a Trust verdict. There is no column to smuggle them into, and the gate proves `status='LOADED'`
is refused. Those remain T10/T11/T12/T14.

**Governed access.** All three tables `ENABLE` + `FORCE` RLS with `anon` and `authenticated`
revoked: the row that decides whether somebody's cargo was received must not be writable from a
browser. (The gate creates those Supabase roles in its fixture rather than weakening the migration.)

## 3. Evidence at `27a2a558`

| gate | result |
|---|---|
| T9 warehouse PGlite gate (own CI step) | **20/20** |
| full backend suite (ci.yml env) | **6091 passed / 0 failed** (21 skipped, 6112 total) |
| all five migration gates (T9 · T8×2 · T6 · integrity) | exit 0 |
| lint regression | NET_NEW_ERRORS=0 |

**Two mutations proven:** allowing `RECEIVED` without attribution, and allowing a weight without its
unit — each turns the gate red.

Applied to **staging only**; verified `FORCE` RLS and no `anon` SELECT on all three tables.

## 4. Not done — what `T9-PARTIAL` is missing

- **T9.2** governed receive/measure services with server-derived warehouse authority — the schema
  exists; no service writes it yet.
- **T9.3** customer and operator surfaces (intake queue, "your cargo", discrepancy view).
- **T9.4** T7 communications convergence (cargo received, discrepancy notice), replay-safe.
- **T9.5** T8 evidence convergence for condition photos — binding through T8, no new file store.
- **T9.6** privacy/adversarial matrix, responsive certification, staging journeys A–E.

The authority and its truth boundaries are in place and proven; the product on top of them is not
built. **This agent does not mark `T9-USABLE`.**

## 5. Carried forward

**T12-BLOCKER unchanged.** `documentIntelligenceService` still writes a fabricated customs exchange
rate (13.5) and duty (50000). No T9 surface reads it.
