# Claude Code Hardening Directive — CarUp Diaspora Trade OS Phases 3–7

> **Repository:** `https://github.com/kudzimusar/carup`
>
> **Program branch:** `claude/diaspora-phases-3-7-program`
>
> **Draft PR:** `https://github.com/kudzimusar/carup/pull/81`
>
> **Directive path:** `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_HARDENING_DIRECTIVE.md`
>
> **Branch link:** `https://github.com/kudzimusar/carup/blob/claude/diaspora-phases-3-7-program/docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_HARDENING_DIRECTIVE.md`

---

## 1. Mandate

You are Claude Code continuing the existing **CarUp Diaspora Trade OS Phases 3–7** program on draft PR `#81`.

The feature breadth is already implemented. Your task is now to convert the current draft from **mock-tested code breadth** into a **merge-ready, database-safe, authorization-safe, integration-proven implementation**.

Do not add unrelated features. Do not start Phase 8, Phase 9, or Phase 10. Do not merge the PR. Do not touch production Supabase.

The program is not complete merely because builds pass or mocked tests are green. Completion now requires proof at the transaction, authorization, migration, staging, CI, and OAuth boundaries.

---

## 2. Current Program State

Known current state:

- Draft PR: `#81`
- Program branch: `claude/diaspora-phases-3-7-program`
- Current reported head before this directive: `3d3075364f307d39dbc59c3e525ba781d0f1b4ed`
- Base main commit: `3ac2ff23a60f545bbafed8d4d256277209f3adf9`
- PR is open, draft, and unmerged.
- Four Vercel preview deployments passed.
- Local mocked backend tests reportedly passed.
- Local focused Playwright tests reportedly passed.
- The Phase 3 stock idempotency migration exists in the repository but has not been applied to staging or production.
- Phase 7 live Google Drive operations remain unimplemented; the real provider currently throws explicit external-activation errors.
- `stash@{0}` is unrelated and must remain untouched.
- Unrelated `*.exit` / `*.txt` artifacts must remain untracked and unstaged.

The current implementation must be treated as **draft code awaiting hardening**, not production-ready functionality.

---

## 3. Verified Risk Register

The hardening program must resolve or explicitly reclassify every item below.

### Risk A — Stock ledger is not atomic

Current behavior performs:

1. ledger insert;
2. stock item balance update;
3. audit insert;

as separate database calls.

This permits:

- ledger row without balance update;
- lost updates under concurrent reservations;
- over-reservation under race conditions;
- idempotency checks that race before the unique index is enforced.

### Risk B — Quote acceptance is not atomic

Current behavior separately:

1. accepts one quote;
2. rejects sibling quotes;
3. updates the buyer order.

This permits partial state and concurrent multiple acceptance.

### Risk C — Container approval is not serialized

Current behavior recomputes capacity before approval, but concurrent approvals may both pass using the same old capacity snapshot.

### Risk D — Backend role enforcement is too broad

Several new route modules use `authorizeRole()` without explicit role allowlists. Frontend role restrictions do not substitute for backend authorization.

### Risk E — Audit is best-effort while documentation claims guaranteed audit

Current `appendAudit()` swallows audit insertion failure. This is inconsistent with claims that every mutation writes an immutable audit record.

### Risk F — Staging database contract is unproven

The Phase 3 idempotency migration has not been applied to staging. The real schema and RPC behavior have not been validated by live integration tests.

### Risk G — CI does not independently prove the reported local test totals

Vercel deployment success proves build/deploy viability, not the full backend, Playwright, authorization, migration, or concurrency test program.

### Risk H — Google Drive is scaffold/mock-complete, not live-functional

The real Google provider does not implement token exchange, refresh, revoke, folder, upload, or metadata calls.

### Risk I — Drive mock selection can fail open

Missing Google credentials can cause mock-provider selection outside tests. Production must never silently use a mock provider.

### Risk J — OAuth state lacks expiry and one-time replay protection

The current signed user-bound state lacks an expiry timestamp and server-side one-time nonce consumption.

---

## 4. Session Goal and Loop

Set this session goal when supported:

```text
/goal Harden CarUp Diaspora Trade OS Phases 3–7 on draft PR #81 until stock movements, quote acceptance, and container approvals are atomic and concurrency-safe; backend roles are explicit; critical audit policy is truthful and enforced; migrations and RPCs are validated in staging; CI independently runs the acceptance suite; Google Drive fails closed and is honestly classified; OAuth state has expiry and replay protection; all regressions pass; keep the PR draft and unmerged; do not touch production Supabase or unrelated workstreams.
```

