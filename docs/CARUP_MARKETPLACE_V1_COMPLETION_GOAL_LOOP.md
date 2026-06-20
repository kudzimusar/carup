# CarUp Marketplace v1 — Completion Goal and Merge Loop

**Document status:** Active execution directive  
**Primary repository:** `kudzimusar/carup`  
**Primary feature PR:** `#73`  
**Audience:** Claude Code and any supporting implementation/release agents  
**Execution rule:** Read this document completely before changing code, branches, deployments, databases, PR metadata, or worktrees.

---

## 1. Mission

Finish Marketplace v1 as an integrated CarUp capability, merge it safely into `main`, verify the combined system, and preserve a clean path to public launch.

The immediate target is **not more Marketplace feature development**. The immediate target is:

1. integrate the latest stable `main` into PR #73;
2. run the complete release-candidate test suite;
3. push the updated PR branch without rewriting history;
4. make PR #73 fully merge-ready;
5. stop before merge and request explicit human approval;
6. after explicit merge approval, squash-merge and verify the combined system;
7. keep production access-control containment tracked separately under Issue #77.

Marketplace v1 must stop being an isolated branch and become part of the full CarUp system without losing security, trust, web, mobile, diaspora, referral, seller, buyer, admin, or evidence behavior.

---

## 2. Current Canonical State

This section is a snapshot. Resolve all remote state again at execution time.

### Marketplace PR

- PR: `#73`
- Branch: `feature/marketplace-v1-production-integration`
- Base: `main`
- Last verified feature head: `2e88f50a0f9f4377214c7bb86eafb8a54c87956c`
- Last verified state: open, mergeable, not draft, unmerged
- Marketplace production inquiry schema migration: completed and verified
- Production session-contract migration: intentionally skipped because production already satisfied the contract

### Last known `main`

- Snapshot SHA: `3ac2ff23a60f545bbafed8d4d256277209f3adf9`
- `main` was moving because another process was actively landing work.
- Never assume this SHA is still current.

### Completed functional gates

- Public Marketplace browse/detail: PASS
- Buyer save/compare/inquiry flows: PASS
- Seller inquiry and sold-status flows: PASS
- Admin moderation and audit flows: PASS
- Mobile Marketplace list/detail/inquiry smoke: PASS
- Staging backend and web health: PASS
- Marketplace production migration and synthetic cleanup: PASS

### Separate security work

- Public tracking issue: `#77`
- Branch: `security/production-access-containment`
- Dedicated worktree may exist at:
  `/Users/shadreckmusarurwa/Project AI/carup-security-containment`
- This work is separate from PR #73.
- Do not add its migration or private findings to PR #73.
- Do not publish private production-security evidence in the public repository.

### Local-work protection

A local documentation/security checkpoint commit has existed outside the PR branch:

`dcc37094fa156209085d2fb35e97299b44aa0db6`

Do not reset, delete, amend, cherry-pick, force-push, or otherwise alter it unless the user explicitly instructs you to do so.

---

## 3. Definition of Done

Marketplace v1 is complete only when all of the following are true:

### Merge preparation

- PR #73 contains the latest stable `main`.
- The PR branch includes both the original Marketplace head and latest `main` ancestry.
- No unresolved merge conflicts remain.
- Full backend, web, mobile, build, and Playwright gates pass from the merged candidate.
- Remote PR checks pass on the new head.
- PR description and final readiness comment accurately reflect production and QA state.
- PR remains open until explicit human merge approval.

### Merge execution

- Explicit user instruction `MERGE PR #73` is received after a `READY FOR EXPLICIT MERGE APPROVAL` report.
- PR #73 is squash-merged into `main`.
- The resulting `main` contains Marketplace v1 and the latest pre-merge main changes.
- No unapproved production database or security change occurs during merge.

### Post-merge system verification

- `main` build and critical tests pass.
- Staging or preview deployment from merged `main` is healthy.
- Public Marketplace, auth, buyer, seller, admin, mobile API, referral, and diaspora-safe inquiry smoke paths pass.
- Production deployment occurs only after explicit approval and through the established deployment path.

### Public-launch protection

- Issue #77 remains tracked as the access-control hardening gate.
- Private production-security details stay private.
- Broad public launch is not declared complete until the separate containment work is reviewed, tested, and approved.

---

## 4. Non-Negotiable Rules

### No guessing

When state is unclear, inspect it. Do not infer:

- current remote branch heads;
- whether another agent is active;
- whether `main` is stable;
- whether a worktree is safe to modify;
- whether a deployment is production or staging;
- whether a migration was already applied;
- whether a PR check is required or optional.

