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

## 8a. What a trader actually sees at the research URL — a correction

An earlier walk recorded "told plainly why, not shown a blank page". That was a loose regex match
against the dashboard, and the record is corrected here rather than left standing.

What actually happens when a trader types `/diaspora/rate-research`: the **route boundary**
redirects them to their own dashboard. The workspace never mounts, so the page's own refusal copy
is not what an `owner` sees — it is defence in depth for a role the registry admits but the server
does not. The redirect is the stronger outcome, and it is the registry entry that produces it.

Measured at the final head, for both a trader (`owner`) and a logistics provider (`dealer`), with a
real CSRF token so the refusal observed is the AUTHORITY refusal and not the transport one:

| Call | Status | Body |
|---|---|---|
| `GET /diaspora/trade-rate-observations` | **403** | authority |
| `GET …/corridor-benchmark` | **403** | authority |
| `POST /diaspora/trade-rate-observations` | **403** | `INSUFFICIENT_PERMISSIONS — The rate research workspace is restricted to CarUp platform reviewers and administrators` |

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

---

# Owner acceptance — 2026-09-07

**`T6-USABLE` — OWNER ACCEPTED.** Runtime frozen at **`2d0a0bc0`**.

## Chronology — preserved, not rewritten

| stage | SHA | verdict |
|---|---|---|
| initial implementation | `b6ba1ccd` | `T6-PARTIAL` |
| technical/product closure | `209e491b` | `T6-PARTIAL` — owner acceptance outstanding |
| **acceptance-cycle correction** | `2d0a0bc0` | one T6-blocking defect found and closed |
| **owner acceptance / runtime freeze** | **`2d0a0bc0`** | **`T6-USABLE`** |

T6 was never green from the start, and this record does not pretend otherwise.

## Why `209e491b` was superseded

The acceptance walk was not a formality: it found a **twelfth defect, and a blocking one.**

Two suppliers were put on the same requirement. Supplier A disclosed three things — the goods
(priced), Zimbabwe duty (**EXCLUDED**), pre-shipment inspection (**NOT_APPLICABLE**). Supplier B
disclosed one — the goods — and said nothing whatever about customs. The buyer's screen said:

> These offers cover the same scope, so the totals compare directly.
> Lowest recorded total: **SYNTHETIC Sakura Motors Export**

It named the supplier who had disclosed **less** as cheapest. Two linked causes:

1. `assessComparability` scored scope on **INCLUDED stages alone**, so a disclosed exclusion and
   total silence were indistinguishable. That inverts the module's own governing rule —
   *uncertainty is penalised, never rewarded* — and made saying nothing the winning strategy.
2. The server already returned `covers_full_journey` with a comment instructing the caller to
   surface it, *because a lowest total across a partial scope is a lowest PARTIAL cost*. The panel
   ignored the field and printed a flat "Lowest recorded total".

Both fixed at `2d0a0bc0`. Scope now also accounts for the **material stages each side has ANSWERED**
(priced, excluded, or not-applicable), and the difference is named in the customer's words. The
verdict reads "Lowest known cost so far" and states that the unpriced stages will still be paid by
somebody. The honest ocean-leg case — two offers pricing only the main carriage, both silent on the
rest — is preserved and pinned by its own test. Mutation-proven both ways.

Re-measured on the deployed product afterwards:

> CarUp is not calling one of these cheaper. These offers do not describe the same purchase, so
> CarUp shows no cheapest option. SYNTHETIC Trade OS Supplier uat says where it stands on Import
> duty and taxes; SYNTHETIC Sakura Motors Export does not mention it.

## Product acceptance — walked in the browser at `2d0a0bc0`

**B1 · procurement — 27/28**, publish → two competing structured offers → comparison → award →
carry-forward. JPY 2,400,000 survived compose, review, persistence, refresh and relogin, and was
never redenominated. Reference USD appeared separately and labelled "for comparison". INCLUDED,
EXCLUDED and NOT_APPLICABLE stayed semantically distinct on screen. After the award the compliance
record carries both offers forward without re-entry:

```
Quotations   JPY 2,400,000  Seller qa-trade…  Accepted
             USD 14,500     Seller qa-trade…  Rejected
```

**B2 · logistics — clean.** Stated total and itemised parts never conflated; excluded customs reads
"Amount not stated — you arrange this", never `$0`; an UNKNOWN charge stays "Not priced yet"; the
estimate says "Known estimated costs so far / NOT A FULL LANDED COST"; and "Still unpriced" lists
*Customs clearing* and *Inland transport* — **not** "The goods themselves", proving the
domain-aware materiality rule holds for a freight provider.