Use this loop when supported:

```text
/loop For the active hardening milestone: inspect the exact current implementation and schema; update the hardening ledger; implement the smallest complete security/integrity slice; add failure, concurrency, authorization, rollback, and integration tests; run focused checks; commit; push; update PR evidence; continue. Stop only for explicit staging authorization, production credentials, destructive migration approval, external paid infrastructure, or a product-policy decision that cannot be inferred safely.
```

If `/goal` or `/loop` are unavailable, follow the same process manually.

---

## 5. Delivery Model

Remain on:

```text
claude/diaspora-phases-3-7-program
```

Do not create a parallel implementation PR unless the current branch is irreparably contaminated.

Create and maintain:

```text
docs/DIASPORA_PHASES_3_TO_7_HARDENING_PROGRESS.md
```

Record after every milestone:

- risk addressed;
- current implementation finding;
- schema/RPC changes;
- files changed;
- tests added;
- local test results;
- staging status;
- CI status;
- commit SHA;
- unresolved limitations;
- next milestone.

Recommended milestone commits:

```text
fix: make diaspora stock movements atomic
fix: make diaspora quote acceptance atomic
fix: serialize diaspora container approvals
fix: enforce diaspora phase 3 to 7 backend roles
fix: enforce critical diaspora audit policy
fix: harden diaspora drive and oauth boundaries
ci: verify diaspora phases 3 to 7 acceptance suite
test: validate diaspora phases 3 to 7 against staging
docs: complete phases 3 to 7 hardening handoff
```

Keep the PR as draft until every mandatory merge gate passes.

---

## 6. Workstream Boundaries

Do not modify:

- Navigation Intelligence;
- Vehicle Evidence;
- Mobile Identity;
- PartSentry;
- unrelated marketplace features;
- unrelated mobile surfaces;
- unrelated Vercel projects;
- Phase 8 subscription implementation;
- Phase 9 SafeTrade execution;
- Phase 10 Trade Graph intelligence.

Do not apply, pop, rewrite, or drop `stash@{0}`.

Do not stage unrelated untracked artifacts.

Do not delete unrelated documentation.

---

# HARDENING MILESTONE H0 — BASELINE AND TRUTHFUL STATUS

## 7. Baseline Verification

Before code changes, run:

```bash
cd "/Users/shadreckmusarurwa/Project AI/carup-kimi"

git fetch origin
git checkout claude/diaspora-phases-3-7-program
git status --short
git branch --show-current
git log --oneline --decorate -15
git diff --name-status origin/main...HEAD
git stash list
```

Confirm:

- correct branch;
- PR #81 head matches the branch;
- no unrelated files are staged;
- unrelated stash remains untouched;
- branch contains only Diaspora Phase 3–7 work and hardening docs;
- current `origin/main` divergence is understood.

Read fully:

```text
docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md
docs/DIASPORA_PHASES_3_TO_7_DISCOVERY.md
docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md
docs/DIASPORA_PHASES_3_TO_7_HANDOFF.md
docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_HARDENING_DIRECTIVE.md
```

Update the handoff and progress docs immediately so they no longer claim unconditional production-safe atomicity, guaranteed audit, concurrency safety, or live Drive functionality before those are proven.

Use precise status labels:

- `IMPLEMENTED — HARDENING IN PROGRESS`
- `STAGING-VERIFIED`
- `CODE-COMPLETE PENDING EXTERNAL ACTIVATION`
- `BLOCKED`

Do not use `COMPLETE` where an external or database boundary remains unverified.

---

# HARDENING MILESTONE H1 — ATOMIC STOCK LEDGER

## 8. Required Outcome

A stock movement must become one atomic database operation.

The operation must either:

- insert the immutable ledger event;
- update stock balances;
- enforce idempotency;
- enforce availability/reservation constraints;
- record the required audit event;

or perform none of them.

## 9. Database Design Requirements

Inspect the real Phase 1B schema first. Implement the final schema using repository migrations.

Preferred approach:

- PostgreSQL function exposed through Supabase RPC;
- transaction is implicit within the function call;
- lock the stock item row with `SELECT ... FOR UPDATE`;
- validate tenant and actor parameters against the locked record;
- check existing `(stock_item_id, idempotency_key)` before mutation;
- calculate balances using locked current values;
- reject negative availability/reserved balances;
- insert the ledger row;
- update the item row;
- insert a critical audit row;
- return stock item, ledger entry, replay flag, and balances.

Suggested RPC name:

```text
diaspora_append_stock_movement_atomic
```

The exact function signature must follow discovered schema conventions. Do not guess table columns. Do not use dynamic SQL.

Security requirements:

- set an explicit safe `search_path`;
- use least privilege;
- avoid trusting client-provided tenant ownership blindly;
- do not allow arbitrary table or action names;
- validate action from an allowlist;
- validate quantity numerically;
- require reviewer/admin metadata for `ADJUST_WITH_APPROVAL`;
- protect function execution using grants consistent with the backend service role model;
- never expose service-role secrets.

## 10. Service Refactor

Refactor `diasporaStockLedgerService.js` so production uses one RPC call instead of separate insert/update calls.

Keep pure balance calculation helpers only where useful for validation/testing.

The service must:

- generate/require idempotency keys where appropriate;
- translate RPC errors into stable sanitized application errors;
- return explicit `idempotentReplay`;
- never perform a fallback non-atomic path in production;
- allow a mock/injected client in unit tests;
- fail closed when the RPC is missing.

## 11. Stock Tests

Add tests for:

- successful ADD;
- successful RESERVE;
- successful RELEASE_RESERVATION;
- REMOVE, DAMAGE, RETURN, TRANSFER;
- approved adjustment;
- duplicate idempotency replay;
- same idempotency key with conflicting payload is rejected;
- reservation exceeding availability fails with zero writes;
- release exceeding reserved fails with zero writes;
- simulated audit failure causes full rollback for critical stock mutation;
- simulated stock update failure causes no ledger row;
- concurrent reservations cannot over-reserve;
- two simultaneous identical idempotent requests apply once;
- cross-tenant actor is denied;
- non-reviewer adjustment denied.

At least one concurrency test must use the real staging database or a transactional local PostgreSQL instance. An in-memory sequential mock is not sufficient proof.

---

# HARDENING MILESTONE H2 — ATOMIC QUOTE ACCEPTANCE

## 12. Required Outcome

Accepting a quote must atomically:

1. lock the buyer order;
2. validate buyer/reviewer authority;
3. confirm no different quote is already accepted;
4. validate the selected quote belongs to the order and is submitted;
5. mark the selected quote accepted;
6. reject sibling submitted quotes;
7. update the order with the accepted quote and status;
8. write a critical audit row;
9. return the updated order and accepted quote.

Failure at any step must roll back all changes.

## 13. Database/RPC Requirements

Preferred RPC:

```text
diaspora_accept_quote_atomic
```

Requirements:

- `SELECT ... FOR UPDATE` on the order;
- lock the selected quote and relevant sibling quote set;
- idempotent replay for the same accepted quote;
- conflict for a different already accepted quote;
- tenant/owner validation;
- no second accepted quote under concurrent requests;
- audit insertion in the same transaction;
- explicit safe `search_path`;
- sanitized failure mapping.

Refactor `diasporaBuyerOrderService.js` to call the RPC.

Do not retain the current multi-call accept/reject/update loop as production fallback.

## 14. Quote Acceptance Tests

Add tests for:

- one submitted quote accepted;
- sibling submitted quotes rejected;
- same quote repeated is idempotent;
- different second quote rejected;
- quote from another order rejected;
- draft quote rejected;
- non-owner/non-reviewer denied;
- audit failure rolls back;
- order update failure rolls back;
- concurrent acceptance of two different quotes yields exactly one accepted quote;
- tenant isolation.

At least one true concurrent database test is required.

---

# HARDENING MILESTONE H3 — SERIALIZED CONTAINER APPROVAL

## 15. Required Outcome

Reservation approval must be atomic and serialized so two simultaneous approvals cannot overfill a container.

## 16. Database/RPC Requirements

Preferred RPC:

```text
diaspora_approve_cargo_reservation_atomic
```

The RPC must:

- lock the container row with `FOR UPDATE`;
- lock or safely inspect the reservation row;
- validate reviewer/admin/tenant-admin authority;
- validate reservation state;
- recompute approved CBM inside the transaction;
- include the current reservation once;
- enforce total volume;
- enforce weight when configured;
- update reservation status;
- update cached container capacity fields;
- calculate 90% ready-to-close and 98% full flags;
- write a critical audit row;
- return reservation and capacity;
- roll back on any error.

