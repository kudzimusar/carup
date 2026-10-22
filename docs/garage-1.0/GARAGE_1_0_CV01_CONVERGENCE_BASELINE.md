# GARAGE-1.0-CV01 — Accepted Garage / Service Network → Current Corporate / AUTH Convergence

Repository: `kudzimusar/carup`

Programme: **CARUP GARAGE-1.0 — BUSINESS OPERATING SYSTEM COMPLETION**

CV01 parent authority:

`166025842bc2bae024c13162c2f3623617f88277`

Inherited AUTH-05 head:

`32be52360bb38987ba4a72e644f118d643b34f7e`

Historical Garage / Service Network sources used for parity comparison only:

- PR #197 `c23f012c4399f472eb6a9cae89b67fcc15a4ed40`
- PR #209 product tree `5bc3c96eaba410d98478ec2f8208d378029d0b2f`
- PR #209 current head `ce45e16f1b52b4eb59cb49e5955cc4830db0cf97`

## 1. CV01 purpose

CV01 creates the exact Garage programme foundation from which GARAGE-1.0 may add new operating-system capability.

It does **not** add multi-site, workforce, CRM, scheduling, inventory, quoting, invoicing, payment, receipt, or new intelligence functionality.

Its job is to prove that the accepted Garage / Service Network capabilities from the older lineage are represented by the newer Corporate / One CarUp authority without weakening current authentication, tenancy, Corporate governance, or AUTH-05.

## 2. Convergence result

The old and new lineages diverge at:

`bb9d9900c700873ca57df0ac18a1a5c01f77711a`

The current Corporate line already contains selectively ported and hardened versions of the material Garage / Service Network product:

- Garage application and evidence;
- governed Garage review;
- canonical activation;
- Garage invitation and membership lifecycle;
- Garage public profile and publication;
- Garage Directory and Garage Detail;
- Service Case;
- Garage queue;
- work-order convergence;
- mechanic assignment history;
- service records;
- PartSentry / evidence binding;
- Service Link;
- owner service history;
- Garage / mechanic service intelligence.

The only legacy Garage-specific executable source still present on PR #209 but absent on the current line is the old Garage-specific operating-context authority / switcher family. That authority is intentionally superseded by the centralized active-organization session contract and must not be restored.

Therefore CV01 requires **zero Garage product-source carry-forward** from PR #209 at baseline.

## 3. Frozen current authority

The following current semantics are load-bearing and remain frozen through CV01:

1. session identity resolves through AUTH-05;
2. active organization is explicitly selected on the session;
3. `x-tenant-id` is an assertion, never authority by itself;
4. tenant membership is reverified for requests;
5. tenant status and type are verified for Garage actions;
6. tenant roles do not become platform roles;
7. Garage applicant status grants no operating authority;
8. Garage approval and activation remain separate acts;
9. activation derives tenant, founder and founding role server-side;
10. invitation secrets remain hashed, expiring, revocable and single-use;
11. invitation acceptance remains atomic and verified-email bound;
12. membership removal / demotion preserves last-admin safety under a Garage lock;
13. membership removal ends future authority but does not erase historical work;
14. branch attribution remains tenant-constrained;
15. work-order assignment remains durable and tenant-safe;
16. Service Records remain source history;
17. Corporate memberships and Corporate permissions remain a separate governance plane from Garage `tenant_users`;
18. ordinary `service_role` does not regain AUTH-05 session authority.

## 4. Superseded legacy assets

The following are not candidates for restoration during CV01:

- `backend/services/garageOnboarding/garageContextService.js`
- `web/src/components/garage/GarageContextSwitcher.tsx`
- September Service Network migrations superseded by the October OC5D migration line;
- September Garage activation / invitation / membership migrations superseded by the October OC5E line;
- legacy role-selection assumptions that predate session-bound active organization authority.

Legacy tests, UAT scripts and receipts remain useful historical evidence but do not outrank the current executable authority.

## 5. Canonical migration line to preserve

Garage / onboarding:

- `20260918090000_ocr_c3_garage_applications.sql`
- `20260918100000_ocr_c3_garage_application_evidence.sql`
- `20260918110000_ocr_c3_garage_onboarding_rls.sql`
- `20261003100000_ocr_c3_garage_evidence_lineage_reconciliation.sql`
- `20261004190000_gmo3_garage_application_decision.sql`
- `20261004190100_gmo4_garage_business_activation.sql`
- `20261004190200_gmo6_garage_invitations.sql`
- `20261004190300_gmo7_garage_membership_guard.sql`

Service Network:

- `20261004180000_service_network_s1_garage_identity.sql`
- `20261004180100_service_network_s2_service_cases.sql`
- `20261004180200_service_network_s3_inquiry_target_garage.sql`
- `20261004180300_service_network_s4_work_order_assignment.sql`
- `20261004180400_service_network_s5_service_records.sql`
- `20261004180500_service_network_s8_service_links.sql`
- `20261004180600_service_network_o4_event_dedupe.sql`
- `20261004180700_service_network_o5_thread_type.sql`
- `20261004180800_service_network_case_status_template.sql`

Corporate / AUTH inherited unchanged:

- `20261014010000_ca_k3_auth_02_corporate_membership_foundation.sql`
- `20261014020000_ca_k3_auth_03_corporate_membership_governance.sql`
- `20261015010000_ca_k3_auth_04_corporate_permission_authority.sql`
- `20261016010000_ca_k3_auth_05_session_identity_authority.sql`
- `20261016163834_ca_k3_auth_05_r4_atomic_owner_registration.sql`

## 6. CV01 certification surface

The CV01 harness must prove:

- exact ancestry from `166025842bc2bae024c13162c2f3623617f88277`;
- the AUTH-05 / Corporate boundary files retain their parent blobs;
- legacy Garage context authority is not restored;
- Garage admin routes remain typed active-Garage routes;
- activation remains atomic and server-derived;
- invitation acceptance remains atomic and verified-email bound;
- last-admin protection remains serialized;
- branch/work-order integrity remains tenant constrained;
- current Garage journey tests remain green;
- no new Garage feature implementation is introduced in CV01.

## 7. Scope after CV01

Only after CV01 certification should the programme open:

**GARAGE-1.0-OPS01 — MULTI-SITE + STAFF OPERATIONS FOUNDATION**

Expected first new authoritative models include:

- complete branch CRUD and branch operating identity;
- opening hours;
- branch manager and staff-to-branch assignment;
- workforce profiles, departments, skills and certifications;
- the minimum operational RBAC needed by a real multi-site workshop.

Commercial, inventory and advanced workshop scheduling work remain later tranches and must be built on the converged CV01 authority.

## 8. Production boundary

Production Supabase project:

`vhmnajoeicasaigiophh`

is outside CV01 authority and must not be accessed or mutated.
