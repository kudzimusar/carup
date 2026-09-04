# O2-X5A — Stakeholder Workbook Catalogue + CarUp AI Workbook Assistant: Implementation Plan & Certification Contract

- **Branch:** `feat/operations-o2-people-compliance` · **Starting head:** `0d1a3a74` (X5 accepted)
- **Date opened:** 2026-09-04 · **Scope:** X5A ONLY — X6/X7 not started; **P7 remains BLOCKED /
  NOT EXECUTED**; live biometric provider remains **NOT ACTIVATED**.
- **Companion manual (the durable reference):**
  `CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md` — the stakeholder roll-call, workbook
  compositions, field registry and exposure matrix live THERE; this file is the execution
  checklist and certification contract.

## The laws of X5A

> **CarUp maintains one governed bulk-data architecture, but exposes only the correct workbook
> to the correct stakeholder for the correct task.**

> **Exhaustive catalogue ≠ expose everything to everyone.**

> **AI is an explicit user-facing workbook tool. AI proposes, explains and checks; authoritative
> domain services decide.**

Standing O2 laws continue to bind every item below: *Security protects Trust. Truth earns Trust.
Trust permits Speed. Speed must never manufacture Truth.* And: *identity verified ≠ Dealer
compliant ≠ Seller authorised ≠ Vehicle registered ≠ Vehicle trusted* — a workbook may carry
claims, candidates and evidence references; it may never import an authority outcome.

## Why X5A exists

X5 proved the governed import engine end-to-end for the Dealer onboarding lane (semantic mapping
→ checksum-bound human confirmation → the existing diaspora dry-run truth gate) but did **not**
provide a complete stakeholder-specific template/export/import UX: there is no stakeholder
catalogue, no complete Seller/Dealer *vehicle* workbook covering the current sell-flow fields, no
Template / Export / Import / Recent Imports workspace, no universal field registry, and the AI
mapping that exists is invisible plumbing rather than a product capability. X5A closes exactly
that gap — **without** building a second import engine, a second history store, or any new
authority surface.

## Non-negotiable execution order

1. **Stage A — documentation first.** This plan + the catalogue manual + the six canonical O2 doc
   updates are authored and committed **before any product code changes**
   (`docs(o2): X5A — stakeholder workbook catalogue and AI intake operating plan`).
2. **Stage B — implementation from the documents.** The repository documents are the
   implementation authority. The checklist below is the roll-call; items close only with
   evidence; if reality contradicts the plan, the plan/catalogue is corrected FIRST, in the same
   change.

## Architecture (one governed pipeline, many governed exposures)

```
Workbook Field Registry (versioned constants — canonical keys, human labels, help,
│ vocabularies, importability, exportability, stakeholders, worksheets, authority
│ class, AI flags, privacy class, validation)
│
├─► Template catalogue service (SERVER-derived stakeholder eligibility →
│     available/unavailable templates + allowed actions)
│
├─► XLSX engine (the EXISTING diaspora ExcelJS service, generalized to accept a
│     template OBJECT; string template types keep byte-identical diaspora behavior)
│     · generateTemplate → header keys + help row + dropdowns + hidden reference
│       sheet + Instructions (schema version, template key, timestamp, privacy)
│     · parseWorkbook → normalized {templateType, sheets} payload (formulas never
│       evaluated; EXAMPLE rows dropped)
│     · exportWorkbook → server-sourced rows, formula-neutralized, redacted
│
├─► Import chain (per template family):
│     file → inspect → deterministic mapping → AI mapping (headers only)
│          → human correction → mapping confirmation (checksum-bound)
│          → validation → dry run → review → explicit confirmation
│          → governed execution → receipt
│     · diaspora templates: the EXISTING chain, untouched
│     · seller/dealer vehicle templates: a NEW executor that writes ONLY through
│       canonical vehicle/listing services — never a second raw-table importer
│
├─► Batch/receipt store: the EXISTING diaspora_workbook_import_batches /
│     _rows / _receipts tables (template_type is free text — new template keys
│     land in the SAME store; no second history store)
│
└─► CarUp AI Workbook Assistant (explicit UI component): map columns · explain
      field · check workbook · suggest corrections · explain errors · find
      duplicates/conflicts · summarize import · "what still needs attention"
      — deterministic checks first; AI receives headers/errors/minimal safe
      context; every AI output is a visually-distinct PROPOSAL
```

