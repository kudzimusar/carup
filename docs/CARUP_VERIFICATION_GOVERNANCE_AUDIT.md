# CARUP_VERIFICATION_GOVERNANCE_AUDIT.md

## Governance Foundation Implementation

Status: IMPLEMENTED

This sprint adds the minimum backend governance foundation needed before CarUp introduces broad trust-fact setter workflows, new dashboard queues, or new public marketplace trust claims.

### Audit table added

Status: IMPLEMENTED

Migration:

- `database/migrations/20260603233640_governance_foundation_trust_audit_events.sql`

Table:

- `trust_audit_events`

Fields added:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `event_type TEXT NOT NULL`
- `vin TEXT`
- `vehicle_id TEXT`
- `trust_fact TEXT`
- `previous_value JSONB`
- `new_value JSONB`
- `actor_user_id TEXT`
- `actor_role TEXT`
- `actor_tenant_id TEXT`
- `actor_type TEXT NOT NULL DEFAULT 'user'`
- `source_dashboard TEXT`
- `source_route TEXT`
- `evidence_ids TEXT[] DEFAULT '{}'`
- `partsentry_log_ids TEXT[] DEFAULT '{}'`
- `registry_verification_id TEXT`
- `safepay_transaction_id TEXT`
- `reason TEXT`
- `decision_notes TEXT`
- `request_id TEXT`
- `ip_address TEXT`
- `user_agent TEXT`
- `created_at TIMESTAMPTZ DEFAULT NOW()`

Indexes added:

- `idx_trust_audit_events_event_type`
- `idx_trust_audit_events_vin`
- `idx_trust_audit_events_trust_fact`
- `idx_trust_audit_events_actor_user_id`
- `idx_trust_audit_events_created_at`
- `idx_trust_audit_events_request_id`

Security:

- RLS is enabled on `trust_audit_events`.
- `anon` and `authenticated` table access is revoked.
- `service_role` is granted table access for backend-side audit inserts.
- No public audit creation API was added.

### Audit logger added

Status: IMPLEMENTED

File:

- `backend/services/auditLogger.js`

Functions:

- `logAuditEvent(supabaseClient, event)`
- `logAuditEvent(event)` legacy-compatible overload
- `normalizeTrustAuditEvent(event)`

Behavior:

- Writes central audit events to `trust_audit_events`.
- Normalizes actor fields from `req.userContext` when present.
- Captures `request_id`, `ip_address`, and `user_agent` from request context.
- Supports system actor events.
- Redacts sensitive values in JSON payloads.
- Returns safe failure objects instead of throwing from non-critical audit writes.
- Keeps best-effort legacy writes to `organization_audit_logs` for existing route/test compatibility.

### Correlation middleware added

Status: IMPLEMENTED

File:

- `backend/middleware/correlationMiddleware.js`

Behavior:

- Preserves incoming `x-request-id` when present.
- Falls back to incoming `x-correlation-id`.
- Generates `req-UUID` when no request ID is provided.
- Sets `req.requestId`.
- Sets `req.correlationId` for compatibility with existing code.
- Sets response headers `x-request-id` and `x-correlation-id`.

Mount:

- `backend/server.js` already imports and uses `correlationMiddleware`.

### Auth hardening added

Status: IMPLEMENTED

File:

- `backend/middleware/authMiddleware.js`

Functions:

- `authorizeRole(allowedRoles = [])`
- `resolveEffectiveRole({ userRole, tenantRole, requestedRole })`
- `isUserIdFallbackAllowed(env)`

Behavior:

- `x-stakeholder-role` can no longer become the effective role unless it matches the verified user role or a verified non-admin tenant role.
- Tenant `admin` role is not treated as global CarUp `admin`.
- `x-user-id` fallback is restricted to test/development/local mode or explicit `CARUP_ALLOW_X_USER_ID_FALLBACK=true`.
- `req.userContext` now includes both `id` and `userId`.
- `req.userContext` also includes `role`, `effectiveRole`, `baseRole`, `tenantRole`, and `tenantId`.

Related consistency fix:

- `backend/routes/complianceRoutes.js` now writes `verified_by: req.userContext.id`.

### Permission policy added

Status: IMPLEMENTED

File:

- `backend/services/trustGovernance/trustPermissionService.js`

Function:

- `canSetTrustFact(actor, fact, action, context)`

Policy foundation:

- Owner cannot approve, revoke, or verify trust facts.
- Dealer cannot self-certify `dealer_verified`.
- Mechanic cannot verify their own part records by default.
- Government can approve `plate_verified`, `zimra_verified`, and `cid_clear`.
- Finance/bank can set `safe_pay_ready` through a future governed workflow.
- Admin can approve/revoke with a reason.
- System can refresh `vehicle_listing_summaries` but cannot create source trust facts.

