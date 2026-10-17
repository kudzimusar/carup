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

1. **RELEASE-POLICY CONVERGENCE — IMPLEMENTED, MODERATOR REMEDIATION REQUIRED (2026-09-26, §9A; remediation §9B).** Release eligibility is now milestone-specific. T8/T11/T12 facts are read from their frozen owners, and only for the milestones they gate. Every SafeTrade assurance gate still applies to every release.
2. **Logistics-only subject binding.** Current SafeTrade transactions require `import_order_id`. Trade OS logistics can exist without a procurement import order. T13 needs a canonical subject-binding decision that reuses SafeTrade rather than creating a second payments system.
3. **Incomplete accepted quotes — fallback retired, write paths still open.** The fallback is retired (`7dc80e46`) and staging measured 0 of 48 incomplete (§4). But product write paths can still create a quote the resolver will refuse, and nothing refuses it earlier: legacy `addQuote` writes `seller_id: payload.seller_id || null` with an unvalidated amount and currency; RFQ `updateQuote` copies `quote_currency` unvalidated and `submitQuoteById` does not re-validate; a workbook-imported draft can carry `quote_amount || 0`; and `diaspora_accept_quote_atomic` accepts any `ISSUED` quote without checking completeness. Close these by requiring the complete triple before a quote can be `ISSUED` or `ACCEPTED`, then add the equivalent `CHECK` (`NOT VALID` first). The governed repair path for an existing incomplete row is not yet named.
4. **UI truth projection.** Existing SafeTrade surfaces are substantial, but the new source-money/provider/ledger distinctions must be checked in the deployed buyer/seller/operator experience.
5. **Live provider/legal/custody.** Not authorized in T13 implementation. Sandbox is sufficient for lifecycle certification; live provider activation requires a separate owner decision.
6. **Legacy quote write — CLOSED (2026-09-26).** `POST /import-orders/:id/quotes` authenticated but did not authorise, inserted before any check and took `seller_id` from the body. Now every check runs before any write. The seller is server-derived (an assigned seller quotes only as themselves, and an operator only for a seller assigned to this order). The buyer, outsiders and foreign tenant admins are refused, money is validated with no USD default, and the transition is pre-checked. `assign-seller`, which grants the authority quoting relies on, had the same insert-first defect and is now restricted to platform operators or the order's tenant admin. `diaspora-legacy-quote-authz.test.js`: 18 tests, each refusal proven to mutate nothing. The original code fails 14 of them, and 3 guard mutations are each red.
7. **SafeTrade currencies vs the trade corridor — RESOLVED (2026-09-26): JPY settles in JPY.** SafeTrade now supports JPY directly. The accepted quote's JPY is the settlement money, so no settlement FX exists to source or reconcile, and `settlementFx` stays `null`. A caller asserting USD is recorded and ignored, never applied. JPY has no minor unit, so a fractional yen is refused in an accepted quote (`SAFETRADE_QUOTE_AMOUNT_NOT_REPRESENTABLE`) and in any milestone (`CURRENCY_MINOR_UNIT_VIOLATION`), checked on the raw figure and never rounded. `constants/diaspora/currencyMinorUnits.js` declares minor units for every supported currency, pinned by test. Currencies outside the list stay `UNSUPPORTED_CURRENCY`. The web `formatMoney` no longer renders a missing currency as USD. Tests: `trade-os-t13-jpy-settlement.test.js` (7), with three mutations each red. A separate settlement currency with transaction FX was not modelled: it needs provider FX provenance, which remains a live-provider decision (item 5).

## 9A. Release-policy convergence (2026-09-26)

**Historical behaviour.** `evaluateRelease` judged every release as the FINAL release of the whole transaction. Whatever milestone was being released, it required APPROVED compliance, every `vehicle_government_documents` row VERIFIED, a `diaspora_shipments` row ARRIVED/RELEASED/COMPLETED, and the buyer's delivery confirmation. A deposit therefore could not be released until the goods had been delivered. It also read fulfilment facts from tables that are no longer their owners: the legacy vehicle-government table stood in for the T8 evidence authority, and T11's RELEASED/COMPLETED stood in for customs facts that T11 hands to T12 (`STAGES_HANDED_TO_T12`).

**Authority map.**

