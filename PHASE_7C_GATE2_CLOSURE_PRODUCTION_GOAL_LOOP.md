# CarUp Phase 7C Gate 2 Closure and Production Goal Loop

> **Authoritative execution directive**
>
> Repository: `kudzimusar/carup`  
> Feature PR: `#72`  
> Feature branch: `phase-7c-native-verification-production-loop`  
> Staging Supabase: `eoyenigwevnxwwhyhaer`  
> Production Supabase: `vhmnajoeicasaigiophh`
>
> This file must remain in the repository after delivery as the durable implementation, release, and audit reference for Phase 7C.

---

## 1. Mission

Close the Phase 7C Verification Governance and Native Mobile Gate 2 feature completely, consolidate it into one current-`main` release path, and prepare a safe production cutover.

The finished feature must prove the full user and operator loop:

```text
mobile login
→ start verification
→ submit controlled evidence
→ backend creates verification session
→ evidence is classified and OCR provenance is recorded
→ unsafe/non-document evidence fails closed or enters quarantine
→ administrator reviews the case
→ administrator approves, rejects, escalates, or requests resubmission
→ backend persists the decision and audit chain
→ mobile refreshes the truthful stored status
→ user resubmits where requested
→ final decision is visible and consistent across mobile and admin
```

This is a closure programme, not another planning exercise.

The target is not an impossible promise of zero future bugs. The release standard is:

- zero known P0 defects;
- zero known P1 defects;
- all required automated gates passing;
- physical-device Gate 2 passing;
- staging schema and deployment verified;
- one clean current-main release PR;
- exact production migration and rollback plan;
- bounded production smoke test passing after explicit owner authorization.

---

## 2. Non-negotiable operating rules

1. Work autonomously through the stages in this file.
2. Do not stop for internal phase approvals.
3. Pause only for:
   - owner physical-device testing; and
   - the explicit production authorization phrase:
     `AUTHORIZE PHASE 7C PRODUCTION CUTOVER`.
4. Do not commit directly to `main`.
5. Do not merge PR #72 directly because it is historically diverged from current `main`.
6. Do not blindly reuse stale PR #76.
7. Do not create a stack of Phase 7C PRs.
8. Use one clean current-main release PR after Gate 2 is verified.
9. Never force-push unless preserving the branch is impossible and the owner explicitly approves.
10. Never print secrets, tokens, complete environment files, production credentials, or unredacted identity data.
11. Never claim `PASS`, `green`, `deployed`, `migrated`, or `production verified` without exact evidence.
12. Preserve newer current-main behavior when resolving conflicts.
13. Keep this file updated as the closure ledger.

---

## 3. Continuous `/loop` protocol

Repeat this cycle until the Definition of Done is met:

1. Fetch repository and GitHub truth.
2. Update the ledger in this file.
3. Select the highest-risk unresolved blocker.
4. Implement the smallest correct fix.
5. Run focused tests.
6. Run broader regression after focused tests pass.
7. Commit intended files only.
8. Push without force.
9. Verify the remote SHA and remote CI.
10. Record exact commands, totals, failures, and evidence.
11. Continue automatically.

Use these statuses in the ledger:

- `NOT STARTED`
- `IN PROGRESS`
- `BLOCKED — EXTERNAL`
- `IMPLEMENTED — UNVERIFIED`
- `VERIFIED ON STAGING`
- `VERIFIED ON OWNER DEVICE`
- `VERIFIED IN PRODUCTION`
- `CLOSED`

---

## 4. Initial repository truth check

Before changing code, run:

```bash
git remote -v
git status --short
git branch --show-current
git log --oneline --decorate -20
git fetch --all --prune

gh pr view 72 --json \
  state,isDraft,mergeable,headRefName,headRefOid,baseRefName,commits,files,statusCheckRollup

gh pr view 76 --json \
  state,isDraft,mergeable,headRefName,headRefOid,baseRefName,commits,files,statusCheckRollup

git rev-list --left-right --count \
  origin/main...origin/phase-7c-native-verification-production-loop

git rev-list --left-right --count \
  origin/main...origin/release/carup-v1-rc1
```

Also inspect whether these reported local SHAs exist:

```bash
git cat-file -t a341356bec6cba4929ac61ca1eec37444bf15c25 || true
git cat-file -t 82a89d8549f4aaf8486475adcdd9a262a06710be || true
```

