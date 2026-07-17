# Real-Postgres proofs — atomicity, idempotency, and Phase 8/9 ACL boundaries

Two standalone real-Postgres harnesses (neither part of CI `node --test`; both need
`embedded-postgres` + `pg`, installed via this dir's `package.json`):

- **`reservation-idempotency-realpg.mjs`** — atomic `FOR UPDATE` reservation-approval concurrency +
  migration #16 idempotency (documented below).
- **`phase8-9-acl-realpg.mjs`** — the Phase 8/9 **mutation-boundary hardening** proof. Creates the real
  `anon`/`authenticated`/`service_role` roles (service_role with `BYPASSRLS`, as Supabase configures
  it) + the real `diaspora_trade_os_*` helper functions, applies the hardened RLS policies + grants,
  and proves the negative cases as the actual Postgres roles. **Captured result (2026-07-18): 16/16.**
  ```
  P8: tenant member CAN SELECT own-tenant subscription
  P8: cross-tenant member SELECT returns 0 rows (RLS)
  P8: tenant member CANNOT INSERT a subscription (42501)
  P8: tenant member CANNOT UPDATE plan_key/status (42501)
  P8: tenant member CANNOT create an entitlement override (42501)
  P8/anon+authenticated CANNOT execute the usage-mutation RPC (42501)
  P9: participant CAN SELECT an allowed SafeTrade transaction
  P9: participant CANNOT set transaction status RELEASED / milestone status (42501)
  P9: participant CANNOT forge an eligible=true release evaluation (42501)
  P9: participant CANNOT set dispute status/fraud_hold (42501)
  P9: cross-tenant SELECT returns 0 (RLS)
  service_role CAN write the money table + execute the RPC (backend path)
  ════ PHASE 8/9 ACL PROOF: 16/16 passed ════
  ```

---

# Real-Postgres proof — atomic reservation approval + migration idempotency

`reservation-idempotency-realpg.mjs` boots a **real embedded Postgres** (not the in-memory JS mock
used by the standard suites) and applies the **actual migration SQL verbatim** to prove the two
claims that genuinely need real Postgres semantics — `SELECT … FOR UPDATE` row-locking and unique-index
enforcement — since `carup-staging` is unreachable this loop (EB-1: the Supabase MCP connector is
disconnected; `ToolSearch mcp__claude_ai_Supabase__list_projects` → "No matching deferred tools found").

It is a **standalone script, not part of the default CI `node --test` run** (it needs the
`embedded-postgres` package, deliberately NOT added to the repo's dependencies so CI install stays
lean). Run it locally to reproduce:

```bash
cd backend/tests/realpg
npm init -y && npm install embedded-postgres pg
node reservation-idempotency-realpg.mjs
```

## Captured result (2026-07-04) — 10/10 against real Postgres 18.4

```
PASS  real Postgres booted (embedded, not a mock) — server_version=18.4
PASS  H3 atomic RPC loads on real Postgres (plpgsql + pinned search_path) — proconfig=["search_path=public, pg_temp"]
PASS  migration #16 applies on real Postgres (partial unique index created) — partial predicate present
PASS  concurrent approval B BLOCKS on the container row lock while A is open (FOR UPDATE serializes)
PASS  second concurrent approval REJECTED with OVERFILL (cannot both pass an old snapshot) — DIASPORA_CONTAINER/OVERFILL: projected 60.000 total 50
PASS  end state: exactly 1 approved, container used=30 ≤ 50 (no overfill committed) — approved=1 used=30
PASS  exactly 1 in-transaction audit row (rolled-back approval left no audit) — audit rows=1
PASS  duplicate (import_order_id, idempotency_key) rejected by real unique index (23505) — pg code=23505
PASS  multiple NULL idempotency_key rows coexist (partial index does not constrain NULLs) — null-key rows=2
PASS  grant introspection runs on real PG; PUBLIC has no EXECUTE on the atomic RPC (REVOKE applied) — grantees=postgres
════ REAL-POSTGRES PROOF: 10/10 passed ════
```

## What this proves vs. what remains EB-1-blocked

**Proven on real Postgres** (upgrades the JS-mock evidence): `diaspora_approve_cargo_reservation_atomic`
loads as real PL/pgSQL with a pinned `search_path`; two **overlapping** transactions serialize on the
container's `FOR UPDATE` lock so a concurrent pair that would overfill is rejected (`OVERFILL`) with
exactly one approval committing and one in-transaction audit row; migration #16's partial unique index
enforces real `23505` de-duplication on `(import_order_id, idempotency_key)` while permitting multiple
NULL keys; and the RPC's `REVOKE … FROM PUBLIC` holds.

**Still requires the actual `carup-staging` instance (EB-1, release owner):** applying migration #16 to
staging itself, running Supabase security/performance **advisors**, verifying the **full** RLS policy
set + grants + storage policies against production-shaped data, and rehearsing the documented rollback
scripts. A local embedded Postgres proves the SQL/locking **logic** is correct; it is not the staging
database and does not substitute for the staging apply + advisor sweep.
