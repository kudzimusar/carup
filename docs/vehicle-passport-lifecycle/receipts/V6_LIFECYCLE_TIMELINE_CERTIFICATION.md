# V6 — Unified Vehicle Lifecycle Timeline Foundation Certification

**Date:** 2026-08-28
**Phase:** V6 — Unified Vehicle Lifecycle Timeline
**Status:** IMPLEMENTED / EXACT-HEAD CI PENDING

## Scope

V6 establishes the Passport lifecycle read model. It does not create a second event ledger.

## Files added

- `backend/services/passport/passportLifecycleTimeline.js`
- `backend/tests/passport-v6-lifecycle-timeline.test.js`

CI extended:

- `.github/workflows/vehicle-passport-foundation-ci.yml`

## Lifecycle categories

The read model supports the canonical V6 categories:

- manufacture/import;
- registration/licensing;
- ownership;
- inspection;
- mileage;
- evidence;
- verification;
- damage/incident;
- insurance;
- service;
- parts;
- listing;
- reservation/transaction;
- sale/transfer.

## Source identity

Every event still requires the V1 provenance identity:

- `source_type`;
- `source_ref`.

Duplicate projections of the same `kind + source_type + source_ref` collapse to the latest projection.

This de-duplicates representation without creating a new authoritative event identity.

## Correction and supersession

A correction may explicitly reference source identities it supersedes.

Default product projection hides superseded records while governance/audit callers may request them.

Supersession changes presentation state; it does not delete history.

## Privacy

Lifecycle events continue to obey the Passport audience/visibility contract.

Public/buyer projections receive only public-safe summary/details.

Owner-only transfer events are withheld from public callers.

Private correction reasons are not exposed publicly.

## Incomplete-history semantics

Lifecycle coverage is explicit.

An empty timeline can remain:

- unknown;
- partial;
- unavailable;

with governed coverage limitations.

An empty timeline is never automatically presented as clean history.

## Tests

V6 proves:

1. canonical lifecycle category vocabulary;
2. correction/supersession without deletion;
3. owner-only event privacy;
4. category filters;
5. incomplete-history semantics;
6. duplicate source-record de-duplication;
7. correction-reason privacy;
8. no database/event-ledger ownership.

## Phase decision

**V6 FOUNDATION IMPLEMENTED. EXACT-HEAD CI REQUIRED BEFORE V7.**
