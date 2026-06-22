# Milestone 1 PR — Vehicle Life Evidence Taxonomy + Provenance / Chain of Custody

**Branch:** `feat/vehicle-life-m1-taxonomy-provenance` → base `main`
**Program:** Vehicle Life Intelligence (master plan PR #89, §4 + §5)
**Status:** Draft. **Do not merge** without explicit `merge this PR now` from the user.

## Exact scope

Completes Milestone 1 of the master plan: layer the eight life-stage evidence **classes**
+ subtypes above the existing evidence model, add an **evidence-set** grouping, a governed
**source registry**, full **provenance fields**, a **perceptual-hash** abstraction, and an
immutable, hash-chained **chain-of-custody** log — plus the taxonomy/sources/provenance APIs
and the upload + 8-stage-timeline UI. Reuses the existing `vehicle_evidence` table, SHA-256
checksums, dual-bucket storage, RLS, and `trust_audit_events` (no duplication).

## Migrations

`database/migrations/20260621120000_vehicle_life_evidence_taxonomy_provenance.sql` (additive, reversible):
- new tables `evidence_class_taxonomy`, `evidence_sources` (+ `evidence_sources_public` view),
  `evidence_sets`, `evidence_provenance_events` (append-only via trigger);
- extends `vehicle_evidence` with 16 taxonomy/provenance columns + backfill of `evidence_class`
  from the 13 legacy types; indexes; RLS + grants; seeds the 8-class catalog and baseline sources.
- Down migration drops everything it added.

## Changed files (19; +2,458 / −6)

- **Backend services:** `evidenceTaxonomy.js`, `perceptualHash.js`, `provenanceService.js`,
  `sourceRegistryService.js`, `evidenceSetService.js` (new); `evidenceService.js` (extended
  validator + provenance column builder + best-effort chain-of-custody writer).
- **Backend routes/wiring:** `evidenceCatalogRoutes.js` (new — taxonomy, sources, sets,
  provenance); `vehiclesRoutes.js` (upload now records classification + provenance);
  `server.js` (mounts the router).
- **Tests:** `vehicle-life-taxonomy.test.js` (15), `evidence-catalog-routes.test.js` (5).
- **Frontend:** `EvidenceUploadModal.tsx` (class/subtype/date/mileage/tags), new
  `VehicleLifeStageTimeline.tsx`, `VehicleDetail.tsx` + owner `VehicleProfile.tsx` (render
  timeline), `useCarUpApi.ts` (taxonomy/sources clients), `types/index.ts`.
- **Docs:** `MILESTONE_0_DISCOVERY_AND_GAP_AUDIT.md`, `EVIDENCE_TAXONOMY.md`,
  `PROVENANCE_AND_CHAIN_OF_CUSTODY.md`, this file.

## Test results

- Backend `node --test`: **38/38 pass** (M1 taxonomy 15, catalog routes 5, evidence-ai-fraud,
  evidence-api, evidence-validation, server-export, auth-middleware) — including the full
  pre-existing evidence suite as regression.
- Frontend: `npx tsc --noEmit --project web/tsconfig.app.json` → **exit 0**;
  `npm run build` → **exit 0** (only the pre-existing chunk-size advisory).
- `git diff --check` → clean.

## Security / privacy impact

- Source credentials (`contact_reference`/`credential_reference`) are RLS-restricted and
  stripped by the public serializer + `evidence_sources_public` view.
- Provenance retrieval is role-scoped; public callers never receive IPs, raw actor IDs, or hashes.
- Chain-of-custody is append-only (DB trigger) and hash-chained (tamper-evident).
- No new secrets; perceptual hashing makes no fabricated capability claims (PNG only today).
- AI remains advisory; nothing here lets AI approve evidence or change trust (unchanged).

## Rollout / rollback

- **Rollout:** apply the migration (additive; backfills existing rows; no destructive changes).
  No env changes required. Frontend is backward compatible (new fields optional).
- **Rollback:** run the migration's `-- +migrate Down` section (drops the new tables/columns/
  trigger/view) and revert the branch. Legacy evidence continues to function without the class
  layer. No data loss for pre-existing columns.

## Remaining blockers / follow-ups

- Perceptual hashing currently supports PNG only (no `sharp`/`jimp` dependency). JPEG/WEBP
  decode is a deliberate follow-up; the abstraction is ready for it. (Honest limitation.)
- External source adapters are **sandbox/unverified** seeds only — Milestone 2 builds the
  ingestion framework; no source is claimed live.
- Migration verified by review + the mocked test suite (no production Supabase touched, per
  master plan §19); apply against a staging DB before any production consideration.
