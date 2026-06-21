# Navigation Intelligence Blueprint — Staging Deployment & Smoke Plan

> **Status: PREPARED — pending Product Owner action.**
> This Blueprint is built deploy-ready, but the staging deployment and the
> governance migration **were not executed by the implementation agent**. The
> only Supabase project available in this environment is the live/shared
> project `vhmnajoeicasaigiophh` (the same one `backend/server.js` logs and that
> `.env` points to, `NODE_ENV=development`). Per the plan's rules #9/#10 and the
> mandatory stop conditions ("no production migration without separate
> approval", "staging must not point to production services", "do not use
> production data/credentials for testing"), the agent **did not** apply the
> migration or run write-path integration tests against it. The steps below are
> for the Product Owner / release engineer to run against the **real staging
> Supabase + staging Vercel projects**.

## Pre-req: a real staging environment
- A **separate staging Supabase project** (NOT `vhmnajoeicasaigiophh`).
- Staging Vercel projects `carup-staging` (web) and `carup-backend-staging` (backend) with `VITE_API_URL`/`APP_ENV=staging` and the staging `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

## 1. Deploy the same SHA to staging
Deploy web + backend from the integration branch head (record the SHA). They must point at the **staging** backend/Supabase.

## 2. Apply the governance migration to STAGING only
```bash
# against the STAGING Supabase, service-role:
psql "$STAGING_DATABASE_URL" -f database/migrations/20260621120000_feature_rollout_overrides.sql
# verify
psql "$STAGING_DATABASE_URL" -c "\d+ feature_rollout_overrides"
```
The migration is idempotent and creates only the one server-owned table (RLS on, service_role-only). No production writes.

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
