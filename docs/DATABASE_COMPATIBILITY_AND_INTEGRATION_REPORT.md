# Database Compatibility & Integration Report

**Program:** CarUp Database Compatibility & Unified Runtime Contract Audit
**Date:** 2026-08-09
**Branch under audit:** `integration/unified-product-advancement` (PR #139)
**Companion PRs:** #141 (production migration dispatcher, extended), #140 (staging dispatcher, merged)
**Author:** Claude (autonomous audit session), for owner review

Every claim below marked *live-verified* was executed against the running
staging database during this audit via the scoped `supabase-carup-staging`
MCP server. Production was **never connected to** by this audit; production
statements are receipts-based or explicitly UNKNOWN, by design.

---

## A. Database architecture

| Environment | Supabase project ref | Region | Access path used by this audit |
|---|---|---|---|
| Staging | `eoyenigwevnxwwhyhaer` | ap-southeast-2 | Scoped MCP server `supabase-carup-staging` (project-ref-pinned). Identity re-verified via `get_project_url` before every mutating step. |
| Production | `vhmnajoeicasaigiophh` | ap-south-1 | **No live access from this audit.** The only sanctioned path is the pinned-candidate GitHub Actions dispatcher (PR #141): `MODE=preflight` is a READ ONLY transaction; `MODE=apply` requires the exact owner authorization phrase and was **not** run. |

Runtime access architecture (live-verified on the codebase):

- **Every backend data path uses the service-role Supabase client.** RLS is
  therefore bypassed by design for product traffic; authorization is enforced
  in the application layer (route/service predicates). This is the single most
  important architectural fact for interpreting sections E and H.
- The web app holds an anon-key client; its sole writer is dead code. The anon
  key's real exposure is PostgREST itself, which is what the API-role grant
  audit (E) measured and the hardening migration closes.
- The production project ref appears in **no executable file** (CR-1); the
  dispatcher receives it as an environment secret and the runner refuses a
  connection string that does not contain it or that contains the staging ref.

## B. Contract matrix

Feature → runtime writer/reader → database objects. "Contract holds" means the
runtime's actual write/read shape was matched column-for-column against the
live staging schema (Phases 2–4), and where marked, exercised end-to-end with
synthetic fixtures (Phase 5/6, section G).

| Feature | Runtime surface | Database objects | Contract status |
|---|---|---|---|
| Marketplace publication gate | `vehicleStatus.js` projection; publication endpoints | `vehicles.publication_status` + 20260603132036 summary columns (`vehicle_condition_category`, `passport_verified`, `zimra_verified`, `safe_pay_ready`, `inspection_ready`) | Holds; exercised live (visible set == published only) |
| Marketplace inquiries/leads | `marketplaceInquiryService`, `leadsRoutes` | `marketplace_inquiries` (21 cols, live-verified), `dealer_leads` (created by `006_domain1.sql`, orphaned but present) | Holds; seller isolation exercised live; perf pushdown fixed (D-9) |
| Communication engine | `domain_events` outbox → `eventWorker` → orchestrator | `domain_events` (18 cols incl. `dedupe_key`, `available_at`), `message_threads` (`thread_type` CHECK, 12 legal values), `notification_queue` (34-col orchestrator variant incl. `event_id`, `dedupe_key`) | **Was RED** (SM-1/SM-2: illegal thread types; dedupe collapse) — fixed this audit (D-1, D-2) |
| Trust graph / audit | `trustGraphService`, `trust_audit_events` writers | `trust_audit_events` (23 cols), `trust_score_history` | **Was RED** (MM-14: `trust_score_history` ABSENT) — table created + staging-applied this audit |
| Vehicle passport ledger | `blockchainService` (event chain + every-10th checkpoint upsert) | `blockchain_events`, `rolling_integrity_checkpoints` (upsert `onConflict: 'vin'`) | **Was RED** (MM-14: checkpoint table ABSENT) — created with `vin` PRIMARY KEY + staging-applied this audit. Payload-type concern MM-11 refuted live (`jsonb_typeof='object'`) |
| Mechanic OS | `workOrdersRoutes`, mechanic dashboards | `mechanic_work_orders` / `mechanic_parts` (converged shape, 20260808150000) | Holds; converged write exercised live; client-side completion path was unreachable — fixed in web lane (D-13) |
| Evidence / completeness | `completenessEvaluator`, evidence upload | `vehicle_evidence` (`evidence_type` CHECK, 13 values) | **Was AMBER** (MM-1: one illegal constant, any-of matching saved it) — constants aligned to the CHECK (D-8) |
| Finance | `financeService`, `financeRoutes` | `finance_applications` (incl. `tenant_id`) | **Was RED** (SM-3 tenant split-brain) — fixed (D-3, D-4) |
| PartSentry | `partsentryService`, public card reads | `partsentry_logs` (+20260603132036 verification columns), `partsentry_review_requests` | Holds; unverified-tenant read widening removed, tenant stamping added (D-11, D-12) |
| Identity verification | `decisionRecorder` | `verification_sessions` (**no `tenant_id` column** — live-verified), `verification_decisions` | **Was AMBER** (phantom column read; unscoped 23505 recovery) — fixed (D-5) |
| Diaspora | billing/entitlements routes, workbook export | diaspora billing tables; entitlements envelope | Envelope render defect + broken xlsx anchor fixed in web lane (D-14, D-15) |
| Storage / media | `mediaRouter` | Storage buckets; `vehicles` ownership rows for authz | **Was RED** (document-upload/signed-URL IDOR class) — fixed (D-10) |

## C. Schema drift

**Staging vs repository:**

- The staging migration ledger (`supabase_migrations.schema_migrations`) and
  the actual schema diverge in bookkeeping, not in structure: several schema
  elements arrived out-of-band historically (ledger ≠ schema is an accepted
  fact of this project; the dispatchers exist precisely to stop adding to it).
- Naming drift recorded during this audit: migrations applied through the MCP
  server are ledgered under **apply-time versions** (`20260809012226`,
  `20260809012350`-class stamps) with the repo filename kept in `name`
  (`20260809100000_trust_side_tables`, `20260809110000_api_role_write_hardening`),
  while dispatcher-applied migrations use filename versions. Cosmetic; the
  authoritative check is schema state, which was verified directly.
- The hardening migration was amended once **after** first staging apply
  (bare `REVOKE INSERT/UPDATE/DELETE` left non-RLS-filtered `TRUNCATE` plus
  `TRIGGER`/`REFERENCES` residue). The stale ledger row was removed and the
  amended migration re-applied, so staging ledger `statements`, repo file, and
  live posture agree.
- `database/test/migration_pglite_check.mjs` differs between `main` and the
  #139 branch (the #139 harness carries the mechanic-convergence prerequisite
  machinery). The dispatcher branch deliberately keeps the `main`-shaped
  harness; pinned migration files there are runner-sourced, per the
  established #140/#141 pattern.

**Staging vs production:** UNKNOWN by design — this audit had no production
access. The extended #141 preflight (candidate `ccbc2e0`) now inventories the
full dependency set (12 tables, column sets, CHECK values, vin uniqueness,
grant/RLS posture) in one READ ONLY transaction, so the drift answer becomes
owner-reviewable evidence before any apply. Known receipts: production had
not received the publication-gate migrations as of PR #141's validation, and
nothing in this audit changed production.

## D. Runtime compatibility defects

Confirmed defects (all live-verified against staging schema; severity after
verification). "Fixed" = implemented on a `fix/db-compat-*` lane branched from
the #139 branch and merged back after tests.

| # | Defect | Severity | Status |
|---|---|---|---|
| D-1 | Comms: NEW notification policies emit `thread_type` values (`verification`, `marketplace_listing`, `evidence`) **rejected by the DB CHECK** → thread creation fails at runtime | P0 | **Fixed** — `fix/db-compat-comms` (merged `40b336c`); suites 203/203 |
| D-2 | Comms: event listeners drop the raw outbox record → `notification_queue.event_id` NULL and dedupe key collapses to per-user-per-type (distinct events swallowed) | P0 | **Fixed** — `fix/db-compat-comms` (merged `40b336c`); suites 203/203 |
| D-3 | Finance: events emitted with `tenantId = bankId` (a client-supplied `users.id`) poisoning `domain_events`/`message_threads`/`notification_queue.tenant_id`; `Math.random()` application ids | P0 | **Fixed** — `fix/db-compat-comms` (merged `40b336c`); suites 203/203 |
| D-4 | Finance routes: platform-wide unscoped GET; unvalidated, event-less status updates | P2 | **Fixed** — `fix/db-compat-comms` (merged `40b336c`); suites 203/203 |
| D-5 | Identity: `decisionRecorder` reads phantom `verification_sessions.tenant_id`; 23505 recovery re-query not session-scoped | P1/P3 | **Fixed** — `fix/db-compat-comms` (merged `40b336c`); suites 203/203 |
| D-6 | Moderation audit rows omit actor attribution | P2 | **Fixed** — `fix/db-compat-comms` (merged `40b336c`); suites 203/203 |
| D-7 | New-policy channels (email/push) can only dead-letter (no address enrichment) → in_app-only until enrichment exists | P1 | **Fixed** — `fix/db-compat-comms` (merged `40b336c`); suites 203/203 |
| D-8 | Completeness evaluator: `ownership_transfer` is not a legal `evidence_type` (CHECK says `ownership_transfer_document`); any-of matching prevented total blockage (downgraded from feared P0) | P2 | **Fixed** — `fix/db-compat-marketplace` (merged `0eded1d`); suites 90/90 + adjacent 96/96 |
| D-9 | Inquiry seller listing pulls whole table, filters in JS | P2 | **Fixed** — `fix/db-compat-marketplace` (merged `0eded1d`); suites 90/90 + adjacent 96/96 |
| D-10 | Storage: document upload without ownership check + `x-user-id` header actor; signed-URL endpoints sign arbitrary caller paths (IDOR) | P1 | **Fixed** — `fix/db-compat-marketplace` (merged `0eded1d`); suites 90/90 + adjacent 96/96 |
| D-11 | PartSentry read widening from optionalAuth's **unverified** tenant header claim | P1 | **Fixed** — `fix/db-compat-marketplace` (merged `0eded1d`); suites 90/90 + adjacent 96/96 |
| D-12 | Completeness endpoint unscoped; saved-vehicles `vehicles(*)` embed leaks non-public columns | P1 | **Fixed** — `fix/db-compat-marketplace` (merged `0eded1d`); suites 90/90 + adjacent 96/96 |
| D-13 | Work-order completion PATCH unreachable from any client; dashboard counts a status no path produces | P2 | **Fixed** — `fix/db-compat-web-2` (merged `e4676a3`); vitest 22/22 + `tsc -b` clean |
| D-14 | Diaspora entitlements panel renders the response **envelope's field names** instead of entitlements | P0 (functional) | **Fixed** — `fix/db-compat-web-2` (merged `e4676a3`); vitest 22/22 + `tsc -b` clean |
| D-15 | Diaspora workbook xlsx download is a relative `<a href>` — SPA rewrite + missing auth headers make it always broken | P0 (functional) | **Fixed** — `fix/db-compat-web-2` (merged `e4676a3`); vitest 22/22 + `tsc -b` clean |
| D-16 | `trust_score_history` + `rolling_integrity_checkpoints` ABSENT while runtime writes them (silently swallowed by try/catch) | P1 | **Fixed** — migration `20260809100000`, staging-applied, write-shape probe passed |
| D-17 | PostgREST exposure: `mechanic_work_orders`/`mechanic_parts`/`vehicle_ownership_history` RLS-OFF with full anon DML; `vehicle_evidence` anon/authenticated INSERT/UPDATE grants; `vehicles` anon-writable via `tenant_id IS NULL` policy branch | P0 (exposure) | **Fixed** — migration `20260809110000`, staging-applied, SELECT-only posture live-verified |

Refuted during adversarial verification (no fix needed): MM-11 (blockchain
payload type — supabase-js normalizes to jsonb object, proven live).

## E. Multi-tenancy / RLS findings

**Application-layer authorization (what product traffic actually goes
through):** proven live with synthetic fixtures (section G):

- Dealer A vs Dealer B inventory isolation: each sees exactly its own vehicle.
- Dealer B reading Garage C's work order: 0 rows. Garage C cross-tenant: 0.
- Dealer B attempting cross-tenant UPDATE via the app predicate: **0 rows
  affected** (run as a standalone data-modifying CTE).
- Seller inquiry isolation: seller A sees 1 (its own), seller B sees 0.
- Public gate visibility: exactly the published VIN, never drafts.

**DB-level enforcement (what PostgREST + API keys allow):** materially weaker
before this audit, and this distinction is the honest core of Issue #101:

- Pre-audit (live-verified): three tables had RLS **disabled** with full
  anon/authenticated DML; `vehicle_evidence` had anon+authenticated
  INSERT/UPDATE grants; `vehicles` combined `USING (true)` public read with a
  permissive write policy whose `tenant_id IS NULL` branch made private-seller
  rows anon-writable over REST.
- Post-audit (live-verified after `20260809110000`): RLS enabled on all seven
  relevant tables; API-role grants are now **SELECT-only on `vehicles` and
  `vehicle_evidence`, none anywhere else**. The `vehicles` public-read policy
  (`USING (true)`) is deliberately untouched: it is a documented product
  decision under Issue #101 and this audit does not adjudicate it (and does
  not close the issue).
