# Seller Journey 1.0 — Programme Status

**Date:** 2026-08-28 (second implementation run)
**Implementer:** Claude Code
**Write lane:** PR #182 `feat/marketplace-reliability-reference-ux`
**Certified head:** `2121fc5e`
**Docs lane:** PR #186 `docs/seller-journey-1-0-canonical-plan`

---

## 1. Phase status

| Phase | Decision | Notes |
|---|---|---|
| **S0** Vehicle Taxonomy & Seller Contract Foundation | **PASS** | staging gate PASS at immutable candidate `7b250687` |
| **S1** Seller Entry & Vehicle Identification | **PASS** | existing-Passport detection before form investment |
| **S2** Canonical Commercial Listing Data | **PASS** | read-half defect closed; completeness gate self-updating |
| **S3** Seller Identity, Dealer Context & Privacy | **PASS** | consent controls + three-way location vocabulary, staging-proven. Dealer branch deferred |
| **S4** Listing Media Studio | **PASS** | cover choice, accessible reorder, deterministic intake feedback |
| **S5** Embedded Verify & Evidence Reconciliation | **PASS** | contradiction surfaced to the seller and blocking publication |
| **S6** Actual Buyer Preview & Searchability Proof | **PASS** | real Marketplace card + discoverability summary |
| **S7** Publication Readiness & Listing Quality | **PASS** | three measurements held apart by what each may read |
| **S8** Publish, Edit & Manage Lifecycle | **PASS** | price change end to end, API and UI |
| **S9** Seller Intelligence Pairing | **BLOCKED** | PR #185 — see §3 |
| **S10** Communications End-to-End Certification | **BLOCKED** | PR #183 — see §3 |
| **S11** Cross-Surface Convergence | **PASS** | one row through every real projection, 14/14 |
| **S12** Golden Seller Vehicle Production Certification | **OWNER-GATED** | see §3 |

**Every phase that can be executed inside PR #182 is now PASS.**

## 2. What each phase actually closed

Every phase closed a defect where CarUp **asked a seller for something and then failed to honour it**:

1. **S1** — a duplicate surfaced only at the submit-time 409, after every field and photo.
2. **S2** — four seller-stated fields were written and API-projected but absent from `PUBLIC_VEHICLE_FIELDS`, so Vehicle Detail's description, features and condition reads were **dead keys**. The Condition tile said "Not recorded" for **every vehicle on the platform**.
3. **S3** — location was published because the seller *typed* it, not because they *chose* to; public seller identity could be read but never set.
4. **S4** — a "Cover" badge asserted a choice nobody made, while bare URLs meant the listing had **no primary photo at all**. Rejected files vanished **silently**.
5. **S5** — a detected, stored 2020-vs-2019 contradiction **published exactly like a clean listing**, and the seller was never shown it.
6. **S6** — the preview was bespoke and printed **"0 km"** for an unentered mileage.
7. **S7** — only one of the three required measurements had a surface.
8. **S8** — correcting a price required a database write.
9. **S11** — the newly-added governed facts had no convergence proof.

## 3. Blockers — re-reconciled against live evidence on 2026-08-28

**S9 — Seller Intelligence. BLOCKED.**
Live: PR #185 `OPEN`, draft, **unmerged**, head `0b9fa030` (unchanged). `main` unchanged at `ba208963`, so **no reconciled base exists**. `backend/services/intelligence/` in this base contains only `disclosureConflict.js` and `temporalComparison.js` — `activityEventTypes.js` and `activityLedgerService.js` are **absent**.

Per the plan's lane rules, **no** second activity ledger, event taxonomy, seller analytics pipeline or rollup engine was created. What S9 will observe now exists: the authoritative mutations and their audit records (`VEHICLE_LISTING_PUBLISHED`, `VEHICLE_LISTING_UNPUBLISHED`, `VEHICLE_PRICE_CHANGED` with before/after) are written server-side beside the domain change.

**Unblocks when:** #185 merges, or a base explicitly reconciling #182 and #185 is chosen.

**S10 — Communications. BLOCKED.**
Live: PR #183 `OPEN`, draft, **unmerged**, head `507530aa` (unchanged). Communications was **not** rebuilt (Invariant 4). No gate sending real WhatsApp/Telegram/provider traffic was run speculatively.

**Unblocks when:** #183 merges or a reconciled base exists. Certification then covers `authoritative domain event → Communications → preference/consent policy → channel → delivery → canonical conversation/notification record`, including that an external provider failure does not destroy canonical CarUp state.

**S12 — OWNER-GATED.** Not run. Requires owner acceptance, staging UAT sign-off and production activation authority.

## 4. Authority boundaries observed

- **No merge.** PR #182 remains open and draft.
- **No production activation.** All migrations staging-only; nothing promoted.
- **One write lane.** All runtime work in #182. #183 and #185 files never touched. A new `docs/vehicle-passport-trust-lifecycle-1-0-plan` branch appeared and was checked: documentation-only, and it names #182 as owner of the Seller/Marketplace contracts.
- **Remote head re-read before every push.**

## 5. Staging schema state — unchanged this run

| Migration | Gate | Result |
|---|---|---|
| `20260828133000` / `…140000` / `…143000` — S0 taxonomy | Seller S0 gate (candidate `7b250687`) | PASS |
| `20260828160000` — S3 visibility widening | Seller S3 gate (candidate `0ada1ca3`) | PASS — vocabulary in force `["province_only","public","withheld"]`, provenance guard intact, consent distribution unchanged |

**S5, S11, S4 and S8 required no migration at all.**

## 6. Failures encountered and resolved this run

1. **A PGlite fixture predated two columns.** `issue164-codex-findings-remediation` hand-declares a schema without `vehicle_document_extractions` or `normalized_plate_number`, so the fail-closed S5 evaluator correctly refused. The **fixture** was corrected to model the real schema — making the evaluator tolerant would have re-introduced "assume clean when you cannot read".
2. **A fourth-allow-list guard fired on the materiality list.** `issue164-phase1-read-contract` forbids a new exported vehicle column array under `backend/services`. The guard was right — such an array is shaped exactly like a projection allow-list. Resolved by exposing a **predicate** instead, which makes "this never queries" structurally true rather than intended.
3. **Two S11 media fixtures were wrong, not the code.** Rows read from `image_url`, and identity must be an opaque UUID. The fixtures moved to the real shape; nothing in the contract was relaxed.
4. **A resilience assertion pinned a moved implementation detail.** Updated to follow the filtering into `screenListingImages`, where the property is guarded more strictly.
5. **Recurring load-flake:** `VehicleSearch.test.tsx` intermittently times out under full-suite parallelism (observed 3× across the programme) and passes **11/11 in isolation** every time. No causal path — it fully mocks the API. Recorded rather than suppressed; worth a timeout budget if it recurs, since a flake can eventually mask a real failure.

## 7. Recommended next actions

1. **Owner review of PR #182.** Every executable phase is PASS at `2121fc5e` with all ten workflows green.
2. **S9 / S10** once #185 and #183 merge, or once an explicitly reconciled base is chosen.
3. **S12** on owner instruction only.
4. Optional in-lane follow-ons, all recorded: dealer branch context (S3), blur/lighting scoring only if a governed signal appears (S4), guest-surface cover choice (S4).
