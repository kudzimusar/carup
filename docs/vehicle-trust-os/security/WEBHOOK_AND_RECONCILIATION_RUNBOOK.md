# Webhook & Reconciliation Runbook

Applies to all asynchronous provider integrations (insurer, lender, escrow) and any
government source that pushes signed callbacks or batch files.

## Webhook security contract

Every inbound provider webhook MUST carry:
- `x-signature`: HMAC-SHA256 over `${x-timestamp}.${rawBody}` using the provider's secret;
- `x-timestamp`: unix ms, within a **5-minute** drift window (anti-replay);
- `idempotency-key`: unique per logical event (dedupe).

Verification (`webhookSecurity.verifyWebhook`):
1. **Fail closed in production** — if the provider secret env is unset, no signature can verify
   (never fall back to a committed literal). Dev-bypass requires an explicit opt-in flag and is
   never honored in production.
2. Reject on missing/invalid signature, stale timestamp (replay), or unknown provider.
3. Record every attempt — including failed/replayed — in the provider/eligibility/escrow webhook
   event table (append-only) with `signature_valid` + `replay_detected`.
4. Dedupe by idempotency key; a duplicate is recorded but not re-applied.
5. Only a verified, non-duplicate, well-formed event mutates state (and only forward, gated).

## Secret & credential rotation
- Secrets live in env/vault under the name in `provider_registry.credential_ref` — never in the
  DB, Git, logs, or PR text.
- Rotation: provision the new secret under the referenced name, redeploy, confirm a signed test
  webhook verifies, then retire the old secret. No code change; no DB change.

## Reconciliation cycle
1. Pull the provider's settlement/result set for the window (signed batch file → private
   `reconciliation-reports` bucket; store the path, never contents).
2. `runReconciliation(providerId, capability, externalRecords, internalLookup)`:
   - matched → counted;
   - missing internal → `reconciliation_mismatches` (`missing_internal`);
   - amount mismatch → `reconciliation_mismatches` (`amount_mismatch`).
3. Job status `succeeded` (0 mismatches) or `partial`.
4. Admin resolves each mismatch (`investigating` → `resolved`/`written_off`) via the operator
   console; resolutions are auditable.

## Dead-letter & incident response
- Transient outcomes (timeout/rate_limit) retry with backoff; exhausted retries → dead-letter
  attempt row.
- Repeated failures open the circuit breaker (provider paused automatically).
- On a confirmed provider incident: open a `provider_incident`, flip the per-provider kill switch,
  investigate via `provider_request_attempts` (correlation ids), mitigate, resolve, re-enable.
- Global stop: unset `CAPABILITIES_LIVE` / set the emergency kill switch — halts all providers
  without corrupting append-only history.
