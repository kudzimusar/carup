# Public API Inventory — Issue #164 Phase 1

Analysis only. No source file was modified. Baseline: `c662d1a4` (Phase 0) on
`integration/canonical-vehicle-truth-closure`.

Scope: every endpoint reachable from `backend/server.js` route registrations
(`backend/server.js:244-296`, plus the ~60 handlers defined inline in `server.js`) and every file in
`backend/routes/` that returns **vehicle, listing, seller, evidence, trust or transaction** data.
Endpoints that carry none of those facts (auth, comms, diaspora, referral, navigation analytics,
feature governance, governance/compliance ledgers, admin org/audit) are out of scope and omitted.

Canonical contract under consumption, never forked:
`backend/utils/publicVehicleProjection.js`.

---

## 1. Classification counts

| Classification | Count |
|---|---:|
| **retain** | 37 |
| **adapt** | 19 |
| **consolidate** | 15 |
| **deprecate** | 4 |
| **total endpoints inventoried** | **75** |

Definitions used below:
- **retain** — already correct against the nine principles; no Phase 1 change.
- **adapt** — endpoint stays, but its projection, gate, or fabricated default must change.
- **consolidate** — endpoint's fact set is served by another endpoint; fold it in and make one the source.
- **deprecate** — endpoint is a strictly weaker duplicate or an unbounded oracle; remove or gate to zero public reach.

---

## 2. Inventory

### A. Anonymous vehicle reads registered inline in `server.js`

| path | method | auth middleware | returns | projection / select | overlaps-with | class | reasoning |
|---|---|---|---|---|---|---|---|
| `/api/vehicles/:vin/details` (`server.js:421`) | GET | **none** | one vehicle + `tenant:tenants(name,type,status)` | `PUBLIC_VEHICLE_SELECT` (`server.js:427`) | `/api/marketplace/listings/:id`, passport | consolidate | Second public per-VIN vehicle representation. Same facts as the marketplace detail but a thinner, differently-named shape, and it embeds the raw tenant row where the marketplace deliberately reduces the tenant to a governed seller label (`listingSummaryService.js:92-111`). Two shapes for one identity = principle 1 breach. |
| `/api/vehicles` (`server.js:440`) | GET | **none** | vehicle array, ad-hoc filters | `PUBLIC_VEHICLE_SELECT` (`server.js:447`) | `/api/marketplace/listings` | deprecate | Strictly weaker duplicate of the marketplace list: no evidence/PartSentry/ownership joins, no derived tags, no media, **no fixture exclusion** (`filterVisibleVehicles`, `listingSummaryService.js:402`), and a different filter vocabulary (`dutyPaid`/`policeVerified`/`trustRange` vs `tag`/`condition`). Publishes raw column names as the public contract. |
| `/api/vehicles/:vin/passport` (`server.js:763`) | GET | `optionalAuth()` | vehicle + timeline + evidenceVault + trustReport + chainVerification + identity + plateHistory + ownershipSummary | `projectVehicle` / `toPublicEvidence` / `toPublicPlateHistory` (`server.js:728,731,753`) | `/details`, `/api/vehicles/:vin/report`, `/trust-decision` | adapt | The deepest public read and the only one already on the canonical contract. Two defects remain: **no publication/status gate at all** (`buildVehiclePassport`, `server.js:523-541` never calls `isPublicVehicleStatus`/`isPubliclyVisiblePublication`), and the timeline still carries un-allow-listed evidence payload — see §5. |
| `/api/vehicles/passport/lookup/:identifier` (`server.js:778`) | GET | `optionalAuth()` | same as passport | same | passport | adapt | **Identifier oracle.** `collectPassportLookupMatches` (`server.js:490-514`) probes `vehicles.chassis_number`, `vehicles.plate_number`, `vehicles.normalized_plate_number`, `vehicles.temporary_identification_number` and `vehicle_plate_history.plate_number/normalized_plate_number` with no visibility gate. 404/409/200 confirm-or-deny any registry identifier for **any** vehicle, including drafts, and `vehicle_plate_history` rows whose `record_visibility` is not `'public'`. The values are correctly withheld from the body but confirmed by the status code. |
| `/api/vehicles/:vin/verify-ledger` (`server.js:807`) | GET | **none** | full `verifyChain(vin)` report | none (raw service output) | `passport.chainVerification` | consolidate | The passport deliberately strips `chain[]` for anonymous callers because ledger payloads carry owner names (`server.js:735-738`). This endpoint returns the *same* `verifyChain` output unredacted and unauthenticated. It is the redaction the passport applies, reachable by another URL. |
| `/api/vehicles/:vin/odometer-audit` (`server.js:818`) | GET | **none** | odometer audit | none | `report.mileage_history` (`reportService.js:114`), passport timeline | consolidate | Third mileage-truth representation for one vehicle, no gate, no shared derivation with `buildMileageHistory`. |
| `/api/vehicles/:vin/recommendations` (`server.js:1093`) | GET | **none** | vehicle array | **`PUBLIC_VEHICLE_COLUMNS`** (`recommendationService.js:21`) | `/api/marketplace/recommendations` | deprecate | Duplicate of the marketplace recommender with a different projection, different shape (raw rows vs summaries), different limit and different ranking. Also reads its anchor via `select('vin, make, price')` with **no gate** (`recommendationService.js:9-13`). |
| `/api/partsentry/:vin` (`server.js:964`) | GET | `optionalAuth()` | governed repair ledger | `getRepairHistory({publicOnly})` | listing `partsentry_*` fields | retain | Correct: audience widening keys on the verified `owner_id` match only, explicitly refusing the unverified `x-tenant-id` claim (`server.js:973-985`). |
| `/api/security/check-stolen/:vin` (`server.js:1071`) | GET | **none** | `{stolen, policeReportNumber, reportedAt, actionRequired}` | `stolen_vehicles` `select('*')` (`securityService.js:33`) | listing `risk_status`, trust `fraud_risk` | adapt | Anonymous, ungated, and echoes the **police report number** — an external case identifier — to any caller. Overlaps `trust_summary.risk_status` with no shared derivation. |
| `/api/insurance/quote` (`server.js:1039`) | POST | **none** | premium, monthly, riskScore, currency, discounts | `vehicles` `select('*')` (`insuranceService.js:5`) | `eligibilityRoutes`, `insurerRoutes`, `partner .../insurance` | deprecate | Anonymous priced read of **any** VIN including drafts. `userId` is taken from the body (`server.js:1040`), so the caller picks whose `stakeholder_profiles.trust_score` weights the quote — a cross-user trust-score oracle. Substitutes `trustScore = 50.0` when the profile is missing (`insuranceService.js:9`) and prices on it. Superseded by the governed eligibility path. |
| `/api/reputation/:dealerId` (`server.js:1082`) | GET | **none** | dealer trust score | `reputationService` | `seller_summary`, `/api/dealers/:id/summary` | adapt | Third seller-trust representation (this, `getBuyerSafeSummary`, `sellerSummaryForVehicle`), anonymous, keyed on a user id so it enumerates dealer identities. |
| `/api/import/duty-estimate` (`server.js:1050`) | POST | **none** | pure ZIMRA duty calc | none | — | retain | No stored fact read; input-only calculator. |

