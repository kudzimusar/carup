# Service Network Foundation 1.0 — Post-#194 Reconciliation and Final Certification

This receipt has two parts. **Section A is the failed-reconciliation audit performed at the
broken head `93b97a36`, preserved exactly as it was written, before any repair.** It is kept
unedited because it is the institutional record of why the runtime mounting gate now exists:
184 of 184 Service Network tests were green while all 34 endpoints returned 404.

**Section B records the repair and its offline verification.**

**Section C records the hosted staging completion** — the migrations applied to the approved
staging database, the governed preview pair, the six hosted journeys and their database evidence.
Section B named one blocker; section C closes it.

**Section D corrects a provenance inconsistency in section C and re-certifies against an explicitly
identified paired deployment.** Where C and D disagree, **D is authoritative**; C is kept because how
the inconsistency arose is part of the record.

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

## B.6 Exact-head CI

Certified head **`fbfa2678`** (`5a0306e5` plus a documentation-only whitespace fix).
`local == origin == PR #197 head`, working tree clean, PR still **Draft**, `main` unmoved at
`bb9d9900`.

| Workflow | Result at `fbfa2678` |
|---|---|
| CI (Lint · Types · Build · Tests) | **success** — `6021 tests, 6000 pass, 0 fail, 21 skipped`, identical to the local run |
| CI · Service Network migration harnesses | **success** — "All 6 Service Network harnesses passed" against real PostgreSQL |
| CI · Secret scan | success |
| CI · Dependency audit | success |
| Vehicle Passport Foundation CI | **success** |
| Referral Engine CI | success |
| Navigation Intelligence CI | success |
| Diaspora Phases 3-7 Validation | success |
| Communication Command Center CI | success |
| Diaspora Deployed Staging UAT | skipped (by design) |
| Marketplace Reference Regression | **failure — blocked, see below** |

### Two gates that had never run on this branch

Both `Vehicle Passport Foundation CI` and `Marketplace Reference Regression` are path-filtered, and
both are filtered on `backend/server.js`. At the broken head that file was **byte-identical to
main**, so the PR presented no diff for either gate and neither ever ran. Repairing the file gave
them one, and both fired for the first time at `5a0306e5`.

This is the hazard in its purest form: the branch looked green because two gates were never asked.

- **Passport CI** failed on `git diff --check` — six trailing-whitespace lines in the canonical
  plan's metadata header, pre-existing PR content in a file this work never touched. They were
  deliberate markdown hard line breaks; the block is now a list, which renders identically. **Now
  green.**
- **Marketplace Reference Regression** is blocked on a precondition, not a regression. See B.7.

## B.7 Blocked, and why it is a Product Owner decision

`Marketplace Reference Regression` fails at its first step:

```
{"error":"candidate preview pair is not governed",
 "branch":"feat/service-network-foundation-1-0",
 "frontend_configured":false,"backend_configured":false}
```

The gate refuses to certify a branch that is not registered in `web/preview-frontend-pairing.json`
and `web/preview-backend-pairing.json`. **That refusal is correct and must not be worked around.**
The maps exist so a branch preview cannot silently certify against the shared staging backend, which
produces evidence that looks real and is not.

What is established:

- a frontend preview for the exact head **does exist and is READY** —
  `dpl_DSKAmTR2NrMLX3c573ydaxYCZjbC`, commit `5a0306e5`, alias
  `carup-staging-git-feat-service-network-foundation-1-0-11-11.vercel.app`;
- the backend alias was **not** guessed. Vercel truncates and hashes long branch names (existing
  entries show `…-control-6e0b93-…`, `…-comm-25bf18-…`), so a constructed URL could point at another
  deployment — exactly the mispairing the gate prevents.

Even with a correct pair, the gate's later steps run an **unmocked staging certification**, which
needs migrations `20260904120000`–`20260904190000` applied to the staging database. They are not.

So one decision unblocks both this gate and the six data journeys in B.5: **apply the Service
Network migrations to staging and register the verified preview pair.** Both mutate a hosted
environment and were outside this lane's authorization, so neither was done and neither is claimed.

## B.8 Two pinned truths that this work deliberately changed

Both gates were working correctly; each pinned a fact that an obligation changed. Both pins were
flipped rather than deleted.

- `intelligence-schema-contract` — *"every table an Intelligence service reads is one that exists"*.
  `service_cases` added to the known set, verified by an applied migration
  (`service_network_s2_check.mjs` executes its Up/Down/re-Up against real PostgreSQL in CI), not by
  assertion.
