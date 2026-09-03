# CarUp Stakeholder & Workbook Catalogue — the permanent manual

**Status:** authored 2026-09-04 (O2-X5A Stage A, head `0d1a3a74`), maintained live thereafter.
**Audience:** Product · Engineering · UAT · Operations · future agents · X6 · X7 · every later
workbook expansion. **X6 and X7 MUST use §2 as their stakeholder roll-call.**
**Laws:** one governed bulk-data architecture, stakeholder-correct exposure · exhaustive
catalogue ≠ expose everything to everyone · AI proposes/explains/checks, authoritative domain
services decide · a workbook carries claims/candidates/evidence references, never authority
outcomes.

Every value in this manual is repository-backed; definers are cited as `path:line` at the time
of authorship. If implementation reality diverges, THIS FILE is corrected in the same change.

---

## §1 Vocabulary separation — five different things called "stakeholder"

A workbook must never be exposed because a client sent a role-like string. These five
vocabularies are DIFFERENT FACTS with different owners; exposure derives only from server truth:

| Kind | What it is | Example | Defining source |
|---|---|---|---|
| **Registration context** | Self-declared routing context from signup/X2 — grants NOTHING | `business_type='dealer'` | `database/migrations/20260829123000_user_registration_profiles.sql:18-21` (explicitly non-authorizing at `:2-7`) |
| **Authorization role** | The platform `users.role` the server enforces | `role='dealer'` | DB CHECK `supabase_schema.sql:19`: `owner, dealer, mechanic, insurance, government, bank, admin` (+ backend-only `platform_admin`/`super_admin`, `authMiddleware.js:11`) |
| **Organization type** | What an org IS | `organizations.type='garage'` | `supabase_schema.sql:166`: `dealership, garage, insurance, bank, fleet, import, government` |
| **Workflow participant** | A role INSIDE one workflow | `logistics_provider` (comms), `clearing_agent` (workbook sheet vocab) | `communicationStakeholderContractService.js:1-14`; `diasporaWorkbookSchema.js:15-23` |
| **Authority relationship** | A governed, decided relationship | Dealer tenant membership · Seller Authority (`vehicle_seller_authority`) · verified diaspora trade profile | `tenant_users` (`002_multi_tenant_and_auth_schema.sql:30`); `sellerAuthorityService.js`; `diaspora_trade_profiles.verification_status` (`013_diaspora_trade_schema.sql:121`) |

Signup grants only `role='owner'` (`server.js:2413`, fail-closed). Tenant roles
(`member/admin/manager/administrator/tenant_admin`) are relationships, not identities. The
X5 law stands: `dealer_profiles.tenant_id` is never client-assignable.

---

## §2 Stakeholder universe — the exhaustive roll-call (X6/X7 use THIS list)

Dispositions: **SUPPORTED_WORKBOOK** (a workbook exists for them) ·
**CONDITIONAL_WORKBOOK** (exists, behind a named server-verified condition) ·
**NO_WORKBOOK_API_OR_UI_IS_CORRECT** (deliberate: another surface is right) ·
**DEFERRED_CANONICAL_WORKFLOW_MISSING** (would need domain authority that doesn't exist on
this branch) · **INTERNAL_ONLY** (CarUp-side actor, never a customer workbook).

### Individuals

| # | Stakeholder | Repo evidence | Disposition | Workbook / reason |
|---|---|---|---|---|
| 1 | Individual buyer (local) | role `owner` browsing; marketplace inquiry buyer | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | Browsing, saving, inquiring, escrow are interactive single-record flows; bulk data has no honest buy-side use case on the local marketplace |
| 2 | Private vehicle owner | role `owner`; `vehicles.current_seller_id` | **SUPPORTED_WORKBOOK** | `seller_vehicles` (My Vehicle Listing workbook) — template/export/import/recent-imports |
| 3 | Private seller | same as #2 (listing authority via creation) | **SUPPORTED_WORKBOOK** | `seller_vehicles` |
| 4 | Diaspora customer / sponsor | `diaspora_trade_profiles.role_type='buyer'` (`013_diaspora_trade_schema.sql:120`); plan tier `diaspora_buyer` | **SUPPORTED_WORKBOOK** | Existing diaspora `buyer` template (import orders, documents, payment milestones) |

### Automotive businesses

