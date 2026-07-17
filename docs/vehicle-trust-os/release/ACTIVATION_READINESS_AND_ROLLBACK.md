# Full Activation — Activation-Readiness & Rollback Report

**Program:** Vehicle Trust OS Full Activation & Mobile Certification
**Branch / PR:** `plan/vehicle-trust-full-activation` → PR #114 → `main` · **Code SHA:** `87be672`
**Staging:** `eoyenigwevnxwwhyhaer`

## 1. Final status

> **VEHICLE TRUST OS FULL ACTIVATION ENGINEERING COMPLETE — STAGING GREEN; EXTERNAL PROVIDER ACTIVATIONS CLEARLY GATED**

All internally-controllable engineering for the shared provider control-plane and the five domain
workstreams is complete, tested, staging-applied and honest-by-construction. Everything that
remains is an **external, named activation gate** (a signed contract, an issued credential, a legal
approval, or physical certification hardware) — never bypassed by a simulator, and never labelled
as official/live.

## 2. Per-provider classification

Each provider is exactly one of the goal's five states.

| Provider | Capability | Classification | Specific external gate(s) |
|---|---|---|---|
| **ZIMRA** | government_source | `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED` | signed ZIMRA data-sharing agreement → then credential + live transport |
| **CVR** | government_source | `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED` | signed CVR agreement → credential + live transport |
| **ZINARA** | government_source | `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED` | signed ZINARA agreement → credential + live transport |
| **VID** | government_source | `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED` | signed VID agreement → credential + live transport |
| **CID** | government_source | `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED` | signed CID (stolen-vehicle) agreement → credential + live transport |
| **Licensed insurer** | insurance | `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED` | signed insurer contract → `INSURANCE_WEBHOOK_SECRET` + credential |
| **Regulated lender** | finance | `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED` | signed lender contract → credential + approved live credit endpoint |
| **Real-money escrow** | escrow | `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED` | approved regulated escrow provider + signed contract + completed KYC/AML + settlement terms + credential |

**Mobile native offline certification** (not a provider): **ENGINEERING COMPLETE — PHYSICAL DEVICE
& iOS SIGNING GATE.** Harness, capture-admission gate, append-only results ledger and runner script
are complete and green in logic/store/migration; the only outstanding item is execution on physical
Android + iOS hardware with an Apple signing identity (external hardware gate, no contract/credential).

**P0/P1 internal defects: 0.** No provider is `INCOMPLETE_SPECIFIC_DEFECT`.

## 3. Why no provider is LIVE or PILOT_READY yet

`live`/`pilot_live` are refused by the platform unless `contract_status='signed'` **and** a
`credential_ref` is set, and the live transport is a stub that returns `unavailable` /
`credential_pending` until a real endpoint is wired. No external contract exists for any provider,
so each honestly sits in `sandbox`/`not_configured` and cannot be promoted by code alone. This is
the intended fail-closed posture, not a defect.

## 4. Activation procedure (per provider, when the external gate clears)

1. `POST /api/admin/providers` — register (or confirm) the provider (fail-closed).
2. Record the signed contract: set `contract_status='signed'` + `credential_ref` (a vault/env key
   **name**, never a secret value).
3. Provision the real secret **outside** the database (env/vault) under the referenced name.
4. `PATCH /api/admin/providers/:id/activation` → `pilot_live` (limited pilot) or `live`.
5. `PATCH /api/admin/providers/:id/kill-switch` → `{ enabled: false }`.
6. Wire the live transport (replace the stub), confirm a signed test webhook verifies, then
   monitor `GET /api/admin/providers/:id/health` and schedule reconciliation.

Full detail per provider in `providers/*_DOSSIER.md` and `providers/*_ACTIVATION_PACKAGE.md`.

## 5. Kill switches

- **Per-provider:** `PATCH /api/admin/providers/:id/kill-switch {enabled:true}` (and the escrow
  config kill switch `PATCH /api/escrow/provider/config/:configId/kill-switch`) block all new calls
  immediately; append-only history is untouched. (Journey step 14 proves this.)
- **Global:** production is fail-closed by default — capabilities stay OFF unless `CAPABILITIES_LIVE=1`.
  The emergency `CAPABILITY_KILL_SWITCH=1` / `ESCROW_GLOBAL_KILL_SWITCH` halts every capability at
  once without corrupting append-only history.

## 6. Rollback plan

**Nothing in this cycle touches production.** All changes are on staging + the PR branch. If a
rollback is required after any future production cutover:

1. **Feature-level (instant, no deploy):** set the global kill switch / unset `CAPABILITIES_LIVE`,
   or flip the per-provider kill switch. New calls stop; history is preserved.
2. **Schema-level (if ever needed):** each of the seven migrations has a tested `-- +migrate Down`
   (PGlite Down pass = 23/23). Because every table is additive and every ledger is append-only,
   rollback drops the new tables in reverse dependency order and **mutates no existing production
   data**. Order: `20260703190000` → `170000` → `160000` → `150000` → `140000` → `130000` →
   `120000`.
3. **Storage:** the five private buckets are additive; removing them affects no existing bucket.

## 7. External gates summary (nothing invented)

No endpoint, contract, credential, legal approval, or live result was fabricated. Every "live"
path is a stub until a real transport is wired, and every sandbox/simulated result is stamped
`SIMULATED` / `mode='sandbox'` and can never be relabelled official. Outstanding external gates:
signed government data-sharing agreements (×5), signed insurer/lender/escrow contracts, issued
credentials + webhook secrets (provisioned outside the DB), a regulated escrow provider with
completed KYC/AML + settlement terms, and physical Android/iOS certification hardware + Apple
signing identity.
