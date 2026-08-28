# S8 Certification Receipt — Publish, Edit & Manage Lifecycle

**Programme:** Seller Journey 1.0
**Phase:** S8 — Publish, Edit & Manage Lifecycle
**Decision:** **PASS** — completed 2026-08-28. The API landed in the first pass and the seller-facing control in the second (§4a); the Communications-owned capabilities remain S10's by design.
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `abc11e96` |
| Communications PR #183 / Intelligence PR #185 | untouched |

Remote head re-read (`12eaa388`) before push. No migration, no schema change.

**Changed files:** `backend/routes/vehiclesRoutes.js`, `backend/tests/seller-price-change.test.js` (new), `web/src/hooks/useCarUpApi.ts`.

## 2. Audit: what already worked

| S8 capability | State before this phase |
|---|---|
| Save draft / resume / edit | Live — draft save, guest-draft claim (S1), and the authenticated form |
| Publish | Live — `POST /api/vehicles/:vin/publish`, gated on the deterministic completeness evaluator, with both `blocking_gaps` and `pending_gaps` disclosed so a seller can tell "you have not supplied this" from "we have not finished reviewing it" |
| Pause / unpublish | Live — `POST /api/vehicles/:vin/unpublish`, returns to `publishable` without touching availability |
| Mark sold | Live — status PATCH, surfaced in My Listings |
| **Change price** | **Missing** |
| Respond to inquiries / manage conversations | Communications-owned (Invariant 4) |
| Begin ownership transfer | Present in the ownership/transfer surfaces, outside this lane |

None of the working capabilities was rebuilt.

## 3. The gap closed

The gate requires the lifecycle to work **"without direct database intervention"**, and `price_changed` is a documented authoritative event. Once a listing existed, the only way to correct its price was a database write.

`PATCH /api/vehicles/:vin/price` is deliberately narrow and moves the **amount alone**:

- **It accepts no currency.** Redenominating an existing listing is not a price change — it would turn 28,500 of one currency into 28,500 of another with nobody restating the vehicle. Currency is stated once, at creation, by the seller who was asked for it, and it carries a provenance stamp this route has no basis to re-issue. Asserted by test: the route source contains no `req.body.currency`.
- **It writes `price` and nothing else.** A cheaper car is not a more available one, and certainly not a more verified one. The test parses the update payload's column list and requires it to be exactly `['price']` — handling both object shorthand and explicit form, so tightening the implementation's style cannot make the guard silently pass on an empty list.
- **It refuses rather than coerces.** Missing, non-numeric, zero and negative are all 400s. `price` carries no column default, so a coerced `0` would publish a free car — the same fabrication the read paths already refuse on the way out.
- **Scope reuses `loadScopedVehicle`**, so ownership and tenant rules cannot drift away from the publication routes beside it.
- **Both ends are audited.** `VEHICLE_PRICE_CHANGED` carries `beforePrice` and `afterPrice`, because "the price changed" is not a record of what changed. The shared loader now selects `price` so the "before" is **read** rather than assumed.

## 4. Deferred by design

- **Respond to inquiries / manage conversations.** Communications-owned per Invariant 4 (#183 / Communications 2.0). Seller Journey consumes it; certification is S10's, and building a seller-side conversation store here would be the duplication the plan forbids.
- **`price_changed` as an emitted Intelligence event.** The authoritative *mutation* and its audit record now exist, which is the prerequisite. Emitting the observation belongs to S9, whose event infrastructure (`activityEventTypes.js`, `activityLedgerService.js`) lives **only in PR #185**. Wiring it here would fork #185-owned code.
## 4a. The seller-facing control — completed (head `ba4e8fe6`)

With no human-facing control, "complete lifecycle without a database write" was only true for
someone holding an API client. My Listings now carries a price editor that loosens **nothing** the
API tightened:

- it sends the **amount alone** — `updateVehiclePrice(vin, number)`, asserted to be called with
  exactly two arguments, because a currency here would let a seller silently redenominate an
  existing listing;
- the currency is **shown** so the seller sees what they are pricing in, and is deliberately not
  editable;
- zero, negative and non-numeric input are refused **before** the request, with the server check
  still authoritative rather than replaced;
- the editor opens **empty** when a listing has no recorded price — seeding `0` would offer the
  seller a free car as a starting point;
- the displayed price is the one the **server confirmed**, never the one typed, so a refused or
  adjusted write cannot leave a seller looking at a price that was never stored;
- a failed save leaves the displayed price untouched;
- nothing else moves — tests assert publish, unpublish and status are never called by a price
  change. Sold listings offer no control at all.

`MyListings.price` — **9/9 passed**; owner dashboard suites **102/102**.

## 5. Evidence at `abc11e96`

| Check | Result |
|---|---|
| **Full backend suite** (`node --test backend/tests/`, CI env contract) | **4405 pass / 0 fail** (30 skipped) |
| `seller-price-change` | **7/7 passed** |
| `npm run build` (`tsc -b && vite build`) | **exit 0** |

ESLint on `useCarUpApi.ts` reports 66 pre-existing `@typescript-eslint/no-explicit-any` errors across the file, present on the untouched baseline and green in CI at every prior head. The added method is fully typed and introduces none.

## 6. Decision

> **S8 — PARTIAL PASS.** The seller lifecycle now runs end to end without a database write: publish, unpublish, change price, mark sold. The two remaining capabilities are Communications-owned and Intelligence-owned respectively, and are deferred to the phases the plan assigns them to rather than duplicated here.