- `issue164-lookup-policy` — *"the public kind list is exactly the VIN"*. Now asserts the deliberate
  two-entry registry, plus the property that makes each entry safe, plus that `RESTRICTED` never
  becomes public. A third entry still has to arrive as a deliberate change there.

## B.9 Scope

- Production untouched. No staging deployment, no migration applied to any hosted database.
- `main` untouched.
- PR #197 remains **Draft**.
- The two new migrations are forward-only and additive; every pre-existing branch of the functions
  they replace is reproduced unchanged.

---

# C. Hosted staging completion

Section B certified the repair offline and named one blocker: the Service Network migrations had
never been applied to a hosted database, and the branch was not registered as a governed preview
pair. Both are now closed. This section records the hosted evidence.

**Certified head: `9c95e2a239ed393bf12f4d4f0bdcf129a48a4e30`.** The candidate `c81e1e98` was carried
forward by exactly one commit, which registers this branch's preview pair. Why that commit was
unavoidable is in C.3.

## C.1 Provenance of the exact preview pair

> **SUPERSEDED BY D.3.** The table below records the pre-pairing verification this brief required,
> at `c81e1e98`. That SHA does **not** contain the pairing registry entry, which `vite.config.ts`
> reads at build time, so it is not the certified candidate. See section D.

Verified twice from independent sources before anything was used.

| Side | Deployment ID | URL | Commit SHA | State |
|---|---|---|---|---|
| Frontend | `dpl_DnYCMjFd9spmJrnDwzD4tTYMqrjH` | `https://carup-staging-136orjxmf-11-11.vercel.app` | `c81e1e98…` | READY |
| Backend | `dpl_BpLZ5bXvnJ13MUSJ3HZ9gZ7z7KuK` | `https://carup-backend-staging-veyxcjyxk-11-11.vercel.app` | `c81e1e98…` | READY |

- **Vercel deployment metadata** reports `githubCommitSha = c81e1e98…` and
  `githubCommitRef = feat/service-network-foundation-1-0` for both.
- **The backend's own `/api/health`** independently reports
  `build.commit_sha = c81e1e98…`, `deployment_id = dpl_BpLZ5bXvnJ13MUSJ3HZ9gZ7z7KuK`,
  `provenance_available = true`.

Neither side ever reported another SHA, so the fail-closed condition was not triggered.

After the pairing commit, both were re-verified at the new head: frontend
`carup-provenance.json → commit_sha 9c95e2a2…, unpaired false`, backend
`/api/health → build.commit_sha 9c95e2a2…`.

## C.2 The migrated staging database

**Project `eoyenigwevnxwwhyhaer`** — the same ref the repository's own workflows pin as
`EXPECTED_STAGING_PROJECT_REF`. No production database was touched.

**The backend was proven bound to this database before it was migrated**, rather than assumed: the
deployed `/api/health` reported `outboxBacklog: 284`, and `select count(*) from domain_events where
status='pending'` on this project returned exactly **284**.

### Preflight

| Check | Result |
|---|---|
| Service Network migrations in the ledger | **none of the eight** |
| Old-timestamp (`20260901*`) Service Network equivalents | **none** — no prior migration had created this schema |
| The 11 Service Network tables | **all absent** |
| S3 column, O4 service branch, O5 thread type | absent, absent, absent |
| FK prerequisites (`tenants`, `users`, `vehicles`, `mechanic_work_orders`, `message_threads`, `domain_events`) | all present |

### Apply

All eight were genuinely missing and all eight were applied, in order, through the governed
migration mechanism. The `-- +migrate Up` section of each file was applied exactly as the candidate
defines it.

| # | Migration | Status |
|---|---|---|
| 1 | `20260904120000_service_network_s1_garage_identity` | applied |
| 2 | `20260904130000_service_network_s2_service_cases` | applied |
| 3 | `20260904140000_service_network_s3_inquiry_target_garage` | applied |
| 4 | `20260904150000_service_network_s4_work_order_assignment` | applied |
| 5 | `20260904160000_service_network_s5_service_records` | applied |
| 6 | `20260904170000_service_network_s8_service_links` | applied |
| 7 | `20260904180000_service_network_o4_event_dedupe` | applied |
| 8 | `20260904190000_service_network_o5_thread_type` | applied |

