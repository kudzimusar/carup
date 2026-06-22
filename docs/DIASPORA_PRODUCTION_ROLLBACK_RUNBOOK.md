# Diaspora Production Rollback Runbook

> Prepared in advance. Use only with the same release authorization as the release runbook.
> Principle: **fail closed**. Disabling a feature flag is always preferred over a data rollback;
> reach for migration rollback only when a flag cannot contain the fault.

## Severity → response

| Situation | First action | Escalation |
| --- | --- | --- |
| New feature misbehaving (XLSX, SafeTrade sandbox, graph, AI insights) | Turn its **feature flag OFF** (no deploy needed if flag is env-driven and hot-read) | If flag insufficient, redeploy previous build |
| Quota/entitlement enforcement wrong (lockouts) | Set `DIASPORA_SUBSCRIPTION_ENFORCEMENT` to monitor/off | Hotfix entitlement resolution; redeploy |
| Webhook/reconciliation failures (billing/payment) | Disable provider flag; let idempotent retries drain; do NOT release any funds | Manual reconciliation; legal if money involved |
| Migration caused breakage | Apply documented down/remediation migration | Restore from pre-release backup (last resort) |
| Security incident (token/credential leak, RLS bypass) | Disable affected provider/flag; rotate affected secret; revoke tokens | Follow CR-1 incident procedure; notify owner |

## Step-by-step deploy rollback
1. Identify the last known-good deployment (Vercel `carup`, `carup-backend`) and promote it.
2. Confirm health (auth, tenant isolation smoke).
3. Re-disable any feature flags enabled in the bad release.

## Step-by-step migration rollback
1. **Stop writes** to affected tables (disable owning feature flag).
2. Apply the migration's `-- +migrate Down` / remediation block (all program migrations ship one;
   note: some security migrations intentionally do not restore prior broad grants — read the Down
   note before running).
3. Run reconciliation queries to confirm consistent state.
4. If schema/data cannot be safely reversed, **restore from the pre-release backup** taken in
   release runbook Part B step 1, then re-apply only verified migrations.
5. Run Supabase advisors; confirm no high-severity regression.

## Money/escrow safety (Phase 9)
Never auto-release, auto-refund, or auto-capture during rollback. All payment state stays held;
resolve via the dispute/manual-review path. Real-money actions remain disabled unless EB-4 active.

## Trade Graph projection (Phase 10) rollback
The graph is **derived and rebuildable**, so rollback is low-risk:
1. **Disable first:** set `DIASPORA_TRADE_GRAPH` OFF — the gate is scoped to `/trade-graph`, so sibling
   diaspora routes are unaffected (proven by the route-isolation regression). This is the primary action.
2. If projections diverged or a bad event poisoned data, **rebuild** the tenant graph
   (`rebuildTenantGraph`, admin-only) — it re-derives from authoritative tables/events; no domain data
   is at risk because the graph is never a source of truth.
3. Inspect `trade_graph_dead_letters` for un-projected events; replay via `projectPendingEvents` after
   the fault is resolved. Per-event SAVEPOINT isolation means one bad event never blocks the batch.
4. If the migration itself must be reversed, apply its `-- +migrate Down` (drops the 7 graph tables +
   RPCs); no authoritative data is affected.

## Data integrity invariants to re-check after any rollback
- Stock ledger immutability (no deletes; balances reconcile).
- Quota reservations released, not orphaned.
- SafeTrade transactions in a valid state; no released funds without held payment + passed policy.
- Graph projections rebuildable from `domain_events` (run rebuild if projections diverged).
- Audit chain intact (critical-audit rows present for every critical transition).

## Evidence
Record in the progress ledger: trigger, action taken, flags toggled, migrations reversed, backup
restored (y/n), reconciliation result, residual risk, follow-up items.
