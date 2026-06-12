# CARUP_VERIFICATION_GOVERNANCE_AUDIT.md

## 1. Executive summary

Status: PARTIAL

PR #7 added the read-side marketplace summary foundation, but trust-field governance is not implemented yet. The codebase can display some trust signals safely because `backend/services/marketplace/listingSummaryService.js` derives them from explicit fields or public verified records. However, most trust facts have no approved setter workflow, no role-specific dashboard review queue, and no durable verification audit trail.

The strongest existing governance pattern is evidence review:

- IMPLEMENTED: `backend/services/evidence/evidenceService.js` defines upload permissions through `canUploadEvidence()` and verification status values through `verificationStatuses`.
- PARTIAL: `backend/routes/vehiclesRoutes.js` exposes evidence upload, review, verify, and reject routes.
- MISSING: the route imports `logAuditEvent` from `backend/services/auditLogger.js`, but that file is absent in the current tree.
- MISSING: `backend/server.js` imports `./middleware/correlationMiddleware.js`, but `backend/middleware/correlationMiddleware.js` is absent.

The main governance risks are:

- `backend/middleware/authMiddleware.js` allows `x-stakeholder-role` to become the effective authorization role without proving the user may assume that role.
- Several routes expect `req.userContext.userId`, while `authorizeRole()` sets `req.userContext.id`.
- `organization_audit_logs` exists, but it is organization-scoped and user-callable. It is not a central immutable trust-fact audit trail.
- `system_audit_logs` appears in `database/migrations/004_add_tamper_proofing.sql` with SQLite syntax (`AUTOINCREMENT`), so it is not a reliable Supabase/Postgres audit foundation.
- `partsentry_logs` are public through `GET /api/partsentry/:vin` in `backend/server.js`, while PR #7 correctly requires `public_card_eligible = true` for marketplace card trust signals.

Recommended Phase 1: build the governance foundation before adding more UI claims. Add central audit logging, request correlation, effective-role authorization, trust-fact setter policy, and minimal backend setter workflows for facts already shown in marketplace cards. Defer advanced ranking, certification automation, and broad dashboard polish until the audit and authorization foundation is in place.

## 2. Existing roles and permissions

Status: PARTIAL

Canonical roles currently found:

| Role | Status | Evidence |
|---|---:|---|
| `owner` | IMPLEMENTED | `shared/types/index.ts`, `database/migrations/supabase_schema.sql`, `backend/server.js` role switch catalog |
| `dealer` | IMPLEMENTED | `shared/types/index.ts`, `database/migrations/supabase_schema.sql`, dealer dashboard routes in `web/src/App.tsx` |
| `mechanic` | IMPLEMENTED | `shared/types/index.ts`, `database/migrations/supabase_schema.sql`, mechanic dashboard routes in `web/src/App.tsx` |
| `insurance` | IMPLEMENTED | `shared/types/index.ts`, `database/migrations/supabase_schema.sql`, insurance dashboard routes in `web/src/App.tsx` |
| `government` | IMPLEMENTED | `shared/types/index.ts`, `database/migrations/supabase_schema.sql`, government dashboard routes in `web/src/App.tsx` |
| `admin` | IMPLEMENTED | `shared/types/index.ts`, `database/migrations/supabase_schema.sql`, admin dashboard routes in `web/src/App.tsx` |
| `bank` | IMPLEMENTED | `shared/types/index.ts`, `database/migrations/supabase_schema.sql`, bank dashboard routes in `web/src/App.tsx` |
| `finance` | PARTIAL | Used in `backend/routes/financeRoutes.js` via `authorizeRole(['admin', 'finance', 'bank'])`, but not present in shared role types or `users.role` checks |
| `certified dealer` | MISSING | No role or certification table found; currently only a planned trust concept |
| `garage` | MISSING | No separate role; garage behavior is represented by `mechanic` and tenant-scoped mechanic routes |
| `system job` | MISSING | No explicit system actor role; backend services run with service credentials but do not identify system audit actors |

Permission implementation:

- `backend/middleware/authMiddleware.js` exports `authorizeRole(allowedRoles = [])`.
- `authorizeRole()` validates `x-session-token` or Bearer token against `user_sessions`.
- If no token is present, it falls back to `x-user-id`.
- It fetches `users(role, is_verified)`.
- If `x-tenant-id` is present, it validates `tenant_users(tenant_id, user_id)`.
- It sets `req.userContext = { id, role, tenantId }`.