### No history rewriting

Do not use:

- `git push --force`
- `git push --force-with-lease`
- interactive rebase on PR #73
- branch deletion
- replacement of the 30 Marketplace commits

Use a normal merge from `origin/main` into the PR candidate.

### No production mutation during merge preparation

Do not:

- apply database migrations;
- seed data;
- provision QA users;
- modify grants or RLS;
- deploy production applications;
- change production aliases;
- rotate production credentials;
- merge PR #73.

### No security-work collision

Do not touch the security-containment worktree when it contains uncommitted work owned by another process.

Do not copy its private or sensitive details into:

- PR #73;
- Issue #77;
- public migration comments;
- commit messages;
- test logs;
- final public reports.

### Scope freeze

Only P0/P1 merge blockers may change Marketplace code:

- security boundary failure;
- data loss or corruption;
- authorization bypass;
- broken auth/session path;
- broken buyer/seller/admin core workflow;
- broken staging or production deployment contract;
- migration incompatibility;
- a release-gate test proving a real functional regression.

Do not add polish, charts, broad refactors, dashboard truthfulness work, new payment automation, or future feature expansion to PR #73.

---

## 5. Agent Coordination Protocol

Multiple agents or worktrees may be active. Coordination is mandatory.

### Step 5.1 — Inventory before work

From the primary repository, inspect:

```bash
git worktree list --porcelain
git status --short
git branch --all --verbose --no-abbrev
git fetch origin --prune
git log --oneline --decorate -8 origin/main
git log --oneline --decorate -8 origin/feature/marketplace-v1-production-integration
```

Also inspect active processes without killing them:

```bash
ps aux | grep -E '[c]laude|[c]odex|[o]pencode|[k]imi|[g]it|[v]ercel|[p]laywright'
```

Report any process or worktree that appears to be changing `main`, PR #73, or the security branch.

### Step 5.2 — Do not duplicate ownership

- If another process is writing the same branch/worktree, do not edit it.
- If another process is advancing `main`, enter the stability loop below.
- If the security worktree has an untracked containment migration, treat it as active work owned by another process.

### Step 5.3 — Main stability loop

A merge candidate cannot be finalized while `main` changes continuously.

Use this exact stability rule:

1. fetch `origin`;
2. record `origin/main` SHA and UTC timestamp;
3. wait five minutes;
4. fetch again;
5. compare SHA;
6. require two consecutive unchanged five-minute observations before starting the full release suite.

Suggested shell check:

```bash
before="$(git rev-parse origin/main)"
date -u '+%Y-%m-%dT%H:%M:%SZ'
sleep 300
git fetch origin --prune
after="$(git rev-parse origin/main)"
printf 'before=%s\nafter=%s\n' "$before" "$after"
test "$before" = "$after"
```

If `main` moves, do not push a stale merge. Restart the stability observation.

Maximum unattended observation: 30 minutes. If no stable window appears, stop with `HOLD — MAIN STILL MOVING` and identify the newest SHA and observed movement.

---

## 6. Phase A — Create a Clean Finalization Worktree

Do not reuse the stale unpushed merge candidate as authoritative.

Create a fresh detached worktree from the remote PR branch:

```bash
git fetch origin --prune

remote_pr_head="$(git rev-parse origin/feature/marketplace-v1-production-integration)"
printf 'remote_pr_head=%s\n' "$remote_pr_head"

test "$remote_pr_head" = "2e88f50a0f9f4377214c7bb86eafb8a54c87956c" || {
  echo "Remote PR head changed. Stop and review the new head."
  exit 1
}

git worktree add --detach \
  "/Users/shadreckmusarurwa/Project AI/carup-pr73-finalize" \
  origin/feature/marketplace-v1-production-integration

cd "/Users/shadreckmusarurwa/Project AI/carup-pr73-finalize"

git rev-parse HEAD
git status --porcelain
```

The new worktree must be clean.

If that path already exists:

- inspect it first;
- never delete an active worktree;
- use a new clearly named detached path such as `carup-pr73-finalize-2` only when the existing path is confirmed inactive.

---

## 7. Phase B — Integrate Stable `main`

After the required stable window:

```bash
cd "/Users/shadreckmusarurwa/Project AI/carup-pr73-finalize"
git fetch origin --prune
stable_main="$(git rev-parse origin/main)"
printf 'stable_main=%s\n' "$stable_main"

git merge --no-edit "$stable_main"
```

### Conflict policy

Continue automatically only when there are no conflicts.

For conflicts, list them:

```bash
git diff --name-only --diff-filter=U
```