If a database constraint or advisory lock is used, document why. Row locking is preferred when sufficient.

Refactor the production service to call the atomic RPC.

## 17. Container Tests

Add tests for:

- valid approval;
- pending reservation not consuming approved capacity;
- rejected/cancelled reservation releases capacity;
- exact 90% ready-to-close;
- exact 98% full;
- volume overfill rejected with zero state change;
- weight overfill rejected;
- simultaneous approvals cannot overfill;
- unauthorized approval denied;
- owner cancellation allowed;
- closing booking does not mark shipment delivered or release payment;
- audit rollback behavior;
- tenant/participant privacy.

---

# HARDENING MILESTONE H4 — EXPLICIT BACKEND AUTHORIZATION

## 18. Authorization Matrix

Create a documented authorization matrix in:

```text
docs/DIASPORA_PHASES_3_TO_7_AUTHORIZATION_MATRIX.md
```

Define allowed roles and ownership requirements per route.

Minimum intended roles:

### Stock and Supply Documents

Create/update/ledger/reserve/release:

- seller/dealer/supplier roles;
- tenant admin for the same tenant;
- platform admin/reviewer where explicitly intended.

Buyer/owner must not create seller stock merely because authenticated.

### Buyer Orders

Create/update/publish/accept quote:

- buyer/owner for own order;
- reviewer/admin where intended.

### RFQ/Quotes

Discover/respond/submit/withdraw:

- seller/dealer/supplier for eligible RFQs;
- own quotes only;
- reviewer/admin visibility where intended.

### AI Commands

- requester can create/read own commands;
- medium-risk confirmation only by requester or reviewer/admin;
- high-risk approval only reviewer/admin;
- high-risk execution remains blocked.

### Container Marketplace

- authenticated participants may list open containers subject to privacy rules;
- reservation owner may request/cancel own reservation;
- logistics reviewer/admin/authorized tenant admin may approve/reject;
- container creation/close booking restricted.

### Drive

- authenticated user accesses only own connection/files;
- no cross-user token reference or file metadata access.

## 19. Route Enforcement

Replace broad `authorizeRole()` route guards with explicit allowlists where the route is role-specific.

Service-level ownership/tenant checks must remain. Route middleware and service authorization are defense in depth.

Do not trust `x-stakeholder-role` unless it matches server-derived platform or tenant role according to existing middleware.

Add route-level tests proving:

- disallowed authenticated role receives 403;
- allowed role reaches service;
- spoofed stakeholder role is rejected;
- cross-tenant header is rejected;
- platform admins cannot accidentally inherit tenant ownership where not intended.

Frontend route guards must match the backend matrix, but backend remains authoritative.

---

# HARDENING MILESTONE H5 — CRITICAL AUDIT POLICY

## 20. Audit Classification

Define two audit policies:

### Critical audit

A critical mutation must fail and roll back when audit insertion fails.

Critical examples:

- stock movement;
- approved stock adjustment;
- quote acceptance;
- AI approval/rejection/execution attempt;
- cargo reservation approval/rejection/cancellation;
- Drive connect/disconnect/upload where security trace is required.

### Best-effort audit

Only genuinely non-critical read-side or low-impact telemetry may remain best effort.

## 21. Implementation Requirements

Do not claim “every mutation writes an audit row” while `appendAudit()` swallows errors.

Implement one of:

- audit insertion inside each atomic RPC transaction; or
- a strict audit helper that throws, used only where the surrounding operation is transactional.

Retain a separate explicitly named best-effort helper only where justified.

Suggested names:

```text
appendCriticalAudit
appendBestEffortAudit
```

Documentation and tests must reflect the actual policy.

Tests must prove critical mutation rollback on audit failure.

---

# HARDENING MILESTONE H6 — DRIVE AND OAUTH BOUNDARIES

## 22. Honest Phase 7 Classification

Until live Google operations are implemented and verified, Phase 7 must be described as:

```text
SCAFFOLD/MOCK-COMPLETE — LIVE GOOGLE ACTIVATION NOT IMPLEMENTED
```

Do not use “code-complete pending credentials” if token exchange and Drive API operations are still unimplemented.

## 23. Fail-Closed Provider Selection

Production rules:

- `NODE_ENV=production` must never select `MockDriveProvider` automatically;
- `DIASPORA_DRIVE_MOCK=true` must be rejected in production;
- Drive enabled without required configuration must return a safe configuration error;
- Drive disabled must expose a truthful disabled status;
- no mock URL or mock file result may be emitted in production.

Add tests for every configuration combination.

## 24. OAuth State Hardening

State must include:

- user ID;
- tenant ID where applicable;
- issued-at timestamp;
- expiry timestamp;
- cryptographically random nonce;
- signature.

Implement one-time nonce storage/consumption using an existing secure table or an additive migration.

Required behavior:

- state expires within a short documented window;
- state is bound to initiating user;
- state is bound to tenant where applicable;
- tampered state rejected;
- expired state rejected;
- replayed/consumed state rejected;
- missing production state secret fails closed;
- no fixed production fallback secret.

## 25. Real Google Provider Decision

Choose one truthful path:

### Path A — Implement live provider

Only if approved dependencies and credentials architecture are available:

- token exchange;
- refresh;
- revoke;
- folder creation;
- upload;
- metadata retrieval;
- opaque encrypted credential storage/reference;
- authorized staging E2E.

### Path B — Keep scaffold-only

If external activation is unavailable:

- keep mock tests;
- disable production connect/upload;
- expose explicit “not activated” state;
- document exact remaining implementation work;
- do not mark Phase 7 live-complete.

Do not invent a secret store. Inspect and reuse the project’s approved secret/storage pattern. Stop if a product/security decision is required.

---

# HARDENING MILESTONE H7 — MIGRATION AND STAGING VALIDATION

## 26. Migration Set

The final repository may require additive migrations for:

- stock idempotency key and unique index;
- atomic stock movement RPC;
- atomic quote acceptance RPC;
- atomic container approval RPC;
- OAuth nonce/state storage;
- grants/indexes/check constraints required by those functions.

Do not modify production directly.

## 27. Staging Authorization Boundary

Target staging project, when explicitly authorized:

```text
eoyenigwevnxwwhyhaer
```

Production project is out of scope:

```text
vhmnajoeicasaigiophh
```

Before any staging apply:

1. list current migrations;
2. inspect relevant tables and columns;
3. compare repository migration state;
4. produce exact migration plan;
5. request/confirm authorization if not already explicit;
6. back up schema metadata where possible;
7. apply additive migrations only;
8. run security and performance advisors afterward.

Never apply to production.

## 28. Staging Integration Tests

Create a staging-safe integration suite, gated by environment variables, that:

- uses isolated test records;
- marks records with a unique test-run prefix;
- cleans them up safely;
- never uses production IDs;
- never modifies unrelated records;
- proves atomic rollback and concurrency behavior;
- proves route/service/schema contract;
- proves RLS/service-role assumptions;
- redacts credentials from logs.

Required staging scenarios:

### Stock

- create stock item;
- concurrent reserve race;
- duplicate idempotency replay;
- failed movement leaves no partial row;
- cross-tenant denial.

### Quote acceptance

- concurrent acceptance of two quotes;
- exactly one accepted;
- sibling state correct;
- order state correct;
- repeat acceptance idempotent.

### Container

- concurrent approvals near capacity;
- no overfill;
- cached capacity correct;
- audit row exists.

### Audit

- critical audit failure or simulated failure rolls back.

### Drive

- mock disabled in production mode;
- state expiry/replay protection using staging metadata table;
- live provider remains disabled unless explicitly activated.

Document test-run IDs and cleanup results.

---

# HARDENING MILESTONE H8 — CI ACCEPTANCE WORKFLOW

## 29. GitHub Actions Requirement

Add a focused PR workflow, for example:

```text
.github/workflows/diaspora-phases-3-7-validation.yml
```

Trigger on changes to relevant Diaspora backend, web, migration, and test paths.

The workflow must run independently:

1. dependency install using the repository lockfile;
2. backend focused Diaspora tests;
3. TypeScript check;
4. route validation;
5. focused Playwright tests for Phases 2C and 3–7;
6. production web build;
7. migration static checks or SQL validation where available;
8. secret-scan guard for OAuth/service-role material.

Staging integration tests should run only when required secrets are configured and must otherwise report a clear `skipped — secrets unavailable`, not false success.

Upload Playwright reports and useful logs as artifacts on failure.

Do not include real secrets in workflow files.

