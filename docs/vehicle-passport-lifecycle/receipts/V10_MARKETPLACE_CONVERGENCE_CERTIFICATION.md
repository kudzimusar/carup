# V10 — Marketplace and Buyer Due-Diligence Convergence

**Date:** 2026-08-28
**Phase:** V10 — Marketplace and Buyer Due-Diligence Convergence
**Status:** FOUNDATION IMPLEMENTED / RUNTIME WIRING BLOCKED BY ACTIVE SELLER LANE

## Scope

V10 adds an executable parity gate between normalized Marketplace/Vehicle Detail output and normalized public Passport output.

It deliberately does not edit PR #182-owned Marketplace/Seller files.

## Files added

- `backend/services/passport/passportMarketplaceConvergence.js`
- `backend/tests/passport-v10-marketplace-convergence.test.js`

## Parity contract

The convergence gate compares:

- VIN;
- make/model/year/color;
- mileage, preserving zero vs unknown;
- price/currency;
- publication state;
- listing state;
- seller/listing claim value + state + source;
- canonical Trust score/band/evaluation/confidence/version/timestamp;
- public evidence identity.

A Passport-only or unpublished vehicle must not expose Marketplace transaction actions.

## What this prevents

- Marketplace mileage `0` vs Passport “unknown”;
- same Trust score with different calculation version;
- claim value matching while claim state/provenance differs;
- Marketplace and Passport exposing different evidence records;
- transaction actions appearing on a Passport that is not a public listing.

## Ownership boundary

This module is a **validator only**.

It does not call or reproduce:

- Marketplace listing assemblers;
- public vehicle projection;
- listing claim projection;
- Trust calculation;
- database reads/writes.

## Runtime integration blocker

Seller/Marketplace PR #182 is currently active and owns the shared public listing/detail surfaces. Seller programme status also records S5 and S11 as unfinished.

Therefore V10 cannot honestly be called end-to-end operational until a reconciled exact head wires the parity contract into the real shared surfaces and certifies staging.

## Phase decision

**V10 FOUNDATION IMPLEMENTED. RUNTIME CONVERGENCE REMAINS BLOCKED UNTIL SELLER S5/S11 RECONCILIATION.**
