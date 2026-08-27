# I2 — First-Party Governed Activity Ledger

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Implements:** `I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md` §3–§6 (envelope, taxonomy, identity, exclusions, privacy, retention/erasure)
**Status:** complete — source implemented, staging migration applied, guarantees proven against the live database.

---

## What shipped

| Artefact | Path |
|---|---|
| Migration | `database/migrations/20260827120000_intelligence_activity_ledger.sql` |
| Taxonomy constants | `backend/services/intelligence/activityEventTypes.js` |
| Ingestion service | `backend/services/intelligence/activityLedgerService.js` |
| API routes | `backend/routes/intelligenceActivityRoutes.js` |
| Server wiring | `backend/server.js` (import + `app.use`) |
| Tests | `backend/tests/intelligence-activity-ledger.test.js` (34 tests) |

Two tables: `marketplace_activity_events` (the ledger) and `intelligence_ingestion_stats` (per-hour ingestion counters). Two SECURITY DEFINER functions: `intelligence_purge_activity_events(cutoff)` and `intelligence_erase_actor(user_id)`.

Two endpoints: `POST /api/intelligence/activity` (public, bounded, `optionalAuth`, 202 with counts only) and `GET /api/admin/intelligence/ingestion-health` (admin).

---

## The four invariants, and how each is enforced

**1. Observation, not authority.** The ledger records that an action occurred; it never becomes the business fact. Server-emitted events are written beside their domain write and keyed on that write's authority row id or post-commit timestamp, so the ledger can be *reconciled against* the authority instead of believed. `saved_vehicles`, `marketplace_inquiries`, Communications, `vehicles.publication_status`/`status`, `escrow_trust_sessions`/`vehicle_reservations` and the trust services remain authoritative.

**2. The client never asserts privilege.** `authenticated_user_id` comes from the session; `tenant_id`/`organization_id` come from the event's **object** (the listing's owning tenant), never from the caller's headers. A client-supplied value for any of them is dropped rather than trusted. Client submissions naming a server-emitted type (`marketplace_listing_saved`, `_sold`, `_reservation_completed`, …) are rejected with a distinct reason — a caller must not be able to manufacture a save or a sale that no authority recorded. An event on an unknown object is rejected rather than stored with a guessed scope.

**3. Duplicates cannot inflate a metric.** Every event carries a server-computed `idempotency_key` behind a UNIQUE index. A replayed batch collides in the *database*, not in a best-effort in-process window that a restart would forget — and the collision is **counted**, not silently swallowed.

**4. Analytics never blocks UX, and loss is never silent.** Ingestion resolves even when storage fails; failures increment observability counters. `GET .../ingestion-health` returns `available: false` with "These are NOT zero" rather than zeros when counters cannot be read — the I1 §8 no-fake-zeros contract applied to the ledger's own health.

Additional governance shipped with the ledger rather than after it (I0 found *zero* retention jobs across every existing event table — this programme does not repeat that omission): 24-month retention with a purge function that **refuses a cutoff inside the retention window**, and an erasure function that tombstones identity while preserving the behavioural row so historical aggregates stay reconcilable.

---

## Evidence

### Automated tests — 34/34 pass
`backend/tests/intelligence-activity-ledger.test.js` covers: taxonomy equality across service constants and the DB CHECK; every type having exactly one emitter, a privacy class and a metadata allowlist; reserved names rejected distinctly from unknown ones; G10 lifecycle events staying reserved; client-forged server events rejected end-to-end; server-derived identity/scope with hostile client claims present; anonymous handling; unknown-object rejection; in-batch and cross-batch duplicate collapse; page-view view semantics; metadata allowlist dropping smuggled email/phone/free-text; enum rejection; share-resolution distinction; clock-skew vs late-event discipline; self-traffic (owner and tenant); bot flagging; unauthorized synthetic declaration refused; server-event authority-material requirement; emitter non-overlap; replay produces one key; storage-failure posture; **route mounted in server.js**; migration governance (RLS forced, zero policies, no client grants, unique index, retention/erasure present, every SECURITY DEFINER pins search_path, no existing table weakened).

