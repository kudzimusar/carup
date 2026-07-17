# Licensed Insurer Activation Package

**Scope:** production-ready onboarding + execution for a **licensed insurer** provider, built on
the shared provider control-plane and the shared eligibility framework. This is the insurer-specific
layer of the Vehicle Trust OS Full Activation program (canonical doc §84–99).

**Migrations**
- Foundation: `20260703120000_provider_platform.sql` (registry, execution attempts, activation history).
- Eligibility: `20260626160000_eligibility_framework.sql` (`eligibility_requests` / `eligibility_decisions` / `eligibility_webhook_events`).
- **This package: `20260703140000_insurance_provider.sql`** (`insurer_profiles`, `insurance_consents`, `insurance_provider_decisions`).

**Code**
- Service: `backend/services/insurance/insurerWorkflow.js`
- Routes: `backend/routes/insurerRoutes.js`
- Tests: `backend/tests/insurance-provider.test.js`

> **Honesty guarantee.** No insurer, endpoint, policy number, or premium is invented anywhere in
> this package. Until a real insurer is contracted and its transport is wired, every outcome is
> produced by the deterministic **sandbox simulator** and is stamped `mode='sandbox'`. A policy or
> `eligible` outcome is **never** recorded without a confirmed `provider_reference`.

---

## 1. Design principles (insurer-specific)

1. **Extend, do not fork.** The insurer capability reuses the shared gates
   (`eligibilityContract.evaluateGates`), the shared execution/retry/idempotency/circuit-breaker
   path (`providerFramework.executeProviderRequest`), and the shared signed-webhook verification
   (`webhookSecurity.verifyWebhook`). Only insurer-specific concerns (consent, min-data projection,
   outcome mapping, the insurer decision ledger) are new.
2. **Consent is mandatory and scoped.** An insurer request cannot proceed without a valid, unrevoked
   `insurance_consents` grant whose `scope.fields` cover the insurer's `min_data_projection.required`.
3. **Privacy by construction.** Public vehicle facts (VIN/make/model/year) live in `vehicles`.
   Private underwriting/applicant context is **never** stored as a public fact. An
   `insurance_provider_decisions` row stores only: outcome, provider reference, owner-facing
   conditions, validity, and the honesty `mode` label — never premiums, risk scores, or applicant PII.
4. **Fail-closed.** A new insurer profile is `active=false`, `contract_status='none'`. The underlying
   `provider_registry` row defaults to `kill_switch_enabled=true`, `activation_mode='not_configured'`.
   `live`/`pilot_live` additionally require `contract_status='signed'` + a `credential_ref`.
5. **Secrets outside the DB.** `credential_ref` is an env/vault key **name**, never a secret value
   (`registerInsurerProfile` refuses anything that looks like a secret).
6. **Append-only.** `insurance_provider_decisions` is immutable (`governance_block_mutation`).
   `insurance_consents` is append-only with a **one-way** revocation (`insurance_consent_guard`):
   consent facts are immutable; `revoked_at` may transition `NULL → timestamp` exactly once.

---

## 2. Consent model

`insurance_consents` (append-only ledger):

| Column | Meaning |
|--------|---------|
| `id` | the **consentRef** passed to a request |
| `vin` | vehicle the owner consents about (FK, `ON DELETE RESTRICT`) |
| `user_id` | consenting user (FK) |
| `insurer_profile_id` | the insurer the consent is granted to |
| `consent_version` | must match the insurer profile's `consent_version` |
| `scope` | `{ "fields": ["vin","make",...] }` — the fields the owner authorises to share |
| `granted_at` / `revoked_at` | one-way lifecycle (revoke = single `NULL → timestamp`) |

- **Grant:** `POST /api/vehicles/:vin/insurer/consent` → returns `consent_ref`.
- **Revoke:** `revokeConsent(consentId)` (one-way; enforced immutable).
- **Verify (server-side):** `verifyConsent(vin, consentRef, profile)` fails closed on
  missing / not-found / revoked / version-mismatch / insufficient-scope.

---

## 3. Data projection (minimum necessary)

`insurer_profiles.min_data_projection = { "required": [...], "optional": [...] }` declares the
maximum data the insurer is contractually permitted to receive. At request time
`buildMinDataProjection(vehicle, profile, consent)` returns **only**:

- fields listed in `required ∪ optional`, **and**
- fields the consent `scope` granted, **and**
- fields that are **public vehicle facts** (owner_id / tenant_id are hard-excluded).

Nothing else — no gate context, no trust internals, no applicant data — is ever sent to the provider.

---

## 4. States

### 4.1 Insurer decision outcome (`insurance_provider_decisions.outcome`)

| Outcome | Meaning | Eligibility request status |
|---------|---------|----------------------------|
| `eligible` | insurable; confirmed `provider_reference` present | `eligible` |
| `conditional` | insurable subject to owner-facing conditions | `conditionally_eligible` |
| `manual_review` | needs a human / more evidence / no insurer record | `manual_review` |
| `declined` | not insurable (e.g. high-risk / gate hard-block) | `not_eligible` |
| `unavailable` | insurer not callable (kill switch / mode / outage) | `unavailable` |
| `expired` | a prior decision's validity has lapsed | `expired` |
| `failed` | transient/technical failure after retries (timeout/rate-limit/malformed) | `failed` |

### 4.2 Provider-framework outcome → insurer outcome mapping