- Because the backend runs service-role, none of the hardening changes any
  product path — verified by the regression battery (section G).

**Honesty caveat:** the tenancy proofs above demonstrate *application
predicates*, not database-enforced isolation. With a leaked service-role key
or a backend authorization bug, the database itself still does not enforce
tenant boundaries. Closing that (RLS policies for API-role access patterns,
or per-tenant claims) remains the Issue #101 program's scope.

## F. Migration status

The four migrations the production dispatcher (PR #141, candidate `ccbc2e0`)
now carries:

| Migration | Repo | Staging | Production | Checksum (sha256:12) | Dependency | Status |
|---|---|---|---|---|---|---|
| `20260808140000_publication_gate_backfill.sql` | #139 branch + dispatcher branch (pinned copy) | **Applied** (Actions dispatcher, PR #140 path) | Not applied (UNKNOWN until preflight receipts) | `8149450f6d8e` (frozen in runner) | `vehicles.publication_status` populated pre-gate | Ready; apply owner-gated |
| `20260808150000_mechanic_work_orders_convergence.sql` | same | **Applied** (same path) | Not applied | `9d0bab867938` | mechanic tables must pre-exist (runner refuses blind apply) | Ready; apply owner-gated |
| `20260809100000_trust_side_tables.sql` | #139 branch `4697a57` + dispatcher `4a62e69` (byte-identical) | **Applied 2026-08-09 via scoped MCP**; tables, RLS, grants + write-shape probe live-verified | Not applied | `8daf5a2fb89b` | `vehicles.vin` PK/UNIQUE (runner guards; live-verified =1 on staging) | Ready; apply owner-gated |
| `20260809110000_api_role_write_hardening.sql` | #139 branch `3afe594` + dispatcher `e7374ff` (byte-identical) | **Applied 2026-08-09 via scoped MCP** (amended once, see C); SELECT-only posture live-verified | Not applied | `ccdefddea654` | all five target tables must pre-exist (runner guards) | Ready; apply owner-gated |

PGlite harness: full Up → Down → re-Up over the #139 pin list including both
new migrations — `overall: PASS`.

The broader #139 migration family (marketplace_inquiries, trust_audit_events,
partsentry_review_requests, communication engine tables, 20260603132036
columns, evidence CHECK) is **present on staging** (12/12 dependency tables
live-verified today) and is exactly what the extended #141 preflight now
inventories on production.

