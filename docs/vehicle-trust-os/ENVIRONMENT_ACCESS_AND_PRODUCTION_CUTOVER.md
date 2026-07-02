# CarUp Vehicle Trust OS — Environment Access and Production Cutover

**Status:** Canonical non-secret environment and access reference  
**Working branch:** `release/core-vehicle-trust-os-mvp`  
**Primary plan:** `docs/vehicle-trust-os/CORE_VEHICLE_TRUST_OS_MVP_RELEASE_PLAN.md`  
**Last verified:** 2026-06-24  

> Read this file before using Supabase MCP, Supabase CLI, database URLs, staging credentials, production credentials, migration runners, Vercel environment variables, or production cutover commands.

---

## 1. Goal

Complete the Core Vehicle Trust OS MVP and place it in production during the current release session, provided every required gate passes.

The goal is not perfection. The goal is a working, integrated, truthful MVP on production `main` with:

- the Vehicle Trust OS release branch reconciled with current `main`;
- staging migrations and golden-vehicle qualification complete;
- production migration plan verified;
- production migrations applied safely;
- release PR merged only after explicit owner authorization;
- production deployment verified;
- production-safe smoke test green;
- no unsupported government-verification claims;
- no cross-tenant, evidence-privacy, audit-loss or migration errors.

Do not add unrelated features during this session.

---

## 2. Canonical Supabase Environment Map

These project identities were verified through the connected CarUp Supabase organization.

| Environment | Project name | Project ref | API URL | Direct database host | Region | Status |
|---|---|---|---|---|---|---|
| Staging | `carup-staging` | `eoyenigwevnxwwhyhaer` | `https://eoyenigwevnxwwhyhaer.supabase.co` | `db.eoyenigwevnxwwhyhaer.supabase.co` | `ap-southeast-2` | `ACTIVE_HEALTHY` |
| Production | `CarUp` | `vhmnajoeicasaigiophh` | `https://vhmnajoeicasaigiophh.supabase.co` | `db.vhmnajoeicasaigiophh.supabase.co` | `ap-south-1` | `ACTIVE_HEALTHY` |

**CarUp Supabase organization ID:** `tzmmjpcgplzjzktuwsad`

The project shown in the incorrect Claude MCP session:

```text
sfhtlzcgrnrdznhvdrbn  production-os
```

is **not an approved CarUp staging or production target for this release**. Do not use it.

---

## 3. Secret Handling Rules

This repository document intentionally contains no passwords, access tokens, service-role keys, JWT secrets, database passwords or private API credentials.

Claude must obtain secrets only through one of these approved mechanisms:

1. native Supabase CLI credential storage after interactive login;
2. an authenticated Supabase MCP session connected to organization `tzmmjpcgplzjzktuwsad`;
3. local uncommitted environment files with restrictive permissions;
4. approved deployment-platform environment variables;
5. an owner-provided secret entered directly into a secure prompt or dashboard, never pasted into source, chat logs, PR comments or terminal transcripts shared publicly.

Never:

- commit `.env*` secrets;
- print secret values;
- paste service-role keys into PRs or reports;
- expose service-role keys to Vite/mobile variables;
- reuse a staging secret in production;
- invent or guess a database password;
- replace a missing password with a placeholder and continue.

Required secret variable names may include:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
STAGING_SUPABASE_URL
STAGING_SUPABASE_ANON_KEY
STAGING_SUPABASE_SERVICE_ROLE_KEY
PRODUCTION_SUPABASE_URL
PRODUCTION_SUPABASE_ANON_KEY
PRODUCTION_SUPABASE_SERVICE_ROLE_KEY
```

Values must remain outside Git.

---

## 4. Correct the Broken Claude Environment

The previous Claude session was connected to the wrong Supabase account and had an invalid staging database URL whose hostname resolved to `base`.

### Required correction

1. Disconnect or stop using the MCP session that sees only `sfhtlzcgrnrdznhvdrbn`.
2. Re-authenticate Supabase MCP or CLI to the CarUp organization.
3. Verify that the account sees both exact refs:

```text
eoyenigwevnxwwhyhaer
vhmnajoeicasaigiophh
```

4. Verify the staging API URL is exactly:

```text
https://eoyenigwevnxwwhyhaer.supabase.co
```

5. Verify the production API URL is exactly:

```text
https://vhmnajoeicasaigiophh.supabase.co
```

6. Remove or replace any `.env.staging` value whose parsed hostname is `base`.
7. Do not commit the corrected `.env.staging` file.

### Direct connection format

A direct staging database URL has this structure:

```text
postgresql://postgres:[STAGING_DB_PASSWORD]@db.eoyenigwevnxwwhyhaer.supabase.co:5432/postgres
```

A direct production database URL has this structure:

```text
postgresql://postgres:[PRODUCTION_DB_PASSWORD]@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres
```

The passwords are different secrets and must be obtained securely from the respective project settings.

Direct database endpoints use IPv6 unless the project has IPv4 support. On an IPv4-only network, use the project’s **session-mode Supavisor pooler connection string copied from the Supabase Connect panel** rather than inventing a pooler hostname.

---

## 5. Preferred Access Method

### Option 1 — Correct Supabase MCP session

Preferred when the MCP account can see both approved CarUp projects.

Before any mutation, run a project-list operation and verify:

```text
staging    eoyenigwevnxwwhyhaer    carup-staging
production vhmnajoeicasaigiophh    CarUp
```

Every mutation request must include the exact project ref.

### Option 2 — Supabase CLI linked to staging

Use the CLI only after authenticating to the correct CarUp account.

```bash
supabase login
supabase projects list
supabase link --project-ref eoyenigwevnxwwhyhaer
```

The CLI may request `SUPABASE_DB_PASSWORD`. Enter the staging database password securely; do not place it in shell history or source files.

Verify the link before pushing:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
```

