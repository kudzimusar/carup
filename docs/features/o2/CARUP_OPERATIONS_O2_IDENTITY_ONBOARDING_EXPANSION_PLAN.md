# O2 — Identity/Onboarding Expansion: Canonical Plan

- **Branch:** `feat/operations-o2-people-compliance` (authored at head `90c50cc0`; P1-C certified parent `e9326f76`)
- **Date:** 2026-09-03
- **Status:** DESIGN (X0) — documentation only; **no product code, no migrations, no staging actions in this phase**
- **Relationship to core O2:** governed **extension** of the completed core (P0–P6 + P1-C), never a restart
- **Canonical home:** `docs/features/o2/` — there is deliberately **no** second O2 documentation hierarchy (`docs/o2/…` must not be created)
- **Governing ADR:** `docs/architecture/CARUP_OPERATIONS_CONTROL_PLANE_M8_REUSABLE_OPERATIONS_PATTERN_ADR.md`
- **Governing law:** OPERATIONS ORCHESTRATES. DOMAIN SERVICES OWN TRUTH.

> **O2 Core Operations P0–P6 + P1-C are implemented/certified. P7 staging certification remains
> blocked. The Identity/Onboarding Expansion is a new governed extension of that existing O2
> foundation, not a restart of O2.**

## Product Owner mandate

> CarUp must make legitimate action fast, fraudulent action difficult, authoritative truth
> distinguishable from claims, and every material decision explainable after the fact.

Canonical principles, binding on every expansion phase:

> **Security protects Trust. Truth earns Trust. Trust permits Speed. Speed must never manufacture
> Truth.**

> **Identity verified ≠ Dealer compliant ≠ Seller authorised ≠ Vehicle registered ≠ Vehicle
> trusted.**

And the expansion-specific corollary that X1 exists to enforce:

> **Machine/user input must never manufacture authoritative Trust.**

The expansion arc:

> Recover/reconcile remaining onboarding capabilities → strengthen identity/security → connect
> registration and Dealer onboarding → reuse bulk migration → add genuine biometrics only through
> governed evidence → improve Communications and intelligence → preserve all existing domain
> authorities.

## Foundation this plan builds on (X0 reconciliation, 2026-09-03)

Full evidence in `CARUP_OPERATIONS_O2_DISCOVERY_AND_OWNERSHIP.md` §5. Summary:

| Fact | Verified value |
|---|---|
| O2 branch head | `90c50cc0` (local == origin; tracked tree clean) |
| P1-C certified candidate | `e9326f76` — 4 real workflow runs green; backend 5789/0; web 1561/1561 |
| Convergence authority | PR #194 `integration/vehicle-passport-v16-cert` @ `33720d79`, OPEN (draft), unmerged; it is an ancestor of the O2 head |
| Core state | P0–P6 + P1-C complete with evidence; **P7 BLOCKED / NOT EXECUTED** (tracker P7 note governs) |
| O2 PR | none exists (by design: stop at a certified candidate for Product Owner review) |

## What the expansion is NOT

- **Not a restart.** P0–P7 keep their numbering, meaning and evidence. Completed phases are not
  reopened; expansion phases use the `X` namespace.
- **Not P7.** Staging certification stays blocked until the documented #194/staging-pairing
  conditions are resolved and the Product Owner is aware of the synthetic-identity-document
  requirement. Nothing in X0–X7 may run it early.
- **Not a Communications implementation.** O2 keeps the certified emit-only contract; delivery,
  providers and templates belong to the Communications lane
  (`docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`).
