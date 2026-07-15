# CarUp Referral Engine V1 — Acceptance and Production Closure Ledger

> **Single source of truth.** Do not create parallel Referral V1 acceptance or closure reports.

## Scope lock

- Repository: `kudzimusar/carup`
- Programme in scope: **Referral Engine V1 only**
- Full-Vision / Wave A: **excluded**
- PR #105: **excluded; do not merge, rebase, deploy, or migrate**
- Production authorization phrase: `AUTHORIZE REFERRAL V1 PRODUCTION CUTOVER`
- Production changes are prohibited during Stages 0–8.
- No real customer contacts, real rewards, external-provider activation, Docker installation, or Wave A migrations are authorized.

## Stage ledger

| Stage | Status | Production changed |
|---|---|---|
| 0 — Freeze and verify current state | **PASS** | No |
| 1 — Current-main automated regression | **PASS** | No |
| 2 — Staging schema and account readiness | **PASS** | No |
| 3 — Staging admin web acceptance | **PASS** (P2 staging-config finding; Stage 9 gate) | No |
| 4 — Owner/invitee correct-attribution journey | BLOCKED — security precondition (active Stage 2 token) | No |
| 5 — Import/container referral journey | NOT STARTED | No |
| 6 — Simulated channel-attribution integration | NOT STARTED | No |
| 7 — Adversarial security gate | NOT STARTED | No |
| 8 — Owner physical-device mobile gate | NOT STARTED | No |
| 9 — Read-only production preflight | LOCKED | No |
| 10 — Owner-authorized migration and cutover | LOCKED | No |
| 11 — Controlled production acceptance | LOCKED | No |
| 12 — Production test-data cleanup | LOCKED | No |
| 13 — Documentation and formal closure | LOCKED | No |

---

# Stage 0 — Freeze and verify current state

- Executed: `2026-07-15`
- Gate result: **PASS**
- Production changed: **No**
- Database writes: **None**
- Deployments promoted/re-aliased: **None**
- PRs merged/rebased: **None**

## 1. Exact current main SHA

```text
6214f3dd7aef7a24d33170009164d8f4932ab429
```

Commit:

```text
docs(phase7c): production cutover completion report (#116)
```

The commit is documentation-only and explicitly records that no application code, migrations, environment variables, or deployment aliases changed.

## 2. Repository and working-tree state

- GitHub default branch: `main`
- Remote `main` frozen at the exact SHA above.
- This execution used atomic GitHub API operations rather than a mutable local checkout; therefore there is no uncommitted local working tree in this execution context.
- Stage 0 evidence branch: `docs/referral-v1-stage0-baseline`
- Branch base: exact `main` SHA `6214f3dd7aef7a24d33170009164d8f4932ab429`
- Intended branch delta: this ledger file only.

## 3. Referral-related PR disposition

### Current open referral PR search

Only one open pull request matched the referral scope:

| PR | State | Merged | Mergeable | Disposition |
|---|---|---:|---:|---|
| #105 — `feat(referral): Wave A Identity Attribution and Universal Widget` | Open | No | No | **Historical Full-Vision Wave A; excluded from V1; do not merge, rebase, deploy, or migrate** |

### V1 release baseline

| PR | State | Merged | Disposition |
|---|---|---:|---|
| #88 — `feat(referrals): Referral Engine Release Candidate` | Closed | Yes | Merged V1 implementation and historical acceptance evidence; must be rerun against current `main` |

No other open referral pull request was returned by the repository search.

## 4. Current-main Vercel deployment checks

GitHub's combined status for current `main` reports all four Vercel contexts as `success`.

| Environment | Tier | Vercel project | Current-main deployment/status identifier | Status |
|---|---|---|---|---|
| Staging | Frontend | `carup-staging` | `HbrVKVVFdf9viUrzqTy5VjZo2Cmk` | **success** |
| Staging | Backend | `carup-backend-staging` | `G5cUsPJQN6j2LX1Zh5mLwr8FLXvE` | **success** |
| Production | Frontend | `carup` | `657vEa7n3zxwr4LywiAH8WdhBzde` | **success** |
| Production | Backend | `carup-backend` | `AWys3Qth5ngPN8B4GBpwunmEdkqf` | **success** |

Canonical application URLs recorded in the repository:

```text
Staging frontend:  https://carup-staging.vercel.app
Staging backend:   https://carup-backend-staging.vercel.app
Production frontend: https://carup.vercel.app
Production backend:  https://carup-backend.vercel.app
```

Runtime-health continuity evidence:

- Latest staging acceptance evidence records backend `/api/health` HTTP 200 with Supabase healthy, web HTTP 200, staging backend baked into the frontend bundle, and zero production references in that bundle.
- Latest production cutover evidence records backend health HTTP 200 with Supabase healthy and frontend HTTP 200.
- The current-main commit is documentation-only and states that it did not change runtime code, environment variables, or deployment aliases.

## 5. Supabase project-binding proof

Direct Supabase project inventory:

| Environment | Project name | Project ref | API URL | Region | Project health |
|---|---|---|---|---|---|
| Staging | `carup-staging` | `eoyenigwevnxwwhyhaer` | `https://eoyenigwevnxwwhyhaer.supabase.co` | `ap-southeast-2` | **ACTIVE_HEALTHY** |
| Production | `CarUp` | `vhmnajoeicasaigiophh` | `https://vhmnajoeicasaigiophh.supabase.co` | `ap-south-1` | **ACTIVE_HEALTHY** |

Binding conclusion:

- Staging deployment pair is `carup-staging` + `carup-backend-staging`, with direct project ref `eoyenigwevnxwwhyhaer`.
- Production deployment pair is `carup` + `carup-backend`, with direct project ref `vhmnajoeicasaigiophh`.
- No production binding or environment value was modified during Stage 0.

## 6. Read-only referral schema inventory

The following read-only catalogue query was executed separately against staging and production:

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       count(p.policyname)::int as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = n.nspname
 and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname like 'referral\_%' escape '\'