## G. Staging workflow evidence

Real read/write journeys executed against live staging with synthetic
`uat-dbaudit-*` fixtures (tenants A/B, garage C, users, vehicles, work order,
inquiry), then removed (cleanup residual = 0 across every fixture table):

1. **Publication journey:** vehicle created draft → published → appears in
   the public gate projection; the draft VIN never does. Visible set equalled
   the published VIN exactly.
2. **Mechanic journey:** converged-shape work order insert (tenant, customer,
   costs) succeeded and read back through the service path; Garage C's order
   invisible to Dealer B (0 rows).
3. **Inquiry journey:** buyer inquiry insert → seller A list shows 1, seller
   B shows 0.
4. **Cross-tenant write attempt:** B→A UPDATE through the app predicate
   affected 0 rows.
5. **Trust write-shape probe (post-migration):** `trust_score_history` insert
   with the runtime's exact column set succeeded and was deleted (id=1,
   residual 0).
6. **Outbox health observation:** 213 `domain_events` rows sat `pending` on
   deployed staging — the deployed worker is not draining the outbox. This is
   a deployment/ops observation (AMBER), not a schema defect; the fixed comms
   code paths were validated by the hermetic suites instead.

Whole-build regression battery on the merged #139 branch (backend node --test
suites incl. comms + marketplace, web vitest + `tsc -b`, PGlite migration
check, mobile):

