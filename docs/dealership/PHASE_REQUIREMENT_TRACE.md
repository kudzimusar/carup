# CARUP-DEALER-ONB-001-LR01 — PHASE REQUIREMENT TRACE & SOURCE CUSTODY

**Status: INCOMPLETE IMPLEMENTATION — DO NOT MERGE, DEPLOY, PUBLISH OR ACTIVATE.**

- Frozen base/main: `bb9d9900c700873ca57df0ac18a1a5c01f77711a` (confirmed current main at D0).
- Branch: `feat/carup-dealer-1-0-unified-longrun` (isolated).
- Controlling specification: [Master Implementation Plan v1.1](https://github.com/kudzimusar/carup/blob/288d1fb2249bd674fd8f6defd805a32f445ad3e9/docs/dealership/CARUP_DEALERSHIP_1_0_MASTER_IMPLEMENTATION_PLAN_2026-11-03.md).
- Execution instructions: [LR01 full agent prompt](https://github.com/kudzimusar/carup/blob/288d1fb2249bd674fd8f6defd805a32f445ad3e9/docs/dealership/CARUP_DEALERSHIP_1_0_LR01_UNIFIED_IMPLEMENTATION_AGENT_PROMPT.md).
- Workbook factual authority: [20-sheet Google Sheet](https://docs.google.com/spreadsheets/d/10YntHvtk9PhrRjZQEMHWfnZgqT84hisTW_oOnt2ZhNQ/edit), plus attached XLSX.
- Docs-only PR #257: independent; **do not modify or merge**.
- Attached XLSX SHA-256 observed: `a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137`, size 172KB approximately. Source export/live revision must be checked before actual DB import.
- Source data was inspected using the 20-sheet local file and live Google Sheets read, **not inserted into a database in this environment**.

## D0 source accounting (verified)

- **104/104 research/branch records**, exact seed IDs `ZW-DEAL-0001`–`ZW-DEAL-0104`.
- Original `Car Dealers Database!A8:K111`; **row 111 is not a 111-company count**.
- **40** original dealer intake columns; **128** Field Dictionary definitions.
- All **104 parent/branch identity matches are unreviewed**. No distinct legal-company count can be claimed.
- All **104 source-public eligibility cases are PENDING_HUMAN_SOURCE_ELIGIBILITY**, all **104 public profiles NOT_PUBLISHED** in the workbook.
- All logos `PLACEHOLDER_UNTIL_RIGHTS_REVIEW`; this is not 104 legally cleared official logos.
- Live eligibility/published count is 0 in the RESEARCH WORKBOOK. This is **not** an assertion about current deployed production public pages.
- Research contact telephone/email/ownership labels remain RESTRICTED source facts and must not enter a public projection without separate review.
- Do not infer CarUp-verified official dealers from the proposed source-category label.

### Original workbook proposed source categories — not independently approved business classifications

| Workbook source-derived category | Research rows |
|---|---:|
| Official dealer / franchise label — UNVERIFIED | 40 |
| Independent dealer claim | 28 |
| Importer / sourcing claim | 13 |
| Importer / bonded / clearing claim | 6 |
| Premium / luxury dealer claim | 5 |
| Dealer / seller claim — categorize in D0 | 4 |
| Assembler / manufacturing claim | 3 |
| Marketplace / brokerage claim | 3 |
| Dealer and service centre claim | 1 |
| Commercial / heavy vehicle claim | 1 |

### D0–D11 trace ledger

Every phase must reread controlling plan and workbook. `NONE` and `NOT_IMPLEMENTED` entries are intentionally explicit; adding a source file is not evidence that UAT passes.

| Phase | Plan section | Workbook exact worksheet/range | Existing code/canonical owner | Source change | Tests/evidence | Disposition |
|---|---|---|---|---|---|---|
| D0 | §0–§5.5 | Car Dealers Database!A8:K111; DEV1/2/5/8; original 10 | Source XLSX and owner research; importer `importResearchSeed.mjs` | Actual Owner-uploaded original 104 rows exact source SHA verified; native export reconciled; local disposable SQLite 104 inserted/read-back + 104 replay; 10 categories, 26 potential collision pairs, 11 repeated group-hint groups | `SOURCE_104_LOCAL_AUDIT_2026-11-04.md`; actual-source JSON; source grouping logic and tests | SOURCE_AUDIT_PASS_SQLITE_ONLY; REAL_POSTGRES_IMPORT_NOT_EXECUTED; 104 HUMAN_PUBLICATION_DECISIONS_PENDING |
| D1 | §4 | DEV2, DEV3, DEV8/9 | Existing Corporate/AUTH, tenant_users, dealer_profiles and branches | 15 additive candidate migrations through `20261103138000` for research, claim, OCR, privacy, legal/activation, source contact/grouping, operating declarations, full storefront, canonical staff, transaction feedback candidates and private branch details | `database/test/dealer_1_0_pglite_check.mjs`; exact-head CI requested | CANDIDATE_SOURCE_ONLY; NO_SHARED_OR_PRODUCTION_MIGRATION |
| D2 | §4.4, §8.2 | DEV5; DEV9; DEV10 | Dealer Compliance and research public projection | Atomic independent compliance reviewer, password step-up, profile column grant hardening, research takedown/claim controls, current source contact restrictions | dealer-compliance.test.js; dealer-research-service.test.js; isolated PGlite | SOURCE_HARDENING_DONE; NO_REAL_SECURITY_PENTEST_OR_DEPLOYED_PROOF |
| D3 | §5.2–§5.6 | DEV3; Dealer Profile Intake!A1:AN105; DEV2 | Dealer intake/service + claim private authority | Claim-bound 12-tab XLSX, source prefill, offline edit/import, read-back versioned draft, original CSV header preview/confirmed import, manual signer/consent | dealer-intake-workbook; dealer-workbook-roundtrip; dealer-csv-migration tests | MOST_SOURCE_CONTRACTS_PRESENT; REAL_CLAIMANT_EXCEL_UAT_PENDING |
| D4 | §5.5–§6 | Car Dealers Database!A8:K111; DEV8!A2:U105; DEV9/10 | Private research seed and approved source projection | Source importer, no-merge duplicate/group signals, independent one-by-one reviewer queue, restricted field publication contact, public eligible-only unclaimed directory, correction/takedown | Actual 104 local SQLite source audit; grouping tests, synthetic publication PGlite | NO_REAL_POSTGRES_104_COMMIT; 0 HUMAN_REVIEWED; 0 REAL_PUBLIC_PROFILES |
| D5 | §7 | Evidence Register; DEV2/5 | Existing private OCR documents, scanned originals | Local opt-in Tesseract/Poppler; immutable document candidates, source SHA/page provenance, manual-review fallback | dealer-document-candidates.test.js synthetic, PGlite OCR custody | NO_REAL_DOCUMENT_CORPUS_OR_OCR_BINARY_SANDBOX_QUALIFICATION |
| D6 | §8.3 | Verification Tracker; DEV9 S05–S18 | Claim reviews + Corporate/AUTH legal/tenant service | Frozen compliance docket; separate independent legal review and gated idempotent canonical organization+tenant+owner membership, revocation guards, no approved ZW policy seeded | dealer-compliance-application, dealer-legal-activation, PGlite source fixture | CODE_CANDIDATE; NO_REAL_LEGAL_SIGNOFF, REAL_APPROVAL, LIVE_TENANT |
| D7 | §9.1 | Dealer Profile Intake, Buyer Assurance, DEV4 | Canonical dealer profiles, branches, tenant_users, vehicles, Corporate/AUTH | Claim-linked active ordinary-member dashboard, persistent private branch creation/edit with declared GPS and hours, staff invite/revoke to canonical membership, canonical risk-clear dealer follow-up progressing only contact/qualification via audited transaction, six versioned operation/policy sections, VIN tenant-only inventory, canonical Marketplace inquiry tenant-scoped seller inbox with risk-held PII, honest NULL finance/staff counts | dealer-dashboard-authority-route; dealer-staff-membership; dealer-operational-declarations; dealer-tenant-inventory; dealer-tenant-leads tests | INTEGRATION_SOURCE_PRESENT; PHYSICAL_MEMBER_BROWSER, SELLER_PUBLISH, FULL_BRANCH/STAFF_RBAC_UNQUALIFIED |
| D8 | §9.2–§9.5 | DEV8/9, Buyer Feedback Log | Research publication projection + legal/storefront current view | Two-tier stable research/full storefront, reviewed location/contact fields, immutable full-public decision, source correction, buyer-safe terms, no unlicensed logos or fake reviews | dealer-full-storefront, dealer-research-service tests | SOURCE_PRESENT; 0 REVIEWED_REAL_SOURCE_RECORDS, 0 REAL_FULL_PUBLICATION, SEO_BROWSER_UAT_PENDING |
| D9 | §10 | DEV6 Money Flows; DEV5 | PAY-03B PR251, PAY-05 PR254 both draft/unmerged | Truthful tenant-scoped commerce readiness; PAY03B read-only canonical subscription, invoice and payment_transactions snapshot if separately-governed schema exists; separate CarUp/dealer/garage beneficiaries, all prices/charges/entitlements fail-closed | dealer-commercial-readiness.test.js tenant isolation, hold, absent schema and no money provider call | READINESS_INTERFACE_ONLY; BILLING/RECEIPT/PROVIDER_RECONCILIATION_ENGINEERING_NOT_CONVERGED; NO_LIVE_ACTIVATION |
| D10 | §8.1, §11 | DEV2, DEV4, DEV5 | Dealer jurisdiction policy | ZW draft conditional legal checklist; versioned external policy approval table, foreign country fail-closed | dealer-jurisdiction-preview + legal-activation synthetic tests | DRAFT_RULES; NO_ZW_LEGAL_SIGNOFF_OR_FOREIGN_CONFIG |
| D11 | §12–§16 | DEV7 T01–T42; DEV10 S01–S25 | GitHub CI, isolated PGlite, physical UAT | Exact 67 named acceptance cases now individually mapped in `DEV7_DEV10_67_CASE_ACCEPTANCE_MATRIX_2026-11-04.md`; 12 synthetic scenarios distinct from 12 real dealer pilot; source audit + CI | DEV7/DEV10 67-case ledger; latest exact-head CI must be inspected | 0/67 INDEPENDENT_PASSES_CERTIFIED; BROWSER_390/768/1280/1920, REAL_12_DEALER_PILOT, FULL_CI, INDEPENDENT_REVIEW_PENDING |

## 4 November 2026 — LR01-R1 continued source reconciliation and D7 integration

- The Owner's uploaded original XLSX is SHA-256 `a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137`, matching the original stored manifest. The fresh Google Sheets XLSX re-export is a different binary SHA; **all 104 source rows and the complete DEV8 crosswalk match**, while only eight metadata-note cells differ (`START HERE!E22:E27` and `Data Quality!B24:B25`, 166 vs 136). Neither number is a dealer count. Preserve both versions and import only a consciously approved exact SHA.
- Actual 104-research-row source-data audit was executed on disposable **local SQLite**, read-back 104/104 and same-source replay 104/104. Original contacts remain private, all unreviewed/unpublished. **Do not claim this as the PG importer or a certified 104-record live directory.**
- D4 importer now produces candidate duplicate name/address matches and repeated private parent-hint *counts*, without exposing private principals or auto-merging companies; actual source yields 26 potential pair collisions and 11 repeated group-hint sets, neither legally confirmed.
- D7 dealership dashboard now calls canonical `GET /api/dealer/operational-workspace` rather than role-restricted legacy `/api/dealer/profile`, reads only inventory matching the active tenant envelope, exposes a genuine private branch create via `/api/dealer/operational-branches`, and does not display unsafe seller inquiries or fake financial analytics. Static source-route regression test is in CI; physical browser acceptance remains outstanding.
- Reference workbook `DEV 4 - Capabilities` complete 25-case mapping: [`DEV4_C01_C25_ENGINEERING_COVERAGE_2026-11-04.md`](DEV4_C01_C25_ENGINEERING_COVERAGE_2026-11-04.md). Exact 67-case `DEV7/DEV10` matrix: [`DEV7_DEV10_67_CASE_ACCEPTANCE_MATRIX_2026-11-04.md`](DEV7_DEV10_67_CASE_ACCEPTANCE_MATRIX_2026-11-04.md). Neither claims independent full acceptance.
- The 13 candidate migrations and recent code must pass **latest exact-head** isolated CI and a separate independent full system/security/UX review before any integration decision. Earlier eight-migration CI must not be reused as current acceptance.

### 4 November 2026 — Dealer Marketplace and PAY-03B integration continuation

- C15 dealer dashboard now links to a **real tenant-scoped Marketplace enquiry inbox**. The server reads only `marketplace_inquiries` with `seller_tenant_id` matched to the independently approved canonical dealer tenant, blocks mismatched rows, suppresses spam and risky PII, and returns no fictitious sales, successful transactions or financial counts. The dealer does not gain Marketplace admin status-writing authority. `backend/tests/dealer-tenant-leads.test.js` adds privacy/tenant negative cases.
- C24 dealer commercial UI now reads actual PAY-03B subscription, invoice and canonical `payment_transactions` status **only if PAY-03B tables are already installed under separate authorization**. Missing tables return `PAY03B_SCHEMA_OR_CANONICAL_READ_UNAVAILABLE` and null records, never zero. The read performs no payment initiation, provider call, receipt generation or entitlement grant. The `reconciliation_hold` status is shown without converting it to a paid entitlement. Independent PAY-03B and PAY-05 PRs remain draft/unmerged.
- **Cross-programme incompatibility that must remain visible:** the candidate legal activation inserts canonical `tenant_users.role='dealer'` for the owner, while PAY-03B billing write authority allows only `admin`, `administrator`, or `tenant_admin`; never self-upgrade roles or authorize payments by inference. An explicit governed role/finance integration decision is needed before checkout.
- This continuation also corrected an outdated **13-migration** PGlite fixture table-count assertion (27 observed versus 22 stale expected). An earlier exact-head CI failed that assertion and was not accepted; the final changed head must be independently rechecked.

## Core D0 authority and known contradictions

1. `main` contains `backend/routes/dealerRoutes.js`, `backend/services/dealer/dealerComplianceService.js`, `database/migrations/20260626150000_dealer_compliance.sql`, and basic dealer entities. Existing `dealer_profiles` requires a user_id: **research prelistings must not be inserted as verified dealer profiles or ghost user accounts**.
2. The v1.1 plan cites O2/One CarUp route, service, public-directory and workspace functionality on **draft/unmerged PRs #208/#221/#222**, not automatically present at frozen main. Port/reconcile only with exact-source independent review; do not fabricate established code paths.
3. PAY-03B PR #251 and PAY-05 PR #254 are draft/unmerged. Dealer subscription is unpriced/commercially blocked; Paynow Level-1 is garage-owned collections simulator, never CarUp first-party dealer billing or live money.
4. Current compliance `deriveCanPublish` failed to gate `active_state`; buyer summary returned fabricated unresolved-serious-complaint count `0`. Source fixes were committed on this branch with tests, **not yet physically run**.
5. Legacy main `recordDecision` uses non-atomic ledger + profile writes, and base RLS grants direct authenticated INSERT/UPDATE of status and tenant columns. The isolated implementation now adds a service-role-only PostgreSQL atomic RPC, verified independent reviewer password step-up and column-scoped direct user grants. These are **candidate remediations pending exact-head CI and independent certification**, not deployed governance.
6. The additive private research table is source-only and explicitly prohibits direct public / tenant / role authority; migration is **not applied** and actual 104-row DB import is **not executed**.
7. The importer explicitly refuses nonloopback target hosts and requires a matching expected XLSX SHA before a local DB write. Its dry-run validates DEV8 versus raw source and keeps private source contact fields out of output logs; it does not conduct human source publication review.
8. Source categories and parent/group strings are **research observations**; human public eligibility, legal parent verification, logo rights, company claim and full compliance are all separate review decisions.

## 3 November 2026 — LR01 continuation security/claim checkpoint

- Single **Draft/Unmerged** candidate PR: [#258](https://github.com/kudzimusar/carup/pull/258). Frozen main stays unchanged. PR title and description explicitly block merge and deployment.
- Discovered additional claim/evidence/workbook/reviewer work already on the feature branch and reconciled it against the approved research-first programme. No password, private workbook content, claimant evidence or unreviewed research rows have been published in this PR.
- Eight additive database migration contracts now cover private source research, publication review, corrections, claim evidence/decisions, atomic drafts, legacy compliance governance, column-scoped authenticated profile writes, append-only dealer OCR candidates, plus an immutable consented compliance-submission/review docket.
- The legacy unverified-actor bypass through profile table-wide UPDATE/INSERT is now **prohibited by candidate SQL grants**, and governance decisions are made through one DB-atomic maker-checker RPC rather than separate insert/update calls. Real database and independent security review are still pending.
- Workstream D5 now has **candidate-only source and synthetic tests**. An explicit local Tesseract/Poppler opt-in reads the already scanned private original, validates SHA/magic, and emits field/page provenance with null confidence; provider outage creates a manual-review status. **No real OCR provider, PDF security sandbox or independent legal-document qualification has passed**; legacy identity/vehicle OCR remains prohibited.
- D10 has a **Zimbabwe-only draft applicability preview**; foreign countries are blocked pending jurisdiction policy and Zimbabwe law/issuer signoff is outstanding. D9 Paynow/Stripe remains **NOT IMPLEMENTED/UNAUTHORIZED**. No real money, legal entitlement or national regulator verification is inferred.
- **Release disposition BLOCK** until exact-head isolated plus full system CI, realistic source publication/claim adjudication, 67-case matrix, 12-dealer pilot, human/physical Chromium UAT, commercial gates and independent acceptance.

### D6 claim-to-compliance submission continuation — 3 November 2026

- The applicant's independently claim-approved 12-tab workbook now supports an explicit frozen-version application submission with signer, research-confirmation, privacy acknowledgment and applicant attestation. This **does not prove independent signer authority**.
- SQL refuses missing or stale source/draft evidence, missing ZW/legal identity, unconfirmed research, missing branch, missing private original company-authority evidence, omitted signer or privacy acknowledgment and spoofed claimant. A frozen applicant snapshot is immutable, source/version/hash bound and retry-idempotent; direct anonymous/authenticated read/write are disallowed.
- A separate verified independent reviewer must password-reauthenticate to view sensitive frozen applications and to record an append-only finding. Allowed outcomes: NEEDS_CORRECTIONS, EVIDENCE_REQUIRED or READY_FOR_REGULATORY_REVIEW. **None is legal compliance approval or tenant activation**.
- Applicant status and review feedback are shown privately. Corrections update the editable draft and produce a new versioned submission; prior submissions are preserved for audit. Historical source and prior case custody are not silently overwritten.
- Source candidate implementation and isolated test coverage are added; **real compliance, legal policy, organization/tenant provisioning and physical owner UAT remain unexecuted**.

### D4 seed-first reviewer control — 3 November 2026

- Added private allowlisted research reviewer queue at `/admin/dealer-research-review` with exact source ID, original row, researched name/city, unverified category and revision. Original telephone, email, named principal, raw source row and reviewer note never enter this queue projection.
- Each row requires its own documented human review; a new unclaimed public research prelisting requires at least 80 characters of case rationale and an independent password reauthentication. Withheld/duplicate/disputed records never render publicly. There is **no bulk publication** button.
- No reviewer has actually adjudicated the 104 source records, the private workbook has not been committed, and no remote/shared DB has been seeded. **A useful live 104-dealer directory is still blocked by lawful source/data checks and controlled deployment**.
- The reviewer queue is **implemented source code pending exact-head CI**, not authenticated real-staging UAT.

### D5/D10/D11 candidate checkpoint — 3 November 2026

- Eight additive PostgreSQL migrations, including document OCR candidate custody and a frozen D6 application-review docket. All SQL writes are limited to the isolated branch; **none applied to shared, staging or production**.
- [Exact-head D5/D10 isolated CI run 41603272240](https://github.com/kudzimusar/carup/actions/runs/41603272240) passed source/contract tests, seven-migration apply/rollback/reapply, web TypeScript and build. A later synthetic 12-scenario case file exists in the branch; **its own new exact-head CI must be reviewed before citing its pass**.
- OCR uses a **local-only** provider seam off by default, not the legacy fake-confidence Gemini identity OCR. It cannot grant legal status. Multi-page PDF has explicit render/page-count boundaries but **real-process qualification with sandboxing has not been executed**.
- Twelve **synthetic** dealer scenarios now target unclaimed, withheld, disputed, grouped branch, franchise, importer/bonded, restrictions, foreign country and OCR conflicts. D7 now has a read-only canonical tenant member count and negative-path tests, but no staff headcount, role assignment or revenue claims. These scenarios are **not** the required **12 actual dealers** or 67 named T/S acceptance cases.
- D10 Zimbabwe draft jurisdiction policy does not represent up-to-date legal verification or binding regulator interpretation. Jurisdiction sign-off and all other country configurations remain blockers.
- Draft PR #258 remains **BLOCKED/UNMERGED**; the remaining programme gates retain their restrictions.

## Source-by-source D0 ledger — no publication decisions represented

| Seed ID | Original A:K row | Research city | Workbook-proposed category (UNVERIFIED) | Source review | Parent/branch review | Public |
|---|---:|---|---|---|---|---|
| ZW-DEAL-0001 | 8 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0002 | 9 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0003 | 10 | Bulawayo | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0004 | 11 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0005 | 12 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0006 | 13 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0007 | 14 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0008 | 15 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0009 | 16 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0010 | 17 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0011 | 18 | Bulawayo | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0012 | 19 | Mutare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0013 | 20 | Kadoma | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0014 | 21 | Chiredzi | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0015 | 22 | Masvingo | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0016 | 23 | Selous | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0017 | 24 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0018 | 25 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0019 | 26 | Bulawayo | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0020 | 27 | Bulawayo | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0021 | 28 | Mutare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0022 | 29 | Gweru | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0023 | 30 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0024 | 31 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0025 | 32 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0026 | 33 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0027 | 34 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0028 | 35 | Bulawayo | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0029 | 36 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0030 | 37 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0031 | 38 | Bulawayo | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0032 | 39 | Victoria Falls | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0033 | 40 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0034 | 41 | Mutare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0035 | 42 | Bulawayo | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0036 | 43 | Gweru | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0037 | 44 | Harare | Assembler / manufacturing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0038 | 45 | Harare | Assembler / manufacturing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0039 | 46 | Mutare | Assembler / manufacturing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0040 | 47 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0041 | 48 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0042 | 49 | Harare | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0043 | 50 | Chinhoyi | Official dealer / franchise label — UNVERIFIED | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0044 | 51 | Harare | Premium / luxury dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0045 | 52 | Harare | Importer / bonded / clearing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0046 | 53 | Harare | Importer / bonded / clearing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0047 | 54 | Harare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0048 | 55 | Harare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0049 | 56 | Harare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0050 | 57 | Masvingo | Dealer and service centre claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0051 | 58 | Gweru | Dealer / seller claim — categorize in D0 | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0052 | 59 | Mutare | Dealer / seller claim — categorize in D0 | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0053 | 60 | Masvingo | Dealer / seller claim — categorize in D0 | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0054 | 61 | Victoria Falls | Dealer / seller claim — categorize in D0 | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0055 | 62 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0056 | 63 | Harare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0057 | 64 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0058 | 65 | Harare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0059 | 66 | Harare | Premium / luxury dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0060 | 67 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0061 | 68 | Harare | Premium / luxury dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0062 | 69 | Harare | Premium / luxury dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0063 | 70 | Harare | Premium / luxury dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0064 | 71 | Harare | Commercial / heavy vehicle claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0065 | 72 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0066 | 73 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0067 | 74 | Harare | Marketplace / brokerage claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0068 | 75 | Harare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0069 | 76 | Bulawayo | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0070 | 77 | Mutare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0071 | 78 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0072 | 79 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0073 | 80 | Harare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0074 | 81 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0075 | 82 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0076 | 83 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0077 | 84 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0078 | 85 | Harare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0079 | 86 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0080 | 87 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0081 | 88 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0082 | 89 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0083 | 90 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0084 | 91 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0085 | 92 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0086 | 93 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0087 | 94 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0088 | 95 | Harare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0089 | 96 | Bulawayo | Marketplace / brokerage claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0090 | 97 | Bulawayo | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0091 | 98 | Bulawayo | Marketplace / brokerage claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0092 | 99 | Bulawayo | Importer / bonded / clearing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0093 | 100 | Bulawayo | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0094 | 101 | Bulawayo | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0095 | 102 | Bulawayo | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0096 | 103 | Gweru | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0097 | 104 | Gweru | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0098 | 105 | Mutare | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0099 | 106 | Mutare | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0100 | 107 | Bindura | Independent dealer claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0101 | 108 | Beitbridge | Importer / sourcing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0102 | 109 | Beitbridge | Importer / bonded / clearing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0103 | 110 | Beitbridge | Importer / bonded / clearing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |
| ZW-DEAL-0104 | 111 | Beitbridge | Importer / bonded / clearing claim | PENDING_REVIEW | UNREVIEWED_GROUPING | NOT_PUBLISHED |


## Additional implementation commits — bounded current source

- Research/public review security: `database/migrations/20261103121000_dealer_research_review_and_claim_intake.sql`;
  `backend/services/dealer/dealerResearchService.js`;
  `backend/routes/dealerResearchRoutes.js` mounted under the **existing** `backend/routes/dealerRoutes.js`.
- Source-safety correction/removal queue: `database/migrations/20261103122000_dealer_research_correction_requests.sql`;
  `web/src/pages/DealerResearchCorrection.tsx`.
- Public UI: `web/src/pages/DealerDirectory.tsx` uses only human-reviewed safe research projection;
  `web/src/pages/DealerResearchProfile.tsx` preserves unclaimed status and the correction and claim actions.
  The source review function is DB-atomic and appends an immutable decision event.
- Claim intake is **AWAITING_DOCUMENTARY_EVIDENCE ONLY**, with no path to APPROVED;
  no new role, tenant, organization or private workbook entitlement is created.
- Blank new-business customer XLSX generator `backend/services/dealer/dealerIntakeWorkbook.js`;
  12 customer-facing tabs from DEV3, explicit dispositions for the 40 original Dealer Profile Intake fields,
  and private-source/authority denial. **It is not dealer-specific prefilled export and there is no upload parser.**
- The GitHub repository is **PUBLIC**. To prevent source-contact/privacy disclosure,
  **the 104 raw names, ownership/principal, phone, email and website fields were NOT committed**.
  The importer reads the original attached XLSX at execution time; no private data is put in Git history.
- Dedicated CI is offline/synthetic, with npm CI, dealership tests, TypeScript and web build.
  Latest exact-head success must be checked on GitHub before any certification claim.

### C01–C25 capability truth at this checkpoint

| Capability | Status | Verified scope |
|---|---|---|
| C01 Seed discovery/claim | PARTIAL | Research source identity, unclaimed public read and pending-evidence claim, **no claim approval** |
| C02 Prefilled claim-bound workbook | BLOCKED | Blank 12-sheet registry/template only, **no approved-claim prefill/roundtrip** |
| C03 Existing-data migration | NOT IMPLEMENTED | Source research parser is not general XLSX/CSV migration |
| C04 AI field mapping | NOT IMPLEMENTED | No authoritative AI mapping or human mapping gate |
| C05 Governed OCR | NOT IMPLEMENTED | Existing Document Intelligence remains; no dealer reconnection |
| C06 Intelligent validation | PARTIAL | Source structural validation and field registry only |
| C07 Save/resume | NOT IMPLEMENTED | Claim interest persisted only; no full intake draft |
| C08 Legal verification | NOT IMPLEMENTED | No independently checked company |
| C09 Conditional regulation | NOT IMPLEMENTED | Legal jurisdiction/issuer review not integrated |
| C10 Independent approval | PARTIAL | Research-only reviewer function; not legal ownership/compliance |
| C11 Organization/tenant activation | NOT IMPLEMENTED | No activation authority added |
| C12 Compliance lifecycle | PARTIAL | Existing service P0 publication/complaints gates corrected, but full event integration lacking |
| C13 Full operating profile | NOT IMPLEMENTED | Workbook schema only |
| C14 Multi-branch | NOT IMPLEMENTED | Branch workbook schema only, no reviewed parent/branch graph |
| C15 Dealer dashboard | NOT IMPLEMENTED | Existing dashboard not upgraded/certified |
| C16 Staff permissions | NOT IMPLEMENTED | Existing Corporate/AUTH untouched |
| C17 VIN inventory | NOT IMPLEMENTED | No new dealer/vehicle integration |
| C18 Public directory | PARTIAL | Governed unclaimed research projection + UI; no approved dealer combined results |
| C19 Upgradeable public page | PARTIAL | Stable seed URL and unclaimed starter page; full upgrade missing |
| C20 Buyer assurance | NOT IMPLEMENTED | Workbook candidate policy fields only |
| C21 Finance disclosures | NOT IMPLEMENTED | Workbook candidate policy fields only |
| C22 Warranty/after-sales | NOT IMPLEMENTED | Workbook candidate policy fields only |
| C23 Genuine reviews/complaints | PARTIAL | Removes fabricated zero; no measured complaint data |
| C24 Commercial subscriptions/Paynow | BLOCKED | PAY-03B and PAY-05 unchanged; unpriced/unapproved, no live charges |
| C25 International jurisdiction | NOT IMPLEMENTED | Workbook country candidate only, no jurisdiction policy engine |

**Release/merge/prices/real provider/independent certification: BLOCKED.**

## Acceptance blockers

- `GOVERNANCE`: no 104 human source/publication reviews. Therefore **no public profiles may be auto-created** from source ingestion.
- `IMPLEMENTATION`: claim, prefilled workbook, OCR, independent activation, real dealer dashboard, public dual projection and services are not finished.
- `RUNTIME`: local PostgreSQL migration, physical importer readback, node tests, exact-head CI and browser UAT not executed from this session.
- `FINANCE`: legal CarUp merchant/prices/provider evidence unavailable; no real Paynow/Stripe action authorized.
- `RELEASE`: never represent branch as independently certified or go-live ready.

## Required continuation

1. Apply SQL to **isolated local PostgreSQL only** after schema/RLS review; run importer in read-only mode with attached XLSX and match digest.
2. Run `backend/tests/dealer-compliance.test.js` and `backend/tests/dealer-research-seed-contract.test.js` plus full existing regressions; repair any failing tests under exact-head custody.
3. Only then execute importer with `--commit-local --expect-sha256=<attached XLSX sha256>` and explicit loopback `DEALER_SEED_DATABASE_URL`; verify 104 private rows and zero newly published profiles.
4. Continue D2–D11 without ever treating initial research seeding or simulated payments as completion.


## 4 November 2026 — LR01-R2 C14 engineering continuation (source-level)

- A fifteenth additive migration, `20261103138000_dealer_branch_operating_details.sql`, adds private latitude, longitude, declared operating hours and guarded rollback **to the existing canonical `dealer_branches`**, not a parallel branch authority.
- Claim/tenant-approved owner create and edit paths validate coordinate pairs, field lengths and authority override attempts server-side. Frontend `DealerDashboard` edits and reloads the canonical branch record rather than retaining browser-only fields.
- Source candidate tests are wired into isolated Node CI and PostgreSQL-compatible PGlite apply/rollback/reapply checks. These are **not** local actual PostgreSQL, authenticated browser or real source-104 golden-journey evidence. Independent C14 acceptance remains unqualified; public display of dealer-declared GPS/hours remains disabled pending review.
- No production/shared schema application, actual source publication, real merchant transaction, merged PR or real-dealer pilot is authorized or claimed.


## 4 November 2026 — LR01-R2 C15 governed Marketplace follow-up source candidate

- A sixteenth isolated dealership migration, `20261103139000_dealer_canonical_inquiry_progress.sql`, provides a guarded PostgreSQL RPC to record owner-reported follow-up directly on the **canonical `marketplace_inquiries` row** and an immutable event audit, with transactionally revalidated legal company, country policy, tenant and actor. Two strictly monotone transitions: `new→contacted→qualified`; risk-held, wrong tenant, wrong owner, direct public/authenticated invocation, duplicate and unsafe state escalations are denied.
- The existing private inquiry UI now submits authenticated follow-up and refreshes from canonical storage. No messaging delivery, successful vehicle sale, moderation, staff assignment, feedback verification, payment, escrow or entitlements are represented. This explicitly does not subsume the broader Marketplace Communications role.
- Candidate unit and PGlite isolated gates are wired but require latest exact-head CI verification. Local physical PostgreSQL, browser/screenshot, actual original XLSX source import and full 67-case independent acceptance remain NOT EXECUTED. Do not publish or release.

## 4 November 2026 — LR01-R2 native 104-row synthetic import implementation

A new `proveSynthetic104NativePostgres.mjs` integration proof generates an ACTUAL 20-worksheet ExcelJS XLSX (all 104 ids and public-safe research category/city distribution, but **fictional dealer names, addresses, contacts and ownership**), parses it through the production research importer, inserts the 104 records into disposable localhost PostgreSQL 17, physically checks immutable row hashes, IDs, categories, pending legal/group/public state and all source crosswalk rows, reimports idempotently, and confirms rollback of a mutated row. A separate native PostgreSQL CI step executes this proof after the 16 migration/authority lifecycle tests.

This synthetic source is **not** the original Owner-uploaded XLSX and has its own SHA. It is not substituted for the Owner's recorded file checksum `a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137`. The authentic private source 104-row import and browser certification remain REQUIRED, NOT EXECUTED. No real contact/legal/parent data is written to the repository or CI fixture. Only the explicit native CI result may upgrade the synthetic 104 importer proof to PASS.

## LR01-R2 actual CarUp browser certification runner — EXECUTION NOT YET PROVEN

The opt-in `dealer-1-0-native-browser-ci.yml` runner uses **no mock HTTP replies**, a disposal-only localhost PostgreSQL 17 service, PostgREST passthrough to the real CarUp Supabase client, the real Express gateway and Vite app, and distinct genuine DB session tokens for *fictional claimant* and *fictional reviewer*. Exactly ONE fictitious source is published by a synthetic reviewer decision, leaving 103 privately unreviewed. The physical Playwright checks are scoped to directory/profile continuity, claim submission, reviewer authorization/queue, and browser screenshots at 390/768/1280/1920. If this runner has not actually passed on the exact head, its status is **NOT VERIFIED**; no screenshots or physical route claims may be inferred from its source code.

Even a fully passing partial-browser gate is **not** the golden journey. The private claimant evidence storage/ClamAV, independent legal authorization, full workbook upload and activation, live VIN listing operating rights, full public profile and 67 independent acceptance cases remain separate unqualified work. The PostgREST bridge deliberately does not fake Supabase Storage/Auth or provider decisions.
