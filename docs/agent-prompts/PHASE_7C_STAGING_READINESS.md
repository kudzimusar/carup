# Phase 7C — Staging Readiness, Database Consistency and Full-Suite Stabilization

## Purpose

This is the canonical execution prompt for the remaining CarUp Phase 7C work on PR #72.

Agents must read this file before making changes. Do not reconstruct this task from chat history.

## Repository and PR

- Repository: `kudzimusar/carup`
- Pull request: `#72`
- PR branch: `phase-7c-native-verification-production-loop`
- Baseline implementation head before documentation commits: `0c7353396c89bb0fdf199c968d35d55f3a89d3ff`
- Base branch: `main`

Always fetch and verify the current remote head before editing because the branch may advance after this document is committed.

## Non-negotiable boundaries

- Do not create a parallel verification system.
- Do not rewrite unrelated modules.
- Do not broaden the product scope.
- Do not merge PR #72.
- Do not enable auto-merge.
- Do not force-push.
- Do not apply production database migrations.
- Do not run arbitrary repository migrations against staging.
- Do not enable RLS across existing tables without compatible policies and tests.
- Do not commit secrets, database URLs, service-role keys, signed URLs, private evidence or personal documents.

## Confirmed Phase 7C implementation

The PR already contains:

- verification case workflow model
- structured reason-code taxonomy
- backend decision-policy engine
- append-only decision recorder
- two-pass document classification
- OCR quarantine behavior
- secure signed evidence previews
- admin case-management UI
- operational review queues
- mobile truthful-state handling
- CSRF corrections
- synthetic image fixtures
- additive case-management migrations

The two newest migrations are:

1. `database/migrations/20260618040000_verification_case_management.sql`
2. `database/migrations/20260618050000_verification_evidence_trust_columns.sql`

## Latest verified test state

Targeted Phase 7C suites were reported green, including:

- backend decision-policy tests
- backend classifier tests
- backend admin-review tests
- web case-management tests
- mobile truthful-state tests
- web TypeScript
- mobile TypeScript
- Expo iOS export

The full backend suite was not fully green at the last verified checkpoint:

- total: 474
- passed: 462
- failed: 5
- skipped: 7

The reported failing suites were:

- `audit-logger.test.js`
- `auth-middleware.test.js`
- `evidence-api.test.js`
- `evidence-validation.test.js`
- `trust-fact-workflow.test.js`

Do not leave these failures unexplained merely because they may also occur on an earlier commit.

---

# Database project boundaries

## Staging — only database target permitted for this task

- Project name: `carup-staging`
- Supabase project ID: `eoyenigwevnxwwhyhaer`

Last verified staging state:

- project status: active and healthy
- `trust_audit_events` exists
- `verification_sessions` does not exist
- `verification_ocr_provenance` does not exist
- migration history does not contain the Phase 7B/7C identity chain
- 39 public tables have RLS disabled

## Production — prohibited target

- Project name: `CarUp`
- Supabase project ID: `vhmnajoeicasaigiophh`

Production currently contains:

- `verification_sessions`
- `verification_ocr_provenance`
- `trust_audit_events`

Do not run SQL, migration scripts, cleanup, seed operations, test writes or schema verification queries that mutate production.

Every staging migration script must explicitly refuse the production project reference.

---

# Safe worktree

Do not modify the owner test worktree:

`/private/tmp/carup-phase7c`

Do not disturb unrelated work in:

`/Users/shadreckmusarurwa/Project AI/carup-kimi`

Create an isolated worktree:

```bash
cd "/Users/shadreckmusarurwa/Project AI/carup-kimi"
git fetch origin
git worktree remove /private/tmp/carup-phase7c-mimo-db --force 2>/dev/null || true
git worktree add --detach \
  /private/tmp/carup-phase7c-mimo-db \
  origin/phase-7c-native-verification-production-loop
cd /private/tmp/carup-phase7c-mimo-db
git switch -c mimo/phase7c-staging-readiness
git status --short
git rev-parse HEAD
```

Record the actual starting SHA. Do not assume the baseline SHA is still current.

---

# Workstream 1 — Resolve the full backend suite

Run:

```bash
cd backend
NODE_ENV=test ALLOW_OCR_MOCK=true node --test tests/
```

For every failure capture:

- suite and test name
- assertion
- expected value
- actual value
- stack trace
- root cause

Reproduce the same failing suite against the earlier Phase 7C base commit:

`09cb6b50eadade26d6ad90db1d09809928f5a5fe`

Use a separate detached worktree for baseline comparison.

For each failure:

1. identify the real cause
2. determine whether current Phase 7C changes affect it
3. apply the smallest safe correction
4. avoid unrelated refactoring
5. preserve or increase coverage
6. run the individual suite
7. run the full backend suite

Required result:

- zero failed tests
- skipped tests explained individually
- no tests deleted, weakened, broadly mocked or newly skipped merely to create a green result