### Exposure rule

**Catalogue availability is server-derived.** Eligibility comes from the authenticated user +
registration profile + dealer application/tenant + governed role/relationship + domain authority
— never from a role-like string in a request body, and never from client-side hiding alone. The
backend returns the allowed catalogue (with honest `unavailable` reasons); the UI renders it.

### Engine-reuse contract (binding on Stage B)

- `diasporaWorkbookXlsxService` is generalized minimally: its three entry points accept a
  template **object** in addition to the known diaspora template-type strings, and the reference
  sheet reads `template.referenceSheets` (which for diaspora strings is the same constant it uses
  today). Diaspora behavior stays content-identical (raw .xlsx bytes are inherently
  nondeterministic — zip entry timestamps — so the parity pin compares parsed content);
  `diaspora-workbook-xlsx.test.js` must stay green unmodified.
- The diaspora planning/review/confirmation/execution chain is **not modified**. Seller/dealer
  vehicle imports get their own validation/dry-run/execution services that reuse the SAME
  security utilities (`sha256Checksum`, `assertAllowedSpreadsheet`, `neutralizeFormula`,
  `DEFAULT_LIMITS`), the SAME batch/receipt tables, and the X5 mapping-confirmation model.
- The X5 `workbookSemanticMappingService` is generalized so canonical columns can come from the
  field registry as well as `getXlsxTemplate` — deterministic aliases first, HEADERS ONLY to AI,
  allowlist-validated, failure → unmapped. Its X5 behavior and pins stay green.

## AI Authority Matrix (enforced, tested)

| AI action | Allowed? |
|---|---|
| map source header → canonical field | yes — proposal |
| explain a field (meaning + permitted values, from the registry) | yes |
| explain an error in plain English | yes |
| normalize clear terminology (e.g. `Auto` → `Automatic`) | proposal only, distinct from deterministic normalization |
| identify a missing required field | yes |
| identify duplicates/conflicts (VIN, references) | yes |
| summarize a dry run | yes |
| generate a missing VIN | **NO** |
| invent mileage | **NO** |
| invent registration status | **NO** |
| mark identity verified | **NO** |
| approve Dealer Compliance | **NO** |
| create Seller Authority | **NO** |
| establish ownership | **NO** |
| mark evidence verified | **NO** |
| calculate/write Vehicle Trust directly | **NO** |
| bypass human mapping confirmation | **NO** |

The Assistant is useful because it **reduces cognitive work**, not because it invents facts.
Where the correct answer is unknown (missing mileage, missing VIN), the Assistant says so and
asks the human. AI failure degrades to manual mapping/validation — never to silence, never to a
guess.

## Template / Export / Import / Recent Imports (the four first-class actions)

- **TEMPLATE** — download the correct canonical workbook for the current stakeholder/task
  (registry-generated, versioned, with instructions/help/dropdowns/reference vocab).
- **EXPORT** — server-sourced workbook of data the caller is authorized to export (DB-backed,
  owner/tenant-scoped, redaction enforced; caller-supplied rows are NEVER a trusted export).
- **IMPORT** — the full governed chain above; nothing writes before explicit confirmation of a
  checksum-bound, human-confirmed mapping and a reviewed dry run.
- **RECENT IMPORTS** — the caller's/tenant's own batches from the existing store: filename,
  template, time, row counts, status, warnings/errors, result, receipt, continue/retry where
  governed.

## Google Sheets compatibility

The source of truth is CarUp's versioned workbook schema. Generated `.xlsx` files must open,
edit and re-export correctly in Microsoft Excel AND Google Sheets (import/edit/export). No
second Google-Sheets-specific schema exists. A future "Open/Make a copy in Google Sheets"
convenience uses the same canonical workbook — documented as a potential integration, not a
separate data model.