The instruction not to stop at six was load-bearing: O4 and O5 were as absent as the other six, and
without them the case lifecycle would have had no dedupe identity and every Service Network
notification would have been rejected by a CHECK constraint.

### One thing found while applying, recorded rather than smoothed over

Staging's `communication_domain_event_dedupe_key()` carried **only** the
`marketplace.inquiry.created` branch. The repo's canonical version also has `user.email.verified`
and `vehicle.trust.presentation_changed`, added by `20260826120000_email_1_0_hardening.sql` — which
is **absent from staging's ledger**. Staging was simply behind on that already-merged lane.

The O4 migration was applied **exactly as the candidate defines it**, which necessarily brings those
two branches with it. Applying a staging-tailored variant would have certified something other than
the candidate. The change is additive: no branch was removed, no existing row was altered, and the
`dedupe_key` column, its partial unique index and the trigger already existed.

### Post-apply verification

| Effect | Result |
|---|---|
| 11 Service Network tables | **11 / 11 present** |
| S3 `marketplace_inquiries.target_provider_tenant_id` | present |
| S4 columns on `mechanic_work_orders` | **7 / 7** |
| Key constraints (branch-within-tenant ×2, service-case FK, cost-needs-currency) | **4 / 4** |
| `service_case_events` append-only trigger | present |
| O4 `service.case.*` branch in the dedupe function | present |
| O5 `service_case` in the thread-type CHECK | present |
| RLS enabled **and forced** | **11 / 11** |

**The decisive before/after:** the deployed backend's `GET /api/garage-directory` answered
`500 — Could not find the table 'public.garage_public_profiles'` before, and `200 {"garages":[],"total":0}`
after. That single change re-proves both that the repair reached the deployment and that this
database is the one it uses.

Migration integrity **24 / 24**; the six PGlite harnesses **6 / 6** against real PostgreSQL.

## C.3 Why the head had to move

The Marketplace gate refused `c81e1e98` with `candidate preview pair is not governed`. Registering
the pair is a file change, so it necessarily produces a new SHA.

It is not merely bureaucratic. `web/vite.config.ts` reads `preview-backend-pairing.json` **at build
time**, and with the branch absent the `c81e1e98` frontend baked in:

```json
{ "api_base_url": "https://unpaired-preview.carup.invalid/api", "unpaired": true,
  "api_base_source": "branch \"feat/service-network-foundation-1-0\" is not listed in preview-backend-pairing.json" }
```

That is fail-closed by design — an unpaired preview must not silently borrow another candidate's
backend. It also means **no hosted UI journey was possible at `c81e1e98`**: that frontend could not
reach any backend at all. The frontend had to be rebuilt with a real origin.

**The pairing guard was not weakened, bypassed or special-cased.** Two values were added to the
registry it reads.

