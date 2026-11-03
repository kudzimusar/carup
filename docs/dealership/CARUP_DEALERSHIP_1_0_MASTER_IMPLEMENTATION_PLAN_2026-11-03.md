# CARUP DEALERSHIP 1.0 — MASTER IMPLEMENTATION, DATA-INTAKE, COMMERCE AND ACCEPTANCE PLAN

**Programme ID:** CARUP-DEALER-ONB-001  
**Version:** 1.1 — claim-first/prelisted dealership programme; proposed for Product Owner review; NOT IMPLEMENTATION AUTHORITY  
**Date:** 2026-11-03 (Asia/Tokyo)  
**Repository:** https://github.com/kudzimusar/carup  
**Document custody:** docs-only proposal branch docs/carup-dealer-1-0-master-plan-20261103; draft review only  
**Programme controller:** CarUp Programme Moderator, operating under 11-11 Tech governance and exact-head evidence controls  
**Product Owner approval:** PENDING  
**Implementation specialist / team:** NOT APPOINTED — selected only after Owner review
**Execution specification:** docs/dealership/CARUP_DEALERSHIP_1_0_LR01_UNIFIED_IMPLEMENTATION_AGENT_PROMPT.md (same docs-only branch)
**Controlling external source:** [Zimbabwe Car Dealers & Automotive Companies Database](https://docs.google.com/spreadsheets/d/10YntHvtk9PhrRjZQEMHWfnZgqT84hisTW_oOnt2ZhNQ/edit) — 10 original research tabs + DEV 1–10 guidance/claim registry  
**Production, shared staging, migrations, real provider charges and merges:** NOT AUTHORIZED by this document

> This is the comprehensive decision and implementation blueprint requested by the Owner. It unifies the previously discussed 25 dealership capabilities, the Zimbabwe dealer research workbook, O2 OCR and workbook foundations, existing compliance and corporate authorities, marketplace and dealer storefront functionality, and CarUp Payments (including PAY-03B and PAY-05 Paynow). It is an implementation specification, not a claim that every feature already works, and is not itself an instruction to begin source changes.

---

## 0. Executive direction and definition of done

### 0.1 Owner's intended product

CarUp must allow an existing or new dealership to:

1. **CarUp first builds a prelisted research-sourced directory** from the 104 existing dealer/branch discoveries (not 111 distinct dealers), after source/safety/duplicate review. Categorize every source row; link probable legal parents and branches without declaring them verified. Render eligible, truthfully labelled public research profiles **before owner claims**, with "Claim this dealership" and a clear unclaimed/not-business-verified state. Records failing publication review remain internal until resolved.
2. The real business representative finds its specific profile and submits a secure **business claim request**. Independently validate lawful authority before any private editing/tenant/role access; handle conflicts, multiple claims, branches and appeals.
3. **After a safe claim is approved**, offer the authorized representative a **dealership-specific prefilled XLSX** using supported, provenance-labelled source data, or their own Excel/CSV records; the workbook contains missing sections to complete. Applicants must confirm imported research values rather than the source becoming silently dealer-verified.
4. Complete the prefilled worksheet offline, once, and upload it. Structured Excel cells are parsed directly; **OCR is used to read unstructured supporting images/PDFs, not to re-read Excel cells**.
5. Receive an automatically populated, fully editable dealership application: legal identity, organization, branches, licences, authorizations, operations, sourcing, finance, warranty, buyer policies, media, contact channels and linked vehicle inventory.
6. See row- and field-level errors, conflicting evidence and import provenance; correct only genuine gaps without retyping accepted values.
7. Upload original regulatory evidence and authorize Document Intelligence to propose extracted facts, never verification decisions.
8. Confirm a versioned participation declaration and submit a governed application.
9. Receive independent CarUp compliance decisions, organization/tenant provisioning and role activation.
10. Use a real dealer workspace to administer branches, authorized staff, vehicle inventory, leads, policies, compliance renewals and permitted commercial services.
11. Upgrade the prelisted public profile to an accurate, attractive, accessible, SEO-capable public dealership page and searchable directory, powered by a buyer-safe publication projection only.
12. Optionally purchase approved CarUp services or dealer subscriptions using an authorized payment method; Paynow must be integrated **only through its actual eligible first-party merchant arrangement and approved provider state**, never by routing CarUp service money into a garage's separate Paynow merchant.
13. Keep business verification independent of vehicle/VIN-level identity, duty, inspection, title and listing eligibility.

### 0.2 Full acceptance outcome

A reviewed, categorized research source catalogue yields public **unclaimed, clearly unverified** informational profiles for eligible real-world dealer/branch discoveries, while unreliable or unsafe records are withheld. A rightful business representative can **claim their existing profile**, receive an applicant-specific prefilled workbook, import all supported values without re-entry, resolve exceptions, submit documentary evidence and signed declarations, be independently approved and automatically provisioned into a correctly scoped legal organization and dealer tenant, operate their branch/inventory tools, and upgrade the existing stable public URL to an approved buyer-safe company profile. Suspensions, expiry, corrections, publication withdrawal and payment entitlements remain accurate across every surface.

**Full completion** requires integrated PostgreSQL tests, exact-head CI, physical authenticated UAT, visual and accessibility evidence, a 12-dealership pilot, independent certification and explicit Owner go-live authorization. Passing unit tests alone or showing a beautiful mock page does not meet this definition.

### 0.3 Non-negotiable policies

- The **Owner first reviews this document and decides who executes**. No specialist assignment or implementation authorization is implied.
- Extend existing canonical CarUp O2, Dealer Compliance, Corporate/AUTH, tenant/member, Seller, Vehicle, Marketplace, Document Intelligence and PAY-02/PAY-03B/PAY-04/PAY-05 systems; do not introduce parallel truth stores or a second billing ledger.
- **One legal organization can have multiple branches, staff, financing partners, authorizations, services and listings**; none of these may be incorrectly compressed into one text column.
- A document being uploaded or OCR-read does not mean it has been verified. A company being verified does not verify every vehicle. A merchant paying CarUp does not confer a trust badge.
- No fabricated dealers, stock, locations, prices, inventory counts, sales, customer reviews, complaint counts, verification labels or payment successes. Missing complaint data is **Not measured**, never zero.
- No unauthorized merge, production change, shared-staging mutation, third-party charge, migration or payment-provider activation. Use explicit environment and provider custody gates.
- Research directory rows are **potential dealer/branch discoveries**, not verified legal entities or permission to create accounts, memberships or verification badges. A source-grounded public *unclaimed informational listing* is allowed only after a documented eligibility review, with an explicit **"Unclaimed · Not independently business-verified"** disclosure and no claims of current licensing/stock/sales/ownership.
- **Population must precede claims:** create and categorize a reviewed source-backed prelisting catalogue and the public claim entrypoints as the first working product capability; separate research publication eligibility from full compliance/active dealer publication.
- **104 vs 111:** 104 actual records have seed IDs ZW-DEAL-0001 through ZW-DEAL-0104 on **Car Dealers Database rows 8–111**. Row 111 is a sheet row, not proof of 111 dealers. These are discovery/branch records, not 104 unique legal entities. Never fabricate seven records or claim all 104 are safe to publish without case-by-case review.
- Brand text or categories such as "Authorized Franchise Dealer" are **source labels, not CarUp verification**; remove/qualify regulated or official-affiliation claims in unclaimed public display unless independently corroborated and approved. Known URLs, phones, addresses and emails are research data; verify public/business nature, timeliness, lawfulness and site-entity match before publication.
- **Unclaimed is not an endorsement:** no customer reviews, service guarantees, OEM badges, dealer inventory, warranty claims, complaint counts or staff account until verified through their respective authorities.
- **Claim authority:** do not let clicking Claim, email-domain inference, workbook upload, phone possession or payment directly confer staff role or data edit. Independent identity/organization evidence, anti-takeover review, audited decision and appeals required.
- **Branding:** official business logos are optional. Verify image origin, licence/permission and entity/branch alignment; else use a clearly generic CarUp initials placeholder. No unlicensed hotlink or borrowed OEM mark.
- **Canonical precedence:** this plan and its bound implementation prompt are the controlling product specification. The exact attached Google Sheet (17 original/DEV tabs before revision; now 10 original + DEV 1–10) supplies source observations and field evidence, NOT authority to invent policies. Future agent must consult both before EVERY phase and reconcile actual code; any uncovered requirement becomes a documented exception for Moderator/Owner review, not an independent design expansion.
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
| Zimbabwe dealer source workbook | Google Sheet “Zimbabwe Car Dealers & Automotive Companies Database”, **10 original research tabs plus 10 DEV tabs (DEV 1–10)**, revised 2026-11-03 | 104 researched dealer/branch entries on rows 8–111, 104 intake records **Not started**, 0 formal submissions, 0 independently verified business claims, 0 approved full dealer summaries. DEV 8 catalogues all 104 prelisting candidates; DEV 9 defines claim states; DEV 10 adds seed/claim tests. No business is verified by population. |

**GitHub references:** https://github.com/kudzimusar/carup/pull/208 ; /pull/221 ; /pull/222 ; /pull/251 ; /pull/254.  
**Note:** These code references are intentionally not asserted to be merged, deployed or run together. D0 must establish the exact implementation parent and current database truth before any source work. No local runtime was executed in the preparation of this plan.

---

## 2. Complete capability requirements (C01–C25)

Every capability has a user outcome, owning authority and acceptance gate; “implemented in a branch” is not a substitute for integrated acceptance.

| ID | Capability | Required behavior | Owner of truth / acceptance |
|---|---|---|---|
| C01 | Seeded discovery and secure dealer registration/claim | Existing unclaimed public business discovery, claim request, identity review, then legal-account application; no self-provisioned authority | Research catalogue + claim service + Registration + Dealer Compliance; verified claim takeover tests |
| C02 | Prefilled, claim-bound Excel onboarding | Versioned **dealer-specific prefilled** workbook seeded with reviewed research-source candidates after independent claim approval; one upload updates all permitted business/branch/child records without retyping | Dealer import domain + claim identity scope; source versus applicant-confirmed provenance and 100% read-back parity |
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
| C18 | Prelisted and approved dealership directory | Browse/search/filter publication-eligible **unclaimed research listings** and separately approved dealer profiles with honest claim/verification state; suppress withheld/duplicate/disputed cases | Research-public/approved-public projection policy; accurate eligible counts and pagination |
| C19 | Upgradeable stable dealer public page | Starter research-sourced page with reviewed name/category/location/source and claim action; after approval upgrade **same stable identity URL** to branded inventory/service/verified page | Versioned two-tier buyer-safe projection, claim-state correctness and privacy-safe rendering |
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
- CarUp research/data team: seed source discoveries, verify safe publication eligibility and categorize research records; never confer business verification or customer identity.
- Independent dealer compliance reviewer: verify scoped claims with evidence, record reasoned decisions after step-up, without acting as the applicant.
- Operations/finance operator: approve merchant/payment and certain policy actions with dual control, not compliance claims by virtue of billing access.
- Customer reviewer/complainant and moderator: only transaction-linked review/complaint evidence with consent and fair response process.
- Product Owner/Programme Moderator/independent certifier: contract approval, independent acceptance, release authorization.

### 3.2 Happy path for the dealer

CarUp sources 104 records -> review source quality and legal/branch grouping -> categorize/suppress ineligible -> prelist eligible unclaimed public profiles -> business discovers existing URL -> submits claim -> CarUp independently authenticates business control -> claim approved -> download **prefilled** dealer-specific workbook (or securely import own records) -> inspect field mappings -> fix only blocking errors -> preview read-back populated application -> upload documents -> OCR observations -> confirm correct facts -> consent/declarations -> submit -> compliance decision -> approve -> organization and membership activation -> authorized workspace -> publish approved buyer-safe profile -> manage vehicles and branches -> optionally purchase approved services -> renew/review.

### 3.3 Adverse paths

- Existing research listing belongs to another legal entity, franchise or branch.
- Another actor tries to claim the same legal registration.
- A claimant controls an email/domain or mobile number but not the legal business, or claims a branch without parent authority.
- Public research record has a wrong street/website, stale phone, private individual contact or unverifiable franchise/authorization label.
- Two claimed profiles are later determined to be branches of the same parent, or a dispute/closure requires prelisting suppression.
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
4A. **dealer_research_seed_records** (only if no existing source catalogue can own this) — immutable source-qualified external key, original name/category/brand/address/contact/website, retrieval/corroboration dates, original rows/hash, public field eligibility, candidate parent/branch ID, suppression and evidence. A research record is **not a legal organization**.
4B. **dealer_prelisting_public_versions** — revisioned allowlisted research-safe projection and publication decision/reviewer, status PRELISTED_UNCLAIMED / WITHHELD / SUPPRESSED / DUPLICATE / UNDER_DISPUTE; never compliance verified. Use the existing public profile version authority where safe instead of parallel public truth.
4C. **dealer_claim_requests and claim evidence/decision events** — claimed seed IDs, applicant auth identity, asserted relationship, legal/branch scope, private evidence references, audit and reviewer decision, uniqueness and dispute/appeal outcomes; no direct tenant/role write from submission.
4D. **dealer_seed_import_receipts** — source file SHA, sheet and row count, category/grouping disposition, reviewed/public/withheld/duplicate counts, first/last applied timestamps and idempotent rerun outcome.
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

**Two independent public publication gates exist:**
1. **Research prelisting gate:** CarUp research authority reviews source quality, source links, business-versus-branch identity, public/business-safe facts, regulated-affiliation language, stale contacts, suppression requests, and logo rights. It can publish **only a minimal, clearly unclaimed/not independently business-verified informational profile** with attribution/as-of date. It creates no dealer organization, tenant, staff permission, seller authority, inventory, verified badge or service payment entitlement.
2. **Claimed full-dealership gate:** Dealer Compliance governs identity, active_state, scoped review, organization/tenant membership, restrictions/suspension/expiry, buyer-safe approved version and VIN-specific listing authority. A prelisting remains unverified even when someone files a claim; claim approval alone does not equal compliance/operating activation. After fully approved dealer activation the same public identity can upgrade to the full validated profile.
Define one explicit domain-owned policy per gate and shared enforcement at admin, public projection, search/cache, seller API and marketplace boundaries. An ineligible prelisting must be suppressed immediately; a revoked full listing must be retracted or, only if policy review permits, downgraded to a legally safe unclaimed-style record without implying valid dealer authority.

Separate approved dealer profile visibility from VIN-specific vehicle listing visibility; a business cannot make its stock duty-paid merely by filling in “typical stock duty status.”

### 4.5 Private, approved and self-declared data

| Classification | Examples | Allowed use |
|---|---|---|
| Private regulated | tax IDs, government IDs, banking details, licences as raw scans, internal reviewer notes, security and IP data | Authorized applicant/reviewer only; masked in staff views as needed |
| Research-sourced unclaimed | original source company/branch name, generic category, corroborated public address/website, checked public business contact | Reviewed minimal public listing with attribution/as-of date and conspicuous **Unclaimed · Not independently business-verified** label; not a dealer endorsement |
| Applicant-declared | hours, brand specialization, typical sourcing, lot capacity, contacts, financing options | Private draft; may be published only if policy permits and clearly labelled dealer-declared |
| Independently reviewed | legal name, scoped licence, verified branch location, OEM authorization | May be specifically labelled CarUp reviewed with source/scope/date |
| Transaction-derived | actual on-platform stock, sales if authoritative, verified buyer reviews and complaints | Publish only with sufficient transaction proof, consent, moderation, sample/period |
| Not collected | unknown complaints, unstated warranty, unavailable metrics | Show Not measured / Not supplied, never zero or affirmative claims |

---

## 5. Dealer Excel/CSV workbook specification

### 5.1 Principle

**CarUp Dealer Intake Workbook v1.0 is the single dealer-facing canonical template**, generated from a backend field registry. Both website manual forms and XLSX imports reference that same registry; they must not drift.

The 10-tab Zimbabwe source/research workbook is **not** issued unchanged. The same Google Sheet now has **10 original tabs and DEV 1–10 developer-reference tabs**, including a 104-row seed catalogue and claim tests. It includes internal verification, evidence, quality and buyer feedback worksheets; a dealer must not edit reviewer decisions or publish research claims. Preserve it internally as a research, public-prelisting candidate, and migration crosswalk. Only a separately generated, claim-bound prefilled CUSTOMER workbook is shared with an approved claimant.

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

### 5.5 Seed-first migration of Zimbabwe research directory and initial prelisting

The research source records **104 discovery/branch rows (A8:K111)** with IDs ZW-DEAL-0001 to ZW-DEAL-0104, not 111 distinct dealers. The source workbook's row number 111 is not a dealer count. Original 10 tabs plus DEV 1–10 must be attached to the development run. **DEV 8 - Seed Catalogue** is the full 104-row import/reference manifest, **DEV 9 - Claim Workflow** defines claim control, and **DEV 10 - Seed Tests** supplies additional required cases. The 104 existing detailed intakes are still **Not started**, and no claims or full verification are recorded.

The **first functional product slice** is a prelisting importer/public directory, not blank-only registration:
1. Read all 104 source IDs (no synthesized extra seven). Idempotently create private source-locked research candidates, with original values, timestamped source URL and row-level file/hash receipts. Source-to-entity keys must not create accounts, dealer roles, subscriptions, inventory or compliance-approved legal entities.
2. Categorize by source-backed business model (franchise/official-label claimant **unverified** pending proof; independent; used/pre-owned; importer; commercial/heavy vehicle; assembler; workshop/service; marketplace/brokerage; customs/clearing; multi-category). Save **source-category** separately from CarUp verified capabilities. Do not flatten multivalued model/brand fields.
3. Reconcile potential **legal parent / dealership group / distinct branch** with explicit grouping confidence and human review. Display 104 *source records* and an independently calculated, evidence-backed count of *distinct organizations* only after dedupe; do not equate the two.
4. For each source row, perform minimal public eligibility review: public/business legal interest, URL legitimacy and current operation, address/region plausibility, ownership versus branch, no sensitive person/contact, applicable removal requests, source-attribution requirements, unsafe false licensing/franchise words, and duplication. Status: CANDIDATE_PENDING_REVIEW -> PRELISTED_UNCLAIMED or WITHHELD / DUPLICATE / SUPPRESSED / UNDER_DISPUTE. Publishing a candidate without a decision is forbidden.
5. Create **real, useful initial public directory and stable dealer/branch pages for eligible records** using only allowlisted research-safe facts. Clearly label them **Unclaimed · Not independently business-verified**, state data source/as-of or "information may be outdated," provide "Claim this dealership," and offer correction/report/removal. Do not show an approval shield, a dealer-operated sales listing or badges based on research category alone.
6. For each source-backed public field, capture provenance, field eligibility decision and last check. Use official business logos only when entity alignment and image rights are documented. Otherwise show an excellent generic branded initials placeholder. Do not hotlink a manufacturer logo as dealer brand.
7. Preserve source discoveries that are withheld (do not invent them publicly). Record per-row counts for imported, categorized, duplicate/grouped, eligible/published, withheld, source-correction-needed and logo approved/placeholder. Never claim **104 published** unless 104 actually pass.
8. Claimant must select a specific source-backed business/branch; server verifies the claimed scope and applicant authority without exposing internal evidence. Multiple branch claim may be processed as a governed parent organization group; conflict and preexisting account routes must not takeover another tenant.
9. **After independent CLAIM_APPROVED**, generate a **prefilled, versioned, actor-bound customer workbook** using reviewed research candidates and known linked branches. Keep provenance column notes/metadata and mark imported research as **NEEDS_DEALER_CONFIRMATION**. The dealer corrects names/locations, adds missing legal evidence/policies, signs/consents in server flow and uploads once. Do not give private reviewer/evidence data or research contact fields forbidden for publicity to another party.
10. Execute the standard import/Document Intelligence/compliance workflow; preserve original seed IDs, stable public URLs, claimant role and source attribution. Only full independent compliance/operating approval upgrades the same public profile to FULL_DEALER_APPROVED with correct tenant-scoped inventory and entitlements.
11. Run **12 representative dealer/branch scenarios** including unclaimed, rightful claimant, competing claimant, franchise branch and importer/clearing; write dry-run receipts and UAT cases. Source correction, takedown, appeal and identity resolution must be tested before public deployment.
12. Produce stage funnel metrics: source discoveries (104 baseline), reviewed, dedupe/grouped, eligible public prelistings, withheld, claim attempts, claims approved/rejected/disputed, workbooks exported/uploaded, compliance submitted/approved, live approved profiles; the count of research discoveries is **not** an account or verified dealer count.

### 5.6 Claim-bound prefilled workbook and no-reentry contract

- The official dealer-facing XLSX has one canonical field-registry schema shared with manual UI. A **claimant-specific export** adds prepopulation from permitted seed data, stable `seed_dealer_id` and `branch_ref`, export revision, application ID, schema version, server-side integrity receipt and `source_status`/confirmation flags; these keys are **references, not authority**.
- An approved claimant receives its own scoped downloadable file; a random visitor or unapproved claimant cannot download a private company dossier, legal scan or another application's prefilled workbook. A preview of publicly reviewed facts may be offered before claim.
- On reupload, company and branch data already present must populate the correct canonical editable form with source and modification provenance. Dealer confirmation is explicit; auto-filled source text does not become "dealer declared" until confirmed, nor "CarUp verified" until reviewed.
- Any claim version change, duplicate claim or stale source/verified-field collision raises a human-visible conflict. Cannot silently overwrite approved data or transfer branch ownership.
- The exported file must never include internal Verification Tracker decisions, Evidence Register private links, moderation, complaint records, payment ledger, secret metadata or any buyer identity.
- Existing dealer-registration path without a matching prelisting remains supported: safe **new business** application, duplicate discovery check and later attachment to approved source entity, with the same privacy and compliance gates.
- The agent must prove export -> edit offline -> upload -> persisted field read-back -> review -> full public profile upgrade for at least one realistic grouped multi-branch fixture.

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

Claim-approved status is NOT business-operating approval. Seeded discovery -> claim independent authority -> private application completion -> legal and compliance approval -> tenant membership/activation are distinct transitions. No claimant can edit the seed source itself or control an existing tenant until the applicable governed transition passes. Rejected/disputed claimants receive no credentials for the business.



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

**Proposed URL:** /dealers. **Population first:** publish eligible, reviewed informational profiles from the 104-record seed catalogue before any dealer claims. Show distinct, searchable results for `PRELISTED_UNCLAIMED` and `FULL_DEALER_APPROVED` with clear **source research versus independent business verification** distinction. Visitors can search by verified/published city/province, source-category (not verified franchise certification), and approved claims; stock/services filters apply only where actual approved data exists. Pages need claim CTA and report-correction action. Exclude WITHHELD, DUPLICATE, SUPPRESSED, under legal dispute or unsafe records. Keep counts and search consistent; no source-only "Authorized dealer" badge, fake inventory or sponsorship ranking.

### 9.3 Public dealer profile

**Proposed URL:** /dealers/{slug}; stable seed-backed canonical identity and immutable ID redirect policy. The same URL must work when an unclaimed source-backed profile becomes claimed and fully approved.
- **UNCLAIMED starter view:** only publication-reviewed source name, broadly categorized business type, area/branch, checked public business address/website/contact where allowed, source/as-of date, "Unclaimed · Not independently business-verified" disclosure, **Claim this dealership** action, correction/report/removal control and reviewed official logo or generic initials placeholder. No buyer reviews, stock, payment service, licence/OEM trust badge or unwarranted operations assertions.
- **CLAIM PENDING:** maintain informational view unless suppression is required; never disclose claimant name, documents or reviewer correspondence, and never falsely label the business as owned or verified.
- **FULL_APPROVED view:** authorized logo, legal/trading public name, branch region, safe contact/website, narrowly scoped independently reviewed claims and review date; same stable identity and existing links.
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

Create a versioned server-produced buyer-safe read model separate from private dealer tables, with **two disjoint projection schemas**: `unclaimed_research_profile_v1` (sourced/publication-reviewed only) and `approved_dealer_profile_v1` (claim, legal, operating and compliance-approved). They have distinct badge/metadata rules but share a stable public slug or alias after merge/upgrade. Explicit allowlist, field-level provenance/verification labels, approved media and links, no tax numbers, registration scans, bank details, internal notes, private people or storage paths. Revision invalidation on source-correction, duplicate, takedown, claimant dispute, compliance decision, expiry and removal. Server-side privacy and role tests; no broad SELECT * exposure. Do not misrepresent public CarUp research pages as seller-operated storefronts.

### 9.5 Presentation QA

The first public directory acceptance is **eligible prelisted profiles shown before any account/claim**; the second is a rightful-claim-to-full-profile upgrade under the same stable URL. Test missing/misidentified logo, third-party marketplace source versus official source, parent/branch duplication, location correction, takedown/dispute, stale cache, source-label leakage into approved badges and inability of a visitor to download private prefilled workbooks.



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
| **D0 — Authority, worksheet & source review** | Compare main vs O2/OC/PAY lineages, inspect actual schema; attach and freeze the live 104-row Google Sheet and DEV 1–10; review source/business eligibility | SHA-pinned source/workbook manifest, 104-row completeness receipt, duplicate/parent/branch analysis, security/authority inventory | 104 valid stable IDs and no unapproved 111 count or self-verified sources |
| **D1 — Source registry, claim & workbook contract** | Define prelisting, categories, grouping, claim requests/decisions, legal/branch/tenant identities; map 40-column intake and all research/DEV fields | Versioned two-tier public projection, seed and claim schema, full field registry and country/permissions contract | All 104 source records classifiable, safe decisions, no applicant access to reviewer/governance data |
| **D2 — P0 truth, source-publication & claim safety** | Complaint-0 fix, reconcile active full-public gate vs unclaimed research-public gate; authenticate claims, disputes, correction/takedown and separate claimant role from business authority | Reviewer-safe claim decisions, prelisting eligibility service and no-bypass publication policy | Cannot self-claim another organization or publish unsafe/verified claims from research |
| **D3 — Claim-bound prefilled workbook & forms** | Generate from shared registry a dealer-specific prefilled XLSX from claim-approved seed plus unfilled sections; support blank/no-seed path | Versioned XLSX with source flags, legal/branch keys, safe download, manual editor, sample/test files | Pre-export provenance and postupload persisted parity with no re-entry |
| **D4 — Seed all 104, prelist then import** | Idempotently seed and categorize all 104 discovery/branch records, group/dedupe; publish only source-reviewed safe unclaimed pages; secure claim service + multi-sheet prefilled import | Real 104-row catalogue, source-to-branch map, publication/suppression receipts, prelisted directory, claim endpoints and no-reentry import | All 104 accounted for; eligible live in isolated test; claim->prefill->upload parity; no fake verified entities |
| **D5 — OCR reconvergence** | Governance-safe Document Intelligence for business docs incl. PDF page strategy; candidate reconciliation and user confirmation | Document-class schemas, tests and UX; privacy/provider qualification evidence | Real-document corpus passes accuracy/security, no extraction-driven approval |
| **D6 — Claim approval and corporate activation** | Independently approve lawful claimant of a specific prelisted company/branch, then separate full company compliance; idempotently activate organization/dealer tenant/member only after full approval | Audited claim/appeal state and canonical activation contract with stable public identity | Claim alone gives no tenant/role; compliant approved owner reaches correct workspace |
| **D7 — Private dealer workspace** | Profiles, branches, inventory references, staff/permissions, policies, contacts, media, compliance, notifications, pricing/lead views | Production-shaped dealer UI/API; no fixed fake branches or local-only permissions | Actual data read-back and tenant isolation across all operations |
| **D8 — Unclaimed-to-approved public directory** | Populate source-reviewed unclaimed profiles with claim CTA, source labels/placeholders; after full approval upgrade same stable URL with safe inventory/services/media | Two-tier safe public API/search, SEO, correction/takedown, compliant full dealer profiles | Eligible research pages exist without claimed accounts, correct labels, secure full upgrade |
| **D9 — Commercial Paynow/entitlement integration** | Define first-party CarUp service billing vs dealer/garage payees; approved PAY-02 products, PAY-03B owner subscriptions; Paynow activation requirements | Commercial owner-decision register, first-party Paynow integration spec, separately tested payments/entitlement workflow if later authorized | Unpriced/live-unauthorized checkout refuses; correct legal beneficiary; exact provider reconciliation |
| **D10 — Country configuration** | Zimbabwe conditional catalogue, legal review, expansion policy plug-in; currency, locale and documents | Jurisdiction/version registry, Zimbabwe-qualified rules, country pilot plan | No incorrect jurisdiction-required fields; proper expiry and consent |
| **D11 — Seed/claim/full-lifecycle certification** | Reconcile all 104 seed receipts, group/eligibility, initial unclaimed pages, rightful/hostile/disputed claims, branded/placeholder logos, prefilled export/import, full approval, PAY and 12-case pilot | Source/claims and end-to-end gate matrix, red-team tests, exact-head CI, responsive screenshots, independent dossier | Correct 104/111 interpretation, public prelisting validity, denied takeover and complete upgrade are demonstrably proven |

### 11.1 P0 to P2 priorities

**P0 / before public rollout:** verify/source-categorize all 104 records; source-by-source public eligibility/suppression; separate unclaimed and full publication gates; secure ownership claim/takedown/appeal; fixed zero-complaint summary; consistent active/compliance/listing policy; secure legal organization/tenant activation; prefilled no-reentry workbook; private/public separation, reviewer and evidence custody; no fake verified records.

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

1. **Field contract and pinned reference:** 10 original research tabs + DEV 1–10 must match the attached Google workbook, all 104 seed IDs must be inventoried, all tab/column definitions map to a canonical target or explicit non-importability; schema version pinned and no manual UI drift.
2. **Seed catalogue / claim:** idempotent full 104-row fixture import; categories and legal parent/branch grouping without false legal entity creation; public source eligibility and selective suppression; prelist page when unclaimed; safe owner/branch claims, conflicts/appeals and no role escalation; claim-bound prefilled export and distinct private/public records.
4. **Parser:** XLSX many-sheet, CSV, quoted/newlines, empty, merged cell, formulas, duplicate headings/keys, whitespace, 1000+ rows, malicious ZIP expansion, CSV injection, wrong MIME, old version, non-document file.
4. **Import/migration:** idempotent replay, partial storage failure, atomic child linking, ambiguous research crosswalk, cross-tenant collision, source edits, material verified-field conflict, re-import + stale SHA confirmation.
5. **OCR:** live-evaluation fixture corpus, accuracy and hallucination guard, independent review gating, provider outage, PDF page handling, privacy and document class mismatch.
6. **Identity:** forged company owner, forged member/tenant/role, rejected signatory, applicant-to-active transition, suspension immediate revoke, reviewer step-up.
7. **Compliance:** legal/branch authorization scope, issuer/date/expiry, applicable/not-applicable, true complaints measurement, independent decision vs imported claims, event/cache invalidation.
8. **Payments:** no first-party charge without approval; PAY-03B version/price/tax/merchant; PAY-05 inherited garage isolation; payment statuses and cross-merchant mismatch; provider return is not payment; manual “paid” never accepted.
9. **Public privacy:** safe exact projection, no private IDs/docs/tax/banking, no unauthorized merchant secrets, no internal notes in search/snippet/logs.
10. **Marketplace:** public dealer->actual published VIN listings, correct branch membership, duty/title/inspection per VIN, withdrawn dealer and stock retraction.
11. **Accessibility/visual:** 390/768/1280/1920; keyboard, screen reader, no overflow or broken imagery/links, representative long African legal names and multiple branches.
12. **Operational:** precise row errors, importer telemetry, audit and event reconciliation, change history, backups/rollback, non-leaking logs and retention rules.
13. **Physical UAT:** authenticated actual app on isolated approved database; source SHA/deployment SHA/schema fingerprint and test output all correlated.

### 12.2 Quantified exit targets (proposed standards)

- **104/104 unique research seed IDs reconciled** (not 111), with row-level category, matching/branch grouping, source provenance, eligibility, publication/suppression and logo outcome; publish only genuinely eligible entries.
- **100% of workbook field definitions accounted for** in schema, import and UI parity matrix; unimportable fields explicitly listed.
- **100% of allowed prefilled cells** on a rightful claimant's export round-trip into the correct editable business/branch records; no source-to-verified state promotion.
- **0 successful hostile claims or unauthorized private workbook exports**, with tested disputes/appeals/takedowns and stable URL public upgrade.
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

**O3. Public information policy:** Owner has directed **prelisted public research profiles before claims**; the agent must implement publication only for source-reviewed safe business facts labelled unclaimed/not business-verified. Any material unresolved legal/licensing/contact ambiguity is withheld or escalated. Owner may separately approve the detailed allowlist and takedown policy, not bypass the safety gate.

**O4. Dealer identity claims:** Owner requires a **Claim this dealership** process with independent documentary/authority proof before edit or membership; define exact evidence criteria, contested legal parent/branch ownership, appeal and removal policy under compliance reviewer approval. No mere email-domain match can auto-approve.

**O5. Business licences:** authorize independent current Zimbabwe regulatory/legal qualification for tax, bonded, OEM, PRAZ and international profiles; avoid treating research examples as law.

**O6. Merchant services pricing:** list approved dealer paid services, full tariffs, billing period, country, taxes, entitlements and cancellation/refund terms; none invented.

**O7. Paynow first-party merchant for CarUp services:** confirm legal CarUp Zimbabwe beneficiary, merchant settlement arrangements, provider permission, currency, merchant integration, operational compliance and owner authorization; preserve PAY-05 garage Paynow arrangement separately.

**O8. Public review/complaint publication:** thresholds for verified buyers, privacy, fair dispute and measurement; no zero complaint claims without records.

**O9. Feature release gates:** choose which P2 items may launch after baseline 1.0, without removing their documented data relationships.

**O10. Assignment:** Owner requires **one isolated long-run implementation** with sequential D0–D11 checkpoints under one run; implementation starts only after Owner explicitly sends the canonical agent prompt. No intermediate partial handoffs or merges.

**O11. Logos:** official source/entity-matched business logos only after image-rights and permitted-use review; otherwise standard initials placeholder. Do not invent logos or display unverified official franchise branding.

**O12. Initial public seed policy:** maintain documented per-source eligibility, source/as-of attribution, correction/takedown path and suppression; if uncertain about a material claim, the agent may withhold the record and document the issue rather than silently invent permission.

No unresolved decision above is to be silently interpreted as implementation approval.

---

## 16. Final deliverable checklist and acceptance artifacts

A completed Dealership 1.0 programme delivers:

- [ ] **All 104 research entries** imported as source-preserving candidates with category, provenance and grouping dispositions (not a fictional 111 businesses), and reviewed public eligibility decisions.
- [ ] **Eligible unclaimed public profiles** live within isolated test build with truthful unverified label, correction/takedown route, optional authorized logo or initials placeholder and secure **Claim this dealership** CTA.
- [ ] **Rightful claim and claimant-specific prefilled Excel** demonstrated; hostile/duplicate claims, disputes, branch ownership and account takeover fail closed.
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
- [ ] Public searchable dealer directory supporting **source-reviewed prelisted/unclaimed** and **fully approved** profiles at stable URLs; only approved full profiles include real stock, services, scoped verification and commercial entitlements.
- [ ] Authentic transaction-based reviews and **Not measured** for unmeasured complaints.
- [ ] PAY-02/PAY-03B commercial products integrated with properly authorized first-party Paynow capability where eligible; PAY-05 garage collections untouched and not misrepresented as live.
- [ ] Zimbabwe rules plus bounded international country-config model.
- [ ] Security, RLS/tenant, privacy, migration, integration, accessible visual and real physical UAT evidence.
- [ ] 12-dealer pilot, independent certification, Moderator disposition and Owner final release approval.

### Completion rule

**Do not call the system complete** merely because 104 records were imported, 104 pages were generated (without eligibility review), a workbook uploads, OCR reads a test file, a profile page renders, a dealer receives an approval badge or a simulated payment succeeds. The accepted outcome is one coherent, accurate, governed, end-to-end dealer lifecycle, with separately authorized commerce and public presentation.

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

### Appendix C. Version 1.1 source-to-implementation authority and change control

**Always-reference rule:** At the start of the long run and at each D0–D11 phase, the agent must read and cite (a) **this complete canonical master plan**, (b) **the attached Google Sheet export** of “Zimbabwe Car Dealers & Automotive Companies Database” including all original 10 tabs and DEV 1–10, and (c) **the bound implementation prompt** at `docs/dealership/CARUP_DEALERSHIP_1_0_LR01_UNIFIED_IMPLEMENTATION_AGENT_PROMPT.md`. Maintain a phase-by-phase traceability ledger citing plan section, worksheet tab/range/seed IDs, canonical code path, tests, evidence and source SHA. A plan/worksheet inconsistency is a **BLOCKED_REQUIREMENT or OWNER_DECISION** entry; do not silently invent new product behavior. The sheet controls what the 104 **research** records actually say. The plan controls permitted behavior, privacy, governance, workflows and acceptance. Source code controls preexisting storage/runtime authority once D0 reconciled.

**Developer workbook contract:** [Google Sheets source](https://docs.google.com/spreadsheets/d/10YntHvtk9PhrRjZQEMHWfnZgqT84hisTW_oOnt2ZhNQ/edit). Original 10 tabs remain research/private governance. DEV 1–10 support development: read-me, field map, generated customer-template spec, 25 capabilities, gap closure, money flows, baseline tests, **104-row seed catalogue**, **claim workflow**, **seed/claim acceptance tests**. Download all tabs as .xlsx and attach. Confirm file SHA/size and IDs; no extra 7 invented entries.

**Long-run acceptance:** Source-preserving 104-record catalogue; every source row categorized and given eligibility disposition; only eligible public unclaimed listings; secure claim request/reviewer approval with failed hostile cases; prefilled versioned workbook export and import parity; full independent compliance/tenant activation; same stable public page upgrades truthfully; original 25 capabilities; financial safety; exact-head tests. All work remains on isolated feature branch, draft/unmerged for Moderator and Owner review.

**Owner review status: PENDING. No implementation, merge, deployment, migration of shared data or real payment is authorized by this documentation edit alone.**
