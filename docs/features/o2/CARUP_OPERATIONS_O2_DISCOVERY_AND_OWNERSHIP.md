# O2 — Current-code discovery and domain ownership map

Discovered at integrated candidate `dd94c56d`. Every anchor verified by reading the file, not inferred.

## 3. Current-code discovery

### Identity Verification (REUSE — do not rebuild)

| Piece | Anchor | State |
|---|---|---|
| Case phase model | `backend/services/identity/caseWorkflow.js` | 7 workflow phases (`SYSTEM_PROCESSING`, `REVIEWER_ACTION_REQUIRED`, `APPLICANT_ACTION_REQUIRED`, `ESCALATED`, `RESOLVED_APPROVED`, `RESOLVED_REJECTED`, `CANCELLED`); 8 dispositions incl. `RESUBMISSION_REQUESTED`; decision actions incl. `ADD_INTERNAL_NOTE`, `ESCALATE`; reason-code → recommended-action map |
| Sessions + review | `backend/services/identity/verificationSessionService.js` — `createVerificationSession`, `submitVerificationSession`, `listVerificationSessionsForReview`, `getVerificationSessionForReview`, `reviewVerificationSession`, `getEvidencePreviewUrl` | full lifecycle incl. reviewer surface |
| Decision policy/recording | `decisionPolicy.js`, `decisionRecorder.js`, `reasonCodes.js` | governed decisions with reasons |
| Evidence + binding | `evidenceValidation.js`, `identityBinding.js`, `documentClassifier.js` | OCR provenance recorded (`verification_ocr_provenance`) |
| Admin routes | `backend/routes/identityVerificationAdminRoutes.js` | list/detail/decide/preview |
| Tables | `verification_sessions`, `verification_decisions`, `verification_assessments`, `identity_documents`, `verification_ocr_provenance` | present |

### Dealer Compliance (REUSE — do not rebuild)

| Piece | Anchor |
|---|---|
| Service | `backend/services/dealer/dealerComplianceService.js` — profiles, branches, requirements (`upsertRequirement` with `is_blocking`), documents (with `expiry_date`), decisions (`recordDecision`, `applyDecisionToProfile`), `deriveCanPublish`, `deriveExpiryState` |
| Statuses | `active` / `pending` / `restricted` / `suspended` (+ investigation concept via decisions) — **kept as-is; never replaced by a generic Operations status** |
| Routes | `backend/routes/dealerRoutes.js`, `backend/routes/complianceRoutes.js` (registry read/update, government+admin) |
| Tables | `dealer_compliance_requirements`, `dealer_compliance_documents`, `compliance_reports` |

### Seller Authority (REUSE — the M8 reference implementation)

`backend/services/seller/sellerAuthorityService.js` + `vehicle_seller_authority` — status lifecycle
(`evidence_submitted` … `confirmed` / `insufficient` / `disputed` / `revoked`), `basis`,
`policy_version`, `decided_by/role/at`, `evidence_ids`, UNIQUE(vin, seller_user_id). Grain is
vehicle × seller and stays that way.

### Ownership transfer (REUSE — the P1 integration point)

| Piece | Anchor |
|---|---|
| Routes | `backend/routes/passportOwnershipTransferRoutes.js` — begin (idempotency-key required, session-proven), get, transition |
| Service | `backend/services/passport/passportOwnershipTransferService.js` — `transitionOwnershipTransfer`: completion requires GOVERNANCE role + `registryAuthority` + `completionReference`; finance-encumbrance guard is message-layer, the real authority is `trg_block_encumbered_owner_change` inside the atomic RPC |
| RPC | `passport_transition_ownership_transfer_atomic` (`20260828203000_passport_ownership_transfer_authority.sql`) — owns the `vehicles.owner_id` change under `FOR UPDATE` |
| **THE GAP (P1)** | The RPC and service **never touch `vehicle_seller_authority`** (verified by search of the migration and service). A completed transfer leaves the PREVIOUS owner's `confirmed` authority standing. |

### Seller compliance inputs (data already present)

`users.is_verified`, email-verification lane (fix branch commit `c88c6ef2` certifies seller Email),
identity sessions per user, `vehicle_seller_authority` per vehicle, dealer tenant membership
(`tenant_users`). These stay separate concepts; O2 displays them side by side, never folds them.

### Communications integration points

`emitDomainEvent` (`backend/services/eventBus/eventBusService.js`) is the emit side;
`communicationEventListeners.js` / product notification services own delivery. Precedent:
`seller.authority.decided` already emitted from the vehicles routes. O2 adds emit-only events; no
Communications code changes.

## 4. Domain ownership map