This policy is intentionally not wired into broad new setter routes yet.

### Existing sensitive flows now write audit events

Status: PARTIAL

Evidence routes:

- `backend/routes/vehiclesRoutes.js`
- `PATCH /api/vehicles/:vin/evidence/:evidenceId/verify`
- `PATCH /api/vehicles/:vin/evidence/:evidenceId/reject`

Events:

- `EVIDENCE_VERIFIED`
- `EVIDENCE_REJECTED`

Audit fields include:

- VIN
- evidence ID
- previous verification value
- new verification value
- actor user ID
- actor role
- actor tenant ID
- decision notes/reason
- request ID

Role switch route:

- `backend/server.js`
- `POST /api/auth/switch-role`

Events:

- `ROLE_SWITCH_REQUESTED`
- `ROLE_SWITCH_GRANTED`
- `ROLE_SWITCH_DENIED`

Role switching now rejects unverified role assumption.

### Public PartSentry read safety

Status: IMPLEMENTED

Files:

- `backend/server.js`
- `backend/services/partsentry/partsentryService.js`

Changes:

- `POST /api/partsentry/add` now derives `mechanicId` from `req.userContext.id`.
- `GET /api/partsentry/:vin` now returns only public-card-safe fields.
- Public reads are filtered to `public_card_eligible = true`.
- Public reads no longer return `partsentry_logs.select('*')`.
- Marketplace summary behavior is unchanged because `backend/services/marketplace/listingSummaryService.js` already performs its own public-card eligibility checks.

### Tests added

Status: IMPLEMENTED

Files:

- `backend/tests/auth-middleware.test.js`
- `backend/tests/trust-governance.test.js`
- `backend/tests/audit-logger.test.js`

Coverage:

- Spoofed `x-stakeholder-role` rejection.
- Valid role acceptance.
- Tenant role verification.
- Tenant admin not treated as global admin.
- `x-user-id` fallback unavailable outside local/test mode.
- Role/fact trust permission policy.
- Audit event normalization.
- Audit JSON redaction.
- Audit safe failure behavior.

## Remaining Phase 2 setter workflows

Status: BACKEND_NEEDED

Still deferred:

- Governed setter workflow for `vehicle_condition_category`.
- Governed setter workflow for `passport_verified`.
- Governed setter workflow for `plate_verified`.
- Governed setter workflow for `zimra_verified`.
- Governed setter workflow for `cid_clear`.
- Governed setter workflow for `safe_pay_ready`.
- Governed setter workflow for `inspection_ready`.
- Governed setter workflow for `public_card_eligible`.
- Governed setter workflow for `partsentry_checked`.
- Governed setter workflow for `verified_parts`.
- Governed seller/dealer verification workflow for `seller_display_label` and `dealer_verified`.
- System job workflow for `vehicle_listing_summaries` refresh.

## Remaining dashboard queues

Status: SHOULD_DEFER

Still deferred:

- Admin trust fact review queue.
- Government registry/CID/ZIMRA review queue.
- PartSentry public-card review queue.
- SafePay operator queue.
- Dealer verification queue.
- Audit trail viewer.

## Confirmation

No new public trust badges were added.

No new dashboard UI was added.

No public Parts Marketplace was added.

No broad trust-fact setter workflows were added.

## Phase 2A Governed Trust Fact Setter Workflow Implementation

Status: IMPLEMENTED

Phase 2A adds the first narrow governed backend workflow for evidence-backed marketplace trust facts.

### Trust request table

Status: IMPLEMENTED

Migration:

- `database/migrations/20260604002000_trust_fact_requests_phase2a.sql`

Table:

- `trust_fact_requests`

Supported facts:

- `vehicle_condition_category`
- `passport_verified`
- `inspection_ready`

Lifecycle statuses:

- `pending`
- `approved`
- `rejected`
- `revoked`
- `superseded`

Security:

- RLS is enabled.
- `anon` and `authenticated` table access is revoked.
- Backend service role writes requests.
- No public Supabase Data API write path was added.

### Routes added

Status: IMPLEMENTED

File:

- `backend/routes/trustFactRoutes.js`

Mounted in:

- `backend/server.js`

Routes:

- `POST /api/verification/trust-facts/:vin/requests`
- `GET /api/verification/review-queue`
- `PATCH /api/verification/trust-facts/:requestId/approve`
- `PATCH /api/verification/trust-facts/:requestId/reject`
- `PATCH /api/verification/trust-facts/:requestId/revoke`
- `GET /api/verification/audit-trail/:vin`

### Service functions added

Status: IMPLEMENTED

File:

- `backend/services/trustGovernance/trustFactWorkflowService.js`

Functions:

- `createTrustFactRequest()`
- `listTrustFactReviewQueue()`
- `approveTrustFactRequest()`
- `rejectTrustFactRequest()`
- `revokeTrustFactRequest()`
- `validatePhase2ATrustFactPayload()`
- `validateEvidenceForApproval()`
- `getTrustFactAuditTrail()`

