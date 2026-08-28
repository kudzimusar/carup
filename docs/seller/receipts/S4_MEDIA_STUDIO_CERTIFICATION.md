# S4 Certification Receipt — Listing Media Studio

**Programme:** Seller Journey 1.0
**Phase:** S4 — Listing Media Studio
**Decision:** **PARTIAL PASS** — the truth-critical items are closed and certified; three presentation refinements are explicitly deferred (§5)
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `e3881eb0` |
| Communications PR #183 / Intelligence PR #185 | untouched |

Remote head re-read (`c2311317`) before push. No migration, no backend change — the server contract was already correct.

**Changed files:** `web/src/pages/dashboard/owner/SellVehicle.tsx`, `web/src/pages/SellFlow.media.test.tsx` (new).

## 2. The defect (S0-P0-09): a badge that asserted a choice nobody made

The **server** contract was already exact and needed no change:

- a bare URL string claims nothing;
- `{ url, is_primary: true }` is the seller's explicit choice;
- two claimants are refused with a **400**, not resolved by guessing.

Its own comment records why electing one server-side is forbidden: it *"would be the same fabrication as `idx === 0`, just with more steps."*

The **form** then performed exactly that fabrication in the other direction. It painted a **"Cover"** badge on whichever photo happened to be first, and submitted bare URL strings. So:

- the seller was shown a cover selection they never made;
- nothing was sent to the server as primary;
- the listing had **no primary photo at all**;
- the badge was a claim about CarUp's data that CarUp's data did not support.

## 3. What S4 delivered

- **The seller picks the cover.** Every photo carries a *Make cover* control; the badge appears only on the chosen one.
- **Nothing claims primacy until a choice is made**, and the empty state says so explicitly — *"No cover photo chosen. Pick the photo buyers should see first — otherwise CarUp will not claim one for you."* — rather than implying a default.
- **Removing the chosen cover clears the choice.** Letting the badge slide onto whatever takes that index would re-invent a selection nobody made. Removing a photo *before* the cover shifts the stored index instead, so the same photo stays chosen.
- **The payload matches the server contract**: `{ url, is_primary: true }` for exactly the chosen photo, bare strings for the rest, and no claim at all when no cover was chosen.
- **Guided photo sequence** added as the plan specifies (Front → Rear → Driver side → Passenger side → Interior → Dashboard → Odometer → Engine → Tyres → Any known damage). It is explicitly labelled optional and carries **no verification language** — a suggested photo is not evidence, and listing media stays commercial media until separately admitted (Invariant: listing media ≠ evidence).

## 4. Evidence quality note

The S4 tests **submit through the real form and inspect the payload the server was actually handed** — `createVehicleListing.mock.calls[0][0].images` — rather than matching source. They assert exactly one primacy claimant, that it is the seller's chosen index, that unchosen photos remain bare strings, and that an unanswered cover question produces no claim at all. A source assertion would have proven the code was written; this proves the server is told the right thing.

## 5. Deferred, with reasons

- **Drag-and-drop reorder.** Ordering is currently selection order, which is honest and stable. Reorder is a presentation refinement with no truth consequence now that primacy is an explicit choice rather than a position — the two were coupled only while "first" meant "cover".
- **Automated media-quality feedback** (blur/resolution/lighting scoring). Requires an image-analysis capability that does not exist in this lane; a heuristic that told a seller their photo was "good" would be a CarUp claim about evidence quality, which S4's truth boundary does not permit without a governed source.
- **Guest-surface cover choice.** The guest draft deliberately carries no primacy decision, matching the S3 consent disposition: media primacy is chosen at the authenticated surface, which is the moment of real publication commitment. This keeps a listing claim out of browser `sessionStorage`.

## 6. Evidence at `e3881eb0`

| Check | Result |
|---|---|
| `npx vitest run` (full web unit suite) | **114 files / 1151 tests passed** |
| `npm run build` (`tsc -b && vite build`) | **exit 0** |
| ESLint on changed files | **exit 0** |
| `SellFlow.media` | **7/7 passed** |
| Sibling Sell suites (consent, identification, resilience, draft continuity) | **22/22 passed** |
| **Marketplace Reference Regression** (exact-head + unmocked staging certification) | **success** |
| Seller S0 + Seller S3 staging gates | **success** |
| Navigation / Communication / Referral / Diaspora CI | **success** |

> **Correction.** This row set was recorded before the `CI` workflow finished at this head. `CI (lint · types · build · tests)` was **red** at `e3881eb0` — one backend test, `migration-integrity`, failing on the S3 migration's marker convention, unrelated to S4's changes. It is documented and fixed in the S7 receipt §5, and is **green** at `12eaa388`, which contains all of S4.

## 7. Decision

> **S4 — PARTIAL PASS.** The cover photo is now a choice the seller actually makes, sent in the shape the server contract defines and proven by inspecting the submitted payload. The badge that asserted an unmade choice is gone. Three presentation refinements are named above with reasons rather than silently dropped.

**Next:** S6 — Actual Buyer Preview & Searchability Proof.
