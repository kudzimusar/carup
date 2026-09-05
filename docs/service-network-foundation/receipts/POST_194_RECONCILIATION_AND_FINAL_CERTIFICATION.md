# Service Network Foundation 1.0 — Post-#194 Reconciliation and Final Certification

This receipt has two parts. **Section A is the failed-reconciliation audit performed at the
broken head `93b97a36`, preserved exactly as it was written, before any repair.** It is kept
unedited because it is the institutional record of why the runtime mounting gate now exists:
184 of 184 Service Network tests were green while all 34 endpoints returned 404.

**Section B records the repair and its verification.**

---

# A. Failed reconciliation audit (pre-repair, at `93b97a36`)

**Verdict: NOT FINISHED.**

Audit performed read-only at PR #197 head `93b97a361cc00df3f7b912385a7f125de0015ea5`.
No commit, no push, no merge, no migration applied, no production or staging mutation.
PR #197 remains **Draft**.

---

### 1. State established (before any testing)

| Fact | Value |
|---|---|
| Local HEAD | `93b97a361cc00df3f7b912385a7f125de0015ea5` |
| Remote `feat/service-network-foundation-1-0` | `93b97a361cc00df3f7b912385a7f125de0015ea5` |
| PR #197 head | `93b97a361cc00df3f7b912385a7f125de0015ea5` |
| `main` HEAD | `bb9d9900c700873ca57df0ac18a1a5c01f77711a` (unmoved) |
| Local == remote | Yes |
| Working tree | Clean (untracked local config only) |
| Contains `5683b74e` | Yes — first parent |
| Contains `bb9d9900` | Yes — second parent |
| PR state | OPEN, **Draft**, base `main` |

`93b97a36` is a two-parent merge of the frozen #197 head and post-#194 `main`. **No commit
follows it**, so no obligation work has been performed since the merge.

> Environment note: the local clone is **shallow**, so `git merge-base` between the two parents
> returns nothing. Every comparison below is therefore a direct blob/tree comparison, which is
> shallow-safe, and each is independently corroborated by GitHub's own PR diff.

---

### 2. Findings

#### R1 — P0. The merge silently unmounted the entire Service Network backend.

`backend/server.js` at HEAD is **byte-identical to `main`'s**:

```
git diff bb9d9900 HEAD -- backend/server.js   ->   (empty)
```

The merge resolved the one conflicted file by taking main's side wholesale, discarding all
13 of #197's lines. `PR197_AUDIT_AND_MERGE_REHEARSAL.md` §4 predicted this exact outcome and
prescribed the opposite rule:

> *"Rule: union both sides, preserving each side's internal order. Never choose one side.
> … choosing 'theirs' silently unmounts all six Service Network routers. Both are silent —
> the server still boots and the routes simply 404."*

Lines dropped (present at `5683b74e:backend/server.js`, absent at HEAD):

| Kind | Lines |
|---|---|
| Router imports | `117-122` — `garageDirectoryRouter`, `serviceCaseRouter`, `serviceWorkOrderRouter`, `serviceRecordRouter`, `serviceLinkRouter`, `garageQueueRouter` |
| Service import | `123` — `getOwnerServiceHistory` |
| Mounts | `345-350` — the six `app.use(...)` calls |

**Runtime proof** (booted `backend/server.js`, walked the live Express router stack):

```
TOTAL mounted route paths:        694
SERVICE NETWORK paths mounted:      0   of 34 declared
```

The nine superficial matches are all pre-existing `main` routes (`/api/mechanic/work-orders`,
`/api/garage/analytics`, assorted review queues) — none belong to #197.

**Corroboration from GitHub:** `backend/server.js` and `web/src/App.tsx` are **absent** from
PR #197's current 72-file diff. GitHub agrees both shared files now equal `main`.

**Resulting dead call graph** — each service's only non-test caller is its route file, and every
route file mounts zero times:

| Service | Only non-test caller | Mounted |
|---|---|---|
| `garageDirectoryService` | `garageDirectoryRoutes.js` | 0 |
| `garageQueueService` | `garageQueueRoutes.js` | 0 |
| `serviceCaseService` | `serviceCaseRoutes.js` | 0 |
| `serviceLinkService` | `serviceLinkRoutes.js` | 0 |
| `serviceRecordService` | `serviceRecordRoutes.js` | 0 |
| `workOrderAssignmentService` | `serviceWorkOrderRoutes.js` | 0 |
| `ownerServiceHistoryService` | **none** | — |

