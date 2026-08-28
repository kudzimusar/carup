# V2 — Identity, Claim and Access Foundation Certification

**Date:** 2026-08-28
**Phase:** V2 — Vehicle Identity, Claim and Access
**Status:** PASS — EXACT-HEAD FOUNDATION CERTIFIED

## Scope decision

V2 is intentionally limited to **pure identity/access policy and ownership-claim state contracts** while Seller Journey remains active.

No database table, migration, Passport route, Seller ownership write path, Marketplace surface, public projection or mobile vehicle surface is changed by this phase.

## Live reconciliation

At V2 implementation start:

- Seller/Marketplace PR #182: `abc11e9682a7140a9e3e60f995d9537ad4043b8a`
- Passport PR #188 pre-CI-extension head: `353830cd309e6bf91caff123cca479f2e8c9c9cf`
- changed-file overlap between #188 and #182: **0 files**

## Files added

- `backend/services/passport/passportAccessPolicy.js`
- `backend/services/passport/passportClaimStateMachine.js`
- `backend/tests/passport-v2-identity-access.test.js`

CI gate extended:

- `.github/workflows/vehicle-passport-foundation-ci.yml`

## Identity and lookup contract

V2 reuses the already-certified Issue #164 lookup authority:

`backend/utils/passportLookupPolicy.js`

It does **not** create a second VIN/plate/chassis classifier.

Required behavior remains:

- exact VIN lookup may be public;
- plate / temporary identifier / chassis lookup is restricted;
- anonymous restricted lookup is non-enumerable;
- malformed identifiers never become database queries;
- seller opt-in remains closed by default unless the canonical policy explicitly opens it.

## Audience/capability contract

`resolvePassportAudienceFromCapabilities()` consumes established authorization facts rather than inferring access from a user-supplied role name.

Supported capability inputs include:

- governance access;
- owner relationship;
- seller relationship;
- transaction access;
- service access;
- institutional access.

A caller cannot self-request a privileged Passport audience merely by naming it.

The policy owns no:

- request-header parsing;
- session validation;
- database reads;
- tenant resolution;
- ownership lookup.

Those remain upstream authorization responsibilities.

## Ownership-claim state contract

V2 introduces a pure workflow state machine:

- `not_claimed`
- `pending`
- `evidence_required`
- `under_review`
- `verified`
- `rejected`
- `disputed`
- `revoked`

Important boundary:

> A verified CarUp Passport claim is not automatically an external registry ownership fact.

Rules include:

- no direct `not_claimed → verified` jump;
- every transition requires an authenticated actor identity supplied by the caller;
- verified/rejected/revoked decisions require review authority;
- disputes require a reason;
- illegal transitions fail closed;
- transition output is an event-shaped record for future governed persistence, not persistence itself.

## Tests

`backend/tests/passport-v2-identity-access.test.js` proves:

1. exact VIN delegates to canonical public lookup policy;
2. anonymous plate lookup remains restricted;
3. authenticated restricted lookup can resolve;
4. malformed identifier cannot become a query;
5. audience is resolved from established capabilities;
6. caller cannot self-elevate to owner audience;
7. claim cannot jump directly to verified;
8. review decisions require review authority;
9. dispute requires an explicit reason;
10. V2 access policy imports the canonical lookup policy and owns no auth/session/database implementation.

## CI contract

The dedicated Passport workflow now blocks on:

- V1 Passport foundation contract;
- V2 identity/access contract;
- canonical Issue #164 Passport lookup policy;
- canonical Trust decision authority;
- syntax for all Passport foundation modules;
- diff hygiene.

## Seller-dependent work still blocked

V2 does not yet implement:

- persistent Passport claims;
- owner relationship database schema;
- Seller → ownership-claim handoff;
- transfer mutation;
- route integration;
- UI claim flow;
- organization/dealer claim persistence.

Those require exact-head Seller reconciliation and later phase authorization.

## Exact-head certification

Certified code head:

- exact code head: `b27d860462996d1cf8f12193b5cdca9e894fff91`
- Vehicle Passport Foundation CI run: `33161997283`
- V1 Passport foundation contract — PASS
- V2 identity/access contract — PASS
- canonical Issue #164 Passport lookup policy — PASS
- canonical Trust decision authority — PASS
- Passport syntax checks — PASS
- diff hygiene — PASS
- changed-file overlap with Seller PR #182 — **0 files**

The preceding V2 run failed only because the anti-fork test matched the word “authorization” in a source comment. The guard was corrected to detect concrete header/session/auth implementation. No product behavior or authority boundary was weakened.

## Phase decision

**V2 FOUNDATION PASS.**

Persistent vehicle-claim storage and Seller/ownership write integration remain blocked. V3 may proceed only as isolated Passport evidence/provenance projection work.
