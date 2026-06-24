# CarUp Referral Engine — Production Readiness

> **Status: release-candidate evidence draft. Live-UAT-dependent items marked PENDING (staging secret unavailable at authoring time, 2026-06-21).**

This document satisfies Phase F7 of `docs/referral-ai-engine/REFERRAL_ENGINE_FINAL_UAT_RELEASE_GOAL_LOOP.md`. It is grounded in the actual repository on branch `feat/referral-final-uat-release`. No secret values are included; environment variables are referenced by **name only**.

Production must not be deployed and production migrations must not be applied without explicit owner approval (Phase G of the goal-loop document).

---

## 1. Scope and authoring basis

- Branch: `feat/referral-final-uat-release`
- Referral schema source of truth: `database/migrations/016_referral_engine_phase1.sql`
- Backend referral API: `backend/routes/referralRoutes.js`, mounted at `/api/referrals` via `backend/routes/promotionsRoutes.js` (`router.use('/api/referrals', referralRouter)`), which is mounted into the app in `backend/server.js` (`app.use(promotionsRouter)`).
- Web referral routes: registered in `web/src/App.tsx` and discoverable via `web/src/config/featureRegistry.ts`.

All file paths below were inspected, not inferred.

---

## 2. Migration parity (staging vs production)

### 2.1 Referral migration files in the repository

There is exactly **one** referral schema migration file in the repository:

| File | Purpose | Tables created |
|------|---------|----------------|
| `database/migrations/016_referral_engine_phase1.sql` | Foundation schema for the Referral Engine | `referral_campaigns`, `referral_codes`, `referral_events`, `referral_coupons`, `referral_coupon_redemptions`, `referral_wallets`, `referral_wallet_transactions`, `referral_share_assets`, `referral_admin_audit_events` (9 tables) |

Verified facts about this migration:

- It creates all 9 referral tables with `CREATE TABLE IF NOT EXISTS` (idempotent / forward-only).
- It enables Row Level Security (`ENABLE ROW LEVEL SECURITY`) on all 9 referral tables.
- It defines the `set_referral_updated_at()` trigger function and per-table `updated_at` triggers (each guarded by `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`, so re-running is safe).
- It does **not** contain a `-- +migrate Down` section. The repository migration runner (`backend/db/migrate.js`) parses a `-- +migrate Down` block for rollback; because `016` has none, `npm run migrate:rollback --workspace=backend` has **no down SQL** for the referral schema. See the rollback runbook for the implication.

> Note on "phases 1–7": backend referral phases 2–7 (agent gateway, channels, local marketplace, imports, marketing, trust) are **application code** layered on the same `016` schema, not separate SQL migrations. No `database/migrations/*.sql` file beyond `016` creates referral tables. `database/migrations/20260616120000_marketplace_v1_inquiries.sql` only references `referral_code` / `campaign_code` as columns on a marketplace-inquiry table; it is not part of the referral schema.

### 2.2 Staging parity evidence

Per `docs/referral-ai-engine/SUPABASE_STAGING_VERIFICATION_20260613.md` (dated 2026-06-13, project ref `eoyenigwevnxwwhyhaer` / `carup-staging`):

- The 9 `public.referral_%` tables already exist on staging and **all have RLS enabled**.
- Key constraints were verified present (campaign `(tenant_id, slug)` unique, code `code` unique, coupon `code` unique, coupon-redemption `(coupon_id, redeemer_user_id)` and `idempotency_key` unique, wallet `user_id` unique, and the wallet-transaction status check including `created/pending/eligible/approved/payable/paid_or_applied/held`).
- The staging DB "already contained the referral migration output, so no migration was applied" during that pass.

### 2.3 Production parity

- **PENDING — requires staging UAT execution (blocked on staging secret).** Direct confirmation that the production project (`vhmnajoeicasaigiophh` / `CarUp`) has the `016` schema applied at the exact same definition as staging could not be performed at authoring time (no production credentials, and production must not be touched without owner approval).
- Promotion requirement: before deploy, apply `database/migrations/016_referral_engine_phase1.sql` to production **only if** the 9 referral tables are not already present, in migration order, under explicit owner approval (goal-loop Phase G, step 3). Because the migration is idempotent (`CREATE TABLE IF NOT EXISTS`), re-application against an already-migrated production DB is non-destructive, but it must still be reviewed and approved.

---

## 3. Required environment variables (NAMES only)

