# S3 Certification Receipt — Seller Identity, Dealer Context & Privacy

**Programme:** Seller Journey 1.0
**Phase:** S3 — Seller Identity, Dealer Context & Privacy
**Decision:** **PASS** — consent controls, the three-way location vocabulary and its staging migration all delivered and certified. One item (dealer branch) explicitly deferred with reasons (§5).
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `c2311317` |
| S3 immutable staging candidate | `e2d393d8ac809f76afb499e2994385303371afe9` |
| Communications PR #183 | `507530aadff17ec8aa4830d3cb392efda6876031` — untouched |
| Intelligence PR #185 | `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` — untouched |

Remote head re-read before every push (`ab7b86b9` → `00c46e80` → `3c9d2348` → `c2311317`). No third source-write lane opened.

**Changed files:** `backend/server.js`, `backend/utils/publicVehicleProjection.js`, `backend/utils/checkConstraintVocabulary.js` (new), `backend/scripts/seller-s3-location-visibility-staging.mjs` (new), `database/migrations/20260828160000_seller_s3_location_visibility_province_only.sql` (new), `.github/workflows/seller-s3-location-visibility-staging.yml` (new), `web/src/pages/dashboard/owner/SellVehicle.tsx`, plus five test files.

**Schema change:** one — the additive CHECK-constraint widening in §5. **Staging only.** Production activation requires owner authority and was not performed.

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

## 5. The three-way location vocabulary — delivered

The plan's middle location answer was initially scoped as a follow-on because it needs a third vocabulary value behind a database CHECK constraint. It was then **completed in this phase**.

`province_only` discloses strictly less than `public`. Withholding is now computed **per leaf** — `attestedValue` already supported it — so the city is withheld exactly as `withheld` withholds it while province and country still publish. The properties held by test:

- a city withheld by `province_only` is **byte-identical** to one withheld outright, so the shape of the answer cannot disclose which choice the seller made;
- the disclosure ordering `public > province_only > withheld` is asserted directly, not inferred;
- the **owner audience is unchanged** — this narrows the public answer only;
- an unprovenanced location stays `not_recorded` under **every** visibility, so withholding never becomes a way of implying a location exists;
- the write path accepts the new value only as an **exact** match, so a typo or a stale client can only ever produce more privacy than the seller asked for, never less.

**Migration.** `20260828160000_seller_s3_location_visibility_province_only.sql` widens one CHECK constraint and does nothing else: writes no rows, backfills nothing, leaves `vehicles_listing_location_requires_source` untouched, and raises rather than continuing if its own pre/post digest moves. Its Down refuses to narrow the vocabulary while any seller has chosen the new value.

**Gate.** Applied by a **sibling** workflow, `Seller S3 Location Visibility Staging Gate`, pinned to immutable candidate `e2d393d8` — deliberately *not* an extension of the S0 gate, because S0 is certified against its own immutable candidate and folding S3's migration into it would invalidate a signed-off certification.

**Staging receipt (run at `c2311317`, `status: PASS`):**

| Field | Value |
|---|---|
| `vocabulary_in_force` | `["province_only", "public", "withheld"]` |
| `missing_values` / `unexpected_values` | `[]` / `[]` |
| `provenance_guard_present` | `true` |
| ledger | `20260828160000` applied |
| consent distribution | 36 `(null)`, 2 `public` — **unchanged** across apply, asserted before/after |

**A first-run failure, recorded rather than hidden.** The gate's first run refused with `constraint_present: true, vocabulary_in_force: []`. The constraint was installed correctly; the gate's own **parser** could not read it — `pg_get_constraintdef` rendered the array as `'{public,withheld}'::text[]` while the regex understood only `ARRAY['public'::text, …]`. The refusal was the correct outcome (preflight rolled back; nothing was applied) but for the wrong reason. The parser is now a pure module tested **by execution** against both renderings, because the bug was behavioural and a source assertion would not have caught it; an unreadable definition still yields no values on purpose, so the gate keeps failing closed rather than certifying a constraint it never read.

**The Issue #164 vocabulary-parity test was strengthened, not relaxed.** It previously pinned the *first* migration's declared vocabulary to `CLAIM_VISIBILITY`. It now reads **every** migration that defines the constraint and asserts two things: the vocabulary **in force** (the last definer) equals the module's list, and no migration ever declared a value the projection ignores.

## 5b. Still deferred, with reasons

- **Dealer branch context.** `dealer_branches` exists in `dealerComplianceService`, but branch is not part of the vehicle listing contract. Dealer/tenant *identity* is already governed (`buildVehicleListingCandidate` derives `owner_id`/`tenant_id`/`current_seller_type` as Private Owner vs Dealer). Adding branch to a listing is a schema change to the listing contract and is scoped with the province-only slice.
- **Communication preferences.** Communications-owned per Invariant 4 (#183 / Communications 2.0). Certified at S10, not rebuilt here.

## 6. Evidence at `00c46e80`

| Check | Result |
|---|---|
| Backend privacy + seller suites (`seller-consent-controls`, `seller-data-contract-completeness`, `seller-stated-data-reaches-buyers`, `issue164-phase4-seller-location`, `issue164-phase4-sentinel`, `issue164-phase0-public-projection`, `issue164-phase1-read-contract`) | **175/175 passed** |
| `npx vitest run` (full web unit suite) | **113 files / 1143 tests passed** |
| `npm run build` (`tsc -b && vite build`) | **exit 0** |
| ESLint on changed files | **exit 0** |
| S3 suites specifically | `seller-consent-controls` 5/5, `SellFlow.consent` 6/6, `seller-location-province-only` 7/7, `check-constraint-vocabulary` 5/5 |
| **Seller S3 Location Visibility Staging Gate** | **success** (preflight → apply → verify) |
| Seller S0 Global Taxonomy Staging Gate | success (unaffected — untouched by this phase) |

The 175-test backend set deliberately includes the full Issue #164 privacy and read-contract suites, because this change touches a consent column: they pass unchanged, confirming no private field became reachable and no claim gate weakened.

## 7. Decision

> **S3 — PASS.** The consent decisions CarUp already governed are now decisions the seller actually makes: both default to private, their discovery consequences are disclosed at the point of choice, and location now offers the middle answer — province without city — proven on staging to disclose strictly less than public while leaving every recorded consent value and the provenance guard untouched.

**Next:** S4 — Listing Media Studio, which owns the primary-photo contract recorded in S0-P0-09.
