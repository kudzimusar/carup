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