All 10 services, 6 route files and 6 migrations are present on disk and unreachable from the
running application.

#### R2 — P0. S6's governed owner projection was reverted to main's raw query.

`/api/service-history/me` still exists, but at HEAD it is **main's pre-#197 implementation**:
a direct `select('*')` over `mechanic_work_orders`, returning raw rows. #197 had replaced it
with `getOwnerServiceHistory(...)` — the governed owner projection that states a fact or
reports it absent. That delegation is gone, so S6 currently contributes nothing at runtime.

#### R3 — P0. `web/src/App.tsx` lost the public garage profile route.

Also reverted to main. `GarageDetail` and its `/garages/:slug` route are gone;
`web/src/pages/GarageDetail.tsx` remains on disk with **zero importers** — an orphaned page.
(`/garages`, `/dashboard/garage`, `ServiceHistory` and `CustomerRecords` routes survive only
because they already existed on `main`.)

#### R4 — P1. CI is red at the exact head, and the merge caused it.

| Head | CI workflow |
|---|---|
| `5683b74e` (pre-merge) | **success** |
| `93b97a36` (exact head) | **failure** |

Run `33961287790`, job *Lint · Types · Build · Tests*, step **Backend tests (node:test)**:
5953 tests, 5931 pass, **1 fail**, 21 skipped. The single failure:

```
not ok 4360 - no NEW timestamp-prefix collision is introduced
  backend/tests/migration-integrity.test.js:169
  new timestamp-prefix collision(s): 20260901120000
```

`main` brought in `20260901120000_vehicle_finance_obligation_authority.sql`, which collides with
##197's `20260901120000_service_network_s1_garage_identity.sql`. Five duplicate prefixes already
exist in the repo as a grandfathered baseline; this guard is baseline-aware and fails only on
**new** collisions. The five sibling workflows (Referral, Navigation Intelligence, Diaspora 3-7,
Communication Command Center) are green at this head; Diaspora Deployed Staging UAT skipped.

#### R5 — P1. #197's test suite is structurally incapable of detecting R1.

All 21 Service Network test files import services **directly**. Zero import a route file, boot
`server.js`, or use supertest:

```
node --test backend/tests/service-network-*.test.js
  tests 184 | pass 184 | fail 0
```

**184/184 green while 34/34 endpoints return 404.** This is the same failure mode recorded in
`wiring-not-just-implementation`: injected-collaborator tests hiding a production path that is
dead by construction. Restoring the mount is necessary but not sufficient — without a
mount-point assertion, the next merge can silently repeat this.

#### R6 — P1. #197's six PGlite migration checks are wired into no gate.

`database/test/service_network_s{1,2,3,4,5,8}_check.mjs` are referenced by **0** workflow files,
and `migration_pglite_check.mjs`'s `NEW_MIGRATIONS` list ends at `20260810120000`. ci.yml's own
comment names this trap:

> *"a migration added after that date is otherwise executed by NO gate in this repo
> (migration-integrity.test.js only parses the file and checks its markers)"*

##197's six migrations are therefore never executed against real Postgres by CI.

---

### 3. O1–O10 obligation roll call at `93b97a36`

The merge brought `main` in but performed no obligation work. Measured, not inferred:

| # | Obligation | State | Evidence |
|---|---|---|---|
| O1 | Extend passport service/parts projection + lifecycle timeline | **OPEN** | No SN service references the passport projections |
| O2 | Populate `target_provider_tenant_id` in `createInquiry` | **OPEN** | Column exists (`20260901140000`); zero references in `marketplaceInquiryService.js` |
| O3 | Re-point I9 reads off `seller_*` | **OPEN** | No `target_provider_tenant_id` in `services/intelligence/` — blocked on O2 |
| O4 | Register `service.*` in `DETERMINISTIC_EVENT_IDENTITY_FIELDS` + DB dedupe trigger | **OPEN** | 0 `service.*` keys in `eventBusService.js:23` |
| O5 | Author §15.4 communication subscriptions | **OPEN** | No subscriber for `service.case.*` |
| O6 | Public service-link lookup added openly via `PUBLIC_LOOKUP_KINDS` | **OPEN — and bypassed** | `PUBLIC_LOOKUP_KINDS` is still `[VIN]`; `GET /api/service-links/:publicToken` (`optionalAuth()`) is a second public lookup surface that never consults `passportLookupPolicy` |
| O7 | Owner service history feeds the single lifecycle story | **OPEN — regressed** | See R2; `ownerServiceHistoryService` now has zero production callers |
| O8 | Extend `activityEventTypes` + `marketplace_activity_events` CHECK | **OPEN** | No service event types in the vocabulary |
| O9 | Directory trust display via `canonicalTrustService` batch | **N/A** | No trust display shipped |
| O10 | Evidence taxonomy additions | **N/A** | No taxonomy classes added |

