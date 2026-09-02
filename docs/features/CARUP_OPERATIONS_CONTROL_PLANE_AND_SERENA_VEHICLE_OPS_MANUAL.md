# CarUp Operations Control Plane + Serena Vehicle Operations
## Canonical Implementation Plan, Development Manual and Iteration Contract

**Status:** IMPLEMENTATION-READY SOURCE PLAN — architecture is intentionally incremental and remains evolvable
**Repository:** kudzimusar/carup
**Plan branch:** feat/operations-control-plane-serena-slice
**Plan branch origin:** 569e4f14c3fa022d942a41a57751fa3834def756
**Originating Seller lane:** fix/zimbabwe-seller-reality-comms-hardening
**Primary UAT vehicle:** 2016 Nissan Serena Highway Star — GFC27-027051
**Governing project protocol:** docs/project-governance/MILESTONE_EXECUTION_PROTOCOL.md
**Seller master tracker:** docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md
**Zimbabwe Seller reality plan:** docs/seller/ZIMBABWE_SELLER_REALITY_COMMUNICATIONS_HARDENING_PLAN.md
**Vehicle Passport lifecycle plan:** docs/vehicle-passport-lifecycle/CARUP_VEHICLE_PASSPORT_TRUST_LIFECYCLE_1_0_CANONICAL_PLAN.md
**Verification/governance foundation:** docs/CARUP_VERIFICATION_GOVERNANCE_AUDIT.md
**Authority risk register:** docs/hardening/AUTHORITY_AUDIT_REGISTER.md
**Benchmark appendix:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_BENCHMARK_RESEARCH.md
**Claude execution prompt:** docs/agent-prompts/CARUP_OPERATIONS_CONTROL_PLANE_SERENA_CLAUDE_START_PROMPT.md

---

# 0. Why this document exists

CarUp has reached a point where product journeys are producing real operational decisions.

A Seller can create or recover a vehicle, build a listing, upload evidence, create a Vehicle Passport history, disclose accident/insurance/finance information, reach publication readiness, communicate with buyers, and move through ownership lifecycle.

That creates a new system responsibility:

> When CarUp says an item is "Pending review", who reviews it, under what authority, using which evidence, through which canonical workflow, and what exactly is the reviewer allowed to conclude?

The repository already contains many answers, but they were created vertically as individual features needed privileged actions. CarUp currently has real or partial consoles for evidence review, identity verification, trust review, governance review, Marketplace moderation, fraud, dealer compliance, Communications, referral operations, feature governance, institutional/government views, finance, insurance, dealer and mechanic portals.

What CarUp does not yet have is one coherent contract explaining how those surfaces fit together.

This plan creates that contract.

The objective is not to pause CarUp and build a huge universal Admin application. The objective is to:

1. recognize and preserve the operational capabilities that already exist;
2. define their authority boundaries;
3. organize them under a CarUp Operations Control Plane;
4. implement the model in small vertical slices;
5. use the Serena as the first real Vehicle Operations slice;
6. allow Serena to become truthfully publishable without inventing Zimbabwe registration evidence;
7. extract reusable operating patterns only after real domain use proves they are reusable;
8. preserve this manual as the future reference for agents and human maintainers.

This document is both a development plan and an operating design manual.

---

# 1. Mandatory interpretation rule for every implementation agent

The repository at the implementation HEAD is the execution truth.

This document records the architecture discovered at candidate 569e4f14c3fa022d942a41a57751fa3834def756. It must not become an excuse to overwrite newer code.

Before changing code, every agent must:

- read this document in full;
- inspect the current branch, HEAD and working tree;
- inspect open pull requests and active worktrees/branches touching Seller, Passport, Governance, Marketplace, Communications or Service Network;
- compare the current code against the current-state inventory in this document;
- inspect relevant migrations already applied or pending in staging;
- record any drift in the implementation progress file;
- reuse newer correct implementations instead of recreating them;
- stop only if drift creates a true product/security conflict.

No agent may say "the plan said X" when current code has a newer governed contract. The agent must reconcile the plan with the newer authority and document the decision.

---

# 2. Executive product goal

The long-term model is:

> CarUp Operations is the human and system operating layer that coordinates governed decisions across People, Vehicles, Marketplace, Communications, Service, Finance, Insurance, Transactions, external authorities, platform configuration and security.

The first implementation slice is narrower:

> Build the minimum governed Vehicle Operations capability needed to inspect the Serena's actual records, correct the legacy-versus-canonical evidence semantics, evaluate Seller authority independently from Zimbabwe registration, clear only legitimate publication blockers, and return the final Publish action to Kingstone.

The first slice must prove this end-to-end contract:

~~~text
Seller
  ↓
Vehicle Passport
  ↓
Evidence submission
  ↓
CarUp Vehicle Operations review
  ↓
Seller authority / evidence / risk / readiness decisions
  ↓
Publishable
  ↓
Seller deliberately clicks Publish
  ↓
Marketplace
  ↓
Buyer sees only truthful public-safe projection
~~~

Operations clears governed blockers.

Operations does not secretly publish on the Seller's behalf.

---

# 3. Product laws — non-negotiable

These laws apply to every Operations slice.

## 3.1 Truth is source-aware

CarUp must distinguish:

- Seller statement;
- CarUp-observed artifact;
- CarUp-reviewed artifact/classification;
- CarUp policy/governance decision;
- external-source report;
- authoritative external confirmation;
- derived canonical state;
- public-safe projection.

No UI wording may erase those distinctions.

## 3.2 Unknown is not clear

A read failure, missing record, unavailable provider or absent document must never become verified, clear, no accident, no loan, not stolen, locally registered, duty cleared or safe.

Use explicit unknown, unavailable, not recorded, not evaluated or pending states.

## 3.3 Registration readiness is not Trust

Zimbabwe registration progress is a lifecycle/readiness dimension.

A permanent import may legitimately be listed while local registration is still progressing, provided all other publication requirements pass and the pending stage is truthfully disclosed.

A pending registration stage must not receive an arbitrary Trust penalty merely for being pending.

## 3.4 TIP is not a generic import placeholder

Temporary foreign vehicle — TIP is a distinct temporary-admission state.

A Tanzania T1 through-transit declaration must never be relabeled as a Zimbabwe Temporary Import Permit.

## 3.5 Vehicle identity is not limited to one international form

The current Marketplace eligibility code recognizes documented import frame/chassis identifiers of 12–17 letters/numbers/hyphens as real-market identifiers in addition to standard VINs.

Do not regress Serena or other Japanese imports back to a forced fabricated 17-character VIN.

## 3.6 One vehicle, one Passport

An existing vehicle identity must converge on the canonical Vehicle Passport.

Seller authority or commercial listing rights do not justify creating a duplicate vehicle identity.

## 3.7 Listing media is not evidence

Commercial listing photographs and Vehicle Life evidence have separate storage, semantics, verification and public projection rules.

## 3.8 Review does not create external authority

A CarUp reviewer can review classification, relevance, consistency, seller authority under CarUp policy, Marketplace suitability, risk and evidence quality.

A CarUp reviewer cannot become ZIMRA, CVR, ZRP/CID, an insurer, a bank/lender or an inspection authority unless CarUp is consuming a valid authorized source from that authority.

## 3.9 Private artifacts remain private

Passport, payment details, addresses, banking information and other restricted documents can support governed decisions without becoming public Marketplace content.

## 3.10 AI advises; governed paths decide

AI may classify, extract, summarize, detect anomalies and recommend review.

AI must not silently approve external facts or create canonical Trust.

## 3.11 No self-certification

The requester or source actor must not approve their own independent verification when the policy requires independent review.

Examples:

- Seller cannot independently verify their own authority evidence.
- Mechanic cannot make their own PartSentry log independently verified.
- Dealer cannot self-create dealer_verified.
- Reviewer conflicts must be visible and handled.

## 3.12 Audit is part of the decision

Material decisions need actor, actor authority, subject, previous state, new state, reason, evidence basis, timestamp, source route and correlation/request identity.

## 3.13 Domain records remain canonical

The Operations Control Plane coordinates domain records. It must not create duplicate truth stores merely for dashboard convenience.

---

# 4. Terminology

## 4.1 Operations Control Plane

The coordinated operating environment that lets authorized CarUp staff or specialist partners:

- see work requiring intervention;
- inspect permitted context;
- take bounded decisions;
- assign/escalate/resolve work;
- produce audit records;
- notify affected participants;
- project approved public state.

It is not one database table and not one giant Admin component.

## 4.2 Platform Administration

Platform-level control over feature rollout, environment configuration, operator permissions, system policies, emergency controls, provider/platform health and security response.

Platform Administration is different from everyday Operations.

## 4.3 Super Admin / Platform Admin

A small platform-authority class intended for platform configuration, emergency intervention, role/capability governance and protected changes.

It is not intended to be the normal person reviewing every evidence document.

## 4.4 Specialist Operator

A person or partner with bounded capability to perform a specific operational function.

Examples include Evidence Reviewer, Trust/Passport Reviewer, Customer Operations, Marketplace Moderator, Dealer Compliance, Risk Operations, Service Network Operations and Finance Operations.

## 4.5 Authoritative External Source

A source that legitimately owns or controls a fact outside CarUp, for example a government registry, customs/revenue authority, lender, insurer or inspection provider.

A source may be connected by API, webhook, uploaded authoritative document or other governed integration.

## 4.6 Governed Decision

A decision made through a defined CarUp policy and attributed to an authorized actor.

Examples:

- evidence verified;
- evidence rejected;
- seller authority confirmed under CarUp policy;
- listing suppressed;
- risk case resolved;
- trust fact approved.

## 4.7 Public Projection

A sanitized statement safe for buyers.

It is not a raw database row and must never contain private evidence paths, security tokens or internal risk reasoning that policy does not permit.

