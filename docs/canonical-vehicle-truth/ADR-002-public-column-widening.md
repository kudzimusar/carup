# ADR-002 — Accepting a 7-column widening of the legacy public vehicle endpoints

**Status:** ACCEPTED by lead architect. Raised by independent review as "sign this off, do not absorb it."

## What changed

`/api/vehicles` and `/api/vehicles/:vin/details` previously projected through
`PUBLIC_VEHICLE_COLUMNS` (24 columns). Phase 0 converged them onto the canonical
`PUBLIC_VEHICLE_SELECT` (31 columns). Net **+7**:

`registration_authority`, `registration_status`, `plate_status`, `zimra_verified`,
`inspection_ready`, `safe_pay_ready`, `public_seller_display_enabled`

### Amended in Phase 1 — the same +7 now applies to two further endpoints

Phase 1 converged the remaining `PUBLIC_VEHICLE_COLUMNS` consumers onto the same canonical
list, so this sign-off explicitly extends to:

- `GET /api/vehicles/:vin/recommendations` (via `recommendationService`) — anonymous;
- the `vehicles(...)` embed on `GET /api/vehicles/saved` — authenticated, but the embedded rows
  belong to *other* sellers, so they are public-class data and are judged on the same basis.

Independently verified on staging: all 7 are low-cardinality enums or booleans
(`registration_authority` = `CVR` for all 16 rows; `plate_status` = `Active` for all 16;
the three booleans split 13/3, 12/4, 12/4; `public_seller_display_enabled` false for all).
None is a join key, and none can single out a person, plate, chassis or owner.
No column was dropped by either convergence — the change is strictly widening.

## Why this is acceptable

1. **Not a new exposure class.** All 7 are already returned to anonymous callers today by
   `GET /api/marketplace/listings` (verified live: the UAT Toyota payload carries `zimra_verified`,
   `plate_status`, `inspection_ready`, `safe_pay_ready`). Convergence onto one contract makes the
   public surface *consistent*; it does not reveal a category of fact that was previously private.
2. **None is identifying.** No value in the set can single out a person, a plate, or a chassis.
   `plate_status` is a lifecycle state (`Active`/`Flagged`/`Suspended`), not the plate.
   `public_seller_display_enabled` is a display posture flag, not seller identity.
3. **The alternative is worse.** Keeping two divergent public column lists is precisely the
   root cause (RC-2) this programme exists to remove: N projections drift, and the narrowest one
   provides false assurance while a sibling endpoint leaks.

## What is explicitly NOT widened

The 4 genuinely private columns are dropped for **both** audiences on these routes:
`owner_id`, `tenant_id`, `current_seller_id`, `temp_plate_id`.

## Related, deliberately not changed

`backend/routes/partnerApiRoutes.js:50,56` returns `plate_number`, but only behind
`requirePartnerScope('vehicle:identity')`. That is a governed partner scope, not an anonymous
leak. It is a **convergence gap**, not a P0, and is deferred to Phase 1 API convergence.

## Caveat carried forward

`zimra_verified` / `inspection_ready` / `safe_pay_ready` are today unbacked denormalized booleans
(Phase 2 classifies them; Phase 3 derives them). Publishing them consistently does not make them
*true* — it makes them consistently visible. Their truthfulness is Phase 2/3 work, and the
invariant suite must forbid a `verified` claim without provenance regardless of which endpoint
serves it.