**8 open, 2 not applicable, 0 closed.**

O6 deserves emphasis: it is not merely unwritten. #194 made public lookup kinds a deliberate
list of one so that a new public surface must be added in the open. #197 introduces one that
routes around that gate entirely. It is inert only because R1 leaves it unmounted — restoring
the mount makes it live.

---

### 4. Auth surface of the 34 unmounted endpoints

Recorded for post-fix review; none is currently reachable.

| Gate | Count | Endpoints |
|---|---|---|
| Public (no auth) | 2 | `GET /api/garage-directory`, `GET /api/garage-directory/:slug` |
| `optionalAuth()` | 1 | `GET /api/service-links/:publicToken` — see O6 |
| `authorizeRole(GARAGE_ROLES)` | 24 | garage profile/branches/queue/customers, case accept·decline·start·complete, all work-order and service-record routes |
| `authorizeRole(REQUESTER_ROLES)` | 4 | `POST /api/service-cases`, `GET /mine`, `GET /:caseId`, `POST /:caseId/cancel` |
| `authorizeRole(AUTHENTICATED_ROLES)` | 4 | service-link creation, capability grant·redeem·revoke |

No endpoint is unintentionally unauthenticated. `optionalAuth()` is correctly invoked as a
factory.

---

### 5. What was not run, and why

- **Five journey tests, Playwright staging, staging UAT — not run.** All 34 endpoints are
  unmounted, so every journey fails at its first API call. Running them would produce a
  foregone red rather than new information. They are the correct gate *after* R1 is fixed.
- **Full local backend suite — started, then stopped deliberately.** Host swap was exhausted
  (8.5 GiB of 9.2 GiB used, ~1 GiB disk free), the condition recorded in
  `carup-machine-thrashing-false-failures` as producing bogus timeouts. CI at the exact head is
  the authority and already answered definitively (§R4). The Service Network subset ran clean
  before pressure built: 184/184.
- **No staging migration, no provider activation, no production access.**

---

### 6. Required to reach FINISHED

1. **Re-resolve `backend/server.js` by union**, per §4 of the rehearsal document — restore the
   six imports, the `getOwnerServiceHistory` import, the six mounts, and #197's delegating
   `/api/service-history/me`, while keeping `main`'s `passportOwnershipTransferRouter` and the
   Seller-owned imports (`createAuthEmailService`, `normalizeRegistrationProfile`,
   `normalizeVehicleTaxonomyInput`, `buildCanonicalVehicleLifecycle`), all of which survived.
2. **Restore `web/src/App.tsx`**: `GarageDetail` import and the `/garages/:slug` route.
3. **Rename** `20260901120000_service_network_s1_garage_identity.sql` to a free timestamp to
   clear the new-collision guard.
4. **Add a mount-point assertion** that boots the app and asserts all 34 paths are routable, so
   R1 cannot recur silently.
5. **Wire the six `service_network_s*_check.mjs` gates into CI** and extend `NEW_MIGRATIONS`.
6. **Then** run the five journeys, Playwright, and staging UAT — they are meaningful only after 1–5.
7. Close O1–O8, or record each as accepted debt with an owner.

---

*Read-only audit. Production untouched. PR #197 unchanged and still Draft.*

---

# B. Final repaired certification

Everything in section A was measured at the broken head and is preserved unedited. This section
records what was repaired and what was independently verified afterwards.

## B.1 The repair

### R1 — `backend/server.js`, resolved by UNION

The merge took `main`'s side of this file wholesale. It is now a union: every post-#194 import and
mount is untouched, and the seven Service Network lines the merge discarded are restored — six
router imports, the `getOwnerServiceHistory` import, and the six `app.use(...)` mounts, in their
original position between `vehicleFinanceObligationRouter` and the Diaspora mount.

**Runtime proof.** The real Express application is booted and its live router stack walked:

```
TOTAL mounted route paths:        715      (was 694)
SERVICE NETWORK mounted paths:     35 / 35 (was 0 / 34)
```

Per router family, derived from the route files themselves rather than a hand-written list:

