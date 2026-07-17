# Provider Architecture & Onboarding Runbook

**Scope:** the shared provider control-plane that backs every external integration —
government sources (ZIMRA/CVR/ZINARA/VID/CID), insurers, lenders and escrow providers.
**Foundation migration:** `20260703120000_provider_platform.sql` (+ `20260703190000_provider_storage.sql`).

## 1. Design principles

1. **One control-plane, many capabilities.** Every provider is a row in `provider_registry`
   with a `capability_type` ∈ {government_source, insurance, finance, escrow}. All calls go
   through one governed path (`providerFramework.executeProviderRequest`).
2. **Honesty is structural.** A provider's `activation_mode` is stamped onto every result and
   every `provider_request_attempts` row. A simulated/sandbox/manual/unavailable result can
   never be relabelled as official/live (enforced in code + the DB mode column + UI badges).
3. **Fail-closed by default.** A new provider is `activation_mode='not_configured'` with
   `kill_switch_enabled=true`. It is not callable until an admin (a) clears the kill switch and
   (b) sets a callable mode. `live`/`pilot_live` additionally require `contract_status='signed'`
   and a `credential_ref`.
4. **Secrets live outside the database.** `credential_ref` holds a *reference* (an env/vault key
   NAME), never a secret value. `upsertProvider` refuses anything that looks like a secret.
5. **Append-only history.** `provider_request_attempts` and `provider_activation_history` are
   immutable (governance_block_mutation triggers). Money and governed decisions can never be
   silently rewritten.

## 2. Activation modes (11)

| Mode | Callable | Meaning |
|------|----------|---------|
| `not_configured` | no | registered, nothing set up |
| `contract_pending` | no | awaiting a signed agreement |
| `credential_pending` | no | contract signed, credentials not yet provisioned |
| `sandbox` | yes | deterministic simulator (staging/tests) |
| `partner_file` | yes | signed batch/file import from an approved operator |
| `manual` | yes | authorized human verification recorded with evidence |
| `pilot_live` | yes | live with a real provider under a limited pilot (allowlist/caps) |
| `live` | yes | full live production |
| `degraded` | no | live but impaired — routes to unavailable |
| `unavailable` | no | temporarily not queryable |
| `suspended` | no | administratively stopped |

Callable ⊂ {sandbox, partner_file, manual, pilot_live, live}. Everything else returns
`unavailable` (never a fabricated result).

## 3. Execution path (every call)

`executeProviderRequest(provider, req, opts)`:
1. **Idempotency** — a repeated `idempotency_key` returns the recorded prior outcome (no re-call).
2. **Kill switch + mode gate** — fail-closed; records an `unavailable` attempt with the reason.
3. **Global capability flag** — `capabilityFlags.isCapabilityEnabled(...)`; production defaults OFF
   unless `CAPABILITIES_LIVE=1` (no accidental sandbox in production).
4. **Circuit breaker** — ≥4 failures in the last 5 attempts opens the circuit → `circuit_open`.
5. **Invoke** (simulator for sandbox/pilot; a stub returning `unavailable`/`credential_pending`
   until a real transport is wired) with **retries** on transient outcomes (timeout/rate_limit).
6. **Dead-letter** after exhausting retries.
7. Every attempt is written append-only with a correlation id.

## 4. Onboarding a provider (operator steps)

1. `POST /api/admin/providers` — register (fail-closed; supply `provider_key`, `capability_type`,
   `display_name`, optional `credential_ref` **name**, `endpoint_allowlist` for SSRF, `config`).
2. Complete the provider dossier / activation package (see the per-provider docs).
3. When a contract is signed: set `contract_status='signed'` and the `credential_ref`.
4. Provision the real secret **outside** the DB (env/vault) under the referenced name.
5. `PATCH /api/admin/providers/:id/activation` → `pilot_live` (or `sandbox` for staging).
6. `PATCH /api/admin/providers/:id/kill-switch` → `{enabled:false}` to allow calls.
7. Monitor `GET /api/admin/providers/:id/health`; schedule reconciliation.

## 5. Kill switches & incident response

- **Per-provider:** `PATCH .../kill-switch {enabled:true}` blocks all new calls immediately;
  history is untouched (append-only). Recorded in `provider_activation_history`.
- **Global:** unset `CAPABILITIES_LIVE` (or set the emergency `CAPABILITY_KILL_SWITCH=1`) to stop
  every capability at once — production default is already fail-closed.
- Open a `provider_incident` (`POST .../incidents`) to track investigation → mitigation → resolution.

## 6. Reconciliation

`reconciliationService.runReconciliation(providerId, capability, externalRecords, internalLookup)`
matches an external settlement/result set against internal append-only history, records
matched/mismatch counts into `reconciliation_jobs`, and queues each unmatched item into
`reconciliation_mismatches` for admin resolution. Reconciliation report artifacts live in the
private `reconciliation-reports` Storage bucket (path reference only).

## 7. Storage

Private buckets (`20260703190000_provider_storage.sql`): `provider-batch-files`,
`reconciliation-reports`, `kyc-kyb-documents`, `dispute-evidence`, `mobile-cert-artifacts`.
Access is service-role + admin/government; the app mints short-lived signed URLs. Checksums,
type/size limits and retention are enforced in the application layer (see the security docs).
