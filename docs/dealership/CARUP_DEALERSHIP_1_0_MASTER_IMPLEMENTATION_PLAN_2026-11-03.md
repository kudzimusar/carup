# CARUP DEALERSHIP 1.0 — MASTER IMPLEMENTATION, DATA-INTAKE, COMMERCE AND ACCEPTANCE PLAN

**Programme ID:** CARUP-DEALER-ONB-001  
**Version:** 1.0 — proposed for Product Owner review; NOT IMPLEMENTATION AUTHORITY  
**Date:** 2026-11-03 (Asia/Tokyo)  
**Repository:** https://github.com/kudzimusar/carup  
**Document custody:** docs-only proposal branch docs/carup-dealer-1-0-master-plan-20261103; draft review only  
**Programme controller:** CarUp Programme Moderator, operating under 11-11 Tech governance and exact-head evidence controls  
**Product Owner approval:** PENDING  
**Implementation specialist / team:** NOT APPOINTED — selected only after Owner review  
**Production, shared staging, migrations, real provider charges and merges:** NOT AUTHORIZED by this document

> This is the comprehensive decision and implementation blueprint requested by the Owner. It unifies the previously discussed 25 dealership capabilities, the Zimbabwe dealer research workbook, O2 OCR and workbook foundations, existing compliance and corporate authorities, marketplace and dealer storefront functionality, and CarUp Payments (including PAY-03B and PAY-05 Paynow). It is an implementation specification, not a claim that every feature already works, and is not itself an instruction to begin source changes.

---

## 0. Executive direction and definition of done

### 0.1 Owner's intended product

CarUp must allow an existing or new dealership to:

1. Register or safely claim an already researched dealership/branch.
2. Download a comprehensive, field-defined Excel onboarding workbook or bring its own Excel/CSV records.
3. Complete the worksheet offline, once, and upload it. Structured Excel cells are parsed directly; **OCR is used to read unstructured supporting images/PDFs, not to re-read Excel cells**.
4. Receive an automatically populated, fully editable dealership application: legal identity, organization, branches, licences, authorizations, operations, sourcing, finance, warranty, buyer policies, media, contact channels and linked vehicle inventory.
5. See row- and field-level errors, conflicting evidence and import provenance; correct only genuine gaps without retyping accepted values.
6. Upload original regulatory evidence and authorize Document Intelligence to propose extracted facts, never verification decisions.
7. Confirm a versioned participation declaration and submit a governed application.
8. Receive independent CarUp compliance decisions, organization/tenant provisioning and role activation.
9. Use a real dealer workspace to administer branches, authorized staff, vehicle inventory, leads, policies, compliance renewals and permitted commercial services.
10. Present an accurate, attractive, accessible, SEO-capable public dealership page and searchable directory, powered by a buyer-safe publication projection only.
11. Optionally purchase approved CarUp services or dealer subscriptions using an authorized payment method; Paynow must be integrated **only through its actual eligible first-party merchant arrangement and approved provider state**, never by routing CarUp service money into a garage's separate Paynow merchant.
12. Keep business verification independent of vehicle/VIN-level identity, duty, inspection, title and listing eligibility.

### 0.2 Full acceptance outcome

A dealer with a completed valid workbook can import all supported values without manual re-entry, resolve only exceptions, submit documentary evidence and signed declarations, be independently approved and automatically provisioned into a correctly scoped legal organization and dealer tenant, operate their branch/inventory tools, and have an approved buyer-safe profile publicly visible. Suspensions, expiry, corrections, publication withdrawal and payment entitlements remain accurate across every surface.

**Full completion** requires integrated PostgreSQL tests, exact-head CI, physical authenticated UAT, visual and accessibility evidence, a 12-dealership pilot, independent certification and explicit Owner go-live authorization. Passing unit tests alone or showing a beautiful mock page does not meet this definition.

### 0.3 Non-negotiable policies

- The **Owner first reviews this document and decides who executes**. No specialist assignment or implementation authorization is implied.
- Extend existing canonical CarUp O2, Dealer Compliance, Corporate/AUTH, tenant/member, Seller, Vehicle, Marketplace, Document Intelligence and PAY-02/PAY-03B/PAY-04/PAY-05 systems; do not introduce parallel truth stores or a second billing ledger.
- **One legal organization can have multiple branches, staff, financing partners, authorizations, services and listings**; none of these may be incorrectly compressed into one text column.
- A document being uploaded or OCR-read does not mean it has been verified. A company being verified does not verify every vehicle. A merchant paying CarUp does not confer a trust badge.
- No fabricated dealers, stock, locations, prices, inventory counts, sales, customer reviews, complaint counts, verification labels or payment successes. Missing complaint data is **Not measured**, never zero.
- No unauthorized merge, production change, shared-staging mutation, third-party charge, migration or payment-provider activation. Use explicit environment and provider custody gates.
- Research directory rows are **potential dealer/branch discoveries**, not verified business entities or permission to create accounts for those businesses.
- Use approved open-source/free components or already-authorized provider arrangements. Do not introduce paid AI, OCR, geocoding or third-party infrastructure as an unapproved dependency.
- Each specialist produces evidence and a recommendation. Independent certification and final Moderator ACCEPT / REMEDIATE / BLOCK remain distinct.

---

## 1. Verified source inventory and state at preparation

This is a **source/evidence snapshot, not a claim of live deployment**. The active lineages are draft/unmerged and may differ from main and one another.

| Area | Evidenced source / reference | Finding and limitation |
|---|---|---|
| O2 source | Draft PR #208, candidate e65c0bb835c65abce43ea1a0407406e4bf6456bb | Dealer application, private evidence, branch additions, OCR candidates and workbook mapping were implemented/tested in this lineage; its OCR test used an injected provider double, not certified live dealer-document extraction. |
| One CarUp source convergence | Draft PR #221, head 531e822b40d60bda89fdb2435d2d1e93871469f0 | Seven direct profile fields; dealer OCR deliberately **deferred** for authority safety; onboarding overview returns document_extraction.available=false. |
| One CarUp runtime closure | Draft PR #222, head 082c73d85c1ae9e9d3b64674cdcb9d8dccbcd568 | No governed published dealer registry; DealerDirectory renders a truthful empty state and a dealer join entry. |
| Seven direct intake fields | backend/services/dealer/dealerOnboardingService.js; web/src/pages/dealer/DealerOnboarding.tsx | legal_name, trading_name, registration_number, tax_id, physical_address, responsible_person, operating_country. Not a complete 40-column contract. |
| Company/identity Document Intelligence | backend/services/document-intelligence/documentIntelligenceService.js and documentSchemas.js; backend/services/ai/ocrVisionProvider.js | Vision extraction exists, outputs candidate/provenance only; provider configured by CARUP_OCR_PROVIDER; business schema exists; dealer-specific call was removed. |
| Workbook migration front end | backend/routes/dealerOnboardingRoutes.js; workbookSemanticMappingService.js | Inspects first populated XLSX sheet, maps headers for a trade template, binds user confirmation to SHA-256 and runs the existing Diaspora dry run. This **does not** import the complete multi-sheet dealer business profile. |
| Broader vehicle workbook work | docs/features/o2/CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_RECEIPT.md on PR #208 | Separate vehicle workbook registry with dealer vehicle inventory templates, export, dry-run and no-reentry vehicle draft goals; the RC2 OC5C completion record says the #208 X5A catalogue was **not ported**. Qualify lineage before reuse. |
| Compliance governance | backend/services/dealer/dealerComplianceService.js | Review status, blocking requirements, decision ledger and publication evaluation exist. Buyer summary still hard-codes unresolved serious complaints to 0; reconcile active_state with publish semantics. |
| Dealer seller authority | backend/services/dealer/dealerListingAuthority.js | Checks tenant membership, member authority and dealership tenant type; documented inability to automatically activate new compliant dealer applicants. |
| Public directory | web/src/pages/DealerDirectory.tsx, PR #222 lineage | Empty by construction; no public governed dealer-profile read model or completed public dealer detail page. |
| Dealer workspace | web/src/pages/dashboard/dealer/DealerDashboard.tsx | Some tenant-scoped inventory improvements; sample fixed branch selector and local-only permission toggles remain; not complete operations. |
| Dealer subscription foundation | Draft PR #251, head c2d548edbe4cc7ac9528f3c4a2c7f55a1d8bad88; docs/payments/CARUP_PAY_03B_DEALER_BUSINESS_SUBSCRIPTIONS.md | Legal-organization-owned subscription/entitlement architecture and local/sandbox tests. Dealer storefront plan is unpriced and commercially blocked; not live. |
| PAY-05 Paynow | Draft PR #254, head 1d3b690198c5f0842fc580f36280714fedaba32a; docs/payments/CARUP_PAY_05_FINAL_CERTIFICATION.md | Level-1 garage-owned customer invoice collections: local protocol simulator, local PostgreSQL/HTTP/browser and CI evidence. No real Paynow provider call or live money; independent final certification remains required. |
| Zimbabwe dealer source workbook | Google Sheet “Zimbabwe Car Dealers & Automotive Companies Database”, 10 tabs, as reviewed 2026-11-03 | 104 researched dealer/branch entries; 104 intake records **Not started**, 0 formal submissions, 0 verified business claims, 0 approved public summaries, 0 recorded feedback entries. Research presence is not verification. |

