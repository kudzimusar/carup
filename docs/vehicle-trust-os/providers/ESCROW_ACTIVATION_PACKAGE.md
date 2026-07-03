# Regulated REAL-MONEY Escrow Provider — Activation Package

Vehicle Trust OS · Full Activation · canonical doc §115–130

> **NO REAL FUNDS MOVE** through this system until an **approved provider, signed contracts,
> completed KYC/AML, agreed settlement terms and real credentials** all exist and are switched
> to live by governance. Until then every escrow runs in **sandbox** and is labelled sandbox.
> This package does **not** invent a provider, does **not** hold client money, and does **not**
> move real funds. It is the *readiness control surface* a regulated escrow integration requires.

---

## 1. What this extension is (and is not)

This is an **extension** of the existing trust-gated escrow lifecycle
(`backend/services/escrow/escrowTrustService.js`, migration `20260626180000_escrow_trust_sessions.sql`)
and the **shared provider platform** (`20260703120000_provider_platform.sql`,
`backend/services/providerPlatform/*`). It adds the regulatory controls that a real-money escrow
provider requires **before** it may ever be activated:

| Concern | Where it lives |
| --- | --- |
| Provider config: jurisdiction, currency, caps, fees, settlement, KYC requirement, pilot allowlist, kill switch, credential **reference** | `escrow_provider_config` |
| KYC/KYB gate state per buyer / seller / dealer (evidence **reference** only) | `escrow_kyc_kyb_states` |
| Append-only external↔internal money reconciliation | `escrow_reconciliation_ledger` |
| Append-only two-distinct-approver record for a sensitive manual release/refund | `escrow_dual_control_approvals` |
| Provider escrow lifecycle FSM + immutable transitions | `escrow_trust_events` (append-only) via `escrowProviderService.js` |

It is **not** a payment processor, a ledger of client balances, or a replacement for the existing
`safepay_escrows` foundation. It never stores secrets (only a `credential_ref` naming an env/vault
key) and never stores KYC documents or PII (only an `evidence_ref` Storage path).

---

## 2. Provider onboarding

A provider is only ever callable when **every** gate below is satisfied (fail-closed by default):

1. **Register** the provider in `provider_registry` with `capability_type = 'escrow'`
   (`providerRegistry.upsertProvider`). New providers start `kill_switch_enabled = true`,
   `activation_mode = 'not_configured'` — i.e. blocked.
2. **Contracts & credentials.** `activation_mode` cannot become `pilot_live`/`live` without
   `contract_status = 'signed'` **and** a `credential_ref`. The secret itself is stored in the
   env/vault the reference names — never in the database.
3. **Escrow config.** Insert an `escrow_provider_config` row (`active = false`,
   `kill_switch_enabled = true` by default). Governance flips `active = true` and the kill switch
   off only after legal / compliance / settlement sign-off.
4. **Capability flag.** The global `escrow` capability flag
   (`featureFlags/capabilityFlags.js`) is **off in production** unless explicitly enabled — so a
   sandbox provider can never activate in production by accident.

Only when the provider is callable **and** the config is active **and** both kill switches are off
**and** the capability flag is on can a new provider escrow be created.

---

## 3. KYC / KYB

- `escrow_kyc_kyb_states` holds one state per `(subject_type ∈ {buyer, seller, dealer}, subject_id,
  provider_id)`: `not_started → pending → approved | rejected | expired`.
- `evidence_ref` is a **private Storage path reference only** — never the documents, never PII.
- When `escrow_provider_config.kyc_kyb_required = true` (the default), `initiateProviderEscrow`
  **blocks funding** unless every required subject is `approved`. Any other state (including a
  missing row) fails closed with `kyc_kyb_not_approved`.
- KYC/KYB approval is a governed/manual outcome recorded by an authorized reviewer or the provider
  workflow — the platform never auto-approves.

---

## 4. Currency, limits, fees, settlement

Configured per `(provider_id, jurisdiction, currency)` in `escrow_provider_config`:

- **Currency** — an escrow request must match a configured currency row.
- **Transaction caps** — `min_amount_cents` / `max_amount_cents`. Amounts outside the range are
  rejected (`below_min_amount` / `cap_exceeded`) before any provider call.
- **Fee schedule** — `fee_schedule` JSONB (bps / flat / tiers). Non-secret model only.
- **Settlement terms** — `settlement_terms` JSONB (payout rail, settlement window, hold periods).

These are configuration inputs to a real integration; they do not by themselves move money.

---

## 5. Provider escrow lifecycle

`initiateProviderEscrow(sessionId, { providerKey, amountCents, currency })` runs, in order and all
fail-closed: **global + provider kill switch / capability → provider callable → active config →
transaction caps → currency → pilot allowlist → KYC/KYB → existing trust gates
(identity / publication / fraud / dealer / participant / documents / listing snapshot) → shared
provider framework call** (sandbox simulator until a live transport exists). On success it records
an immutable `funding` initiation event.