Determine and record:

- current `main` SHA;
- PR #72 remote SHA and divergence;
- PR #76 remote SHA and divergence;
- uncommitted local files;
- local-only commits;
- which Phase 7C commits are already in PR #76;
- which Phase 7C files are already in current `main`;
- migration state on staging and production.

Historical snapshot at the time this directive was created:

- PR #72 remote head was `270c7d1b5b0cc1885fd7f8eafa0acd691d1ed17d`;
- reported launcher SHAs were not visible remotely;
- `scripts/start-phase7c-gate2-mobile.sh` was absent from the remote PR #72 branch.

Treat this snapshot only as a starting point; live repository state is authoritative.

---

## 5. Gate 2 launcher completion

Required files:

```text
scripts/start-phase7c-gate2-mobile.sh
docs/guides/PHASE_7C_GATE2_OWNER_MOBILE_TEST.md
mobile/package.json
package-lock.json
```

The launcher must satisfy all of these requirements:

1. Works from repository root and from `mobile/`.
2. Refuses execution outside the CarUp repository.
3. Checks free disk before installation.
4. Defaults to `2500 MB` minimum free space.
5. Supports `PHASE7C_GATE2_MIN_FREE_MB` override.
6. Creates `mobile/.env.local` only when missing.
7. Never overwrites an existing `mobile/.env.local`.
8. Validates an existing env file without printing its values.
9. Requires the deployed staging backend.
10. Rejects localhost, `127.0.0.1`, `0.0.0.0`, and dev API fallback.
11. Requires local-development fallback to be disabled.
12. Never prints secrets or the complete env file.
13. Uses a focused mobile workspace installation suitable for the low-disk Mac.
14. Preserves workspace dependency resolution.
15. Verifies:
    - `expo-router/entry`;
    - `react-native-web`;
    - `semver/functions/satisfies`;
    - `react-native-reanimated`.
16. Uses LAN by default.
17. Supports `--tunnel` explicitly.
18. Supports `--verify-only` without starting Expo.
19. Prints cleanup instructions.
20. Exits non-zero for every failed prerequisite.
21. Does not commit `mobile/.env.local`.
22. Confirms `.gitignore` excludes local mobile env files.

Add deterministic launcher tests for:

- missing env file;
- valid existing env file;
- localhost rejection;
- wrong backend rejection;
- fallback-enabled rejection;
- low-disk rejection;
- missing dependency;
- verify-only success;
- verify-only failure;
- no secret output.

Push the launcher to PR #72 and verify the file list remotely before asking the owner to run it.

---

## 6. Automated verification gates

Run from a clean install.

### Launcher

```bash
./scripts/start-phase7c-gate2-mobile.sh --verify-only
```

### Mobile

```bash
npm run ts:check --workspace=mobile
cd mobile
npx vitest run --config vitest.config.ts
npx expo export --platform ios --output-dir dist-phase7c-gate2 --clear
cd ..
```

### Web

```bash
npx tsc -p web/tsconfig.app.json --noEmit
npm run test:unit --workspace=web
npm run build --workspace=web
```

### Backend

Run all Phase 7C suites covering:

- verification session workflow;
- admin review;
- decision policy;
- decision recording;
- reason codes;
- identity binding;
- document classification;
- evidence validation;
- OCR mock guard;
- OCR provenance;
- audit logging;
- authorization boundaries;
- signed preview access and expiry;
- stale-version handling;
- idempotency;
- event-worker behavior.

### Repository hygiene

```bash
git diff --check
```

Run the repository secret scanner against source, diff, templates, build output, and generated artifacts.

Required result:

- zero TypeScript errors;
- zero test failures;
- exact pass/skip totals recorded;
- mobile Expo export succeeds;
- web production build succeeds;
- zero active credential matches;
- no secret output.

---

## 7. Database and migration reconciliation

Projects:

```text
STAGING:    eoyenigwevnxwwhyhaer
PRODUCTION: vhmnajoeicasaigiophh
```

Perform read-only inventory first.

Inspect:

- migration history;
- `verification_sessions`;
- OCR provenance tables;
- case-management and assessment tables;
- decision records;
- evidence-trust columns;
- indexes and foreign keys;
- RLS and privileges;
- storage bucket privacy;
- functions and triggers;
- current row counts.

