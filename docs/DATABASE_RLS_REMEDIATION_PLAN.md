# Database RLS Remediation Plan

> Generated: 2026-06-19
> PR: #72 — phase-7c-native-verification-production-loop
> Status: **INVENTORY ONLY** — No RLS policies are applied or modified by PR #72

---

## Confirmed Counts

| Environment | Public Tables Without RLS |
|-------------|--------------------------|
| Production (`vhmnajoeicasaigiophh`) | 27 |
| Staging (`eoyenigwevnxwwhyhaer`) | 39 |

---

## Table Classification

### 1. Identity / PII (Priority 0)

| Table | Environment | Risk | Current Readers | Intended Actors | Proposed Policy Model | Notes |
|-------|------------|------|----------------|-----------------|----------------------|-------|
| `users` | Both | HIGH | service_role, anon? | service_role only | `service_role` only; anon/authenticated denied | Legacy table — critical to audit |
| `user_sessions` | Staging (absent) | HIGH | service_role | service_role only | `service_role` only; authenticated denied | Phase 7B migration will create with RLS |
| `login_attempts` | Staging (absent) | HIGH | service_role | service_role only | `service_role` only | Audit data, never exposed |
| `ocr_documents` | Staging (absent) | HIGH | service_role | service_role only | `service_role` only | Contains extracted identity data |
| `identity_documents` | Both | HIGH | service_role | service_role + user (own) | User can read own; service_role full | — |
| `kyc_profiles` | Both | HIGH | service_role | service_role + user (own) | User can read own; service_role full | — |
| `device_sessions` | Both | MEDIUM | service_role | service_role + user (own) | User can read own; service_role full | — |
| `trusted_devices` | Both | MEDIUM | service_role | service_role + user (own) | User can read own; service_role full | — |

### 2. Authentication (Priority 0)

| Table | Environment | Risk | Current Readers | Intended Actors | Proposed Policy Model |
|-------|------------|------|----------------|-----------------|----------------------|
| `failed_auth_attempts` | Both | HIGH | service_role | service_role only | `service_role` only; audit-only |
| `security_events` | Both | HIGH | service_role | service_role only | `service_role` only |
| `role_switch_logs` | Both | HIGH | service_role | service_role only | `service_role` only |
| `tenant_api_keys` | Both | HIGH | service_role | service_role + tenant admin | Tenant admin can read own; service_role full |

### 3. Financial (Priority 0)

| Table | Environment | Risk | Proposed Policy Model |
|-------|------------|------|----------------------|
| `financial_ledger` | Both | CRITICAL | `service_role` only |
| `payments` | Both | CRITICAL | `service_role` only |
| `payouts` | Both | CRITICAL | `service_role` only |
| `refunds` | Both | CRITICAL | `service_role` only |
| `payment_transactions` | Both | CRITICAL | `service_role` only |
| `tenant_billing` | Both | HIGH | `service_role` + tenant admin |
| `safepay_transaction` (if separate) | Both | CRITICAL | `service_role` only |

### 4. Tenant-Owned Data (Priority 1)

