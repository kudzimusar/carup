# CARUP_PARTSENTRY_PUBLIC_CARD_APPROVAL_PLAN.md

## Executive Summary

Status: PLAN_ONLY

CarUp already has the read-side safety foundation for PartSentry marketplace signals:

- `backend/services/marketplace/listingSummaryService.js` only derives `partsentry_checked`, `repair_history_available`, `verified_parts`, and `recent_service` from `partsentry_logs` rows where `public_card_eligible` is truthy.
- `backend/services/partsentry/partsentryService.js` exposes public repair history through `getRepairHistory(vin, { publicOnly: true })` and selects only safe summary fields.
- `database/migrations/20260603132036_marketplace_listing_summary_infra.sql` added `verification_status`, `part_verification_status`, `suspicion_status`, and `public_card_eligible` to `partsentry_logs`.
- `backend/services/trustGovernance/trustPermissionService.js` already has placeholder governance rules for `public_card_eligible`, `partsentry_checked`, and `verified_parts`, including a guard that mechanics cannot verify their own part records.
- `backend/services/auditLogger.js` and `trust_audit_events` already support `partsentry_log_ids`.

The missing piece is a governed write workflow that decides when a PartSentry log may become `public_card_eligible`, when the service log itself becomes `verification_status = 'verified'`, when the installed part becomes `part_verification_status = 'verified'`, and how `suspicion_status` is reviewed, flagged, cleared, or revoked.

Recommendation: create a dedicated `partsentry_review_requests` workflow instead of reusing `trust_fact_requests`. PartSentry decisions are log-level and part-level, while `trust_fact_requests` is currently constrained to vehicle-level Phase 2A facts: `vehicle_condition_category`, `passport_verified`, and `inspection_ready`.

## Current Implementation Readiness

### Existing PartSentry Write Path

Status: PARTIAL

Files:

- `backend/server.js`
- `backend/services/partsentry/partsentryService.js`
- `web/src/hooks/useCarUpApi.ts`
- `web/src/pages/dashboard/mechanic/ServiceLogs.tsx`
- `web/src/pages/dashboard/owner/PartSentry.tsx`

Existing route:

- `POST /api/partsentry/add`

Current authorization:

- `authorizeRole(['mechanic'])` in `backend/server.js`

Current service function:

- `addRepairLog(vin, mechanicId, partName, partOem, actionType, description, mileage)`

Current behavior:

- Creates a `partsentry_logs` row with `vin`, `mechanic_id`, `part_name`, `part_oem`, `action_type`, `description`, `mileage`, `signature`, and `timestamp`.
- Derives `mechanicId` from `req.userContext.id` in `backend/server.js`.
- Updates the vehicle odometer after the log insert.
- Writes a blockchain event through `addEvent()`.

Planning note:

- The owner dashboard page `web/src/pages/dashboard/owner/PartSentry.tsx` still calls `addRepairLog()` with a hardcoded mechanic ID, but the backend route only allows `mechanic`. This should not become a public-card approval path. It should remain outside Phase 2B or be cleaned up later as a UX/API mismatch.

### Existing Public Read Path

Status: IMPLEMENTED_FOR_SAFE_READS

Files:

- `backend/server.js`
- `backend/services/partsentry/partsentryService.js`

Existing route:

- `GET /api/partsentry/:vin`

Current service function:

- `getRepairHistory(vin, { publicOnly = false })`

Current public-only selected fields:

- `id`
- `vin`
- `part_name`
- `part_oem`
- `action_type`
- `mileage`
- `timestamp`
- `verification_status`
- `part_verification_status`
- `public_card_eligible`

Current public filter:

- `public_card_eligible = true`

Planning note:

- This is a good public-read boundary. The approval workflow should preserve it and avoid returning `mechanic_id`, raw `description`, raw `signature`, private invoices, uploader IDs, phone numbers, emails, or addresses.

### Existing Marketplace Summary Behavior

Status: IMPLEMENTED_FOR_LIVE_READS

File:

- `backend/services/marketplace/listingSummaryService.js`

Functions:

