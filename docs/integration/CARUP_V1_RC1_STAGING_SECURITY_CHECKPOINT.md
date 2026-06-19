# CarUp RC1 — Staging Security Checkpoint

**Date:** 2026-06-20  
**Branch:** `release/carup-v1-rc1`  
**RC SHA:** `f511ea57857c71f31e1f10d3c72cf109df6239f8`

---

## Phase 1 — Local env file tracking status

| File | Git-tracked? | Gitignored? | Status |
|---|---|---|---|
| `.env` | No (empty `git ls-files`) | Yes (`.gitignore:26`) | SAFE |
| `.env.staging` | No | Yes (`.gitignore:27 .env.*`) | SAFE |
| `web/.env.local` | No | Yes (`.gitignore:27 .env.*`) | SAFE (not committed) |
| `web/.env` | No | Yes (`.gitignore:29`) | SAFE |
| `.env.example` | Yes | No (whitelisted `!.env.example`) | SAFE — no secrets, placeholders only |

All local env files are correctly gitignored and have never been tracked in the active Git tree.

---

## Phase 2 — Git history credential scan

### env files in history
```
git log --all --oneline -- web/.env.local .env.staging .env.staging.local
```
**Result:** No commits — these files have never been committed to any branch.

### Production Supabase project ref (`vhmnajoeicasaigiophh`) in history
**Result:** Present in **20+ commits** reachable from `origin/main` and multiple remote branches.  
The ref appears in documentation files, migration scripts, and configuration references.  
These are **project ref strings** (public-facing, not secret), not credential values.

### Staging Supabase project ref (`eoyenigwevnxwwhyhaer`) in history
**Result:** Present in **20+ commits** across multiple branches including `origin/main`.  
Same assessment — project ref strings are not secret values.

### Production database password scan
```
git log --all --oneline -S'[PASSWORD_FRAGMENT_REDACTED]' -- . ':!node_modules'
```
**Result:** ⚠️ **MATCH FOUND — 8 commits in Git history**

| Commit SHA | Message | Reachable from |
|---|---|---|
| `79eee15` | Add Diaspora Trade backend, RLS validation | `origin/main`, multiple branches |
| `23d521d` | chore: production readiness stabilization | `origin/main`, multiple branches |
| `7a8b609` | feat: add Zimbabwe plate identity | `origin/main`, multiple branches |
| `06adad8` | feat: add vehicle evidence timeline | `origin/main`, multiple branches |
| `c1921dc` | fix: remove hardcoded migration script secrets | `origin/main`, multiple branches |
| `4f9e4f3` | Add Diaspora live validation workflow | remote branch only |
| `f568e1a` | feat: production readiness stabilization sprint | `origin/main`, multiple branches |
| `0e766fd` | Initial CarUp Kimi commit | `origin/main`, multiple branches |

**Classification: Repository Credential Incident**

The production database password was committed in Git history and is reachable from `origin/main`. The password is **publicly accessible** on GitHub to anyone with repository access.

### Credential-shaped declarations in tracked files
Files scanned (`DATABASE_URL=`, `SUPABASE_DB_URL=`, `SUPABASE_SERVICE_ROLE_KEY=`, `JWT_SECRET=`):

| File | Variable | Assessment |
|---|---|---|
| `SECURITY_SECRET_CLEANUP_REPORT.md` | `SUPABASE_SERVICE_ROLE_KEY=`, `SUPABASE_DB_URL=`, `JWT_SECRET=` | Documentation only — values redacted in file |
| `database/seeds/marketplace_v1_staging_qa_accounts.sql` | `SUPABASE_DB_URL=` | Comment/usage instruction only |
| `scripts/provision-staging-qa-accounts.mjs` | `SUPABASE_DB_URL=` | Usage instruction in JSDoc — no value |
| `scripts/run-staging-qa-provision.sh` | `SUPABASE_DB_URL=` | Comment only — no value |

No live credential values found in currently tracked files.

---

## Phase 3 — Production credential containment status

> [!CAUTION]
> The production database password found in Git history (`0e766fd` through `79eee15`) must be treated as **compromised** because those commits are reachable from `origin/main` on GitHub.

**Required operator confirmation (blocking staging migration authorization):**

```
Production database password rotated:                           [ ] YES  [ ] NO
Affected production environment variables updated (Vercel):     [ ] YES  [ ] NO
Production backend redeployed and health checked:               [ ] YES  [ ] NO
Old credential invalidated:                                     [ ] YES  [ ] NO
```

**This checkpoint will NOT authorize migration to staging until these four items are confirmed YES.**

Note: History rewriting (BFG/git-filter-repo) to remove the credential from Git history requires separate Product Owner approval and coordinated force-push to all remote branches. It is not performed here.

---

## Phase 4 — Local env file recommendations

`web/.env.local` contains production Supabase credentials (project `vhmnajoeicasaigiophh`) including a database URL with a plaintext password. It is gitignored and was never committed.

**Required actions:**
1. After production password rotation: delete or overwrite `web/.env.local` entirely
2. Create staging-only local files using approved secret sources:
   - `.env.staging.local`
   - `web/.env.staging.local`
   - `backend/.env.staging.local`

