# PAY-04 integrated PostgreSQL certification — both orders

Disposable PostgreSQL 17 (`pay01c_sandbox_ci` on 127.0.0.1:55432), `scripts/ci/pay04-postgres-certification.sh`. Migrations unchanged since `03118b5a`; the same script runs in CI on every push (§1 of the certification).

## payments-first

```
#### Phase 1 (payments-first): upgrade — PAY-04 preserves OPS07 history, derived balances and canonical payments
PAY01C_POSTGRES_SMOKE_PASS: isolated claim, RLS, idempotency, refund and monotonic entitlement
PAY02_POSTGRES_SMOKE_PASS: 66-item DB catalogue, RLS, ACLs, atomic governance version advancement, quote idempotency/immutability, report order lifecycle, multi-party separation, and canonical payment
PAY03A_POSTGRES_SMOKE_PASS: Canonical vehicle/report schema preserved, synthetic fixtures segregated, atomic report fulfillment, idempotent replay, restrictive RLS, and refund revocation verified
STG01_R3_R1_ATOMIC_EVIDENCE_REVIEW_SMOKE_PASS: Atomic audit + status + provenance transaction, self-review refusal, idempotent replay, and conflict guard verified
PAY03B_F5_SMOKE E PASS: pending partial held, provider full refund supersedes and revokes
PAY03B_F5_SMOKE F PASS: self-dealing refused, settled partial required, final revocation permanent
PAY03B_F5_SMOKE G-H PASS: first-observation convergence, refund completion keeps the hold
PAY03B_F5_POSTGRES_SMOKE_PASS: partial-refund reconciliation hold, governed resolution, convergence and isolation
PAY03B_SUB_SMOKE S1-S2 PASS: least privilege, governance inventory (7 products, none sellable), immutability
PAY03B_SUB_SMOKE S3 PASS: sandbox plans need Owner authorization, governed product scope and a permitted gateway
PAY03B_SUB_SMOKE S4-S9 PASS: authority, idempotency, one live subscription, paid-period access, renewal, failed renewal, recovery
PAY03B_SUB_SMOKE S10-S12 PASS: change authority/policy, entitlement follows paid plan, proration refused, period-end cancellation keeps paid access
PAY03B_SUB_SMOKE S13 PASS: invoice partial refund holds access, governed restore, full refund ends paid coverage
PAY03B_SUB_SMOKE S14-S17 PASS: approved grace only, immediate cancel by terms, admin suspension, member removal, immutability
PAY03B_SUB_SMOKE S18 PASS: simulator gateway refused by default, explicit disposable enablement only
PAY03B_SUBSCRIPTIONS_POSTGRES_SMOKE_PASS: canonical subscription authority, paid-period entitlements, invoices bound 1:1 to the canonical ledger
PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: R1 R2 R3 R4 R5 R6 R8 R10 R11 R14 verified on the canonical functions
PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: L2-03 a refund-driven coverage revocation names the canonical payment outcome
#### Phase 2 (payments-first): behaviour — certified PAY smokes on the PAY-04 writers, then the PAY-04 smokes
PAY01C_POSTGRES_SMOKE_PASS: isolated claim, RLS, idempotency, refund and monotonic entitlement
PAY02_POSTGRES_SMOKE_PASS: 66-item DB catalogue, RLS, ACLs, atomic governance version advancement, quote idempotency/immutability, report order lifecycle, multi-party separation, and canonical payment
PAY03A_POSTGRES_SMOKE_PASS: Canonical vehicle/report schema preserved, synthetic fixtures segregated, atomic report fulfillment, idempotent replay, restrictive RLS, and refund revocation verified
STG01_R3_R1_ATOMIC_EVIDENCE_REVIEW_SMOKE_PASS: Atomic audit + status + provenance transaction, self-review refusal, idempotent replay, and conflict guard verified
PAY03B_F5_SMOKE E PASS: pending partial held, provider full refund supersedes and revokes
PAY03B_F5_SMOKE F PASS: self-dealing refused, settled partial required, final revocation permanent
PAY03B_F5_SMOKE G-H PASS: first-observation convergence, refund completion keeps the hold
PAY03B_F5_POSTGRES_SMOKE_PASS: partial-refund reconciliation hold, governed resolution, convergence and isolation
PAY03B_SUB_SMOKE S1-S2 PASS: least privilege, governance inventory (7 products, none sellable), immutability
PAY03B_SUB_SMOKE S3 PASS: sandbox plans need Owner authorization, governed product scope and a permitted gateway
PAY03B_SUB_SMOKE S4-S9 PASS: authority, idempotency, one live subscription, paid-period access, renewal, failed renewal, recovery
PAY03B_SUB_SMOKE S10-S12 PASS: change authority/policy, entitlement follows paid plan, proration refused, period-end cancellation keeps paid access
PAY03B_SUB_SMOKE S13 PASS: invoice partial refund holds access, governed restore, full refund ends paid coverage
PAY03B_SUB_SMOKE S14-S17 PASS: approved grace only, immediate cancel by terms, admin suspension, member removal, immutability
PAY03B_SUB_SMOKE S18 PASS: simulator gateway refused by default, explicit disposable enablement only
PAY03B_SUBSCRIPTIONS_POSTGRES_SMOKE_PASS: canonical subscription authority, paid-period entitlements, invoices bound 1:1 to the canonical ledger
PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: R1 R2 R3 R4 R5 R6 R8 R10 R11 R14 verified on the canonical functions
PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: L2-03 a refund-driven coverage revocation names the canonical payment outcome
PAY04_INTEGRITY_SMOKE I2-I11 PASS: unrecorded, foreign-job, foreign-garage, reversed, over-quantity and mis-categorised lines refused
PAY04_INTEGRITY_SMOKE I1 I12 S PASS: provenance-bound lines issue, void + re-issue is the adjustment path, invoicing never moves stock
PAY04_INTEGRITY_SMOKE I13 I14 PASS: legacy lines are history; a billed part reverses only after its invoice is voided
PAY04_INTEGRITY_SMOKE P PASS: instructions are garage-owned, versioned, append-only, admin-only and audited
PAY04_GARAGE_INVOICE_INTEGRITY_POSTGRES_SMOKE_PASS: line provenance, no stock side effects, adjustment by void + re-issue, payment instructions
PAY04_PROVIDER_SMOKE G PASS: runtime-guarded simulator only, platform-operator registration, CarUp Stripe refused, immutable merchant identity
PAY04_PROVIDER_SMOKE A PASS: customer-only initiation, currency and precision, idempotent per payer key, canonical third-party row
PAY04_PROVIDER_SMOKE R PASS: in-flight money reserved against declared payments, new collections and void; an unattached stop closes it
PAY04_PROVIDER_SMOKE L PASS: attach once, confirmed money allocated with the next shared receipt number, replay-safe, garage refund lifecycle
PAY04_PROVIDER_SMOKE X PASS: stop/expiry hold the room until the provider confirms closure; money that beat a stop counts; closed collections never attach
PAY04_PROVIDER_SMOKE H PASS: F5 partial-refund hold reused, sticky, governed release only, operator final/restore re-project the garage invoice, later refunds de-count, garage members conflicted
PAY04_PROVIDER_SMOKE D PASS: mismatches recorded never applied and block counting, operator closure governed and sticky, late money unallocated until refunded or re-projected
PAY04_PROVIDER_SMOKE I PASS: append-only ledger and history, governed-writer-only allocation, receipts = counted money, shared numbering, least privilege
PAY04_PROVIDER_SMOKE N PASS: confirmed/refunded notifications are once-only by their own trigger; the shared function is untouched
PAY04_GARAGE_PROVIDER_PAYMENTS_POSTGRES_SMOKE_PASS: third-party garage money on the canonical ledger, F5 reused, reservations, discrepancies, invariants
PAY04_POSTGRES_CERTIFICATION_PASS (payments-first)
```