Authorization gaps:

- BACKEND_NEEDED: `x-stakeholder-role` is trusted as `activeRole` without proving it matches the real user role or tenant membership.
- BACKEND_NEEDED: the `x-user-id` fallback should be restricted to local/test mode or removed.
- BACKEND_NEEDED: several routes use `req.userContext.userId`, but the middleware sets `req.userContext.id`.
- BACKEND_NEEDED: trust fact writes need field-level authorization, not only route-level role checks.

## 3. Existing dashboard map

Status: PARTIAL

Top-level dashboard routes are defined in `web/src/App.tsx`. Navigation labels are defined in `web/src/components/layout/DashboardLayout.tsx`.

| Dashboard | Route paths | Status | Governance relevance |
|---|---|---:|---|
| Owner | `/dashboard`, `/dashboard/garage`, `/dashboard/service-history`, `/dashboard/insurance`, `/dashboard/partsentry`, `/dashboard/listings`, `/dashboard/my-listings`, `/dashboard/sell-vehicle`, `/dashboard/ai` | PARTIAL | Owner can create listings and view PartSentry UI, but no governed trust-fact approval |
| Dealer | `/dealer`, `/dealer/inventory`, `/dealer/leads`, `/dealer/promotions`, `/dealer/analytics`, `/dealer/evidence` | PARTIAL | Dealer inventory exists; evidence review page exists, but backend approve/reject is admin/government only |
| Mechanic | `/mechanic`, `/mechanic/work-orders`, `/mechanic/service-logs`, `/mechanic/parts`, `/mechanic/customers` | PARTIAL | Work orders and parts routes exist; PartSentry public-card governance is missing |
| Insurance | `/insurance-dash`, `/insurance-dash/claims`, `/insurance-dash/risk`, `/insurance-dash/fraud` | UI_ONLY | Dashboard pages exist, but trust fact setters were not found |
| Government | `/government`, `/government/registry`, `/government/compliance`, `/government/evidence` | PARTIAL | Registry and evidence screens exist; registry route does not write vehicle trust fields |
| Bank | `/bank`, `/bank/applications`, `/bank/collateral`, `/bank/risk` | PARTIAL | Finance dashboards exist; SafePay readiness setter is missing |
| Admin | `/admin`, `/admin/users`, `/admin/ai`, `/admin/moderation`, `/admin/evidence` | PARTIAL | Marketplace moderation and evidence review exist; central trust governance queue is missing |

Existing important screens:

- `web/src/pages/dashboard/admin/EvidenceReview.tsx`: shared evidence review UI used by `/admin/evidence`, `/dealer/evidence`, and `/government/evidence`.
- `web/src/pages/dashboard/admin/MarketplaceModeration.tsx`: moderation screen using `updateVehicleStatus()`.
- `web/src/pages/dashboard/government/RegistryVerification.tsx`: registry verification screen using compliance APIs.
- `web/src/pages/dashboard/owner/SellVehicle.tsx`: seller listing creation screen using `createVehicleListing()`.
- `web/src/pages/dashboard/owner/PartSentry.tsx`: owner-facing PartSentry UI with demo/fallback behavior.
- `web/src/pages/dashboard/mechanic/ServiceLogs.tsx`: mechanic service log UI with mock data and `addRepairLog()` integration.
- `web/src/pages/dashboard/mechanic/WorkOrders.tsx`: mechanic work order screen.
- `web/src/pages/dashboard/mechanic/PartsTracking.tsx`: mechanic parts screen.

## 4. Trust field governance matrix

Status: BACKEND_NEEDED