| Router | Declared | Mounted |
|---|---|---|
| `garageDirectoryRoutes` | 8 | 8 |
| `serviceCaseRoutes` | 9 | 9 |
| `serviceWorkOrderRoutes` | 5 | 5 |
| `serviceRecordRoutes` | 5 | 5 |
| `serviceLinkRoutes` | 5 | 5 |
| `garageQueueRoutes` | 2 | 2 |
| `server.js` (S6 owner history) | 1 | 1 |
| **Total** | **35** | **35** |

The audit counted 34 router endpoints; the 35th is the S6 owner-history endpoint mounted in
`server.js` itself.

### R2 — `/api/service-history/me` restored to the governed projection

The merge reinstated `main`'s raw `select('*')` over `mechanic_work_orders`. The route delegates to
`getOwnerServiceHistory` again, and the raw implementation is gone rather than shadowed.

### R3 — `web/src/App.tsx`, resolved by UNION

The complete post-#194 file is preserved; only the lost `GarageDetail` import and the
`/garages/:slug` route are added. `web/src/pages/GarageDetail.tsx` is no longer orphaned.

### R4 — migration timestamp collision

`main` brought `20260901120000_vehicle_finance_obligation_authority.sql` through #194. That file is
protected and untouched.

The Service Network set was resequenced forward instead. **Moving S1 alone would have broken FK
ordering** — S2 and S4 both `REFERENCES garage_branches`, created by S1 — so all six moved together
and kept their relative order. None had been applied to protected production (`git ls-tree` on
`main` finds zero Service Network migrations), so the rename is safe.

```
20260901120000 → 20260904120000  S1 garage identity
20260901130000 → 20260904130000  S2 service cases
20260901140000 → 20260904140000  S3 inquiry target garage
20260901150000 → 20260904150000  S4 work order assignment
20260901160000 → 20260904160000  S5 service records
20260901170000 → 20260904170000  S8 service links
```

All twelve references (six `database/test/*_check.mjs` harnesses and six S-receipts) were updated.
The five grandfathered duplicate prefixes are unchanged; no new duplicate exists.

### R5 — the runtime gate that would have caught this

`backend/tests/service-network-route-mounting.test.js` boots the real application and asserts
registration, not source text. The declared surface is derived from the route files, so an endpoint
added and never mounted fails the day it is written.

**Mutation-tested, twice:**

| Mutation | Result |
|---|---|
| Remove ONE mount (`serviceLinkRouter`) | 3 → 1 pass (caught) |
| Remove all six mounts (`server.js` takes main wholesale) | 3 → 1 pass (caught) |

A third test guards the converse mistake — restoring #197's `server.js` wholesale would unmount
everything `main` added.

`backend/tests/service-network-owner-history-route.test.js` does the same for R2. Its discriminator
is exact: the governed projection refuses a request with no owner identity with
`ForbiddenError` → 403, which the raw `select('*')` implementation cannot produce. Mutation-tested by
restoring `main`'s raw handler: **caught**.

`web/src/App.routeConvergence.test.tsx` renders the real `App` at each path and asks React Router
what resolved. Its first test is a control case proving the detection works at all. Mutation-tested
by deleting the `/garages/:slug` route: **caught**.

### R6 — the six PGlite harnesses now run in CI

`database/test/service_network_s{1,2,3,4,5,8}_check.mjs` were referenced by zero workflows, so six
migrations were executed by no gate — `migration-integrity.test.js` only parses a file and checks
its markers. A globbed step was added to `ci.yml` following the repository's existing Diaspora
pattern, including its refusal to pass vacuously on zero matches. All six pass locally against real
PostgreSQL via PGlite.

## B.2 O1–O10 roll call

Audit state: **8 OPEN / 2 N/A / 0 CLOSED**. Now:

| # | Obligation | State | What was done, and the evidence |
|---|---|---|---|
| O1 | Passport service projection | **CLOSED** | `projectServiceNetworkRecord()` added to the canonical projection. The Passport authority vocabulary is EXTENDED with `garage_stated`, `mechanic_attributed`, `evidence_backed` — without it, a governed `evidence_backed` record silently collapsed to `unknown`. `work_performed` reaches owner/governance only. Also fixed a pre-existing defect the tests surfaced: the merged chronological list was computed and then **discarded**, so callers got three source-ordered lists rather than one history. |
| O2 | Marketplace target garage | **CLOSED** | `createInquiry` resolves `target_provider_tenant_id` from `garage_public_profiles` where `publication_status = 'published'`. A caller may name a garage by slug or tenant id, but the persisted tenant is always the directory's answer; an unpublished or unknown garage is refused rather than recorded. Never derived from seller ownership — `seller_id`/`seller_tenant_id` stay untouched. |
| O3 | Intelligence I9 | **CLOSED** | Six of the eight declared-unmeasurable capabilities were **no longer true**: S2/S4/S5 added `requested_at`/`accepted_at`/`started_at`/`completed_at`/`cancelled_at`, a tenant-constrained `branch_id`, and a controlled `service_category`. Bookings, booking conversion, cancellations, turnaround, branch performance and service-category demand are now computed from those governed columns. Capacity and team performance remain declared absent with accurate reasons. Version bumped `service@1` → `service@2`. Garage scope stays tenant-wide; the mechanic projection is proven never to read `service_cases`. |
| O4 | Deterministic events | **CLOSED** | Six `service.*` types registered in `DETERMINISTIC_EVENT_IDENTITY_FIELDS`, keyed on `serviceCaseId`. Forward-only migration `20260904180000` extends `communication_domain_event_dedupe_key()` with the identical key format; a test parses the migration and pins the two contracts together. A replay produces the same key despite `eventPayload()` stamping a fresh `occurredAt`, so payload comparison could never have deduped these. |
| O5 | Communications | **CLOSED** | Four customer-facing transitions subscribed through canonical Communications, addressed to the governed participant `requester_user_id`. In-app only with `policyChannelsOnly`, so a user preference cannot widen it to email or SMS. `service.case.requested` and `service.case.cancelled` are deliberately NOT subscribed and say why: their audience is a tenant, and Communications addresses a user. Forward-only migration `20260904190000` adds the `service_case` thread type — without it the thread INSERT would have been rejected and the notification silently never queued. |
| O6 | Service Link public lookup | **CLOSED** | Scanning still requires no login. `SERVICE_LINK` is registered in `PUBLIC_LOOKUP_KINDS`, and the registration is **load-bearing**: `resolveServiceLink` consults `resolveLookupAccess`, so removing the entry genuinely closes the route. An anonymous scan returns exactly five safe keys and no VIN. Redemption remains authenticated; revocation, expiry and single-use are conditions of the consuming UPDATE. |
| O7 | Canonical lifecycle | **CLOSED** | Completed `service_records` join the ONE canonical timeline as `service` events. `work_performed` is not even SELECTed — a column never read cannot leak. Provenance carries the same `service_authority` value Passport projects, so the two surfaces cannot tell different stories. `service_records` added to the category's source list, so an unreadable source reports partial rather than complete. |
| O8 | Intelligence activity taxonomy | **N/A, proven** | Service Network writes to the `domain_events` outbox, never the analytics activity ledger, and that boundary is deliberate: a missed analytics event costs a data point, a missed case transition costs a customer their notification. Enforced by tests that fail if a Service Network service starts writing to the ledger, if a `service_*` type appears in the vocabulary, or if the JS vocabulary and DB CHECK drift apart. |
| O9 | Trust | **N/A, proven** | No Service Network path writes a Trust score, signal, or the `vehicles` row at all. Proven per-service against six forbidden patterns plus a check that no `vehicles` write exists. Completion emits an event and nothing more. |
| O10 | Evidence | **CLOSED (compatible)** | Evidence is LINKED by reference in `service_record_evidence`; no evidence content is duplicated. A matching VIN is proven insufficient — attaching requires a governed service case for that vehicle by that tenant. Cross-tenant linking fails, with one deliberate exception: evidence the vehicle's OWNER uploaded. |

**Result: 8 CLOSED, 2 proven N/A, 0 open.**

## B.3 Authentication audit

Every consequential Service Network route now composes `authorizeSessionRole(...)`
(`allowUserIdFallback: false`) instead of `authorizeRole(...)`. 31 routes changed across six route
files, covering case creation and actions, the garage private queue, customer records, mechanic
assignment, work-order status, service records, capability grant/redeem/revoke, and private garage
profile mutations.

Genuinely public surfaces are unchanged: `GET /api/garage-directory`,
`GET /api/garage-directory/:slug` (no auth) and `GET /api/service-links/:publicToken`
(`optionalAuth()`).

`backend/tests/service-network-auth-adversarial.test.js` runs the REAL middleware against the REAL
mounted routes. Its first test proves the `x-user-id` fallback is genuinely OPEN in the test
environment, so the rest cannot pass vacuously.

The assertion is on the refusal MESSAGE, not the status code. With no reachable database
`authorizeRole` also answers 401 — but with *"User record not found"*, because it accepted the
forged header as an identity and only failed looking that user up; against a real database it would
have succeeded. `authorizeSessionRole` answers *"This action requires an authenticated session"*.