group by c.relname, c.relrowsecurity
order by c.relname;
```

### Staging — `eoyenigwevnxwwhyhaer`

Count: **9**

| Table | RLS enabled | Policy count |
|---|---:|---:|
| `referral_admin_audit_events` | Yes | 0 |
| `referral_campaigns` | Yes | 0 |
| `referral_codes` | Yes | 0 |
| `referral_coupon_redemptions` | Yes | 0 |
| `referral_coupons` | Yes | 0 |
| `referral_events` | Yes | 0 |
| `referral_share_assets` | Yes | 0 |
| `referral_wallet_transactions` | Yes | 0 |
| `referral_wallets` | Yes | 0 |

Interpretation: RLS is enabled on all nine foundation tables. Zero policies preserves the existing server-owned, deny-by-default posture for direct client access.

### Production — `vhmnajoeicasaigiophh`

Count: **0**

```text
No public referral_* tables exist.
```

Production Referral V1 migration has not been applied.

## 7. PR #105 exclusion confirmation

```text
CONFIRMED EXCLUDED
```

PR #105 remains open, unmerged, and not mergeable. No merge, rebase, deployment, migration, branch update, or code port was performed.

## 8. Stage 0 evidence summary

```text
Stage: Stage 0 — Freeze and verify current state
Exact SHA: 6214f3dd7aef7a24d33170009164d8f4932ab429
Environment: GitHub main + Vercel staging/production status + Supabase staging/production read-only inventory
Actions completed: main freeze; PR inventory; deployment-status capture; project-binding verification; read-only schema inventory; ledger creation
Tests run: no application tests in Stage 0
Pass totals: 4/4 Vercel contexts success; 2/2 Supabase projects ACTIVE_HEALTHY; staging 9/9 referral tables with RLS; production 0 referral tables
Failures: none
Defects: none opened in Stage 0
Data created: documentation ledger only
Production changed: No
Evidence recorded: this file
Gate result: PASS
Next single action: begin Stage 1 current-main automated regression on exact SHA 6214f3dd7aef7a24d33170009164d8f4932ab429
```

## Stage 0 decision

# PASS

The repository, deployment statuses, environment bindings, referral schema state, and PR boundary are frozen and recorded. Production remains unchanged. Stage 1 may begin only from the exact approved SHA above.

---

# Stage 1 — Current-main automated regression

- Executed: `2026-07-15`
- Gate result: **PASS**
- Production changed: **No**
- Database writes: **None**
- Deployments promoted/re-aliased: **None**
- PRs merged/rebased: **None**

## 1. Execution environment

```text
Exact SHA under test: 6214f3dd7aef7a24d33170009164d8f4932ab429
Checkout: fresh detached git worktree of the frozen SHA (clean tree, no local modifications)
Pre-flight: origin/main re-fetched and confirmed still exactly 6214f3dd7aef7a24d33170009164d8f4932ab429 — no Stage 0 refresh required
Machine: macOS (Darwin 21.6.0), local release-engineering workstation
Node: v20.20.2   npm: 10.8.2   Playwright: 1.60.0 (chromium-1223 installed)
```

Canonical CI parity reference: `.github/workflows/referral-ci.yml` (Referral Engine CI). That workflow ran on `3e37ba0440672189febc0edf32237dfe4ed5855f` (this ledger branch — tree = frozen main + this documentation file only) on 2026-07-15 with conclusion **success**, providing independent ubuntu/node-20 confirmation of the same suites.

## 2. Baseline commands, exit codes and totals

Backend suites require the same non-secret dummy environment values that `referral-ci.yml` uses to satisfy import-time checks (the suites self-mock the database; no live Supabase is contacted):

```text
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=dummy_ci_key_not_a_secret
JWT_SECRET=dummy_ci_jwt_secret_not_a_secret
NODE_ENV=test
```

| # | Command | Exit | Result |
|---|---|---:|---|
| 1 | `npm ci` | 0 | 1463 packages installed; 2 upstream deprecation warnings (`uuid@7.0.3`, `recharts@2.15.4`); `npm audit` advisory: 28 vulnerabilities (3 low / 18 moderate / 7 high) — dependency-level, pre-existing, non-gating |
| 2 | `npm exec --workspace=web -- tsc -p tsconfig.app.json --noEmit` | 0 | 0 TypeScript errors |
| 3 | `npm run test:unit --workspace=web` (canonical single-worker run: `npx vitest run --maxWorkers=1` in `web/`) | 0 | **63 files passed, 506/506 tests passed, 0 failed, 0 skipped** |
| 4 | `npm run ts:check --workspace=mobile` | 0 | 0 TypeScript errors |
| 5 | `node --test` per file: `backend/tests/auth-login.test.js`, all 16 `backend/tests/referral-*.test.js`, plus `backend/tests/seed-uat-referral-users.test.js` (18 files, CI env above) | 0 | **171/171 tests passed, 0 failed, 0 skipped, 0 cancelled** |
| 6 | `node --check backend/scripts/uat/referral-uat-journeys.mjs` | 0 | UAT runner syntax valid |
| 7 | `npm run build --workspace=web` | 0 | Production build success in 46.3s; only warning: standing Rollup chunk-size advisory (chunks > 500 kB) |
| 8 | `npx playwright test e2e/referral-staging.spec.ts --workers=1` (in `web/`, against local Vite server) | 0 | **2 passed, 2 skipped, 0 failed** (16s) |
| 9 | `npx vitest run src/config/featureRegistry.route-validation.test.ts` (in `web/`) | 0 | 7/7 passed — every registered referral route present in `App.tsx` |
| 10 | `git diff --check` (clean worktree at frozen SHA) | 0 | clean |

Total across executed suites: **679 distinct tests passed, 0 failed, 2 credential-gated Playwright skips** (web unit 506 + backend 171 + Playwright 2; the explicit 7/7 feature-registry run in row 9 re-executes tests already contained in the web unit 506 and is not double-counted).

## 3. Referral browser-test discovery

```bash
find web/e2e -name 'referral-*.spec.ts' -print
```

```text
web/e2e/referral-staging.spec.ts
```

This is the only referral Playwright spec at this SHA. It belongs to `web/playwright.config.ts` (`testDir: ./e2e`, chromium, no `webServer` block — server started externally). Executed with one worker against a locally served frontend of the frozen SHA:

- `login page renders the form` — **pass**
- `invalid credentials surface a readable, accessible inline alert` — **pass**
- `admin logs in and reaches the referral admin area` — **skipped by design** (requires `E2E_UAT_ADMIN_*` staging credentials; exercised for real in Stage 3)
- `owner logs in and sees the Refer & Earn wallet page` — **skipped by design** (requires `E2E_UAT_OWNER_*` staging credentials; exercised for real in Stage 3/4)

## 4. Current equivalents of the required auxiliary gates

| Required gate | Current equivalent at this SHA | Result |
|---|---|---|
| Referral route-smoke | `backend/tests/referral-engine-route-smoke.test.js` (mounts real `createReferralRouter` over real HTTP with in-memory services; verifies route registration + public/operator/webhook-secret auth behaviour) | **pass** (within the 171) |
| Referral E2E-stack | `backend/tests/referral-engine-e2e-stack.test.js` (full production service-graph wiring, attribution → reward → trust → audit chain, in-process) | **pass** (within the 171) |
| Referral UAT guard | `backend/tests/referral-uat-guard.test.js` + `backend/tests/referral-uat-auth-guard.test.js` (staging-target guard PASS/FAIL matrix incl. the historical P1 production-host laundering case; switch-role escalation guard) | **pass** (within the 171) |
| Feature Registry referral route validation | `web/src/config/featureRegistry.route-validation.test.ts` — referral routes `/dashboard/referrals`, `/admin/referrals`, `/admin/referrals/{codes,local-leads,import-routes,marketing,trust}` all registered and routed | **pass** (7/7) |
| Secret scanning | Exact `ci.yml` `secret-scan` fallback grep (`service_role`, private-key blocks, `sk-…` tokens over js/ts/tsx/json/sql, excluding `node_modules`/`dist`) | **pass** — 120 matches, every one a literal `service_role` role-name string in SQL migrations/backend RLS code; **zero credentials, zero private keys, zero token-shaped matches** |
| Client-bundle staging/production reference check | **No bundle-check script exists at this SHA** (verified). Equivalent manual scan over freshly built `web/dist`: no `service_role`/`SERVICE_ROLE` match, no private-key material, no `sk-…` token, no staging Supabase ref (`eoyenigwevnxwwhyhaer`), no production Supabase ref (`vhmnajoeicasaigiophh`) | **pass** (see note N3) |
| `git diff --check` | Run in the clean frozen-SHA worktree | **pass** (exit 0) |

## 5. Notes and observations (non-gating)

- **N1 — Backend env prerequisite.** A bare `node --test backend/tests/referral-*.test.js` without the CI dummy env fails at module load (`backend/db/supabase.js` throws on missing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — only `referral-engine-route-smoke.test.js` transitively imports it). With the canonical CI dummy values the full set passes 171/171. Not a product defect; recorded so future gates use the canonical invocation.
- **N2 — Local vitest parallelism flake (not a defect).** On this workstation, the default multi-worker `vitest run` intermittently times out (5s per-test budget) in two non-referral admin-console test files (`FeatureGovernanceConsole.test.tsx`, `IdentityVerificationCaseManagement.test.tsx`) under jsdom worker contention. Both files pass 38/38 in isolation, the full suite passes 506/506 single-worker, and Referral Engine CI passed the identical tree on ubuntu on 2026-07-15. Classified as local-hardware resource contention; canonical evidence is the single-worker run plus CI.
- **N3 — Fallback backend URL in bundle (by design).** The built bundle contains exactly one occurrence of `https://carup-backend.vercel.app` — the documented last-resort fallback in `web/src/lib/apiClient.ts` (used only when `VITE_API_URL` is unset and the host is not local; deployed staging sets `VITE_API_URL` to the staging backend). It is a public URL, not a secret. Recorded for completeness.
- **N4 — First Playwright attempt flake.** On the first (cold) run the login-render test hit the 30s timeout while the dev server compiled, then passed on automatic retry (suite exit 0). The recorded warm run is clean: 2 passed / 2 skipped in 16s.

