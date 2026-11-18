# CarUp Platform Contracts

This directory contains platform-wide contracts that must be reused across CarUp product surfaces.

## Global Vehicle Taxonomy

1. [Global Vehicle Taxonomy Contract](./CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md)
2. [Global Vehicle Taxonomy Schema & Vocabulary](./CARUP_GLOBAL_VEHICLE_TAXONOMY_SCHEMA.md)
3. [Global Vehicle Taxonomy Migration & Rollout Plan](./CARUP_GLOBAL_VEHICLE_TAXONOMY_MIGRATION_PLAN.md)

### Current status

The taxonomy work is being initiated through **Seller Journey 1.0 / S0**, but the finished taxonomy is owned by the **CarUp platform**, not by Seller.

Permanent rule:

> Define once. Normalize once. Version once. Reuse globally.

Consumers include Sell, Buy/Marketplace, Home, Verify/Passport, Intelligence, Imports/Diaspora, mobile, dealer/admin tools, backend services, public/partner APIs and future regional CarUp products.

Future agents must extend or consume these contracts. They must not create a competing feature-local vehicle taxonomy once a dimension is globally covered.