| Fact | Owning service / record | O2 may… | O2 must never… |
|---|---|---|---|
| Who a user is (account) | `users` (auth lane) | read id/name/role/is_verified | write users; expose email publicly |
| Identity verification state | identity service / `verification_sessions`+`verification_decisions` | read; call `reviewVerificationSession` as the reviewer | store its own copy of the phase; decide without the identity service |
| Identity artifacts (ID document images, selfie) | identity storage + preview URLs | show to capability-holding reviewer via the identity service's own preview path | proxy/persist/expose them anywhere else — NEVER public |
| Seller authority | `sellerAuthorityService` / `vehicle_seller_authority` | read state; call `reviewSellerAuthority` | write rows directly; treat authority as identity |
| Vehicle ownership | passport transfer service / RPC / `vehicles.owner_id` | read transfer state | complete/alter transfers outside the governed route; fabricate ownership |
| Dealer compliance | `dealerComplianceService` | read profile/requirements/documents/decisions; call `recordDecision` | replace its statuses with a generic one; grant tenant admins platform authority |
| Email verification | auth/email lane | read the flag | conflate with identity verification |
| Zimbabwe registration | registration lifecycle (vehicle domain) | read | treat as a People fact |
| Vehicle Trust | `canonicalTrustService` | read | write, ever (one-writer invariant) |
| Audit | `trust_audit_events` + domain audit paths | read for display; rely on domain writes | write audit rows of its own for domain decisions |
| Notifications | Communications | emit domain events | send messages directly |

## 5. Exact-head reconciliation — 2026-09-03, head `90c50cc0` (X0)

Re-verified for the Identity/Onboarding Expansion; every anchor existence-checked at this head.
The original discovery above (`dd94c56d`) is preserved untouched.

- **Convergence authority:** PR #194 `integration/vehicle-passport-v16-cert` @ `33720d79` — OPEN
  (draft), unmerged, and an ancestor of this head. Core O2 state: P0–P6 + P1-C complete and
  certified at `e9326f76`; **P7 BLOCKED / NOT EXECUTED**; no PR exists for the O2 branch.
- **Active person-identity stack (Phase 7C):** `backend/services/identity/*` with routes
  `/api/identity/…` (`identityVerificationRoutes.js`) and `/api/admin/identity/…`
  (`identityVerificationAdminRoutes.js`); shared contract `shared/types/verificationStatus.ts`.
- **Active admin UI:** `web/src/pages/dashboard/admin/IdentityVerificationCaseManagement.tsx`,
  routed at `/admin/verification` (`web/src/App.tsx`).
- **Unrouted legacy UI:** `web/src/pages/dashboard/admin/VerificationReview.tsx` — no route
  imports it. Disposition: **QUARANTINE** — retirement candidate after dependency/test
  confirmation; no expansion functionality may be added to it.
- **Second verification lane (overlap, undispositioned):**
  `backend/services/document-intelligence/documentIntelligenceRouter.js` +
  `documentIntelligenceService.js`, mounted at `/api/verification` (`backend/server.js:357`,
  behind `authorizeSessionRole(['admin','government'])`). Endpoints: `/ocr`, `/ocr/:id/approve`,
  `/fraud-scan`, `/trust-score/:userId`, `/promote-trust`.
- **`POST /promote-trust` concern:** passes `userId` + `trustLevel` from the request body into
  `TrustService.assignTrustLevel` (`backend/services/trust-service/trustService.js`), which
  upserts a six-tier `kyc_profiles.overall_status` and logs a `security_events` row — no reason
  codes, no governed decision record. X0 read-only survey: that route is the ONLY caller of
  `assignTrustLevel`; no web code calls any `/api/verification/*` endpoint; nothing in the
  repository reads `kyc_profiles.overall_status`. The service's `extractDocumentData` DOES have a
  live consumer (`backend/routes/diasporaRoutes.js`). Resolution is expansion workstream
  **O2-X1** — `CARUP_OPERATIONS_O2_IDENTITY_ONBOARDING_EXPANSION_PLAN.md`.
- **Registration-profile ownership:** confirmed account/profile data belongs to
  `backend/services/auth/registrationProfileService.js` +
  `database/migrations/20260829123000_user_registration_profiles.sql`; verification stores
  evidence/assessment provenance only — `verification_sessions` is never a profile store.
- **Workbook-engine ownership:** bulk import belongs to the diaspora workbook pipeline
  (`backend/services/diaspora/…` + `workbook/…`, routes `diasporaWorkbookRoutes.js` /
  `diasporaWorkbookXlsxRoutes.js`); Dealer bulk onboarding reuses it — no second importer.
- **Communications boundary:** emit-only via `emitDomainEvent` stands; delivery is owned by the
  Communications lane (`docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`).
