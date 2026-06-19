# CarUp RC1 — Web Build and Vitest Remediation

## Purpose

Restore the integrated `release/carup-v1-rc1` branch to a clean, reproducible web build and test baseline without weakening functionality, deleting tests, bypassing TypeScript, or masking integration defects.

This is a focused remediation milestone. It does not authorize staging deployment, database migration, data seeding, production writes, or merging into `main`.

---

## Current known state

The RC branch integrates work originating from PRs #73, #72, #11, #66, and #58.

Reported results:

- `node backend/tests/run-tests.js` — passed, 35 suites, exit `0`.
- `node --test backend/tests/marketplace-*.test.js` — passed, 147 tests, exit `0`.
- `cd web && npx vitest run` — failed, exit `1`, with 15 `ERR_MODULE_NOT_FOUND` or module-resolution errors.
- `npm run build --workspace=web` — failed, exit `2`.
- No draft RC pull request was created because the required web baseline failed.

The exact Vitest and TypeScript/build diagnostics must be preserved and classified before modifying code.

---

## Scope

You are authorized to:

- diagnose the web build and Vitest failures;
- repair dependency, module-resolution, TypeScript, test-environment, and integration-conflict defects within the web/shared contracts;
- update tests when the test expectation is demonstrably stale and the production contract is correct;
- update package manifests and lockfiles only when a dependency is genuinely required;
- update RC documentation;
- commit and push focused remediation changes to `release/carup-v1-rc1`;
- create a draft RC pull request only after all required baseline checks pass.

You are not authorized to:

- deploy to staging;
- apply any migration;
- seed any database;
- write production or staging data;
- merge any additional feature branch;
- merge into `main`;
- delete tests to obtain a green run;
- add `@ts-ignore`, `@ts-nocheck`, broad `any`, or disabled assertions as a shortcut;
- weaken auth, CSRF, fixture exclusion, PartSentry, verification, Diaspora, or privacy controls;
- replace real API behavior with mock fallback behavior in staging/production;
- change business scope beyond the failures being remediated.

---

## Phase A — Preserve and publish the checkpoint

Before changing application code:

1. Confirm the current branch:

```bash
git branch --show-current
```

Expected:

```text
release/carup-v1-rc1
```

2. Inspect the working tree:

```bash
git status --short
```

3. Confirm these repository documents exist and are tracked:

```text
docs/integration/CARUP_RELEASE_CANDIDATE_INTEGRATION_SPRINT.md
docs/integration/CARUP_V1_RC1_INTEGRATION_MATRIX.md
docs/integration/CARUP_V1_RC1_PHASE1_INTEGRITY_REPORT.md
```

4. If the integrity report or latest documentation commit exists only locally, push it before remediation:

```bash
git push origin release/carup-v1-rc1
```

5. Report the pre-remediation RC SHA:

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/release/carup-v1-rc1
```

The local and remote SHA must match before proceeding.

Stop if unrelated local modifications exist.

---

## Phase B — Reproduce from a clean dependency state

Do not assume the failures are code defects until dependency consistency is verified.

1. Record runtime/tool versions:

```bash
node --version
npm --version
npx tsc --version
```

2. Inspect workspace dependency health:

```bash
npm ls --workspaces --depth=0
npm explain vitest
npm explain vite
npm explain typescript
npm explain jsdom
npm explain @testing-library/react
npm explain @testing-library/jest-dom
```

3. Validate lockfile consistency without editing source:

```bash
npm ci
```

Use the repository root. Do not use `--legacy-peer-deps` unless the normal install fails and the reason is documented. Do not run `npm install` first because it may silently rewrite the lockfile.

4. After `npm ci`, reproduce each failure independently and save full logs:

```bash
npm run build --workspace=web > rc1-web-build-before.log 2>&1
echo $? > rc1-web-build-before.exit

