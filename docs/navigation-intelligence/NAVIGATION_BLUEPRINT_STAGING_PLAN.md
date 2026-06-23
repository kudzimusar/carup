# Navigation Intelligence Blueprint — Staging Deployment & Smoke Plan

> **Status: BOTH governance migrations APPLIED + VERIFIED in staging (`eoyenigwevnxwwhyhaer`). Vercel previews green. PO smoke/UAT pending.**
> Both migrations are applied to the dedicated **staging** Supabase project
> `eoyenigwevnxwwhyhaer` and verified (production `vhmnajoeicasaigiophh` was NOT
> migrated):
> - `20260621120000_feature_rollout_overrides.sql` — applied + verified;
> - `20260622120000_feature_rollout_search_path.sql` — applied + verified; the
>   trigger function `feature_rollout_overrides_touch_updated_at()` `proconfig`
>   now contains `search_path=public, pg_temp` (the security-advisor
>   function-search-path-mutable notice is cleared).
>
> The verified state is recorded under "Migration verification" below. Vercel
> previews (`carup`, `carup-backend`, `carup-staging`, `carup-backend-staging`)
> are green on the current branch head. Application/verification of staging was
> performed by the release engineer (the project is administered outside this
> agent's Supabase tooling); the agent records the confirmed result and **does
> not re-apply** either migration. Production was not touched.
>
> **Full-completion (Milestones F/G) — two NEW staging migrations: ✅ APPLIED + VERIFIED.**
> - `20260623120000_feature_rollout_percentage.sql` — applied + verified: `rollout_percentage`
>   is `SMALLINT NOT NULL DEFAULT 100`, CHECK `0–100`; `rollout_seed` length constraint present;
>   existing override rows carry a safe percentage; RLS/grants unchanged.
> - `20260623130000_navigation_analytics_events.sql` — applied + verified: table exists; RLS
>   enabled; `anon`/`authenticated` have NO direct table privileges; `service_role` has the
>   intended access; analytics indexes + enum/length constraints present; **no direct PII columns**.
>
> Both are recorded in the staging migration history for `eoyenigwevnxwwhyhaer`. Security advisor
> shows only the expected RLS-no-client-policy *informational* notice; no Navigation-specific
> blocking performance advisory. Applied + verified out-of-band by the release engineer (the
> project is administered outside this agent's tooling); the agent records the confirmed result
> and **does not re-apply**. **Production was not touched.** Re-runnable verification SQL is in §5.

## Environment refs (no credentials)
- **Staging Supabase project ref:** `eoyenigwevnxwwhyhaer` (both governance migrations applied + verified).
- **Production/shared Supabase project ref:** `vhmnajoeicasaigiophh` (`.env` target — NOT migrated).
- **Tooling-visible project:** `sfhtlzcgrnrdznhvdrbn` ("production-os") — production; intentionally NOT migrated.
- Staging Vercel projects: `carup-staging` (web) and `carup-backend-staging` (backend) with `VITE_API_URL`/`APP_ENV=staging` and the staging project's `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (held in the staging secrets store, not in this repo).

## 1. Deploy the same SHA to staging
Deploy web + backend from the integration branch head (record the SHA). They must point at the **staging** backend/Supabase.

## 2. Governance migration on STAGING only (`eoyenigwevnxwwhyhaer`)
> **APPLIED.** `20260621120000_feature_rollout_overrides.sql` is applied to staging (idempotent, one server-owned table, RLS on, service_role-only). **No production writes.**

### Migration verification — CONFIRMED in staging (by the release engineer)
The following were confirmed present/correct in `eoyenigwevnxwwhyhaer`:
- ✅ `feature_rollout_overrides` table exists; migration recorded in staging history.
- ✅ RLS enabled.
- ✅ `anon` has NO direct privileges; `authenticated` has NO direct privileges; `service_role` has the intended privileges.
- ✅ Primary key; unique `(feature_id, environment)` index; supporting indexes; CHECK constraints; `updated_at` trigger.

### Follow-up: harden the trigger function search_path — APPLIED + VERIFIED
> The security advisor flagged `feature_rollout_overrides_touch_updated_at()` with a mutable `search_path`. Migration `20260622120000_feature_rollout_search_path.sql` (idempotent, guarded) is **applied + verified in staging**: the function's `proconfig` now contains `search_path=public, pg_temp`, and the advisor notice is cleared. Re-verification query (for the record):
```sql
select proname, proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='feature_rollout_overrides_touch_updated_at';
-- proconfig contains 'search_path=public, pg_temp' ✅
```

### Re-verification SQL (re-runnable against staging; expected results in parentheses)
```sql
-- table exists (1 row)
select to_regclass('public.feature_rollout_overrides') is not null as table_exists;
-- unique (feature_id, environment)  (1 row, indisunique = t)
select indexname from pg_indexes where tablename='feature_rollout_overrides' and indexname='uq_feature_rollout_overrides_feature_env';
-- CHECK constraints: env, lifecycle, time-window, version  (4 rows)
select conname from pg_constraint where conrelid='public.feature_rollout_overrides'::regclass and contype='c';
-- version column present, NOT NULL, default 1
select column_name, is_nullable, column_default from information_schema.columns
  where table_name='feature_rollout_overrides' and column_name='version';
-- supporting indexes (feature_id, environment, updated_at) present
select indexname from pg_indexes where tablename='feature_rollout_overrides';
-- updated_at trigger present  (1 row)
select tgname from pg_trigger where tgrelid='public.feature_rollout_overrides'::regclass and not tgisinternal;
-- RLS enabled  (relrowsecurity = t)
select relrowsecurity from pg_class where oid='public.feature_rollout_overrides'::regclass;
-- grants: anon/authenticated have NO privileges; service_role has them
select grantee, privilege_type from information_schema.role_table_grants
  where table_name='feature_rollout_overrides' order by grantee;
```
After applying, also run the Supabase **security advisors** and confirm no "RLS disabled"/"exposed table" notice for `feature_rollout_overrides`. Record results (no secrets).

## 3. Staging smoke checklist (record pass/fail + screenshots)
- [ ] Staging frontend calls the staging backend; staging backend uses staging Supabase; **no production writes**.
- [ ] `GET /api/features/effective` → 200, features at static defaults (no overrides yet).
- [ ] Admin API authorization: admin session can `GET /api/admin/features`; a non-admin session gets 403; a spoofed `x-stakeholder-role: admin` header from a non-admin user is **denied** (server re-derives role from `user_sessions`→`users`).
- [ ] Create an override via `/admin/features` (e.g. set `product.insurance` → `disabled` in staging) → audit row appears (`trust_audit_events`, `FEATURE_ROLLOUT_*`).
- [ ] Nav visibility updates: the disabled feature disappears from the footer/menus after hydration.
- [ ] Direct-route boundary updates: visiting the disabled feature's route shows the unavailable page.
- [ ] Reset the override → feature returns to static default; cache invalidated.
- [ ] Desktop top nav (Buy/Sell/Verify/Parts/More), footer, mobile drawer all render.
- [ ] All seven roles (owner, dealer, mechanic, insurance, government, admin, bank): correct dashboard + drawer items, no cross-role leakage.
- [ ] Login → sanitized return-to; role switching; logout clears protected items.
- [ ] Marketplace coverage-gated links activate/defer with real staging coverage.
- [ ] Deep-link refresh preserves query state; tablet↔desktop transition; accessibility smoke (keyboard + focus).

## 4. Evidence to capture
- Staging web + backend deployment URLs and the SHA.
- Migration apply output + `\d+ feature_rollout_overrides`.
- Screenshots / API transcripts for each smoke item.
- A staging override audit row.

## Automated pre-staging signal already green (this branch, local)
- Web unit 192, tsc clean, build OK; DB-free backend governance 17 + server-export 1; Playwright nav suites 27–32. See `NAVIGATION_BLUEPRINT_MILESTONE_EVIDENCE.md`.

## 5. Milestone F/G migration verification (re-runnable against staging)
Run after the release engineer applies the two new migrations to `eoyenigwevnxwwhyhaer`
(expected results in parentheses). Production is NOT migrated.

```sql
-- G: percentage columns present with correct defaults/constraints
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
  where table_name='feature_rollout_overrides'
    and column_name in ('rollout_percentage','rollout_seed');           -- (2 rows; pct default 100, NOT NULL)
select conname from pg_constraint
  where conrelid='public.feature_rollout_overrides'::regclass and contype='c'
    and conname like '%rollout_percentage%';                            -- (>=1: 0..100 check)
select count(*) from feature_rollout_overrides where rollout_percentage is null; -- (0 — existing rows defaulted to 100)

-- F: analytics table exists, RLS on, service_role-only, indexed, no PII columns
select to_regclass('public.navigation_analytics_events') is not null;   -- (t)
select relrowsecurity from pg_class
  where oid='public.navigation_analytics_events'::regclass;             -- (t)
select grantee, privilege_type from information_schema.role_table_grants
  where table_name='navigation_analytics_events' order by grantee;      -- (service_role only; no anon/authenticated)
select indexname from pg_indexes where tablename='navigation_analytics_events'; -- (occurred_at/feature_id/event_type/surface/platform)
select column_name from information_schema.columns
  where table_name='navigation_analytics_events';                       -- (allowlist only; NO email/name/phone/vin/token/ip/device/tenant/url)
```
After applying, run the Supabase **security advisors** and confirm no "RLS disabled" /
"exposed table" / "function search_path mutable" notice for the new objects. Record results (no secrets).

## 6. Milestone F/G staging smoke (record pass/fail)
- [ ] Native app (staging build) loads governed tabs/drawer per role; logout/role-switch refreshes; no fabricated screens; no hardcoded localhost (physical device reaches staging API).
- [ ] `/admin/features` lazy console loads on direct refresh (loading → console); chunk split present in the deployed assets.
- [ ] Set a feature `rollout_percentage` (e.g. 25%) in staging → exposure is stable per subject across reloads; role/tenant denial still wins; reset → 100%.
- [ ] `POST /api/analytics/navigation` ingests a bounded batch (202), rejects oversized/over-rate, stores no PII; admin aggregate endpoint returns funnel metrics for an admin and 403 for a non-admin.
- [ ] Axe/keyboard smoke on desktop nav, mobile drawer, console, lifecycle page.
