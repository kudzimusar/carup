# I13 — Diaspora / Trade Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I13
**Status:** implementation and tests complete; live-settlement certification carried to I19 (no live payment provider exists, and the database forbids one)

---

## 1. What the live data actually says

| Source | Rows | What it means |
|---|---|---|
| `diaspora_import_orders` | 91 | 62 vehicle, 29 parts; 47 requested, 26 seller-assigned, 16 cancelled |
| `diaspora_payment_milestones` | 107 | **all** type `DEPOSIT`, **all** `PENDING`, **none confirmed** |
| `diaspora_import_quotes` | 26 | all `ACCEPTED`, all with a seller |
| `escrow_trust_sessions` | 27 | 11 sandbox, 16 never started a payment |
| `diaspora_stock_items` / `_ledger` | 43 / 41 | — |
| `diaspora_shipments`, `_container_shipments`, `_shipment_stage_events`, `_cargo_reservations` | **0** | no shipment has ever been observed |
| every `diaspora_safetrade_*` table | **0** | — |
| `trade_graph_nodes` / `_edges` | **0** | the graph layer is empty and flagged off |

Four findings decide the phase.

**Every corridor is the same corridor.** All 91 orders are Japan → Zimbabwe. Corridor
demand is real, but it is *one* corridor — so a "top corridors" ranking would imply
a market of many. The projection reports the shape of the market instead, and says
so explicitly when only one corridor exists.

**No payment has ever been confirmed.** All 107 milestones are `PENDING` with a NULL
`confirmed_at`. A scheduled deposit is an intention to pay.

**Every escrow session that reached a payment state is sandbox.** Grouping by
provider gives exactly two populations: sandbox sessions (settled, held, cancelled)
and sessions that never started a payment. There are **zero** live settlements.

**The database forbids a live SafeTrade payment.** `diaspora_safetrade_transactions`
carries `CHECK ((live_payment = false))`. This is not a policy or a flag — a live
payment cannot be recorded at all.

So the two things a reader most wants from this domain — **settled trade value** and
**shipment/route demand** — are precisely the two CarUp cannot state. Neither is
estimated.

---

## 2. Reconciling with the existing trade intelligence

`DiasporaTradeIntelligenceService` (Phase 10) already computes demand signals,
container opportunities and risk exposure. It reads the **derived graph**, behind
the `DIASPORA_TRADE_GRAPH` flag (off by default), and that graph holds zero nodes
and zero edges — so it currently answers nothing.

I13 does **not** reimplement it. The new module reads the **authoritative tables**
the graph service does not read, defers to it in the payload's `related_authority`,
and a test asserts the new projection emits no `demand_signals` or
`container_opportunit*` keys. Nothing here writes to the graph.

---

## 3. What was built

`backend/services/intelligence/tradeIntelligenceService.js` — `trade_demand@1`,
route `GET /api/trade/intelligence`.

**Measured:** corridor demand, order funnel by status and type, quote activity and
acceptance, requested budgets, milestone scheduling and confirmation, escrow
sessions split by provider mode.

**Refused, each with a structural reason:** settled trade value, SafeTrade
outcomes, shipment demand, route demand, landed cost, trade↔vehicle linkage,
counterparty reputation, compliance outcomes.

### Money is never summed across currencies

CarUp holds no FX authority, so `amountsByCurrency()` groups by each record's own
currency and the payload carries no combined total. Today every row is USD —
exactly when such a guard is easiest to omit and most likely to break silently
later. A test asserts the cross-currency sum appears nowhere, and an amount with no
currency is counted as unpriced rather than folded in at zero.

### Scope mirrors the authoritative list — the I11 trap again

Every one of the 91 orders has a **NULL `tenant_id`**. `listImportOrders` narrows by
`tenant_id` when the session has one and otherwise by `buyer_id` OR `created_by`, so
a tenant-only filter would have reported **zero orders to a buyer whose own orders
the list page shows** — the same defect caught in I11 on finance. `resolveTradeScope`
mirrors the authoritative key.

**Government is deliberately not carried over.** The existing order list admits
`government` to the whole table. Handing an institutional role platform-wide
commercial trade intelligence is gap G5, so the new route is gated
`['owner','dealer','admin']` and a government session falls through to its own
participant scope. A test pins this.

---

## 4. The fake-zeros removed from the diaspora surfaces

A read-only sweep of every diaspora/trade/SafeTrade/escrow surface found a
consistent defect: a failed fetch collapsed to `[]` and rendered as "none exist".
Each fix distinguishes *unreadable* from *empty*, reusing one shared
`UnavailableNote`/`EmptyNote` pair lifted from `DiasporaOrderPassport`, which had
already solved this correctly.

Ordered by consequence:

| Surface | Was | Now |
|---|---|---|
| `DiasporaConfirmedImport` | a failed interrupted-import check **silently hid** the section — including its "Partly applied and could not be fully reversed… do not retry" warning | says the check could not be run, and that this is not confirmation there are none |
| `DiasporaSafeTradeOperations` | a failed reconciliation read still rendered "**Everything is reconciled.**" behind a generic partial-data banner | per-section state; the failed section says reconciliation is unverified |
| `DiasporaTrade` (compliance queue) | **no `.catch` at all** — a failed read told a reviewer "No compliance reviews found." and rejected unhandled | catches, and says the queue could not be loaded |
| `DiasporaSafeTradeDetail` | five enrichments collapsed to empty: a failed milestone read showed "no milestones defined" **and a plan total of $0.00**; a failed dispute read hid an active dispute | each unreadable section says so; no plan total is shown when the list is unreadable |
| `DiasporaTrade` (shipments) | a failed shipments read rendered "No shipment has been scheduled"; a failed container read **silently withdrew the reserve control** | `null` vs `[]` throughout; the withdrawn control is explained |
| `DiasporaTradeGraph` | a comment claimed the panel showed its own error; there was no error state, so a failed check rendered "**No unprocessed events.**" | the panel now genuinely says the check could not be run |
| `DiasporaContainerMarketplace` | a failed reservation read rendered "No reservations." — a reviewer could close a booking believing nobody reserved space | states the read failed |
| `DiasporaStockManager` | a failed ledger read rendered "No movements yet." | states the read failed |
| `DiasporaSubscription` / `UsageDashboard` | `null` usage was indistinguishable from an empty period → "No metered usage to report" | distinct unavailable state |
| `DiasporaReverseRfq`, `DiasporaAiCommandCenter` | empty states rendered *alongside* the error | the error wins; also `NaN%` confidence now reads "not reported" |
| `DiasporaConfirmedImport` | `{result.appliedRows ?? 0}` labelled "Applied" | "Not reported" |
| `DiasporaSafeTradeOperations` | `{a.currency \|\| ''}` — a reviewer approving an amount of unknown denomination | says the currency is not recorded |

### The cross-currency total

`milestoneHeldTotal()` summed raw milestone amounts and `SafeTradeMilestones`
labelled the result with the **single case currency** — while each row correctly
rendered its own `m.currency`, so mixed-currency plans were visibly possible. Added
`milestoneTotalsByCurrency()`, which keeps currencies apart and reports milestones
with no recorded amount as excluded rather than adding them as zero. The header
shows no plan total at all when the list could not be read, since a total of zero
would assert an empty plan.

---

## 5. Files

**New:** `backend/services/intelligence/tradeIntelligenceService.js`,
`backend/tests/intelligence-trade.test.js`,
`web/src/components/intelligence/TradeIntelligence.tsx`,
`web/src/components/intelligence/TradeIntelligence.test.tsx`,
`web/src/components/diaspora/DataStateNotes.tsx`

**Modified:** `backend/routes/intelligenceProjectionRoutes.js`,
`web/src/hooks/useCarUpApi.ts`, and the twelve diaspora surfaces listed above,
plus `safeTradeHelpers.ts` / `SafeTradeMilestones.tsx`.

`TradeIntelligence` is **mounted** on the import-order list.

**Migrations: none.**

---

## 6. Verification

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4649 tests, 0 fail**, 21 skipped |
| Web suite | **1237 tests, 114 files, 0 fail** |
| I13 backend tests | 21 pass |
| I13 web tests | 12 pass |
| Web typecheck | clean |
| Web build | clean |

**One existing test was changed, deliberately.** `DiasporaTradeGraph.test.tsx`
asserted that a failed dead-letter read renders `dead-letters-empty` — it was
pinning the fake-zero itself. Its stated intent (the dashboard stays usable) is
preserved; the assertion now requires the unavailable state and forbids the empty
one.

Three test-authoring faults of my own were fixed rather than worked around: a
regex that read "has ever been confirmed" as "never been confirmed", and two
route-source slices bounded at `export default` — which swallowed a *later* route's
doc comment and read its prose as this route's gate. All route-block assertions now
strip comments first.

---

## 7. Carried forward

**To I19 certification:** live settlement cannot be certified — no escrow session has
used a live provider and the database forbids a live SafeTrade payment. Joins I9
(0 work orders), I10 (no live insurer), I11 (no lender), I12 (2 provenance rows).

**To later phases**, found during the sweep and deliberately *not* fixed here:

- **I15 (government):** `GovernmentDashboard.tsx` is the worst surface found so far
  — nothing on it except the duty calculator talks to a server. Hardcoded national
  registration volumes, four literal KPI tiles including a 1.2M-vehicle registry, a
  ZIMRA duty result **seeded into state and rendered before any calculation runs**,
  and a fabricated MFA audit log naming invented officers and IP addresses.
  `ComplianceReports.tsx` has a Download button that resolves a 2-second timer and
  claims success without fetching anything.
- **I16 (command centre):** `AdminDashboard.tsx` renders `'$145,000'` as escrow
  volume whenever the real count is zero, four literal `change` deltas, a seeded
  `stats` object used as the fallback for every field (so a real `0` is replaced by
  the invented seed), and "Online" status for two named third-party companies.
- **Marketing surfaces:** `TrustSafety.tsx` claims funds are "held in a regulated
  trust account", directly contradicting the non-custodial notice the SafeTrade
  components carry; `TrustSafety` and `About` publish two different fabricated
  fraud-detection rates.

**Production boundary respected:** source and staging only.

**Next:** I14 — Referral & Marketing Intelligence.
