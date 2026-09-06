# S1 Certification Receipt — Seller Entry & Vehicle Identification

**Programme:** Seller Journey 1.0
**Phase:** S1 — Seller Entry & Vehicle Identification
**Decision:** **PASS**
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

Performed immediately before the first S1 write, per plan §3.3:

| Surface | Exact state at S1 start | Exact state at certification |
|---|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` | unchanged |
| **PR #182 (write lane)** | `4d7b94fc8bd7c8e0b22658239cb8376a01a39e7e` | `a1d8828f` |
| Communications PR #183 | `507530aadff17ec8aa4830d3cb392efda6876031` | unchanged |
| Intelligence PR #185 | `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` | unchanged |
| Seller docs PR #186 | `f3024147` (S0 certification) | this receipt |

Remote head was re-read (`git fetch`) and confirmed at `4d7b94fc` immediately before pushing, per the "verify remote state before claiming done" rule. No third source-write lane was opened: S1 runtime work landed in PR #182, which owns the Seller surfaces.

**Changed-file manifest (S1):**

| File | Ownership |
|---|---|
| `web/src/lib/sellerVehicleIdentification.ts` (new) | #182 Seller lane |
| `web/src/lib/sellerVehicleIdentification.test.ts` (new) | #182 Seller lane |
| `web/src/hooks/useSellerVehicleIdentification.ts` (new) | #182 Seller lane |
| `web/src/components/sell/VehicleIdentificationNotice.tsx` (new) | #182 Seller lane |
| `web/src/pages/SellFlow.identification.test.tsx` (new) | #182 Seller lane |
| `web/src/lib/guestSellDraft.continuity.test.ts` (new) | #182 Seller lane |
| `web/src/pages/GuestSell.tsx` | #182 Seller lane |
| `web/src/pages/dashboard/owner/SellVehicle.tsx` | #182 Seller lane |

No #183 or #185 file was touched. No migration, no schema change, no backend change.

## 2. S1 requirement disposition

| S1 requirement | State at S1 start | Disposition |
|---|---|---|
| Guest seller support | Already live (`GuestSell.tsx`, 4-step flow) | **Satisfied ahead of schedule — not rebuilt** |
| Authenticated private owner | Already live (`SellVehicle.tsx`) | **Satisfied ahead of schedule — not rebuilt** |
| Dealer / tenant context | Governed server-side: `buildVehicleListingCandidate` derives `owner_id`/`tenant_id`/`current_seller_type` (Private Owner vs Dealer) from the authenticated context; `/api/vehicles/add` is `authorizeRole(['dealer','owner','admin'])` | **Satisfied ahead of schedule** |
| Dealer branch context *where governed* | `dealer_branches` exists in `dealerComplianceService`; branch is not part of the vehicle listing contract | **Deferred to S3**, which explicitly owns dealer branch under its identity controls |
| Existing Vehicle Passport reuse | **Absent** | **Implemented this phase** |
| Duplicate-vehicle prevention | Submit-time 409 only, after full form investment | **Implemented this phase** (pre-form detection; the 409 remains authoritative) |
| No truth-dangerous defaults | `year: '2020'` default removed in S0; guest year starts empty | **Satisfied** |
| Guest draft survives authentication | Live but unguarded | **Satisfied + permanently guarded this phase** |

## 3. What S1 implemented

### 3.1 Existing-Passport detection before form investment

Before S1, both Sell surfaces learned about a duplicate only from the submit-time 409 — after every field and photo had been supplied. S1 adds one shared contract, run as soon as the VIN is syntactically complete (debounced 400 ms), reusing the **same public, rate-limited, `optionalAuth()`-gated passport lookup that Verify already calls**. No new endpoint and no new exposure: a seller sees exactly what any public caller of that endpoint sees for this identifier.

Truth boundaries encoded in `sellerVehicleIdentification.ts` and enforced by test:

- **`passport_exists`** — reads as "CarUp already holds a Vehicle Passport for this VIN", never as a verified seller fact.
- **`no_carup_record`** — fail-closed. A miss is a statement about CarUp's records only; it never claims the vehicle does not exist, is new, or is unregistered. This is the same rule the public Verify lookup already follows.
- **`check_unavailable`** — a transport failure is reported distinctly from a miss and never blocks the seller. Collapsing the two would let a network error publish "CarUp holds no record" as a fact.
- **No prefill.** The carried projection is narrowed to `{vin, make, model, year}` — identity and description only. Colour, mileage, price and condition are seller-stated dimensions; inheriting them from an existing record would manufacture a seller-stated fact nobody asserted. The notice says so to the seller in plain words.

### 3.2 Draft continuity permanently guarded

Guest Sell asks 23 questions, the browser draft persists 23, authenticated Sell reads back 23 — verified equal. Nothing previously held that equality. `guestSellDraft.continuity.test.ts` now walks all three surfaces structurally and also pins the draft's version rejection and the ordering rule that the draft is cleared only *after* the server accepted the listing. **Mutation-checked:** removing one draft field fails the suite with a named field.

## 4. Wiring proof

A prior CarUp lane shipped a correct collaborator whose production path was dead by construction. `SellFlow.identification.test.tsx` therefore renders **both real Sell surfaces** (`describe.each`) and drives the real VIN inputs, asserting the seller actually sees each outcome — 8 tests, 4 per surface. The detector cannot regress into an unreferenced module.

## 5. Evidence

**Local, at `a1d8828f`:**

| Check | Result |
|---|---|
| `npx vitest run` (full web unit suite) | **110 files / 1129 tests passed** |
| `npx tsc --noEmit` | **exit 0** |
| `npx eslint` (all changed/new files) | **exit 0** |
| `npm run build` | **exit 0**, built in 54.05s |
| `node --test` taxonomy + anti-fork suites | **8/8 passed** |
| S1 suites specifically | `sellerVehicleIdentification` 6/6, `SellFlow.identification` 8/8, `guestSellDraft.continuity` 4/4, `SellFlow.resilience` 6/6 |

**CI at the S1 head** — recorded in §7 below once the run completes.

## 6. Boundary dispositions

- **Intelligence seam (`sell_started`, `guest_draft_saved`, `account_handoff_*`)** — the Intelligence event infrastructure (`activityEventTypes.js`, `activityLedgerService.js`) exists **only in PR #185**, not in this lane. Emitting these events here would either fork #185-owned code — forbidden by plan §3.2 — or depend on code absent from this branch. Per plan §8 and the S9 phase definition, this is an **S9 pairing obligation** executed at an explicitly reconciled base. Recorded, not built. No competing event system was created.
- **Communications seam (draft continuation, account handoff, identity verification)** — no provider-specific seller logic was added. Communications remains #183/Communications-2.0-owned per Invariant 4. Deferred to S10 certification.

## 7. Decision

> **S1 — PASS.** A guest can begin, authenticate later and resume without losing or corrupting entered information — now permanently guarded — and both Sell surfaces detect an existing CarUp Passport before the seller invests in the form, without fabricating identity, prefilling seller-stated facts, or publishing a lookup miss as proof of non-existence.

**Next phase:** S2 — Canonical Commercial Listing Data. Note that S0 already closed the headline S2 persistence P0s (`seller_description`, `seller_features`, `body_style`, `seller_stated_condition`, drivetrain). S2 therefore begins as a **completeness audit of the full Seller Data Contract Matrix** against live schema and API, not a rebuild of the persistence already delivered.