## Template versioning

Every generated workbook carries: schema version, template key, generated timestamp,
compatibility information, privacy notice, instructions (the Instructions sheet + export meta
sheet already provide the carrier). Uploads of unsupported old versions fail with a clear
"template version is no longer supported" message and an upgrade path — incompatible old columns
are never silently interpreted.

---

## Stage A checklist (documentation gate)

- [x] A1 This plan authored with the three laws verbatim
- [x] A2 `CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md` authored as the permanent
      manual (stakeholder roll-call §1, dispositions, workbook compositions, worksheet→contract
      map, field registry, exposure matrix, AI section, privacy/authority classes)
- [x] A3.1 Expansion plan: X5A inserted between X5 and X6 with the why-it-exists statement
- [x] A3.2 Implementation plan: X5A post-core deliverable + gate added (history untouched)
- [x] A3.3 Discovery doc: X5A discovery section (existing template system, XLSX generation,
      template families, X5 mapping, the six named gaps)
- [x] A3.4 Matrices: Stakeholder × Workbook, Worksheet × Authority, AI action × Authority,
      field authority classification, exposure/eligibility matrix
- [x] A3.5 Progress tracker: stale "X5+ NOT started" header corrected (history preserved),
      X5A items added as the live roll-call
- [x] A3.6 Who-must-act: workbook responsibility states added from the EXISTING vocabulary
- [x] A4 Stakeholder universe exhausted repo-backed (every stakeholder dispositioned
      SUPPORTED_WORKBOOK / CONDITIONAL_WORKBOOK / NO_WORKBOOK_API_OR_UI_IS_CORRECT /
      DEFERRED_CANONICAL_WORKFLOW_MISSING / INTERNAL_ONLY — none absent)
- [x] A5 Vocabulary separation recorded (registration context ≠ auth role ≠ organization type
      ≠ workflow participant ≠ authority relationship)
- [x] A6 Canonical Workbook Field Registry documented (all 18 properties per field)
- [x] A7 Current Seller/vehicle user-enterable fields exhausted (identity, registration,
      listing, accident history, insurance, finance disclosure, media, evidence)
- [x] A8 Task-specific workbook compositions defined (reusable worksheet modules; no
      100-column sheet)
- [x] A9 Exposure matrix documented (server-derived; per-stakeholder allowed/denied examples)
- [x] A10 CarUp AI Workbook Assistant defined as a product capability (8 user-facing functions)
- [x] A11 AI Authority Matrix documented (above) — enforcement obligations named
- [x] A12 Template/Export/Import/Recent Imports model documented (above)
- [x] A13 Google Sheets compatibility documented (above)
- [x] A14 Internal consistency check run (all task-listed stakeholders present; 32 dispositions; X5A referenced in all six canonical docs); docs-only commit made — SHA recorded below

**Stage A docs commit:** `72acf7e0` — `docs(o2): X5A — stakeholder workbook catalogue and AI intake operating plan` (8 files, +878; BEFORE any product code)

---

## Stage B checklist (implementation roll-call — close only with evidence)

- [x] B1 **Workbook Field Registry (code)** — `backend/constants/workbook/workbookFieldRegistry.js`:
      versioned, powers template generation/labels/help/validation/vocabularies/stakeholder
      applicability/worksheets/importability/exportability/AI-safe metadata; authority-only
      fields not importable — **`backend/constants/workbook/workbookFieldRegistry.js` (`carup_workbook_registry.v1`, vehicle schema `2026.09.x5a.vehicle-v1`); vocabularies imported from owning modules (registration lifecycle, disclosures, CLAIM_VISIBILITY, evidence taxonomy, shared taxonomy catalog); FORBIDDEN_WORKBOOK_COLUMNS (30) refuse governed results + the 11 private-banking keys; suite 8/8 incl. the create-route destructure tripwire**
