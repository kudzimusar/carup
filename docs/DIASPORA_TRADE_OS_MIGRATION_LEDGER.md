# Diaspora Trade OS — Database Migration Ledger

> Single ordered ledger of every Diaspora-relevant migration. Location: **`database/migrations/`**
> (one directory; no `supabase/migrations` or Supabase CLI list). Applied by a custom Node runner
> **`backend/db/migrate.js`** (`npm run migrate:up` / `migrate:rollback`): lexical sort, `-- +migrate Up/Down`
> blocks executed in a `BEGIN…COMMIT` transaction, applied files tracked in `schema_migrations(version)`.
>
> **CRITICAL:** No migration in this ledger has been applied to any database **by this program**. Apply
> **missing** migrations to **staging first** (EB-1, Supabase `eoyenigwevnxwwhyhaer`) and only then to
> **production** (EB-5, `vhmnajoeicasaigiophh`, forbidden until explicit release authorization). **Never
> reapply an existing migration.** `shasum -a 256` short = first 12 hex chars.
>
> **Runner caveat:** files without `-- +migrate` markers are **skipped by the Node runner** and applied
> out-of-band via `psql`/deploy scripts (marked ⚠ below). Rehydrate them in the release runbook.

| Ord | Filename | Phase | Purpose | Tables / RPCs | RLS / grants / search_path | Down script | sha256 | Staging | Prod |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `013_diaspora_trade_schema.sql` | Foundation (1-2C) | Order-first Japan→Zim import domain + OCR/doc registry + gov docs | 21 tables (`diaspora_import_orders`+children, `diaspora_trade_profiles`, `_quotes`, `_trade_documents`(+extractions/verifications), `_container_shipments`, `_cargo_reservations`, `_shipments`(+stage_events), `_compliance_reviews`, `_payment_milestones`, `_reputation_records`, `_import_audit_log`, `vehicle_import_records`, `vehicle_government_documents`); fns `set_diaspora_updated_at`, `is_diaspora_platform_admin` | RLS Y (21 tables) · grants Y (no REVOKE-PUBLIC) · search_path **N** | **Y** | `1bf309663e40` | BLOCKED (EB-1) | NOT APPLIED (EB-5) |
| 2 | `014_diaspora_rls_recursion_fix.sql` | Foundation | Fix recursive order RLS via SECURITY DEFINER helper | fn `diaspora_can_access_order` | RLS Y (recreates ~11 policies) · grants Y · search_path Y | N (comment-only) | `08abfcc4150d` | BLOCKED | NOT APPLIED |
| 3 | `20260611061849_diaspora_trade_os_phase1b_foundation.sql` | Foundation (1B) | Workbook/dry-run + stock/AI-command/Drive foundation; canonical RLS helpers | 9 tables (`diaspora_workbook_import_batches/_rows`, `_supply_documents`, `_stock_items`, `_order_documents`, `_ai_commands`, `_stock_ledger`, `_drive_connections/_files`); fns `_current_user_id`, `_is_platform_admin`, `_is_tenant_member`, `_can_access_row` | RLS Y (9) · grants Y (REVOKE PUBLIC) · search_path Y | N (intentional) | `223c31b5f9c0` | BLOCKED | NOT APPLIED |
| 4 ⚠ | `20260619201406_production_access_containment.sql` | Foundation hardening | Revoke client-role access to 11 launch tables; harden `diaspora_can_access_order` | recreates fn | RLS Y (11) · grants Y (REVOKE anon/auth) · search_path Y | N | `9e85e828bb3c` | BLOCKED | NOT APPLIED |
| 5 | `20260620120000_diaspora_phase3_stock_ledger_idempotency.sql` | PR#81 P3-7 | Idempotency key + indexes on stock ledger | alters `diaspora_stock_ledger` | additive only | **Y** | `b6fb0f1fb742` | BLOCKED | NOT APPLIED |
| 6 ⚠ | `20260620232827_issue77_access_containment_followup.sql` | Foundation hardening | Pin search_path + least-privilege on 2 authz helpers | recreates `current_tenant_id`, `is_diaspora_platform_admin` | grants Y · search_path Y | N | `0cf27ad5399d` | BLOCKED | NOT APPLIED |
| 7 | `20260621090000_diaspora_h1_stock_movement_rpc.sql` | PR#81 P3-7 (H1) | Atomic stock movement (lock, idempotent, balance checks, in-txn audit) | RPC `diaspora_append_stock_movement_atomic` | grants Y (service_role) · search_path Y | **Y** | `58e194faa367` | BLOCKED | NOT APPLIED |
| 8 | `20260621091000_diaspora_h2_quote_acceptance_rpc.sql` | PR#81 P3-7 (H2) | Atomic quote acceptance (accept one, reject siblings, audit) | RPC `diaspora_accept_quote_atomic` | grants Y · search_path Y | **Y** | `cc524c5542ab` | BLOCKED | NOT APPLIED |
| 9 | `20260621092000_diaspora_h3_container_approval_rpc.sql` | PR#81 P3-7 (H3) | Serialized container approval (lock, recompute, overfill guard, audit) | RPC `diaspora_approve_cargo_reservation_atomic` | grants Y · search_path Y | **Y** | `2f2c02fce58b` | BLOCKED | NOT APPLIED |
| 10 | `20260621093000_diaspora_h6_oauth_state_nonce.sql` | PR#81 P3-7 (H6) | One-time expiring OAuth state nonce store (never stores tokens) | table `diaspora_oauth_states` | RLS Y (service-role only) | **Y** | `059a16df74d4` | BLOCKED | NOT APPLIED |
| 11 | `20260621094000_diaspora_h7_rpc_execute_grants.sql` | PR#81 P3-7 (H7) | Lock H1/H2/H3 RPC EXECUTE to service_role | grants only | grants Y | N (would weaken security) | `c5675c23fd76` | BLOCKED | NOT APPLIED |
| 12 | `20260621120000_diaspora_phase8_subscription_entitlements.sql` | Phase 8 | Plan catalog + subscriptions + overrides + usage meters/reservations + billing log; atomic quota RPC; seeds 5 plans | 6 tables (`diaspora_subscription_*`); RPC `diaspora_reserve_usage_atomic` | RLS Y (6) · grants Y · search_path Y | **Y** | `14f18cea8e74` | BLOCKED | NOT APPLIED |
| 13 | `20260621130000_diaspora_phase9_safetrade.sql` | Phase 9 | Escrow/assurance overlay; fail-closed money (CHECK `live_payment=false`, provider∈sandbox/fake) | 3 tables (`diaspora_safetrade_transactions/_milestones/_release_evaluations`); RPCs `diaspora_safetrade_transition_atomic`, `_record_milestone_atomic` | RLS Y (3) · grants Y · search_path Y | **Y** | `1cfbc7271867` | BLOCKED | NOT APPLIED |
| 14 | `20260621131000_diaspora_phase9_safetrade_disputes.sql` | Phase 9 (Stage B) | Disputes + append-only evidence + delivery confirmations (records only) | 3 tables (`diaspora_safetrade_disputes/_dispute_evidence/_delivery_confirmations`) | RLS Y (3) · grants Y (evidence append-only) | **Y** | `9f8b0cb06f5d` | BLOCKED | NOT APPLIED |
| 15 | `20260621140000_diaspora_phase10_trade_graph.sql` | Phase 10 | Event-sourced rebuildable graph projection (nodes/edges from `domain_events`+audit); admin rebuild | 7 tables (`trade_graph_*`); RPCs `trade_graph_record_checkpoint`, `_request_rebuild` | RLS Y (7) · grants Y · search_path Y | **Y** | `b23a2dadf006` | BLOCKED | NOT APPLIED |
| 16 | `20260704090000_diaspora_payment_milestone_idempotency.sql` | Final completion (W3) | Additive idempotency key on payment milestones so retried creations de-duplicate | alters `diaspora_payment_milestones` (+`idempotency_key`, partial unique index on `(import_order_id, idempotency_key)`) | additive only | **Y** | `1f1fc891fd05` | BLOCKED (EB-1) | NOT APPLIED (EB-5) |