### B. Marketplace public surface (`backend/routes/marketplaceRoutes.js`)

| path | method | auth middleware | returns | projection / select | overlaps-with | class | reasoning |
|---|---|---|---|---|---|---|---|
| `/api/marketplace/listings` (`:46`) | GET | **none** | `{listings[], total, limit}` summaries | `LISTING_SELECT_COLUMNS` → `buildMarketplaceListingSummary` (`listingSummaryService.js:417,214`) | `/api/vehicles` | adapt | Richest and best-gated public list; the right base for the canonical contract. Must adopt the canonical projection and drop the fabricated defaults at `listingSummaryService.js:236,237,241,244,259`. |
| `/api/marketplace/listings/:id` (`:76`) | GET | `optionalAuth()` | full detail: summary + trust/verification/pricing + media + seller + safety + transaction intent | same + `marketplaceListingDetailService.js:114-148` | `/api/vehicles/:vin/details`, passport | adapt | The right base for the canonical public detail. Fabricates `seller_summary.location`/`country` (`marketplaceListingDetailService.js:39-40`). |
| `/api/marketplace/recommendations` (`:67`) | GET | **none** | summaries | `LISTING_SELECT_COLUMNS` | `/api/vehicles/:vin/recommendations` | adapt | Correct pipeline, but the **anchor read is ungated** (`marketplaceDiscoveryService.js:70-76`): an unpublished VIN is a valid anchor, so `{listings:[],total:0}` vs a populated result distinguishes "no such VIN" from "draft VIN exists". |
| `/api/marketplace/compare` (`:71`) | POST | **none** | detail-lite ×4 | via `getMarketplaceListingDetail` | — | retain | Inherits the detail gate; non-public VINs are silently dropped (`marketplaceDiscoveryService.js:52`). |
| `/api/marketplace/nav-coverage` (`:50`) | GET | **none** | counts per nav slot | `navCoverageService` | — | retain | Aggregate counts only. |
| `/api/marketplace/categories` (`:54`) | GET | **none** | static taxonomy | none | — | retain | No stored fact. |
| `/api/marketplace/parts` (`:59`) | GET | **none** | `{listings: [], governed: true}` | `buildPartSummary` (`marketplacePartsService.js:16`) | — | adapt | Correctly returns empty rather than fabricating inventory, but the shape itself bakes in `location: 'Zimbabwe'`, `supplier_label: 'Verified supplier'`, `currency: 'USD'` as defaults (`:26,29,33`) — the fabrications land the moment inventory exists. |
| `/api/marketplace/services` (`:63`) | GET | **none** | `{listings: [], governed: true}` | `buildServiceSummary` (`marketplacePartsService.js:37`) | — | adapt | Same: `display_name: 'Service provider'`, `location: 'Zimbabwe'`, `verification_status: 'unverified'` defaults (`:40,43,44`). `'unverified'` as a default for an absent value is absence-as-proof (principle 9). |
| `/api/marketplace/inquiries` (`:96`) | POST | `optionalAuth()` | inquiry record | `marketplaceInquiryService` | — | retain | Rate-limited, guest-allowed by design. |
| `/api/marketplace/saved` (`:110`) | GET | `authorizeRole([])` | saved listing summaries | `marketplaceSavedService` | `/api/vehicles/saved` | consolidate | Two saved-listing stores/read paths for one user intent. |
| `/api/marketplace/listings/:id/save` (`:114`) | POST | `authorizeRole([])` | ack | — | `/api/vehicles/saved/add` | consolidate | Same. |
| `/api/marketplace/listings/:id/save` (`:118`) | DELETE | `authorizeRole([])` | ack | — | `/api/vehicles/saved/:vin` | consolidate | Same. |
| `/api/marketplace/my-listings/inquiries` (`:124`) | GET | `authorizeRole([])` | seller inbox | `listInquiriesForSeller` | — | retain | Seller-scoped. |
| `/api/marketplace/ai/{listing-draft,buyer-assistant,price-estimate,share-copy}` (`:139,143,147,152`) | POST | **none** | advisory copy | `price-estimate` resolves via the public detail (`:130-137`) | — | retain | Advisory only; `price-estimate` inherits the detail gate. |

### C. Evidence reads

| path | method | auth middleware | returns | projection / select | overlaps-with | class | reasoning |
|---|---|---|---|---|---|---|---|
| `/api/vehicles/:vin/evidence` (`vehiclesRoutes.js:437`) | GET | **none — hand-rolled header auth** | full `vehicle_evidence` rows | `select('*')` + `normalizeEvidenceRecord` (`:485-489`, `evidenceService.js:272-288` spreads `...record`) | `passport.evidenceVault` | adapt | **P0.** Two defects Phase 0 already fixed on the passport, still live here: (1) audience is decided from the **unverified** `x-user-id` / `x-tenant-id` headers (`:441-481`) — a scraped `owner_id` buys the owner audience, which is exactly the passport defect; (2) rows are returned raw, so anonymous callers receive `uploaded_by`, `verified_by`, `source_id`, `tenant_id`, `file_path`, `storage_bucket`, `verification_notes` — every field `PUBLIC_EVIDENCE_FIELDS` exists to withhold. |
| `/api/vehicles/:vin/evidence/timeline` (`vehiclesRoutes.js:536`) | GET | **none** | timeline items + full evidence rows | `select('*')` → `evidenceToTimelineItem` (`:551`, `evidenceService.js:296`) | `passport.evidenceTimeline` | adapt | **P0.** Anonymous. `evidenceToTimelineItem` emits `details.uploadedBy = uploaded_by` (`evidenceService.js:314`) and `desc = verification_notes` (`:307`); `sanitizedEvidence` (`:568-576`) returns the whole row again. No `toPublicEvidence`, no publication gate. |
| `/api/vehicles/:vin/evidence-sets` (`evidenceCatalogRoutes.js:74`) | GET | **none** | full evidence-set rows | `select('*')` (`evidenceSetService.js:51-58`) | passport | adapt | Anonymous, no allow-list, no vehicle-existence check, no publication gate. |
| `/api/evidence/taxonomy` (`evidenceCatalogRoutes.js:41`) | GET | **none** | static taxonomy | none | — | retain | Reference data. |
| `/api/evidence/sources` (`evidenceCatalogRoutes.js:46`) | GET | **none** | registry list | `listPublicSources` | — | retain | Already a public-safe source list. |
| `/api/vehicles/:vin/evidence/:evidenceId/provenance` (`evidenceCatalogRoutes.js:81`) | GET | `authorizeRole()` | chain validity + events | `toPublicProvenanceSummary` for non-privileged (`:90-95`) | — | retain | Correct audience split. |
| `/api/vehicles/:vin/extractions` (`evidenceCatalogRoutes.js:114`) | GET | `authorizeRole(...)` | OCR extractions | — | — | retain | Authenticated, review-gated. |
| `/api/evidence/review` (`vehiclesRoutes.js:586`) | GET | `authorizeRole(reviewRoles)` | evidence + `vehicles(make,model,year,trust_score)` | `select('*, vehicles!...(...)')` (`:594`) | — | retain | Reviewer surface, tenant-scoped fail-closed below `:600`. |

