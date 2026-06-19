# CarUp RC1 — Staging Credential Recovery and Safe Environment Verification

## Purpose

Resolve the staging-environment blocker safely before any RC1 migration, seed, deployment, or end-to-end test.

This instruction exists because the local workspace contains:

- a placeholder-only `.env.staging` file;
- a local `web/.env.local` containing production Supabase connection details;
- no confirmed safe staging database connection available to the current agent session.

The production-looking credential must be treated as potentially exposed. No secret value may be printed, pasted into chat, committed, written into documentation, or included in logs.

---

## Current known facts

- RC branch: `release/carup-v1-rc1`
- Draft PR: `#76`
- Staging Supabase project ref: `eoyenigwevnxwwhyhaer`
- Production Supabase project ref: `vhmnajoeicasaigiophh`
- Required staging migration:

```text
database/migrations/20260616120000_marketplace_v1_inquiries.sql
```

The current GitHub branch does **not** contain `web/.env.local` or `.env.staging`; these are local-only environment files and must remain untracked.

---

## Non-negotiable rules

Do not:

- paste any secret into chat;
- print any database password, JWT secret, service-role key, anon key, or full database URL;
- commit `.env`, `.env.*`, `*.local`, credentials, or generated secret files;
- populate a tracked `.env.staging` file with real values;
- use the production project for staging work;
- run the migration until a staging-project guard proves the target is `eoyenigwevnxwwhyhaer`;
- deploy or migrate production;
- reuse a production password after suspected exposure;
- continue if environment provenance remains uncertain.

Do not modify application code during this recovery checkpoint.

---

## Phase 1 — Freeze and prove the repository state

Run:

```bash
git checkout release/carup-v1-rc1
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/release/carup-v1-rc1
```

Confirm:

- branch is `release/carup-v1-rc1`;
- local and remote SHAs match;
- no environment file is staged or tracked;
- diagnostic files remain untracked and are not committed.

Verify ignore coverage:

```bash
git check-ignore -v web/.env.local .env.staging .env.staging.local 2>/dev/null || true
git ls-files web/.env.local .env.staging .env.staging.local
```

Expected:

- ignore rules are shown;
- `git ls-files` prints nothing.

Stop if any secret-bearing environment file is tracked.

---

## Phase 2 — Determine whether the secret entered Git history

Perform a path and project-ref scan without printing secret values:

```bash
git log --all --oneline -- web/.env.local .env.staging .env.staging.local
git log --all --oneline -S'vhmnajoeicasaigiophh' -- . ':!node_modules' ':!dist'
git log --all --oneline -S'eoyenigwevnxwwhyhaer' -- . ':!node_modules' ':!dist'
```

Also inspect tracked files for credential-shaped declarations without printing values:

```bash
git grep -nE 'DATABASE_URL=|DIRECT_URL=|SUPABASE_DB_URL=|SUPABASE_SERVICE_ROLE_KEY=|JWT_SECRET=' -- ':!*.example' ':!docs/**' || true
```

Report only:

- whether matches exist;
- file paths;
- commit SHAs;
- variable names.

Redact all values.

If a real secret exists in Git history, stop and classify it as a repository credential incident. Do not attempt history rewriting without separate approval.

---

## Phase 3 — Production credential containment

Because a plaintext production database password was observed locally, treat it as compromised until rotation is confirmed.

The Product Owner or authorized operator must rotate the production database password in the production Supabase project.

After rotation, update every authorized production consumer that uses the old database URL, including applicable Vercel projects, local secret stores, CI secrets, and deployment integrations.

Do not reveal either the old or new password.

Required operator confirmation:

```text
Production database password rotated: YES / NO
Affected production environment variables updated: YES / NO
Production backend redeployed and health checked: YES / NO
Old credential invalidated: YES / NO
```

Do not continue to staging migration while the old production credential remains active after suspected exposure.

---

## Phase 4 — Remove unsafe local ambiguity

Do not copy values from `web/.env.local` into any staging file.

After the production credential has been rotated and authorized consumers updated:

1. Remove or quarantine the obsolete local production environment file.
2. Create new local-only environment files from approved secret sources as needed.
3. Keep real values only in ignored local files, Vercel environment variables, Supabase secrets, or an approved secret manager.

Recommended local names:

```text
.env.staging.local
web/.env.staging.local
backend/.env.staging.local
```

Before using them:

```bash
git check-ignore -v .env.staging.local web/.env.staging.local backend/.env.staging.local
```

All must be ignored.

Never write secrets into:

```text
docs/
README files
PR descriptions
issue comments
shell history where avoidable
command output logs
```

---

## Phase 5 — Discover staging configuration from authoritative sources

Do not depend on placeholder repository files.

Use the authenticated Vercel and Supabase accounts as the source of truth.

