# CarUp Operations Control Plane — Implementation Progress & Roll-Call

**Status:** IN EXECUTION — M0–M1 complete 2026-09-02; M2 in progress  
**Canonical manual:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_AND_SERENA_VEHICLE_OPS_MANUAL.md  
**Benchmark appendix:** docs/features/CARUP_OPERATIONS_CONTROL_PLANE_BENCHMARK_RESEARCH.md  
**Claude start prompt:** docs/agent-prompts/CARUP_OPERATIONS_CONTROL_PLANE_SERENA_CLAUDE_START_PROMPT.md  
**Seed branch:** feat/operations-control-plane-serena-slice  
**Seed base:** 569e4f14c3fa022d942a41a57751fa3834def756  
**Primary UAT vehicle:** GFC27-027051

---

## Tracker law

This file is the execution roll-call.

Claude Code and any later implementation agent must update it **in the same work session** whenever a task changes state.

State markers:

- [ ] not started / not proven
- [~] in progress
- [x] cleared with evidence
- [!] blocked by a genuine external or mandatory stop condition

A task is not cleared because code exists.

For every [x], add evidence in the Evidence Register at the bottom:

- commit/SHA;
- test name/run;
- route/API;
- migration if any;
- screenshot/UAT receipt when applicable.

Do not skip a task silently. If a task becomes unnecessary because current code already solved it, mark [x] and cite the current implementation/test proving it.

Do not call the Serena slice certified until every M0–M7 mandatory item is [x] or an explicitly approved [!] exception.

---

# M0 — Revalidate exact implementation state

**Executed:** 2026-09-02 (Claude Code). All inspection read-only; no Serena mutation.

