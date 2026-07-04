# Diaspora migration rollbacks — classification & scripts

Per the Final Completion plan (§E), every diaspora migration **without** a usable `-- +migrate Down`
block is classified here, with a versioned script where a safe one is possible. Migrations **with**
Down blocks are rolled back via `npm run migrate:rollback` (`backend/db/migrate.js`, transactional)
and are not duplicated here.

> **HONESTY NOTE — NOT REHEARSED.** None of these scripts have been rehearsed against staging: the
> Supabase MCP connector available to this program cannot reach `carup-staging`
> (`eoyenigwevnxwwhyhaer`) — external blocker **EB-1**. Every script below has had static review
> only. **Rehearse on staging (or an approved isolated branch) before any production use.** Never
> claim rehearsal where only static review occurred.

| Migration | Classification | Script | Data-loss risk | Notes |
|---|---|---|---|---|
| `014_diaspora_rls_recursion_fix.sql` | **Forward-fix only (do not roll back)** | `verify_014_diaspora_rls_recursion_fix.sql` | None (verification only) | The pre-014 policies caused RLS recursion — restoring them reintroduces a known defect. If 014 misbehaves, fix forward. |
| `20260611061849_diaspora_trade_os_phase1b_foundation.sql` | **Reversible SQL — TOTAL DATA LOSS** | `rollback_20260611061849_phase1b_foundation.sql` | **TOTAL** for 9 tables (workbook batches/rows, supply docs, stock items/ledger, order docs, AI commands, Drive connections/files) | Guarded: the script refuses to run until the safety latch is edited. Take a backup first; capture before-counts. |
| `20260619201406_production_access_containment.sql` | **Feature-disable + backup restore (security-weakening rollback)** | `verify_20260619201406_production_access_containment.sql` | None (verification only) | Rolling back would RE-GRANT anon/authenticated access to 11 launch tables. Do not script that; restore from backup if truly required. |
| `20260620232827_issue77_access_containment_followup.sql` | **Feature-disable + backup restore (security-weakening rollback)** | `verify_20260620232827_issue77_followup.sql` | None (verification only) | Rolling back would unpin `search_path` and widen grants on 2 authz helpers. |
| `20260621094000_diaspora_h7_rpc_execute_grants.sql` | **Feature-disable + backup restore (security-weakening rollback)** | `verify_20260621094000_h7_rpc_grants.sql` | None (verification only) | Rolling back would re-expose the H1/H2/H3 atomic RPCs to anon/authenticated EXECUTE. Deliberately no destructive script. |

## Procedure (any rollback)

1. Run the script's **BEFORE** verification queries; save the output.
2. Take a point-in-time backup / confirm the latest snapshot restores.
3. Apply the rollback (only where a destructive script exists AND its latch is deliberately edited).
4. Run the **AFTER** verification queries; diff against expected.
5. Record the action in `docs/DIASPORA_TRADE_OS_MIGRATION_LEDGER.md` and the rollback runbook.

## Down-block spot-check (migrations that DO have Down)

Statically re-verified (this loop) that the `-- +migrate Down` blocks of the three newest ledger
entries reverse their Up DDL: `20260621131000_diaspora_phase9_safetrade_disputes.sql`,
`20260621140000_diaspora_phase10_trade_graph.sql`, and
`20260704090000_diaspora_payment_milestone_idempotency.sql` (drops the partial unique index, then
the column — correct order, no data destroyed beyond the additive column itself).