- `summarizePartSentry(rows = [])`
- `deriveMarketplaceTags(vehicle, evidenceSummary, partSentrySummary, ownershipCount = 0)`
- `buildMarketplaceListingSummary(...)`
- `listMarketplaceListings(supabaseClient, params = {})`

Current marketplace PartSentry input fields:

- `vin`
- `action_type`
- `timestamp`
- `created_at`
- `verification_status`
- `part_verification_status`
- `suspicion_status`
- `public_card_eligible`

Current derived card fields:

- `partsentry_checked`
- `repair_history_count`
- `verified_parts_count`
- `recent_service`

Current derived tags:

- `partsentry_checked`
- `repair_history_available`
- `verified_parts`
- `recent_service`

Critical current rule:

- Listing cards only get PartSentry public trust signals when `public_card_eligible` is truthy.

### Existing Governance Foundation

Status: PARTIAL_FOR_PARTSENTRY

Files:

- `backend/services/trustGovernance/trustPermissionService.js`
- `backend/services/auditLogger.js`
- `database/migrations/20260603233640_governance_foundation_trust_audit_events.sql`

Existing trust facts listed in `SOURCE_TRUST_FACTS`:

- `public_card_eligible`
- `partsentry_checked`
- `verified_parts`

Existing PartSentry-specific permission guard:

- `canSetTrustFact(actor, 'verified_parts', ..., { submittedBy, ownRecord })` denies a `mechanic` verifying their own part records by default.

Existing audit support:

- `trust_audit_events.partsentry_log_ids`
- `logAuditEvent()` normalization supports `partsentry_log_ids` and `targetType = 'partsentry_log'`.

Gap:

- There is no route, table, service, request lifecycle, UI queue, or mutation workflow for PartSentry approvals.

## Direct Answers To Planning Questions

### 1. Should PartSentry approvals reuse `trust_fact_requests`, or need a dedicated `partsentry_review_requests` table?

Recommendation: create a dedicated `partsentry_review_requests` table.

Reason:

- `trust_fact_requests` is intentionally constrained by `trust_fact_requests_fact_check` to `vehicle_condition_category`, `passport_verified`, and `inspection_ready`.
- `trust_fact_requests` is VIN-first and vehicle-fact oriented.
- PartSentry decisions are log-level and part-level. A single VIN can have many logs, each with different mechanic provenance, part provenance, suspicion status, and public eligibility.
- Reusing `trust_fact_requests.partsentry_log_ids` would require widening the current check constraint and overloading a vehicle-level workflow.

Use `trust_audit_events` for shared audit history, but use a dedicated review request table for PartSentry.

### 2. Which actors can submit PartSentry records for review?

Recommended Phase 2B submitters:

- `mechanic`: can submit a review request for their own newly created `partsentry_logs` row.
- `garage` or garage tenant roles represented through `mechanic` or tenant role context: can submit review requests for logs within their tenant scope.
- `owner`: can request review of a log tied to a vehicle they own, but cannot alter log verification values directly.
- `dealer`: can request review of a log tied to a tenant vehicle, but cannot alter log verification values directly.
- `admin`: can submit on behalf of support or moderation.

Do not allow:

- anonymous users
- public marketplace users
- `system` actor creating source trust facts

### 3. Which actors can approve `public_card_eligible`?

Recommended Phase 2B approvers:

- `admin`: can approve, reject, revoke, flag, and clear all PartSentry public-card decisions with reason.
- `certified_garage_reviewer`: future tenant-scoped role, can approve non-own-tenant logs only if CarUp wants distributed review.

Recommended for first implementation:

- Admin only for `public_card_eligible`.

Reason:

- Public-card eligibility affects public marketplace claims.
- Current code has no certified garage reviewer role separate from `mechanic`.
- The existing auth model has `mechanic` and tenant roles, but tenant `admin` is not global admin.
- Mechanics must not approve their own records.

### 4. Which actors can set `verification_status` and `part_verification_status`?

Recommended:

- `verification_status`: admin in Phase 2B. Certified independent garage reviewer can be added later.
- `part_verification_status`: admin in Phase 2B. Certified independent garage reviewer can be added later if independent provenance rules are implemented.
- `mechanic`: may request verification, but cannot approve their own `partsentry_logs`.
- `garage`: may submit records or request review, but should not approve records from the same tenant in Phase 2B.

