# CarUp Issue #77 — Access-Control Containment Goal Loop

**Status:** Active execution directive  
**Repository:** `kudzimusar/carup`  
**Issue:** `#77 — Production access-control hardening before public launch`  
**Audience:** Claude Code and supporting review agents  
**Public-safety rule:** This repository is public. Do not publish private production findings, credentials, project references, database hosts, exploit paths, customer data, or sensitive catalog evidence.

---

## 1. Goal

Complete the Issue #77 containment release candidate without touching production.

The immediate target is:

1. take sole ownership of the paused security worktree;
2. preserve and statically review the existing uncommitted containment migration;
3. produce a private reconciliation manifest for independent staging-database verification;
4. reconcile the local SQL against the migration already recorded in staging;
5. add a minimal incremental follow-up only when the evidence proves it is required;
6. test all changes against staging;
7. push the security branch and open a sanitized security PR;
8. stop before PR merge and before production application.

The goal is **not** to eliminate every historical database warning in one sweep. The goal is to contain launch-critical direct access while preserving legitimate browser, mobile, backend, admin, worker, marketplace, payment, audit, identity, and diaspora flows.

---

## 2. Authoritative Current State

### Completed

- Marketplace PR #73 is merged into `main`.
- Production and staging application environments are separated.
- Production frontend routes to the production backend.
- Staging frontend routes to the staging backend.
- Production and staging backends read distinct Supabase datasets.
- Environment-separation summary is already posted to Issue #77.
- Production must remain untouched during this directive.

### Staging migration fact

Independent Supabase inspection has confirmed that staging already records:

```text
version: 20260619201629
name: production_access_containment
```

The local worktree contains an uncommitted file:

```text
database/migrations/20260619201406_production_access_containment.sql
```

Do **not** apply the original containment migration again until the local SQL and the staging database state have been reconciled.

### Security worktree

Expected worktree:

```text
/Users/shadreckmusarurwa/Project AI/carup-security-containment
```

Expected branch:

```text
security/production-access-containment
```

The previous owner appears paused. Confirm that before editing.

---

## 3. Definition of Done

Issue #77 reaches `READY FOR SECURITY PR REVIEW` only when:

- sole worktree ownership is established;
- the existing local migration is backed up privately and reviewed;
- the migration's intended final state matches staging catalog state;
- any mismatch is explained and resolved safely;
- remaining launch-critical findings are classified by real application access path;
- a second migration is added only when necessary;
- staging tests and advisors pass at the required level;
- the exact reviewed migration files are committed;
- the security branch is pushed without history rewriting;
- a sanitized PR is opened against `main`;
- production remains unchanged;
- private evidence never enters Git history or public GitHub comments;
- the run stops before merge and before production migration.

---

## 4. Non-Negotiable Boundaries

Do not:

- change production schema, data, grants, RLS, functions, keys, aliases, or deployments;
- reapply `production_access_containment` blindly;
- blanket-enable RLS across all tables;
- add broad product features or refactors;
- modify Marketplace PR #73;
- close Issue #77;
- merge the security PR;
- force-push or rewrite history;
- delete or reset another agent's work;
- expose private security evidence publicly;
- commit `.env` files, database dumps, screenshots, traces, credentials, private reports, or generated test artifacts.

When evidence is incomplete, stop with an exact hold reason. Do not guess.

---

## 5. Two-Agent Operating Model

Claude Code may not have direct access to the CarUp staging Supabase connector in every session. That does not justify fabricating database state or waiting indefinitely.

Use this split:

### Claude Code owns

- worktree ownership checks;
- backup of the local WIP file;
- static SQL review;
- codebase access-path audit;
- private reconciliation manifest;
- local tests;
- migration editing after independent reconciliation evidence is returned;
- branch, commit, push, and sanitized PR delivery.

### Independent Supabase verifier owns

- staging migration ledger confirmation;
- read-only catalog inspection;
- grant/RLS/policy/function state verification;
- staging advisor baseline and post-change comparison;
- staging-only migration application after SQL review;
- production untouched verification.

Claude must not claim database reconciliation is complete until independent evidence has been returned.

---

## 6. Phase A — Coordination and Ownership

Run from the primary repository:

```bash
git fetch origin --prune
git worktree list --porcelain
git status --short
git branch --all --verbose --no-abbrev
ps aux | grep -E '[c]laude|[c]odex|[o]pencode|[k]imi|[g]it|[s]upabase|[p]laywright'
```

Then inspect the security worktree:

```bash
git -C "/Users/shadreckmusarurwa/Project AI/carup-security-containment" status --short
git -C "/Users/shadreckmusarurwa/Project AI/carup-security-containment" rev-parse --abbrev-ref HEAD
git -C "/Users/shadreckmusarurwa/Project AI/carup-security-containment" log -1 --oneline
```

Proceed only when no active process is writing that worktree.

If ownership is unclear, stop:

```text
HOLD — SECURITY WORKTREE OWNERSHIP UNRESOLVED
```

Do not create a duplicate containment branch or migration.

---

