# CARUP_TRUST_FACT_SETTER_PHASE2A_PLAN.md

## 1. Executive summary

Status: PLAN_ONLY

Phase 2A should introduce the first governed trust-fact setter workflow for three evidence-backed marketplace facts:

- `vehicle_condition_category`
- `passport_verified`
- `inspection_ready`

The recommended design is to create a `trust_fact_requests` table and route all Phase 2A mutations through request rows. Approval should mutate `vehicles` only after permission checks, evidence validation, and audit logging requirements are satisfied. This avoids direct dashboard toggles and preserves a durable review trail.

Current code readiness:

- IMPLEMENTED: `vehicles.vehicle_condition_category`, `vehicles.passport_verified`, `vehicles.passport_verified_at`, `vehicles.passport_verification_source`, and `vehicles.inspection_ready` already exist in `database/migrations/20260603132036_marketplace_listing_summary_infra.sql`.
- IMPLEMENTED: `backend/services/marketplace/listingSummaryService.js` already reads `vehicle_condition_category`, `passport_verified`, and `inspection_ready` from `vehicles`.
- IMPLEMENTED: `backend/services/auditLogger.js` writes `trust_audit_events`.
- PARTIAL: `backend/services/trustGovernance/trustPermissionService.js` has foundation rules, but it needs Phase 2A-specific request/review/revoke rules.
- MISSING: no `trust_fact_requests` table exists.
- MISSING: no backend routes exist for trust-fact request, review, approve, reject, or revoke.
- SHOULD_DEFER: `vehicle_listing_summaries` refresh workers remain out of scope.

Implementation should be backend-only. Do not add broad dashboard UI, new public badges, public Parts Marketplace, ZIMRA/CID/SafePay setters, PartSentry public-card setters, dealer verification, or listing summary refresh workers.

Implementation note:

- Supabase JS alone does not provide a multi-write transaction wrapper in the current backend style. Phase 2A should therefore write required audit events before mutating `vehicles`, so audit failure blocks public trust-fact mutation. A future Phase 2B hardening pass can move request update, vehicle mutation, and audit inserts into a single Postgres transaction or internal RPC.

## 2. Proposed request/approval data model

Status: BACKEND_NEEDED

Recommendation: create `trust_fact_requests`.

Yes, trust fact requests should have their own table. The request row is the governance object that connects submitter, reviewer, evidence references, requested value, current value, decision notes, audit events, and eventual vehicle mutation.

Recommended migration:

```sql
CREATE TABLE IF NOT EXISTS trust_fact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  trust_fact TEXT NOT NULL,
  requested_value JSONB NOT NULL,
  current_value JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT REFERENCES users(id),
  requested_by_role TEXT NOT NULL,
  requested_by_tenant_id UUID,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_by_role TEXT,
  reviewed_by_tenant_id UUID,
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  partsentry_log_ids TEXT[] NOT NULL DEFAULT '{}',
  reason TEXT,
  decision_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Recommended constraints:

- `trust_fact IN ('vehicle_condition_category', 'passport_verified', 'inspection_ready')`
- `status IN ('pending', 'approved', 'rejected', 'revoked', 'superseded')`
- `requested_value` must be validated in backend service code per fact.
- Only one non-terminal request per `vin + trust_fact` should be allowed. Use a partial unique index on `status = 'pending'`.

Recommended indexes:

- `(vin)`
- `(trust_fact)`
- `(status)`
- `(requested_by)`
- `(reviewed_by)`
- `(created_at)`
- `(vin, trust_fact, status)`
- GIN index on `evidence_ids` only if review queries need it later.

RLS and access:

- Enable RLS.
- Revoke `anon`.
- Do not grant public writes.
- Backend service role writes requests.
- If Data API exposure is needed later, add scoped authenticated read policies only after dashboard queues are implemented.

Why request rows first:

- They prevent direct UI toggles from becoming source-of-truth trust facts.
- They make self-approval checks possible.
- They preserve rejected requests as fraud/quality signals.
- They allow revocation to point back to an approved request.
- They give marketplace summaries a clear approved source.

Approval should mutate `vehicles` only after the request row exists and is approved. Direct mutation without a request row should be disallowed for Phase 2A.

## 3. Phase 2A trust facts and allowed values

Status: BACKEND_NEEDED

| Trust fact | Current vehicle fields | Allowed requested value | Approval mutation | Revoke mutation |
|---|---|---|---|---|
| `vehicle_condition_category` | `vehicles.vehicle_condition_category` | One of `brand_new`, `recently_imported`, `locally_used`, `second_hand`, `certified_dealer`, `unknown` | Set `vehicles.vehicle_condition_category` to requested category | Set to `unknown` or previous approved value if tracked |
| `passport_verified` | `vehicles.passport_verified`, `vehicles.passport_verified_at`, `vehicles.passport_verification_source` | `{ "passport_verified": true }` | Set `passport_verified = true`, `passport_verified_at = now()`, `passport_verification_source = 'trust_fact_request:<id>'` | Set `passport_verified = false`, clear `passport_verified_at`, set source to revocation marker or null |
| `inspection_ready` | `vehicles.inspection_ready` | `{ "inspection_ready": true }` | Set `inspection_ready = true` | Set `inspection_ready = false` |

Validation rules:

- `vehicle_condition_category` requests must not accept free-form category labels.
- `passport_verified` and `inspection_ready` should be boolean trust facts, not strings.
- Reject any request that tries to set Phase 2B facts such as `zimra_verified`, `cid_clear`, `safe_pay_ready`, `public_card_eligible`, `verified_parts`, or `dealer_verified`.
- Reject any request with no `reason`.
- Approval and revocation must require `decision_notes` or `reason`.

## 4. Role permission matrix

Status: BACKEND_NEEDED

Every mutation must call `canSetTrustFact(actor, fact, action, context)` or a Phase 2A-specific policy wrapper that delegates to it.

| Role | Request `vehicle_condition_category` | Request `passport_verified` | Request `inspection_ready` | Approve/reject | Revoke |
|---|---:|---:|---:|---:|---:|
| private seller / owner | YES, owned vehicle only | YES, owned vehicle only | YES, owned vehicle only | NO | NO |
| dealer | YES, tenant vehicle only | YES, tenant vehicle only | YES, tenant vehicle only | NO in Phase 2A | NO |
| certified dealer | SHOULD_DEFER | SHOULD_DEFER | SHOULD_DEFER | SHOULD_DEFER | SHOULD_DEFER |
| garage / mechanic | NO | NO | NO | NO | NO |
| admin | YES | YES | YES | YES, with reason | YES, with reason |
| government / registry reviewer | NO | YES, if evidence supports it | YES, if evidence supports it | YES for `passport_verified` and `inspection_ready`; NO for `vehicle_condition_category` | YES for `passport_verified` and `inspection_ready` |
| finance / SafePay operator | NO | NO | NO | NO | NO |
| system job | NO | NO | NO | NO source-fact mutation | NO source-fact mutation |

Self-approval rules:

- Dealer cannot approve its own requests.
- Owner cannot approve any trust facts.
- Admin can approve admin-created requests only if a reason is present and audit records the override.
- Government can approve only supported `passport_verified` and `inspection_ready` requests.

Scope rules:

- Owner requests require `vehicles.owner_id = req.userContext.id`.
- Dealer requests require `vehicles.tenant_id = req.userContext.tenantId`.
- Admin and government review routes can read pending queues, but government must be constrained to facts it can review.

## 5. Required evidence references

Status: BACKEND_NEEDED

All Phase 2A approvals must validate evidence references before mutating `vehicles`.

Evidence source:

- Table: `vehicle_evidence`
- Existing statuses: `pending`, `verified`, `rejected`, `disputed`, `superseded`
- Existing visibility levels include `public_safe`, `restricted`, `private`, `government_only`
- Existing route/service: `backend/routes/vehiclesRoutes.js`, `backend/services/evidence/evidenceService.js`

Common evidence requirements:

- Every `evidence_id` must exist.
- Every referenced evidence row must match the same `vin`.
- Approval requires `verification_status = 'verified'`.
- Listing images must not count as evidence.
- Public marketplace claims must not expose private evidence metadata.

Fact-specific minimums:

| Trust fact | Required evidence for request | Required evidence for approval |
|---|---|---|
| `vehicle_condition_category` | At least one evidence reference strongly recommended; allow request with reason for owner/dealer intake if evidence is pending | At least one verified evidence row matching the category claim. Examples: `dealer_listing_photo`, `import_photo`, `customs_photo`, `registration_document`, `odometer_photo`, `owner_handover_photo` |
| `passport_verified` | At least one document evidence reference required | At minimum one verified identity/ownership document: `registration_document` or `ownership_transfer_document`; recommended to also require one verified public-safe vehicle identity/condition evidence row |
| `inspection_ready` | At least one inspection evidence reference required | At least one verified `inspection_photo` row, or a future inspection document type once added |

Visibility handling:

- Admin may review all evidence visibility levels.
- Government may review `public_safe`, `restricted`, and `government_only`.
- Owner/dealer request responses should not return private evidence payloads from other actors.

## 6. API route design

Status: BACKEND_NEEDED

Recommended new route module:

- `backend/routes/trustFactRoutes.js`

Recommended service module:

- `backend/services/trustGovernance/trustFactWorkflowService.js`

Mount:

- Add route module in `backend/server.js`.

Routes:

### `POST /api/verification/trust-facts/:vin/requests`

Status: BACKEND_NEEDED

Auth:

- `authorizeRole(['owner', 'dealer', 'admin', 'government'])`

Body:

```json
{
  "trust_fact": "passport_verified",
  "requested_value": { "passport_verified": true },
  "evidence_ids": ["evidence-id-1"],
  "reason": "Registration document and vehicle identity evidence are ready for Passport review."
}
```

Behavior:

- Validate fact is in Phase 2A.
- Validate requested value.
- Validate vehicle exists.
- Validate requester ownership/tenant scope unless admin/government.
- Call `canSetTrustFact(actor, fact, 'submit', context)`.
- Insert `trust_fact_requests` with `status = 'pending'`.
- Emit `TRUST_FACT_CHANGE_REQUESTED`.

### `GET /api/verification/review-queue`

Status: BACKEND_NEEDED

Auth:

- `authorizeRole(['admin', 'government'])`

Query:

- `status=pending`
- `trust_fact=passport_verified`
- `vin=...`

Behavior:

- Admin can see all Phase 2A requests.
- Government can see `passport_verified` and `inspection_ready`.
- Do not expose private seller PII.
- Return request summary plus safe evidence summary, not raw private evidence fields.

### `PATCH /api/verification/trust-facts/:requestId/approve`

Status: BACKEND_NEEDED

Auth:

- `authorizeRole(['admin', 'government'])`

Body:

```json
{
  "decision_notes": "Verified registration document and inspection evidence.",
  "reason": "Evidence bundle supports Passport verification."
}
```

Behavior:

- Load pending request.
- Validate reviewer can approve fact.
- Prevent self-approval unless admin override with reason.
- Validate evidence references are verified and match VIN.
- In one transaction, set request `status = 'approved'`, mutate `vehicles`, and write audit events.
- Emit `TRUST_FACT_APPROVED`.
- Emit field-specific event.

### `PATCH /api/verification/trust-facts/:requestId/reject`

Status: BACKEND_NEEDED

Auth:

- `authorizeRole(['admin', 'government'])`

Behavior:

- Load pending request.
- Validate reviewer can reject fact.
- Set request `status = 'rejected'`, reviewer fields, `decision_notes`, `reviewed_at`.
- Do not mutate `vehicles`.
- Emit `TRUST_FACT_REJECTED`.

### `PATCH /api/verification/trust-facts/:requestId/revoke`

Status: BACKEND_NEEDED

Auth:

- `authorizeRole(['admin', 'government'])`

Behavior:

- Load approved request.
- Validate reviewer can revoke fact.
- Set request `status = 'revoked'`, reviewer fields, `decision_notes`, `revoked_at`.
- Mutate `vehicles` to revoke the approved fact.
- Emit `TRUST_FACT_REVOKED`.
- Emit field-specific revoke/set event where applicable.

### `GET /api/verification/audit-trail/:vin`

Status: BACKEND_NEEDED

Auth:

- `authorizeRole(['owner', 'dealer', 'admin', 'government'])`

Behavior:

- Admin/government can see trust audit events for VIN.
- Owner can see own vehicle audit summaries.
- Dealer can see tenant vehicle audit summaries.
- Do not expose private evidence metadata, owner PII, phone, email, address, national ID, or private reviewer notes to unauthorized actors.

## 7. Mutation behavior

Status: BACKEND_NEEDED

Approval should create request rows first, then mutate `vehicles` on approval.

Recommended transactional behavior:

- Approval/rejection/revocation should be implemented in a workflow service, not directly in route handlers.
- Use a database transaction for request update, vehicle mutation, and required central audit insert.
- Since `logAuditEvent()` is intentionally safe-failure for non-critical flows, the Phase 2A workflow service should treat audit failure as critical for trust-fact approval/revocation. If `logAuditEvent()` returns `success: false`, rollback or fail before exposing the mutation as complete.
- If current Supabase JS usage cannot guarantee a transaction across these writes, use a backend Postgres transaction through `pg`, or a carefully scoped internal RPC. Do not expose a public `SECURITY DEFINER` function in the public schema.

Approval mutation mapping:

```js
vehicle_condition_category:
  vehicles.vehicle_condition_category = requested_value.condition_category