| Suite | Result |
|---|---|
| Backend full (`node --test backend/tests/*.test.js`, CI-equivalent env) | 2730 tests: **2717 pass, 0 regressions**, 12 skipped (live-smoke guards), 1 fail — see below |
| Web (`npx vitest run`, all 90 files) | **797/797 pass** |
| Web typecheck (`npx tsc -b`) | clean |
| Mobile (`npx vitest run`) | **53/53 pass** |
| PGlite migration harness (merged tree, incl. both new migrations) | **overall PASS** (full Up → Down → re-Up) |
| Lane-scoped suites | comms 203/203; marketplace 90/90 briefed + 96/96 adjacent; web-lane 22/22 |

The single backend failure is `provision-staging-qa-accounts.test.js`
("…REAL users role catalog…"), a live-integration test that opens a direct
Postgres connection using the workstation `.env`; it fails with `28P01
password authentication failed` — a stale local credential, not code. Proven
pre-existing: the identical test fails identically at the pre-merge baseline
commit (`3afe594`) with the same `.env`, and the suite is 0-fail wherever no
`.env` is present (CI and the lane worktrees). **Answer to "did anything that
already worked stop working?": no.**

## H. Production readiness decision

**Scope of this verdict.** "Compatibility" here means: the PR #139 build and
the database schema it will run against are contract-compatible, proven on
live staging and by the whole-build regression battery. It is **not** a
statement that production has been migrated — production application remains
owner-gated behind PR #141's preflight receipts and authorization phrase, by
design.

