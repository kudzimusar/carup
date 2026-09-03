# O2-X5A — Stakeholder Workbook Catalogue + CarUp AI Workbook Assistant: Certification Receipt

- **Branch:** `feat/operations-o2-people-compliance` · **Date:** 2026-09-04
- **Starting SHA:** `0d1a3a74` (X5 accepted) · **Docs-first gate commit:** `72acf7e0`
  (+ SHA record `c2cdd0a5`) — committed BEFORE any product code, per the X5A law.
- **Code commit:** `06ef4b9a` (22 files, +3744) · **Final docs/receipt commit:** the docs-lane commit carrying
  this receipt (exact SHAs restated in the tracker's X5A.10 line after push).
- **Scope:** X5A ONLY — X6/X7 not started; **P7 remains BLOCKED / NOT EXECUTED**;
  **live biometric provider remains NOT ACTIVATED**; do-not-merge stands.

## The three laws, held

One governed bulk-data architecture with stakeholder-correct exposure (server-derived
catalogue, fail-closed per call) · exhaustive catalogue ≠ expose everything to everyone
(32 dispositioned stakeholders, honest `unavailable` reasons) · AI proposes/explains/checks
while authoritative domain services decide (deterministic-first assistant; NO-row authority
matrix enforced and pinned).

## 1. Execution order (the docs-first gate)

Stage A produced the plan (`CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_PLAN.md`)
and the permanent manual (`CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md`) plus the six
canonical doc updates, committed docs-only at `72acf7e0`. Stage B implemented FROM those
documents with the checklist as the roll-call; the one architecture correction discovered
during implementation (xlsx bytes are zip-timestamp nondeterministic → engine parity is
CONTENT parity, not byte parity) was corrected in the plan IN THE SAME CHANGE as the test.

## 2. Stakeholder catalogue (the roll-call X6/X7 must use)

**32 stakeholder rows, every one dispositioned — none absent:** 7 SUPPORTED_WORKBOOK ·
8 CONDITIONAL_WORKBOOK · 9 NO_WORKBOOK_API_OR_UI_IS_CORRECT · 3
DEFERRED_CANONICAL_WORKFLOW_MISSING · 5 INTERNAL_ONLY. Every required stakeholder from the
task list is present plus repo-discovered actors (enterprise partner, clearing agent, trade
agent/company, customs reviewer, admin sub-operators, member/anonymous, golden fixtures).
The roll-call integrity rule binds future phases: new stakeholder vocabulary anywhere in the
repo requires a new catalogue row with a disposition.

## 3. What shipped (files)

**New:** `backend/constants/workbook/workbookFieldRegistry.js` ·
`backend/services/workbook/{workbookCatalogueService,vehicleWorkbookImportService,workbookAiAssistantService,workbookDbExportService}.js`
· `backend/routes/workbookRoutes.js` · 5 backend suites (`o2-x5a-*.test.js`) ·
`web/src/components/workbook/WorkbookWorkspace.tsx` (+test) ·
`web/src/pages/workbook/WorkbookTools.tsx` (+test) ·
migration `20260904090000_workbook_store_scope_loosening.sql`.

**Edited:** `diasporaWorkbookXlsxService.js` (accepts template objects;
`template.referenceSheets`) · `workbookSemanticMappingService.js` (registry templates;
user-scoped confirmations for vehicle templates — dealer binding preserved) ·
`backend/server.js` (mount) · `web/src/hooks/useCarUpApi.ts` (9 workbook functions) ·
`web/src/App.tsx` (`/workbook-tools`) · `web/src/pages/dealer/DealerOnboarding.tsx`
(embeds the shared workspace for `dealer_vehicle_inventory`).

**Migration (loosening only):** two `DROP NOT NULL`s
(`dealer_workbook_mapping_confirmations.dealer_id`;
`diaspora_workbook_import_receipts.tenant_id`) so the EXISTING mapping/batch/receipt stores
serve the new template keys — no second store, no second confirmation discipline, no other
DDL. **No staging migration was applied** (P7 discipline).

## 4. Templates implemented / deferred

**Implemented (registry engine):** `seller_vehicles` (VEHICLES · LISTINGS · ACCIDENT_HISTORY
· DISCLOSURES · MEDIA · EVIDENCE_NOTES + Instructions + _REFERENCE) and
`dealer_vehicle_inventory` (BUSINESS · BRANCHES + the same vehicle modules).
**Implemented (existing diaspora engine, exposed by VERIFIED trade-profile role):** `buyer`,
`seller`, `supplier`, `enterprise`, `container_reservation` — no second schema, canonical
keys unchanged.
**Deferred/refused, honestly surfaced with reason codes:** garage + mechanic
(`service_network_reconciliation_required` — PR #197), insurer + lender decision workbooks
(`provider_platform_is_the_integration_surface`), government registry
(`governed_activation_lane_exists`), fleet (`no_canonical_bulk_workflow`).

## 5. Field registry coverage

`carup_workbook_registry.v1` / vehicle schema `2026.09.x5a.vehicle-v1`. 52 importable field
keys on `seller_vehicles` (61 on the dealer template) covering the CURRENT user-enterable
Seller contract: identity (15), registration (4, the 8-stage ZW lifecycle with the site's own
labels), listing (9 incl. `location_visibility` and `public_seller_display_enabled` as
human questions), accident history (state + 10-event child rows), insurance/finance
disclosure (5 — the 11 private-banking keys are prohibited AS COLUMNS), media references
(url/label/cover/order; binaries stay on the site uploader), evidence references (always
`pending`, never verdicts). Vocabularies are IMPORTED from their owning modules; catalog
aliases (`Auto`→`Automatic`) are the deterministic normalizer. Intentional exclusions are
documented per-field in `INTENTIONALLY_NON_IMPORTABLE` (claim_type, aliases, interactive
decisions, idempotency machinery). **Drift fails loudly:** vocab-equality pins + web source
pins + the create-route destructure tripwire (an unaccounted new sell-flow key fails
`o2-x5a-field-registry.test.js` by name).

## 6. The AI Workbook Assistant

A NAMED, visible product surface (violet panel in the workspace): map my columns
(deterministic registry matches first — template files resolve with AI never invoked, pinned;
AI proposes only for unresolved headers, headers-only) · explain this field
(registry-served) · check my workbook · suggest correction (deterministic normalization vs
AI PROPOSAL, both visually attributed, both confirmation-gated; the unknowable →
`needs_user_value` with NO suggested value) · explain this error (curated plain English) ·
find duplicates/conflicts (VIN-in-file, existing Passport) · summarize my import (with the
structural "0 authority decisions will be imported" line) · what still needs attention
(errors-first table). **Restrictions enforced + pinned:** no invented VIN/mileage/status, no
verification/compliance/authority/trust writes, no mapping-confirmation bypass; AI failure
degrades to manual mapping/validation.

## 7. Template / Export / Import / Recent Imports

- **TEMPLATE:** registry-generated .xlsx with human-label headers, help row, dropdowns,
  hidden reference vocab, Instructions carrying schema version/template key/timestamp/privacy.
  **Versioning:** an upload stamped with an unsupported version fails
  `TEMPLATE_VERSION_UNSUPPORTED` with the upgrade path — old columns are never silently
  reinterpreted (pinned).
- **EXPORT:** server-sourced from `vehicles` by `current_seller_id` (+ own dealer
  BUSINESS/BRANCHES); engine/chassis redacted by default; canonical values export as their
  human labels; evidence links never export; no caller-supplied-rows path exists (pinned).
- **IMPORT:** file → inspect (version gate + per-sheet proposals) → human mapping
  confirmation (checksum-bound per sheet; forbidden targets refused) → validation + dry run
  (labels/aliases→canonical, markers refused, VIN grouping, existing-Passport rejection) →
  persisted batch/rows in the EXISTING store → review (summary + attention) → explicit
  `confirm=true` → execution replaying the canonical `POST /api/vehicles/add` as the
  importing user (loopback dispatch in production, injected in tests; STABLE per-vehicle
  `client_submission_id` = idempotent retry) + canonical evidence upload → receipts in the
  EXISTING receipts table → batch `IMPORTED`/`PARTIALLY_IMPORTED`.
- **RECENT IMPORTS:** uploader-scoped view over `diaspora_workbook_import_batches`
  (filename, time, counts, status, executability).

**Google Sheets:** one canonical .xlsx; the engine's parser already tolerates
Sheets-exported files (cached formula results only, help-row detection by value, EXAMPLE-row
filtering); the template instructions tell users the Sheets round-trip path. No second schema.

## 8. No re-entry (the core acceptance)

Execution replays the SAME route the sell flow calls, so imported values ARE the site's
values: the NO-RE-ENTRY pin proves every importable field lands in the canonical create
payload under the exact keys the certified route persists (`vehicles` columns +
`listing_images` rows) and the site reads back. Imported vehicles appear as private DRAFTS in
the normal My Vehicles / seller surfaces with nothing to re-type. Exceptions are exactly the
documented list: authority decisions, evidence review outcomes, genuinely missing fields,
media/evidence referenced-not-ingested, and the per-field intentional exclusions.

## 9. Test evidence

- New backend suites **35/35**: field registry 8 · vehicle workbook 10 · catalogue exposure 7
  · assistant 6 · export/parity 4.
- New web suites **7/7**: WorkbookWorkspace 5 · WorkbookTools 2. Affected pages re-proven:
  DealerOnboarding 4/4, RegistrationJourney 11/11. `tsc --noEmit` clean.
- Targeted regression batch **271/271** (X5A ×5, X5 ×2, diaspora workbook ×5 — xlsx suite
  UNMODIFIED, dealer ×2, seller disclosure/finance-authority ×3, X2 routes).
- Lint gate **NET_NEW 0/0** (one interim `set-state-in-effect` finding fixed with the
  established queueMicrotask idiom, then re-run clean).
- **Full backend suite: 5906 tests — 5885 pass / 0 fail / 21 skipped** (X5 baseline 5871 +
  exactly the 35 new X5A tests). Two interim failures were traced, fixed and re-proven: a
  duplicate hook symbol (`executeWorkbookImport` already served the diaspora lane — the X5A
  function is `executeVehicleWorkbookBatch`) had crash-loaded 10 web test files, and one
  navigation-analytics live-HTTP flake (outside X5A's surface) was 25/25 in isolation and
  green in the certifying rerun.
- **Full web suite: 1585/1585** (X5 baseline 1578 + exactly the 7 new); real `tsc --noEmit` exit 0; lint gate **NET_NEW 0/0**.

## 10. Unresolved dependencies (carried, not created)

- **Dealer activation** (X5): approved applicant → active Dealer role/tenant grant path still
  unbuilt; the dealer template works in applicant mode (drafts only) and says so.
- **Service Network** (PR #197): garage/mechanic workbooks deferred until that lane lands.
- **PR #194** unmerged: P7 and every staging concern stay blocked as before.
- Recorded for a v2 decision: full evidence metadata columns (odometer/tags/sources) stay on
  the interactive uploader; local parts-inventory workbook has no canonical owner yet.

## 11. Confirmations

- **X1–X5 remain green** (targeted batches + the full suite at this head).
- **LIVE BIOMETRIC PROVIDER: NOT ACTIVATED** — X5A touched no biometric code or config.
- **P7 NOT EXECUTED** — no staging pairing entries, no staging migrations, no fixtures, no
  deploys, no UAT runs.
- **Recommendation:** X6 is safe to begin, using the catalogue manual §2 as its stakeholder
  roll-call (now a binding rule in the expansion plan and tracker).