Lifecycle states (immutable transitions appended to `escrow_trust_events`):

```
funding ─▶ inspection ─▶ release ─▶ payout ─▶ reconciliation
   │            │           │
   ├─▶ dispute ─┴──▶ refund ─▶ reconciliation
   └─▶ cancellation (terminal)
```

Invalid transitions are rejected. A blocked initiation is recorded as a non-lifecycle audit marker,
so it never masquerades as an initiated escrow and can be retried after remediation.

---

## 6. Dual control (sensitive manual release / refund)

`requireDualControl(sessionId, action, approver1, approver2)` (`action ∈ {release, refund}`):

- **Rejects two identical approver ids** — enforced both in the service and by a schema-level
  `CHECK (approver_1_id <> approver_2_id)` on the append-only `escrow_dual_control_approvals`.
- Records the two-distinct-approver approval immutably, then performs the corresponding FSM
  transition. There is no single-actor path to release or refund funds.

---

## 7. Reconciliation

`runEscrowReconciliation(providerId, window)` compares external provider transactions against
internal escrow amounts:

- Every comparison is booked to the **append-only** `escrow_reconciliation_ledger`
  (`matched` true/false; idempotent per external transaction reference).
- Unmatched / mismatched rows are queued into `reconciliation_mismatches` (from the shared provider
  platform) under a `reconciliation_jobs` row, with `resolution = 'open'` for investigation.
- Mismatch types: `amount_mismatch`, `missing_internal`, `missing_external`. A window with no
  mismatches completes `succeeded`; otherwise `partial`.

---

## 8. Sandbox / live separation (honesty guarantee)

- **Only** a provider with `activation_mode = 'live'` represents **real money**. Every other mode
  (`sandbox`, `pilot_live`, …) is labelled **sandbox** and can never be represented as real money.
- Each initiation records `fund_label`, `is_real_money` and `sandbox` honestly from the provider
  mode. `escrow_provider_config.sandbox_live_separation` documents that separation is required.
- Because no provider is approved live, in practice **all** escrow is sandbox today. The label is
  computed from the provider mode, not from a caller-supplied flag.

---

## 9. Pilot allowlist

- `escrow_provider_config.pilot_allowlist` is a list of user/tenant ids permitted during a
  controlled pilot.
- An **empty** allowlist means "no pilot restriction". A **non-empty** allowlist requires every
  participant (buyer / seller / tenant) on the escrow to be listed; otherwise funding is blocked
  with `not_on_pilot_allowlist`. This bounds real-money exposure to an approved cohort.

---

## 10. Kill switch

Two layers, both of which **stop new escrow creation without corrupting existing history**:

- **Global** — `ESCROW_GLOBAL_KILL_SWITCH=1` (or the `escrow` capability flag off, or the platform
  emergency `CAPABILITY_KILL_SWITCH=1`) blocks all new escrow.
- **Per-provider** — `escrow_provider_config.kill_switch_enabled = true`
  (`setEscrowKillSwitch(configId, true)`) blocks new escrow for that provider and records an
  append-only audit line. Existing sessions, events, ledger and approvals are untouched.

---

## 11. Webhooks

`ingestEscrowProviderWebhook` is **signed (HMAC-SHA256) + replay-protected (5-min drift) +
idempotent** and **fail-closed on a missing secret** (production with no
`ESCROW_PROVIDER_WEBHOOK_SECRET` can never verify any signature). Every attempt — valid, invalid,
replayed or duplicate — is recorded append-only in `escrow_trust_webhook_events`.

---

## 12. Completion classification

**Classification: `sandbox_ready` / activation-blocked-on-external-approvals.**

Justification:

- **Code / schema / tests are complete and green.** The migration is marker-aware, additive and
  reversible (Up → Down → re-Up verified in isolation); money-history tables are append-only
  (UPDATE/DELETE blocked); dual control is enforced by CHECK and in code; the service and routes
  are fail-closed. Automated tests cover caps, pilot allowlist, KYC/KYB, trust-gate fail-closed,
  lifecycle FSM (valid + invalid), dual-control distinct approvers, webhook
  valid/invalid/replay/duplicate/missing-secret, reconciliation match + mismatch, kill switch, and
  the sandbox-never-real guarantee.
- **It is NOT production-live for real money**, and cannot be, until the following **external**
  prerequisites are satisfied and switched on by governance: an **approved regulated escrow
  provider**, **signed contracts**, completed **KYC/AML program**, agreed **settlement terms**,
  real **credentials** (referenced, not stored), a signed provider `activation_mode = 'live'`, and
  the production `escrow` capability flag enabled. None of these are invented here.

Until every one of those is true, this extension operates strictly in **sandbox** and **no real
funds move**.