### D. Trust & report reads

| path | method | auth middleware | returns | projection / select | overlaps-with | class | reasoning |
|---|---|---|---|---|---|---|---|
| `/api/vehicles/:vin/trust-decision` (`trustDecisionRoutes.js:16`) | GET | `authorizeRole()` | dimensional decision | `toPublicDecision` (`trustDecisionService.js:279`) | `passport.trustReport`, listing `trust_summary`, `vehicles.trust_score`, partner `trust-summary`/`decision` | consolidate | The dimensional model is the right Trust authority, but it is one of **four** live trust representations (see §6, gap 1). Also note `owner`/`dealer` are treated as privileged here (`:20`) yet not by `reportService.isPrivileged` (`reportService.js:17`) — two different privilege ladders. |
| `/api/vehicles/:vin/trust-decision/full` (`trustDecisionRoutes.js:27`) | GET | `authorizeRole(['admin','government','reviewer'])` | full decision | — | — | retain | Correct. |
| `/api/vehicles/:vin/report` (`reportRoutes.js:20`) | GET | `optionalAuth()` | `vehicle_history_report.v1` | `assembleReport` (`reportService.js:98`) | passport | adapt | Fourth public per-VIN vehicle representation. Body is already narrow (`identity` = vin/make/model/year, `reportService.js:125`), but there is **no publication/status gate**: an anonymous caller pulls a history report for a draft VIN. |
| `/api/reports/shared/:token` (`reportRoutes.js:43`) | GET | share token | immutable snapshot | — | — | retain | Token-scoped, revocable, 410 on expiry. |
| `/api/vehicles/:vin/report/versions`, `/api/report-versions/:id/{share,revoke}` (`reportRoutes.js:26,31,37`) | POST | `authorizeRole(...)` | version / link | — | — | retain | Owner/admin only. |
| `/api/vehicles/:vin/sources` (`sourceVerificationRoutes.js:84`) | GET | `authorizeRole([...])` | per-provider results | — | — | retain | Authenticated. |
| `/api/vehicles/:vin/sources/coverage` (`sourceVerificationRoutes.js:94`) | GET | `authorizeRole()` | coverage | `getCoverage` | trust-decision `source_coverage` dim | retain | Shared derivation already. |
| `/api/verification/audit-trail/:vin` (`trustFactRoutes.js:72`) | GET | `authorizeRole([...])` | trust-fact audit | — | — | retain | Authenticated. |

### E. Partner API v1 (`backend/routes/partnerApiRoutes.js`)

| path | method | auth middleware | returns | projection / select | overlaps-with | class | reasoning |
|---|---|---|---|---|---|---|---|
| `/api/partner/v1/vehicles/:vin/identity` (`:47`) | GET | `requirePartnerScope('vehicle:identity')` | `{vin, make, model, year, plate_number}` | inline allow-list (`:48-56`) | `PRIVATE_VEHICLE_FIELDS` | adapt | **Governed, not a leak — but a convergence gap.** `plate_number` is in `PRIVATE_VEHICLE_FIELDS` (`publicVehicleProjection.js:66`) and in `OWNER_ADDITIONAL_VEHICLE_FIELDS` (`publicVehicleProjection.js:72-79`); the partner audience is a third audience the contract does not name. It also has **no publication/status gate**, so a scoped partner reads identity for drafts. The fix is to name a `partner` audience in the contract, not to fork a fourth allow-list in route code. |
| `/api/partner/v1/vehicles/:vin/trust-summary` (`:60`) | GET | `requirePartnerScope('vehicle:trust')` | `{trust: toPublicDecision(...)}` | `toPublicDecision` | `.../decision` (`:85`) | consolidate | Byte-identical payload to `.../decision` under a different scope name. |
| `/api/partner/v1/vehicles/:vin/decision` (`:85`) | GET | `requirePartnerScope('trust:read')` | `{decision: toPublicDecision(...)}` | `toPublicDecision` | `.../trust-summary` | deprecate | Exact duplicate of `:60` with a different scope and a different response key. Two scopes granting the same fact is a governance defect. |
| `/api/partner/v1/vehicles/:vin/source-coverage` (`:68`) | GET | `requirePartnerScope('vehicle:sources')` | provider/mode/status/retrieved_at | explicit map (`:71`) | — | retain | Narrow, explicit. |
| `/api/partner/v1/vehicles/:vin/fraud-summary` (`:76`) | GET | `requirePartnerScope('fraud:read_summary')` | risk dims | derived from decision | — | retain | Summary only. |
| `/api/partner/v1/dealers/:id/summary` (`:93`) | GET | `requirePartnerScope('dealer:read_summary')` | buyer-safe dealer | `getBuyerSafeSummary` | `/api/dealers/:id/summary` (`dealerRoutes.js:153`) | consolidate | Same service, two surfaces, two auth models. |
| `/api/partner/v1/vehicles/:vin/insurance` (`:100,113`) | POST/GET | scope | request/status | `eligibilityService` | `eligibilityRoutes.js:68,69` | retain | Status only, no applicant PII. |
| `/api/partner/v1/vehicles/:vin/finance` (`:122,132`) | POST/GET | scope | status | `eligibilityService` | `eligibilityRoutes.js:72,73` | retain | Status only. |
| `/api/partner/v1/vehicles/:vin/escrow` (`:143`) | GET | scope | latest session status | `listSessionsForVin` | `escrowTrustRoutes.js:51` | retain | Status only. |
| `/api/partner/v1/ping` (`:41`) | GET | `requirePartnerScope(null)` | liveness | — | — | retain | No vehicle fact. |

### F. Owner / seller views

