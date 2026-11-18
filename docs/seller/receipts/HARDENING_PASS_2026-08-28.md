# Seller Journey 1.0 — Evidence-First Hardening Pass

**Date:** 2026-08-28
**Reviewer/implementer:** Claude Code
**Reviewed head:** `2121fc5e` → **fixed head `fd49f31d`**
**Scope:** highest-risk contracts only. No feature design reopened.

---

## 1. Reconciliation before review

| Surface | State |
|---|---|
| PR #182 | `2121fc5e`, OPEN, draft, MERGEABLE — **no drift**, local == remote, clean tree |
| CI at reviewed head | **all ten workflows green** |
| PR #183 / #185 | unchanged, still open and unmerged — S9/S10 remain blocked |
| **New: PR #188** `feat/vehicle-passport-foundation` | a **new source-write lane**. Diffed against our surfaces (`GuestSell`, owner dashboard, `backend/services/evidence`, `publicVehicleProjection`, `listingSummaryService`, `shared/taxonomy`) — **zero overlap**. No lane conflict. |

## 2. Defects found and fixed — five, all real

**D1 — Stale contract documentation (`completenessEvaluator.js`).** The header enumerated **five** blocking requirements after S5 added a sixth. An engineer reading it would not learn that a document disagreement blocks publication. The return JSDoc omitted `reconciliation` entirely. Both corrected, plus a note that requirement 6 keeps the evaluator's determinism promise — it reads `match_status` (a string comparison) and `review_status` (a human decision), **never** the extraction's `confidence`.

**D2 — Privacy boundary true by accident, now by test.** `trustDecisionService` consumes `evaluateCompleteness`, and its `evidence_completeness` dimension is **PUBLIC**. The S5 requirement's label names the disagreeing field (*"Resolve document disagreement: year"*). Traced end to end: the label stays private because (a) the requirement's status is `pending_review`, so it lands in `pending_gaps`, never `blocking_gaps` — and only `blocking_gaps` becomes a public reason code; and (b) `toPublicDecision` publishes `{status, value, reason_codes}` and **drops the `rest` bag** where `pending_gaps` travels. **No leak exists.** Both conditions are now pinned by a regression test, because a future change publishing `rest` would silently expose an unreviewed OCR disagreement to shoppers.

**D3 — Keyboard-invisible control.** The photo remove button was `opacity-0` with a hover-only reveal, so a keyboard user tabbing to it focused an **invisible** control — while the move buttons beside it revealed on focus. Fixed.

**D4 — Ambiguous accessible name.** Every "Make cover" button carried the same accessible name, so a screen reader announced three identical buttons with no way to tell which photo each acted on — while the move buttons correctly said *"Move photo 3 earlier"*. Now `Make photo N the cover photo`. Fixed.

**D5 — Recurring flake that could mask a real failure.** `VehicleSearch.test.tsx` intermittently exceeded vitest's 5s default under full-suite parallelism — **four times across the programme** — passing 11/11 in isolation every time. It renders a full search page with two data effects and a card grid, and unlike its heavier siblings carried no timeout budget. Raised to 30s, following the precedent `VehicleDetail.media.test.tsx` already sets. Nothing about the product is asserted by a deadline; a flake that recurs teaches people to re-run a red suite instead of reading it.

## 3. Contracts reviewed and found sound — no change needed

| Contract | Verification |
|---|---|
| Seller-stated vs governed truth | `seller_stated_condition` and `vehicle_condition_category` remain distinct on both projections; reconciliation carries no `resolved_value` |
| Publication blockers | `fact_reconciliation` lives **inside** the canonical evaluator; one answer to "may this publish?" |
| Evidence reconciliation | only a human review decision resolves; `pending` blocks regardless of confidence |
| Privacy / location leakage | `province_only` withholds the city exactly as `withheld` does; the card never names a place the passport withheld |
| Price-change ownership | route confirmed **mounted** (`app.use(vehiclesRouter)`) and scoped via `loadScopedVehicle` throwing `ForbiddenError` — not merely present in source |
| Media primacy / reorder | cover travels with the photo, not the slot; index arithmetic correct in both directions |
| Missing-value semantics | absent mileage/price are `null` on both surfaces, never 0; "looked and found none" stays distinct from "never looked" |
| Taxonomy anti-forking | anti-fork suite green; materiality is a predicate, never an exported column array |
| Cross-surface convergence | 14/14 behavioural checks through the real projections |
| Debug code / dead fields | swept all changed `.ts/.tsx/.js/.mjs`: no `console.log` outside staging receipts and pre-existing boot banners, no TODO/FIXME, no `.only`/`.skip`, no `debugger` |

## 4. Test results at `fd49f31d`

| Check | Result |
|---|---|
| Focused Seller suites (10 files) | **74 / 74 pass** |
| **Full backend suite** (CI env contract) | **4452 pass / 0 fail** (30 skipped) |
| **Full web suite** | **121 files / 1207 tests pass — no flake** |
| `npm run build` (`tsc -b && vite build`) | exit 0 |
| ESLint on changed files | 0 errors |

## 5. Residual owner risks

1. **Production schema precondition — verify before activation.** The S5 gate **fails closed**: if `vehicle_document_extractions` is absent, `evaluateCompleteness` throws and **publication breaks for every vehicle**. Confirmed present with all 11 evaluator columns on **staging**. **Production could not be verified from this session** — the read-only introspection query was blocked by the environment's safety classifier, and I did not work around it. Before any production activation, confirm in production:
   - `public.vehicle_document_extractions` exists with the 11 columns the evaluator selects;
   - `public.vehicles` carries `make, model, year, normalized_plate_number`.
   The failure mode is loud (a 500 on the completeness/publish path), not silent.

2. **S0/S3 migrations are staging-only.** The taxonomy and `province_only` visibility migrations have not been applied to production. Sequencing is the owner's call.

3. **Guest Sell still drops unsupported files silently.** The deterministic intake feedback added in S4 covers authenticated Sell only; `GuestSell` retains the older inline filter and a different cap (10 vs 15). Same defect class, lower blast radius — a guest cannot publish. Left unfixed deliberately: it needs the limit parameterised, which is feature work beyond a hardening pass. **Recorded, not silently dropped.**

4. **Dealer branch context (S3)** and **blur/lighting scoring (S4)** remain deferred with reasons in their receipts.

5. **S9, S10 blocked; S12 owner-gated.** Unchanged.

## 6. Decision

> **Hardening pass complete.** Five real defects fixed, each small; no feature design reopened. Every reviewed contract holds. The programme is at `fd49f31d` and ready for owner UAT.
