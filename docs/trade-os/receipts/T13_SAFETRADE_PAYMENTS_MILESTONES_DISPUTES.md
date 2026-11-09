# T13 SafeTrade / Payments / Milestones / Disputes — Implementation Receipt

**Programme:** CarUp Trade OS

**Branch:** `feat/trade-os-client-demo-convergence`

**Starting head:** `8d64418a7de153999a94fb8c09e2bab9caad9140`

**T12:** `T12-USABLE — OWNER ACCEPTED / FROZEN`, runtime `4d880f59`

**T13:** `T13-PARTIAL`

**T14 started:** NO

**Production touched:** NO

## Implemented in this slice

1. Added canonical SafeTrade commercial-truth resolution from the accepted RFQ quote.
2. SafeTrade transaction creation now stores accepted-quote seller/amount/currency when those facts are complete; caller values cannot re-price the transaction.
3. SafeTrade buyer identity is derived from the governed import order rather than blindly copied from the actor creating the overlay.
4. Tenant selection is derived from governed order/context facts; non-privileged caller input cannot mint another tenant.
5. An incomplete accepted quote can no longer authorize a new SafeTrade transaction: creation fails closed (`SAFETRADE_ACCEPTED_QUOTE_INCOMPLETE`) and caller values never fill the missing seller/amount/currency. The first slice's `LEGACY_INCOMPLETE_ACCEPTED_QUOTE` fallback was retired in `7dc80e46`; see "Fallback retirement — measured" below.
6. Added a pure T13 money-truth projection separating source money, milestone state, provider confirmation, ledger application, unresolved reconciliation, disputes and settlement FX.
7. Settlement FX remains absent unless a financial operation supplies complete provider provenance. Reference FX and customs money are explicitly firewalled.
8. Added focused T13 convergence tests and the modern T13 implementation plan.

## Existing authorities intentionally reused

- `diaspora_safetrade_transactions`
- `diaspora_safetrade_milestones`
- `diaspora_safetrade_release_evaluations`
- `diaspora_safetrade_disputes`
- `diaspora_safetrade_dispute_evidence`
- `diaspora_safetrade_delivery_confirmations`
- SafeTrade operations/reconciliation ledger
- maker-checker approval
- durable provider-event ledger
- transactional outbox
- T7 Communications
- T8 Evidence

No new migration is introduced by this slice.

## Truth boundaries

```text
SOURCE COMMERCIAL MONEY != REFERENCE FX != SETTLEMENT MONEY != CUSTOMS MONEY
PROVIDER CONFIRMED != LEDGER APPLIED
DOCUMENT PRESENT != PAYMENT CONFIRMED
CUSTOMS PAYMENT EVIDENCE != SAFETRADE SETTLEMENT
DISPUTE RESOLUTION != REFUND COMPLETED
```

## Not claimed

This receipt does not claim:

- live payments enabled;
- a chosen live payment/escrow provider;
- T13 frozen/owner-accepted;
- release-policy convergence complete;
- logistics-only SafeTrade subject binding complete;
- deployed browser/staging proof complete;
- responsive certification complete.

## Required next hardening

1. Reconcile historical release conditions to current T8/T11/T12 authorities and milestone-specific triggers — **RELEASE-POLICY CONVERGENCE — IMPLEMENTED, MODERATOR REMEDIATION REQUIRED** (plan §9A). Remediation implemented (plan §9B); exact-head staging recertification is recorded outside this file, on PR #207.
2. Audit every SafeTrade UI claim against the new source/provider/ledger truth distinctions.
3. Decide canonical subject binding for logistics-only transactions without creating a second payments authority.
4. ~~Measure/remove the legacy incomplete-quote compatibility path when active data allows.~~ Done for staging (below). Production measurement remains T18's.
5. Run focused + full regression, staging sandbox journeys, responsive review and mutation testing.
6. Close the quote write paths that can still produce an incomplete or unauthorized quote (plan §9 items 3 and 6). The unauthorized legacy route is closed (item 6); completeness checks on the remaining RFQ/workbook write paths and the accept RPC remain (item 3).
7. ~~SafeTrade settlement currencies for the JPY corridor~~ — resolved: JPY settles in JPY, whole yen only, no FX (plan §9 item 7).

## Fallback retirement — measured (2026-09-26)

The first slice deferred retiring the legacy fallback until data proved it safe. The hardening pass (`7dc80e46`) removed it first, and CI went red at `84b2a04` (run `34745007026`): the Phase-9 suite `backend/tests/diaspora-safetrade.test.js` still seeded an accepted quote with no seller, amount or currency, so 6 of 6,459 backend tests hit the new refusal (5 service-level, 1 route-level). No product behaviour was at fault. The fixture modelled a row the database has never been able to hold: `quote_amount` and `quote_currency` have been `NOT NULL` since migration 013.

Before choosing between restoring the fallback and correcting the fixture, the plan's precondition was measured read-only on carup-staging, aggregates only, **with the resolver's own completeness rules** (seller present, amount > 0, three-letter currency):

- 48 `ACCEPTED` quotes, **0** incomplete; 0 open (`DRAFT`/`ISSUED`) quotes incomplete;
- **0** SafeTrade transactions exist, so none was created through the fallback.