| blocker | current source | owning authority | relevant to | irrelevant to | change |
|---|---|---|---|---|---|
| PAYMENT_NOT_HELD | this milestone's status | T13 | every milestone | — | unchanged |
| TOTALS_UNRECONCILED | milestone sum vs total | T13 | every milestone | — | unchanged |
| COMPLIANCE_NOT_APPROVED | `diaspora_compliance_reviews` | T13 assurance (human review) | every milestone | — | unchanged (a safety gate, not a fulfilment fact) |
| DOCUMENTS_NOT_VERIFIED | `diaspora_trade_documents`, current version | **T8** | PROGRESS, SHIPMENT, CUSTOMS_DUTY, DELIVERY, RELEASE, any milestone with trigger `ON_DOCUMENTS_VERIFIED_REVIEWED` | DEPOSIT, FEE, INSURANCE | satisfier moved to T8 (deleted/superseded excluded). *At `0105dfd`: a legacy `vehicle_government_documents` row could still block, and T8 was read from the document's own status column. Superseded by §9B: governed type + reviewer verdict; legacy neither satisfies nor vetoes.* |
| SHIPMENT_MILESTONE_NOT_REACHED | `diaspora_shipments.status` by T11 stage rank | **T11** | SHIPMENT (≥ IN_TRANSIT), DELIVERY/RELEASE (≥ ARRIVED) | DEPOSIT, FEE, INSURANCE, PROGRESS, CUSTOMS_DUTY | milestone-specific; EXCEPTION proves no progress |
| CUSTOMS_ASSESSMENT_NOT_EVIDENCED *(new)* | `diaspora_customs_events` on the order's live case | **T12** | CUSTOMS_DUTY | all others | document-backed ASSESSMENT_EVIDENCE only; payment evidence satisfies nothing |
| DESTINATION_RELEASE_NOT_EVIDENCED *(new)* | `diaspora_customs_events` | **T12** | DELIVERY, RELEASE | all others | AUTHORITY_DOCUMENT release evidence only; a reported release is not an evidenced one |
| DELIVERY_NOT_CONFIRMED | transaction `deliveryConfirmed` flag | T13 (buyer acknowledgement) | DELIVERY, RELEASE, any milestone with trigger `ON_DELIVERY_CONFIRMED_REVIEWED` | DEPOSIT, FEE, INSURANCE, PROGRESS, SHIPMENT, CUSTOMS_DUTY | milestone-specific; a T12 DELIVERY_OBSERVED is not accepted |
| ACTIVE_DISPUTE | transaction `DISPUTED` **and now** active `diaspora_safetrade_disputes` rows | T13 | every milestone | — | strengthened: an active dispute record blocks even if the transaction status lags |
| SECURITY_HOLD | metadata flag / SUSPENDED | T13 | every milestone | — | unchanged |
| ACTOR_NOT_AUTHORIZED | server-derived platform role | T13 | every milestone | — | unchanged |
| LIVE_PAYMENT_DISABLED | provider / live flag | T13 | every milestone | — | unchanged |
| REVIEWER_APPROVAL_REQUIRED | recorded reviewer evaluation | T13 maker-checker | every HIGH-risk release, any class | — | unchanged |

**The model.** `MILESTONE_RELEASE_POLICY` maps the schema's own milestone types to three classes, using no new vocabulary, table or percentage:
- **EARLY** — DEPOSIT, FEE, INSURANCE.
- **INTERMEDIATE** — PROGRESS, SHIPMENT, CUSTOMS_DUTY.
- **FINAL** — DELIVERY, RELEASE.

REFUND, an unknown type, or an evaluation with no `milestoneId` is **FINAL**. A milestone's `release_trigger` can add a requirement and never removes one. The verdict now states `releaseClass`, `milestoneType` and `requirements`. `eligible:true` remains permission for the release path to proceed. It is not provider confirmation, ledger application or funds released, and the engine still writes nothing.

**Retained, unchanged:**
- held funds;
- reconciliation;
- compliance;
- security hold;
- the reviewer actor;
- the live-payment firewall;
- HIGH-risk maker-checker, including the existing ST-3 approval request, the self-approval refusal and the `EVALUATION_NOT_REVIEWED` refusal;
- provider dispatch ≠ confirmation ≠ ledger;
- operation idempotency;
- sandbox-only execution.

**Proof.** `backend/tests/trade-os-t13-release-policy.test.js` holds 20 tests with a positive control for every refusal. The shared SafeTrade fixture now seeds the modern authorities, with no assertion changed. The mutation matrix has 13 mutations, all red. M13's first form survived because a second, independent rank lookup still refused EXCEPTION; re-applied at the rank table, it went red.

**Checkpoint `0105dfd` — certification FAILED.** Exact-head gate run `36268191057`: Bootstrap and Chromium passed; Tablet, Mobile and Aggregate failed at `tests/agents/33-diaspora-staging-browser-parts.spec.ts:92` (`diaspora-stock-merch-result` not found). The moderator also found the T8 gate short of T8's own semantics. Disposition: `T13-PARTIAL — RELEASE-POLICY IMPLEMENTATION SUBSTANTIALLY CORRECT; T8 AUTHORITY REMEDIATION + EXACT-HEAD STAGING RECERTIFICATION REQUIRED`. §9B records the remediation. Nothing above is rewritten.

