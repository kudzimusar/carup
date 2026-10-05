# OC-5D — Service Network convergence (the #197 port)

Branch `feat/oc5d-service-network-convergence`, stacked on OC-5A, OC-5B and OC-5C, built from RC1
(`75449a16`). PR #197 (`c23f012c`, Draft) was **ported, never merged**: its migrations, services,
routes and web surfaces were re-read against this lineage and moved onto a verified, explicit
active-tenant context that did not exist when #197 was written.

Evidence levels follow `ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md`. Every step below is
**SOURCE-certified** (CI plus mutation testing); the migrations are also **DATABASE-certified**
(PGlite over the real prerequisite migrations). Receipts are in
`certification/ONE_CARUP_CERTIFICATION_MANIFEST.json`.

Nothing here is deployed, live-provider certified or owner-accepted. No migration was applied
anywhere. No provider is called by any Service Network path.

## Steps

| Step | Commit | CI | Mutants | Disposition |
|---|---|---|---|---|
| P0 R14 — a production bundle carries no demo identity or password | `ed6b1210` | 37217517034 | 1/1 killed, 2 equivalent (recorded) | PORTED, strengthened |
| P1 verified, explicit active-tenant context | `30c5f95b` | 37221581319 | 34/34 | RE-AUTHORED (replaces #197's guess) |
| P2 the clients choose the organisation | `fc03f92e` | 37221581319 | 15/15 | NEW |
| P6 owner service-history v1 contract | `6783ae3f` | 37237789735 | 17/17 | NEW FIX (native crash F1) |
| P3 the Service Network migrations | `17967567` | 37239177330 | 19/19 | PORTED, re-timestamped, references added |
| P4 the Service Network core | `7e244e5a` | 37244329467 | 38/38 | PORTED, re-gated |
| P7 the web Service Network surfaces | `cdc81ae8` `f6a13c01` | 37246835794 | 33/33 | PORTED, F4 closed |

P5 (the cross-cutting suites #197 touched) landed inside P4: every suite whose premise moved was
re-pinned, none loosened.

`f6a13c01` fixes a test race that P7's run exposed, in an OC-5C test (People & Compliance C3). The
test clicked the next dealer control before the previous decision had settled. P7's extra owner
test files slowed the OC-4D job's runner enough to lose the race (302 ms → 5.3 s). The race was made
deterministic with a delayed decision mock: the old body fails and the new one passes. The
assertions are unchanged.

## What changed beyond #197, and why

**The organisation a request acts for (P1, P2).**
- It was a guess: login handed back the caller's sole membership (#197: "the oldest"), the client sent it as `x-tenant-id`, and the middleware checked membership only — never the tenant's type or status. A membership read that failed answered 403 "you do not belong".
- Now `PUT /api/auth/active-tenant` is the only way a session gains an organisation (a membership of an ACTIVE tenant, recorded on this session, CSRF-protected, rate-limited, audited). Every request re-verifies it; `x-tenant-id` is an assertion (mismatch 403, revoked 403); a failed read is 503 `TENANT_CONTEXT_UNAVAILABLE`.
- The clients hold only what the server verified. A sole membership is offered as one tap, never selected for the person.
- Closed on the way: `switch-role` returned the caller's own password hash; `switch-role` and feature governance lent any tenant role except `admin` as a platform role.

**F4 — a tenant role is not a platform role (P4 backend, P7 web).**
- #197 let a role inside a garage satisfy a feature's PLATFORM role list. A garage's own admin satisfied every `roles: ['admin']` feature in the web.
- A garage feature now declares a tenant scope (`tenantTypes` / `tenantRoles`, `roles: []`) satisfied only by the selected, verified organisation; a platform role satisfies `roles` and nothing else. One predicate on each side (backend feature governance, web `isFeatureRoleEligible`).
- Every web reader uses it: the route gate, the route boundary, the sidebar, the mobile drawer, the compact bar and the operating home. A source pin fails if a new call site forgets the organisation.
- A garage member's home is the Workshop (`/garage`). #197 sent them to `/mechanic`, the platform mechanic's dashboard, whose API refuses them.
- The client no longer swaps the tenant role into `x-stakeholder-role` on a client-kept list of "garage-side" paths.

**Owner service history (P6, P7).**
- The native Garage read `item.cost`, a key no schema ever had, and threw on the first non-empty history.
- The response carried other people's identifiers: after a sale the row names the previous owner; the work order names the garage employee and the account that decided.
- Now one v1 contract is pinned on both sides of the wire: money is `{recorded, amount, currency}` and is never recorded without a currency; a failed read is 503.
- The web Service History page kept its own spend calculation beside the Passport's, and counted a "recorded" entry without an amount as 0. It now uses the Passport's rule.

**Migrations (P3).**
- #197's `20260904*` stamps sorted before migrations they depend on, and two shared a stamp with RC1. They move into `20261004180000..180800`, in dependency order.
- Assignments, records and record parts gain real references (RESTRICT); #197 left bare UUIDs.
- O4 re-asserts `REVOKE ALL` on the dedupe trigger function.
- `service_case_status_v1` is registered by migration; four #197 policies bound it and every customer-facing case notification would have dead-lettered.

**The core (P4).**
- Every garage route is a real session plus `requireActiveTenant({types: ['garage'], roles})`. Workspace roles are {admin, mechanic}; assignment, profile, publication and branches are {admin}. There is no platform-admin bypass.
- `/api/garage/analytics` (RC1) is gated the same way. It served a dealership's admin "garage intelligence" about the dealership.
- `source_inquiry_id` is server-side only. Any caller could name another person's inquiry and receive their case.
- A case-born work order awaits the custodian (OC-5A), and no service record is written until it is authorized.
- Provenance is derived (`garage_stated`), never declared. #197 let a garage stamp its own record evidence-backed.

**The web surfaces (P7).**
- `useGarageOperator`, the only thing that moves a person (`/dashboard` → `/garage`), counts only a selected, verified garage in a workspace role. Nobody is moved while the session restores.
- `/auth/me`'s answer is the whole identity; the organisation is replaced, not merged.
- The mechanic Customer Records page showed fabricated customers (one carried the owner demo address) to every mechanic. It reads the garage's real customers. The demo address is now a production-bundle needle (P0 named this open).
- The design gate declares RC1's garage onboarding pages; both already pass its clauses.

## Deferred, and why

- **#197's preview pairing entries.** They pair #197's own branch previews with a staging backend; nothing in OC-5 deploys.
- **A garage member's "Active portal" label.** On `/garage` the dashboard shell's portal selector reads "Mechanic" (the layout's platform-role prop) for a person whose platform role is owner. It is presentation only: the selector cannot grant anything (switch-role re-verifies). A layout keyed on the operating context is UX work, not convergence.
- **Garage membership creation.** No product path creates a garage membership on this lineage; that is GMO's (OC-5E).

## Not applied anywhere

- The nine Service Network migrations (`database/migrations/20261004180000..180800_*`).
- The OC-5A work-order owner-authorization migrations they build on.

## Open owner decisions recorded by this phase

1. A case-born work order is born **awaiting** the custodian. Recommendation: keep it; OC-5A's decision stands.
2. The Service Network role sets: workspace {admin, mechanic}; assignment, profile, publication and branches {admin}.
3. Publication approval joins when GMO-4's activation path lands.
4. Trade OS T3: the logistics marketplace opens on a self-declared `business_type` (an owner decision the SN-0 pin now lists exactly).
5. Organisations are chosen, never guessed: an operator with one membership taps once.
