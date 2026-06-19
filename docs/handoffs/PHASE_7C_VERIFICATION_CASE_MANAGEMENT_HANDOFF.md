# CarUp Phase 7C — Verification Case Management Handoff

## Purpose

This document is the durable handoff for continuing CarUp Phase 7C in a new chat, IDE session or agent run.

Do not reconstruct Phase 7C from conversation memory. Verify live state, then use this file and the canonical execution prompt.

Canonical execution prompt:

[`docs/agent-prompts/PHASE_7C_STAGING_READINESS.md`](../agent-prompts/PHASE_7C_STAGING_READINESS.md)

Prompt-storage policy:

[`docs/agent-prompts/README.md`](../agent-prompts/README.md)

---

# 1. Standing CarUp continuity rule

For CarUp, all long or multi-step agent prompts must be committed as Markdown files under `docs/agent-prompts/`.

Every future chat instruction must refer to the repository path or GitHub link and instruct the agent to read the file first.

Project/thread handoffs belong under `docs/handoffs/`.

Do not use chat memory, an uploaded file or an offline document as the only source for an important directive.

When instructions change:

1. update the repository Markdown file
2. commit it
3. reference its path in the chat prompt
4. ask the agent to report the commit SHA it read

Never store secrets, passwords, private evidence, identity documents, signed URLs or database connection strings in these documents.

---

# 2. Project isolation

This handoff is for **CarUp / CarUp Kimi only**.

Do not mix this project with:

- Church OS
- STOLEN
- job applications
- unrelated personal documents
- other repositories

Only import functionality from another project when the owner explicitly authorizes it.

---

# 3. Repository state

Repository:

`kudzimusar/carup`

Active pull request:

`#72 — Phase 7C: Admin verification review loop and mobile status refresh`

Active PR branch:

`phase-7c-native-verification-production-loop`

Implementation head verified before the prompt/handoff documentation commits:

`0c7353396c89bb0fdf199c968d35d55f3a89d3ff`

The current PR head may be newer because the canonical prompt and this handoff were committed afterward. Always verify with GitHub before making claims or creating a worktree.

PR rules:

- keep PR #72 open
- do not merge
- do not enable auto-merge
- do not force-push
- push only intended focused commits
- update the existing PR rather than creating a parallel verification PR

---

# 4. Phase 7C objective

Build a production-grade identity verification case-management system that separates:

1. evidence capture
2. document classification
3. OCR provider execution
4. extraction trust
5. account/document identity binding
6. human review
7. applicant correction
8. final disposition
9. immutable audit history

OCR provider success must never be treated as proof that:

- a real identity document exists
- extracted fields are true
- the document belongs to the account holder
- the identity is verified

Only an allowed backend decision transition can create a verified identity state.

---

# 5. Why Phase 7C was redesigned

A real owner test uploaded photographs of a cup as the front and back identity evidence.

Gemini returned plausible but false identity data, including:

- a personal name
- a national ID-like value
- a date of birth
- country information
- confidence `0.98`

The system correctly stopped automatic verification and routed the session to manual review, but the automated output was still presented too authoritatively.

The admin interface also used two ambiguous text fields and four adjacent actions. The owner intended to request a retry, but only an internal note was persisted. The case remained in manual review.

The redesign therefore requires:

- document classification before trusted extraction
- quarantine of hallucinated OCR fields
- backend decision guardrails
- separate internal notes and applicant messages
- clear operational queues
- explicit state transitions
- persistent action confirmation
- truthful mobile outcomes

---

# 6. Implemented architecture on PR #72

The PR contains the following Phase 7C work:

## Backend domain model

- `backend/services/identity/caseWorkflow.js`
- `backend/services/identity/reasonCodes.js`
- `backend/services/identity/decisionPolicy.js`
- `backend/services/identity/decisionRecorder.js`
- `backend/services/identity/documentClassifier.js`

These provide:

- workflow phases
- decision actions
- reason-code rules
- allowed-action evaluation
- optimistic concurrency
- idempotency support
- append-only decisions
- two-pass classification/extraction
- OCR trust quarantine

## Admin case management

- `web/src/pages/dashboard/admin/IdentityVerificationCaseManagement.tsx`
- active route should be `/admin/verification`
- the old four-button review form must not remain the active architecture

The new UI is intended to provide:

- operational queues
- evidence classification
- extraction trust
- identity-binding state
- risk and reason information
- secure signed previews
- decision-first disposition selection
- distinct internal note and applicant message fields
- persistent confirmation after successful transitions

## Mobile truthfulness

The mobile result flow was changed so unverified OCR output is not presented as a confirmed KYC record.

Only backend status `verified` may show confirmed identity fields.

Retry cases should show:

- Retake Required
- the applicant-facing correction message
- the evidence sides to replace
- Restart Verification

## CSRF changes

Reported corrections include:

- CSRF cookie path broadened to `/`
- production fallback-secret guard
- one controlled client retry after a stale-token `403`

These changes still require complete integrated staging validation.

---

# 7. New migrations on PR #72

## Case-management migration

`database/migrations/20260618040000_verification_case_management.sql`

It adds:

- workflow snapshot columns on `verification_sessions`
- `verification_assessments`
- `verification_decisions`
- indexes
- RLS on new tables
- service-role-only direct access

## Evidence/trust snapshot migration

`database/migrations/20260618050000_verification_evidence_trust_columns.sql`

It adds nullable trust-state columns to `verification_sessions`.

These migrations have not been approved for production application.

---

# 8. Database project boundaries

## Production

Project name:

`CarUp`

Project reference:

`vhmnajoeicasaigiophh`

Last verified production state:

- active and healthy PostgreSQL project
- `verification_sessions` exists
- `verification_ocr_provenance` exists
- `trust_audit_events` exists
- the two newest case-management migrations are not applied
- 27 public tables have RLS disabled
- migration history does not fully represent the live schema
- some Phase 7C owner tests created real test records

Production is prohibited during the current staging-readiness task.

Do not run production SQL, schema changes, seed operations, cleanup or test writes.

## Staging

Project name:

`carup-staging`

Project reference:

`eoyenigwevnxwwhyhaer`

Last verified staging state:

- active and healthy PostgreSQL project
- `trust_audit_events` exists
- `verification_sessions` is missing
- `verification_ocr_provenance` is missing
- the Phase 7B/7C identity migration chain is not recorded
- 39 public tables have RLS disabled

Staging is not ready for the two newest migrations in isolation.

---

# 9. Approved staging identity migration chain

Apply only after preflight passes and the owner explicitly authorizes staging DDL.

Order:

1. `database/migrations/20260613000000_phase7b_supabase_auth_and_identity.sql`
2. `database/migrations/20260613020000_verification_admin_review.sql`
3. `database/migrations/20260618030000_verification_ocr_provenance.sql`
4. `database/migrations/20260618040000_verification_case_management.sql`
5. `database/migrations/20260618050000_verification_evidence_trust_columns.sql`

Do not blindly replay the old `trust_audit_events` migration because the table already exists in staging and contains rows.

First compare its live structure to the repository definition. Any correction must be additive and preserve existing data.

---

# 10. Test and build state at handoff

Reported targeted results on implementation head `0c73533`:

- decision-policy backend suite: green
- document-classifier backend suite: green
- admin-review backend suite: green
- web Vitest: `119/119`
- mobile truthful-state Vitest: `18/18`
- web TypeScript: clean
- mobile TypeScript: clean
- Expo iOS export: successful

Reported full backend result:

- total: `474`
- passed: `462`
- failed: `5`
- skipped: `7`

Reported failing suites:

- `audit-logger.test.js`
- `auth-middleware.test.js`
- `evidence-api.test.js`
- `evidence-validation.test.js`
- `trust-fact-workflow.test.js`