- **Not a Service Network change.** Service Network Foundation is its own lane (PR #197); its
  services are not even present on this branch.
- **Not a transfer-authority redesign.** P1/P1-C behaviour is certified
  (`CARUP_OPERATIONS_O2_TRANSFER_AUTHORITY_LIFECYCLE.md`); it is reopened only on a proven
  regression, never for convenience.
- **Not a People takeover of vehicle registration.** Zimbabwe registration remains a
  Vehicle/Passport state (see §G).
- **Not a second bulk importer.** Dealer bulk onboarding reuses the certified diaspora workbook
  engine (see §H).
- **Not biometrics by assertion.** Nothing may be labelled biometric verification until a genuine,
  provider-provenanced capability exists (see X4). **No central raw fingerprint store, by default
  or otherwise, without a separately justified and approved design.**
- **Not a new profile store inside verification.** `verification_sessions` stores evidence and
  assessment provenance; confirmed account/profile data lives in the Registration Profile (§F).

## Source map and dispositions

Architecture is **not** rediscovered from scratch. The following map is verified at head
`90c50cc0`; every path was existence-checked.

### A. Identity Verification (Phase 7C stack) — ADOPT / EXTEND

The canonical person-identity lane. All expansion identity work goes through it.

| Piece | Anchor |
|---|---|
| Sessions + review lifecycle | `backend/services/identity/verificationSessionService.js` |
| Evidence classification | `backend/services/identity/documentClassifier.js` |
| Decision policy / recording / reasons | `backend/services/identity/decisionPolicy.js` · `decisionRecorder.js` · `reasonCodes.js` |
| Case phases + responsibility projection | `backend/services/identity/caseWorkflow.js` |
| Binding + evidence validation | `backend/services/identity/identityBinding.js` · `evidenceValidation.js` |
| User routes | `backend/routes/identityVerificationRoutes.js` (`/api/identity/…`) |
| Admin routes | `backend/routes/identityVerificationAdminRoutes.js` (`/api/admin/identity/…`) |
| Shared contract | `shared/types/verificationStatus.ts` |
| Active admin surface | `web/src/pages/dashboard/admin/IdentityVerificationCaseManagement.tsx` at **`/admin/verification`** |

Proof surface that must stay green through every expansion phase:
`backend/tests/verification-session-workflow.test.js`, `verification-admin-list.test.js`,
`verification-admin-review.test.js`, `verification-decision-policy.test.js`,
`verification-ocr-provenance.test.js`, `verification-terminal-and-consistency.test.js`,
`web/src/pages/dashboard/admin/IdentityVerificationCaseManagement.test.tsx`,
`web/src/pages/dashboard/admin/verificationRoute.test.ts`.

### B. Legacy identity UI — QUARANTINE

`web/src/pages/dashboard/admin/VerificationReview.tsx` is confirmed **unrouted legacy** (route
analysis: no import in `web/src/App.tsx` routes). Disposition: **QUARANTINE — candidate for future
retirement after dependency/test confirmation.** No expansion functionality may be added to it.

### C. The second verification lane — DOCUMENTED OVERLAP (X1 decides)

Two verification-related stacks currently coexist and the expansion refuses to pretend otherwise:

1. **Canonical person-identity lane** — `/api/identity` + `/api/admin/identity` (Phase 7C stack, §A).
2. **Document Intelligence lane** — `backend/services/document-intelligence/documentIntelligenceRouter.js`
   + `documentIntelligenceService.js`, mounted at **`/api/verification`**
   (`backend/server.js:357`, behind `authorizeSessionRole(['admin','government'])`).

Neither lane is silently merged and neither is retired **in this documentation task**. The overlap
is resolved by **O2-X1** (below) with evidence and an explicit Product-Owner-approved disposition.

### D. Dealer Compliance — ADOPT (existing authority, not a new system)

`backend/services/dealer/dealerComplianceService.js` · `backend/routes/dealerRoutes.js` ·
`web/src/pages/dashboard/admin/DealerCompliance.tsx` ·
`database/migrations/20260626150000_dealer_compliance.sql` ·
tests `backend/tests/dealer-compliance.test.js`, `dealer-routes.test.js`.

Expansion direction: company-document OCR may populate **candidate fields/evidence** only. OCR (or
any machine output) must **never** directly set: dealer identity verified · compliance passed ·
`active` · unrestricted · unsuspended · publishable. Those remain governed Dealer Compliance
outcomes recorded through `recordDecision` with actor, reason and audit.

### E. Seller Authority — ADOPT (consume the certified authority; do not reopen)

`backend/services/seller/sellerAuthorityService.js` ·
`database/migrations/20260902160000_vehicle_seller_authority.sql` ·
`database/migrations/20260903120000_ownership_transfer_retires_tenant_relationship.sql` ·
tests `backend/tests/operations-seller-authority.test.js`,
`seller-existing-passport-authority.test.js`, `non-seller-authority-hardening.test.js`, plus the
P1/P1-C proof suites recorded in the tracker.

Invariants every expansion phase preserves verbatim:

> Identity approval does not automatically grant Seller Authority.

> Historical ownership evidence is not an immortal permission token.

> Completed transfer away takes precedence over stale seller evidence or stale relationships.

P1/P1-C is reopened only on a **proven regression** introduced by expansion work — never
preemptively, never for convenience.

### F. Registration Profile — ADOPT / EXTEND (where onboarding data belongs)

`backend/services/auth/registrationProfileService.js` ·
`database/migrations/20260829123000_user_registration_profiles.sql` ·
test `backend/tests/auth-registration-profile.test.js`.

Target onboarding flow (X2 design):

```
document upload
  → OCR extraction candidate            (machine output, marked as candidate, provenance kept)
  → user confirmation/correction        (the user asserts their own profile facts)
  → registration profile                (confirmed account/profile information)
```

Separation of stores is a hard rule: **verification stores evidence/assessment provenance;
Registration Profile stores confirmed account/profile information.** `verification_sessions` must
not become a duplicate permanent user-profile store, and a confirmed profile value is
self-asserted data — it earns nothing authoritative by itself.

### G. Vehicle registration — CONSUME ONLY (outside People authority)

`backend/services/registration/zimbabweRegistrationLifecycle.js` ·
`database/migrations/20260902110000_zimbabwe_registration_lifecycle_and_evidence.sql` ·
test `backend/tests/zimbabwe-registration-lifecycle.test.js`.

O2 may display or consume vehicle registration state; O2 must not own it.

> **Zimbabwe registration pending is a Vehicle/Passport state, not a Person Identity or Seller
> Compliance state.**

### H. Workbook engine — REUSE (no second Dealer CSV importer)

The certified diaspora workbook pipeline is the bulk-migration engine for Dealer onboarding:

`backend/services/diaspora/diasporaWorkbookImportPlanningService.js` ·
`diasporaWorkbookReviewService.js` · `diasporaWorkbookImportExecutionService.js` ·
`diasporaWorkbookImportAuditService.js` · `diasporaWorkbookPersistenceService.js` ·
`diasporaWorkbookValidationService.js` ·
`backend/services/diaspora/workbook/diasporaWorkbookConfirmationService.js` ·
`diasporaWorkbookConfirmedImportService.js` · `diasporaWorkbookUploadSecurity.js` ·
`diasporaWorkbookXlsxService.js` · routes `backend/routes/diasporaWorkbookRoutes.js` ·
`diasporaWorkbookXlsxRoutes.js`.

X5 adds **AI semantic schema mapping BEFORE the existing planning/review/confirmation pipeline** —
e.g. `Reg_No → registration_number`, `Registration → registration_number`, `Cust Tel → phone`,
`Stock # → inventory_reference`. The mapping is **advisory**: a human confirms the mapping before
any import runs, the confirmed mapping is recorded, and the existing safeguards that **refuse
imported VERIFIED/APPROVED compliance outcomes** are preserved unchanged. Bulk data enters as
claims/evidence, never as decisions.

### I. Communications — PROTECTED DEPENDENCY (emit-only stands)

Canonical plan: `docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`; implementation
area `backend/services/communication/`. O2's certified contract is emit-only (`emitDomainEvent`);
delivery is owned by Communications and is not changed by any expansion phase.

The expansion may **specify** semantic O2 events for the Communications lane to deliver:

`identity evidence received` · `extraction completed` · `missing evidence` ·
`user confirmation required` · `reviewer action required` · `resubmission requested` ·
`identity approved/rejected` · `compliance document expiring` · `reverification required`.

Any change to delivery/provider code belongs to the Communications lane, not to O2.

### J. Service Network — PROTECTED / SEPARATE LANE (reference only)

Service Network Foundation lives on PR #197 (`feat/service-network-foundation-1-0`); its services
(`backend/services/serviceNetwork/serviceAuthority.js`, `garageDirectoryService.js`,
`serviceCaseService.js`, `workOrderAssignmentService.js`) and its receipts
(`docs/service-network-foundation/receipts/`) are **not present on this branch** — verified by
existence check. Nothing here modifies that lane.

Future contract the expansion may define (design only, X6; reconciliation NOT implemented now):
O2 establishes **mechanic identity, garage business identity, and mechanic ↔ garage relationship
validity**; Service Network continues to determine **what that actor may do within a service
case**.

## O2-X1 — Document Intelligence Authority Reconciliation

The first expansion workstream, and a precondition for any OCR or AI-assisted onboarding
expansion. It exists because `POST /api/verification/promote-trust` can pass a trust level from
request data into `TrustService.assignTrustLevel` without the O2/7C governed decision model being
visibly involved — in direct tension with **Machine/user input must never manufacture
authoritative Trust.**

### Evidence already in hand (X0, read-only survey at head `90c50cc0`)

- The lane is **mounted and live**: `app.use('/api/verification', authorizeSessionRole(['admin','government']), documentIntelligenceRouter)` — `backend/server.js:357`.
- Endpoints: `POST /ocr`, `POST /ocr/:id/approve`, `POST /fraud-scan`, `GET /trust-score/:userId`,
  `POST /promote-trust`.
- `POST /promote-trust` takes `userId` + `trustLevel` from the request body and calls
  `TrustService.assignTrustLevel` (`backend/services/trust-service/trustService.js`), which
  upserts `kyc_profiles.overall_status = 'Level_<n>_<Name>'` against a six-tier vocabulary
  (Anonymous → Phone Verified → ID Verified → Biometric Verified → Vehicle Verified → Dealer
  Certified) and logs a `security_events` row. No reason codes, no reviewer attribution model, no
  governed decision record.
- **Callers found:** `TrustService.assignTrustLevel` has exactly one caller in the repository —
  the `/promote-trust` route itself. No web code calls any `/api/verification/*` endpoint. No
  repository code reads `kyc_profiles.overall_status`. The tier appears to be **written but never
  consumed**.
- The **service** (as opposed to the router) has one live consumer:
  `DocumentIntelligenceService.extractDocumentData` is used by `backend/routes/diasporaRoutes.js:260`
  for workbook OCR. The extraction capability and the trust-promotion endpoint are separable.
- Dangling frontend calls exist to `/ai/ocr` and `/ai/fraud-scan` (`web/src/hooks/useCarUpApi.ts`)
  with **no `/api/ai` mount found** in `backend/server.js` or `backend/routes/` — X1 step 1 must
  confirm whether these paths are served anywhere or are dead client code.

### X1 protocol (all steps complete before any disposition is executed)

1. identify every caller of `/api/verification/promote-trust`;
2. identify every caller of `TrustService.assignTrustLevel`;
3. identify what trust object/person state it actually changes;
4. identify whether the state is still consumed anywhere authoritative;
5. trace audit/reason/reviewer requirements;
6. compare it with: Phase 7C Identity Verification · current canonical Vehicle Trust one-writer
   rules · Dealer Compliance · Seller Authority;
7. produce one explicit disposition: **ADAPT · RETIRE · QUARANTINE · MOVE BEHIND GOVERNED
   DECISION**.

### Proposed disposition (X0 proposal — requires X1 completion + Product Owner approval)

**RETIRE** the mounted `/api/verification` router surface — specifically `POST /promote-trust`,
the `TrustService.assignTrustLevel` tier-write path, and the other unconsumed router endpoints —
on the X0 evidence that the lane has no frontend consumers, a single self-contained caller, and
writes person-trust state nothing reads; **QUARANTINE it in the interim** (documented here; no new
callers may be added). `DocumentIntelligenceService.extractDocumentData` is **kept** as an
internal extraction utility consumed by governed lanes (diaspora workbook today; X2 candidate
extraction tomorrow) — extraction produces candidates and provenance, never trust. If X1 steps 1–6
surface a genuine consumer, the fallback disposition is **MOVE BEHIND GOVERNED DECISION** (a
capability-gated, reasoned, audited decision path in the owning domain). **No code is deleted in
this documentation task**; the decision is executed only inside X1 after Product Owner approval.

### X1 executed (2026-09-03) — protocol answers, X0 corrections, final dispositions

The Product Owner approved X1; the seven steps completed and the disposition was EXECUTED on the
O2 branch. Full evidence: `CARUP_OPERATIONS_O2_X1_DOCUMENT_INTELLIGENCE_AUTHORITY_RECEIPT.md`.

**Protocol answers (steps 1–6).** `/promote-trust` had no caller anywhere; `assignTrustLevel`'s
only caller was that route. The state it changed — the six-tier `kyc_profiles.overall_status`,
plus `security_events` (`TRUST_LEVEL_UPGRADE`) and USER-typed `trust_score_history` rows — had
exactly one reader: `calculateUserTrustScore`, itself reachable only through the same lane
(`GET /trust-score/:userId`), so the tier loop was closed entirely inside the surface being
retired. **X0 correction:** X0 said "nothing reads `kyc_profiles.overall_status`"; precisely, its
one reader lived inside the retired lane itself. No reason-code, reviewer-attribution or governed
decision machinery existed on any of these paths. Against the governed models the lane violated
all four: 7C identity decisions (reasoned, recorded, self-review-guarded), canonical Vehicle
Trust (one stamped writer), Dealer Compliance (domain statuses + decisions), Seller Authority
(basis + audit).

**Scope beyond `/promote-trust` (as directed).** Re-reading the live source confirmed the more
serious path: `POST /ocr/:id/approve` → `approveDocumentVerification`, which wrote
`cvr_ownership_records` / `zimra_declarations` rows carrying SYNTHESIZED fallback identifiers
(generated `REG_`/`LB_`/`CUS_` references, a hard-coded default National ID, default duty 50000,
fixed exchange rate 13.5), an `administrative_overrides` row with fabricated ip/user-agent,
`ocr_documents.status='Verified'`, a +20 `vehicles.trust_score` bump and `status='Available'`.
Those registry rows are consumed as FACTS by the canonical trust resolver — machine approval was
manufacturing the very facts canonical Trust then trusted.

**The `/ai` lane, resolved (X0 correction).** The frontend's `/ai/ocr` + `/ai/fraud-scan` calls
are NOT dead: they are served inline in `backend/server.js` (`/api/ai/ocr`, `/api/ai/fraud-scan`,
`/api/ai/risk-assessment`, behind `authorizeRole()`) via `aiServiceBus`, whose writes are
observation-only (`ai_inference_logs`, `ai_fraud_scans`, candidate `ocr_documents`). No product
component invokes the web hook methods (OwnerDashboard's truthfulness test pins non-use). KEPT
as-is; residuals recorded for X2: `runOcrParsing` defaults attribution to `'u1'` when no user id
is passed, and extraction's structured candidate rows carry fallback defaults (sex `'M'`, DOB
today, year 2020, plate ← national-id field) — X2 consumption rules must treat every `ocr_*` row
as an UNCONFIRMED candidate and never auto-trust a defaulted field.

**Final dispositions (executed):**

| Component | Disposition |
|---|---|
| `extractDocumentData` + `analyzeImageQuality` + test-gated mock | **KEEP** — extraction/observation; the diaspora consumer stays proven live |
| `approveDocumentVerification` (registry/override/vehicle/trust writes, synthesized identifiers) | **RETIRED** — deleted with its endpoint |
| `documentIntelligenceRouter` + `/api/verification` mount + all five endpoints + its path-scoped rate-limit line | **RETIRED** — deleted/unmounted; no `/api/verification` surface remains |
| `TrustService` (six-tier person trust: `assignTrustLevel`, `calculateUserTrustScore`) | **RETIRED** — deleted; the tier vocabulary is NOT migrated into O2 |
| `FraudService` (device-heuristic scanner, `'system_user'` provenance) | **RETIRED** — deleted; the governed fraud lane (`services/fraud/*`) is untouched |
| `TrustEnforcementEngine` | **UNCHANGED** — other consumers; its two trust-penalty sites remain the register's reduced-scope OPEN entry |
| `/api/ai/*` + `aiServiceBus` | **DOCUMENTED / KEEP** — observation-only; X2 residuals recorded above |
| Historical `kyc_profiles` / `trust_score_history` / `security_events` rows | **PRESERVED** — no data deleted |
| `cvr_ownership_records` / `zimra_declarations` | now **zero in-product writers**; reads (fact resolver) unchanged — pinned by test |

**Guards added:** `backend/tests/o2-x1-document-intelligence-authority.test.js` (6 permanent
boundary guards); the §11 retirement test in `issue164-phase3-trust-authority.test.js`; the B7
trust-writer SET pin in `v16-authority-hardening.test.js` shrank from three writers to two; the
`non-seller-authority-hardening.test.js` section-2 pins now assert the surface is absent rather
than gated; legacy `run-tests.js` Test 28 asserts the retirement instead of the approval chain.

## O2-X2 — Registration + Progressive Trust: EXECUTED (2026-09-03)

Receipt: `CARUP_OPERATIONS_O2_X2_REGISTRATION_PROGRESSIVE_TRUST_RECEIPT.md`. The design sections
below ("Progressive Trust", "Identity lifecycle", …) remain the forward map; this section records
what X2 actually shipped.

**The registration journey, as implemented:**

```
create account (existing 3-step signup, context collected, role always 'owner')
  → /onboarding — the journey page (server truth on every load: refresh/relogin resumes)
  → complete/edit context            PUT  /api/registration/profile
  → start identity                   POST /api/identity/verification-sessions        (7C, reused)
  → upload front/back/selfie         POST …/upload/:side                             (7C, reused)
  → submit                           POST …/submit → classification → OCR → NEVER auto-verify
  → candidates presented             GET  /api/registration/profile/candidates
  → user confirms/corrects → profile PUT  /api/registration/profile (+ candidates_seen)
  → governed human decision          existing 7C review (approve/resubmit/reject/escalate)
  → capabilities progressively unlock (derived ladder, advisory)
```

**New surface (all self-scoped to the proven caller):** `GET /api/registration/journey` ·
`GET /api/registration/profile/candidates` · `PUT /api/registration/profile`
(`backend/routes/registrationOnboardingRoutes.js` +
`backend/services/registration/registrationJourneyService.js`), and the web page
`web/src/pages/onboarding/RegistrationJourney.tsx` at `/onboarding`. **DDL delta: NONE** —
`user_registration_profiles` remains the one confirmed-context store; names/DOB/ID numbers stay
identity EVIDENCE (7C) and are deliberately not duplicated into the profile.

**Field truth model (enforced server-side, pinned by tests):** every candidate carries
`machine_candidate | user_confirmed | user_corrected | user_provided | missing`. Fallback markers
(`N/A`, `Unknown`, …) present as `missing` with no value at all and are REFUSED as profile
content; an absent field stays absent. Confirmed-vs-corrected is derived by the SERVER comparing
the submitted value to the exact candidate the user was shown (`candidates_seen`) — client labels
are never trusted. Provenance lives in the audit event and the 7C provenance tables, never as
profile columns. The 7C invariant stands: the account profile is never mutated from OCR — a
document value reaches the profile only through explicit user confirmation, and account `name`
is not autofillable at all (it is the identity-binding comparator).

**X2 entry residuals CLOSED:** (A) extraction now REFUSES to run without a user id outside the
test suite — guarded at both call sites (`extractDocumentData`, `aiServiceBus.runOcrParsing`) and
`/api/ai/ocr` now passes the proven session identity; the 7C submit path already attributed to
the session owner (source-pinned). (B) candidate-marker filtering + the profile write-boundary
refusal mean no fallback/default value can silently populate the Registration Profile; the
legacy defaults inside the `ocr_*` structured evidence tables remain recorded X-hazards for any
future consumer of those tables (none of X2 reads them — candidates come from the session's
sanitized `ocr_result`).

**Progressive Trust, as shipped:** the ladder + locked-capability list are a DERIVED, advisory
projection (`deriveOnboardingJourney`) — the journey read performs zero writes (pinned) and
grants nothing; authorization stays with each domain gate. Identity approval reaches the
identity stage and still reports Seller Authority, Dealer Compliance, vehicle registration and
Vehicle Trust as locked by their own authorities, with the reasons on screen.
`who_must_act` / `next_actor` / `required_action` are derived at read time from the 7C phase +
reason-code applicant guidance (the dormant session columns stay dormant — P2's
derived-not-stored law).

**Time to Safe Action measurement points (shipped in the journey payload):**
`account_created_at` = `safe_capabilities_available_at` (safe capability is immediate) ·
`context_established_at` · `identity_submitted_at` · `identity_extraction_completed_at` ·
`identity_decided_at`.

**Low-bandwidth behaviour:** per-side uploads are individually retryable in place (a failed side
never loses the session or the other sides); upload state is visible per side; the journey is
re-fetched server truth so refresh/relogin resumes; confirmed profile data is preserved and
re-rendered as a summary (no forced re-entry); an OCR failure routes to human review and NEVER
blocks manual profile completion. Evidence quality is untouched (15MB limit unchanged).

**R1/R2 explicitly avoided:** X2 touches neither `POST /api/vehicles/:vin/evidence-sets` nor the
extractions route; both remain open entries in the risk register for their own hardening lane.
Business signup collects routing context only — full Dealer KYB stays X5.

**Handed to X3/X4/X5:** lifecycle states and step-up auth (X3) now have a journey surface to
hang off; biometric consent + provider provenance (X4) slot into the same 7C evidence path;
Dealer onboarding (X5) picks up `account_kind='business'` routing from the profile.

## O2-X3 — Identity Lifecycle + Account Security: EXECUTED (2026-09-03)

Receipt: `CARUP_OPERATIONS_O2_X3_IDENTITY_LIFECYCLE_ACCOUNT_SECURITY_RECEIPT.md`. The two
questions are now answered separately and never collapsed: **proofing** ("who did CarUp
establish this person to be" — 7C, immutable) and **authentication** ("is the person at the
keyboard proven strongly enough for THIS action" — session assurance).

**Current lifecycle, layered over immutable history.** `identity_lifecycle_events` is an
append-only identity-domain ledger (DB-enforced: UPDATE/DELETE raise; monotonic `seq`); the
current state is the latest row, falling back to the historical approval when no row exists
(`verified`) and to `not_established` otherwise. Historical `resolved_approved` sessions are
never rewritten — proven byte-identical through transitions. States: `verified ·
reverification_required · suspended · compromised · disputed · revoked · recovered`, each
transition carrying subject, both states, reason code, trigger, actor (+kind/role), policy
version (`identity_lifecycle.v1`) and evidence reference. The transition table is total and
fail-closed by name; `verified`/`recovered` are minted ONLY by the governed 7C approval hook
(recorder → `onVerificationApproved`); the subject can never act on their own lifecycle;
**`revoked` accepts only the governed step back into `reverification_required` — an old
approval can never resurrect it** (the hook refuses, test-pinned).

**Triggers implemented:** document expiry as a DERIVED overlay (real, parseable expiry in the
approving evidence → effective `reverification_required`, reason `DOCUMENT_EXPIRED`; nothing
fabricated when the evidence carries none); suspected takeover / security events as governed
reviewer transitions (`SUSPECTED_ACCOUNT_TAKEOVER`, `SECURITY_REVIEW`); recovery classified —
a ROUTINE password reset stays an authentication event (all prior sessions revoked, identity
proofing untouched; the recovery router imports no lifecycle code, source-pinned), while
suspected takeover is the governed `compromised` path. **Material identity change:** the
reason code and policy exist, but no self-service profile/credential-change route exists in
the repository today — the trigger is designed and REFUSED-BY-ABSENCE rather than pretended;
any future account-edit route must call the lifecycle hook (recorded obligation).

**Authentication assurance (`authentication_assurance.v1`).** Sessions carry server-side
`auth_method` / `step_up_at` / `step_up_method` (additive migration; this table's existing
TEXT-timestamp convention kept). Strengths: `session < recent_reauth < strong_authenticator`.
Action classes: `ordinary_action` (proven session) · `sensitive_action` (recent re-proof,
15-min TTL) · `critical_authority_action` (5-min TTL). **Passkey/WebAuthn: NOT implemented and
not pretended** — `STRONG_AUTHENTICATOR_AVAILABLE=false` is a build-time fact; the method
allowlist contains only `password_reauth`, so no code path can record a strength that does not
exist, and the critical class's fall-back to fresh password re-proof is EXPLICIT policy
(`deferredStrongAuthenticator: true`, test-pinned). Assurance derives ONLY from the session
row the presented token resolves to — forged headers/bodies are proven inert. Device
biometrics via a future passkey are AUTHENTICATION, not identity-proofing biometrics (X4).

**One guard, mapped actions.** `requireAuthenticationAssurance(class)` composes after the
role/capability layers and substitutes for none of them (step-up proves the actor; the domain
still decides). Wired: ownership-transfer transition `PATCH /api/ownership-transfers/:id`
[CRITICAL] · seller-authority review · dealer compliance decision · identity evidence preview
· identity lifecycle transition · governed session revocations (self + operations)
[SENSITIVE]. Step-up itself: `POST /api/auth/step-up` (server-verified password on the
presenting session). An x-user-id-asserted identity is refused on every security surface.

**Session security.** Governed revocation over the existing `is_valid` contract — scopes one /
others / all; self-service `POST /api/auth/sessions/revoke-others` (keeps the presenting
session) and `GET /api/auth/sessions` (ids + display metadata, never token material);
operations revocation behind the new `operations.account.security` capability. **`compromised`
revokes every live session in the same governed action**, audited with session ids only.
Invalidated sessions are re-proven rejected by the unchanged authMiddleware.

**Dormant `next_actor`/`required_action`: derivation chosen** (the X2/P2 rule stands). The
lifecycle adds its own derived `who_must_act` projection; the dormant session columns stay
dormant, and no second source of truth was created.

**Progressive Trust integration.** The journey/ladder now respects the CURRENT lifecycle:
capability-bearing (`verified`/`recovered`) is required for identity-approved capability;
`reverification_required` keeps safe low-risk capability while identity-gated capability locks
with the applicant-safe reason; `suspended`/`compromised`/`disputed`/`revoked` fail closed with
CarUp as the visible actor. Only applicant-safe lifecycle fields reach the subject (state,
reason code, guidance, actor — never triggers, ledger ids or internal notes). The lifecycle
changes no domain authority: ownership history, Seller Authority, Dealer Compliance and
Vehicle Trust rows are untouched by every transition (their suites re-proven green).

**New capabilities (static map):** `operations.identity.lifecycle`,
`operations.account.security`. **Migrations (2, additive):**
`20260903200000_identity_lifecycle_events.sql`,
`20260903201000_user_sessions_authentication_assurance.sql`.

## Progressive Trust / capability unlocking (X2 design principle)

The expansion's speed principle: a legitimate user performs safe low-risk actions immediately;
risk-bearing capability unlocks as verified truth accumulates. The ladder:

```
basic account
  → email/phone
  → identity evidence
  → identity decision
  → business/role relationship
  → scoped authority
  → sensitive capability
```

**Unlocked early** (examples, before complete Dealer Compliance): create draft profile · upload
company documents · prepare workbook dry run · explore inventory tools.

**Locked until the appropriate trust/authority exists:** present as verified · sensitive financial
actions · privileged staff administration · governed vehicle selling authority ·
authority-changing operations.

Mechanics stay inside the certified model: capabilities remain the M5 **static** map derived from
`platformRole`/`baseRole` on proven sessions; the UI renders only server-derived
`allowed_actions` and grants nothing (M8-DEFERRED persistent grants stand — if Progressive Trust
ever needs a real per-user grant, that is the documented M8 tripwire and requires an evidence memo
FIRST).

**The primary speed KPI is `Time to Safe Action`** — how quickly a legitimate user can do the
first useful safe thing — not registration duration and not time-to-fully-verified.

## Identity lifecycle and account security (X3 design)

Identity is a lifecycle, not a one-shot gate. The expansion must define governed states:

`verified` · `reverification required` · `suspended` · `compromised` · `disputed` ·
`revoked/recovered` as policy requires.

Triggers that may move a person between states: identity document expiry · suspicious
login/account takeover · high-risk authority operation · material identity change · privileged
role assignment · business ownership/director change.

Step-up authentication is required for high-risk actions (authority changes, financial actions,
privileged administration) — defined per action class in X3.

A distinction the design must never blur:

- **identity proofing** — establishing who a person is (evidence, review, decision; the 7C lane);
- **returning-user authentication** — proving the same account-holder is back (sessions,
  passkeys/WebAuthn/device biometrics).

## Biometrics and consent (X4 design) — truthful scope

Existing reality, recorded so nothing is oversold:

- selfie capture exists;
- current `identityBinding.js` is **name-vs-name comparison**;
- genuine face ↔ document comparison is **not currently proven**;
- genuine liveness is **not currently proven**;
- fingerprint implementation is **not proven** — do not assume it exists.

Build later, only through governed evidence: explicit biometric consent · face ↔ document score ·
genuine liveness · provider provenance recorded with every assessment · fallback/manual review
path. A biometric assessment is **evidence into the governed identity decision**, never a decision
itself.

For returning users, prefer **passkey/WebAuthn/device biometric authentication** unless a
separately justified fingerprint verification use case is approved. **Never create a central raw
fingerprint store by default.**

## Reusable identity assurance projection (X6 design item — not an instruction to implement now)

An O2 assurance projection downstream domains may consume without raw identity documents ever
travelling:

```
identity state · assurance level · verified_at · freshness
```

Derived at read time from the owning identity records — the same derived-not-copied discipline as
the `who_must_act` projection; no domain stores its own copy. Potential consumers: Seller Journey ·
Dealer onboarding · Service Network · Finance · Insurance · SafePay · warranties · staff
onboarding.

## Expansion phase map

Same discipline as core O2: each phase lands only when its gate is green; the tracker records
evidence per item; nothing is marked complete by assertion.

| Phase | Deliverable | Writes product code? | Gate |
|---|---|---|---|
| **X0** | Expansion discovery/design: exact-head reconciliation + this plan + doc-pack updates | No | pack internally consistent, committed to the O2 branch; PO review |
| **X1** | Document Intelligence authority reconciliation (7-step protocol; disposition executed after PO approval) | Only the approved disposition | every step evidenced; disposition approved; canonical lanes untouched |
| **X2** | Registration + Progressive Trust: upload → OCR candidate → user confirmation → registration profile; Time-to-Safe-Action definition | Yes | candidates never authoritative; store-separation proven; capability model unchanged (static map) |
| **X3** | Identity lifecycle / account security: lifecycle states, triggers, step-up auth | Yes | governed transitions with audit; proofing vs authentication separation proven |
| **X4** | Biometrics/consent: consent, face↔document, liveness, provider provenance, manual fallback | Yes | no biometric claim without provider provenance; no raw fingerprint store; assessments are evidence only |
| **X5** | Dealer onboarding + workbook migration: AI semantic mapping (advisory) ahead of the existing pipeline | Yes | human-confirmed mapping recorded; VERIFIED/APPROVED import refusals preserved; no second importer |
| **X6** | Cross-domain assurance projection + Communications event semantics | Yes (emit/read-side only) | derived-not-copied proven; Communications delivery code untouched |
| **X7** | Intelligence + integrated certification of the expansion | CI workflow + spec | exact-head, one SHA; runs only after the P7 blockers are resolved and P7 itself is unblocked |

## Risk and dependency register

| # | Item | Detail | Owning workstream |
|---|---|---|---|
| R1 | `POST /api/vehicles/:vin/evidence-sets` | Role-gated with **no object scope** (pre-existing, recorded during P1-C, deliberately not patched there or here — outside this documentation task's no-code rule) | Recommended: dedicated vehicle-evidence authorization hardening lane; X2 must not build on the route until dispositioned |
| R2 | Extractions route | Same class: role gating without full object scope; same P1-C record | Same lane as R1 |
| R3 | PR #194 unmerged | The convergence base the O2 branch descends from is not yet accepted; certifying anything against it repeats the documented mixed-base hazard | Product Owner acceptance of #194 |
| R4 | Staging pairing absent | `feat/operations-o2-people-compliance` has no entry in `web/preview-frontend-pairing.json` / `preview-backend-pairing.json`; adding one now would push the P1-C RPC migration onto **shared** staging pre-#194 | P7 (after R3) |
| R5 | Synthetic identity documents | P7/X7 staging journeys require submitting identity document images to shared staging; PO awareness required before any are created | P7 (after R3), PO decision |
| R6 | `/promote-trust` + trust tiers | **CLOSED by X1 (2026-09-03)** — the surface is retired; historical rows preserved (see "X1 executed") | X1 (done) |
| R7 | `/ai/ocr`, `/ai/fraud-scan` frontend calls | **RESOLVED by X1 step 1** — served at `/api/ai/*` via `aiServiceBus`, observation-only; attribution/default residuals recorded for X2 | X2 consumption rules |
| R8 | Adjacent open lanes | #196/#197 (Service Network), #200 (seller UAT convergence) are separate lanes; the expansion must not entangle them | respective lanes |

## Decisions requiring Product Owner approval

1. **X1 disposition** of `/api/verification/promote-trust` and the trust-tier write path — the
   proposed RETIRE (with interim quarantine and the MOVE-BEHIND-GOVERNED-DECISION fallback).
2. **Expansion phase order and entry** — approval to begin X1; whether X2/X5 may be re-sequenced.
3. **Biometric provider and consent model** (X4 entry gate).
4. **Assurance projection consumer priority** (X6 — which downstream domain integrates first).
5. **P7 timing** — acceptance of #194, staging pairing, and synthetic identity documents on
   staging (pre-existing decision, restated; nothing here changes it).

## Merge / stop rule

Same as core O2: do not merge. X0 ends with this documentation pack committed to the O2 branch for
Product Owner review. **X1 implementation does not begin until the Product Owner approves the plan
and the X1 disposition path.**
