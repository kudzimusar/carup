# Trade OS T6 — Rates, Commercial Transparency, FX & Landed Cost · Receipt

**Status:** `T6-PARTIAL` — owner acceptance remains
**Date:** 2026-09-06
**Starting SHA:** `9baf64668a20461c950c421103bf82360c34675e`
**Code head:** `b6ba1ccd`
**T5:** `T5-USABLE`, frozen `5079b0b3` — unchanged and regression-green
**Production:** UNTOUCHED / NOT AUTHORIZED · **T7:** NOT STARTED · **PR #207:** Draft
**Plan:** `docs/trade-os/T6_RATES_PRICING_LANDED_COST_IMPLEMENTATION_PLAN.md`
**Canonical:** master plan §44 (contract) · §45 (execution)

---

## 1. Authority audit

| Concern | Existing authority | T6 treatment |
|---|---|---|
| Procurement budget | `diaspora_import_orders` (`budget_*`, `budget_disclosed`) | reused, untouched |
| Procurement offer | `diaspora_import_quotes` (`quote_amount`, `quote_currency`, `inclusions[]`, `exclusions[]`, `valid_until`) | reused; components attach to it |
| Logistics offer | `diaspora_logistics_quotes` (`total_amount`, `currency`, five FIXED charge columns) | reused; components attach to it |
| Settlement | `diaspora_payment_milestones`, `diaspora_safetrade_*` | **not duplicated** — T13 |
| Commercialization | `diaspora_subscription_plans.price_config` | **not touched** — T17 |

**Existing quote-component authority:** none worth the name. Logistics had five *fixed* numeric
columns — a sixth charge was unexpressible, and none carried its own currency, inclusion state,
provenance or revenue class. Procurement had none at all.
**Existing rate authority:** none. **Existing FX authority:** none, anywhere in the repository.

**Hardcoded/fabricated financial values found:** one, outside Trade OS —
`documentIntelligenceService:375` writes `exchange_rate_used: 13.5` and a defaulted
`duty_calculated_zig` into `zimra_declarations`. Customs FX and duty: **T12 territory**, separately
certified subsystem. Recorded, deliberately not changed.

**Schema decision:** four additive tables; one charge table carrying two nullable FKs with an
exactly-one-owner CHECK; no landed-cost table because the estimate composes immutable inputs.
**Why:** a polymorphic owner pair abandons referential integrity, two tables duplicate every rule,
and a stored estimate would be a derivable fact that could drift from its own inputs.

## 2. FX

**Provider:** ECB euro reference rates, behind an `FxRateProvider` abstraction — no commercial
record couples to it.
**Why official/suitable:** a central bank publishing its own figures, whose own terms state these
are reference rates *not intended for transaction purposes*. That is exactly T6's contract.
**Reference only:** enforced by `assertReferenceOnly()`; SETTLEMENT and CUSTOMS throw.
**Snapshot schema:** base/quote/rate/rate_date/source/source_reference/retrieved_at/status +
`triangulation` legs.
**Historical immutability:** database trigger refuses UPDATE and DELETE. A newer rate is a new row.
**Staleness:** `STALE` past 4 days, carrying the source's own date — never today's.
**Outage:** UNAVAILABLE with a reason and **no number**; an older snapshot may be shown, explicitly
marked stale. Never 0, never 1:1, never a silent fallback.
**Unsupported currency:** UNAVAILABLE. **ZWG/ZWL/MZN/TZS are not published by the ECB** — the
destination and both gateway markets — and are never approximated.
**Transaction FX separated:** yes (T13). **Customs FX separated:** yes (T12).

## 3. Cost taxonomy and components

17 stages, GOODS → EXCEPTIONS, with human labels. Four independent dimensions — `inclusion`,
`commercial_status`, `provenance`, `revenue_class` — because QUOTED+PROVIDER_STATED and
CONFIRMED+VERIFIED mean different things. Source money always carries its own currency (a database
CHECK makes money-without-currency unstorable). `evidence_document_id` gives T8 forward
compatibility without implementing upload or verification.

## 4. Quote integrity and comparability

Inclusions, exclusions, assumptions, contingencies and validity are all representable; rejected and
expired offers are retained. Comparability is deterministic — COMPARABLE / PARTIALLY_COMPARABLE /
NOT_COMPARABLE / INSUFFICIENT_INFORMATION with reasons.

**False-cheapest guard:** a winner is named only when every offer prices the same stages. Where
coverage differs the response carries `cheapest: null` and the reasons. Where coverage matches but
the journey is only partly priced, the comparison is allowed **with** `covers_full_journey: false`
and the caveat stated in words — refusing it entirely would hide a real like-for-like difference.

## 5. Landed cost

Known subtotals grouped **by currency** and never summed across them; a single reference USD figure
only when every included component converted. Unpriced stages are named. Exclusions and
contingencies are listed separately. `is_complete` gates the wording: "Estimated landed cost" only
when everything material is answered, otherwise "Known estimated costs so far" with an explicit
not-a-full-landed-cost marker.

**Customs firewall:** T6 computes no duty, VAT, surtax, excise or valuation. `CARUP_CALCULATED`
provenance on IMPORT_CUSTOMS or REGULATORY is refused outright. A supplied figure is recorded with
its provenance and described as such.

## 6. Corridor economics, advisor, allocation

Corridor economics reads the **frozen T5 corridor authority** and changes no route truth.
`cheapest_corridor` stays null unless every corridor answers the same material scope. No corridor
is BEST/CHEAPEST/PREFERRED; `planning_status` never reaches the screen and is documented as
evidence maturity, never desirability.

The advisor is deterministic and every finding carries its measured basis. It says plainly when
options are not the same purchase. No LLM decides a commercial question.