| Trust fact | Current source | Current setter workflow | Required governing actor | Status |
|---|---|---|---|---:|
| `vehicle_condition_category` | `vehicles.vehicle_condition_category` added by `database/migrations/20260603132036_marketplace_listing_summary_infra.sql` | None found. `web/src/pages/dashboard/owner/SellVehicle.tsx` has condition UI, but `POST /api/vehicles/add` in `backend/server.js` does not persist the canonical field | Owner/dealer submit; admin/dealer moderation or policy validates | MISSING |
| `passport_verified` | `vehicles.passport_verified`, `vehicles.passport_verified_at`, `vehicles.passport_verification_source` | None found | Admin or government reviewer; system may refresh after approved evidence bundle | MISSING |
| `plate_verified` | `vehicles.plate_verified_at` or `vehicles.plate_status = 'verified'` in `listingSummaryService.js` | PARTIAL: `backend/routes/complianceRoutes.js` updates `registry_verifications`, not `vehicles.plate_verified_at` or `vehicles.plate_status` | Government/admin registry reviewer | PARTIAL |
| `zimra_verified` | `vehicles.zimra_verified`, `vehicles.zimra_verified_at` | None found; ZIMRA duty estimation exists in `backend/routes/vehiclesRoutes.js`, but it is not a verification setter | Government/admin customs reviewer | MISSING |
| `cid_clear` | `vehicles.police_verified` is mapped to `cid_clear` by `deriveMarketplaceTags()` | None found beyond vehicle creation default false and evidence type `police_clearance_document` | Government/admin registry or police clearance reviewer | PARTIAL |
| `safe_pay_ready` | `vehicles.safe_pay_ready` | SafePay transaction flow exists, but no vehicle readiness setter found | Finance/SafePay operator or system policy | MISSING |
| `inspection_ready` | `vehicles.inspection_ready` | Evidence type `inspection_photo` exists, but no readiness setter found | Admin/government/dealer inspection reviewer | MISSING |
| `evidence_available` | Derived from verified `vehicle_evidence` rows with `visibility_level = 'public_safe'` in `summarizeEvidence()` | No direct setter required | System derived from evidence workflow | IMPLEMENTED |
| `partsentry_checked` | Derived from `partsentry_logs.public_card_eligible = true` and `verification_status = 'verified'` | No approval workflow found; `addRepairLog()` does not set public eligibility or verified status | Mechanic submits; admin/garage reviewer approves | PARTIAL |
| `repair_history_available` | Derived from public-card eligible PartSentry repair/service logs | No public-card review workflow found | Mechanic/garage submit; reviewer approves public visibility | PARTIAL |
| `verified_parts` | Derived from `partsentry_logs.public_card_eligible = true` and `part_verification_status = 'verified'` | No part verification workflow found | Mechanic/garage submit; admin/certified garage verifies | PARTIAL |
| `public_card_eligible` | `partsentry_logs.public_card_eligible` | No setter workflow found | Admin/certified garage/government depending on record type | MISSING |
| `seller_display_label` | Derived by `getSellerSummary()` in `listingSummaryService.js` | No approval workflow for public dealer labels found | Admin/dealer verification process | PARTIAL |
| `dealer_verified` | Derived from seller type in `deriveMarketplaceTags()` | No certification workflow found | Admin/dealer certification reviewer | PARTIAL |
| `marketplace_tags` | Derived by `deriveMarketplaceTags()` | No direct setter required; should remain computed | System summary service | IMPLEMENTED |
| `vehicle_listing_summaries refresh` | `vehicle_listing_summaries` table plus live `listMarketplaceListings()` service | No refresh job or mutation endpoint found | System job | MISSING |

## 5. Missing setter workflows

Status: BACKEND_NEEDED

Missing or unsafe setter workflows:

- MISSING: trusted setter for `vehicles.vehicle_condition_category`.
- MISSING: trusted setter for `vehicles.passport_verified`, `passport_verified_at`, and `passport_verification_source`.
- PARTIAL: trusted setter for plate verification. `backend/routes/complianceRoutes.js` changes `registry_verifications.status`, but not the canonical vehicle fields used by marketplace summaries.
- MISSING: trusted setter for `vehicles.zimra_verified` and `zimra_verified_at`.
- PARTIAL: CID clearance is represented by `vehicles.police_verified`, but no dedicated CID clearance workflow was found.
- MISSING: trusted setter for `vehicles.safe_pay_ready`.
- MISSING: trusted setter for `vehicles.inspection_ready`.
- MISSING: trusted setter for `partsentry_logs.public_card_eligible`.
- MISSING: trusted setter for `partsentry_logs.verification_status`.
- MISSING: trusted setter for `partsentry_logs.part_verification_status`.
- MISSING: trusted dealer certification workflow for `dealer_verified` and public seller display labels.
- MISSING: listing summary refresh job that writes `vehicle_listing_summaries`.

Unsafe or stale flows:

- `POST /api/partsentry/add` in `backend/server.js` accepts `mechanicId` from the request body instead of deriving it from `req.userContext.id`.
- `GET /api/partsentry/:vin` in `backend/server.js` returns `partsentry_logs.select('*')` publicly.
- `web/src/pages/dashboard/owner/PartSentry.tsx` uses local/demo fallback behavior and should not be treated as a real trust setter.
- `web/src/pages/dashboard/mechanic/ServiceLogs.tsx` uses mock service logs and a hard-coded mechanic ID.
- `web/src/pages/dashboard/owner/MyListings.tsx` sends a raw status update request without auth headers and then updates local UI on failure.

## 6. Audit logging readiness

Status: MISSING

Existing audit-related structures:

| Item | File/table | Status | Notes |
|---|---|---:|---|
| `organization_audit_logs` | `database/migrations/supabase_schema.sql` | PARTIAL | Organization-scoped audit table with `organization_id`, `user_id`, `action`, `resource`, `details`, `ip_address`; not trust-fact specific |
| Organization audit API | `backend/server.js` routes `/api/organizations/:id/audit-logs` | PARTIAL | Allows organization users/admins to create logs. This is not an immutable central audit logger |
| `role_switch_logs` | `database/migrations/supabase_schema.sql`, `database/migrations/003_add_user_sessions.sql` | PARTIAL | Table exists, but `/api/auth/switch-role` does not appear to write to it |
| `system_audit_logs` | `database/migrations/004_add_tamper_proofing.sql` | UNSAFE | Uses SQLite syntax (`INTEGER PRIMARY KEY AUTOINCREMENT`) and is not a verified Supabase/Postgres foundation |
| `trust_score_history` | `database/migrations/supabase_schema.sql`, `backend/services/trustGraph/trustGraphService.js` | IMPLEMENTED | Tracks trust score changes, not all trust fact changes |
| `backend/services/auditLogger.js` | Imported by `backend/routes/vehiclesRoutes.js` | MISSING | Referenced but absent |
| `correlationMiddleware.js` | Imported by `backend/server.js` | MISSING | Referenced but absent |
| Request ID fallback | `backend/middleware/errorMiddleware.js` | PARTIAL | Creates request ID only when handling errors |

Required audit table shape:

- `id`
- `event_type`
- `vin`
- `vehicle_id`
- `trust_fact`
- `previous_value`
- `new_value`
- `actor_user_id`
- `actor_role`
- `actor_tenant_id`
- `actor_type` such as `user`, `system`, `service`
- `source_dashboard`
- `source_route`
- `evidence_ids`
- `partsentry_log_ids`
- `registry_verification_id`
- `safepay_transaction_id`
- `reason`
- `decision_notes`
- `request_id`
- `ip_address`
- `user_agent`
- `created_at`

Required audit behavior:

- BACKEND_NEEDED: every trust fact change must produce one immutable audit event.
- BACKEND_NEEDED: rejected attempts should produce an audit event when an authenticated user attempted a governed action.
- BACKEND_NEEDED: audit logs must store before and after values.
- BACKEND_NEEDED: system refreshes of `vehicle_listing_summaries` must have actor `system:listing-summary-refresh`.
- BACKEND_NEEDED: audit reads must be role-scoped and must not expose private evidence metadata to public users.

## 7. Required audit events

Status: BACKEND_NEEDED

Minimum required events:

| Event | Trigger | Actor |
|---|---|---|
| `ROLE_SWITCH_REQUESTED` | `/api/auth/switch-role` called | User |
| `ROLE_SWITCH_GRANTED` | Role switch succeeds | User/system |
| `ROLE_SWITCH_DENIED` | Role switch rejected | User/system |
| `TRUST_FACT_CHANGE_REQUESTED` | Any dashboard submits a trust fact change | User |
| `TRUST_FACT_APPROVED` | Reviewer approves trust fact | Admin/government/finance/certified role/system |
| `TRUST_FACT_REJECTED` | Reviewer rejects trust fact | Admin/government/finance/certified role |
| `TRUST_FACT_REVOKED` | Previously approved fact is revoked | Admin/government/system |
| `VEHICLE_CONDITION_CATEGORY_SET` | Canonical condition changes | Dealer/admin/system policy |
| `PASSPORT_VERIFICATION_APPROVED` | `passport_verified` becomes true | Admin/government/system |
| `PASSPORT_VERIFICATION_REVOKED` | Passport trust is revoked | Admin/government/system |
| `PLATE_VERIFICATION_APPROVED` | Plate verification becomes true | Government/admin |
| `ZIMRA_VERIFICATION_APPROVED` | ZIMRA verification becomes true | Government/admin |
| `CID_CLEARANCE_APPROVED` | CID clearance becomes true | Government/admin |
| `SAFE_PAY_READY_SET` | SafePay readiness changes | Finance/SafePay operator/system |
| `INSPECTION_READY_SET` | Inspection readiness changes | Admin/government/dealer reviewer |
| `EVIDENCE_UPLOADED` | Evidence upload succeeds | Allowed uploader |
| `EVIDENCE_VERIFIED` | Existing evidence verify route succeeds | Admin/government |
| `EVIDENCE_REJECTED` | Existing evidence reject route succeeds | Admin/government |
| `PARTSENTRY_LOG_CREATED` | Mechanic creates repair/part log | Mechanic |
| `PARTSENTRY_PUBLIC_CARD_APPROVED` | `public_card_eligible` becomes true | Admin/certified garage |
| `PARTSENTRY_PUBLIC_CARD_REVOKED` | Public card eligibility is removed | Admin/certified garage |
| `PART_VERIFIED` | `part_verification_status` becomes verified | Admin/certified garage |
| `SELLER_DISPLAY_LABEL_APPROVED` | Dealer public label is approved | Admin |
| `LISTING_SUMMARY_REFRESHED` | Summary row is refreshed | System job |
| `LISTING_SUMMARY_REFRESH_FAILED` | Summary refresh fails | System job |

## 8. Required state machines

Status: BACKEND_NEEDED

Evidence state machine:

- Existing statuses: `pending`, `verified`, `rejected`, `disputed`, `superseded` in `backend/services/evidence/evidenceService.js`.
- Required transitions:
  - `pending -> verified`
  - `pending -> rejected`
  - `verified -> disputed`
  - `verified -> superseded`
  - `disputed -> verified`
  - `disputed -> rejected`
- Governance requirement: only admin/government should approve public trust impact until dealer/mechanic reviewer boundaries are explicitly defined.

PartSentry state machine:

- Current fields: `partsentry_logs.verification_status`, `part_verification_status`, `suspicion_status`, `public_card_eligible`.
- Required log flow:
  - `submitted -> review_pending -> verified -> public_card_eligible`
  - `submitted -> rejected`
  - `verified -> disputed`
  - `public_card_eligible -> revoked`
- Required part flow:
  - `unverified -> review_pending -> verified`
  - `unverified -> rejected`
  - `verified -> revoked`

Passport state machine:

- Required flow:
  - `not_requested -> evidence_pending -> review_pending -> verified`
  - `verified -> suspended`
  - `verified -> revoked`
  - `verified -> expired`
  - `suspended -> verified`

Listing state machine:

- Current statuses are inconsistent across code paths. `backend/services/marketplace/listingSummaryService.js` treats marketplace-visible statuses as active/available/reserved variants. `web/src/pages/dashboard/admin/MarketplaceModeration.tsx` uses moderation statuses such as `approved` and `banned`.
- Required flow:
  - `draft -> submitted -> active`
  - `active -> flagged`
  - `flagged -> suspended`
  - `suspended -> active`
  - `active -> sold`
  - `active -> archived`
  - `active -> quarantined`

SafePay state machine:

- Existing flow in `backend/services/safepay/escrowService.js`:
  - `Pending -> Escrowed`
  - `Escrowed -> Inspecting`
  - `Inspecting -> Completed`
  - `Inspecting -> Disputed`
- Required governance:
  - Add role permissions per transition.
  - Audit every transition.
  - Only finance/SafePay operator or validated buyer/seller contexts should change transaction status.

Listing summary refresh state machine:

- Required flow:
  - `dirty -> queued -> refreshing -> refreshed`
  - `refreshing -> failed`
  - `failed -> queued`
- Required actor: `system:listing-summary-refresh`.

## 9. Backend authorization recommendations

Status: BACKEND_NEEDED

Recommended authorization changes:

- Add a trusted effective-role resolver in `backend/middleware/authMiddleware.js`.
- Do not allow `x-stakeholder-role` to override authorization unless it maps to a verified session role or a verified `tenant_users.role`.
- Remove or restrict `x-user-id` fallback to local/test mode.
- Normalize `req.userContext.id` usage and fix routes that read `req.userContext.userId`.
- Add a trust permission policy such as `canSetTrustFact(actor, fact, vehicle, proposedValue, evidenceRefs)`.
- Require vehicle scope for every setter:
  - Owner can submit claims for owned vehicle only.
  - Dealer can submit claims for tenant inventory only.
  - Mechanic can submit PartSentry/service claims for authorized work orders only.
  - Government can approve registry, plate, ZIMRA, and CID facts.
  - Finance/SafePay operator can set SafePay readiness only through SafePay workflow.
  - Admin can override with reason and audit.
  - System job can compute derived facts and refresh summaries, but cannot create source facts.
- Add route-level and field-level authorization for every trust setter.
- Add central audit logging before and after mutation.
- Add transaction boundaries around trust fact mutation, audit insert, and summary refresh enqueue.

Recommended route design:

- `POST /api/verification/trust-facts/:vin/requests`
- `PATCH /api/verification/trust-facts/:vin/:fact/approve`
- `PATCH /api/verification/trust-facts/:vin/:fact/reject`
- `PATCH /api/verification/trust-facts/:vin/:fact/revoke`
- `GET /api/verification/review-queue`
- `GET /api/verification/audit-trail/:vin`
- `POST /api/marketplace/listings/:vin/summary/refresh` for admin/system only, or internal job only.

## 10. Dashboard implementation recommendations

Status: BACKEND_NEEDED

Recommended dashboard queues:

- Admin trust review queue:
  - Route: new page under `/admin`
  - Scope: all trust fact requests, overrides, revocations, failed summary refreshes.
- Government verification queue:
  - Extend `/government/registry` and `/government/evidence`
  - Scope: plate, ZIMRA, CID, registration, ownership transfer, public government evidence.
- Dealer trust submissions:
  - Extend `/dealer/inventory`
  - Scope: submit vehicle condition, listing readiness, dealer-owned evidence.
- Dealer certification queue:
  - Admin-only review of dealer public display label and `dealer_verified`.
- Mechanic/Garage PartSentry queue:
  - Extend `/mechanic/service-logs` and `/mechanic/parts`
  - Scope: submit PartSentry logs for public-card review.
- Admin PartSentry public-card review:
  - New admin queue for `public_card_eligible`, `verification_status`, and `part_verification_status`.
- SafePay operator queue:
  - Extend bank/finance dashboard.
  - Scope: `safe_pay_ready` and SafePay state transitions.
- Audit trail viewer:
  - Admin/government visible by VIN, trust fact, actor, status, and date range.

UI rules:

- Do not show a toggle that directly flips public trust facts without a review decision screen.
- Every approval/rejection UI must require decision notes.
- Every override must require a reason.
- Public labels must be previewed exactly as marketplace cards will render them.
- Evidence and PartSentry review UIs must distinguish uploaded evidence from listing images.

## 11. Privacy and anti-fraud rules

Status: BACKEND_NEEDED

Privacy rules:

- Public marketplace APIs must never return seller phone, seller email, owner id, private owner name, address, national ID, private evidence metadata, or non-public PartSentry records.
- Private sellers must always display as `Private seller`.
- Dealer names may display only when `public_seller_display_enabled = true`.
- PartSentry records may affect marketplace cards only when `public_card_eligible = true`.
- Evidence may affect public trust signals only when `vehicle_evidence.verification_status = 'verified'` and `vehicle_evidence.visibility_level = 'public_safe'`.
- Listing images must never be counted as evidence.

Anti-fraud rules:

- A user cannot approve their own trust fact submission unless explicitly allowed for low-risk fields.
- Dealers cannot set `dealer_verified` for themselves.
- Mechanics cannot set `part_verification_status = 'verified'` for their own submitted part records without a certified-review rule.
- Government facts must require a government/admin actor and an auditable source reference.
- SafePay readiness must come from SafePay workflow state, not seller/dealer self-attestation.
- Revocation must be first-class for every public trust fact.
- Trust summary refresh must only reflect source facts, never invent facts.

## 12. Proposed implementation phases

Status: SHOULD_DEFER product UI until governance foundation exists

Phase 1: governance foundation

- Add Postgres-safe central trust audit table.
- Add `backend/services/auditLogger.js`.
- Add `backend/middleware/correlationMiddleware.js`.
- Fix `authorizeRole()` effective-role handling.
- Fix `req.userContext.userId` call sites to use `req.userContext.id`.
- Add trust fact permission matrix and tests.
- Add audit writes to existing evidence approve/reject and vehicle status update flows.
- Add audit writes to role switching.
- Lock public PartSentry reads to public-safe fields only.