**GitHub references:** https://github.com/kudzimusar/carup/pull/208 ; /pull/221 ; /pull/222 ; /pull/251 ; /pull/254.  
**Note:** These code references are intentionally not asserted to be merged, deployed or run together. D0 must establish the exact implementation parent and current database truth before any source work. No local runtime was executed in the preparation of this plan.

---

## 2. Complete capability requirements (C01–C25)

Every capability has a user outcome, owning authority and acceptance gate; “implemented in a branch” is not a substitute for integrated acceptance.

| ID | Capability | Required behavior | Owner of truth / acceptance |
|---|---|---|---|
| C01 | Online dealership registration | Business account, legal identity, contact, accountable person, draft continuation; no self-provisioned dealer authority | Registration + Dealer Compliance; tests for identity and registration scopes |
| C02 | Excel bulk onboarding | Versioned downloadable dealer template; one-file upload populates all permitted fields, branches and child records; no retyping | Dealer import domain; 100% mapped permitted fields and read-back parity |
| C03 | Existing-data migration | Existing XLSX/CSV headers and shapes, safe preview/map/dry-run, stable-ID matching | Import domain; conflict/duplicate tests |
| C04 | AI-assisted field mapping | Deterministic header mapping first; AI only optional, advisory, bounded by allowlists; human confirmation | Governed CarUp AI adapter; no invented row data or authority |
| C05 | OCR document extraction | Certificate/tax/licence/address evidence; per-field provenance and manual confirmation; expiry and issuer candidates | Document Intelligence observes, Dealer Compliance decides |
| C06 | Intelligent validation | Schema types, dates, country, conditional requirements, duplicate detection, branch IDs, links and evidence discrepancy | Deterministic server validations; field/row errors |
| C07 | Save/resume onboarding | Persistent drafts, file upload history, autosave, corrections, retries, version changes | Actor/organization-scoped intake store; re-entry tests |
| C08 | Legal business verification | Company registration, legal entity matching, responsible person's identity subject view | Identity Assurance + independent compliance |
| C09 | Conditional regulatory checks | Zimbabwe business and tax documents; bonded/OEM/PRAZ only where applicable; expiry, issuer, facility/branch scope | Jurisdiction catalogue + reviewer decisions |
| C10 | Independent approval | Maker-checker, reviewer step-up, append-only decisions and evidence custody | Existing dealer decisions; cannot self-approve |
| C11 | Automatic governed activation | Approved legal entity -> organization -> dealership tenant -> owner/admin member -> workspace | Corporate/AUTH/tenant domain transaction; idempotent |
| C12 | Compliance lifecycle | Renew, amend, suspend, reinstate, investigate, expire and withdraw public claims | Compliance review state + event/outbox; immediate revocation |
| C13 | Full dealer operating profile | Model, brands, sourcing, capacity/period, stock/consignment, duty policy and service capabilities | Normalized dealer business records and provenance |
| C14 | Multi-branch | Unique branch keys, geocodes, map link, hours, phone, amenities, parent entity | Dealer branches; verified location gate |
| C15 | Real dealer dashboard | Profile, branch status, inventory, inquiries, policy, payments, compliance tasks and real metrics | Existing relevant domain read models; no mock counters |
| C16 | Staff permissions | Invitations, authorization and true persisted owner/admin/staff permissions | Corporate/AUTH and tenant membership; tenant isolation |
| C17 | Vehicle inventory integration | Dealer stock import, per-VIN listing proof, drafts, publish/unpublish, real branch association | Canonical vehicle/seller/marketplace; no blanket duty badges |
| C18 | Public dealership directory | Browse/search/filter only explicitly published dealer profiles | Buyer-safe public projection; accurate counts and pagination |
| C19 | Rich public dealer page | Branding, about, branches/maps, contact, stock, services, links, verified claims, disclosure dates | Approved versioned projection, privacy-safe rendering |
| C20 | Buyer assurance | Contract, duty caveats, inspection rights, legitimate clearances and traceable provenance | Dealer policy + vehicle-specific evidence; scope labels |
| C21 | Finance/payment disclosures | Financing partners, terms, deposits, merchant policy, published currency and fees | Versioned policy terms; regulated/legal approval where required |
| C22 | Warranty/after-sales | Workshops, parts and support, coverage/exclusions, partners, durations | Branch/service capabilities + valid policy versions |
| C23 | Genuine reviews and complaints | Verified-buyer linkage, consent, moderation, dealer response, substantiation, counted period | Transaction/complaint evidence; unknown = Not measured |
| C24 | Plans, subscriptions and paid services | Organization-owned entitlements; explicit tariffs; Paynow where approved; receipts/reconciliation, no pay-to-verify | PAY-02 product registry, PAY-03B, PAY-05/PAY-06 as eligible |
| C25 | International expansion | Country configuration, legal IDs, conditional docs, language, currencies, privacy and mapping rules | Jurisdiction-specific policy/version; no false Zimbabwe requirements abroad |

**Cross-cutting enhancements:** accessible multi-step onboarding, field-level provenance, document/media lifecycle, self-service profile editing, map-driven discovery, SEO and structured metadata, immutable versions, notifications, search analytics, data retention and deletion governance, operator quality dashboards, and full observability.

---

## 3. Stakeholders, journeys and authority boundaries

### 3.1 Actors

- Visitor/buyer: view only published buyer-safe dealer profiles and vehicle listings.
- Applicant: register, claim entity, upload own files, edit draft, correct machine candidates, sign declarations; **no verification, role assignment or publication powers**.
- Dealer owner and delegated staff: operate only their actual organizational membership; branch-specific scopes as granted.
- CarUp research/data team: seed source discoveries and provenance, never confer verification or customer identity.
- Independent dealer compliance reviewer: verify scoped claims with evidence, record reasoned decisions after step-up, without acting as the applicant.
- Operations/finance operator: approve merchant/payment and certain policy actions with dual control, not compliance claims by virtue of billing access.
- Customer reviewer/complainant and moderator: only transaction-linked review/complaint evidence with consent and fair response process.
- Product Owner/Programme Moderator/independent certifier: contract approval, independent acceptance, release authorization.

### 3.2 Happy path for the dealer

Account -> establish/claim business identity -> download or import existing workbook -> inspect field mappings -> fix only blocking errors -> preview read-back populated application -> upload documents -> OCR observations -> confirm correct facts -> consent/declarations -> submit -> compliance decision -> approve -> organization and membership activation -> authorized workspace -> publish approved buyer-safe profile -> manage vehicles and branches -> optionally purchase approved services -> renew/review.

### 3.3 Adverse paths

- Existing research listing belongs to another legal entity, franchise or branch.
- Another actor tries to claim the same legal registration.
- Two companies share a trading name; branches share a street address.
- Missing provider, invalid PDF, timeout, unreadable or confidently wrong OCR.
- Workbook contains a forged role, verified flag, “no complaints”, payment confirmation or tenant ID.
- Spreadsheet changed after mapping approval; stale SHA-256 confirmation.
- Simultaneous upload and duplicate request; partial DB/storage failures.
- Compliance review rejects, requests evidence, expires or suspends a dealer after it was published.
- Garage operator tries to sell through a dealership tenant or staff scope.
- Payment fails, provider status disagrees, money refunded/disputed, merchant is suspended or service plan unpriced.
- User visits a stale public profile URL after withdrawal: must not display stale trust claims.

Every adverse path must fail closed, preserve audit and show a truthful actionable error.

