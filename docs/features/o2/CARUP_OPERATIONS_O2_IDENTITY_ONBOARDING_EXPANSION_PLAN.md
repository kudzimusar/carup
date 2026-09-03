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
| R6 | `/promote-trust` + trust tiers | See O2-X1 — quarantined pending disposition | X1 |
| R7 | Dangling `/ai/ocr`, `/ai/fraud-scan` frontend calls | No backend mount found; either dead client code or an unmapped lane | X1 step 1 confirms; then X2 or removal |
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
