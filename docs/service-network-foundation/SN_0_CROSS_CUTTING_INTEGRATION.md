# SN-0 — Cross-cutting Identity, Context, Navigation & Design Integration

**Status:** canonical, post-Foundation. Extends S0–S10; renumbers nothing.
**Authority:** subordinate to root `DESIGN.md` and to the Truth & Trust / security contracts.
**Applies to:** every Service Network surface and every future Service Network change.

---

## Why this section exists

S0–S10 defined Service Network *vertically*: the Service Case, the garage, the mechanic, the work
order, the service record, evidence, the Passport projection, Service Links. Each was specified,
built and certified against its own contract, and the core transaction loop passed owner UAT.

None of that covers the **horizontal** dependencies. A Service Network journey does not begin at a
Service Case — it begins with a person who registered, was onboarded, belongs to a garage, is
operating in a context, and is looking at a screen on a phone. Foundation never stated those
dependencies, so they were never gated, and two of them turned out to be broken in ways no Service
Network test could see:

- a real garage tenant-member could not reach the workspace at all — **six** independent layers
  judged them by the wrong one of their two true roles, and every suite stayed green;
- the mobile drawer showed that same person nineteen owner items and zero garage items — a
  **seventh** layer, found by this audit.

SN-0 is the durable statement that Service Network **depends on** these things, so a future change
cannot be declared complete without them.

---

## SN-0.1 The two true roles

A CarUp person may hold, simultaneously and truthfully:

| fact | authority | example |
|---|---|---|
| authenticated identity | `users.id` via session | — |
| **platform role** | `users.role` | `owner` |
| registration/profile **claim** | `user_registration_profiles.business_type` | "garage" |
| tenant membership | `tenant_users` | member of Garage A |
| **tenant role** | `tenant_users.role` | `mechanic` |
| active operating context | the tenant a session is acting for | Garage A |

Public registration only ever creates an `owner` (`PUBLIC_REGISTRATION_ROLE`). **A garage employee
who signs up through the product is therefore `owner` platform-wide and `mechanic` inside their
garage.** Both are true. Judging them by only one is the single most expensive mistake in this
area's history.

### The rule

> A requirement is satisfied by the **platform role OR the verified tenant role**.

This is not new. `resolveEffectiveRole` has always said it. What was new was that six other layers
had never been told:

| # | layer | symptom when it did not know |
|---|---|---|
| 1 | `x-stakeholder-role` sent by the client | 403 on every garage route |
| 2 | route access via `DashboardLayout` | redirected off `/garage` |
| 3 | sidebar visibility | workspace invisible |
| 4 | feature governance `accessible` | "Feature unavailable — currently turned off" |
| 5 | route access via `RegistryRouteBoundary` | infinite `/garage ↔ /dashboard` loop |
| 6 | the garage-side route SET | queue worked, **Accept** 403'd |
| 7 | `getMobileNavigation` (drawer) + compact bar | 19 owner items, 0 garage items on mobile |

**Invariant:** navigation visibility and direct route admission derive from the same facts. A
surface that is offered must be admitted; a surface that is refused must not be offered.

Guarded by (each mutation-proven):
- `web/src/lib/tenantRoleAccess.test.ts` — fails naming any `evaluateRouteAccess` call site that
  omits `tenantRole`;
- `web/src/hooks/garageSideRoutes.test.ts` — parses `backend/routes/*.js` for every
  `authorizeSessionRole(GARAGE_ROLES)` declaration and asserts the client agrees;
- `web/src/components/layout/compactNav.test.tsx` — every destination the bar offers is a route the
  same actor can open.

---

## SN-0.2 What grants authority — and what never does

Service Network decides **what an authorized actor may do inside a service workflow**. It does not
decide who is authorized.

### Never grants authority

| input | why it is not authority |
|---|---|
| a registration `business_type` claim | it is an application, recorded so a human can review it |
| OCR / document extraction | input assistance; a forged document must not become a garage |
| a scanned QR / Service Link | a scan is a read; it reports what a link is and confers nothing |
| a client `x-stakeholder-role` header | honoured only against the verified `tenant_users` record |

Guarded by `backend/tests/service-network-authority-boundaries.test.js`, which is structural rather
than stub-based: a stub answers whatever it is asked, and the question here is whether any
authorization path *consults* these inputs at all. Mutation-proven for all three.

### Does grant authority

A `tenant_users` row — a governed membership of a tenant of type `garage`.

---

## SN-0.3 The gap: nothing in the product creates that membership

**This is the most important open item in Service Network, and it is a Product Owner decision, not
an engineering one.**

Verified by exhaustive search of the backend at this head:

```
inserts into tenant_users  : NONE in production code
inserts into tenants       : NONE in production code
```

Every reference is a read. `registrationProfileService` stores intent and touches no authority.
`dealerComplianceService` manages profiles, branches, requirements and documents and never writes
`tenants`, `tenant_users` or `users.role`. No admin route, RPC or onboarding path creates either.

So the chain SN-0 depends on is broken in exactly one place:

