# V4 — Verification, Review and Discrepancy Foundation Certification

**Date:** 2026-08-28
**Phase:** V4 — Verification, Review and Discrepancy Reconciliation
**Status:** IMPLEMENTED / EXACT-HEAD CI PENDING

## Scope

V4 defines how existing source-verification and governed discrepancy records are projected into Vehicle Passport.

It does not create:

- a new government/source adapter;
- a new review queue;
- a new discrepancy engine;
- a new evidence approval path;
- a Trust calculation;
- database writes.

## Files added

- `backend/services/passport/passportVerificationProjection.js`
- `backend/tests/passport-v4-verification-discrepancy.test.js`

CI extended to run the V4 contract plus existing canonical source-verification and governance tests.

## Canonical dependencies reused

- `backend/services/sourceVerification/verificationContract.js`
- `backend/services/governance/governanceService.js`
- existing source mode vocabulary:
  - live
  - partner_file
  - manual_verification
  - sandbox
  - unavailable
- existing verification results:
  - match
  - mismatch
  - no_record
  - unavailable
  - manual_review
  - high_risk
- existing governed dispute/public-state helper.

## Source-state rules

Passport preserves source reality.

Examples:

- `no_record` remains **no_record** and is never renamed to clear/verified;
- `unavailable` remains **unavailable**;
- `sandbox + match` remains visibly sandbox;
- mismatch/high-risk project as adverse source state;
- manual-review remains pending-review;
- source confidence is labeled as source confidence and explicitly not canonical Trust.

Public projections do not include raw payloads, query values, identity fields, requester IDs, tenant IDs or provider credentials.

## Discrepancy rules

Public/buyer:

- unresolved, pending, disputed or inconclusive discrepancy records do not present as confirmed findings;
- only canonically confirmed-public discrepancy state may surface;
- public output excludes internal explanation and evidence IDs.

Owner/seller:

- unresolved discrepancy may be shown as action-required;
- governed evidence references may be supplied;
- internal reviewer explanation remains withheld.

Governance:

- may receive internal explanation through the Passport projection;
- still does not receive raw provider payloads through this module.

## Trust boundary

V4 does not alter canonical Trust.

Verification/source confidence, discrepancy severity and canonical Trust remain distinct concepts.

## Tests

V4 proves:

1. no-record never becomes clearance;
2. unavailable remains unavailable;
3. sandbox match remains visibly sandbox;
4. source confidence is not Trust;
5. unresolved discrepancy is withheld publicly;
6. owner sees unresolved discrepancy as action-required;
7. confirmed public discrepancy uses only public summary;
8. disputed records do not present confirmed-public;
9. unavailable collection state remains unavailable;
10. Passport reuses canonical source-verification/governance contracts and owns no writes/Trust engine.

## Seller dependency

Seller-side contradiction resolution UI, Seller evidence mutations and cross-surface wiring remain blocked until Seller exact-head integration.

## Phase decision

**V4 FOUNDATION IMPLEMENTED. EXACT-HEAD CI REQUIRED BEFORE V5.**