| path | method | auth middleware | returns | projection / select | overlaps-with | class | reasoning |
|---|---|---|---|---|---|---|---|
| `/api/vehicles/me` (`server.js:1767`) | GET | `authorizeRole(['owner','dealer','admin'])` | own vehicles, **raw rows** | `select('*')` (`:1771`) | `OWNER_VEHICLE_SELECT` | adapt | The canonical owner audience already exists (`publicVehicleProjection.js:84-87`) and is unused. `select('*')` means every new `vehicles` column silently joins the owner response — the exact failure mode the contract was written to end. |
| `/api/vehicles/saved` (`server.js:1783`) | GET | `authorizeRole(['owner','dealer','admin'])` | **other sellers'** vehicles | **`PUBLIC_VEHICLE_COLUMNS`** embed (`:1789`) | `PUBLIC_VEHICLE_SELECT`, `/api/marketplace/saved` | adapt | The legacy list is a strict subset of `PUBLIC_VEHICLE_FIELDS`, so converging is a safe widening (adds `generation`? no — adds `registration_authority`, `registration_status`, `plate_status`, `zimra_verified`, `inspection_ready`, `safe_pay_ready`, `public_seller_display_enabled`). **`backend/tests/db-compat-legacy-scopes.test.js:58` pins the literal string `vehicles(${PUBLIC_VEHICLE_COLUMNS})`**, so convergence requires editing that test in the same change; the assertion at `:62` (`!section.includes('vehicles(*)')`) is the invariant worth keeping. Also: this read applies **no publication gate** — an unpublished vehicle stays readable to anyone who saved it before unpublish, which makes `unpublish` a partial no-op. |
| `/api/vehicles/saved/add` (`server.js:1801`) | POST | `authorizeRole([...])` | ack | — | `/api/marketplace/listings/:id/save` | consolidate | Duplicate write path into a different table than `marketplaceSavedService`. |
| `/api/vehicles/saved/:vin` (`server.js:1822`) | DELETE | `authorizeRole([...])` | ack | — | `/api/marketplace/listings/:id/save` DELETE | consolidate | Same. |
| `/api/vehicles/inventory` (`server.js:1534`) | GET | `authorizeRole(['dealer','admin'])` | tenant vehicles, **raw rows** | `select('*')` (`:1543`) | `OWNER_VEHICLE_SELECT` | adapt | Same `select('*')` defect as `/vehicles/me`, at tenant scope. Frontend consumes it as `Vehicle[]` (`web/src/hooks/useCarUpApi.ts:628`). |
| `/api/vehicles/:vin/completeness` (`server.js:1506`) | GET | `authorizeRole([...])` + owner/tenant scope (`:1509-1523`) | requirement matrix | `evaluateCompleteness` | publish gate | retain | Scope rule pinned by `db-compat-legacy-scopes.test.js:20`. |
| `/api/service-history/me` (`server.js:1840`) | GET | `authorizeRole([...])` | service rows for owned VINs | — | — | retain | Owner-scoped. |
| `/api/vehicles/add` (`server.js:1429`) | POST | `authorizeRole(['dealer','owner','admin'])` | ack `{vin, publication_status:'draft'}` | insert (`:1450-1472`) | — | adapt | **The de-fabrication frontier Phase 0 did not reach.** The response is clean; the *write* manufactures: `color \|\| 'White'`, `mileage \|\| 0`, `fuel_type \|\| 'Petrol'`, `drivetrain: 'RWD'` (hardcoded, never from input), `transmission \|\| 'Automatic'`, `generation: ''`, `trim: ''`, `currency \|\| 'USD'`, `duty_paid: false`, `police_verified: false`, and **`trust_score: 50`**. Every one of these is later published as fact by the marketplace and the passport. Separately, the handler destructures `location`, `province`, `description` from the body (`:1432`) and **never persists them** — which is precisely why the read path has to hardcode `location: 'Zimbabwe'`. |
| `/api/vehicles/:vin/status` (`vehiclesRoutes.js:44`) | PATCH | `authorizeRole([...])` + scope (`:55-70`) | ack | — | — | retain | Scoped and audited. |
| `/api/vehicles/:vin/publish` (`vehiclesRoutes.js:152`) | POST | `authorizeRole([...])` + `loadScopedVehicle` | ack | `evaluateCompleteness` gate (`:160`) | — | retain | Correct: publication is a deliberate, gated, audited seller action. (Header comment at `vehiclesRoutes.js:111` is stale — it claims the marketplace shows `publishable` *and* `published`; the live gate is `['published']` only, `vehicleStatus.js:46`.) |
| `/api/vehicles/:vin/unpublish` (`vehiclesRoutes.js:180`) | POST | `authorizeRole([...])` + scope | ack | — | — | retain | Returns to `publishable`, not `draft`. |
| `/api/dealers/:id/summary` (`dealerRoutes.js:153`) | GET | `authorizeRole()` | buyer-safe dealer summary | `getBuyerSafeSummary` | partner `:93`, `/api/reputation/:dealerId`, `seller_summary` | consolidate | Fourth seller representation. |

### G. Transaction readiness

| path | method | auth middleware | returns | projection / select | overlaps-with | class | reasoning |
|---|---|---|---|---|---|---|---|
| `/api/safepay/create` (`server.js:829`) | POST | `authorizeRole()` | escrow record | safepay service | `/api/vehicles/:vin/escrow` POST | consolidate | Two escrow engines for one transaction concept: `safepay_escrows` (`supabase_schema.sql:84`) vs `escrowTrustService` sessions. `transaction_intent` in the public detail (`marketplaceListingDetailService.js:63-73`) references neither. |
| `/api/safepay/list` (`server.js:840`) | GET | `authorizeRole()` | escrows | — | `/api/vehicles/:vin/escrow` GET | consolidate | Same. |
| `/api/safepay/:id/update` (`server.js:890`) | POST | `authorizeRole()` | escrow | — | `/api/escrow/:id/transition` | consolidate | Same. |
| `/api/vehicles/:vin/reserve` (`server.js:1107`) | POST | `authorizeRole()` | reservation | `reserveVehicle` | `transaction_intent`, `status: 'Reserved'` | adapt | Buyer identity correctly taken from the session, but reservation is a third transaction-state store not reflected in `transaction_intent`, and it has no publication gate — a draft VIN can be reserved. |
| `/api/vehicles/:vin/escrow` (`escrowTrustRoutes.js:29,51`) | POST/GET | `authorizeRole([...])` | session | `escrowTrustService` | safepay | retain | The better-governed of the two engines; make it the survivor. |
| `/api/escrow/:id` (`escrowTrustRoutes.js:55`) | GET | `authorizeRole([...])` | session | — | — | retain | |
| `/api/escrow/:id/transition` (`escrowTrustRoutes.js:63`) | PATCH | `authorizeRole([...])` | session | — | — | retain | Server-authoritative state machine (principle 7). |
| `/api/vehicles/:vin/finance/availability` (`lenderRoutes.js:138`) | GET | `authorizeRole` | availability | — | `transaction_intent` | retain | |
| `/api/vehicles/:vin/{insurance,finance}/eligibility` (`eligibilityRoutes.js:68,69,72,73`) | POST/GET | `authorizeRole([...])` | status | `eligibilityService` | partner insurance/finance | retain | Consent- and gate-context-driven. |
| `/api/vehicles/:vin/insurer/*`, `/api/vehicles/:vin/finance/lender/*` (`insurerRoutes.js:46,63,85`, `lenderRoutes.js:60,73,104,118`) | POST/GET | `authorizeRole` inside handler | consent/eligibility | — | eligibility routes | retain | |

### H. Admin / moderation

