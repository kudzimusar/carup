# Seller Journey 1.0 — Programme Status

**Date:** 2026-08-28
**Implementer:** Claude Code
**Write lane:** PR #182 `feat/marketplace-reliability-reference-ux`
**Certified head:** `abc11e96` — **all ten workflows green**
**Docs lane:** PR #186 `docs/seller-journey-1-0-canonical-plan`

---

## 1. Phase status

| Phase | Decision | Notes |
|---|---|---|
| **S0** Vehicle Taxonomy & Seller Contract Foundation | **PASS** | Certified at `4d7b94fc`; staging gate PASS at immutable candidate `7b250687` |
| **S1** Seller Entry & Vehicle Identification | **PASS** | Existing-Passport detection before form investment; draft continuity permanently guarded |
| **S2** Canonical Commercial Listing Data | **PASS** | Read-half defect closed; completeness gate made self-updating |
| **S3** Seller Identity, Dealer Context & Privacy | **PASS** | Consent controls + three-way location vocabulary; staging migration PASS. Dealer branch deferred |
| **S4** Listing Media Studio | **PARTIAL PASS** | Seller-chosen cover + guided shot list. Reorder and media-quality scoring deferred with reasons |
| **S5** Embedded Verify & Evidence Reconciliation | **NOT STARTED** | Next self-contained phase |
| **S6** Actual Buyer Preview & Searchability Proof | **PASS** | Real Marketplace card + discoverability summary |
| **S7** Publication Readiness & Listing Quality | **PASS** | Three measurements held apart by what each may read |
| **S8** Publish, Edit & Manage Lifecycle | **PARTIAL PASS** | Price change closed the last DB-write gap; inquiry handling is S10's |
| **S9** Seller Intelligence Pairing | **BLOCKED** | External lane — see §3 |
| **S10** Communications End-to-End Certification | **BLOCKED** | External lane — see §3 |
| **S11** Cross-Surface Convergence | **NOT STARTED** | Best run after S5 |
| **S12** Golden Seller Vehicle Production Certification | **BLOCKED** | Requires owner authority — see §3 |

## 2. What changed, by defect

Every phase closed a defect where CarUp **asked a seller for something and then failed to honour it**:

1. **S1** — a duplicate was only discovered at the submit-time 409, after every field and photo had been supplied.
2. **S2** — four seller-stated fields were written and API-projected but absent from `PUBLIC_VEHICLE_FIELDS`, so Vehicle Detail's description, features and condition reads were **dead keys**. The Condition tile said "Not recorded" for **every vehicle on the platform**.
3. **S3** — location was published because the seller *typed* it, not because they *chose* to; and `public_seller_display_enabled` could be read but never set, so no seller could switch their public identity on.
4. **S4** — a "Cover" badge asserted a choice nobody made, while bare URLs meant the listing had **no primary photo at all**.
5. **S6** — the preview was a bespoke layout that printed **"0 km"** for an unentered mileage.
6. **S7** — only one of the three required measurements had a surface.
7. **S8** — correcting a price required a database write.

## 3. Blockers — genuine, not scheduling

**S9 — Seller Intelligence Pairing.** The Intelligence event infrastructure (`activityEventTypes.js`, `activityLedgerService.js`, projections, rollups) exists **only in PR #185**. Emitting seller-domain events here would either fork #185-owned code — forbidden by plan §3.2 — or depend on code absent from this branch. **Unblocks when:** #185 merges, or an explicitly reconciled base containing both lanes is chosen. No competing event system was created; the authoritative mutations and audit records S9 will observe now exist.

**S10 — Communications End-to-End Certification.** Communications 2.0 is #183-owned and consumed, not rebuilt (Invariant 4). Certifying the seller matrix (domain event → preference policy → channel → delivery → canonical record) requires that lane. **Note:** gates in this family send **real WhatsApp messages**; they must not be run speculatively or concurrently with another session.

**S12 — Golden Seller Vehicle Production Certification.** Requires owner acceptance, staging UAT sign-off and production activation authority. Not performed.

## 4. Authority boundaries observed throughout

- **No merge.** PR #182 remains open and unmerged.
- **No production activation.** Every migration is staging-only; the S3 migration was applied to staging `eoyenigwevnxwwhyhaer` via an immutable-candidate gate and nowhere else.
- **One write lane.** All runtime work landed in #182, which owns the Seller/Marketplace surfaces. #183 and #185 files were never touched. Documentation and receipts went to #186.
- **Remote head re-read before every push.**

## 5. Staging schema state

| Migration | Gate | Result |
|---|---|---|
| `20260828133000` / `20260828140000` / `20260828143000` — S0 global taxonomy | Seller S0 Global Taxonomy Staging Gate (candidate `7b250687`) | PASS |
| `20260828160000` — S3 location visibility widening | Seller S3 Location Visibility Staging Gate (candidate `0ada1ca3`) | PASS — `vocabulary_in_force: ["province_only","public","withheld"]`, `provenance_guard_present: true`, consent distribution unchanged (36 null / 2 public) |

## 6. Failures encountered and resolved — recorded, not hidden

1. **S3 gate, first run.** Refused with `constraint_present: true, vocabulary_in_force: []`. The constraint was correct; the gate's own **parser** could not read Postgres's braced array rendering. The refusal was right; the reason was wrong. Parser extracted to a pure module and tested by execution against both renderings.
2. **CI red at `e3881eb0` and `fc98bc8a`.** One backend test of 4419: `migration-integrity` rejected the S3 migration for using `-- Up` instead of the repository's `-- +migrate Up`. Local verification had covered the seller and privacy suites but **not** the suite that owns that contract. Fixed, gate re-pinned, staging re-verified unchanged, and the S4/S6 receipts corrected to point at the green head.
3. **`VehicleSearch.test.tsx` load-flake.** One full-suite run showed a 3653 ms timeout on a test that passes 11/11 in isolation, with no causal path from the change. A clean re-run passed 112/112 files. Recorded rather than suppressed.

## 7. Recommended next actions

1. **S5 — Embedded Verify & Evidence Reconciliation.** Self-contained; the evidence upload and review surfaces already exist, so the work is discrepancy surfacing and resolution (seller-stated 2020 vs evidence 2019) without silent overwrite.
2. **S11 — Cross-Surface Convergence.** Best run after S5 so the full governed field set is in place.
3. **S9 / S10** once #185 and #183 merge or a reconciled base is chosen.
4. **S12** on owner instruction only.