## Dependency chain

`013` → base `002_multi_tenant_and_auth_schema` (tenants/users/tenant_users/vehicles). `014`, `20260619201406`,
`20260620232827` → `013`. `phase1b (3)` → `013`, and defines the `diaspora_trade_os_*` helper set reused by
**Phases 8/9/9-disputes/10**. `phase3 (5)` → `phase1b`. `H1 (7)` → `phase1b`+`phase3`+`013`. `H2/H3` → `013`.
`H7 (11)` → `H1/H2/H3`. `phase9-disputes (14)` → `phase9 (13)`. `phase10 (15)` → `phase1b` helpers + `011_phase6_schema`
(`domain_events`) + `013` (audit log).

## Apply / verify procedure (EB-1 staging first, then EB-5 production)

1. Snapshot `schema_migrations` on the target to determine which of the 15 are **already applied** (never reapply).
2. Apply the **missing** subset in ledger order via `npm run migrate:up`; apply the two ⚠ marker-less files out-of-band via `psql` (idempotent) and record them.
3. Verify per migration: tables, indexes, constraints, atomic RPCs present; RLS enabled + policies; `REVOKE … FROM PUBLIC` + `service_role` grants; `SET search_path` pinned on SECURITY DEFINER fns; and tenant-isolation spot checks.
4. Run Supabase advisors after each staging apply.
5. H9 (staging concurrency proof) remains **`SKIPPED — SECRET UNAVAILABLE`** until `DIASPORA_STAGING_DATABASE_URL` is provided (EB-1) and the concurrency test actually runs.