The next agent must reproduce, explain and fix these failures. “Pre-existing” is not a sufficient final state.

Skipped tests must be listed and explained.

---

# 11. Deployment state

At the last verified checkpoint:

- backend Vercel preview: successful
- backend-staging Vercel preview: successful
- frontend Vercel preview: blocked
- frontend-staging Vercel preview: blocked

The frontend block was reported as the Vercel Free plan daily deployment limit:

`api-deployments-free-per-day`

This is an external quota blocker, not a proven code-build failure.

Do not create empty commits or repeatedly push to retrigger Vercel.

Local TypeScript and production builds must still pass. Redeploy the final SHA only after quota resets.

---

# 12. Current database-security position

The database is operational, but it is not fully production-ready.

Current risks:

- production: 27 public tables without RLS
- staging: 39 public tables without RLS
- incomplete migration ledgers
- manually applied historical SQL
- schema drift between staging and production

Do not bulk-enable RLS. Enabling RLS without correct policies can break the application.

The current task must produce an RLS inventory and remediation plan, not broad policy application.

Priority 0 categories:

- identity and PII
- authentication/session data
- financial records
- administrative controls
- audit and security logs

---

# 13. Active remaining work

The canonical work order is maintained in:

[`docs/agent-prompts/PHASE_7C_STAGING_READINESS.md`](../agent-prompts/PHASE_7C_STAGING_READINESS.md)

The active tasks are:

1. resolve the five full-suite backend failures
2. create a read-only staging preflight
3. validate the five-file migration chain
4. compare existing staging `trust_audit_events`
5. create a staging-only migration runner with production refusal
6. create post-migration verification tooling
7. document migration-history reconciliation
8. document the RLS remediation plan
9. correct the outdated PR #72 body
10. run all backend, web, mobile and database-tooling checks
11. push focused commits to the existing PR branch
12. stop before staging DDL

---

# 14. Owner constraints

Agents must preserve these rules:

- no production DDL without explicit approval
- no staging DDL until preflight/tooling report is approved
- no merge without explicit approval
- no auto-merge
- no force-push
- no unrelated overhaul
- no project mixing
- no committed secrets or identity evidence
- agents should automate branch, commit, push and PR updates where authorized
- the owner should not be asked to repeat routine Git operations when an agent can safely perform them

---

# 15. New-thread startup procedure

The first assistant or agent in a new thread must:

1. read this handoff
2. read the canonical Phase 7C execution prompt
3. fetch PR #72 live
4. verify the current PR branch head
5. check current CI and Vercel statuses
6. verify production and staging project references
7. run only read-only database checks unless explicit DDL authorization exists
8. state any difference between live state and this handoff
9. continue from the current verified state rather than restarting Phase 7C

A suitable first message in the new thread is:

> Continue CarUp Phase 7C from PR #72. First read `docs/handoffs/PHASE_7C_VERIFICATION_CASE_MANAGEMENT_HANDOFF.md` and `docs/agent-prompts/PHASE_7C_STAGING_READINESS.md` from the PR branch. Verify the current GitHub, CI, Vercel and Supabase state before making claims. Do not merge, force-push, enable auto-merge, apply production DDL or apply staging DDL without explicit authorization.

---

# 16. Next owner authorization point

After the active agent completes the full-suite fixes, staging preflight, safe runner, verification tooling and documentation, it must stop and provide the final report required by the canonical prompt.

Only then may the owner authorize:

`Apply the verified Phase 7C migration chain to carup-staging only.`

After staging migrations:

1. verify schema and row preservation
2. run the cup/non-document test
3. run a controlled synthetic-ID test
4. test all review dispositions
5. verify audit, idempotency and stale-version behavior
6. verify mobile refresh and resubmission
7. obtain a successful frontend deployment
8. review security findings
9. decide whether production migration is authorized

PR #72 remains a no-merge PR until these gates pass.