## 7. Phase B — Preserve the Existing WIP

Before opening or editing the migration:

```bash
mkdir -p /private/tmp/carup-security-private
chmod 700 /private/tmp/carup-security-private
cp \
  "/Users/shadreckmusarurwa/Project AI/carup-security-containment/database/migrations/20260619201406_production_access_containment.sql" \
  /private/tmp/carup-security-private/production_access_containment.wip.sql
chmod 600 /private/tmp/carup-security-private/production_access_containment.wip.sql
shasum -a 256 /private/tmp/carup-security-private/production_access_containment.wip.sql
```

Record the checksum privately.

Do not print the SQL into a public issue or PR.

---

## 8. Phase C — Static Migration Review

Review the local SQL and prepare a private structured manifest.

For every statement record:

- object type;
- schema and object name;
- operation;
- intended final RLS state;
- intended policies;
- grants revoked from `PUBLIC`, `anon`, and `authenticated`;
- grants preserved for `service_role`;
- function security mode;
- intended function `search_path`;
- execution grants;
- idempotency guard;
- rollback note;
- application access-path assumption.

Classify each object as:

```text
backend_only
account_owned_direct_client
safe_public_read
admin_only
worker_only
privileged_rpc
unclassified
```

Any `unclassified` object blocks editing and deployment until the codebase audit resolves it.

---

## 9. Phase D — Codebase Access-Path Audit

Search all web, mobile, backend, worker, and SQL code for every object in the manifest.

Use searches such as:

```bash
rg -n "from\(['\"]OBJECT_NAME['\"]\)|\.from\(['\"]OBJECT_NAME['\"]\)|rpc\(['\"]FUNCTION_NAME['\"]" .
rg -n "OBJECT_NAME|FUNCTION_NAME" backend web mobile shared scripts database
```

For each object determine:

- browser direct Supabase access;
- mobile direct Supabase access;
- Express backend service-role access;
- background-worker access;
- admin-only access;
- public-read dependency;
- authenticated ownership dependency;
- payment/audit/identity sensitivity;
- expected failure behavior after containment.

At minimum cover these functional categories:

- authentication and sessions;
- saved vehicles;
- listing media;
- vehicle and identity documents;
- payment and finance;
- audit records;
- organization and tenant access;
- marketplace inquiries and reports;
- diaspora order access;
- privileged database functions.

Do not alter an object based only on its table name.

---

## 10. Phase E — Private Reconciliation Manifest

Write the static review to:

```text
/private/tmp/carup-security-private/issue77-reconciliation-manifest.json
```

Permissions:

```bash
chmod 600 /private/tmp/carup-security-private/issue77-reconciliation-manifest.json
```

Required JSON structure:

```json
{
  "migration_file": "database/migrations/20260619201406_production_access_containment.sql",
  "sha256": "...",
  "objects": [
    {
      "object_type": "table|function",
      "schema": "public",
      "name": "...",
      "classification": "backend_only|account_owned_direct_client|safe_public_read|admin_only|worker_only|privileged_rpc|unclassified",
      "expected_rls": true,
      "expected_policies": [],
      "revoke_public": true,
      "revoke_anon": true,
      "revoke_authenticated": true,
      "preserve_service_role": true,
      "expected_security_definer": false,
      "expected_search_path": "pg_catalog, public",
      "expected_execute_roles": ["service_role"],
      "code_evidence": ["path:line"],
      "notes": ""
    }
  ]
}
```

Do not commit this manifest.

Return to the user only:

- manifest path;
- migration checksum;
- number of tables;
- number of functions;
- number of unclassified objects;
- sanitized functional categories;
- whether static review found destructive or non-idempotent statements.

The exact object list may be pasted into the private chat when requested for independent reconciliation. Do not post it publicly.

---

## 11. Phase F — Independent Staging Reconciliation Gate

Pause editing after producing the manifest.

The independent verifier will compare the manifest against staging catalogs and return, for every object:

```text
confirmed_applied
not_applied
state_differs
cannot_verify
```

Claude may continue only when:

- all original migration statements are reconciled;
- no unexplained state difference remains;
- no statement would loosen access on rerun;
- the SQL is idempotent;
- backend service-role paths remain viable.

If differences exist, preserve the original WIP backup and adjust only after the verifier returns the exact category of mismatch.

---

## 12. Phase G — Remaining Security Baseline

After reconciliation, review the staging advisor baseline by category, not by raw count.

Classify findings as:

```text
launch_critical_direct_exposure
backend_only_service_role
legitimate_public_read
account_owned_policy_required
privileged_function_exposure
pre_existing_non_launch_debt
expected_info
```

A remaining advisor ERROR is not automatically a release blocker when grants already remove direct API access, but that must be proven through catalogs and live tests.

Conversely, an RLS-disabled table with `anon` or `authenticated` access is launch-critical even when no current UI calls it.

---

## 13. Phase H — Minimal Follow-Up Migration

Create a second migration only when independent reconciliation proves that launch-critical containment is incomplete.

Use the repository timestamp convention, for example:

```text
database/migrations/<timestamp>_issue77_access_containment_followup.sql
```

Requirements:

- idempotent;
- no data deletion;
- no table redesign;
- no broad refactor;
- no blanket RLS activation;
- explicit ownership policies when direct client access is required;
- revoked direct roles for backend-only resources;
- preserved service-role access;
- preserved required public reads;
- restricted privileged-function execution;
- fixed safe function `search_path` where appropriate;
- rollback notes;
- no private production evidence in comments.

Do not create a follow-up solely to reduce advisor counts.

---

## 14. Phase I — Staging Application and Verification

Only the independent verifier applies SQL to staging.

Rules:

- the original migration is already recorded and must not be reapplied blindly;
- apply only a reviewed incremental follow-up when needed;
- never target production;
- stop on any SQL error;
- verify the staging migration ledger after application;
- verify catalogs, grants, RLS, policies, functions, and execution privileges;
- verify no production ledger or schema change occurred.

---

## 15. Phase J — Regression Matrix

Run from the security worktree after staging state is reconciled.

### Backend

```bash
node backend/tests/run-tests.js
node --test backend/tests/marketplace-*.test.js
node --test backend/tests/auth-register-privilege.test.js
node --test backend/tests/user-sessions-auth-contract.test.js
```

Also run focused tests covering:

- saved records;
- media and listing images;
- identity and documents;
- payments and finance;
- audit authorization;
- diaspora access;
- admin moderation.

### Web

```bash
cd web
npx vitest run
cd ..
npx tsc --noEmit -p web/tsconfig.app.json
npm run build --workspace=web
```

### Mobile

```bash
cd mobile
npx tsc --noEmit
cd ..
```

### Playwright

Run one worker and cover:

- public Marketplace;
- buyer saves;
- account isolation;
- seller listings;
- listing images;
- inquiries;
- seller inquiry isolation;
- admin moderation;
- payment boundaries;
- audit boundaries;
- diaspora order boundaries.

### Live staging assertions

Verify:

- browsing still works;
- auth/session flows work;
- saves persist;
- cross-account reads fail;
- images render;
- inquiries work;
- cross-seller reads fail;
- admin governance works;
- unauthorized admin access fails;
- backend service-role operations work;
- sensitive backend-only resources are not directly accessible;
- privileged RPCs are restricted as intended.

---

## 16. Phase K — Advisor Comparison

Run staging security and performance advisors before and after any follow-up.

Proceed to PR only when:

- no new ERROR is introduced;
- launch-critical direct exposures are contained;
- remaining warnings are classified privately;
- legitimate workflows pass;
- service-role-only INFO findings are understood;
- no production change occurred.

Do not claim all security debt is eliminated unless the evidence proves it.

---

## 17. Phase L — Commit and Push

Before commit:

```bash
git status --short
git diff --check
git diff -- database/migrations/
```

Commit only:

- the reconciled original containment migration;
- a required follow-up migration;
- focused automated tests;
- sanitized documentation required for review.

Do not commit private reports or temporary evidence.

Suggested commit:

```text
security: contain database access paths before public launch
```

Push normally:

```bash
git push -u origin security/production-access-containment
```

No force-push.

---

## 18. Phase M — Sanitized Security PR

Open a PR against `main`.

Suggested title:

```text
security: contain database access paths before public launch
```

The public PR may include:

- Issue #77 reference;
- high-level access-control categories;
- migration filenames;
- staging migration versions;
- test totals;
- sanitized advisor comparison;
- rollback approach;
- confirmation that production is unchanged.

Do not include:

- project refs;
- database hosts;
- keys or fingerprints;
- exploitable object details;
- customer or QA data;
- private catalog evidence;
- detailed production findings.

Stop before merge.

---

## 19. Final Report Template

```markdown
# Issue #77 Security Release Candidate

## Ownership
- Worktree ownership:
- Existing WIP backup:
- Original migration SHA-256:

## Reconciliation
- Staging migration ledger:
- Local SQL vs staging state:
- Confirmed applied:
- State differs:
- Unclassified objects:

## Containment
- Original migration:
- Follow-up migration:
- Functional categories covered:

## Verification
- Backend tests:
- Web tests:
- Web TypeScript:
- Mobile TypeScript:
- Build:
- Playwright:
- Live staging:
- Advisors before/after:

## Delivery
- Branch:
- Commit:
- PR:
- Issue comment:
- Changed files:

## Safety
- Production touched: NO
- Private findings published: NO
- Force-push: NO
- Unrelated changes: NO

## Recommendation
READY FOR SECURITY PR REVIEW
```

---

## 20. Claude Code `/goal` and `/loop`

Use a short `/goal` that points to this document. Do not paste this entire directive into the goal condition.

The goal is:

> Produce a reconciled, staging-tested, sanitized Issue #77 security PR without touching production or merging the PR.

Use `/loop` to move through ownership, static manifest, reconciliation, staging verification, tests, advisors, and delivery.

Stop with exactly one of:

```text
READY FOR SECURITY PR REVIEW
```

or:

```text
HOLD — <exact blocker>
```