## 9B. Moderator remediation (2026-09-26)

### T8 authority

The `0105dfd` gate treated a document as verified when its own `verification_status` column said so, required every current document to be verified whatever its type, and let an unverified legacy `vehicle_government_documents` row veto. It now judges documents the way T8 does (`tradeDocumentWorkspaceService.projectRow`):

| layer | source | rule |
|---|---|---|
| record | `diaspora_trade_documents` | current version only: not deleted, not superseded |
| governed type | `trade_document_types.verification_required` by code | decides whether a verdict is needed at all |
| verdict | latest `diaspora_trade_document_verifications` row for **that** document id | written only by T8's verify/reject routes |

| state | gate |
|---|---|
| latest verdict REJECTED (any type) | BLOCK |
| latest verdict VERIFIED | pass |
| no verdict, type requires verification | BLOCK (awaiting review) |
| no verdict, type does not require verification | pass (supplied) |
| no verdict, type not in T8's vocabulary | BLOCK (no rule says a verdict is unnecessary) |
| no current document at all | BLOCK |

- OCR/extraction is never verification. `OCR_EXTRACTED`, and even a `VERIFIED` status column with no verdict record, blocks.
- A verdict belongs to the version it was given on, so a replacement starts unreviewed. Verdicts are fetched only for current document ids, so a predecessor's verdict cannot be read at all. A rejected version that has been replaced no longer speaks.
- `vehicle_government_documents` is no longer read. No canonical compatibility rule exists, so it neither satisfies nor vetoes.
- T8 defines no per-type "required documents" rule, and none is invented. T8 readiness (`requested`) is not read by this gate.

Proof: `trade-os-t13-release-policy` 27/27, including the seven required cases (verification-required without verdict → BLOCK; verified verdict → PASS; not-required → not blocked; OCR-only → not verified; superseded verified does not bless its replacement; legacy-only neither satisfies nor vetoes; rejected → BLOCK), plus latest-verdict-wins, mixed, empty and ungoverned-type cases.

Mutation matrix, 11 mutations:
- Red (10):
  - T1: verdict requirement ignored;
  - T2: VERIFIED verdict ignored;
  - T3: every type requires a verdict;
  - T4: status column read as verdict;
  - T5: superseded versions counted (red after the replaced-rejected case was added; it survived first);
  - T6: legacy veto restored;
  - T7: REJECTED ignored;
  - T8: earliest verdict wins;
  - T9: empty passes;
  - T10: ungoverned type passes.
- Inert by construction (1): T5b, a replacement inheriting its predecessor's verdict. Verdicts are fetched only for current document ids.

One Phase-9 SafeTrade test ("missing document blocks release") proved blocking with a pending *legacy* row. Under the ruling that legacy must not veto, it now proves blocking with a current T8 document that has no verdict. The shared fixture seeds the governed type and a reviewer verdict.

### Seller/Parts shard (`spec 33:92`)

Classification: **PRODUCT DEFECT** — a pre-existing render/fetch loop in `DiasporaStockManager`, present on `main` (`bb9d990`). It is not cross-shard contamination, stale data, an environment failure or a responsive defect.

Evidence (exact-head run `36268191057`):
- The tablet trace recorded **2,107 GET `/diaspora/stock` and 2,106 GET `/diaspora/supply-documents` in 19 s**, and **no PATCH**. The mobile trace recorded 2,389 and 2,388, and no PATCH.
- The page snapshot shows the form filled, Save enabled, and neither the result nor the error element present.
- Staging audit log: the tablet and mobile rows each have only `STOCK_ITEM_CREATED` and `STOCK_ADD`, with no `STOCK_ITEM_UPDATED`. The Chromium row has both, plus `STOCK_ITEM_PUBLISHED`.
- Each shard created and operated on its own new row, so shared-`uat.seller` contamination did not occur. A 409 `STALE_STOCK_VERSION` was ruled out because no PATCH was sent.

Mechanism. The loaders were keyed on the aggregate `useCarUpApi()` object. That hook returns a new object every render and owns loading state, so every request re-rendered the page, recreated `loadList`/`loadDocs` and re-fired the mount effect: the issue #128 defect, fixed on the trade-profile page but never on the stock manager. The spec's forced click (`force: true`) lands on a page that is re-rendering many times a second. Whether the handler runs is timing luck. Chromium won it this run and lost it at `3cdae37`.

Fix: the loaders depend on the individually memoized methods, not the aggregate. `DiasporaStockManager.requests.test.tsx` uses a mock that re-renders on every request, as the real hook does. It asserts one list load and one document load on mount, one reload after create, and exactly one PATCH carrying `expected_updated_at`. Both tests are red without the fix. The spec is unchanged: no skip, no timeout change, and the merch-save proof is kept.

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
