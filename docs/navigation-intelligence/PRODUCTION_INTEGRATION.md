# Production Integration Plan — PR #94 (Navigation Intelligence)

> Prepared for the Product Owner. **Nothing here is executed by the agent.** The PR is held
> open/unmerged until the PO explicitly authorizes the merge. Production migrations are applied
> only **after** merge, by the release engineer, on PO authorization.

## Pre-merge gate (all must be green before the PO authorizes)

| Gate | State |
|---|---|
| Branch behind `main` | **0 commits** (rebase clean) |
| PR mergeable | **MERGEABLE** (open, not draft, not merged) |
| GitHub CI: `navigation-gates` / `navigation-e2e` / `navigation-accessibility` | **green** on head |
| Vercel: `carup`, `carup-backend`, `carup-staging`, `carup-backend-staging` | **green** |
| Codex review threads | all resolved; final re-review requested |
| Staging migrations (F/G) applied + verified | **PENDING release engineer** (see `STAGING_MIGRATION_HANDOFF.md`) |
| Staging UAT | **PENDING PO** (see `NAVIGATION_BLUEPRINT_UAT_CHECKLIST.md` §H) |

The last two rows are the only items not satisfiable from CI; they gate the PO's authorization.

## Production migration order (apply AFTER merge, on PO authorization)

Production Supabase was **never migrated** during development. Apply, in order, to the
**production** project only after merge + PO sign-off:

1. `20260621120000_feature_rollout_overrides.sql`  *(governance table — if not already on prod)*
2. `20260622120000_feature_rollout_search_path.sql` *(trigger search_path hardening)*
3. `20260623120000_feature_rollout_percentage.sql`  *(additive: rollout_percentage/seed; existing rows → 100%, no behavior change)*
4. `20260623130000_navigation_analytics_events.sql` *(new analytics table; RLS, service-role-only)*

All four are idempotent/additive. Run `npm run migrate:up --workspace=backend` with the env
pointed at production, then run the same verification SQL (staging plan §5) + security &
performance advisors against production. There is **no destructive step**; rollback =
`STAGING_…ROLLBACK_RUNBOOK.md` (drop the added columns / analytics table — additive only).

## Unified production smoke checklist (post-deploy, pre-announce)

- [ ] Web public nav (desktop mega-menus, footer, mobile drawer) renders; **anonymous Sell /
      Create-Passport / Dealer CTAs visible and route to `/register`** after governance hydration.
- [ ] Direct protected route still redirects to login/registration safely.
- [ ] `/admin/features` lazy console loads on direct refresh (loading → console); non-admin redirected.
- [ ] Admin override: set a feature `rollout_percentage = 25%` → exposure stable per subject across
      reloads; role/tenant denial still wins; **explicit "No roles" ([]) override persists** (not
      reset to defaults) when editing percentage; reset → 100% + default roles; audit row written.
- [ ] `POST /api/analytics/navigation` ingests a bounded batch (202), rejects oversized/over-rate,
      stores no PII; admin aggregates return funnel metrics; non-admin gets 403.
- [ ] Native (production build): governed tabs/drawer per role; no fabricated screens; logout/role
      switch refreshes; device reaches the production API (no localhost).
- [ ] Accessibility smoke: keyboard open/Escape, visible focus, reduced motion; axe clean on the
      primary surfaces.
- [ ] All seven roles: correct dashboard + nav items, no cross-role/tenant leakage.
- [ ] Rollback readiness confirmed (runbook reviewed; additive migrations reversible).

## Merge statement

**Do not auto-merge.** When every pre-merge gate is green AND staging migrations + UAT are signed
off, this PR is ready for the Product Owner to issue **"merge this PR now"**.
