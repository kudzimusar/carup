# CARUP-DEALER-ONB-001-LR01-R4 — integration, rollback and release gates

**Status: engineering candidate on Draft PR #258. DO NOT MERGE, DEPLOY, PUBLISH REAL DEALERS OR ACTIVATE PAYMENTS.**
This document is a proposal for the Owner and Moderator. Nothing in it has been executed against a shared, staging or production system.

## 1. Lineage

| Item | Value |
|---|---|
| Frozen main parent | `bb9d9900c700873ca57df0ac18a1a5c01f77711a` |
| R3 Moderator-verified head | `1c7943094c21ad3bbdb339641f0282d0335757d1` |
| R4 commits | `d8be4706` … final head (see the PR head and `R4_67_CASE_EVIDENCE_REGISTER.md`) |
| Counterpart lanes | PAY-03B Draft PR #251 (stacked on #250) and PAY-05 Draft PR #254 — **not** merged into this branch; the dealer commercial read only *reads* PAY-03B tables when they already exist |

Before any integration, confirm `git merge-base --is-ancestor bb9d9900 <head>` and that `main` has not moved in a way that conflicts with the files listed in the PR. Rebase is an Owner decision; this branch has never been rebased.

## 2. Database changes (19 additive migrations)

`20261103120000` … `20261103140000` (R1–R3, 17 migrations) plus two R4 migrations:

| Migration | Adds | Touches canonical tables? | Rollback guard |
|---|---|---|---|
| `20261103141000_dealer_canonical_listing_authority` | listing authority events, VIN↔branch assignment, `dealer_tenant_listing_authority_current`, preparation function, storefront VIN function | **Yes — triggers on `vehicles`, `vehicle_evidence`, `marketplace_inquiries`, `tenants`, `dealer_profiles`, `dealer_approved_seed_links`.** Each trigger returns immediately for tenants without a `dealer_approved_seed_links` row (every existing tenant). | Refuses while listing custody exists |
| `20261103142000_dealer_operating_lifecycle` | append-only lifecycle events, `dealer_record_operating_lifecycle_decision` | No (dealership tables only) | Refuses while lifecycle custody exists |

**Production-impact review required before any apply:** the `20261103141000` triggers run on every write to `vehicles` / `vehicle_evidence` / `marketplace_inquiries` / `tenants`. Their cost for a non-programme tenant is one lookup on the tiny `dealer_approved_seed_links` table (compared as text so legacy non-UUID tenant ids cannot raise). This needs an independent DBA review and an EXPLAIN on staging before approval.

### Forward plan (only after separate authorization)
1. Staging snapshot / PITR marker recorded.
2. Apply the 19 migrations in filename order through the governed migration runner (never the dashboard SQL editor).
3. Run `database/test/dealer_1_0_pglite_check.mjs` semantics against a **staging clone**, not staging itself.
4. Verify zero `dealer_*` business rows exist after apply (the migrations seed only the DRAFT ZW policy row).

### Rollback plan
1. Down migrations run in **reverse** order. Every custody-bearing migration refuses to roll back while its append-only rows exist (`CANNOT_ROLLBACK_WITH_*`): this is deliberate — audit history must not be destroyed by a rollback.
2. If custody exists, the rollback is a **forward fix** (disable the dealer routes by removing the router mount, keep the tables), not a destructive down.
3. The R4 triggers can be dropped independently (`DROP TRIGGER … ON vehicles` etc.) without touching data; that is the emergency kill-switch for canonical-table impact.

## 3. Release gates that remain closed (external — the branch cannot open them)

| Gate | Status | Exact prerequisite |
|---|---|---|
| Marketplace Reference Regression | `BLOCKED_ENVIRONMENT_AUTHORITY` | The workflow requires a governed staging preview pair for `feat/carup-dealer-1-0-unified-longrun` in `web/preview-backend-pairing.json` and `web/preview-frontend-pairing.json`. Prerequisite: Owner authorization for an exact-SHA staging preview deployment of this branch's backend and frontend (cached CLI from a clean worktree, web pinned to the immutable backend host via `VITE_API_URL`), then a commit registering the two stable aliases. The guard must not be weakened or another programme's pair borrowed. |
| Real Zimbabwe legal policy | `BLOCKED_EXTERNAL_AUTHORITY` | An approved `dealer_country_legal_policy_authority` row signed off by a legal owner outside the dealer API. Only the DRAFT row exists. |
| Publication of the 104 real researched dealers | `BLOCKED_EXTERNAL_AUTHORITY` | Human source-eligibility review per record. The Owner-original source is imported only privately and locally (0 published). |
| Logo / OEM / franchise rights | `BLOCKED_EXTERNAL_AUTHORITY` | Rights review; until then the generic placeholder is shown. |
| Dealer subscriptions, invoices, entitlements | `BLOCKED_EXTERNAL_AUTHORITY` | PAY-03B (#251) and PAY-05 (#254) acceptance and merge; explicit tariffs; a governed decision on the tenant role used for billing (PAY-03B billing authority is `admin`/`administrator`/`tenant_admin`; the activated dealer owner is tenant role `dealer`). No price, plan or provider is invented here. |
| Real Paynow / live money | `BLOCKED_EXTERNAL_AUTHORITY` | Owner live authorization; PAY-05 is a **garage-owned** beneficiary and is never CarUp dealer billing. |
| Twelve consenting real dealer pilots | `BLOCKED_EXTERNAL_AUTHORITY` | Real participants and consent. Twelve synthetic scenarios run separately and are labelled synthetic. |
| Independent certification | Not started | A certifier other than the implementing agent. |

## 4. Proposed integration sequence (for Owner assignment)

1. Moderator certification of this Draft at its exact head (register + physical runs).
2. Owner decisions: legal policy owner, billing tenant role, publication policy for the 104 researched records, staging preview authorization.
3. Staging preview pair → Marketplace Reference Regression green on the exact head.
4. Staging-clone migration rehearsal (forward, custody-refusing rollback, trigger kill-switch).
5. Only then a merge decision; production remains a separate authorization.