**B3 · research — clean.** Authorized operator enters, records, and inspects corridor benchmark
data; every row leads with classification and source; synthetic rows are badged *SYNTHETIC — not
market data*; no corridor is called best or preferred. A trader typing the route never mounts the
workspace — the route boundary redirects first — and both a trader and a logistics provider are
refused **403 `INSUFFICIENT_PERMISSIONS`** on read, corridor benchmark and write, measured with a
real CSRF token so the refusal observed is the authorization one and not the transport one.

**B4 · allocation — clean.** Only APPROVED reservations participate and the screen says so; the
existing division reads back exactly (`RES-5648C1C0 — USD 900`, zero remainder); **replay offers no
second division**, so nothing can be double-charged; and it is never called an invoice, a payment
or a settlement.

## Truth contract — inspected in the real UI

| rule | result |
|---|---|
| source money ≠ reference USD | ✅ source leads, USD labelled "for comparison" |
| reference USD retains rate, source, date | ✅ ECB, with its own rate date |
| ZWG / MZN / TZS | ✅ `UNAVAILABLE` with a reason — never 0, never 1:1, never a guess |
| every FX answer | ✅ `purpose: REFERENCE_DISPLAY_ONLY` |
| unknown never becomes zero | ✅ no `$0.00` anywhere; nothing-priced returns null, not 0 |
| INCLUDED / EXCLUDED / NOT_APPLICABLE / unknown | ✅ four distinct sentences on screen |
| landed-cost wording | ✅ "Known estimated costs so far" + the unresolved stages, named |
| comparability | ✅ scope mismatch blocks a headline winner — **and now disclosure mismatch does too** |
| corridors | ✅ no BEST / PREFERRED / CHEAPEST |

## Responsive — seven widths × seven surfaces, no overflow

393×852 · 820×1180 · 1024×768 · 1280×800 · 1366×768 · 1440×900 · 1536×864, all
`scrollWidth <= innerWidth + 1`, across procurement detail, procurement comparison, logistics
detail, structured provider entry, shared-charge allocation, rate research, and the research entry
form. The 393px regression is specifically re-guarded **with the offending sentence on screen** —
"USD comparison unavailable — ZWG/USD is not published by ECB" — at 393/393.

## Gates at the freeze candidate `2d0a0bc0`

| gate | result |
|---|---|
| full backend suite (ci.yml env) | **6009 passed / 0 failed** (21 skipped, 6030 total) |
| T6/T5/T4/T3/Intake phase suites | **264/264** |
| T6 backend | **78/78** |
| PGlite gates — T6 · T5 · migration integrity | all **ok** |
| web suite (full) | **1660/1660**, 169 files |
| `tsc -b` · build · lint regression | PASS · PASS · NET_NEW_ERRORS=0 |
| CI | **7 workflows green**, 1 skipped by design; every step confirmed executed |

## Provenance

```
runtime SHA        2d0a0bc0
FE served bundle   commit_sha 2d0a0bc0 · unpaired false
FE baked backend   carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app
BE /api/health     2d0a0bc0 · preview · UP
DB                 Supabase STAGING only
migration ledger   20260906115540 trade_os_t6_commercial_transparency
                   (applied-at version; the repo file is 20260908090000_*.sql — same content,
                    different key because it was applied through the MCP rather than the CLI)
console            no unexpected errors; the recurring "Failed to fetch" entries are unrelated
                   dashboard widgets (/notifications/me, /marketplace/*, /vehicles/me)
5xx                0
```

**Production untouched.** Production serves `78303ed6` from `main`, deployed 12 days ago, and that
commit contains **none** of the T6 files — not the migration, not the services, not the pages.
`main` is unchanged at `bb9d9900` and this branch is not merged into it. The only CI reference to
the T6 migration is an isolated PGlite verification step; no workflow applies it to production.

## What `T6-USABLE` does not mean

It does **not** mean production-ready. Production readiness remains a separate, explicitly
authorized gate — **T18** — and production remains NOT AUTHORIZED.

## Carried forward

- **Research-data limitation.** No real market rate observations exist. Everything in the research
  workspace is synthetic certification data, badged as such, and none of it may be read as a real
  Beira/Durban/Dar price.
- **T12-BLOCKER** (§8b) stands, deliberately unfixed: `documentIntelligenceService.js:375` writes a
  `zimra_declarations` row with an invented `exchange_rate_used: 13.5` and
  `duty_calculated_zig: 50000`. T6 does not read it. Before a real customs engine can rely on that
  table, **T12** must remove the fabricated rate/duty and establish the governed
  jurisdiction/effective-date customs authority. This is not grounds for reopening T6, which owns
  reference and commercial pricing — not customs valuation.
- **Non-blocking (UX):** the order compliance record identifies a supplier by truncated user id
  (`Seller qa-trade…`) rather than organisation name.