## 6. Defects

```text
P0: 0
P1: 0
P2/P3 opened: 0 (observations N1–N4 recorded above; none is a product defect at this SHA)
```

## 7. Stage 1 evidence summary

```text
Stage: Stage 1 — Current-main automated regression
Exact SHA: 6214f3dd7aef7a24d33170009164d8f4932ab429
Environment: clean local worktree (macOS/node 20.20.2) + Referral Engine CI (ubuntu/node 20) on the identical tree
Actions completed: full baseline suite, referral browser-spec discovery and execution, route-smoke/e2e-stack/UAT-guard/feature-registry/secret-scan/bundle-scan/git-diff gates
Commands/tests run: 10 gate commands recorded above with exact invocations
Pass totals: web unit 506/506; backend referral+auth+seed 171/171; Playwright referral 2 passed; feature-registry 7/7; all TypeScript checks 0 errors; web production build success
Failures: 0 (in canonical invocations)
Skips: 2 Playwright journeys, credential-gated by design (covered in Stages 3–4)
Defects: none (P0 = 0, P1 = 0)
Data created: none (no database contacted; self-mocked suites only)
Production changed: No
Evidence recorded: this file
Gate result: PASS
Next single action: begin Stage 2 staging schema and account readiness against Supabase project eoyenigwevnxwwhyhaer
```

## Stage 1 decision

# PASS

Zero test failures, zero TypeScript errors, successful web production build, successful mobile type-check, all expected referral routes present (backend route-smoke + web feature registry), and no browser/mobile secret exposure. Production remains unchanged. Stage 2 may begin.

---

# Stage 2 — Staging schema and account readiness

- Started: `2026-07-15` (blocked mid-stage on staging DB access; resolved same day by owner-provided, to-be-rotated Supabase Management API access)
- Completed: `2026-07-15`
- Gate result: **PASS**
- Production changed: **No** (read-only SELECT inventory only)
- Staging data written: **3 rows in `public.users` only** (the REFV1 accounts; no referral data)

## 1. Completed Stage 2 checks (no database access required)

| Check | Method | Result |
|---|---|---|
| Staging backend health | `GET https://carup-backend-staging.vercel.app/api/health` | **HTTP 200**, `status: UP`, `supabase.status: healthy` |
| Staging frontend availability | `GET https://carup-staging.vercel.app/` | **HTTP 200** |
| Staging frontend API target | Downloaded deployed bundle `assets/index-CmHlN0Cs.js` (2,319,950 bytes) | **staging backend `https://carup-backend-staging.vercel.app` baked (7 occurrences)** — `VITE_API_URL` correctly set per Vercel project |
| Production references in staging bundle | Same bundle scan | 1 occurrence of `https://carup-backend.vercel.app` — the documented last-resort fallback constant in `apiClient.ts` (inert when `VITE_API_URL` is set; same constant present in the local frozen-SHA build; Stage 1 note N3) |
| Service-role material in staging client bundle | Same bundle scan | **0 matches** for `service_role`/`SERVICE_ROLE`; **no Supabase project refs** (neither `eoyenigwevnxwwhyhaer` nor `vhmnajoeicasaigiophh`); **no JWT-shaped tokens at all** in the bundle |
| UAT tooling refuses production (live) | `STAGING_API_BASE_URL=https://carup-backend.vercel.app` + syntactically-dummy creds → `node backend/scripts/uat/referral-uat-journeys.mjs` | **Refused before any network call**: `ABORT: not staging — Refusing: API host "carup-backend.vercel.app" is not recognisable as the staging environment`, exit 1 |
| UAT tooling guard unit matrix | Stage 1: `backend/tests/referral-uat-guard.test.js` incl. historical P1 production-host-laundering case | **pass** |

