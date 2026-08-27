# I3 — Marketplace Instrumentation

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Implements:** `I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md` §4.1–§4.3 on top of the I2 ledger
**Status:** I3a (server-side) complete. I3b (web client) and I3c (mobile client) follow in this same lane.

---

## I3a — server-side emissions

| Artefact | Path |
|---|---|
| Emitters | `backend/services/intelligence/marketplaceActivityEmitters.js` |
| Wiring — discovery + saves + inquiries | `backend/routes/marketplaceRoutes.js` |
| Wiring — save/unsave authority | `backend/services/marketplace/marketplaceSavedService.js` |
| Wiring — inquiry authority | `backend/services/marketplace/marketplaceInquiryService.js` |
| Tests | `backend/tests/intelligence-marketplace-instrumentation.test.js` (26 tests) |

### What is now observed

| Event | Anchored to | Closes |
|---|---|---|
| `marketplace_search_performed` | the list API call, with `result_count` and bounded catalogue filter values | searches emitted nothing (I0 §4) |
| `marketplace_search_zero_results` | the same call when nothing matched | unmet demand was invisible |
| `marketplace_listing_opened` | every served listing detail, organic **and** attributed | **the largest I0 gap** — organic views were recorded nowhere |
| `marketplace_listing_saved` | the `saved_vehicles` row's own `created_at` | saves left no history |
| `marketplace_listing_unsaved` | the **deleted** row's `created_at` (delete-returning) | an unsave left zero trace |
| `marketplace_inquiry_created` | the `marketplace_inquiries` row id | leads could not be stage-linked to prior behaviour |
| `marketplace_inspection_requested` | an inspection-type inquiry | inspection was not a distinct funnel stage |

### Design decisions worth stating

**Anchoring to the authority, not to the request.** Every idempotency key is derived from the authoritative row — the saved row's `created_at`, the deleted row's `created_at`, the inquiry id, the shopper's page view. A request-time value would make each retry a new "sale".

**A no-op save observes nothing.** `saveListing` already short-circuits when the listing is saved; the emitter now sits *after* that check, so re-saving reports no new interest. A save metric that counted no-ops would report interest that never happened.

**Contextless opens are skipped and counted.** `marketplace_listing_opened` is server-emitted but session-scoped: without a session key we cannot tell one shopper from two, so counting would corrupt unique-viewer metrics. Crawlers, `curl` and API consumers therefore produce **no event** and increment `opened_without_context` — an honest bounded undercount instead of a fabricated shopper.

**Prefetch is excluded.** A browser speculating is not a person looking (`Sec-Purpose`/`Purpose: prefetch`, `x-carup-prefetch`).

**`unsaveListing` now deletes with a returning clause.** It previously deleted blind. Unlike a save, an unsave has no reconciliation path by construction — once the row is gone there is nothing to sweep against — so the row must be returned at delete time or the signal is permanently unrecoverable.

**Search stores filter VALUES, hashes the words.** Bounded catalogue filters (make, condition, price band, tags, sort) are retained because Lost Opportunity (I6) must answer "which searches could this listing have matched if a field were filled in" — a hash cannot answer that. The free-text query is a person's words: hashed for grouping, never stored. *(Additive metadata-allowlist extension under schema_version 1; no metric meaning changes, so no version bump per §2.)*

**Another lane's ledger is left alone.** The referral bridge's own `marketplace_listing_viewed` still fires exactly as before — it is the referral engine's workflow record. Intelligence supersedes it *for view metrics* (§4.6) without deleting or repurposing it.

### PR #182 coordination

Every file touched is outside PR #182's ownership: `marketplaceRoutes.js`, `marketplaceSavedService.js`, `marketplaceInquiryService.js`. #182 owns the discovery/detail/summary services and the web/mobile marketplace pages; none of those are modified here. Instrumenting at the route and authority-service layer was chosen for exactly this reason.

---

## Evidence

