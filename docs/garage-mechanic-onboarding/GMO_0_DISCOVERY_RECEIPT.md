# GMO-0 — Current-State & Authority Reconnaissance

**Type:** read-only audit. No runtime code was changed by this phase.
**Head audited:** `ee45e556` (PR #197, Draft) · `main` `bb9d9900` · PR #208 Draft, untouched.
**Method:** source inspection, not recollection. Every claim below cites what was searched.

---

## 1. The missing authority — confirmed from source

### 1.1 Nothing creates an organisation or a membership

Every production reference to the two tables Service Network consumes, classified by operation:

| table | references in production code | writes |
|---|---|---|
| `tenants` | 2 | **0** |
| `tenant_users` | 14 | **0** |

```
tenants
  services/serviceNetwork/garageDirectoryService.js:87    select
  services/serviceNetwork/serviceLinkService.js:279       select

tenant_users
  middleware/authMiddleware.js:169                        select
  server.js:500, 2152, 2215, 2282, 2323, 2388             select
  routes/vehiclesRoutes.js:954                            select
  services/serviceNetwork/workOrderAssignmentService.js   select
  services/serviceNetwork/garageQueueService.js           select
  services/serviceNetwork/serviceLinkService.js           select
  services/serviceNetwork/serviceAuthority.js             select
  services/featureGovernance/featureGovernanceService.js  select (×2)
```

(`backend/tests/` and `services/golden/` fixtures excluded — fixtures are not a product path.)

**Conclusion:** there is no legitimate product path that founds a Garage. The staging garages used
throughout Service Network certification were created by direct SQL.

### 1.2 Nothing advances a business application

```
user_registration_profiles.onboarding_status
  written : ONCE, at registration — 'requested' (business) | 'not_required' (individual)
            services/auth/registrationProfileService.js:72
  read    : server.js:2623 (echoed in the registration response)
  transitions to in_review / approved / rejected : NONE ANYWHERE
```

The column already declares the vocabulary
`not_required | requested | in_review | approved | rejected` (migration
`20260829123000_user_registration_profiles.sql`), and nothing can move a row past `requested`.

### 1.3 What the platform role can do

`users.role` is written by: registration (insert), `adminRoutes` suspension (`role: 'suspended'`),
auth recovery, and golden fixtures. **No path promotes a person to `mechanic` or `dealer`.** This is
correct — a platform role is not the mechanism for professional authority; a membership is.

---

## 2. What already exists and works — do not rebuild

### 2.1 Operating-context switching is built and governed

`POST /api/auth/switch-role` (`server.js:452`) is already the canonical context switch:

- refuses switching anyone else's context (`userId !== req.userContext.id`);
- validates the role against an approved catalog;
- when a `tenantId` is supplied, **verifies membership** — *"Forbidden. You do not belong to this
  organization."*;
- `canAssumeRequestedRole = role === user.role || (verifiedTenantRole && role === verifiedTenantRole
  && role !== 'admin')` — a tenant may never mint platform admin;
- issues a new session carrying `active_role` + `active_organization_id`;
- audit-logs both `ROLE_SWITCH_REQUESTED` and the outcome.

**GMO does not need to build context switching.** It needs to produce the `tenant_users` row that
this endpoint already verifies.

### 2.2 The reviewer/application machine exists in Dealer Compliance

`services/dealer/dealerComplianceService.js` is already an application + evidence + blocking
requirements + reviewer decision engine:

```
createOrUpdateProfile · addBranch/listBranches
upsertRequirement/listRequirements        (blocking requirements)
uploadDocument/listDocuments              (evidence)
recordDecision/listDecisions              (append-only decision ledger)
deriveCanPublish · deriveExpiryState      (derived lifecycle state)

DECISIONS_ALLOWED = approve_requirement | reject_requirement | request_more_info
                  | restrict | suspend | reinstate | set_expiry
requirement status = verified | present | pending | rejected | not_applicable
```

Critically, it **records compliance state and grants no tenancy** — it never writes `tenants`,
`tenant_users` or `users.role`. That is the correct shape: it is the missing *activation* step, not
the review step, that GMO must add.

### 2.3 Identity / OCR / evidence

```
services/identity/  caseWorkflow · decisionPolicy · decisionRecorder · documentClassifier
                    evidenceValidation · identityBinding · reasonCodes · verificationSessionService
services/evidence/  evidenceService · evidenceSetService · extractionService · provenanceService
                    evidenceTaxonomy · completenessEvaluator · perceptualHash …
```

`documentClassifier` carries an explicit `extractionAllowed` / `extractionTrust` model
(`NOT_RUN`, `PARTIALLY_TRUSTED`, …). **No identity module writes role, tenant or membership** —
verified and guarded by `backend/tests/service-network-authority-boundaries.test.js`.

### 2.4 Events and audit

`services/eventBus/eventBusService.js → emitDomainEvent` is the canonical event entry point Service
Network already uses. `services/auditLogger.js → logAuditEvent` is the canonical audit trail, already
used by `switch-role` and Seller authority.

---

## 3. What a Garage applicant experiences today

| step | today |
|---|---|
| registers, chooses Business → Garage / Service Centre | ✅ works |
| account created | ✅ safe base `owner` account |
| intent stored | ✅ `user_registration_profiles`, `onboarding_status: 'requested'` |
| told signup grants nothing | ✅ *"…granted only after governed business review."* |
| **any way to continue** | ❌ **none exists** |
| **any reviewer who can decide** | ❌ **none exists** |
| **any way to become a Garage** | ❌ **none exists** |

They receive a correct, honest, safe account — and a dead end. `onboarding_status` stays `requested`
permanently. There is no status surface, so the truthful state is not even visible to them.

## 4. What a Mechanic applicant experiences today

Identical, with one extra hazard: `business_type: 'mechanic'` is a **claim**, and nothing consumes
it — which is correct (guarded), but means a self-declared mechanic has no path either. There is no
invitation mechanism, so a Garage cannot bring them in even if the Garage existed.

---

## 5. Reuse map — what GMO consumes rather than rebuilds

| need | reuse | never build |
|---|---|---|
| person identity, session | Auth / `user_sessions` | a second auth |
| stated intent | `user_registration_profiles` + `registrationProfileService` | a second profile store |
| application lifecycle vocabulary | `onboarding_status`: `not_required\|requested\|in_review\|approved\|rejected` | a new vocabulary |
| reviewer verbs | `DECISIONS_ALLOWED` from Dealer Compliance | a second reviewer verb set |
| requirement/evidence state | `verified\|present\|pending\|rejected\|not_applicable` | a second state engine |
| identity verification | `services/identity/*` (O2 / PR #208) | a second verification |
| document extraction | `services/evidence/extractionService` + `documentClassifier` | a second OCR service |
| evidence storage & provenance | `services/evidence/*` | a second evidence store |
| reason codes | `services/identity/reasonCodes.js` | a second taxonomy |
| events | `emitDomainEvent` | a second outbox/notification system |
| audit | `logAuditEvent` | a second audit trail |
| operating-context switch | `POST /api/auth/switch-role` | a second context model |
| navigation/context consumption | feature registry + `resolveFeatureVisibility` + `tenantRole` | an eighth role inference |
| everything after activation | Service Network (#197) | a second garage workspace |

**The only genuinely new thing GMO must build is the activation step** — the governed transition
from *approved application* to *organisation + founding membership* — plus the applicant-facing
application/status surfaces and the mechanic invitation lifecycle.

---

## 6. The seven-layer lesson, carried forward

Service Network paid for one fact being decided in several places **seven times**
(`docs/service-network-foundation/SN_0_CROSS_CUTTING_INTEGRATION.md` §SN-0.1). Every suite stayed
green through all seven; a real account in a real browser found them.

GMO introduces a *new* organisation and a *new* membership, so it is exactly the programme that
could add an eighth. The plan therefore forbids any new role inference and requires that desktop
sidebar, compact bottom navigation, direct routes and backend authorization all consume the same
canonical operating context that already exists.

---

## 7. Open Product Owner decisions surfaced by this audit

Listed in the canonical plan §12. In summary, and only where they genuinely cannot be resolved from
existing contracts:

1. **Minimum activation evidence for a Zimbabwe garage** — what CarUp requires before a Garage may
   *operate a workspace* (distinct from being *verified*).
2. **Who reviews** — whether Garage applications are reviewed by the existing admin/reviewer role or
   a new operations role.
3. **Independent / mobile mechanics** — whether a mechanic may exist without a Garage tenant in v1.
4. **Founding role name** — the `tenant_users.role` value for the founding operator.
5. **Re-application after rejection** — cooldown, appeal, or free re-submission.

No decision above was invented, and no activation path was implemented.