passport_verified:
  vehicles.passport_verified = true
  vehicles.passport_verified_at = now()
  vehicles.passport_verification_source = `trust_fact_request:${request.id}`

inspection_ready:
  vehicles.inspection_ready = true
```

Revocation mutation mapping:

```js
vehicle_condition_category:
  vehicles.vehicle_condition_category = 'unknown'

passport_verified:
  vehicles.passport_verified = false
  vehicles.passport_verified_at = null
  vehicles.passport_verification_source = `revoked_trust_fact_request:${request.id}`

inspection_ready:
  vehicles.inspection_ready = false
```

Superseding behavior:

- When a new request for the same `vin + trust_fact` is approved, older pending requests for that pair should become `superseded`.
- An approved request should remain `approved` unless explicitly revoked.

## 8. Audit event design

Status: BACKEND_NEEDED

Use `backend/services/auditLogger.js` and `trust_audit_events`.

Required generic events:

- `TRUST_FACT_CHANGE_REQUESTED`
- `TRUST_FACT_APPROVED`
- `TRUST_FACT_REJECTED`
- `TRUST_FACT_REVOKED`

Required Phase 2A field events:

- `VEHICLE_CONDITION_CATEGORY_SET`
- `PASSPORT_VERIFICATION_APPROVED`
- `PASSPORT_VERIFICATION_REVOKED`
- `INSPECTION_READY_SET`

Recommended additional field events for completeness:

- `VEHICLE_CONDITION_CATEGORY_REVOKED`
- `INSPECTION_READY_REVOKED`

Audit payload requirements:

- `vin`
- `vehicle_id` if available
- `trust_fact`
- `previous_value`
- `new_value`
- `actor_user_id`
- `actor_role`
- `actor_tenant_id`
- `source_route`
- `evidence_ids`
- `reason`
- `decision_notes`
- `request_id`
- `ip_address`
- `user_agent`

Event mapping:

| Action | Generic event | Field-specific event |
|---|---|---|
| Request created | `TRUST_FACT_CHANGE_REQUESTED` | None |
| Condition approved | `TRUST_FACT_APPROVED` | `VEHICLE_CONDITION_CATEGORY_SET` |
| Passport approved | `TRUST_FACT_APPROVED` | `PASSPORT_VERIFICATION_APPROVED` |
| Inspection approved | `TRUST_FACT_APPROVED` | `INSPECTION_READY_SET` |
| Any rejected | `TRUST_FACT_REJECTED` | None |
| Passport revoked | `TRUST_FACT_REVOKED` | `PASSPORT_VERIFICATION_REVOKED` |
| Condition revoked | `TRUST_FACT_REVOKED` | `VEHICLE_CONDITION_CATEGORY_REVOKED` or `VEHICLE_CONDITION_CATEGORY_SET` to `unknown` |
| Inspection revoked | `TRUST_FACT_REVOKED` | `INSPECTION_READY_REVOKED` or `INSPECTION_READY_SET` to `false` |

## 9. Marketplace summary impact

Status: IMPLEMENTED_FOR_LIVE_READS, SHOULD_DEFER_MATERIALIZED_REFRESH

Current live marketplace endpoint:

- Route: `GET /api/marketplace/listings`
- File: `backend/routes/marketplaceRoutes.js`
- Service: `backend/services/marketplace/listingSummaryService.js`

Impact after approval:

- `vehicle_condition_category` is reflected immediately because `listMarketplaceListings()` selects `vehicles.vehicle_condition_category`.
- `passport_verified` is reflected immediately because `deriveMarketplaceTags()` adds `passport_verified` only when `vehicles.passport_verified` is truthy.
- `inspection_ready` is reflected immediately because `deriveMarketplaceTags()` adds `inspection_ready` only when `vehicles.inspection_ready` is truthy.

Impact after revocation:

- Revoked `passport_verified` and `inspection_ready` disappear from live marketplace summaries after the vehicle row updates.
- Revoked `vehicle_condition_category` should become `unknown` or another approved category.

Materialized table:

- `vehicle_listing_summaries` exists but refresh workers are deferred.
- Phase 2A should not implement listing summary refresh workers.
- If implementation wants to prepare for Phase 2B, it may record a non-public dirty marker in request/audit metadata, but it should not add refresh jobs yet.

## 10. Privacy rules

Status: BACKEND_NEEDED

Public marketplace privacy:

- Do not expose trust request rows publicly.
- Do not expose audit rows publicly.
- Do not expose private owner names, phone numbers, email, address, national ID, or private evidence metadata.
- Do not expose raw private evidence records in review queue responses to unauthorized actors.
- Do not count listing images as evidence.

Review queue privacy:

- Admin can see full request context needed for moderation.
- Government can see request context for `passport_verified` and `inspection_ready`, constrained to allowed evidence visibility.
- Owner/dealer can see their own request status and redacted decision summaries.
- Decision notes may contain sensitive internal reviewer reasoning; expose carefully by role.

Audit privacy:

- `GET /api/verification/audit-trail/:vin` must require auth and vehicle scope.
- Public users must not access `trust_audit_events`.
- Public marketplace cards should show only the resulting safe trust fact, not the private request/audit trail behind it.

## 11. Test plan

Status: BACKEND_NEEDED

Migration tests:

- `trust_fact_requests` migration runs on clean Postgres/Supabase.
- RLS is enabled.
- `anon` has no access.
- Partial unique index blocks duplicate pending requests for the same `vin + trust_fact`.
- Check constraints reject non-Phase 2A facts.

Policy tests:

- Owner can submit Phase 2A requests for owned vehicle.
- Owner cannot submit for another owner vehicle.
- Dealer can submit for tenant vehicle.
- Dealer cannot submit for non-tenant vehicle.
- Admin can approve/reject/revoke all three facts with reason.
- Admin approval without reason is rejected.
- Government can approve/reject/revoke `passport_verified` and `inspection_ready`.
- Government cannot approve/reject/revoke `vehicle_condition_category`.
- Dealer cannot approve own request.
- Owner cannot approve any request.
- System cannot create source trust facts.

API tests:

- `POST /api/verification/trust-facts/:vin/requests` creates pending request and emits `TRUST_FACT_CHANGE_REQUESTED`.
- Invalid fact is rejected.
- Invalid requested value is rejected.
- Missing reason is rejected.
- Missing evidence is rejected where required.
- `GET /api/verification/review-queue` scopes admin/government correctly.
- `PATCH approve` changes request status, mutates `vehicles`, and writes generic plus field-specific audit events.
- `PATCH reject` changes request status and writes audit event without mutating `vehicles`.
- `PATCH revoke` changes request status, revokes vehicle field, and writes audit events.
- Self-approval is rejected.

Evidence tests:

- Approval rejects evidence IDs from another VIN.
- Approval rejects unverified evidence.
- Passport approval requires verified `registration_document` or `ownership_transfer_document`.
- Inspection approval requires verified `inspection_photo`.
- Vehicle condition approval requires supporting verified evidence.

Marketplace tests:

- Approved `passport_verified` appears in `/api/marketplace/listings`.
- Revoked `passport_verified` disappears.
- Approved `inspection_ready` appears.
- Revoked `inspection_ready` disappears.
- Approved `vehicle_condition_category` changes category filtering.
- No private evidence fields appear in marketplace listing responses.

Audit tests:

- `trust_audit_events.previous_value` and `new_value` are populated for approvals and revocations.
- `request_id`, `ip_address`, and `user_agent` are preserved.
- `evidence_ids` are recorded.
- Audit failure blocks approval/revocation in this workflow.

Suggested commands after implementation:

```bash
node backend/tests/trust-governance.test.js
node backend/tests/audit-logger.test.js
node backend/tests/auth-middleware.test.js
node backend/tests/trust-fact-workflow.test.js
node --check backend/routes/trustFactRoutes.js
node --check backend/services/trustGovernance/trustFactWorkflowService.js
node --check backend/services/trustGovernance/trustPermissionService.js
node backend/tests/marketplace-listing-summary.test.js
npm run build --workspace=web
npx playwright test web/e2e/marketplace-cards.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/plate-privacy.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/evidence-timeline.spec.ts --config=web/playwright.config.ts --project=chromium
```

## 12. Implementation checklist

Status: PLAN_ONLY

1. Add migration for `trust_fact_requests`.
2. Add `backend/services/trustGovernance/trustFactWorkflowService.js`.
3. Extend `backend/services/trustGovernance/trustPermissionService.js` with Phase 2A request/review/revoke rules.
4. Add `backend/routes/trustFactRoutes.js`.
5. Mount trust fact routes in `backend/server.js`.
6. Implement request creation with ownership/tenant checks.
7. Implement review queue with admin/government scoping.
8. Implement approval workflow with evidence validation.
9. Implement rejection workflow.
10. Implement revocation workflow.
11. Ensure approval/revocation mutates `vehicles` only through workflow service.
12. Ensure every mutation writes `trust_audit_events`.
13. Treat audit failure as blocking for trust fact approval/revocation.
14. Add backend workflow tests.
15. Add marketplace summary regression tests for approved/revoked facts.
16. Update `docs/CARUP_VERIFICATION_GOVERNANCE_AUDIT.md` with Phase 2A implementation notes after implementation.
17. Do not add dashboard UI in Phase 2A.
18. Do not add public trust claims beyond values already supported by marketplace cards.

## 13. Deferred Phase 2B/2C items

Status: SHOULD_DEFER

Explicitly deferred:

- `zimra_verified`
- `cid_clear`
- `safe_pay_ready`
- `public_card_eligible`
- `verified_parts`
- `dealer_verified`
- Broad dashboard UI
- Public Parts Marketplace
- Listing summary refresh workers
- Materialized `vehicle_listing_summaries` refresh triggers/jobs
- Government registry-specific setter routes for ZIMRA/CID
- SafePay operator workflow
- PartSentry public-card workflow
- Certified dealer workflow

Phase 2B recommendation:

- Add government-backed workflows for `zimra_verified` and `cid_clear`.
- Add SafePay-backed workflow for `safe_pay_ready`.

Phase 2C recommendation:

- Add PartSentry public-card workflows for `public_card_eligible`, `partsentry_checked`, and `verified_parts`.
- Add dealer verification and public seller label governance.
- Add materialized listing summary refresh workers after setter workflows are stable.
