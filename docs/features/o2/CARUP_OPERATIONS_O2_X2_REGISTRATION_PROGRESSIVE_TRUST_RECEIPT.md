# O2-X2 — Registration + Progressive Trust: Certification Receipt

- **Branch:** `feat/operations-o2-people-compliance`
- **Starting head:** `4455814a` (X1 docs) · **Date:** 2026-09-03
- **Scope executed:** X2 ONLY. X3–X7 not started; **P7 remains BLOCKED / NOT EXECUTED**; P1/P1-C and the X1 retirement untouched and re-proven green.
- **Law enforced:**

> **Registration data may be autofilled by AI/OCR, but nothing becomes verified merely because
> OCR extracted it.** · **Time to Safe Action is the primary speed objective.**

## 1. The registration journey, as shipped

```
create account (existing 3-step signup — context collected, role always 'owner')
  → /onboarding (web/src/pages/onboarding/RegistrationJourney.tsx — server truth each load)
  → complete/edit context            PUT  /api/registration/profile
  → start identity                   POST /api/identity/verification-sessions        (7C, reused)
  → upload front/back/selfie         POST …/upload/:side                             (7C, reused)
  → submit                           POST …/submit → classification → OCR → NEVER auto-verify
  → candidates presented             GET  /api/registration/profile/candidates
  → user confirms/corrects           PUT  /api/registration/profile (+ candidates_seen)
  → governed human decision          existing 7C review (approve/resubmit/reject/escalate)
  → capabilities progressively unlock (derived ladder — advisory, zero-write)
```

**New code:** `backend/services/registration/registrationJourneyService.js` ·
`backend/routes/registrationOnboardingRoutes.js` (3 self-scoped endpoints) · the `/onboarding`
page + route + a "finish setting up" link on the Register success panel · six typed functions in
`useCarUpApi`. **DDL delta: NONE** — `user_registration_profiles` remains the single confirmed
store; names/DOB/ID numbers stay 7C evidence and are not duplicated into the profile.

## 2. Capability ladder (derived; unlocks by stage)

| Stage | Reached when | Unlocks |
|---|---|---|
| `basic_account` | always (signup) | browse marketplace · save vehicles · create safe drafts · start registration profile · upload identity documents |
| `contact_context_established` | profile row exists | continue draft workflows · prepare Seller onboarding · (+ prepare Dealer onboarding when business) |
| `identity_pending` | active 7C session | continue safe preparation work |
| `identity_approved` | session `resolved_approved` | consume identity assurance · proceed to identity-gated workflows |

Locked list always names the owning authority: `sell_vehicle_publicly` → Seller Authority ·
`dealer_tools` → Dealer Compliance · `vehicle_registration_truth` → vehicle lifecycle ·
`vehicle_trust` → canonical Trust · `privileged_staff_administration` → platform governance ·
(until approved) `present_as_identity_verified` + `sensitive_financial_actions` → identity
decision. **Identity approval unlocks none of the domain authorities — proven by test and by the
zero-write pin on the journey read.**

## 3. Candidate / confirmed field semantics (pinned)

States: `machine_candidate · user_confirmed · user_corrected · user_provided · missing`.
Markers (`N/A`, `Unknown`, `-`, …) and absences render as `missing` with **no value key**, cannot
be presented, and are **refused** as profile content at the write boundary. Confirmed-vs-corrected
is derived by the SERVER comparing the submitted value against the exact candidate shown
(`candidates_seen`); client labels are never trusted. Provenance lives in the audit event
(`REGISTRATION_PROFILE_SUBMITTED/UPDATED`, fail-closed) + 7C's `verification_ocr_provenance` —
never as profile columns. Update preservation: original terms/privacy acknowledgement instants
survive; a reviewed business `onboarding_status` never regresses to `requested`.

## 4. Security boundaries (held, with the guard for each)