---

# 5. Code-grounded current state at the originating candidate

This section is a map for Claude and future agents. It records what existed at candidate 569e4f14c3fa022d942a41a57751fa3834def756.

The agent must revalidate every item at the implementation HEAD.

## 5.1 Feature Registry and navigation

File:

- web/src/config/featureRegistry.ts

The registry contains approximately 100+ registered features across commerce, trust, evidence, service, parts, insurance, government, diaspora, admin, finance, referrals and information domains.

Existing Admin-oriented routes include:

- /admin
- /admin/features
- /admin/users
- /admin/ai
- /admin/moderation
- /admin/evidence
- /admin/verification
- /admin/trust-review
- /admin/fraud-queue
- /admin/dealer-compliance
- /admin/governance-review
- /admin/referrals/*
- /admin/communications
- /admin/diaspora/*

Existing institutional/specialist portals include:

- /government/*
- /bank/*
- /insurance-dash/*
- /dealer/*
- /mechanic/*

The Feature Registry already supplies route ownership, role bounds, lifecycle state, active/beta/planned/hidden/disabled/deprecated semantics, feature rollout governance and navigation placement.

This infrastructure must be extended, not bypassed.

## 5.2 Platform role authority

File:

- backend/middleware/authMiddleware.js

Backend platform authority already understands:

- admin;
- platform_admin;
- super_admin.

The frontend shared UserRole currently models:

- owner;
- dealer;
- mechanic;
- bank;
- insurance;
- government;
- admin.

This mismatch is important.

Do not solve it by blindly adding every future operations job title to UserRole.

The target model separates stakeholder portal identity from operating capabilities.

## 5.3 Admin Dashboard

File:

- web/src/pages/dashboard/admin/AdminDashboard.tsx

A real Admin shell exists and describes itself as an ecosystem command centre.

It should be treated as an existing surface to reorganize incrementally.

Do not replace it with a new application unless a later architecture review proves that is necessary.

## 5.4 User Management

File:

- web/src/pages/dashboard/admin/UserManagement.tsx

Current capabilities include listing users, suspending users and creating a new user using the normal registration endpoint.

This is not yet an acceptable privileged-operator provisioning system.

Do not allow a general public registration flow to mint platform or specialist Operations authority.

A future operator-provisioning path must be explicit, audited and server-authorized.

## 5.5 Identity Verification

Files include:

- web/src/pages/dashboard/admin/IdentityVerificationCaseManagement.tsx
- backend/routes/identityVerificationAdminRoutes.js
- backend/services/identity/*

This is one of the strongest existing Operations-style verticals.

The UI already models reviewer action required, applicant action required/resubmission, escalated cases, approved, rejected/closed, evidence previews, approve, request resubmission, reject, escalate, internal notes, reason codes, applicant messages and idempotent decisions.

Reuse these workflow principles.

Do not merge identity verification with vehicle evidence review.

## 5.6 Vehicle Evidence Review

Files include:

- web/src/pages/dashboard/admin/EvidenceReview.tsx
- backend/routes/vehiclesRoutes.js
- backend/services/evidence/*

Current Admin evidence UI can show pending/verified/rejected evidence, file or withheld state, checksum, AI advisory, extraction review and approve/reject actions.

Current backend behavior has an authority mismatch:

- GET /api/evidence/review may expose tenant-scoped review items to dealer/mechanic roles;
- PATCH verify/reject is restricted to admin/government.

The implementation must reconcile this deliberately.

A role must not be presented with an Approve button that the backend correctly refuses.

## 5.7 Evidence provenance and taxonomy

Canonical source:

- backend/services/evidence/evidenceTaxonomy.js

Canonical classes at the originating candidate include:

- import;
- auction;
- accident;
- repair;
- inspection;
- ownership_transfer;
- registration;
- dealer_listing;
- current_condition.

Important Serena-relevant canonical subtypes include:

Import:
- bill_of_lading;
- export_certificate;
- customs_entry;
- duty_clearance_document;
- commercial_invoice;
- payment_receipt;
- transit_declaration.

Inspection:
- roadworthiness.

Registration:
- cvr_first_registration;
- registration_book;
- registration_plate_record;
- police_clearance_first_registration;
- reregistration_record;
- temporary_import_permit.

The canonical taxonomy is the future semantic authority.

## 5.8 Legacy evidence-type conflict

File:

- web/src/components/EvidenceUploadModal.tsx

The current upload UI still requires a legacy evidence_type before allowing the newer class/subtype selection.

Legacy values include registration_document, insurance_document, ownership_transfer_document, import_photo, customs_photo and others.

This can produce a contradictory record such as:

~~~text
legacy evidence_type: registration_document
canonical evidence_class: import
canonical evidence_subtype: commercial_invoice
~~~

The UI may then display one part of the record as Import and another part as Registration Document.

This is a high-priority semantic defect for the Serena slice.

## 5.9 Completeness evaluator still depends on legacy semantic types

File:

- backend/services/evidence/completenessEvaluator.js

The originating candidate treats a verified legacy registration_document or ownership_transfer_document as satisfying the blocking Ownership / Registration Document requirement.

It does not yet derive this requirement from the newer canonical class/subtype and a distinct Seller authority model.

This creates a Truth risk:

an import invoice carried under the legacy registration_document type could be interpreted by the old publication gate as ownership/registration evidence even while its canonical class says Import / Commercial Invoice.

The Serena must not be published by exploiting this mismatch.

## 5.10 Zimbabwe registration lifecycle

File:

- backend/services/registration/zimbabweRegistrationLifecycle.js

Canonical states:

- unknown;
- import_in_transit;
- arrived_customs_pending;
- customs_cleared_cvr_pending;
- cvr_plate_pending;
- locally_registered;
- temporary_foreign_tip;
- reregistration_pending.

Permanent-import pending states are ordinarily listable when other requirements pass.

Unknown and temporary foreign/TIP states can require additional review/blocking.

The registration helper correctly does not require a local plate for normal permanent-import pending stages.

Preserve this.

## 5.11 Seller authority is already partially implemented

File:

- backend/routes/vehiclesRoutes.js

The originating candidate already contains a seller-claim flow for an existing Vehicle Passport.

It defines:

- SELLER_AUTHORITY_CLAIM_REQUESTED;
- recognized existing relationships;
- a seller-claim endpoint;
- an evidence-based authority shortcut.

However, the evidence shortcut still depends on legacy evidence types registration_document and ownership_transfer_document.

Therefore the implementation must not start by inventing a second parallel authority system.

First inspect the complete current seller-claim flow and decide whether to harden it, extract it into a dedicated service, add a governed review state, or migrate it to a better canonical table.

The decision must be based on current schema and current consumers.

## 5.12 Publication lifecycle

File:

- backend/routes/vehiclesRoutes.js

The seller publication route is owner/dealer/admin scoped, calls evaluateCompleteness, returns missing and pending blocking requirements, and only publishes after the deterministic gate passes.

Unpublish returns the vehicle to a non-public publishable state.

The new Operations slice must preserve the final Seller action.

Do not make evidence approval silently publish the listing.

## 5.13 Trust Review

Files:

- web/src/pages/dashboard/shared/TrustReviewQueue.tsx
- backend/routes/trustFactRoutes.js
- backend/services/trustGovernance/trustFactWorkflowService.js
- backend/services/trustGovernance/trustPermissionService.js

This is the governed trust-fact review path.

It already supports pending/approved/rejected/revoked/superseded, evidence inspection, audit trail, approve/reject/revoke and role-specific fact scope.

Do not create a new "approve trust" button in Vehicle Operations that bypasses this service.

## 5.14 Governance Review

Files:

- web/src/pages/dashboard/shared/GovernanceReviewQueue.tsx
- backend/routes/governanceRoutes.js
- backend/services/governance/governanceService.js
- backend/services/governance/disputeService.js

The governance layer already supports temporal findings, disclosure conflicts, vehicle identity candidates, evidence verification, confirm, reject, amend, request more, inconclusive, supersede, escalate, disputes, independent reviewer assignment and appeal.

The service explicitly separates reviewer decisions from canonical Trust score mutation.

Important mismatch:

the governance code recognizes a reviewer role that is not represented by the shared frontend UserRole.

This is evidence that reviewer capability should become a separate operational authority concept.

## 5.15 Marketplace Moderation

Files:

- web/src/pages/dashboard/admin/MarketplaceModeration.tsx
- backend/routes/marketplaceAdminRoutes.js
- backend/services/marketplace/marketplaceModerationService.js

Current functions include listing public/pending/suppressed/rejected listings, approve, reject, suppress, request evidence, flag risk, clear risk, inquiry management, assignment, analytics and AI moderation advisory.

This is Marketplace Operations, not Vehicle Evidence verification.

## 5.16 Fraud/Risk

Files include:

- web/src/pages/dashboard/admin/FraudQueue.tsx
- backend/routes/fraudRoutes.js
- backend/services/fraud/*

Current fraud cases can show severity, indicate publication blocking, resolve false positives and block listings.

This should become Risk Operations without being merged into the evidence reviewer role.

## 5.17 Dealer Compliance

Files include:

- web/src/pages/dashboard/admin/DealerCompliance.tsx
- backend/services/dealer/dealerComplianceService.js

Multiple compliance states are kept separate.

This is a good pattern: do not collapse identity, business evidence, active state, restrictions, suspension and investigation into one green "Dealer verified" bit.

## 5.18 Communications Command Center

File:

- web/src/pages/dashboard/admin/Communications.tsx

The existing Command Center provides a mature horizontal workflow vocabulary.

Current team labels include:

- support;
- finance;
- safepay;
- trust_safety;
- marketplace.

Current workflow queues include:

- all active;
- needs human;
- AI handling;
- assigned to me;
- unassigned;
- awaiting customer;
- escalated;
- SLA breach;
- failed/dead letter;
- resolved.

Capabilities include assignment, escalation, human reply, resolve/reopen, SLA management, delivery recovery, provider health and audit.

The Operations Control Plane should reuse these concepts where appropriate rather than inventing incompatible queue semantics.

## 5.19 Feature Governance

File:

- web/src/pages/dashboard/admin/FeatureGovernanceConsole.tsx

This provides real platform operations for feature lifecycle, environment, rollout overrides, role bounds, percentage rollout and audit.

This belongs under Platform Operations, not routine Customer/Vehicle review.

## 5.20 Government portal

Files:

- web/src/pages/dashboard/government/*

The Government dashboard has been deliberately corrected so it does not pretend CarUp has a live ZIMRA registry integration where one does not exist.

Preserve that honesty.

Do not allow a CarUp "government-looking" screen to create an authoritative government fact without an actual authorized source.

Important routing mismatch to revalidate:

government.governance-review is registered for government but the originating App.tsx places a government governance route inside the Admin DashboardLayout.

Correct when this area is touched.

## 5.21 Finance

Files:

- web/src/pages/dashboard/bank/*
- backend/services/finance/*
- backend/routes/financeRoutes.js

A lending application queue exists.

The repository has been hardened to avoid treating Vehicle Trust as borrower creditworthiness.

External live lender activation remains a separate concern.

Finance Operations must not be implemented as a generic Admin changing lender decisions unless that authority is deliberately defined.

## 5.22 Insurance

Files:

- web/src/pages/dashboard/insurance/*
- backend/services/insurance/*

The originating Insurance dashboard truthfully exposes several unavailable states because the required claims/policy read model is not fully live.

Do not fabricate operating metrics to make the future Operations dashboard look populated.

## 5.23 Service Network

At the originating exact candidate there was no backend/services/serviceNetwork directory.

Mechanic UI and PartSentry foundations exist, but the richer Service Network Foundation was being developed in another lane/PR.

Therefore:

- do not assume Service Network Operations exists on this branch;
- re-check the implementation HEAD;
- consume the integrated Service Network contract only if it is actually present;
- otherwise leave Service Operations as a future slice.

## 5.24 PartSentry

The repository already contains trustGovernance/partsentryReviewService.js, partsentry review routes, a partsentry review migration and public-card suppression rules.

The admin reviewer UI is not yet a complete unified Operations surface.

Keep no-self-approval and public-card governance intact.

## 5.25 SafeTrade / SafePay

Diaspora SafeTrade foundations and an operations seam exist, but the originating UI is feature-flagged/hidden and payment operation is not to be represented as live custody unless the provider is actually active.

Do not build Transaction Operations on sandbox assumptions and label it production.

## 5.26 Audit

trust_audit_events is a strong central foundation, but the repository also contains other audit/event ledgers.

The first Serena slice should reuse existing audit paths.

A future unified Audit Console may aggregate multiple ledgers but must not rewrite them.

---

# 6. The realized architectural problem

The current structure is mostly:

~~~text
Feature needs privileged action
    ↓
Add /admin/... page
    ↓
Authorize admin/government
    ↓
Repeat for next feature
~~~

This has produced valuable domain functionality but creates four systemic problems.

## 6.1 Admin has become an overloaded word

Admin can mean platform configuration, evidence reviewer, marketplace moderator, support agent, trust reviewer, fraud reviewer, dealer compliance or referral operator.

Those are not the same authority.

## 6.2 Stakeholder role and operating job are being conflated

Owner, dealer, mechanic, bank, insurer and government are stakeholder/partner identities.

Evidence Reviewer or Marketplace Moderator is an operating capability.

Do not model them as equivalent axes.

## 6.3 Domain review and source authority can be confused

A reviewer can inspect a document without becoming the issuer of the underlying fact.

## 6.4 Existing operational surfaces are hard to discover as one system

Several real Admin features have no normal sidebar placement.

Operations needs information architecture and orchestration before it needs another large dashboard.

---

# 7. Target authority model

Use four separate dimensions.

~~~text
AUTHENTICATED USER
    │
    ├── Stakeholder / portal identity
    │     owner
    │     dealer
    │     mechanic
    │     bank
    │     insurance
    │     government
    │
    ├── Platform authority
    │     none
    │     operator / admin compatibility
    │     platform_admin
    │     super_admin
    │
    ├── Operations memberships
    │     customer_operations
    │     identity_operations
    │     seller_compliance
    │     vehicle_evidence
    │     trust_passport
    │     marketplace
    │     risk
    │     dealer_compliance
    │     service_network
    │     finance_operations
    │     insurance_operations
    │     transaction_operations
    │     security_audit
    │
    └── Capabilities + scope
          operations.vehicle_evidence.review
          operations.seller_authority.review
          operations.marketplace.moderate
          operations.risk.resolve
          ...
          scope = global / tenant / case / VIN / jurisdiction / partner
~~~

The implementation should migrate toward this model incrementally.

Do not attempt a destructive all-routes RBAC rewrite in the Serena slice.

---

# 8. Capability vocabulary — target, not mandatory first migration

Potential capability names:

- operations.accounts.read
- operations.accounts.support
- operations.identity.review
- operations.seller_compliance.review
- operations.vehicle.read_private
- operations.vehicle_evidence.review
- operations.vehicle_evidence.classify
- operations.seller_authority.review
- operations.passport.review
- operations.trust.review
- operations.governance.review
- operations.marketplace.moderate
- operations.marketplace.request_evidence
- operations.risk.investigate
- operations.risk.resolve
- operations.disputes.manage
- operations.communications.handle
- operations.dealer_compliance.review
- operations.service_network.manage
- operations.partsentry.review
- operations.finance.manage
- operations.insurance.manage
- operations.transaction.review
- operations.audit.read
- operations.feature_governance.manage
- operations.platform.emergency

Rules:

1. Capability checks are server-authoritative.
2. Client navigation reflects capability but does not grant it.
3. Platform Admin may hold broad capabilities but should not be the routine assigned operator.
4. External partners receive only domain-appropriate scope.
5. A tenant role must never become global CarUp Operations authority by header selection.
6. Consequential private-evidence actions should require proven sessions.

---

# 9. Operating-function map

| Operating function | Appropriate operator | Existing CarUp surface/foundation | Target direction |
|---|---|---|---|
| User/account problems | Customer Operations | /admin/users + Communications | Separate support capability from platform admin |
| Identity verification | Identity Operations | /admin/verification | Preserve strong case workflow |
| Seller verification/authority | Seller Compliance / Vehicle Ops | seller-claim partial flow | Build governed authority review |
| Vehicle evidence | Evidence Reviewer | /admin/evidence | Canonical taxonomy + bounded review |
| Passport discrepancies | Trust/Passport Reviewer | trust + governance review | Compose, do not duplicate |
| Marketplace listing risk | Marketplace Moderator | /admin/moderation | Keep public-visibility authority separate |
| Fraud/risk | Risk Operations | /admin/fraud-queue | Preserve publication block semantics |
| Buyer/seller disputes | Resolution/Support | governance disputes + Communications | Converge assignment/communication later |
| Communications | Customer Operations | /admin/communications | Reuse queues/SLA/assignment |
| Dealer onboarding | Dealer Compliance | /admin/dealer-compliance | Specialist bounded workflow |
| Garage/mechanic issues | Service Network Operations | mechanic/PartSentry; Service Network branch may differ | Future slice after integration |
| Finance applications | Finance partner / Finance Ops | /bank + finance services | Partner/domain authority |
| Insurance | Insurer / Insurance Ops | /insurance-dash + insurer services | Future read model/provider activation |
| SafePay/escrow | Transaction Operations | escrow/SafeTrade seams | Only after live authority is real |
| Government records | Authorized government/integration | /government + provider framework | Never generic Admin certification |
| Platform configuration | Platform Admin | /admin/features | Platform Operations |
| Feature rollout | Platform Admin / Engineering Ops | Feature Governance | Keep runtime governance |
| Audit/security | Security/Audit authority | trust_audit_events + other ledgers | Future unified read view |

---

# 10. Governance Admin Contract

This section is the core architectural contract.

## G1 — Platform authority is not source authority

Platform Admin can administer CarUp.

Platform Admin does not automatically have the right to claim that CVR, ZIMRA, an insurer or a bank confirmed a fact.

## G2 — Operational capability is server-derived

Do not accept a UI portal selection or x-stakeholder-role header as proof of privileged authority.

Use server-derived user/session/tenant/capability context.

## G3 — Super Admin is exceptional authority

Super Admin is intended for emergency controls, platform access administration, critical escalation and system configuration.

Routine cases should be assigned to specialist operators.

## G4 — Least privilege

Every operating role receives only the records, actions and scope needed.

## G5 — No self-certification

Independent verification must prevent the source/requester from becoming their own final verifier when the policy requires independence.

## G6 — Decisions are attributable

Material decisions record actor, base platform authority, operating capability, tenant/scope, target, decision, reason, evidence IDs, previous state, new state, request/correlation ID and policy version when applicable.

## G7 — Private evidence does not become public content

The existence or outcome of a restricted artifact may support a buyer-safe statement.

The raw artifact remains restricted.

## G8 — One authoritative writer per fact

Vehicle Operations may display Trust, Fraud and Marketplace states.

It must call their existing canonical services for mutation.

Do not create a second writer because a combined screen is convenient.

## G9 — AI never converts uncertainty into authority

An AI confidence score must not become Verified.

## G10 — Failure is not success

If a review dependency cannot be read, show unavailable and fail closed where the action depends on it.

## G11 — Seller statements remain seller statements

A Seller can state registration stage, accident disclosure, finance disclosure, insurance disclosure and condition.

Review can assess consistency and evidence.

It cannot rewrite the historical origin of the statement.

## G12 — External facts retain external provenance

If an external provider confirms a fact, store the source/provider reference and authority basis.

## G13 — Review and correction preserve history

Use supersede/amend/review-decision patterns.

Do not silently mutate an immutable source artifact to make the current UI cleaner.

## G14 — Seller retains commercial agency

Operations clears governance blockers.

Seller chooses Publish, Unpublish, change price and mark sold where policy allows.

## G15 — Moderation is not verification

Marketplace moderation answers:

> May this listing be publicly visible?

It does not necessarily answer:

> Is every Seller claim externally verified?

## G16 — Seller authority is not local registration

A seller may have sufficient reviewed authority to list a permanent import before local registration is complete.

## G17 — Finance/insurance are separate domains

An active finance obligation or insurance state must not be silently transformed into vehicle Trust.

## G18 — Public copy is a governed projection

No frontend component invents stronger badge text from raw internal fields.

---

# 11. Truth-level model

Use this conceptual hierarchy in UI labels and API DTOs.

## Level 0 — Not established

No reliable source is recorded.

Example:

- Zimbabwe customs clearance not established.

## Level 1 — Artifact observed

CarUp can prove a file or event was received.

Example:

- Commercial Invoice uploaded.

## Level 2 — CarUp reviewed

An authorized reviewer confirmed classification, relevance, consistency, legibility or association with the vehicle.

Example:

- Import / Commercial Invoice — reviewed.

## Level 3 — CarUp governed policy decision

CarUp can make a policy decision it owns.

Examples:

- Seller authority to list confirmed under CarUp policy.
- Listing permitted for Marketplace.
- Fraud signal resolved false positive.

## Level 4 — External authoritative fact

A legitimate external authority confirms the fact.

Examples:

- CVR registration confirmed.
- ZIMRA customs clearance confirmed.
- Insurer policy active.
- Lender payoff/encumbrance confirmed.

## Level 5 — Public-safe projection

A buyer receives a safe summary derived from Levels 0–4.

Example:

~~~text
Seller authority: Reviewed by CarUp
Zimbabwe registration: Local registration pending
Import journey: Documented
CVR registration: Not yet recorded
~~~

---

# 12. Operations orchestration model

The Operations layer should initially compose existing domain authorities.

Do not create a generic operations_cases table in Milestone 1 simply because the concept sounds reusable.

First prove the Serena vertical slice.

A future reusable Operations Case may have:

- case_id;
- case_type;
- subject_type;
- subject_id;
- VIN;
- status;
- priority;
- assigned_team;
- assigned_operator;
- required_capability;
- SLA;
- linked domain records;
- resolution summary.

But the case must only orchestrate.

It must not duplicate vehicle_evidence, trust_fact_requests, fraud cases, marketplace moderation, identity sessions, communications threads or disputes.

Extraction of a generic case model belongs after at least two real operating domains prove common requirements.

---

# 13. Serena evidence truth baseline

Do not re-upload or delete Serena evidence merely to make the gate pass.

The known source pack contains seven source documents:

1. Kingstone identity/passport document.
2. BE FORWARD commercial invoice.
3. PayPal purchase/payment receipt.
4. House Bill of Lading.
5. Japanese Export Certificate.
6. Tanzania T1 through-transit declaration.
7. Zimbabwe CBCA/Cotecna roadworthiness/inspection certificate.

Intended canonical classification:

| Artifact | Evidence class | Evidence subtype | Normal visibility |
|---|---|---|---|
| Kingstone identity | Account/Seller identity authority, not Vehicle Life public document | Identity workflow | Restricted/private |
| BE FORWARD invoice | import | commercial_invoice | Restricted |
| PayPal receipt | import | payment_receipt | Restricted |
| House Bill of Lading | import | bill_of_lading | Restricted |
| Japanese Export Certificate | import | export_certificate | Restricted |
| Tanzania T1 | import | transit_declaration | Restricted |
| CBCA/Cotecna | inspection | roadworthiness | Restricted unless a safe derived projection is approved |

Important:

- no supplied Zimbabwe CVR registration book;
- no supplied Zimbabwe local plate record;
- no supplied Zimbabwe TIP;
- Tanzania T1 is not TIP;
- Japanese Export Certificate is not Zimbabwe registration;
- import documents may contribute to Seller authority assessment but do not become CVR registration documents.

---

# 14. Serena first-slice target state

The desired truthful state is structurally similar to:

~~~text
Vehicle
2016 Nissan Serena Highway Star
Identifier GFC27-027051

Seller authority
Reviewed / confirmed under CarUp policy

Zimbabwe registration
A legitimate pending permanent-import stage
Source: Seller statement and/or governed evidence as actually available

CVR registration
Not recorded unless authoritative evidence exists

Zimbabwe plate
Not required for a legitimate pending stage

TIP
Not applicable unless the vehicle is genuinely on temporary foreign admission

Import journey
Documented through canonical evidence classes

Roadworthiness
Evidence reviewed, with source/provenance shown

Fraud/risk
No unresolved blocking case

Fact reconciliation
No unresolved material contradiction

Marketplace readiness
Publishable

Final action
Kingstone clicks Publish
~~~

The exact registration sub-stage must be determined from actual Serena records and any later evidence, not assumed by this document.

---

# 15. Milestone framework

The first implementation programme is M0–M8.

The later Control Plane programme is O2–O10.

The agent must not expand into O2–O10 during the Serena implementation unless required to fix a direct blocker.

Task states in the implementation progress file:

- [ ] not started / not proven
- [~] in progress
- [x] cleared with evidence
- [!] externally or safely blocked

A task is not complete because code exists.

It is complete when the acceptance proof is recorded.

---

# 16. M0 — Revalidate, freeze and map the exact implementation HEAD

## Objective

Prove what exists before any product change.

## Required work

1. Record branch, HEAD SHA, merge base, working-tree status and open PRs touching the same domains.
2. Confirm whether the originating Seller branch has advanced.
3. Confirm exact frontend/backend staging pairing if staging is used.
4. Inspect:
   - vehiclesRoutes seller-claim flow in full;
   - completeness evaluator;
   - evidence taxonomy;
   - evidence upload UI;
   - evidence review routes;
   - governance review;
   - trust fact review;
   - fraud;
   - Marketplace moderation;
   - public projection;
   - seller publish UI;
   - relevant migrations.
5. Inspect Serena records read-only.
6. Create docs/features/CARUP_OPERATIONS_CONTROL_PLANE_PROGRESS.md.
7. Add an M0 code/current-state delta table.

## Serena read-only inventory

At minimum record:

- vehicles row;
- publication_status;
- availability status;
- registration_status;
- registration_status_source;
- plate/temp permit fields;
- owner_id/current_seller_id/tenant relationship;
- all vehicle_evidence rows;
- legacy evidence_type;
- evidence_class;
- evidence_subtype;
- visibility_level;
- verification_status;
- uploaded_by;
- source_id;
- checksums;
- linked events;
- extractions;
- unresolved fact conflicts;
- seller-authority claim events;
- trust-fact requests;
- fraud cases;
- governance review tasks;
- current completeness result;
- canonical Trust state.

## Acceptance

No write is performed to Serena during M0.

The progress file contains a precise current-state map.

## Stop conditions

Stop before mutation if current Serena evidence cannot be safely distinguished, candidate data is on production rather than staging, a newer PR changed Seller authority semantics in a conflicting way, or a destructive migration would be needed.

---

# 17. M1 — Canonical evidence semantics become authoritative

## Objective

Prevent legacy evidence_type from overriding the meaning of the newer Vehicle Life taxonomy.

## Core rule

For new and governed records:

~~~text
semantic meaning = evidence_class + evidence_subtype
artifact form = document/photo/etc
legacy evidence_type = compatibility only
~~~

Do not allow a legacy registration_document field to override canonical import / commercial_invoice semantics.

## Backend work

Inspect and update as necessary:

- backend/services/evidence/evidenceTaxonomy.js
- backend/services/evidence/evidenceService.js
- backend/services/evidence/completenessEvaluator.js
- public projection helpers
- evidence review services
- extraction document-type mapping
- source/provenance services

Create one canonical helper that answers questions such as:

- Is this a registration artifact?
- Is this ownership-transfer evidence?
- Is this import evidence?
- Is this a Seller-authority candidate?
- Is this a document artifact?
- May this subtype contribute to a particular publication requirement?

The helper must prefer canonical class/subtype when present.

Legacy rows with no canonical classification may fall back to legacy mapping.

## Upload UI work

Refactor EvidenceUploadModal or its replacement so a user selects:

1. life stage / evidence class;
2. subtype;
3. file;
4. visibility.

Do not force an owner to choose "Registration Document" merely to upload a commercial invoice PDF.

The file being PDF is not the semantic category.

## Migration/backfill rule

Do not blindly rewrite historical evidence.

If a migration/backfill is required:

- make it additive;
- use deterministic mappings only;
- record provenance;
- produce a dry run;
- preserve original legacy value;
- do not reinterpret ambiguous rows automatically.

Serena may need a governed classification correction if stored rows are contradictory.

Any correction must preserve the original record/provenance and record who/what changed the interpretation.

## Public display

Evidence cards/timeline must display canonical classification first.

Legacy compatibility labels must not produce a visible "Registration Document" card for an artifact canonically classified as Import / Commercial Invoice.

## Tests

Must cover:

- canonical import/commercial_invoice with legacy registration_document does not count as registration;
- canonical import/transit_declaration never becomes TIP;
- canonical import/export_certificate is not Zimbabwe registration;
- registration/registration_book does count as registration evidence where policy allows;
- ambiguous legacy-only records preserve backwards compatibility;
- private visibility remains private;
- public projection never leaks file URL for private evidence;
- Serena seven-document classification matrix.

## Acceptance

Every Serena artifact displays under the correct lifecycle class/subtype.

No Serena import artifact is being counted as Zimbabwe registration solely because of legacy evidence_type.

---

# 18. M2 — Seller Authority becomes a first-class governed concept

## Objective

Answer:

> Does this Seller have sufficient reviewed authority to offer this vehicle on CarUp?

without answering the different question:

> Has Zimbabwe local registration been completed?

## First rule

Inspect the existing /api/vehicles/:vin/seller-claim implementation before designing schema.

The current flow is already partially implemented.

Do not duplicate it.

## Target authority states

The implementation may use existing records or an additive dedicated model, but the public/internal state machine should be equivalent to:

- not_assessed;
- evidence_submitted;
- under_review;
- confirmed;
- insufficient;
- disputed;
- revoked.

Names may be adapted to repository conventions if documented.

## Recognition paths

### Existing canonical relationship

If CarUp already has a governed owner/current-seller/tenant relationship, authority can be recognized according to current ownership rules.

### Locally registered vehicle

A reviewed ownership/registration evidence set can support Seller authority.

### Permanent import awaiting local registration

Authority may be supported by an evidence set such as:

- seller identity;
- purchase/commercial invoice;
- payment record;
- Bill of Lading/consignee relationship;
- export record;
- canonical vehicle identity;
- Seller declaration;
- no unresolved conflicting authority claim.

This can support CarUp Seller authority without asserting Zimbabwe registration.

### Dealer

Dealer authority must respect tenant/dealer compliance and inventory relationship.

## Strong wording rule

Internal state:

- seller_authority = confirmed

Public copy:

- Seller authority reviewed by CarUp

Do not say Legal title certified or CVR ownership verified unless the corresponding external source supports it.

## Reviewer authority

Initial Serena implementation may remain admin-backed internally for compatibility, but the code must introduce a bounded Seller Authority review capability/service boundary rather than treating every Admin action as globally equivalent.

If capability persistence is not yet introduced, isolate policy in one service so later RBAC replacement is mechanical.

## No self-approval

Seller cannot confirm their own authority.

## Conflict handling

If another owner/current seller exists or evidence conflicts:

- do not overwrite relationship;
- create/route a review;
- support dispute/escalation;
- preserve one Passport.

## Audit

Record claim, evidence basis, reviewer, decision, reason, policy version, conflict state and resulting authority state.

## Tests

Must cover:

- existing relationship recognized;
- import evidence set can support Seller authority without registration;
- commercial invoice alone is insufficient unless policy explicitly says otherwise;
- Seller cannot approve own claim;
- conflicting current seller blocks auto-confirmation;
- revoked/disputed authority blocks appropriate operations;
- no duplicate Vehicle Passport;
- cross-user and cross-tenant access denied.

## Acceptance

Serena can obtain a governed Seller authority decision without fake CVR/TIP evidence.

---

# 19. M3 — Reconcile publication completeness with the new authority model

## Objective

The publication gate must ask the correct questions.

## Old problematic question

~~~text
Do we have a verified legacy registration_document or ownership_transfer_document?
~~~

## Target questions

~~~text
1. Is the vehicle identity sufficiently recorded?
2. Is the Seller authorized to list under governed CarUp policy?
3. Is the Zimbabwe registration lifecycle stage truthfully recorded?
4. Is that registration stage ordinarily listable?
5. Are there unresolved material document contradictions?
6. Is there a blocking fraud/risk/governance condition?
7. Are required listing data/media complete?
8. Are other explicit publication requirements satisfied?
~~~

## Registration readiness

Keep using the canonical Zimbabwe lifecycle helper.

A permanent-import pending stage may be non-blocking.

Locally registered requires appropriate local registration information.

TIP remains its own special policy state.

Unknown fails closed where publication policy requires a known stage.

## Evidence requirement

Replace the generic Ownership / Registration Document blocker with semantically accurate requirements.

Possible separate requirements:

- Seller authority;
- Registration evidence, only when required by lifecycle stage;
- Document reconciliation;
- vehicle identity;
- listing completeness.

Do not force a permanent-import pending vehicle to upload a nonexistent registration book.

## Finance/insurance

Preserve the accepted Seller convergence rule:

- active finance/encumbrance can coexist with a listing when truthfully disclosed and governed;
- finance is not an automatic Trust penalty;
- insurance state is not a fabricated clearance signal.

## Seller-facing refusal

If publication is blocked, response/UI must distinguish:

- Missing from Seller;
- Awaiting CarUp review;
- Awaiting external authority;
- Conflict requires action;
- Policy-blocked.

## Tests

Must include:

- Serena-like permanent import with Seller authority confirmed and registration pending → publishable if all other blockers clear;
- same vehicle with registration stage unknown → correct block;
- TIP state → correct policy outcome;
- import invoice misclassified through legacy field cannot satisfy registration;
- locally_registered without required local plate/book remains incomplete;
- unresolved extraction conflict blocks;
- blocking fraud case blocks;
- finance disclosure alone does not block;
- restricted evidence can satisfy internal requirement without becoming public artifact.

## Acceptance

No path exists where a Serena import document accidentally satisfies a Zimbabwe registration requirement through its legacy field.

---

# 20. M4 — Vehicle Operations Review surface

## Objective

Give a specialist reviewer one VIN-centered workspace that composes existing domain authorities.

Recommended initial route:

- /admin/vehicles/:vin/review

A future /operations route can be introduced later if warranted.

Do not rename all existing Admin routes in this slice.

## Reviewer screen composition

### A. Vehicle identity

Show:

- make;
- model;
- year;
- canonical identifier;
- chassis/frame identifier;
- engine number if authorized;
- Passport state;
- listing/publication state.

### B. Seller

Show:

- Seller identity summary;
- account verification state;
- seller/dealer type;
- current canonical owner/seller/tenant relationship;
- Seller authority claim/review state.

Do not show security tokens.

### C. Zimbabwe registration lifecycle

Show:

- canonical stage;
- stage source;
- whether stage is seller-stated, reviewed or authoritative;
- local plate requirement;
- TIP applicability;
- current publication impact.

### D. Evidence set

Group by canonical class:

- import;
- inspection;
- registration;
- ownership transfer;
- accident;
- repair;
- current condition;
- etc.

Each row should expose only reviewer-authorized fields:

- subtype;
- verification state;
- visibility;
- source;
- checksum/provenance;
- uploader;
- linked event;
- extraction status;
- review history.

### E. Document intelligence

Reuse current extraction review.

Show unresolved material conflicts.

Do not duplicate extraction mutation code.

### F. Seller authority

Show:

- current status;
- basis;
- evidence IDs;
- conflicts;
- permitted decision actions.

### G. Trust / governance

Display:

- canonical Trust evaluation state;
- applicable trust-fact requests;
- governance findings.

Action links should route/call canonical Trust/Governance services.

### H. Fraud / risk

Show:

- open cases;
- publication blocking;
- severity;
- links/actions allowed by Risk capability.

### I. Marketplace readiness

Show a requirement matrix:

- requirement;
- source;
- state;
- blocking;
- who must act next.

### J. Audit

Show relevant safe audit trail.

### K. Communications

Show or link relevant support/trust conversation context only where authorized.

Do not dump account-security messages into a reply thread.

## Action rules

Allowed actions may include:

- confirm/correct evidence classification;
- verify/reject evidence;
- request more evidence;
- review Seller authority;
- open/resolve permitted governance task;
- navigate to fraud/moderation;
- send governed request/notification.

Do not add direct buttons for:

- "Verify ZIMRA" without ZIMRA source;
- "Register CVR" without CVR integration;
- "Make Trust 80";
- "Publish now as Admin" as routine workflow.

## Backend aggregation

A reviewer read endpoint may aggregate existing domain data for the page.

Example target:

- GET /api/admin/vehicles/:vin/review

The aggregate DTO is a read model, not a new source of truth.

Every mutation calls the owning service.

## Security

The reviewer aggregate must:

- require authenticated proven session;
- enforce platform/capability scope;
- never accept x-user-id fallback in staging/production;
- never return unrestricted storage paths;
- mint short-lived signed URLs only through existing private-evidence controls;
- redact unrelated PII.

## Acceptance

Reviewer can understand Serena's complete operational state from one screen without manually opening five disconnected consoles.

---

# 21. M5 — First bounded Operations capability layer

## Objective

Stop expanding raw Admin authority while avoiding a dangerous all-at-once RBAC rewrite.

## Required design

Create one centralized Operations authorization policy/service.

It should be able to answer:

- Does this user have capability X?
- Under what scope?
- Is this a platform emergency override?
- Is this a tenant/partner role?
- Is this a proven session?

The implementation may initially map existing admin/government roles into capabilities for compatibility.

Example:

~~~text
admin
→ operations.vehicle_evidence.review
→ operations.seller_authority.review
→ operations.marketplace.moderate
...

government
→ only the government/reviewer capabilities explicitly intended
~~~

But new code must authorize against the centralized policy rather than sprinkling more direct role checks.

## Do not do yet

Do not rewrite every historic route in CarUp.

Apply the capability layer to:

- new Vehicle Operations aggregate;
- Seller authority decision;
- any modified Evidence review action;
- any new queue.

Then migrate old domains iteratively.

## Platform Admin

Map backend platform_admin/super_admin deliberately.

Frontend must not accidentally redirect a valid platform authority because shared UserRole cannot represent it.

Choose and document a compatibility strategy.

## Operator provisioning

Do not use normal public /auth/register to create privileged operators.

If operator provisioning is needed in this slice, implement an explicit admin-only invite/provisioning path or seed only a staging test operator through an approved safe mechanism.

## Acceptance

The Serena review can be executed by an authorized operator without making "Admin" the only conceptual authority in new code.

---

# 22. M6 — Operations navigation and discoverability

## Objective

Make the existing operating surfaces understandable as one system without rewriting them.

## Admin/Operations information architecture

Group existing routes conceptually:

### People

- Users / Customer Operations;
- Identity Verification;
- Dealer Compliance.

### Vehicles & Trust

- Vehicle Operations;
- Evidence Review;
- Trust Review;
- Governance Review;
- Fraud Queue.

### Marketplace

- Marketplace Moderation;
- inquiries.

### Communications

- Command Center.

### Growth / Diaspora

- Referral Operations;
- Diaspora operator consoles.

### Platform

- Feature Governance;
- AI Monitoring;
- future Security/Audit.

## Navigation corrections

Revalidate and correct:

- features with placements: [] that should be discoverable;
- duplicate/unreachable routes;
- government governance route ownership;
- wrong-role visible buttons;
- platform_admin/super_admin route compatibility.

## UI principle

Do not populate the Operations landing page with invented metrics.

Every number must have a real read model and a defined denominator.

If a metric is unavailable, say so.

## Acceptance

An authorized operator can find the Vehicle Operations route and existing specialist consoles through a coherent navigation hierarchy.

---

# 23. M7 — Serena governed review and owner UAT

## Objective

Take the real Serena from its current draft/pending-review state to a truthfully publishable state using the new Operations path.

## Required staging sequence

1. Confirm exact staging frontend/backend SHA pairing.
2. Sign in with the authorized Operations test account.
3. Open Serena Vehicle Operations.
4. Confirm evidence classification.
5. Correct only proven classification defects through governed actions.
6. Review the seven evidence items.
7. Resolve material extraction conflicts if present.
8. Review Seller authority.
9. Confirm actual Zimbabwe registration stage/source.
10. Confirm no fake local plate/TIP.
11. Confirm no unresolved fraud/governance block.
12. Re-run completeness.
13. Confirm canonical Trust re-materializes if relevant evidence decisions changed.
14. Confirm state is Publishable.
15. Sign out of Operations.
16. Sign in as Kingstone.
17. Open the existing Serena draft.
18. Confirm the listing shows the correct pending-registration disclosure.
19. Click Publish as Kingstone.
20. Verify public Marketplace card.
21. Verify Vehicle Detail/Passport.
22. Verify restricted source documents are not exposed.
23. Verify public copy says only what CarUp can support.
24. Verify buyer inquiry path remains functional.
25. Verify unpublish/republish remains functional where policy allows.

## Required screenshots/evidence

At minimum:

- Vehicle Operations overview;
- canonical evidence grouping;
- Seller authority decision;
- registration readiness;
- publication requirement matrix;
- Seller-side Publish control;
- public Marketplace card;
- public Vehicle Detail/Passport evidence summary;
- proof restricted file is unavailable to buyer.

## Serena success criteria

Serena can be listed while local registration is pending if all actual conditions permit.

The public listing must not claim Zimbabwe registration completed, Zimbabwe plate issued, TIP exists or customs/ZIMRA confirmation exists unless those facts are truly supported at UAT time.

---

# 24. M8 — Extract reusable Operations patterns after Serena

## Objective

Generalize only what Serena proved.

## Review questions

After Serena, inspect:

- which work states were reused from Communications;
- whether assignment/SLA is actually needed for Vehicle Operations;
- whether a generic operations_case is justified;
- whether seller_authority deserves its own table;
- whether capability membership needs persistent schema;
- whether Vehicle Operations queue needs a normalized task model;
- which existing Governance review_tasks already cover the need.

## Decision gate

Do not create a generic Operations workflow engine merely because it appears architecturally elegant.

Create reusable infrastructure only when:

- at least two operating domains need the same concept;
- domain canonical records remain intact;
- migration cost is justified;
- security scope is defined.

---

# 25. Later domain slices — architecture roadmap, not current Serena scope

## O2 — People & Compliance

Integrate account support, identity verification, seller compliance, dealer compliance and operator provisioning.

Goal: one People operating model with separate authorities.

## O3 — Marketplace Safety

Integrate moderation, fraud, listing complaints, evidence requests and buyer inquiry risk.

Goal: Marketplace public-visibility decisions without rewriting Trust.

## O4 — Customer Operations

Use Communications foundation for support, assignment, SLA, disputes, escalation and customer history.

Goal: customer cases link to domain state without Communications becoming the domain truth.

## O5 — Service Network Operations

Only after the Service Network backend is present in the implementation authority.

Potential scope:

- garage onboarding;
- mechanic affiliation;
- service-case escalation;
- capability disputes;
- PartSentry review;
- evidence conflicts.

## O6 — Finance Operations

Coordinate applications, partner/lender routing, vehicle encumbrance and provider exceptions.

CarUp must not issue lender decisions unless contractually authorized.

## O7 — Insurance Operations

Coordinate insurer integrations, policy evidence, claims, risk provider results and exceptions.

Do not fabricate claims KPIs.

## O8 — Transaction Operations

Only when SafePay/escrow live authority exists.

Coordinate payment states, reconciliation, release holds, disputes and transaction exceptions.

## O9 — Government/Provider Operations

Coordinate CVR, ZIMRA, CID/ZRP, inspection provider, provider health and reconciliation.

External source is authoritative.

## O10 — Security & Platform Operations

Coordinate access reviews, audit search, platform incidents, feature governance, provider health and emergency controls.

---

# 26. Target data architecture

## Existing authorities to preserve

The implementation agent must inspect and reuse as applicable:

- users;
- user_sessions;
- tenant_users;
- vehicles;
- listing_images;
- vehicle_evidence;
- evidence_sources;
- evidence_provenance_events;
- vehicle_document_extractions;
- trust_fact_requests;
- trust_audit_events;
- review_tasks;
- review_decisions;
- disputes;
- dispute_events;
- fraud cases/signals;
- dealer compliance records;
- communications threads/messages/workflow;
- finance obligation records;
- provider registries/requests;
- PartSentry review requests;
- listing publication fields.

## Possible future additions

Only after schema discovery.

### Seller authority review

A dedicated table may be justified if the audit-event-only claim implementation cannot safely support state lifecycle, active/current decision, supersession, dispute, evidence basis and idempotency.

Do not create it before proving the current seller-claim flow is insufficient.

### Operations membership/capabilities

A persistent table may eventually model:

- user_id;
- team;
- capability;
- scope_type;
- scope_id;
- validity;
- granted_by;
- audit fields.

Again, first reuse existing auth/tenant structures and add only what the first slice requires.

### Operations cases

Deferred to M8 decision.

---

# 27. API design guidance

New APIs should be thin and domain-aware.

## Recommended reviewer aggregate

Possible:

- GET /api/admin/vehicles/:vin/review

Response groups:

- vehicle;
- seller;
- registration_readiness;
- evidence_summary;
- extraction_conflicts;
- seller_authority;
- trust_summary;
- governance_summary;
- risk_summary;
- publication_readiness;
- audit_summary;
- allowed_actions.

allowed_actions must be server-derived.

## Seller authority decision

Do not name until the current seller-claim service is fully inspected.

Possible approaches:

- extend seller-claim with reviewer decision routes;
- extract sellerAuthorityService;
- add dedicated review resource.

Whichever route is chosen:

- idempotency;
- reason;
- evidence basis;
- audit;
- no self-approval;
- scope;
- notifications.

## Evidence classification correction

Prefer a specific governed correction action over an unrestricted PATCH to arbitrary evidence fields.

The original source record/provenance must remain reconstructable.

## Mutations

Vehicle Operations UI should call:

- evidence service for evidence;
- extraction service for extraction review;
- seller authority service for authority;
- trust fact service for Trust facts;
- governance service for governance decisions;
- fraud service for risk;
- Marketplace service for moderation.

No combined "Approve everything" endpoint.

---

# 28. UI/UX contract

## Operations surfaces are decision workspaces

Each screen should answer:

1. What requires attention?
2. Why?
3. What evidence supports it?
4. What can this operator do?
5. What happens after the decision?
6. Who must act next?
7. What will the customer see?

## Status design

Use explicit labels:

- Missing;
- Submitted;
- Awaiting CarUp review;
- Awaiting external source;
- Reviewed;
- Confirmed by source;
- Disputed;
- Rejected;
- Unavailable;
- Not evaluated;
- Publishable;
- Blocked.

Avoid vague Good, Safe or Clear unless a defined domain policy owns that meaning.

## Dashboard metrics

A count should have a real data source, time window, scope and meaningful denominator when needed.

Never recreate the historical fabricated Admin/Bank/Insurance/Government metrics that were already removed.

---

# 29. Security and privacy requirements

## Authentication

Consequential Operations actions require proven sessions.

No production/staging x-user-id fallback.

## Authorization

Backend is authoritative.

Frontend hiding is not security.

## Tenant scope

Dealer/mechanic/partner access is scoped to the correct tenant/resource.

Tenant admin is not platform admin.

## Private evidence

Private artifacts:

- never become public URLs;
- use signed access only after authorization;
- are not embedded in generic audit JSON;
- are not copied into Marketplace DTOs.

## PII

Reviewer aggregate returns only what the current task requires.

## Security tokens

Email verification/password reset tokens must never appear in Communications threads, notification body, Operations case text or audit public views.

## AI

Raw provider prompts/responses containing private material remain internal according to existing policies.

---

# 30. Audit and notification requirements

Every material reviewer decision should write or reuse an appropriate durable event.

Examples:

- EVIDENCE_CLASSIFICATION_CORRECTED;
- EVIDENCE_VERIFIED;
- EVIDENCE_REJECTED;
- SELLER_AUTHORITY_REVIEWED;
- GOVERNANCE_DECISION_APPLIED;
- MARKETPLACE_* moderation event;
- FRAUD_CASE_RESOLVED.

Event naming should follow current conventions after inspection.

Seller/customer notifications should say what changed and what action is required.

Do not create a reply-capable conversation for a one-way security delivery.

If additional evidence is requested, prefer a safe action notification and/or support/trust thread with no raw token or restricted document.

---

# 31. Known inconsistencies to resolve or explicitly defer

Claude must check each item.

- [ ] Evidence review queue roles versus approve/reject roles.
- [ ] reviewer appears in Governance roles but not shared UserRole.
- [ ] platform_admin/super_admin backend roles versus frontend route model.
- [ ] government governance route registry versus Admin layout placement.
- [ ] Admin real features with placements: [] and poor discoverability.
- [ ] EvidenceUploadModal legacy evidence_type requirement versus canonical taxonomy.
- [ ] Completeness evaluator legacy document-type blocker.
- [ ] Seller authority current dependency on legacy registration/ownership evidence type.
- [ ] UserManagement public registration path unsuitable for privileged operator provisioning.
- [ ] Service Network backend absent at originating candidate.
- [ ] Government portal cannot imply live authority without provider.
- [ ] Insurance operational read model incomplete.
- [ ] SafeTrade operations not to be called live payment authority while sandbox/hidden.
- [ ] Multiple audit stores and no unified operator read model.
- [ ] Old docs that still describe 17-character-only VIN eligibility must be reconciled with current Japanese chassis support.

Items outside the Serena critical path may be documented and deferred.

---

# 32. Test strategy

Testing is mandatory at each milestone, not only at the end.

## Backend unit tests

Cover:

- canonical classification;
- Seller authority policy;
- completeness predicates;
- registration readiness;
- authorization/capability;
- public projection;
- audit normalization;
- idempotency.

## Backend integration tests

Cover actual interactions among evidence, authority, completeness, Trust refresh, fraud and publication.

## Real PostgreSQL tests

Required for any migration, uniqueness, RLS, transactional decision paths and concurrency-sensitive reviewer decisions.

## Web unit/component

Cover:

- Vehicle Operations sections;
- allowed actions;
- missing/unavailable states;
- no false "Registration Document" legacy label;
- private evidence withheld;
- operator role state.

## Playwright

Desktop, tablet and mobile Chromium.

Required journeys:

- operator Serena review;
- wrong-role denial;
- seller after review;
- seller Publish;
- Marketplace card;
- Vehicle Detail;
- restricted evidence refusal;
- unpublish/republish regression;
- navigation.

## Existing affected gates

At implementation HEAD, enumerate and run all affected gates, including as applicable:

- Seller account/auth continuity;
- Seller F–G;
- Seller H–I–J;
- Seller K;
- Seller L–M;
- Seller Golden lifecycle;
- Vehicle Passport Foundation;
- Marketplace;
- Communications;
- navigation intent;
- Trust/governance;
- evidence;
- referral/diaspora only if touched.

Do not omit a gate because it is slow.

## Exact-head staging

Before Owner UAT:

- frontend SHA = backend SHA;
- unpaired = false;
- migrations match expected staging state;
- all independent affected CI green;
- long lifecycle gate green or its exact blocker truthfully recorded.

---

# 33. Migration policy

1. Prefer no migration when existing structures safely support the first slice.
2. If migration is required:
   - additive;
   - idempotent where project convention requires;
   - RLS/grants reviewed;
   - indexes reviewed;
   - rollback/forward-fix documented.
3. Never edit historical migration files that have been applied.
4. Never touch production without explicit authorization.
5. Staging migration apply requires the project-approved process.
6. Preserve Serena records.

---

# 34. Rollback strategy

## Code

Use normal Git revert/forward fix.

Do not hard-reset shared branches.

## Feature

New Operations surfaces should be feature-governed where appropriate.

A runtime disable must not remove underlying domain records.

## Schema

Prefer additive structures that can remain dormant.

If rollback of a new table is unsafe after decisions exist, disable consumers and forward-fix rather than destroy audit history.

## Serena

Do not "rollback" by deleting real UAT evidence.

If a review decision was wrong, reject/revoke/supersede using the governed workflow and preserve history.

---

# 35. Explicit non-goals for the Serena slice

Do not implement:

- the complete Operations Control Plane for all domains;
- live government integrations that are not provisioned;
- full insurance operating system;
- full bank/lender platform;
- full SafePay production settlement;
- complete Service Network admin if its backend is not integrated;
- generic operations case engine before M8;
- an organization HR/workforce system;
- a global replatform of every /admin route;
- arbitrary Trust score editing;
- fake demo metrics;
- direct production writes.

---

# 36. Definition of Done — Serena slice

The Serena slice is complete only when:

- [ ] Current-head discovery recorded.
- [ ] Serena original evidence preserved.
- [ ] Canonical evidence class/subtype is semantic authority.
- [ ] Legacy import-document misclassification cannot satisfy registration.
- [ ] Seller authority is governed separately from Zimbabwe registration.
- [ ] Permanent-import pending registration can be listable according to policy.
- [ ] Vehicle Operations reviewer screen is functional.
- [ ] New Operations actions use bounded server authority.
- [ ] All decisions are audited.
- [ ] Restricted evidence remains restricted.
- [ ] Serena has no unresolved blocker other than legitimately external/unavailable facts that policy allows.
- [ ] Kingstone can deliberately publish the existing Serena.
- [ ] Marketplace shows the real listing.
- [ ] Public copy truthfully discloses pending registration.
- [ ] No false CVR/ZIMRA/TIP/plate claim appears.
- [ ] Seller can unpublish/republish where policy allows.
- [ ] Existing Seller/Passport/Marketplace/Communications regressions remain green.
- [ ] Desktop/tablet/mobile UAT passes.
- [ ] Exact frontend/backend SHA pairing proven.
- [ ] Progress manual updated.
- [ ] PR remains unmerged until Product Owner approval.

---

# 37. Definition of Done — first Operations foundation

The foundation can be called established when:

- Vehicle Operations exists as a real specialist workflow;
- authority model distinguishes platform authority from domain operator capability;
- at least one capability policy is enforced server-side;
- existing domain writers remain canonical;
- Operations navigation is coherent;
- audit and privacy rules are proven;
- Serena real UAT passes;
- reusable patterns are documented based on evidence.

This does not mean every future Operations domain is complete.

---

# 38. Manual maintenance and iteration rule

This file is a living architecture manual.

After every material Operations milestone, update:

## Current implementation state

Record current routes, services, schemas, roles/capabilities and active/deferred domains.

## Decision log

For each architecture decision record:

- date;
- decision;
- reason;
- alternatives;
- code/migration;
- effect on older plan.

## Operations adoption matrix

Track each domain:

- not mapped;
- mapped;
- partial;
- implemented;
- certified.

## Known limitations

Never delete an old limitation merely because it is inconvenient.

Mark it closed with evidence.

## Benchmark appendix

Revalidate when a benchmark policy materially influences a new CarUp decision.

---

# 39. Agent execution protocol

During implementation:

1. Read this manual.
2. Read the Claude start prompt.
3. Read the Seller master tracker and Zimbabwe hardening plan.
4. Read DESIGN.md.
5. Read Marketplace convergence plan.
6. Read Vehicle Passport lifecycle plan.
7. Read verification governance audit.
8. Read authority audit register.
9. Read benchmark appendix.
10. Inspect current code and PRs.
11. Create/update Operations progress file.
12. Execute M0–M7 continuously.
13. Update roll call after every cleared task.
14. Continue independent work after a non-global blocker.
15. Stop only at a mandatory stop condition.
16. Do not merge.

---

# 40. Mandatory stop conditions

Stop and report when:

- production write is required without authorization;
- destructive migration is required;
- private evidence could be exposed;
- a role/capability decision is ambiguous and changes security boundaries;
- a current active PR conflicts with the same canonical authority and safe reconciliation is unclear;
- external credentials/provider authority are required;
- current staging data contradicts the assumed Serena lifecycle materially;
- required test/gate fails and cannot be repaired within approved scope;
- implementation would need to fabricate a fact to progress.

A stop report must include exact blocker, evidence, affected milestone, safe alternatives and recommendation.

---

# 41. Final implementation report format

Claude's final report for the Serena slice must include:

1. Branch.
2. Final HEAD SHA.
3. Base SHA.
4. PR number/link if opened.
5. Exact staging URL.
6. Frontend deployed SHA.
7. Backend deployed SHA.
8. Pairing state.
9. Serena VIN/identifier.
10. Evidence rows before-state summary.
11. Evidence canonicalization changes.
12. Legacy evidence compatibility strategy.
13. Seller Authority implementation.
14. Seller Authority state for Serena.
15. Zimbabwe registration stage for Serena.
16. Registration stage provenance.
17. TIP result.
18. CVR result.
19. Plate result.
20. Publication completeness before.
21. Publication completeness after.
22. Fraud/governance result.
23. Canonical Trust state.
24. Vehicle Operations route.
25. Operations authorization implementation.
26. Operator used in staging and how it was safely provisioned.
27. Audit evidence.
28. Private evidence leak test.
29. Seller Publish result.
30. Marketplace card result.
31. Vehicle Detail/Passport result.
32. Buyer inquiry result.
33. Unpublish/republish result.
34. Desktop UAT.
35. Tablet UAT.
36. Mobile UAT.
37. Accessibility result.
38. Backend tests.
39. Web tests.
40. Playwright tests.
41. Existing Seller gates.
42. Passport gates.
43. Marketplace gates.
44. Communications gates.
45. Migration files.
46. Staging migrations applied.
47. Production touched: yes/no.
48. Known limitations.
49. Deferred Operations domains.
50. Unresolved security findings.
51. Whether Serena is owner-UAT-ready.
52. Whether PR is merge-ready.
53. Recommended next slice.

---

# 42. Benchmark-derived product requirements

The detailed source research is in docs/features/CARUP_OPERATIONS_CONTROL_PLANE_BENCHMARK_RESEARCH.md.

The implementation adopts these public-workflow lessons:

## 42.1 carVertical

Vehicle-history products gain trust by preserving source provenance and by acknowledging that absent records do not prove the absence of an event.

CarUp adaptation:

- missing data stays unknown;
- external records keep their source;
- CarUp does not manufacture history;
- public reports distinguish what was found from what was not established.

## 42.2 CARFAX

Seller-entered listing details and sourced history can disagree because they have different origins.

CarUp adaptation:

- Seller statement and sourced history can coexist;
- conflicts create review, not silent overwriting;
- buyer copy identifies provenance.

## 42.3 Autotrader Private Seller Exchange

Identity, seller/title authority, vehicle history, fraud, secure communication, payment and registration/title workflow are layered responsibilities.

CarUp adaptation:

- separate operator domains;
- do not create one "verified" bit;
- transaction authority remains distinct from evidence and Trust;
- finance/lien handling is separate.

## 42.4 Cars.com

Seller attestation, platform moderation and partner transaction services are separate layers.

CarUp adaptation:

- Seller remains responsible for statements;
- Marketplace Operations controls public suitability;
- partner/government authority remains external;
- investigation/suppression does not equal external verification.

## 42.5 BE FORWARD

Shipping, export, payment, inspection and registration/customs artifacts belong to different lifecycle stages.

CarUp adaptation:

- canonical evidence class/subtype is semantic authority;
- a Bill of Lading remains import evidence;
- an export certificate remains export/import evidence;
- a transit declaration remains transit evidence;
- a Zimbabwe CVR book is registration evidence;
- file type does not determine life-stage meaning.

---

# 43. Architectural north star

The long-term CarUp operating model is:

~~~text
                         CARUP OPERATIONS
                                │
       ┌────────────────────────┼────────────────────────┐
       │                        │                        │
     PEOPLE                  VEHICLES                 COMMERCE
       │                        │                        │
Customer Operations      Evidence Review        Marketplace Review
Identity Operations      Seller Authority       Buyer/Seller Cases
Seller Compliance        Passport / Trust       Fraud / Risk
Dealer Compliance        Governance             Transactions
       │                        │                        │
       └──────────────┬─────────┴──────────┬─────────────┘
                      │                    │
              PARTNER OPERATIONS      RESOLUTION
                      │                    │
              Service Network         Communications
              Finance                 Disputes
              Insurance               Escalations
              Government Sources      SLA
              Import / Diaspora
                      │
                      └─────────┬──────────┘
                                │
                         AUDIT / GOVERNANCE
                                │
               ┌────────────────┴────────────────┐
               │                                 │
        PLATFORM OPERATIONS               SECURITY / AUDIT
        Feature Governance                Access review
        Provider health                   Incident response
        Configuration                     Audit search
        Emergency controls
               │
               └────────────────┬────────────────┘
                                │
                      PLATFORM / SUPER ADMIN
~~~

The architecture should be reached by adding proven specialist slices, not by creating a giant all-powerful Admin.

The Serena is the first proof.

If CarUp can take one real imported vehicle with real imperfect evidence, keep every source truthful, review the correct things, leave external facts with external authorities, clear legitimate blockers, and let the Seller publish safely, then the Operations Control Plane has earned its foundation.
---

# 44. Current implementation state — updated 2026-09-03 (Serena slice, PR #206)

This section records what the Serena slice actually built, per the §38 maintenance rule. The execution evidence lives in docs/features/CARUP_OPERATIONS_CONTROL_PLANE_PROGRESS.md.

## Routes

- GET /api/admin/vehicles/:vin/review — the Vehicle Operations reviewer aggregate (read model; role gate + operations.vehicle.read_private capability; proven session mandatory).
- PATCH /api/vehicles/:vin/evidence/:evidenceId/classification — governed classification correction (operations.vehicle_evidence.classify; reason mandatory; fail-closed audit; history preserved in metadata.classification_history + 'corrected' provenance event).
- GET /api/vehicles/:vin/seller-authority — current governed authority state (own-state for sellers; any-seller for reviewers).
- POST /api/vehicles/:vin/seller-authority/review — governed authority decision (operations.seller_authority.review; no self-approval; conflict fails closed 409).
- POST /api/vehicles/:vin/seller-claim — unchanged contract, now delegating to the canonical service.
- Web: /admin/vehicles/:vin/review (admin.vehicle-operations), linked from the Evidence Review queue.

## Services and schemas

- backend/services/evidence/evidenceTaxonomy.js — canonical semantic layer: resolveSemanticClassification + predicates (registration / ownership-registration requirement / TIP / seller-authority candidacy / document form) that ignore a contradictory legacy evidence_type whenever a canonical class exists; deriveLegacyCompatibilityType for canonical-first uploads.
- backend/services/evidence/evidenceClassificationCorrectionService.js.
- backend/services/seller/sellerAuthorityService.js — policy seller_authority.v1; states evidence_submitted/under_review/confirmed/insufficient/disputed/revoked (+ derived recognized/not_assessed); trust_audit_events remains the decision-history ledger (fail closed).
- backend/services/operations/operationsAuthorizationService.js — the bounded capability layer (operations.vehicle.read_private, .vehicle_evidence.review, .vehicle_evidence.classify, .seller_authority.review); grants derive from the server-side platform/base role only.
- backend/services/operations/vehicleOperationsReadModel.js — the aggregate; no storage locators, no seller contact PII, no audit network identity.
- backend/services/evidence/completenessEvaluator.js — the M3 gate (seller_authority requirement; stage-conditional registration_evidence; blocking risk_governance from fraud_cases; who_must_act/refusal_category).
- Migrations: 20260902150000_vehicle_life_generic_compat_types.sql (adds vehicle_life_document/vehicle_life_photo compat values, canonical-required CHECK), 20260902160000_vehicle_seller_authority.sql (current-state table, UNIQUE(vin,seller), decider-attribution CHECK, RLS + service_role-only). Both applied to staging (supabase ledger + idempotent CI apply).

## Roles / capabilities

- No persistent capability schema yet (M8 decides). Compatibility mapping: admin/platform_admin/super_admin/government → the four vehicle-operations capabilities; every other role (including tenant-elevated effective roles) → none.
- Frontend: platform_admin/super_admin now route as admin (normalizeFrontendRole); `reviewer` remains backend-only and explicitly bounded.

## Deferred domains

Service Network (O5 — backend absent on this branch), generic operations_cases (M8 gate), persistent operator provisioning, Communications-embedded operations queues, insurance/finance/transaction operations (O6–O8).

# 45. Decision log — Serena slice

| Date | Decision | Reason | Alternatives rejected |
|---|---|---|---|
| 2026-09-02 | Keep legacy evidence_type as the stored compatibility/artifact-form field; add TWO neutral generic values instead of freeing the column | The field is load-bearing (upload role auth, storage bucket, default visibility, AI extraction); dropping or freeing it would be a destructive contract change | Making evidence_type nullable; extending it with new semantic values |
| 2026-09-02 | Canonical-first uploads DERIVE the compatibility value server-side | No new record can be born with a false legacy meaning; legacy clients unaffected | Rejecting contradictory input (breaks existing callers); trusting the client pick |
| 2026-09-03 | Additive vehicle_seller_authority table | The audit-event-only claim cannot serve a queryable current state, lifecycle, supersession or race-safe decisions for the publication gate | Replaying trust_audit_events per completeness evaluation; reusing governance review_tasks |
| 2026-09-03 | Publication seller_authority satisfied by CONFIRMED decision or relationship + verified canonical ownership/registration document | Preserves the old gate's strength (no self-created listing publishes with zero verified documents) while making explicit review the path for permanent imports | Auto-satisfying on verified import chain (review must decide); requiring confirmation for everyone (breaks Golden parity) |
| 2026-09-03 | registration_evidence demanded only for locally_registered | A permanent import cannot produce a registration book it does not have (§19) | Keeping a universal registration-document blocker |
| 2026-09-03 | risk_governance requirement reads fraud_cases.blocks_publication in the gate itself | The flag was consumed only by the trust decision; the publish route never asked — two answers to one question | Leaving fraud advisory-only; wiring the trust decision into publish |
| 2026-09-03 | Capabilities derive from platformRole/baseRole only | Generalizes the marketplaceModeration anti-escalation pattern; header-steered effective roles can never mint operations authority | Reading effectiveRole; introducing a persistent grants table now |
| 2026-09-03 | Registration stage stays seller-editable on restored drafts; reuse path stamps registration_status_source | The stage is a lifecycle claim, not identity; a stage without provenance evaluates as not_recorded and silently blocked the seller's own truthful statement | Keeping the canonicalLocked freeze; operator-declared stages (false provenance) |
| 2026-09-03 | Serena rows NOT rewritten; legacy mislabels surfaced in the workspace instead | Canonical values were already correct; M1 makes them authoritative; history preserved (G13) | Backfilling legacy fields; reclassifying rows in bulk |
| 2026-09-03 | Serena truthful stage = arrived_customs_pending (seller statement) | The pack proves transit + arrival-region inspection but does NOT establish Zimbabwe customs clearance; duty_paid=false is recorded | customs_cleared_cvr_pending (would assert an unestablished clearance); leaving unknown (blocks a legitimately listable vehicle) |
| 2026-09-03 | import_source='import' left as-is, recorded as a data-quality note | The value fails the pure eligibility helper but that helper is not wired into publish/read paths; only auto-classification skips; a truthful 'Japan' correction is a Seller statement for a later save | Mutating the row operator-side (wrong provenance) |
