# S3 Certification Receipt — Seller Identity, Dealer Context & Privacy

**Programme:** Seller Journey 1.0
**Phase:** S3 — Seller Identity, Dealer Context & Privacy
**Decision:** **PARTIAL PASS** — consent controls delivered and certified; two items explicitly deferred with reasons (§5)
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `00c46e80` |
| Communications PR #183 | `507530aadff17ec8aa4830d3cb392efda6876031` — untouched |
| Intelligence PR #185 | `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` — untouched |

Remote head re-read (`ab7b86b9`) immediately before push. No third source-write lane opened. No migration, no schema change.

**Changed files:** `backend/server.js`, `backend/tests/seller-consent-controls.test.js` (new), `backend/tests/seller-data-contract-completeness.test.js`, `web/src/pages/dashboard/owner/SellVehicle.tsx`, `web/src/pages/SellFlow.consent.test.tsx` (new).

## 2. The defect: governed reads, unreachable writes

Two consent decisions were fully governed on the **read** side and unreachable on the **write** side.

**Location visibility (S0-P0-10).** `POST /api/vehicles/add` already accepted `location_visibility` and already failed closed — anything that was not an explicit `'public'` withheld. `toLocationClaim` already gated city/province/country on it. But no Sell surface offered the control, so every seller's location was published *because they typed it into a listing form*, not because they chose to publish it. The handler's own comment named the gap exactly:

> "Adding a control to the form is what would make this a seller's choice rather than a default."

**Public seller identity.** `public_seller_display_enabled` is read fail-closed with `=== true`, drives `currentOwnerVisible`, and is projected to buyers as `seller_public_profile_enabled`. The write path **never accepted it at all**, so there was no path by which any seller could switch their public identity on. Measured previously at false on 16 of 16 staging rows — not because sellers chose privacy, but because the choice did not exist.

## 3. What S3 delivered

Both decisions are now explicit seller choices, presented on the Location & Pricing step — the seller meets the location control in the same place they enter the location it governs.

- **Both default to the private answer.** `locationVisibility: 'withheld'`, `publicSellerDisplay: false`. Publishing is something a seller chooses; silence never chooses it for them.
- **Consequences are stated before publication, not discovered after it.** The panel tells the seller that a withheld location means "Buyers will not see where the vehicle is" **and** "Location filters will not match this listing" — the discovery cost of privacy, disclosed at the moment of the decision.
- **Identity consent is resolved with `=== true`** on the write path, matching the read path. Coercion would let a stray `'false'` string or a `1` from a form serializer publish a person who never agreed to be published. The test asserts `undefined`, `null`, `'true'` and `1` all resolve to **off**.
- **Both values are written**, not merely accepted: `listing_location_visibility` and `public_seller_display_enabled` are on the persisted row, so it records a decision the seller actually made rather than a column default.

**Guest surface disposition:** the guest draft deliberately carries no consent decision. A guest cannot publish — the draft is claimed at authenticated submit, which is the moment of real publication commitment and the moment the consent question is asked. This keeps a consent decision out of browser `sessionStorage`.

## 4. A hole in the S2 gate, found and closed

Implementing this exposed a genuine hole in the completeness gate written one phase earlier: it inspected only the request **destructure**, so a field reached as `req.body.x` — which is how `location_visibility` and `public_seller_display_enabled` are both read — was just as accepted and just as capable of being dropped unnoticed. The gate now covers **both** access patterns and names a canonical destination for each of the six direct reads.

## 5. Deferred, with reasons

- **"Province only" location visibility.** The plan's three-way location control (city+province / province only / hidden until inquiry) needs a third vocabulary value. `attestedValue` already supports **per-leaf** withholding, so the projection can express it — but `listing_location_visibility` is pinned by a database CHECK constraint (`vehicles_listing_location_visibility_vocabulary`) and by a test asserting the migration's declared vocabulary equals `Object.values(CLAIM_VISIBILITY)`. Adding a value therefore requires a **migration altering a governed privacy constraint**, plus an extension of the immutable-candidate S0 staging gate. That is a deliberately separate, explicitly scoped slice rather than something to fold into a UI change. The two-value control shipped here is honest and complete on its own terms.
- **Dealer branch context.** `dealer_branches` exists in `dealerComplianceService`, but branch is not part of the vehicle listing contract. Dealer/tenant *identity* is already governed (`buildVehicleListingCandidate` derives `owner_id`/`tenant_id`/`current_seller_type` as Private Owner vs Dealer). Adding branch to a listing is a schema change to the listing contract and is scoped with the province-only slice.
- **Communication preferences.** Communications-owned per Invariant 4 (#183 / Communications 2.0). Certified at S10, not rebuilt here.

## 6. Evidence at `00c46e80`

| Check | Result |
|---|---|
| Backend privacy + seller suites (`seller-consent-controls`, `seller-data-contract-completeness`, `seller-stated-data-reaches-buyers`, `issue164-phase4-seller-location`, `issue164-phase4-sentinel`, `issue164-phase0-public-projection`, `issue164-phase1-read-contract`) | **175/175 passed** |
| `npx vitest run` (full web unit suite) | **113 files / 1143 tests passed** |
| `npm run build` (`tsc -b && vite build`) | **exit 0** |
| ESLint on changed files | **exit 0** |
| S3 suites specifically | `seller-consent-controls` 5/5, `SellFlow.consent` 5/5 |

The 175-test backend set deliberately includes the full Issue #164 privacy and read-contract suites, because this change touches a consent column: they pass unchanged, confirming no private field became reachable and no claim gate weakened.

## 7. Decision

> **S3 — PARTIAL PASS.** The two consent decisions CarUp already governed are now decisions the seller actually makes, defaulting to private, with their discovery consequences disclosed at the point of choice. The three-way location vocabulary and dealer branch require a governed-constraint migration and are scoped as an explicit follow-on slice rather than silently dropped.

**Next:** the deferred migration slice (province-only visibility + dealer branch), then S4 — Listing Media Studio, which owns the primary-photo contract recorded in S0-P0-09.