Phase 2: governed trust fact setters

- Add backend endpoints for trust fact requests, approvals, rejections, and revocations.
- Add setter workflows for `vehicle_condition_category`, `passport_verified`, `plate_verified`, `zimra_verified`, `cid_clear`, `safe_pay_ready`, and `inspection_ready`.
- Add PartSentry review workflow for `public_card_eligible`, `verification_status`, and `part_verification_status`.
- Add dealer public label and dealer verification workflow.

Phase 3: dashboard review queues

- Add admin trust review queue.
- Extend government registry/evidence queues.
- Extend mechanic/garage PartSentry queues.
- Add SafePay operator queue.
- Add audit trail viewer.

Phase 4: listing summary refresh infrastructure

- Add dirty/queued/refreshed summary refresh flow.
- Add system actor identity.
- Add summary refresh retries and failure audit events.
- Materialize `vehicle_listing_summaries` from governed source facts.

Phase 5: ranking and advanced anti-fraud

- Add backend-supported marketplace ranking.
- Add dispute/revocation analytics.
- Add risk scoring for suspicious role switches, repeated rejected claims, mileage anomalies, and seller/dealer behavior.

## 13. Test plan

Status: BACKEND_NEEDED

Backend authorization tests:

- `authorizeRole()` rejects spoofed `x-stakeholder-role`.
- `authorizeRole()` rejects unauthorized role switching.
- Owner cannot approve trust facts.
- Dealer cannot self-certify `dealer_verified`.
- Mechanic cannot verify their own part records unless policy allows it.
- Government can approve plate, ZIMRA, and CID facts.
- Finance/SafePay actor can set SafePay readiness through allowed workflow only.
- System actor can refresh listing summaries but cannot create source trust facts.

Audit tests:

- Every trust fact approval writes one audit event with before value, after value, actor, role, VIN, request ID, and reason.
- Every rejection writes an audit event.
- Every revocation writes an audit event.
- Evidence verify/reject routes write `EVIDENCE_VERIFIED` and `EVIDENCE_REJECTED`.
- Role switch writes `ROLE_SWITCH_REQUESTED`, `ROLE_SWITCH_GRANTED`, or `ROLE_SWITCH_DENIED`.
- Listing summary refresh writes `LISTING_SUMMARY_REFRESHED` or `LISTING_SUMMARY_REFRESH_FAILED`.

Migration/RLS tests:

- New audit migrations run on clean Supabase/Postgres.
- No SQLite-only syntax is introduced.
- Public users cannot read private trust audit records.
- Admin/government can read appropriate audit records.
- Organization users cannot forge central trust audit records.

Privacy tests:

- `GET /api/marketplace/listings` does not return seller phone, seller email, owner id, private owner name, address, national ID, private evidence fields, or non-public PartSentry records.
- Private sellers always return `Private seller`.
- Dealer label appears only when `public_seller_display_enabled = true`.
- Evidence Available appears only for verified `public_safe` evidence.
- PartSentry Checked appears only for `public_card_eligible = true` and `verification_status = 'verified'`.
- Verified Parts appears only for `public_card_eligible = true` and `part_verification_status = 'verified'`.

State-machine tests:

- Invalid evidence transitions are rejected.
- Invalid PartSentry transitions are rejected.
- Invalid Passport transitions are rejected.
- Invalid listing moderation transitions are rejected.
- Invalid SafePay transitions are rejected.
- Revoked facts disappear from marketplace tags after summary refresh.

Frontend Playwright tests:

- Admin trust review queue renders pending trust fact requests.
- Government registry queue can approve and reject plate verification.
- Evidence review queue requires decision notes.
- PartSentry public-card review queue does not expose private mechanic notes publicly.
- Audit trail viewer shows trust fact history for an authorized admin.
- Marketplace cards continue to hide private owner/seller PII.

Regression commands after implementation:

```bash
npm run build --workspace=web
node backend/tests/marketplace-listing-summary.test.js
node --check backend/routes/marketplaceRoutes.js
node --check backend/services/marketplace/listingSummaryService.js
npx playwright test web/e2e/marketplace-cards.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/navigation-commerce.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/homepage.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/plate-privacy.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/evidence-timeline.spec.ts --config=web/playwright.config.ts --project=chromium
```
