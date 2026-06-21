# Navigation Intelligence Blueprint — Rollback Runbook

Scope: how to safely undo any part of the Navigation Intelligence Blueprint
(branch `codex/navigation-intelligence-blueprint-completion`). The system is
designed to **fail safe** — a missing override or failed governance fetch falls
back to static defaults — so most "rollback" is configuration, not code revert.

> Layered design: you can roll back the *runtime governance* (data) WITHOUT
> reverting *code*, and revert *code* without touching the *database*.

---

## 0. Decide the blast radius
| Symptom | Smallest safe action |
|---|---|
| A single feature mis-toggled in an environment | **Reset that override** (§1) |
| Governance console misbehaving | **Disable the console route** (§3) — nav/boundaries keep working on static defaults |
| Navigation regression (menus/footer/mobile) | **Revert the frontend** (§4) |
| Migration problem in staging | **Roll back the migration** (§5) — staging only |
| Everything | **Deployment rollback** (§6) |

---

## 1. Reset one or more runtime overrides (no deploy)
Effective state reverts to the static default immediately (cache is invalidated on write).
- Admin UI: `/admin/features` → open the feature → **Reset to default**.
- API: `DELETE /api/admin/features/:featureId/rollout` with body `{ "environment": "<env>" }` (platform-admin session).
- Bulk (DB, service-role only, staging): `DELETE FROM feature_rollout_overrides WHERE environment = '<env>';`

## 2. Invalidate the governance cache
The service cache is in-memory with a 30 s TTL and is invalidated automatically on every mutation. To force-clear without a mutation, restart the backend instance (or wait ≤ 30 s). No data is lost.

## 3. Disable the Feature Governance Console route (keep nav working)
- Frontend: remove the `<Route path="/admin/features" …>` line in `web/src/App.tsx` and the `admin.features` entry in `web/src/config/featureRegistry.ts`, then regenerate the manifest (`node scripts/generate-feature-manifest.mjs`) and redeploy. Navigation and route boundaries are unaffected (they don't depend on the console).
- Or, without a deploy: set a `disabled` override for `admin.features` via the API in the target environment — direct access then renders the "unavailable" page and it disappears from the admin sidebar.

## 4. Revert frontend navigation changes
- Full revert: `git revert` the navigation commits, or redeploy the previous `main` build. The previous `Navbar`/`Footer`/mobile drawer behavior is restored verbatim (they are in version control).
- Partial: the registry-driven selectors are additive; reverting `Navbar.tsx`/`Footer.tsx`/`MobileNavDrawer.tsx` to their pre-Blueprint versions restores the hardcoded menus while leaving `featureRegistry.ts` intact.
- Restore static defaults: nav already renders from static lifecycle when `effectiveStates` is empty — simply stop the `/api/features/effective` hydration (revert `FeatureGovernanceLoader` to `FeatureGovernanceProvider value={{}}`).

## 5. Roll back the database migration (STAGING ONLY)
The migration `database/migrations/20260621120000_feature_rollout_overrides.sql`
is **staging-only and not applied to production**. To remove it from staging
(service-role / SQL editor):
```sql
DROP TRIGGER IF EXISTS trg_feature_rollout_overrides_touch ON feature_rollout_overrides;
DROP FUNCTION IF EXISTS feature_rollout_overrides_touch_updated_at();
DROP TABLE IF EXISTS feature_rollout_overrides;
```
The backend then degrades safely: `/api/features/effective` and the admin list fall back to static defaults (a disabled feature never becomes enabled because the table is gone). No other table is touched. Audit rows in `trust_audit_events` (event_type `FEATURE_ROLLOUT_*`) are immutable and intentionally retained.

## 6. Deployment rollback
- Frontend & backend deploy from the same integration branch/SHA. To roll back, re-promote the previous production deployment (Vercel: promote the last good deployment) for both the web and backend projects.
- No production migration was applied, so a deploy rollback requires **no DB change**.

## 7. Verification after rollback
- `GET /api/features/effective` returns `200` with features at their static lifecycle.
- Desktop menus, footer, and mobile drawer render; no `Soon`/disabled regressions on active features.
- A protected route still redirects unauthenticated users to `/login?returnTo=…`.
- `/admin/features` is reachable by admins (if retained) or returns the unavailable/redirect behavior (if disabled).
- Run the structural gates: `npm run test:unit --workspace=web` and `node --test backend/tests/feature-governance.test.js`.
