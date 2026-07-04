# Full Activation — Migration, RLS & Storage Matrix

Scope: the seven migrations that make up the Vehicle Trust OS provider control-plane and the
five domain workstreams. All are **additive, marker-aware (`-- +migrate Up` / `-- +migrate Down`),
and reversible**. Verified by `database/test/migration_pglite_check.mjs` — **Up 23 / Down 23 /
re-Up 23** (PostgreSQL 17.5 WASM) — and applied to deployed staging `eoyenigwevnxwwhyhaer`.

## 1. Migration matrix (this cycle)

| Timestamp / file | SHA-256 (first 16) | Key tables | Append-only (governance_block_mutation) | RLS | Staging |
|---|---|---|---|---|---|
| `20260703120000_provider_platform.sql` | `e0f15cb9d77f963e` | provider_registry, provider_contract_versions, provider_request_attempts, provider_health_checks, provider_incidents, reconciliation_jobs, reconciliation_mismatches, provider_activation_history | provider_request_attempts, provider_activation_history | admin/government + service_role | ✅ applied |
| `20260703130000_government_source_activation.sql` | `7a343ab7866847bd` | government_source_config, government_source_batch_imports | government_source_batch_imports | ✅ | ✅ applied |
| `20260703140000_insurance_provider.sql` | `0102a77cd53a690e` | insurer_profiles, insurance_consents, insurance_provider_decisions | insurance_consents (guard), insurance_provider_decisions | ✅ owner/admin | ✅ applied |
| `20260703150000_finance_provider.sql` | `713a037542420dc1` | lender_profiles, finance_consents, finance_provider_decisions | finance_consents (guard), finance_provider_decisions | ✅ owner/admin | ✅ applied |
| `20260703160000_escrow_provider.sql` | `8ac4325d98d14072` | escrow_provider_config, escrow_kyc_kyb_states, escrow_reconciliation_ledger, escrow_dual_control_approvals | escrow_reconciliation_ledger, escrow_dual_control_approvals | ✅ participant/admin | ✅ applied |
| `20260703170000_mobile_certification.sql` | `f3d76bb4fec0196c` | mobile_certification_runs, mobile_certification_results | mobile_certification_results | ✅ admin/government | ✅ applied |
| `20260703190000_provider_storage.sql` | `476ab84d3d3c0bb9` | (storage.buckets + policies; PGlite-safe no-op) | — | storage policies | ✅ applied |

Immutability is asserted directly in the PGlite harness for every append-only ledger — each
`UPDATE` and `DELETE` is blocked at the DB layer:

```
gov_batch_imports_immutable       update_blocked=true  delete_blocked=true
insurance_decisions_immutable     update_blocked=true  delete_blocked=true
finance_decisions_immutable       update_blocked=true  delete_blocked=true
escrow_recon_ledger_immutable     update_blocked=true  delete_blocked=true
mobile_cert_results_immutable     update_blocked=true  delete_blocked=true
```

## 2. Staging RLS / trigger verification (deployed `eoyenigwevnxwwhyhaer`)

Direct catalog inspection of the 14 new tables on staging:

- **Tables present:** 14 / 14.
- **RLS enabled:** 14 / 14.
- **Append-only guard triggers (BEFORE UPDATE + BEFORE DELETE):** present on all 8 ledgers —
  `government_source_batch_imports`, `insurance_consents`, `insurance_provider_decisions`,
  `finance_consents`, `finance_provider_decisions`, `escrow_reconciliation_ledger`,
  `escrow_dual_control_approvals`, `mobile_certification_results` (2 triggers each).
- **RLS policies:** present on every table (admin/government + service_role; owner/participant
  scope where applicable; **no anon grants** on any control-plane or ledger table).

## 3. Storage matrix (private buckets)

`20260703190000_provider_storage.sql` provisions five **private** buckets with admin/government
read + no-anon policies. The application mints short-lived signed URLs; only path references are
stored (never bytes or URLs), and checksum/type/size limits are enforced in the app layer.

| Bucket | Purpose | Access |
|---|---|---|
| `provider-batch-files` | signed government/insurer/lender batch imports | service_role write; admin/gov read |
| `reconciliation-reports` | settlement/reconciliation artifacts | service_role write; admin/gov read |
| `kyc-kyb-documents` | escrow KYC/KYB evidence | service_role write; admin/gov read |
| `dispute-evidence` | escrow/insurer dispute artifacts | service_role write; admin/gov read |
| `mobile-cert-artifacts` | device-certification evidence (screenshots/logs) | service_role write; admin/gov read |

## 4. Rollback

Every migration ships a tested `-- +migrate Down`. Because all tables are additive and the
ledgers are append-only, rollback is table drops in reverse dependency order (proven by the
harness Down pass) with **no data mutation** of existing production tables. See
`ACTIVATION_READINESS_AND_ROLLBACK.md` §Rollback for the operational procedure.