Gitignore check confirms all `.env.*` patterns are ignored:
```
.gitignore:27:.env.*
```

---

## Phase 5 — Vercel project verification

**Vercel account:** `kudzimusar` / team: `pay-pass-project`  
**CLI version:** 54.7.1

| Project | Production URL | Last deployment | Status |
|---|---|---|---|
| `carup` | https://carup.vercel.app | 6 min ago | ✅ Ready |
| `carup-staging` | https://carup-staging.vercel.app | 6 min ago | ✅ Ready |
| `carup-backend` | https://carup-backend.vercel.app | 6 min ago | ✅ Ready |
| `carup-backend-staging` | https://carup-backend-staging.vercel.app | 6 min ago | ✅ Ready |

### carup-backend-staging env variable names (values encrypted)

| Variable | Scope |
|---|---|
| `NODE_ENV` | Preview, Production |
| `SUPABASE_URL` | Production, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview |
| `SUPABASE_DB_URL` | Production, Preview |
| `JWT_SECRET` | Production, Preview |
| `CORS_ALLOWED_ORIGINS` | Production, Preview |
| `ENABLE_AUTOMATION_WEBHOOKS` | Production, Preview |
| `OCR_MODE` | Preview, Production |
| `ALLOW_OCR_MOCK` | Preview, Production |

All required variables present. Values encrypted — project ref not verifiable without decrypting.

### carup-staging env variable names

| Variable | Scope | Note |
|---|---|---|
| `VITE_API_URL` | Preview (branch: `feature/marketplace-v1-production-integration`) | ⚠️ Branch-scoped to old branch, not RC1 |
| `VITE_API_URL` | Production | Encrypted |
| `VITE_SUPABASE_URL` | Production, Preview | Encrypted |
| `VITE_SUPABASE_ANON_KEY` | Production, Preview | Encrypted |

> [!WARNING]
> `VITE_API_URL` has a branch-scoped preview override pointed at `feature/marketplace-v1-production-integration` (the old integration branch), **not** `release/carup-v1-rc1`. Preview deployments triggered from the RC branch may use the production-scope `VITE_API_URL`. This must be verified before staging smoke tests.

### Staging backend health check
```
GET https://carup-backend-staging.vercel.app/api/health
```
**Result:** `{"status":"UP", "supabase":{"status":"healthy","outboxBacklog":0}}` ✅

---

## Phase 6 — Staging target guard

| Check | Result |
|---|---|
| Connection obtained from authorized staging source | ⏳ PENDING — requires production password rotation first |
| Expected staging project ref (`eoyenigwevnxwwhyhaer`) confirmed | ⏳ PENDING — Vercel env values are encrypted; requires `read -s` shell session |
| Production project ref (`vhmnajoeicasaigiophh`) detected | ❌ NOT CONFIRMED either way — encrypted |
| Migration authorized to continue | ❌ **NO — blocked by credential rotation requirement** |

---

## Phase 7 — Migration status

**Status: BLOCKED**

Migration `database/migrations/20260616120000_marketplace_v1_inquiries.sql` is authorized but cannot be applied until:
1. Production credential rotation is confirmed
2. Staging Supabase project ref is positively confirmed as `eoyenigwevnxwwhyhaer`
3. The staging-target guard passes

---

## Operations explicitly NOT performed

- No migration applied ✅
- No database seeded ✅
- No production data written ✅
- No staging data written ✅
- No Git history rewritten ✅
- No secrets printed or logged ✅
- No `.env.staging` filled with real values ✅
- PR #76 not merged ✅
- PR #76 not marked ready for review ✅

---

## Remaining blockers

### BLOCKER 1 (Security — Critical)
Production database password present in Git history reachable from `origin/main`. Must be rotated before staging work proceeds.

### BLOCKER 2 (Vercel — Medium)
`VITE_API_URL` preview override on `carup-staging` is scoped to `feature/marketplace-v1-production-integration`, not `release/carup-v1-rc1`. RC1 staging previews may use the wrong API URL. A new branch-scoped override for `release/carup-v1-rc1` or promotion to production scope is needed.

### BLOCKER 3 (Target verification — Medium)
Cannot positively confirm `carup-backend-staging` points to staging Supabase (`eoyenigwevnxwwhyhaer`) without operator confirmation or a `read -s` shell session. Vercel env values are encrypted in pulled files.

---

## Recommendation

**DO NOT PROCEED to staging migration or smoke testing.**

Required operator actions before resuming:
1. **Rotate** the production database password in Supabase project `vhmnajoeicasaigiophh`
2. **Update** all production consumers (Vercel `carup-backend` project env, local `.env`, CI)
3. **Confirm** rotation with the four-item checklist above
4. **Delete** `web/.env.local` (contains the old production DB URL with plaintext password)
5. **Verify** in a `read -s` shell session that `SUPABASE_DB_URL` targets `eoyenigwevnxwwhyhaer`
6. **Add** a `VITE_API_URL` preview override for branch `release/carup-v1-rc1` on `carup-staging` pointing to `https://carup-backend-staging.vercel.app`

After those six actions, re-run Phase 6 (staging target guard), apply the migration, and resume RC1 staging validation.
