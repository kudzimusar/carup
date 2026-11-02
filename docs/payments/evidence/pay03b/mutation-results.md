# PAY-03B mutation evidence (generated 2026-11-01T12:14:23Z)

Each mutant removes or weakens one control; the certification (SQL) or the targeted tests (JS) must FAIL.

## f5mut/result.log
MUTANT hold_not_sticky: KILLED -> PAY03B_F5_HOLD_LIFTED_BY_READBACK: {"id": 
MUTANT resolver_not_checked_in_users: KILLED -> PAY03B_F5_NOT_REFUSED: expected PAY03B_RESOLUTION_AUTHORITY_REFUSED 
MUTANT sync_hold_not_suspended: KILLED -> PAY03B_F5_HOLD_DID_NOT_SUSPEND: {"vin": 
MUTANT self_dealing_allowed: substitution did not apply (INVALID)  <- superseded: the remediation rewrote this code; re-targeted below as self_dealing_pay01a_payer_allowed: KILLED
MUTANT stale_verification_allowed: KILLED -> PAY03B_F5_WRONG_REFUSAL: expected PAY03B_PROVIDER_VERIFICATION_STALE 
MUTANT final_partial_not_revoked: KILLED -> PAY03B_F5_SMOKE PAY03B_F5_SMOKE 
MUTANT restore_ignores_provider_state: KILLED -> PAY03B_F5_NOT_REFUSED: expected PAY03B_RESTORE_REQUIRES_UNREFUNDED_PROVIDER_STATE 
MUTANT legacy_writer_bypasses_hold: KILLED -> PAY01C_PAYMENT_OWNERSHIP_OR_AUTHORITY_INVALID 

## submut/result.log
MUTANT active_without_paid_period: KILLED -> PAY03B_SUB_ACTIVE_FLAG_GRANTED_ACCESS: {"id": "7218dda9-bd4e-45bb-9252-6962096cf641", "stale": false, "status"
MUTANT staff_has_billing_authority: KILLED -> PAY03B_SUB_NOT_REFUSED: expected PAY03B_BILLING_AUTHORITY_REFUSED
MUTANT coverage_counts_refunded: KILLED -> PAY03B_SUB_REFUND_KEPT_ACCESS: {"access": true, "reason": "paid_period", "status": "active", "plan_code": "dea
MUTANT coverage_counts_anomalies: substitution did not apply (INVALID)  <- superseded: the remediation rewrote this code; re-targeted below: KILLED
MUTANT provider_lifts_admin_suspension: KILLED -> PAY03B_SUB_PROVIDER_LIFTED_ADMIN_SUSPENSION: {"access": true, "reason": "paid_period", "status": "active", "pl
MUTANT grace_without_approval: substitution did not apply (INVALID)  <- superseded: the remediation rewrote this code; re-targeted below: KILLED
MUTANT immediate_cancel_keeps_access: KILLED -> PAY03B_SUB_IMMEDIATE_CANCEL_KEPT_ACCESS: {"access": true, "reason": "paid_through_after_period_end_cancellatio
MUTANT paid_without_paid_invoice: KILLED -> PAY03B_SUB_NOT_REFUSED: expected PAY03B_PAYMENT_PAID_WITHOUT_PAID_INVOICE
MUTANT entitlement_from_unpaid_plan: KILLED -> PAY03B_SUB_UNPAID_UPGRADE_GRANTED: {"access": true, "reason": "paid_period", "status": "active", "plan_code": 
MUTANT stale_observation_applied: substitution did not apply (INVALID)  <- superseded: the remediation rewrote this code; re-targeted below: KILLED
MUTANT simulator_enabled_by_default: KILLED -> PAY03B_SUB_NOT_REFUSED: expected PAY03B_GATEWAY_NOT_PERMITTED
MUTANT hold_does_not_block_access: KILLED -> PAY03B_SUB_INVOICE_PARTIAL_REFUND_NOT_HELD: {"invoice": {"id": "b0e85e53-ad1b-4004-b8ee-f559054f8de4", "anomal

## remut/result.log
MUTANT R11b_full_refund_evidence_off: KILLED -> PAY03B_REM_NOT_REFUSED: expected PAY03B_FULL_REFUND_EVIDENCE_REQUIRED
MUTANT R11a_hold_release_trigger_off: KILLED -> PAY03B_REM_NOT_REFUSED: expected PAY03B_HOLD_RELEASE_REQUIRES_GOVERNED_PATH
MUTANT R10_superseded_evidence_accepted: KILLED -> PAY03B_REM_NOT_REFUSED: expected PAY03B_PROVIDER_VERIFICATION_SUPERSEDED
MUTANT R5_resolver_payer_check_off: KILLED -> PAY03B_F5_NOT_REFUSED: expected PAY03B_RESOLUTION_SELF_DEALING_REFUSED
MUTANT R6_future_tolerance_5min: KILLED -> PAY03B_REM_NOT_REFUSED: expected PAY03B_PROVIDER_OBSERVATION_TIME_INVALID
MUTANT R6_cancelled_status_revivable: KILLED -> PAY03B_REM_R6_CANCELLED_STATUS_REVIVED: {"id": "d8fa87fc-ace3-49d3-a4f8-4eb6eb0fc4ee", "stale": false, "status
MUTANT R6_terminal_provider_read_applied: KILLED -> PAY03B_REM_R14_RESUME_IGNORED_PROVIDER_STATE: {"replay": false, "request": {"id": "2c726777-1062-4d34-ab29-a62
MUTANT R1_snapshot_duplicate_short_circuit: KILLED -> PAY03B_REM_R1_DUPLICATE_SKIPPED_WORK: {"id": "8498d666-1d06-47e2-b9f2-05b6c2473a71", "stale": false, "status":
MUTANT R1_invoice_duplicate_short_circuit: KILLED -> PAY03B_REM_R1_INVOICE_DUPLICATE_SKIPPED_WORK: {"duplicate_event": true}
MUTANT R2_sync_exception_keeps_access: KILLED -> PAY03B_REM_R2_SYNC_EXCEPTION_KEPT_ACCESS: {"access": true, "reason": "paid_period", "status": "active", "plan_
MUTANT R2_uncollectible_terminal: KILLED -> PAY03B_INVOICE_STATUS_REGRESSION_REFUSED
MUTANT R2_uncollectible_cancels_payment: KILLED -> PAY03B_REM_R2_UNCOLLECTIBLE_CANCELLED_PAYMENT: {"invoice": {"id": "f3d6c3c5-d640-4dde-ac2f-96c8d35f912f", "ano
MUTANT R2_credit_only_unflagged: KILLED -> PAY03B_REM_R2_CREDIT_ONLY_PRORATION_WRONG: {"invoice": {"id": "d36d63c3-c361-46ca-bb5e-36fe149fb554", "anomaly
MUTANT R3_draft_amount_frozen: KILLED -> PAY03B_PAYMENT_PAID_WITHOUT_PAID_INVOICE
MUTANT R4_manual_invoice_unflagged: KILLED -> PAY03B_REM_R4_MANUAL_INVOICE_GRANTED_COVERAGE: {"invoice": {"id": "fe2374b0-77b6-4834-8460-c038be6656b3", "ano
MUTANT R4_coverage_counts_any_reason: KILLED -> PAY03B_REM_R4_COVERAGE_COUNTS_MANUAL_INVOICES
MUTANT R5_invoice_member_conflict_off: KILLED -> PAY03B_REM_NOT_REFUSED: expected PAY03B_RESOLUTION_SELF_DEALING_REFUSED
MUTANT R8_trial_uncapped: KILLED -> PAY03B_REM_R8_TRIAL_UNCAPPED
MUTANT R11_invoice_writer_unmarked_release: KILLED -> PAY03B_HOLD_RELEASE_REQUIRES_GOVERNED_PATH
MUTANT R14_admin_replay_unchecked: KILLED -> PAY03B_REM_NOT_REFUSED: expected PAY03B_CHANGE_IDEMPOTENCY_CONFLICT
MUTANT R14_resume_ignores_provider_state: KILLED -> PAY03B_REM_R14_RESUME_IGNORED_PROVIDER_STATE: {"replay": false, "request": {"id": "f870f261-8151-4511-bac3-eef
MUTANT R14_unapproved_trial_honoured: KILLED -> PAY03B_REM_R14_UNAPPROVED_TRIAL_HONOURED: {"status": "trialing"}

## remut/retarget.log
MUTANT R11b_full_refund_evidence_off: KILLED -> PAY03B_REM_NOT_REFUSED: expected PAY03B_FULL_REFUND_EVIDENCE_REQUIRED
MUTANT R11a_hold_release_trigger_off: KILLED -> PAY03B_REM_NOT_REFUSED: expected PAY03B_HOLD_RELEASE_REQUIRES_GOVERNED_PATH
MUTANT self_dealing_pay01a_payer_allowed: KILLED -> PAY03B_F5_NOT_REFUSED: expected PAY03B_RESOLUTION_SELF_DEALING_REFUSED
MUTANT coverage_counts_anomalies: KILLED -> PAY03B_SUB_UNAUTHORIZED_PRORATION_ACCEPTED
MUTANT grace_without_approval: KILLED -> PAY03B_SUB_FAILED_RENEWAL_WRONG: {"invoice": {"id": "7d3e6a9f-6a76-4ad5-96eb-8b976fe3d362", "anomaly": null, "
MUTANT stale_observation_applied: KILLED -> PAY03B_SUB_OUT_OF_ORDER_NOT_CONVERGED

## jsmut/result.log
MUTANT S1_duplicate_short_circuit: KILLED -> not ok 11 - R1: a redelivered event finishes the invoice work an earlier attempt could not (no duplicate short
MUTANT S2_no_invoice_isolation: KILLED -> not ok 12 - R2: a transient failure on one invoice never stops the others and is rethrown so the event is rede
MUTANT S3_subscription_stamped_after_read: KILLED -> not ok 14 - R6: provider observations are stamped BEFORE the provider is read (a slower, older read can never 
MUTANT S4_invoices_stamped_after_read: KILLED -> not ok 14 - R6: provider observations are stamped BEFORE the provider is read (a slower, older read can never 
MUTANT S5_checkout_amount_unchecked: KILLED -> not ok 16 - R13: a provider checkout whose amount or currency differs from the governed plan is expired, never
MUTANT S6_capacity_guard_fails_open: KILLED -> not ok 2 - R9: with enforcement on, a tenant with neither a baseline nor paid capacity is refused (fail closed
MUTANT S7_hold_alert_removed: KILLED -> not ok 15 - R10/R14: an opened invoice hold raises an operator alert; resolution evidence is stamped before th
MUTANT S8_absent_invoice_exception_never_cleared: KILLED -> not ok 13 - R2: an unrecordable invoice becomes a durable sync exception that suspends access without blocking
MUTANT S9_permanent_failure_not_quarantined: KILLED -> not ok 13 - R2: an unrecordable invoice becomes a durable sync exception that suspends access without blocking
MUTANT S10_verification_stamped_after_read: KILLED -> not ok 15 - R10/R14: an opened invoice hold raises an operator alert; resolution evidence is stamped before th
MUTANT A1_invoice_history_first_page_only: KILLED -> not ok 8 - stripe adapter: the invoice history is read completely (paginated), and an over-long history fails 
MUTANT A2_one_bad_invoice_fails_listing: KILLED -> not ok 9 - stripe adapter: one unsupported invoice in the history is reported as rejected; the others still no
MUTANT A3_credit_only_refused: KILLED -> not ok 7 - normalizer: a credit-only proration invoice (no positive line, nothing due) is normalized, not refu
MUTANT A4_checkout_amount_not_reported: KILLED -> not ok 10 - stripe adapter: a retrieved checkout states its amount and currency
MUTANT A5_history_unbounded: SURVIVED  <- first run; the test only proved an endless history eventually fails. Strengthened to pin the exact bound; re-run below: KILLED

## jsmut A5 re-run after pinning the exact 1000-invoice bound
MUTANT A5_history_unbounded: KILLED -> not ok 8 - stripe adapter: the invoice history is read completely (paginated), and an over-long history fails closed

## PAY-01A verification stamping (pay01aService.readPay01aProviderPaymentTruth)
MUTANT pay01a_verification_stamped_after_read: KILLED -> not ok 22 - F5 operator: the verification time is taken BEFORE the provider read

## Totals (unique mutants)
- SQL: F5 7 + subscription 9 + remediation 22 + re-targeted 4 = 42 killed, 0 surviving.
- JS: earlier service 5 + remediation service/adapter 15 + PAY-01A stamping 1 = 21 killed, 0 surviving (A5 after strengthening the test).
- 63 unique mutants, all killed.

## svcmut (earlier service mutants) re-run at the remediated service
MUTANT capacity_ignores_subscription: KILLED -> not ok 2 - checkout is idempotent and single; the redirect alone grants nothing; the signed provider events do
MUTANT checkout_event_substitution_accepted: KILLED -> not ok 10 - webhook reference substitution is refused; unmatched provider objects change nothing
MUTANT refund_without_resync: KILLED -> not ok 9 - governed admin refund of the current invoice ends its paid coverage and is audited before the provi
MUTANT guard_ignores_enforcement_flag: KILLED -> not ok 17 - listing capacity is enforced at the domain boundary from the tenant entitlement (sandbox enforceme
MUTANT staff_marked_billing_authority: KILLED -> not ok 1 - authority: non-members are refused; staff without billing authority cannot buy; changed terms are r

## Level 2 findings (fixed in `ccfbbc52`, recorded 2026-11-01)

Each fix had a failing test first. The RED run is the "fix removed" mutant: the same tests on the code before the fix.

```
MUTANT l203_cause_fix_removed (SQL, invoice writer cause = 'invoice_' || provider_status): KILLED -> PAY03B_REM_L2_03_TRANSITION_CAUSE: the coverage revocation is recorded as invoice_paid
MUTANT l203_condition_inverted (SQL, `v_payment.status = 'paid'`): KILLED -> PAY03B_REM_L2_03_TRANSITION_CAUSE: the coverage revocation is recorded as invoice_paid
MUTANT l201_preview_gateway_check_removed (JS service): KILLED -> not ok 5 - F-L2-01: a target plan the subscription gateway cannot use is refused BEFORE any provider call (Missing expected rejection)
MUTANT l201_ui_subscribe_gate_removed (web): KILLED -> in a Stripe-sandbox runtime, only plans Stripe can bill offer a checkout
MUTANT l201_ui_change_gate_removed (web): KILLED -> a live Stripe-gateway subscription is offered changes only to plans Stripe can bill
MUTANT l202_destructive_class_removed (web; refund, suspend, immediate cancel, abandon): KILLED -> 4 tests: expected className to contain 'bg-red-700'
MUTANT l203_cause_formatter_removed (web): KILLED -> describePay03bTransitionCause is not a function
```

The physical counterpart of F-L2-02:
- axe on the refund and suspension dialogs in the Level 1 browser spec passes at `248970ee`.
- At `ccfbbc52` the same check measured a frame of the button's 150 ms enable fade. A read-only probe sampled opacity 0.59, 0.85 and 1.0 at 36, 70 and 153 ms. The spec now waits for opacity 1 before measuring.
- The settled red-700 is 6.5:1. The old `#ef4444` is 3.76:1 even when settled.

## Totals including the Level 2 findings
- 63 earlier unique mutants plus 7 Level 2 mutants: 70 killed, 0 surviving.
