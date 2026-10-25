# T11-CAP-02 — Journey projection · Receipt

**Specialist gate: `SPECIALIST GATE PASSED`** for the projection and its HTTP surface at unit level.
Recommendation: `RECOMMEND ACCEPT — T11-CAP-02`. The Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Canonical role | `JOURNEY PROJECTION SPECIALIST` |
| Builds on | CAP-01 Part B (`48917994`) |
| Frozen code modified | **none** — one existing file gains two additive lines (import + mount) |
| Schema / migrations | **none** |
| Staging / production | not touched |

## 1. What was built

- [journeyProjectionService.js](../../../backend/services/diaspora/journeyProjectionService.js) —
  `getJourney(subjectType, subjectId, userContext, options)`. A **read-only composition**; it stores and
  decides nothing. Subjects: `import_order`, `cargo_reservation` (alias) and `shipment` (alias), all
  resolved to the import order.
- [diasporaJourneyRoutes.js](../../../backend/routes/diasporaJourneyRoutes.js) — one route,
  `GET /api/diaspora/journeys/:subjectType/:subjectId`, behind the same coarse role middleware as the
  T11/T12 participant routes. **No write route exists.** Mounted in `diasporaRoutes.js`.
- Tests: [projection](../../../backend/tests/trade-os-t11-cap-02-journey-projection.test.js) (36) and
  [route](../../../backend/tests/trade-os-t11-cap-02-journey-route.test.js) (9).

## 2. The rules, as implemented

**Shipment selection (Part B §4.1)** — never `shipments[0]`. Tier 1: attached to this order (and on its
container if it has one). Tier 2: another order's shipment on this order's container. Tier 3: this
order's shipment on a *different* container (shown and flagged). The best tier present decides; exactly
one → selected; more than one → `SHIPMENT_AMBIGUOUS` and **no movement is claimed** (no dates, no
references, no movement events).
**Access** — who may read the order (`canReadImportOrder`) plus platform admins/reviewers; the
reservation and shipment aliases are authorized from the *resolved order*, so owning a booking never
opens someone else's order. A non-privileged caller gets the same 403, with the same body, for a missing
id and a forbidden one; platform admins/reviewers get a true 404. A sailing operator with no right to
the order is refused (they keep the T11 operator view).
**Private data** — consignee shown only to the order's buyer/creator and platform admins/reviewers
(not to tenant admins or assigned participants); chassis and engine numbers likewise.
**Truthfulness** — the state is derived from *observed* dates, never from the status enum; planned /
estimated / observed are separate fields; LOADED is not SAILED; a carrier reference is not movement; a
customs hold carries "not a customs decision"; cargo left behind or not loaded is not shown another
cargo's container shipment; a request ("wanted make/model") is never presented as a vehicle.
**Never serialised** — shipment `metadata`, `created_by`, event `metadata`, `recorded_by`, another
order's id or buyer.
**Not yet composed** — documents, customs, payments, notifications, actions, agents and legs each return
`availability: "not_yet_composed"` with the owning authority, so an empty section can never be read as
"nothing to report". These are CAP-04/06/07/08.

## 3. Evidence

| Check | Result |
|---|---|
| New tests | **45 / 45 pass** (36 projection + 9 HTTP) |
| New + frozen T11 suites (`trade-os-t11-*`) | **104 / 104** (the 59 existing T11 tests unchanged) |
| Wider regression (24 `trade-os-*` + 76 `diaspora-*` files) | **2,073 tests · 2,065 pass · 7 skipped · 1 fail** |
| That 1 failure | `diaspora-logistics-rfq.test.js:236` (T3 sailing match). **Reproduced on the untouched tree.** Cause: the fixture hard-codes `booking_deadline 2026-10-01` and `departure_date 2026-10-15`, both now past, so the sailing is correctly excluded. **HARNESS — a time-bomb fixture**, pre-existing, not changed here (frozen test) |
| Projection mutation test | 12 mutants; **11 killed**, module loading each time. The survivor (soft-delete filter removed from the query only) is a redundant second line of defence: removing **both** copies kills it (`a soft-deleted shipment is not a candidate`) |
| Route mutation test | writes added, authentication removed, router unmounted, import deleted — all killed. One **weakness found and fixed**: a commented-out mount still satisfied my first regex; the assertion is now anchored to an uncommented line |
| Read-only proof | trap on `insert/update/delete/upsert/rpc`: 0 writes; query count independent of timeline length |
| Equivalence guard | Journey dates deep-equal T11's own participant `dates` for the same fixture |

Two false greens were caught on the way and are recorded because they were nearly accepted: a regression
shard that ran **zero tests** (zsh passed 100 filenames as one argument — `tests` was undefined while
`failed` was `[]`), and a first-run all-green projection suite that was then mutation-tested before being
cited.

## 4. What this unit does **not** prove

- Everything above is **unit level against an in-memory mock**. Nothing has run against staging, and
  there is no UI yet (CAP-03).
- No ESLint config exists for `backend/`, so no lint result is claimed.
- The query-by-order-and-container rule depends on `diaspora_shipments.import_order_id` /
  `container_id` being populated; **staging holds one live shipment in total**, so the multi-shipment
  paths are proven by tests only, not by data.
- The legacy `GET /my-tracking/...` (`shipments[0]`), the exception notifier's recipient, the stale T4
  rail and the legacy shipment endpoints are **unchanged and still open** (Part B decisions D1–D3). The
  Journey composes around them; it does not repair them.

## 5. Next

CAP-03 (experience). CAP-04 (legs) and CAP-05 (observations) add the additive tables Part B §3 defined;
they replace the `not_yet_composed` placeholders for legs and ETA history. The real-data end (D4, vehicle
identity) is still held.
