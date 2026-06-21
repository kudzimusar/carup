# CarUp Referral Engine — Rollback Runbook

> **Status: release-candidate evidence draft. Live-UAT-dependent items marked PENDING (staging secret unavailable at authoring time, 2026-06-21).**

This runbook satisfies Phase F7 of `docs/referral-ai-engine/REFERRAL_ENGINE_FINAL_UAT_RELEASE_GOAL_LOOP.md`. It is grounded in the actual repository on branch `feat/referral-final-uat-release`. It tells an on-call operator how to safely back out a Referral Engine production release **without losing wallet, dispute, or audit data**.

**Approver line:** No rollback step that mutates production (revert deploy, run migrations, disable navigation in prod, pause rewards) may proceed without **explicit owner approval**. Record approver, timestamp, and the reason on every executed step.

---

## 0. Decision guide — what kind of rollback?

| Symptom | Action | Section |
|---------|--------|---------|
| Bad web build / broken referral pages / wrong UI | Roll back web deploy only | §1 |
| Backend referral API errors / regression | Roll back backend deploy only | §2 |
| Schema problem after a referral migration | Forward-fix (preferred) or rollback | §3 |
| Need to hide the feature without redeploying logic | Disable referral navigation | §4 |
| Rewards being created incorrectly (e.g. wrong owner) | Pause reward creation, preserve data | §5 |

Default preference: **roll back the deploy artifact, keep the schema**. The referral schema is additive and idempotent; data is preserved by leaving tables in place (see §3 and §6).

---

## 1. Web rollback procedure

The web app is a Vite SPA (`web/`) deployed as static output with SPA rewrites (`web/vercel.json` → `/index.html`; root `vercel.json` → `/`). Build command: `npm run build --workspace=web` (`tsc -b && vite build`).

**Preferred — platform deployment rollback (fast, no code change):**
1. Get owner approval.
2. In the web hosting dashboard (Vercel target — *exact project to be confirmed by owner*), promote the **last known-good production deployment** for the web project. This instantly serves the prior bundle.
3. Verify: load `/dashboard/referrals` and the six `/admin/referrals*` routes; confirm the prior behavior is restored.

**Alternative — git revert + redeploy:**
1. `git revert` the offending web commit(s) on a branch off `main`, open a PR, get owner approval, merge.
2. CI/host rebuilds `web/` and deploys.

No environment variables need to change for a web rollback. Do **not** flip `VITE_MARKETPLACE_ALLOW_MOCK` on in production.

---

## 2. Backend rollback procedure

The backend is a Node/Express service started with `node server.js` (`backend/package.json` `start`). The referral API is mounted at `/api/referrals` via `backend/routes/promotionsRoutes.js` → `backend/server.js`.

**Preferred — deploy artifact rollback (no schema change):**
1. Get owner approval.
2. Redeploy the **previous known-good backend build/commit** to the backend host (*exact host to be confirmed by owner — no backend host manifest exists in the repo*).
3. Keep the existing database schema in place (do **not** roll back migrations as part of a code rollback — see §3).
4. Verify: `GET /api/health` returns `status: UP` and `supabase.status: healthy`; run the smoke reads in §7.

**Alternative — git revert + redeploy:**
1. `git revert` the offending backend commit(s) on a branch off `main`, PR, owner approval, merge, redeploy.

Environment: leave all `SUPABASE_*`, `JWT_SECRET`, and `CARUP_*` values unchanged. Rotate a secret only if the incident is a secret compromise (owner-held; see readiness doc §4).

---

## 3. Migration: forward-fix vs rollback

### 3.1 Reality of the referral migration

- The **only** referral schema migration is `database/migrations/016_referral_engine_phase1.sql`. It creates 9 tables with `CREATE TABLE IF NOT EXISTS` and enables RLS on each.
- The repository migration runner is `backend/db/migrate.js` (`npm run migrate:up` / `npm run migrate:rollback --workspace=backend`). It executes a migration's `-- +migrate Down` block on rollback.
- **`016` has NO `-- +migrate Down` section.** Therefore `migrate:rollback` has **no down SQL** for the referral schema and will not drop referral tables. This is intentional safety: the schema cannot be auto-dropped, so **wallet/dispute/audit data cannot be destroyed by a routine rollback command.**

### 3.2 Preferred approach: FORWARD-FIX

For almost every schema-related incident, **forward-fix, do not roll back the schema**:
1. Write a new, additive, idempotent migration with a higher number/timestamp (next after `016` and after the latest `2026*` migrations) that corrects the issue (add column, add/adjust constraint, backfill).
2. Make it idempotent (`IF NOT EXISTS` / guarded `ALTER`) and include a `-- +migrate Down` block if reversibility is needed.
3. Get owner approval, apply in order via the same mechanism used to deploy `016`, verify.