- **Service Network:** separate lane (PR #197); `backend/services/serviceNetwork/*` is NOT
  present on this branch (existence-checked).

#### X1 addendum — executed 2026-09-03 (see the expansion plan's "X1 executed" section)

- The second verification lane is now **RETIRED**: router, mount, path-scoped rate-limit line and
  all five endpoints deleted; `approveDocumentVerification`, `TrustService` and `FraudService`
  deleted; `extractDocumentData` kept as the internal candidate-extraction engine.
- Two X0 statements corrected: `kyc_profiles.overall_status` had one reader
  (`calculateUserTrustScore` — inside the retired lane itself), and the `/ai/ocr` +
  `/ai/fraud-scan` frontend calls ARE served — inline `/api/ai/*` routes in `backend/server.js`
  via `aiServiceBus` (observation-only writes; no product component invokes the web hook methods).
- The `vehicles.trust_score` foreign-writer set shrank from three to two
  (`v16-authority-hardening.test.js` B7 pins the set), and the registry tables
  `cvr_ownership_records`/`zimra_declarations` now have zero in-product writers.
- Boundary pinned by `backend/tests/o2-x1-document-intelligence-authority.test.js` (6 guards);
  receipt: `CARUP_OPERATIONS_O2_X1_DOCUMENT_INTELLIGENCE_AUTHORITY_RECEIPT.md`.

#### X2 addendum — executed 2026-09-03 (see the expansion plan's "X2 executed" section)

- **New self-scoped registration surface:** `GET /api/registration/journey` ·
  `GET /api/registration/profile/candidates` · `PUT /api/registration/profile`
  (`registrationOnboardingRoutes.js` + `services/registration/registrationJourneyService.js`),
  web page `/onboarding` (`web/src/pages/onboarding/RegistrationJourney.tsx`). DDL delta NONE.
- **Ownership unchanged:** `user_registration_profiles` stays the confirmed-context store (the
  only table the new service writes, users' own rows only); identity evidence and provenance stay
  with 7C; the journey/ladder is a derived, advisory projection that performs zero writes.
- **Discovery facts:** `next_actor`/`required_action` are DORMANT session columns (no writer
  anywhere) — X2 derives both at read time instead; `users.is_verified` is the email-lane flag
  (no product writer sets it from identity) and identity truth lives only on the session
  (status `verified` / phase `resolved_approved`); the applicant web flow did not exist before
  X2 (only the admin surface did).
- **Attribution guards (X1 residual A closed):** `extractDocumentData` and
  `aiServiceBus.runOcrParsing` refuse to run without a user id outside the test suite;
  `/api/ai/ocr` passes `req.userContext.id`.

#### X3 addendum — executed 2026-09-03 (see the expansion plan's "X3 executed" section)

- **New identity-domain lifecycle ledger:** `identity_lifecycle_events` (append-only,
  DB-enforced, monotonic `seq`) + `identityLifecycleService` — current state derived from the
  latest row with fallback to the historical 7C approval; 7C sessions remain immutable.
- **Ownership decisions:** the identity domain owns lifecycle truth (only its approval hook
  mints `verified`/`recovered`); auth owns session assurance (`auth_method`/`step_up_at`/
  `step_up_method` on `user_sessions`, server-derived only); Operations acts through
  `operations.identity.lifecycle` / `operations.account.security` on proven, stepped-up
  sessions; routine recovery stays an authentication event (recovery router imports no
  lifecycle code, source-pinned).
- **Discovery facts:** no self-service profile/credential-change or logout routes exist —
  the material-identity-change trigger has no write path to hook today (designed, refused by
  absence; any future account-edit route must call the lifecycle hook); no WebAuthn/passkey/MFA
  implementation exists anywhere in the repository — `STRONG_AUTHENTICATOR_AVAILABLE=false` is
  the build-time fact and the critical class's password-re-proof fallback is explicit policy.
- **One step-up guard** (`requireAuthenticationAssurance`) wired to: transfer transition
  [CRITICAL]; seller-authority review, dealer decision, evidence preview, lifecycle
  transition, session revocations [SENSITIVE]. It composes after role/capability layers and
  substitutes for none of them.

#### X4 addendum — executed 2026-09-03 (architecture certified; live provider NOT activated)

- **New identity-domain pieces:** `identity_biometric_consents` (append-only consent ledger) +
  biometric columns on the existing `verification_assessments`;
  `services/identity/biometrics/` (provider contract + consent + assessment services);
  applicant routes `/api/identity/biometric-consent[...]` and
  `/api/identity/verification-sessions/:id/biometrics` (session-id only — no client scores).
- **Ownership:** the identity domain owns consent and biometric evidence; `decisionPolicy`
  consumes the evidence (mismatch/failed-liveness block approval; nothing biometric grants
  it); the 7C reviewer decision remains the only approval writer; `identityBinding` stays the
  independent, non-biometric name dimension.
- **Provider posture:** registry → honest null provider (`not_configured`); unknown vendor
  names throw; test doubles refused outside the test suite; provider selection is a governed
  PO decision (`CARUP_OPERATIONS_O2_X4_BIOMETRIC_PROVIDER_DECISION.md`, status NOT SELECTED).
- **Data-minimisation law (pinned repo-wide):** no biometric template/embedding store, no
  fingerprint fields/endpoints; CarUp keeps assessment + provenance + consent + decision.
