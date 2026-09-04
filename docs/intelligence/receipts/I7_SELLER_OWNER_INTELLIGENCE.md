# I7 — Seller / Owner Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Resumed after:** `SECURITY_CLOSURE_G1_G2_G3.md` (moderator gate, closed at `96eccff2`)
**Status:** Marketplace Pulse and listing-level insights both shipped and wired. Mobile parity remains sequenced behind PR #182.

---

## What shipped

| Artefact | Path |
|---|---|
| Display contract | `web/src/lib/intelligenceDisplay.ts` |
| Marketplace Pulse | `web/src/components/intelligence/MarketplacePulse.tsx` |
| API fetchers | `web/src/hooks/useCarUpApi.ts` (`fetchSellerIntelligence`, `fetchListingIntelligence`) |
| Mounted on | `web/src/pages/dashboard/owner/OwnerDashboard.tsx` |
| Tests | `web/src/lib/intelligenceDisplay.test.ts` (22 tests) |

## The display contract is the point

The backend never returns a bare number — every metric arrives inside an availability envelope. `intelligenceDisplay.ts` is the **only** place a surface unwraps one, which makes it the only place a fake zero could be born. The I0 audit found a dozen existing CarUp surfaces rendering a failed read as `0`, which reads to a seller as "nobody came"; this module exists so that cannot happen again through the Intelligence path.

Concretely:

- A value is shown **only** when the backend says `value`. `unavailable` → "Not available", `insufficient_data` → "Not enough activity yet", `not_applicable` → "Not applicable".
- A **missing** metric is treated as unavailable, never as zero — an absent metric is something we did not measure, not something that did not happen.
- A number smuggled alongside a non-value state is still not displayed, so a backend bug cannot become a displayed figure.
- A genuine `0` **is** shown as `0`, and is distinguishable from all of the above.
- **Trust never renders as a low number.** `not_evaluated`, `stale` and `unavailable` are distinct states, and a score the backend withheld is never leaked — asserted directly.

## Provenance is rendered, not implied

The Pulse shows *as of* the rollup's completion time, states partial coverage in words ("Measured on 2 of the last 7 days"), and prints the `calculation_version`. A gap in measurement and a genuine zero look identical on a chart, so the gap is said out loud instead.

The empty states distinguish **"we could not read this"** from **"you have nothing listed yet"** — they call for completely different actions from the seller, and collapsing them is how a broken read starts looking like a quiet market.

## Analytics must never break the surface it sits on

Mounting the Pulse initially broke 25 existing OwnerDashboard tests: those tests stub `useCarUpApi` partially, so the new fetcher was `undefined` and the component threw, taking the dashboard down with it.

The fix was **not** to edit the guard tests — they protect issue-#128 truthfulness invariants. The component now treats an unavailable API surface as an unreadable read and renders its normal "Not available" state. That is the same rule already enforced backend-side: a telemetry failure degrades telemetry, never the product.

---

## Evidence

- **22 display-contract tests** and **22 listing-insight tests** pass, covering every non-value state, the missing-metric case, the smuggled-number case, qualifiers, provenance, trust rendering, completeness-is-not-Trust, independent performance/guidance failure, and lost-opportunity phrasing.
- **Full web suite: 108 files / 1,157 tests / 0 failures.**
- Typecheck clean; production build succeeds.
- `git merge-tree` against PR #182 head `26eb1995`: **0 conflicts**.

---

## Listing-level insights (shipped)

| Artefact | Path |
|---|---|
| Component | `web/src/components/intelligence/ListingInsights.tsx` |
| Tests | `web/src/components/intelligence/ListingInsights.test.tsx` (22 tests) |
| Wired into | `web/src/pages/dashboard/owner/MyListings.tsx` — opened on demand per listing |

Renders the discovery funnel (impressions → views → unique viewers → engaged → saves → enquiries), the three conversion rates, listing completeness with its explainable groups, lost opportunity, and next-best-action.

Two design points carried from the backend into the markup:

- **Completeness and Trust are separate blocks with separate headings**, and the completeness block states in words that it is not a Trust score. A test asserts the score is unchanged by the trust state, that `not_evaluated` renders as words with no digits, and that a `stale` evaluation never leaks the score the backend withheld.
- **Performance and guidance fail independently.** Completeness needs no rollup, so a rollup outage shows "could not be read" for the funnel while still showing the advice a seller can act on today. A single failure never hides both.

Lost opportunity is phrased as a matching statement with its observed count ("could not be confidently matched … 42 searches"), and a test asserts the action list promises no benefit CarUp has not measured.

The panel is opened on demand rather than fetched with the page, so a listing list does not pull analytics nobody asked for.

### PR #182 coordination — checked, not assumed

Per the moderator's constraint, #182's exact head was re-checked immediately before wiring: **`26eb1995`**. That lane owns `MyListings.responsive.test.tsx`, which reads `MyListings.tsx` **as a source string** and pins three patterns (a wrapping action row matching `className="flex[^"]*gap-2 mt-3"`, the `Publish to Marketplace` CTA, and the `listing-actions-` testid). Its branch does **not** modify `MyListings.tsx` itself — `git diff origin/main …182 -- MyListings.tsx` is empty — so the test is a guard on existing content rather than a rewrite of the flow.

The integration was therefore made strictly additive: the toggle and panel sit **after** the guarded action row, which is left byte-identical. All three of #182's assertions were re-run against the modified file and still hold, and `git merge-tree` against `26eb1995` reports **zero conflict markers** with the wiring applied.

### One thing deliberately left alone

`MyListings.tsx` still renders "Views not tracked" on the listing row. Organic views *are* now recorded in the ledger (I3a), but the row reads `listing.viewCount`, which the listing endpoint does not populate — so changing that text without changing its data source would replace one honest statement with a misleading one. Real figures appear in the insights panel, which reads the governed projection. Surfacing them on the row itself belongs with a listing-summary change in the marketplace lane.

---

## Remaining in I7

- **Mobile parity**, sequenced behind PR #182 for the same reason as I3c.
- Figures will read as genuine zeros until impression instrumentation lands (also behind #182) and a rollup has run; `coverage` and the as-of line make that visible rather than mysterious.