**Basis:**

1. Every confirmed RED defect (D-1…D-17) is fixed on the #139 branch, with
   tests, and merged (`40b336c`, `0eded1d`, `e4676a3`).
2. Staging now holds the complete #139 dependency set (12/12 tables
   live-verified today), including the two new audit migrations, applied and
   posture-verified.
3. The whole-build regression battery is green with zero regressions
   (section G).
4. The production path is fully specified: PR #141 candidate `ccbc2e0`
   carries all four migrations with frozen checksums, a full dependency
   inventory in READ ONLY preflight, blind-apply guards, and fail-closed
   post-apply contracts.

**Conditions attached (all owner-controlled, none blocking this verdict):**

- Run #141 `MODE=preflight` and review the dependency-inventory receipts
  before authorizing apply; the inventory exists precisely so that any
  production drift surfaces as evidence, not as an apply-time failure.
- Merge order: #141 first (or dispatch from its merged main copy), apply the
  four migrations, then merge #139.
- The deployed staging outbox backlog (213 pending `domain_events`) is an
  ops follow-up: ensure the event worker actually runs in each deployed
  environment before relying on notification delivery.
- The `vehicles` public-read policy and DB-level tenant enforcement remain
  the Issue #101 program's scope (not closed by this audit).

```text
DATABASE COMPATIBILITY GATE — PASS
```

---

## Addendum — post-audit interruption sweep and remediation (2026-08-09, same day)

The audit session was interrupted twice by disk exhaustion. A seven-agent
verification sweep afterwards checked every surface the interruptions could
have damaged. Findings and resolutions, all on this branch:

1. **Two changes lost in the web-lane rewrite, restored.** The first web fix
   lane was interrupted and rewritten from scratch; the rewrite dropped the
   Phase-4 `description` fallback in the work-order service cell (every
   app-created order rendered the placeholder "General Service" instead of
   the mechanic's entered text) and the `cancelled` filter button. Both
   restored, with regression tests (`WorkOrders.test.tsx`, +2 scenarios).

2. **CI lint-regression gate red on the pinned head, fixed.** The rewrite
   introduced two net-new lint errors (`Promise<any>` on
   `updateMechanicWorkOrder`; `react-hooks/set-state-in-effect` in the
   work-orders load effect). Both fixed; the gate re-run locally reports
   `NET_NEW_ERRORS=0`.

3. **Vercel backend deployments failing at creation, root-caused and fixed.**
   `backend/vercel.json` carried a `* * * * *` cron for
   `/api/internal/events/process`; the Vercel Hobby plan rejects sub-daily
   cron schedules at deploy time, so every `carup-backend` /
   `carup-backend-staging` deployment failed — the exact hazard
   `20260626120000_communication_supabase_cron.sql` documents and solved for
   the communications worker. Resolution mirrors that precedent: NEW
   migration `20260809120000_events_outbox_pg_cron.sql` schedules
   `carup-events-outbox-every-minute` via pg_cron + pg_net (idempotent,
   extension-guarded, secrets read from Vault at execution time — new
   `CARUP_EVENTS_ENDPOINT_URL` plus the shared `CARUP_WORKER_SECRET`), and
   `backend/vercel.json` is `{}` again. The event-coverage test now enforces
   the pg_cron architecture and forbids sub-daily vercel.json crons. This
   also gives the "deployed staging outbox backlog" ops follow-up above its
   quiet-traffic drain. The migration manifest is now **five** migrations,
   and the PR #141 runner carries the fifth (frozen `2c0424ffba94`).

   **Canonical scheduler truth (supersedes all earlier wording):**

   ```text
   scheduler              = Supabase pg_cron + pg_net
   Vercel cron            = removed (backend/vercel.json is {})
   staging activation     = evidence-backed (see receipts below)
   production activation  = owner-gated via PR #141 / not yet applied
   ```

   **Governance closure (same day, later):** the migration was hardened to
   FAIL-CLOSED (missing pg_cron or pg_net RAISES before the ledger row can
   exist; Vault secrets remain a safe, verifiable activation gate), with a
   contract test and a behavioral PGlite test proving the failure. Staging
   application went through a reviewed dispatcher, not manual SQL:
   `.github/workflows/events-cron-staging-migration.yml` (PR #142, pin
   advanced by PR #143 to candidate `0f5c0e3`, frozen `2c0424ffba94`).
   Receipts: verify run 31298661815 (extensions present, ledger/job absent
   pre-apply); apply run 31298702039 (`#20260809120000 applied and
   recorded`, cron job `carup-events-outbox-every-minute` active on
   `* * * * *`); re-dispatch 31299048156 proved verify-only idempotency and
   pinned the endpoint Vault URL to the stable staging domain. End-to-end
   proof (run 31299094478) walked the chain with a synthetic event: pg_cron
   fired (3/3 succeeded) and pg_net POSTed, but the deployed staging
   backend predates seam-E and 404s `/api/internal/events/process` — the
   event honestly stayed `pending` and every synthetic row was cleaned up.
   E2E completes after `carup-backend-staging` redeploys from this branch
   (blocked ~24h by Vercel's build rate limit). The same receipts exposed
   that BOTH Vault worker URLs had rotted to a deleted deployment URL
   (pg_net receiving `410 Gone` every minute) — staging comms delivery had
   been silently broken; both URLs now point at the stable staging domain.

4. **Everything else verified intact.** Staging posture re-confirmed live
   (both audit migrations applied; SELECT-only grants and RLS on all seven
   hardened tables; ledger note: the apply tool stamped versions
   `20260809012226`/`20260809012426` with the canonical filenames in the
   name field — a harmless drift, both migrations idempotent). PGlite
   Up→Down→re-Up: PASS. Comms + marketplace suites 386/386; the two
   cron-affected suites 145/145 after the pg_cron move; targeted web suites
   16/16 with a clean typecheck. PR #141 pins `ccbc2e0`/`98d54b6` verified
   present on the remote. Git object store clean; no conflict markers,
   truncated files, or other interruption debris anywhere in the tree.

The gate verdict above stands. The five-migration manifest supersedes the
four-migration wording in sections F and H.
