# S2 Certification Receipt — Canonical Commercial Listing Data

**Programme:** Seller Journey 1.0
**Phase:** S2 — Canonical Commercial Listing Data
**Decision:** **PASS**
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `ab7b86b9` at certification |
| Communications PR #183 | `507530aadff17ec8aa4830d3cb392efda6876031` — untouched |
| Intelligence PR #185 | `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` — untouched |
| Seller docs PR #186 | this receipt |

Remote head re-read before each push. No third source-write lane opened.

**Changed files (S2):**

| File | Change |
|---|---|
| `backend/tests/seller-data-contract-completeness.test.js` (new) | self-updating write-side gate |
| `backend/tests/seller-stated-data-reaches-buyers.test.js` (new) | read-side gate |
| `backend/utils/publicVehicleProjection.js` | four seller-stated fields added to the public projection |
| `web/src/pages/VehicleDetail.tsx` | reads the fields the projection publishes; labels them |
| `web/src/pages/VehicleDetail.sellerStatement.test.tsx` (new) | buyer-facing render proof |
| `web/src/types/index.ts` | `Vehicle` carries the four seller-stated fields |

No migration, no schema change.

## 2. Work already complete before S2 — not rebuilt

S0 had already closed the headline S2 persistence P0s inside PR #182: `seller_description`, `seller_features`, `body_style`, `seller_stated_condition` and `drivetrain` all have canonical columns and are written by `POST /api/vehicles/add`, with body style and seller condition kept out of the governed `vehicle_condition_category`. Per the handoff rule, this was treated as **done** and re-audited rather than reimplemented.

**Write-path audit result:** the handler accepts 26 named fields; every one has a canonical destination — direct columns for the specification and identity dimensions, `seller_description`/`seller_features`/`body_style`/`seller_stated_condition`/`seller_condition` for the seller's commercial statements, `listing_city`/`listing_province` (with provenance) for location, `import_source` for import state, `submittedMedia` for images, and the candidate builder for price/year/owner/tenant. **Zero accepted fields are silently discarded.** The authenticated Sell payload sends all 23 business form fields; guest data reaches the same path through the S1-guarded draft claim.

## 3. Defect found and closed — the read half of the invariant

The invariant is *ask once → store once → provenance once → **reuse everywhere***. The write half was done; the read half was not.

`PUBLIC_VEHICLE_FIELDS` — the allow-list behind `/api/vehicles/:vin/passport` and `/api/vehicles/:vin/details` — carried **none** of the four seller-stated commercial fields. Consequently, on Vehicle Detail:

- `vehicle.description` was a **dead key**. A seller could write a full description and no buyer would ever see a character of it.
- `vehicle.features` was a **dead key**. The Features block could never render.
- `vehicle.condition` was a **dead key**. The Condition tile rendered **"Not recorded" for every vehicle on the platform**.
- Body style was collected, stored, taxonomy-resolved — and displayed nowhere.

This is the same defect class this page's own comments already document for the photo gallery ("a key the passport body does not have… which is how a car with photos on its Marketplace card ended up announcing that it had none"). The Marketplace *listing summary* projected all four correctly, so the two surfaces disagreed about the same vehicle.

### Fix

1. `PUBLIC_VEHICLE_FIELDS` now carries `body_style`, `seller_stated_condition`, `seller_description`, `seller_features`.
2. Vehicle Detail reads those fields (legacy `description`/`features` retained only as fallbacks for already-listed marketplace responses).
3. Body style and seller condition render as spec tiles; missing values keep saying **"Not recorded"** rather than guessing (Invariant 8).

### Privacy disposition

This changes **the projection, not the audience**. The Marketplace listing summary already publishes exactly this seller copy to the same anonymous callers. None of the four fields appears on `PRIVATE_VEHICLE_FIELDS`; the existing invariants (`public ∩ private = ∅`, `PUBLIC_VEHICLE_SELECT ≡ allow-list`) are derived from the list itself and continued to hold — all 63 tests in `issue164-phase0-public-projection` and `issue164-phase1-read-contract` pass unchanged.