Grouped by service. **No values are recorded here.** Local env files are git-ignored (`backend/.env`, `web/.env`, `.env`, `.env.*` per `.gitignore`); UAT uses an ignored `backend/.env.uat.local` (goal-loop Phase F1).

### 3.1 Backend (Express API — `backend/`)

Required for referral / auth / Supabase operation (verified via `process.env.*` usage in `backend/db/supabase.js`, `backend/routes/referralRoutes.js`, `backend/services/referral/*`, `backend/services/auth/*`, `backend/middleware/*`):

| Variable name | Used for |
|---------------|----------|
| `SUPABASE_URL` | Supabase project URL (`backend/db/supabase.js`) — also used to derive staging-vs-prod ref guard |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) (`backend/db/supabase.js`); also CSRF fallback in `backend/middleware/securityMiddleware.js` |
| `SUPABASE_DB_URL` | Direct DB URL used by the seed/migration safety guard (`backend/scripts/seed-uat-referral-users.mjs`) |
| `JWT_SECRET` | Auth/session signing; primary CSRF secret source (`backend/middleware/securityMiddleware.js`) |
| `NODE_ENV` | Environment mode; gates UAT seed (refuses `production`) and dev fallbacks |
| `PORT` | API listen port (`backend/server.js`) |
| `CORS_ALLOWED_ORIGINS` | Allowed browser origins |

Referral-specific integration variables (verified in `backend/routes/referralRoutes.js` and `backend/services/referral/*`):

| Variable name | Used for |
|---------------|----------|
| `CARUP_AGENT_GATEWAY_SECRET` | Trusted agent-gateway header secret for `/api/referrals/agent/*` |
| `CARUP_CHANNEL_WEBHOOK_SECRET` | Inbound channel webhook secret (WhatsApp/Telegram/Facebook/Instagram) |
| `CARUP_PUBLIC_BASE_URL` | Public base URL used in generated share links |
| `CARUP_PUBLIC_URL` | Public URL used in generated share/share-kit links |
| `CARUP_WHATSAPP_NUMBER` | WhatsApp share-channel number |
| `CARUP_TELEGRAM_BOT` | Telegram share-channel bot handle |

Observability / platform (verified in `backend/server.js`, `backend/middleware/errorMiddleware.js`, `backend/services/ai/sentry.js`):

| Variable name | Used for |
|---------------|----------|
| `SENTRY_DSN` | Error reporting; `/api/health` reports `sentry.enabled` from its presence |
| `VERCEL` | Platform-detection flag |

> AI/OCR provider keys (e.g. `GEMINI_API_KEY`, `GROQ_API_KEY`, `CARUP_KIMI_GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MOONSHOT_API_KEY`) and payment webhook secrets (`PAYNOW_WEBHOOK_SECRET`, `ECOCASH_WEBHOOK_SECRET`, `INNBUCKS_WEBHOOK_SECRET`, `SAFEPAY_WEBHOOK_SECRET`) exist in the broader backend but are **not on the referral critical path**. They are listed here only so the owner can confirm full-service config; the referral engine does not require them.

UAT-only (never set in production — verified in `backend/scripts/seed-uat-referral-users.mjs`): `UAT_SEED_CONFIRM`, `UAT_ADMIN_PASSWORD`, `UAT_OWNER_PASSWORD`.

### 3.2 Web (Vite SPA — `web/`)

Verified via `import.meta.env.*` usage under `web/src`:

| Variable name | Used for |
|---------------|----------|
| `VITE_API_URL` | Backend API base URL |
| `VITE_SUPABASE_URL` | Supabase project URL (browser) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key (browser-safe; **not** the service role key) |
| `VITE_MARKETPLACE_ALLOW_MOCK` | Mock-data toggle (must be off in production) |

### 3.3 Mobile (Expo — `mobile/`)

Verified via `process.env.EXPO_PUBLIC_*` usage under `mobile`:

| Variable name | Used for |
|---------------|----------|
| `EXPO_PUBLIC_API_URL` | Backend API base URL |
| `EXPO_PUBLIC_ALLOW_LOCALHOST_API` | Dev-only localhost allowance (must be off for release builds) |
| `EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK` | Dev-only user fallback (must be off for release builds) |

---

## 4. Secret ownership

