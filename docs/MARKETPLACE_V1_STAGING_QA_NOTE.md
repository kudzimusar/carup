# Marketplace v1 — Staging QA Note (PR #73)

## 1. PR status & head SHA
- **PR:** #73 — https://github.com/kudzimusar/carup/pull/73
- **State:** OPEN, not draft · **mergeable = MERGEABLE / CLEAN** (docs-only conflict already resolved)
- **Head:** `feature/marketplace-v1-production-integration` @ **`8da525c644ac907c63fa686c4e036a59546ae183`**
- **Base:** `main` · +4949 / −165 · 47 files
- **CI:** all 4 Vercel deployments **passed** ("Deployment has completed"); Vercel Preview Comments pass.
- **Do not merge automatically.**

## 2. Vercel preview URLs (branch `feature/marketplace-v1-production-integration`, all DEPLOYED)
| Project | Preview URL |
|---|---|
| **carup** (web) | https://carup-git-feature-marketplace-v1-produc-08de6e-pay-pass-project.vercel.app |
| **carup-staging** (web staging) | https://carup-staging-git-feature-marketplace-v-f18b77-pay-pass-project.vercel.app |
| **carup-backend** | https://carup-backend-git-feature-marketplace-v-49d4b2-pay-pass-project.vercel.app |
| **carup-backend-staging** | https://carup-backend-staging-git-feature-marke-6e59d7-pay-pass-project.vercel.app |

> Use **carup-staging** (web) + **carup-backend-staging** for staging QA. Confirm the web preview's `VITE_API_URL` targets a backend whose Supabase has the migration below applied. Backend smoke (no migration needed):
> `curl -s <backend-staging>/api/marketplace/listings | head` · `curl -s <backend-staging>/api/marketplace/categories` · `curl -s <backend-staging>/api/marketplace/parts`

## 3. Migration to apply
- **File:** `database/migrations/20260616120000_marketplace_v1_inquiries.sql`
- Creates `marketplace_inquiries` + `marketplace_listing_reports` (RLS enabled, `anon`/`authenticated` REVOKED, `service_role` only, indexed). **Idempotent** (`to_regclass` + `IF NOT EXISTS`) — safe to re-run. Rollback notes are in the file header.

## 4. Exact apply command (staging Supabase)
Apply to the **same Supabase project the `carup-backend-staging` deployment uses**. Use the staging DB URL from `.env.staging` (`SUPABASE_DB_URL`) — **do not** use `scripts/run-sql.js` or the `deploy-migration-0XX.js` hardcoded fallback (those carry a hardcoded prod credential — see §7).

**Option A — psql (recommended, exact):**
```bash
# SUPABASE_DB_URL = the STAGING pooler connection string from .env.staging
export $(grep -E '^SUPABASE_DB_URL=' .env.staging | xargs)
psql "$SUPABASE_DB_URL" -f database/migrations/20260616120000_marketplace_v1_inquiries.sql
```

**Option B — Supabase Dashboard → SQL Editor:** open the staging project → SQL Editor → paste the full contents of `database/migrations/20260616120000_marketplace_v1_inquiries.sql` → Run.

**Project-approved pattern (if a script is preferred):** mirror `scripts/deploy-migration-013.js` (reads `process.env.SUPABASE_DB_URL`, `pg.Client`, runs one migration file) but point it at the new file and **provide `SUPABASE_DB_URL` via env — no hardcoded fallback**.

**Verify applied:**
```sql
select to_regclass('public.marketplace_inquiries'), to_regclass('public.marketplace_listing_reports');
-- both should be non-null
```

## 5. Manual QA checklist

### Public marketplace
- [ ] `/marketplace` loads; vehicle cards render; trust/condition chips work.
- [ ] Search + filters (make, price, category chip, sort) update the URL and results; refresh + back/forward preserve state.
- [ ] No private seller name/phone on cards (private sellers show "Private seller").
- [ ] "Ask CarUp AI" opens; returns guidance (or an honest `AI unavailable` note) — never errors.

### Listing detail
- [ ] Open a card → detail page shows **Trust summary** (badges from backend only), **All-in cost estimate**, **Safety warnings**.
- [ ] A listing with no governed signals shows "No public trust badges yet" — frontend invents nothing.
- [ ] PartSentry/verified badges appear only when backend supplies them.

### Inquiry
- [ ] Detail → "Send inquiry" / "Request inspection": guest must provide email or phone; submit succeeds (after migration).
- [ ] Signed-in buyer (no typed contact) → inquiry still captures a reply channel (enriched from profile).
- [ ] Off-platform-payment language in the message flags risk (admin sees `watch`).