cd web
npx vitest run --reporter=verbose > ../rc1-web-vitest-before.log 2>&1
echo $? > ../rc1-web-vitest-before.exit
cd ..
```

5. Print the complete relevant diagnostics, not only the last 20 lines:

```bash
cat rc1-web-build-before.exit
cat rc1-web-vitest-before.exit
sed -n '1,260p' rc1-web-build-before.log
sed -n '1,320p' rc1-web-vitest-before.log
```

If the logs exceed those ranges, identify every distinct error signature with file, line, module, and occurrence count.

---

## Phase C — Produce a failure inventory before editing

Create a table in the integrity report:

| ID | Command | Error class | Module/file | Root cause hypothesis | Evidence | Planned correction |
|---|---|---|---|---|---|---|

Classify failures into one of these categories:

1. Dependency missing from `package.json`.
2. Dependency present but not installed because local `node_modules` is stale.
3. Package/lockfile workspace mismatch.
4. Invalid import path or filename casing.
5. Missing source file after branch reconciliation.
6. Type export/import mismatch between `web`, `shared`, or `mobile`.
7. Vitest alias/config mismatch.
8. Missing test setup or jsdom configuration.
9. ESM/CommonJS incompatibility.
10. Genuine TypeScript integration defect.
11. Stale test expectation after an intentional contract change.
12. Duplicate package version or incompatible transitive dependency.

Do not edit code until every distinct error is represented in the inventory.

---

## Phase D — Focused configuration audit

Inspect and compare the following files against `main` and the originating feature branches:

```text
package.json
package-lock.json
web/package.json
web/tsconfig.json
web/tsconfig.app.json
web/tsconfig.node.json
web/vite.config.ts
web/playwright.config.ts
web/src/test/setup.ts
shared/package.json
shared/tsconfig.json
```

Also inspect all failing import sites.

Required checks:

- workspace packages are declared consistently;
- `@/*` aliases resolve identically in TypeScript, Vite, and Vitest;
- shared imports reference exported files that exist with exact case;
- tests use jsdom only where required;
- test setup imports installed packages;
- no branch merge reverted required test dependencies;
- no package is present only in one workspace when resolution expects it at root;
- no generated or local-only path is imported;
- no `.gemini`, Antigravity, scratch, or absolute `/Users/...` path appears in source/config;
- no source file contains unresolved conflict markers.

Run:

```bash
grep -RInE '/Users/|\.gemini|antigravity|brain/|scratch/' web shared package.json package-lock.json --exclude-dir=node_modules || true
grep -RInE '<<<<<<<|=======|>>>>>>>' web shared package.json package-lock.json || true
```

---

## Phase E — Minimal remediation

Apply the smallest correct fixes supported by the failure inventory.

### Dependency rules

- Add a package only when an actual runtime, build, or test import requires it.
- Place runtime packages in `dependencies` and test/build-only packages in `devDependencies`.
- Respect workspace ownership; do not duplicate packages without a documented reason.
- After manifest changes, regenerate `package-lock.json` using the normal repository install command.
- Do not downgrade major toolchains merely to hide an integration error without explicit evidence and approval.

### Import and type rules

- Correct import paths and filename casing.
- Restore missing exports rather than duplicating types.
- Prefer shared canonical types over parallel web-only copies.
- Do not introduce broad `any` or suppress TypeScript diagnostics.
- Preserve the current Marketplace URL contract, Navigation Intelligence coverage gate, CSRF behavior, and governed trust contracts.

### Test rules

- Do not delete or skip failing tests.
- Modify a test only when the expected behavior is stale and the new expected behavior is already supported by the approved feature contract.
- Add regression coverage for each repaired integration defect.
- Preserve PartSentry, identity verification, privacy, navigation, referral, and Diaspora assertions.

### Build rules

- The normal command `npm run build --workspace=web` must pass.
- Do not create a separate permissive build path for RC1.

---

## Phase F — Required verification after remediation

Run from a clean working tree after installing dependencies from the updated lockfile:

```bash
npm ci

node backend/tests/run-tests.js
node --test backend/tests/marketplace-*.test.js

npm run build --workspace=web
npx tsc --noEmit -p web/tsconfig.app.json

cd web
npx vitest run --reporter=verbose
cd ..

cd mobile
npx tsc --noEmit
cd ..
```

Then run directly relevant test groups for:

- Marketplace URL parameters;
- navbar coverage/deep links;
- Marketplace cards and privacy;
- PartSentry approval and listing summaries;
- verification admin review and decision policy;
- Diaspora shipment read authorization;
- auth middleware and user-session contract.

Run the existing Playwright suites for these visible URL contracts:

```text
/marketplace?maxPrice=5000
/marketplace?maxPrice=10000
/marketplace?sort=trust
/marketplace?q=Toyota
/marketplace?category=locally_used
```

The tests must verify visible filtered/sorted results, not merely URL parsing.

For each command record:

- exit code;
- pass/fail/skip count;
- duration;
- warnings;
- log path.

Stop if any required check fails. Do not proceed to deployment.

---

## Phase G — Review the remediation diff

Before committing:

```bash
git status --short
git diff --check
git diff --stat
git diff --name-status
git diff
```

Confirm:

- only remediation-related files changed;
- no migration or seed was executed;
- no production/staging environment variable changed;
- no generated logs, `.exit` files, temporary artifacts, `diff_stat.txt`, or `diff_name_status.txt` are committed;
- no credentials or absolute local paths appear;
- no test was removed or disabled;
- no privacy/security condition was weakened.

Commit with a focused message, for example:

```text
fix(rc1): restore web build and test module resolution
```

Push:

```bash
git push origin release/carup-v1-rc1
```

---

## Phase H — Update the integrity report

Update:

```text
docs/integration/CARUP_V1_RC1_PHASE1_INTEGRITY_REPORT.md
```

Include:

- pre-remediation SHA;
- post-remediation SHA;
- exact root causes;
- files changed;
- dependencies added/removed and why;
- tests added or corrected;
- complete before/after command results;
- remaining warnings;
- confirmation that no deployment, migration, seed, or production write occurred;
- recommendation: proceed to Phase 3 or remediate further.

Commit the documentation with the remediation, or in a directly adjacent documentation commit.

---

## Phase I — Draft RC pull request

Only when every required baseline command passes:

1. Confirm the remote RC branch contains the remediation commit.
2. Open a **draft** pull request:

```text
release/carup-v1-rc1 → main
```

Title:

```text
CarUp v1 RC1 — integrated release candidate
```

The draft body must include:

- integrated branch provenance;
- conflict resolutions;
- remediation root causes;
- complete test results;
- migrations not applied;
- staging not deployed;
- known limitations;
- explicit statement that the PR is not ready to merge.

Do not mark ready for review.
Do not merge.

---

## Mandatory stop conditions

Stop and report immediately if:

- `npm ci` cannot reproduce a deterministic dependency state;
- fixing the build requires removing an approved feature;
- a security or privacy control appears responsible for a failure;
- a migration/schema dependency is required to compile or unit-test the web application;
- more than the focused web/shared configuration surface must be redesigned;
- tests expose a business-contract conflict between integrated PRs;
- an absolute local file or untracked generated artifact was imported into application code;
- the RC branch diverges unexpectedly from its remote;
- any required command still fails after the minimal remediation attempt.

A stop report must include the exact command, full error signature, affected files, attempted correction, and safest next options.

---

## Required final report

Return:

- pre-remediation RC SHA;
- post-remediation RC SHA;
- root-cause inventory;
- files changed;
- dependency changes;
- tests added/updated;
- complete command results;
- draft PR link, if created;
- operations explicitly not performed;
- recommendation for the next phase.

Do not deploy or migrate as part of this milestone.
