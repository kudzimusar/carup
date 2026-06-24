# Integration Qualification Report — Vehicle Life Intelligence M1–M6

**Branch:** `integration/vehicle-life-m1-m6` · **HEAD:** `0499ad8` (base `main` @ `c25b094`)
**Scope:** qualify the six milestone PRs for merge as one coherent tree. **No PR merged, no
production deploy, no production Supabase used, no secrets exposed.**

## 1. Integrated branch SHA
`0499ad8` on `integration/vehicle-life-m1-m6` (23 commits above `main`: the six milestones merged
in order M3→M4→M5→M6 plus four integration commits — overlap report, M5 fix + migration harness,
golden journey, this report).

## 2. Combined changed files (vs `main`)
- **Migrations (6):** `20260621120000` … `20260621170000` (taxonomy/provenance, ingestion, AI/
  temporal/disclosure, report versions, governance, outbox DLQ).
- **Backend services:** `evidence/*` (taxonomy, perceptualHash, provenance, sourceRegistry,
  evidenceSet), `ingestion/*` (provider, engine, identity, listingSnapshot, sandbox adapter,
  fixtures), `ai/*` (analysisProvider, analysisJobService, similarity, evaluation),
  `intelligence/*` (temporalComparison, disclosureConflict), `report/reportService`,
  `governance/*` (governanceService, disputeService), `middleware/rateLimitStore` +
  `securityMiddleware` (CSRF fix), `services/eventBus/eventWorker` (DLQ).
- **Backend routes:** evidenceCatalog, ingestion, intelligence, report, governance — all mounted in
  `server.js` (union-resolved).
- **Frontend:** taxonomy upload fields, life-stage timeline, temporal/disclosure panels, history
  report + shared page, governance review queue + dispute panel; `useCarUpApi`, `types`, `App.tsx`,
  `VehicleDetail` (union-resolved).
- **Tests (13 new files):** taxonomy, catalog routes, ingestion (framework+routes), AI/temporal/
  disclosure (engines+routes), report, governance (workflow+routes), rate-limit store, outbox DLQ,
  golden journey + migration harness.
- **Infra/docs:** `.github/workflows/ci.yml`, `infra/cloudflare-waf.sample.json`, ADR + WAF +
  backup/DR + observability + secrets + release + golden-datasets + program/overlap/integration docs.
- **No `package.json` / `package-lock.json` changes** (no dependency additions in any milestone).

## 3. Migration apply / down / reapply evidence (isolated PostgreSQL 17 via PGlite)
Harness: `database/test/migration_pglite_check.mjs` (no daemon, no Supabase). Bootstraps a
Supabase-compat shim (roles `anon`/`authenticated`/`service_role`, `auth.uid()`, prerequisite
`vehicles`/`users`/`domain_events` + the real 014/015 `vehicle_evidence`), then:

- **Up:** 6/6 applied → **19 tables**, `evidence_sources_public` view, **9 append-only/guard
  triggers** (provenance, listing, report-version, review_decisions, dispute_events), RLS policies.
- **Down (reverse 170000→120000):** 6/6 → **0 of the 19 tables remain** (clean rollback).
- **reUp:** 6/6 → **19 tables** restored.
- **Legacy backfill (item 9):** a pre-M1 `odometer_photo` row → `evidence_class='inspection'`,
  `checksum_algorithm='sha256'` ✓ (legacy compatibility preserved).
- **Append-only enforced:** `UPDATE` on `evidence_provenance_events` blocked by trigger ✓.
- Migration ordering monotonic and dependency-correct.

> Caveat: PGlite is an isolated real Postgres 17, not the actual Supabase staging instance; the
> Supabase-specific roles/`auth.uid()` were shimmed. A staging-Supabase apply is still recommended
> pre-production, but migration **mechanics** (up/down/reup/backfill/triggers) are verified.

## 4. Consolidated test matrix (integration tree)
**195/195 pass** in one run:
- M1 taxonomy/catalog, M2 ingestion (framework+routes), M3 AI/temporal/disclosure (engines+routes),
  M4 report, M5 governance (workflow+routes), M6 rate-limit + outbox DLQ.
- Golden journey (A–P).
- Regressions: evidence (ai-fraud/api/validation), auth (login/middleware/session), trust
  (fact-workflow/governance), marketplace (summary/eligibility), verification session, server boot.
