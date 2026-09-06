# S7 Certification Receipt — Publication Readiness & Listing Quality

**Programme:** Seller Journey 1.0
**Phase:** S7 — Publication Readiness & Listing Quality
**Decision:** **PASS**
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `12eaa388` |
| S3 immutable staging candidate | `0ada1ca38352a12ec35e1480da0ee8f241f2520b` (re-pinned, §5) |
| Communications PR #183 / Intelligence PR #185 | untouched |

**Changed files:** `web/src/lib/listingQuality.ts` (new), `web/src/lib/listingQuality.test.ts` (new), `web/src/components/sell/ListingQualityPanel.tsx` (new), `web/src/pages/SellFlow.threeMeasurements.test.tsx` (new), `web/src/pages/dashboard/owner/SellVehicle.tsx`.

## 2. Starting position

**Publication Readiness already existed and was well built.** `VehicleCompletenessPanel` reads governed evidence requirements, separates blocking from advisory, distinguishes `verified / present / pending / missing / rejected / expired / not_applicable`, and states plainly when publication is blocked. It was not rebuilt.

What was missing was the other two of the three measurements Invariant 6 requires — and, critically, any mechanism holding them apart.

## 3. The risk this phase had to manage

Before S7 there was one measurement, so there was nothing to collapse. **The risk arrives with the second block**: a percentage shown beside a car is read as a verdict on the car unless the page says otherwise. A seller who uploads eight photos and writes four hundred characters has a stronger **advertisement**; CarUp has verified exactly as much as it had before.

## 4. What S7 delivered

**Listing Quality** (`listingQuality.ts`) — seven concrete checks over seller-supplied inputs only: photo count, photo depth, a chosen cover (S4), description written, description detailed, features listed, and how many buyer filters the listing can actually be found by (S6). Banded as *Needs work / Getting there / Strong*.

The separation is enforced as arithmetic and vocabulary, not as tone:

- **No governed input reaches it.** Evidence state, verification status and Trust position are not parameters. A perfect score is reachable with zero evidence — which is exactly why it may never be presented as verification.
- **No verification vocabulary anywhere.** Tests scan every check label, every suggestion and the band itself for `verified|trust|certified|approved|inspected|proof`. The band words were chosen to share no vocabulary with Trust — *"Strong"* describes an advertisement; *"trusted"*, *"gold"* and *"certified"* are forbidden.
- **Suggestions are recommendations, and say so**: *"These are recommendations. None of them blocks publication."* — the distinction that keeps them from being read as the publication requirements listed beside them.
- **Monotonic**: proven to rise as the seller adds real content, so the number cannot reward nothing.

**Canonical Trust is pointed to, never restated.** The third block carries **no number at all** and links to the Passport. A seller-side copy of a Trust position is how a score drifts from the `calculation_version` that makes it attributable — the defect this repository already documents for `vehicle.trust_score` leaking onto a passport beside a `not_evaluated` report. The test asserts the block contains no percentage and no score field.

**On-screen scope statements.** Listing Quality declares what it is and what it is not: *"How strong your advertisement is. This is separate from whether CarUp can publish the listing, and separate again from what CarUp has verified about the vehicle."*

## 5. A CI failure I caused, found and fixed — recorded rather than hidden

The `CI` workflow failed at heads `e3881eb0` and `fc98bc8a` with **one** failing backend test out of 4419:

```
not ok 3511 - EVERY executable migration in database/migrations parses cleanly
  20260828160000_seller_s3_location_visibility_province_only.sql: MISSING_UP_MARKER
```

**Cause.** The S3 migration used `-- Up` / `-- Down` while `backend/db/migrationParser.js` enforces `-- +migrate Up` / `-- +migrate Down` for every executable migration.

**How it escaped.** Local verification covered the seller and privacy suites but **not** `migration-integrity.test.js` — the suite that owns exactly this contract. A migration reached staging on markers the repository does not accept.

**Fix.** Canonical markers in the migration, and the staging runner's Up extraction moved to the same markers so the file and the parser read it identically rather than the script carrying a private convention. The gate was re-pinned to `0ada1ca3`.

**Staging impact: none.** The constraint applied under version `20260828160000` was already in force and correct; the apply step is idempotent. This changed how the file is *parsed*, not what staging holds — re-verified after the fix: `vocabulary_in_force: ["province_only","public","withheld"]`, `provenance_guard_present: true`, distribution unchanged at 36 `(null)` / 2 `public`.

**Correction to the S4 and S6 receipts.** Both recorded their CI evidence before this run completed. Their local and staging evidence stands as written, but `CI (lint · types · build · tests)` was **red** at those two heads for the reason above and is **green** at `12eaa388`, which contains all of S4, S6 and S7.

## 6. Evidence at `12eaa388`

| Check | Result |
|---|---|
| **Full backend suite** (`node --test backend/tests/`, CI env contract) | **4398 pass / 0 fail** (30 skipped) |
| `npx vitest run` (full web unit suite) | **118 files / 1175 tests passed** |
| `npm run build` (`tsc -b && vite build`) | **exit 0** |
| ESLint on changed files | **exit 0** |
| `listingQuality` (by execution) | **7/7 passed** |
| `SellFlow.threeMeasurements` (real post-save render) | **5/5 passed** |
| `migration-integrity` | **24/24 passed** |

**CI at `12eaa388` — all ten workflows green:** CI (lint · types · build · tests), Marketplace Reference Regression (exact-head + unmocked staging certification), Seller S0 Global Taxonomy Staging Gate, **Seller S3 Location Visibility Staging Gate**, Marketplace Reference Media Staging Apply, Diaspora Phases 3–7 Validation, Navigation Intelligence CI, Communication Command Center CI, Referral Engine CI, Diaspora Deployed Staging UAT (skipped by design).

## 7. Decision

> **S7 — PASS.** A seller can now distinguish blocking requirements, recommendations and verified Trust state, because the three are separate blocks with separate scopes — held apart by what each one is allowed to read, not merely by how it is worded.

**Next:** S5 (Embedded Verify & Evidence Reconciliation) and S8 (Publish, Edit & Manage Lifecycle) are the remaining self-contained phases. S9 and S10 have hard external-lane dependencies (#185 Intelligence, #183 Communications) and S12 requires owner authority — see the programme summary.