Forward-fix preserves all existing rows in `referral_wallets`, `referral_wallet_transactions`, `referral_events`, `referral_admin_audit_events`, and the dispute/case records stored in `referral_events`.

### 3.3 Schema rollback (last resort, destructive — owner only)

Dropping referral tables is **destructive** (loses wallet/dispute/audit data) and is **not** supported by `migrate:rollback` for `016`. Do this only if the owner explicitly accepts data loss:
1. Get explicit written owner approval acknowledging data loss.
2. Take a full backup/export of all 9 `referral_*` tables first (and run the audit export `GET /api/referrals/trust/audit-export` to capture a checksummed trail).
3. Only then, under owner direction, drop/alter the affected objects.

Default stance for this runbook: **never drop referral tables to recover from a deploy issue.** Back out the code instead (§1, §2) and forward-fix the schema (§3.2).

---

## 4. Disabling referral navigation safely

This hides the feature in the UI without touching data or schema. Identify the **actual** entry points:

### 4.1 Navigation registry (primary control point)
- File: `web/src/config/featureRegistry.ts`.
- All referral nav entries carry `domain: 'referral'`: `owner.referrals`, `admin.referrals`, `admin.referral-codes`, `admin.referral-local-leads`, `admin.referral-import-routes`, `admin.referral-marketing`, `admin.referral-trust`.
- Removing (or commenting out) these entries removes them from every sidebar/nav, because navigation components consume the registry instead of hard-coded lists (per the file's header comment). This is the safest UI-only disable.

> Note: the registry has **no built-in `enabled`/feature-flag field** (verified — `FeatureRegistryItem` has no `enabled`/`disabled`/`flag` property). Disabling is done by editing the registry array (remove/comment the seven `domain: 'referral'` entries) and redeploying web, not by toggling a flag. If a runtime flag is desired, it must be added; that is a code change, not an ops toggle.

### 4.2 Route registrations (defense in depth)
- File: `web/src/App.tsx`.
- The seven referral routes are registered here:
  - `/dashboard/referrals` → `ReferralWallet`
  - `/admin/referrals` → `ReferralCampaigns`
  - `/admin/referrals/codes` → `ReferralCodes`
  - `/admin/referrals/local-leads` → `ReferralLocalLeads`
  - `/admin/referrals/import-routes` → `ReferralImportRoutes`
  - `/admin/referrals/marketing` → `ReferralMarketing`
  - `/admin/referrals/trust` → `ReferralTrustReview`
- To make routes unreachable (not just hidden), comment out these `<Route>` lines (and their imports at the top of `App.tsx`) and redeploy web.

### 4.3 Recommended order
Remove the registry entries first (§4.1) for the cleanest UX; remove routes (§4.2) only if you must guarantee the pages are not reachable by direct URL. Both are web-only changes — backend data is untouched.

---

## 5. Safe reward-pause strategy (halt reward creation without data loss)

The goal is to stop **new** reward/wallet credits from being created while preserving every existing wallet, transaction, dispute, and audit record.

### 5.1 The real reward/wallet code path
- New referral credits are created by `createWalletTransaction(...)` in `backend/services/referral/referralEngineService.js`. It inserts into `referral_wallet_transactions` (`REFERRAL_TABLES.walletTransactions`), recomputes balances, and records a `WALLET_TRANSACTION_CREATED` referral event.
- Rewards originate from milestone qualification:
  - Local: `backend/services/referral/referralLocalMarketplaceHardenedService.js` (`qualifyLead`, gated by `REWARDABLE_MILESTONES`), exposed at `POST /api/referrals/local-marketplace/leads/:leadEventId/qualify` (requires `OPERATOR_ROLES`).
  - Imports/container: `backend/services/referral/referralImportCampaignHardenedService.js` (`qualifyMilestone`, gated by `REWARDABLE_IMPORT_MILESTONES`), exposed at `POST /api/referrals/import-campaigns/leads/:leadEventId/qualify` (requires `OPERATOR_ROLES`).
- Direct admin/operator wallet writes: `POST /api/referrals/wallets/transactions` (operator) and `PATCH /api/referrals/wallets/transactions/:id/status` (admin).

### 5.2 How to pause (in order of preference)

**Option A — Operational halt (no code change, fastest):** Instruct operators to stop calling the two qualify endpoints and the wallet-transaction write endpoint. Because all reward-creating endpoints require `OPERATOR_ROLES`/`ADMIN_ROLES`, suspending the operator/admin accounts' ability to trigger qualification effectively pauses new rewards. No data is touched. Suitable as the immediate stop-gap.

**Option B — Code-level guard (preferred durable pause, requires deploy):** Add a short-circuit in `createWalletTransaction` (in `referralEngineService.js`) — the single choke point all reward credits pass through — to refuse new inserts while paused (e.g. return a structured `ForbiddenError` / "rewards temporarily paused" without writing). Because every reward path funnels through this one method, guarding it pauses local, import, and direct admin credit creation at once. Existing rows are untouched. Deploy backend with the guard, get owner approval first.

**Option C — Disable the trigger surface:** Disable the referral admin nav (§4) so operators cannot reach the qualify/marketing/trust admin pages, combined with Option A. UI-only; backend endpoints still exist but are not driven.

### 5.3 What pausing must NOT do
- Do **not** transition or delete existing `referral_wallet_transactions` rows.
- Do **not** drop or truncate any `referral_*` table.
- Pausing only prevents **new** inserts; pending/approved/settled balances remain exactly as they were.

> Note: existing held/dispute logic already exists (`POST /api/referrals/trust/wallet-transactions/:transactionId/hold` and dispute endpoints). A "hold" places an existing transaction in a `held` state for review — that is a per-transaction trust action, complementary to a global reward pause, not a substitute for it.

---

## 6. Preservation guarantees (wallet / dispute / audit data)

These guarantees hold for every procedure above when followed as written:

- **Wallets & transactions** (`referral_wallets`, `referral_wallet_transactions`): preserved. No referral service issues `DELETE`/`TRUNCATE` against these tables (verified by grep across `backend/services/referral/*.js`). Code rollback (§1, §2) and forward-fix (§3.2) leave all rows intact. Reward pause (§5) only blocks new inserts.
- **Disputes & review cases**: preserved. Disputes and trust cases are recorded as `referral_events` (created via `recordReferralEvent` in `referralEngineService.js`) and resolved via status transitions, never hard-deleted. Rolling back code does not alter stored events.
- **Audit trail** (`referral_admin_audit_events` + `referral_events`): preserved. Admin decisions write audit events; the checksummed export (`exportAuditTrail` in `backend/services/referral/referralTrustReviewService.js`, SHA-256 `checksum()`) lets you snapshot a tamper-evident trail before any risky step.
- **Schema-level safety net**: `016` has no `-- +migrate Down`, so `migrate:rollback` cannot drop referral tables. Destroying referral data requires a deliberate, owner-approved, manual operation (§3.3).

Recommended safety step before any production rollback: run `GET /api/referrals/trust/audit-export` and store the returned checksum + payload as evidence.

---

## 7. Post-rollback validation

Run after any rollback action; all are non-destructive:

- [ ] **Health**: `GET /api/health` returns `status: UP`, `supabase.status: healthy`.
- [ ] **Public code validation**: `POST /api/referrals/validate` returns a structured valid/invalid response.
- [ ] **Owner wallet read**: an owner `GET /api/referrals/wallets/:userId` (own ID) returns their wallet with the **same** balances as before the rollback (confirm preservation); another user's ID is rejected.
- [ ] **Admin list reads**: `GET /api/referrals/campaigns`, `/codes`, `/coupons`, `/local-marketplace/leads`, `/import-campaigns/routes`, `/trust/disputes` return data.
- [ ] **Dispute integrity**: any in-flight dispute still appears in `GET /api/referrals/trust/disputes` with its prior status.
- [ ] **Audit integrity**: `GET /api/referrals/trust/audit-export` returns a checksum; event count is ≥ the pre-rollback count (audit is append-only).
- [ ] **Route rendering**: referral routes render (or are intentionally hidden, if §4 was applied) for the correct roles.
- [ ] **No staging leakage**: no `eoyenigwevnxwwhyhaer` ref, no `uat-*@carup.local` account, no service-role key in production responses/bundles.
- [ ] **If rewards were paused (§5)**: confirm no new `referral_wallet_transactions` rows are being created and existing balances are unchanged.

> Live execution of these steps against production is **PENDING** until a release is actually deployed and owner approval is granted; they are written to be runnable at that time.

---

## 8. Approver

- **Owner approval is required** before executing any production-mutating step in this runbook (web/backend deploy rollback, navigation disable in production, reward pause, or any migration action).
- For schema rollback (§3.3) the owner must additionally **acknowledge potential data loss in writing**, and a full `referral_*` backup plus a checksummed audit export must be taken first.
- Record on every executed step: approver, timestamp, action taken, and verification result.

_Authored 2026-06-21 on branch `feat/referral-final-uat-release`. Live-UAT-dependent confirmations are marked PENDING (staging secret unavailable at authoring time)._