### Referral capture
- [ ] Open `/marketplace?ref=CARUP-TEST&campaign=WINTER`, then submit an inquiry → inquiry carries `referral_code=CARUP-TEST`, `campaign_code=WINTER`, `source_channel=web` (verify in admin inquiries / DB). No reward is created by marketplace.

### Seller dashboard
- [ ] Owner → **My Listings** shows the **Marketplace inquiries** card (own listings' inquiries only) after migration; create/edit/status flows still work (unchanged).

### Admin moderation
- [ ] `/admin/moderation` (admin) → **Command Center**: analytics counts; Listings tab with approve / suppress / reject / flag-risk / clear-risk / request-evidence (suppress/reject/flag **require a reason**).
- [ ] Open the admin detail of a **suppressed/flagged/rejected** listing → it loads (does **not** 404) and shows the true `public_status`.
- [ ] AI moderation summary button returns a summary (or deterministic fallback).
- [ ] Inquiries tab: status changes (Contacted/Qualified/Spam) after migration; before migration shows the "migration not applied" note (no crash).

### Parts gated v1
- [ ] `/marketplace/parts` reachable (header link + footer). Renders parts cards when data exists; otherwise a governed onboarding state + "Request a parts quote".
- [ ] "Verified Parts" badge appears **only** for public-card-eligible parts; suppressed/suspicious parts render the card **without** the badge.

### Garage/Service gated v1
- [ ] `/marketplace/services` reachable. Renders service cards or a governed onboarding state + "Request a service / inspection".

### Diaspora / import / container inquiry
- [ ] `/marketplace` → "Import to Zimbabwe" inquiry (types: import_quote_request / container_space_interest / diaspora_*); submit creates an inquiry. **No shipment/container fields are accepted or stored** (verify the stored row has none).

### Mobile smoke (Expo — not on Vercel)
- [ ] Run the Expo app with `EXPO_PUBLIC_API_URL=<carup-backend-staging preview>` (set `EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK` only for dev).
- [ ] Marketplace tab loads listings from `/api/marketplace/listings` (canonical, not legacy `/api/vehicles`).
- [ ] Open a vehicle → **Trust Summary** card shows backend badges; "Express Interest" sends an inquiry (signed-in) or prompts sign-in (guest).

## 6. Known limitations — should NOT block v1
- **Parts & Garage/Service are gated v1** (governed surface + cards + governance + inquiry); no parts/garage **inventory backend** exists yet, so lists are empty/onboarding until inventory is added (plan §3 permits "placeholder intentionally gated").
- **Seller AI listing-builder & submit-for-review UI** not wired into the create form (backend AI endpoints exist).
- **Verified-review write-flow** is contract/placeholder only (§20).
- **Mobile** verified by `tsc` + inspection; no automated mobile e2e harness in the repo.
- **PartSentry write-side approval** still depends on **PR #11** (read-side suppression is correct and fail-closed here).
- **Per-seller identity→passport_verified bridge** (PR #72 Workstream G) deferred; `verification_summary.identity_status` defaults conservative.
- SafePay escrow / wallet payout / logistics / AI negotiation / dealer billing intentionally deferred (contracts only).

## 7. Limitations that SHOULD block merge if human QA fails
- **Migration not applied** to the staging Supabase the backend targets → inquiry create / admin & seller inquiry lists / reports fail. **Apply §4 and re-verify** before sign-off.
- Any **trust/PartSentry badge rendering without backend governance** (e.g., a suppressed/suspicious part showing "Verified Parts", or the frontend inventing a badge) — hard governance violation.
- **Admin cannot open a suppressed/flagged/rejected listing** (must not 404) — moderation would be unusable.
- **Inquiry loses referral attribution** or a **signed-in inquiry leaves the seller with no reply channel**.
- Any **public response leaking** owner_id / tenant_id / guest contact / seller_id / mechanic_id / raw risk internals.
- **Diaspora inquiry persisting shipment/container data** (PR #58 boundary).
- Privilege check regressions: a **tenant-scoped role reaching global marketplace moderation/admin** (must be platform-role gated, fail-closed).

### Pre-existing security note (out of scope for PR #73, flag separately)
`scripts/run-sql.js` and the fallback in `scripts/deploy-migration-0XX.js` contain a **hardcoded production Postgres credential**. This predates PR #73 and is **not** modified here. Do not use those scripts for staging; recommend rotating that credential and removing the hardcoded fallback in a separate security PR.

---
**Final status:** READY FOR HUMAN QA on staging once the §4 migration is applied. Do not merge automatically.