Stage 0's read-only inventory (recorded above) already confirmed the nine `referral_*` tables exist on staging with RLS enabled on all nine and zero client policies (deny-by-default).

## 2. Access resolution (historical blocker, closed)

The stage was initially blocked: the claude.ai Supabase connector was bound to the wrong Supabase account, the CLI lacked the staging DB password, the only local env credentials pointed at production (deliberately unused), and keychain token extraction was correctly refused by local permission policy. The owner resolved this by providing a Supabase Management API access token scoped to the CarUp organization (`tzmmjpcgplzjzktuwsad`) **with a commitment to rotate all provided credentials after closure**. Access was verified to show exactly the two CarUp projects (`eoyenigwevnxwwhyhaer` carup-staging, `vhmnajoeicasaigiophh` CarUp, both ACTIVE_HEALTHY), and the staging ref was explicitly confirmed before any SQL ran.

All database inspection ran through a local helper that (a) allows only the two CarUp refs, (b) rejects any statement that is not a single `SELECT`/`WITH`, and (c) calls the Management API `database/query` endpoint with `read_only: true`. No token, key, or password appears in the ledger, the repository, chat output, or logs.

## 3. Staging schema inspection — `eoyenigwevnxwwhyhaer` (read-only)

### 3.1 Tables and RLS

Exactly **nine** `referral_*` tables exist (catalogue query, no extras):

| Table | RLS enabled | RLS forced | Client policies |
|---|---:|---:|---:|
| `referral_admin_audit_events` | Yes | No | 0 |
| `referral_campaigns` | Yes | No | 0 |
| `referral_codes` | Yes | No | 0 |
| `referral_coupon_redemptions` | Yes | No | 0 |
| `referral_coupons` | Yes | No | 0 |
| `referral_events` | Yes | No | 0 |
| `referral_share_assets` | Yes | No | 0 |
| `referral_wallet_transactions` | Yes | No | 0 |
| `referral_wallets` | Yes | No | 0 |

ACL posture (from `pg_class.relacl`): standard Supabase grants exist for `anon`/`authenticated`/`service_role`, but with **RLS enabled and zero policies every direct client request is deny-by-default**; only the server-owned `service_role` path (RLS-bypassing by Supabase design, used exclusively by the Express backend) can operate. This is the expected server-owned posture.

### 3.2 Constraints (46 total via `pg_constraint`) — required proofs

| Required verification | Constraint evidence |
|---|---|
| Referral-code uniqueness | `referral_codes_code_key UNIQUE (code)` |
| Campaign/code ownership linkage | `referral_codes.campaign_id → referral_campaigns(id) ON DELETE SET NULL`; owner column `referral_codes.owner_user_id` |
| Coupon uniqueness | `referral_coupons_code_key UNIQUE (code)` |
| Duplicate coupon-redemption prevention | `UNIQUE (coupon_id, redeemer_user_id)` **and** `UNIQUE (idempotency_key)` on `referral_coupon_redemptions` |
| Wallet uniqueness by owner | `referral_wallets_user_id_key UNIQUE (user_id)` (tenant scoping via `tenant_id NOT NULL`; single-wallet-per-user model) |
| Allowed wallet transaction statuses | CHECK allowlist: `created, pending, eligible, approved, payable, paid_or_applied, held, rejected` |
| Registration cannot mature a reward (DB level) | CHECK `referral_signup_only_not_matured`: signup-type source events may only be `created/pending/held/rejected` |
| Invalid wallet transition protection | DB layer: status allowlist + `amount >= 0` CHECK; transition state machine enforced in the service layer and verified by the Stage 1 suites (171/171, incl. invalid-transition and hold/review cases) |
| Share-asset campaign/code relationships | `share_assets.campaign_id → campaigns ON DELETE SET NULL`; `share_assets.code_id → codes ON DELETE CASCADE` |
| Event/audit immutability controls | `referral_events`, `referral_coupon_redemptions`, `referral_share_assets`, `referral_admin_audit_events` are append-only in the service layer (no update triggers, no client write path via RLS); client tampering impossible (0 policies); service path verified append-only by Stage 1 suites |
| Status catalogs on campaigns/codes/coupons | CHECKs: campaign `DRAFT/ACTIVE/PAUSED/COMPLETED/ARCHIVED`, type `LOCAL_MARKETPLACE/IMPORT_VEHICLE/IMPORT_PARTS/CONTAINER_SPACE/COMMUNITY_GROUP/AGENT_PARTNER`; code `ACTIVE/DISABLED/EXPIRED/EXHAUSTED` + `code_type MEMBER/CAMPAIGN/COUPON/GROUP/AGENT` + `uses_count >= 0` + `max_uses >= 0`; coupon `PERCENT/FIXED/SERVICE_CREDIT`, `discount_value >= 0`, `max_redemptions >= 0`; redemption `applied/reversed/voided` |
| Referential graph | `events → campaigns/codes/coupons/wallet_transactions (SET NULL)`; `wallet_transactions → wallets (CASCADE), campaigns/codes/source events (SET NULL)` |

### 3.3 Indexes (32) and triggers (5)

- Every PK is a unique btree index; every FK path and hot lookup is covered: codes by `code` and `campaign_id`; coupons by `code` and `campaign_id`; events by `campaign_id/occurred_at DESC`, `code_id/occurred_at DESC`, `coupon_id`, `subject_type+subject_id`, `wallet_transaction_id`; wallet transactions by `wallet_id/created_at DESC`, `campaign_id`, `code_id`, `source_event_id`; wallets by `user_id` (unique); campaigns by `status+campaign_type+priority_scope` and unique `tenant_id+slug`.
- Triggers: `set_referral_updated_at()` BEFORE UPDATE on the five mutable tables (`campaigns`, `codes`, `coupons`, `wallets`, `wallet_transactions`). The four append-only tables intentionally have none.

### 3.4 Tenant columns and defaults

All nine tables carry `tenant_id text NOT NULL DEFAULT 'platform'`. Ownership/actor columns present as designed: `codes.owner_user_id`, `wallets.user_id NOT NULL`, `wallet_transactions.user_id NOT NULL`, `coupon_redemptions.redeemer_user_id NOT NULL`, `events.actor_user_id`, `admin_audit_events.actor_user_id` + `reason`. Status columns default safely (`campaigns → DRAFT`, `codes/coupons → ACTIVE`, `wallet_transactions → pending`, `redemptions → applied`).

