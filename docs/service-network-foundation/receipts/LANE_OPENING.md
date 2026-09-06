# Service Network Foundation 1.0 — Implementation Lane Opening

- **Programme:** CarUp Service Network Foundation 1.0
- **Canonical plan:** `docs/service-network-foundation/CARUP_SERVICE_NETWORK_FOUNDATION_1_0_CANONICAL_PLAN.md`
  (arrives on `main` via PR #196 — deliberately NOT duplicated on this branch to avoid an add/add conflict at rebase time)
- **Branch:** `feat/service-network-foundation-1-0`
- **Branch base (canonical `main` at creation):** `ba208963d863654157335189c60f587cbe330041`
- **Lane opened:** 2026-08-29
- **Workspace:** isolated fresh clone, fully separate from the PR #194 reconciliation workspace

## One-PR rule

This branch and its Draft PR are the **single implementation lane** for the entire
Foundation 1.0 programme. All phases S0 → S10 proceed sequentially on this branch.
No per-phase PRs. Each phase ends with tests plus a receipt committed under
`docs/service-network-foundation/receipts/`.

## Implementation freeze (in force)

PR #194 (`integration/vehicle-passport-v16-cert`, head `24422686` at lane opening) is
still under reconciliation and carries contracts Service Network depends on
(Communications, Intelligence, Vehicle Passport, Marketplace, trust/lifecycle
foundations). Until #194 or its approved successor is merged into `main`:

- **no** Service Case migration, canonical service tables, work-order authority
  changes, RLS changes, Trust changes, Passport/Communications/Intelligence
  authority changes, production migrations, provider activation, or production writes;
- **allowed:** preparation, read-only inspection of #194, contract mapping,
  environment setup, baseline test establishment, documentation.

PR #194 is a **read-only dependency reference**. It must never be merged,
cherry-picked, or copied into this branch. Its contracts arrive only through
`PR #194 → main → rebase of this branch`.

## Resume protocol when #194 lands

1. Fetch new canonical `main`; record its exact SHA.
2. Rebase `feat/service-network-foundation-1-0` onto it.
3. Re-run S0 reconciliation against merged truth; reconcile Pre-S0 findings.
4. Proceed S1 → S10 sequentially on this same branch/PR per the canonical plan's
   automatic-continuation rule (§29), stopping only for §30 manual-stop conditions.
5. Mark the PR ready only after all S0–S10 gates and exact-head certification.