### Full backend regression — 4,386 tests, 0 failures
Run under the exact `ci.yml` env contract (`NODE_ENV=test`, placeholder Supabase/JWT vars). 4,365 pass, 21 pre-existing skips, **0 fail**.

### Migration harness — PASS
`node database/test/migration_pglite_check.mjs` against real PostgreSQL via PGlite: `overall: PASS`, empty `prereq_failures`/`up_failures`/`down_failures`/`reup_failures` (exit 0).

### Live staging database proof
Migration applied to staging as `intelligence_activity_ledger`. Queried afterwards:

| Check | Live result |
|---|---|
| Grants to `anon`/`authenticated`/`PUBLIC` | `(none)` |
| RLS | `rls_enabled=true forced=true policies=0` |
| Duplicate suppression | `CREATE UNIQUE INDEX uq_mae_idempotency_key … (idempotency_key)` present |
| `intelligence_erase_actor` | `secdef=true cfg=search_path=public, pg_temp` |
| `intelligence_purge_activity_events` | `secdef=true cfg=search_path=public, pg_temp` |

Behavioural proof executed against the live table (each must fail; all did):

| Behaviour | Result |
|---|---|
| Second insert of the same `idempotency_key` | PASS — rejected by unique violation |
| Reserved type `marketplace_listing_paused` | PASS — rejected by CHECK |
| Anonymous row carrying an identity | PASS — rejected by actor-coherence CHECK |
| `occurred_at` in the future | PASS — rejected by CHECK |
| Purge with a cutoff inside retention | PASS — "refusing to purge inside the 24-month retention window" |
| Erasure of an actor | PASS — row survives, identity and session key gone, `identity_erased_at` set |

Proof rows were deleted afterwards; the ledger is at **0 rows** — a clean baseline for I3 instrumentation and I19 controlled-count certification.

---

## Deliberate limitations (declared, not hidden)

- **`opened_without_context`:** `marketplace_listing_opened` is server-emitted but keyed on client-minted session/page-view context. A crawler, `curl`, or an API consumer sending neither produces **no event** and increments a counter — an honest, bounded, observable undercount rather than a collapsed all-in-one key.
- **Cross-device journeys** undercount conversions (funnel linking is device-scoped by `link_key`), per I1 §5.2.
- **`_unsaved` has no backfill path:** a delete leaves no authority row, so a missed unsave event stays missed and is visible only in the loss counters. Stated in the contract rather than papered over with a sweep that cannot work.
- **Bot heuristic is conservative and versioned** (`BOT_HEURISTIC_VERSION = 1`); it flags rather than rejects, so a false positive costs a rollup exclusion, never a lost event.
- **The ledger is empty and unwired to product surfaces.** I2 built the store and the door; I3 wires the emitters. No metric may be displayed from this ledger until I4 rollups and I5 projections exist.

## Gap register movement

| Gap | Status |
|---|---|
| G13 (retention/erasure must ship with I2) | **CLOSED** — purge + erasure functions shipped and proven live |
| G10 (`paused`/`archived` domain states absent) | still open by design — events remain reserved; the test suite pins them as reserved so a later phase cannot quietly emit them |
| G11 (no production settlement state) | still open — gates production certification of `sales@1` |
| G1 (unauthenticated `POST /api/referrals/events`) | still open — gates attributed metrics; the new ledger deliberately does **not** depend on the referral stream for view/demand data |

---

## I2 gate statement

The contract's exit conditions for this phase — server-side derivation of privileged dimensions, schema versioning, idempotency, dedupe, privacy, bot/test exclusions, retention, RLS/access boundaries, indexes, and fail-safe behaviour — are implemented, tested, and proven against the live staging database. No cross-tenant leak is possible by construction (scope follows the object, clients cannot assert it); no fabricated authority is possible (client-submitted business events are rejected).

**I2 is complete. The programme continues into I3 (marketplace instrumentation, web and mobile).**