```
registration ✓ → registration profile ✓ → identity/business onboarding ✓
   → governed membership ✗ ← NOTHING IN THE PRODUCT CREATES THIS
   → active context ✓ → SN navigation ✓ → route ✓ → backend capability ✓
```

Everything either side of that link works and is certified. The staging garages used throughout
Service Network certification were provisioned **by direct SQL in certification fixtures**, never by
a product journey.

### Consequences, stated plainly

- A real person who registers as `business_type: garage` today gets a correct, safe base account and
  **no path to ever operating a garage on CarUp**.
- Service Network's entire garage side is reachable only for memberships provisioned out of band.
- Journey B ("new garage applicant") ends truthfully at "onboarding pending" — and pending is where
  it stays, because there is no reviewer action that can complete it.

### Owned by

This gap is now a programme of its own:
**`docs/garage-mechanic-onboarding/GARAGE_MECHANIC_ONBOARDING_1_0_CANONICAL_PLAN.md`**.

The dependency chain reads:

```
O2 Identity / Registration → Garage & Mechanic Onboarding → Tenant / Context → Service Network
```

Service Network consumes the membership. It must never create one.

### What was deliberately NOT done

No activation path was invented. Choosing who may grant a business/tenant membership, and on what
evidence, is a new authority that does not exist today — an explicit Product Owner decision. Writing
one would have been fabricating governance.

---

## SN-0.4 Design authority

Root `DESIGN.md` is the global UI/UX contract for every CarUp surface.

**Service Network was never certified against it.** `DESIGN.md` was ADDED to the repository on
2026-09-04 (merge `bb9d9900`); the Service Network lane opened 2026-08-29 and the file is absent at
`001f7de2`. Foundation became functionally and responsively usable through owner UAT without any
global-design gate, because the gate did not exist when its surfaces were specified.

`web/src/__tests__/designContract.test.ts` now enforces the mechanically decidable clauses — §4.3
width continuity across connected routes, §6.2 back/up affordance, §8.1 no fake zeros, §10 touch
targets and overflow primitives, §20 the legacy-pattern ratchet — names the clause in every failure,
and fails if `DESIGN.md` is renamed or those clauses disappear.

Editorial judgement (§3 "editorial rather than generic SaaS", §4 palette and typographic character)
remains a human review. A test should not pretend to see it.

**§20 is a ratchet, not a cliff.** Nine working, UAT-passed Service Network pages are built on
`Card + CardContent + card-shadow`, which §20 deprecates. They were built before the rule existed.
Their card count is recorded and may only shrink — which is exactly what §20 means by "existing
legacy surfaces are migration targets, not reference implementations". Rewriting them to chase a
visual standard would be a redesign, and a convergence audit is not a mandate for one.

---

## SN-0.5 Mobile navigation

**Decision: one canonical, context-aware compact bar — `CompactBottomNav` — in both shells.**

Verified before changing anything:

- `CompactBottomNav` already existed, mounted **only** in `MainLayout` (the public shell). Every
  authenticated workspace on a phone had a hamburger drawer and nothing else.
- Web bottom tabs were **deliberately deferred**, not forgotten — Lane B.1, recorded in
  `docs/navigation-intelligence/NAVIGATION_PR_RECONCILIATION.md`.
- The **native** app already ships governed role-aware bottom tabs with a ≤5 ceiling, a
  More→drawer contract and a dedupe rule
  (`docs/navigation-intelligence/NATIVE_NAVIGATION_IMPLEMENTATION.md`).

So the architecturally consistent move was to extend the one canonical component to the
authenticated shell, matching the native contract — **not** to add `GarageBottomNav` /
`MechanicBottomNav`, which would be the competing systems that lane already rejected.

The bar:
- resolves destinations from the **feature registry**, filtered by `resolveFeatureVisibility` — the
  same resolver the sidebar, drawer and route boundary use;
- follows the role the person is **operating** as, because a bottom bar states the current task, not
  an inventory of everything the person could ever do;
- holds ≤5 items with "More" opening the **existing** drawer, so there is no second secondary
  surface;
- carries safe-area insets, ≥44px touch targets, one `aria-current`, and page padding equal to its
  own height so it never covers a primary CTA (§10);
- lost its private `ROLE_HOME` map, which was an eighth place deciding one fact.

Desktop and tablet keep the sidebar; the bar is `lg:hidden`.

---

## SN-0.6 Completion gate for future Service Network work

A Service Network change is **not** complete when its own tests pass. It is complete when:

1. `web/src/__tests__/designContract.test.ts` passes, and any new surface is declared to it;
2. every new gate consuming a role accepts the platform role **or** the verified tenant role;
3. navigation visibility and route admission are proven to agree for the same actor;
4. no new authority is derived from a profile claim, OCR output or a QR scan;
5. desktop, tablet and mobile are each exercised in a browser, not reasoned about;
6. the PR states which `DESIGN.md` sections it implements (§24).

Item 5 is not ceremony. Every defect in SN-0.1 was invisible to a green suite and obvious to one
real account in one real browser.
