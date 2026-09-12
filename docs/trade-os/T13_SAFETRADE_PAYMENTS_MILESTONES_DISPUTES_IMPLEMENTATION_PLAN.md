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

Historical accepted quotes that pre-date one or more of `seller_id`, `quote_amount`, `quote_currency` remain compatible only through an explicitly labelled `LEGACY_INCOMPLETE_ACCEPTED_QUOTE` fallback. Missing canonical fields are recorded. No FX is invented.

This compatibility branch is debt to remove after repository/staging data proves all active accepted quotes have complete commercial facts.

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
3. **Legacy incomplete accepted quotes.** Compatibility fallback must be measured and retired when safe.
4. **UI truth projection.** Existing SafeTrade surfaces are substantial, but the new source-money/provider/ledger distinctions must be checked in the deployed buyer/seller/operator experience.
5. **Live provider/legal/custody.** Not authorized in T13 implementation. Sandbox is sufficient for lifecycle certification; live provider activation requires a separate owner decision.

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
