# I6 — Listing Completeness & Lost Opportunity, and the I2–I5 Review Remediation

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Status:** I6 complete; the adversarial review of I2–I5 is resolved and its findings pinned by regression tests.

---

## Part 1 — I6: Listing Completeness (LC1) and Lost Opportunity (LO1)

| Artefact | Path |
|---|---|
| Service | `backend/services/intelligence/listingCompletenessService.js` |
| Wired into | `getListingInsights` → `GET /api/marketplace/my-listings/:vin/analytics` |
| Tests | `backend/tests/intelligence-listing-completeness.test.js` (26 tests) |

### Completeness is structurally not Trust

Trust and transaction readiness are returned in a `displayed_separately` block that no scoring path can reach, so a future edit cannot quietly fold evaluation state into the percentage. A test proves a high-trust listing and an unevaluated one with identical information score **identically**. `not_evaluated` stays `not_evaluated` and never becomes 0 or "poor" — and trust is read from the canonical trust service, never from the `vehicles` trust columns, which #164 demoted precisely because projecting them published `trust_score: 84` beside a report saying `not_evaluated`.

### Three of the plan's twelve groups cannot be measured, and say so

Checking the live schema first changed the design:

- **"useful description"** — `vehicles` has **no description column at all**.
- **"exterior media coverage" / "interior media coverage"** — `listing_images` records only `is_primary` and `display_order`, with no view classification, so the two cannot be told apart.

Scoring these from something adjacent would be fabrication; dropping them silently would overstate a seller's completeness. Both are refused: the score publishes its own denominator, and a 100% listing still shows what was *not* assessed.

The nine measurable groups score over fields verified present in the live `vehicles` schema. `seller_presence` scores `current_seller_type`, not `current_seller_id` — the id is a `PRIVATE_VEHICLE_FIELD` under the #164 contract, and the type answers the same question without touching a private column.

### Lost Opportunity only claims what it can prove

LO1 counts a missed search **only** when the listing satisfies every *other* filter that search applied. A search the listing would have failed anyway is never counted — telling a seller they lost it would be false. An unrecognised filter makes the search ineligible rather than assumed-matching.

The plan's flagship example is a **location**-filter miss. Location is recorded but is **not a marketplace search filter yet**, so no location lost-opportunity can honestly be reported. It is declared in `not_yet_measurable` rather than quietly omitted, and becomes computable the moment location is filterable.

Next-best-actions rank observed missed searches (evidence) above completeness gaps (advice), and a test asserts no nudge promises a benefit CarUp has not measured.

### A governance guard caught a real design problem

The #164 test *"no fourth vehicle allow-list exists"* failed on the first version of this service. That guard fixes the number of vehicle column allow-lists at two, because a third is a place private columns leak. Complying improved the design rather than working around it: the guidance read now uses the canonical `LISTING_SELECT_COLUMNS_WITH_CLAIMS` projection instead of `select('*')` (which had been pulling engine/chassis/plate into memory), the rubric is not exported as a column-shaped literal, and trust comes from the canonical service.

---

## Part 2 — Adversarial review remediation

A four-lens adversarial review (security, number-correctness, regression, failure-modes) was run over the accumulated I2–I5 code. It found defects that would have shipped as confident wrong numbers. **The I3a live controlled run only exercised the server-emitted path — which is exactly where the client-path blockers hid.**

### Blockers: actively harmful, or entirely dead

| Defect | Consequence |
|---|---|
| `resolveApiBaseUrl()` called with no arguments | Falls through every environment branch to the **production** base. A staging tester's session token would have been sent to the production API and their behaviour written into production rollups. |
| Flush POSTed to `${base}/api/intelligence/activity` when the base already ends in `/api` | Every client event 404'd — invisibly, because the request never reached the route that counts loss. |
| `optionalAuth` passed uncalled | Express treats the factory as the middleware; it never calls `next()`, so every ingestion POST hung until socket timeout on a public unauthenticated route. |
| `recordServerEvent` wrote `exclusion_flags: []` and no emitter passed any | The whole exclusion machinery was **inert for every headline metric**: a dealer refreshing their own listing inflated their own demand, fixture VINs counted as real shoppers, `self_traffic_views` was a permanent zero — while the rollup comments and the migration both claimed the opposite. |
| Seller grain keyed on `owner_id`; inquiries key on `current_seller_id` | **32 of 38 staging vehicles have the two differing.** Seller lead counts were zero for ~84% of listings, and the governed seller could not read their own analytics at all. |
| Seller/tenant buckets built only from listings with ledger events | A lead arriving by WhatsApp produced a pulse of all zeros marked `value` — the fake-zero defect this programme exists to remove. |
| `rollupDay` had **no caller anywhere**, and freshness gated on *today* | Both meant every rollup table stayed empty and every projection reported `unavailable` forever. |

### Majors

Unpaginated reads (PostgREST's 1000-row cap silently truncated a busy day while the run still reported `completed`); authority read failures swallowed as zeros inside a completed run; conversion rates that could exceed 100% (a WhatsApp lead never passed through a view); free-text metadata accepting any 128-character string, making `affordance`/`country`/`step` a channel into a store retained 24 months; `syntheticAuthorized` falling back to `NODE_ENV !== 'production'` — the exact pattern that became an open door when CarUp ran `NODE_ENV=test` inside a staging Production environment; a header-asserted identity written as authenticated, fabricating behavioural history about a named person; erasure nulling the session key so recomputing a certified day silently lowered its unique counts; non-atomic ingestion counters losing counts in the module whose purpose is making loss visible; and an anonymous visitor's session reset on **every page load**, because `!isAuthenticated` is a guest's steady state, not a logout.

### Remediation

All of the above are fixed, plus a new `20260827140000_intelligence_post_review_hardening.sql` (erasure no longer touches the session key; an atomic `ON CONFLICT` counter RPC) and a new `intelligenceRollupRoutes.js` giving `rollupDay` a privileged, bounded caller. **28 regression tests** in `intelligence-review-regressions.test.js` pin every finding.

---

## Evidence

- **Backend suite: 4,515 tests, 0 failures** under the `ci.yml` env contract.
- **Web:** typecheck clean; activity client 21/21.
- **`migration_pglite_check.mjs`: overall PASS** with all three Intelligence migrations.
- **Live staging, the verification that was missing:** an authenticated client ingestion POST against the deployed preview returned `202 in 0.49s` (previously it hung), and a controlled batch of 5 events returned exactly `accepted: 3, rejected: 1, duplicates: 1`. Reading the rows back proved:
  - the smuggled `affordance: "alice@example.com +263771234567"` was **dropped** — `metadata: {}`;
  - the forged `marketplace_listing_saved` was **rejected**, never written;
  - the repeated impression **deduped**;
  - `country: "ZW"` and the share enums were accepted;
  - `bot_suspect` was correctly stamped (curl's user agent), proving the exclusion machinery fires end-to-end.
- Staging left at **0 rows** across the ledger, counters and rollups.

---

## What this changes about the earlier receipts

The I3a and I4 receipts asserted that self-traffic was excluded from seller-facing numbers. **That was false at the time**: the rollup filters were correct, but nothing ever set a flag for them to filter on. It is true now, and a regression test holds it. This correction is recorded here rather than by quietly editing those receipts.

---

## I6 gate statement

Completeness is explainable field-by-field, never masquerades as Trust, and publishes its own denominator including what it cannot measure. Lost Opportunity claims only searches the listing would otherwise have matched. The I2–I5 review is resolved with every finding pinned by a test and the client path verified live for the first time.

**Next: I7 (Seller/Owner Intelligence surfaces).**
