# ADR-003 — Passport lookup: public by VIN, authenticated by plate

**Status:** DECIDED by the product owner, 2026-08-17. This was the one genuine policy question
raised by Phase 0 (Issue #164); it is recorded here because it constrains later phases.

## The problem

`GET /api/vehicles/passport/lookup/:identifier` resolved a plate, temporary identifier or chassis
number to a VIN for anonymous callers. Phase 0 stopped the passport *body* from returning those
identifiers, but the route itself remained an **enumeration oracle**: anyone could test whether a
given plate existed in CarUp, at scale, without an account. Marketplace search had been closed to
exactly this, one file away.

## Decision

1. **Exact VIN lookup stays public and anonymous.** It is how a buyer standing in front of a car
   checks it, and it can only confirm an identifier the caller already holds.
2. **Plate, temporary identifier and chassis lookup require verified CarUp authentication.**
3. **An unauthenticated restricted lookup must not reveal whether the identifier exists** — every
   such request receives the identical non-enumerable response.
4. **Owner / admin / government access is unchanged.** Authentication decides whether the lookup
   *resolves*; the existing governed role rules still decide what the passport *body* contains.
5. Both passport routes are rate limited.
6. The helper is architected so an explicit **seller opt-in** to public plate lookup can be added
   later without widening the default.

## Chassis number — an inference, stated openly

The decision named plate and temporary identifier. Chassis number is included as restricted
because it is the same class of private identifier (it is in `PRIVATE_VEHICLE_FIELDS`, carries the
same cloning risk, and was resolvable through the same route). Leaving it public would have
preserved the oracle the decision exists to close, while "keep *exact VIN* lookup public" reads as
naming the one intended public entry point. Flagged here rather than buried.

## How it is implemented

`backend/utils/passportLookupPolicy.js` is the single place the policy lives.

- `classifyLookupIdentifier` sorts an identifier into `vin` (ISO 3779: 17 chars, no I/O/Q) or
  `restricted`. `PUBLIC_LOOKUP_KINDS` is a list of exactly one, so a new public kind must be added
  in the open rather than by loosening a condition.
- **The refusal happens before any query runs.** Answering from the policy alone is what makes the
  response non-enumerable: body *and* timing are identical whether or not the identifier exists.
  A constant body over a query that still ran would leak existence through response time.
- **A VIN lookup searches the `vin` column alone** (`lookupColumnsForKind`). This is what makes
  public VIN lookup safe rather than merely permitted: a public caller cannot supply a plate and
  discover the vehicle behind it, because the plate columns are never searched for that kind.
- Rate limits: 30/min on `/:vin/passport`, **10/min** on the identifier route — probing warrants a
  tighter budget than reading, and a test asserts the ordering so a future edit cannot invert it.

### Why the refusal is a 401 with a non-"Unauthorized" message

`web/src/lib/apiClient.ts` treats a 401 as a **session failure** when the message is absent or
begins with `Unauthorized`, and then clears the caller's stored auth. A plate-lookup refusal is a
statement about the caller's *access level*, not a broken session, so wording it that way would
sign browsing users out. The message deliberately does not start with `Unauthorized`, and a test
pins that — otherwise the dependency would be accidental and a reword would reintroduce the bug.

### The seller opt-in extension point

`resolveLookupAccess({ kind, actor, sellerOptIn })` already honours an opt-in, and
`resolveSellerLookupOptIn()` is the single function that would begin returning true. It is
**closed by default** and performs no query today — querying for a feature that does not exist yet
would reintroduce the timing signal for no benefit. A test asserts that only the literal `true`
opens the lookup, so a truthy-ish bug (`'false'`, `1`, `{}`) cannot widen the default.

## User-visible consequence

A signed-out visitor who searches by plate previously got a passport; they now get a **"Sign in to
look up by plate"** state. Rendering the old "Vehicle Not Found" would have been a false statement
about a vehicle that exists — the same withheld-vs-unrecorded conflation Phase 0 removed elsewhere.

## Guarded by

`backend/tests/issue164-lookup-policy.test.js` — 23 invariants. Verified to bite: making the
restricted kind public fails 6 tests; dropping the kind argument (restoring the cross-identifier
oracle) fails 1; removing the rate limiter fails 1.

---

## Scope boundary — this ADR governs the LOOKUP, not the BODY (added Phase 5)

Point 4 above already says it ("Authentication decides whether the lookup *resolves*; the existing
governed role rules still decide what the passport *body* contains"), and Phase 5 made the
distinction load-bearing rather than theoretical, so the boundary is drawn explicitly:

| question | decided by |
|---|---|
| May this caller resolve this identifier to a VIN at all? | **This ADR.** Exact VIN public; plate / temporary identifier / chassis authenticated; refusals non-enumerable and pre-query. |
| Given that it resolved, what does the anonymous body contain? | **`ADR-002-public-column-widening.md`.** Phase 0's +7 columns, Phase 5's `listing_media[].media_id`, and Phase 5's publication gate on listing media. |

**The Phase 5 addition worth flagging here**, because it is the same *non-enumerability* property
this ADR is built on, applied one layer in: the anonymous passport now serves listing media only for
a **published** listing, and the gated response is byte-identical to that of a published listing with
no photos. A gate that answered "no photos have been added" about a draft that *has* photographs
would have reintroduced an existence oracle inside a body reached through a route hardened against
exactly that — and would have done it by publishing a falsehood, which is worse than the leak. See
ADR-002, "the anonymous Passport and a DRAFT listing's photographs", and Rule 1b in
`MEDIA_EVIDENCE_CONTRACT.md`.

Note the two use different mechanisms for the same property, and both are deliberate: this ADR
achieves it by **answering before any query runs** (so body *and* timing are constant), while the
media gate achieves it by **running the identical queries either way** and discarding the rows
in-process (so timing is constant because the work is). Constant-time-by-not-working and
constant-time-by-always-working are both valid; mixing them up is not.