### 5. Should admin, government, or certified garage approve PartSentry records?

Recommended:

- Admin approves in Phase 2B.
- Certified garage reviewer should be deferred until the role exists explicitly.
- Government should not approve routine PartSentry records.

Government exception:

- Government can be involved later for stolen/suspicious part investigations, CID-linked suspicion resolution, or registry-backed stolen part clearance. That should be Phase 2C, not Phase 2B.

### 6. How should mechanics be prevented from verifying their own parts?

Backend rules:

- Compare reviewer `req.userContext.id` against `partsentry_logs.mechanic_id`.
- Compare reviewer tenant against the source garage tenant once a durable `tenant_id` or garage ownership link is available.
- Deny if `actor.id === partsentry_logs.mechanic_id`.
- Deny if `actor.tenantId === partsentry_logs.tenant_id` for non-admin certified garage reviewers.
- Require `canSetTrustFact(actor, 'verified_parts', 'approve', { submittedBy: mechanic_id, ownRecord: true })`.

Database support needed:

- `partsentry_logs.tenant_id` already appears in `database/migrations/002_multi_tenant_and_auth_schema.sql`, but Phase 2B should confirm this column exists in all environments and is populated by `addRepairLog()`.
- Add `submitted_by` or reuse `mechanic_id` consistently.
- Add `reviewed_by`, `reviewed_by_role`, `reviewed_by_tenant_id`, and timestamp fields either on `partsentry_logs` or on `partsentry_review_requests`.

### 7. What evidence is required for verified parts?

Minimum Phase 2B evidence:

- The PartSentry log itself: `partsentry_logs.id`.
- Work order reference, if available.
- Invoice or receipt evidence for the part.
- Part number or OEM code: `part_oem`.
- Installation action and mileage: `action_type`, `mileage`, `timestamp`.
- Vehicle link: `vin`.
- Mechanic or garage provenance: `mechanic_id`, tenant or organization context.

Recommended evidence references:

- `vehicle_evidence.id` rows with safe evidence types such as `service_invoice`, `parts_invoice`, `work_order_document`, `part_serial_photo`, `odometer_photo`, `mechanic_inspection_photo`.
- Optional future `part_evidence` table if CarUp needs part-level evidence independent of vehicle evidence.

Approval requirement:

- `part_verification_status = 'verified'` should require at least one verified invoice/receipt/serial/work-order evidence row and a non-empty `part_oem` or part identifier.

### 8. What fields should public marketplace cards be allowed to consume?

Allowed for marketplace card summaries:

- booleans/counts derived by `listingSummaryService.js`
- `partsentry_checked`
- `repair_history_count`
- `verified_parts_count`
- `recent_service`
- marketplace tags derived from those fields

Allowed source fields in backend summary calculation:

- `vin`
- `action_type`
- `timestamp`
- `created_at`
- `verification_status`
- `part_verification_status`
- `public_card_eligible`
- `suspicion_status` only for suppressing or filtering risky records, not for public card copy

Do not expose on public marketplace cards:

- `mechanic_id`
- reviewer IDs
- `tenant_id`
- raw `description`
- raw `signature`
- invoice URLs
- file storage paths
- private notes
- phone/email/address/national ID
- suspicion details

### 9. What audit events are required?

Required generic events:

- `PARTSENTRY_REVIEW_REQUESTED`
- `PARTSENTRY_REVIEW_APPROVED`
- `PARTSENTRY_REVIEW_REJECTED`
- `PARTSENTRY_REVIEW_REVOKED`

Required field events:

- `PARTSENTRY_PUBLIC_CARD_ELIGIBILITY_APPROVED`
- `PARTSENTRY_PUBLIC_CARD_ELIGIBILITY_REJECTED`
- `PARTSENTRY_PUBLIC_CARD_ELIGIBILITY_REVOKED`
- `PARTSENTRY_LOG_VERIFIED`
- `PARTSENTRY_LOG_REJECTED`
- `PARTSENTRY_LOG_DISPUTED`
- `PART_VERIFICATION_APPROVED`
- `PART_VERIFICATION_REJECTED`
- `PART_VERIFICATION_REVOKED`
- `PARTSENTRY_SUSPICION_FLAGGED`
- `PARTSENTRY_SUSPICION_CLEARED`