| Secret | Holder | Notes |
|--------|--------|-------|
| `SUPABASE_SERVICE_ROLE_KEY` (production) | **Owner-held** | Server-only; must never be present in any web/mobile bundle. The repo confirms the service role key is used only in `backend/`. |
| `SUPABASE_DB_URL` (production) | **Owner-held** | Direct DB connection string. |
| `JWT_SECRET` (production) | **Owner-held** | Session and CSRF signing. |
| `CARUP_AGENT_GATEWAY_SECRET`, `CARUP_CHANNEL_WEBHOOK_SECRET` | **Owner-held** | Trusted server-to-server / webhook secrets. |
| `SENTRY_DSN` | **Owner-held** | Observability sink. |
| UAT staging service-role key + `UAT_ADMIN_PASSWORD` / `UAT_OWNER_PASSWORD` | **Owner-held (staging)** | **Not available at authoring time.** Required to execute the live staging UAT; this is the root blocker for all PENDING items below. The legacy hard-coded UAT passwords are documented as compromised in `backend/scripts/seed-uat-referral-users.mjs` and must be rotated, never reused. |

No secret values are stored in this document or anywhere in the committed tree (enforced by `.gitignore`: `.env`, `.env.*`, `web/.env`, `backend/.env`, `.env.vercel`).

---

## 5. Deployment targets

| Component | Discovered target / config | Confidence |
|-----------|----------------------------|------------|
| Web (`web/`) | Vercel-style SPA. `web/vercel.json` rewrites all routes to `/index.html`; root `vercel.json` rewrites `/(.*)` to `/`. Build via `npm run build --workspace=web` (`tsc -b && vite build`). | Config present; **exact Vercel project/owner = deployment target to be confirmed by owner.** |
| Backend (`backend/`) | Node/Express service started with `node server.js` (`backend/package.json` `start` script). A `VERCEL` env flag is referenced in code, but no dedicated backend host manifest (`render.yaml`, backend `Dockerfile`, `fly.toml`, `Procfile`) was found. | **Deployment target to be confirmed by owner** (the specific backend host is not declared in the repo). |
| Mobile (`mobile/`) | Expo app (`mobile/app.json`: name `CarUp`, slug `carup-mobile`, SDK `54.0.0`, iOS bundle `com.carup.mobile`, Android package `com.carup.mobile`, scheme `carup`). | Config present; **store/EAS release pipeline = deployment target to be confirmed by owner.** Mobile release is separate from web/backend per goal-loop Phase G step 5. |

Only two `vercel.json` files and one `mobile/app.json` were found; no `render.yaml`, `fly.toml`, `railway.json`, or `Procfile` exists in the repo (excluding `node_modules`).

---

## 6. Referral routes

### 6.1 Web routes (registered in `web/src/App.tsx`)

| Route | Audience | Component (import in `App.tsx`) |
|-------|----------|---------------------------------|
| `/dashboard/referrals` | Owner | `ReferralWallet` (`web/src/pages/dashboard/owner/ReferralWallet`) |
| `/admin/referrals` | Admin | `ReferralCampaigns` (`web/src/pages/dashboard/admin/ReferralCampaigns`) |
| `/admin/referrals/codes` | Admin | `ReferralCodes` (`web/src/pages/dashboard/admin/ReferralCodes`) |
| `/admin/referrals/local-leads` | Admin | `ReferralLocalLeads` (`web/src/pages/dashboard/admin/ReferralLocalLeads`) |
| `/admin/referrals/import-routes` | Admin | `ReferralImportRoutes` (`web/src/pages/dashboard/admin/ReferralImportRoutes`) |
| `/admin/referrals/marketing` | Admin | `ReferralMarketing` (`web/src/pages/dashboard/admin/ReferralMarketing`) |
| `/admin/referrals/trust` | Admin | `ReferralTrustReview` (`web/src/pages/dashboard/admin/ReferralTrustReview`) |

Each route is also declared as a navigation entry in `web/src/config/featureRegistry.ts` with `domain: 'referral'` (owner entry `owner.referrals`, role `owner`; admin entries `admin.referrals`, `admin.referral-codes`, `admin.referral-local-leads`, `admin.referral-import-routes`, `admin.referral-marketing`, `admin.referral-trust`, role `admin`).

### 6.2 Backend API routes (in `backend/routes/referralRoutes.js`, prefix `/api/referrals`)

Representative endpoints (authorization in parentheses; `OPERATOR_ROLES`/`ADMIN_ROLES`/`TRUST_DECISION_ROLES` are defined at the top of the file):