### Vercel

Inspect CLI help first because CLI flags may differ by installed version:

```bash
vercel --version
vercel link --help
vercel env --help
vercel env pull --help
```

Use a temporary directory or a dedicated project link so the repository's existing Vercel linkage is not overwritten accidentally.

Identify and verify these projects:

```text
carup-staging
carup-backend-staging
```

For each project, report only:

- project name;
- linked Git branch or deployment source;
- deployment URL;
- environment-variable names present;
- environment scope;
- deployment commit SHA where available.

Do not print environment-variable values.

Confirm the frontend has a staging API base variable and that it points to the staging backend, not production.

Confirm the backend has staging Supabase variables whose project ref resolves to:

```text
eoyenigwevnxwwhyhaer
```

### Supabase

Obtain the staging database connection from the staging Supabase project through the authorized dashboard or approved local secret store.

Store it only in the current shell or an ignored local file.

Prefer a shell session that does not echo the value. Example pattern:

```bash
read -s SUPABASE_DB_URL
export SUPABASE_DB_URL
```

Do not paste the value into the terminal command itself if shell history is enabled.

---

## Phase 6 — Mandatory staging-target guard

Before any migration, prove the connection targets staging.

Use a read-only connection check. Do not print the full connection string.

At minimum verify:

- database connection succeeds;
- current database/user/host metadata is consistent with the staging project;
- the target is not associated with production ref `vhmnajoeicasaigiophh`;
- the approved staging ref is `eoyenigwevnxwwhyhaer`.

Create a safe guard script or one-time shell check that aborts unless the expected staging identifier is confirmed.

The guard must fail closed.

Required report:

```text
Connection obtained from authorized staging source: YES / NO
Expected staging project ref confirmed: YES / NO
Production project ref detected: YES / NO
Migration authorized to continue: YES / NO
```

If the staging project cannot be proven, stop.

---

## Phase 7 — Apply only the approved staging migration

Only after the target guard passes, apply:

```text
database/migrations/20260616120000_marketplace_v1_inquiries.sql
```

Do not apply unrelated migrations in this checkpoint.

Do not use scripts containing hardcoded fallback credentials.

Use the approved staging DB URL supplied through the secure shell environment.

After applying, verify:

```sql
select
  to_regclass('public.marketplace_inquiries') as marketplace_inquiries,
  to_regclass('public.marketplace_listing_reports') as marketplace_listing_reports;
```

Both must be non-null.

Also verify:

- RLS is enabled;
- `anon` and `authenticated` do not have direct table privileges;
- `service_role` retains the intended access;
- the migration did not touch production.

Do not print sensitive connection information.

---

## Phase 8 — Confirm deployment alignment

After migration, prove that the staging frontend, staging backend, and staging database belong to the same RC environment.

Report:

```text
RC branch:
RC commit SHA:
Staging frontend project:
Staging frontend URL:
Staging frontend commit SHA:
Staging backend project:
Staging backend URL:
Staging backend commit SHA:
Staging Supabase project ref:
Migration applied:
```

The frontend and backend RC SHAs should match or be traceably built from the same RC branch state.

Stop if stable staging points to production backend or production Supabase.

---

## Phase 9 — Resume staging validation

Only after Phases 1–8 pass, resume the existing RC1 staging validation plan:

- controlled QA dataset verification;
- Marketplace URL smoke tests;
- Playwright integrated checks;
- inquiry persistence;
- referral attribution;
- admin and owner flows;
- Parts/Services routing;
- Diaspora metadata safety;
- Product Owner UAT documentation.

Do not merge PR #76.
Do not mark it ready for review.

---

## Documentation requirement

Create or update:

```text
docs/integration/CARUP_V1_RC1_STAGING_SECURITY_CHECKPOINT.md
```

Record:

- local-only file status;
- Git-history scan result;
- production credential rotation status without values;
- Vercel project verification;
- staging Supabase target verification;
- migration result;
- frontend/backend/DB alignment;
- operations not performed;
- remaining blockers.

Do not include secrets.

---

## Mandatory stop conditions

Stop immediately if:

- a secret is tracked or appears in Git history;
- production rotation is not confirmed after suspected exposure;
- the staging project cannot be proven;
- a Vercel staging project points to production Supabase;
- a staging frontend points to production backend;
- the migration command would use a hardcoded fallback;
- any secret would appear in output or documentation;
- the approved migration affects unexpected objects;
- production data or infrastructure would be changed beyond the explicitly authorized credential rotation.

---

## Required final report

Return:

- RC SHA;
- Git tracking/history result;
- credential rotation status;
- staging Vercel project alignment;
- staging Supabase target confirmation;
- migration verification;
- security checkpoint document commit SHA;
- remaining blockers;
- recommendation to resume staging UAT or stop.
