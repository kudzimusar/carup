# PREEXISTING_USERS_TABLE_WRITE_PRIVILEGE_REVIEW_REQUIRED

**Status: OPEN — separate security follow-up. Deliberately NOT remediated inside Email 1.0 (PR #183).**
Recorded 2026-08-27 during the Email 1.0 reconciliation-queue closure, after a Codex review observed
that column-level revokes on `public.users` are ineffective against table-level grants.

## Live evidence (canonical staging, read-only)

`information_schema.role_table_grants`:

| grantee | table | privileges held |
|---|---|---|
| `anon` | `public.users` | **UPDATE, INSERT, DELETE**, SELECT |
| `authenticated` | `public.users` | **UPDATE, INSERT, DELETE**, SELECT |
| `authenticated` | `public.vehicles` | SELECT only |

PostgreSQL privileges are additive: while these table-level grants stand, no column-level
`REVOKE` can make any `users` column service-only.

## Why this is not currently a live exploit

Also measured on staging:

- `public.users` has **RLS ENABLED** (`pg_class.relrowsecurity = true`)
- with **ZERO policies** (`pg_policies` count = 0, client UPDATE/ALL policies = 0).

RLS-enabled with no policies is **default-deny** for every role subject to RLS. `anon` and
`authenticated` are subject to RLS (only `service_role` carries BYPASSRLS), so their write grants
pass the privilege check and then match no rows. As of this measurement a client cannot in fact
rewrite `email_verified_at` or any other `users` column.

## Why it still needs review

The posture is one `CREATE POLICY` away from being live. Any future feature that adds a permissive
policy on `public.users` for client roles — even a narrowly-intended one — re-arms the full
UPDATE/INSERT/DELETE grant behind it. Grants this broad on the account-authority table violate the
posture this repository already enforces elsewhere (`20260814090000_issue101_p0_rls_and_view_hardening.sql`
revokes table-by-table and the `db-anon-grant-posture` gate holds the line for `vehicles`).

## Why Email 1.0 does not fold the fix in

Revoking table-level write on `users` and re-granting safe columns is an account-security migration
with its own regression surface (every legitimate client write path to `users` must be inventoried
first). Doing that inside an Email PR would couple two unrelated risk domains. Email 1.0 instead
**removed its dependency** on `users` privileges entirely: reconciliation state lives in
`communication_reconciliation_work`, a service-only table (RLS forced, all client privileges
revoked, proven against real PostgreSQL by
`database/test/email_reconciliation_privilege_check.mjs`).

## Recommended follow-up (separate programme)

1. Inventory client write paths to `public.users` (expected: none — the backend writes as service_role).
2. `REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;` in a dedicated migration.
3. Extend `db-anon-grant-posture.test.js` to pin the `users` write posture the way it pins `vehicles` SELECT.
4. Sweep for other public tables with client write grants shielded only by policy-less RLS.
