# Service Network Foundation 1.0 — Post-#194 Reconciliation and Final Certification

**Verdict: NOT FINISHED.**

Audit performed read-only at PR #197 head `93b97a361cc00df3f7b912385a7f125de0015ea5`.
No commit, no push, no merge, no migration applied, no production or staging mutation.
PR #197 remains **Draft**.

---

## 1. State established (before any testing)

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

## 2. Findings

### R1 — P0. The merge silently unmounted the entire Service Network backend.

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

### R2 — P0. S6's governed owner projection was reverted to main's raw query.

`/api/service-history/me` still exists, but at HEAD it is **main's pre-#197 implementation**:
a direct `select('*')` over `mechanic_work_orders`, returning raw rows. #197 had replaced it
with `getOwnerServiceHistory(...)` — the governed owner projection that states a fact or
reports it absent. That delegation is gone, so S6 currently contributes nothing at runtime.

### R3 — P0. `web/src/App.tsx` lost the public garage profile route.

Also reverted to main. `GarageDetail` and its `/garages/:slug` route are gone;
`web/src/pages/GarageDetail.tsx` remains on disk with **zero importers** — an orphaned page.
(`/garages`, `/dashboard/garage`, `ServiceHistory` and `CustomerRecords` routes survive only
because they already existed on `main`.)

### R4 — P1. CI is red at the exact head, and the merge caused it.

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
#197's `20260901120000_service_network_s1_garage_identity.sql`. Five duplicate prefixes already
exist in the repo as a grandfathered baseline; this guard is baseline-aware and fails only on
**new** collisions. The five sibling workflows (Referral, Navigation Intelligence, Diaspora 3-7,
Communication Command Center) are green at this head; Diaspora Deployed Staging UAT skipped.

### R5 — P1. #197's test suite is structurally incapable of detecting R1.

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

### R6 — P1. #197's six PGlite migration checks are wired into no gate.

`database/test/service_network_s{1,2,3,4,5,8}_check.mjs` are referenced by **0** workflow files,
and `migration_pglite_check.mjs`'s `NEW_MIGRATIONS` list ends at `20260810120000`. ci.yml's own
comment names this trap:

> *"a migration added after that date is otherwise executed by NO gate in this repo
> (migration-integrity.test.js only parses the file and checks its markers)"*

#197's six migrations are therefore never executed against real Postgres by CI.

---

## 3. O1–O10 obligation roll call at `93b97a36`

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

## 4. Auth surface of the 34 unmounted endpoints

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

## 5. What was not run, and why

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

## 6. Required to reach FINISHED

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