- [x] B2 **Engine reconciliation** — xlsx service accepts template objects; diaspora string
      behavior byte-equivalent; `diaspora-workbook-xlsx.test.js` green unmodified — **engine accepts template objects (`requireTemplate` + `template.referenceSheets`); diaspora `diaspora-workbook-xlsx.test.js` 24/24 UNMODIFIED; content-parity pin green (bytes are zip-timestamp nondeterministic — parity is parsed content); X5 mapping service generalized (registry labels resolve deterministically; dealer scope preserved) with X5 suites 16/16**
- [x] B3 **Template Catalogue API** — server-derived available/unavailable with reasons; no
      request-body eligibility — **`workbookCatalogueService.resolveWorkbookCatalogue` + `requireTemplateAction` (fail-closed per call) + GET /api/workbook/catalogue; eligibility from role + X2 registration profile + X5 dealer context + VERIFIED trade profiles; exposure suite 7/7 incl. forged-actor pin**
- [x] B4 **Seller/Dealer vehicle workbook** — covers the documented current user-enterable
      Seller capability across normalized sheets; intentional exclusions recorded in the registry — **seller_vehicles + dealer_vehicle_inventory: inspect (version gate) → per-sheet checksum-bound confirmations → validation/dry run (labels/aliases→canonical, markers refused, VIN grouping, existing-Passport rejection) → batch/rows in the EXISTING store → explicit confirm → execution replaying canonical POST /api/vehicles/add per vehicle (stable client_submission_id) + canonical evidence upload; suite 10/10**
- [x] B5 **Importer/Exporter templates** — reuse diaspora contracts/labels; canonical keys
      preserved — **importer/exporter/supplier/enterprise/container templates = the EXISTING diaspora catalog exposed by verified trade-profile role (engine `diaspora`); no second schema; labels stay canonical diaspora keys**
- [x] B6 **Other stakeholders** — only safe templates; deferred ones honestly unavailable — **garage/mechanic/insurer/lender/government/fleet surface as honest `unavailable` entries with reason codes; deferred-stays-deferred pinned**
- [x] B7 **CarUp AI Workbook Assistant (UI + endpoints)** — visible component; proposals
      visually distinct from deterministic/user/canonical values — **`workbookAiAssistantService` + 3 assistant routes + the NAMED assistant panel in WorkbookWorkspace; provider badges distinguish deterministic vs AI PROPOSAL vs unmapped; suite 6/6**
- [x] B8 **Cell/row-level attention** — issues table (row, field, issue, suggestion, action);
      no fabricated suggestions — **attention report (sheet/row/field/severity/message/explanation) + suggestions table semantics: deterministic normalization vs AI proposal (requires_confirmation) vs needs_user_value with NO suggested value for the unknowable**
- [x] B9 **Export** — server-sourced, scoped, redacted — **`workbookDbExportService.exportVehicleWorkbookFromDatabase` — vehicles by current_seller_id (+ dealer BUSINESS/BRANCHES from own profile); engine/chassis redacted by default; values export as human labels; no caller-rows path; suite 4/4**
- [x] B10 **Recent Imports** — existing store reused, server-scoped — **GET /api/workbook/recent-imports over `diaspora_workbook_import_batches` filtered by uploaded_by + vehicle template keys; uploader-scoping pin green; migration `20260904090000` loosens two NOT NULLs only (no second store)**
- [x] B11 **No re-entry acceptance** — imported values appear in normal pages without
      re-typing (exceptions only as documented) — **the NO-RE-ENTRY PIN (o2-x5a-vehicle-workbook, test 10) proves every importable VEHICLES/LISTINGS/disclosure/media field lands in the canonical create payload under the exact keys the certified route persists and the site reads back (SellVehicle draft restore, VehicleProfile); execution replays that route, so imported values ARE site values. Exceptions stay the documented §4 list: authority decisions, evidence review, missing fields, media/evidence referenced-not-ingested, intentionally non-importable fields**
- [x] B12 **Terminology UX** — human labels/help/dropdowns/instructions; canonical values
      unchanged — **workbook headers/cells are human labels (registration presentation map, disclosure labels, visibility sentences, Yes/No); canonical values travel underneath; label↔canonical round-trip pinned in registry + import suites**
