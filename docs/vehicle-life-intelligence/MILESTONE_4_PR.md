# Milestone 4 PR — Buyer-Facing Vehicle History Report

**Branch:** `feat/vehicle-life-m4-buyer-report` → base `feat/vehicle-life-m3-ai-temporal-disclosure` (stacked)
**Program:** Vehicle Life Intelligence (master plan PR #89, §10)
**Status:** Draft. **Do not merge** without explicit `merge this PR now`.

## Exact scope

A CarVertical-class buyer report assembled from M1–M3 data with a strict public-safe allowlist:
identity, key alerts (itemized, evidence-linked — no single unexplained score), life timeline,
auction/import, accident/repair, inspection, mileage history + anomaly detection, ownership,
listing history, before/after visual comparisons, disclosure findings, current condition,
transparent completeness indicators, explicit limitations, and an evidence/source index — plus
immutable report versioning, expiring share links, and correction/revocation.

## Migrations

`database/migrations/20260621150000_report_versions.sql` (additive, reversible): `report_versions`
(versioned, content-immutable via trigger; share token + expiry + revocation + correction notice).
RLS; not exposed to anon (shared access mediated by token via the API).

## Changed files

- **Service:** `report/reportService.js` (assembly, completeness, limitations, mileage anomaly,
  alerts, versioning, expiring share links, revocation).
- **Routes/wiring:** `routes/reportRoutes.js` (report, versions, share, revoke, public shared-token),
  `server.js`.
- **Frontend:** `VehicleHistoryReport.tsx`, `SharedReport.tsx` (+ public route), wired into
  `VehicleDetail.tsx`; `useCarUpApi.ts` + `types/index.ts`. (built by the M4 UI agent)
- **Tests:** `vehicle-report.test.js` (5).
- **Docs:** this file.

## Test results

- `node --test`: **5/5** report tests pass (public vs admin audience boundaries, mileage anomaly,
  completeness/limitations explicit, immutable versioning, share expiry + revocation) + server boot.
- Frontend tsc + build: clean (UI agent verified).

## Security / privacy / governance

- Public report excludes pending/restricted evidence and unconfirmed findings; internal
  explanations and raw model output never leak.
- Missing data is shown explicitly and **never** presented as a clean history (master plan §10.4).
- Report versions are content-immutable; shared links expire and can be revoked with a correction
  notice; the original snapshot is retained.
- AI/temporal/disclosure outputs reach buyers only when reviewer-confirmed + public-safe.

## Rollout / rollback

- **Rollout:** apply migration (additive). Report endpoints are read-mostly; versioning/sharing
  are opt-in actions.
- **Rollback:** migration `-- +migrate Down`; revert branch. No impact on M1–M3.

## Remaining blockers / follow-ups

- Reviewer **confirm/amend** actions that flip findings to `confirmed` (so they surface publicly)
  are delivered in **Milestone 5** (governance) — until then buyer reports correctly show few/no
  AI findings, which is the safe default.
- PDF export is optional and deferred (privacy-safe HTML report shipped); noted in §10.5.
