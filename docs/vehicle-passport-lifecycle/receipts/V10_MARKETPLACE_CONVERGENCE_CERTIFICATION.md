# V10 — Marketplace and Buyer Due-Diligence Convergence

**Date:** 2026-08-28
**Phase:** V10 — Marketplace and Buyer Due-Diligence Convergence
**Status:** FOUNDATION PASS / RUNTIME WIRING BLOCKED BY ACTIVE SELLER LANE

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

## Exact-head certification

Certified code head:

- exact code head: `5f36b78aff40a732115ed7e109db6d5704db4f4a`
- Vehicle Passport Foundation CI run: `33165243296` — **PASS**
- Passport V1–V10 cumulative contracts — PASS
- canonical service/PartSentry/Trust/source/governance/evidence/lookup guards — PASS
- syntax/diff hygiene — PASS

The immediately preceding run at `6022fa88714fc38c4926681653312dbaef5c0d94` failed two V10 tests because the fixture reused the same mutable `claims` and `canonicalTrust` objects on both sides of the comparison. The fixture was isolated with independent clones. The convergence implementation was not weakened or changed.

## Phase decision

**V10 FOUNDATION PASS. RUNTIME CONVERGENCE REMAINS BLOCKED UNTIL SELLER S5/S11 RECONCILIATION.**
