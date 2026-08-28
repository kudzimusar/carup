# Seller Journey 1.0

This directory is the canonical repository manual for CarUp Seller Journey 1.0.

## Start here

1. [Seller Journey 1.0 Canonical Plan](./SELLER_JOURNEY_1_0_CANONICAL_PLAN.md)
2. [CarUp Global Vehicle Taxonomy Contract](../platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md)
3. [Global Taxonomy Schema & Vocabulary](../platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_SCHEMA.md)
4. [Global Taxonomy Migration & Rollout](../platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_MIGRATION_PLAN.md)
5. [S0 — Vehicle Taxonomy & Seller Contract Foundation](./S0_VEHICLE_TAXONOMY_AND_SELLER_CONTRACT_FOUNDATION.md)

## Operating rule

Before any Seller runtime change, reconcile:

- live `main`;
- active PR heads;
- changed-file ownership;
- merge/conflict state;
- Communications ownership;
- Intelligence ownership.

Do not open a third runtime source-write lane merely because this documentation exists.

## Current phase

**S0 — Global Vehicle Taxonomy & Seller Contract Foundation: CERTIFIED — PASS (2026-08-28)**

S0 runtime work was implemented inside PR #182 (the lane that owns the Seller/taxonomy/Marketplace surfaces) and certified at exact head `4d7b94fc8bd7c8e0b22658239cb8376a01a39e7e` with staging proof at immutable candidate `7b2506870df48a87d92f0c2fc6ca1a38e3040f6e`. See `receipts/S0_TAXONOMY_AND_CONTRACT_CERTIFICATION.md`.

**S1 — Seller Entry & Vehicle Identification: CERTIFIED — PASS**
**S2 — Canonical Commercial Listing Data: CERTIFIED — PASS**
**S3 — Seller Identity, Dealer Context & Privacy: PARTIAL PASS** (consent controls delivered; province-only visibility + dealer branch deferred to an explicit migration slice)

All Seller runtime work continues inside PR #182, which owns the Seller/Marketplace surfaces. Receipts for every phase live in `receipts/`.

**Next: the deferred S3 migration slice, then S4 — Listing Media Studio.**

## Future receipts

Implementation and certification receipts belong under:

`docs/seller/receipts/`

The phase numbering is permanently:

`S0 → S1 → S2 → ... → S12`

Do not rename S0 to A0 or restart the programme from first principles.

## Global taxonomy rule

Seller Journey initiates S0, but CarUp Platform owns the finished taxonomy. Future agents must consume or extend `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md`; they must not create feature-local make/model/year/fuel/transmission/body-style taxonomies once the global contract covers them.
