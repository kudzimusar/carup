# Diaspora Trade OS — Final Completion Goal Loop

This is the canonical plan for closing the five remaining original-plan capabilities. All agents must read and update this document before claiming completion.

Repository: `kudzimusar/carup`
Program branch: `claude/diaspora-phases-8-10-production-program` (PR #90, stacked on PR #81)
Supabase: use `carup-staging` for implementation proof. Keep the `CarUp` production project read-only until the authorized release gate.

## /goal

Complete all five remaining capabilities in one autonomous program:

1. Buyer self-service trade-profile management.
2. Seller/supplier self-service trade-profile management plus reviewer verification/suspension.
3. Payment-milestone creation UI with secure server rules and non-custodial wording.
4. Tenant-scoped database-sourced XLSX export using the existing workbook catalog and exporter.
5. Rollback/recovery completion: atomic workbook draft execution, rollback plans for forward-only migrations, and removal of the legacy non-atomic reservation-approval path.

The goal is complete only when all five are user-operable, tenant-safe, tested, staged on Supabase, documented, committed, pushed, and CI-green.

## /loop

Repeat until every exit condition is green:

1. **Discover** current routes, services, schema, RLS, RPCs, storage, tests, PR state, and gaps.
2. **Plan** isolated agent work; reserve shared files for the Program Integrator.
3. **Implement** the smallest complete production-safe change.
4. **Migrate staging** with additive migrations; never edit applied migration bytes.
5. **Verify Supabase** tables, functions, indexes, RLS, grants, search paths, storage policies, and advisors.
6. **Test** unit, route, authz, tenant isolation, idempotency, concurrency, UI, accessibility, and E2E.
7. **Adversarially review** over-permission, PII exposure, replay, rollback, spreadsheet injection, TOCTOU, and route shadowing.
8. **Integrate** shared-file edits serially; push coherent commits to PR #90 and wait for CI.
9. **Document evidence** in this plan, the acceptance matrix, migration ledger, risk register, and runbooks.
10. If anything remains incomplete, return to step 1. Exit only at a clean, pushed, CI-green, staging-verified boundary.

Do not pause for phase-by-phase approval. Stop only for a real external blocker, destructive production action, cost-bearing resource creation, or product-contract decision.

---

## Boundaries

- No UI-10, referral work, redesign, live billing, live Drive, or real-money SafeTrade.
- Confirmed workbook import remains disabled; make only draft execution atomic.
- Do not mutate production Supabase during this goal loop.
- Do not print or commit secrets.
- Do not trust client-provided tenant, user, role, verification, ownership, or payment state.
- Do not create public storage buckets.
- Keep PR #90 draft and stacked until release authorization.

## Integration-owned files

Only the Program Integrator edits shared files such as:

- `backend/routes/diasporaRoutes.js`
- `backend/routes/diasporaWorkbookXlsxRoutes.js`
- `backend/server.js`
- `web/src/App.tsx`
- `web/src/config/featureRegistry.ts`
- `web/src/hooks/useCarUpApi.ts`
- `web/src/types/index.ts`
- lockfiles, workflows, migrations, and program documents

Specialists create isolated services, components, tests, and proposed patches. Integration is serial.

---

# A. Secure trade-profile management

## Backend first

Add or normalize:

- `GET /api/diaspora/trade-profiles/me`
- `POST /api/diaspora/trade-profiles`
- `PATCH /api/diaspora/trade-profiles/:id`
- scoped `GET /api/diaspora/trade-profiles/:id`
- tenant-scoped reviewer/admin `GET /api/diaspora/trade-profiles`
- optional `POST /api/diaspora/trade-profiles/:id/submit-review`
- existing reviewer-only verify/suspend operations

Rules:

- derive `user_id` and `tenant_id` from trusted `userContext`;
- reject attempts to assign another user or tenant;
- owner edits only safe fields;
- verification state, trust score, reputation counters, and audit fields are server-controlled;
- verified role changes require a controlled transition;
- enforce the chosen one-profile-per-user/tenant/role rule;
- scope every read by owner, tenant, participant, or reviewer policy;
- require reason/audit for verify and suspend;
- suspended profiles fail closed on protected trade operations;
- sanitize metadata and prevent privilege-bearing keys;
- add optimistic concurrency or version checks.

Supabase:

- verify/add unique indexes and tenant/user/role/status indexes;
- verify owner, tenant-admin, and reviewer RLS policies;
- ensure anonymous users cannot read private profiles;
- add a new migration rather than changing an applied migration.

## UI

Create:

- `/diaspora/trade-profile` — shared buyer/seller/supplier self-service page
- `/diaspora/admin/trade-profiles` — reviewer queue if required

Support create, edit safe fields, verification status, submit for review, reviewer verify/suspend, loading/error/conflict states, and accessibility.

Tests must cover self-creation, client identity spoofing, duplicate rules, safe updates, forbidden trust/status changes, unrelated and cross-tenant denial, reviewer actions, suspension enforcement, audit, RLS, E2E, and accessibility.

---

# B. Payment-milestone creation

Harden `POST /api/diaspora/import-orders/:id/payment-milestones` before exposing its UI.

Rules:

- authorize from trusted tenant/order participation;
- define buyer/seller/admin/reviewer rights explicitly;
- client cannot create final payment states such as PAID, RELEASED, REFUNDED, or VERIFIED;
- new milestones start non-final;
- validate positive amount, currency, type, date, accepted quote/order relationship, and cumulative amount;
- require idempotency;
- write critical audit and notification evidence;
- return explicit wording that this is a commercial schedule, not proof that money moved.

Add the form to order detail and Order Passport with amount/type/currency/due date, totals, remaining balance, confirmation, duplicate-submit protection, safe errors, refresh, and accessible status messages.

Test authorization, spoofing, invalid amounts/currencies/types, forbidden final states, over-allocation, idempotency, audit, notification, non-custodial wording, and UI behavior.

---

# C. Database-sourced XLSX export

Keep the existing caller-row export for compatibility only. Add a trusted route such as:

- `POST /api/diaspora/workbook/xlsx/export-from-db`

The request may contain `templateType`, safe filters/date range, and a redaction profile, but never data rows.

Server flow:

1. authorize actor/tenant;
2. resolve the existing template catalog;
3. query only authorized tenant data through services/read projections;
4. map rows to the existing stable workbook keys;
5. apply role-based PII redaction;
6. neutralize spreadsheet formulas;
7. call the existing `exportWorkbook` engine;
8. audit template, filters, counts, checksum, actor, and timestamp;
9. return the file without storing it by default.

Support the existing buyer, seller, supplier, enterprise, and container-reservation templates. Do not create a second schema.

Enforce tenant isolation, participant restrictions, row/cell/file ceilings, timeouts, and safe fields. Never export secrets, provider metadata, private storage paths, or raw internal policy data.

Storage audit:

- inspect current buckets/policies;
- create no bucket unless persistence is proven necessary;
- default to on-demand download;
- verify no workbook/profile document is publicly readable.

Test tenant isolation, role redaction, formula safety, limits, audit, parser round-trip, and UI download/privacy warning.

---

# D. Atomic workbook draft execution

Confirmed live import stays disabled. Make the existing draft/staging executor atomic through a database transaction, preferably a SECURITY DEFINER RPC with pinned `search_path`.

The operation must:

- accept a validated batch reference, not arbitrary tables/SQL;
- verify tenant, actor, checksum, schema version, template, and approval state;
- reject changed data after dry-run;
- lock the batch;
- enforce idempotency;
- write all draft rows or none;
- write critical audit in the same transaction;
- return deterministic mappings/counts;
- leave a failed batch retryable;
- never write live trade tables.

Revoke inappropriate execution grants and prevent dynamic SQL/table input.

Test all-or-nothing writes, audit rollback, duplicate retry, checksum/version conflict, tenant spoofing, concurrent execution, retry after failure, and proof that live tables remain unchanged. Run concurrency against staging, not mocks only.

---

# E. Reservation atomicity and migration rollback

Route `POST /api/diaspora/reservations/:id/approve` through the same atomic capacity RPC/service used by the guarded marketplace flow.

Requirements:

- preserve response compatibility where possible;
- generic status mutation must not approve reservations;
- enforce operator/reviewer role and tenant scope;
- lock reservation/container rows;
- prevent overfill under concurrency;
- write audit inside the transaction;
- keep reject/cancel separately authorized and idempotent.

Test legacy route delegation, concurrent overfill prevention, generic-approve rejection, unauthorized/cross-tenant denial, audit rollback, and UI regression.

For every migration without a Down path:

- classify as reversible SQL, compensating migration, or feature-disable plus backup restore;
- add safe versioned scripts under `database/rollbacks/diaspora/` where possible;
- add before/after verification queries;
- document data-loss risk;
- rehearse on staging or an approved isolated branch;
- update the migration ledger and rollback runbook;
- never claim rehearsal when only static review occurred.

---

# Supabase staging checklist

Use `carup-staging` directly:

1. inventory tables, functions, policies, indexes, grants, migration history, storage buckets, and policies;
2. run security/performance advisors;
3. apply only missing additive migrations;
4. verify objects, RLS, positive/negative tenant cases, function owner/search path/grants;
5. run targeted integration and concurrency tests;
6. run advisors again;
7. record evidence in the migration ledger.

Keep production read-only until the release gate.

---

# Required gates

Backend:

- profile, milestone, export, atomic draft, reservation concurrency, tenant isolation, role spoofing, audit, idempotency, and full Diaspora suites.

Frontend:

- buyer/seller profile, reviewer profile, milestone, database export, passports, vehicle/parts journeys, component tests, E2E, and accessibility.

Repository:

- `npm ci`, TypeScript, production build, route validation, authoritative Diaspora CI, lint with no new debt, migration sanity, RLS/ACL checks, `node --check`, `git diff --check`, and secret scan.

Staging:

- applied migrations, real concurrency, profile/milestone/export APIs, storage privacy, and both integrated journeys.

Exit requires zero failed required tests and zero unresolved P0/P1 defects.

---

# Parallel execution

- Agent A: profile backend/RLS/tests
- Agent B: profile UI/E2E
- Agent C: milestones backend/UI/tests
- Agent D: DB export/privacy tests
- Agent E: atomic workbook RPC/concurrency
- Agent F: reservation atomicity/rollback scripts
- Agent G: Supabase staging/schema/storage/advisors
- Agent H: adversarial security/recovery review

The Program Integrator reviews all diffs, applies shared-file edits serially, runs full gates, updates evidence, pushes PR #90, and waits for CI.

Suggested commits:

1. `fix(diaspora): secure trade profile ownership and tenant scope`
2. `feat(diaspora): add buyer and seller trade profile management`
3. `feat(diaspora): add payment milestone creation experience`
4. `feat(diaspora): export tenant workbooks from database`
5. `fix(diaspora): make workbook draft execution atomic`
6. `fix(diaspora): use atomic capacity approval for reservations`
7. `docs(diaspora): complete rollback and final capability evidence`

---

# Progress matrix

| Workstream | Discovery | Code | Migration | Staging | Tests | E2E | Review | Docs | Status |
|---|---|---|---|---|---|---|---|---|---|
| A Profile management | OPEN | OPEN | OPEN | OPEN | OPEN | OPEN | OPEN | OPEN | OPEN |
| B Payment milestones | OPEN | OPEN | TBD | OPEN | OPEN | OPEN | OPEN | OPEN | OPEN |
| C DB export | OPEN | OPEN | TBD | OPEN | OPEN | OPEN | OPEN | OPEN | OPEN |
| D Atomic drafts | OPEN | OPEN | OPEN | OPEN | OPEN | N/A | OPEN | OPEN | OPEN |
| E Reservation/rollback | OPEN | OPEN | TBD | OPEN | OPEN | REGRESSION | OPEN | OPEN | OPEN |

---

# Final report

Return one report with PR/commit SHAs; routes and policies; RLS/constraint evidence; milestone semantics; export templates and privacy proof; atomic draft and reservation evidence; rollback classifications/rehearsals; staging migrations; schema/RLS/grant/storage/advisor results; backend/frontend/E2E/concurrency totals; vehicle/parts journey results; CI status; remaining findings; acceptance rows moved to COMPLETE; production untouched confirmation; flags remaining OFF; release-only blockers; rollback readiness; and final verdict: `GO FOR RELEASE GATE`, `GO WITH KNOWN LIMITATIONS`, or `NO-GO`.

The loop ends only when all five workstreams are complete and staging-proven, or a genuine external blocker is documented with exact evidence and no code work remains.