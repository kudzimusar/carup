# CarUp Vehicle Passport / Trust Lifecycle 1.0

**Status:** canonical planning package candidate  
**Programme:** Post-Reunification Product Advancement — Vehicle Passport / Trust Lifecycle 1.0  
**Repository:** kudzimusar/carup  
**Document branch:** docs/vehicle-passport-trust-lifecycle-1-0-plan  
**Runtime authorization:** NONE while the Seller Journey 1.0 implementation is active or until the lane/governance rules permit this programme to become an implementation lane.

## Purpose

This directory defines how CarUp turns the already-built Canonical Vehicle Truth and Canonical Trust foundations into one persistent, owner-facing and ecosystem-facing Vehicle Passport lifecycle.

The governing product chain is:

**Sell → Vehicle Passport → Verify → Marketplace → Home → Communications → Intelligence → ownership lifecycle**

The advertisement is temporary. The vehicle record persists.

Vehicle Passport / Trust Lifecycle 1.0 is a **convergence and productization programme**, not a new Trust architecture. It must reuse the existing canonical vehicle identity, evidence/provenance, public projection, Trust decision authority, Communications architecture, Marketplace contracts, Seller contracts and Intelligence contracts.

## Required reading order for every future agent

1. [CARUP_VEHICLE_PASSPORT_TRUST_LIFECYCLE_1_0_CANONICAL_PLAN.md](./CARUP_VEHICLE_PASSPORT_TRUST_LIFECYCLE_1_0_CANONICAL_PLAN.md)
2. [DEPENDENCY_AND_AUTHORITY_MAP.md](./DEPENDENCY_AND_AUTHORITY_MAP.md)
3. [MARKET_BENCHMARK_AND_DIFFERENTIATION_MATRIX.md](./MARKET_BENCHMARK_AND_DIFFERENTIATION_MATRIX.md)
4. [VEHICLE_PASSPORT_TRUST_LIFECYCLE_AGENT_START_PROMPT.md](./VEHICLE_PASSPORT_TRUST_LIFECYCLE_AGENT_START_PROMPT.md)
5. Latest phase receipt under [receipts/](./receipts/)
6. Live Seller Journey 1.0 canonical plan and its latest certification receipt
7. Canonical Vehicle Truth / Trust contracts under docs/canonical-vehicle-truth/
8. Communications 2.0 canonical plan
9. CarUp Intelligence canonical plan
10. Post-Reunification Product Advancement plan

## Non-negotiable architectural sentence

> **Truth records what is known and its provenance. Trust evaluates what CarUp can responsibly conclude. The Vehicle Passport presents and orchestrates that truth and trust through the vehicle lifecycle. The Passport is not a competing authority.**

## Activation dependency

This programme is documented now so it is not reconstructed from conversational memory later.

Before any runtime phase begins, the implementation agent MUST:

- finish or reconcile Seller Journey 1.0 against its accepted exact head;
- resolve live main;
- enumerate open source-write PRs and lane ownership;
- re-audit the final Seller → Passport seams;
- re-audit Canonical Truth / Trust exact contracts;
- record a fresh V0 receipt;
- obtain an allowed implementation lane.

No future agent may treat the source SHAs in these planning documents as permission to build from a stale branch.

## Receipts

Each implementation phase must create an evidence receipt under docs/vehicle-passport-lifecycle/receipts/.

See the canonical plan for the required phase names, gates and receipt schema.