---

## 4. Canonical data architecture and relational contracts

### 4.1 Reuse vs introduce

**Reuse / reconcile:**
- Account context: user registration and identity assurance.
- Legal entity: organizations; operating business: tenants; membership and access: tenant_users and Corporate/AUTH policy.
- Dealer domain: dealer_profiles, dealer_branches, dealer_compliance_documents, dealer_compliance_requirements and dealer_compliance_decisions.
- Vehicles: canonical vehicle, seller identity, media, evidence, listing publication and marketplace visibility.
- Payments: PAY-02 products and owner/funds rules; PAY-03B subscriptions/invoices/entitlements; PAY-04 collections/allocations/receipts; PAY-05 provider adapter and merchant custody where applicable; Stripe PAY-01 sandbox as separate merchant/jurisdiction.
- OCR/AI: existing Document Intelligence, approved vision provider and governed advisory gateway.

**Proposed bounded additions, subject to D0 schema reconciliation (names illustrative, not automatic migrations):**
1. **dealer_intake_batches** — uploader, dealer/application ID, file SHA-256, template version, mapping version, status, counts, created/committed timestamps and retry fingerprint.
2. **dealer_intake_sheet_rows** — sheet, physical row, stable source ID, target entity type/id, candidate payload, errors/warnings, applied result; no raw PII in audit logs.
3. **dealer_intake_field_provenance** — property key, source class, document/source reference, actor, submission version, verified review reference, override precedence and update time.
4. **dealer_research_identity_crosswalk** — source list, seed dealer ID, matched dealer/legal-organization/branch IDs, match evidence, reviewer, suppression/merge rationale and conflict state.
5. **dealer_business_authorizations** — licence/OEM/PRAZ/sector claim, issuer, legal and facility scope, jurisdiction, evidence, start/end dates, verification and state.
6. **dealer_operating_capabilities** — sourcing channels, stock model, brands, capacity with measurement period, workshop/inspection/parts capabilities, evidence scope.
7. **dealer_finance_partners** — authorized finance partners and written, approved lender/merchant claims, effective dates and territory.
8. **dealer_buyer_policy_versions** — sales contract, duty disclosure, inspection rights, deposits/refund/cancellation terms, warranty scope/exclusions, dispute/complaint routes, review and effective dates.
9. **dealer_media_assets and dealer_digital_links** — authorized logo, branch gallery, media ownership/licence, moderation, cover/order, URL health and public visibility.
10. **dealer_public_profile_versions** — approval fingerprint, redacted JSON projection, publication status, slug, public revision, published/withdrawn timestamps, reasons and search index update.
11. **dealer_agreement_acceptances** — immutable version/terms hash, organization identity, authorized signer, consent, timestamp/IP retention policy, review result.
12. **dealer_feedback_public_projection** — transaction-backed review/complaint metrics only from owning complaint/transaction authorities; do not create a parallel complaints truth table.

Create child tables only when current canonical structures demonstrably cannot represent them. Maintain relational foreign keys, tenant and entity scope, unique constraints, updated-by provenance, audit trace and reasonable retention. Private documents remain in protected storage; their signed URLs never enter public projections.

### 4.2 Identity hierarchy

User (actual human) -> authorized membership -> legal organization -> operational dealership tenant -> dealer profile -> many branches -> many relevant capabilities/policies/authorizations/vehicles/media.

**Never equate:** source research row = legal entity; brand/franchise claim = authorization; one legal entity = one branch; person account = dealership; paid plan = verified company; dealer approved = vehicle published.

### 4.3 Stable keys and merge rules

- CarUp UUIDs are canonical. External records use source-qualified stable keys, e.g., research source + ZW-DEAL-0001; **seed ID is not a company registration number**.
- Link record to legal entity only after safe normalized jurisdiction+registration identifier evidence and human handling of ambiguity.
- Parent company and branches have separate keys; multiple brands/authorizations/locations have child rows.
- Use deterministic matching candidates, not automatic fuzzy merges. Require human review for same trading names, shared phone numbers, franchise branches and incompatible registrations.
- Re-import uses immutable batch plus idempotent upsert with optimistic concurrency and reviewer-controlled updates for material verified claims.
- Users cannot import tenant_id, role, reviewer outcome, verification status, subscription entitlement, trust score, complaint verdict, receipt, payment paid state or publication authority.

### 4.4 Business and listing truth

Dealer Compliance governs eight lifecycle dimensions; publishing must additionally require applicable active_state and valid legal/tenant/membership authority, no suspended/restricted/expired state, required claims verified, approved public revision and any listing-specific completeness. Define **one policy shared across** admin status, public projection, vehicle publish API, seller authority and marketplace search.

Separate approved dealer profile visibility from VIN-specific vehicle listing visibility; a business cannot make its stock duty-paid merely by filling in “typical stock duty status.”

### 4.5 Private, approved and self-declared data

| Classification | Examples | Allowed use |
|---|---|---|
| Private regulated | tax IDs, government IDs, banking details, licences as raw scans, internal reviewer notes, security and IP data | Authorized applicant/reviewer only; masked in staff views as needed |
| Applicant-declared | hours, brand specialization, typical sourcing, lot capacity, contacts, financing options | Private draft; may be published only if policy permits and clearly labelled dealer-declared |
| Independently reviewed | legal name, scoped licence, verified branch location, OEM authorization | May be specifically labelled CarUp reviewed with source/scope/date |
| Transaction-derived | actual on-platform stock, sales if authoritative, verified buyer reviews and complaints | Publish only with sufficient transaction proof, consent, moderation, sample/period |
| Not collected | unknown complaints, unstated warranty, unavailable metrics | Show Not measured / Not supplied, never zero or affirmative claims |

---

## 5. Dealer Excel/CSV workbook specification

### 5.1 Principle

**CarUp Dealer Intake Workbook v1.0 is the single dealer-facing canonical template**, generated from a backend field registry. Both website manual forms and XLSX imports reference that same registry; they must not drift.

The 10-tab Zimbabwe source/research workbook is **not** issued unchanged. It includes internal verification, evidence, quality and buyer feedback worksheets; a dealer must not edit reviewer decisions or publish research claims. Preserve it internally as a research and migration crosswalk.

### 5.2 Customer-facing versioned tabs

| Tab | Grain/key | Primary fields / constraints |
|---|---|---|
| README / Instructions | Template | schema version, file integrity rules, help, required/conditional markers, source/consent notices, examples |
| BUSINESS | One legal entity/application | legal name, trading name, registration number and authority, country, tax ID (private), year, business models, accountable signatory, email/phone, physical head office |
| BRANCHES | Many rows keyed by branch_ref | branch_ref, type, name, address, province/city/suburb, GPS lat/long, reviewed map link, hours, official contact, site capacity, public visibility |
| LICENCES_AUTHORIZATIONS | Many rows keyed by authorization_ref | category, issuer, licence reference (private), jurisdiction/facility scope, evidence reference, issued/expires, conditional applicability, owner claim |
| BRANDS_FRANCHISES | Many per entity or branch | brand, relationship type, authorizing issuer, supported branch, effective/expires, evidence reference |
| OPERATIONS_SOURCING | Many declared categories | sourcing countries/channels, ownership vs consignment, new/used, typical duty and imports policy, volume with time period, inspection and vehicle-ownership process |
| FINANCE_PAYMENTS | Many policy or partner rows | accepted customer payment methods/currencies (declaration), bank/lender partners, written financing conditions, deposit/lay-by terms, fee disclosure |
| WORKSHOP_WARRANTY | Many branch or product policy rows | mechanical/inspection services, service facility, partners, parts, warranty covered systems, term, exclusions, claim procedure |
| BUYER_PROTECTION | One or versioned policies | sale contract, written quotation, condition, independent inspection, VIN before deposit, customs disclosure, ownership transfer, cancellation/refund/dispute process |
| DIGITAL_MEDIA | Many media/link rows | business description, authorized logo, branch photos (references only), map/website/catalogue links, marketing contact, alt text, consent/licence |
| VEHICLE_INVENTORY_REFERENCE | Links only; separately versioned template | inventory template/batch references and branch assignment; refer into existing vehicle-workbook engine, not business compliance |
| CONSENTS_DECLARATIONS | One or more authorized signatories | declaration answers, signed agreement version, signer identity reference, company attestation; execution must occur in governed server flow, not self-certified spreadsheet cells |

