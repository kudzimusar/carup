# S5 Certification Receipt — Embedded Verify & Evidence Reconciliation

**Programme:** Seller Journey 1.0
**Phase:** S5 — Embedded Verify & Evidence Reconciliation
**Decision:** **PASS**
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `7b1ecda5` at S5 certification |
| Communications PR #183 | `507530aadff17ec8aa4830d3cb392efda6876031` — untouched |
| Intelligence PR #185 | `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` — untouched |

Live heads re-read before starting; PR #182 was at `abc11e96` with all ten workflows green and no drift from the handoff SHA. A new branch `docs/vehicle-passport-trust-lifecycle-1-0-plan` appeared during reconciliation: it is **documentation-only** and names #182 as the owner of "active Seller/Marketplace contracts", so it opens no competing lane.

**No migration. No schema change.** Every input S5 consumes already existed.

## 2. What already existed — and was not rebuilt

CarUp **already detected** the plan's reference case. `extractionService.computeMatchStatus` compares an OCR-extracted document field against the vehicle row and writes `match_status: 'mismatch'`, and `year` is one of the eight compared identity fields. The resolution vocabulary existed too: `review_status ∈ {pending, confirmed, rejected, amended, waived}`, written by the existing reviewer route.

So S5 built **no** second evidence store, **no** second discrepancy engine, **no** second verification architecture and **no** new table.

## 3. The two gaps — and they were the whole phase

**The seller could not SEE it.** `GET /api/vehicles/:vin/extractions` is `PRIVILEGED_ROLES`-only. The one person who could explain why their registration document disagrees with their entry was the one person never shown it.

**It could not STOP anything.** `evaluateCompleteness` never read `vehicle_document_extractions`. A listing whose registration document said 2019 while the seller said 2020 — detected, stored, sitting in the reviewer queue — published **exactly like a clean one**. That is precisely the failure S5's gate exists to prevent.

## 4. What S5 delivered

### 4.1 The reconciliation read model

`backend/services/evidence/sellerFactReconciliation.js` — pure over pre-fetched rows, like `vehicleFactResolver`, importing no database client. It **resolves nothing itself**. The authority rules, each held by test:

| Rule | How it is enforced |
|---|---|
| A seller statement is never overwritten | Both values travel, separately attributed. There is deliberately **no `resolved_value`** in the output, so a caller cannot mistake the model for an authority. The input row is not mutated. |
| Evidence is what the document says, not what CarUp verified | `evidence_indicated` is an OCR reading. `evidence_verified` becomes true only on `confirmed`/`amended` — never because a document exists, never because confidence was high. |
| Only a human decision resolves | `pending` stays unresolved regardless of confidence. All four review verdicts resolve. |
| A comparison that could not be made is not a contradiction | `missing_reference` and `inconclusive` → `not_comparable`, never blocking. |
| Missing stays missing | No reading at all → `no_evidence`. Not agreement, not a failure. |
| Agreement ≠ verification | A matching document is `agrees` with `evidence_verified: false`. |

Superseded readings are **counted**, not dropped, so a single reported value never implies only one document was read. The read model carries no reviewer identity, file locator, AI job id or model name — asserted by serializing and searching for each.

### 4.2 The gate, inside the canonical evaluator

A `fact_reconciliation` blocking requirement was added **inside** `evaluateCompleteness` rather than beside it. The publish route already gates on `is_publishable` and already discloses `blocking_gaps`/`pending_gaps`; a parallel gate would give CarUp **two answers** to "may this publish?".

- It **names the disagreeing fact** (`Resolve document disagreement: year`) rather than refusing anonymously — the defect the publish route already had to fix once for pending ownership documents.
- Status is `pending_review`, not `missing`: the seller *has* supplied the document, and a human decision is what clears it. "Missing" would tell them to upload it again.
- It **fails closed**. A gate that cannot read its own input throws rather than assuming the listing is clean — assuming would publish the exact contradiction the requirement exists to catch.
- The reconciliation travels on the response, so a caller learns *why* without a second round trip.

### 4.3 The seller surface

`FactReconciliationPanel` shows both readings side by side — *"You stated 2020"* / *"Registration document reads 2019"* — and states plainly that **CarUp has not changed anything**. A reviewer-confirmed reading is labelled as confirmed **on the document**, which is not the same as CarUp certifying the vehicle's model year.

It renders **nothing** when there is no disagreement, and nothing for `no_evidence`: a panel that reports "no problems" on every listing trains sellers to stop reading it. It is mounted by `VehicleCompletenessPanel` — the surface that already fetches this data — with a wiring test, because a correct component nobody renders is the "dead by construction" failure this repository has hit before.

### 4.4 No new endpoint

The existing `/api/vehicles/:vin/completeness` is already role-gated **and** ownership/tenant-scoped with a 403, and it already returns `evaluateCompleteness`. The reconciliation reaches the seller through it automatically.

## 5. Test coverage against the phase's required cases

| Required case | Covered |
|---|---|
| Seller statement agrees with evidence | ✅ `agrees`, and `evidence_verified: false` |
| Seller statement conflicts | ✅ the 2020/2019 reference case, both sides attributed |
| Evidence pending | ✅ unresolved and blocking |
| Evidence rejected | ✅ resolved; seller statement stands unqualified |
| Verified/governed result | ✅ `confirmed` records the outcome **without** rewriting the seller |
| Unresolved discrepancy | ✅ `has_unresolved_material_contradiction` |
| Publication with material unresolved contradiction | ✅ `is_publishable: false`, gap disclosed by key |
| Missing evidence stays missing | ✅ `no_evidence`; no fabricated failure or zero |
| No seller-private evidence in public projections | ✅ six structural assertions against the allow-lists |

Also covered: non-material contradictions report but do not block; a fact the seller never stated cannot be "contradicted"; the newest reading per field decides.

## 6. Evidence at `7b1ecda5`

| Check | Result |
|---|---|
| **Full backend suite** (`node --test backend/tests/`, CI env contract) | **4437 pass / 0 fail** (30 skipped) |
| `seller-fact-reconciliation` | 15/15 |
| `seller-contradiction-blocks-publication` | 10/10 |
| `seller-reconciliation-privacy` | 6/6 |
| `FactReconciliationPanel` | 9/9 |
| `npm run build` (`tsc -b && vite build`) | exit 0 |
| ESLint on new files | 0 errors |
| **CI at this head — all ten workflows** | **success** |

## 7. Two corrections made during the phase, recorded

1. **A PGlite fixture was widened, not a contract relaxed.** `issue164-codex-findings-remediation` hand-declares a schema that predated `vehicle_document_extractions` and `normalized_plate_number`, so the fail-closed evaluator correctly refused to certify against it. The fixture moved to model the real schema; making the evaluator tolerant of a missing table would have re-introduced "assume clean when you cannot read".

2. **Materiality is a predicate, not an exported array.** `issue164-phase1-read-contract` forbids a fourth exported vehicle column list under `backend/services`, and it is right to: such an array is indistinguishable *by shape* from a projection allow-list, and a projection allow-list decides what CarUp publishes. This list decides the opposite — what **blocks** publication — and is never used to query. Exposing it as `isMaterialReconciliationField()` makes that structurally true rather than merely intended, and a test asserts the module performs no query at all.

## 8. Decision

> **S5 — PASS.** A known material contradiction can no longer silently reach publication, and the seller can see the disagreement with both sources named and neither presented as the answer. Every input was already in the database; what S5 added was the reading of it, the gate on it, and the honesty about what CarUp has and has not decided.