| # | Stakeholder | Repo evidence | Disposition | Workbook / reason |
|---|---|---|---|---|
| 5 | Dealer (applicant → active) | role `dealer`; `business_type='dealer'`; X5 onboarding lane | **SUPPORTED_WORKBOOK** | Applicant: X5 dealer-onboarding workbook lane + `dealer_vehicle_inventory` (safe: creates DRAFTS only). Active (governed role/tenant): the same inventory template plus export. Privileged dealer operations stay behind the unresolved X5 activation dependency |
| 6 | Overseas dealer | no distinct string anywhere (verified); reachable as diaspora `seller`/`exporter` trade profile | **CONDITIONAL_WORKBOOK** | Diaspora `seller` template — condition: verified diaspora trade profile. Recorded: "overseas dealer" is not a modeled identity; do not invent one |
| 7 | Exporter | `business_type='exporter'` (`registrationProfileService.js:6`); `role_type='exporter'` | **SUPPORTED_WORKBOOK** | Exporter workbook = existing diaspora `seller` (stock/quotes) + `supplier` (documents) templates — real trade contracts, no new schema |
| 8 | Importer | `business_type='importer'`; diaspora buyer/enterprise/container contracts | **SUPPORTED_WORKBOOK** | Importer workbook = existing diaspora `buyer` + `container_reservation` (+ `enterprise` for coordinators) |
| 9 | Garage | `business_type='garage'`; org type `garage`; comms workflow `garage` | **DEFERRED_CANONICAL_WORKFLOW_MISSING** | `backend/services/serviceNetwork` is ABSENT on this branch (PR #197 lane — verified). Message: "Not available yet — Service Network reconciliation required." Future composition sketch in §3 |
| 10 | Mechanic | platform role `mechanic`; PartSentry logs | **DEFERRED_CANONICAL_WORKFLOW_MISSING** | Same #197 dependency; additionally PartSentry rows are evidence-like — bulk-importing service history as fact would manufacture truth, so even post-#197 a mechanic workbook imports claims only |
| 11 | Parts seller | `business_type='parts_seller'`; comms `parts_seller`; no parts-listing bulk contract (verified: no vocabulary in `partsentryService.js`) | **CONDITIONAL_WORKBOOK** | Diaspora `supplier` template for parts trade (`parts_import`/`parts_export` order types) — condition: verified trade profile. Local parts-inventory workbook: deferred, no canonical owner |
| 12 | Parts supplier | referral participant `parts_supplier`; diaspora supplier sheets | **CONDITIONAL_WORKBOOK** | Same as #11 |

### Regulated / commercial providers

| # | Stakeholder | Repo evidence | Disposition | Reason |
|---|---|---|---|---|
| 13 | Insurer | role `insurance`; `insurer_profiles` under `provider_registry`; decisions sync/webhook/manual (`20260703140000_insurance_provider.sql:117-124`) | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | Provider integration is the provider platform (registry, activation modes, partner files). Insurance DECISIONS may never arrive by spreadsheet; a safe input workbook may be added later only with an approved canonical intake |
| 14 | Bank / lender | roles `bank`/`finance`/`lender`; `lender_profiles`; lender attestation gates (`vehicleFinanceObligationService.js:213-222`) | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | Same provider-platform reasoning; finance decisions/obligations are attested through governed actor gates, never imported |
| 15 | Payments / escrow provider | actor classes `{provider, webhook}` (`escrowTrustService.js:31`); billing providers `sandbox/manual/stripe/paynow` | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | Webhook/API actors; `APPROVED_LIVE_PROVIDERS=[]` fail-closed. Nothing spreadsheet-shaped |

### Trade / logistics

| # | Stakeholder | Repo evidence | Disposition | Workbook / reason |
|---|---|---|---|---|
| 16 | Import coordinator | comms `import_coordinator`; `role_type='coordinator'` | **CONDITIONAL_WORKBOOK** | Diaspora `enterprise` template — condition: verified coordinator trade profile |
| 17 | Logistics / shipping provider | workbook role `logistics_partner`; SHIPMENTS/CONTAINER_SHIPMENTS sheets; comms `logistics_provider` | **CONDITIONAL_WORKBOOK** | `container_reservation` + `enterprise` sheets — condition: verified logistics trade profile. No platform role exists; identity is the trade profile |
| 18 | Container / cargo operator | modeled as RESOURCES not a role (`carrier_name` free text, `diasporaShipmentService.js:43`; no operator role string — verified) | **CONDITIONAL_WORKBOOK** | Folded into #17; recorded that no distinct operator identity exists — do not invent one |

### Organizations / future actors

| # | Stakeholder | Repo evidence | Disposition | Reason |
|---|---|---|---|---|
| 19 | Fleet / rental / corporate | org type `fleet` only — zero code paths; `rental`/`corporate` absent (verified) | **DEFERRED_CANONICAL_WORKFLOW_MISSING** | No fleet workflow owner exists; a fleet vehicle workbook would be `seller_vehicles` at scale once a fleet authority model lands |
| 20 | Government institution / officer | role `government`; source keys `zimra, cvr, zinara, vid, cid`; existing governed batch-import (`governmentActivationRoutes.js` — admin/government only) | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | Registry truth never arrives via user workbook. Their EXISTING lane (source-verification activation: partner files, batch import, suspend/emergency controls) is the correct, already-governed surface — X5A adds nothing to it |
| 21 | Referral / affiliate partner | referral engine (codes, campaigns, participant types) | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | Referral codes/campaigns are generated artifacts with fraud governance; bulk import would be a fraud vector. Interactive + API only |
| 22 | External API partner | `partner_clients` + scopes `vehicle:identity/trust/sources` (`20260626130000_partner_api.sql`) | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | The partner API is the machine surface; a spreadsheet would be a worse API |
| 23 | CarUp admin / internal operator | 9 `operations.*` capabilities (`operationsAuthorizationService.js:29-44`); diaspora operator console | **INTERNAL_ONLY** | Operators facilitate/review imports (existing operator console); they are not a workbook customer. Admin exports go through governed admin surfaces |
| 24 | `other` business | `business_type='other'` (`registrationProfileService.js:13`) | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | An unspecified business has no canonical bulk workflow; re-registering a specific type is the path to one |
| 25 | Provider systems (webhook/system/ai actors) | `{provider, webhook, system}` actor classes; comms actor types; evidence `actor_type` `ai`/`source_partner` | **INTERNAL_ONLY** | Machine actors; never a workbook audience |

### Discovered in repository evidence (beyond the required list — recorded so none disappear)

| # | Stakeholder | Repo evidence | Disposition | Note |
|---|---|---|---|---|
| 26 | Diaspora enterprise partner | plan `enterprise` (`diasporaEntitlements.js:127-238`); `enterprise` template; workbook role `enterprise_partner` | **SUPPORTED_WORKBOOK** | The existing `enterprise` (all-sheets) template |
| 27 | Clearing agent | workbook role `clearing_agent` (`diasporaWorkbookSchema.js:15-23`) | **CONDITIONAL_WORKBOOK** | Participates through coordinator/enterprise workbooks; no standalone template — no standalone authority exists |
| 28 | Diaspora trade `agent` / `company` | `role_type` values (`013_diaspora_trade_schema.sql:120`) | **CONDITIONAL_WORKBOOK** | Covered by diaspora templates under their verified trade profile role |
| 29 | Customs reviewer | `participant_role='customs_reviewer'` (`013_diaspora_trade_schema.sql:102`) | **INTERNAL_ONLY** | Review-side participant; COMPLIANCE_REVIEWS rows are review records, and workbook import of APPROVED outcomes is refused by the existing classifier |
| 30 | Admin sub-operators (`support`, `trust_manager`, `compliance_manager`, `marketplace_manager`, `finance`) + `reviewer`/`government_reviewer` | `adminCommunicationRoutes.js:13`; various role sets | **INTERNAL_ONLY** | Operator/review identities |
| 31 | `member` (null-role default) / `anonymous` | `authMiddleware.js:163`; nav `role_category` | **NO_WORKBOOK_API_OR_UI_IS_CORRECT** | Unregistered/incomplete identities; registration first |
| 32 | Golden/staging fixture identities | `goldenVehicleSpecs.js:42-50` | **INTERNAL_ONLY** | Certification fixtures, never product stakeholders |

**Roll-call integrity rule:** a new stakeholder-like vocabulary anywhere in the repo (new role,
business type, org type, participant role, provider class) REQUIRES a new row here with a
disposition — absence is a certification failure for the phase that introduced it.

---

## §3 Workbook compositions (reusable worksheet modules — no 100-column sheets)

Sheet modules are defined once and composed per template. `Instructions` and `_REFERENCE`
(hidden, protected, carrying the allowed vocabularies) are present in every workbook, and the
Instructions sheet carries: schema version, template key, generated timestamp, compatibility
note, privacy notice, how-to lines. Only VEHICLES + LISTINGS need rows for a minimal
seller/dealer import — every other data sheet is optional.

### `seller_vehicles` — Private Seller / Owner Vehicle Workbook (NEW in X5A)

`VEHICLES` (identity + registration) · `LISTINGS` (commercial) · `ACCIDENT_HISTORY`
(multi-row per VIN, max 10 events) · `DISCLOSURES` (insurance + finance states, 1:1) ·
`MEDIA` (photo references, multi-row) · `EVIDENCE_NOTES` (evidence references, multi-row) ·
`Instructions` · `_REFERENCE`.

*Composition decision (recorded per A8):* the task sketch listed separate REGISTRATION /
INSURANCE / FINANCE sheets; registration fields ride on `VEHICLES` (they are 1:1 identity-side
facts entering the same create call) and the two 1:1 disclosure groups share one `DISCLOSURES`
sheet — fewer, fuller sheets for a typically-small workbook. The module boundaries in the field
registry keep them separable if a later template wants them apart.

### `dealer_vehicle_inventory` — Dealer Workbook (NEW in X5A)

`BUSINESS` (dealer application profile claims, 1 row) · `BRANCHES` (multi-row) · then the same
vehicle modules as `seller_vehicles` (`VEHICLES`, `LISTINGS`, `ACCIDENT_HISTORY`,
`DISCLOSURES`, `MEDIA`, `EVIDENCE_NOTES`) · `Instructions` · `_REFERENCE`.
Import creates DRAFT vehicles under the importing user's own listing authority — it never
touches Dealer Compliance, publication, or the dealer role.

### Exporter Workbook (EXISTING diaspora contracts)

Diaspora `seller` template (`TRADE_PROFILES`, `IMPORT_QUOTES`, `TRADE_DOCUMENTS`,
`CARGO_RESERVATIONS`, `AI_COMMAND_CENTER`) + `supplier` template for supply documents —
`diasporaWorkbookTemplates.js:228-254`. No new schema.

### Importer Workbook (EXISTING diaspora contracts)

Diaspora `buyer` template (`DIASPORA_IMPORT_ORDERS`, `TRADE_DOCUMENTS`, `PAYMENT_MILESTONES`,
`AI_COMMAND_CENTER`) + `container_reservation` (`CONTAINER_SHIPMENTS`, `CARGO_RESERVATIONS`,
`DIASPORA_IMPORT_ORDERS`); coordinators additionally the `enterprise` (all-sheets) template.
Registration preparation for arrived vehicles happens in `seller_vehicles`/dealer inventory
(registration stage vocabulary), not a new sheet.

### Supplier / Parts

Diaspora `supplier` template only (§2 #11-12) — worksheets whose canonical owners exist today.

### Garage / Mechanic — DEFERRED

**Not composed on this branch — Service Network reconciliation required (PR #197).** Future
sketch (recorded, not buildable here): `BUSINESS` · `SERVICE_CASES` (claims) ·
`WORK_ORDER_HISTORY` (claims, never verified evidence) · `PARTS_USED` · Instructions ·
Reference — to be built from #197's `serviceAuthority`/`serviceCaseService` contracts, and only
after that lane defines who may bulk-assert service history.

### Insurance / Lender / Government — no authoritative-decision spreadsheets

No workbook exposes decision import. Any future safe-input workbook (e.g. an insurer submitting
its OWN branch directory) requires a canonical intake contract and PO approval first.

---

## §4 Canonical Workbook Field Registry

**Registry version:** `carup_workbook_registry.v1` (all fields below introduced 2026-09-04).
**Authority classes:** `claim` (subject's statement) · `candidate` (machine-proposed, needs
human confirmation) · `evidence_ref` (pointer to evidence, never its verdict) · `governed_result`
(NEVER importable — server-derived only).
**Privacy classes:** `P0` public-safe · `P1` commercial · `P2` personal · `P3` prohibited-in-
workbooks (private banking keys, credentials, biometric data — may not even appear as columns).
**AI rule for every row:** AI assistance (mapping/explanation/checks) allowed; **AI decision
NO** — AI never fills a value; suggestions are proposals requiring the user's explicit
acceptance. Exceptions would be listed per-field; there are none in v1.

Shared column facts for the NEW vehicle modules (sheets `VEHICLES`, `LISTINGS`,
`ACCIDENT_HISTORY`, `DISCLOSURES`, `MEDIA`, `EVIDENCE_NOTES`): owning domain = Seller/vehicle
listing lane; write path = the canonical `POST /api/vehicles/add` contract
(`backend/server.js:2628`) replayed per accepted VIN group (plus
`POST /api/vehicles/:vin/evidence/upload` for `EVIDENCE_NOTES`); validation = the same server
rules cited per row; version = v1. Human labels below are the workbook headers; canonical keys
travel underneath (label↔key mapping is part of the registry, so imports accept both).

### Sheet `VEHICLES` (identity + registration; 1 row per vehicle; key: VIN)

| Canonical key | Workbook label | Type | Req | Vocabulary / validation (source) | Import | Export | Auth class | Privacy |
|---|---|---|---|---|---|---|---|---|
| `vin` | VIN / Vehicle Identifier | text | **yes** | 12–17 `[A-Za-z0-9-]`, no I/O/Q at 17 (`server.js:2642-2655`) | yes | yes | claim | P0 |
| `make` | Make | text | **yes** | 43-make catalog + open (`shared/taxonomy/vehicle/catalog.json`) | yes | yes | claim | P0 |
| `model` | Model | text | **yes** | per-make + open | yes | yes | claim | P0 |
| `year` | Year | number | **yes** | 1886..currentYear+1 (catalog yearPolicy) | yes | yes | claim | P0 |
| `color` | Color | enum | **yes** | 16 colors (Black…Other) | yes | yes | claim | P0 |
| `mileage` | Mileage (km) | number | **yes** | integer ≥ 0 (`server.js:2672-2675`) — unknown is NOT importable; leave the row out until known | yes | yes | claim | P0 |
| `body_style` | Body style | enum | **yes** | 16 body styles (Sedan…Other) | yes | yes | claim | P0 |
| `seller_stated_condition` | Condition (your words) | enum | **yes** | New, Used, Other — never the governed condition category | yes | yes | claim | P0 |
| `fuel_type` | Fuel type | enum | **yes** | 9 values (Petrol…Other) | yes | yes | claim | P0 |
| `transmission` | Transmission | enum | **yes** | 7 values (Automatic…Other) | yes | yes | claim | P0 |
| `drivetrain` | Drivetrain | enum | no | FWD, RWD, AWD, 4WD, Other | yes | yes | claim | P0 |
| `engine_number` | Engine number | text | no (blocks publish) | free text, uppercased | yes | **redacted by default** | claim | P2 |
| `chassis_number` | Chassis number | text | no (blocks publish) | free text, uppercased | yes | **redacted by default** | claim | P2 |
| `generation` | Generation (optional) | text | no | free text | yes | yes | claim | P0 |
| `trim` | Trim (optional) | text | no | free text | yes | yes | claim | P0 |
| `registration_status` | Registration stage | enum | no (`unknown`/TIP block publish) | 8 ZW lifecycle values with existing labels (`zimbabweRegistrationLifecycle.js:8-30`; e.g. `customs_cleared_cvr_pending` → "Customs cleared — local registration pending") | yes | yes | claim | P0 |
| `plate_number` | Zimbabwe number plate (if issued) | text | required when stage = locally registered | free text, uppercased | yes | yes | claim | P1 |
| `temp_plate_id` | Temporary Import Permit no. | text | no | free text | yes | yes | claim | P1 |
| `registration_country` | Country of registration (optional) | text | no | free text | yes | yes | claim | P0 |

### Sheet `LISTINGS` (commercial; 1 row per vehicle; key: VIN)

| Canonical key | Workbook label | Type | Req | Vocabulary / validation | Import | Export | Auth class | Privacy |
|---|---|---|---|---|---|---|---|---|
| `price` | Asking price | number | **yes** | > 0 (`server.js:2641`) | yes | yes | claim | P1 |
| `currency` | Currency | enum | **yes** | USD, ZiG (client list `SellVehicle.tsx:156-159`; server requires presence — the registry enforces membership, closing that gap at the workbook boundary) | yes | yes | claim | P1 |
| `listing_city` | City | enum | **yes** | 15 ZW cities (`mockData.ts:180`) | yes | yes | claim | P0 |
| `listing_province` | Province | enum | no | 10 ZW provinces (`mockData.ts:186`) | yes | yes | claim | P0 |
| `listing_country` | Listing country (optional) | text | no | free text; never inferred | yes | yes | claim | P0 |
| `seller_description` | Description | text | **yes** | 50–500 chars | yes | yes | claim | P0 |
| `seller_features` | Features (comma-separated) | list | no | free text, deduped, max 50 | yes | yes | claim | P0 |
| `location_visibility` | Who can see the vehicle location? | enum | no (default withheld) | `public` ("Show my city and province"), `province_only` ("Show my province only"), `withheld` ("Keep my location private until I reply") — fail-closed (`publicVehicleProjection.js:555-559`) | yes | yes | claim | P1 |
| `public_seller_display_enabled` | Show seller name publicly? | boolean | no (default No) | Yes/No → strict `=== true` (`server.js:2792`) | yes | yes | claim | P1 |

### Sheet `ACCIDENT_HISTORY` (0–10 rows per VIN)

Header row: `vin` + `accident_state` (once per VIN: `yes` / `no_known_accident_history` /
`unknown` — labels "Yes — it has been in an accident" / "No known accident history" / "I don't
know") + per-event columns, all free text ≤200 chars, all optional, allow-list-projected
(`vehicleHistoryDisclosures.js:37-42`): `approx_date` (Approximate date), `event_mileage`
(Mileage at the time), `damage_area` (Damaged area), `severity` (Severity, your words),
`insurer_involved` (Insurer involved?), `police_report_state` (Police report),
`repair_state` (Repair state), `repairer` (Repairer / garage). All: import yes · export yes ·
claim · P1. A blank state means "not recorded" — never "No".

### Sheet `DISCLOSURES` (1 row per VIN)

| Canonical key | Workbook label | Vocabulary | Auth class | Privacy |
|---|---|---|---|---|
| `insurance_state` | Currently insured? | `insured` / `not_insured` / `unknown` | claim | P1 |
| `insurer_name` | Insurer (optional) | free text ≤200, only with `insured` | claim | P1 |
| `finance_state` | Finance / lender interest? | `none_known` / `active` / `settlement_pending` / `cleared` / `unknown` (labels per `vehicleHistoryDisclosures` web lib) | claim | P1 |
| `finance_type` | Type of finance | `bank_loan, vehicle_finance, lease, hire_purchase, secured_lien, other` | claim | P1 |
| `lender_name` | Lender / provider (optional) | free text ≤200 | claim | P1 |

**P3 prohibition (workbook-level law):** the 11 private-banking keys
(`outstanding_balance, monthly_payment, apr, interest_rate, account_number, loan_reference,
contract_number, bank_account, repayment_history, credit_score, credit_report` —
`vehicleHistoryDisclosures.js:31-35`, M17/INV-18, triple-enforced incl. DB CHECK) are refused
as workbook COLUMNS: no template contains them, the importer refuses a mapping onto them, and
the server refusal remains the backstop.

### Sheet `MEDIA` (0–15 rows per VIN — photo REFERENCES, not binaries)

| Canonical key | Workbook label | Type | Vocabulary / validation | Import | Export | Auth class | Privacy |
|---|---|---|---|---|---|---|---|
| `image_url` | Photo web address (http/https) | url | publishable http(s) only (`server.js:3286`) | yes | yes | claim | P0 |
| `photo_label` | What the photo shows | enum | 13 shot labels (Front three-quarter … Other), ≤80 chars | yes | yes | claim | P0 |
| `is_primary` | Cover photo? (one per vehicle) | boolean | strict true, max one per VIN (`server.js:2721-2725`) | yes | yes | claim | P0 |
| `display_order` | Display order | number | row order wins; dense from 0 | yes | yes | claim | P0 |

**Binary media law:** image FILES do not belong in spreadsheet cells. The workbook carries
URL references; direct device uploads remain the site/media endpoint
(`POST /api/media/upload/vehicle` — base64 intake, MIME magic-byte check, malware scan, EXIF
strip). A row whose URL is not publishable imports as "referenced, not ingested" and is
reported — never silently dropped, never fabricated.

### Sheet `EVIDENCE_NOTES` (0–n rows per VIN — evidence REFERENCES)

| Canonical key | Workbook label | Type | Vocabulary / validation | Import | Export | Auth class | Privacy |
|---|---|---|---|---|---|---|---|
| `evidence_class` | Evidence category | enum | 9 classes (`evidenceTaxonomy.js:15-25`) | yes | yes | evidence_ref | P1 |
| `evidence_subtype` | Evidence type | enum | per-class subtype catalog | yes | yes | evidence_ref | P1 |
| `file_url` | Document/photo web address | url | http(s); the canonical evidence upload accepts `file_url` (`evidenceService.js:212`) | yes | no | evidence_ref | P2 |
| `event_date` | Date of the event | date | ISO date | yes | yes | evidence_ref | P1 |
| `event_date_precision` | How precise is the date? | enum | `EVENT_DATE_PRECISIONS` (default `day`) | yes | yes | evidence_ref | P1 |
| `evidence_label` | Your label for this document | text | free text | yes | yes | evidence_ref | P1 |

Imported evidence lands with server-hardcoded `verification_status='pending'`
(`vehiclesRoutes.js:830`) and clamped visibility — the workbook can never assert `verified`,
a trust impact, or a widened visibility.

### Sheets `BUSINESS` + `BRANCHES` (dealer template only)

`BUSINESS` (1 row): `legal_name` (Legal business name), `trading_name` (Trading name),
`registration_number` (Company registration number), `tax_id` (Tax ID), `physical_address`
(Physical address), `responsible_person` (Responsible person), `operating_country`
(Operating country) — the X5 `PROFILE_FIELDS` exactly (`dealerComplianceService.js:27-33`);
all claims, P1/P2; import yes (upserts the caller's OWN dealer application profile via the X5
service); export yes. **`tenant_id` is not a column and never will be** (X5 §4 law).
`BRANCHES` (0–n rows): `branch_name`, `branch_address` — claims, P1.

### Diaspora sheets (imported unchanged)

The 11 diaspora sheets keep their canonical UPPERCASE keys, requiredness, and status-list
vocabularies from `diasporaWorkbookSchema.js:114-203` — this registry does NOT duplicate them;
it references that schema as their single source. Authority classification for their sensitive
columns: `VERIFICATION_STATUS`/`COMPLIANCE_STATUS`/`APPROVAL_STATUS` columns are staging
declarations whose elevated values (`VERIFIED`/`APPROVED`) the existing import classifier
refuses to persist as outcomes — the X5-pinned behavior, unchanged.

### `governed_result` fields — NEVER importable, by name

`trust_score` (one writer: `canonicalTrustService`, INV-TRUST-2) · `verification_status`
(evidence + vehicles; reviewer routes only) · `duty_paid` · `police_verified` ·
`publication_status` (only the governed publish gate advances it) · `owner_id` /
`current_seller_id` / seller-authority status/basis (`sellerAuthorityService.js:23` invariant)
· `tenant_id` · dealer compliance eight statuses + `can_publish` · identity/biometric
states · every `*_source` / `*_recorded_at` provenance column (server-stamped) · taxonomy
`*_taxon_id` columns. The registry lists them ONLY so tooling can refuse them by name: they
have `importable: false, exportable: per-domain-projection, authority: governed_result`.

### Intentionally non-importable user-enterable fields (with reasons)

| Field | Reason |
|---|---|
| `claim_type` (seller-claim `owner`/`authorised_seller`) | An authority CLAIM with governed review consequences — one-at-a-time, deliberate, on the site (`sellerAuthorityService.js:406`); bulk-claiming authority is exactly the shape of fraud the lane exists to catch |
| Evidence binary `file` (base64) | Binaries don't belong in cells; `file_url` references are the workbook path |
| `visibility_level` (evidence) | Server-clamped widening rules; workbook rows take the safe default |
| `odometer_value`/`odometer_unit`, `component_tags`, `declared_condition`, registry source refs on evidence | v1 scope: minimal reference metadata only; full evidence metadata stays on the interactive uploader — recorded for a v2 decision |
| `client_submission_id` | Generated per row by the importer (idempotency machinery, not user data) |
| `reuse_existing_passport` | An interactive conflict-resolution decision made against a live duplicate-VIN warning, not a bulk assertion |

---

## §5 Exposure matrix — who sees which template, at which authority stage

**The rule: catalogue availability is server-derived.** The catalogue endpoint derives
eligibility per §1's authority sources and returns `available` + `unavailable` (with honest
reason codes). Client-side hiding is presentation only; the backend list is the gate, and the
template/export/import/recent-imports routes re-verify eligibility on every call.

| Stakeholder (server-derived state) | Sees (actions) | Does NOT see (reason code) |
|---|---|---|
| Individual (role `owner`, no business context, no vehicles… any owner) | `seller_vehicles` (template · import · recent_imports; export once ≥1 own vehicle) | dealer/importer/exporter/diaspora templates (`business_context_required` / `trade_profile_required`); anything privileged |
| Individual buyer with no sell intent | same as above (owning/selling is one role — `seller_vehicles` shows for every `owner`; an unused template is harmless, an invented "buyer workbook" is not) | — |
| Diaspora customer (verified `buyer` trade profile) | diaspora `buyer` (template · export · import · recent_imports) | seller/supplier/enterprise (`trade_profile_role_mismatch`) |
| Dealer APPLICANT (`business_type='dealer'`, X5 onboarding context, NOT active) | X5 onboarding workbook lane; `dealer_vehicle_inventory` (template · import — creates drafts under own listing authority; export of own drafts) | active-Dealer operational exports (`dealer_activation_required` — the X5 unresolved dependency, stated honestly) |
| ACTIVE Dealer (governed `dealer` role/tenant) | `dealer_vehicle_inventory` full (template · export · import · recent_imports) | other tenants' anything (`tenant_scope`); decision imports (never a template) |
| Exporter (`business_type='exporter'` + verified trade profile) | diaspora `seller` + `supplier` | buyer/container unless profile role matches (`trade_profile_role_mismatch`) |
| Importer (`business_type='importer'` + verified trade profile) | diaspora `buyer` + `container_reservation` (+ `enterprise` for coordinator profiles) | seller/supplier mismatches |
| Parts seller/supplier (verified supplier trade profile) | diaspora `supplier` | local parts inventory (`canonical_workflow_missing`) |
| Garage / mechanic | — | all (`service_network_reconciliation_required`) — shown as an honest unavailable entry, not hidden |
| Insurer / bank / lender / escrow provider | — | all (`provider_platform_is_the_integration_surface`) |
| Government | — | all in this workspace (`governed_activation_lane_exists`) |
| Referral partner / API partner / `other` business | — | all (`no_canonical_bulk_workflow`) |
| Admin/operators | operator console (existing diaspora surface) — not this catalogue | customer templates as themselves (`internal_operator`) |

Forgery pins required (B14): a request-body/header `business_type`/`role`/`template_key`
never changes the derived catalogue; tenant A never sees tenant B's templates, imports, or
exports; deferred stakeholders STAY deferred.

---

## §6 CarUp AI Workbook Assistant — product capability definition

A visible, named component of the workbook workspace (never invisible plumbing), with eight
user-facing functions:

1. **Map my columns** — deterministic aliases first; AI proposes for unresolved headers only
   (HEADERS ONLY leave the system); allowlist-validated against the selected template;
   unmappable stays honestly unmapped. (The X5 mapper, made visible.)
2. **Explain this field** — meaning, permitted values and their human labels, from the field
   registry (registry-served; AI may rephrase, never redefine).
3. **Check my workbook** — deterministic validation surfaced conversationally: missing values,
   malformed values, vocabulary mismatches, duplicate identifiers, conflicting mappings,
   suspicious/inconsistent records, unsupported fields.
4. **Suggest correction** — canonical normalization proposals (e.g. `Auto` → `Automatic`),
   with deterministic normalization and AI proposal visually distinguished; material
   suggestions require explicit acceptance.
5. **Explain this error** — error codes → actionable plain English.
6. **Find duplicates/conflicts** — VIN conflicts, duplicate stock/import references, existing
   Passport, duplicate dealer records; AI explains, authority resolution stays human/governed.
7. **Summarize my import** — pre-confirmation: "47 rows ready · 3 need your attention · 1
   blocked · 0 authority decisions will be imported" (the last line is structural truth, not a
   claim).
8. **What still needs attention?** — only the unresolved rows/cells, so nobody scrolls a 500-row
   sheet hunting for the 3 red cells.

The AI Authority Matrix governing all eight lives in
`CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_PLAN.md` and in matrices §11; its NO
rows (generate VIN, invent mileage/registration status, mark verified/approve/authorize,
write Trust, bypass mapping confirmation) are enforcement obligations with tests, not
aspirations. Failure mode: assistant unavailable → manual mapping/validation continues.

---

## §7 Template / Export / Import / Recent Imports — the common workspace model

One configuration-driven shell per stakeholder workspace:

- **TEMPLATE** — GET the canonical workbook for a `template_key` the catalogue granted.
- **EXPORT** — server builds the workbook from DB rows the caller may export (owner/tenant
  scoping per table; ALWAYS-redact headers; the diaspora `exportWorkbookFromDatabase` pattern);
  request-body rows are never a trusted export.
- **IMPORT** — `file → inspect → deterministic mapping → AI mapping → human correction →
  mapping confirmation (checksum-bound) → validation → dry run → review → explicit
  confirmation → governed execution → receipt`.
- **RECENT IMPORTS** — the caller's/tenant's batches from the existing store
  (`diaspora_workbook_import_batches`/`_receipts`): filename, template, uploaded time, row
  counts, status, warnings/errors, result, receipt, continue/retry where governed.

Seller/dealer vehicle EXECUTION model: each accepted VIN group replays the canonical
`POST /api/vehicles/add` contract as the importing user (their proven session, their listing
authority, per-row `client_submission_id` idempotency) — the certified route remains the ONLY
listing writer; evidence rows replay the canonical evidence upload. Diaspora templates keep
their existing execution chain untouched.

## §8 Google Sheets compatibility

The versioned CarUp workbook schema is the single source of truth. Generated `.xlsx` must
open/edit/re-export in Microsoft Excel AND Google Sheets; parsing tolerates Sheets' XLSX
export (already the engine's behavior: cached formula results only, help-row detection by
value, EXAMPLE-row filtering). No Sheets-specific schema. "Open/Make a copy in Google Sheets"
is a potential future convenience over the same file — an integration, never a data model.

## §9 Maintenance contract

- Implementation changes a field/exposure/template/AI behavior → THIS file updates in the same
  change (Stage B18 obligation).
- New stakeholder vocabulary anywhere → new §2 row with disposition (roll-call integrity rule).
- Seller sell-flow gains a user-enterable, safely-importable field → the registry completeness
  test fails by name until the registry (and this manual) covers it or records the intentional
  omission.
- X6/X7 certification MUST enumerate §2 and state per-row what (if anything) changed.

---

## §10 X6 roll-call — identity assurance + Communications dispositions (added 2026-09-04; the register X7 certifies)

Per §2 row, exactly one ASSURANCE disposition and one COMMS disposition. Vocabulary —
ASSURANCE: `CONSUMER` (consumes the `identity_assurance.v1` projection — implemented or
contract-recorded as noted) · `CONSUMER_CONDITIONAL` (consumes only for named higher-risk
actions) · `NONE_TODAY` (human stakeholder, no identity-gated workflow yet) ·
`NOT_APPLICABLE` (no human identity to project) · `DEFERRED(<dependency>)` ·
`INTERNAL_READER` (reads others' assurance in governed review surfaces, never their own
gate). COMMS: workflow names from `communicationStakeholderContracts` (regulated ⇒ marketing
prohibited, AI draft-only) · `AUTH_ONLY` (account_holder authentication mail only) ·
`INTERNAL` · `NONE` · `DEFERRED(<dependency>)`. X6 expands NO marketing eligibility.

| # | Stakeholder | Assurance | Communications | Status | Dependency |
|---|---|---|---|---|---|
| 1 | Individual buyer (local) | CONSUMER_CONDITIONAL — finance/escrow-grade actions only; never for browsing | marketplace (buyer) + support + AUTH_ONLY; transactional | contract recorded | finance/escrow lanes adopt at their gates |
| 2 | Private vehicle owner | CONSUMER — registration journey capability ladder | marketplace (seller) · garage (vehicle_owner) · AUTH_ONLY; transactional | IMPLEMENTED (registration consumer) | — |
| 3 | Private seller | CONSUMER — journey surface; Seller Authority stays separate (pinned: assurance grants none) | marketplace (seller); `seller.authority.decided`/`.superseded` events | IMPLEMENTED (journey) + contract recorded (seller gates) | seller person-gate policy, if ever adopted |
| 4 | Diaspora customer / sponsor | CONSUMER_CONDITIONAL — escrow/payment actions; trade-profile verification governs trade | diaspora_import (customer); transactional | contract recorded | diaspora lane adoption |
| 5 | Dealer (applicant → active) | CONSUMER — responsible-person assurance on the application; Dealer Compliance separate (pinned) | dealer (dealer) + `dealer.compliance.decided`/`.evidence_required` events; transactional | IMPLEMENTED (dealer onboarding consumer + events) | activation path = PO dependency (§19) |
| 6 | Overseas dealer | CONSUMER_CONDITIONAL — via verified diaspora seller profile; person assurance at escrow | diaspora_import; transactional | contract recorded | diaspora lane adoption |
| 7 | Exporter | CONSUMER_CONDITIONAL — same model as #6 | diaspora_import; transactional | contract recorded | diaspora lane adoption |
| 8 | Importer | CONSUMER_CONDITIONAL — same model | diaspora_import · container_logistics (customer) | contract recorded | diaspora lane adoption |
| 9 | Garage | DEFERRED(SERVICE_NETWORK_RECONCILIATION_REQUIRED — PR #197): garage principal identity | garage (garage) — participant today; service events deferred | deferred | PR #197 |
| 10 | Mechanic | DEFERRED(SERVICE_NETWORK_RECONCILIATION_REQUIRED): mechanic identity contract recorded | NONE today (no mechanic comms workflow) | deferred | PR #197 |
| 11 | Parts seller | CONSUMER_CONDITIONAL — via supplier trade profile | parts (parts_seller); transactional | contract recorded | parts lane adoption |
| 12 | Parts supplier | CONSUMER_CONDITIONAL — as #11 | parts (parts_seller) | contract recorded | parts lane adoption |
| 13 | Insurer | NOT_APPLICABLE for own gate; CONSUMER_CONDITIONAL contract as a reader of the OWNER's assurance in future underwriting — provider decisions stay theirs | insurance (insurer) — REGULATED; marketing prohibited | contract recorded | provider-platform adoption |
| 14 | Bank / lender | as #13 | finance (lender) — REGULATED; marketing prohibited | contract recorded | provider-platform adoption |
| 15 | Payments / escrow provider | NOT_APPLICABLE (machine actor — no human projection invented) | NONE (webhooks/API) | closed | — |
| 16 | Import coordinator | CONSUMER_CONDITIONAL — via verified coordinator profile | diaspora_import (import_coordinator) | contract recorded | diaspora lane adoption |
| 17 | Logistics / shipping provider | NOT_APPLICABLE today (trade-profile verification governs) | container_logistics (logistics_provider) | contract recorded | — |
| 18 | Container / cargo operator | folded into #17 | folded into #17 | closed | — |
| 19 | Fleet / rental / corporate | DEFERRED(no fleet workflow authority) | NONE today | deferred | fleet lane |
| 20 | Government institution / officer | NOT_APPLICABLE — officer authorization is role/capability, NEVER O2 customer identity verification (recorded law) | government_public_service (government_officer) — REGULATED | closed | — |
| 21 | Referral / affiliate partner | NONE_TODAY (no identity-gated referral action) | referral (referrer/referred_user); marketing per referral-lane governance only | closed | — |
| 22 | External API partner | NOT_APPLICABLE (machine) | NONE (partner API) | closed | — |
| 23 | CarUp admin / internal operator | INTERNAL_READER — operations read models surface assurance of SUBJECTS (implemented: people review gains `identity_assurance`) | INTERNAL (support/admin side) | IMPLEMENTED (ops read model) | — |
| 24 | `other` business | NONE_TODAY | AUTH_ONLY | closed | — |
| 25 | Provider systems (webhook/system/ai) | NOT_APPLICABLE (machine — pinned never treated as human recipients) | NONE | closed | — |
| 26 | Diaspora enterprise partner | CONSUMER_CONDITIONAL — via enterprise profile | diaspora_import · container_logistics | contract recorded | diaspora lane adoption |
| 27 | Clearing agent | NOT_APPLICABLE today (participates via coordinator workflows) | via diaspora threads (participant) | closed | — |
| 28 | Diaspora trade agent / company | CONSUMER_CONDITIONAL — via verified trade profile | diaspora_import | contract recorded | diaspora lane adoption |
| 29 | Customs reviewer | INTERNAL_READER (review side) | INTERNAL | closed | — |
| 30 | Admin sub-operators + reviewers | INTERNAL_READER | INTERNAL | closed | — |
| 31 | `member` (null-role) / anonymous | NOT_APPLICABLE until registration establishes an account; then AUTH_ONLY | AUTH_ONLY once registered; anonymous NONE | closed | — |
| 32 | Golden/staging fixtures | NOT_APPLICABLE (test identities) | NONE | closed | — |

Reconciliation notes: comms workflow names and `regulated` flags are verbatim from
`backend/services/communication/communicationStakeholderContractService.js` (insurance ·
finance · government_public_service · trust_safety regulated ⇒ AI draft-only, marketing
prohibited); the X6 events land on thread types `account` / `trust_safety` / `import` (all in
the existing DB CHECK list); machine/internal rows (15, 22, 25, 29, 30, 32) must never resolve
as human notification recipients (pinned).
