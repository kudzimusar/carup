# Vehicle Trust OS — Provider Integration Threat Model

Scope: the provider platform + government/insurer/lender/escrow integrations + private Storage.

## Assets
- Buyer/seller PII, owner identity, KYC/KYB documents, applicant credit/affordability data,
  underwriting data, escrow funds (future), provider credentials, webhook secrets, audit history.

## Trust boundaries
- Public buyer surface · authenticated app · Partner API (scoped keys) · admin/government
  operator console · external providers (over the network) · Supabase (DB + Storage).

## Threats & mitigations

| # | Threat | Mitigation |
|---|--------|-----------|
| T1 | Credential leakage into Git/DB/logs/PR | Secrets are never stored — only `credential_ref` (env/vault key name). `upsertProvider` + secret-scan reject apparent secrets. Redaction in logs. |
| T2 | SSRF via provider endpoints | `provider_registry.endpoint_allowlist`; outbound calls must match the allowlist; live transport stubs until wired. |
| T3 | Webhook forgery | HMAC-SHA256 signature over `${timestamp}.${payload}`, timing-safe compare; **fail-closed in production** when the secret env is unset (no committed-literal fallback). |
| T4 | Webhook replay | 5-minute timestamp drift window + idempotency-key dedupe on webhook events. |
| T5 | Duplicate/double execution | Idempotency keys on `provider_request_attempts` (unique) + eligibility/escrow request keys. |
| T6 | Sandbox result shown as official | `activation_mode` stamped on every result + attempt row + UI badge; callable-mode gate; simulator payloads tagged `SIMULATED`. |
| T7 | Cross-tenant / cross-user data access | RLS on every sensitive table (service_role + admin/gov + owner/participant scope); Partner API redaction; no anon grants on control-plane. |
| T8 | Applicant credit/underwriting data exposure | Finance/insurance decisions store gate *snapshots* only; public + Partner projections strip all applicant/underwriting fields (asserted in tests). |
| T9 | Unauthorized money movement (escrow) | KYC/KYB gate + transaction caps + pilot allowlist + trust gates + dual-control (two distinct approvers) for manual release/refund; sandbox funds never labelled real; no real funds until external approvals. |
| T10 | Audit tampering | Append-only triggers (governance_block_mutation) on attempts, activation history, decisions, money history — UPDATE/DELETE blocked at the DB. |
| T11 | Provider outage cascading failure | Circuit breaker + dead-letter + degraded/unavailable modes + per-provider + global kill switches. |
| T12 | Malicious/oversized uploads | Private buckets; server-side type/size/checksum controls; short-lived signed URLs; no direct end-user bucket reads. |
| T13 | Privilege escalation on activation | `live`/`pilot_live` require signed contract + credential_ref; activation changes are append-only + attributed to an actor. |
| T14 | Stale/expired credentials | Credential rotation is external (referenced key), documented in the webhook/reconciliation runbook; expired contract → mode gated. |

## Residual / external gates
- Real provider endpoints, credentials, contracts and legal approvals (all providers).
- Physical iOS certification hardware/signing.
These are named activation gates — never bypassed by simulators.
