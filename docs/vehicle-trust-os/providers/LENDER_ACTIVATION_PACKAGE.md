# Regulated Lender (Finance) Activation Package

Vehicle Trust OS — Full Activation, canonical goal §101–113 ("Finance").

This package documents how a **regulated lender** is onboarded, configured, gated,
integrated and (eventually) taken live for vehicle finance eligibility. It is a
production-ready **workflow**, not a live integration: no lender, endpoint or credit
decision is invented here. The system runs in **sandbox** (deterministic simulator) until a
real, contracted, credentialed lender is approved and switched to a live mode by an operator.

> **Privacy invariant (canonical §112).** No applicant, affordability, income or credit data
> is ever stored in, or projected from, the public vehicle passport or the general Partner
> API. This workflow stores **only** a gate-context snapshot with each decision and exposes
> **only** a coarse availability state publicly. Full decisions are private to the applicant
> and admins.

---

## 1. Components

| Concern | Artifact |
| --- | --- |
| Schema | `database/migrations/20260703150000_finance_provider.sql` |
| Workflow service | `backend/services/finance/lenderWorkflow.js` |
| HTTP routes | `backend/routes/lenderRoutes.js` |
| Tests | `backend/tests/finance-provider.test.js` |
| Reused: provider platform | `backend/services/providerPlatform/{providerRegistry,providerFramework,simulators}.js` |
| Reused: eligibility gates | `backend/services/eligibility/{eligibilityContract,webhookSecurity}.js` |

The lender workflow **extends** the shared eligibility framework and the provider platform —
it does not fork them. Every lender call passes through `providerFramework.executeProviderRequest`,
inheriting fail-closed gating, idempotency, retries, circuit breaker and honest mode labelling.

### Schema

- **`lender_profiles`** — one row per configured regulated lender (control-plane config only,
  no applicant data): `legal_name`, `products`, `eligibility_rules`, `consent_terms`,
  `retention_terms`, `contract_status`, `credential_ref` (**reference only**, never a secret),
  `active` (fail-closed default `false`), `tenant_id`. Bound to a `provider_registry` row of
  `capability_type = 'finance'`.
- **`finance_consents`** — applicant consent ledger. Core fields (`vin`, `applicant_user_id`,
  `consent_version`, `scope`, `granted_at`) are **immutable** (content-guard trigger). Only the
  retention-lifecycle stamps `revoked_at` and `deletion_requested_at` may be set later. Rows are
  never hard-deleted (an erasure request is a stamp; purge is a separate retention job).
- **`finance_provider_decisions`** — **append-only** (via `governance_block_mutation`) lender
  decision history. `decision_inputs_snapshot` is constrained by a DB `CHECK` that rejects the
  obvious sensitive keys (`income`, `monthly_income`, `credit_score`, `affordability`,
  `monthly_debts`, `ssn`). Links to the driving `eligibility_requests` row `ON DELETE RESTRICT`.

RLS: `service_role` full; `admin`/`government` read all; applicants read only their own consent
and decisions (as vehicle owner or eligibility requester). `anon` has no access. There is **no**
public or general-`authenticated` projection of any applicant/credit/decision detail.

---

## 2. Onboarding runbook

1. **Register the provider** (control plane, fail-closed): `reg.upsertProvider({ provider_key,
   capability_type: 'finance', jurisdiction, display_name })`. New providers start
   `kill_switch_enabled = true`, `activation_mode = 'not_configured'`.
2. **Create the lender profile**: insert a `lender_profiles` row bound to that provider with the
   agreed `products`, `eligibility_rules`, `consent_terms`, `retention_terms`. Keep `active = false`.
3. **Sandbox**: `reg.setActivationMode(id, 'sandbox')` then `reg.setKillSwitch(id, false)`. The
   deterministic simulator now serves every eligibility path for UAT and contract tests.
4. **Contract + credentials** (external activation gates — may remain named blockers): a signed
   `contract_status = 'signed'` and a `credential_ref` (an env/vault key **name**) are required
   before any live mode. The registry refuses to store an apparent secret in `credential_ref`.
5. **Pilot / live**: `reg.setActivationMode(id, 'pilot_live' | 'live')` — allowed only when the
   contract is signed and a credential reference exists. Set `lender_profiles.active = true`.
   A provider must **never** silently fall back from live to sandbox in production.

---

## 3. Consent + retention model

- **Consent is mandatory.** `requestLenderEligibility` will not call a lender without an
  **active** consent reference. Missing / revoked / erasure-requested consent routes the request
  to `manual_review` and the lender is never called.
- **Minimum approved data projection.** Only the coarse gate context is snapshotted with a
  decision. Raw applicant/income/credit data is neither required nor stored by this workflow.
- **Revocation** stamps `revoked_at`; **right-to-erasure** stamps `deletion_requested_at`
  (`requestApplicantDeletion`). Both are permitted updates; the core consent content stays
  immutable and rows are never hard-deleted. Actual data purge is a separate, documented
  retention job keyed off `deletion_requested_at` and the lender's `retention_terms`.

---

## 4. Gate snapshots

