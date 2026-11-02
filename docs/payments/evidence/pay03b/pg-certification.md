# PAY-03B disposable PostgreSQL certification

- **Candidate:** `248970eec82311d417b6c333482096de1c9ed78d` (the final runtime). Its SQL is that of `ccfbbc52`, which added the L2-03 transition-cause fix and its smoke.
- **Run from:** the clean, detached UAT worktree at that commit.
- **Recorded:** 2026-11-02T00:16:23Z
- **Database:** a disposable `postgres:17` container on 127.0.0.1:55432, database `pay01c_sandbox_ci`. Never staging, never production.
- **Sanitized:** PASS notices and fingerprints only.
- **Fingerprint:** it is computed per run over freshly seeded, timestamped rows, so its value differs between runs. The certified property is that, *within* a run, it is identical before and after the PAY-03B migrations (the script fails otherwise).
- **CI:** the same two orders ran in CI at `ccfbbc52` and `248970ee` (certification §10).

## `baseline-first`

```
NOTICE:  trigger "trg_pay02_product_identity_immutable" for relation "public.pay02_commercial_products" does not exist, skipping
NOTICE:  trigger "trg_pay02_product_version_immutable" for relation "public.pay02_commercial_product_versions" does not exist, skipping
NOTICE:  trigger "trg_pay02_proposal_immutability" for relation "public.pay02_activation_proposals" does not exist, skipping
NOTICE:  trigger "trg_pay02_quote_immutability" for relation "public.pay02_commercial_quotes" does not exist, skipping
NOTICE:  trigger "trg_pay02_report_order_immutability" for relation "public.pay02_report_orders" does not exist, skipping
psql:database/migrations/supabase_schema.sql:313: NOTICE:  policy "vehicles_public_read" for relation "vehicles" does not exist, skipping
psql:database/migrations/supabase_schema.sql:318: NOTICE:  policy "organizations_public_read" for relation "organizations" does not exist, skipping
NOTICE:  relation "user_sessions" already exists, skipping
NOTICE:  policy "tenant_vehicles_isolation" for relation "vehicles" does not exist, skipping
NOTICE:  policy "tenant_isolation" for relation "tenants" does not exist, skipping
NOTICE:  column "event_type" of relation "vehicle_evidence" already exists, skipping
NOTICE:  constraint "vehicle_evidence_evidence_type_check" of relation "vehicle_evidence" does not exist, skipping
NOTICE:  policy "vehicle evidence public verified read" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  policy "vehicle evidence authenticated read" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  policy "vehicle evidence authenticated insert" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  policy "vehicle evidence authenticated update own pending" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  extension "pgcrypto" already exists, skipping
NOTICE:  constraint "vehicle_evidence_event_date_precision_check" of relation "vehicle_evidence" does not exist, skipping
NOTICE:  constraint "vehicle_evidence_evidence_class_check" of relation "vehicle_evidence" does not exist, skipping
NOTICE:  constraint "vehicle_evidence_original_asset_fk" of relation "vehicle_evidence" does not exist, skipping
NOTICE:  trigger "trg_provenance_no_update" for relation "evidence_provenance_events" does not exist, skipping
NOTICE:  trigger "trg_provenance_no_delete" for relation "evidence_provenance_events" does not exist, skipping
NOTICE:  policy "evidence sets authenticated read" for relation "evidence_sets" does not exist, skipping
NOTICE:  policy "provenance authenticated read" for relation "evidence_provenance_events" does not exist, skipping
NOTICE:  trigger "trg_listing_snapshot_no_update" for relation "listing_snapshots" does not exist, skipping
NOTICE:  trigger "trg_listing_snapshot_no_delete" for relation "listing_snapshots" does not exist, skipping
NOTICE:  policy "ingestion jobs authenticated read" for relation "ingestion_jobs" does not exist, skipping
NOTICE:  policy "source records authenticated read" for relation "source_records" does not exist, skipping
NOTICE:  policy "identity candidates authenticated read" for relation "vehicle_identity_candidates" does not exist, skipping
NOTICE:  policy "listing snapshots authenticated read" for relation "listing_snapshots" does not exist, skipping
NOTICE:  policy "ai jobs authenticated read" for relation "ai_analysis_jobs" does not exist, skipping
NOTICE:  policy "ai obs authenticated read" for relation "ai_observations" does not exist, skipping
NOTICE:  policy "temporal findings authenticated read" for relation "temporal_findings" does not exist, skipping
NOTICE:  policy "disclosure claims authenticated read" for relation "disclosure_claims" does not exist, skipping
NOTICE:  policy "disclosure conflicts authenticated read" for relation "disclosure_conflicts" does not exist, skipping
NOTICE:  trigger "trg_report_version_guard" for relation "report_versions" does not exist, skipping
NOTICE:  policy "report versions authenticated read" for relation "report_versions" does not exist, skipping
NOTICE:  policy "vehicle evidence uploader or admin read" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  relation "vehicle_plate_history" does not exist, skipping
NOTICE:  policy "evidence sets owner or admin read" for relation "evidence_sets" does not exist, skipping
NOTICE:  policy "provenance admin or reviewer read" for relation "evidence_provenance_events" does not exist, skipping
NOTICE:  policy "ai observations admin or reviewer read" for relation "ai_observations" does not exist, skipping
NOTICE:  policy "temporal findings admin or reviewer read" for relation "temporal_findings" does not exist, skipping
NOTICE:  policy "disclosure claims owner or admin read" for relation "disclosure_claims" does not exist, skipping
NOTICE:  policy "disclosure conflicts admin or reviewer read" for relation "disclosure_conflicts" does not exist, skipping
NOTICE:  policy "report versions public share" for relation "report_versions" does not exist, skipping
NOTICE:  policy "report versions owner read" for relation "report_versions" does not exist, skipping
NOTICE:  policy "report versions admin read" for relation "report_versions" does not exist, skipping
NOTICE:  relation "review_tasks" does not exist, skipping
NOTICE:  relation "review_tasks" does not exist, skipping
NOTICE:  relation "review_decisions" does not exist, skipping
NOTICE:  relation "review_decisions" does not exist, skipping
NOTICE:  relation "disputes" does not exist, skipping
NOTICE:  relation "disputes" does not exist, skipping
NOTICE:  relation "dispute_events" does not exist, skipping
NOTICE:  relation "dispute_events" does not exist, skipping
NOTICE:  relation "trust_change_log" does not exist, skipping
NOTICE:  relation "trust_change_log" does not exist, skipping
NOTICE:  trigger "trg_pay03a_report_version_binding_guard" for relation "public.report_versions" does not exist, skipping
NOTICE:  policy "pay03a_paid_report_entitlement_guard" for relation "public.report_versions" does not exist, skipping
[pay01c-demo-postgres-smoke.sql] PAY01C_POSTGRES_SMOKE_PASS: isolated claim, RLS, idempotency, refund and monotonic entitlement
[pay02-foundation-postgres-smoke.sql] PAY02_POSTGRES_SMOKE_PASS: 66-item DB catalogue, RLS, ACLs, atomic governance version advancement, quote idempotency/immutability, report order lifecycle, multi-party separation, and canonical payment convergence verified
[pay03a-real-report-postgres-smoke.sql] PAY03A_POSTGRES_SMOKE_PASS: Canonical vehicle/report schema preserved, synthetic fixtures segregated, atomic report fulfillment, idempotent replay, restrictive RLS, and refund revocation verified
[pay03a-real-report-postgres-smoke.sql] STG01_R3_R1_ATOMIC_EVIDENCE_REVIEW_SMOKE_PASS: Atomic audit + status + provenance transaction, self-review refusal, idempotent replay, and conflict guard verified
NOTICE:  trigger "trg_pay03b_reconciliation_exception_guard" for relation "public.pay03b_payment_reconciliation_exceptions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_guard_payment_hold_release" for relation "public.payment_transactions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_plan_version_guard" for relation "public.pay03b_subscription_plans" does not exist, skipping
NOTICE:  trigger "trg_pay03b_business_subscription_guard" for relation "public.pay03b_business_subscriptions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_subscription_invoice_guard" for relation "public.pay03b_subscription_invoices" does not exist, skipping
NOTICE:  trigger "trg_pay03b_transitions_append_only" for relation "public.pay03b_subscription_transitions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_receipts_append_only" for relation "public.pay03b_provider_event_receipts" does not exist, skipping
NOTICE:  trigger "trg_pay03b_change_request_guard" for relation "public.pay03b_subscription_change_requests" does not exist, skipping
historical canonical rows preserved across PAY-03B migrations: fingerprint 9328fa173d36b8cd2395d1f7fbe34bd8
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_SMOKE B-D,I,J PASS: hold, sticky readback, governed restore, immutability, isolation
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_SMOKE E PASS: pending partial held, provider full refund supersedes and revokes
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_SMOKE F PASS: self-dealing refused, settled partial required, final revocation permanent
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_SMOKE G-H PASS: first-observation convergence, refund completion keeps the hold
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_POSTGRES_SMOKE_PASS: partial-refund reconciliation hold, governed resolution, convergence and isolation
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S1-S2 PASS: least privilege, governance inventory (7 products, none sellable), immutability
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S3 PASS: sandbox plans need Owner authorization, governed product scope and a permitted gateway
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S4-S9 PASS: authority, idempotency, one live subscription, paid-period access, renewal, failed renewal, recovery
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S10-S12 PASS: change authority/policy, entitlement follows paid plan, proration refused, period-end cancellation keeps paid access
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S13 PASS: invoice partial refund holds access, governed restore, full refund ends paid coverage
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S14-S17 PASS: approved grace only, immediate cancel by terms, admin suspension, member removal, immutability
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S18 PASS: simulator gateway refused by default, explicit disposable enablement only
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUBSCRIPTIONS_POSTGRES_SMOKE_PASS: canonical subscription authority, paid-period entitlements, invoices bound 1:1 to the canonical ledger
[pay03b-remediation-postgres-smoke.sql] PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: R1 R2 R3 R4 R5 R6 R8 R10 R11 R14 verified on the canonical functions
[pay03b-remediation-postgres-smoke.sql] PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: L2-03 a refund-driven coverage revocation names the canonical payment outcome
PAY03B_POSTGRES_CERTIFICATION_PASS (baseline-first)
```

