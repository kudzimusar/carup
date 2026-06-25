# Vehicle Trust OS — Staging Product UAT Report (Phase 19)

**Date (UTC):** 2026-06-26 · **Staging project:** `eoyenigwevnxwwhyhaer` (migrations applied 10/10).

## Status: UAT NOT EXECUTED in this environment (deployment blocker)

A real staging **deployment + interactive UAT** of the integrated web/mobile app could not be
performed here. This is an **environment/capability blocker**, stated honestly — not a pass:

- Deploying the web + backend to staging requires Vercel deploy credentials/CLI access and an
  app-serving environment that is **not available** in this working context.
- Interactive + Playwright UAT requires the deployed, seeded staging app (web URL + backend).
- Per the task constraints, this agent does not point E2E at production and does not deploy production.

**No UAT step below may be reported as passed.** They are defined and ready to run once staging is
deployed by an operator with deploy access.

## Evidence that DOES exist (qualified, not a substitute for interactive UAT)

- **Staging migrations:** 10/10 applied to `eoyenigwevnxwwhyhaer`; 20 tables + view + columns + RLS +
  policies + grants + 12 append-only triggers verified (`STAGING_MIGRATION_REPORT.md`).
- **Golden Vehicle Journey:** 29/29 end-to-end steps against the live staging schema, transactional
  (rolled back, zero residual) — covers create→identity→evidence→OCR→mismatch→review→publication
  gate→ownership transfer→relist→report v1/v2 immutability→public/private + cross-tenant
  (`GOLDEN_VEHICLE_EVIDENCE_REPORT.md`).
- **Backend tests:** full Vehicle Trust `node:test` suite 221/221 (20 files) at release commit; new
  extraction-routes + audit-immutability = 24/24 at integration commit.
- **Web (Vitest):** 330/330 tests pass (tsc exit 0 + vite build exit 0).
- **New Phase 11 seller completeness:** `VehicleCompletenessPanel.test.tsx` 15/15.

## UAT script to run on the deployed staging app (15 steps — all PENDING)

Use synthetic labelled data only (VIN prefix `UAT-`). Do not use real customer identity documents.

1. Seller creates a vehicle (draft). — PENDING
2. Seller uploads documents. — PENDING
3. OCR extracts fields; processing states visible (queued/processing/extracted/needs_review). — PENDING
4. A deliberate mismatch enters review; ExtractionReviewPanel shows per-field confidence + mismatch. — PENDING
5. Admin reviews evidence + extractions (confirm/reject/amend/waive in ExtractionReviewPanel). — PENDING
6. After draft save, completeness panel shows missing documents, completeness %, blocking gaps. — PENDING
7. Completeness changes as evidence is added; percentage updates. — PENDING
8. Publication gate passes/fails correctly (`is_publishable` must be true before publish). — PENDING
9. Published vehicle appears in marketplace. — PENDING
10. Buyer opens trust summary (separated identity/completeness/confidence/trust/risk/publication; no generic "verified" badge). — PENDING
11. Buyer opens passport + evidence timeline. — PENDING
12. Buyer generates report (version + generated-at; no unsupported live-government claims). — PENDING
13. Ownership transfer preserves history (same VIN passport; previous evidence not deleted). — PENDING
14. Cross-user access rejected; private documents inaccessible publicly. — PENDING
15. Mobile user completes the equivalent supported journey (passport, garage OCR, KYC; logout clears verification store). — PENDING

## Recommendation

Hand the deployed-staging UAT to an operator with Vercel deploy access (staging `eoyenigwevnxwwhyhaer`
only). The code is implemented + unit/integration-verified; the interactive staging UAT gate is the
remaining step before declaring product-integration UAT green.

**Hard blockers before production cutover (in addition to UAT):**
1. Gate 15 credential rotation (`vhmnajoeicasaigiophh` — not remediated in this task).
2. Staging interactive UAT green (15 steps above).