No customer workbook may include columns purporting to set **reviewer_verified**, compliance outcome, activation, role, trust badge, confirmed payments, verified buyer count or complaint disposition.

### 5.3 Field types, validations and presentation rules

- Legal/registration: normalized jurisdiction-qualified legal identifier; raw number private; no automatic legal verification.
- Tax/authorizations: number, issuer, evidence, expiry ISO date; *not applicable* distinct from missing.
- Dates: true date; reject impossible or ambiguous day/month values with row references.
- GPS: latitude [-90,90], longitude [-180,180], no forced country-centroid defaults; map host and branch consent reviewed.
- Capacity/sales: numeric quantity and period, declared vs audited; cannot become real completed sales metrics.
- Contact: valid phone format with country and consent; preserve original raw form for correction; no public director private phone.
- Finance: permitted currencies with jurisdiction and merchant; distinguish “dealer offers bank finance” from verified lender partnership.
- Warranty: terms, exclusions, branch and vehicle class and effective dates; never assert coverage for every vehicle.
- Company/branch photos: workbook can carry URLs and metadata but binaries must pass media upload with ownership/licence checks; failed URL is an explicit issue.
- Source citation and evidence reference: link must be authorization-checked and never copied into public pages.
- For every declared field: key, display name, type, format, allowed values, required/conditional state, privacy, publication rule, authority owner, validator, source of truth, help/example and migration behavior.

### 5.4 Existing files, CSV and spreadsheet compatibility

- Official XLSX import: multiple named worksheets, header/help row detection from manifest, explicit version, stable source IDs, relationships between sheets, formula cached-value and spreadsheet-injection handling.
- Existing XLSX/CSV: explicit source files/sheet selection and deterministic mapping first; optional governed AI suggests **headers only**. A CSV represents one defined grain; multiple CSVs require signed manifest/relationship mapping.
- Unsupported older schema: return version error and migration preview, not silent reinterpretation.
- Enforce file size, row/column count, sheet count, ZIP expansion, MIME magic, formula/link/CSV injection and malware policy.
- No assumption that all existing dealer data is clean or in one file. Support import previews with optional mapping profiles saved *per organization*.

### 5.5 Migration of Zimbabwe research directory

Research workbook (10 tabs) has 104 source discoveries and zero verified dealer/public records. Its importer is **internal-only**:
1. Ingest with source-locked provenance; do not create 104 verified dealer accounts.
2. Detect legal parent and branch clusters; match to canonical entities only with evidence.
3. Retain research seed IDs as crosswalk references.
4. Allow eligible dealer to claim an actual business through ownership proof, avoiding hostile or duplicate claims.
5. Apply dealer-approved corrections through normal intake, not research write authority.
6. Preserve internal verification decisions, research notes and buyer complaint logs as non-importable private domains.
7. Run an initial **12 representative branch pilot** including franchise, independent, multi-branch, consignment/import and different Zimbabwe locales.
8. Produce authoritative conversion metrics: research discovered, claimed, submitted, verified, active, published; never combine these as a single “registered dealers” number.

---

## 6. One-upload import engine and no-reentry acceptance

### 6.1 Required state machine

FILE_RECEIVED -> SECURITY_CHECKED -> VERSION_IDENTIFIED -> SHEETS_PARSED -> FIELD_MAPPING_PROPOSED -> HUMAN_MAPPING_CONFIRMED -> VALIDATED -> DRAFT_STAGED -> USER_CORRECTIONS -> USER_CONFIRMED -> DRAFT_COMMITTED -> READ_BACK_VERIFIED -> SUBMITTED_FOR_REVIEW. On errors: explicit FAILED_VALIDATION / AWAITING_USER / QUARANTINED / RETRYABLE_FAILURE / REJECTED. No import state by itself grants verified/public status.

### 6.2 Processing behavior

1. Authenticated request bound to one applicant and organization application; secure staging and checksum.
2. Read all required worksheet names in scope, not merely the first nonempty sheet; generate a per-sheet manifest.
3. Resolve fields from the canonical registry; suggest mappings deterministically first, AI only for unresolved headers (advisory, fail-open to *manual mapping*, never to authorization).
4. Present fields grouped into existing record, new child record, ignored, ambiguity and invalid value, before confirmation.
5. Bind mapping confirmation to uploader, application, file SHA-256, schema version, sheet IDs, row grain and mapping version.
6. Parse normalized values with conflict severity: error, warning, re-review and valid. Missing is different from zero/false/not-applicable.
7. Resolve parent and child references, duplicates, cross-tenant conflicts and protected previously verified values.
8. Persist draft and field-level provenance using transaction boundaries, idempotency keys, durable batch receipts and retry-safe service methods. Storage side effects have compensating cleanup and reconciliation.
9. Return exact per-row and per-field diagnostics, including sheet name, Excel row number, column label, proposed value, existing value, reason and permitted correction.
10. Show a human-editable **prepopulated full application** with source markers, candidate vs verified information, completeness per tab and public-preview switch.
11. Dealer explicitly confirms corrected data and required declarations; the server revalidates checksum and current authority.
12. Read back the canonical records, compare allowed fields and relationships, and refuse “import complete” if parity fails.
13. On duplicate/retry: no repeated organizations, branches, licences, subscriptions, listings or webhook events. Preserve import history, cancellation and read-only error report export.
14. On verified-field conflict: queue a review/version amendment; do not overwrite a previously approved public projection.

**Zero manual re-entry gate:** every valid importable field in an accepted workbook appears as persisted editable data on the relevant page, with its source trace, without asking the applicant to type it again. Legitimately missing information, consent, legal signing and substantive OCR corrections remain explicit user actions.

### 6.3 Failure message UX

Examples: “BRANCHES row 7: branch_ref BR-02 is already bound to another address”; “LICENCES_AUTHORIZATIONS row 4: expiry 31/02/2026 is not a calendar date”; “BUYER_PROTECTION row 2: refund policy URL cannot be fetched or reviewed”; “Business registration number conflicts with an approved entity; manual identity review required.” Raw SQL and private identity never shown.

---

## 7. OCR, AI and document evidence convergence

### 7.1 Correct technical division

- **Structured .xlsx/.csv:** deterministic parser + schema, no OCR.
- **Scanned/photo/PDF company evidence:** existing Document Intelligence with configured provider; candidate facts and provenance only.
- **Header mapping:** deterministic first; CarUp AI advisory on header names only; no row-level PII to mapping prompts.
- **Verification:** Dealer Compliance independent reviewer; no model-driven approval, role, publication or trust decision.

### 7.2 Repair previously tested dealer OCR safely

O2 PR #208 called the OCR extraction service directly and associated candidates with dealer documents; its test used a controlled OCR double. OC-5C removed the dealer OCR route because it bypassed the governed Document Intelligence authority pattern. **Do not simply revert the removal.**

New integration requires:
- Reuse the one Document Intelligence provider boundary, user attribution and original evidence custody.
- Create a dealer document-class schema (company registration, tax clearance, branch address, franchise/OEM letter, bonded licence and where relevant PRAZ) with issuer, issued/expiry, legal identity and scope.
- Verify MIME from actual bytes, size and storage ownership; no supplied storage paths, no applicant-supplied verification status, no leaking signed raw links.
- Handle image and **multi-page PDF** through an explicitly proven renderer/page extractor. The current vision provider handles one image/request; PDF acceptance alone does not prove correct page ingestion.
- Return observed candidates per field with actual provider/model, extraction time, document class, page, source, unreadable state, unknown confidence and schema version.
- Detect mismatch against workbook legal names, registration, branch location, issuer, expiry; present side-by-side correction.
- Never coerce missing provider confidence to user-facing 0 or fake 100%; no auto-approval based on confidence threshold.
- Place failed extraction in an auditable “provider unavailable”/“manual review” state, never discard the original upload or claim OCR succeeded.
- Support explicit user confirmation/correction and **independent reviewer** decision. Revocation/expiry must affect derived claims and public surfaces.
- Verify provider configuration is authorized, free/quota-compliant and privacy reviewed before using any external model on sensitive documents.

### 7.3 Qualification corpus

Real/synthetic-labelled corpus: good scans, photographed pages, blurred/rotated/glare, wrong document type, non-document images, forged stamps, conflicting issuer, stale tax certificate, ambiguous day/month, multi-page PDF, unknown country, names in different spellings, missing fields, duplicate submission, language variants, provider outage and retry. Blind QA must measure field precision/recall and wrong-field rate separately from test-double success. A high confidence fabricated company is a critical failure.