- [x] B13 **Security/authority protections** — the authority-import refusal list proven;
      X5/diaspora refusal gates green — **registry contains no forbidden column (pin); mapping confirm + dry-run refuse forbidden targets (pins); execute payload proven to carry NO authority keys; diaspora/X5 refusal gates re-run green in the regression batch**
- [x] B14 **Stakeholder exposure tests** — every catalogue disposition proven — **o2-x5a-catalogue-exposure 7/7: owner/applicant/active-dealer/diaspora-role/unverified/forged-actor/deferred + regulated-role refusals; uploader scoping in the workbook suite**
- [x] B15 **Completeness tests** — registry vs current Seller user-enterable contract; drift
      fails loudly — **registry suite: vocab equality vs owning modules, web source pins, and the create-route destructure tripwire (an unaccounted new key fails by name)**
- [x] B16 **Template versioning** — version carried; unsupported versions fail with upgrade
      message — **Instructions sheet carries schemaVersion/templateType/generatedAt; inspect + dry run refuse a mismatched version with `TEMPLATE_VERSION_UNSUPPORTED` + upgrade path (pinned)**
- [x] B17 **Workbook workspace UI** — Template | Export | Import | Recent Imports + visible
      Assistant; config-driven shell reused across stakeholders — **`WorkbookWorkspace.tsx` shared shell (Template | Export | Import | Recent Imports + assistant); `/workbook-tools` catalogue-driven page; embedded in Dealer onboarding for dealer_vehicle_inventory; web suites 7/7 new (+ DealerOnboarding 4/4, RegistrationJourney 11/11 unaffected), tsc clean**
- [x] B18 **Docs stay live** — this checklist + tracker updated per unit; catalogue updated on
      every field/exposure/deferral/AI change — **checklist evidenced per item as units landed; one architecture correction recorded in-place (byte→content parity, with the zip-timestamp reason); tracker X5A.2-X5A.8 updated below; no catalogue §2/§5 divergence arose (implementation followed the manual)**
- [x] B19 **Certification** — full list in the contract below — **all green: targeted 271/271 · full backend 5906 (5885/0/21) · full web 1585/1585 · tsc 0 · lint NET_NEW 0/0 · diaspora xlsx suite unmodified · X1–X5/P1-C lanes inside the full run**
- [x] B20 **Receipt** — `CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_RECEIPT.md` — **authored with SHAs, 32 dispositions (7/8/9/3/5), templates, deferrals, counts, confirmations**

## Certification contract (B19)

**Catalogue:** every discovered stakeholder dispositioned; none absent by accident.
**Field coverage:** mature Seller/Dealer user-enterable importable fields covered; Diaspora
contracts covered; intentional omissions documented in the registry/manual.
**Templates:** valid XLSX; Google-Sheets importable; help/instructions present; dropdowns work;
reference vocabularies protected; EXAMPLE rows cannot import.
**AI:** obvious in UI; deterministic precedes AI; headers/minimal safe context only; cannot
invent authority or silently fill facts; material suggestions require user confirmation; failure
degrades to manual.
**Import:** dry run · mapping confirmation · checksum · validation · confirmation · execution ·
compensation · receipts · recent imports.
**Export:** server-sourced, scoped, redacted.
**UX:** imported fields visible in normal pages without re-entry; human-readable terminology;
attention-only review possible.
**Security:** cross-user/cross-dealer/cross-tenant denied; authority outcomes blocked;
protected/private data not leaked.
**Regression:** X1 guards · X2 · X3 · X4 · X5 · P1/P1-C · diaspora workbook suites · seller
suites · dealer suites · full backend · full web · typecheck · lint NET_NEW 0 — all green.

## Stop condition

X5A stops (and X6 does not begin) only when the fifteen conditions of the task's stop list hold,
the receipt exists, code+docs are committed and pushed, and local == origin with a clean tree.
Then STOP for Product Owner review. **Do not merge.**