Compare against:

```text
database/migrations/20260613020000_verification_admin_review.sql
database/migrations/20260618030000_verification_ocr_provenance.sql
database/migrations/20260618040000_verification_case_management.sql
database/migrations/20260618050000_verification_evidence_trust_columns.sql
```

Rules:

- never edit an already-applied migration;
- use an additive, idempotent reconciliation migration when live schema differs;
- do not run an unrestricted broad migration push;
- staging may be mutated only after exact manifest review;
- production remains read-only until explicit cutover authorization.

For staging:

1. Confirm backup/restore capability.
2. Apply only missing Phase 7C migrations.
3. Verify every object individually.
4. Confirm existing rows remain intact.
5. Run Supabase security and performance advisors.
6. Record migration versions and checksums.

For production:

- inventory only;
- produce exact absent-migration manifest;
- produce rollback strategy;
- make no changes yet.

---

## 8. Staging deployment and acceptance

Deploy the exact tested SHA to staging backend and web.

Verify:

- backend health;
- web loads;
- web targets staging backend;
- mobile env targets staging backend;
- no localhost fallback;
- no production project reference;
- admin verification route is reachable;
- signed previews use staging storage;
- mock OCR cannot create a real identity approval.

Record deployment IDs and exact SHA.

### Required staging scenarios

#### A. Valid controlled document

- mobile user logs in;
- starts verification;
- uploads controlled evidence;
- backend creates session;
- OCR provenance is recorded;
- admin reviews signed preview;
- admin approves;
- mobile refreshes to Approved;
- audit chain persists.

#### B. Resubmission

- inadequate evidence submitted;
- admin requests resubmission with reason code;
- mobile refreshes to Resubmission Required;
- reason and retry CTA are visible;
- replacement evidence submitted;
- workflow updates safely;
- admin approves;
- mobile displays final state.

#### C. Rejection

- admin rejects with reason;
- mobile displays Rejected;
- no stale Processing state remains;
- actor, reason, and version are audited.

#### D. Escalation

- admin escalates;
- case enters correct queue;
- unauthorized users cannot decide;
- mobile state remains truthful.

#### E. Non-document fail-closed

Use controlled fixtures such as cup, desk object, blank image, screenshot, or corrupted image.

- evidence is rejected or quarantined;
- no fabricated identity fields are accepted;
- false approval is impossible.

#### F. Authorization

- users cannot read another user’s verification;
- unauthorized operators cannot decide;
- signed previews expire;
- preview responses use `no-store`;
- raw identity data is absent from logs and public responses.

#### G. Concurrency and idempotency

- duplicate submission does not create duplicate decisions;
- stale-version decision fails;
- duplicate admin command is idempotent;
- worker retry does not corrupt state.

Update:

```text
docs/reports/PHASE_7C_STAGING_ACCEPTANCE_REPORT.md
```

Set status:

```text
AUTOMATED STAGING PASS — OWNER DEVICE GATE REQUIRED
```

---

## 9. Owner physical-device Gate 2

This is the first mandatory pause.

Before requesting the owner test, report:

- remote SHA;
- PR #72 head;
- launcher verification result;
- minimum free-disk requirement;
- mobile TypeScript result;
- exact mobile Vitest total;
- Expo export result;
- staging backend host without credentials;
- root startup command;
- mobile-directory startup command;
- tunnel fallback command.

Canonical commands:

```bash
# From repository root
./scripts/start-phase7c-gate2-mobile.sh

# From mobile/
../scripts/start-phase7c-gate2-mobile.sh

# Tunnel fallback
./scripts/start-phase7c-gate2-mobile.sh --tunnel
```

Owner checklist:

1. Launcher completes.
2. Expo starts without semver/Reanimated errors.
3. App opens on physical device.
4. Login succeeds.
5. Authenticated tabs load.
6. Verification starts.
7. Controlled evidence uploads.
8. Processing state appears.
9. Admin locates session.
10. Admin requests resubmission.
11. Mobile refreshes to Resubmission Required.
12. User resubmits.
13. Admin approves.
14. Mobile refreshes to Approved.
15. Controlled non-document cannot create a false approval.

Capture:

- device/platform;
- Expo Go or development client;
- LAN or tunnel;
- opaque test account ID;
- verification session ID;
- timestamps;
- redacted screenshots;
- PASS/FAIL per step;
- errors and logs.

