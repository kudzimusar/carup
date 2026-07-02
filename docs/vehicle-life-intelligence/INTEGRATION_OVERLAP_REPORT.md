# Integration Overlap Report — Vehicle Life Intelligence M1–M6

Branch shape: M1→M2→M3 is a linear stack on `main`; **M4, M5, M6 each branch from M3** (siblings).
So the only real merge conflicts are between the siblings (chiefly **M4 ↔ M5**). M6 is effectively
conflict-free (distinct files; does not touch `server.js`).

## Per-file overlap matrix

| File | M1 | M2 | M3 | M4 | M5 | M6 | Conflict? | Resolution |
|---|---|---|---|---|---|---|---|---|
| `backend/server.js` (router wiring) | ✎ | ✎ | ✎ | ✎ | ✎ | — | **M4↔M5** | union: keep all router imports + `app.use(...)` mounts (evidenceCatalog, ingestion, intelligence, report, governance) |
| route files (`evidenceCatalogRoutes`, `ingestionRoutes`, `intelligenceRoutes`, `reportRoutes`, `governanceRoutes`) | new | new | new | new | new | — | none | distinct new files |
| `web/src/App.tsx` | — | — | — | ✎ | ✎ | — | **M4↔M5** | union: SharedReport route (M4) + governance-review routes (M5) + both imports |
| `web/src/hooks/useCarUpApi.ts` | ✎ | — | ✎ | ✎ | ✎ | — | **M4↔M5** | union: report methods (M4) + governance methods (M5); merge import list + return object |
| `web/src/types/index.ts` | ✎ | — | ✎ | ✎ | ✎ | — | **M4↔M5** | union: report types (M4) + governance types (M5) appended |
| `web/src/pages/VehicleDetail.tsx` | ✎ | — | ✎ | ✎ | ✎ | — | **M4↔M5** | union: History Report tab (M4) + DisputePanel section (M5) |
| report/temporal/disclosure/governance components | — | — | new(M3) | new(M4) | new(M5) | — | none | distinct new files |
| `database/migrations/*` | +1 | +1 | +1 | +1 | +1 | +1 | none | 6 distinct timestamped files; order 120000→170000 |
| `package.json` / `package-lock.json` | — | — | — | — | — | — | **none** | no dependency changes in any milestone |
| `.github/workflows/ci.yml` | — | — | — | — | — | new | none | M6 only |
| `backend/middleware/securityMiddleware.js` | — | — | — | — | — | ✎ | none | M6 only |
| `backend/middleware/rateLimitStore.js`, `backend/services/eventBus/eventWorker.js` | — | — | — | — | — | ✎/new | none | M6 only |

✎ = modified · new = new file · — = untouched

## Merge plan (deterministic)

1. `integration/vehicle-life-m1-m6` from `origin/main`.
2. Merge **M3** → fast-forward (brings M1+M2+M3 linearly; no conflict).
3. Merge **M4** → fast-forward (M4 = M3 + report commits).
4. Merge **M5** → 3-way; resolve the 5 M4↔M5 files by **union** (preserve all behavior).
5. Merge **M6** → expected clean (distinct files; no `server.js` touch).

## Migration ordering (confirmed monotonic)

`20260621120000` (M1) → `130000` (M2) → `140000` (M3) → `150000` (M4) → `160000` (M5) → `170000` (M6).
Each references only objects created by an earlier migration (vehicles/users → vehicle_evidence(014) →
evidence_sources/sets(M1) → listing_snapshots(M2) → temporal/disclosure(M3) → report_versions(M4) →
governance(M5) → outbox DLQ(M6)). No reordering required.

## Risk notes

- The five M4↔M5 files are **additive in different regions**; conflicts are localized to the
  import blocks, the `useCarUpApi` return object, and adjacent JSX/route blocks. Union resolution
  preserves both milestones' behavior; verified afterward by tsc + build + the full test suite.
- Migrations use Supabase-specific constructs (`anon`/`authenticated` roles, `auth.uid()`); the
  isolated-Postgres (pglite) apply test uses a documented Supabase-compat shim (see migration evidence).
