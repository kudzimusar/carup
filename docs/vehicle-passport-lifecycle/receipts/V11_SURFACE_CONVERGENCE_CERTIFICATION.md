# V11 — Seller, Verify and Home Convergence

**Date:** 2026-08-28
**Phase:** V11 — Seller, Verify and Home Convergence
**Status:** FOUNDATION IMPLEMENTED / RUNTIME CONVERGENCE BLOCKED BY SELLER S5/S11

## Scope

V11 adds a Passport-owned cross-surface canonical parity validator for:

- Seller;
- Passport;
- Verify;
- Marketplace;
- Home.

It does not edit the active Seller/Marketplace lane.

## Canonical comparison

Passport is the normalized anchor supplied to the validator.

Sibling surfaces may omit fields they do not render, but any field they explicitly present as canonical must agree on:

- VIN;
- make/model/year/color;
- mileage;
- fuel/transmission/drivetrain;
- publication/listing state;
- canonical Trust score/band/evaluation/confidence/version/timestamp.

A genuine zero remains distinct from unknown/null.

## Seller statement boundary

Seller-stated facts are allowed to differ from canonical truth while unresolved.

They must be carried separately with:

`authority: seller_statement`

A seller statement cannot be placed into the canonical block to erase a discrepancy.

## Trust boundary

A surface cannot present a different Trust evaluation state/version merely because the score is numerically equal.

## Runtime blocker

Seller programme #186 currently records:

- S5 Embedded Verify & Evidence Reconciliation — NOT STARTED;
- S11 Cross-Surface Convergence — NOT STARTED.

Therefore this validator can be certified as a foundation, but Seller → Passport → Verify → Marketplace → Home runtime convergence cannot be claimed until those exact-head Seller phases are reconciled and staging-proven.

## Phase decision

**V11 FOUNDATION IMPLEMENTED. RUNTIME CONVERGENCE REMAINS BLOCKED.**
