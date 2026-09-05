# Vehicle Passport / Trust Lifecycle 1.0 — Agent Start Prompt

Use this prompt when assigning an implementation agent to begin or resume the programme.

---

You are taking ownership of **CarUp Vehicle Passport / Trust Lifecycle 1.0** in:

**Repository:** kudzimusar/carup

This is a continuation of the post-reunification CarUp product programme.

Do **not** restart the project from first principles.

Do **not** redesign Canonical Vehicle Truth or Canonical Trust.

Do **not** create a second Vehicle Passport architecture.

Do **not** begin runtime implementation until you have reconciled the current repository and confirmed that the programme has an allowed source-write lane.

## Governing documents

Read these files IN FULL before changing code:

1. docs/vehicle-passport-lifecycle/CARUP_VEHICLE_PASSPORT_TRUST_LIFECYCLE_1_0_CANONICAL_PLAN.md
2. docs/vehicle-passport-lifecycle/DEPENDENCY_AND_AUTHORITY_MAP.md
3. docs/vehicle-passport-lifecycle/MARKET_BENCHMARK_AND_DIFFERENTIATION_MATRIX.md
4. docs/vehicle-passport-lifecycle/README.md
5. latest file in docs/vehicle-passport-lifecycle/receipts/
6. the current Seller Journey 1.0 canonical plan and latest Seller phase receipt
7. docs/canonical-vehicle-truth/ADR-001-trust-authority.md
8. docs/canonical-vehicle-truth/FACT_MODEL.md
9. docs/canonical-vehicle-truth/MEDIA_EVIDENCE_CONTRACT.md
10. docs/canonical-vehicle-truth/ADR-003-passport-lookup-policy.md
11. docs/canonical-vehicle-truth/ISSUE164_PHASE8_SURFACE_CONVERGENCE.md
12. docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md
13. the current CarUp Intelligence canonical plan
14. the current Post-Reunification Product Advancement execution plan

Treat live repository evidence as authoritative if any planning-time SHA has moved.

## Core architecture contract

The governing relationship is:

**Evidence / observations → Canonical Truth → Canonical Trust → Vehicle Passport → role-scoped journeys/actions**

Interpret that strictly:

- Truth records what is known and its provenance.
- Trust evaluates what CarUp can responsibly conclude.
- Vehicle Passport presents and orchestrates that Truth/Trust through the vehicle lifecycle.
- Passport is NOT a competing authority.
- Communications owns canonical conversations/notifications.
- Intelligence observes authoritative domain state and recommends; it does not replace business truth.
- Marketplace consumes the public vehicle/Trust projection.
- Seller contributes seller-stated data, listing data, media and evidence through governed contracts.
- Ownership transfer preserves the same canonical vehicle.
- Garage/Mechanic/PartSentry contribute governed service/parts observations; they do not directly set vehicle Trust.
- External providers/authorities remain source-specific and must never be represented as connected/verified unless runtime evidence proves that exact source state.

## Upstream dependency: Seller Journey 1.0

The intended platform chain is:

**Sell → Vehicle Passport → Verify → Marketplace → Home → Communications → Intelligence → Transaction → Ownership lifecycle**

Before starting Passport runtime work:

1. resolve live main SHA;
2. enumerate open PRs and exact heads;
3. identify the accepted/current Seller Journey head;
4. determine whether Seller S0–S12 is complete;
5. inspect Seller → Passport seams;
6. confirm media vs evidence separation;
7. confirm seller-stated vs governed truth;
8. confirm publication readiness / listing quality / canonical Trust remain separate;
9. confirm sold → ownership transfer semantics;
10. identify any remaining Seller blockers.

If Seller is not complete and Passport has no authorized implementation lane, stop runtime mutation and report the dependency rather than creating a competing lane.

Documentation/audit work is allowed only if it does not mutate runtime source.

## Mandatory live reconciliation before Phase V0/V1

Reconcile:

- canonical main;
- open implementation PRs;
- branch/lane ownership;
- current Passport web and mobile routes/components;
- canonical vehicle identity schema;
- evidence/provenance schema;
- ownership-history schema;
- Trust decision service and public projection;
- Verify lookup policy;
- Marketplace listing/detail projection;
- Seller contracts;
- service/mechanic/garage records;
- PartSentry;
- Communications events/conversations;
- Intelligence events/read models;
- external source/provider reality;
- RLS/grants/security;
- migrations and staging state.

Create or update:

**docs/vehicle-passport-lifecycle/receipts/V0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md**

Do not rely on remembered SHAs.

## Permanent invariants