Audit fields:

- `vin`
- `trust_fact`
- `previous_value`
- `new_value`
- `actor_user_id`
- `actor_role`
- `actor_tenant_id`
- `source_route`
- `evidence_ids`
- `partsentry_log_ids`
- `reason`
- `decision_notes`
- `request_id`

### 10. Should PartSentry review appear in the existing Trust Review Queue UI or a separate PartSentry Review Queue?

Recommendation: create a separate PartSentry Review Queue.

Reason:

- `web/src/pages/dashboard/shared/TrustReviewQueue.tsx` is intentionally Phase 2A vehicle-fact-only.
- `TrustFactName` in `web/src/types/index.ts` is currently limited to `vehicle_condition_category`, `passport_verified`, and `inspection_ready`.
- PartSentry rows need log-level columns: part name, action type, mechanic/garage label, public-card requested value, part verification requested value, suspicion status, and evidence/provenance.
- Mixing the workflows would make the Phase 2A queue less clear and increase privacy risk.

Recommended future routes:

- `/admin/partsentry-review`
- later `/garage/partsentry-review` or `/mechanic/partsentry-review` only for submitter/request visibility, not self-approval

## Role Permission Matrix

| Role | Submit Review | Approve Public Card | Verify Service Log | Verify Part | Flag Suspicion | Clear Suspicion | Revoke Public Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `owner` | YES, own vehicle only | NO | NO | NO | REQUEST_ONLY | NO | REQUEST_ONLY |
| `dealer` | YES, tenant vehicle only | NO | NO | NO | REQUEST_ONLY | NO | REQUEST_ONLY |
| `mechanic` | YES, own log only | NO | NO for own log | NO for own part | REQUEST_ONLY | NO | NO |
| `garage` tenant role | YES, tenant log only | SHOULD_DEFER | SHOULD_DEFER | SHOULD_DEFER | REQUEST_ONLY | SHOULD_DEFER | SHOULD_DEFER |
| certified garage reviewer | SHOULD_DEFER | YES, independent logs only | YES, independent logs only | YES, independent logs only | YES | YES | YES |
| `admin` | YES | YES | YES | YES | YES | YES | YES |
| `government` | SHOULD_DEFER for suspicious/stolen parts only | NO | NO | NO | YES for CID-linked cases later | YES for CID-linked cases later | NO |
| `system` | NO source trust facts | NO | NO | NO | NO | NO | Refresh summaries only |

Phase 2B minimum:

- Admin approval only.
- Mechanics, owners, dealers, and garage tenants can submit/request review subject to scope.
- Government and certified garage reviewer workflows are deferred.

## State Machine For PartSentry Log Review

### Existing Fields

Table:

- `partsentry_logs`

Fields added by `database/migrations/20260603132036_marketplace_listing_summary_infra.sql`:

- `verification_status TEXT NOT NULL DEFAULT 'unverified'`
- `part_verification_status TEXT NOT NULL DEFAULT 'unverified'`
- `suspicion_status TEXT NOT NULL DEFAULT 'none'`
- `public_card_eligible BOOLEAN NOT NULL DEFAULT false`

Allowed `verification_status` values:

- `unverified`
- `pending`
- `verified`
- `rejected`
- `disputed`

Allowed `part_verification_status` values:

- `unverified`
- `pending`
- `verified`
- `rejected`
- `disputed`

Allowed `suspicion_status` values:

- `none`
- `watch`
- `flagged`
- `cleared`

### Proposed Review Request Statuses

New table:

- `partsentry_review_requests`

Request statuses:

- `pending`
- `approved`
- `rejected`
- `revoked`
- `superseded`

Review actions:

- `request_public_card_eligibility`
- `request_log_verification`
- `request_part_verification`
- `flag_suspicion`
- `clear_suspicion`
- `revoke_public_card_eligibility`

### Transition Rules

New log:

- `verification_status = 'unverified'`
- `part_verification_status = 'unverified'`
- `suspicion_status = 'none'`
- `public_card_eligible = false`

Submitted for review:

