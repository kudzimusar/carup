# Diaspora Trade OS — Phases 3–7 Staging Migration & Validation Plan (H7)

> **STOP gate:** migrations in this plan are **prepared but NOT applied**. Applying them to staging
> requires explicit user authorization. Production is out of scope and forbidden.
>
> - **Authorized staging project (apply only when authorized):** `eoyenigwevnxwwhyhaer`
> - **Forbidden production project:** `vhmnajoeicasaigiophh`

## Migration set (additive, backwards-compatible)

Apply in this order to the authorized staging database only:

1. `database/migrations/20260620120000_diaspora_phase3_stock_ledger_idempotency.sql`
   — `idempotency_key` column + partial unique index on `diaspora_stock_ledger`.
2. `database/migrations/20260621090000_diaspora_h1_stock_movement_rpc.sql`
   — `diaspora_append_stock_movement_atomic(...)`.
3. `database/migrations/20260621091000_diaspora_h2_quote_acceptance_rpc.sql`
   — `diaspora_accept_quote_atomic(...)`.
4. `database/migrations/20260621092000_diaspora_h3_container_approval_rpc.sql`
   — `diaspora_approve_cargo_reservation_atomic(...)`.
5. `database/migrations/20260621093000_diaspora_h6_oauth_state_nonce.sql`
   — `diaspora_oauth_states` table + indexes + RLS.

All depend on the Phase 1B foundation tables (already present in staging) and `pgcrypto` (already
enabled). The RPCs are `SECURITY INVOKER` with a fixed `search_path` and `EXECUTE` granted to
`service_role` only.

## Pre-apply steps (no mutation)

1. `list_migrations` / inspect `database/migrations/` vs the staging migration history.
2. Inspect the relevant tables/columns: `diaspora_stock_items`, `diaspora_stock_ledger`,
   `diaspora_import_orders`, `diaspora_import_quotes`, `diaspora_container_shipments`,
   `diaspora_cargo_reservations`, `diaspora_import_audit_log`.
3. Confirm none of the new function names / `diaspora_oauth_states` already exist (idempotent
   `CREATE OR REPLACE` / `IF NOT EXISTS` make re-runs safe regardless).
4. Snapshot schema metadata (function list, table list) for rollback reference.
5. **Request explicit staging authorization before applying.**

## Apply steps (authorized staging only)

1. Apply migrations 1→5 in order (Supabase MCP `apply_migration` or the project's `scripts/` runner,
   pointed at the **staging** connection string).
2. Run `get_advisors` (security) and review — expect no new ERROR-level findings introduced by these
   additive objects; note the `service_role`-only grants and `SECURITY INVOKER`.
3. Run `get_advisors` (performance) and review the new indexes
   (`idx_diaspora_stock_ledger_idempotency`, `idx_diaspora_oauth_states_*`).
4. Run the gated staging integration suite (below).
5. Record the applied migration versions, advisor results, and integration run IDs in the hardening
   report.

## Gated staging integration suite

`backend/tests/staging/diaspora-staging-integration.test.js` — **skipped by default**. Enable with:

```bash
RUN_DIASPORA_STAGING_INTEGRATION=true \
DATABASE_URL=postgresql://…@db.eoyenigwevnxwwhyhaer.supabase.co:5432/postgres \
node --test backend/tests/staging/diaspora-staging-integration.test.js
```

It refuses to run if the connection string targets the forbidden production project. It uses a unique
`run prefix` for all test records and cleans them up. It proves, against the real database:

- the three atomic RPCs and `diaspora_oauth_states` exist;
- concurrent stock reservations cannot over-reserve (row-lock serialization);
- concurrent acceptance of two different quotes yields exactly one accepted quote;
- concurrent container approvals near capacity cannot overfill;
- a partial-failure movement leaves no ledger row (transactional rollback);
- audit rows are written in the same transaction.

## Rollback / remediation

Each migration has a `-- +migrate Down` section. Drops are safe and additive:

- drop the RPC functions;
- drop `diaspora_oauth_states`;
- drop the `idempotency_key` column + indexes.

Stock balances live on `diaspora_stock_items` + immutable ledger rows; dropping the additive objects
does not lose balance data. Re-apply is idempotent.

## Status

- Migrations applied to staging: **NO**.
- Production touched: **NO**.

### BLOCKED — authorized staging project not reachable (2026-06-21)

Staging apply was authorized for `eoyenigwevnxwwhyhaer`, but the connected Supabase MCP integration
**cannot access that project**:

- `get_project('eoyenigwevnxwwhyhaer')` → `permission denied`.
- `list_projects` returns exactly one project: `sfhtlzcgrnrdznhvdrbn` (name **"production-os"**),
  which is **neither** the authorized staging (`eoyenigwevnxwwhyhaer`) **nor** the named forbidden
  production (`vhmnajoeicasaigiophh`).

No migration was applied. The only reachable project is named "production-os" and was **not**
authorized, so it must not be touched. To proceed, one of the following is required:

1. Connect/grant the Supabase integration to the org/project containing `eoyenigwevnxwwhyhaer`, or
2. Provide a staging `DATABASE_URL` for `eoyenigwevnxwwhyhaer` so the gated pg-based suite can run, or
3. Confirm the correct staging project ref (if `eoyenigwevnxwwhyhaer` is wrong).

Until then, H7-apply / H9 staging smoke remain blocked; all code-side gates are complete and green.