### 3.5 Wave A absence

A staging-wide catalogue scan for `ambassador|payout|attribution|receiver_|specialist|permanent_code|widget` table names returned **zero rows** — no Full-Vision/Wave A tables exist or are being treated as V1 requirements.

## 4. Production read-only reconfirmation — `vhmnajoeicasaigiophh`

The same catalogue query (single read-only SELECT) returned **zero** public `referral_*` tables. No migration was applied; production is unchanged.

## 5. Staging account provisioning

Provisioned via the repository's sanctioned mechanism (the exact gates and upsert semantics of `backend/scripts/seed-uat-referral-users.mjs`, reusing `hashPassword` from `backend/utils/passwordAuth.js` and `extractSupabaseRef`/`assertStagingTarget`/role-catalog/minimum-length checks from `scripts/provision-staging-qa-accounts.mjs`), executed with `NODE_ENV=test`, `UAT_SEED_CONFIRM=yes`, against the explicitly asserted staging ref only.

| Email | id | Role | Action | Rationale |
|---|---|---|---|---|
| `refv1-admin@staging.carup.local` | `refv1-staging-admin` | `admin` | created | Admin console + qualification/review surfaces |
| `refv1-owner@staging.carup.local` | `refv1-staging-owner` | `owner` | created | Referral code owner / Refer & Earn wallet |
| `refv1-invitee@staging.carup.local` | `refv1-staging-invitee` | `owner` | created | CarUp has no separate member/buyer role — an ordinary invitee is an `owner`-role user with no privileged data (per the documented product model); minimum correct role |

Credential handling: three strong random passwords (18 random bytes each, base64url) generated directly into `backend/.env.uat.local` (matched by `.gitignore:27 .env.*`), file mode `-rw-------`; staging service-role key retrieved via the Management API into the same ignored file. **No password, hash, key, or token was printed, committed, or recorded anywhere else.** Display names use the `REFV1-STAGING-` test-data prefix.

Verification:

| Check | Result |
|---|---|
| Staging `users` rows (read-only SELECT) | 3/3 present with correct roles and non-empty scrypt hashes |
| Live login `POST /api/auth/login` on deployed staging backend | admin → **HTTP 200, role=admin**; owner → **HTTP 200, role=owner**; invitee → **HTTP 200, role=owner** |
| Same emails in production `users` (read-only SELECT) | **0 rows** — accounts exist only in staging |

## 6. Stage 2 completion criteria

```text
All nine staging foundation tables exist            YES
RLS enabled on all nine                             YES (0 client policies; server-owned)
Required constraints, indexes, triggers verified    YES (46 constraints, 32 indexes, 5 triggers)
Staging deployment bindings remain correct          YES (§1: health + bundle checks)
UAT runner refuses production targets               YES (§1: live refusal, exit 1)
No client-side secret present                       YES (§1: deployed bundle scans)
Three staging accounts exist with correct roles     YES (created + live-login verified)
Accounts do not exist in production                 YES (0 rows)
Production still contains zero referral tables      YES (read-only reconfirmed)
Production has not changed                          YES (SELECT-only)
P0 defects                                          0
P1 defects                                          0
```

## 7. Stage 2 evidence summary

```text
Stage: Stage 2 — Staging schema and account readiness
Exact SHA: 6214f3dd7aef7a24d33170009164d8f4932ab429
Environment: staging Supabase eoyenigwevnxwwhyhaer (inspection + 3 user rows); production vhmnajoeicasaigiophh (read-only SELECTs only); deployed staging web/backend
Actions completed: project-ref verification; full nine-table schema inspection; ACL/RLS posture verification; Wave A absence scan; production zero-table reconfirmation; REFV1 account provisioning + live login verification; production absence verification
SQL/read-only inspections: 9 catalogue/inspection SELECTs via ref-allowlisted read-only helper
Account provisioning result: 3 created (admin/owner/owner), logins verified HTTP 200 with correct roles
Pass totals: 12/12 completion criteria
Failures: 0
Defects: P0 = 0, P1 = 0
Data created: 3 staging users rows only (REFV1-STAGING- prefix; no referral data)
Production changed: No
Evidence recorded: this file
Gate result: PASS
Next single action: begin Stage 3 staging admin web acceptance (R-ADM-01 … R-ADM-20) as a separate execution
```

## Stage 2 decision

# PASS

The staging Referral V1 foundation schema is present, correctly constrained, indexed, triggered, tenant-scoped and RLS-protected in the server-owned posture; production remains free of referral tables and unchanged; and the three controlled staging accounts exist only in staging with verified logins and minimum correct roles. Stage 3 may begin in a separate execution.

---

# Stage 3 — Staging admin web acceptance