- create `partsentry_review_requests.status = 'pending'`
- optionally set `verification_status = 'pending'` or leave log unchanged until approval

Approved for public card:

- require reviewer permission
- require decision notes
- require audit event success before mutation
- set `public_card_eligible = true`
- set `verification_status = 'verified'` when service-log evidence is approved
- set `part_verification_status = 'verified'` only if part provenance evidence is approved
- require `suspicion_status IN ('none', 'cleared')`

Rejected:

- request `status = 'rejected'`
- public fields remain false/unverified
- optionally set `verification_status = 'rejected'` or `part_verification_status = 'rejected'` depending on rejected request type

Revoked:

- request `status = 'revoked'`
- set `public_card_eligible = false`
- optionally set affected verification status to `disputed` or `rejected`
- marketplace cards immediately stop deriving PartSentry labels from that log

Suspicion flagged:

- set `suspicion_status = 'flagged'`
- set `public_card_eligible = false`
- optional `verification_status = 'disputed'`
- do not show suspicion details on public marketplace cards

Suspicion cleared:

- set `suspicion_status = 'cleared'`
- public card eligibility still requires a separate approval or prior approved request revalidation

## Proposed Database Additions

### Dedicated Review Request Table

Status: BACKEND_NEEDED

Table:

- `partsentry_review_requests`

Suggested fields:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `partsentry_log_id BIGINT NOT NULL REFERENCES partsentry_logs(id) ON DELETE CASCADE`
- `vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE`
- `request_type TEXT NOT NULL`
- `requested_value JSONB NOT NULL`
- `current_value JSONB`
- `status TEXT NOT NULL DEFAULT 'pending'`
- `requested_by TEXT REFERENCES users(id)`
- `requested_by_role TEXT NOT NULL`
- `requested_by_tenant_id UUID`
- `reviewed_by TEXT REFERENCES users(id)`
- `reviewed_by_role TEXT`
- `reviewed_by_tenant_id UUID`
- `evidence_ids TEXT[] NOT NULL DEFAULT '{}'`
- `partsentry_log_ids TEXT[] NOT NULL DEFAULT '{}'`
- `reason TEXT`
- `decision_notes TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `reviewed_at TIMESTAMPTZ`
- `revoked_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Request type check:

- `public_card_eligible`
- `verification_status`
- `part_verification_status`
- `suspicion_status`

Status check:

- `pending`
- `approved`
- `rejected`
- `revoked`
- `superseded`

RLS/Supabase rule:

- Enable RLS.
- Revoke access from `anon` and `authenticated`.
- Grant backend `service_role`.
- Do not expose write access through Supabase Data API.

### Optional Partsentry Log Reviewer Fields

Status: BACKEND_NEEDED

Add to `partsentry_logs` only if direct row-level traceability is needed beyond `partsentry_review_requests` and `trust_audit_events`:

- `public_card_reviewed_by TEXT`
- `public_card_reviewed_at TIMESTAMPTZ`
- `verification_reviewed_by TEXT`
- `verification_reviewed_at TIMESTAMPTZ`
- `part_verification_reviewed_by TEXT`
- `part_verification_reviewed_at TIMESTAMPTZ`
- `suspicion_reviewed_by TEXT`
- `suspicion_reviewed_at TIMESTAMPTZ`

Recommendation:

- Keep reviewer metadata primarily in `partsentry_review_requests` and `trust_audit_events` for Phase 2B.
- Add row-level reviewer fields later only if query performance or reporting needs them.

## API Route Design

Status: BACKEND_NEEDED

Recommended new router:

- `backend/routes/partsentryReviewRoutes.js`

Recommended service:

- `backend/services/trustGovernance/partsentryReviewService.js`

Routes:

- `POST /api/verification/partsentry/:logId/requests`
- `GET /api/verification/partsentry/review-queue`
- `PATCH /api/verification/partsentry/:requestId/approve`
- `PATCH /api/verification/partsentry/:requestId/reject`
- `PATCH /api/verification/partsentry/:requestId/revoke`
- `PATCH /api/verification/partsentry/:logId/flag-suspicion`
- `PATCH /api/verification/partsentry/:logId/clear-suspicion`
- `GET /api/verification/partsentry/audit-trail/:vin`
- `GET /api/verification/partsentry/logs/:logId`