### Authority disposition (Invariant 2 / S0-P0-04)

The seller's condition is captioned **"Condition (seller-stated)"** and the features heading reads **"Features stated by the seller"**. CarUp's governed `vehicle_condition_category` remains a separate field answering a separate question. The render test asserts the tile carries the word "seller" and carries **no** governance language (`verified|certified|confirmed|inspected`).

## 4. The gate is now self-updating

The pre-S2 guard was a fixed allow-list of seven field names: it could confirm the fields someone remembered to list and stayed silent about a **new** field added to the request destructure and then forgotten in the write — precisely the shape of S0-P0-06.

`seller-data-contract-completeness.test.js` reads what the handler **actually accepts** and asserts each field reaches a **named** canonical destination. Adding a field without persisting it now fails by name with nobody editing the test. Indirect destinations are named explicitly rather than pattern-matched, so renaming a column cannot silently satisfy the guard.

**Mutation-checked:** adding `service_history_note` to the destructure without persisting it fails with
`these fields are accepted from the seller but this guard knows no canonical destination for them: service_history_note`.

## 5. Deferred by design (recorded, not silently dropped)

- **Generation / trim (S0-P0-07)** — accepted and persisted by the backend; not collected by either Sell form and carrying no taxonomy data yet. Leaving them unasked is honest; they are not in the S2 required set.
- **Primary photo (S0-P0-09)** → S4 Listing Media Studio.
- **Location visibility (S0-P0-10)** → S3 Identity, Dealer Context & Privacy.
- **Dealer branch** → S3.

## 6. Evidence

**Local, at `ab7b86b9`:**

| Check | Result |
|---|---|
| `npx vitest run` (full web unit suite) | **112 files / 1138 tests passed** |
| `npm run build` (`tsc -b && vite build`) | **exit 0** |
| Backend seller + projection + read-contract suites | **74/74 passed** |
| VehicleDetail suites (media + trust + sellerStatement) | **128/128 passed** |
| ESLint on changed files | no new errors (4 pre-existing in `types/index.ts`, identical on the untouched baseline) |

One full-suite run showed a single load-related timeout in `VehicleSearch.test.tsx` (3653 ms on a test that passes in 11/11 in isolation, with no causal path from these changes — that suite fully mocks the API and never renders VehicleDetail). A clean re-run passed **112/112 files, 1138/1138 tests**. Recorded rather than hidden.

**CI at the S2 head `ab7b86b9`:**

| Workflow | Result |
|---|---|
| **Marketplace Reference Regression** (exact-head reference + unmocked staging certification) | **success** |
| Seller S0 Global Taxonomy Staging Gate | success |
| Marketplace Reference Media Staging Apply | success |
| Diaspora Phases 3–7 Validation (backend, build, Playwright, staging-integration) | success |
| Navigation Intelligence CI | success |
| Communication Command Center CI | success |
| Referral Engine CI | success |
| CI (lint · types · build · tests) | success |

**An intermediate red, resolved and recorded rather than hidden.** At `b6f9e7f9` — a commit that added only a backend test file and changed no runtime code — the unmocked staging certification failed on `vehicle-intelligence-story` visibility, with `listing-media-block` marked *flaky* in the same run. Both assertions depend on the branch backend preview responding, the same suite passed at `4d7b94fc` twenty minutes earlier, and preview pairing was verified correct (branch web ↔ branch backend preview, not shared staging). The suite then passed at `ab7b86b9`, which contains strictly more runtime change including the whole Vehicle Detail edit. The failure was environmental — a cold branch backend preview — not a regression.

## 7. Decision

> **S2 — PASS.** Every field the Seller contract accepts has a canonical destination, none is silently discarded, and — newly — the seller's own commercial statements now actually reach the buyer, labelled as the seller's and never as CarUp's. The completeness gate behind this is self-updating rather than a list someone must remember to extend.

**Next phase:** S3 — Seller Identity, Dealer Context & Privacy, which owns the two deferred S0 items (location visibility as an explicit seller choice, dealer branch context) plus public seller identity on/off and communication-preference visibility.
