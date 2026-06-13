# Phase 7C — Native Verification Production Loop

**Branch:** `phase-7c-native-verification-production-loop`  
**Created from:** `main` after PR #14 merge (2026-06-13T01:08:53Z)  
**Issue:** #70  
**Workstream A (this doc):** Baseline audit and failing-test containment

---

## 1. Phase 7B Route Map

All identity verification routes are registered in `backend/routes/identityVerificationRoutes.js` and mounted via `backend/server.js`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/security/csrf-token` | none (guest) | Returns HMAC-signed CSRF token bound to current session |
| `POST` | `/api/auth/login` | none | scrypt password check, session persist, login_attempts log |
| `POST` | `/api/auth/register` | none | scrypt hash on save |
| `POST` | `/api/identity/verification-sessions` | `authorizeRole()` | Create session (status: `draft`) |
| `POST` | `/api/identity/verification-sessions/:id/upload/:side` | `authorizeRole()` | Upload front/back/selfie; side values: `front`, `back`, `selfie` |
| `POST` | `/api/identity/verification-sessions/:id/submit` | `authorizeRole()` | Runs OCR → evaluates confidence + identity fields → sets `verified` or `pending_manual_review` |
| `GET` | `/api/identity/verification-sessions/:id` | `authorizeRole()` | Fetch session by ID (owner-scoped) |

No admin list or admin review routes exist for verification sessions.

### CSRF / Auth behavior

- `csrfMiddleware` (HMAC-SHA256) validates `x-csrf-token` on all non-idempotent methods (`POST`, `PUT`, `PATCH`, `DELETE`).
- Token is bound to `(userId, sessionToken)`; 90-minute TTL in mobile cache.
- Mobile: `fetchCsrfToken()` sends `ngrok-skip-browser-warning: true` to bypass ngrok HTML interstitial; retries once on 403.
- Session auth: `authorizeRole()` reads `x-session-token` + `x-user-id` headers; rejects with 401 if session is invalid or expired.
- Password: `evaluateLoginCredentials()` requires matching scrypt hash in production; legacy passwordless only in `NODE_ENV=development|test|local`.

---

## 2. Mobile Screen Map

All screens live under `mobile/app/(auth)/verification/` and `mobile/app/(tabs)/`.

| Screen | File | Status |
|--------|------|--------|
| Dashboard entry | `(tabs)/index.tsx` | Welcome block uses `className` (NativeWind now wired post-merge); role switcher and action buttons use inline styles |
| Login | `(auth)/login.tsx` | Fully inline-styled; CSRF fetch before POST; 403 retry; honest error mapping |
| Verification intro | `(auth)/verification/intro.tsx` | Inline-styled benefit cards; CTA navigates to document-select |
| Document select | `(auth)/verification/document-select.tsx` | Needs audit |
| Front capture | `(auth)/verification/capture-front.tsx` | Needs audit |
| Back capture | `(auth)/verification/capture-back.tsx` | Needs audit |
| Selfie | `(auth)/verification/selfie.tsx` | Needs audit |
| Liveness | `(auth)/verification/liveness.tsx` | **Simulated**: auto-complete timer (3 s), no camera, explicitly labelled "(Simulated)"; does not affect backend verification status |
| Review captures | `(auth)/verification/review.tsx` | "Manual Quality Checklist" labels; "Selfie (liveness deferred)" |
| Processing | `(auth)/verification/processing.tsx` | No misleading stage messages; plain spinner |
| Result | `(auth)/verification/result.tsx` | Truthful: verified / pending_manual_review / ocr_failed / rejected |

### NativeWind state (post-merge)

`withNativeWind` is wired in `mobile/metro.config.js` and `global.css` is configured. `className` props on `ScrollView` and `View`/`Text` in `(tabs)/index.tsx` will now render correctly. However, several verification screens (`document-select`, `capture-front`, `capture-back`, `selfie`, `result`) have not been audited for `className`-only controls — Workstream B must audit each.

---

## 3. Database / Migration State

| Migration file | Tables created or altered |
|----------------|--------------------------|
| `003_add_user_sessions.sql` | `user_sessions` — legacy SQLite-flavored schema (TEXT id/created_at, active_role NOT NULL). |
| `20260605042424_verification_sessions_phase7b.sql` | `verification_sessions`, `ocr_documents`, `ocr-documents` storage bucket, RLS |
| `20260613000000_phase7b_supabase_auth_and_identity.sql` | Backfills `user_sessions` defaults (id, active_role, created_at); `login_attempts` table; idempotent |
| `20260613010000_users_password_hash.sql` | `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT` |

### `verification_sessions` column inventory

```
id                UUID PK
user_id           TEXT NOT NULL → users(id)
document_type     TEXT NOT NULL
double_sided      BOOLEAN DEFAULT false
status            TEXT CHECK (draft | captured | uploaded | ocr_pending | ocr_failed | pending_manual_review | verified | rejected)
front_storage_path / front_mime_type
back_storage_path / back_mime_type
selfie_storage_path / selfie_mime_type
ocr_document_id   TEXT → ocr_documents(id)
ocr_result        JSONB
confidence_score  NUMERIC(5,4)
failure_reason    TEXT
review_notes      TEXT
reviewed_by       TEXT → users(id)   ← exists but never written by backend
reviewed_at       TIMESTAMPTZ        ← exists but never written by backend
created_at / updated_at / captured_at / uploaded_at / submitted_at / ocr_started_at / ocr_completed_at
```

**Missing columns for Phase 7C admin review (additive migration required):**
- `review_decision` — `TEXT CHECK (approved | rejected | request_retry)` 
- `retry_reason` — `TEXT`
- `liveness_status` — `TEXT` (once real liveness is implemented)

RLS: `anon` and `authenticated` are revoked; `service_role` only. All queries go through the backend.

### Storage

- Bucket: `ocr-documents` (private, service_role access)
- Paths: `{userId}/{sessionId}/{side}.{ext}` via `storageService.js`
- No signed URL generation exposed to public routes — only `service_role` reads

---

## 4. OCR Quality Gate

Implemented in `backend/services/identity/verificationSessionService.js` as `evaluateOcrEvidence()`.

Rules:
1. `result.success` must be `true`.
2. `confidenceScore` (or `qualityMetrics.blurScore` fallback) must be ≥ 0.75.
3. At least one of: `national_id_number` OR (`first_name` AND `last_name`) must be non-empty.

Outcome:
- All pass → `status = 'verified'`
- Any fail → `status = 'pending_manual_review'` + `failure_reason` set

---

## 5. Existing Admin / Web Patterns Reusable in Phase 7C

| Pattern | Location | Notes |
|---------|----------|-------|
| `authorizeRole(['admin'])` | `backend/middleware/authMiddleware.js` | Drop-in for review routes |
| `asyncHandler` | all route files | Wrap async route handlers |
| `writeAudit()` | `verificationSessionService.js:158` | Already used in verification service; extend for review events |
| `EvidenceReview.tsx` | `web/src/pages/dashboard/admin/EvidenceReview.tsx` | Existing vehicle-evidence review page — same list+detail+action pattern needed for verification queue |
| `DashboardLayout role="admin"` | `web/src/App.tsx:256` | Admin shell already routes to `/admin/*`; add `/admin/verification` here |
| Trust-fact review queue pattern | `trustFactRoutes.js` + `trust-fact-workflow.test.js` | Role-scoped queue, admin/govt approval, audit trail |

---

## 6. Baseline Test Results (main after PR #14 merge)

Tested on Node v20.20.2.

| Suite | Tests | Pass | Fail | Status |
|-------|-------|------|------|--------|
| `audit-logger.test.js` | 4 | 4 | 0 | ✅ Green |
| `auth-middleware.test.js` | 5 | 5 | 0 | ✅ Green |
| `evidence-ai-fraud.test.js` | 5 | 5 | 0 | ✅ Fixed in Slice 7C.1 (was 1 pass + crash) |
| `evidence-api.test.js` | 1 | 1 | 0 | ✅ Green |
| `evidence-validation.test.js` | 6 | 6 | 0 | ✅ Green |
| `trust-fact-workflow.test.js` | 15 | 15 | 0 | ✅ Green |
| `verification-session-workflow.test.js` | 18 | 18 | 0 | ✅ Green (Phase 7B) |
| `auth-login.test.js` | 8 | 8 | 0 | ✅ Green (Phase 7B) |

### evidence-ai-fraud.test.js — failure analysis

**Symptom:** `ERR_TEST_FAILURE: Unable to deserialize cloned data due to invalid or unsupported version` — uncaughtException at the file level; 1 test passes before the crash.

**Root cause:** Test 5 ("Duplicate photo checksum check") contains `const { runAiAnalysis } = await import('../services/evidence/evidenceService.js')` inside the test body. Node 20 test runner uses worker threads with structured clone for IPC; a dynamic `import()` inside a running test body can trigger this serialization failure when the imported module has top-level side effects (Supabase client, storage singletons). This is a known Node 20.x test runner limitation.

**Classification:** Pre-existing defect, present on `main` before Phase 7B. Not introduced by this branch.

**Resolution (Slice 7C.1):** Hoisted the `runAiAnalysis` import out of the test body to module scope, alongside the existing top-level imports. No fraud/evidence assertions changed. Suite is now 5/5 green.

Any new test failure introduced by Phase 7C commits is a blocker.

---

## 7. Identified Gaps for Phase 7C Workstreams

### Workstream B — Mobile UI polish

- Dashboard welcome block uses `className` (NativeWind now active, renders correctly, but consistency audit needed).
- Screens not yet converted to inline styles: `document-select`, `capture-front`, `capture-back`, `selfie`, `result` — each needs audit.
- No retry CTA for camera failure, upload failure, or CSRF failure on any capture screen.
- Liveness screen is timer-driven simulation; no real camera challenge.

### Workstream C — Real liveness detection

- `liveness.tsx` auto-completes after 3 s; sets `AsyncStorage` key `livenessVerified = 'true'` but this is not sent to or checked by the backend.
- `verification_sessions` has no `liveness_status` column.
- Backend `submitVerificationSession` does not read or enforce liveness state.
- No liveness SDK integrated (FaceTec, AWS Rekognition, or similar).

### Workstream D — Admin / manual-review dashboard

**Backend implemented in Slice 7C.2:**
- `GET /api/admin/identity/verification-sessions?status=` — admin list (filterable by reviewable status).
- `GET /api/admin/identity/verification-sessions/:sessionId` — admin detail.
- `POST /api/admin/identity/verification-sessions/:sessionId/review` — actions: `approve`, `reject`, `request_retry`, `add_review_notes`.
- All three routes guarded by `authorizeRole(['admin'])`; the service re-checks the admin role defensively. Every action writes a `trust_audit_events` entry. Responses are projected through `sanitizeReviewSession`, which omits all `*_storage_path` fields — no private document path or URL leaks.
- Migration `20260613020000_verification_admin_review.sql` adds `review_decision`, `retry_reason`, `liveness_status` (forward-compat only, never set to verified), extends the status CHECK to allow `retry_requested`, and indexes `reviewed_by`. `reviewed_by`/`reviewed_at` already existed and are now written.

**Still pending (Workstream D web layer):**
- No `/admin/verification` web page; `EvidenceReview.tsx` is the closest reusable template.

### Workstream F — Production auth / security hardening

- Existing `users` rows without `password_hash` can still log in from dev/test mode. A password migration or forced-reset flow is needed for production.
- No password reset / forgot-password endpoint.
- Session expiry enforcement: `expires_at` is stored as TEXT (legacy), never compared by `authorizeRole()`.

### Workstream G — Verification → trust integration

- `submitVerificationSession` sets `status = 'verified'` but writes no trust fact and emits no event.
- Existing `trust-fact-workflow` pattern and `eventBus` listeners are the correct integration point.
- `passport_verified` trust fact already exists in the system; connecting `verification_sessions.status = 'verified'` to it is the Phase 7C integration target.

---

## 8. Phase 7C Implementation Order (recommended)

1. **Fix `evidence-ai-fraud.test.js`** — hoist dynamic import; unblocks clean baseline (small).
2. **Admin review routes** — `GET` list + `PATCH` review action; add migration for `review_decision`/`retry_reason`.
3. **Web admin page** (`/admin/verification`) — clone `EvidenceReview.tsx` pattern.
4. **Mobile UI polish** — audit and convert remaining `className`-only screens; add retry paths.
5. **Mobile status refresh** — poll or manual refresh on result screen for `pending_manual_review`.
6. **Trust integration** — emit `passport_verified` trust fact on backend approval.
7. **Real liveness** — deferred; requires SDK selection and mobile camera integration.

---

## 9. Physical iPhone Smoke Plan (Phase 7C)

Before any Phase 7C PR merge:

1. Start ngrok: `ngrok http 3000`
2. Set `EXPO_PUBLIC_API_URL=https://<ngrok-subdomain>.ngrok-free.app` in `mobile/.env`
3. Start Metro: `cd mobile && npx expo start --clear`
4. Open Expo Go on iPhone, scan QR.
5. Login with a test account that has `password_hash` set.
6. Tap "Start Verification Flow" from dashboard.
7. Complete doc select → front capture → back capture → selfie → liveness (simulated) → review → submit.
8. Confirm result screen shows truthful status (verified / pending_manual_review).
9. If pending: log in to web admin `/admin/verification`, locate session, approve.
10. Return to mobile, refresh result screen, confirm status updates to verified.
11. Confirm wrong password → 401; missing CSRF → 403 with honest error.