---

# Workstream 2 — Staging schema preflight

Create:

`scripts/phase7c-staging-preflight.mjs`

Requirements:

- explicit project reference required
- accept staging project `eoyenigwevnxwwhyhaer`
- reject production project `vhmnajoeicasaigiophh`
- read-only by default
- never print secrets or connection strings
- no database mutation in preflight mode

Inspect these required tables:

- `users`
- `user_sessions`
- `login_attempts`
- `ocr_documents`
- `verification_sessions`
- `trust_audit_events`
- `verification_ocr_provenance`
- `verification_assessments`
- `verification_decisions`

Inspect storage:

- bucket `ocr-documents`
- bucket must be private

Inspect these `verification_sessions` columns:

- `review_decision`
- `retry_reason`
- `liveness_status`
- `workflow_phase`
- `final_disposition`
- `primary_reason_code`
- `next_actor`
- `required_action`
- `notification_status`
- `notification_attempted_at`
- `version`
- `evidence_classification`
- `ocr_execution_status`
- `extraction_trust_status`
- `identity_binding_status`
- `selfie_check_status`

The report must use clear states:

- `PRESENT`
- `MISSING`
- `TYPE MISMATCH`
- `CONSTRAINT MISMATCH`
- `RLS ENABLED`
- `RLS DISABLED`
- `REQUIRED MIGRATION`

---

# Workstream 3 — Validate the staging migration chain

Approved identity migration order:

1. `database/migrations/20260613000000_phase7b_supabase_auth_and_identity.sql`
2. `database/migrations/20260613020000_verification_admin_review.sql`
3. `database/migrations/20260618030000_verification_ocr_provenance.sql`
4. `database/migrations/20260618040000_verification_case_management.sql`
5. `database/migrations/20260618050000_verification_evidence_trust_columns.sql`

Do not blindly replay:

`database/migrations/20260603233640_governance_foundation_trust_audit_events.sql`

Reason: staging already contains `trust_audit_events` and existing rows must be preserved.

Instead compare the live staging table to the repository definition:

- columns
- data types
- indexes
- RLS state
- grants

If fully compatible, leave it unchanged.

If additive alignment is needed, create a new additive alignment migration. Never drop, truncate or recreate the table.

Before approving the chain, verify:

- `users` exists
- `users.id` is compatible with all identity foreign keys
- existing `user_sessions` does not conflict with the Phase 7B migration
- `ocr_documents` is absent or compatible
- storage schema is available
- `storage.buckets` is available
- `pgcrypto` is available
- no existing object will be destructively rewritten

---

# Workstream 4 — Safe staging migration runner

Create:

`scripts/apply-phase7c-staging-migrations.mjs`

Modes:

- `--dry-run`
- `--verify-only`
- `--apply`

Rules:

- dry-run is the default
- mutation requires `--apply`
- require `SUPABASE_PROJECT_REF=eoyenigwevnxwwhyhaer`
- reject `vhmnajoeicasaigiophh`
- reject arbitrary project references
- accept no arbitrary migration directory
- apply only the five approved migration files
- apply them only in the approved order
- use stop-on-error behavior
- stop on the first failure
- report each migration start and completion
- print no secrets
- apply no unrelated Diaspora, referral, marketplace, finance, registry or legacy migrations
- do not fabricate migration-history records
- do not edit `supabase_migrations.schema_migrations` manually

Do not execute `--apply` until the owner explicitly authorizes staging DDL after reviewing the final report.

---

# Workstream 5 — Post-migration verification

Create:

`scripts/verify-phase7c-staging-schema.mjs`

Validate:

- all required tables exist
- all required columns exist
- foreign keys target compatible columns
- expected indexes exist
- RLS is enabled on Phase 7B/7C identity tables
- `anon` has no direct table access
- `authenticated` has no direct table access
- `service_role` retains backend access
- `ocr-documents` is private
- no public policy exposes raw evidence paths
- the script refuses production

Capture pre- and post-migration row counts for:

- `users`
- `user_sessions`
- `trust_audit_events`

Prove existing rows are preserved.

Prove the five migrations are idempotent in a disposable/local database or an explicitly authorized staging run.

---

# Workstream 6 — Migration-history reconciliation

Create:

`docs/DATABASE_MIGRATION_RECONCILIATION.md`

Document production and staging separately.

Production project:

`vhmnajoeicasaigiophh`

Staging project:

`eoyenigwevnxwwhyhaer`

Include:

- migrations recorded by Supabase
- important schema objects that exist without recorded migrations
- missing staging identity migrations
- known manually applied DDL
- schema drift risks
- safe reconciliation recommendations
- future migration policy

Do not insert fake historical migration rows.

Future policy must require:

1. repository migration
2. staging application
3. schema verification
4. owner acceptance
5. production authorization
6. production application
7. migration record
8. rollback or recovery note