---

## 8. Dealer compliance, activation and lifecycle

### 8.1 Jurisdiction-based conditions

Zimbabwe requirements must be conditional. Core business incorporation/tax and identity depend on actual business form and current law; bonded warehouse licence only for a bonded facility; PRAZ where government procurement is claimed; OEM authorization only for official/franchise claims; financial partner authorization when such relationships are advertised. Capture issuer, regulatory source/edition, review period, branch scope and applicability. Obtain legal/regulatory confirmation; spreadsheet descriptions are **not legal advice or current licences**.

International mode uses country-code policy versions, correct document labels, currencies, address formats and alternative regulators; does not blindly impose Zimbabwe PRAZ/ZIMRA on foreign applicants. Country expansion is a separately approved policy rollout.

### 8.2 Compliance state and truth fixes (P0)

- Reconcile **active_state**, identity verified, compliance passed, restrictions, suspension, investigation, expiry, blocking requirements and listing limits into one deliberate publication policy. The inspected deriveCanPublish did not itself test active_state: repair policy semantics and test all downstream gates.
- Replace hard-coded unresolved_serious_complaints=0 with measured, sourced complaint data; unknown => **Not measured**. No complaints register != no complaints.
- Require verified source, evidence ID, reviewer ID, scope and effective/expiry dates before claim gets an independent review badge.
- Ensure reviewer decision ledger and lifecycle status changes are atomic/fail-recoverable; audited after state write as appropriate, and sensitive preview/decision requires recent step-up.
- Version signed participation agreement, applicant authorized-signatory proof and consent. A workbook entry cannot itself sign a legal agreement.
- On expiry/suspension/rejection: revoke affected claims, profile publication and listing permission according to scope, not necessarily all historically accurate sales records; trigger cache/search invalidation.
- Keep a correction/review appeal path with independent decision evidence and a customer-visible status suitable for each case.

### 8.3 Approved -> operational dealer transition (P0)

Governed server-side action:
1. Verify approved application, signer, legal entity match and conditional requirements.
2. Idempotently bind/create canonical organization and dealership tenant, rejecting ambiguous legal entities and cross-tenant collisions.
3. Establish owner/admin membership with validated authority, not user-supplied tenant_id/role.
4. Issue a stable dealer profile/business linkage and correct staff scope.
5. Set operational activation only after required checks and organization/tenant writes succeed; recover from partial failures without duplicating tenancy or role.
6. Grant dealer workspace based on actual membership, not registration alone.
7. Apply business/public profile publication separately; vehicle listing rights still require each VIN's own seller authority and completeness.
8. Verify suspended/revoked/expired lifecycle disables rights promptly across API, cache, sessions and user interface.

Paying subscription invoice cannot bypass these steps.

---

## 9. Private dealer workspace and public buyer experience

### 9.1 Private navigation/UX

Sections:
- Overview (applications, blocking tasks, verified vs declared counts, compliance, next action).
- Business profile (legal facts, branding, public description, preview).
- Branches (real branch selector, verified address, hours, maps, media and stock attribution).
- Documents & evidence (private uploads, OCR candidates, reviewer comments and expiry).
- Licence/authorization centre (scoped claims, renewals and history).
- Inventory and listings (link existing seller tools, vehicles and VIN-specific evidence; import separately).
- Enquiries/CRM (tenant-scoped real data, not invented lead/sale counts).
- Staff and access (actual Corporate/AUTH tenant memberships and scoped permissions; no local-only toggles).
- Buyer policies, financing, warranty and after-sales.
- Reviews and complaints (real transaction linkage, moderation and fair response).
- Payments & subscriptions (separate merchant-as-payer and merchant-as-payee views, as applicable).
- Activity/history, notifications, export and profile privacy.

Dashboard values must come from measured read models. If no authoritative sales table exists, report “Not available” rather than static charts.

### 9.2 Public dealer directory

**Proposed URL:** /dealers. Search by city/province, dealership type, brand, advertised services, approved branch distance (when geocoded), available real vehicles, declared vs verified capability. Paginated source-backed results only. Maintain index freshness and consistent search/list counts; no mocked verified badges or undisclosed sponsored ranking.

### 9.3 Public dealer profile

**Proposed URL:** /dealers/{approved-slug}; stable slug + immutable ID redirect policy.
- Header: authorized logo, legal/trading public name, branch region, safe contact/website, narrowly scoped verified claims and review date.
- Overview: dealer-approved description, model/specialization, sourcing and current company claim state.
- Locations: verified branches, address, coordinates, real hours, phones, map and direction links; no synthetic map pins.
- Cars for sale: canonical live VIN-specific listings with publication status, images, accurate prices/currency, duty disclosure per vehicle; link to listing/Passport.
- Services: after-sales, workshop, parts, inspection and sourcing.
- Payment and finance disclosure: written terms only, valid provider/finance partners, deposit/refund conditions and itemized additional fees where appropriate.
- Warranty/returns/assurance: versioned coverage, exclusions, inspection rights, dispute path and truthful complaint measurement.
- Reviews: only eligible consented transaction-backed buyer feedback, with sample size/date and moderation.
- Trust information: distinguish **CarUp reviewed** specific claim, **Dealer declared**, **Not verified**, **Not measured**, **Expired/withdrawn**. No purchased trust badges.
- Media: correct owner/licence, responsive sizing/alt text, placeholders on unavailable imagery, moderation and no broken image gallery.
- Accessible contact CTA (inquiry, phone or email where consent), no fake booking or payment action.

### 9.4 Public profile projection contract

Create a versioned server-produced buyer-safe read model separate from private dealer tables. Explicit allowlist, field-level provenance/verification labels, approved media and links, no tax numbers, registration scans, bank details, internal notes, private people or storage paths. Revision invalidation on compliance decisions. Server-side privacy and role tests; no broad SELECT * exposure.

### 9.5 Presentation QA

Test 390, 768, 1280 and 1920 px, real text overflow, long names, many branches, empty data, RTL/international considerations as relevant, screen reader labels, keyboard focus, mobile menu, website/phone link sanitization, map graceful degradation, images, structured metadata, canonical URLs, social previews, SEO indexing rules, loading/empty/error states and public cache invalidation. Check exact database-to-API-to-page parity; visual polish cannot replace correctness.

---

## 10. Payments and commerce — existing Paynow, subscriptions and service fees

**This section is required by the Owner. It protects the work already done and tested while avoiding the common mistake of treating all Paynow money as belonging to CarUp.**

### 10.1 Separate legal money flows

| Money flow | Payer | Legal beneficiary / merchant of record | Current source authority / status | Dealer programme action |
|---|---|---|---|---|
| A. Dealership pays **CarUp** for approved products/services | Dealer legal organization | Approved relevant CarUp entity/merchant and jurisdiction | PAY-02 product registry, PAY-03B subscription foundation; dealer plan currently unpriced/commercially blocked | Build first-party checkout entitlement path only after approved tariff, legal merchant, tax/currency, provider qualification, independent cert and Owner authorization |
| B. Dealer buyer pays **dealership** for a dealer-owned invoice or service | Buyer | Dealership's own verified merchant | PAY-05 currently implements **garage** merchant invoice collections via Paynow simulator, not dealers | Requires distinct approved dealer-owned extension with legal ownership, provider terms and certification; do not reuse garage funds owner labels for dealer money |
| C. Garage customer pays **garage** via Paynow | Garage customer | Garage's own tenant merchant | PAY-04 + PAY-05 Level 1 implemented/tested locally; Paynow live blocked | **Preserve**; no redesign or invocation in dealer pilot |
| D. CarUp Japan first-party Stripe sandbox product | CarUp customer | Approved CarUp Japan sandbox account, where product is authorized | PAY-01/03A sandbox programme | Do not silently route Zimbabwe dealer fees through Japan Stripe |
| E. Other-party service-provider/finance/insurance/carriage money | Relevant customer | Specific legally entitled third party | Product inventory includes blocked categories, provider/legal authority not approved | Out of scope unless separately legally authorized |

**PAY-05 as actually built:** customer pays garage invoice through **garage's Paynow merchant**, one integration per garage and currency; signed provider status independently polled; no settlement to CarUp; one durable request/idempotent recovery; the accepted Paynow adapter is on PAY-04's invoice/receipt/collection foundations. PAY-05 recognizes USD and ZWG where supported, not “ZIG”, and does not invent provider cancel, merchant refund or FX APIs. Actual Paynow provider activation is blocked.