| path | method | auth middleware | returns | projection / select | overlaps-with | class | reasoning |
|---|---|---|---|---|---|---|---|
| `/api/admin/marketplace/listings` (`marketplaceAdminRoutes.js:32`) | GET | `authorizeRole(REVIEWER_ROLES)` | moderation queue | listing pipeline, `audience:'admin'` | — | retain | |
| `/api/admin/marketplace/listings/:id` (`marketplaceAdminRoutes.js:36`) | GET | `authorizeRole(REVIEWER_ROLES)` | detail, admin audience | `getMarketplaceListingDetail(..., {audience:'admin'})` (`marketplaceListingDetailService.js:88-99`) | — | retain | Deliberately bypasses only the public-status filter, keeping the fixture guard. Correct. |

---

## 3. Endpoints returning vehicle rows that do **not** go through `publicVehicleProjection.js`

Exhaustive, as required. Only `server.js:421`, `server.js:440` and the two passport routes consume the
canonical contract today (`server.js:100` is its **only** import in the repo).

**Via `PUBLIC_VEHICLE_COLUMNS`** (legacy list, `vehicleStatus.js:68` — a strict subset of `PUBLIC_VEHICLE_FIELDS`):
1. `GET /api/vehicles/:vin/recommendations` — `recommendationService.js:21`
2. `GET /api/vehicles/saved` — `server.js:1789` (embed; pinned by `db-compat-legacy-scopes.test.js:58`)

**Via `LISTING_SELECT_COLUMNS`** (marketplace list, `listingSummaryService.js:417-450` — adds `owner_id`, `tenant_id`, `plate_verified_at`, `tenant:tenants(...)`; omits `generation`, `trim`, `color`, `drivetrain`, `registration_authority`, `registration_status`):
3. `GET /api/marketplace/listings` — `listingSummaryService.js:492`
4. `GET /api/marketplace/listings/:id` — `marketplaceListingDetailService.js:82`
5. `GET /api/marketplace/recommendations` — `marketplaceDiscoveryService.js:70,76`
6. `POST /api/marketplace/compare` — via #4
7. `POST /api/marketplace/ai/price-estimate` — via #4 (`marketplaceRoutes.js:133`)
8. `GET /api/admin/marketplace/listings` and `/:id` — via the same pipeline

**Via raw `select('*')` on `vehicles`:**
9. `GET /api/vehicles/me` — `server.js:1771`
10. `GET /api/vehicles/inventory` — `server.js:1543`
11. `POST /api/insurance/quote` — `insuranceService.js:5` (derives price/year/mileage/currency into the response)
12. `POST /api/security/report-stolen` — `securityService.js:8`
13. `GET /api/vehicles/:vin/passport` — `server.js:527` reads `select('*')` **but** projects on output (`server.js:723`); the read is over-broad by design, which is the stated point of `toPublicVehicle`. Not a defect; listed for completeness.
14. `loadVehicleForEvidence` — `vehiclesRoutes.js:213` (internal scope check only; row not echoed)
15. `trustGraphService.js:293`, `documentIntelligenceService.js:329`, `insurerWorkflow.js:280` (internal derivation; rows not echoed)

**Via other ad-hoc selects that reach a response body:**
16. `GET /api/partner/v1/vehicles/:vin/identity` — `partnerApiRoutes.js:50,56`, inline allow-list including `plate_number`
17. `GET /api/vehicles/:vin/trust-decision` (+ `/full`, + partner `trust-summary`/`decision`/`fraud-summary`) — `trustDecisionService.js:302` selects `chassis_number, engine_number, plate_number, temp_plate_id, tenant_id`; values are not echoed, but `identityDimension` (`trustDecisionService.js:56-61`) publishes `present`/`missing` and `reason_codes: ['missing:chassis_number', ...]` through `toPublicDecision` — a **presence oracle** over private identifiers
18. `GET /api/vehicles/:vin/report` — `reportService.js:100,126` (`sel(supabase,'vehicles',...)` unbounded select, narrowed to vin/make/model/year on output)
19. `GET /api/evidence/review` — `vehiclesRoutes.js:594` embeds `vehicles(make, model, year, trust_score)`

**Non-vehicle rows returned raw that the contract already governs elsewhere:**
20. `GET /api/vehicles/:vin/evidence` — `vehiclesRoutes.js:489` `select('*')` on `vehicle_evidence`, no `toPublicEvidence`
21. `GET /api/vehicles/:vin/evidence/timeline` — `vehiclesRoutes.js:551` same
22. `GET /api/vehicles/:vin/evidence-sets` — `evidenceSetService.js:54` `select('*')`
23. `GET /api/security/check-stolen/:vin` — `securityService.js:33` `select('*')` on `stolen_vehicles`

---

## 4. Publication / status visibility gate — divergence matrix

The marketplace gate is `isPublicVehicleStatus(status) && isPubliclyVisiblePublication(publication_status) && !fixture`
(`listingSummaryService.js:403-409`), where publication must be exactly `'published'` (`vehicleStatus.js:46`).

| endpoint | status gate | publication gate | fixture gate |
|---|:--:|:--:|:--:|
| `/api/marketplace/listings`, `/listings/:id`, `/compare` | ✅ | ✅ | ✅ |
| `/api/marketplace/recommendations` — **candidates** | ✅ | ✅ | ✅ |
| `/api/marketplace/recommendations` — **anchor** (`marketplaceDiscoveryService.js:70`) | ❌ | ❌ | ❌ |
| `/api/vehicles/:vin/details` (`server.js:429`) | ✅ | ✅ | ❌ |
| `/api/vehicles` (`server.js:449-450`) | ✅ | ✅ | ❌ |
| `/api/vehicles/:vin/recommendations` — candidates (`recommendationService.js:25-26`) | ✅ | ✅ | ❌ |
| `/api/vehicles/:vin/recommendations` — anchor (`recommendationService.js:9`) | ❌ | ❌ | ❌ |
| `/api/vehicles/:vin/passport` | ❌ | ❌ | ❌ |
| `/api/vehicles/passport/lookup/:identifier` | ❌ | ❌ | ❌ |
| `/api/vehicles/:vin/report` | ❌ | ❌ | ❌ |
| `/api/vehicles/:vin/evidence`, `/evidence/timeline`, `/evidence-sets` | ❌ | ❌ | ❌ |
| `/api/vehicles/:vin/verify-ledger`, `/odometer-audit` | ❌ | ❌ | ❌ |
| `/api/security/check-stolen/:vin`, `/api/insurance/quote` | ❌ | ❌ | ❌ |
| `/api/partner/v1/vehicles/:vin/*` | ❌ | ❌ | ❌ |
| `/api/vehicles/saved` (embed) | ❌ | ❌ | ❌ |
| `/api/vehicles/:vin/reserve` | ❌ | ❌ | ❌ |

Consequence: `unpublish` (`vehiclesRoutes.js:180`) removes a vehicle from **one** of sixteen public read
paths. The passport, the report, the evidence endpoints and the lookup oracle all keep serving it.

---

## 5. Passport residue Phase 0 did not close