- **tsc** `--noEmit` exit 0 · **vite build** exit 0 · **git diff --check** clean · **secret scan** 0
  matches · **npm audit** pre-existing moderate/high advisories only (no new deps from this program).

## 5. Golden journey result — PASS
A create vehicle · B sandbox auction import · C inspection/current evidence · D provenance chain ·
E mock analysis (advisory; verification unchanged) · F temporal finding (same-vehicle gated,
pending_review) · G listing claim (original text retained) · H disclosure conflict (neutral,
pending_review) · I governance confirm (audited; no trust change) · J buyer report · K cautious
"requires reviewer confirmation" language + explicit limitations · L seller dispute · M supersede
via governed path (auditable) · N report v2 (superseded finding no longer confirmed-public) · O v1
shared report immutable · P public output omits internal explanations, IPs, secrets, and restricted
evidence. All assertions green.

## 6. Role / privacy result — PASS
- Server-side `authorizeRole` enforced: non-admin cannot trigger ingestion (403) or apply
  governance decisions; buyers receive only reviewer-confirmed, public-safe temporal/disclosure
  output; pending findings never public.
- Public report/provenance serializers strip internal explanations, raw model output, reviewer-
  private notes, source credentials, IP addresses, actor IDs.
- Restricted/pending evidence excluded from public report + public APIs.
- AI cannot approve evidence or change trust; ambiguous identity → human queue (never auto-attach);
  missing history never presented as clean; disclosure language neutral; superseded/disputed
  auditable; share links expire + revoke; rate limiter fails-open per policy; CSRF never uses the
  service-role secret; outbox dead-letter + replay covered.

## 7. Conflict resolutions
- `backend/server.js` (M4↔M5): union — kept both `reportRouter` and `governanceRouter` import + mount.
- `web/src/hooks/useCarUpApi.ts` (M4↔M5): union — both report and governance methods + imports + return entries.
- `web/src/types/index.ts` (M4↔M5): union — both report and governance type blocks.
- `web/src/App.tsx`, `web/src/pages/VehicleDetail.tsx` (M4↔M5): auto-merged cleanly (additions in distinct regions).
- M6 merged with **zero conflicts** (distinct files).
- **Integration defect found & fixed:** M5 migration had an unnecessary `CREATE EXTENSION pgcrypto`
  (gen_random_uuid is core; the other five don't use it) — removed for portability. **This fix is
  on the integration branch only; PR #96 still carries it** (see recommendation).

## 8. Remaining external blockers (production, not merge)
Live provider APIs + legal agreements; live AI quality numbers (samples + budget); Redis/Cloudflare/
Fly/monitoring accounts + paid Supabase PITR; staging-Supabase migration apply; production pilot +
backup/DR drills; rotation of any exposed service-role key (prod access). None block merge.

## 9. Recommended merge order / consolidation strategy
**Strategy B — merge the consolidated integration branch** (`integration/vehicle-life-m1-m6`).
Rationale: it is the only artifact integration-tested as a whole (conflicts resolved, M5 defect
fixed, 195 tests, migrations up/down/reup on real PG17, golden journey + role/privacy green). The
siblings #95/#96/#97 should not be merged independently because (a) #96 still carries the pgcrypto
defect and (b) independent sibling merges re-introduce the M4↔M5 conflict resolution at each step.

If the team prefers **Strategy A** (sequential `#91→#92→#93→#95→#96→#97` with retarget): first
cherry-pick the one-line M5 pgcrypto removal onto #96, then retarget #95→#93, #96→#95, #97→#96 and
re-resolve the M4↔M5 wiring conflicts at each step (already solved on the integration branch).

## 10. Final recommendation

**READY FOR EXPLICIT MERGE**

The combined tree builds and tests (195/195), all six migrations apply/rollback/reapply on an
isolated PostgreSQL 17 with legacy backfill and append-only enforcement verified, the golden
end-to-end journey passes, role/privacy boundaries hold, the single integration defect (M5
pgcrypto) is corrected, and the merge strategy is unambiguous (B preferred). Production rollout
remains gated on the external blockers in §8. **No PR has been merged and no deployment performed —
merge only after the user explicitly says `merge this PR now`.**