## `pay03b-first`

```
NOTICE:  trigger "trg_pay02_product_identity_immutable" for relation "public.pay02_commercial_products" does not exist, skipping
NOTICE:  trigger "trg_pay02_product_version_immutable" for relation "public.pay02_commercial_product_versions" does not exist, skipping
NOTICE:  trigger "trg_pay02_proposal_immutability" for relation "public.pay02_activation_proposals" does not exist, skipping
NOTICE:  trigger "trg_pay02_quote_immutability" for relation "public.pay02_commercial_quotes" does not exist, skipping
NOTICE:  trigger "trg_pay02_report_order_immutability" for relation "public.pay02_report_orders" does not exist, skipping
psql:database/migrations/supabase_schema.sql:313: NOTICE:  policy "vehicles_public_read" for relation "vehicles" does not exist, skipping
psql:database/migrations/supabase_schema.sql:318: NOTICE:  policy "organizations_public_read" for relation "organizations" does not exist, skipping
NOTICE:  relation "user_sessions" already exists, skipping
NOTICE:  policy "tenant_vehicles_isolation" for relation "vehicles" does not exist, skipping
NOTICE:  policy "tenant_isolation" for relation "tenants" does not exist, skipping
NOTICE:  column "event_type" of relation "vehicle_evidence" already exists, skipping
NOTICE:  constraint "vehicle_evidence_evidence_type_check" of relation "vehicle_evidence" does not exist, skipping
NOTICE:  policy "vehicle evidence public verified read" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  policy "vehicle evidence authenticated read" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  policy "vehicle evidence authenticated insert" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  policy "vehicle evidence authenticated update own pending" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  extension "pgcrypto" already exists, skipping
NOTICE:  constraint "vehicle_evidence_event_date_precision_check" of relation "vehicle_evidence" does not exist, skipping
NOTICE:  constraint "vehicle_evidence_evidence_class_check" of relation "vehicle_evidence" does not exist, skipping
NOTICE:  constraint "vehicle_evidence_original_asset_fk" of relation "vehicle_evidence" does not exist, skipping
NOTICE:  trigger "trg_provenance_no_update" for relation "evidence_provenance_events" does not exist, skipping
NOTICE:  trigger "trg_provenance_no_delete" for relation "evidence_provenance_events" does not exist, skipping
NOTICE:  policy "evidence sets authenticated read" for relation "evidence_sets" does not exist, skipping
NOTICE:  policy "provenance authenticated read" for relation "evidence_provenance_events" does not exist, skipping
NOTICE:  trigger "trg_listing_snapshot_no_update" for relation "listing_snapshots" does not exist, skipping
NOTICE:  trigger "trg_listing_snapshot_no_delete" for relation "listing_snapshots" does not exist, skipping
NOTICE:  policy "ingestion jobs authenticated read" for relation "ingestion_jobs" does not exist, skipping
NOTICE:  policy "source records authenticated read" for relation "source_records" does not exist, skipping
NOTICE:  policy "identity candidates authenticated read" for relation "vehicle_identity_candidates" does not exist, skipping
NOTICE:  policy "listing snapshots authenticated read" for relation "listing_snapshots" does not exist, skipping
NOTICE:  policy "ai jobs authenticated read" for relation "ai_analysis_jobs" does not exist, skipping
NOTICE:  policy "ai obs authenticated read" for relation "ai_observations" does not exist, skipping
NOTICE:  policy "temporal findings authenticated read" for relation "temporal_findings" does not exist, skipping
NOTICE:  policy "disclosure claims authenticated read" for relation "disclosure_claims" does not exist, skipping
NOTICE:  policy "disclosure conflicts authenticated read" for relation "disclosure_conflicts" does not exist, skipping
NOTICE:  trigger "trg_report_version_guard" for relation "report_versions" does not exist, skipping
NOTICE:  policy "report versions authenticated read" for relation "report_versions" does not exist, skipping
NOTICE:  policy "vehicle evidence uploader or admin read" for relation "vehicle_evidence" does not exist, skipping
NOTICE:  relation "vehicle_plate_history" does not exist, skipping
NOTICE:  policy "evidence sets owner or admin read" for relation "evidence_sets" does not exist, skipping
NOTICE:  policy "provenance admin or reviewer read" for relation "evidence_provenance_events" does not exist, skipping
NOTICE:  policy "ai observations admin or reviewer read" for relation "ai_observations" does not exist, skipping
NOTICE:  policy "temporal findings admin or reviewer read" for relation "temporal_findings" does not exist, skipping
NOTICE:  policy "disclosure claims owner or admin read" for relation "disclosure_claims" does not exist, skipping
NOTICE:  policy "disclosure conflicts admin or reviewer read" for relation "disclosure_conflicts" does not exist, skipping
NOTICE:  policy "report versions public share" for relation "report_versions" does not exist, skipping
NOTICE:  policy "report versions owner read" for relation "report_versions" does not exist, skipping
NOTICE:  policy "report versions admin read" for relation "report_versions" does not exist, skipping
NOTICE:  relation "review_tasks" does not exist, skipping
NOTICE:  relation "review_tasks" does not exist, skipping
NOTICE:  relation "review_decisions" does not exist, skipping
NOTICE:  relation "review_decisions" does not exist, skipping
NOTICE:  relation "disputes" does not exist, skipping
NOTICE:  relation "disputes" does not exist, skipping
NOTICE:  relation "dispute_events" does not exist, skipping
NOTICE:  relation "dispute_events" does not exist, skipping
NOTICE:  relation "trust_change_log" does not exist, skipping
NOTICE:  relation "trust_change_log" does not exist, skipping
NOTICE:  trigger "trg_pay03a_report_version_binding_guard" for relation "public.report_versions" does not exist, skipping
NOTICE:  policy "pay03a_paid_report_entitlement_guard" for relation "public.report_versions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_reconciliation_exception_guard" for relation "public.pay03b_payment_reconciliation_exceptions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_guard_payment_hold_release" for relation "public.payment_transactions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_plan_version_guard" for relation "public.pay03b_subscription_plans" does not exist, skipping
NOTICE:  trigger "trg_pay03b_business_subscription_guard" for relation "public.pay03b_business_subscriptions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_subscription_invoice_guard" for relation "public.pay03b_subscription_invoices" does not exist, skipping
NOTICE:  trigger "trg_pay03b_transitions_append_only" for relation "public.pay03b_subscription_transitions" does not exist, skipping
NOTICE:  trigger "trg_pay03b_receipts_append_only" for relation "public.pay03b_provider_event_receipts" does not exist, skipping
NOTICE:  trigger "trg_pay03b_change_request_guard" for relation "public.pay03b_subscription_change_requests" does not exist, skipping
[pay01c-demo-postgres-smoke.sql] PAY01C_POSTGRES_SMOKE_PASS: isolated claim, RLS, idempotency, refund and monotonic entitlement
[pay02-foundation-postgres-smoke.sql] PAY02_POSTGRES_SMOKE_PASS: 66-item DB catalogue, RLS, ACLs, atomic governance version advancement, quote idempotency/immutability, report order lifecycle, multi-party separation, and canonical payment convergence verified
[pay03a-real-report-postgres-smoke.sql] PAY03A_POSTGRES_SMOKE_PASS: Canonical vehicle/report schema preserved, synthetic fixtures segregated, atomic report fulfillment, idempotent replay, restrictive RLS, and refund revocation verified
[pay03a-real-report-postgres-smoke.sql] STG01_R3_R1_ATOMIC_EVIDENCE_REVIEW_SMOKE_PASS: Atomic audit + status + provenance transaction, self-review refusal, idempotent replay, and conflict guard verified
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_SMOKE B-D,I,J PASS: hold, sticky readback, governed restore, immutability, isolation
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_SMOKE E PASS: pending partial held, provider full refund supersedes and revokes
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_SMOKE F PASS: self-dealing refused, settled partial required, final revocation permanent
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_SMOKE G-H PASS: first-observation convergence, refund completion keeps the hold
[pay03b-f5-reconciliation-postgres-smoke.sql] PAY03B_F5_POSTGRES_SMOKE_PASS: partial-refund reconciliation hold, governed resolution, convergence and isolation
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S1-S2 PASS: least privilege, governance inventory (7 products, none sellable), immutability
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S3 PASS: sandbox plans need Owner authorization, governed product scope and a permitted gateway
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S4-S9 PASS: authority, idempotency, one live subscription, paid-period access, renewal, failed renewal, recovery
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S10-S12 PASS: change authority/policy, entitlement follows paid plan, proration refused, period-end cancellation keeps paid access
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S13 PASS: invoice partial refund holds access, governed restore, full refund ends paid coverage
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S14-S17 PASS: approved grace only, immediate cancel by terms, admin suspension, member removal, immutability
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUB_SMOKE S18 PASS: simulator gateway refused by default, explicit disposable enablement only
[pay03b-subscriptions-postgres-smoke.sql] PAY03B_SUBSCRIPTIONS_POSTGRES_SMOKE_PASS: canonical subscription authority, paid-period entitlements, invoices bound 1:1 to the canonical ledger
[pay03b-remediation-postgres-smoke.sql] PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: R1 R2 R3 R4 R5 R6 R8 R10 R11 R14 verified on the canonical functions
[pay03b-remediation-postgres-smoke.sql] PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: L2-03 a refund-driven coverage revocation names the canonical payment outcome
PAY03B_POSTGRES_CERTIFICATION_PASS (pay03b-first)
```
