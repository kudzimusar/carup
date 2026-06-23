# Staging Migration Handoff — Full-Completion (F/G) migrations

> **STATUS: ✅ APPLIED + VERIFIED IN STAGING (`eoyenigwevnxwwhyhaer`) by the release engineer.**
> Both Full-Completion migrations are applied and verified in staging; production remains
> untouched. The agent did not (and cannot) reach the staging Supabase project — application
> and verification were performed out-of-band by the release engineer, who confirmed:
> - `rollout_percentage` is `SMALLINT NOT NULL DEFAULT 100`; percentage CHECK is `0–100`;
>   `rollout_seed` length constraint exists; existing override rows carry a safe percentage;
> - `navigation_analytics_events` exists; RLS enabled; `anon`/`authenticated` have **no** direct
>   table privileges; `service_role` has the intended access; analytics indexes + enum/length
>   constraints exist; the table has **no direct PII columns**;
> - both migrations are recorded in staging migration history;
> - security advisor shows only the expected RLS-no-client-policy *informational* notice;
> - no Navigation-specific blocking performance advisory exists.
>
> The original apply/verify runbook is retained below for the production apply (PO-authorized,
> post-merge — see `PRODUCTION_INTEGRATION.md`).

## Migrations to apply (in this order) — STAGING `eoyenigwevnxwwhyhaer` ONLY

1. `database/migrations/20260623120000_feature_rollout_percentage.sql`
   — additive `ALTER TABLE feature_rollout_overrides` (adds `rollout_percentage SMALLINT
   DEFAULT 100`, `rollout_seed TEXT`; guarded CHECKs). Idempotent, reversible.
2. `database/migrations/20260623130000_navigation_analytics_events.sql`
   — new `navigation_analytics_events` table (RLS, service-role-only, enum CHECKs, indexes).
   Idempotent.

Both are **staging-first**. The original governance migrations
(`20260621120000_feature_rollout_overrides`, `20260622120000_feature_rollout_search_path`)
are already applied + verified in staging. **Production is NOT migrated.**

## Apply (point env at STAGING, then run the repo runner)

```bash
# 1. Point the backend env at the STAGING Supabase project (NOT production):
export SUPABASE_URL="https://eoyenigwevnxwwhyhaer.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<staging service-role key from the staging secrets store>"

# 2. Apply pending migrations with the repo runner (applies in timestamp order):
npm run migrate:up --workspace=backend

# (Alternatively, apply each SQL file directly via psql / the Supabase SQL editor against
#  the staging project — the files are plain idempotent SQL.)
```

Confirm the staging migration history now records BOTH new files (the runner records applied
migrations; or `select * from supabase_migrations.schema_migrations` / the project's history).

## Verify (run against STAGING; expected results in parentheses)

Run the **Milestone F/G verification SQL** in `NAVIGATION_BLUEPRINT_STAGING_PLAN.md` §5:

- **Percentage (G):** `rollout_percentage` + `rollout_seed` columns exist; `rollout_percentage`
  is `SMALLINT NOT NULL DEFAULT 100`; CHECK `0..100` present; **no existing row has
  `rollout_percentage IS NULL`** (existing rows defaulted to 100 — safe); RLS + service-role
  grants unchanged.
- **Analytics (F):** `navigation_analytics_events` exists; **RLS enabled**; `anon` and
  `authenticated` have **no direct table privileges**; `service_role` has the intended access;
  indexes (`occurred_at, feature_id, event_type, surface, platform`) + enum CHECK constraints
  present; **no PII columns** (no email/name/phone/vin/token/ip/device/tenant/url); migration
  history records both files.

Then run the Supabase **security advisors** AND **performance advisors** and confirm:
- no "RLS disabled" / "exposed table" notice for `navigation_analytics_events`;
- no "function search_path mutable" regression;
- no missing-index / unindexed-foreign-key performance warning introduced by the new objects.
Record results (no secrets).

## Sign-off (release engineer fills in)

| Item | Result | Notes |
|---|---|---|
| `20260623120000_feature_rollout_percentage` applied | ☐ PASS / ☐ FAIL | |
| `20260623130000_navigation_analytics_events` applied | ☐ PASS / ☐ FAIL | |
| Percentage verification (§5) | ☐ PASS / ☐ FAIL | |
| Analytics verification (§5, no PII) | ☐ PASS / ☐ FAIL | |
| Security advisors clean | ☐ PASS / ☐ FAIL | |
| Performance advisors clean | ☐ PASS / ☐ FAIL | |
| Migration history records both | ☐ PASS / ☐ FAIL | |

Once all rows are PASS, update `NAVIGATION_BLUEPRINT_STAGING_PLAN.md` to record the two
migrations as **applied + verified** (mirroring how the governance migrations are recorded).