- Executed: `2026-07-15`
- Gate result: **PASS** (0 P0, 0 P1; one P2 staging-configuration finding and one P3 recorded, neither blocking)
- Production changed: **No** (production not contacted at all during Stage 3)
- Environment: deployed staging `https://carup-staging.vercel.app` (frontend) + `https://carup-backend-staging.vercel.app` (backend), Supabase `eoyenigwevnxwwhyhaer`
- Method: real deployed staging UI driven with Playwright (Chromium). Direct API/DB reads used only for post-action verification, authorization-negative testing, and evidence — never as a substitute for a required UI operation.
- Run identifier: `REFV1-STAGING-S3-20260715T092916Z` (embedded in every synthetic record's name/slug/metadata)

## 0. Security preconditions

| Precondition | State |
|---|---|
| Stage 2 Supabase Management API token | Local session copy **deleted**; no `sbp_` token remains in scratchpad or shell history. **Server-side revocation is an owner action** (recorded as a required rotation item; the token is owner-held, not revocable from this session). Not used in Stage 3. |
| Production `SERVICE_ROLE_KEY` / DB password / DB URL pasted earlier | **Not used.** Recorded as requiring a separately authorized security rotation (see §8). |
| Credentials source | Only `backend/.env.uat.local` (git-ignored, mode `-rw-------`, staging ref only). |
| Secrets in evidence | No password, token, JWT, cookie, CSRF token or service key printed to terminal, ledger, commits, or retained Playwright/DB output. |

## 1. Browser preparation

| Check | Result |
|---|---|
| Staging frontend `GET /` | **HTTP 200** |
| Staging backend `GET /api/health` | **HTTP 200**, `status: UP`, `supabase: healthy` |
| Staging bundle API target | staging backend baked (`carup-backend-staging` ×4); 1 inert fallback constant; **0** service-role/Supabase-ref matches |
| Referral Playwright spec (`web/e2e/referral-staging.spec.ts --workers=1`, staging base URL + REFV1 admin/owner creds) | **4 passed, 0 failed, 0 skipped** — the two previously credential-gated admin/owner journeys now execute |

## 2. Functional acceptance cases (R-ADM-01 … R-ADM-20)

All 20 executed **in order through the deployed staging UI**. Persistence verified with the staging-only read-only PostgREST helper.

| Case | UI route | Action | Observed (PASS) | Key persisted ID / evidence |
|---|---|---|---|---|
| R-ADM-01 | `/login` → `/admin` | Admin login | Authenticated `role=admin`; no production/external host contacted | user `refv1-staging-admin` |
| R-ADM-02 | `/admin/referrals` | Open admin console | Campaign console renders; nav for all 6 referral areas present; 0 console errors; persisted (not mock) data | — |
| R-ADM-03 | `/admin/referrals` | Create campaign | Row created, `tenant=platform`, `LOCAL_MARKETPLACE·LOCAL`, safe initial status `DRAFT`; `campaign.created` event written | campaign `956a1e1f-b65a-4bed-969e-724bbaa6f235`; event `3d6e1efb-30ff-4a8e-b4c4-1005cef88d1e` |
| R-ADM-04 | `/admin/referrals` | Update campaign | `DRAFT → ACTIVE`; persisted across reload (UI + DB); `updated_by=refv1-staging-admin` | before `DRAFT` / after `ACTIVE` |
| R-ADM-05 | `/admin/referrals/codes` + `/local-leads` | Create referral code | Code created and campaign-linked; **owner-owned** code minted via the Create-Bundle UI with `owner_user_id=refv1-staging-owner`; **duplicate creation blocked** ("Referral code already exists.", HTTP 400) | admin code `1cb25f37-…` (`REFV1S3CODE20260715`); owner code `ae7d6b33-8ecf-42e7-ac6e-69efb571b7ec` (`LOCAL-BUYER-REFV1-STAGING-OWNE-4A4CDF3B`, owner `refv1-staging-owner`) |
| R-ADM-06 | `/admin/referrals/codes` | Create coupon | `FIXED · 25`, `ACTIVE`, persisted once; **duplicate blocked** ("Coupon already exists.", HTTP 400) | coupon `0eb92b8d-6fd7-4c99-a3f6-8470cb121c7c` (`REFV1S3COUPON20260715`) |
| R-ADM-07 | `/admin/referrals/codes` | Generate share kit | Attributed share kit persisted; URL carries the referral code; targets `carup.app/r/…` (safe public route), never production admin | share asset `75ef50f3-46c2-4d43-9729-c5deaec5d4c4` (code `ae7d6b33`, campaign `171c994b`); URL `https://carup.app/r/LOCAL-BUYER-REFV1-STAGING-OWNE-4A4CDF3B` |
| R-ADM-08 | `/admin/referrals/local-leads` | Create local lead | Lead persisted, attributed to owner code+campaign (`attribution.owner_user_id=refv1-staging-owner`); synthetic target only; status `attributed`; **no wallet txn at creation** | lead event `737f04f1-b38f-44fc-ae88-3f544957a342` |
| R-ADM-09 | `/admin/referrals/local-leads` | Qualify local lead | `reward_created:true`; **benefit owner = `refv1-staging-owner` (original code owner), NOT the acting admin**; benefit `pending`; **duplicate qualification blocked** ("Reward eligibility already exists…"); one txn only | wallet txn `26ad7374-5efb-484b-b556-835a033d571f` (`user_id=refv1-staging-owner`, `amount=10`, `pending`); owner wallet `0c568b48…` `pending_balance=10` |
| R-ADM-10 | `/admin/referrals/import-routes` | Create import route | Container-space route persisted, `total=10 CBM booked=0 open` | route `refv1s3-japan-refv1s3-zimbabwe-container-space`; event `b40e4898-c12d-4099-92ec-bd92e2b3255a` |
| R-ADM-11 | `/admin/referrals/import-routes` | Update route capacity | `total 10 → 6`; reload confirms `total:6 booked:0 available:6` | event `import_campaign.capacity_updated` |
| R-ADM-12 | `/admin/referrals/import-routes` | Fill + block overbooking | Route filled to `booked 6/6` (status `full`); route-level over-set (`booked 7 > 6`) rejected ("booked capacity cannot exceed total capacity."); demand-over-available with waitlist OFF rejected ("requested capacity exceeds available route capacity."); **capacity never negative, never overbooked** | — |
| R-ADM-13 | `/admin/referrals/import-routes` | Enable waitlist | Excess demand (waitlist ON) → `waitlisted:true`, `capacity_status:full`; **reserved capacity unchanged (6/6)**; **0 wallet txns** for the waitlisted event | waitlisted lead event `fa259238-45c6-4b11-8d0b-63542460fddf` |
| R-ADM-14 | `/admin/referrals/marketing` | Generate marketing draft | Proof-story asset created as **`draft`**; disclosure present; **no external provider call**; not auto-published | asset `6b7ba4d2-f0d4-4b75-bb2f-97dee6196dfa` |
| R-ADM-15 | `/admin/referrals/marketing` | Approve marketing asset | `draft → review → approved` (each an allowed transition, persisted across reload); **approval triggered no external publication** | events `38c23828…` (→review), `b8ea6a71…` (→approved) |
| R-ADM-16 | `/admin/referrals/trust` | Run risk check | `Recommendation: review · score: 30 · critical: false`; result persisted with signal; **did not auto-approve/settle** the wallet txn (stayed `pending`) | event `trust.ai_recommendation_stored 77a3fd5a…` |
| R-ADM-17 | `/admin/referrals/trust` | Place wallet hold | Txn `26ad7374` → `held`; wallet totals internally consistent (all balances net-zero, benefit held not settled); **no settlement/external reward**; audit event written | event `trust.wallet_hold_applied a834738f…`; txn `26ad7374`, wallet `0c568b48…` |
| R-ADM-18 | `/admin/referrals/trust` | Review decision | No-reason submit **blocked** by UI ("A reason is required for every decision.") **and** API (`400 VALIDATION_FAILED: decision reason is required.`); with reason → decision persisted, actor `refv1-staging-admin`, reason recorded, audit event written; txn remained `held` (no settlement) | review case `e3436f3a-45f0-4b12-b708-5dd954198349`; event `trust.review_case_decided d7cc1a52…` |
| R-ADM-19 | `/admin/referrals/trust` | Resolve dispute | Dispute opened (reason required) then resolved `resolved_upheld` with reason+actor; owner-visible state retrievable via Explain Benefit ("held: This benefit is held for trust review…"); complete audit chain | dispute `ac32f244-cf26-4346-a305-f11d7f8a4a7f`; events `trust.dispute_created ac32f244…`, `trust.dispute_resolved 71fc3c86…` |
| R-ADM-20 | `/admin/referrals/trust` | Export audit trail | Export succeeded: **200 events**, **SHA-256 checksum present**, bounded (`limit=200`); contains all controlled IDs (`956a1e1f`, `ae7d6b33`, `26ad7374`, `ac32f244`, `e3436f3a`); **no service-role key, JWT, password, or unrelated customer PII**; saved only to local ignored evidence dir | export event `trust.audit_export_created`; saved `scratchpad/s3-evidence/refv1-s3-audit-export.json` |

**Functional total: 20 / 20 PASS.** The mandatory correct-owner database assertion (`reward_owner_user_id == original referral code owner`) held: the qualified benefit is owned by `refv1-staging-owner`, not the acting admin.

## 3. Authorization / security boundary tests

| Boundary | Result |
|---|---|
| Owner cannot access admin referral routes | **PASS** — all 6 admin routes: API returns **403** on every admin endpoint (`/campaigns`, `/codes`, `/local-marketplace/leads`, `/import-campaigns/routes`, `/trust/review-cases`); frontend redirects to owner `/dashboard`; **no admin UI/data rendered** |
| Invitee cannot access admin referral routes | **PASS** — identical: API **403** on all, redirect to owner dashboard, no admin data |
| Unauthenticated admin API calls | **PASS** — `GET`/`POST` to admin referral endpoints return **401** |
| Authenticated non-admin (owner/invitee) | **PASS** — **403** (covered above) |
| Required-reason cannot be bypassed | **PASS** — hold, review decision, and dispute-resolve each rejected without a reason at both **UI** and **API** (`400 VALIDATION_FAILED`: "wallet hold reason is required." / "decision reason is required." / "dispute resolution reason is required.") |
| Marketing cannot auto-publish | **PASS** — draft stayed `draft`; approval reached `approved` (not `published`); no external provider contacted |
| CSRF on mutation | **Mechanism PASS, with P2 staging-config caveat** — see below |

### CSRF finding (P2 — staging environment configuration; Stage 9 production gate)

- Forcing enforcement (`x-verify-csrf: true`, no token) on `POST /api/referrals/campaigns` returns **HTTP 403 "CSRF validation failed. Request untrusted."** — the double-submit CSRF middleware is present and **functionally correct**.
- However, the same POST **without** a CSRF token (the plain boundary test) returned **HTTP 201** on deployed staging. Root cause: the deployed **staging backend runs `NODE_ENV=test`**, and `csrfMiddleware` intentionally bypasses CSRF when `NODE_ENV==='test' && x-verify-csrf!=='true'` (same switch also enables a rate-limit bypass header and an insecure default CSRF secret). This is a **staging deployment configuration** matter, **not a Referral V1 code defect** (the enforcement code is proven correct).
- Classification: **P2**, staging-only. Recorded as a **mandatory Stage 9 read-only check**: confirm the **production** backend is **not** `NODE_ENV=test` (i.e., production enforces CSRF, rate limiting, and a real CSRF secret by default). If Stage 9 finds production in test mode, that escalates to P0/P1. Per Stage 1–8 discipline, production was **not** probed during Stage 3.

## 4. Console and network inspection

- **Only external host contacted in the entire session: `fonts.googleapis.com`** (Google Fonts stylesheet, 200). No requests to the production backend (`carup-backend.vercel.app`), the production Supabase ref, or any WhatsApp/Telegram/Facebook/email/payment/AI provider. `carup.app/r/…` and `carup.app/referrals/…` appear only as **hrefs inside generated share/marketing assets**, never navigated or fetched.
- All captured console errors originate from the **deliberate negative tests** (duplicate code/coupon `400`, forced-CSRF `403`, unauthenticated `401`, required-reason `400`). No unexplained JavaScript errors.

## 5. Defects

```text
P0: 0
P1: 0
P2: 1 — deployed staging backend runs NODE_ENV=test, bypassing CSRF-by-default (and enabling
        rate-limit bypass header + insecure default CSRF secret). Staging-only; CSRF enforcement
        code proven correct. MANDATORY Stage 9 gate: verify production is NOT NODE_ENV=test.
P3: 1 — frontend admin route-guard is timing-inconsistent (an unauthorized user briefly shows the
        /admin/* URL before the redirect settles), but no admin data ever renders and the API
        enforces 403. Cosmetic; no data exposure.
```

No P0/P1 defect was found, so no defect remediation branch/PR was required for Stage 3.

## 6. Data created (staging only; all carry `REFV1-STAGING-S3-20260715T092916Z` or a REFV1 identifier)

- Campaigns: `956a1e1f…` (Local Campaign), `171c994b…` (owner bundle campaign), `d52654ff…` (created by the CSRF-negative test; tracked test data)
- Codes: `1cb25f37…` (`REFV1S3CODE20260715`), `ae7d6b33…` (`LOCAL-BUYER-REFV1-STAGING-OWNE-4A4CDF3B`)
- Coupon: `0eb92b8d…` (`REFV1S3COUPON20260715`)
- Share assets: `75ef50f3…` (+ one earlier bundle share kit `04490601…`)
- Local lead: `737f04f1…`; import route `refv1s3-japan-refv1s3-zimbabwe-container-space` + its leads incl. waitlisted `fa259238…`
- Wallet: owner wallet `0c568b48…`, transaction `26ad7374…`
- Trust: risk recommendation, review case `e3436f3a…`, dispute `ac32f244…`, marketing asset `6b7ba4d2…`

All are staging synthetic records for Stage 12 cleanup. No real customer contact, real reward, or settlement was created (benefit remained `pending`→`held`, never approved/settled).

## 7. Stage 3 evidence summary

```text
Stage: Stage 3 — Staging admin web acceptance
Exact SHA: 6214f3dd7aef7a24d33170009164d8f4932ab429
Environment: deployed staging (carup-staging / carup-backend-staging), Supabase eoyenigwevnxwwhyhaer
Browser suite: web/e2e/referral-staging.spec.ts — 4 passed, 0 failed, 0 skipped (1 worker, staging creds)
Admin functional cases: R-ADM-01 … R-ADM-20 = 20/20 PASS via deployed UI
Authorization/security checks: owner 403, invitee 403, unauth 401, required-reason blocked (UI+API), marketing no auto-publish, CSRF enforcement 403 (mechanism); P2 staging test-mode CSRF-default-bypass
Actions completed: browser prep; 20 functional cases; 6 authorization boundaries; console/network sweep; audit export capture
Commands/tests run: Playwright referral spec + Playwright-driven UI journeys; read-only PostgREST verification; authenticated negative-auth fetches
Pass totals: 4/4 browser; 20/20 functional; 6/6 authorization boundaries (CSRF mechanism verified)
Failures: 0
Defects: P0=0, P1=0, P2=1 (staging NODE_ENV=test), P3=1 (frontend route-guard timing)
Data created: staging-only synthetic REFV1-STAGING-S3 records (listed §6); 0 production
Production changed: No (production not contacted)
External providers changed: No (only Google Fonts stylesheet loaded)
Evidence recorded: this file; audit export at scratchpad/s3-evidence/refv1-s3-audit-export.json (local, ignored)
Gate result: PASS
Next single action: begin Stage 4 (owner/invitee correct-attribution journey) in a separate execution
```

## 8. Carry-forward items

1. **Stage 9 (mandatory):** verify production backend is **not** `NODE_ENV=test` — CSRF, rate limiting, and CSRF-secret must be enforced by default in production. (Root of the Stage 3 P2.)
2. **Security rotation (separately authorized):** the production `SERVICE_ROLE_KEY`, DB password and DB URL pasted into the working conversation, the Stage 2 Supabase Management API token, the staging service key in `backend/.env.uat.local`, and the three REFV1 staging account passwords must be rotated as a distinct, owner-authorized action. Not performed in Stage 3.

## Stage 3 decision

# PASS

An administrator operated the complete Referral Engine V1 through the real deployed staging web application: all 20 functional cases passed with database-verified persistence, the correct-owner attribution invariant held, capacity/waitlist/duplicate protections held, fraud-hold/human-review/dispute/audit-export controls worked with enforced reasons, and every authorization boundary denied non-admin and unauthenticated access (API 403/401). CSRF enforcement is functionally correct; the deployed-staging test-mode default-bypass is recorded as a P2 with a mandatory Stage 9 production check. No P0/P1 defects, no production contact, no external-provider activation, no real customer data, and no real reward or settlement. Stage 4 may begin in a separate execution.

---

# Stage 4 — Owner/invitee correct-attribution journey (BLOCKED — security precondition)

- Attempted: `2026-07-15`
- Gate result: **NOT STARTED — blocked by mandatory security precondition**
- Production changed: **No**
- Staging data written: **None** (no Stage 4 run identifier was created; no R-OWN case was executed)

## 1. Security precondition check (Stage 4 §1) — FAILED

The Stage 4 execution directive requires, before any journey work: *"Confirm the temporary Supabase Management API token used during Stage 2 has been revoked server-side, not merely deleted locally"*, and *"If the temporary Management API token is still active, stop and report the security blocker. Do not begin the referral journey."*

Verification performed at Stage 4 start:

```text
GET https://api.supabase.com/v1/projects with the Stage 2 token
→ HTTP 200 — the token is STILL ACTIVE server-side
```

Execution therefore stopped immediately. No referral-journey action, account rotation, or data creation was performed.

## 2. Local hygiene state (verified clean)

| Surface | State |
|---|---|
| Shell environment | Clean (non-persistent per-invocation shells; nothing exported) |
| Shell history (`~/.zsh_history`) | No token material |
| Temporary files / session scratchpad | No token material (local copy was deleted at Stage 3 start) |
| Helper configuration (`sbq.mjs` / `sbread.mjs`) | No embedded token (file-based; token file deleted) |
| Claude settings (global and project) | No token material |
| `backend/.env.uat.local` | git-ignored, mode `-rw-------`, staging-only values, no token, no production values |

**Irreducible exposure:** the token value exists in the working conversation transcript (it was pasted there by the owner when granting access, and referenced by the verification test). This cannot be scrubbed locally and is precisely why **server-side revocation is the only effective control**. Local deletion alone — already done — is insufficient.

## 3. Owner actions required to unblock Stage 4

1. **Revoke the Stage 2 Supabase personal access token** in the Supabase dashboard (Account → Access Tokens). There is no self-revocation API for the token; this is dashboard-only, owner-only.
2. Re-run of Stage 4 will then re-verify revocation (expect HTTP 401), complete the remaining preconditions (staging-credential rotation policy check, three live logins), and begin the R-OWN journey.

The previously recorded rotation list remains pending as a separately authorized security workflow: production service-role key / DB password / DB URL pasted into conversation, the Stage 2 Management API token, the staging service key held in the ignored local env file, and the three REFV1 staging account passwords.

## 4. Stage 4 blocker summary

```text
Stage: Stage 4 — Owner/invitee correct-attribution journey
Exact SHA: 6214f3dd7aef7a24d33170009164d8f4932ab429
Environment: none contacted beyond the single Management API token-validity check (api.supabase.com)
Security preconditions: FAILED at item 1 — Stage 2 Management API token still ACTIVE server-side (HTTP 200)
Owner/invitee functional cases: not started (0 of R-OWN-01…20)
Actions completed: token-validity verification; local remnant sweep (all clean); env-file hygiene verification
Data created: none
Production changed: No
External providers changed: No
Evidence recorded: this file
Gate result: BLOCKED — awaiting owner revocation of the Stage 2 token
Next single action: owner revokes the Stage 2 Supabase access token in the dashboard, then Stage 4 re-runs from the security preconditions
```

## 5. Second revocation-verification attempt — STILL BLOCKED

- Attempted: `2026-07-15` (after the owner reported dashboard revocation)
- Verification: `GET https://api.supabase.com/v1/projects` with the Stage 2 token → **HTTP 200**; confirmed once more with cache-busting → **HTTP 200**. The Stage 2 token remains **ACTIVE**; status only was captured (no body read, no token printed or saved).
- Interpretation: the Supabase dashboard lists personal access tokens by **name and creation date only** — token values are never displayed — so the revocation most likely removed a **different** token on the account.
- Unblock guidance recorded for the owner: in **supabase.com/dashboard → Account → Access Tokens**, either identify the token generated for Stage 2 by its name/creation date (created 2026-07-15 or earlier, supplied for the Stage 2 unblock) and revoke it, or — reliably — **revoke ALL personal access tokens** on the account (the Supabase CLI login can be re-established afterwards with `supabase login`; no production runtime credential is affected by PAT revocation).
- Stage 4 remains **NOT STARTED**: no run identifier, no data, no staging login, no journey action. Local hygiene state from §2 is unchanged.
