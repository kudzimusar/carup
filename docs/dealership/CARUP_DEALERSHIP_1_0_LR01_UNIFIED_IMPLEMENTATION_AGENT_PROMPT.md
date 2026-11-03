# 11-11 TECH — CARUP PROGRAMME MODERATOR → UNIFIED DEALERSHIP IMPLEMENTATION SPECIALIST

## CARUP-DEALER-ONB-001-LR01 — CLAIM-FIRST DEALERSHIP 1.0, ONE ISOLATED LONG RUN

**Assignment:** Implement and independently evidence the COMPLETE dealership system under one continuous long run; phase checkpoints but no separate specialist restart.  
**Product Owner:** Controls assignment, legal/commercial policy, final merge and release decisions.  
**Repository:** https://github.com/kudzimusar/carup  
**Proposed isolated implementation branch:** \`feat/carup-dealer-1-0-unified-longrun\`  
**Frozen main starting SHA, verified 2026-11-03:** \`bb9d9900c700873ca57df0ac18a1a5c01f77711a\` (verify unchanged ancestry; if main moved, use this exact parent unless Owner supplies a newer parent).  
**Controlling documentation branch:** \`docs/carup-dealer-1-0-master-plan-20261103\`; [draft PR #257](https://github.com/kudzimusar/carup/pull/257) — documentation ONLY, never merge without Owner authorization.  
**Canonical plan file:** \`docs/dealership/CARUP_DEALERSHIP_1_0_MASTER_IMPLEMENTATION_PLAN_2026-11-03.md\`, **version 1.1 claim-first**, authored on the docs-only branch.  
**Controlling workbook:** **Zimbabwe Car Dealers & Automotive Companies Database** — https://docs.google.com/spreadsheets/d/10YntHvtk9PhrRjZQEMHWfnZgqT84hisTW_oOnt2ZhNQ/edit — **download full .xlsx and attach**, all **20 tabs: 10 original + DEV 1–10**.  
**Commit containing current master-plan v1.1:** \`dd3520da61173ec2edc66a7eb56898e3c5d557d8\`; validate against current docs branch before starting.  
**Implementation specialist:** Owner will designate after reviewing this prompt; prompt is NOT yet a message instructing anyone to execute.  
**Current implementation authorization:** NONE until Product Owner actually supplies this prompt as an assignment.  
**Production/shared staging/live Paynow/merges:** PROHIBITED unless separately, explicitly authorized.

### MODERATOR MANDATE — READ THE SOURCE MATERIAL, DO NOT INVENT FEATURES

The Owner has already supplied the requirements. **Do not substitute your own product ideas, datasets, architecture, branding, payment prices or claims.** Work solely from:
1. The **complete version 1.1 master plan**, including §5.5 prelisting, §5.6 prefilled claim workbook, two public projection gates, D0–D11, privacy and money boundaries;
2. The **actual Google Sheet .xlsx** attached to the development task, with the exact original research tabs and the DEV 1–10 developer tabs;
3. Verified existing code/DB contracts and programme-specific accepted authorities after D0 reconciliation;
4. This unified execution prompt, which determines work order, isolation, evidence and handoff.

**Every phase D0–D11 MUST begin with an explicit plan-and-workbook reference check.** Keep \`docs/dealership/evidence/LR01/PHASE_REQUIREMENT_TRACE.md\` (or an equivalent version-controlled manifest) with columns:
\`phase | plan section/requirement | worksheet tab+range/Seed Dealer ID | existing canonical code owner | implementation file/commit | tests | evidence | decision/blocker\`.
Do not claim a phase complete if the ledger has unaccounted requirements. If actual code contradicts a worksheet suggestion, investigate ownership and document the discrepancy. If plan vs worksheet disagree, **the worksheet controls observed source facts, the master plan controls intended behavior and safety policy**. A material unresolved contradiction is a recorded BLOCKED_REQUIREMENT/OWNER_DECISION, not permission to improvise. If no safe implementation is possible for one task, preserve the fail-closed gate, continue the other authorized phases, and disclose the exact blocker.

**No invented dealer data:** the actual source holds **104 source dealer/branch discoveries**, IDs \`ZW-DEAL-0001\` through \`ZW-DEAL-0104\`, \`Car Dealers Database!A8:K111\`. **Row 111 is the last data row, NOT a count of 111 dealers.** The original 10 research tabs and 104 intake rows are unverified/unsubmitted. Source label "Authorized Franchise Dealer" is not CarUp certification. A source row is not necessarily a distinct legal organization. No verified dealer, live seller, trust badge, customer review, complaint zero, dealership inventory, settlement, operational tenant or individual official logo may be invented. Brand/URL/contact/media may be surfaced only after field-level research-public eligibility and rights review.

### EXPECTED FINISHED JOURNEY — MANDATORY ORDER

\`CarUp imports and categorizes all 104 source records\`
→ \`research reviewer determines source and field publication eligibility\`
→ \`eligible records appear as explicitly UNCLAIMED, NOT BUSINESS-VERIFIED in public dealer directory and stable profile URLs\`
→ \`business representative finds existing profile and clicks CLAIM THIS DEALERSHIP\`
→ \`authenticated claim application and company/branch authority proof\`
→ \`independent claim decision; no roles or tenant at claim-request time\`
→ \`claim-approved user downloads a DEALER-SPECIFIC PREFILLED Excel workbook derived from allowed research data\`
→ \`dealer edits missing/corrected items, uploads workbook once; canonical app fields auto-populate\`
→ \`uploads business documents, OCR generates candidate observations, applicant corrects\`
→ \`independent regulatory/identity/compliance review\`
→ \`idempotent organization + dealership tenant + authorized roles activated only after full approval\`
→ \`same public profile URL upgrades from UNCLAIMED research view to fully approved buyer-safe dealer page\`
→ \`real vehicle inventory, branches, services, staff, policies, inquiries and eligible commercial services\`.

Allow a new real dealer with no seed match to register safely through the same compliance process after duplicate checks. Never force an outsider to claim an unrelated business.

---

# 1. EXECUTION AND CUSTODY

Use **one feature branch** created from the exact frozen main SHA above, not PR #257's documentation branch and not any O2/OC/PAY candidate branch. Bring the version 1.1 master plan and this prompt into the implementation branch **without silently importing product code from the docs branch**. Preserve their contents and evidence of source hash. Do not edit main, PR #257, any other product branch or the original Google Sheet.

On D0 compare source authorities (do NOT blindly merge):
- O2 People/Compliance/Dealer OCR and workbook work: draft PR #208, historical head \`e65c0bb835c65abce43ea1a0407406e4bf6456bb\`;
- One CarUp RC2: draft PR #221, historical head \`531e822b40d60bda89fdb2435d2d1e93871469f0\`;
- OC5R closure: draft PR #222, historical head \`082c73d85c1ae9e9d3b64674cdcb9d8dccbcd568\`;
- Dealer business subscriptions PAY-03B: draft PR #251, \`c2d548edbe4cc7ac9528f3c4a2c7f55a1d8bad88\`;
- Garage collections PAY-04: verify actual issue/PR and accepted ancestry;
- Paynow Zimbabwe collections PAY-05: draft PR #254, \`1d3b690198c5f0842fc580f36280714fedaba32a\`.

These are **distinct unmerged source lineages**, not one currently shipped product. Verify each exact head live; quote observed state and source. Selectively port only documented needed contracts and security fixes, recording per-file provenance and independent regression. Canonical authorities remain registration, Corporate/AUTH, tenant_users/organizations, Dealer Compliance, Dealer/branch, Vehicle/Seller/Marketplace, Document Intelligence, PAY-02/PAY-03B/PAY-04/PAY-05 as applicable. No parallel identity store or money ledger.

**Local isolation:** disposable local database and temporary file storage, safe non-shared test secrets, mocks or strictly local simulators for all money flows. Inspect CI workflow credential/staging side effects before branch push. Never deploy, migrate shared/production, connect a real Paynow account, run live payments, or merge without a separate Owner instruction.

**Single-run delivery:** complete D0–D11 sequentially under ONE assignment, committing at logical checkpoints. Do not stop after a new plan, database schema, demo-only UI, one importer or partial OCR. Continue to the end, recording genuine external blocks rather than pretending money/legal/provider authorization exists.

---

# 2. REFERENCE WORKBOOK CONTRACT — USE THE ACTUAL DATA

The implementation agent MUST inspect, record and cite **every original tab and each DEV tab**.

## Original 10 research/verification tabs

1. \`Car Dealers Database\`: exact data rows \`A8:K111\`, source category/name/brands/address/area/city/contact/parent/URL and \`ZW-DEAL-0001..0104\`. Row 7 is header. The original extensions L:U/V must not be silently discarded. **104 source rows; 0 verified businesses.**
2. \`Database Schema & Expansion\`: previous source fields and intended extension metadata.
3. \`START HERE\`: source intent, caveats, how declarations differ from independent verification.
4. \`Dealer Profile Intake\`: 40 columns A:AN of applicant/company/branch/authorization/operation info, 104 unstarted research-linked profiles.
5. \`Verification Tracker\`: independent reviewer-only 10 claim areas; never import as applicant-issued badges.
6. \`Evidence Register\`: private restricted reference/evidence, never public or uncontrolled prefill.
7. \`Buyer Assurance\`: contract/payment/warranty/dispute policies and **Not measured** complaint/review state.
8. \`Buyer Feedback Log\`: source-only customer feedback register, no fictional reviews or claims.
9. \`Field Dictionary\`: 128 documented original definitions; applicant fields versus governance fields.
10. \`Data Quality\`: source counts and absence of verified claims/public approvals; no zero complaints inference.

## DEV 1–10 binding development references

- \`DEV 1 - Read Me\`: mandatory phase-by-phase usage and no-invention rules.
- \`DEV 2 - Field Map\`: 140 existing source columns, proposed target domains, privacy and import dispositions; proposed keys **are not automatically DB-canonical**.
- \`DEV 3 - Intake Tabs\`: approved **target spec** for the generated customer-facing multitab XLSX; include claim-bound **prepopulation** and source confirmation, not research governance sheets.
- \`DEV 4 - Capabilities\`: C01–C25 coverage, with claim-first changes embedded into C01, C02, C11, C18, C19.
- \`DEV 5 - Gap Closure\`: baseline defects plus seed/claim/prefill/public legality P0 gaps.
- \`DEV 6 - Money Flows\`: distinguish dealer paying CarUp vs buyer paying dealer vs garage money and Stripe.
- \`DEV 7 - Test Matrix\`: original T01–T35 **plus T36–T42** explicit claim-first tests; **NOT RUN** at worksheet completion.
- \`DEV 8 - Seed Catalogue\`: **104 exact original source rows** copied as research-only candidates with source category, proposed category, grouping status, public eligibility PENDING, claim status UNCLAIMED, logo rights status and NOT_PUBLISHED; importer map; preserve exact identifiers/URLs/address/contact only as research values.
- \`DEV 9 - Claim Workflow\`: detailed source->prelisting->claim->review->prefill->compliance->activation->full profile transition and adverse-state rules, with reviewer roles.
- \`DEV 10 - Seed Tests\`: S01–S25 exact seeding, prelisting, hostile claim, prefill, logo, takedown, public upgrade and certification cases. **NOT RUN** at worksheet completion.

**NEVER** provide all 20 reference tabs to a dealer applicant. Agent must generate the public/customer-specific versioned template from the canonical field registry and export only that applicant's allowed research and account data.

The agent must attach/register the exact source XLSX fingerprint, source document title/ID, sheet names/header rows, 104 IDs and derived 104/104 receipt. The live Drive document may change; if attached copy diverges, stop blind import, record hash/diff and seek Owner source resolution.

---

# 3. ACCEPTANCE CONTRACT FOR THE CLAIM-FIRST CATALOGUE

## 3.1 Source registry and categorization

- Idempotently ingest **all 104** source rows, source version/hash and source-qualified Seed Dealer ID. Do not create 111, 104 organizations or 104 accounts automatically.
- Preserve the original 38 source type labels and propose typed search categories: independent, import, clearing/bonded claim, franchise/OEM claim (unverified), assembler, luxury, commercial, marketplace/brokerage, other. Multiple categories allowed; any source label “Authorized” or “Bonded” must remain **research-claimed, not CarUp verified**.
- Group likely parent legal entities and physical branches through evidence-backed review. Keep all original seed-to-group mappings including duplicate, suppressed, conflicting or branch-only rows; no fuzzy automatic legal entity merge.
- Maintain immutable original source and per-field provenance, retrieval/as-of timestamp, source URL, review and correction history.

## 3.2 Publish useful research pages before claims, safely

- Field-level source-publication eligibility MUST be reviewed, source-link/site identity/recency checked, public business contact safe, regulated affiliations muted until independently corroborated, right-to-correct/takedown supported.
- Per-entry states: CANDIDATE_PENDING_REVIEW -> CATEGORIZED_UNVERIFIED -> PRELISTED_UNCLAIMED / WITHHELD / DUPLICATE / SUPPRESSED / UNDER_DISPUTE.
- Directory and URL show eligible **unclaimed** real source-backed dealers **before any dealer account exists**. Label “**Unclaimed · Not independently business-verified**” and cite source/as-of information; show categorized label as research, branch location/contact/website only when checked, and **Claim this dealership** action.
- Public prelisted display is **not full dealer compliance publication**. Do not permit a prelisted row to publish VIN inventory, carry verified licences/OEM badge, show customer reviews, have staff tenant access, show finance/warranty or use payments.
- Logo policy: use an actual rights-cleared, properly matched business logo if licensed and evidence saved, else a polished neutral initials placeholder. Do not hotlink, scrape or misrepresent a car manufacturer/franchise mark.
- Some source rows may fail publication eligibility. Record reason and keep them private. **Do not mark 104 published if only a subset passes**. Requirement is **104/104 source records accounted for and all eligible publicly discoverable**, with truthful counts.
- Support edits/corrections/takedowns, missing businesses, relocated branches, disputed ownership, bad official status, stale contact and cache/SEO retraction without private data leaks.

## 3.3 A claim does not confer dealer authority

- Claim CTA requires real logged-in user; request binds exact seed/branch and claimed legal entity relationship.
- Applicant submits genuine legal authority evidence, including responsible representative and entity/branch scope; independent reviewer decision and step-up. Rate-limit, prevent enumeration, redact responses and keep private documents protected.
- Different people claiming same business triggers dispute, not first-come ownership. Prevent domain/phone/website-only takeover and any claim for an unauthorized subsidiary branch.
- Defined outcomes: CLAIM_DRAFT, CLAIM_SUBMITTED, CLAIM_UNDER_REVIEW, CLAIM_DISPUTED, CLAIM_REJECTED, CLAIM_APPROVED, APPEAL etc.
- Even CLAIM_APPROVED grants only the **scoped private application/prefilled workbook**, not legal/compliance verification, operating tenant, inventory seller role, public verified badge or paid entitlement. Full independent compliance comes later.

## 3.4 Claim-bound prefilled Excel and public upgrade

- For a rightful approved claimant, generated customer workbook is **prefilled** with permitted existing source fields for the exact approved company/branches (seed IDs, stable branch refs, business name/category/address/website/contacts where suitable), with \`NEEDS_DEALER_CONFIRMATION\` provenance.
- The generated workbook includes all missing legal/commercial/warranty/policies/after-sales fields as blank/conditional, not fake values. It must exclude internal reviewer, complaint, restricted evidence, unauthorized source contact and payment status.
- Dealer downloads, corrects/finishes, uploads once; server accepts only checksum/version/claim-bound file and maps to one canonical editable application and correctly linked branch children; no retyping. The user must affirm prefilled facts; the importer cannot self-approve.
- OCR adds document **candidate** facts; independent compliance reviews original evidence. After valid signatory/terms and complete compliance, idempotent organization+dealer tenant+roles are provisioned and only then can operating UI and real inventory be used.
- Public starter and approved full page use same stable public identity (alias/slug redirects as needed), safe projection revision and cache invalidation. A suspended company must not remain falsely marked full/verified.

---

# 4. COMPLETE EXISTING DEALERSHIP 1.0 SCOPE (C01–C25)

In addition to the claim-first work above, deliver the full complete master plan:
C01 registration/claim; C02 prefilled workbook; C03 existing XLSX/CSV migration; C04 governed advisory header mapping; C05 governed document OCR incl real multipage PDF evaluation; C06 deterministic validation; C07 save/resume; C08 business verification; C09 conditional regulatory licence/authorization; C10 independent compliance review; C11 claim-safe organization/tenant activation; C12 expiry/revoke; C13 full operating profile; C14 real multi-branch; C15 functional dashboard; C16 persisted Corporate/AUTH staff RBAC; C17 canonical per-VIN inventory; C18 populated unclaimed-and-full dealer directory; C19 rich stable upgradeable page; C20 buyer assurance; C21 financing/payment policies; C22 warranty/workshop; C23 transaction-backed buyer reviews and complaints with Not measured when absent; C24 compliant paid service subscriptions; C25 jurisdiction/country policy configuration.

**No partial or fake implementation:** Dashboard buttons must persist valid state. Vehicle inventory and settlement are not inferred from research labels. Internal evidence and finance identifiers never enter public projection. Claim-first changes the start of the lifecycle, **not** the required full end of the lifecycle.

---

# 5. PHASE-BY-PHASE ONE LONG RUN — DO NOT HAND BACK MIDWAY

Every phase must begin by re-reading this prompt, the master plan's corresponding section, and the relevant **source/DEV worksheet tabs**, then updating \`PHASE_REQUIREMENT_TRACE.md\`. Create an exact-head checkpoint commit after passing appropriate tests. Proceed immediately to the next phase; **do not ask the Owner to reauthorize between phases**. Where a provider/real legal/commercial dependency is blocked, fail closed and record the blocker while finishing all remaining authorized engineering work.

## D0 — Exact source authority and 104-row inventory

- Inspect main/O2/One CarUp/Corporate/Dealer/Seller/PAY branches, exact SHAs and current schema. Read plan §0–§5.5, \`DEV 1/2/5/8\`, original research 10 tabs, verify 104 original seed IDs, 40 intake columns, 128 dictionary definitions.
- Produce baseline tests, per-domain authority and source-to-canonical mapping, current deployed vs draft distinction, parent/branch/group deduplication design, source safety register, logo usage assessment and source checksum. Record initial known defects.
- Exit: complete reproducible source/authority inventory and 104/104 original row accounting; no invented 111 dealer count.

## D1 — Canonical normalized data, prelisting and claim contracts

- Reuse existing organizations/tenants/tenant_users/dealer_profiles/dealer_branches/compliance/PAY/vehicle authority. Add minimal additive schema for immutable source candidates, grouping crosswalk, reviewed prelisting/public revision, claim requests/decisions/disputes, candidate provenance, signed source version, intake batches, company authorizations, service/policy/media as required by §4.
- Explicitly separate \`RESEARCH_SOURCE\`, \`RESEARCH_PUBLIC_ELIGIBLE\`, \`CLAIM_APPROVED\`, \`COMPLIANCE_APPROVED\`, \`TENANT_ACTIVE\`, \`FULL_PUBLIC\`.
- Never conflate original seed row with legal organization or reviewer-confirmed company. Privacy/RLS, stable URL and idempotent import contracts tested locally.
- Exit: exact data model and authority gates plus local migrations/constraints PASS.

## D2 — P0 compliance truth and claim-publication safety

- Repair hard-coded zero complaints, active_state/public divergence and reviewer/decision atomicity risks.
- Implement safe source-publication eligibility, takedown/correction/dispute states, independent claim reviewer permissions and negative anti-takeover tests, without rewriting accepted Corporate authority.
- Existing full compliance publication cannot be bypassed via seed import; explicit source-public read-model is narrower.
- Exit: unsafe unclaimed source fields/official badges withheld, claims cannot self-approve, no invented complaint count or roles.

## D3 — Generate versioned claim-prefilled Excel and manual forms

- Use \`DEV 3\` as the schema specification. Generate a clean official customer-facing template with instructions, BUSINESS, BRANCHES, LICENCES, BRANDS, OPERATIONS, FINANCE, WORKSHOP/WARRANTY, BUYER PROTECTION, DIGITAL MEDIA, vehicle references and server-executed CONSENTS.
- For CLAIM_APPROVED issue claimant- and claim-specific **PREFILLED** XLSX using reviewed relevant seed values and branch references, field-level provenance \`NEEDS_DEALER_CONFIRMATION\`, version/SHA and blank missing fields.
- Provide manual form with same field registry and save/resume. Prevent unapproved claimant from downloading a private file, foreign branch data or any reviewer ledger.
- Exit: generated .xlsx and manual form parity; source-prefund (pre-fill) proof and safe export tests PASS.

## D4 — Real 104-source seeder, public initial directory and import

- In isolated local database, import 104/104 source rows exactly, deterministic reimport, trace source/branch, classify and group with reviewer-gated identity.
- Publish actual **eligible** unclaimed starter pages to isolated local public directory; feature should be useful before any dealer claims. Source-reviewed public data and labels, claim CTA, correction/takedown. Source-unsafe records stay withheld with reasons.
- Implement secure claim submission, state and reviewer endpoints on top of D1–D2 authority.
- Implement fully structured many-sheet XLSX/CSV parsing, header-row detection, workbook version, field-level validation, optional AI advisory headers, human confirmation, entity relationships, staged persistence, error reports, checksum, idempotency, exact read-back, no re-entry.
- Exit: eligible source listings render, 104 rows accounted for, claim flows secure, approved-claim prefilled roundtrip passes.

## D5 — Governed business-document OCR

- Inspect O2 #208 earlier injected provider tests and OC5C deliberate deferral. Reconnect company OCR **only through** governed Document Intelligence. Use real appropriate business-image/PDF document class, multi-page processing proof, source page/field provenance and conflict correction.
- No machine verification, no hallucination-based approval, no source fields becoming approved because OCR text matches. Wrong docs/provider off must fail closed while permitting manual evidence.
- Exit: authorized real-document corpus where available, privacy/security checks and manual review fallback PASS.

## D6 — Independently approve claim + compliance, activate organization

- Implement secure claimant independent review incl branch/parent legal scope, two competing claims, appeal, rejection, corrections and reviewer separation; explain exactly why CLAIM_APPROVED alone is not compliance.
- After legal identity and compliance complete, atomically/idempotently bind or provision correct organization, dealership tenant, approved authorized representative and membership. Prevent self-assigned roles or crossing an existing tenant.
- Link seed profile, claim, legal organization, branches and stable public identity; no duplicated business.
- Exit: genuine rightful applicant gets own operating workspace only after full approval; rejected/hostile/disputed remains blocked.

## D7 — Full real dealer operating workspace

- Functional profile, branches, media, source correction, documents, authorizations/expiry, staff and real permissions, vehicle inventory, stock sourcing, leads, services, policy/warranty, buyer feedback, plan/finance views and history.
- Branch selector from actual DB, no fixed cities; buttons write to canonical domain and survive reload; all metrics measured or unavailable.
- Exit: authenticated E2E on several real fixture entities, tenant isolation and entity ownership.

## D8 — Two-tier SEO-ready public directory and stable upgraded profiles

- Build search/filter/list and public detail for unclaimed source-eligible records with prominent claim action, as-of attribution, rights-cleared logo or initials placeholder, location/categorization (not verified franchise) and safe contacts.
- For fully approved entities upgrade same canonical URL with real branding, branch galleries, VIN stock, inquiry, policies, reviewed licences, verified-source labels, real feedback and complaint measurement.
- Source edits, takedowns, suspensions, denied claims, disputed ownership and expiring verification must invalidate all search/public caches. No raw evidence or source false badges.
- Exit: unclaimed and fully approved render accurately on 390/768/1280/1920 with accessibility, privacy and SEO tests.

## D9 — Payment plans and Paynow funds-owner reconciliation (no live money)

- Preserve PAY-02 commercial products and PAY-03B organization subscriptions, plus PAY-04/PAY-05 garage-owned Paynow simulator architecture.
- **CarUp first-party:** dealer organization pays **CarUp** for authorized services/subscriptions via a specifically authorized CarUp merchant. Dealer storefront plan is currently **UNPRICED / COMMERCIALLY BLOCKED**; no guessed tariffs, merchant or provider real mode.
- **Garage third-party:** garage customer pays garage through garage-owned Paynow account; PAY-05 Level-1 protocol simulator tests only, NOT a dealer service payment; no garage settlement reclassification.
- **Potential dealer third-party:** buyer paying dealer requires independent merchant/legal/payee qualification; do not pretend PAY-05 already does this.
- Integrate plan display, eligibility, entitlements, invoicing/receipts, status/adapter safeguards, refunds/disputes, cross-tenant isolation and fail-closed authorized mode. No real provider calls/settlements. Preserve accepted negative finance regressions.
- Exit: exact financial ownership and no false paid state; external approval blockers explicit.

## D10 — Jurisdiction configuration and full convergence

- Zimbabwe-specific conditional tax/issuer/branch/OEM/PRAZ/bond rules with current authority research; no blanket requirement for every company. Future other-country configuration without unauthorized legal guesses.
- Finish integration of all C01–C25 without parallel identity/vehicle/payment systems. Perform source->claim->prefill->OCR->independent verification->tenant activation->same public profile upgrade in one real local app.
- Exit: source/workbook/plan trace matrix complete, end-to-end integrated boundaries and country tests PASS.

## D11 — Comprehensive certification and draft integration proposal

- Execute original \`DEV 7\` T01–T42 plus \`DEV 10\` S01–S25; add missing high-risk tests rather than changing or marking worksheet test outcomes as automatically passed.
- Test seed 104/104, parent/branch grouping, eligible/uneligible source publication, official category labels, logos/placeholder rights, claim anti-takeover, dispute/appeal, prefilled workbook security, import data parity, real OCR fallback, tenant/role activation, full publication upgrade, suspension/takedown, payment ownership, privacy, CI/local DB upgrade order, visual accessibility and performance.
- Twelve diverse realistic dealership test scenarios including multi-branch/franchise/importer/broker/service and at least one contested claimant. Synthetic tests are clearly fixture-labelled, not marketed as real dealer UAT.
- Independent read-only review where supported: source/database, auth/security/claim, privacy/brand, payments/finance, public UX/accessibility, integration.
- Exit: final exact-head source and CI receipts, independently reproducible evidence and one complete Draft implementation PR **unmerged**.

---

# 6. ACCEPTANCE PRIORITIES AND NON-NEGOTIABLE RED LINES

### Must demonstrably work on the isolated branch

- **104/104 original source records retained and classified**, with exact source seed IDs; no unauthorized seven additions; human-decided eligibility/suppression/grouping; not falsely 104 legal entities or 104 verified businesses.
- **Source-reviewed eligible profiles publicly visible while unclaimed** with truthful label, source/as-of and correction/claim controls.
- **Real secure claim**: independent proof and multiple-claim conflict handling; no staff/tenant/verified role from a click, domain email, phone, spreadsheet or payment.
- **Prefilled dealer-specific customer XLSX** after claimant approval; no raw reviewer/finance/buyer records exposed; all valid supported values round-trip into editable canonical application without re-entry.
- **Document OCR** candidate-only with source/provenance and reviewer approval independent from OCR.
- **Compliance** with licence conditions and correct seller/branch authorization; no fabricated complaint zero; no fake verified badges.
- **Stable public URL upgrade** from prelisted research info to full verified dealer, never brand affiliation inference or invented actual stock.
- **Existing CarUp services and payments** integrated only within legal-owner and commercial approvals; never live Paynow unauthorized.
- **Full coverage of C01–C25**; working UI, APIs, persistence, tests and reliable failure handling.

### Security and financial blockers

STOP an unsafe subtask on cross-tenant access, fraudulent owner takeover, false license/complaint/claim verification, exposed private documents or merchant keys, wrong funds beneficiary, live money/production migration without authority. Keep other independently safe work moving if possible and report the red-line blocker exactly.

### Evidence precedence

The **Google Sheet** is evidence of what was researched, not verification of reality or permission to publish unsafely. The **master plan** is controlling specification and publication policy; this **prompt** is controlling execution order/branch/evidence. Existing code after D0 governs canonical data ownership. If inconsistent, log it and seek Owner/Moderator decision; do not autonomously invent entity relations, commercial plans, logos, user testimonials or policy exceptions.

---

# 7. RETURN CONTRACT — ONE COMPLETE REVIEW PACKAGE

At end of this one long run, open ONE Draft PR from \`feat/carup-dealer-1-0-unified-longrun\` targeting main; do NOT merge or deploy. Return an evidence-based, independently inspectable document with:

1. **Source custody:** exact frozen main SHA, implementation branch, final exact-head SHA, changed files, ports from unmerged refs, clean worktree, CI/workflow references; checks that no shared-staging/real-money operation occurred.
2. **Requirement trace ledger:** every D0–D11 phase, corresponding complete plan section, actual source workbook tab and cell ranges, 104 seed IDs, code path and tests; unresolved Owner decisions explicit.
3. **Source seeding receipt:** exact 104 source rows, category and grouping breakdown, approved eligible public count vs withheld/duplicate/unsafe, source URL/claim state, rights-cleared logos versus placeholders; explicitly distinguish 104 source entries from legal-entity count and profile-publication count.
4. **Claim audit:** rightful, duplicate, branch-scope, hostile, disputed, rejected, appeal and correction/takedown flows, with no premature role grants.
5. **Workbook proof:** claim-specific prefilled generated XLSX with safe fields, uploaded corrections, checksum/actor binding, every supported field read back in correct canonical entities; old data migration and 104-source privacy.
6. **End-to-end product proof:** registration, OCR, independent compliance, entity/tenant activation, branch/inventory, stable public profile upgraded; genuine browser evidence with 390/768/1280/1920 responsive validation.
7. **All C01–C25 classification:** IMPLEMENTED_AND_TESTED / IMPLEMENTED_NOT_INDEPENDENTLY_CERTIFIED / PARTIAL / BLOCKED_EXTERNAL_AUTHORITY / NOT_IMPLEMENTED. Never mask a partial under a successful UI screenshot.
8. **Payment dossier:** CarUp first-party vs dealer vs garage money, PAY-02/PAY-03B/PAY-04/PAY-05 source and tested provider mode, tariffs unpriced, reconciliation/entitlements, real Paynow blocked by Owner/provider authorization; no invented successful charge.
9. **Test matrix:** T01–T42 + S01–S25, failures, corrected exact heads, independent review findings and CI, schema fingerprints, rollback and migration-order tests.
10. **Integration-readiness analysis:** minimal merge plan, current main ancestry/diff, route/config/migration ordering, backward compatibility, feature flags, source-data import procedure and recovery, privacy/finance security, Owner release gates and blockers.
11. **ONE specialist recommendation:** ACCEPT / REMEDIATE / BLOCK, with evidence. Final independent certification and Moderator decision belong to the Moderator and Owner, not to the implementer.

**Do not start until Owner explicitly appoints the execution agent by sharing this prompt. Once assigned: begin with D0 source and worksheet reconciliation, proceed through D11 without repeatedly asking for phase-by-phase authorization, keep work isolated, and return the full review package.**
