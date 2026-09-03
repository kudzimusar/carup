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
  today). Diaspora behavior stays byte-equivalent; `diaspora-workbook-xlsx.test.js` must stay
  green unmodified.
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
- [ ] A14 Internal consistency check run; docs-only commit made — SHA recorded below

**Stage A docs commit:** _(recorded at the A14 gate)_

---

## Stage B checklist (implementation roll-call — close only with evidence)

- [ ] B1 **Workbook Field Registry (code)** — `backend/constants/workbook/workbookFieldRegistry.js`:
      versioned, powers template generation/labels/help/validation/vocabularies/stakeholder
      applicability/worksheets/importability/exportability/AI-safe metadata; authority-only
      fields not importable
- [ ] B2 **Engine reconciliation** — xlsx service accepts template objects; diaspora string
      behavior byte-equivalent; `diaspora-workbook-xlsx.test.js` green unmodified
- [ ] B3 **Template Catalogue API** — server-derived available/unavailable with reasons; no
      request-body eligibility
- [ ] B4 **Seller/Dealer vehicle workbook** — covers the documented current user-enterable
      Seller capability across normalized sheets; intentional exclusions recorded in the registry
- [ ] B5 **Importer/Exporter templates** — reuse diaspora contracts/labels; canonical keys
      preserved
- [ ] B6 **Other stakeholders** — only safe templates; deferred ones honestly unavailable
- [ ] B7 **CarUp AI Workbook Assistant (UI + endpoints)** — visible component; proposals
      visually distinct from deterministic/user/canonical values
- [ ] B8 **Cell/row-level attention** — issues table (row, field, issue, suggestion, action);
      no fabricated suggestions
- [ ] B9 **Export** — server-sourced, scoped, redacted
- [ ] B10 **Recent Imports** — existing store reused, server-scoped
- [ ] B11 **No re-entry acceptance** — imported values appear in normal pages without
      re-typing (exceptions only as documented)
- [ ] B12 **Terminology UX** — human labels/help/dropdowns/instructions; canonical values
      unchanged
- [ ] B13 **Security/authority protections** — the authority-import refusal list proven;
      X5/diaspora refusal gates green
- [ ] B14 **Stakeholder exposure tests** — every catalogue disposition proven
- [ ] B15 **Completeness tests** — registry vs current Seller user-enterable contract; drift
      fails loudly
- [ ] B16 **Template versioning** — version carried; unsupported versions fail with upgrade
      message
- [ ] B17 **Workbook workspace UI** — Template | Export | Import | Recent Imports + visible
      Assistant; config-driven shell reused across stakeholders
- [ ] B18 **Docs stay live** — this checklist + tracker updated per unit; catalogue updated on
      every field/exposure/deferral/AI change
- [ ] B19 **Certification** — full list in the contract below
- [ ] B20 **Receipt** — `CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_RECEIPT.md`

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