---

# Workstream 7 — RLS security inventory

Confirmed last-known counts:

- production tables without RLS: 27
- staging tables without RLS: 39

Do not enable broad RLS in this task.

Create:

`docs/DATABASE_RLS_REMEDIATION_PLAN.md`

For every table without RLS, classify it as one of:

- public reference data
- backend-only operational data
- tenant-owned data
- user-owned data
- financial data
- identity/PII
- audit/logging
- unknown / owner decision required

For each table record:

- current readers and writers
- intended actors
- proposed policy model
- risk of enabling RLS without policies
- priority
- required regression tests

Priority 0 must include identity, financial, authentication and administrative tables.

This workstream is inventory and planning only.

---

# Workstream 8 — Frontend Vercel status

The last frontend Vercel checks failed because the Free plan daily deployment quota was exhausted:

`api-deployments-free-per-day`

Do not label this a code failure without build evidence.

Do not create empty commits or repeatedly push to trigger deployments.

Required:

1. run local web TypeScript
2. run local web production build
3. record exact results
4. classify Vercel as `EXTERNAL QUOTA BLOCKER`
5. record the final SHA that needs deployment after quota reset
6. do not claim deployment success until Vercel reports success

---

# Workstream 9 — Correct PR #72 documentation

The current PR body contains outdated statements about:

- the old admin page
- old migration states
- old test totals
- evidence preview restrictions that no longer apply
- pending migrations already changed later

Update the PR body to accurately describe:

- case-management architecture
- classifier and two-pass flow
- OCR quarantine
- decision-policy engine
- reason codes
- operational queues
- secure signed previews
- mobile truthful-state behavior
- CSRF fixes
- all new migrations
- production migration state
- staging schema drift
- exact full-suite and targeted-suite totals
- Vercel quota blocker
- staging acceptance plan
- explicit no-merge recommendation

Do not claim:

- the new case-management migrations are applied to production
- staging is ready before verification
- the full backend suite is green before it is zero-failure
- frontend Vercel deployment succeeded while quota-blocked

---

# Workstream 10 — Final validation

Run from the committed tree:

```bash
git diff --check
```

Backend:

```bash
cd backend
NODE_ENV=test ALLOW_OCR_MOCK=true node --test tests/
node --test tests/verification-decision-policy.test.js
node --test tests/identity-document-classifier.test.js
node --test tests/verification-admin-review.test.js
node --test tests/verification-ocr-provenance.test.js
node --test tests/verification-session-workflow.test.js
```

Required full-suite result: zero failed.

Web:

```bash
cd web
npx tsc --noEmit
npx vitest run
npm run build
```

Mobile:

```bash
cd mobile
npx tsc --noEmit -p tsconfig.json
npx vitest run
npx expo export --platform ios --output-dir /tmp/carup-phase7c-ios-export
```

Database tooling tests must include:

- missing project reference rejection
- wrong project reference rejection
- production reference rejection
- dry-run ordering
- only approved files selected
- missing prerequisite detection
- no-secret-output verification
- idempotency verification logic

---

# Commit and push policy

Create focused commits, for example:

1. `fix(test): resolve remaining full backend suite failures`
2. `feat(db): add Phase 7C staging preflight and safe migration runner`
3. `test(db): add staging schema and migration safety coverage`
4. `docs(db): add migration reconciliation and RLS remediation plans`
5. `docs(7C): update lifecycle and staging acceptance guidance`

Before pushing:

```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/phase-7c-native-verification-production-loop
```

If the remote branch advanced, integrate normally. Never force-push.

Push to the existing PR branch:

```bash
git push origin HEAD:phase-7c-native-verification-production-loop
```

After pushing, fetch and confirm local and remote SHAs match.

---

# Stop conditions

Stop before staging DDL when all of the following are complete:

- full backend suite is zero-failure
- scripts are committed and tested
- migration dependency chain is validated
- staging preflight reports exact missing objects
- trust audit compatibility is documented
- PR #72 description is current
- remote branch is updated

Do not:

- apply staging DDL without explicit owner authorization
- touch production
- merge
- enable auto-merge
- trigger repeated Vercel deployments
- enable broad RLS policies

---

# Required final report

Return:

1. starting SHA
2. ending local SHA
3. remote PR SHA
4. complete backend totals
5. root cause and fix for each previous failure
6. staging preflight result
7. exact approved migration chain
8. `trust_audit_events` compatibility result
9. migration runner files and safety guards
10. schema verification result
11. migration-history reconciliation summary
12. RLS inventory summary
13. web tests and production build
14. mobile tests, typecheck and Expo export
15. Vercel quota status
16. commits created
17. push confirmation
18. PR update confirmation
19. exact staging DDL command awaiting owner approval
20. explicit no-merge recommendation

Do not ask what to do next until this report is complete or a genuine external-access blocker prevents progress.