`buildVehiclePassport` allow-lists `details` for anonymous callers (`server.js:702-721`) but spreads the
event first (`server.js:694`), so two fields survive on the anonymous timeline:

- **`event.metadata`** — `evidenceToTimelineItem` sets `metadata: item.metadata || {}` (`evidenceService.js:312`). `vehicle_evidence.metadata` carries `ai_analysis` (risk scores, reviewer summaries). `/api/vehicles/:vin/evidence` strips it for non-admins (`vehiclesRoutes.js:517-527`); the passport does not.
- **`publicDescription` for evidence events** — `server.js:685-686` sets it from `event.desc`, which is `verification_notes` (`evidenceService.js:307`) — reviewer free text, published anonymously. This is the same class of escape the plate-number interpolation fix closed.

`evidenceVault` is correctly projected (`server.js:731`); only the timeline path leaks.

---

## 6. Top 5 convergence gaps

1. **Four Trust representations, three fabricated baselines, one cache treated as authority.**
   `vehicles.trust_score` is written by three independent writers — `trustGraphService.js:435`,
   `trustEnforcementEngine.js:158`, `documentIntelligenceService.js:382` (the last computing
   `Math.min(100, (vehicle.trust_score || 80) + 20)`, i.e. inventing 80 when unknown). Its DB default is
   `REAL DEFAULT 80.0` (`supabase_schema.sql:60`); `/api/vehicles/add` inserts `50` (`server.js:1456`);
   the marketplace reads the column and renders `numericValue(vehicle.trust_score)` → **0** when null
   (`listingSummaryService.js:244`, `:45`). Meanwhile the passport computes a live report
   (`trustGraphService.js:424`), the listing detail builds a badge-based `trust_summary`
   (`marketplaceTrustSummaryService.js:88`), and `/trust-decision` returns a dimensional decision. Four
   answers to "how trustworthy is this vehicle", and the persisted cache is the one the public sees.
   Direct breach of principles 2 and 4.

2. **The evidence endpoints are the pre-Phase-0 passport, still live.**
   `vehiclesRoutes.js:437` decides its audience from unverified `x-user-id`/`x-tenant-id` headers and
   returns `select('*')` evidence rows; `vehiclesRoutes.js:536` is anonymous and emits
   `details.uploadedBy` and reviewer `verification_notes`. `toPublicEvidence` and `optionalAuth()` already
   exist and are already used by the passport. This is the single highest-severity Phase 1 item.

3. **Publication state governs one read path out of sixteen.** See §4. The passport, the report, the
   lookup oracle, evidence, ledger, odometer, partner identity and saved-vehicle embeds all serve draft
   and quarantined vehicles. `unpublish` is advertised to sellers as removal from public view and is not.

4. **Three vehicle column allow-lists plus six raw `select('*')`.** `PUBLIC_VEHICLE_FIELDS`
   (`publicVehicleProjection.js:37`), `PUBLIC_VEHICLE_COLUMNS` (`vehicleStatus.js:68`) and
   `LISTING_SELECT_COLUMNS` (`listingSummaryService.js:417`) each define "public vehicle" differently.
   Adding a column to `vehicles` still widens the surface through the two non-canonical lists and through
   `/api/vehicles/me` and `/api/vehicles/inventory` — the exact regression the contract was created to
   make impossible.

5. **Location has no canonical source, so every layer invents one.** `vehicles` has no location column
   (`supabase_schema.sql:44-64`); `/api/vehicles/add` accepts `location` and `province` and discards them
   (`server.js:1432`); the summary emits the constant `location: 'Zimbabwe'`
   (`listingSummaryService.js:259`); the detail emits `location: … || 'Zimbabwe'` and `country: 'ZW'`
   (`marketplaceListingDetailService.js:39-40`); parts/services default the same way
   (`marketplacePartsService.js:33,43`). Phase 0 removed these strings from the frontend; the backend
   still manufactures them. Principle 4 and principle 5 both.

Runner-up (named in the brief, correctly *not* a leak): **`partnerApiRoutes.js:50,56` returns `plate_number`
behind `requirePartnerScope('vehicle:identity')`**. Governed and audited, so not a privacy defect — but it
is a fourth audience the canonical contract does not name, expressed as a fourth inline allow-list. Phase 1
should add a `partner` audience to `publicVehicleProjection.js` and have the route consume it, so the
partner surface widens only when the contract says so.

---

## 7. Proposed canonical public read contract (proposal only — do not implement)

One shape, `PublicVehicleView.v1`, served by the marketplace list (summary subset) and detail (full),
consumed by the passport's `vehicle` block and by `/api/vehicles/:vin/details`. Audiences:
`public` | `partner` | `owner` | `reviewer`, resolved server-side, never from a header claim.

**Unknown convention.** Every group that can be unrecorded carries a sibling state enum rather than a
sentinel value:

```
"<group>_state": "recorded" | "not_recorded" | "withheld" | "not_applicable"
```

`recorded` ⇒ the value field is populated. `not_recorded` ⇒ nothing exists upstream. `withheld` ⇒ a value
exists but this audience may not see it. A `null` value alone is never sufficient — Phase 0 already
established this pattern with `identity.identifiersRedacted` (`server.js:753`) and
`ownershipSummary.currentSellerRecorded` (`server.js:595`); this generalises it. No field may fall back
to a plausible default at any layer.

