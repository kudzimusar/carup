# S0 — Live Reconciliation and Authority Freeze

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Implementation base:** `main` @ `ba208963d863654157335189c60f587cbe330041` (pre-#194, by explicit owner override — see PRE_S0 receipt §1)
- **Evidence base:** `PRE_S0_DEPENDENCY_RECONNAISSANCE.md` (14 domains, committed at `1c913db5`), baseline fully green (4352 backend tests / 0 fail)
- **Rebase obligation:** when PR #194/successor merges, rebase this branch onto new `main`, re-run every `[#194-sensitive]` item below, and re-verify this freeze before S10 certification.

## 1. Frozen authority matrix (plan §5 instantiated against real code)

| Question | Canonical authority — exact location |
|---|---|
| What vehicle is this? | `vehicles` (canonical VIN); public projection ONLY via `backend/utils/publicVehicleProjection.js` (no fourth allow-list — pinned by issue164-phase1-read-contract.test.js) |
| Who owns the vehicle? | `vehicles.owner_id` + `vehicle_ownership_history`; `[#194-sensitive]` #194's transfer authority becomes the only ownership writer — Service Network adds **no** ownership writer |
| Who is current seller? | `vehicles.current_seller_id` (transaction authorities read it, never owner_id) — never conflated with service requester |
| Where did the service lead originate? | `marketplace_inquiries` (inquiry_type `garage_service_request`) + source attribution fields — Marketplace owns acquisition intent (Invariant 8) |
| Which garage is targeted? | **NEW** Service Case authority (`service_cases.garage_tenant_id`) + additive inquiry bridge (§4.3) — never `seller_id` overload (plan §10.2) |
| Which garage accepted? | **NEW** `service_cases` state machine |
| Who may act for the garage? | `tenants`/`tenant_users` membership via `authorizeRole` + per-request membership verification (`backend/middleware/authMiddleware.js`) — the legacy `organizations/*` universe is NOT extended |
| Which mechanic performed/assigned? | **NEW** `work_order_assignments` (durable history); `mechanic_work_orders.mechanic_id` stops being final authority (creator-conflation removed as authority, column kept for compatibility) |
| Work-order state? | `mechanic_work_orders` evolved **additively** (§4.2); DB CHECK vocabulary preserved |
| What was said? | Communications 2.0 threads (`message_threads`, business_workflow=`service`, subject_type=`service_case`) — no service messages silo (Invariant 6) |
| Email/WhatsApp/push sent? | Communications delivery authority (notification_queue + adapters) — never direct adapter imports from service routes |
| What evidence exists? | Evidence authority (`vehicle_evidence` + `evidenceTaxonomy.js`) — taxonomy extended in lockstep module+seed-migration |
| What part was recorded? | `partsentry_logs` via `partsentryService.addRepairLog` — Service Records link to it, never re-implement |
| Mileage observed during service? | Recorded as service observation; `vehicles.mileage` keeps its ONE existing writer (`partsentryService.addRepairLog:51`, test-pinned) — **Service Network adds no second canonical-mileage writer** (S0 adjudication of plan fact #8) |
| What appears in history? | Passport projection — on main: inline `server.js` + `trustGraphService` timeline; `[#194-sensitive]` #194 formalizes `passportServicePartsProjection.js`/`passportLifecycleTimeline` as V8 modules → Service Network extends those after rebase, never forks a third timeline (Invariant 9) |
| Fact verified/trusted? | `canonicalTrustService` (getCanonicalTrust/Batch/toPublicTrust) ONLY; `refreshCanonicalTrust` the only writer; **no service-activity trust input exists or is added** (Invariant 4) |
| What can be measured? | Intelligence projection; `[#194-sensitive]` I9 `serviceIntelligenceService` NOT_MEASURABLE registry reconciled at rebase (plan §19.3) |
| What did a QR identify? | **NEW** Service Link resolver (S8) — opaque, hashed-if-bearer, sibling table to `auth_action_tokens` reusing the SA1C pattern (its purpose CHECK is closed — never widened) |
| Permission to act? | Auth/tenant/capability authority (`authorizeRole` factories; `optionalAuth` IS a factory; its x-tenant-id passthrough is UNVERIFIED — never authorization) |
| Device/session context? | Existing session context where governed; device context recorded **absent** when ungoverned (no fabrication) |

**Duplicate-authority verdicts (gate item):** no unresolved duplicates remain. The four candidate collisions found — (a) tenants vs organizations universes → **tenants wins**, legacy universe untouched; (b) creator-as-mechanic vs assignment → **assignment table wins**, column preserved; (c) `trustGraphService` deprecated engine (+5 service-count hazard at ~:377) → **never imported by Service Network**; (d) marketplace inquiry status pipeline vs case lifecycle → **separate vocabularies, one-way bridge** (§4.3).

## 2. Frozen state vocabulary

- **Service Case** (new, lowercase): `requested | accepted | active | completed | declined | cancelled`
- **Work order** (existing DB CHECK, unchanged): `'In Progress' | 'Completed' | 'Cancelled'` — Title-Case preserved; server-side transition guard added (terminal states immutable, plan §7.6/Invariant 12) without mutating the CHECK; web keeps its lowercase display normalization
- **Provenance** (plan §6.6): `owner_declared | garage_stated | mechanic_attributed | professional_governed | evidence_backed | partner_record | unknown` — `[#194-sensitive]` a strict superset of #194's frozen `SERVICE_AUTHORITIES` {professional_governed, owner_declared, partner_record, unknown}: extends, never forks
- Case states never written into `marketplace_inquiries.status` (lead pipeline) or `vehicles.status` (marketplace visibility vocabulary)

## 3. Frozen event vocabulary (plan §8 against real outbox)

- Transport: `domain_events` outbox via `emitDomainEvent(pgClient, …)` app-side or `INSERT INTO domain_events` inside SECURITY DEFINER RPCs (transactional emit — both patterns proven); consumed via `eventWorker.subscribe` + a new `registerServiceNetworkListeners` in `server.js` (never a second poller)
- Namespace: **dot-lowercase** `service.case.requested/accepted/declined/cancelled/completed`, `service.work_order.created`, `service.mechanic.assigned/unassigned`, `service.mileage.observed`, `service.part.recorded`, `service.evidence.attached`, `service.work.started/completed/cancelled` — matches `marketplace.inquiry.created` convention; the SCREAMING_SNAKE RPC style is legacy and not mirrored
- Envelope: identifiers in JSON payload per existing convention (`occurred_at` payload-carried; dormant aggregate/correlation columns NOT unilaterally adopted); no PII/free text in payloads (referral minimization precedent 20260716033000)
- Idempotency: deduplicatable events registered BOTH in the DB dedupe trigger and `[#194-sensitive]` `DETERMINISTIC_EVENT_IDENTITY_FIELDS` (post-rebase), with a parity test per the email-hardening-c3 pattern; consumers idempotent (notification_queue.dedupe_key; processed-events ledger pattern where projecting)
- Every notification-feeding event added to `COMMUNICATION_EVENT_TYPES` **with a real emitter** in the same change (communication-event-coverage.test.js gate)

## 4. Frozen Foundation schema delta (all additive; timestamps ≥ `20260901…` to stay strictly after the #194 lane incl. its in-flight `20260829040000`)

**4.1 New tables** (every one: ENABLE+FORCE RLS, REVOKE anon/authenticated/PUBLIC, GRANT service_role — the #194 template; service-role-only because RLS is NOT the runtime boundary, app-level `.eq('tenant_id', verified)` is):
- `garage_public_profiles` — governed publication projection keyed `tenant_id UUID FK tenants` (publication state draft|published|unpublished, public display name, location, contact policy, service categories, verification dimensions, public-safe media refs). Sibling projection — `tenants` itself not widened. No ratings, no invented hours (plan §6.5).
- `garage_branches` — branch model for the ACTIVE tenants universe (tenant_id UUID FK; legacy `organization_branches`/`dealer_branches` are wrong-keyed and untouched); all branch references nullable everywhere (plan §9.4).
- `service_cases` — plan §6.1 fields; `garage_tenant_id UUID FK tenants`, `vin FK vehicles`, requester_user_id, nullable branch_id/source_inquiry_id/conversation_thread_id, lifecycle timestamps (server-generated), `status` frozen §2. Structural template: #194's `20260828203000` (state machine + append-only events + atomic RPCs + partial unique indexes).
- `service_case_events` — append-only per-case history.
- `work_order_assignments` — durable assignment history (work_order_id, mechanic_user_id, assigned_by, assigned_at, unassigned_at, reason).
- `service_case_inquiry_links` — idempotent bridge, `inquiry_id UNIQUE` (plan §10.3).
- (S8) `service_links` — resource-link resolver records; bearer secrets hashed (SA1C pattern; report share-token plaintext precedent is NOT compliant and not copied).

**4.2 Additive columns:** `mechanic_work_orders` + `service_case_id`, `branch_id` (nullable), `service_category` (structured, nullable), `completed_at`, `cancelled_at`, `cancellation_reason`, `currency` (no USD assumption; absent cost never rendered 0) — convergence-migration style (20260808150000); no renames, no repurposing (three #194 consumers select existing columns). `marketplace_inquiries` + `target_provider_tenant_id UUID` (nullable) — the smallest truthful §10.2 bridge; `seller_id` semantics untouched.

**4.3 Explicitly NOT in the Foundation delta:** no `vehicles` columns; no ownership/seller writers; no trust columns/writers; no changes to `tenants`/`organizations`; no second work-order/messages/timeline/outbox tables; no mutation of any DB CHECK; no edits to provenance-pinned or retired migrations; no production migrations (staging-only until owner promotion, plan §35).

**Schema-shape gate:** every migration is authored only against shapes verified in the PRE_S0 receipt and proven by a dedicated PGlite harness wired into CI via the #194 wrapper-test pattern (no unwired harnesses); `mockSupabase.UNIQUE_INDEXES` extended for every new unique constraint.

## 5. Frozen integration seams

- **Communications:** `business_workflow='service'` added to `WORKFLOW_THREAD_TYPES` + stakeholder contract (roles: vehicle_owner, garage, mechanic, governance) + `emailStakeholderMatrix` row (matrix test enforces); `thread_type` stays `'general'`; `subject_type='service_case'` frozen (single spelling — thread dedupe forks otherwise); notifications channel-scoped **in_app/transactional-first** (recipient-address enrichment gap is real; email/WhatsApp/push after rebase onto #194's recipientResolution); WhatsApp requires a Meta-approved template — none exists, none sent (plan §35); **REAL-SEND HAZARD** honored: staging pg_cron drains with real adapters — tests never enqueue against staging Postgres, `COMMUNICATION_REAL_ADAPTERS` stays unset. Communications failure never rolls back a Service Case (§15.5 — recoverable receipt pattern).
- **Marketplace:** inquiry vocabulary reused; bridge is consume-only (inquiry → case via §4.1 link table); no idempotency exists on inquiry POST — case creation dedupes on `inquiry_id UNIQUE`; `[#194-sensitive]` #194 intelligence reading `seller_*` as provider-target conflicts with §10.2 — reconciled at rebase per §19.3; `mechanic_service_request` type exists only in #194 code, not in DB CHECK — not adopted in Foundation.
- **Trust:** display-only via `canonicalTrustService`; directory lists use cache-only `getCanonicalTrustBatch`; most prod vehicles show `not_evaluated` by design (351 unstamped); no `vehicles` inserts from Service Network (DEFAULT 80.0 hazard); no wording that reintroduces deleted "certified garage/mechanic" claims (mockData.ts garage strings never reused).
- **Passport/Evidence:** service records project through existing authorities; evidence classes extended module+seed lockstep; public projections pass `publicVehicleProjection`; costs/free text/customer identity never public (existing allow-list discipline).
- **Intelligence:** observes only; service metrics land post-rebase against #194's ledger (CHECK-constrained enum + 3-way pinned taxonomy) — S7 defers instrumentation wiring to the rebased registry; I9 NOT_MEASURABLE reconciliation is a rebase-time deliverable (§19.3, incl. the cancellation contradiction of plan fact #6).
- **API namespace:** `/api/service-cases/*`, `/api/garage-directory/*` (public read), garage-side under session-verified tenant scope; `/api/garage/*` analytics namespace (#194) and `/dashboard/garage` (owner My Garage) are NOT reused; feature id `product.garages` + route `/garages` are taken over, not duplicated. Consequential writes: `authorizeSessionRole`-style session-only + mandatory `x-idempotency-key` (#194 transfer-route precedent).
- **Unauthenticated org endpoints** (`/api/organizations/:id/branches`, `/:id/users` — leak staff emails on main; #194 hardens them): the S1 directory is built on the NEW governed projection, never on these; `[#194-sensitive]` their hardening arrives via rebase.

## 6. Legacy compatibility obligations

1. Legacy `mechanic_work_orders` rows (both historical shapes; lowercase legacy status strings) remain readable everywhere new columns are consumed (all nullable).
2. `/api/service-history/me`, trustGraph `workorder:` timeline entries, and mechanic dashboard continue to work against evolved schema (three simultaneous consumers).
3. `partsentry_logs` rows without case/work-order linkage stay first-class in projections.
4. `garage_service_request` inquiries created before the bridge (NULL target tenant) remain valid leads; no backfill fabricates targeting.
5. Existing `garage` communications workflow rows and `garage_booking_confirmation` template family remain untouched; `service` workflow is additive and reconciled, not a rename.
6. Owner-surface truth debt (hard-coded "Next Service 500 km", `$0` for absent cost, bare "Garage" label, CustomerRecords demo data) is REMOVED, not migrated (plan fact #4; Invariant 10: unknown ≠ zero).

## 7. S0 gate verdict

- ✅ No unresolved duplicate authority (§1 verdicts)
- ✅ No stale #194 assumption — every #194 dependency is tagged `[#194-sensitive]` with a rebase-time action; none is silently assumed present on the implementation base
- ✅ No migration written yet; all future migrations bound to verified shapes + per-migration PGlite proof + timestamps ≥ 20260901
- ⚠️ Owner override in force: base is pre-#194 `main`; S0 re-runs at rebase (standing obligation)

**S0 is complete. S1 (Governed Garage Identity and Publication) begins now on this branch.**