**Mutation-tested:** reverting one route (`GET /api/garage/queue`) to `authorizeRole` turns three
tests red. An earlier, status-only version of the same test caught only the source-text check —
which is why the message assertion is there.

## B.4 Test counts

| Layer | Result |
|---|---|
| A — focused regression | **133 / 133** |
| B — complete Service Network suite | **251 / 251** (was 184 at the broken head) |
| C — full backend, repo ROOT, CI env contract | **6021 tests, 6000 pass, 0 fail, 21 skipped** |
| D — full web (vitest) | **163 files, 1582 / 1582 passed** |
| E — migration integrity | **24 / 24**; six Service Network PGlite harnesses **6 / 6** against real PostgreSQL |

Web typecheck (`tsc -b`) passes. Lint on net-new files is clean; `App.tsx` carries two pre-existing
`react-refresh/only-export-components` errors on its `AppContext` export, confirmed identical before
and after this change (they shift by one line because of the added import).

Net-new tests: 4 backend files (route mounting, owner-history route, O1–O10 obligations, adversarial
auth) and 1 web file (App route convergence).

**One methodology note, recorded because it nearly produced a false report.** The first full-backend
run showed 13 failures. Eleven were phantom: the run omitted `ALLOW_OCR_MOCK: 'true'` from the
`ci.yml` env contract, and those eleven verification/OCR tests pass 24/24 once it is set. The
remaining two were real and are fixed below. Running the backend suite without the exact CI env
manufactures failures that say nothing about the code.

## B.5 Product journeys and Playwright

### What ran, in a real browser

`web/e2e/service-network-public-routes.spec.ts`, Chromium, **6 / 6 passed** — desktop and a Pixel 5
viewport, including a control case at each width proving the NotFound detection works at all (without
it, every other assertion could pass because the catch-all never renders). The mobile case also
asserts no horizontal overflow: a profile page that renders but scrolls sideways is still broken.

Provenance was established before trusting the result. Port 5173 was already serving a DIFFERENT
worktree, so a dedicated server was started on 5199 and its working directory verified via `lsof`
to be this repaired tree. Running the specs against the other session's server would have been
false evidence. That server was left untouched and is still running.

This is the exact regression R3 caused: `/garages/:slug` fell through to the catch-all while
`GarageDetail.tsx` sat on disk with no importer.

### What did NOT run, and why

The six data journeys — directory → detail → request service; request → case → accept/decline;
work order → mechanic → record → completion; owner → Service History → Passport; Service Link →
scan → capability; garage queue and customer history — **were not executed end-to-end.**

They require a database holding the Service Network tables. There is none reachable: the local
Supabase is down (`localhost:54321` refuses connections), and applying these migrations to a hosted
database was not authorized in this lane. Running the journeys anyway would produce a foregone red
at the first API call, which is the same reason section A gave for not running them at the broken
head — and it would say nothing about whether the repair worked.

What exists instead is not a substitute and is not presented as one, but it is not nothing:

- all 35 endpoints are proven MOUNTED at runtime, which is what made every journey fail before;
- each journey's authorization gate is proven to refuse a forged identity and to admit only a real
  session, against the live middleware;
- the case lifecycle, records, links and capabilities are covered by 251 Service Network tests
  against injected persistence.

**The journeys remain the correct next gate, and this certification does not claim them.** They need
a database with `20260904120000`–`20260904190000` applied — a Product Owner decision, since it means
migrating a hosted environment.

## B.6 Two pinned truths that this work deliberately changed

Both gates were working correctly; each pinned a fact that an obligation changed. Both pins were
flipped rather than deleted.

- `intelligence-schema-contract` — *"every table an Intelligence service reads is one that exists"*.
  `service_cases` added to the known set, verified by an applied migration
  (`service_network_s2_check.mjs` executes its Up/Down/re-Up against real PostgreSQL in CI), not by
  assertion.
- `issue164-lookup-policy` — *"the public kind list is exactly the VIN"*. Now asserts the deliberate
  two-entry registry, plus the property that makes each entry safe, plus that `RESTRICTED` never
  becomes public. A third entry still has to arrive as a deliberate change there.

## B.7 Scope

- Production untouched. No staging deployment, no migration applied to any hosted database.
- `main` untouched.
- PR #197 remains **Draft**.
- The two new migrations are forward-only and additive; every pre-existing branch of the functions
  they replace is reproduced unchanged.
