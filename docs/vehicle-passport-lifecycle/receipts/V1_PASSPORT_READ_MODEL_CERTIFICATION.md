# V1 — Passport Read Model Foundation Certification

**Date:** 2026-08-28
**Phase:** V1 — Passport Information Architecture and Canonical Read Model
**Status:** IMPLEMENTED / CI PENDING AT INITIAL RECEIPT

## Goal

Create a reusable Passport composition layer without creating a new vehicle, evidence, Trust, ownership, Communications or Intelligence authority.

## Files added

- `backend/services/passport/passportContract.js`
- `backend/services/passport/passportTimelineService.js`
- `backend/services/passport/passportReadModelService.js`
- `backend/services/passport/README.md`
- `backend/tests/passport-foundation-contract.test.js`

No Seller-owned shared runtime file was edited.

## Contract implemented

### Audience model

The foundation defines:

- public;
- buyer;
- owner;
- seller;
- garage;
- partner;
- governance.

Visibility is explicit:

- public;
- transaction;
- owner;
- service_partner;
- institutional;
- internal.

### Missing-state model

The Passport foundation preserves:

- known;
- partial;
- unknown;
- unavailable;
- not_evaluated;
- withheld;
- not_applicable;
- conflicting;
- pending;
- expired;
- rejected.

`governedValue()` preserves the distinction between missing and genuine zero/false values.

### Public safety

Public and buyer Passport projections are recursively fail-closed against private keys including owner/tenant IDs, engine/chassis/temp identifiers, direct contact data, reviewer/internal metadata, provider credentials and storage paths.

This is a second defensive boundary, not a replacement for canonical server-side public projection.

### Canonical Trust

The read model accepts Trust only as an input projection and passes it through unchanged.

It contains no Trust score/band algorithm and no legacy Trust Graph import.

### Lifecycle timeline

Every timeline event requires:

- `kind`;
- `occurred_at`;
- `source_type`;
- `source_ref`.

The presentation timeline:

- filters by audience visibility;
- uses public summary/details for public/buyer;
- preserves richer detail only for authorized audiences;
- de-duplicates multiple projections of the same authoritative source record by `kind + source_type + source_ref`;
- sorts newest-first;
- carries evidence IDs and mileage only as supplied facts.

The timeline is therefore a read model, not a new event ledger.

### Database boundary

The new Passport foundation has no Supabase/database read/write code.

Integration callers must supply governed inputs from canonical domain services.

## Tests authored

`passport-foundation-contract.test.js` covers:

1. public projection uses only public data;
2. owner projection does not widen public output;
3. public private-key leakage fails closed;
4. buyer private-key leakage fails closed;
5. canonical Trust is passed through unchanged;
6. unknown stays unknown while real zero/false remain real values;
7. authoritative-source timeline de-duplication;
8. provenance-less timeline event rejection;
9. governance-only event visibility;
10. static anti-fork guard against Trust calculation/database ownership.

## Seller dependency

V1 is intentionally not wired into the existing Passport route yet.

That wiring would touch `backend/server.js` and Seller-owned projection/lifecycle surfaces. It remains blocked until the Seller exact-head reconciliation gate.

## Phase decision

**V1 FOUNDATION IMPLEMENTED.**

Advance only to isolated V2 analysis/scaffolding that does not mutate Seller-owned identity/claim write paths. Route integration remains blocked.