## 30. CI Merge Gate

Before PR #81 can become ready for review:

- workflow exists on the PR branch;
- workflow runs for the latest head;
- all non-secret-dependent jobs pass;
- staging job passes after staging authorization/secrets are available;
- Vercel preview checks pass;
- no build-rate-limit failure is misclassified as code failure;
- no required job remains merely local-only.

---

# HARDENING MILESTONE H9 — AUTHENTICATED STAGING SMOKE TEST

## 31. Purpose

After migrations and CI pass, test the actual deployed preview/backend against staging with authenticated, role-specific accounts or controlled test identities.

Required smoke flows:

### Seller stock

- authorized seller creates stock;
- opening quantity becomes ledger event;
- direct quantity patch rejected;
- reserve and release update balances;
- unauthorized buyer receives 403.

### Reverse RFQ

- buyer creates/publishes request;
- seller sees eligible RFQ;
- seller submits quote;
- buyer accepts one quote;
- competing quote is not accepted;
- unauthorized actor cannot accept.

### AI

- low-risk draft action works;
- medium-risk requires confirmation;
- high-risk execution blocked;
- duplicate command does not duplicate action.

### Container

- operator creates container;
- participant requests reservation;
- unauthorized user cannot approve;
- authorized approval updates capacity;
- overfill rejected.

### Drive

- disabled/not-activated state is truthful;
- no mock URL appears in production-mode preview;
- no token or credential reference appears in API response.

Capture:

- request IDs;
- HTTP statuses;
- sanitized response excerpts;
- database verification queries;
- screenshots where useful;
- cleanup confirmation.

Do not use production Supabase.

---

# HARDENING MILESTONE H10 — FINAL REVIEW READINESS

## 32. Required Documentation Updates

Update:

```text
docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md
docs/DIASPORA_PHASES_3_TO_7_HANDOFF.md
docs/CARUP_WORKSTREAM_SEPARATION_AND_HANDOFF.md
```

Add:

```text
docs/DIASPORA_PHASES_3_TO_7_HARDENING_REPORT.md
```

The hardening report must state:

- each original risk;
- exact remediation;
- migration/RPC names;
- staging migration versions;
- staging integration evidence;
- concurrency evidence;
- authorization matrix result;
- audit policy;
- CI workflow/run links;
- Vercel results;
- Drive classification;
- remaining external blockers;
- production activation steps;
- rollback/remediation instructions;
- whether PR is ready or still blocked.

## 33. PR Update

Update PR #81 body to distinguish:

- implemented features;
- hardening completed;
- staging verification;
- CI evidence;
- deferred external activation;
- known limitations;
- production migration steps;
- explicit non-goals.

Keep PR draft until all mandatory gates pass.

Do not merge.

---

## 34. Mandatory Test Matrix

Run after relevant milestones and again at final head.

### Repository hygiene

```bash
git diff --check
git status --short
git diff --name-status origin/main...HEAD
```

### Backend

Run the project’s actual focused Diaspora test commands. At minimum include:

```text
stock
RFQ/quote
AI command
container marketplace
Drive
workbook Phase 2C regressions
route authorization
atomic RPC contract
```

### Type and frontend

```bash
npx tsc --noEmit --project web/tsconfig.app.json
npx vitest run web/src/config/featureRegistry.route-validation.test.ts
npm run build
```

### Playwright

Run:

```text
web/e2e/diaspora-workbook-dry-run.spec.ts
web/e2e/diaspora-workbook-operator-console.spec.ts
web/e2e/diaspora-stock-supply.spec.ts
web/e2e/diaspora-reverse-rfq.spec.ts
web/e2e/diaspora-ai-command-center.spec.ts
web/e2e/diaspora-container-marketplace.spec.ts
web/e2e/diaspora-drive-connections.spec.ts
```

Add new E2E/API contract specs where authorization gaps were fixed.

### Staging

Run the gated real-database integration suite after authorization and migration apply.

### CI

Record job names, run IDs, status, and artifact links.

---

## 35. Mandatory Merge Gates

PR #81 must remain draft and unmerged until all applicable gates pass.

### Gate 1 — Atomicity

- stock movement is one database transaction;
- quote acceptance is one database transaction;
- container approval is serialized in one database transaction;
- concurrency tests pass.

### Gate 2 — Authorization

- explicit backend route allowlists;
- service ownership/tenant checks;
- spoofed role rejection;
- cross-tenant tests pass.

