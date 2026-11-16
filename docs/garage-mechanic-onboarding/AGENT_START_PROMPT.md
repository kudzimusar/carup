# Garage & Mechanic Onboarding 1.0 — Agent Start Prompt

Read this before touching anything in this programme.

---

## Where you are

CarUp can run a garage service workflow end to end. It cannot let a garage *join*.

Service Network Foundation 1.0 (PR #197, frozen at `ee45e556`) is complete and certified: given a
governed Garage membership, the whole loop works — request, queue, accept, job card, mechanic
assignment, work, completion, service history, Passport. Certified on desktop, tablet and mobile.

It consumes a `tenant_users` membership of a `garage` tenant. **Nothing in the product creates one.**
Every production reference to `tenants` and `tenant_users` is a SELECT, and
`user_registration_profiles.onboarding_status` is written once at registration and never advanced.
The garages used in Service Network certification were created by direct SQL.

This programme builds the missing path. It is not a Service Network change.

## Current phase

**GMO-0 is complete** (`GMO_0_DISCOVERY_RECEIPT.md`). Implementation of GMO-1 is **not authorized**
by the existence of the plan. Await explicit Product Owner authorization.

---

## Read first, in this order

1. `GARAGE_MECHANIC_ONBOARDING_1_0_CANONICAL_PLAN.md` — this programme
2. `GMO_0_DISCOVERY_RECEIPT.md` — what exists today, from source
3. root `DESIGN.md` — the global UI/UX contract, and it is enforced
4. `docs/service-network-foundation/SN_0_CROSS_CUTTING_INTEGRATION.md` — the seven-layer lesson
5. `docs/service-network-foundation/CARUP_SERVICE_NETWORK_FOUNDATION_1_0_CANONICAL_PLAN.md` §38.4 —
   the freeze and the boundary
6. PR #208 / O2 — the identity, verification and compliance architecture you are extending

Do not infer any of the above from a conversation summary. Read the code.

---

## The rule everything rests on

> Creating an account records who a person says they are. Verification establishes supported
> identity or evidence. Business activation establishes an organisation. Membership establishes the
> person's relationship to that organisation. Domain services determine what that membership may do.
> **None implies the next automatically.**

If you find yourself writing code where a claim, a document, a scan or a verification *becomes* an
authority, stop. That is the bug this whole programme exists to prevent.

---

## Hard constraints

**Never grants professional authority:** signup choice · `business_type` · registration profile ·
OCR output · identity verification alone · QR scan · Service Link · Garage Directory profile ·
Seller authority · vehicle ownership · Dealer profile · a typed organisation name.

**Do not build a second anything.** O2 already owns identity verification, document extraction,
evidence, reason codes and review patterns. Dealer Compliance already owns the application +
requirements + decision-ledger shape. `switch-role` already owns context switching. `emitDomainEvent`
and `logAuditEvent` are the canonical event and audit entry points. Reuse them.

**Do not add an eighth role inference.** Service Network paid seven times for one fact being decided
in several places, and every test suite stayed green through all seven. Desktop sidebar, compact
bottom navigation, direct routes and backend authorization consume the *same* canonical operating
context.

**Do not:** merge #197 or #208 · touch `main` or production · create migrations without explicit
authorization · activate an OCR provider or spend provider/neuron budget · manually create tenant
rows in staging and call it implementation.

---

## What "done" means here

Not "the API works". A phase is done when: the journey exists in the product, a real person can walk
it in a real browser on desktop *and* mobile, the authority is mutation-proven, the negative tests in
plan §15 pass, `DESIGN.md` compliance is gated, and a durable receipt records what remains open.

`GMO-8` forbids direct SQL fixtures standing in for any core onboarding step. If your certification
needs a hand-made tenant, the programme has not delivered its point.

---

## The most dangerous phase

**GMO-4 (Business Activation).** It is the only place in CarUp that will create an organisation and
a founding membership. Mutation-test it harder than anything else you write.

The specific failure to fear is already in this repository's history: during Service Network, a query
named a column that did not exist, the error was swallowed by a bare `catch`, and a broken read
became a confident answer. It passed review and deployed. Activation is far more consequential than
a read.

> A failed database operation must never become a confident "approved" state.

---

## Decisions you may not make alone

See plan §12. In particular: what evidence a Zimbabwe garage must supply to *operate* (as distinct
from being *verified*), who reviews, whether independent mechanics exist in v1, and the founding role
name — which may require adding to Service Network's accepted `GARAGE_ROLES` and therefore touches a
frozen certification.

If a decision is not derivable from an existing contract, surface it. Do not invent governance.
