# V7 — Ownership History and Transfer Lifecycle Foundation Certification

**Date:** 2026-08-28
**Phase:** V7 — Ownership History and Transfer Lifecycle
**Status:** IMPLEMENTED / EXACT-HEAD CI PENDING

## Authority finding

Live repository reconciliation found historical ownership data and ownership-transfer evidence, but no canonical governed ownership-transfer service.

V7 therefore defines the missing **pure contract** without claiming persistence or legal transfer completion.

## Files added

- `backend/services/passport/passportTransferStateMachine.js`
- `backend/services/passport/passportOwnershipProjection.js`
- `backend/tests/passport-v7-ownership-transfer.test.js`

## Transfer lifecycle

The contract distinguishes:

- not started;
- initiated;
- awaiting parties;
- evidence required;
- under review;
- transaction complete;
- registry pending;
- complete;
- disputed;
- cancelled.

### Hard rules

- sold is not transfer complete;
- transaction complete is not registry ownership complete;
- transfer cannot jump from not-started directly to complete;
- complete requires a governed ownership/registry confirmation supplied upstream;
- disputes require an explicit reason;
- completion changes relationship-based owner access semantics.

## Ownership history privacy

Public, buyer, owner and seller projections do not expose prior/current owner IDs.

Governance projection may receive governed owner identifiers.

More than one current-owner relationship fails closed instead of choosing one.

Unknown historical coverage stays unknown.

## Persistence boundary

V7 does not:

- create an ownership table;
- write owner_id;
- mutate a listing;
- mark a vehicle sold;
- complete SafePay;
- establish registry ownership;
- change authentication.

These remain later governed integration work.

## Phase decision

**V7 FOUNDATION IMPLEMENTED. EXACT-HEAD CI REQUIRED BEFORE V8.**
