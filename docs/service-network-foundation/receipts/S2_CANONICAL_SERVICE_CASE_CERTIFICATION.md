# S2 — Canonical Service Case Foundation — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

## 1. What S2 builds

The canonical Service Case: the durable orchestration record for one service engagement
(plan §6.1, §6.2, §7, S2).

**Schema** — `20260904130000_service_network_s2_service_cases.sql`:
- `service_cases` — every S0-frozen semantic field; FKs to `vehicles(vin)`, `tenants(id)`,
  `garage_branches(id)`, `users(id)`; `status` CHECK over exactly the frozen six states;
  separate server-stamped lifecycle timestamps (`requested_at`, `accepted_at`, `declined_at`,
  `started_at`, `completed_at`, `cancelled_at`) so completion time is never derived from
  `updated_at` (plan §24.5).
- `service_case_events` — append-only transition history with a trigger that **refuses UPDATE
  and DELETE** at the database, so no future code path can quietly rewrite recorded history
  (Invariant 12).
- **The idempotent marketplace bridge** (plan §10.3) is a partial `UNIQUE INDEX` on
  `source_inquiry_id WHERE NOT NULL`: a retry loses the insert race (23505) instead of opening
  a second case, while the many cases with no inquiry origin coexist (NULLs distinct).
- RLS posture per the S0 template: `ENABLE` + `FORCE`, zero policies, clients revoked
  (table **and** the events sequence), `service_role` granted.

**Service** — `backend/services/serviceNetwork/serviceCaseService.js`: the lifecycle state
machine, tenant-safe authorization, append-only history, and canonical event emission.

**Routes** — `backend/routes/serviceCaseRoutes.js`, mounted in `server.js`. No public Service
Case surface exists; every endpoint is session-authenticated.

## 2. Authority decisions honoured

| S0 / plan rule | How S2 satisfies it |
|---|---|
| The case orchestrates, it does not replace authorities (Invariant 2) | Vehicle referenced by FK, never copied; conversation carried only as `conversation_thread_id`; no work-order row is written (S4 owns that); no Passport write |
| Service activity is not Trust (Invariant 4) | Completion stamps a timestamp and emits an event — a test asserts the vehicle row (incl. `trust_score`) is byte-identical after a full lifecycle |
| Terminal states remain historical (§7.6/§7.7, Invariant 12) | `completed`/`declined`/`cancelled` have **no** outgoing transitions; history is append-only by DB trigger; cancellation is a state, never a delete |
| Idempotent bridge (§10.3) | DB partial unique index + insert-and-lose-the-race handling; a retry returns the same case with `created:false` |
| One canonical event namespace (§8) | `service.case.requested/accepted/declined/cancelled/completed` and `service.work.started`, dot-lowercase, on the existing `domain_events` outbox — no service-specific channel (Invariant 6) |
| Event payloads carry no private text (§8) | Payloads carry identifiers + status + `occurredAt` only; a test asserts the private `request_summary` never reaches an event |
| Communications failure must not erase the case (§15.5) | Emission failure is caught and reported as `notification.emitted:false`; the case stands |
| Tenant isolation is app-level | Every garage action verifies `garage_tenant_id === verified tenantId`; a foreign tenant reads **404, not 403**, so the API is not an existence oracle |
| Requests route only to a real, offered garage | Creation verifies a **published** `garage_public_profiles` row |
| Closed vocabularies | Status, source channel, service category, decline and cancellation reason codes are all validated allow-lists |

Concurrency: each transition guards on the observed status inside the `UPDATE` predicate, so a
racing writer loses with a conflict rather than both "succeeding".

## 3. Verification — commands and results

Environment: exact `ci.yml` contract.

| Gate | Command | Result |
|---|---|---|
| S2 migration proof (real PostgreSQL) | `node database/test/service_network_s2_check.mjs` | **PASS** — RLS posture incl. sequence grants, FK rejection for unknown VIN/tenant, CHECK refusing states outside the frozen six, 23505 on inquiry retry (and on a *different* garage re-consuming the same inquiry), NULL origins coexisting, append-only UPDATE/DELETE refusal, Down/re-Up |
| S2 authority contracts | `node --test backend/tests/service-network-s2-service-case.test.js` | **PASS** — 18/18 |
| S2 combined (incl. CI wrapper) | `node --test backend/tests/service-network-s2*.test.js` | **PASS** — 19/19 |
| Full backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4386 tests, **4365 pass, 0 fail**, 21 skipped (S1 baseline 4367 → +19 new, zero regressions) |

The migration proof is wired into CI via
`backend/tests/service-network-s2-service-case-migration.test.js` (wrapper-test pattern), and
`mockSupabase.UNIQUE_INDEXES` now registers `service_cases.source_inquiry_id` so the bridge's
race is modelled in the in-memory suite too.

## 4. Notable engineering decision

`emitDomainEvent` resolves through `deps.emitDomainEvent || emitDomainEvent` — the
`marketplaceInquiryService` idiom. The production default is the real outbox writer, and a
dedicated test asserts the module imports the real emitter and uses that fallback, so an
injected-collaborator test cannot pass while the production path is dead by construction.

## 5. Deliberately NOT in S2

Work-order creation/linking and mechanic assignment (S4), service records/parts/evidence (S5),
Passport projection (S6), Intelligence instrumentation (S7), Service Link/QR (S8), Communications
thread binding and the `business_workflow='service'` registration (S3), and any owner/garage UI
for cases (S9). `conversation_thread_id` exists and stays NULL until S3 binds it.

## 6. `[#194-sensitive]` items for the rebase

- Service event types must be registered in #194's `DETERMINISTIC_EVENT_IDENTITY_FIELDS` and the
  DB dedupe trigger **in lockstep** before any service event is made deduplicatable.
- `communication-event-coverage.test.js` (modified by #194) will require each notification-feeding
  `service.*` event to have a mapped emitter when S3 subscribes them.
- `backend/server.js` router mounting remains a known rebase hotspot.

**S2 is complete and green. S3 (Marketplace and Communications Convergence) is next.**