Simple documentation-only conflicts may be resolved while preserving both meanings.

Stop for approval before resolving conflicts involving:

- auth middleware;
- registration or role authorization;
- Marketplace routes/services;
- mobile Marketplace API;
- service worker behavior;
- database migrations;
- grants/RLS/security policies;
- payment, audit, trust, evidence, PartSentry, referral, or diaspora boundaries.

Never apply blanket `ours` or `theirs` to a whole functional file without inspection.

### Content-safety verification

After merge:

```bash
git status --short
git diff --check
git log --oneline --decorate -8
git diff --name-status origin/main...HEAD
```

Confirm the candidate does not contain:

- the uncommitted containment migration;
- private production-security findings;
- database dumps;
- `.env` files;
- credentials or tokens;
- generated `.exit` files;
- QA passwords;
- the protected local `dcc3709` commit;
- unrelated local artifacts.

---

## 8. Phase C — Release Candidate Test Matrix

Run all tests from the clean merged worktree.

### Backend

```bash
node backend/tests/run-tests.js
node --test backend/tests/marketplace-*.test.js
node --test backend/tests/auth-register-privilege.test.js
node --test backend/tests/user-sessions-auth-contract.test.js
```

### Web unit and type checks

```bash
cd web
npx vitest run
cd ..

npx tsc --noEmit -p web/tsconfig.app.json
```

### Mobile type check

```bash
cd mobile
npx tsc --noEmit
cd ..
```

### Web production build

```bash
npm run build --workspace=web
```

The existing chunk-size warning is informational unless the build fails or a new severe regression appears.

### Focused Playwright suite

Run single-worker to reduce environmental flakiness:

```bash
cd web
npx playwright test \
  e2e/marketplace-v1-flows.spec.ts \
  e2e/marketplace-saved-server.spec.ts \
  e2e/saved-cars-marketplace-api.spec.ts \
  e2e/my-listings-seller-status.spec.ts \
  e2e/admin-moderation-guard.spec.ts \
  e2e/marketplace-routes.spec.ts \
  e2e/marketplace-compare-visibility.spec.ts \
  e2e/marketplace-media.spec.ts \
  e2e/marketplace-parts.spec.ts \
  --workers=1
cd ..
```

A retry pass must be reported as flaky. Repeated failure is a blocker.

### Final local cleanliness

```bash
git diff --check
git status --porcelain
```

Remove only test artifacts generated in this isolated worktree. Do not commit generated reports, screenshots, traces, or exit files unless they are already an intentional repository contract.

---

## 9. Phase D — Final Race Check

Before pushing, fetch again:

```bash
git fetch origin --prune
```

Verify the PR branch did not move:

```bash
test "$(git rev-parse origin/feature/marketplace-v1-production-integration)" = \
  "2e88f50a0f9f4377214c7bb86eafb8a54c87956c"
```

Verify latest `main` is included:

```bash
latest_main="$(git rev-parse origin/main)"
git merge-base --is-ancestor "$latest_main" HEAD
```

Verify the original Marketplace head is included:

```bash
git merge-base --is-ancestor \
  2e88f50a0f9f4377214c7bb86eafb8a54c87956c \
  HEAD
```

Both ancestry checks must exit `0`.

If `main` moved after tests:

1. merge the new `origin/main`;
2. rerun the complete release matrix;
3. repeat the final race check.

Do not push a stale candidate merely to finish the task faster.

---

## 10. Phase E — Push Without Rewriting History

Push the merged candidate normally:

```bash
git push origin HEAD:feature/marketplace-v1-production-integration
```

Never force-push.

Post-push:

```bash
git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/feature/marketplace-v1-production-integration
git status --porcelain
```

Local candidate and remote PR head must match exactly.

---

## 11. Phase F — Remote Checks and PR Finalization

### Wait for checks

Required successful checks on the new PR head:

- Vercel `carup-staging`
- Vercel `carup-backend-staging`
- Vercel `carup`
- Vercel `carup-backend`
- all triggered GitHub Actions checks

Do not merge while checks are pending or failing.

### Update PR #73 description

Update the PR body to reflect truth:

- production Marketplace inquiry migration applied and verified;
- production session migration intentionally skipped because the contract already existed;
- public, buyer, seller, admin, mobile, and production migration gates passed;
- synthetic production smoke data removed;
- Issue #77 remains a separate public-launch hardening gate;
- no private production details disclosed.

Mark completed QA checklist entries complete.

Do not say Issue #77 is complete.

### Post final merge-readiness comment

Include:

- previous feature head;
- stable `main` SHA integrated;
- new PR head;
- conflict status;
- exact test commands and results;
- remote check results;
- production migration status;
- explicit session-migration skip;
- Issue #77 separation;
- confirmation no production mutation occurred in merge preparation;
- confirmation PR remains open and unmerged;
- final recommendation.

---

## 12. Merge Plan — Prepare but Do Not Execute

Preferred merge method: **squash merge**.

Suggested title:

```text
feat(marketplace): integrate Marketplace v1 production release
```

Suggested message:

```text
Integrates the governed Marketplace v1 across backend, web and mobile, including buyer inquiries, seller workflows, saved and comparison flows, trust summaries, moderation, referral attribution, mobile API convergence, security boundary fixes, production schema support and release verification.

Production access-control hardening continues separately under Issue #77 and remains a public-launch gate.
```

Do not run `gh pr merge` in the merge-preparation run.

Stop with exactly one of:

- `READY FOR EXPLICIT MERGE APPROVAL`
- `HOLD — <exact blocker>`

The human approval phrase required before merge is:

```text
MERGE PR #73
```

---

## 13. Phase G — After Explicit Merge Approval Only

Do not execute this phase until the user explicitly says `MERGE PR #73` after the readiness report.

### Revalidate immediately before merge

- PR open and mergeable;
- head unchanged from tested SHA;
- base `main` unchanged or already included;
- all required checks successful;
- no new review blocker;
- production migration status unchanged.

If any state changed, stop and return to merge preparation.

### Execute squash merge

Use the prepared title and message.

Do not delete the feature branch until post-merge verification is complete.

### Verify merged `main`

Confirm:

- PR state merged;
- resulting merge/squash SHA;
- `origin/main` contains the merged Marketplace change;
- Issue #77 remains open and separate;
- no unapproved migration or security change was merged.

### Post-merge tests

From a clean worktree at the merged `origin/main`, rerun at minimum:

```bash
node --test backend/tests/marketplace-*.test.js
npx tsc --noEmit -p web/tsconfig.app.json
cd mobile && npx tsc --noEmit && cd ..
npm run build --workspace=web
```

Run the focused Marketplace Playwright smoke if the environment is available.

### Deployment boundary

Do not manually deploy production unless explicitly authorized.

If production deploys automatically from `main`, observe the deployment and run read-only smoke checks. Do not modify data except through a separately approved synthetic smoke procedure with immediate cleanup.

---

## 14. Security Containment Track

Issue #77 remains separate and urgent.

Do not block merging completed Marketplace code indefinitely because the containment work is a separate system-hardening track. However:

- do not declare broad public launch complete;
- do not publish private findings;
- do not apply the unfinished containment migration to production;
- do not merge the security branch without its own staging tests and explicit approval.

If another agent owns the security worktree, leave it alone and report its state without duplication.

After PR #73 is merged, the next dedicated task is:

1. finish the containment migration in the security worktree;
2. test it on staging only;
3. push the security branch;
4. open a sanitized security PR;
5. stop before production application.

---

## 15. Final Reporting Template

```markdown
# PR #73 Merge-Preparation Report

## Git State
- Original PR head:
- Stable main SHA integrated:
- New PR head:
- Local/remote equality:
- Worktree clean:
- Conflicts:

## Tests
- Backend full suite:
- Marketplace backend suite:
- Auth privilege suite:
- Session contract suite:
- Web Vitest:
- Web TypeScript:
- Mobile TypeScript:
- Web build:
- Playwright:

## Remote Checks
- carup-staging:
- carup-backend-staging:
- carup:
- carup-backend:
- GitHub Actions:

## Safety
- Production changed during merge prep: NO
- Security worktree touched: NO
- Protected local commit touched: NO
- Private security details published: NO
- Issue #77 remains separate: YES

## Merge Plan
- Method: squash
- Prepared title:
- Prepared message:

## Recommendation
READY FOR EXPLICIT MERGE APPROVAL
```

---

## 16. Claude Code Goal/Loop Use

When invoked, Claude Code must:

1. read this file completely;
2. establish the goal using `/goal`;
3. use `/loop` for the main-stability observation and merge-preparation sequence;
4. maintain the scope freeze;
5. stop before merge.

The goal is not “keep working indefinitely.” The goal is:

> Produce a tested, latest-main-integrated, remotely green PR #73 and a truthful `READY FOR EXPLICIT MERGE APPROVAL` report, without touching production or the separate security-containment work.

If the goal cannot be reached because `main` never stabilizes, another process owns the branch, tests fail, or checks fail, return a precise hold report instead of guessing or weakening a gate.