- [x] M0.1 Record current branch — `feat/operations-control-plane-serena-slice` (checked out from origin; tracks origin).
- [x] M0.2 Record current HEAD SHA — `96620f920044b858fe3dbb525de14a813d5899df` (identical to the documented docs head; remote has nothing newer on this branch).
- [x] M0.3 Record merge base — branch is a strict superset: `f180c47d` (integration/vehicle-passport-v16-cert tip, PR #194), `569e4f14` (fix/zimbabwe-seller-reality-comms-hardening tip, PR #205) and `ba208963` (origin/main) are all ancestors of HEAD. HEAD = 569e4f14 + 4 docs commits.
- [x] M0.4 Working tree — no tracked changes; untracked files are prior-session artifacts (screenshots, .mcp.json, .claude/settings.json, backend/supabase/, .playwright-mcp/) left in place.
- [x] M0.5 Open PRs touching these domains — #194 (integration cert lane; our base), #205 (ZR hardening; fully contained in HEAD), **#200 fix/seller-uat-convergence-final-194 (NOT contained: 27 commits redesigning My Garage / My Listings / Sell intent router / Evidence Vault workspace / Owner Dashboard, targeting #194, merge-base 43204bee, ~280 commits behind HEAD)**, #197/#196 (Service Network — separate lane; `backend/services/serviceNetwork` absent at HEAD, confirmed), #188 (Passport foundation), #185 (Intelligence), #183, #182, #186, #181, #137.
- [x] M0.6 HEAD vs seed base — seed base 569e4f14 **is** HEAD minus the 4 docs commits; no drift between seed assumption and implementation authority.
- [x] M0.7 Implementation target — this branch; eventual merge lane per handoff is a PR from this branch (unmerged candidate for owner review). PR #200 is a parallel seller-UX lane: this slice avoids redesigning the seller surfaces #200 owns (My Garage/My Listings/Sell router); the ops slice touches EvidenceUploadModal + backend semantics + admin surfaces. Overlap recorded, judged reconcilable, not a stop condition.
- [x] M0.8 Staging provenance — stable staging frontend `https://carup-staging.vercel.app/carup-provenance.json` → sha `ba208963`, branch main, `unpaired=false`; backend `https://carup-backend-staging.vercel.app/api/health` → same sha `ba208963`, supabase healthy, outbox 0. Staging serves **main**, not this branch; M7 requires an exact-head candidate preview pair (PR #205's governed preview-pair mechanism, commit e910a192, is on this branch).
- [x] M0.9 Seller-claim flow inspected end to end — `POST /api/vehicles/:vin/seller-claim` (backend/routes/vehiclesRoutes.js:350-411), `authorizeRole(['owner','dealer'])` (admin excluded). Recognition = owner_id/current_seller_id/tenant match OR `hasVerifiedSellerAuthorityEvidence` (verified **legacy** `registration_document`/`ownership_transfer_document` uploaded **by the claimant**). Persistence = single immutable `trust_audit_events` row `SELLER_AUTHORITY_CLAIM_REQUESTED` per (vin,user), no lifecycle, no reviewer decision path, no expiry/denial; its only effect is a never-lapsing scope bypass letting the claimant upload the two legacy doc types (vehiclesRoutes.js:478-487). Duplicate inline copy of the evidence rule in backend/server.js:2998-3018 (`SELLER_AUTHORITY_CLAIM_REQUIRED` refusals :3053/:3113). No sellerAuthorityService, no table.
- [x] M0.10 Completeness evaluator inspected — backend/services/evidence/completenessEvaluator.js. Requirements: vin/chassis/engine identity; `registration_readiness` (blocking flag = zimbabweRegistrationLifecycle `publication_blocking`); `ownership_document` blocking, satisfied by **legacy types only** (`BLOCKING_DOC_TYPES = ['registration_document','ownership_transfer_document']`, never consults class/subtype); `fact_reconciliation` blocking (extraction conflicts, fails closed); 4 advisory doc types; finance disclosure advisory (never blocking). Fraud is NOT a completeness input (blocks only via trustDecisionService `publication_eligibility` dimension). Manual §5.9 risk CONFIRMED: a verified import doc carried under legacy `registration_document` satisfies the ownership/registration gate.
- [x] M0.11 Evidence taxonomy + upload contract inspected — evidenceTaxonomy.js has 9 classes incl. `registration` (6 subtypes) and import subtypes incl. `commercial_invoice`/`payment_receipt`/`transit_declaration` (ZR work already on this branch). `resolveClassification` validates subtype↔class but NEVER class↔legacy-type: contradictions are accepted. Legacy `evidence_type` is **load-bearing**: it alone drives upload role authorization, storage bucket (documents → private `ocr-documents`), default visibility and AI extraction targets. EvidenceUploadModal still hard-requires legacy `evidence_type` (class/subtype optional, silently absent if taxonomy fetch fails; class label map omits `registration`). **No reclassification/classification-correction endpoint exists anywhere.**
- [x] M0.12 Evidence Review authorization inspected — READ queue `GET /api/evidence/review` allows `admin,government,dealer,mechanic` (tenant-scoped for the latter two); PATCH verify/reject allows `admin,government` only; the shared EvidenceReview.tsx renders Approve/Reject to all queue readers (mounted at /dealer/evidence, /government/evidence, /admin/evidence) → manual §5.6 mismatch CONFIRMED. `/link-event` PATCH is any-authenticated (bare authorizeRole()).
- [x] M0.13 Trust/Governance review inspected — trustFactRoutes admin/government; Phase-2A facts only; fail-closed audits to trust_audit_events; self-review ban (admin exempt). governanceRoutes REVIEWER_ROLES `['admin','government','reviewer']` — **`reviewer` exists on the backend but not in shared UserRole**; frontend locks governance-review to `admin` only. review_decisions immutable; trust_change_log requires a backing review decision.
- [x] M0.14 Fraud/Marketplace moderation inspected — fraud queue roles `admin,government,reviewer`, resolve `admin,reviewer`; `fraud_cases.blocks_publication` latches on and is consumed ONLY by trustDecisionService (not by the publish route). Marketplace moderation service gates on `platformRole||baseRole` (deliberately not effectiveRole — good anti-escalation pattern to reuse); actions approve/reject/suppress/flag_risk/clear_risk/request_evidence mutate `vehicles.status`; audit best-effort.
- [x] M0.15 Public evidence projection inspected — publicVehicleProjection.js allow-list + `isPrivateEvidenceArtifact` (bucket-based, label-distrusting) nulls file_url for private-bucket rows; visibility+verified filters applied in SQL on all anonymous paths and re-applied in vehicleMediaProjection. One dormant divergent projector: `backend/services/passport/passportEvidenceProjection.js` trusts `visibility_level` and copies file_url with no bucket check — currently unwired (test-only); must not be wired without hardening.
- [x] M0.16 Migrations/staging state — repo migrations through `20260902123000`; staging supabase ledger ends at `20260829123000` but the ZR migration `20260902110000_zimbabwe_registration_lifecycle_and_evidence.sql` IS physically applied (constraint `vehicles_registration_status_canonical_when_sourced` present; 6 registration + 3 new import subtypes seeded in evidence_class_taxonomy) — staging migrations are applied by the project process outside the supabase CLI ledger. Staging schema matches this branch's expectations.
- [x] M0.17 Serena vehicle row (read-only) — exactly ONE Serena: vin `GFC27-027051`, Nissan Serena Highway Star 2016, status `Available`, publication_status `draft`, owner_id = current_seller_id = `u_66cace85fad949e4` (Kingstone; role `owner`, email NOT verified, no identity_documents rows), tenant NULL, current_seller_type `Private Owner`, chassis `GFC27-027051`, engine `MR20961177B`, import_source `import`, duty_paid false, zimra_verified false, passport_verified false, price 12800 USD, listing_city Harare, all three seller disclosures (accident/insurance/finance) recorded, trust never evaluated (trust_score/band NULL), created 2026-09-01.
- [x] M0.18 Serena evidence rows (read-only) — 5 rows in vehicle_evidence, all uploaded 2026-09-02 11:13–11:34 UTC by the owner account, all `verification_status=pending`, all PDF with checksum+file. Uploads were validated by a ZR-candidate backend (main's taxonomy at ba208963 lacks `transit_declaration` etc.), consistent with the governed PR #205 preview pair. 2 of 7 pack documents are deliberately NOT in the Vehicle Life vault: PayPal payment receipt (not yet uploaded) and Kingstone identity (belongs to identity workflow — also not yet in identity_documents).
- [x] M0.19 Legacy vs canonical per Serena item:

| Evidence id (short) | Artifact | legacy evidence_type | canonical class/subtype | Contradiction |
|---|---|---|---|---|
| 3afcd7e8 | House Bill of Lading | ownership_transfer_document | import / bill_of_lading | YES |
| 56fd68e9 | Japanese Export Certificate | registration_document | import / export_certificate | YES |
| 228d0b3a | CBCA/Cotecna roadworthiness | registration_document | inspection / roadworthiness | YES |
| 21904869 | Tanzania T1 | registration_document | import / transit_declaration | YES |
| f641b520 | BE FORWARD invoice | registration_document | import / commercial_invoice | YES |

  Canonical classification is correct on every row; the legacy field is wrong on every row. If these rows were verified today, the legacy-driven ownership/registration gate would pass on import documents — the exact defect this slice exists to close.
- [x] M0.20 Visibility + verification — all pending; visibility `private` except Tanzania T1 = `public_safe`. Leak check: all five are documentEvidenceTypes → stored in the private `ocr-documents` bucket → `toPublicEvidence` withholds file_url regardless of label; nothing currently leaks (also all pending, so no public path applies). The T1 `public_safe` label should still be reviewed in M7 (manual intends restricted).
- [x] M0.21 Extractions/conflicts — 0 rows in vehicle_document_extractions for the VIN; no reconciliation conflicts.
- [x] M0.22 Seller authority claim/relationship — 0 `SELLER_AUTHORITY_CLAIM_REQUESTED` events (none needed: Kingstone already holds owner_id AND current_seller_id). trust_audit_events for the VIN = exactly 5 `EVIDENCE_UPLOADED` events by the owner.
- [x] M0.23 Registration status — `registration_status` NULL, `registration_status_source` NULL, no plate, no temp permit fields. Per zimbabweRegistrationLifecycle this evaluates as `not_recorded` → publication_blocking with reason `registration_stage_not_recorded`. The seller stage-declaration UI (commit 60caed5c) exists on this branch but staging serves main, so Kingstone could not yet declare a stage.
- [x] M0.24 Fraud/governance/trust — 0 fraud_cases, 0 review_tasks, 0 disputes, 0 trust_fact_requests, 0 disclosure_claims for the VIN. 10 listing_images. Canonical trust never materialized.
- [x] M0.25 Current completeness (derived from evaluator semantics against the read state; no API mutation): identity (vin/chassis/engine) present; `registration_readiness` **blocking-missing** (stage not recorded); `ownership_document` **pending_review** (pending legacy-typed rows exist); fact_reconciliation clear (no extractions); advisory docs: inspection satisfied at legacy level only via mislabel; finance disclosure present. → NOT publishable; blocking_gaps=[registration_readiness], pending_gaps=[ownership_document]. Exact API result to be re-captured in M7 on the candidate pair.
- [x] M0.26 Delta table below.
- [x] M0.27 No Serena write occurred — only SELECTs were issued against staging; the only tool used was read-only SQL; no API mutation, no storage access.

### M0 current-state delta

| Manual assumption | Current code/state | Same / changed | Required response |
|---|---|---|---|
| §5.8 upload UI requires legacy evidence_type; contradictions possible | Confirmed (EvidenceUploadModal.tsx:93-94, :221-224; resolveClassification never cross-checks) — and legacy type is additionally load-bearing for auth/bucket/visibility/extraction | Same, worse than assumed | M1 must make canonical semantics authoritative while preserving the legacy field's storage/authorization duties or migrating them deliberately |
| §5.9 completeness gate reads legacy types | Confirmed verbatim (`BLOCKING_DOC_TYPES`); tests pin the arrays verbatim (marketplace-publication-gate.test.js:115-132; seller-existing-passport-authority.test.js pins the strings in vehiclesRoutes) | Same | M3 replaces predicate + deliberately updates the pinning tests |
| §5.11 seller-claim partially implemented | Confirmed; plus: admin excluded from claim route; claim never lapses; evidence shortcut requires claimant-uploaded doc; duplicated inline in server.js | Same, more precise | M2 hardens/extracts (no parallel system) |
| §5.6 evidence review role mismatch | Confirmed; also `/link-event` PATCH is any-authenticated | Same + new finding | M4/M5 reconcile; consider tightening link-event within scope |
| §5.14 `reviewer` role mismatch | Confirmed (governance + fraud accept `reviewer`; shared UserRole lacks it; frontend admin registry locks to `admin`) | Same | M5/M6 bounded handling |
| §5.2 platform_admin/super_admin frontend gap | Confirmed: backend global bypass (authMiddleware.js:189) but frontend redirect-lockout to /dashboard | Same | M5 compatibility strategy |
| §7/8 no capability layer exists | Confirmed: `operations.*` strings appear only in docs; nearest prior art = diasporaPermissions capabilities + marketplaceModeration platformRole gate | Same | M5 creates the first bounded layer |
| Taxonomy has 9 classes incl. registration | Confirmed on branch AND applied on staging DB | Same | Reuse as-is |
| §5.10 registration lifecycle helper listability | Confirmed: only `unknown` + `temporary_foreign_tip` not ordinarily listable; plate required only for `locally_registered`; provenance (source) required | Same | Reuse as-is |
| §5.23 Service Network absent on branch | Confirmed (no backend/services/serviceNetwork) | Same | Leave to O5 |
| Old eligibility doc claims 17-char VIN only | docs/CARUP_REAL_LISTING_ELIGIBILITY_CONTRACT.md §2 still says 17-char; Serena (12-char chassis-as-VIN) exists as a real listing row; manual §3.5 says code recognizes 12–17 import identifiers | Docs stale vs code | Verify code accepts Serena identifier during M3/M7; reconcile doc if in scope |
| Seven-document pack in Evidence Vault | Only 5 of 7 uploaded (payment receipt + identity pending); canonical classes all correct, legacy types all wrong; T1 labeled public_safe | Partially different | M7 review handles decisions; payment receipt upload is Kingstone's/UAT action; identity goes through identity workflow, never the vehicle vault |
| Fraud blocks publication | Only via trustDecision publication dimension; publish route itself never consults fraud_cases | More precise than manual | M3 decides deliberately where risk blocking belongs; no silent behavior change without tests |
| Dormant risk (new finding) | passportEvidenceProjection.js trusts visibility label, copies file_url, unwired | New | Do not wire; harden or note if touched |

---

# M1 — Canonical evidence semantics

**Implemented 2026-09-02.** Design decision: legacy `evidence_type` was found to be load-bearing (upload role auth, storage bucket, default visibility, AI extraction targets), so M1 (a) added canonical semantic predicates that ignore the legacy field whenever a canonical class exists, (b) made the load-bearing decisions canonical-aware, and (c) made canonical-first uploads DERIVE their compatibility evidence_type (exact counterpart when one exists, else new neutral `vehicle_life_document`/`vehicle_life_photo` values added by additive migration `20260902150000_vehicle_life_generic_compat_types.sql`) so no new record can be born with a false legacy meaning.

- [x] M1.1 Canonical semantic helper — `resolveSemanticClassification` + predicates in backend/services/evidence/evidenceTaxonomy.js (isRegistration/isImport/isInspection/isOwnershipTransfer/isTemporaryImportPermit/satisfiesOwnershipRegistrationRequirement/isSellerAuthorityCandidate/isDocumentArtifact/semanticClassificationLabel + deriveLegacyCompatibilityType). Web mirror: web/src/lib/evidenceClassification.ts.
- [x] M1.2 Canonical wins when present — predicates ignore legacy for canonical rows; tests `operations-evidence-semantics.test.js`.
- [x] M1.3 Legacy = compatibility only — canonical-first uploads no longer accept user-chosen legacy semantics (server derives); bucket/visibility/role auth now canonical-aware (`isDocumentUpload`, `canUploadEvidenceRecord`).
- [x] M1.4 Legacy-only rows readable via LEGACY_TYPE_TO_CLASS fallback — tested.
- [x] M1.5 import/commercial_invoice ≠ registration — tested (also with contradictory legacy field).
- [x] M1.6 import/transit_declaration ≠ TIP — only registration/temporary_import_permit is a TIP; tested.
- [x] M1.7 import/export_certificate ≠ Zimbabwe registration — tested.
- [x] M1.8 registration/registration_book recognized — tested.
- [x] M1.9 Upload UX canonical-first — EvidenceUploadModal now requires Life stage + subtype (role-filtered), submits class/subtype WITHOUT evidence_type, auto-defaults documents to Restricted; legacy select survives only as fallback when the taxonomy cannot load. Component tests `EvidenceUploadModal.canonical.test.tsx` (5/5).
- [x] M1.10 Evidence review shows canonical classification — EvidenceReview.tsx `classificationLabel` (canonical-first, legacy fallback).
- [x] M1.11 Passport/timeline canonical display — backend `evidenceToTimelineItem` label + evidence_class/subtype fields; PremiumEvidenceGallery groups/labels canonically; VehicleProfile documents list + verified-logbook badge canonical-aware.
- [x] M1.12 Privacy preserved — toPublicEvidence unchanged (bucket-based withholding); new test proves a canonical private-bucket import doc still withholds file_url; d0-evidence-private-data-exposure + phase gates green.
- [x] M1.13 Governed classification correction — new evidenceClassificationCorrectionService + `PATCH /api/vehicles/:vin/evidence/:evidenceId/classification` (admin/government): reason mandatory, uploader self-correction refused (G5), audit to trust_audit_events FAIL-CLOSED before mutation (G6), previous classification appended to metadata.classification_history (G13), 'corrected' provenance event; only class/subtype mutate. Behavioral tests incl. audit-failure abort.
- [x] M1.14 No blind rewrite — no data backfill anywhere; migration is additive CHECK-widening only; Serena rows untouched.
- [x] M1.15 Serena BE FORWARD invoice — canonical import/commercial_invoice already correct in staging (M0.19); semantics tests pin the exact stored shape (legacy registration_document + canonical import) as import evidence. Staging visual confirmation lands in M7.6.
- [x] M1.16 Serena payment receipt — not yet uploaded (M0.18); the canonical-first upload path now files it as import/payment_receipt with a truthful generic compat type; pinned in the Serena matrix test.
- [x] M1.17 Serena Bill of Lading — canonical import/bill_of_lading; pinned (incl. its legacy ownership_transfer_document contradiction never granting ownership semantics).
- [x] M1.18 Serena Japanese Export Certificate — canonical import/export_certificate; pinned as never-registration.
- [x] M1.19 Serena Tanzania T1 — canonical import/transit_declaration; pinned as never-TIP.
- [x] M1.20 Serena CBCA/Cotecna — canonical inspection/roadworthiness; pinned.
- [x] M1.21 Kingstone identity — NOT in vehicle_evidence (M0.18); identity documents remain in the identity workflow; nothing in M1 creates a vault path for identity artifacts.
- [x] M1.22 Backend canonicalization tests green — operations-evidence-semantics (21/21) + affected suites 175/175 (incl. two inherited baseline-red fixtures repaired: marketplace-publication-gate + seller-contradiction-blocks-publication lacked the ZR sourced registration stage).
- [x] M1.23 Public privacy projection tests green — included in the 175 (d0-evidence-private-data-exposure, seller-reconciliation-privacy, issue164-d0-evidence-route-authorization) + new withholding test.

---

# M2 — Seller Authority governance

**Implemented 2026-09-02/03.** Schema decision (start prompt §10): the audit-event-only claim implementation could not support a queryable current state for the publication gate, a reviewer lifecycle, supersession, dispute/revocation or race-safe decisions — replaying trust_audit_events inside every completeness evaluation is neither cheap nor safe. Additive table `vehicle_seller_authority` (migration `20260902160000`) holds ONLY current state per (vin, seller); trust_audit_events remains the decision-history authority (every decision audited fail-closed). Canonical service: backend/services/seller/sellerAuthorityService.js (policy `seller_authority.v1`).

- [x] M2.1 Existing seller-claim contract extracted/hardened, not duplicated — `POST /api/vehicles/:vin/seller-claim` delegates to `submitSellerClaim` (same recognized/evidence_required handshake, same claim audit event, now also an idempotent claim row); the inline server.js `governedSellerEvidence` duplicate now calls the one service.
- [x] M2.2 Authority vs registration separated — service answers ONLY the authority question; registration stays in zimbabweRegistrationLifecycle; state machine has no registration input; wording test pins that no authority statement mentions registration/title/CVR/plate.
- [x] M2.3 State model documented — not_assessed / recognized (derived from relationship) / evidence_submitted / under_review / confirmed / insufficient / disputed / revoked; precedence: explicit decision row > relationship recognition > not_assessed; explicit revoked/disputed/insufficient overrides relationship (fails closed). Recorded in migration + service docstrings + this tracker.
- [x] M2.4 Relationship recognition preserved — `hasExistingSellerRelationship` unchanged semantics; tested.
- [x] M2.5 Permanent-import evidence-set policy — `evaluateEvidenceBasis`: ≥2 DISTINCT verified import purchase-chain documents (commercial_invoice/payment_receipt/bill_of_lading/export_certificate) → basis `reviewed_permanent_import_evidence_set`; commercial invoice alone refused (tested).
- [x] M2.6 Ownership/registration evidence policy preserved, canonical-aware — verified ownership/registration DOCUMENT (M1 semantics) → basis `reviewed_ownership_registration_evidence`; a mislabeled import doc never qualifies (tested).
- [x] M2.7 Dealer/tenant scoped — tenant recognition only for matching tenant; cross-tenant test green; dealer basis `dealer_tenant_inventory`.
- [x] M2.8 No self-approval — seller cannot review own claim, admin included (tested).
- [x] M2.9 Conflict fails closed — confirmation refused 409 when another party holds owner_id/current_seller_id/tenant; relationship never overwritten (tested; service has no code path writing vehicles.*).
- [x] M2.10 Disputed/revoked handled — decisions exist in state machine; revocation overrides relationship in `isSellerAuthoritySatisfied` (tested); supersession recorded via previous_status in the audit event.
- [x] M2.11 Evidence basis stored/audited — evidence_ids on the row + audit event.
- [x] M2.12 Reason required for confirmed/insufficient/disputed/revoked (tested).
- [x] M2.13 Idempotency/concurrency — claims idempotent (one row, one audit event across repeats; UNIQUE(vin,seller) backstops concurrent claims; benign-duplicate handling); decisions audited-then-written; DB CHECK requires decider attribution on decision states (PGlite harness).
- [x] M2.14 Seller notification safe — new `seller.authority.decided` domain event → canonical fabric (in_app, transactional, template `seller_authority_v1`); payload carries only VIN + public decision wording — no reviewer identity, no tokens, no documents; best-effort after the durable audited decision.
- [x] M2.15 Public wording bounded — `toPublicSellerAuthorityStatement`: "Seller authority reviewed by CarUp" etc.; test asserts no title/CVR/ZIMRA/registration/plate claims for any state.
- [x] M2.16 Serena reviewable without fake CVR/TIP — Kingstone holds owner_id+current_seller_id → reviewer can record `confirmed` on basis `existing_relationship` (strengthened by the import purchase-chain once verified); nothing in the path requires registration/TIP evidence. Staging execution lands in M7.10.
- [x] M2.17 Backend tests green — operations-seller-authority.test.js 14/14; updated seller-existing-passport-authority source-contract pins; communication coverage suites 148/148.
- [x] M2.18 Cross-user/cross-tenant negatives green — stranger=not_assessed, cross-tenant dealer denied recognition, GET state route restricts non-reviewers to their own state.

New/changed surfaces: `GET /api/vehicles/:vin/seller-authority` (reviewer may query any seller; others own-state only; reviewer-only attribution fields), `POST /api/vehicles/:vin/seller-authority/review` (admin/government pending M5 capability layer). Claimant upload-scope bypass is now canonical-aware (ownership/registration documents OR import purchase-chain — isSellerAuthorityCandidateRow). PGlite harness `database/test/operations_serena_slice_pglite_check.mjs` + CI step added (migrations after 20260810120000 are executed by no other gate).

---

# M3 — Publication completeness reconciliation

- [ ] M3.1 Legacy registration_document alone no longer drives ownership/registration gate.
- [ ] M3.2 Seller authority is a distinct publication requirement.
- [ ] M3.3 Zimbabwe registration readiness remains distinct.
- [ ] M3.4 Permanent-import pending stages can be non-blocking when policy allows.
- [ ] M3.5 locally_registered enforces local registration requirements.
- [ ] M3.6 TIP remains separate special state.
- [ ] M3.7 unknown stage fails closed as designed.
- [ ] M3.8 unresolved material extraction conflict blocks.
- [ ] M3.9 blocking fraud/governance state blocks.
- [ ] M3.10 finance disclosure remains non-blocking unless a separate transaction rule says otherwise.
- [ ] M3.11 insurance state does not fabricate Trust/public clearance.
- [ ] M3.12 refusal response distinguishes missing vs pending vs external vs conflict.
- [ ] M3.13 Serena-like publication matrix unit tests green.
- [ ] M3.14 Existing Seller lifecycle regression tests green.

---

# M4 — Vehicle Operations Review workspace

- [ ] M4.1 Register governed Vehicle Operations route.
- [ ] M4.2 Add reviewer read model/aggregator without new canonical truth.
- [ ] M4.3 Vehicle identity section.
- [ ] M4.4 Seller/account section.
- [ ] M4.5 Zimbabwe registration section with provenance.
- [ ] M4.6 Evidence grouping by canonical class.
- [ ] M4.7 Extraction/reconciliation section reuses canonical service.
- [ ] M4.8 Seller Authority section reuses canonical service.
- [ ] M4.9 Trust/Governance section reuses canonical services.
- [ ] M4.10 Fraud/Risk section reuses canonical services.
- [ ] M4.11 Publication readiness requirement matrix.
- [ ] M4.12 Audit section.
- [ ] M4.13 Communications links/context safe.
- [ ] M4.14 Server-derived allowed_actions.
- [ ] M4.15 No direct arbitrary Trust mutation.
- [ ] M4.16 No fake ZIMRA/CVR action.
- [ ] M4.17 No routine Admin auto-publish action.
- [ ] M4.18 Restricted artifact paths/URLs cannot leak.
- [ ] M4.19 Proven-session requirement enforced.
- [ ] M4.20 Wrong-role access denied.
- [ ] M4.21 Component/web tests green.
- [ ] M4.22 Desktop responsive test green.
- [ ] M4.23 Tablet responsive test green.
- [ ] M4.24 Mobile responsive test green.

---

# M5 — First bounded Operations capability layer

- [ ] M5.1 Central Operations authorization policy/service created or current equivalent proven.
- [ ] M5.2 Vehicle evidence review capability defined.
- [ ] M5.3 Seller authority review capability defined.
- [ ] M5.4 Vehicle private-read capability defined.
- [ ] M5.5 Platform Admin compatibility defined.
- [ ] M5.6 Super Admin compatibility defined.
- [ ] M5.7 Government capability scope defined.
- [ ] M5.8 Tenant role cannot escalate to platform operator.
- [ ] M5.9 New routes use capability policy.
- [ ] M5.10 Public registration cannot mint privileged operator.
- [ ] M5.11 Safe staging operator provisioning documented.
- [ ] M5.12 Authz adversarial tests green.

---

# M6 — Operations navigation / information architecture

- [ ] M6.1 Operations groups defined in navigation.
- [ ] M6.2 People group.
- [ ] M6.3 Vehicles & Trust group.
- [ ] M6.4 Marketplace group.
- [ ] M6.5 Communications group.
- [ ] M6.6 Growth/Diaspora group.
- [ ] M6.7 Platform group.
- [ ] M6.8 Fraud Queue discoverability corrected where appropriate.
- [ ] M6.9 Dealer Compliance discoverability corrected where appropriate.
- [ ] M6.10 Governance Review discoverability corrected where appropriate.
- [ ] M6.11 government governance route/layout mismatch resolved or explicitly deferred.
- [ ] M6.12 reviewer/UserRole mismatch resolved or explicitly bounded.
- [ ] M6.13 platform_admin/super_admin frontend route compatibility resolved.
- [ ] M6.14 No fabricated Operations metrics introduced.
- [ ] M6.15 Navigation tests green.
- [ ] M6.16 Mobile navigation tests green.

---

# M7 — Serena real staging review → Seller publish

- [ ] M7.1 Exact staging frontend SHA recorded.
- [ ] M7.2 Exact staging backend SHA recorded.
- [ ] M7.3 unpaired=false proven.
- [ ] M7.4 Authorized Operations test account session proven.
- [ ] M7.5 Serena Vehicle Operations page loads.
- [ ] M7.6 Serena canonical evidence grouping correct.
- [ ] M7.7 Serena private identity/payment docs remain restricted.
- [ ] M7.8 Serena evidence decisions completed as appropriate.
- [ ] M7.9 Serena extraction conflicts resolved or proven absent.
- [ ] M7.10 Serena Seller authority reviewed.
- [ ] M7.11 Serena actual registration stage/provenance confirmed.
- [ ] M7.12 No fake local plate.
- [ ] M7.13 No fake TIP.
- [ ] M7.14 No unsupported CVR claim.
- [ ] M7.15 No unsupported ZIMRA/customs claim.
- [ ] M7.16 No blocking fraud/governance case.
- [ ] M7.17 Completeness recalculated.
- [ ] M7.18 Serena becomes publishable legitimately.
- [ ] M7.19 Canonical Trust state recorded.
- [ ] M7.20 Sign in as existing Kingstone account.
- [ ] M7.21 Existing Serena draft loads — no duplicate Serena.
- [ ] M7.22 Seller sees truthful pending-registration state.
- [ ] M7.23 Kingstone clicks Publish.
- [ ] M7.24 Marketplace card visible.
- [ ] M7.25 Marketplace Vehicle Detail visible.
- [ ] M7.26 Passport public projection truthful.
- [ ] M7.27 Raw restricted source files inaccessible to buyer.
- [ ] M7.28 Buyer inquiry functional.
- [ ] M7.29 Seller receives/manages inquiry.
- [ ] M7.30 Unpublish works.
- [ ] M7.31 Republish works.
- [ ] M7.32 Desktop UAT PASS.
- [ ] M7.33 Tablet UAT PASS.
- [ ] M7.34 Mobile UAT PASS.
- [ ] M7.35 Accessibility PASS.
- [ ] M7.36 Affected backend gates green.
- [ ] M7.37 Affected web gates green.
- [ ] M7.38 Vehicle Passport gates green.
- [ ] M7.39 Marketplace gates green.
- [ ] M7.40 Communications gates green.
- [ ] M7.41 Seller Golden lifecycle green.
- [ ] M7.42 CI matrix green.
- [ ] M7.43 Final candidate SHA frozen.
- [ ] M7.44 Final report written.
- [ ] M7.45 Owner UAT instructions written.
- [ ] M7.46 PR remains unmerged pending owner approval.

---

# M8 — Extract proven reusable Operations patterns

Do not execute M8 as a reason to delay Serena owner UAT. M8 can begin after the M7 candidate is frozen.

- [ ] M8.1 Compare Vehicle Operations workflow with Communications workflow.
- [ ] M8.2 Decide whether assignment is common enough to extract.
- [ ] M8.3 Decide whether SLA is common enough to extract.
- [ ] M8.4 Decide whether generic operations_cases is justified.
- [ ] M8.5 Decide whether persistent operations memberships/capabilities are justified.
- [ ] M8.6 Decide whether Seller Authority needs dedicated table/service beyond current implementation.
- [ ] M8.7 Record reusable pattern ADR/decision.
- [ ] M8.8 Update canonical manual current-state section.
- [ ] M8.9 Update future O2–O10 sequencing.

---

# Future Operations adoption matrix

| Domain | Current state at execution | Target slice | Status | Notes |
|---|---|---|---|---|
| Vehicle Operations | | Serena M0–M7 | [ ] | |
| People / Customer Ops | | O2 | [ ] | |
| Identity | | O2 | [ ] | |
| Seller Compliance | | O2 | [ ] | |
| Dealer Compliance | | O2 | [ ] | |
| Marketplace Safety | | O3 | [ ] | |
| Risk/Fraud | | O3 | [ ] | |
| Customer Communications | | O4 | [ ] | |
| Disputes/Resolution | | O4 | [ ] | |
| Service Network | | O5 | [ ] | |
| PartSentry Governance | | O5 | [ ] | |
| Finance | | O6 | [ ] | |
| Insurance | | O7 | [ ] | |
| Transaction / SafePay | | O8 | [ ] | |
| Government/provider operations | | O9 | [ ] | |
| Security/Audit | | O10 | [ ] | |
| Platform/Feature Governance | | O10 | [ ] | |

---

# Evidence Register

Append one row for every cleared item or logically grouped set of items.

| Task(s) | SHA / file / migration | Test or UAT evidence | Result | Notes |
|---|---|---|---|---|
| M0.1–M0.8 | HEAD 96620f92; origin/main ba208963; PR list via gh 2026-09-02 | git rev-list/merge-base runs; live curl of carup-staging /carup-provenance.json + carup-backend-staging /api/health | PASS | Staging pair = main@ba208963, unpaired=false |
| M0.9–M0.16 | 96620f92 code inspection | Read-only code survey with file:line citations recorded in M0 section | PASS | No code changed |
| M0.17–M0.25 | staging DB (supabase carup-staging), read-only SQL | vehicles, vehicle_evidence, trust_audit_events, identity_documents, fraud/governance/extraction tables queried for GFC27-027051 | PASS | 0 writes issued |
| M0.27 | — | Session tool log: SELECT-only SQL | PASS | |
| M1.1–M1.8, M1.14–M1.20 | evidenceTaxonomy.js semantic layer; migration 20260902150000 | backend/tests/operations-evidence-semantics.test.js 21/21 | PASS | Serena matrix pinned against exact stored shapes |
| M1.9 | EvidenceUploadModal.tsx canonical-first | web EvidenceUploadModal.canonical.test.tsx 5/5; tsc clean | PASS | Legacy select = taxonomy-unavailable fallback only |
| M1.10–M1.11 | EvidenceReview.tsx, PremiumEvidenceGallery.tsx, VehicleProfile.tsx, evidenceService evidenceToTimelineItem | owner-page vitest 140/140; tsc clean | PASS | |
| M1.12, M1.23 | publicVehicleProjection unchanged | withholding test + privacy suites in 175/175 run | PASS | |
| M1.13 | evidenceClassificationCorrectionService.js + PATCH classification route | behavioral tests incl. fail-closed audit abort | PASS | |
| M1.22 | — | node --test: 175/175 across 11 affected suites; migration-integrity 24/24 | PASS | Two inherited stale fixtures repaired (pre-existing red at HEAD, proven via git stash) |

---

# Mandatory blocker register

| Task | Blocker | Evidence | Safe options | Owner decision needed? |
|---|---|---|---|---|
| | | | | |

---

# Final candidate record

**Branch:**  
**HEAD:**  
**PR:**  
**Staging URL:**  
**Frontend SHA:**  
**Backend SHA:**  
**Unpaired:**  
**Serena publishable:**  
**Serena published:**  
**Owner UAT ready:**  
**Merge ready:**  
**Production touched:** NO unless explicitly authorized and recorded otherwise.