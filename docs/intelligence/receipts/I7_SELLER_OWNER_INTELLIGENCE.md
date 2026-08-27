# I7 — Seller / Owner Intelligence (in progress)

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Resumed after:** `SECURITY_CLOSURE_G1_G2_G3.md` (moderator gate, closed at `96eccff2`)
**Status:** first surface shipped — Marketplace Pulse on the owner dashboard. Listing-level insights and mobile parity follow.

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

- **22 display-contract tests** pass, covering every non-value state, the missing-metric case, the smuggled-number case, qualifiers, provenance, and trust rendering.
- **Full web suite: 107 files / 1,135 tests / 0 failures.**
- Typecheck clean; production build succeeds.

## Remaining in I7

- **Listing-level insights** (`fetchListingIntelligence` is wired and ready): the full discovery funnel, price response, completeness with its explainable groups, lost opportunity and next-best-action for one listing. This replaces `MyListings.tsx`'s honest-but-empty "Views not tracked".
- **Mobile parity**, which stays sequenced behind PR #182 for the same reason as I3c.
- Figures will read as genuine zeros until impression instrumentation lands (also behind #182) and a rollup has run; `coverage` and the as-of line make that visible rather than mysterious.