Gate 2 passes only when P0 = 0, P1 = 0, and the complete physical-device critical path succeeds.

---

## 10. Owner-defect loop

For every owner-reported defect:

1. Reproduce.
2. Classify P0/P1/P2/P3.
3. Fix all P0/P1 immediately.
4. Add regression test.
5. Rerun focused and broader suites.
6. Push.
7. Redeploy staging.
8. Ask owner to repeat only affected steps.
9. Update acceptance report.

Final Gate 2 status:

```text
GATE 2 PASS — READY FOR CURRENT-MAIN RELEASE INTEGRATION
```

---

## 11. Clean current-main release integration

Do not merge the diverged PR #72 directly.

After Gate 2 passes:

1. Create a clean branch from latest `origin/main`:

```text
release/phase7c-verification-production
```

2. Build a delta matrix:

- PR #72 unique commits;
- Phase 7C commits already in PR #76;
- Phase 7C code already in current `main`;
- launcher commits;
- migrations;
- tests;
- docs;
- conflicts;
- obsolete code.

3. Integrate only the verified Phase 7C delta.
4. Preserve newer main behavior.
5. Do not import unrelated stale RC1 code.
6. Prefer clean logical cherry-picks; reapply the minimal final diff where needed.

Required release contents:

- native verification flow;
- truthful mobile state;
- admin review and case management;
- decision policy and reason taxonomy;
- classifier and quarantine;
- OCR provenance;
- signed-preview protection;
- authorization boundaries;
- required migrations;
- Gate 2 launcher;
- automated tests;
- staging and owner reports;
- production manifest and rollback plan;
- this directive file.

Open exactly one PR:

```text
release(phase7c): verification governance and native Gate 2
```

Base: `main`.

---

## 12. PR consolidation

After the clean release PR contains the verified final delta:

### PR #72

- comment that it is superseded by the clean release PR;
- link the successor;
- record final Gate 2 evidence;
- close without merging.

### PR #76

- mark its embedded Phase 7C snapshot superseded;
- audit unrelated Marketplace, PartSentry, Registry, and Diaspora content;
- do not close PR #76 until every unrelated component has a verified successor;
- record final disposition in:

```text
docs/PROJECT_PR_CONSOLIDATION_LEDGER.md
```

---

## 13. Release qualification

On the exact clean release PR SHA, run:

- clean `npm ci`;
- web TypeScript;
- web unit tests;
- web production build;
- mobile TypeScript;
- mobile Vitest;
- Expo iOS export;
- all Phase 7C backend tests;
- authentication and authorization regressions;
- evidence, audit, and event-worker regressions;
- navigation tests;
- Playwright admin-verification flows;
- staging acceptance;
- owner Gate 2 evidence;
- `git diff --check`;
- secret scan;
- migration dry run;
- staging schema verification;
- Supabase advisors.

Requirements:

- branch is 0 behind main;
- all CI checks pass;
- all preview deployments pass;
- every review thread resolved;
- exact totals are recorded;
- P0 = 0;
- P1 = 0.

---

## 14. Production preflight

Create:

```text
docs/releases/PHASE_7C_PRODUCTION_CUTOVER_RUNBOOK.md
```

The runbook must include:

- current production schema inventory;
- exact missing migration list;
- migration checksums;
- backup/restore reference;
- production environment validation;
- previous backend/web deployment IDs;
- deployment order;
- smoke tests;
- monitoring;
- rollback triggers;
- rollback commands;
- expected duration;
- responsible actor.

Before requesting authorization, confirm:

- production project is correct;
- no staging variables in production;
- no localhost fallback;
- no active credentials in source;
- storage bucket private;
- backup/restore ready;
- rollback rehearsed;
- no known P0/P1 defects;
- bounded internal smoke account prepared;
- synthetic evidence cannot be mistaken for real identity evidence.

Then pause and request exactly:

```text
AUTHORIZE PHASE 7C PRODUCTION CUTOVER
```

---

## 15. Production cutover

Execute only after the exact authorization phrase.

Order:

1. Record current main and production deployment SHAs.
2. Merge the qualified clean release PR into `main`.
3. Verify merge SHA and main CI.
4. Create or verify database restore point.
5. Apply only missing Phase 7C migrations.
6. Verify schema, indexes, triggers, RLS, privileges, and row preservation.
7. Deploy backend first.
8. Verify backend health and production project binding.
9. Run bounded backend smoke tests.
10. Deploy web admin interface.
11. Verify authorization and signed previews.
12. Build or publish the native production artifact/update only through the established mobile release process.
13. Do not submit to App Store or Google Play unless explicitly authorized and signing requirements are valid.
14. Run bounded internal verification smoke test.
15. Monitor logs and telemetry.

Production smoke must prove:

- login;
- verification session creation;
- controlled evidence submission;
- admin case visibility;
- signed preview;
- resubmission;
- mobile refresh;
- final decision;
- audit chain;
- unauthorized access rejection;
- non-document fail-closed behavior.

Never use real customer identity documents for smoke testing.

---

## 16. Rollback conditions

Rollback immediately for:

- migration failure;
- broad authentication failure;
- session creation failure;
- unsafe admin-review failure;
- cross-user data exposure;
- signed-preview leakage;
- false approval from non-document evidence;
- incorrect mobile final status;
- audit-chain failure;
- major production error spike;
- deployment/project mismatch.

Rollback strategy:

- redeploy previous backend and web deployments;
- disable feature through existing flags where available;
- prefer forward database repair for additive migrations;
- do not destroy evidence, decisions, audits, or user records;
- run Down sections only when tested and demonstrably safe;
- roll back mobile update channel/artifact through the established release process.

---

## 17. Production observation and closure

Observe:

- API errors;
- session failures;
- upload failures;
- OCR/classifier errors;
- admin decision failures;
- signed-preview failures;
- worker retries;
- mobile status mismatches;
- authorization failures;
- RLS errors;
- database performance.

Create final report:

```text
docs/releases/PHASE_7C_PRODUCTION_COMPLETION_REPORT.md
```

After the stabilization window:

- close resolved issues;
- preserve audit evidence;
- clean safe staging test data;
- update project progress documentation;
- tag the release;
- set this ledger status to `CLOSED`.

---

## 18. Definition of Done

Phase 7C is complete only when every item is true:

- Gate 2 launcher is committed remotely.
- Existing mobile env files are never overwritten.
- Launcher works on the owner’s low-disk Mac.
- Mobile dependencies resolve correctly.
- Mobile TypeScript passes.
- Mobile Vitest passes.
- Expo export passes.
- Web TypeScript, tests, and build pass.
- All Phase 7C backend tests pass.
- Staging schema matches tracked migrations.
- Staging security checks pass.
- Full staging verification lifecycle passes.
- Owner physical-device Gate 2 passes.
- Non-document evidence fails closed.
- Admin review, resubmission, rejection, escalation, and approval work.
- Mobile shows the truthful persisted result.
- One clean current-main release PR exists.
- Clean release branch is 0 behind main.
- All CI and preview checks pass.
- PR #72 is closed as superseded.
- PR #76’s embedded Phase 7C snapshot is formally superseded.
- Production backup and rollback are ready.
- Production migration succeeds after authorization.
- Backend and web production deployments succeed.
- Native production release succeeds where authorized.
- Production smoke passes.
- P0 remaining = 0.
- P1 remaining = 0.
- No active credentials exist in source.
- Production observation shows no release-blocking regression.
- Completion report is committed.

Final status must be one of:

```text
PHASE 7C CLOSED — MERGED AND PRODUCTION VERIFIED
```

or

```text
PHASE 7C BLOCKED — <exact unresolved external blocker>
```

---

## 19. Final response contract

Return:

1. Initial PR #72 SHA and state
2. Recovered launcher SHA
3. Final Phase 7C feature SHA
4. Clean release PR number
5. Final merge SHA
6. PR #72 closure result
7. PR #76 Phase 7C disposition
8. Changed files
9. Migration manifest and checksums
10. Staging schema verification
11. Automated commands and exact totals
12. Owner device and network mode
13. Owner Gate 2 result
14. Staging deployment IDs
15. Production backup reference
16. Production migration result
17. Production deployment IDs
18. Mobile build/update result
19. Production smoke result
20. Supabase advisor result
21. Monitoring result
22. Remaining P2/P3 limitations
23. Rollback readiness
24. Final closure status

Never substitute confidence for evidence.