`ok`+evidence → `eligible`/`conditional`/`declined`/`manual_review` (from the provider's eligibility
field); `ok` **without** `provider_reference` → `manual_review` (honesty); `mismatch` → `conditional`;
`high_risk` → `declined`; `no_record` → `manual_review`; `unavailable`/`circuit_open` → `unavailable`;
`timeout`/`rate_limited`/`malformed`/`error` → `failed`.

### 4.3 Gates run BEFORE the provider

`evaluateGates('insurance', ctx)` hard-blocks (→ `declined`/`not_eligible`) on unresolved identity,
an active fraud case, invalid publication, or a suspended dealer; soft-blocks (→ `manual_review`) on
insufficient source coverage. Consent failures also short-circuit to `manual_review`. In every block
case the **provider is never called** (0 rows in `provider_request_attempts`).

---

## 5. Webhook & reconciliation

**Endpoint:** `POST /api/insurer/webhook` (no role auth — authenticated by HMAC).

Headers: `x-signature` (HMAC-SHA256 of `${timestamp}.${payload}`), `x-timestamp`, `idempotency-key`,
optional `x-provider-id`. Body: `{ request_id, outcome, provider_reference?, conditions?, validity_until? }`.

`ingestInsurerWebhook` (reuses `webhookSecurity.verifyWebhook`):
1. **Signature + replay** — HMAC + 5-minute timestamp drift window.
2. **Fail-closed on missing secret** — without `INSURANCE_WEBHOOK_SECRET` in production the provider
   is unknown → verification cannot succeed → rejected (HTTP 401).
3. **Idempotency** — a repeated `idempotency-key` is recorded (append-only audit in
   `eligibility_webhook_events`) but never re-applied.
4. **Honesty** — `outcome='eligible'` without a `provider_reference` is downgraded to `manual_review`.
5. **Apply** — updates the `eligibility_requests` row and appends a new
   `insurance_provider_decisions` row with `source='webhook'`.

Responses: `200` applied · `202` valid signature but not applied (duplicate / missing fields) · `401`
invalid signature.

**Reconciliation:** the shared platform's `reconciliation_jobs` / `reconciliation_mismatches` tables
(migration `20260703120000`) reconcile insurer references against the append-only decision ledger on a
schedule; unmatched references open a mismatch for admin follow-up. No decision is ever silently rewritten.

---

## 6. Pilot activation checklist

1. `POST /api/admin/providers` — register the insurer in `provider_registry`
   (`capability_type='insurance'`, `provider_key`, `display_name`, `credential_ref` **name** only,
   `endpoint_allowlist` for SSRF). Fail-closed by default.
2. `POST /api/admin/insurer/providers` — create the `insurer_profiles` row (`legal_name`, `products`,
   `regions`, `min_data_projection`, `consent_version`). Leave `active=false` until contracted.
3. Sign the contract → set `contract_status='signed'`; provision the secret in vault/env and set
   `credential_ref` to its **name**.
4. Sandbox verification — drive the deterministic simulator via
   `POST /api/vehicles/:vin/insurer/eligibility` (VIN keywords: `CLEAN…`→eligible, `MISMATCH…`→conditional,
   `NORECORD…`→manual_review, `STOLEN…`→declined, `UNAVAIL…`→unavailable). Confirm the append-only ledger,
   the public projection, and webhook signature/replay/idempotency.
5. `pilot_live` — clear the kill switch and set `activation_mode='pilot_live'` (requires signed contract +
   credential_ref). Apply an allowlist + caps. Monitor `/api/admin/insurer/providers` (health, kill switch,
   incidents) and reconciliation.
6. `live` — promote to `activation_mode='live'` after the pilot exit criteria pass.

At any point: flip the per-provider **kill switch** (or the global `CAPABILITY_KILL_SWITCH` /
`insurance_eligibility` flag) to fail-closed instantly.

---

## 7. API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/vehicles/:vin/insurer/consent` | owner/dealer/admin | record a consent grant → `consent_ref` |
| POST | `/api/vehicles/:vin/insurer/eligibility` | owner/dealer/admin | request insurer eligibility (public projection returned) |
| GET | `/api/vehicles/:vin/insurer/eligibility` | owner/dealer/admin/reviewer | latest status (public projection) |
| POST | `/api/insurer/webhook` | HMAC only | async insurer decision |
| POST | `/api/admin/insurer/providers` | admin | onboard/update an insurer profile |
| GET | `/api/admin/insurer/providers` | admin | provider-health board |
| GET | `/api/admin/insurer/vehicles/:vin/decisions` | admin | full append-only decision history (support) |

The only route that returns the full decision ledger is admin-gated. Every owner/dealer/reviewer
response is the **underwriting-free** public projection.

---

## 8. Completion classification

This package is delivered in the **`sandbox`** activation state.

- **What is production-ready:** the schema (append-only + RLS + immutability, PGlite-verified up/down/re-up),
  the onboarding + consent + projection + execution + webhook code, the routes, and the tests
  (19/19 passing) are complete and production-grade.
- **Why `sandbox`, not `pilot_live`/`live`:** no real insurer is contracted, no live transport is wired,
  and no production `INSURANCE_WEBHOOK_SECRET` / `credential_ref` is provisioned. Per the honesty rule,
  the capability therefore remains in `sandbox` (deterministic simulator) until a licensed insurer is
  onboarded through §6. Promotion to `pilot_live`/`live` is a configuration + contract step, not a code change.
