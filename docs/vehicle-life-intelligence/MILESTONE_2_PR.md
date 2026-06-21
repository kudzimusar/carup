# Milestone 2 PR — External Source Ingestion Framework

**Branch:** `feat/vehicle-life-m2-ingestion` → base `feat/vehicle-life-m1-taxonomy-provenance` (stacked on M1)
**Program:** Vehicle Life Intelligence (master plan PR #89, §6)
**Status:** Draft. **Do not merge** without explicit `merge this PR now`. Retarget to `main` after M1 merges.

## Exact scope

Durable historical-evidence acquisition on top of the M1 taxonomy/provenance model: a
framework-neutral provider interface, a durable ingestion job state machine
(idempotency/retry/backoff/quarantine/dead-letter), vehicle identity resolution with a human
review queue, immutable versioned listing snapshots, and a contract-complete **fixture-backed
sandbox** auction adapter proving the end-to-end path. No source is represented as live.

## Migrations

`database/migrations/20260621130000_external_source_ingestion.sql` (additive, reversible):
`ingestion_jobs`, `source_records` (idempotent per source+record), `vehicle_identity_candidates`
(human queue), `listing_snapshots` (append-only via trigger, versioned). RLS + grants; never
exposed to anon. Down migration drops all of it.

## Changed files

- **Services:** `ingestion/sourceProvider.js` (interface + registry), `ingestion/identityResolution.js`,
  `ingestion/listingSnapshotService.js`, `ingestion/ingestionService.js` (durable engine),
  `ingestion/adapters/sandboxJpAuctionAdapter.js`, `ingestion/registerAdapters.js`,
  `ingestion/fixtures/jp_auction_sandbox.json`.
- **Routes/wiring:** `routes/ingestionRoutes.js` (jobs, identity queue/resolve, listing snapshots,
  providers), `server.js` (mount).
- **Tests:** `ingestion-framework.test.js` (7), `ingestion-routes.test.js` (4).
- **Docs:** `SOURCE_PARTNER_ONBOARDING.md`, this file.

## Test results

- `node --test`: **12/12 pass** (framework 7, routes 4, server-export boot 1) — end-to-end
  sandbox import, idempotent re-import, quarantine, identity routing, listing versioning,
  candidate resolution, role enforcement, and server boot with the new router.

## Security / privacy impact

- All ingestion tables RLS-protected; never exposed to anon.
- Imported evidence is `pending` + `restricted` — requires governed review before public.
- Provider `mode` (fixture/sandbox/live) is surfaced; **no source is claimed live**.
- Ambiguous identity never auto-attaches (human queue).
- Imported assets carry full chain-of-custody (`imported` provenance event).

## Rollout / rollback

- **Rollout:** apply the migration (additive). Trigger sandbox ingestion via
  `POST /api/ingestion/jobs {adapter_id:"sandbox_jp_auction"}` (admin) — fixtures only, safe.
- **Rollback:** run the migration `-- +migrate Down`; revert the branch. No effect on M1 or
  pre-existing data.

## Remaining blockers / follow-ups (external)

- **Real auction/importer/inspection/government APIs are external blockers** (credentials +
  legal data agreements). The adapter interface, sandbox adapter, contract tests, secure
  config points, and onboarding doc are complete; promoting to live is gated on those agreements
  (master plan §6.6) — documented, not faked.
- A reviewer UI for the identity-resolution queue folds into the M5 unified review queues.
- In production the job trigger should enqueue onto the durable worker (eventWorker pattern)
  rather than run inline; the `ingestion_jobs` state machine already supports that.