Both values are Vercel's stable per-branch **aliases**, which is what these files document
("Values are the ORIGIN of that branch's backend preview — Vercel's stable per-branch alias, which
keeps its hostname across redeploys") and what all 13 existing entries use. An immutable
per-deployment URL could never satisfy this gate: registering one moves the head, and the gate then
compares that deployment's `commit_sha` against the new head and fails.

Neither alias was constructed. Both were read from Vercel metadata and then verified to resolve to
exactly the deployments the Product Owner pinned. The backend alias is
`…-feat-service-network-fou-fda7ff-…` — the truncated-and-hashed form, not the readable form a guess
would have produced, which is why the previous session refused to invent it.

## C.4 Marketplace Reference Regression

**PASS** at `9c95e2a2` (run `33974162679`). The pairing step now resolves:

```json
{"branch":"feat/service-network-foundation-1-0",
 "frontend":"https://carup-staging-git-feat-service-network-foundation-1-0-11-11.vercel.app",
 "backend":"https://carup-backend-staging-git-feat-service-network-fou-fda7ff-11-11.vercel.app"}
```

The gate then ran its full unmocked staging certification against that pair: **8 files / 205 tests**
plus **7 Playwright specs** against deployed staging, all green.

## C.5 The six hosted journeys

Run `snc002742`, against the paired backend and the migrated database. **36 / 36 assertions passed.**

Fixtures are synthetic, staging-only and **run-scoped** — their own tenant, four accounts, VIN
`SNCERT002742VIN01` and slug `sn-cert-snc002742` — so no earlier certification could manufacture
state for this one. No production identity or vehicle was used.

Notably, the garage role was **not** granted by editing a user's platform role. Public registration
refuses to assign one (`"Public registration cannot assign a role; accounts are created as 'owner'"`),
so the garage and mechanic received their role the governed way: membership in a `garage`-type
tenant, which `resolveEffectiveRole` honours only when the requested role matches the verified
`tenant_users` row.

| Journey | Assertions | Result |
|---|---|---|
| 1 — Directory → Detail → service request | 6 | PASS |
| 2 — Marketplace request → target garage | 2 | PASS |
| 3 — accept → queue / state transition | 4 | PASS |
| 4 — work order → mechanic → work → record → completion | 8 | PASS |
| 5 — Owner Service History → Passport / lifecycle | 5 | PASS |
| 6 — Service Link → anonymous lookup → scoped capability | 9 | PASS |

Each journey asserted refusals as well as successes: an unpublished garage is absent from the public
directory; an unrelated user cannot read the case; the private queue refuses an anonymous caller;
an unknown work-order status is refused; another owner does not see this vehicle's history;
redemption requires authentication; a redeemed capability cannot be replayed; a revoked one cannot
be redeemed.

## C.6 Database evidence for the consequential transitions

API responses were not accepted as proof. Every consequential transition was read back from the
staging database.

**Service case** `ae273895-138b-465b-99bb-405f57d5dd3c` — `status completed`, correct VIN, garage
tenant and requester, `source_channel directory`, and all four stamps present
(`requested_at`, `accepted_at`, `started_at`, `completed_at`).

**Append-only case history** — the full lifecycle, in order:

```
service.case.requested   null      → requested
service.case.accepted    requested → accepted
service.work.started     accepted  → active
service.case.completed   active    → completed
```

**Work order** `0c7f2470…` — `service_case_id` links to the case, `status Completed`, `completed_at`
set, correct tenant, VIN and category.

**Assignment** — mechanic `u_853bbaff…`, assigned by the garage user, `unassigned_at` null (live).

**Service record** `16ad0880…` — `total_cost 250`, `currency ZIG` (ISO-4217 uppercase), correct VIN
and tenant, `performed_at` set.

**Mileage** — one observation, `91000`, `observation_source garage_stated` — recorded as an
observation, never written to a canonical odometer.

**O2** — the marketplace inquiry carries `target_provider_tenant_id = c970d768…`, with `seller_id`
and `seller_tenant_id` both **NULL**. Seller semantics were never overloaded for routing. A forged
tenant id was refused outright rather than recorded.

**O4** — all four events carry the correct deterministic key, in the exact format the application
derives:

```
service.case.requested:ae273895-…   service.case.accepted:ae273895-…
service.work.started:ae273895-…     service.case.completed:ae273895-…
```

Replay was then tested directly against the hosted database: a second
`service.case.accepted` insert for the same case raised **`unique_violation`**, and the row count
stayed at 1 before and after. **Replay does not duplicate durable effects.**

**O5** — the recipient contract holds exactly as designed. `service.case.accepted` carries
`recipientUserId = u_0d0ed7b23cab4b7c`, the case's requester; `service.case.requested` carries
**none**, because its audience is the garage tenant and Communications addresses a user. Both carry
the governed participants (`requesterUserId`, `garageTenantId`, `acceptedByUserId`) and neither
carries the private `request_summary`.

The O5 constraint was verified behaviourally: a `service_case` thread inserts successfully, while a
bogus thread type is still **rejected** — so the CHECK was extended, not dropped. Both probe rows
were deleted.

**O6** — the service link is active; two capability grants exist: one redeemed by the governed
grantee, one revoked and never redeemed.

## C.7 Communications — environment limitation, stated not worked around

The backend reports `communications: BLOCKED`. `COMMUNICATION_ENGINE_ENABLED` is not true and the
worker/provider settings are absent.

**No provider credential was added. No channel was enabled.** Nothing was changed to make this
section green.

What the Foundation contract requires was proven:

| Requirement | Evidence |
|---|---|
| Domain event emitted | 4 `service.*` events durably in `domain_events` |
| Governed recipient / context | `recipientUserId` = case requester on customer-facing transitions; participants carried; no private free text |
| Canonical outbox binding | events are in the canonical `domain_events` outbox with correct dedupe keys — no Service-Network-specific channel |
| Thread binding *where available* | the `service_case` thread type is accepted by the migrated schema; **fanout did not run** |
| Service truth survives Communications degradation | the case completed, the work order completed, the service record was written and owner history is correct — **all while Communications is BLOCKED** |

**What did not happen, stated plainly:** the four events remain `status = 'pending'` in the outbox
and **no thread or notification was produced for this case** (`threads_for_case = 0`). No delivery
is claimed. Enabling the canonical in-app engine is a separate environment decision.

This does not block any of the six journeys — all 36 assertions passed with Communications disabled,
which is itself the degradation guarantee.

## C.8 Final certification at `9c95e2a2`

> **SUPERSEDED BY D.5**, which certifies the deployed candidate at `90c57626` — the same runtime
> tree plus documentation — against an explicitly identified paired deployment.

| Gate | Result |
|---|---|
| Marketplace Reference Regression | **PASS** (pair governed; 205 tests + 7 Playwright vs deployed staging) |
| Service Network focused suite + migration integrity | **275 / 275** |
| Full backend (repo ROOT, CI env contract) | **6021 tests, 6000 pass, 0 fail, 21 skipped** |
| Migration integrity | **24 / 24** |
| Six real-PostgreSQL harnesses | **6 / 6** |
| Playwright desktop + mobile, against **deployed paired staging** | **6 / 6**, control case at each width |
| Hosted journeys | **36 / 36** |

Exact-head CI at `9c95e2a2` — **all eight workflows**:

| Workflow | Result |
|---|---|
| CI (Lint · Types · Build · Tests) | success |
| Marketplace Reference Regression | **success** |
| Vehicle Passport Foundation CI | success |
| Referral Engine CI | success |
| Navigation Intelligence CI | success |
| Diaspora Phases 3-7 Validation | success |
| Communication Command Center CI | success |
| Diaspora Deployed Staging UAT | skipped (by design) |

## C.9 Re-certification after the receipt commit

The rule is that any commit moving the branch re-runs exact-head certification. This receipt is
itself such a commit, so the head it describes cannot be the head it lives on. That is stated here
rather than papered over.

- **`9c95e2a2` is the certified CODE head.** Every gate, journey and database assertion above was
  performed against it, and the hosted deployments served it.
- **`46af9532` adds this receipt and nothing else** — one documentation file. It was re-certified in
  full, and both deployments rebuilt and re-verified at it:
  frontend `carup-provenance.json → commit_sha 46af9532…, unpaired false`,
  backend `/api/health → build.commit_sha 46af9532…` (`dpl_HVrcPopKGckyuadtWSWXehXsUoKD`).

All eight workflows at `46af9532`:

| Workflow | Result |
|---|---|
| CI | **success** — 6021 tests, 6000 pass, 0 fail, 21 skipped; "All 6 Service Network harnesses passed" |
| Marketplace Reference Regression | **success** — pair governed, backend reporting `46af9532` |
| Vehicle Passport Foundation CI | success |
| Referral Engine CI | success |
| Navigation Intelligence CI | success |
| Diaspora Phases 3-7 Validation | success |
| Communication Command Center CI | success |
| Diaspora Deployed Staging UAT | skipped (by design) |

Any commit after this one is documentation-only by construction; its CI result is reported to the
Product Owner directly, because a receipt cannot contain the outcome of its own commit.

## C.10 Scope

- **Production untouched.** No production migration, no production deployment, no production data.
- **`main` untouched** — still `bb9d9900`.
- **PR #197 remains Draft.**
- Only the approved staging project `eoyenigwevnxwwhyhaer` was migrated.
- No third-party provider credential was added and no communication channel was enabled.
- The historical `93b97a36` failed-reconciliation evidence in section A is unchanged, as is the
  record of the runtime guards it produced.

---

# D. Deployed-provenance closure — correction and re-certification

Section C contained a provenance inconsistency. It is corrected here rather than rewritten, because
how it happened is part of the record.

## D.1 The inconsistency

C.1 recorded the deployed pair as `c81e1e98` while naming `9c95e2a2` the certified code head. Those
cannot both describe the certified candidate, because **`c81e1e98` does not contain the pairing
registry entry** and `web/vite.config.ts` reads that registry **at build time**.

Verified, not assumed:

```
git show c81e1e98:web/preview-backend-pairing.json  | grep -c service-network-foundation-1-0  → 0
git show c81e1e98:web/preview-frontend-pairing.json | grep -c service-network-foundation-1-0  → 0
git diff --name-only c81e1e98 9c95e2a2  → web/preview-backend-pairing.json
                                          web/preview-frontend-pairing.json
```

So a frontend built from `c81e1e98` was necessarily unpaired and could not prove that the paired
build works. **C.1's table describes the pre-pairing verification step required by the brief, not
the certified candidate.** Reporting it as the certified pair was wrong, and this section supersedes
it.

What was *not* wrong: the journeys in C.5 were executed after the pairing commit, against a
build that reported `unpaired: false`. The defect was in the reporting, not in the run. This section
re-runs everything against an explicitly identified paired candidate anyway, so the claim rests on
evidence gathered under the corrected understanding rather than on that argument.

## D.2 The provenance chain, stated

| SHA | What it is | Frontend pairing at that SHA |
|---|---|---|
| `c81e1e98` | first branch deployments | **absent** — build baked `unpaired-preview.carup.invalid`, could reach no backend |
| `9c95e2a2` | pairing registry added (**the only runtime change**) | present |
| `90c57626` | docs-only final head | present |

`git diff --name-only 9c95e2a2 90c57626` → one file, `docs/…/POST_194_RECONCILIATION_AND_FINAL_CERTIFICATION.md`.
**No runtime file changed after `9c95e2a2`**, so `90c57626` is a valid certification candidate.

## D.3 The deployed exact candidate

Read from Vercel deployment metadata, not inferred from aliases.

| Side | Deployment ID | Immutable URL | Commit SHA | State |
|---|---|---|---|---|
| Frontend | `dpl_FwMegxi4kE7qhDRrf22NCxzRugDo` | `https://carup-staging-ex3y9dsvu-11-11.vercel.app` | `90c57626…` | READY |
| Backend | `dpl_FgJXXGLaT8Tw8Xme2SnyH2YYcxrm` | `https://carup-backend-staging-i2wf80soc-11-11.vercel.app` | `90c57626…` | READY |

Corroborated independently:

- frontend `/carup-provenance.json` → `commit_sha 90c57626…`, `unpaired false`,
  `api_base_source: "paired from preview-backend-pairing.json"`;
- backend `/api/health` → `build.commit_sha 90c57626…`, and it self-reports
  `deployment_id dpl_FgJXXGLaT8Tw8Xme2SnyH2YYcxrm`, matching Vercel.

**Served bundle:** `/assets/index-DXJ-nV1q.js`, 2,804,914 bytes,
sha256 `9a689163544d28f27f5e9d981916c2db5891187a4d829ac5a2f65ec31aa63de9`.

## D.4 Pairing proved from the bundle, not the registry

The bundle contains five host literals, including the shared staging backend and the invalid host.
Their presence is not a defect — they are the resolver's constants. What matters is which one this
build can select:

```js
const Oq = <production api>, vre = "https://carup-backend-staging.vercel.app/api",
      Pq = "https://unpaired-preview.carup.invalid/api";
function pr(t, a) {              // t = build-time configured base, a = hostname
  const s = t?.trim();
  return s ? wre(s)              // ← a non-empty configured base SHORT-CIRCUITS everything
       : a && jre.includes(a) ? "/api"
       : Dq(a) ? vre             // shared staging
       : Iq(a) ? Pq              // branch preview with NO configured base → invalid host
       : Oq;                     // production
}
```

**All 17 resolver call sites pass the Service Network branch backend as `t`** — 15 as an inline
literal, 2 via a local assigned that same literal, each verified individually. Because `t` is always
non-empty, the `vre`, `Pq` and `Oq` branches are unreachable in this build. `Pq`'s only other
reference is the provenance banner that *detects* an unpaired build and sets `blocksUat: true`; it
does not fire, because `apiBaseUrl !== Pq`.

Had the registry entry been missing, this build's own hostname (`carup-staging-…vercel.app`)
satisfies `Iq`, so it would have resolved to the invalid host — which is exactly what `c81e1e98`
did.

**Runtime confirmation.** The deployed candidate was driven in Chromium across `/`, `/garages`,
`/garages/:slug`, `/marketplace` and `/dealers`, recording every request:

| Origin | Requests |
|---|---|
| Service Network branch backend (paired) | **27** |
| the frontend deployment itself (assets) | 15 |
| `fonts.googleapis.com` / `fonts.gstatic.com` | 10 |
| `eoyenigwevnxwwhyhaer.supabase.co` (the approved staging project) | 2 |

**Forbidden-origin violations: NONE.** Zero requests to the shared staging backend, the main
backend, production (`api.carup.dev` / `carup.dev`) or `carup.invalid`. Observed calls include
`GET <paired-be>/api/garage-directory`, so the Service Network surface is genuinely being served
through the paired backend.

## D.5 Hosted certification re-run on this candidate

| Gate | Result |
|---|---|
| Marketplace Reference Regression @ `90c57626` | **success** — pair governed, backend reporting `90c57626` |
| Service Network deployed Playwright, against `dpl_FwMegxi4kE7qhDRrf22NCxzRugDo` | **6 / 6** — desktop + mobile, control case at each width |
| Six hosted journeys, run `snf014553`, against `dpl_FgJXXGLaT8Tw8Xme2SnyH2YYcxrm` | **36 / 36** |
| Exact-head CI @ `90c57626` | **8 / 8** (one skipped by design) |

The journey run is newly scoped — its own tenant `cf717f62…`, four fresh accounts, VIN
`SNFINAL014553VIN1`, slug `sn-cert-snf014553` — so no earlier certification could supply its state.
It covers garage directory, case lifecycle, mechanic assignment, work-order linkage, completion,
service record, provider targeting and degraded Communications, with refusals asserted alongside
successes.

## D.6 Database — verified, not reapplied

No migration was reapplied. The schema was re-read:

| Check | Result |
|---|---|
| Service Network tables | **11 / 11** |
| S4 columns on `mechanic_work_orders` | **7 / 7** |
| Key constraints | **4 / 4** |
| RLS enabled **and** forced | **11 / 11** |
| Service Network migrations in the ledger | **8 / 8** |
| S3 column · O4 branch · O5 thread type | present · present · present |

**Binding re-proved at the immutable deployment**: `/api/health` reported `outboxBacklog: 297` and
the database reported exactly **297** pending `domain_events`.

Fresh run `snf014553` wrote every expected consequence:

- **case history** — `requested → accepted → active (service.work.started) → completed`, append-only, in order;
- **work-order link** — `service_case_id = 10b61d47…`, `status Completed`, `completed_at` set;
- **assignment** — mechanic `u_3078db18…`, assigned by the garage user, live;
- **cost + currency** — `250 ZIG` (ISO-4217 uppercase), never a bare zero;
- **mileage observation** — `91000`, `garage_stated`, an observation and not a canonical odometer write;
- **provider tenant target** — `target_provider_tenant_id = cf717f62…` with `seller_id` and `seller_tenant_id` both **NULL**;
- **`service.*` dedupe events** — all four, keyed `<eventType>:<serviceCaseId>`.

**Replay re-proved on the fresh case:** a duplicate `service.case.accepted` insert raised
`unique_violation`; the row count was **1 before and 1 after**.

## D.7 Communications — degraded mode reconfirmed

Unchanged and deliberately so. **No credential added, no provider enabled, no delivery claimed.**

| Property | Observed |
|---|---|
| Service truth completes | case completed, work order completed, record written, owner history correct |
| Outbox events durable | 4 `service.*` rows persisted |
| Correct dedupe keys | all four, exact format |
| Correct recipient semantics | `service.case.accepted` → `recipientUserId = u_8665a9e7…` (the requester); `service.case.requested` → **none**, its audience being a tenant |
| No private free-text leakage | `private_summary_leaked = false` — the request summary appears in no event payload |
| Delivery | **`events_pending = 4`, `threads_for_case = 0`** |

The engine remains `BLOCKED` (`COMMUNICATION_ENGINE_ENABLED` not true, worker secret absent). This
is an external-delivery limitation of the staging environment. It corrupts nothing in the Foundation
contract, and the degradation guarantee is itself evidence: all 36 journey assertions passed with
Communications down.

## D.8 What supersedes what

- **C.1's deployment table is superseded by D.3.** C.1 remains as the record of the pre-pairing
  verification the brief asked for.
- **C.8's "certified at `9c95e2a2`" is superseded by D.5**, which certifies the deployed candidate at
  `90c57626` — the same runtime tree, plus documentation.
- Sections A and B are untouched. A is byte-identical; the `93b97a36` failed-reconciliation evidence
  and the runtime guards it produced remain exactly as recorded.

Production untouched. `main` untouched at `bb9d9900`. PR #197 remains **Draft**.
