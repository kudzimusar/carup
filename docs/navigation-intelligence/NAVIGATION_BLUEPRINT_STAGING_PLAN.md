# Navigation Intelligence Blueprint — Staging Deployment & Smoke Plan

> **Status: main governance migration APPLIED + VERIFIED in staging (`eoyenigwevnxwwhyhaer`). Search-path follow-up authored (pending apply). Vercel deploy + PO smoke pending.**
> The main migration `20260621120000_feature_rollout_overrides.sql` has been
> applied to the dedicated **staging** Supabase project `eoyenigwevnxwwhyhaer`
> (production `vhmnajoeicasaigiophh` was NOT migrated). The verified staging state
> is recorded under "Migration verification (confirmed in staging)" below.
>
> Attribution / honesty note: the apply + verification were performed by the
> release engineer who holds staging access — the **agent's own connected Supabase
> tooling still cannot reach `eoyenigwevnxwwhyhaer`** (`list_projects` shows only
> `sfhtlzcgrnrdznhvdrbn` "production-os"; a read-only probe of the staging ref
> returns *permission denied*), so the agent cannot independently re-run those
> checks and is recording the confirmed result. The follow-up migration
> `20260622120000_feature_rollout_search_path.sql` (security-advisor hardening) is
> authored and **pending application to staging** by the release engineer.

## Environment refs (no credentials)
- **Staging Supabase project ref:** `eoyenigwevnxwwhyhaer` (governance-migration target; main migration applied/verified; not reachable from the agent's tooling).
- **Production/shared Supabase project ref:** `vhmnajoeicasaigiophh` (`.env` target — must NOT receive this migration).
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

### Follow-up: harden the trigger function search_path
> The security advisor flagged `feature_rollout_overrides_touch_updated_at()` with a mutable `search_path`. Migration `20260622120000_feature_rollout_search_path.sql` pins it (idempotent, guarded). **Pending application to staging** by the release engineer (the agent cannot reach the staging project):
```bash
psql "$STAGING_DATABASE_URL" -f database/migrations/20260622120000_feature_rollout_search_path.sql
-- verify
select proname, proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='feature_rollout_overrides_touch_updated_at';
-- expect proconfig to contain 'search_path=public, pg_temp'; then re-run the security advisor.
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