**Important:** The Owner's requirement “merchants can pay for CarUp services through Paynow” is **flow A**, not proof of an implemented PAY-05 garage collection. Flow A requires approved first-party CarUp Zimbabwe Paynow merchant and a separately authorized adapter/checkout mapping to PAY-02/PAY-03B (or approved future programme). It **must never** redirect CarUp's service invoices into a garage's merchant account. If the word “merchant” also means a dealer collecting from customers, that is flow B and is separately governed.

### 10.2 Mandatory billing capabilities for dealer services

- Product catalogue: reuse PAY-02 immutable product codes and price/term versions (including the dealer storefront package; no prices invented here).
- Commercial approval: Owner-approved price, currency, taxes, billing interval, service definition, legal beneficiary, eligible jurisdiction, consumer/business terms and effective date. “Unpriced” must not create a payable checkout.
- Business ownership: organization subscription and tenant relationship from existing PAY-03B; buyer's individual user is not subscription owner.
- Entitlement: a paid/sandbox-confirmed subscription may enable **commercial service scope** only (e.g., enhanced storefront tools, feature limits) after verified provider reconciliation; never verification badge, compliance, identity approval or vehicle duty status.
- Checkout: provider eligibility, signed requests, correct amount/currency/tax, idempotent initiation, redirect/return that **does not equal paid**.
- Reconciliation: signed notification authenticity + fresh provider status read, finance ledger, disputes/chargebacks, held/uncollectible states, duplicates and out-of-order events, receipts, invoice history and refund policy (never claim Paynow merchant refund API).
- Lifecycle: trials/grace where expressly approved, renewals, cancellation, payment failure and entitlement revocation through canonical access checks; no stale continued access.
- Merchant custody: encrypted secrets, independent operator verification, one integration per entity/currency, anti-SSRF provider URLs, no client-supplied merchant mode, public key fingerprints only, incident kill switch.
- UX: dealer organization billing page, real product/plan labels and costs, receipt/invoice history, payment status reconciliation and clear next actions.
- Country: evaluate Zimbabwe merchant structure, supported Paynow methods (e.g., mobile money) and currency policy at activation; do not claim a method live without real-provider certification.
- Separation of public listing entitlement from trust/publication authorization: commercial package may be required for certain *extras*, but payment never overrides baseline dealer compliance.

### 10.3 Existing Paynow evidence and explicit blockers

PAY-05 final local evidence at tested a0ddee281e75936da39ea1adb3d8105bead63bc3 documented 41/41 HTTP, 12/12 headed browser, 26/26 PAY-04 HTTP and 9/9 browser regression, dual PostgreSQL/CI evidence. Final docs-only/test-only head 1d3b690198c5f0842fc580f36280714fedaba32a is draft PR #254. These are **specialist/local Level 1 results**; formal independent certification is not silently conferred, and no live Paynow charge/settlement has occurred.

Keep PAY-05's **BLOCKED_OWNER_PROVIDER_EVIDENCE**: Owner+provider+merchant approvals, live credentials, 19 provider-specific unresolved questions, database and environment real-mode guards, and separate Level 2 rehearsal must be resolved before any actual charge. Do not connect a real merchant, alter keys, enable staging/production or sell paid services as part of this plan.

PAY-03B dealer_storefront_package remains **commercially_blocked and unpriced**. A tested subscription simulator is not a funded, deployable dealer billing product. A dedicated commercial authorization and finance reconciliation certification are required before public price/checkout UI.

### 10.4 Payment non-goals and negative tests

No merchant-of-record guess, no garage-to-CarUp funds substitution, no shared gateway keys, no false “paid” after browser return, no invented Paynow refunds, no provider charge on internal test, no payment-triggered verification, no plan/price invented, no silent subscription on application approval. Test merchant/tenant/currency mismatch, duplicate callbacks, unsigned updates, late Paid, disputed/refunded, retry after network timeout, duplicate billing periods, wrong amount, provider unavailable, suspended merchant and cross-tenant leakage.

---

## 11. Work programme, scope freeze and acceptance gates

The phases below are **proposed sequencing**. No phase is authorized by filing this document. An Owner-approved execution assignment must name the exact parent SHA, branch, scope, evidence and independent certifier; product changes proceed one authority writer at a time.

| Phase | Dependency / detailed scope | Required output | Gate to exit |
|---|---|---|---|
| **D0 — Authority & fault inventory** | Compare current main vs O2 #208, OC #221/#222, Corporate/Garage/Seller, PAY #251/#254; inspect actual schemas, APIs, UAT and deployments | Evidence-indexed field-by-field source contract; baseline SHA; failure register; conflict/ancestry map; one authority owner per record | Moderator signs off factual inventory; no assertions of deployed parity without physical evidence |
| **D1 — Data & workbook contract** | Define dealer entity/branch/authorizations/policies; map 40-column intake + verification/buyer-assurance sheets, ten-tab research, 25 capabilities; privacy matrix | Versioned dealer schema/field registry, entity ERD, workbook layouts, CSV mapping, API contracts, migration/additive DDL plan | 100% disposition of source fields, no accidental import of reviewer/governance fields |
| **D2 — P0 authority and truth repairs** | Complaint “0” fix; deriveCanPublish active state; account->organization->tenant->role ownership model; govern reviewer and document operations | Fail-closed compliance/activation ADRs, P0 fixes as Owner-authorized separate changes, regression matrix | No forged role/tenant, no false complaint assertion, no conflicting active/public gate |
| **D3 — Official workbook & forms** | Generate beautiful annotated dealer-facing XLSX; same registry drives manual form/help/error display; schema versions and conditionals | Dealer Workbook v1, accessible manual editor, sample/test files, metadata and guides | Workbook keys and UI/DB validators agree; exported/saved draft parity |
| **D4 — Multi-sheet import and migration** | Secure parser, field matching, checksum confirmations, stable identity, staged draft, idempotency, internal research crosswalk | One-upload intake engine, review report, import histories, rollback/recovery, 104-row internal migration dry run | Full valid workbook imports without re-entry; duplicate/conflict and DB parity proof |
| **D5 — OCR reconvergence** | Governance-safe Document Intelligence for business docs incl. PDF page strategy; candidate reconciliation and user confirmation | Document-class schemas, tests and UX; privacy/provider qualification evidence | Real-document corpus passes accuracy/security, no extraction-driven approval |
| **D6 — Activation and corporate governance** | Approved applicant->legal organization->dealer tenant->owner/member->workspace with idempotent service transaction | Canonical activation contract, membership and suspension/reinstatement tests | Approved dealer reaches correct real workspace; rejected/expired dealer cannot |
| **D7 — Private dealer workspace** | Profiles, branches, inventory references, staff/permissions, policies, contacts, media, compliance, notifications, pricing/lead views | Production-shaped dealer UI/API; no fixed fake branches or local-only permissions | Actual data read-back and tenant isolation across all operations |
| **D8 — Public directory and pages** | Buyer-safe projection, approved public media, search/index, SEO, profile and stock links, disclosures/complaint counts | Real directory and mobile dealer detail; retraction/invalidations | Only verified/approved and clearly declared public values, no private leaks |
| **D9 — Commercial Paynow/entitlement integration** | Define first-party CarUp service billing vs dealer/garage payees; approved PAY-02 products, PAY-03B owner subscriptions; Paynow activation requirements | Commercial owner-decision register, first-party Paynow integration spec, separately tested payments/entitlement workflow if later authorized | Unpriced/live-unauthorized checkout refuses; correct legal beneficiary; exact provider reconciliation |
| **D10 — Country configuration** | Zimbabwe conditional catalogue, legal review, expansion policy plug-in; currency, locale and documents | Jurisdiction/version registry, Zimbabwe-qualified rules, country pilot plan | No incorrect jurisdiction-required fields; proper expiry and consent |
| **D11 — Independent end-to-end certification & pilot** | Database/migrations, 12 dealer sample, real upload/OCR, auth, reviewer, payments offline, public snapshots, responsive UX | Gate matrix, golden UAT scripts, red-team negatives, exact-head CI and screenshots; consolidated independent report | Independent recommendation + final Moderator disposition + Owner release approval |

