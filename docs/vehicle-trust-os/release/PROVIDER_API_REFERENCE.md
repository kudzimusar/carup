# Full Activation — Provider API Reference (contract update)

New endpoints introduced this cycle. All are **internal** (admin/government operators, the
authenticated app owner surface, or signed provider webhooks) — **not** part of the public
`partner-api-openapi.json` external contract. Every admin/government route is guarded by
`authorizeRole(['admin','government'])`; owner routes are scoped to the vehicle owner; webhooks
are HMAC-signed with replay + idempotency protection and fail closed in production.

## Provider control-plane (admin/government) — `providerPlatformRoutes`

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/providers` | list providers + the 11 activation modes |
| POST | `/api/admin/providers` | register a provider (fail-closed; rejects secret-looking `credential_ref`) |
| PATCH | `/api/admin/providers/:id/activation` | change activation mode (live/pilot_live require signed contract + credential_ref) |
| PATCH | `/api/admin/providers/:id/kill-switch` | flip the per-provider kill switch (append-only history) |
| GET | `/api/admin/providers/:id/health` | health + incident + activation state |
| POST | `/api/admin/providers/:id/health-check` | record a health probe |
| POST | `/api/admin/providers/:id/incidents` | open an incident |
| GET | `/api/admin/providers/:id/reconciliation/mismatches` | list open reconciliation mismatches |
| PATCH | `/api/admin/reconciliation/mismatches/:id` | resolve a mismatch (investigating → resolved/written_off) |

## Government sources (admin/government) — `governmentActivationRoutes`

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/gov/sources/:sourceKey/check` | run a governed source verification (ZIMRA/CVR/ZINARA/VID/CID) |
| POST | `/api/gov/sources/:sourceKey/batch-import` | record a signed batch-file import (Storage path only) |
| GET | `/api/gov/sources/imports` | list batch imports |
| GET | `/api/gov/sources/health` | per-source health + callability |
| GET | `/api/gov/sources/errors` | non-clean government attempts |
| PATCH | `/api/gov/sources/:sourceKey/suspend` | administratively suspend a source |
| PATCH | `/api/gov/sources/:sourceKey/emergency-disable` | kill switch on + mode → suspended |

## Insurer — `insurerRoutes`

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/vehicles/:vin/insurer/consent` | owner records insurer consent (scoped) |
| POST | `/api/vehicles/:vin/insurer/eligibility` | request insurer eligibility (consent + gates required) |
| GET | `/api/vehicles/:vin/insurer/eligibility` | current insurer status (coarse) |
| POST | `/api/insurer/webhook` | signed insurer decision webhook |
| POST | `/api/admin/insurer/providers` | onboard an insurer profile |
| GET | `/api/admin/insurer/providers` | insurer provider-health board |
| GET | `/api/admin/insurer/vehicles/:vin/decisions` | append-only decision history |

## Lender (finance) — `lenderRoutes`

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/vehicles/:vin/finance/consent` | applicant records finance consent |
| POST | `/api/vehicles/:vin/finance/lender/eligibility` | request lender eligibility (consent + gates required) |
| GET | `/api/vehicles/:vin/finance/lender/status` | current lender status |
| POST | `/api/vehicles/:vin/finance/consent/:id/deletion` | applicant deletion/retention request |
| GET | `/api/vehicles/:vin/finance/availability` | coarse public finance availability |
| POST | `/api/finance/lender/webhook` | signed lender decision webhook |
| GET | `/api/admin/finance/lender/decisions` | append-only decision ledger |

## Real-money escrow — `escrowProviderRoutes`

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/escrow/:id/provider/initiate` | initiate a provider-test escrow (caps/KYC/pilot/trust gated) |
| PATCH | `/api/escrow/:id/provider/transition` | advance the provider escrow FSM |
| POST | `/api/escrow/:id/provider/dual-control` | two-distinct-approver release/refund |
| POST | `/api/escrow/provider/webhook` | signed escrow settlement webhook |
| GET | `/api/escrow/provider/:providerId/reconciliation` | reconciliation ledger/mismatches |
| POST | `/api/escrow/provider/:providerId/reconciliation/run` | run a reconciliation window |
| PATCH | `/api/escrow/provider/config/:configId/kill-switch` | escrow-config kill switch |

## Mobile certification (admin/government) — `mobileCertificationRoutes`

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/mobile-certification/matrix` | read-only device-certification matrix (append-only ledger) |

### Common guarantees
- **No secrets in transit or at rest** in the API surface — only credential *references*.
- **Honesty labels** — every result carries its `activation_mode`; sandbox/simulated results are
  never presented as official/live.
- **Fail-closed** — kill switch / non-callable mode / missing capability flag → `unavailable`.
- **Append-only** — decisions, money ledgers, activation history and request attempts are immutable
  at the DB layer (`governance_block_mutation`).