Do not run the real push until the dry-run output matches the approved migration set.

### Option 3 — Marker-aware repository migration runner

Use this when repository migrations contain explicit Up/Down markers that the standard CLI cannot safely interpret as-is.

Requirements:

- parse and execute only the Up section;
- print migration filenames and hashes, not secrets;
- stop on the first SQL error;
- record the migration ledger transactionally;
- verify expected schema after each migration;
- never use plain `psql -f` on a file containing both Up and Down sections.

---

## 6. Staging Authorization

Staging project:

```text
eoyenigwevnxwwhyhaer
```

Claude is authorized to complete the following on staging during this release session:

- read-only audit;
- apply the approved Vehicle Trust OS migrations;
- run the golden vehicle fixture journey;
- create clearly labelled staging fixtures;
- run RLS, OCR, review, trust, listing and continuity tests;
- correct migration or implementation errors on the release branch;
- rerun staging qualification until green.

Do not use real customer identity documents or secrets in staging fixtures.

Do not copy staging test accounts or fixtures into production.

---

## 7. Production Authorization Boundary

Production project:

```text
vhmnajoeicasaigiophh
```

The owner’s objective is to complete production release during this session. However, irreversible production mutation still requires a final cutover checkpoint.

Before production migration or merge, Claude must present one compact cutover manifest containing:

- release branch name;
- exact release commit SHA;
- release PR number;
- exact production project ref;
- exact migration filenames in order;
- migration file SHA-256 hashes;
- staging migration result;
- staging golden-vehicle result;
- RLS/grant matrix result;
- TypeScript/build/test counts;
- backup/recovery evidence;
- rollback or forward-fix plan;
- production smoke checklist.

Then request the exact authorization phrase:

```text
AUTHORIZE VEHICLE TRUST PRODUCTION CUTOVER
```

After that phrase, Claude may:

1. apply the approved migrations to production;
2. verify schema, RLS, grants, functions, triggers and indexes;
3. merge the approved release PR to `main`;
4. verify production backend/web deployment;
5. run production-safe labelled smoke tests;
6. publish the final closeout report.

No unrelated production mutation is authorized.

---

## 8. Error-Prevention Gates

The release must be fail-closed at every boundary.

### Environment identity gate

Before each migration or data mutation, assert:

- intended environment;
- exact project ref;
- exact API host;
- exact database host or linked project;
- no other project ref in environment variables;
- no placeholder host such as `base`;
- no production ref during staging work;
- no staging ref during production work.

### Migration gate

Before applying:

- migration ordering is deterministic;
- only Up sections execute;
- hashes match the cutover manifest;
- dry run or isolated apply/down/reapply is green;
- no unreviewed destructive statements;
- current remote migration ledger is captured;
- backup/recovery evidence exists for production.

### Application gate

Before production merge:

- no unresolved conflict markers;
- no unintended file changes;
- `npm ci` succeeds;
- TypeScript succeeds;
- Vite build succeeds;
- backend tests succeed;
- migration harness succeeds;
- RLS/auth tests succeed;
- Playwright critical journey succeeds;
- `git diff --check` succeeds;
- secret scan succeeds;
- CI is green on the exact release head.

### Trust safety gate

Do not release if any of these remain:

- cross-tenant read/write exposure;
- public access to private evidence or raw OCR/AI data;
- incomplete vehicle represented as fully verified;
- plate verification represented as whole-vehicle verification;
- unsupported live-government claim;
- lost audit event on a trust-changing mutation;
- evidence deletion erases provenance;
- ownership transfer creates a second disconnected passport;
- trust score cannot be explained by governed inputs.

---

## 9. Session Execution Priority

Claude must focus only on the shortest safe path to production:

```text
correct access
→ verify baseline
→ integrate PR #98
→ security/OCR/completeness corrections
→ staging migrations
→ golden vehicle
→ full release qualification
→ release PR
→ owner cutover authorization
→ production migrations
→ merge main
→ production smoke
→ closeout
```

Do not start new features, redesigns or post-MVP enhancements.

When an error occurs:

1. stop the failing mutation;
2. preserve logs without secrets;
3. identify exact file/table/environment;
4. implement the minimum correction;
5. rerun the failed gate;
6. rerun dependent regression gates;
7. continue only when green.

---

## 10. Final Required Outcome

The preferred end-of-session classification is:

```text
VEHICLE TRUST OS MVP LIVE — PRODUCTION SMOKE GREEN
```

Permitted fallback when a real blocker cannot be safely resolved:

```text
NOT READY — VEHICLE TRUST BLOCKERS REMAIN
```

Do not report production completion based only on local, CI or staging success.