### 11.1 P0 to P2 priorities

**P0 / before public rollout:** authoritative source reconciliation; fixed zero-complaint summary; consistent active/compliance/listing policy; secure legal organization/tenant activation; complete dealer-specific schema; no-reentry import core; private/public separation; independent reviewer and evidence custody; no fake public directory records.

**P1 / required complete 1.0:** versioned signed agreement, branches/GPS, legal authorizations and conditional laws, production-shaped dashboards, OCR reconvergence, safe research directory identity linking, real public profile and search, media, warranty/finance/buyer policies, real user notices and accessibility.

**P2 / gated enhancement:** approved paid services, first-party Paynow provider path (without circumventing approved authority), deeper business analytics, richer review/reputation, country expansion, optional AI assistance and advanced search.

### 11.2 Suggested implementation packages (for Owner assignment later)

- **WP-A: Architecture and source certification (D0–D1).** Read-only discovery, ADRs, field/authority coverage; independent moderator review.
- **WP-B: Core security and activation (D2 + D6).** One domain writer, exact-head DB/identity tests.
- **WP-C: Bulk intake and OCR (D3–D5).** Separate parser and Document Intelligence owners, shared schema, one final integration writer.
- **WP-D: Dealer operating + public UI (D7–D8).** Private/public projections, real backend; visual and access certification.
- **WP-E: Commercial payments (D9).** Existing PAY programme specialist, no live provider absent separate Owner policy; independent finance reviewer.
- **WP-F: International policy and final certification (D10–D11).** Legal/jurisdiction expert and independent operational UAT.

All packages are future proposed assignments, not orders issued now.

---

## 12. Verification matrix and evidence

### 12.1 Required exact-head test stack

1. **Field contract:** all tab/column definitions map to a canonical target or explicit non-importability; field count and schema version pinned; no drift with manual UI.
2. **Parser:** XLSX many-sheet, CSV, quoted/newlines, empty, merged cell, formulas, duplicate headings/keys, whitespace, 1000+ rows, malicious ZIP expansion, CSV injection, wrong MIME, old version, non-document file.
3. **Import/migration:** idempotent replay, partial storage failure, atomic child linking, ambiguous research crosswalk, cross-tenant collision, source edits, material verified-field conflict, re-import + stale SHA confirmation.
4. **OCR:** live-evaluation fixture corpus, accuracy and hallucination guard, independent review gating, provider outage, PDF page handling, privacy and document class mismatch.
5. **Identity:** forged company owner, forged member/tenant/role, rejected signatory, applicant-to-active transition, suspension immediate revoke, reviewer step-up.
6. **Compliance:** legal/branch authorization scope, issuer/date/expiry, applicable/not-applicable, true complaints measurement, independent decision vs imported claims, event/cache invalidation.
7. **Payments:** no first-party charge without approval; PAY-03B version/price/tax/merchant; PAY-05 inherited garage isolation; payment statuses and cross-merchant mismatch; provider return is not payment; manual “paid” never accepted.
8. **Public privacy:** safe exact projection, no private IDs/docs/tax/banking, no unauthorized merchant secrets, no internal notes in search/snippet/logs.
9. **Marketplace:** public dealer->actual published VIN listings, correct branch membership, duty/title/inspection per VIN, withdrawn dealer and stock retraction.
10. **Accessibility/visual:** 390/768/1280/1920; keyboard, screen reader, no overflow or broken imagery/links, representative long African legal names and multiple branches.
11. **Operational:** precise row errors, importer telemetry, audit and event reconciliation, change history, backups/rollback, non-leaking logs and retention rules.
12. **Physical UAT:** authenticated actual app on isolated approved database; source SHA/deployment SHA/schema fingerprint and test output all correlated.

### 12.2 Quantified exit targets (proposed standards)

- **100% of workbook field definitions accounted for** in schema, import and UI parity matrix; unimportable fields explicitly listed.
- **100% valid, importable pilot cells** read back into correct canonical record without retyping; no unknown silent drops.
- **0 unauthorized compliance/publication/tenant/merchant writes** under adversarial cases.
- **0 private source values in public projection** and **0 fabricated sales, reviews, unresolved complaints or provider confirmations**.
- **0 duplicate legal entities/branches/invoice requests** on idempotency test.
- **All P0 negative path and migration certification gates PASS** at identical exact-head source.
- **All 12 pilot dealers** complete a realistic application lifecycle; record missing-data exceptions separately from product defects.
- For OCR, establish acceptable precision/recall/error thresholds **after** representative baseline measurements and privacy risk classification; never invent a certified percentage.
- Commercial payments require separate ledger/reconciliation exact-head proof, provider authorization and real-mode Owner gate; a mock/simulator PASS is only Level 1.

### 12.3 Independent acceptance

Specialist self-testing -> source and data custody independent inspection -> exact-head CI verification -> physical staging (only after explicit authorization) -> security/finance/privacy verification -> independent final recommendation (ACCEPT/REMEDIATE/BLOCK) -> Moderator disposition -> Owner release authorization. Produce immutable evidence receipts, source SHA, branch/PR, schema revision, case IDs, screenshots, log redactions and blocker classification.

---

## 13. Risks, mitigations, and hard stops

| Risk | Impact | Control and stop condition |
|---|---|---|
| Wrong implementation lineage / source “looks complete” | High | D0 freezes exact parent; read actual DB/deployment; stop on unmerged lineage mismatch |
| OCR candidate mistaken for verified identity | Critical | Human review, provenance and no authority writes; fail non-document/high-confidence inventions |
| Ten-tab workbook imported through vehicle trade path | Critical | Dedicated dealer schema, multi-sheet parser and explicit per-sheet grain; do not run legacy importer blindly |
| Duplicate dealer/entity or takeover of discovered branch | Critical | Registration/issuer proofs, safe claim path, manual ambiguous merge approval |
| Private business identifiers/keys exposed publicly | Critical | Allowlisted projection, redaction, authorization tests, signed private document access |
| Suspended dealer still published/listing | Critical | Unified activation/publish policy, event invalidation, negative UAT |
| “0 complaints” implies clean record | High | Actual linked evidence and Not measured state; no fabricated zero |
| Payment uses wrong legal merchant account | Critical | Funds-owner matrix, first-party CarUp merchant approval, separate garage/dealer ledgers |
| Mistaking Paynow simulator for real money | Critical | Explicit simulator labels and real-mode DB/env kill switches; no live provider calls |
| Expiry/legal claims stale or rules guessed | High | Conditional jurisdiction policy, reviewer, issuer/expiry and legal qualification |
| Spreadsheet changes silently override verified fields | High | Version/conflict queue and checksum; no applicant authority for verification writes |
| Dashboard false roles/permissions or fake metrics | High | Canonical membership enforcement and observed metrics only |
| Unsafe file/XML/ZIP inputs | High | File security, parser quotas, quarantine, malware checks and isolation |
| Partial upload/DB transaction inconsistent | High | Idempotency, atomic domain writes, cleanup/reconciliation and traceable batch receipts |
| Commercial cost/tariff invented | High | PAY-03B commercially blocked until Owner tariff/merchant/tax authorization |
| External paid dependencies introduced without approval | Medium | Free/open-source/authorized provider design with explicit cost/privacy review |

**Immediate STOP:** any cross-dealer access, company identity takeover, OCR-driven self-approval, bad public privacy projection, incorrect legal money ownership, unapproved real payment/production operation or source authority divergence.

---

## 14. Responsibility, governance and delivery rules

### 14.1 Proposed RACI-style decision ownership

| Decision / output | Accountable | Responsible in future | Independent assurance |
|---|---|---|---|
| Product vision/requirements/prioritization | Product Owner | Future designated Programme specialist | Moderator |
| Exact source and authority baseline | Moderator | D0 architecture specialist | Independent source reviewer |
| Field model/workbook/CSV import | Owner-approved technical lead | Dealer intake specialist | Data privacy + DB reviewer |
| OCR/document intelligence | Domain/OCR authority owner | OCR integration specialist | Security/accuracy reviewer |
| Organization/tenant/roles | Corporate/AUTH domain owner | Activation specialist | Identity/security reviewer |
| Regulatory claims | Product Owner + authorized policy reviewer | Dealer Compliance specialist | Independent compliance reviewer |
| Public UI and buyer projection | Product Owner | UI/marketplace specialist | Privacy/accessibility reviewer |
| PAY-03B/Paynow integration | Product Owner + finance/legal authority | Payments programme specialist | Independent money/security certifier |
| Release approval | Product Owner | Operations after explicit authorization | Moderator final disposition |

