# CARUP-DEALER-ONB-001-LR01-R1 — Full DEV7 / DEV10 acceptance matrix

**Status: NOT INTEGRATION ACCEPTED.** This document derives 42 T-cases and 25 S-cases verbatim from the Owner's 20-tab reference workbook and distinguishes implementation evidence from independent PASS. It is NOT a fake 67-case pass report.

- Source test authority: `DEV 7 - Test Matrix!A2:H43` and `DEV 10 - Seed Tests!A2:I26`.
- Owner-original attached XLSX SHA-256: `a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137`.
- Native Google re-export SHA differs, eight nonidentity metadata cells differ; the 104 research rows and DEV8 crosswalk match.
- Recorded local 104-row audit uses SQLite, not the PostgreSQL importer; no human source records were approved for publication.
- `CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY` means a related test/service exists but the full named workbook acceptance gate has **not** been independently proven.
- `PHYSICAL_OR_PROVIDER_NOT_QUALIFIED` means the named browser/real-document/provider/financial workflow was not executed here.
- A subsequent specialist must replace each status only with exact-head test ID, actual result, screenshots/logs and independent reviewer proof. Do not auto-promote from GitHub CI success.

## DEV 7 — T01–T42

| ID | Scenario from workbook | Plan phase | Type | Current evidence, without overclaim | Actual acceptance disposition |
|---|---|---|---|---|---|
| T01 | Official XLSX: all named sheets and valid 40 original intake fields | D3-D4 | Exact read-back diff | dealerIntakeWorkbook.js; dealer-workbook-roundtrip.test.js | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T02 | Existing nonstandard spreadsheet with renamed headers | D4 | Mapping receipts and diff | dealerCsvIntake.js; dealer-csv-migration.test.js | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T03 | CSV with encoded quotes, formula-looking cells and newlines | D4 | Parser regression | dealer-csv-migration.test.js | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T04 | Research database source 104 rows and ten tabs | D4 | Database counts and crosswalk | 104-row owner-original local SQLite source audit; PostgreSQL still outstanding | REAL_SOURCE_LOCAL_SQLITE_ONLY |
| T05 | Multi-branch and multi-OEM one legal entity | D1-D4 | SQL join/foreign key evidence | 8+ isolated migration PGlite harness, canonical checks pending final CI | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T06 | Duplicate upload and concurrent retries | D4 | Idempotency/concurrency tests | dealer-workbook-roundtrip.test.js; DB version-receipts | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T07 | Changed bytes after confirmed mapping | D4 | Checksum tests | dealer-intake-workbook.test.js; source SHA custody | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T08 | Incorrect customer-supplied tenant_id/verified/status/paid fields | D4 | Adversarial API tests | dealer-research-service.test.js; negative auth/source | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T09 | Invalid dates, non-geographic GPS, unresolved branch keys | D4 | Error report screenshot | not physically observed in browser | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T10 | User resumes after closing browser | D3-D4 | Auth browser UAT | not physically observed in browser | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T11 | Real clear company registration photo | D5 | Document corpus | dealer-document-candidates.test.js (synthetic corpus) | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T12 | Multi-page business PDF with tax/expiry | D5 | Physical OCR evidence | real OCR binary/document corpus not qualified | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T13 | Non-document image / hallucination | D5 | Negative corpus | dealer-document-candidates.test.js negative corpus (synthetic) | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T14 | OCR unavailable or confidence not reported | D5 | Provider outage test | dealer-document-candidates.test.js local outage seam | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T15 | OCR disagrees with workbook legal name or expiry | D5 | Reviewer UAT | original private real reviewer/browser not qualified | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T16 | Dealer attempts self-approval or reviewer status import | D2-D6 | Authorization test | dealer-claim-application.test.js; dealer-legal-activation.test.js | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T17 | Approved applicant activates business tenant and owner | D6 | Physical DB UAT | PGlite synthetic; physical canonical DB UAT not run | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T18 | Suspended/expired dealer requests publish and public profile | D2-D8 | Lifecycle integration | dealer-legal-activation.test.js; live revocation SQL candidate | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T19 | PRAZ/bond/OEM not applicable case | D10 | Jurisdiction matrix | dealer-jurisdiction-preview.test.js (draft country policy) | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T20 | Cross-dealer file/branch/profile/contract access | D5-D8 | RLS/HTTP negative | dealer-research-service.test.js; PGlite private RLS | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T21 | No approved dealer in directory | D8 | Browser UAT | headless/headed browser UAT not qualified | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T22 | Approved dealer profile data parity and media gallery | D8 | DB→API→browser diff | real DB API browser parity not qualified | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T23 | Review/complaint register not measured | D2-D8 | Projection regression | dealer-full-storefront.test.js; research projection | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T24 | Business duty policy vs VIN-specific duty | D7-D8 | Marketplace safety tests | dealer-tenant-inventory.test.js (no seller rights) | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T25 | Real branch selector, staff permissions and inventory | D7 | Authenticated E2E | dealer-dashboard-authority-route.test.js plus dealer-tenant-leads.test.js and real Marketplace inquiry inbox; authenticated browser still not run | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T26 | Dealer plans unpriced/commercially blocked | D9 | Finance negative-path | dealer-commercial-readiness.test.js + read-only canonical PAY03B subscription/invoice/payment ledger readback if schema exists; no provider transaction | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T27 | CarUp services versus garage merchant gateway | D9 | Ledger identity test | PAY03B canonical payment_transactions read-only scope if deployed; real finance reconciliation and approved entitlement unqualified | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T28 | Paynow callback/return does not prove Paid | D9 | Provider simulator negative | No provider charge; PAY03B ledger/source only; Paynow merchant certification outstanding | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T29 | Provider retry/duplicate and late Paid/Disputed/Refunded | D9 | Concurrency/provider cases | PAY-03B/PAY-05 separate unmerged programmes | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T30 | No Owner Paynow live authorization | D9 | Env/DB guard tests | no shared/live provider activated | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T31 | Dealer outside Zimbabwe | D10 | Country policy tests | dealer-jurisdiction-preview.test.js (draft only) | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T32 | Mobile layouts 390/768/1280/1920, keyboard/screen reader | D7-D11 | Headed Chromium UAT | 390/768/1280/1920 physical browser not run | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T33 | Original source 104 and 128 definitions preserved | D0-D11 | Before/after ranges | source version and required original workbook trace | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T34 | Exact-head CI, reversible local migrations and draft PR | D11 | GitHub/SQL receipt | pending exact-head GitHub Actions | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| T35 | 12 diverse dealership pilot scenarios | D11 | Pilot signed report | 12 real consenting dealer pilot not run | EXTERNAL_INDEPENDENT_GATE |
| T36 | 104 source records vs row 111 | D0-D4 | Source manifest and DB receipt | 104/104 original attached source local SQLite audit; no PostgreSQL importer run | REAL_SOURCE_LOCAL_SQLITE_ONLY |
| T37 | Prelist eligible but unclaimed | D4/D8 | Browser + projection | dealer-research-service.test.js; physical browser still pending | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T38 | Hostile/duplicate dealer claim request | D2/D6 | Auth/DB negative | dealer-claim-application.test.js; maker/checker PGlite | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T39 | Rightful approved claimant exports and uploads prefilled file | D3-D4 | XLSX roundtrip and readback | dealer-workbook-roundtrip.test.js (synthetic) | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T40 | Same slug upgraded after full compliance and activation | D6/D8 | E2E/SEO/caches | dealer-full-storefront.test.js (synthetic); SEO not qualified | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T41 | Source official/franchise label without authorized logo | D4/D8 | Privacy/brand UAT | brand rights are unapproved; initials placeholders | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| T42 | Wrong stale business location or closure request | D2/D8 | HTTP/SEO UAT | dealer-research-service.test.js; browser/SEO invalidation not qualified | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |

## DEV 10 — S01–S25

| ID | Scenario from workbook | Expected outcome | Phase | Evidence, without overclaim | Actual acceptance disposition |
|---|---|---|---|---|---|
| S01 | Read A8:K111 and seed into isolated DB | 104 exact source-qualified IDs, all accounted, no created fictitious 7 | D0/D4 | Owner-attached XLSX 104/104 exact-ID local SQLite source audit | REAL_SOURCE_LOCAL_SQLITE_ONLY |
| S02 | Reimport same workbook twice | One logical source record per seed ID; same audit fingerprint and no duplicate profiles | D4 | Local 104-row same-source replay/readback; canonical PostgreSQL importer not run | REAL_SOURCE_LOCAL_SQLITE_ONLY |
| S03 | Two source rows same group, distinct branch | Retain both branch IDs under one proven parent; no automatic legal merge | D1/D4 | importResearchSeed.mjs duplicate/group signal logic; reviewer still outstanding | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S04 | Same trading names different legal entities | No guessed merger or account takeover; human review | D1/D4 | importResearchSeed.mjs no automatic legal merge | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S05 | Raw source labels Authorized Dealer / Bonded | Render as researched/unverified category; never verification trust badge | D2/D4 | 104 categories from DEV 8, all unverified | REAL_SOURCE_LOCAL_SQLITE_ONLY |
| S06 | Verified public source/business address, lawful display | Eligible can publish as minimal unclaimed, source/as-of and clear label | D2/D4/D8 | no independent human eligibility review yet | HUMAN_ELIGIBILITY_PENDING |
| S07 | Outdated URL or personal contact | Withhold/omit unsafe field and record reason; no public leak | D2/D8 | dealer_research_public_contact_events (candidate only) | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S08 | Zero claim approvals and multiple public eligible records | Directory and individual starter pages work before users register | D4/D8 | dealer-research-service.test.js; no real eligible records | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S09 | Two records merged after source review | Stable canonical URL and redirects, no duplicate search/count | D8 | dealerResearchService.js source vs full projection | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S10 | Official logo not legally cleared | No hotlink/OEM impersonation; generic initials placeholder | D4/D8 | placeholder only, official rights not approved | HUMAN_ELIGIBILITY_PENDING |
| S11 | Unregistered visitor clicks claim | Authentication then scoped claim draft; no profile editing | D6 | dealer-claim-application.test.js | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S12 | Attacker claims matching website/email only | No self-approval; independently authenticated legal authority required | D6 | dealer-claim-application.test.js; maker-checker PGlite | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S13 | Two claimants file same branch | Concurrent dispute/hold; neither receives company control without proof | D6 | dealer-research-service.test.js; competing claims | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S14 | Correct parent organization claims multiple branches | Review branch scope; approved claimant may manage proper branches only | D6 | dealer-legal-activation.test.js; conditional cross-entity authority | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S15 | Approved claimant exports company-specific XLSX | Known public-safe/source allowed fields prefilled, tagged NEEDS_CONFIRMATION | D3 | dealer-intake-workbook.test.js; no live claimant | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S16 | Unapproved claimant tries another dealer's workbook export | 403/404, never source's raw evidence and private contact dump | D3-D4 | dealer-claim-application.test.js private workbook | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S17 | Claim approved->prefill->correct+upload | Correct persisted business/branch child values; no duplicate entry, explicit provenance | D3-D4 | dealer-workbook-roundtrip.test.js | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S18 | Claim approval without full compliance | No verified badge, seller rights, tenant or commercial entitlement | D6 | dealer-legal-activation.test.js synthetic; real country signoff pending | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S19 | Full approval and activation | Same stable URL upgrades to full source-safe approved dealer; real inventory per VIN | D6/D8 | dealer-full-storefront.test.js; synthetic only | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S20 | Claim dispute/owner takedown/full verified expired | Public status withdrawn or downgraded only after independent policy check; no stale cache | D2/D8 | dealer-legal-activation.test.js revocation candidate; physical absent | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S21 | Google snippet of prelisted website | Unclaimed source label and dated provenance; no fake reviewed claim | D8 | public page present; physical SEO/canonical audit absent | PHYSICAL_OR_PROVIDER_NOT_QUALIFIED |
| S22 | Prelisted visitor attempts buy CarUp service or use merchant | No auto merchant/role; PAY-03B commercial blocks, no PAY-05 garage money reuse | D9 | dealer-commercial-readiness.test.js now checks canonical tenant invoice payment hold/foreign tenant refusal; no provider test | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S23 | Reviewer rejects and different actor appeals | Immutable audit, separate reviewer, no permissions until approved | D6 | dealer-claim-application.test.js; immutable claims/appeals | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S24 | Non-Zimbabwe new business without seed | Safe new-business path, no forced ZIMRA/PRAZ, duplicate guard | D10 | dealer-jurisdiction-preview.test.js foreign fail-closed | CANDIDATE_SOURCE_OR_SYNTHETIC_TEST_ONLY |
| S25 | Source original 10 tabs preserved, DEV1–10 aligned and 12 dealer pilot | Evidence of source count, eligibility statuses, claims, prefill, upgrade and exact-head CI | D11 | independent formal 11-11 Tech certification not run | EXTERNAL_INDEPENDENT_GATE |

## Overall test counting rule

**67 named cases identified (42 T + 25 S); 0/67 independently certified PASS by this matrix.** This does not imply 67 failed product cases: available source-level unit/SQL coverage is recorded distinctly from full physical and human acceptance. The 12 synthetic dealer journeys are not the 12-real-dealer pilot. Release remains BLOCK.