### Role permissions

Status: IMPLEMENTED

File:

- `backend/services/trustGovernance/trustPermissionService.js`

Phase 2A rules:

- Owners can request Phase 2A facts only for owned vehicles.
- Dealers can request Phase 2A facts only for tenant vehicles.
- Admin can request/review/revoke all three facts.
- Government can request/review/revoke `passport_verified` and `inspection_ready`.
- Government cannot review `vehicle_condition_category`.
- Owners cannot approve, reject, or revoke trust facts.
- Dealers cannot approve, reject, or revoke Phase 2A trust facts.
- System actors cannot create source trust facts.
- Admin approval/revocation requires reason or decision notes.

### Evidence validation

Status: IMPLEMENTED

Approval requires:

- Every evidence ID exists.
- Every evidence row matches the same VIN.
- Every approval evidence row has `verification_status = 'verified'`.
- Listing images do not count as evidence.

Fact-specific rules:

- `vehicle_condition_category` requires verified supporting condition evidence.
- `passport_verified` requires verified `registration_document` or `ownership_transfer_document`.
- `inspection_ready` requires verified `inspection_photo`.

### Audit events

Status: IMPLEMENTED

Generic events:

- `TRUST_FACT_CHANGE_REQUESTED`
- `TRUST_FACT_APPROVED`
- `TRUST_FACT_REJECTED`
- `TRUST_FACT_REVOKED`

Field-specific events:

- `VEHICLE_CONDITION_CATEGORY_SET`
- `VEHICLE_CONDITION_CATEGORY_REVOKED`
- `PASSPORT_VERIFICATION_APPROVED`
- `PASSPORT_VERIFICATION_REVOKED`
- `INSPECTION_READY_SET`
- `INSPECTION_READY_REVOKED`

Phase 2A approval/revocation treats audit failure as blocking and writes audit events before mutating `vehicles`.

### Marketplace impact

Status: IMPLEMENTED_FOR_LIVE_READS

No listing summary refresh worker was added.

`GET /api/marketplace/listings` already computes live from `vehicles` through `backend/services/marketplace/listingSummaryService.js`, so approved or revoked Phase 2A values are reflected by the live marketplace response after the vehicle row mutation.

### Deferred items

Status: SHOULD_DEFER

Still deferred:

- `zimra_verified`
- `cid_clear`
- `safe_pay_ready`
- `public_card_eligible`
- `verified_parts`
- `dealer_verified`
- broad dashboard UI
- public Parts Marketplace
- listing summary refresh workers
- PartSentry public-card workflows
- SafePay operator workflow
## Admin/Government Trust Review Queue UI

Status: IMPLEMENTED

This frontend-only sprint adds a narrow dashboard UI for Phase 2A governed trust-fact request review. It does not add backend routes, database migrations, public trust badges, owner/dealer approval UI, ZIMRA/CID/SafePay setters, PartSentry approval, dealer verification, public Parts Marketplace, or listing summary refresh workers.

### Routes added

- `/admin/trust-review`
- `/government/trust-review`

### Roles supported

- Admin reviewers can see and act on all Phase 2A trust facts:
  - `vehicle_condition_category`
  - `passport_verified`
  - `inspection_ready`
- Government reviewers can see and act only on:
  - `passport_verified`
  - `inspection_ready`
- Non-admin and non-government users see an unauthorized state and the review queue API is not called.

### Actions supported

- Pending requests support `Approve` and `Reject`.
- Approved requests support `Revoke`.
- Every mutation opens a decision modal and requires `decision_notes` before submit.
- Successful decisions reload the active queue and show a toast.

### Evidence drawer privacy rules

The evidence drawer fetches `/api/vehicles/:vin/evidence`, filters records to the selected request's `evidence_ids`, and renders only safe summary fields:

- evidence type
- verification status
- visibility level
- uploaded/captured date
- linked registry event
- checksum prefix
- safe `Open evidence` link

The UI does not render raw metadata, uploader IDs, private owner names, seller phone numbers, seller emails, addresses, national IDs, or raw file URLs as visible text.

### Audit trail drawer privacy rules

The audit drawer fetches `/api/verification/audit-trail/:vin` and renders event type, trust fact, actor role, previous/new values, source route, evidence IDs, reason, decision notes, and timestamp. Display helpers redact common PII keys and obvious phone/email patterns before rendering audit JSON or notes.

### Remaining deferred workflows

- ZIMRA/CID setters
- SafePay readiness setter
- PartSentry public-card approval workflow
- verified parts workflow
- dealer verification workflow
- owner/dealer approval UI
- public Parts Marketplace
- listing summary refresh workers
- public marketplace trust badge changes
