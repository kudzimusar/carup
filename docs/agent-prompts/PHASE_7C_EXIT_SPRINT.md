# Phase 7C Exit Sprint

## Goal

Finish PR #72 without reopening architecture work.

Current verified baseline:

- PR branch: `phase-7c-native-verification-production-loop`
- Current head at creation: `1b6895d574db54cbd79272343e537fc9dcd33a52`
- PR open, mergeable, unmerged
- All four Vercel checks green
- Backend: 499 total, 492 pass, 0 fail, 7 conditional skips
- Web: 119/119; TypeScript and production build green
- Mobile: 18/18; TypeScript and Expo iOS export green
- Staging Phase 7B/7C identity migrations applied and verified
- Production case-management migrations not applied

Always fetch live state before acting.

## Rules

- No new features.
- No redesign.
- No unrelated refactor.
- No force-push.
- No merge or auto-merge before exit gates pass.
- No production changes without explicit owner approval.
- Do not reopen the broad RLS sprint; record it as follow-up.

## Gate 1 — Automated staging acceptance

Target only staging Supabase `eoyenigwevnxwwhyhaer` and the current staging deployments.

Automate these scenarios:

1. **Cup/non-document containment**
   - submit synthetic cup front/back plus synthetic selfie
   - assert never verified
   - assert classification blocks approval
   - assert OCR identity fields are empty, quarantined or untrusted
   - assert case enters reviewer action required

2. **Request resubmission**
   - admin submits structured reason and applicant message
   - assert one decision row
   - assert one audit event
   - assert session becomes `retry_requested`
   - assert applicant API returns the message and retry state

3. **Idempotency and concurrency**
   - repeat same idempotency key; assert no duplicate
   - submit stale version; assert 409 and no conflicting decision

4. **Authorization**
   - unauthenticated admin API: 401
   - authenticated non-admin: 403
   - admin: succeeds
   - direct anon/authenticated table access remains denied

5. **Controlled valid-document policy path**
   - use only synthetic fixtures
   - prove extraction runs only after qualifying classification
   - prove no auto-verification
   - prove verified state is created only by an allowed admin decision

Capture before/after counts for `users`, `user_sessions`, and `trust_audit_events`.

Create:

`docs/reports/PHASE_7C_STAGING_ACCEPTANCE_REPORT.md`

Record PR SHA, scenario results, staging session IDs, decision IDs, audit event IDs, row counts, limitations, and proceed/stop recommendation. Never include secrets, tokens, signed URLs, private paths or document bytes.

Gate 1 passes only when all five scenarios pass and all automated suites remain green.

## Gate 2 — One owner physical-device smoke test

Do not ask the owner to repeat API tests.

Provide one seven-step journey:

1. Open mobile client configured for staging.
2. Log in as staging applicant.
3. Submit cup/non-document evidence.
4. Confirm no verified identity or authoritative OCR record appears.
5. Admin requests resubmission in staging web.
6. Refresh mobile.
7. Confirm `Retake Required`, applicant message and `Restart Verification`.

Gate 2 passes with one successful owner confirmation.

## Gate 3 — Production cutover and merge

Begin only after explicit owner authorization.

1. Run production read-only preflight on `vhmnajoeicasaigiophh`.
2. Apply only the production-pending migrations:
   - `20260618040000_verification_case_management.sql`
   - `20260618050000_verification_evidence_trust_columns.sql`
3. Verify schema, RLS, grants and row preservation.
4. Confirm all PR checks green.
5. Merge PR #72 using the repository-preferred method.
6. Verify production frontend/backend deployment.
7. Run a non-destructive production smoke test.
8. Create `docs/reports/PHASE_7C_PRODUCTION_CUTOVER_REPORT.md`.

Do not replay the full staging migration chain against production.

## Release blockers only

Block release only if:

- non-document can become verified
- untrusted OCR is shown as confirmed identity
- reviewer decision does not persist
- applicant cannot see resubmission request
- authorization fails
- idempotency/concurrency allows conflicting decisions
- production migration is unsafe
- production deployment fails

Everything else becomes follow-up backlog.

## Required next report

Return only:

1. current SHA
2. Gate 1 results
3. staging session/decision/audit IDs
4. automated suite totals
5. owner smoke-test instructions
6. blockers
7. proceed/stop recommendation

Do not produce another broad architecture review.