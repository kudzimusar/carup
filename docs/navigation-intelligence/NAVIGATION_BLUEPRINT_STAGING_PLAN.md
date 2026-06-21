# Navigation Intelligence Blueprint — Staging Deployment & Smoke Plan

> **Status: migration NOT YET applied — blocked by tooling access. Deployment + PO smoke pending.**
> A dedicated staging Supabase project exists — ref **`eoyenigwevnxwwhyhaer`** —
> and is the authorized migration target (production must NOT receive it). However,
> the staging project is **not reachable from the agent's connected Supabase tooling**:
> `list_projects` exposes only one project, `sfhtlzcgrnrdznhvdrbn` ("production-os"),
> and a read-only probe of `eoyenigwevnxwwhyhaer` returns *"You do not have
> permission to perform this action."* The agent therefore **did not apply the
> migration to any project** — it must not migrate `sfhtlzcgrnrdznhvdrbn`
> (production), and it cannot access `eoyenigwevnxwwhyhaer` (staging). The exact
> apply + verification SQL is provided below for the release engineer who holds
> staging access. (Local `.env` targets the shared/production project
> `vhmnajoeicasaigiophh`, which is likewise not a valid migration target.)

## Environment refs (no credentials)
- **Staging Supabase project ref:** `eoyenigwevnxwwhyhaer` (authorized governance-migration target; not reachable from this environment's tooling).
- **Production/shared Supabase project ref:** `vhmnajoeicasaigiophh` (`.env` target — must NOT receive this migration).
- **Tooling-visible project:** `sfhtlzcgrnrdznhvdrbn` ("production-os") — production; intentionally NOT migrated.
- Staging Vercel projects: `carup-staging` (web) and `carup-backend-staging` (backend) with `VITE_API_URL`/`APP_ENV=staging` and the staging project's `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (held in the staging secrets store, not in this repo).

## 1. Deploy the same SHA to staging
Deploy web + backend from the integration branch head (record the SHA). They must point at the **staging** backend/Supabase.

## 2. Apply the governance migration to STAGING only (`eoyenigwevnxwwhyhaer`)
> **Not yet applied** — see the status note above (staging project not reachable from the agent's tooling). Run this as the release engineer with staging access, e.g. via the Supabase SQL editor / MCP `apply_migration(project_id="eoyenigwevnxwwhyhaer", …)` or psql:
```bash
psql "$STAGING_DATABASE_URL" -f database/migrations/20260621120000_feature_rollout_overrides.sql
```
The migration is idempotent and creates only the one server-owned table (RLS on, service_role-only). **No production writes.**

### Migration verification (run against staging; expected results in parentheses)
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