- Public/owner reads: `POST /validate`, `GET /codes/:code`, `POST /events`, `GET /wallets/:userId` (self-or-admin), `POST /coupons/apply`, `POST /coupons/redeem` (authenticated).
- Admin/operator writes: `POST|GET /campaigns`, `PATCH /campaigns/:id`, `POST|GET /codes`, `POST|GET /coupons`, `POST /share-assets`.
- Local marketplace: `GET /local-marketplace/rules`, `POST /local-marketplace/intent`, `POST|GET /local-marketplace/leads`, `POST /local-marketplace/referral-bundles`, `POST /local-marketplace/leads/:leadEventId/qualify` (operator), `POST /local-marketplace/share-kit`.
- Imports/container: `GET /import-campaigns/rules`, `POST|GET /import-campaigns/routes`, `GET /import-campaigns/routes/:routeKey/status`, `POST /import-campaigns/routes/:routeKey/capacity`, `POST /import-campaigns/referral-bundles`, `POST /import-campaigns/leads`, `POST /import-campaigns/leads/:leadEventId/qualify` (operator), `POST /import-campaigns/share-kit`.
- Marketing: `GET /marketing/rules`, `POST /marketing/campaign-kits|seo-pages|channel-messages|proof-stories|faqs`, `GET /marketing/assets`, `PATCH /marketing/assets/:assetId/status`, `POST /marketing/analytics/suggestions`.
- Trust/audit: `GET /trust/rules`, `POST /trust/risk-checks`, `POST|GET /trust/review-cases`, `PATCH /trust/review-cases/:caseEventId/decision` (trust-decision), `POST /trust/wallet-transactions/:transactionId/hold`, `GET /trust/benefits/:transactionId/explain`, `POST|GET /trust/disputes`, `PATCH /trust/disputes/:disputeEventId/resolve` (trust-decision), `GET /trust/audit-export`.
- Wallet writes: `POST /wallets/transactions` (operator), `PATCH /wallets/transactions/:id/status` (admin).
- Channels/agents: `POST /agent/triage|execute`, `GET /agent/tools`, `POST /channels/:channel/inbound`, `POST /channels/:channel/share-kit`, and per-channel webhooks (WhatsApp/Telegram/Facebook/Instagram verify + inbound).
- Admin events: `GET /admin/events` (admin).

---

## 7. Monitoring and observability hooks present in code

| Hook | Location | Notes |
|------|----------|-------|
| `GET /api/health` | `backend/server.js` (~line 130) | Returns `status: UP`, Supabase health (probes `domain_events` pending backlog), `sentry.enabled` (from `SENTRY_DSN`), OCR provider availability, and a metrics snapshot. Suitable as the production smoke health check. |
| Metrics hub | `backend/services/metrics.js` (consumed in `backend/server.js` via `metricsHub.getSnapshot()`) | Snapshot embedded in `/api/health`. |
| Sentry error capture | `backend/middleware/errorMiddleware.js` (`Sentry.captureException`), `backend/services/eventBus/eventWorker.js`, `backend/services/ai/sentry.js` (DSN from `SENTRY_DSN`) | Active when `SENTRY_DSN` is set. |
| Referral audit/event trail | `backend/services/referral/referralEngineService.js` (`recordReferralEvent`) writes to `referral_events`; admin decisions to `referral_admin_audit_events` | Every campaign/code/coupon/wallet action records a referral event — primary in-app observability for the referral domain. |
| Audit export with checksum | `backend/services/referral/referralTrustReviewService.js` (`exportAuditTrail`, `checksum()` = SHA-256 over the export payload) exposed at `GET /api/referrals/trust/audit-export` | Provides tamper-evident audit export for compliance. |

No Prometheus/Datadog exporter was found; observability is `/api/health` + metrics snapshot + Sentry + the referral event/audit tables.

---

## 8. Data cleanup notes for UAT artifacts

UAT runs on staging (`eoyenigwevnxwwhyhaer`) only. Before/after production promotion, ensure staging-only artifacts do not leak:

- **UAT accounts**: `uat-admin@carup.local` and `uat-owner@carup.local` are seeded only by `backend/scripts/seed-uat-referral-users.mjs` (refuses to run when `NODE_ENV=production`; refuses any non-staging Supabase ref). These must **not** exist in production. Confirm absence as part of go-live.
- **UAT test records**: campaigns/codes/coupons/leads/routes/disputes created during F2–F3 (e.g. `CarUp Referral Test — Local`, `TESTLOCAL2026`, `WELCOME10`, Toyota Aqua lead, Japan→Zimbabwe routes) live in staging. They should not be copied to production. Production smoke testing must not create real rewards (goal-loop Phase G).
- **Compromised legacy UAT passwords**: documented in the seed script as committed/logged while staging browser protection was disabled. They are invalidated by rotation; never reuse. No password value is in this document.
- **Preservation**: referral services contain **no** `DELETE`/`TRUNCATE` against referral tables (verified by grep across `backend/services/referral/*.js`). Cleanup of UAT data, if required, must be a deliberate, owner-approved, staging-scoped operation — never run against production.

---

## 9. Production smoke-test checklist

Run after deploy, non-destructive, against production. Do **not** create production rewards for smoke testing without a controlled test tenant and explicit approval (goal-loop Phase G).

- [ ] **Health**: `GET /api/health` returns `status: UP`, `supabase.status: healthy`, and `sentry.enabled: true` (if Sentry configured). — *executable post-deploy.*
- [ ] **Public code validation**: `POST /api/referrals/validate` (and `GET /api/referrals/codes/:code`) returns a structured valid/invalid response (200 valid / 422 invalid) without leaking internals. — *executable post-deploy with a known production code.*
- [ ] **Owner wallet read**: authenticated owner `GET /api/referrals/wallets/:userId` for their own ID returns their wallet; another user's ID is rejected (`assertSelfOrAdmin`). — *executable post-deploy with a real production owner session.*
- [ ] **Admin list reads**: admin `GET /api/referrals/campaigns`, `/codes`, `/coupons`, `/local-marketplace/leads`, `/import-campaigns/routes`, `/trust/disputes` return paginated lists. — *executable post-deploy with a real production admin session.*
- [ ] **Marketing/trust rules reads**: `GET /api/referrals/marketing/rules` and `GET /api/referrals/trust/rules` return the rule definitions; `GET /api/referrals/trust/audit-export` returns an export with a checksum. — *executable post-deploy.*
- [ ] **Route rendering**: `/dashboard/referrals` and all six `/admin/referrals*` routes render for the correct role and 403/redirect for the wrong role. — *executable post-deploy in browser.*
- [ ] **Absence of staging identifiers/secrets**: production responses, web bundle, and mobile bundle contain no staging ref (`eoyenigwevnxwwhyhaer`), no `uat-*@carup.local` accounts, and no service-role key. — *executable post-deploy via bundle grep + DB check.*

> All checklist items are designed to run against production **post-deploy under owner approval**. They are not the staging UAT; the staging UAT evidence (Phases F1–F4) is **PENDING — requires staging UAT execution (blocked on staging secret)**.

---

## 10. Go / No-Go criteria

**GO requires all of the following:**

1. Migration parity confirmed: production has the `016` schema (9 referral tables, RLS enabled) matching staging — **PENDING (requires owner to confirm against production under approval)**.
2. All required production env vars (Section 3) set with owner-held secrets; no service-role key in any client bundle.
3. Staging UAT (Phases F1–F4) executed and PASS, with correct wallet attribution proven (owner of bundle code = wallet transaction owner) — **PENDING — requires staging UAT execution (blocked on staging secret)**.
4. Zero open critical/high defects (goal-loop F5).
5. Release-candidate regression green (goal-loop F6: web `tsc`, web unit, mobile `ts:check`, backend referral/auth/e2e tests, web build) — **must be attached to the release PR**.
6. Rollback runbook reviewed and ready (`docs/referral-ai-engine/REFERRAL_ENGINE_ROLLBACK_RUNBOOK.md`).
7. Explicit owner approval recorded; approved head SHA unchanged at merge (goal-loop Phase G step 1).

**NO-GO if any of the following:**

- Wrong wallet owner on any reward, privilege escalation (owner→admin), cross-tenant exposure, duplicate rewards, lost attribution, or any production data mutated by UAT.
- Service-role key, UAT password/hash/token, or staging identifier present in a client bundle or committed.
- Required regression suite red, or any open critical/high defect.
- Production migration parity unverified, or migration would run un-reviewed.
- No explicit owner approval, or the approved head SHA has moved.

> Authoring-time recommendation: **NO-GO until the staging UAT is executed** (the deciding evidence in criteria 1 and 3 is PENDING on the staging secret).
