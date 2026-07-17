# Staging End-to-End Acceptance Test Plan

> PR #72 — Phase 7C staging verification
> Target: carup-staging (eoyenigwevnxwwhyhaer)

## Prerequisites

- Staging backend deployed and reachable
- Staging frontend deployed (or local with EXPO_PUBLIC_API_URL pointing to staging)
- Test accounts: admin + mobile user
- Staging migrations applied and verified

---

## Test 1: Cup / Non-Document → Manual Review

**Purpose:** Verify the P0 false-verification fix is effective.

1. Log in as a mobile user on staging.
2. Start identity verification.
3. Capture/upload a **cup photo** (or screenshot, blank image) as both front and back.
4. Submit verification.

**Expected:**
- Session status is NEVER `verified`.
- Session routes to `pending_manual_review`.
- OCR fields show empty/quarantined (no hallucinated identity data).
- Admin can see the session in the `/admin/verification` queue.
- Admin can open the session and see uploaded_sides booleans, evidence classification, and identity binding verdict.

---

## Test 2: Admin Review → Request Resubmission

**Purpose:** Verify the reviewer can request a retry and the mobile user sees it.

1. From Test 1, admin clicks **Request Resubmission**.
2. Select reason code (e.g. `DOCUMENT_NOT_VISIBLE`).
3. Add applicant-facing message.
4. Confirm.

**Expected:**
- Decision recorded in `verification_decisions`.
- Session status changes to `retry_requested`.
- `trust_audit_events` entry written.
- Mobile user refreshes → sees "Retake Required" + reason + "Restart Verification" CTA.

---

## Test 3: Mobile Resubmission

**Purpose:** Verify the mobile retry flow.

1. Mobile user taps **Restart Verification**.
2. Captures/upload a real identity document.
3. Submits.

**Expected:**
- New session created or existing session resets to `draft`.
- After upload, routes to `pending_manual_review`.

---

## Test 4: Admin Approve Valid Identity

**Purpose:** Verify the full approval chain.

1. Admin opens the resubmitted session.
2. Views evidence via secure signed preview (click "Show evidence & identity").
3. Confirms identity binding shows `match`.
4. Clicks **Approve** with internal note.

**Expected:**
- Session status → `verified`.
- Decision recorded.
- Mobile user refresh → sees "Identity Verified".

---

## Test 5: Admin Reject

**Purpose:** Verify rejection flow.

1. Admin opens a `pending_manual_review` session.
2. Clicks **Reject** with reason code and applicant message.
3. Confirms.

**Expected:**
- Session status → `rejected`.
- Mobile user sees "Verification Failed" + reason.
- "Restart Verification" CTA available.

---

## Test 6: Verify Audit Trail

**Purpose:** Prove every decision is immutably recorded.

1. Run the following checks via Supabase SQL editor on staging:

```sql
-- Decisions are recorded
SELECT COUNT(*) FROM verification_decisions;

-- Audit events written
SELECT event_type, COUNT(*) FROM trust_audit_events
WHERE event_type LIKE 'VERIFICATION_%'
GROUP BY event_type;

-- Idempotency keys prevent duplicates
SELECT idempotency_key, COUNT(*) FROM verification_decisions
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

**Expected:**
- Each decision has exactly one `verification_decisions` row.
- Each review action has a corresponding `trust_audit_events` entry.
- No duplicate idempotency keys.

---

## Test 7: Stale-Version Rejection

**Purpose:** Verify optimistic concurrency guard.

1. Admin opens a session detail view.
2. Another admin (or direct SQL) modifies the session.
3. First admin submits a decision.

**Expected:**
- 409 Conflict response due to version mismatch.
- No duplicate decision recorded.

---

## Test 8: Security — Unauthenticated & Unauthorized Rejection

**Purpose:** Verify access controls.

1. Hit `/api/admin/identity/verification-sessions` without auth headers → **401**.
2. Hit same endpoint with a non-admin user session → **403**.
3. Verify `anon` cannot query `verification_sessions`, `verification_decisions`, or `verification_assessments` directly.

---

## Test 9: Row Preservation — Final Counts

**Purpose:** Verify no data loss from the full test run.

```sql
SELECT 'users' AS tbl, COUNT(*) FROM users
UNION ALL
SELECT 'user_sessions', COUNT(*) FROM user_sessions
UNION ALL
SELECT 'trust_audit_events', COUNT(*) FROM trust_audit_events;
```

**Expected:** users and user_sessions unchanged from pre-test baseline.
