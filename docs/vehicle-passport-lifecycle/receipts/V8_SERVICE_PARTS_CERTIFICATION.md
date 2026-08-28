# V8 — Service, Maintenance, Garages and PartSentry Foundation Certification

**Date:** 2026-08-28
**Phase:** V8 — Service, Maintenance, Garages and PartSentry
**Status:** IMPLEMENTED / EXACT-HEAD CI PENDING

## Scope

V8 projects existing work-order, owner-service and PartSentry records into Passport.

It creates no second service ledger and no second PartSentry authority.

## Files added

- `backend/services/passport/passportServicePartsProjection.js`
- `backend/tests/passport-v8-service-parts.test.js`

## Work-order privacy

The Passport work-order projection is whitelist-based.

It excludes:

- customer identity;
- customer IDs;
- tenant IDs;
- issue description;
- free-text description.

Public/buyer projections also withhold service cost.

The dedicated CI reruns the permanent Issue #164 service-timeline privacy guard.

## PartSentry

Public PartSentry projection requires:

- `public_card_eligible = true`; and
- a known-safe suspicion state (`none`, `cleared` or empty).

Unknown/future suspicion states fail closed.

Owner/governance projections may show non-public records with their status explicitly labelled.

CI also reruns the canonical PartSentry review/governance workflow.

## Owner/DIY service

Owner-supplied service is explicitly labelled `owner_declared`.

It is not projected publicly by this foundation.

## Trust boundary

Service and PartSentry records do not stamp Trust.

The projection contains no Trust-score calculation, no canonical Trust refresh and no database write.

## Sparse history

Incomplete service-history coverage remains partial/unknown with explicit limitations.

## Phase decision

**V8 FOUNDATION IMPLEMENTED. EXACT-HEAD CI REQUIRED BEFORE V9.**
