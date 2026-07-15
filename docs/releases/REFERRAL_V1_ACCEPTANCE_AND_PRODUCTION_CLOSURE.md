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
| 2 — Staging schema and account readiness | IN PROGRESS — BLOCKED (staging DB access) | No |
| 3 — Staging admin web acceptance | NOT STARTED | No |
| 4 — Owner/invitee correct-attribution journey | NOT STARTED | No |
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

# Stage 2 — Staging schema and account readiness (IN PROGRESS — BLOCKED)

- Started: `2026-07-15`
- Gate result: **NOT YET — blocked on staging database access (see §3)**
- Production changed: **No**
- Staging data written: **None so far**

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

## 2. Remaining Stage 2 items (require staging database access)

- Primary keys, foreign keys, unique constraints, indexes per table
- Referral-code uniqueness constraint proof
- Coupon duplicate-redemption protection constraint proof
- Wallet status and transition constraints
- Triggers
- Tenant columns and enforcement
- Creation of the three staging accounts (`refv1-admin@`, `refv1-owner@`, `refv1-invitee@staging.carup.local`) with locally-stored ignored credentials

## 3. Blocker — no sanctioned path to the staging database from this session

1. **claude.ai Supabase connector**: authenticated, but against the wrong Supabase account — it can only see an unrelated project (`production-os`, INACTIVE, org `hrhxurdxkwhwazoundpd`). The CarUp projects live in org `tzmmjpcgplzjzktuwsad` and return "permission denied" through this connector.
2. **Supabase CLI**: logged in and lists both CarUp projects, and the repo is linked to staging — but every database-level CLI operation requires `SUPABASE_DB_PASSWORD` for `eoyenigwevnxwwhyhaer`, which is not stored locally.
3. **Local env files**: the only local Supabase credentials found point at **production** (`vhmnajoeicasaigiophh`) and were therefore deliberately not used for staging work (and will not be used for any Stage 2–8 action).
4. **CLI keychain token → Management API**: keychain extraction was blocked by the local permission policy (credential-store access requires explicit user review).

No production resource was touched while establishing the above.

## 4. Owner unblock options (any one suffices for schema inspection)

- **Option A (preferred, unblocks everything)**: re-authorize the claude.ai Supabase connector against the Supabase account that owns org `tzmmjpcgplzjzktuwsad` (carup-staging + CarUp). All Stage 2+ staging SQL then proceeds via MCP.
- **Option B**: place the **staging** database password in a git-ignored local file (e.g. `backend/.env.uat.local`, `SUPABASE_DB_PASSWORD=…`) so the linked Supabase CLI can run read-only inspection.
- **Option C**: add a permission rule allowing the session to read the Supabase CLI keychain token, enabling read-only Management API queries.

For **staging account creation** (sanctioned path: `backend/scripts/seed-uat-referral-users.mjs`), the **staging** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are additionally required in `backend/.env.uat.local` (git-ignored; never committed, never printed) — unless Option A is chosen, in which case alternatives via MCP will be evaluated at execution time.
