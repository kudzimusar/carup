# PAY-04 tables and functions — RLS and privileges (fresh UAT database built from `d421965e`)

Collected 2026-11-02T04:45:22Z from the dedicated local stack (`carup-pay04-supabase`, 127.0.0.1:56322) with read-only catalog queries.

## Tables

| table | RLS | forced | policies | API-role grants |
|---|---|---|---|---|
| garage_invoice_events | t | t | 0 | service_role:INSERT, service_role:SELECT |
| garage_invoice_lines | t | t | 0 | service_role:INSERT, service_role:SELECT |
| garage_invoices | t | t | 0 | service_role:INSERT, service_role:SELECT, service_role:UPDATE |
| garage_payment_records | t | t | 0 | service_role:INSERT, service_role:SELECT |
| garage_receipts | t | t | 0 | service_role:INSERT, service_role:SELECT, service_role:UPDATE |
| pay04_garage_collection_events | t | f | 0 | service_role:SELECT |
| pay04_garage_collections | t | f | 0 | service_role:SELECT |
| pay04_garage_merchant_accounts | t | f | 0 | service_role:SELECT |
| pay04_garage_payment_allocations | t | f | 0 | service_role:SELECT |
| pay04_garage_payment_discrepancies | t | f | 0 | service_role:SELECT |
| pay04_garage_payment_instructions | t | f | 0 | service_role:SELECT |
| pay04_garage_provider_receipts | t | f | 0 | service_role:SELECT |
| pay04_provider_event_receipts | t | f | 0 | service_role:SELECT |
| pay04_runtime_guard | t | f | 0 | service_role:SELECT |

## Functions

| function | security | search_path | EXECUTE by API roles |
|---|---|---|---|
| garage_ops07_invoice_balance | invoker | search_path=public, pg_temp | service_role |
| pay03b_after_payment_resolution | invoker | search_path=public, pg_temp | none |
| pay03b_payment_transition_target | invoker | search_path=public, pg_temp | none |
| pay03b_record_payment_hold | invoker | search_path=public, pg_temp | none |
| pay04_append_only | invoker | search_path=public, pg_temp | none |
| pay04_collection_allocated | invoker | search_path=public, pg_temp | none |
| pay04_garage_payment_event_dedupe_key | invoker | search_path=public | service_role |
| pay04_guard_allocation_insert | invoker | search_path=public, pg_temp | none |
| pay04_guard_billed_usage_reversal | invoker | search_path=public, pg_temp | none |
| pay04_guard_collection | invoker | search_path=public, pg_temp | none |
| pay04_guard_declared_payment | invoker | search_path=public, pg_temp | none |
| pay04_guard_discrepancy | invoker | search_path=public, pg_temp | none |
| pay04_guard_invoice_line_provenance | invoker | search_path=public, pg_temp | service_role |
| pay04_guard_merchant_account | invoker | search_path=public, pg_temp | none |
| pay04_guard_payment_instructions | invoker | search_path=public, pg_temp | service_role |
| pay04_guard_provider_receipt | invoker | search_path=public, pg_temp | none |
| pay04_is_invoice_customer | invoker | search_path=public, pg_temp | none |
| pay04_log | invoker | search_path=public, pg_temp | none |
| pay04_partial_refund_position | invoker | search_path=public, pg_temp | none |
| pay04_record_discrepancy | invoker | search_path=public, pg_temp | none |
| pay04_reproject_garage_collection | invoker | search_path=public, pg_temp | none |
| pay04_stamp_runtime_guard | invoker | search_path=public, pg_temp | none |
| pay04_apply_garage_provider_snapshot | DEFINER | search_path=public, pg_temp | service_role |
| pay04_attach_garage_collection | DEFINER | search_path=public, pg_temp | service_role |
| pay04_begin_garage_collection | DEFINER | search_path=public, pg_temp | service_role |
| pay04_cancel_garage_collection | DEFINER | search_path=public, pg_temp | service_role |
| pay04_close_expired_unattached_collection | DEFINER | search_path=public, pg_temp | service_role |
| pay04_gateway_permitted | DEFINER | search_path=public, pg_temp | service_role |
| pay04_guard_invoice_void | DEFINER | search_path=public, pg_temp | none |
| pay04_invoice_money | DEFINER | search_path=public, pg_temp | service_role |
| pay04_register_garage_merchant_account | DEFINER | search_path=public, pg_temp | service_role |
| pay04_reproject_invoice | DEFINER | search_path=public, pg_temp | service_role |
| pay04_request_garage_collection_refund | DEFINER | search_path=public, pg_temp | service_role |
| pay04_resolve_garage_payment_discrepancy | DEFINER | search_path=public, pg_temp | service_role |
| pay04_set_garage_payment_instructions | DEFINER | search_path=public, pg_temp | service_role |
| pay04_suspend_garage_merchant_account | DEFINER | search_path=public, pg_temp | service_role |

## Runtime guard (who enabled the simulator, and when)

enabled=true · by=postgres · at=2026-11-02T04:44:14Z · note=Disposable PAY-04 local UAT database (carup-pay04-supabase, 127.0.0.1:56322) only.