You must preserve:

1. one physical vehicle → one canonical vehicle;
2. seller/owner statement ≠ verified fact;
3. unknown ≠ false/zero/clear;
4. no evidence ≠ positive Trust;
5. Trust score, confidence, completeness and risk remain distinct;
6. Trust authority remains backend/services/trustDecision/trustDecisionService.js or its explicitly certified successor;
7. public/private projections are enforced server-side;
8. listing media ≠ evidence;
9. evidence/provenance history is not silently destroyed;
10. ownership history is append/history-preserving;
11. Communications is canonical and providers are transports;
12. Intelligence never becomes authoritative business truth;
13. external source claims are exact and source-specific;
14. AI cannot certify evidence, ownership, government status or Trust;
15. exact-head evidence is required for phase certification.

## Programme phases

Proceed according to the canonical plan:

- V0 — Live Reconciliation, Authority Freeze and Gap Inventory
- V1 — Passport Information Architecture and Canonical Read Model
- V2 — Vehicle Identity, Claim and Access
- V3 — Evidence Vault and Provenance Experience
- V4 — Verification, Review and Discrepancy Reconciliation
- V5 — Trust Explanation Layer
- V6 — Unified Vehicle Lifecycle Timeline
- V7 — Ownership History and Transfer Lifecycle
- V8 — Service, Maintenance, Garages and PartSentry
- V9 — Owner Cockpit and Next Actions
- V10 — Marketplace and Buyer Due-Diligence Convergence
- V11 — Seller, Verify and Home Convergence
- V12 — Communications Lifecycle Orchestration
- V13 — Passport Intelligence and Gutu AI
- V14 — External Source / Institutional Adapter Framework
- V15 — Mobile, Low-Bandwidth and Accessibility Parity
- V16 — Golden Vehicle Lifecycle Certification

Do not jump to the next phase because code “looks done”. Deposit a phase receipt with exact-head evidence.

## Product target

Do not reduce the task to a static vehicle-history report.

The Passport should become a **living vehicle operating record** capable of answering:

- What vehicle is this?
- What does CarUp know?
- Where did that information come from?
- What is verified, stated, unknown, unavailable, pending or conflicting?
- What can CarUp responsibly conclude?
- What happened over the vehicle's life?
- What needs attention now?
- What is the user allowed to do next?
- What may another role see?
- What persists when the vehicle is sold?

The vehicle should survive:

**Seller → Marketplace → Buyer → sale → ownership transfer → new owner → service/PartSentry → future relisting**

as the same canonical Passport.

## Market benchmark direction

Use the benchmark document to meet or exceed the useful patterns from:

- CARFAX / Car Care;
- carVertical;
- Experian AutoCheck;
- VINwiki;
- UK MOT / official inspection history;
- Digital Product Passport architecture;
- Zimbabwe licensing/registration/VID/ZIMRA/CID-type due-diligence requirements.

Do not copy competitor visuals or make unsupported source claims.

CarUp's differentiation is the combination of:

**Truth + Trust + persistent Passport + Marketplace + Seller + Communications + Intelligence + Service/PartSentry + ownership continuity**

## Required execution discipline

For every phase:

1. state the exact source/base SHA;
2. state the exact candidate head;
3. state active PR/lane ownership;
4. list changed files;
5. identify schema/migrations;
6. identify every authority contract touched;
7. add tests before claiming closure;
8. certify on exact head;
9. use real staging evidence where required;
10. test public/private projections;
11. test sparse/unknown data, not only evidence-rich fixtures;
12. deposit a receipt;
13. report PASS/BLOCKED and the next authorized phase.

Production changes require explicit owner authorization.

## Golden Vehicle end state

The final Golden Vehicle must prove:

- correct identity;
- Seller contribution;
- evidence;
- discrepancy;
- governed verification;
- canonical Trust;
- Marketplace discovery;
- public Passport;
- buyer inquiry;
- canonical Communications;
- sale;
- ownership transfer;
- same Passport for new owner;
- service history;
- mileage;
- PartSentry where applicable;
- Intelligence;
- future relisting;
- privacy of previous owner.

Do not declare the programme complete until that lifecycle is proven on one exact candidate head.

## First response expected from the agent

Before writing runtime code, report:

1. current main SHA;
2. current Seller Journey status and exact head;
3. current open source-write lanes;
4. current Passport/Truth/Trust implementation state;
5. current phase you believe is authorized;
6. dependency blockers;
7. precise files/schemas you expect to touch;
8. whether runtime implementation can safely begin.

Then proceed only within the authorized phase and repository governance.