No implementer has been selected by drafting this plan.

### 14.2 Every future specialist instruction must contain

Programme ID and work package; frozen parent SHA and source/target branch; accepted authority references; exact file ownership; prohibited source/migrations/payments/production; product and negative acceptance cases; test/runtime evidence required; independent review checklist; return format; open risk register; exactly one recommended disposition; and explicit “do not merge” unless Owner authorizes.

### 14.3 Branch and release governance

- This document belongs to a **docs-only proposed PR** against main, not a direct main edit or production release.
- The Owner reviews and may revise/reject before approving programme scope.
- On approval, freeze the accepted plan version and assign D0 first; do not issue all packages simultaneously without reconciled dependency control.
- Every product work package uses one writer and separate independent read-only certifier; no unauthorized staging migrations or production keys.
- Accept/reject/repair returns require exact-head source and actual evidence, not screenshots from invented fixtures.

---

## 15. Open decisions the Owner must make before implementation

**O1. Plan scope and ordering:** approve this 25-capability target and D0–D11 dependency sequence, or request adjustments.

**O2. Legal dealer onboarding terms:** company participation agreement, required signer, jurisdiction and privacy/dispute language.

**O3. Public information policy:** which unverified but self-declared values may be shown, and what legally sensitive identifiers must never be exposed.

**O4. Dealer identity claims:** whether a CarUp-seeded discovery profile is claimable only after documentary proof, and merger/appeal policy.

**O5. Business licences:** authorize independent current Zimbabwe regulatory/legal qualification for tax, bonded, OEM, PRAZ and international profiles; avoid treating research examples as law.

**O6. Merchant services pricing:** list approved dealer paid services, full tariffs, billing period, country, taxes, entitlements and cancellation/refund terms; none invented.

**O7. Paynow first-party merchant for CarUp services:** confirm legal CarUp Zimbabwe beneficiary, merchant settlement arrangements, provider permission, currency, merchant integration, operational compliance and owner authorization; preserve PAY-05 garage Paynow arrangement separately.

**O8. Public review/complaint publication:** thresholds for verified buyers, privacy, fair dispute and measurement; no zero complaint claims without records.

**O9. Feature release gates:** choose which P2 items may launch after baseline 1.0, without removing their documented data relationships.

**O10. Assignment:** only after Owner has inspected this plan, Owner chooses the specialist/team, whether one long-run unit or tightly governed lanes, and approves a frozen D0 instruction.

No unresolved decision above is to be silently interpreted as implementation approval.

---

## 16. Final deliverable checklist and acceptance artifacts

A completed Dealership 1.0 programme delivers:

- [ ] Accepted architecture and field-ownership ADR; one canonical legal/dealer/tenant authority.
- [ ] Downloadable versioned dealer XLSX and accessible manual forms using one field registry.
- [ ] Existing-data CSV/XLSX import and full multi-sheet dealer intake.
- [ ] Automated accurate population of all permitted company/branch/service/policy fields, with no manual re-entry.
- [ ] Full file/checksum/row/error/provenance, idempotent retries and verified database read-back.
- [ ] Secure OCR for genuine business evidence with page-aware PDF strategy and human correction.
- [ ] Independent legal identity and conditional compliance decision workflows, expiry and versioned agreement.
- [ ] Approved dealer automatic organization/tenant/role activation and governed revocation.
- [ ] Tenant-safe branch, inventory, staff/roles, contacts, policies and operations dashboard.
- [ ] Canonical VIN inventory import and link to existing Seller/Marketplace tools.
- [ ] Public searchable dealer directory and responsive dealer pages with approved images, branches, actual stock, policies, safe contacts and precise trust labels.
- [ ] Authentic transaction-based reviews and **Not measured** for unmeasured complaints.
- [ ] PAY-02/PAY-03B commercial products integrated with properly authorized first-party Paynow capability where eligible; PAY-05 garage collections untouched and not misrepresented as live.
- [ ] Zimbabwe rules plus bounded international country-config model.
- [ ] Security, RLS/tenant, privacy, migration, integration, accessible visual and real physical UAT evidence.
- [ ] 12-dealer pilot, independent certification, Moderator disposition and Owner final release approval.

### Completion rule

**Do not call the system complete** merely because a workbook uploads, OCR reads a test file, a profile page renders, a dealer receives an approval badge or a simulated payment succeeds. The accepted outcome is one coherent, accurate, governed, end-to-end dealer lifecycle, with separately authorized commerce and public presentation.

---

## Appendix A. Source links and evidence locations

- Repository: https://github.com/kudzimusar/carup
- O2 dealer onboarding and original OCR: https://github.com/kudzimusar/carup/pull/208
- One CarUp RC2: https://github.com/kudzimusar/carup/pull/221
- OC5R source closure: https://github.com/kudzimusar/carup/pull/222
- PAY-03B subscriptions: https://github.com/kudzimusar/carup/pull/251
- PAY-05 Paynow: https://github.com/kudzimusar/carup/pull/254
- Current dealer onboarding source on RC2: backend/services/dealer/dealerOnboardingService.js
- Current workbook mapping on RC2: backend/services/dealer/workbookSemanticMappingService.js
- General OCR: backend/services/document-intelligence/documentIntelligenceService.js, documentSchemas.js
- Compliance source: backend/services/dealer/dealerComplianceService.js
- Dealer listing authority: backend/services/dealer/dealerListingAuthority.js
- Dealer private workspace: web/src/pages/dealer/DealerOnboarding.tsx; web/src/pages/dashboard/dealer/DealerDashboard.tsx
- Dealer public directory: web/src/pages/DealerDirectory.tsx
- O2 import reference receipt: docs/features/o2/CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_RECEIPT.md (PR #208)
- OC5C differences: docs/one-carup/OC5C_PEOPLE_IDENTITY_COMPLETION.md (PR #221)
- Subscription reference: docs/payments/CARUP_PAY_03B_DEALER_BUSINESS_SUBSCRIPTIONS.md (PR #251)
- Paynow qualification and Level-1 tests: docs/payments/CARUP_PAY_05_ZIMBABWE_COLLECTIONS_MOBILE_MONEY.md and CARUP_PAY_05_FINAL_CERTIFICATION.md (PR #254)
- Zimbabwe dealer research reference: Google Sheet “Zimbabwe Car Dealers & Automotive Companies Database”, 10 tabs, including Dealer Profile Intake, Verification Tracker, Evidence Register, Buyer Assurance, Buyer Feedback Log, Field Dictionary and Data Quality; 104 preliminary dealer/branch discoveries as of report preparation.

## Appendix B. Previously discussed gap assessment and closure mapping

| Previously identified gap | Programme closure |
|---|---|
| Dealer legal registration / seven field intake | D1, D3 and D4 complete full structured intake |
| Individual identity / evidence upload | D5 and D6 retain subject-safe independent identity evidence |
| Basic business branches | D1 and D7 structured branch/geolocation/operating profile |
| Independent compliance review | D2, D6, D10 decision/expiry/jurisdiction convergence |
| OCR tested on older branch but disabled later | D5 governed reconnection with real document corpus |
| Dealer vehicle sourcing, inventory and finance incomplete | D1, D7, D8, linked separate vehicle import |
| Buyer protection and complaints partial/fabricated zero | D2 and D8 actual records or Not measured |
| Approval-to-tenant/role activation missing | D2/D6 full tested governed transition |
| Foreign dealer country-specific requirements missing | D10 explicit conditional jurisdiction policy |
| Spreadsheet migration currently vehicle-trade, not dealer profile | D3/D4 distinct full multi-sheet dealer domain |
| Dealer commercial package drafted but blocked/unpriced | D9 commercial approval and correct PAY-03B entitlements |
| Owner requests tested Paynow reuse for service payments | D9 distinct first-party CarUp payment flow; preserve PAY-05 garage beneficiary and live block |
| Public dealer directory empty and rich profile absent | D8 buyer-safe API, directory, presentation and SEO |
| Fake branch selector and local permissions | D7 live branch/membership read and write authorities |
| Source researched 104 entities not verified | D4 internal identity crosswalk + D11 pilot |

**Owner review status at publication: PENDING. This plan has no authority to start implementation, merge, deploy or collect real payments.**