Failing closed is therefore the documented rule, and the fixtures were corrected rather than the refusal weakened. `seller_id: 'seller-1'`, `quote_amount: 1000` and `quote_currency: 'USD'` were added to `eligibleSeed` in both `diaspora-safetrade.test.js` and `diaspora-safetrade-authz.test.js`, matching the request `makeDraft` already makes.

**An independent adversarial review (three lenses, mutation-tested) found no blocker, and it found a gap.** No test drove an incomplete quote through `createTransaction` itself. A regression that caught the refusal and fell back to caller values survived every suite (95/95), because the refusal was pinned only in the resolver. Closed with:

- a service-level test (400 `SAFETRADE_ACCEPTED_QUOTE_INCOMPLETE`, all three missing fields named, nothing written) and a route-level test (400, nothing written);
- the missing-entitlement test pinned to `FEATURE_NOT_IN_PLAN`, so it proves the primary gate rather than passing on the eligibility engine's backup;
- `POST /safetrade` no longer defaults a missing currency to `'USD'`. The quote owns the currency, and the default recorded a currency the caller never sent as an "ignored assertion" on every non-USD transaction. Guarded by a route test, which goes red when the default is restored.

SafeTrade suites (`diaspora-safetrade`, `-authz`, `trade-os-t13-safetrade-convergence`): **98/98**.

**Found and recorded, not fixed here** (plan §9 items 3, 6 and 7): product write paths can still create a quote the resolver will refuse; the legacy `POST /import-orders/:id/quotes` inserts before any authorization check; and SafeTrade's currency list (USD/ZAR/GBP/EUR) excludes the corridor's JPY.

**Production was not measured.** It is outside this phase's authority. T18 must repeat the measurement with the same rules.

## Release-policy convergence (2026-09-26) — checkpoint `0105dfd`

Starting authority: branch `feat/trade-os-client-demo-convergence` at `e7b24653` (PR #207 head), `main` `bb9d9900`, clean tree.

- **Root cause.** One global final-state gate served every milestone, so a deposit could not be released before delivery. Fulfilment facts were read from non-owning tables.
- **Change.** The policy is milestone-specific (EARLY / INTERMEDIATE / FINAL, derived from the schema's milestone types). T8, T11 and T12 are read as external authorities, only where a milestone needs them. Unknown or absent milestones are FINAL. Two T12 blocker codes were added: `CUSTOMS_ASSESSMENT_NOT_EVIDENCED` and `DESTINATION_RELEASE_NOT_EVIDENCED`. The dispute gate now also reads active dispute records.
- **Retained.** Held funds, reconciliation, compliance, security hold, reviewer actor, live-payment firewall and HIGH-risk maker-checker all apply to every release.
- **Tests.**
  - `trade-os-t13-release-policy` 20/20.
  - SafeTrade + ST-3 + T13 238/0.
  - Diaspora + Trade OS 2021/0 (7 skipped).
  - Full backend 6524/0 (21 skipped).
  - Lint NET_NEW=0.
- **Mutations.** 13/13 red (plan §9A).
- Full table: plan §9A.

**Certification of `0105dfd` FAILED.** Gate run `36268191057`: Bootstrap and Chromium passed; Tablet, Mobile and Aggregate failed at `spec 33:92`. The moderator also found the T8 gate short of T8 semantics. Status: `RELEASE-POLICY CONVERGENCE — IMPLEMENTED, MODERATOR REMEDIATION REQUIRED`.

## Moderator remediation (2026-09-26)

Starting authority: `0105dfdf` (PR #207 head), `main` `bb9d9900`, clean tree.

- **T8 authority.** Documents are judged on three layers:
  - record: current `diaspora_trade_documents` only;
  - governed type: `trade_document_types.verification_required`;
  - reviewer verdict: the latest `diaspora_trade_document_verifications` row for that document id.

  REJECTED blocks. VERIFIED passes. No verdict blocks only when the type requires one, or the type is ungoverned. Extraction is never a verdict. A replacement starts unreviewed. Legacy `vehicle_government_documents` neither satisfies nor vetoes. No universal required-document rule was invented.
- **Seller/Parts shard.** A PRODUCT DEFECT: a pre-existing render/fetch loop in `DiasporaStockManager` (issue #128 class). The traces show about 2,100 list requests in 19 s and no PATCH. Fixed by keying the loaders on memoized methods, with a request-count regression test. The spec is unchanged.
- **Tests.**
  - `trade-os-t13-release-policy` 27/27.
  - SafeTrade + ST-3 + T13 245/0.
  - T8 30/0.
  - Diaspora + Trade OS 2021/0 (7 skipped).
- **Mutations.** 10 of 11 T8 mutations red; the eleventh is inert by construction (plan §9B).
- Full detail: plan §9B.

Production touched: NO. T14 started: NO. JPY and quote-authorization work: not reopened.

## Verdict

`T13-PARTIAL — CORE COMMERCIAL-MONEY CONVERGENCE IMPLEMENTED; HARDENING + DEPLOYED CERTIFICATION REMAIN.`