Allocation has **no default basis** — an unstated basis returns "not allocated yet". Only APPROVED
reservations participate (T5's frozen invariant, carried into money). Allocations reconcile to the
cent, with the remainder landing deterministically on the largest participant. Replay updates
rather than double-charging.

## 7. Defects found by exercising the system

1. **A JPY offer silently became USD** — the two domains read different currency field names and
   both defaulted to `'USD'`. Found on staging. Fixed by `resolveSourceCurrency()`.
2. **"Not applicable" counted as a gap** — punishing a provider for answering honestly.
3. **The coverage rule existed three times and drifted** — fixing (2) in one place left two stale
   copies, so a journey read complete on one screen and incomplete on another. Now one shared
   helper, guarded by a both-paths-agree test.
4. **An estimate with nothing priced returned USD 0.00** — caught by mutation testing before it
   shipped; the exact unknown-becomes-zero failure this phase exists to prevent.

5. **The whole commercial layer reached no screen.** `QuoteBreakdown`, `LandedEstimatePanel` and
   `ComparisonVerdict` had passing unit tests and no importer anywhere in the product. A provider
   could record a complete breakdown and their customer still saw only the five legacy numeric
   columns. Found by looking for the panel on the deployed buyer screen and not finding it.
6. **Three different facts told with one phrase.** An EXCLUDED customs line and a NOT_APPLICABLE
   inspection line both rendered "Not priced yet" — the words used for an included charge whose
   price is still owed. For a charge that does not apply, no price is ever coming; for an excluded
   one, the customer pays it to somebody else.
7. **A comparison requested for a single offer** — 400 on every single-offer request detail,
   because the two-offer guard sat inside the component that had already fired the request.
8. **Material coverage was one global list.** A freight offer that priced the entire ocean leg was
   reported as still missing "The goods themselves". A logistics provider never prices the
   customer's own cargo, so every shipping offer carried a permanent false entry in the one list
   whose whole job is to be believed.
9. **The advisor reached no screen either.** `/quote-comparison` already returned `advice` with the
   reasoning behind each finding, and the customer surface discarded the field.
10. **The allocation engine had no operator screen.** `allocateSharedCharge` was written, tested
    and routed; nothing told an operator which charges exist on a sailing they operate, so it was
    reachable only by a caller who already knew a charge-component id.
11. **The truth broke the layout.** At 393px the buyer's breakdown scrolled to 765px. The cause was
    the sentence this phase exists to protect — "USD comparison unavailable — ZWG/USD is not
    published by ECB" — sitting in a column that could not wrap. The fuller the truth, the more
    broken the page.

Six of the eleven (1, 5, 6, 7, 9, 10) were invisible from the source and only appeared by using the
deployed product. **A module being correct is not the same as a module being wired**, and the only
test that knows the difference is one that mounts the real screen.

## 8. Evidence

| Gate | Result |
|---|---|
| PGlite migration gate (own CI step, confirmed executed) | **28/28** |
| T6 backend suite | **75/75** |
| Backend regression (T3/T4/T5/Intake/diaspora) | **1577 / 0** |
| Web diaspora suite (incl. T6 wiring tests) | **188/188** |
| Staging: FX · procurement · logistics · allocation · security | **31/31** |
| Staging: corridor economics · mode | **9/9**, **15/15** |
| Owner-UAT proxy: procurement JPY end-to-end | walked in the browser |
| Owner-UAT proxy: logistics JPY end-to-end | walked in the browser |
| Owner-UAT proxy: research workspace + refusals | walked in the browser |
| Owner-UAT proxy: sailing → attached offer → approved booking → division | walked in the browser |
| FX states (JPY/EUR AVAILABLE · ZWG/MZN UNAVAILABLE with a reason) | 12/12 |
| Seven-width geometry (393 · 820 · 1024 · 1280 · 1366 · 1440 · 1536) | 8 surfaces, no overflow |

Staging: Supabase **staging** only; migration `20260908090000` applied there — 4 tables, FX
immutability trigger, RLS on all four, components and allocations service_role-only.

## 8b. Recorded for T12 — a fabricated customs exchange rate, deliberately left alone

`backend/services/document-intelligence/documentIntelligenceService.js:375` writes a
`zimra_declarations` row with `exchange_rate_used: 13.5` and `duty_calculated_zig: 50000` — both
invented constants, written as if they were a customs authority's own figures. A sibling comment in
`backend/services/evidence/vehicleFactResolver.js:140` already names this service as fabricating
them, which is why the evidence layer refuses to read it.

**T6 does not touch it, and must not.** Customs valuation is T12's engine; a T6 "fix" here would be
this phase manufacturing a legal assessment, which §44 forbids in as many words. Verified: no file
under `backend/services/diaspora/trade*.js` and no route in the container-marketplace router reads
`documentIntelligenceService` or `exchange_rate_used`.

**T12-BLOCKER:** the customs/tax engine cannot be built on top of this row without first deleting
the fabricated rate and duty, and deciding what a declaration means when no authority has supplied
one. Recorded, not fixed.

## 9. Deferred (phase firewall held)

T7 communications · T8 documents/verification · T9 warehouse · T10 loading · T11 tracking ·
**T12 customs/tax engine** · **T13 settlement** · T14 reputation · **T15 Intelligence and the
Savings Statement** · T16 AI authority · **T17 fee/subscription policy** · T18 production.

No savings claim is made. No settlement state is manufactured. An estimate is not an invoice.

## 10. Status

**`T6-PARTIAL` — OWNER ACCEPTANCE REMAINS.** T7 not started. Production untouched. PR #207 Draft.