Before any lender call, `evaluateGates('finance', …)` runs the shared trust gates. Hard blocks
(identity unresolved, active fraud case, invalid publication, suspended dealer) → `declined`.
Soft blocks (missing consent, insufficient source coverage) → `manual_review`. Only the
gate-context fields (`identity_status`, `fraud_block`, `publication_status`, `dealer_suspended`,
`source_coverage_connected`, `evidence_sufficient`) are captured in `decision_inputs_snapshot`.
`buildGateSnapshot` and the DB `CHECK` both strip/forbid sensitive keys defensively.

---

## 5. Decision states

`finance_provider_decisions.outcome`:

| Outcome | Meaning |
| --- | --- |
| `potentially_eligible` | Lender indicates likely eligibility (sandbox: clean VIN). |
| `conditional` | Eligible subject to conditions. |
| `manual_review` | Routed to a human (gate soft-block or lender no-record). |
| `declined` | Hard gate block, or lender high-risk decline. |
| `unavailable` | Lender not callable / kill-switched / capability disabled (fail-closed). |
| `expired` | A prior decision's validity window has lapsed. |
| `failed` | Transient exhaustion (timeout/rate-limit/dead-letter) or malformed response. |

Outcomes map onto the shared `eligibility_requests.status` vocabulary for the applicant view.
Decisions carry `provider_reference` and `validity_until` where the lender supplies them.

---

## 6. Webhooks + reconciliation

- **Async updates** arrive at `POST /api/finance/lender/webhook`. Verified with HMAC-SHA256
  signature + 5-minute replay window + idempotency (`webhookSecurity`), signing identity
  `finance_sandbox` (secret from `FINANCE_WEBHOOK_SECRET`). **Fail-closed on a missing secret**:
  absent the env secret in production, verification can never succeed.
- Every event (including invalid/replayed/duplicate) is recorded append-only in
  `eligibility_webhook_events`. A valid event **appends** a new `finance_provider_decisions`
  row and updates the `eligibility_request` — it never mutates a prior decision.
- **Reconciliation/support**: admins review the private ledger via
  `GET /api/admin/finance/lender/decisions`. The shared provider platform's
  `reconciliation_jobs` / `reconciliation_mismatches` tables back periodic reconciliation of
  lender references against internal decisions.

---

## 7. Applicant data protection

- Public passport / Partner API: `financeAvailabilityPublic(vin)` returns **only**
  `{ vin, finance: 'available' | 'not_offered', detail: 'coarse_availability_only' }`.
- Private status: `GET /api/vehicles/:vin/finance/lender/status` is restricted to the applicant
  (vehicle owner) and admins.
- RLS + the `decision_inputs_snapshot` CHECK + the `stripSensitive`/`buildGateSnapshot` guards
  provide defence in depth so no applicant/credit field can leak into any projection.

---

## 8. API surface

| Method + path | Roles | Notes |
| --- | --- | --- |
| `POST /api/vehicles/:vin/finance/consent` | owner/dealer/admin | Records consent; returns a `consent_ref`. |
| `POST /api/vehicles/:vin/finance/lender/eligibility` | owner/dealer/admin | Consent required; gates enforced. |
| `GET  /api/vehicles/:vin/finance/lender/status` | owner/admin | **Private** status + history. |
| `POST /api/vehicles/:vin/finance/consent/:id/deletion` | owner/admin | Right-to-erasure request. |
| `GET  /api/vehicles/:vin/finance/availability` | public | Coarse availability only. |
| `POST /api/finance/lender/webhook` | (signed) | Signature + replay + idempotency. |
| `GET  /api/admin/finance/lender/decisions` | admin/government | Reconciliation/support ledger. |

---

## 9. Pilot activation checklist

- [ ] Signed lender contract on file (`contract_status = 'signed'`).
- [ ] Credential **reference** configured (env/vault key name; no secret in the DB).
- [ ] `consent_terms` + `retention_terms` agreed and stored on `lender_profiles`.
- [ ] Webhook secret provisioned (`FINANCE_WEBHOOK_SECRET`) and rotation documented.
- [ ] Sandbox contract tests green (`node --test backend/tests/finance-provider.test.js`).
- [ ] Migration verified Up/Down/re-Up + immutability in the PGlite harness.
- [ ] Capability flag `finance_eligibility` intentionally set for the target environment.
- [ ] Pilot allowlist + per-provider kill switch confirmed operable.
- [ ] Reconciliation job scheduled; unmatched-event queue monitored.
- [ ] Privacy review: confirmed no applicant/credit data in public passport or Partner API.

---

## 10. Completion classification

**Classification: COMPLETE (workflow) — pending EXTERNAL ACTIVATION GATES for live decisions.**

Justification. Every element the canonical goal requires to be built now is present, real and
tested: the schema (with immutability, content-guard, privacy CHECK and RLS), the workflow
service (consent gating, gate snapshots, framework-routed lender calls, outcome mapping,
append-only decisions, signed/replay/idempotent fail-closed webhooks, retention controls,
coarse public projection), the routes, the contract tests (20 passing) and this package. What
remains are **named external activation gates only** — a signed lender contract, issued
credentials, and an approved live credit endpoint — which per the goal (§19) may remain as
clearly-named blockers and must not be used to defer architecture, code, tests or docs. Until
those gates clear, the workflow runs honestly in sandbox and no live credit decision is claimed.