## garage-first

```
#### Phase 1 (garage-first): upgrade — PAY-04 preserves OPS07 history, derived balances and canonical payments
PAY01C_POSTGRES_SMOKE_PASS: isolated claim, RLS, idempotency, refund and monotonic entitlement
PAY02_POSTGRES_SMOKE_PASS: 66-item DB catalogue, RLS, ACLs, atomic governance version advancement, quote idempotency/immutability, report order lifecycle, multi-party separation, and canonical payment
PAY03A_POSTGRES_SMOKE_PASS: Canonical vehicle/report schema preserved, synthetic fixtures segregated, atomic report fulfillment, idempotent replay, restrictive RLS, and refund revocation verified
STG01_R3_R1_ATOMIC_EVIDENCE_REVIEW_SMOKE_PASS: Atomic audit + status + provenance transaction, self-review refusal, idempotent replay, and conflict guard verified
PAY03B_F5_SMOKE E PASS: pending partial held, provider full refund supersedes and revokes
PAY03B_F5_SMOKE F PASS: self-dealing refused, settled partial required, final revocation permanent
PAY03B_F5_SMOKE G-H PASS: first-observation convergence, refund completion keeps the hold
PAY03B_F5_POSTGRES_SMOKE_PASS: partial-refund reconciliation hold, governed resolution, convergence and isolation
PAY03B_SUB_SMOKE S1-S2 PASS: least privilege, governance inventory (7 products, none sellable), immutability
PAY03B_SUB_SMOKE S3 PASS: sandbox plans need Owner authorization, governed product scope and a permitted gateway
PAY03B_SUB_SMOKE S4-S9 PASS: authority, idempotency, one live subscription, paid-period access, renewal, failed renewal, recovery
PAY03B_SUB_SMOKE S10-S12 PASS: change authority/policy, entitlement follows paid plan, proration refused, period-end cancellation keeps paid access
PAY03B_SUB_SMOKE S13 PASS: invoice partial refund holds access, governed restore, full refund ends paid coverage
PAY03B_SUB_SMOKE S14-S17 PASS: approved grace only, immediate cancel by terms, admin suspension, member removal, immutability
PAY03B_SUB_SMOKE S18 PASS: simulator gateway refused by default, explicit disposable enablement only
PAY03B_SUBSCRIPTIONS_POSTGRES_SMOKE_PASS: canonical subscription authority, paid-period entitlements, invoices bound 1:1 to the canonical ledger
PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: R1 R2 R3 R4 R5 R6 R8 R10 R11 R14 verified on the canonical functions
PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: L2-03 a refund-driven coverage revocation names the canonical payment outcome
#### Phase 2 (garage-first): behaviour — certified PAY smokes on the PAY-04 writers, then the PAY-04 smokes
PAY01C_POSTGRES_SMOKE_PASS: isolated claim, RLS, idempotency, refund and monotonic entitlement
PAY02_POSTGRES_SMOKE_PASS: 66-item DB catalogue, RLS, ACLs, atomic governance version advancement, quote idempotency/immutability, report order lifecycle, multi-party separation, and canonical payment
PAY03A_POSTGRES_SMOKE_PASS: Canonical vehicle/report schema preserved, synthetic fixtures segregated, atomic report fulfillment, idempotent replay, restrictive RLS, and refund revocation verified
STG01_R3_R1_ATOMIC_EVIDENCE_REVIEW_SMOKE_PASS: Atomic audit + status + provenance transaction, self-review refusal, idempotent replay, and conflict guard verified
PAY03B_F5_SMOKE E PASS: pending partial held, provider full refund supersedes and revokes
PAY03B_F5_SMOKE F PASS: self-dealing refused, settled partial required, final revocation permanent
PAY03B_F5_SMOKE G-H PASS: first-observation convergence, refund completion keeps the hold
PAY03B_F5_POSTGRES_SMOKE_PASS: partial-refund reconciliation hold, governed resolution, convergence and isolation
PAY03B_SUB_SMOKE S1-S2 PASS: least privilege, governance inventory (7 products, none sellable), immutability
PAY03B_SUB_SMOKE S3 PASS: sandbox plans need Owner authorization, governed product scope and a permitted gateway
PAY03B_SUB_SMOKE S4-S9 PASS: authority, idempotency, one live subscription, paid-period access, renewal, failed renewal, recovery
PAY03B_SUB_SMOKE S10-S12 PASS: change authority/policy, entitlement follows paid plan, proration refused, period-end cancellation keeps paid access
PAY03B_SUB_SMOKE S13 PASS: invoice partial refund holds access, governed restore, full refund ends paid coverage
PAY03B_SUB_SMOKE S14-S17 PASS: approved grace only, immediate cancel by terms, admin suspension, member removal, immutability
PAY03B_SUB_SMOKE S18 PASS: simulator gateway refused by default, explicit disposable enablement only
PAY03B_SUBSCRIPTIONS_POSTGRES_SMOKE_PASS: canonical subscription authority, paid-period entitlements, invoices bound 1:1 to the canonical ledger
PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: R1 R2 R3 R4 R5 R6 R8 R10 R11 R14 verified on the canonical functions
PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: L2-03 a refund-driven coverage revocation names the canonical payment outcome
PAY04_INTEGRITY_SMOKE I2-I11 PASS: unrecorded, foreign-job, foreign-garage, reversed, over-quantity and mis-categorised lines refused
PAY04_INTEGRITY_SMOKE I1 I12 S PASS: provenance-bound lines issue, void + re-issue is the adjustment path, invoicing never moves stock
PAY04_INTEGRITY_SMOKE I13 I14 PASS: legacy lines are history; a billed part reverses only after its invoice is voided
PAY04_INTEGRITY_SMOKE P PASS: instructions are garage-owned, versioned, append-only, admin-only and audited
PAY04_GARAGE_INVOICE_INTEGRITY_POSTGRES_SMOKE_PASS: line provenance, no stock side effects, adjustment by void + re-issue, payment instructions
PAY04_PROVIDER_SMOKE G PASS: runtime-guarded simulator only, platform-operator registration, CarUp Stripe refused, immutable merchant identity
PAY04_PROVIDER_SMOKE A PASS: customer-only initiation, currency and precision, idempotent per payer key, canonical third-party row
PAY04_PROVIDER_SMOKE R PASS: in-flight money reserved against declared payments, new collections and void; an unattached stop closes it
PAY04_PROVIDER_SMOKE L PASS: attach once, confirmed money allocated with the next shared receipt number, replay-safe, garage refund lifecycle
PAY04_PROVIDER_SMOKE X PASS: stop/expiry hold the room until the provider confirms closure; money that beat a stop counts; closed collections never attach
PAY04_PROVIDER_SMOKE H PASS: F5 partial-refund hold reused, sticky, governed release only, operator final/restore re-project the garage invoice, later refunds de-count, garage members conflicted
PAY04_PROVIDER_SMOKE D PASS: mismatches recorded never applied and block counting, operator closure governed and sticky, late money unallocated until refunded or re-projected
PAY04_PROVIDER_SMOKE I PASS: append-only ledger and history, governed-writer-only allocation, receipts = counted money, shared numbering, least privilege
PAY04_PROVIDER_SMOKE N PASS: confirmed/refunded notifications are once-only by their own trigger; the shared function is untouched
PAY04_GARAGE_PROVIDER_PAYMENTS_POSTGRES_SMOKE_PASS: third-party garage money on the canonical ledger, F5 reused, reservations, discrepancies, invariants
PAY04_POSTGRES_CERTIFICATION_PASS (garage-first)
```