Route authorization:

- Submit route: `authorizeRole(['mechanic', 'owner', 'dealer', 'admin'])`
- Review queue: `authorizeRole(['admin'])` for Phase 2B
- Approve/reject/revoke: `authorizeRole(['admin'])` for Phase 2B
- Suspicion flag/clear: `authorizeRole(['admin'])` for Phase 2B

Should defer:

- certified garage reviewer routes
- government suspicion/CID routes
- public Parts Marketplace routes

## Evidence And Provenance Requirements

### Public Card Eligibility

Require:

- `partsentry_logs.id`
- same `vin`
- valid `action_type`
- valid `mileage`
- non-empty `part_name`
- `suspicion_status IN ('none', 'cleared')`
- reviewer decision notes

Should require at least one supporting evidence reference for Phase 2B:

- work order document
- service invoice
- mechanic inspection photo
- odometer photo

### Service Log Verification

Require:

- verified evidence for work performed
- mileage sanity check already exists in `addRepairLog()`
- no active suspicion flag
- reviewer not equal to `mechanic_id`

### Part Verification

Require:

- `part_oem` or durable part identifier
- invoice or receipt evidence
- part serial/OEM photo when available
- supplier or inventory provenance
- reviewer not equal to `mechanic_id`
- reviewer not from same tenant if certified garage review is enabled later

### Suspicion Status

Flag when:

- stolen part report
- mismatched part serial
- duplicate part identity
- odometer/service chronology inconsistency
- invoice or supplier inconsistency

Clear when:

- reviewer has evidence that resolves the issue
- decision notes explain the clearance
- audit events are written before mutation

## Marketplace Summary Impact

Status: SHOULD_KEEP_CURRENT_READ_SIDE_RULE

Do not add new public label language in Phase 2B.

Keep existing labels/tags:

- `PartSentry Checked`
- `Repair History Available`
- `Verified Parts`
- `Recent Service`

Backend summary impact:

- `partsentry_checked` remains true only when at least one public-card-eligible PartSentry row has `verification_status = 'verified'`.
- `repair_history_count` counts public-card-eligible rows whose `action_type` is `Repaired`, `Replaced`, `Inspected`, or `Diagnosed`.
- `verified_parts_count` counts public-card-eligible rows whose `part_verification_status = 'verified'`.
- `recent_service` derives from public-card-eligible repair rows inside the existing `RECENT_SERVICE_DAYS` window.

Additional hardening recommended:

- Explicitly ignore rows where `suspicion_status = 'flagged'` or `suspicion_status = 'watch'` even if `public_card_eligible = true`.
- Make approval service always set `public_card_eligible = false` when suspicion is flagged.

No materialized summary worker in Phase 2B:

- `GET /api/marketplace/listings` currently computes live through `listMarketplaceListings()`.
- Materialized `vehicle_listing_summaries` refresh remains deferred.

## Privacy Rules

Public marketplace cards may show:

- counts
- booleans
- safe PartSentry labels backed by current summary fields
- vehicle VIN-linked public summary context

Public Passport PartSentry section may show:

- part name
- OEM or part code if not sensitive
- action type
- mileage
- timestamp
- verification status
- part verification status
- checksum/signature prefix only if useful and not treated as proof by itself

Never expose publicly:

- `mechanic_id`
- reviewer user IDs
- tenant IDs
- private garage contacts
- raw `description`
- private invoices
- storage URLs
- raw metadata
- phone numbers
- emails
- addresses
- national IDs
- suspicion investigation notes
- actor identity beyond safe role labels

Audit trail UI:

- Admin can see decision notes and evidence IDs.
- Non-admin users should see redacted audit summaries only if vehicle/log scoped.
- Public users should not see audit trail details.

## Test Plan

### Backend Unit Tests

Add:

- `backend/tests/partsentry-review-workflow.test.js`

Cover:

- mechanic can request review for their own log
- owner can request review only for owned VIN log
- dealer can request review only for tenant VIN log
- admin can approve `public_card_eligible`
- admin can reject with required decision notes
- admin can revoke public card eligibility
- mechanic cannot approve their own log
- certified garage reviewer, if introduced, cannot approve same-tenant logs
- `public_card_eligible` approval requires `suspicion_status IN ('none', 'cleared')`
- `verified_parts` approval requires part evidence
- audit failure blocks mutation
- flagging suspicion disables public-card eligibility
- review queue returns safe fields only

### Existing Test Updates

Update:

- `backend/tests/trust-governance.test.js`

Add coverage:

- admin can approve/revoke `public_card_eligible` with reason
- mechanic cannot verify own `verified_parts`
- system cannot create PartSentry source trust facts
- government cannot approve routine PartSentry public-card facts in Phase 2B

Update:

- `backend/tests/marketplace-listing-summary.test.js`

Add coverage:

- `suspicion_status = 'flagged'` suppresses public PartSentry tags
- `public_card_eligible = false` suppresses all PartSentry public labels
- `verified_parts` appears only when `public_card_eligible = true` and `part_verification_status = 'verified'`
- repair history count uses only public-card-eligible records

### Route Tests

Add route-level tests for:

- `POST /api/verification/partsentry/:logId/requests`
- `GET /api/verification/partsentry/review-queue`
- `PATCH /api/verification/partsentry/:requestId/approve`
- `PATCH /api/verification/partsentry/:requestId/reject`
- `PATCH /api/verification/partsentry/:requestId/revoke`

### Frontend Tests

If Phase 2B includes UI:

- Add `web/e2e/partsentry-review-queue.spec.ts`

Cover:

- admin route loads PartSentry Review
- queue renders VIN, part name, action type, mechanic role label, requested public-card state, evidence count, suspicion state, status
- approve/reject/revoke modals require decision notes
- evidence drawer hides PII and raw file URLs
- audit drawer hides actor IDs and PII
- non-admin users see unauthorized
- mechanic cannot approve own records in UI

## Implementation Phases

### Phase 2B.1 Backend Review Foundation

Status: RECOMMENDED_FIRST

Implement:

- `partsentry_review_requests` migration
- `backend/services/trustGovernance/partsentryReviewService.js`
- `backend/routes/partsentryReviewRoutes.js`
- route mount in `backend/server.js`
- `canSetTrustFact()` PartSentry policy hardening
- audit events through `logAuditEvent()`
- backend tests

Keep deferred:

- UI
- public Parts Marketplace
- materialized summary refresh worker
- government/CID suspicion queue

### Phase 2B.2 Marketplace Summary Hardening

Implement:

- update `summarizePartSentry()` to ignore `suspicion_status IN ('watch', 'flagged')`
- add tests for suspicion suppression

No new public copy:

- continue using existing backed labels only.

### Phase 2B.3 Admin PartSentry Review Queue UI

Implement only after backend passes:

- `/admin/partsentry-review`
- optional admin sidebar link
- typed API helpers
- evidence/provenance drawer
- audit drawer
- approve/reject/revoke/flag/clear modals

Do not add:

- owner/dealer approval UI
- mechanic self-approval UI
- government PartSentry approval UI

### Phase 2C Deferred Workflows

Still deferred:

- certified garage independent reviewer workflow
- government/CID suspicion workflow
- public Parts Marketplace
- SafePay readiness
- ZIMRA/CID setters
- dealer verification
- listing summary refresh workers
- broad public trust badge language

## Implementation Checklist

- Create migration with Supabase-safe RLS and service-role access only.
- Add service functions for create/list/approve/reject/revoke/flag/clear.
- Enforce `canSetTrustFact()` on every mutation.
- Enforce no self-review for mechanics.
- Validate evidence and VIN/log scope.
- Write required audit events before public-card mutation.
- Keep public reads limited to safe fields.
- Add backend unit and route tests.
- Add marketplace summary suppression tests.
- Only then add admin UI if approved.

## Final Recommendation

Build Phase 2B as a narrow backend-first PartSentry review workflow with a dedicated `partsentry_review_requests` table. Keep admin as the only approver initially. Preserve the existing marketplace rule that PartSentry public labels appear only when explicit approved data exists. Defer certified garage, government suspicion, public Parts Marketplace, and materialized summary workers until the backend approval state machine is proven.
