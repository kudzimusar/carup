# S6 Certification Receipt — Actual Buyer Preview & Searchability Proof

**Programme:** Seller Journey 1.0
**Phase:** S6 — Actual Buyer Preview & Searchability Proof
**Decision:** **PASS**
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `fc98bc8a` |
| Communications PR #183 / Intelligence PR #185 | untouched |

Remote head re-read (`e3881eb0`) before push. No migration, no backend change.

**Changed files:** `web/src/lib/sellerListingPreview.ts` (new), `web/src/lib/sellerListingPreview.test.ts` (new), `web/src/pages/GuestSell.tsx`, `web/src/pages/GuestSell.preview.test.tsx` (new).

## 2. The defect: an approximate preview, and a fabricated zero inside it

S6's rule is blunt — *"Reuse the actual Marketplace listing card… No separate approximate preview model."* The guest preview was precisely what that forbids: a bespoke layout showing the seller something no buyer would ever see, free to drift from the real card with every Marketplace change.

It was also not merely approximate. It rendered:

```
{Number(form.mileage || 0).toLocaleString()} km
```

so a seller who had not yet entered mileage was shown **"0 km"** — a fabricated reading for an unknown fact, indistinguishable from a real one. This is the defect class the marketplace summary already documents in its own comments (*"a $0, 0 km, year-0 listing that a shopper cannot tell from a real one"*), reappearing on the seller's side of the same product.

## 3. What S6 delivered

**The preview is now the buyer's own control.** `MarketplaceListingCard` renders it, fed by a shared `sellerDraftToCardModel`. The seller sees the real thing, and it cannot drift from the Marketplace because it *is* the Marketplace component.

Two rules govern every field of the model, each held by test:

1. **Unknown is null, never zero.** Blank, non-numeric and negative entries all resolve to `null`, and the card prints its own honest missing state. A genuine `0` survives — 0 km is a real reading a new vehicle can have.
2. **A draft borrows no authority.** `trust: null`, `plateVerified: false`, `partSentryChecked: false`, `carupGold: false`, `reserved: false`, `labels: ['Draft preview']`, `sellerLabel: 'Seller identity not published'`. The unchecked-plate sentence is read through the Marketplace's **own** `plateStatusLabel` helper rather than invented for the preview, so the two surfaces cannot say different things about the same absence. A preview that flattered the listing would be a preview of a different listing.

**Discoverability summary**, exactly as the plan specifies (`Toyota · Hilux · Pickup · Diesel · Automatic · Harare · 2021`). A facet the seller has not supplied is **omitted**, never padded — listing it would tell the seller their vehicle is findable by something it is not — and the page states plainly: *"A filter you have not answered will not match this listing."*

**The old model is gone, not bypassed.** `PreviewFact`, the helper that existed only to render the approximate layout, is deleted, and a test asserts it cannot return.

## 4. Evidence-quality note, stated rather than implied

The preview **model** is proven by execution — 7 tests covering the card model and the facet list, including the fabricated-zero case directly.

The **page wiring** is asserted at source. The guest preview is step 4 of 4 and steps 2–3 gate on Radix `Select` fields that `fireEvent.change` cannot drive, so a render-level assertion on the preview step is not reachable in jsdom without testing the select implementation instead of the subject. The rendered preview is exercised by the unmocked staging certification in `e2e/`. Source assertions run against **code with comments stripped** — the page now quotes the removed defect to explain it, and a comment naming a fault is the opposite of committing it (same helper and rationale as `VehicleDetail.media.test.tsx`).

## 5. Evidence at `fc98bc8a`

| Check | Result |
|---|---|
| `npx vitest run` (full web unit suite) | **116 files / 1163 tests passed** |
| `npm run build` (`tsc -b && vite build`) | **exit 0** |
| ESLint on changed files | **exit 0** |
| `sellerListingPreview` (model, by execution) | **7/7 passed** |
| `GuestSell.preview` (wiring) | **5/5 passed** |

**CI correction.** `CI (lint · types · build · tests)` was **red** at `fc98bc8a` — one backend test, `migration-integrity`, failing on the S3 migration's marker convention, unrelated to S6's changes. It is documented and fixed in the S7 receipt §5, and all ten workflows are **green** at `12eaa388`, which contains all of S6. Marketplace Reference Regression, both staging gates and every other workflow were green at `fc98bc8a` itself.

## 6. Decision

> **S6 — PASS.** The seller now previews the actual Marketplace listing card rather than an approximation of it, built under rules that keep an unanswered question unanswered and refuse a draft any authority it has not earned. The discoverability summary tells the seller exactly which filters will find this listing — and, as importantly, that the ones they skipped will not.

**Next:** S7 — Publication Readiness & Listing Quality, which must keep Publication Readiness, Listing Quality and Canonical Trust independently calculated and independently presented.
