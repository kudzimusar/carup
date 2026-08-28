# V0 — Live Reconciliation, Authority Freeze and Gap Inventory

**Date:** 2026-08-28
**Programme:** Vehicle Passport / Trust Lifecycle 1.0
**Decision:** PASS FOR BOUNDED V1 FOUNDATION / SELLER-DEPENDENT INTEGRATION BLOCKED

## Exact live anchors at V0

- canonical main: `ba208963d863654157335189c60f587cbe330041`
- Seller/Marketplace runtime PR #182: `abc11e9682a7140a9e3e60f995d9537ad4043b8a` — Draft
- Communications/Email PR #183: `507530aadff17ec8aa4830d3cb392efda6876031` — Draft
- Intelligence runtime PR #185: `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` — Draft
- Seller Journey docs PR #186: `e251ab2f2caa4aa944277ccc67e0f665d77ce739` — Draft
- Passport canonical-plan PR #187: `2cf540fd87c1abf1e6dca165a764f4a8b534d1cb` at foundation authorization update

Owner operating instruction for this execution: Seller is the active implementation journey; Passport Foundation becomes the second bounded lane. Open Draft PRs outside this execution are not permission for this programme to modify their owned surfaces.

## Canonical authorities frozen

### Vehicle Truth / public projection
Preserve:
- `backend/utils/publicVehicleProjection.js`
- canonical field-state / listing-claims semantics
- server-side public/private projection
- unknown/missing semantics
- Passport lookup non-enumeration policy

### Trust
Preserve:
- `backend/services/trustDecision/trustDecisionService.js`
- one canonical, deterministic, versioned Trust decision
- confidence distinct from score
- absence never positive
- no Passport-side Trust calculation

### Evidence/media
Preserve:
- canonical evidence subsystem
- media/evidence separation
- public-safe evidence projection
- provenance and review state

### Communications
Preserve Communications 2.0 as the canonical notification/conversation authority.

### Intelligence
Preserve authoritative-domain-event → analytics observation separation.

## Current Passport baseline on main

The existing Passport is currently assembled inside `backend/server.js` through `buildVehiclePassport(...)`.

The live implementation already contains significant certified protections:

- authenticated/anonymous audience separation;
- evidence-vault public redaction;
- public/private timeline sanitization;
- canonical Trust injection;
- canonical listing-claim injection;
- media/evidence separation;
- chain payload redaction;
- identifier redaction;
- plate-history redaction;
- VIN Passport and protected multi-identifier lookup.

This is an asset to converge, not code to discard.

## Seller overlap / files frozen from this Passport lane

PR #182 currently owns Passport-adjacent shared files including:

- `backend/routes/vehiclesRoutes.js`
- `backend/services/report/canonicalVehicleLifecycleService.js`
- `backend/services/report/reportService.js`
- `backend/utils/publicVehicleProjection.js`
- `backend/utils/vehicleMediaProjection.js`
- `web/src/components/VehicleHistoryReport.tsx`
- `web/src/pages/VehicleDetail.tsx`
- `mobile/app/vehicle/[vin].tsx`
- Seller and Marketplace pages/components.

Notably, `canonicalVehicleLifecycleService.js` does not exist on current main and is introduced by #182. This Passport foundation must not independently recreate or edit that Seller-owned lifecycle path.

## Foundation gap selected for safe implementation

The existing Passport assembly is feature-rich but remains embedded in a large route/server composition path.

The safe V1 gap is therefore:

> Define a pure, role-aware Passport read-model and timeline/provenance contract in a new isolated namespace, with no database ownership and no Trust calculation.

This gives later integration one canonical target shape without editing Seller-owned source.

## V0 write boundary

Authorized now:

- new files under `backend/services/passport/`;
- new Passport-specific tests;
- Passport docs/receipts.

Blocked until Seller exact-head reconciliation:

- changes to existing Passport routes in `backend/server.js`;
- `publicVehicleProjection.js`;
- Seller/Marketplace report/lifecycle services;
- media projection;
- Vehicle Detail;
- Seller UI;
- mobile vehicle page;
- ownership-transfer write paths.

## V0 result

**PASS** for isolated V1 foundation.

No existing runtime source file was modified by V0/V1 foundation work.