| # | field group | canonical source | public representation | explicit unknown state |
|---|---|---|---|---|
| 1 | **identity** | `vehicles.vin` (PK); `make`, `model`, `year` NOT NULL; `generation`, `trim`, `color` nullable | `{ vin, make, model, year, generation, trim, color }`. Registry identifiers (`plate_number`, `normalized_plate_number`, `chassis_number`, `engine_number`, `temporary_identification_number`) are **never** in the `public` audience; `partner` gets `plate_number` only under `vehicle:identity`; `owner` gets the `OWNER_ADDITIONAL_VEHICLE_FIELDS` set | `generation`/`trim`/`color` → `null` + `identity_detail_state`. `identifier_state: 'withheld' \| 'not_recorded'` distinguishes "we have a plate you may not see" from "no plate recorded" — never collapse them. **Deletes** `color \|\| 'White'`, `generation: ''`, `trim: ''` at `server.js:1451-1452` |
| 2 | **listing / publication** | `vehicles.publication_status` (NOT NULL DEFAULT `'draft'`, lifecycle `20260624140000`) + `vehicles.status` via `normalizeVehicleStatus` | `{ publication_status: 'published', availability: 'available' \| 'reserved' }`. A public view exists **only** when `publication_status === 'published'` and `isPublicVehicleStatus(status)` — the gate is a precondition of the projection, not a filter applied afterwards by each caller | Not representable as unknown: a vehicle without a resolvable public publication state has **no public view**. Removes `status: vehicle.status \|\| 'Available'` (`listingSummaryService.js:241`), which currently manufactures availability for a row whose status is null |
| 3 | **public seller** | `vehicles.current_seller_type`, `vehicles.public_seller_display_enabled`, `tenants.name` (dealer only), `dealerComplianceService.getBuyerSafeSummary` | `{ seller_type: 'dealer' \| 'private' \| null, display_label: string \| null, public_profile_enabled: bool, verified_dealer: bool }`. Never `current_seller_id`, never `users.name` unless `public_seller_display_enabled` | `seller_state: 'recorded' \| 'not_recorded' \| 'withheld'`. **Deletes** `'Verified dealer'` and `'Private seller'` (`listingSummaryService.js:101,108`): a label is a claim, and `'Verified dealer'` claims verification the row never asserted. Absent seller ⇒ `display_label: null, seller_state: 'not_recorded'` |
| 4 | **location** | **Does not exist.** No column on `vehicles` (`supabase_schema.sql:44-64`); the write path discards the seller's input (`server.js:1432`) | `{ location: null, country: null }` until a real column and write path exist. Phase 1 must **not** substitute `registration_country` — where a car is registered is not where it is for sale | `location_state: 'not_recorded'` on every listing, unconditionally, until the column ships. **Deletes** `listingSummaryService.js:259`, `marketplaceListingDetailService.js:39-40`, `marketplacePartsService.js:33,43`. Rendering "location unknown" is the correct, honest state; "Zimbabwe" is a fabricated fact |
| 5 | **price / currency** | `vehicles.price` (NOT NULL), `vehicles.currency` (nullable, DB default `'USD'`) | `{ price: number, currency: string \| null, price_mode: 'listed' \| 'quote_required' }` | `price` is NOT NULL so it is always present; **`numericValue(vehicle.price)` (`listingSummaryService.js:236`) must stop coercing null → 0**, because a free car and an unpriced car must not render identically. `currency: null` + `currency_state: 'not_recorded'` replaces `\|\| 'USD'` (`:237`) — pricing a Zimbabwe listing in an assumed currency is a material fabrication |
| 6 | **specifications** | `vehicles.mileage` (NOT NULL), `fuel_type`, `drivetrain`, `transmission`, `vehicle_condition_category` | `{ mileage, fuel_type, drivetrain, transmission, condition_category }` | Each nullable field → `null` + a per-field entry in `specification_state`. `condition_category` already has the right precedent: `deriveConditionCategory` returns the literal `'unknown'` (`listingSummaryService.js:89`). **Deletes** `fuel_type \|\| 'Petrol'`, `drivetrain: 'RWD'`, `transmission \|\| 'Automatic'`, `mileage \|\| 0` at `server.js:1452-1453` — `mileage: 0` on an unknown odometer is the strongest possible false claim about a used car |
| 7 | **listing media** | `listing_images` (`vin`, `image_url`, `is_primary`, `display_order`) | `{ media: [{ url, type: 'image', is_primary }], primary_image_url }` — **explicitly typed as seller-supplied, never as evidence** (principle 6). The field name must carry the distinction: `listing_media`, never `photos` or `images` alongside evidence | `media: []` + `media_state: 'not_recorded'`. Empty must never fall back to an evidence `file_url` or a stock image. `primary_image_url: null` is a valid, renderable state |
| 8 | **verification / facts** | `vehicle_evidence` (verified + `visibility_level='public_safe'`) and the boolean fact columns `duty_paid`, `police_verified`, `zimra_verified`, `passport_verified` | `{ facts: { duty_paid: {value, state, evidence_count}, police_verified: {...}, … }, evidence_count, evidence_status }`. Provenance before claims (principle 3): a fact is public only with a countable governed source behind it | **This is the sharpest change.** The columns are `BOOLEAN DEFAULT FALSE` (`supabase_schema.sql:57-58`) and `/api/vehicles/add` writes `false` explicitly (`server.js:1455`), so today "no evidence yet" and "checked, and it failed" are the same byte. The contract must be **tri-state**: `state: 'verified' \| 'not_verified' \| 'unknown'`, where `unknown` is the default for an unevaluated vehicle. Absence of a verification is not proof of its negative (principle 9) |
| 9 | **Trust** | The dimensional decision (`trustDecisionService.assembleDecision`) is the **single authority**. `vehicles.trust_score` is a **cache with no authority** and must not appear in any public body | `{ trust: { overall: {status, value} \| null, dimensions: {...}, calculation_version, evaluated_at } }` — dimensions preserved, never collapsed to one number (principle 2) | `trust_state: 'scored' \| 'not_scored'`; when `not_scored`, `overall` is `null` and the UI renders "not yet scored", not `0` and not `50`. **Deletes** `numericValue(vehicle.trust_score)` → 0 (`listingSummaryService.js:244`), the `trust_score: 50` insert (`server.js:1456`), the `\|\| 80` fallback (`documentIntelligenceService.js:370,382`); the `REAL DEFAULT 80.0` column default (`supabase_schema.sql:60`) is a Phase 2 migration. `identityDimension`'s `present`/`missing` arrays and `missing:chassis_number` reason codes must move to `visibility: PRIVATE` — they are a presence oracle over `PRIVATE_VEHICLE_FIELDS` |
| 10 | **transaction readiness** | Server-authoritative only (principle 7): the escrow session state machine (`escrowTrustService`) + `eligibilityService` statuses + `vehicles.safe_pay_ready`, `inspection_ready` | `{ transaction: { payment_readiness: 'inquiry_only' \| 'escrow_available' \| 'not_ready', escrow_required: true, deposit_allowed: bool, operator_review_required: bool, fraud_hold: 'none' \| 'hold' } }`. The client may never compute or override any of these | `readiness_state: 'evaluated' \| 'not_evaluated'`. Today `buildTransactionIntent` (`marketplaceListingDetailService.js:63-73`) returns hardcoded constants and `transaction_intent_id: null` for every listing — a plausible default standing in for an unevaluated state. `not_evaluated` must be distinguishable from `not_ready` |

---

## 8. Smallest correct change set for Phase 1 — ordered by risk (lowest first)

Each step is independently shippable and independently verifiable against the three gates.

**S1 — Close the evidence audience defect (highest severity, lowest blast radius).**
`vehiclesRoutes.js:437` — replace the hand-rolled header block (`:441-481`) with `optionalAuth()` and the
same `PASSPORT_PRIVILEGED_ROLES` / `owner_id` rule the passport uses (`server.js:517,536-540`). Project
anonymous rows through `toPublicEvidence`. Do the same at `vehiclesRoutes.js:536`.
*Risk:* low — `toPublicEvidence` already exists and is exercised by 32 passing Phase 0 assertions.
*Verify:* extend `issue164-phase0-public-projection.test.js` with `findPrivateFieldLeaks` over both bodies.

**S2 — Stop the passport timeline leaking evidence payload.**
`server.js:694-721` — drop `metadata` for the unauthorized audience alongside `details`, and set the
evidence branch's `publicDescription` (`:679`) from `evidence_type` rather than `event.desc`
(`verification_notes`).
*Risk:* low — one branch, already inside the Phase 0 sanitizer.

