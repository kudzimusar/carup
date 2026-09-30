# Trade OS T13 — SafeTrade / Payments / Milestones / Disputes Implementation Plan

**Status:** ACTIVE — first convergence slice implemented; full staging/browser certification and owner acceptance remain.

**Canonical programme:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md`

**Branch:** `feat/trade-os-client-demo-convergence`

**Production:** NOT AUTHORIZED.

## 1. Purpose

T13 converges the existing Phase-9 SafeTrade foundation into the current Trade OS architecture. It is not a greenfield payment system.

T13 owns settlement workflow and assurance. It does not own commercial pricing (T6), documents (T8), warehouse/load/shipment facts (T9–T11), customs money/release (T12), reputation (T14), intelligence (T15), AI authority (T16), commercial plan/fee policy (T17), or production release (T18).

Permanent money model:

```text
SOURCE COMMERCIAL MONEY
!= REFERENCE FX PRESENTATION
!= SETTLEMENT MONEY
!= CUSTOMS MONEY

QUOTE
!= AMOUNT DUE
!= PAYMENT REQUEST
!= PAYMENT INITIATED
!= PROVIDER CONFIRMED
!= FUNDS HELD
!= MILESTONE SATISFIED
!= RELEASE APPROVED
!= FUNDS RELEASED
!= REFUNDED
```

## 2. Existing authorities reused

| Fact / operation | Authority | T13 disposition |
|---|---|---|
| accepted commercial quote | `diaspora_import_quotes` | authoritative source money when amount/currency/seller are present |
| SafeTrade case | `diaspora_safetrade_transactions` | reuse |
| milestones | `diaspora_safetrade_milestones` | reuse |
| release evaluations | `diaspora_safetrade_release_evaluations` | reuse |
| disputes/evidence | `diaspora_safetrade_disputes`, `_dispute_evidence` | reuse |
| delivery acknowledgement | `diaspora_safetrade_delivery_confirmations` | reuse only as SafeTrade acknowledgement; T12 remains physical-delivery authority |
| provider operations/reconciliation | `diaspora_safetrade_operations` | reuse |
| maker-checker approvals | existing SafeTrade approval authority | reuse |
| durable provider-event dedupe | existing SafeTrade provider-event ledger | reuse |
| outbox | existing SafeTrade transactional outbox | reuse |
| evidence bytes/documents | T8 | no new store |
| communications | T7 | no new message authority |

## 3. T13.0 authority audit result

The historical SafeTrade implementation is materially complete in backend capability and already includes sandbox provider operations, atomic state/milestone RPCs, disputes, evidence privacy, maker-checker approval, durable provider-event dedupe, transactional outbox and a reconciliation queue.

The first material current-Trade-OS gap was at transaction creation: `sellerId`, `currency` and `totalAmount` were accepted from the caller even though an accepted RFQ quote already exists. That allowed SafeTrade to become a second commercial-money authority.

The first T13 convergence slice therefore makes accepted quote truth load-bearing.

## 4. T13.1 commercial-money convergence

`diasporaSafeTradeCommercialTruthService.js` now resolves:

- the authoritative import order;
- server-derived actor authority;
- the accepted quote named by the order;
- canonical buyer;
- canonical seller/amount/currency from the accepted quote when complete;
- transaction tenant from governed order/context facts;
- explicit provenance.

A complete accepted quote wins over caller assertions. Mismatching caller seller/currency/amount values are recorded as ignored assertions and can never re-price the SafeTrade transaction.

An accepted quote that the resolver cannot read as complete — no `seller_id`, no positive `quote_amount`, or no three-letter `quote_currency` — **cannot authorize a new SafeTrade transaction** (`SAFETRADE_ACCEPTED_QUOTE_INCOMPLETE`, fail closed). Caller values can never fill the gap. Such a row must be repaired through a governed path, never by trusting a client's financial assertion. No FX is invented.

**The retirement precondition was measured, not assumed (2026-09-26).** The first slice kept a `LEGACY_INCOMPLETE_ACCEPTED_QUOTE` fallback as debt "to remove after repository/staging data proves all active accepted quotes have complete commercial facts". `7dc80e46` removed it; the precondition was then measured read-only on carup-staging (`eoyenigwevnxwwhyhaer`), aggregates only, **using the resolver's own completeness rules**:

| measure | value |
|---|---|
| `ACCEPTED` quotes (none soft-deleted) | 48 |
| … `seller_id` missing or blank | **0** |
| … `quote_amount` null or ≤ 0 | **0** |
| … `quote_currency` not a three-letter code | **0** |
| open (`DRAFT`/`ISSUED`) quotes failing the same rules | **0** |
| existing `diaspora_safetrade_transactions` | 0 |

The schema guarantees less than the resolver requires. `quote_amount` and `quote_currency` are `NOT NULL` (since migration 013), but nothing enforces a positive amount or a three-letter currency, and `seller_id` is nullable **and** `REFERENCES users(id) ON DELETE SET NULL` — so a complete row can become incomplete later. The zeros above are a point-in-time fact, not an invariant; that is an argument *for* failing closed, and it is why §9 item 3 remains open.

On staging, no reachable data depends on the fallback, and no transaction was created through it. The test fixtures that still modelled an incomplete accepted quote — `diaspora-safetrade.test.js` and `diaspora-safetrade-authz.test.js` — were corrected to carry the complete triple, and the refusal itself is now pinned at the service and route level, not only in the resolver. **Production was not measured**: it is outside this phase's authority. T18 must repeat this measurement with the same rules before production readiness.

## 5. T13.2 money-truth projection

`diasporaSafeTradeMoneyTruthService.js` provides a pure read-only projection that keeps separate:

- source commercial money;
- milestone plan total;
- pending/held/released/refunded milestone values;
- provider-confirmed operations;
- ledger-applied operations;
- unresolved/reconciling operations;
- open disputes;
- settlement FX.

Settlement FX is `null` unless a specific financial operation contains complete provider provenance (rate, source, currencies, effective time). T6 reference FX and T12 customs FX/payment evidence are never consumed as settlement truth.

## 6. Existing SafeTrade behavior preserved

The slice deliberately does not replace:

- sandbox-only/fail-closed provider behavior;
- `EXTERNAL_ACTIVATION_REQUIRED` live-money firewall;
- milestone reconciliation and idempotency;
- provider-before-ledger reconciliation handling;
- maker-checker high-risk release;
- disputes/refunds;
- server-side evidence privacy;
- operator reconciliation/dead-letter surfaces;
- server-derived available actions.

## 7. Milestone policy

No universal deposit/balance percentage is introduced. Existing milestone authority already requires exact reconciliation to the SafeTrade total and matching currency.

The product may support DEPOSIT/BALANCE and other governed milestone types, but commercial percentages remain transaction-specific unless a later owner-approved product policy defines them.

## 8. Phase firewalls

### T6
Accepted commercial quote owns source money. T13 never recalculates T6 pricing and never treats reference USD/ECB FX as settlement FX.

### T7
Communications describes committed financial facts. Message delivery cannot create/undo a financial fact.

### T8
Invoice/receipt/dispute evidence remains evidence. Presence/OCR does not prove provider settlement.

### T11
Shipment movement may become a release condition but T13 cannot create movement.

### T12
Customs assessment/payment/release evidence is not T13 settlement. T13 settlement is not customs release.

## 9. Known convergence work for the hardening round

The following are deliberately recorded for the next audit rather than hidden:

1. **Release-policy convergence.** The historical release policy still reads legacy government-document/import-order status assumptions broadly. It must be reconciled against T8/T11/T12 facts and milestone-specific release triggers without making deposit/intermediate releases depend on final delivery.
2. **Logistics-only subject binding.** Current SafeTrade transactions require `import_order_id`. Trade OS logistics can exist without a procurement import order. T13 needs a canonical subject-binding decision that reuses SafeTrade rather than creating a second payments system.
3. **Incomplete accepted quotes — fallback retired, write paths still open.** The fallback is retired (`7dc80e46`) and staging measured 0 of 48 incomplete (§4). But product write paths can still create a quote the resolver will refuse, and nothing refuses it earlier: legacy `addQuote` wrote `seller_id: payload.seller_id || null` with an unvalidated amount and currency (retired in `dd7bac20`, item 6); RFQ `updateQuote` copies `quote_currency` unvalidated and `submitQuoteById` does not re-validate; a workbook-imported draft can carry `quote_amount || 0`; and `diaspora_accept_quote_atomic` accepts any `ISSUED` quote without checking completeness. Close these by requiring the complete triple before a quote can be `ISSUED` or `ACCEPTED`, then add the equivalent `CHECK` (`NOT VALID` first). The governed repair path for an existing incomplete row is not yet named.
4. **UI truth projection.** Existing SafeTrade surfaces are substantial, but the new source-money/provider/ledger distinctions must be checked in the deployed buyer/seller/operator experience.
5. **Live provider/legal/custody.** Not authorized in T13 implementation. Sandbox is sufficient for lifecycle certification; live provider activation requires a separate owner decision.
6. **Legacy quote write is not authorized (security, pre-existing) — CLOSED in `dd7bac20`.** `POST /api/diaspora/import-orders/:id/quotes` was guarded only by authentication, and `addQuote` inserted before any authorization check. When the order was already `QUOTE_ISSUED`, no check ran at all, and when the later transition check did refuse, the row was already written. Any signed-in user could write a complete quote on someone else's order in any seller's name, and SafeTrade would take an accepted one as commercial authority. Reproduced first through the real router: a non-participant got 201 on a `QUOTE_ISSUED` order, and 403 with the forged row already written on an `IMPORT_REQUESTED` order. **Closed by retiring the route, not guarding it.** It now answers 410 `LEGACY_IMPORT_ORDER_QUOTE_WRITE_RETIRED` to every signed-in caller and writes nothing, and `addQuote` is deleted. Nothing called it: no web, mobile, e2e, script or test caller. A guard alone would not have held, because `assign-seller` lets anyone become the "assigned seller" (item 8). Sellers and operators quote through RFQ `createQuote`, which derives `seller_id` from the caller and validates amount and ISO currency. Pinned by `backend/tests/diaspora-legacy-quote-route.test.js`: refused with nothing written for a non-participant and for every other caller; seller and operator quoting still works on the RFQ path, with a body `seller_id` ignored. **Not done:** rows the retired route already wrote are not repaired. They are the `diaspora_import_audit_log` rows with action `QUOTE_ISSUED` on resource type `diaspora_import_quote` (the RFQ path writes `RFQ_QUOTE_*`), and staging has not been checked for them.
7. **SafeTrade currencies vs the trade corridor.** SafeTrade supports USD, ZAR, GBP and EUR only, while the Japan→Zimbabwe corridor prices in JPY. A JPY accepted quote is refused (`UNSUPPORTED_CURRENCY`), never converted — correct, but it means SafeTrade cannot yet serve the corridor's core purchase. Staging has 2 accepted quotes outside the SafeTrade currency list. Which currencies SafeTrade settles in is an owner/provider decision, not an FX shortcut.
8. **Anyone can join any import order as its seller (security, pre-existing; found while closing item 6, not fixed).** `POST /api/diaspora/import-orders/:id/assign-seller` is guarded only by authentication. `assignSeller` inserts the participant row, with `user_id` taken from the body, before any check. The transition check that follows is skipped when the order is already `SELLER_ASSIGNED`, and when it does run the caller passes it, because they have just become a participant. Measured against the service: a stranger assigning themselves is accepted from `IMPORT_REQUESTED` and from `SELLER_ASSIGNED`, the order moves to `SELLER_ASSIGNED`, and `getImportOrder` then lets them read the order with its quotes, documents and payment milestones. Participant status also grants the participant transitions. The web client calls this route, so fixing it means deciding who may assign a seller (the buyer, an operator or a tenant admin) before the insert.

## 10. Certification plan

Before T13 can freeze:

- focused T13 convergence tests;
- existing SafeTrade/ST-3 suites;
- payment/provider-event idempotency;
- dispute/evidence privacy;
- maker-checker;
- T6/T7/T8/T11/T12 firewalls;
- full backend/web/typecheck/lint/build;
- governed FE/BE pairing;
- sandbox staging journeys A–G;
- seven-width responsive review;
- mutation matrix covering client payment confirmation, FX collapse, double provider replay, maker-self-approval, dispute bypass, evidence-as-payment and T12/T13 cross-contamination.

## 11. Current phase verdict

`T13-PARTIAL` — commercial-money authority convergence and explicit money-truth projection implemented. Full release-policy convergence, deployed product certification and owner acceptance remain.

T14 has not started. Production remains untouched.