### Gate 3 — Audit

- critical audit policy defined;
- critical mutations roll back on audit failure;
- documentation is truthful.

### Gate 4 — Database

- migrations reviewed;
- staging schema inspected;
- migrations applied to staging only;
- advisors reviewed;
- integration tests pass;
- production untouched.

### Gate 5 — CI

- independent CI workflow runs;
- backend/type/route/E2E/build checks green;
- artifacts available on failure;
- no required result exists only as an agent claim.

### Gate 6 — Drive/OAuth

Either:

- real Google provider implemented and staging-verified;

or:

- feature fails closed and is clearly classified as scaffold/mock-only.

Additionally:

- production mock forbidden;
- state expiry and one-time replay protection implemented;
- production secret fallback forbidden.

### Gate 7 — Regression

- Phase 2C tests pass;
- existing Diaspora tests pass;
- no unrelated workstream files changed;
- Vercel previews green or failures accurately classified.

### Gate 8 — Review

- PR is updated with evidence;
- independent review requested/completed where available;
- unresolved review threads are zero;
- user explicitly approves readiness transition.

---

## 36. Stop Conditions

Stop and report instead of guessing when:

- staging migration permission is not authorized;
- a destructive migration would be required;
- production Supabase access would be required;
- live Google OAuth credentials are required;
- a secure credential vault decision is unresolved;
- a role/tenant product policy is ambiguous;
- a database function would need unsafe `SECURITY DEFINER` behavior without a safe design;
- current main introduces conflicts with unrelated workstreams;
- a cross-tenant leak cannot be resolved safely;
- CI requires a paid/external service not provisioned.

Continue all independent milestones even if Drive live activation remains blocked.

---

## 37. Final Report Format

Report exactly:

1. Branch
2. PR number and URL
3. Final head SHA
4. Base main SHA
5. PR draft/ready state
6. Risk A stock atomicity remediation
7. Stock RPC/migration names
8. Stock concurrency test evidence
9. Risk B quote atomicity remediation
10. Quote RPC/migration names
11. Quote concurrency evidence
12. Risk C container serialization remediation
13. Container RPC/migration names
14. Container concurrency evidence
15. Authorization matrix path
16. Route authorization changes
17. Spoofed-role test results
18. Tenant-isolation test results
19. Critical audit policy
20. Audit rollback test evidence
21. Migration files created
22. Migrations applied to staging
23. Staging migration versions
24. Production Supabase touched or not
25. Staging integration suite results
26. Security advisor results
27. Performance advisor results
28. CI workflow path
29. CI run ID and URL
30. Backend test result
31. TypeScript result
32. Route-validation result
33. Playwright result
34. Build result
35. Vercel result
36. Drive production classification
37. Google provider implementation state
38. OAuth state expiry result
39. OAuth replay result
40. Production mock-provider result
41. Secrets/environment variables required
42. Dependencies added
43. Phase 2C regression result
44. Unrelated workstreams untouched
45. stash@{0} untouched
46. Untracked artifacts excluded
47. Known limitations
48. External blockers
49. Unresolved review threads
50. Whether PR is merge-ready
51. Recommended next action

---

## 38. Claude Code Start Instruction

After reading this full directive, execute:

```text
Read docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_HARDENING_DIRECTIVE.md in full.

Set the /goal from Section 4.
Start the /loop from Section 4.
Remain on claude/diaspora-phases-3-7-program and keep PR #81 draft.
Create docs/DIASPORA_PHASES_3_TO_7_HARDENING_PROGRESS.md.
First correct the documentation claims that currently overstate atomicity, audit guarantees, concurrency safety, and Google Drive readiness.
Then complete milestones H1 through H10 in order.
Do not merge.
Do not touch production Supabase.
Do not apply staging migrations without explicit authorization.
Do not touch stash@{0} or unrelated workstreams.
Stop only for a genuine authorization, external-credential, destructive-migration, or unresolved product-policy blocker.
```

---

## 39. Final Principle

Passing mocked tests is not the final proof for a trade operating system.

The required proof is:

- atomic database state;
- serialized concurrent behavior;
- explicit backend authorization;
- critical audit integrity;
- applied staging migrations;
- live integration evidence;
- independent CI;
- truthful external-integration status;
- preserved workstream boundaries.

Do not optimize for declaring completion. Optimize for earning the right to merge.