- Authenticated-user attribution — extraction REFUSES to run without a user id outside the test
  suite, at BOTH call sites (`extractDocumentData`, `aiServiceBus.runOcrParsing`); `/api/ai/ocr`
  passes the proven session id; the 7C submit attribution is source-pinned.
- Self-scoping — every X2 endpoint derives its subject from `req.userContext`; cross-user reads
  proven refused.
- No client-supplied authority — the ladder is advisory; the journey read performs ZERO writes
  (pinned); `allowed`-style behavior derives server-side.
- No OCR-created verification — 7C's NEVER-auto-verify stands (suite green).
- No profile→Seller Authority, no Trust/vehicle/dealer mutation — registration files import no
  domain authority writers and reach no authority tables (source pins).
- Private evidence — the page consumes only the sanitized session; storage paths/preview URLs
  never enter the registration surface.

## 5. Time to Safe Action (measurement points shipped in the journey payload)

`account_created_at` = `safe_capabilities_available_at` (safe capability is immediate — the KPI
start and its first satisfaction coincide at signup) · `context_established_at` ·
`identity_submitted_at` · `identity_extraction_completed_at` · `identity_decided_at`.

## 6. Low-bandwidth behaviour

Per-side uploads retry in place (a failed side loses nothing else); upload state visible per
side; refresh/relogin resumes from server truth (proven over HTTP); confirmed context re-renders
as a summary (no forced re-entry); OCR failure routes to human review and never blocks manual
completion; evidence quality untouched (15MB limit unchanged).

## 7. Gates (all at the X2 tree; CI-equivalent env)

| Gate | Result |
|---|---|
| New backend X2 suites (`o2-x2-registration-journey`, `o2-x2-registration-routes`) | **22/22** |
| New web page suite (`RegistrationJourney.test.tsx`) | **7/7** |
| Targeted regression (X2 + X1 guards + 7C ×6 + registration-profile + dealer ×2 + diaspora-ocr + hardening + phase-3 + v16) | **231/231** |
| P1-C / O2 core / seller / registration-lifecycle batch (former-seller 11/11 among them) | **67/67** |
| **Full backend suite** | **5817 / 0 fail / 21 skipped** (X1 baseline 5795 + exactly the 22 new tests) |
| **Full web suite** (final tree, uncontended) | **1568 / 1568** (baseline 1561 + exactly the 7 new tests) |
| `tsc --noEmit` (web) | clean |
| Lint regression gate vs branch origin | **NET_NEW_ERRORS=0 / NET_NEW_WARNINGS=0** |
| Migration integrity | no migrations added — unchanged |

Honesty notes: one interim full-web run recorded 1 failure and a diagnostic rerun 6 — all in
files untouched by X2 (SellFlow.identification, GovernmentDashboard, PartsTracking,
VehicleProfile.passport-v15), all passing in isolation (31/31) and in the final uncontended run;
cause was two full suites sharing one machine. Gates NOT run, and why: the staging UAT workflows
(exact-head pairing deliberately absent while #194 is unmerged — the standing P7 blocker), and
GitHub-hosted workflows without `workflow_dispatch` (every step reproduced locally above).

## 8. R1/R2 and residuals

`POST /api/vehicles/:vin/evidence-sets` and the extractions route were **explicitly avoided** —
X2 touches no vehicle routes; both remain open register entries for their own hardening lane.
Remaining for X3/X4/X5: lifecycle states + step-up auth (X3); biometric consent + provider
provenance through the same 7C evidence path (X4); Dealer KYB onboarding picking up
`account_kind='business'` routing (X5). The legacy fallback defaults inside `ocr_*` structured
evidence tables stay recorded hazards for any future consumer (X2 reads none of them).

## Stop condition

X2 is implemented, advisory-autofill is user-confirmed, the Registration Profile is the
confirmed store, Phase 7C remains the identity authority, Progressive Trust behavior is proven,
suites are green, and this receipt closes the phase. **X3 was not begun.**
