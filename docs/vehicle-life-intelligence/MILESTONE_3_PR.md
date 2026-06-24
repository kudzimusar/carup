# Milestone 3 PR — Visual & Disclosure Intelligence (AI jobs · temporal · disclosure)

**Branch:** `feat/vehicle-life-m3-ai-temporal-disclosure` → base `feat/vehicle-life-m2-ingestion` (stacked)
**Program:** Vehicle Life Intelligence (master plan PR #89, §7-§9)
**Status:** Draft. **Do not merge** without explicit `merge this PR now`. Retarget after predecessors merge.

## Exact scope

Replaces mock-only AI with a typed, durable, provider-agnostic analysis layer (live Gemini
retained for OCR + deterministic mock for tests), perceptual similarity + same-vehicle
validation, a temporal component-change engine, and a seller-disclosure conflict engine — all
strictly advisory and governed (every finding defaults to `pending_review`; nothing auto-publishes).

## Migrations

`database/migrations/20260621140000_ai_temporal_disclosure_intelligence.sql` (additive, reversible):
`ai_analysis_jobs` (durable state machine), `ai_observations`, `temporal_findings`,
`disclosure_claims`, `disclosure_conflicts`. RLS; never exposed to anon. Down drops all.

## Changed files

- **AI:** `ai/analysisProvider.js` (typed contract; mock + live Gemini seam),
  `ai/analysisJobService.js` (durable jobs, manual-review threshold), `ai/similarityService.js`
  (near-dup, cross-vehicle reuse, same-vehicle confidence), `ai/evaluation/runEvaluation.js` +
  `evalDataset.json`.
- **Intelligence:** `intelligence/temporalComparison.js`, `intelligence/disclosureConflict.js`.
- **Routes/wiring:** `routes/intelligenceRoutes.js`, `server.js`.
- **Frontend:** `VehicleTemporalComparison.tsx`, `VehicleDisclosurePanel.tsx`, wired into
  `VehicleDetail.tsx`; `useCarUpApi.ts` + `types/index.ts`.
- **Tests:** `ai-temporal-disclosure.test.js` (11), `intelligence-routes.test.js` (5).
- **Docs:** `AI_MODEL_AND_EVALUATION_CARD.md`, `TEMPORAL_AND_DISCLOSURE_POLICY.md`, this file.

## Test results

- `node --test`: **28 pass** (engines 11, routes 5, plus M1/M2 regression) + eval harness runs.
- tsc + vite build: clean (frontend agent verified).

## Security / privacy / governance

- AI advisory only — no job changes verification_status or trust (asserted in tests).
- Findings/conflicts default `pending_review`; buyers see only reviewer-confirmed, public-safe
  output; raw model output + internal explanations stripped by the route allowlist.
- Same-vehicle confidence gates temporal publication; disclosure wording is neutral, never
  accusatory; original claim text retained internally; seller responses appended to immutable
  correction history.
- All new tables RLS-protected; never exposed to anon.

## Rollout / rollback

- **Rollout:** apply migration (additive). Live AI activates only when `GEMINI_API_KEY` set and
  `ALLOW_OCR_MOCK!=='true'`; otherwise deterministic mock.
- **Rollback:** migration `-- +migrate Down`; revert branch. No impact on M1/M2.

## Remaining blockers / follow-ups (external)

- **Real AI quality numbers** require running the eval harness against the live provider with a
  consented/synthetic image+document set (data + provider budget) — harness is ready; numbers
  are NOT claimed as done. Current eval numbers are mock-pipeline validation only.
- Live vision for component/viewpoint beyond OCR/damage is a follow-up (mock fallback today).
- Reviewer confirm/amend actions for findings land in **Milestone 5** (governance).