### Automated tests — 26/26 pass
Covering: filter normalization and query hashing (including that a shopper's words never reach the row); browsing-vs-searching discrimination; zero-result dual emission with distinct keys; organic view recorded and marked unattributed; attributed view marked attributed; prefetch excluded; contextless open skipped **and** counted; page-view view semantics (refresh ≠ new view, new page view = new view); save keyed on authority timestamp; save without authority material refused; save/unsave distinct; **real-service** save emitting exactly one observation; **real-service** re-save emitting nothing; **real-service** unsave keyed on the deleted row; unsave of a never-saved listing emitting nothing; delete-returning asserted in source; inquiry keyed on inquiry id with scope from the authority row and P3 class; inspection stage emitted only for inspection types; inquiry without id refused; every emitter swallowing a database failure; malformed session/page keys rejected; and **wiring assertions** that the product paths actually call the emitters.

The wiring assertions are deliberate: this codebase has previously shipped a correct implementation that no request could reach (`wiring-not-just-implementation`). Injected-collaborator tests alone would not have caught that, so the real service functions are exercised and the call sites are asserted in source.

### Full backend regression — 4,412 tests, 0 failures
Run under the `ci.yml` env contract. 4,391 pass, 21 pre-existing skips, 0 fail. The `saveListing`/`unsaveListing` signature change (added optional `options`) did not regress any existing caller.

### Live staging end-to-end — controlled counts reconcile exactly

Driven over HTTP against the **real deployed preview backend** for this branch
(`carup-backend-staging-git-feat-carup-intelligence-1-0-11-11.vercel.app`, commit `20afa621`),
then read back from the staging database. Because the HTTP calls produced rows in the staging
database, this run also **proves the preview↔staging-database pairing** rather than assuming it
(the `preview-backend-pairing-hazard` this programme has been bitten by before).

Listing views on a real published staging vehicle (`1HGBH41JXMN109186`):

| Action driven | Expected | Observed |
|---|---|---|
| 3 opens under 3 distinct page views | 3 events | **3** (3 distinct `page_view_id`) |
| 1 refresh inside page view 1 | no new event | no 4th row |
| 1 open with `Sec-Purpose: prefetch` | no event | no row |
| 1 open with no session/page-view headers | no event, counter +1 | no row; `opened_without_context = 1` |

Searches:

| Action driven | Expected | Observed |
|---|---|---|
| `?make=Toyota` (4 results) | 1 `search_performed`, `result_count=4` | **1**, `result_count: "4"`, `filters: {"make":"Toyota"}` |
| same search repeated in the same page view | no new event | no second row |
| `?make=Lamborghini` (0 results) | 1 `search_performed` + 1 `search_zero_results` | **1 + 1**, both `filters: {"make":"Lamborghini"}` |
| bare `/listings` with no filters | no event (browsing ≠ searching) | no row |

Row-level properties confirmed live: `actor_scope: anonymous` with no user id, `source_platform: web`, empty `exclusion_flags`, `privacy_class: P1`, `metadata.attributed: false` on organic views, `object_type: search` with null tenant on searches (per §3's null rule for objectless events), and no free-text query stored anywhere.

All rows and counters were deleted afterwards; the ledger and stats tables are back to **0 rows** — a clean baseline for I19 certification.

---

---

## I3b — web client (complete)

| Artefact | Path |
|---|---|
| Activity client | `web/src/lib/intelligenceActivity.ts` |
| Context injection | `web/src/lib/apiClient.ts` (provider slot) |
| App-shell mount | `web/src/components/intelligence/ActivityInstrumentation.tsx`, mounted in `web/src/App.tsx` |
| First client event | `web/src/components/marketplace/InquiryModal.tsx` (`marketplace_inquiry_started`) |
| Tests | `web/src/lib/intelligenceActivity.test.ts` (21 tests) |

The load-bearing idea: a **server**-emitted observation can only be attributed to a shopper — and therefore only counted as a unique viewer or stage-linked into a funnel — if the request carries session and page-view context. Injecting that at `apiClient`, the single request chokepoint, instruments every page at once, including pages this lane must not edit.

- The session key is opaque, random, and not derived from any identifier; it is cleared at logout so a shared device does not carry one person's behaviour into the next person's session, and falls back to a memory-only key when storage is blocked rather than failing.
- `page_view_id` rotates on every route change, because the contract makes it the unit of "one view": a soft navigation to another listing is a new view; a refetch within a screen is not.
- The context provider is a mutable slot rather than a direct import, so the framework-agnostic api client keeps no dependency on the activity client. An auth header always wins a name clash, so telemetry can never influence identity, and a throwing provider cannot break a product request.
- `marketplace_inquiry_started` is recorded when the contact form opens. This is the only lead-funnel step a shopper can abandon without leaving any authoritative trace — the inquiry row exists only on submit — so without it, "how many people tried to contact this seller and gave up" is unanswerable.
- The flush reuses the canonical identity-bound CSRF machinery rather than inventing a second token system; `sendBeacon` is deliberately unused because it cannot carry the token header.

**Evidence:** 21 new tests; full web suite **106 files / 1,113 tests / 0 failures**; typecheck clean; `npm run build` succeeds. (One PartSentry failure seen in an early full run was a `waitFor` timeout flake — that test mocks `useCarUpApi` entirely and never reaches `apiClient`; two subsequent full runs passed.)

---

## I3c — mobile client: blocked on PR #182, deliberately not started

Every mobile marketplace call routes through `mobile/utils/marketplaceApi.ts`, whose private `authHeaders()` is the only place mobile context headers could be injected — and that file, together with `mobile/app/(tabs)/marketplace.tsx` and `mobile/app/vehicle/[vin].tsx`, is **owned and being rewritten by PR #182**.

Writing a mobile activity client now would produce a module with no reachable call site: precisely the dead-by-construction pattern this codebase has already been bitten by (`wiring-not-just-implementation`). So I3c is sequenced after #182 merges rather than shipped unwired. The same applies to web client-event call sites on listing cards: `MarketplaceListingCard.tsx` does not exist on this branch at all — PR #182 creates it.

**Consequence to state plainly:** until then, mobile marketplace actions still leave no Intelligence signal, exactly as I0 found. Mobile inquiries remain visible only through the authoritative `marketplace_inquiries` row.

---

## Deliberate limitations

- **No client-emitted events yet.** Impressions, engaged views, shares, compares, contact clicks, inquiry-starts and process steps require the web/mobile clients (I3b/I3c). Until then, funnel metrics that begin at impression cannot be computed, and this is stated rather than approximated.
- **Lifecycle and price events are not yet wired.** `marketplace_listing_created/_submitted/_published/_sold` and `marketplace_price_changed` are defined and taxonomy-valid but not yet emitted; their authority paths (vehicle create/update/publish) are wired in I3b alongside the client work.
- **`marketplace_reservation_started/_completed`** likewise await wiring into the escrow/reservation services.
- **No metric is displayed from this data.** I3 fills the ledger; I4 builds rollups and I5 the authorized projections. Nothing reaches a stakeholder surface until then.

---

## I3a gate statement

The server half of marketplace instrumentation is implemented, wired into the real product paths, unit-tested including the wiring itself, and regression-clean across the full backend suite. Analytics is non-blocking by construction — every emitter swallows failure and the marketplace proceeds — and every observation is anchored to an authority row rather than to request-time values.
