# Vehicle Passport foundation services

This directory is the isolated V1 foundation for **Vehicle Passport / Trust Lifecycle 1.0**.

## Ownership boundary

These modules are presentation/orchestration contracts. They intentionally do not:

- query Supabase;
- mutate vehicles, evidence, ownership or listing state;
- calculate Trust;
- import the legacy Trust Graph scoring engine;
- emit Communications messages directly;
- write Intelligence events;
- modify Seller/Marketplace shared projections.

Integration work must supply already-governed inputs from the existing canonical authorities.

## Current modules

- `passportContract.js` — audience, visibility, missing-state and public-safety contract.
- `passportTimelineService.js` — provenance-preserving, role-scoped lifecycle normalization/deduplication.
- `passportReadModelService.js` — pure role-aware Passport composition.

This foundation can be built concurrently with Seller because it creates new files only. Seller-dependent wiring remains blocked until the Seller exact-head reconciliation required by V0/V2.