| Table | Environment | Risk | Proposed Policy Model |
|-------|------------|------|----------------------|
| `tenants` | Both | HIGH | `service_role` only; tenant admin read |
| `tenant_users` | Both | HIGH | Tenant-scoped; members see own org |
| `tenant_settings` | Both | MEDIUM | Tenant admin + service_role |
| `tenant_branding` | Both | LOW | Public (tenant's own branding) |
| `tenant_feature_flags` | Both | LOW | Public read; service_role write |
| `organization_memberships` | Both | HIGH | User can read own; tenant admin + service_role |
| `organizations` | Both | HIGH | User can read own; tenant admin + service_role |
| `organization_audit_logs` | Both | MEDIUM | Tenant admin + service_role |

### 5. User-Owned Data (Priority 1)

| Table | Environment | Risk | Proposed Policy Model |
|-------|------------|------|----------------------|
| `saved_vehicles` | Both | LOW | User can CRUD own |
| `vehicle_evidence` | Both | MEDIUM | User can read own + service_role |
| `vehicle_documents` | Both | MEDIUM | User can read own + service_role |
| `listing_images` | Both | LOW | Public read if public listing; owner write |

### 6. Audit / Logging (Priority 1)

| Table | Environment | Risk | Proposed Policy Model |
|-------|------------|------|----------------------|
| `trust_audit_events` | Both (RLS enabled) | — | Already correctly restricted |
| `trust_fact_requests` | Both | MEDIUM | Reviewer + service_role |
| `system_audit_logs` | Both | MEDIUM | `service_role` only |
| `signature_verification_logs` | Both | MEDIUM | `service_role` only |
| `ai_inference_logs` | Both | LOW | `service_role` only |
| `ai_fraud_scans` | Both | LOW | `service_role` only |
| `performance_telemetry` | Both | LOW | `service_role` only |
| `gateway_integration_logs` | Both | LOW | `service_role` only |
| `sync_reconciliation_queue` | Both | LOW | `service_role` only |

### 7. Diaspora (Priority 2)

| Table | Environment | Risk | Proposed Policy Model |
|-------|------------|------|----------------------|
| `diaspora_import_orders` | Both | MEDIUM | Participant-scoped + service_role |
| `diaspora_import_order_participants` | Both | MEDIUM | Participant-scoped |
| `diaspora_shipments` | Both | MEDIUM | Participant-scoped |
| `diaspora_container_shipments` | Both | MEDIUM | Participant-scoped |
| `diaspora_trade_documents` | Both | MEDIUM | Participant-scoped |
| `diaspora_trade_document_verifications` | Both | MEDIUM | Reviewer + participant |
| `diaspora_trade_profiles` | Both | LOW | Public read; owner write |
| `diaspora_cargo_reservations` | Both | MEDIUM | Participant-scoped |
| `diaspora_payment_milestones` | Both | MEDIUM | Participant-scoped |
| `diaspora_import_quotes` | Both | LOW | Participant-scoped |
| `diaspora_compliance_reviews` | Both | MEDIUM | Reviewer + service_role |
| `diaspora_notification_preferences` | Both | LOW | User own |
| `diaspora_reputation_records` | Both | LOW | Public read |
| `diaspora_shipment_stage_events` | Both | MEDIUM | Participant-scoped |
| `diaspora_import_audit_log` | Both | MEDIUM | `service_role` only |
| `diaspora_ai_commands` | Both | LOW | `service_role` only |
| `diaspora_drive_connections` | Both | MEDIUM | User own |
| `diaspora_drive_files` | Both | MEDIUM | User own + participant |
| `diaspora_order_documents` | Both | MEDIUM | Participant-scoped |
| `diaspora_stock_items` | Both | LOW | Participant-scoped |
| `diaspora_stock_ledger` | Both | LOW | Participant-scoped |
| `diaspora_supply_documents` | Both | MEDIUM | Participant-scoped |
| `diaspora_workbook_import_batches` | Both | MEDIUM | Operator + service_role |
| `diaspora_workbook_import_rows` | Both | MEDIUM | Operator + service_role |
| `vehicle_government_documents` | Both | MEDIUM | Government + service_role + owner |
| `vehicle_import_records` | Both | MEDIUM | Participant-scoped |
| `trade_document_rules` | Both | LOW | Public read; service_role write |
| `trade_document_templates` | Both | LOW | Public read |
| `trade_document_types` | Both | LOW | Public read |

### 8. Public Reference Data (Priority 3)

| Table | Environment | Risk | Proposed Policy Model |
|-------|------------|------|----------------------|
| `currency_rates` | Both | LOW | Public read; service_role write |
| `domain_events` | Both | LOW | `service_role` only |
| `server_health` | Both | LOW | `service_role` only |
| `vehicle_listings` | Both | LOW | Public read; authorized write |
| `vehicle_listing_summaries` | Both | LOW | Public read |
| `vehicle_telemetry` | Both | LOW | Authorized write |
| `dealer_leads` | Both | LOW | Dealer + service_role |
| `dealer_promotions` | Both | LOW | Public read; dealer write |
| `mechanic_parts` | Both | LOW | Mechanic + service_role |
| `mechanic_work_orders` | Both | LOW | Mechanic + owner + service_role |
| `insurance_claims` | Both | MEDIUM | Participant + service_role |
| `fraud_alerts` | Both | MEDIUM | Reviewer + service_role |
| `compliance_reports` | Both | MEDIUM | Government + service_role |
| `registry_verifications` | Both | MEDIUM | Government + service_role |
| `vehicle_plate_history` | Both | LOW | Public read; service_role write |
| `stolen_vehicles` | Both | LOW | Public read; service_role write |
| `trust_score_history` | Both | MEDIUM | User own; service_role full |
| `rolling_integrity_checkpoints` | Both | LOW | `service_role` only |
| `system_failures` | Both | LOW | `service_role` only |
| `public_keys` | Both | LOW | `service_role` only |
| `outbox_events` | Both | LOW | `service_role` only |
| `notification_queue` | Both | LOW | `service_role` only |

### 9. Verification / Identity (Priority 0 — Phase 7C target)

| Table | Environment | Risk | Proposed Policy Model | Migration |
|-------|------------|------|----------------------|-----------|
| `verification_sessions` | Production (RLS ON) | — | Already correct: service_role only | 20260613000000 |
| `verification_ocr_provenance` | Production (RLS ON) | — | Already correct: service_role only | 20260618030000 |
| `verification_assessments` | Neither (staging absent) | — | service_role only | 20260618040000 |
| `verification_decisions` | Neither (staging absent) | — | service_role only | 20260618040000 |

---

## Risk of Enabling RLS Without a Policy

Enabling RLS on a table without a policy (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
without a corresponding `CREATE POLICY`) **denies all access** — including to
`service_role` for existing queries. This would break the application.

**Rule**: Always create the `service_role` grant policy before or simultaneously
with enabling RLS. The standard pattern is:

```sql
ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE <name> FROM anon;
REVOKE ALL ON TABLE <name> FROM authenticated;
GRANT ALL ON TABLE <name> TO service_role;
```

---

## Recommended Priority

| Priority | Category | Tables | Target PR |
|----------|----------|--------|-----------|
| P0 | Identity/PII, Auth, Financial, Verification | ~20 | Separate PR after #72 |
| P1 | Tenant, User-owned, Audit | ~15 | Separate PR after P0 |
| P2 | Diaspora, Government | ~25 | Per-domain PR |
| P3 | Public reference, Operational | ~20 | Per-domain PR |

---

## Required Tests Per Policy

For each table where RLS is enabled with a policy, verify:

1. `service_role` can SELECT/INSERT/UPDATE/DELETE (backend access preserved)
2. `anon` is denied all access
3. `authenticated` is denied direct access (unless specifically granted)
4. Row-level filtering works correctly for user-scoped access
5. No evidence storage paths are exposed through public policies

---

## Exclusions

The following are intentionally excluded from Phase 7C RLS work:

- Tables that only exist in SQLite-flavored migrations (001–015) that were never
  applied to Supabase (their Postgres equivalents may not exist)
- `storage.buckets` and `storage.objects` — Supabase-managed, different RLS model
- Tables managed by Supabase Auth (`auth.users`, etc.) — managed by Supabase
- Migration history tables (`supabase_migrations.schema_migrations`)
