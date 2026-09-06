# CarUp Trade OS — T6 Rates, Commercial Transparency, FX & Landed-Cost Implementation Plan

**Status:** IMPLEMENTED — OWNER ACCEPTANCE OUTSTANDING (`T6-PARTIAL`)
**Date:** 2026-09-06
**Repository:** `kudzimusar/carup`
**Branch:** `feat/trade-os-client-demo-convergence`
**Draft PR:** `#207`
**Plan baseline / authorization head:** `9baf64668a20461c950c421103bf82360c34675e`
**T5 frozen runtime:** `5079b0b3` — `T5-USABLE`, must remain regression-green
**Production:** NOT AUTHORIZED / MUST REMAIN UNTOUCHED
**Parent authority:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md`
**Global design authority:** root `DESIGN.md`

---

## 0. Purpose and boundary

T6 is the **commercial-transparency layer**. Its objective:

> **MAKE AVOIDABLE TRADE COST VISIBLE AND COMPETITIVELY REMOVABLE.**

T6 must answer truthfully what is charged, by whom, in what original currency, for which service
scope, what is included, what is excluded, **what remains unknown**, and what is estimated versus
provider-quoted versus confirmed — without manufacturing certainty.

T6 is **not** customs legislation (T12), settlement (T13), invoicing, tracking (T11), warehouse
(T9), loading (T10), reputation (T14), AI authority (T16) or commercialization policy (T17).

---

## 1. T6.0 — Commercial authority audit (COMPLETE)

Searched the entire repository and the live staging schema before designing.

### 1.1 Money authorities that already exist

| Domain | Authority | Money facts held |
|---|---|---|
| Procurement demand | `diaspora_import_orders` | `budget_amount`, `budget_currency`, `budget_basis`, `budget_max_amount`, `budget_flexibility`, **`budget_disclosed`** |
| Procurement offer | `diaspora_import_quotes` | `quote_amount` (NOT NULL), `quote_currency`, `unit_price`, `lead_time_days`, `valid_until`, `inclusions[]`, `exclusions[]` |
| Logistics offer | `diaspora_logistics_quotes` | `total_amount` (NOT NULL), `currency`, **five fixed charge columns** — `freight_amount`, `handling_amount`, `origin_charges`, `destination_charges`, `documentation_fees` — plus `transit_days`, `valid_until`, `pickup_included`/`delivery_included` (tri-state), `inclusions[]`, `exclusions[]`, `conditions` |
| Logistics cargo | `diaspora_logistics_request_items` | `declared_value`, `declared_value_currency` |
| Container booking | `diaspora_cargo_reservations` | `declared_value`, `currency`, `invoice_document_id` |
| Stock | `diaspora_stock_items`, `diaspora_stock_ledger` | `unit_cost`, `unit_price`, `currency` |
| **Settlement — T13, DO NOT DUPLICATE** | `diaspora_payment_milestones`, `diaspora_safetrade_*` | `amount`, `currency`, `total_amount` |
| **Commercialization — T17** | `diaspora_subscription_plans.price_config` | jsonb |

### 1.2 What does NOT exist

- **No FX authority of any kind.** No rate table, no snapshot, no provider abstraction, no conversion utility anywhere in `backend/`, `web/src/`, `shared/` or `database/`.
- **No charge/cost component authority.** Logistics has five *fixed* numeric columns — a sixth charge (port storage, demurrage, quarantine) cannot be expressed at all, and none of the five carries its own currency, inclusion state, provenance or revenue classification. Procurement has no components whatsoever.
- **No rate / rate-card / market-observation authority.**
- **No landed-cost authority.** `tradeIntelligenceService` names this gap explicitly and honestly: *"A quote records a single amount with free-form inclusions and exclusions. There is no structured duty, freight, handling or tax breakdown to build a landed cost from."* T6 is what closes that gap.
- **No allocation authority** for shared-capacity charges.

### 1.3 Findings carried into the design

1. **`inclusions` / `exclusions` are free TEXT arrays.** They are human-readable but not classifiable,
   so no deterministic comparability can be computed from them today. T6 adds *structured* components
   without removing the free-text fields the providers already use.
2. **Every money column is `NOT NULL DEFAULT 'USD'`.** A provider quoting JPY who omits the field
   silently produces a USD row. Staging confirms the risk is unexercised, not absent: **every**
   existing amount is USD (import quotes 42, logistics quotes 71, order budgets 115). Multi-currency
   is entirely unproven in practice, so T6 must not assume the default is harmless.
3. **One pre-existing fabricated financial value, outside Trade OS.**
   `backend/services/document-intelligence/documentIntelligenceService.js:375` writes
   `exchange_rate_used: 13.5` and `duty_calculated_zig: … || 50000` into `zimra_declarations` during
   admin OCR approval. This is a **customs** FX and a **duty** figure — **T12 territory** — in a
   separately certified subsystem, not the Trade OS commercial path. **Recorded, deliberately not
   changed by T6**: altering a certified lane to tidy a value T6 does not own would be scope
   creep, and T12 owns the rules engine that must replace it. It is named here so it cannot be
   mistaken for a precedent T6 follows.
4. **`tradeIntelligenceService.amountsByCurrency` never adds currencies together**, precisely
   because no conversion was performed. That existing truth contract is the one T6 must satisfy
   before any USD comparison is allowed to appear.

### 1.4 Schema decision

**Four additive tables. No JSON blob. No universal shadow transaction. No existing authority replaced.**

- `diaspora_fx_rate_snapshots` — immutable reference-FX snapshots.
- `diaspora_trade_charge_components` — the structured charge authority.
- `diaspora_trade_rate_observations` — rates/research, deliberately separate from quotes.
- `diaspora_shared_charge_allocations` — per-participant allocation of a shared charge.

**Why one charge table rather than two.** A charge component must attach to *either* a procurement
offer or a logistics offer. A polymorphic `(owner_type, owner_id)` pair would abandon referential
integrity, and two near-identical tables would duplicate every rule. Instead the table carries **two
nullable foreign keys** — `import_quote_id` and `logistics_quote_id` — with a CHECK that **exactly
one** is set. Both domains keep real FK integrity and cascade behaviour, and one service path owns
the rules. This is the same shape T4 used for the continuation edge, for the same reason.

**Landed cost needs no table.** An estimate is a *composition* of charge components and FX
snapshots, both of which are immutable. It is therefore reproducible by construction, and a later
rate change cannot rewrite an earlier estimate. A fifth table would store a derivable fact.

---

## 2. Roll-call

### T6.0 — Authority audit
- [x] Search the entire repository for money/rate/FX/landed authorities.
- [x] Audit procurement, logistics, container, corridor, intake and settlement money facts.
- [x] Identify hardcoded/fabricated financial values.
- [x] Produce the authority map (§1) before schema.
- [x] Record the schema decision and its justification.

### T6.1 — FX authority
- [x] Research and document an official reference-rate source (authority, coverage, frequency, effective-date semantics, outage/revision behaviour, triangulation, licensing).
- [x] Implement behind an `FxRateProvider` abstraction; no commercial record couples to one provider.
- [x] Immutable snapshots sufficient to reproduce a conversion, including triangulation legs.
- [x] `AVAILABLE` / `STALE` / `UNAVAILABLE` states; never a silent fallback, never 1:1, never 0.
- [x] Reference FX can never become settlement or customs FX.

### T6.2 — Cost taxonomy
- [x] Canonical stage vocabulary (GOODS … EXCEPTIONS); not every category mandatory.
- [x] Unknown and not-applicable remain distinct.
- [x] A taxonomy entry identifies a charge's TYPE — it never asserts the charge exists.

### T6.3 — Charge components
- [x] Structured component authority with the families in §8 of the directive.
- [x] Inclusion state, commercial status, provenance and revenue classification are separate dimensions.
- [x] Evidence-attachment capability without implementing T8.

### T6.4 — Quote normalization & comparability
- [x] Original money is never destroyed or overwritten.
- [x] Reference USD retained beside the source, with its snapshot.
- [x] Deterministic comparability: COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE / INSUFFICIENT_INFORMATION, with reasons.
- [x] An exclusion is never rendered as 0.
- [x] Rejected/expired offers retained as history.

### T6.5 — Rate sources
- [x] Rate observations separate from provider quotes.
- [x] Classification: PROVIDER_QUOTED / PROVIDER_RATE_CARD / OFFICIAL_FEE / RESEARCH_OBSERVATION / CARUP_ESTIMATE / HISTORICAL_ACTUAL.
- [x] Provenance, effective dates, basis/unit, corridor/leg/mode applicability, source reference.

### T6.6 — Landed-cost estimate
- [x] Known/estimated subtotal, known exclusions, unpriced stages, contingencies.
- [x] Never prints a single "landed cost" when material stages are unknown.
- [x] Customs firewall: duty/VAT/valuation not calculated (T12).
- [x] Reproducible; immune to later rate changes.

### T6.7 — Corridor economics
- [x] Built over the frozen T5 corridor authority; route truth unchanged.
- [x] Uncertainty is penalised, never rewarded — missing components must not make a corridor look cheap.
- [x] No corridor declared BEST/CHEAPEST/PREFERRED.

### T6.8 — Deterministic advisor
- [x] Explainable outcomes only; every statement exposes its measured basis.
- [x] Says so when options are not commercially comparable.
- [x] No LLM decides the commercial answer.

### T6.9 — Shared-capacity allocation
- [x] Explicit governed bases only; no silent default to CBM.
- [x] APPROVED reservations only; REQUESTED never becomes a charge.
- [x] Allocations reconcile exactly to the source charge, with deterministic rounding.

### T6.10 — Security, UI, tests, staging
- [x] Server derives provider/tenant/FX/normalized-USD/verification; client cannot supply them.
- [x] Customer, provider and research/operations surfaces per root `DESIGN.md`.
- [x] Migration gate on real Postgres/PGlite; bounded reads (no T5-style N+1).
- [x] Staging journeys A–F + allocation; seven-width geometry; owner-UAT proxy.

### T6.11 — Closure findings (walked in the deployed product, not read in the code)

Six defects were found by using the product; none was visible from the source alone. Recorded here
because the pattern matters more than the individual fixes.

- [x] **The commercial layer reached no screen.** `QuoteBreakdown`, `LandedEstimatePanel` and
  `ComparisonVerdict` had passing unit tests and no importer. A provider could record a complete
  breakdown and their customer still saw only the five legacy columns. Both customer surfaces now
  mount the same section, and the wiring is mutation-proven on the real pages.
- [x] **Three facts told as one phrase.** An EXCLUDED customs line and a NOT_APPLICABLE inspection
  line both read "Not priced yet" — the words used for a charge whose price is still owed.
- [x] **A comparison requested for one offer.** 400 on every single-offer request detail; the
  two-offer guard now sits outside the component that loads.
- [x] **Material coverage was one global list.** A freight offer pricing the whole ocean leg was
  reported as missing "The goods themselves". Material stages now depend on the purchase.
- [x] **The advisor reached no screen.** `/quote-comparison` returned `advice`; the customer
  surface discarded it. Reasoning nobody sees cannot be argued with.
- [x] **The allocation engine had no operator screen.** It was reachable only by a caller who
  already knew a charge-component id. A sailing-scoped read plus a panel closes it.
- [x] **The truth broke the layout.** At 393px the buyer's breakdown scrolled to 765px, because the
  unavailable-FX explanation could not wrap. The fuller the truth, the more broken the page.

---

## 3. Phase firewall

T6 implements none of: T7 communications, T8 document verification, T9 warehouse measurement,
T10 loading, T11 tracking, T12 customs/tax engine, T13 settlement, T14 reputation, T15 Intelligence
/ Savings Statement, T16 AI authority, T17 fee policy, T18 production authorization.

**No savings claim.** T6 may show arithmetic differences between *commercially comparable* options.
It may not claim "you saved $X with CarUp" — that needs a governed baseline and journey history
(T15/T17).

**Unknown is never zero.** Unknown freight is not $0; unknown customs is not $0; unsupported FX is
not $0; an excluded charge is not an included one.