**S3 — Delete the write-path fabrications.**
`server.js:1450-1472` — `color`, `mileage`, `fuel_type`, `drivetrain`, `transmission`, `generation`,
`trim`, `currency` become `null` when absent; `trust_score` is omitted from the insert entirely (never
`50`); `duty_paid`/`police_verified` are omitted so they are not asserted as `false`.
*Risk:* medium — `marketplaceListingEligibility` may currently rely on populated fields; check
`buildVehicleListingCandidate` before removing. This is the root cause of most of §7's read-side symptoms:
fix the writer first, then the readers have real nulls to represent.

**S4 — Delete the read-path fabricated defaults.**
`listingSummaryService.js:236,237,241,244,259` and `marketplaceListingDetailService.js:39-40` and
`marketplacePartsService.js:26,29,33,41,43,44`. Emit `null` plus the `*_state` sibling from §7.
*Risk:* medium — `shared/types/marketplace.ts` and every `web/src` consumer of
`MarketplaceListingSummary` must accept `null`. Land the type change and the frontend null-handling in the
same commit; `web/src/pages/Marketplace.tsx:151` already documents the posture.

**S5 — Apply the marketplace visibility gate to the remaining public reads.**
`buildVehiclePassport` (`server.js:523`), `collectPassportLookupMatches` (`server.js:490` — filter matches
to publicly visible vehicles **before** counting, so 404/409/200 stops confirming identifiers),
`assembleReport` caller (`reportRoutes.js:20`), the three evidence endpoints, `verify-ledger`,
`odometer-audit`, `check-stolen`, the two recommendation anchors
(`recommendationService.js:9`, `marketplaceDiscoveryService.js:70`), and the `/api/vehicles/saved` embed
(`server.js:1789`).
*Risk:* medium-high — this changes what authenticated owners see of their own draft vehicles. The gate
must be audience-aware: `owner`/`admin` keep access to their drafts; only the `public` audience is gated.

**S6 — Collapse the three vehicle allow-lists into one.**
Point `recommendationService.js:21` and `server.js:1789` at `PUBLIC_VEHICLE_SELECT`; point
`server.js:1771` (`/vehicles/me`) and `server.js:1543` (`/vehicles/inventory`) at `OWNER_VEHICLE_SELECT`;
fold `LISTING_SELECT_COLUMNS` into `PUBLIC_VEHICLE_SELECT` plus an explicit
`INTERNAL_LISTING_FILTER_COLUMNS = ['owner_id','tenant_id']` so the fixture-filter columns stay visibly
separate from the projection. Then delete `PUBLIC_VEHICLE_COLUMNS` from `vehicleStatus.js:68`.
*Risk:* high — **`backend/tests/db-compat-legacy-scopes.test.js:58` pins the literal string
`vehicles(${PUBLIC_VEHICLE_COLUMNS})`** and must be edited in the same commit. Keep and strengthen the
`:62` assertion (`!section.includes('vehicles(*)')`), and add the equivalent for `/vehicles/me` and
`/vehicles/inventory`, which currently have no such pin. Note `PUBLIC_VEHICLE_COLUMNS ⊂
PUBLIC_VEHICLE_FIELDS`, so the convergence is a widening of 7 already-public fields, not a narrowing —
verify no consumer depends on their absence.

**S7 — Name the `partner` audience in the contract.**
Add `PARTNER_ADDITIONAL_VEHICLE_FIELDS = ['plate_number']` and `'partner'` to `projectVehicle`
(`publicVehicleProjection.js:181`); have `partnerApiRoutes.js:48-56` consume it instead of its inline
list. No behaviour change — it moves the decision from route code into the governed contract.
*Risk:* low, but sequence it after S6 so there is one list to extend.

**S8 — Retire the duplicates.**
Delete `/api/partner/v1/vehicles/:vin/decision` (`partnerApiRoutes.js:85`, exact duplicate of `:60`).
Mark `/api/vehicles` (`server.js:440`), `/api/vehicles/:vin/recommendations` (`server.js:1093`) and
`/api/insurance/quote` (`server.js:1039`) deprecated with a removal target; front them onto the
marketplace pipeline or gate them to authenticated callers.
*Risk:* high — requires a frontend consumer audit first (`web/src/hooks/useCarUpApi.ts`). Doing this last
means every remaining caller is already reading the converged shape.

---

## 9. Explicitly **not** Phase 1

| item | phase | why |
|---|---|---|
| Migration to drop `vehicles.trust_score REAL DEFAULT 80.0` and make the cache nullable (`supabase_schema.sql:60`); reconciling the three writers (`trustGraphService.js:435`, `trustEnforcementEngine.js:158`, `documentIntelligenceService.js:382`) onto one | **2** | Schema + backfill + RLS. Phase 1 stops *publishing* the cache; Phase 2 fixes the cache. |
| Adding a real `location`/`city`/`province` column, its write path, and a backfill | **2** | Phase 1's obligation is only to stop fabricating it. |
| Tri-state migration of `duty_paid`/`police_verified`/`zimra_verified`/`passport_verified` from `BOOLEAN DEFAULT FALSE` to a nullable/enum fact model | **2** | Column-type change on a live table. Phase 1 can represent the tri-state in the response from evidence counts without touching the columns. |
| Collapsing the two escrow engines (`safepay_escrows` vs `escrowTrustService` sessions) and wiring `transaction_intent` to real state | **3** | Transaction-state consolidation with money semantics; needs its own reconciliation and a data migration. |
| Merging `saved_vehicles` with `marketplaceSavedService`'s store | **3** | Two user-data tables; needs a migration and a dedup pass. |
| Unifying the four seller representations (`sellerSummaryForVehicle`, `getBuyerSafeSummary`, `calculateDealerReputation`, `/api/reputation/:dealerId`) behind one seller-truth service | **3** | Cross-domain; Phase 1 only stops the fabricated labels. |
| Parts & garage inventory backend (`marketplacePartsService.js` returns governed-empty by design) | **5** | No inventory exists; Phase 1 fixes only the default-bearing card shape. |
| Deleting `/api/vehicles`, `/api/vehicles/:vin/recommendations`, `/api/insurance/quote` outright, and the `/details` ↔ `/listings/:id` merge | **5** | Public contract removal — needs a deprecation window and a frontend migration. |
| Permanent leak-invariant CI suite over **every** public route body (generalising `findPrivateFieldLeaks`, `publicVehicleProjection.js:190`) | **6** | Belongs with the closure gate, once the surface has stopped moving. |
| Frontend removal of any remaining client-side business-truth derivation (principle 5) beyond null-handling for S4 | **6** | Depends on the final contract shape. |

---

## 10. Verification note

This document is analysis only; no source file was modified, so the three gates are unchanged from the
`c662d1a4` baseline: `npx tsc -b --force` exit 0 · `npx vitest run` 812 passed / 91 files ·
`node --test backend/tests/issue164-phase0-public-projection.test.js` 32 passed.
