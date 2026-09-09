# O2 — People & Compliance Operations: Progress / Roll-call Tracker

States: `[ ]` not started · `[~]` in progress · `[x]` done with evidence · `[!]` blocked with reason.
Every `[x]` names its evidence. No item may be closed by assertion.

**Branch:** `feat/operations-o2-people-compliance` · **Base:** integrated candidate `dd94c56d`
**State:** P0–P6 complete, plus the **P1-C effective-authorization correction** (see the correction notice under P1). **P7 EXECUTED AND PASSED 2026-09-04** (run `33839364831` @ `463507d1`, 21/21; receipt in this directory) — see the P7 note below. **Expansion:** X0–X5 complete (X1 = Document Intelligence authority retirement @ `5e996a7c`; X2 = Registration + Progressive Trust; X3 = Identity Lifecycle + Account Security; X4 = Biometrics + Explicit Consent — ARCHITECTURE CERTIFIED, live provider NOT ACTIVATED; X5 = Dealer onboarding + governed workbook migration @ `0d1a3a74` — see the receipts); **X5A COMPLETE 2026-09-04** (stakeholder workbook catalogue + AI intake; docs-first gate `72acf7e0`; 32 stakeholder dispositions; suites 5906:5885/0/21 + 1585/1585); **X6 COMPLETE 2026-09-04** (identity_assurance.v1 + semantic events; docs-first gate `07222eb3`; suites 5930:5909/0/21 + 1585/1585); **X7 COMPLETE** (integrated expansion certification, 13/13; receipt in this directory) — see X7 in the expansion section. **PRODUCT OWNER UAT COMPLETE 2026-09-07: O2-USABLE — OWNER ACCEPTED at `4002dbea`**; the walk found three defects (a missing step-up on the identity decision route — blocking; governed refusals reported as `500 DATABASE_ERROR`; a 393px overflow on `/workbook-tools`), all closed in one bounded commit and re-walked 33 PASS · 0 FAIL — result `CARUP_OPERATIONS_O2_OWNER_UAT_RESULT.md`. **POST-READY AUTOMATED REVIEW 2026-09-08: 8 findings closed @`87684c6a`; a FRESH re-review of that head found 6 MORE P1s (D1–D6); an INDEPENDENT audit found 3 MORE P1s (E1–E3); a further re-audit found 3 MORE (F1–F3) plus 4 overstated claims (F4); the G-round found 2 P1 + 4 P2 + 2 P3 (closed in H); the I-round then found 2 MORE P1 + 4 P2, ALL closed. All reproduced, all closed** — — `7fe1f821` is HISTORICAL and no longer the merge candidate; the independent approval recorded against it predates the current runtime, so a fresh review is required. *(Corrected 2026-09-07: this line said "X7 NOT started" while line 196 recorded X7 done — the checklist below was always accurate. Corrected 2026-09-04: it previously said "X5+ NOT started" after X5 had completed.)*
**Rule:** do not merge O2; stop at a certified candidate for Product Owner review.
**#194 LANDED (2026-09-04):** merge commit `bb9d9900` (= main); O2 RECONCILED onto the accepted
base via manifest-driven merge `7b9e8907` (no blind cherry-pick; vehiclesRoutes manual —
f600d002 hunk adopted, X3 step-up kept; X1 retirement intact; zero P1-C duplication; six O2
migrations remain the staging-parity set) — receipt
`CARUP_OPERATIONS_O2_POST_PR194_RECONCILIATION_RECEIPT.md`. The P7 note's blocker list is
updated by that receipt: the #194/divergence blocker is CLOSED; DDL parity + fixtures + pairing
remain the open, authorization-gated steps.

## P0 — Design pack

- [x] P0.1 Implementation plan — `CARUP_OPERATIONS_O2_IMPLEMENTATION_PLAN.md`
- [x] P0.2 This tracker
- [x] P0.3 Current-code discovery — `CARUP_OPERATIONS_O2_DISCOVERY_AND_OWNERSHIP.md` §3
- [x] P0.4 Domain ownership map — same file §4
- [x] P0.5 who-must-act normalization matrix — `CARUP_OPERATIONS_O2_WHO_MUST_ACT_MATRIX.md`
- [x] P0.6 Identity/Seller/Dealer authority matrix — `CARUP_OPERATIONS_O2_MATRICES.md` §6
- [x] P0.7 Transfer → Seller Authority lifecycle design — `CARUP_OPERATIONS_O2_TRANSFER_AUTHORITY_LIFECYCLE.md`
- [x] P0.8 Privacy matrix — `CARUP_OPERATIONS_O2_MATRICES.md` §8
- [x] P0.9 API/data delta — `CARUP_OPERATIONS_O2_MATRICES.md` §9 (DDL delta: NONE)
- [x] P0.10 Test/certification matrix — `CARUP_OPERATIONS_O2_MATRICES.md` §10

## P1 — Ownership transfer supersedes prior Seller Authority

> ### CORRECTION — P1 was reported complete on incomplete grounds (2026-09-03)
>
> Independent Product Owner review found that P1 closed the *row* but not the *effective
> authorization*. The earlier `[x]` marks below are **retained, not erased** — they were true about
> what they asserted (the row is revoked, audited, idempotent, nothing fabricated for B) and wrong
> about what they implied (that the former owner could no longer act). Both hazards are now closed
> and proven; the P1 correction items are tracked separately in **P1-C** below.
>
> **Root cause.** Two independent paths let a former owner keep effective Seller control:
>
> * **Hazard A — historical evidence.** `hasVerifiedOwnershipAuthorityEvidence` answers only "does a
>   verified ownership/registration document uploaded by this user exist?", which stays TRUE forever
>   after a sale. `POST /api/vehicles/add` fed it into `existingSellerRelationship` and the reuse
>   write then set `current_seller_id: <caller>` — handing publish/price/status scope over B's
>   vehicle back to A on the strength of a document that only ever proved what was true *before* the
>   sale. A document is not an immortal permission token.
> * **Hazard B — best-effort supersession.** Legal ownership must stand even when the derived
>   supersession write fails, so a stale `confirmed` row can physically survive a completed transfer,
>   and every read path treated it as sufficient.
>
> **Root cause beneath both, found by the repository sweep:** the transfer RPC retires
> `current_seller_id` / `current_seller_type` / `current_seller_type_source` but **not**
> `vehicles.tenant_id`. That third column is the final clause of the
> `isOwner || isCurrentSeller || isDealerTenant` scope test **repeated verbatim across eleven
> authorization sites**, so a dealer principal who sold their own vehicle retained publish,
> unpublish, price, status(sold), seller-draft, media upload + private signed URLs, evidence scope,
> link-event, completeness disclosure, stolen-report and PartSentry odometer writes over a vehicle
> they no longer owned.

- [x] P1.1 `supersedeSellerAuthorityOnOwnershipTransfer` in sellerAuthorityService — audit-first fail-closed, revocation never deletion, `SELLER_AUTHORITY_SUPERSEDED` event, disputed rows superseded, idempotent no-op on revoked/absent rows
- [x] P1.2 Invoked from `transitionOwnershipTransfer` on canonical `complete` only; a supersession failure is returned by name in `authority_supersession` while the registry-backed completion stands
- [x] P1.3 No authority fabricated for the incoming owner — asserted in proof (d)
- [x] P1.4 PGlite behavioral proof — `backend/tests/o2-transfer-authority-supersession.test.js`, 6/6 through the REAL migrations and REAL service functions
- [x] P1.5 Full backend suite 5752/0 fail after P1; 5778/0 fail at P6 head

## P1-C — Effective-authorization correction (the defect above)

- [x] P1-C.1 `hasSupersedingOwnershipTransfer` — registry-backed, deliberately INDEPENDENT of the authority row, so it survives a failed supersession; fails CLOSED on an unreadable ledger; short-circuits for the canonical owner (no added query on the ordinary path)
- [x] P1-C.2 `isSellerAuthorityEffectivelyDenied` — encodes the precedence: completed transfer away → DENY, explicit `revoked` → DENY, **then** historical evidence may be considered
- [x] P1-C.3 `getSellerAuthorityState` is ownership-aware — forces `revoked`, strips `existing_relationship`, and reports `effective_denial_reason` + `stale_authority_row_status`
- [x] P1-C.4 `POST /api/vehicles/add` reuse — denial evaluated BEFORE evidence; the relationship clauses (owner, stale current_seller, tenant, evidence) are all conjoined with `!denied`; refusal is the existing 409 `SELLER_AUTHORITY_CLAIM_REQUIRED`, so the reuse write that resets `current_seller_id` is never reached
- [x] P1-C.5 `loadScopedVehicle` (publish / unpublish / price) denies a superseded former owner on every clause
- [x] P1-C.6 `submitSellerClaim` refuses a superseded former owner (`SELLER_AUTHORITY_SUPERSEDED`, 403) — previously it answered `recognized` and SHORT-CIRCUITED, so no claim row and no audit event were written and the wrongful recognition was invisible to Operations
- [x] P1-C.7 Seller evidence upload — the claimant bypass no longer treats any historical claim event as a perpetual upload grant
- [x] P1-C.8 `reviewSellerAuthority` refuses to CONFIRM a seller whose ownership transferred away (409) — refusing/revoking them stays available
- [x] P1-C.9 **Root-cause migration** `20260903120000_ownership_transfer_retires_tenant_relationship.sql` — completion also clears `vehicles.tenant_id`. Generated FROM the certified 20260828203000 function rather than retyped; the diff is provably 0 lines removed / 1 line of code added (plus comment), closing all eleven shared-triple sites at once
- [x] P1-C.10 Operations exposure — the Vehicle Operations aggregate surfaces `effective_denial_reason`, `stale_authority_row_status` and `requires_operations_recovery` so a failed supersession is visible and repairable, not silently survived
- [x] P1-C.11 Journey A (normal supersession), Journey B (forced supersession failure — the critical fail-closed proof, incl. stale `current_seller_id` and surviving tenant variants), Journey C (history integrity) — `backend/tests/o2-former-seller-authorization.test.js`, **11/11**
- [x] P1-C.12 Non-regression proven explicitly: the canonical current owner is never denied by their own transfer history, and a non-owner seller with verified evidence and NO completed transfer is still legitimately authorized

### Repository sweep (§6) — every effective Seller authorization path

| Class | Sites | Disposition |
|---|---|---|
| **DEFECT → closed by the root-cause migration** | publish/unpublish/price scoping, `PATCH /status`, seller-draft edit, `vehicleObjectAuthority` (stolen-report, lender, insurer, eligibility), `mediaRouter` ×4 (vehicle upload, document upload, signed read/write URLs), evidence link-event, completeness disclosure, PartSentry odometer write | All keyed off the shared `isOwner \|\| isCurrentSeller \|\| isDealerTenant` triple; with `tenant_id` retired on completion the former owner now fails every clause. Publish/unpublish/price additionally carry the explicit denial check (defence in depth). |
| **DEFECT → closed directly** | `POST /api/vehicles/add` reuse, `submitSellerClaim`, evidence-upload claimant bypass, `reviewSellerAuthority` confirm | Evidence-based, not tenant-based — the migration does not reach them; each carries the denial gate. |
| **MADE SAFE BY THE FIX** | `getSellerAuthorityState` and everything downstream: `completenessEvaluator` publication gate, Vehicle Operations read model, `GET /seller-authority` | All resolve authority through the now ownership-aware state function. |
| **ALREADY SAFE** | lender routes (`owner_id` only, updated atomically by the RPC), trust-fact/PartSentry review permissions (owner may submit, never approve), evidence verify/reject, seller-authority review route, marketplace moderation, source verification, Vehicle Operations route, the transfer RPC itself, escrow/reserve (buyer-side) | Admin/government-gated, capability-gated, or keyed on `owner_id` alone. |
| **LEGITIMATELY INDEPENDENT** | `GET /api/vehicles/me`, dealer inventory read, intelligence/recommendation projections, public vehicle projection, inquiry history, report versions | Reads, or outbound projections; grant no seller control. |
| **CONTAINMENT (not a fix, worth knowing)** | `resolveMarketplaceSellerId` and `resolveListingSeller` deliberately never fall back to `owner_id` | Even had a former owner republished, buyer intent and escrow could not route to them — the listing has no governed current seller. |

Two items recorded but deliberately NOT changed here, as outside this bounded correction:
`POST /api/vehicles/:vin/evidence-sets` and the extractions route are role-gated with no object
scope at all (pre-existing, not transfer-specific); and `listingSummaryService.toClaimRow` still
synthesizes a cosmetic `relationship: true` from a surviving tenant — a display artifact that grants
no scope, and now moot for transferred vehicles since `tenant_id` is cleared.

### P1-C certification (candidate `e9326f76`)

**Real GitHub workflow runs at `e9326f76`** — dispatched, executed, green:

| Gate | Run | Result |
|---|---|---|
| Vehicle Passport Foundation CI | 33725721160 | **PASS** |
| Navigation Intelligence CI | 33725724035 | **PASS** |
| Communication Command Center CI | 33725726641 | **PASS** |
| Referral Engine CI | 33725730557 | **PASS** |

**Local, at the same SHA:** full backend suite **5789 tests / 0 fail / 21 skipped**; full web suite
**1561/1561**; `tsc --noEmit` clean; lint regression **NET_NEW_ERRORS=0 / NET_NEW_WARNINGS=0** vs
`origin/integration/vehicle-passport-v16-cert`; production build passes; migration-integrity 24/24;
all 8 `ci.yml` PGlite gates PASS; all 11 diaspora ledger harnesses PASS (11 ran, 0 failed).
Targeted: former-seller authorization **11/11**, transfer supersession 6/6, O2 responsibility 10/10,
O2 People/Compliance 10/10, O2 adversarial 6/6; seller+passport+marketplace suites **759/759**.

**Gates that did NOT execute, and precisely why — no PASS is claimed for any of these:**

| Gate | Why it could not run | What covers it instead |
|---|---|---|
| `CI` (Lint · Types · Build · Tests) | No `workflow_dispatch` trigger at all; `pull_request: [main]` only, and O2 has no PR | Every step reproduced locally at this SHA (lint, tsc, build, backend 0-fail, 8 PGlite gates, 11 ledger harnesses) — the approach this repository already uses for this workflow |
| Vehicle Finance Obligation Authority CI | No `workflow_dispatch` trigger | Its `finance_obligation_pglite_check` PGlite gate run locally: PASS |
| Seller Exact-Head Staging UAT (Golden) · Seller Media Lifecycle Staging UAT · Operations Serena Staging UAT · Marketplace Reference Regression (its final two unmocked staging steps) | **`feat/operations-o2-people-compliance` has no entry in `web/preview-frontend-pairing.json` / `preview-backend-pairing.json`**, so every exact-head provenance assertion fails before any product behaviour is exercised. Adding a pairing entry would also require applying this correction's RPC migration to **shared** staging while **#194 is still unmerged** — mixing an unaccepted base into the environment the certified integrated candidate depends on, which is the hazard this programme has already documented | These four are **green at the integrated candidate** (`dd94c56d` / `33720d79`), which O2 descends from. They must be re-run for O2 as part of **P7**, after the Product Owner accepts #194 |

The local half of Marketplace Reference Regression (backend marketplace suites, web unit tests,
mocked Playwright reference suite) is covered by the full backend and web suites above; it was
deliberately NOT dispatched, because it would have red-flagged on the pairing step for a reason
unrelated to this correction.

## P2 — Responsibility projection (ADR vocabulary verbatim)

- [x] P2.1 `backend/services/operations/responsibilityVocabulary.js` — a test forbids imports and persistence in the module itself
- [x] P2.2 `caseWorkflow.toResponsibilityProjection` — total over WORKFLOW_PHASE, unmapped phase fails by name
- [x] P2.3 `sellerAuthorityService.toResponsibilityProjection` — total over SELLER_AUTHORITY_STATUSES + derived states; listing-context rule tested
- [x] P2.4 `dealerComplianceService.toResponsibilityProjection` — pure over the deriveCanPublish inputs; 10 matrix rows tested; domain statuses never replaced
- [x] P2.5 `passportOwnershipTransferService.toResponsibilityProjection` — states parsed from the migration's CHECK constraint so a new state fails by name; registry waits are external_authority (`backend/tests/o2-responsibility-projection.test.js` 10/10)

## P3 — People & Compliance operating view (read-only)

- [x] P3.1 Three capabilities in the STATIC map; anti-escalation + fallback-refusal re-proven for them (`o2-people-compliance-review.test.js`)
- [x] P3.2 `peopleComplianceReadModel.buildPersonComplianceReview` + `peopleOperationsRoutes.js` (read-only; the route file is pinned to have NO mutating verbs); SHOULD-NEVER-LEAK quarantine test proves no artifact path, OCR payload, internal note, reviewer user id, password material or audit ip/user_agent escapes
- [x] P3.3 `PeopleComplianceReview.tsx` — five sections; a test forbids any combined verified-seller badge by name
- [x] P3.4 `admin.people-operations` registry entry (placements [], nav nodes unchanged at 83), route mounted, manifest regenerated (105 features); entry link from User Management rows
- [~] P3.5 Read-model tests 10/10 + UI tests 6/6 + full web suite 1561/1561 + tsc + lint NET_NEW 0/0; axe on the LIVE page belongs to the P7 staging replay

## P4 — Reviewer actions (existing endpoints only)

- [x] P4.1 Identity decisions wired to `POST /api/admin/identity/verification-sessions/:id/review`; non-approve decisions require a written reason in the UI
- [x] P4.2 Per-vehicle authority rows LINK to the certified Vehicle Operations workspace where the M5-wired decision already lives — one mutation surface per decision, deliberately not duplicated
- [x] P4.3 Dealer decisions wired to `PATCH /api/admin/dealers/:id/decision` with a mandatory reason
- [x] P4.4 Actions render only from server `allowed_actions`; empty-grant context renders no controls (tested)

## P5 — Communications events

- [x] P5.1 Already existed end-to-end (decisionRecorder emits, Communications listens) — found and pinned, not rebuilt
- [x] P5.2 `dealer.compliance.decided` emitted after the durable ledger row, best-effort, Communications owns delivery
- [x] P5.3 Pinned in `o2-people-adversarial.test.js`; the dealer service is pinned to never message anyone directly; zero Communications changes

## P6 — Privacy + adversarial

- [~] P6.1 Policy + middleware layers proven locally (M5 machinery reused verbatim; route composition pinned); the live-HTTP adversarial replay with a real CSRF token belongs to P7
- [x] P6.2 REAL GAP FOUND AND CLOSED: identity review had no self-review guard — an admin could approve their own identity session. Guard added in the OWNING identity service before anything is recorded; seller self-review was already refused (SELLER_AUTHORITY_SELF_REVIEW)
- [x] P6.3 Tenant/effective role grants none of the three capabilities (tested); tenant admin is not CarUp Operations
- [x] P6.4 The aggregate carries no artifact path or link (quarantine test); the identity service's audited preview route remains the only access path

## P7 — Staging certification

> **Not started, deliberately.** P7 is a slice-scale staging build: a new UAT workflow + spec, plus
> synthetic staging identities able to run the identity journeys — which means submitting identity
> DOCUMENT IMAGES to shared staging. Synthetic-asset precedent exists (`goldenSyntheticAssets.js`),
> and the reconciliation lessons apply (dedicated identities, queue-never-cancel, exact-head pair).
> The Product Owner should be aware before synthetic identity documents are created on staging, and
> the stacked #194 → main merge is still pending — certifying P7 against a base the owner has not
> yet accepted would repeat the mixed-base hazard. A skeleton workflow that never ran would be a
> gate that represents nothing, so none was created.

> **P7 readiness reconciliation — 2026-09-04 (head `bf10431b`): STILL BLOCKED.** Facts:
> #194 OPEN/BLOCKED and moved `33720d79`→`52ebcd46` (+7; lanes now DIVERGED — GitHub compare;
> local clone is shallow); O2 absent from both pairing maps (fail-closed, as designed); ALL 7
> O2 migrations unapplied to staging (ledger ends `20260902183022`) plus ~13 recent #194-lane
> migrations with no staging match (full DDL parity audit is a P7.1 obligation); synthetic
> identity/document policy stands with PO approval NOT yet given (no fixtures created);
> pairing additions are per-branch additive but shared-DB migrations pre-#194 would run under
> every live candidate (v16-cert, Serena slice, pinned seller gates). §10-X journey
> extensions added to the certification matrix so P7 now protects X1–X6. Entry conditions NOT
> satisfied — nothing was deployed, migrated, or fixtured. PO actions needed: (1) accept/land
> #194 (and O2 reconciles its +7); (2) approve staging DDL parity plan incl. the O2 seven;
> (3) approve synthetic identity-document creation; (4) then authorize pairing + P7 spec.

- [x] P7.1 Spec + workflow — **DONE**: sibling gate `.github/workflows/o2-p7-staging-uat.yml` + `tests/agents/44-o2-p7-staging.spec.ts` (exact-head bound, fail-closed project guard, governed six-migration apply with independent verification, per-run synthetic identities, three viewports)
- [x] P7.2 Journeys — **DONE**: §10 + §10-X certified, run `33839364831` @ `463507d1`, 21/21
- [x] P7.3 Desktop + tablet + mobile; axe serious/critical = 0 — **DONE** (all three viewports)
- [x] P7.4 Regression roll call at the same SHA — **DONE** (full backend/web/lint at the candidate; X1–X6/X5A + P1-C suites green)
- [x] P7.5 Credential/test-data cleanup audit — **DONE**: per-run identities cannot accumulate (a new run mints new accounts); no credential printed (all masked); no legacy fixture touched
- [x] P7.6 Certified O2 candidate frozen — **`463507d1`** certified; STOP for Product Owner review
- [x] X7 Intelligence + integrated expansion certification — **DONE**: `o2-x7-integrated-certification.test.js` 13/13; receipt `CARUP_OPERATIONS_O2_X7_INTEGRATED_CERTIFICATION_RECEIPT.md`
- [x] FINAL MATRIX @ `7eba353f` — backend **5945: 5924/0/21** · web **1585/1585** · tsc clean · production build success · lint NET_NEW **0/0** (one contended web timeout classified and disproven in isolation, 8/8, then 1585/1585 uncontended)

## O2 Identity/Onboarding Expansion (X-phases)

Governed by `CARUP_OPERATIONS_O2_IDENTITY_ONBOARDING_EXPANSION_PLAN.md`. Same rule as above: no
item may be closed by assertion. Core P0–P7 entries above are never edited by expansion work, and
**P7 remains BLOCKED / NOT EXECUTED** regardless of expansion progress.

- [x] X0.1 Exact-head reconciliation — PR #194 head re-verified `33720d79` (OPEN, unmerged, ancestor of this branch); branch head `90c50cc0` == origin; every expansion-cited path existence-checked; dual verification lanes, unrouted `VerificationReview.tsx`, and the `/promote-trust` caller/consumer survey recorded in `CARUP_OPERATIONS_O2_DISCOVERY_AND_OWNERSHIP.md` §5
- [x] X0.2 Expansion plan authored — `CARUP_OPERATIONS_O2_IDENTITY_ONBOARDING_EXPANSION_PLAN.md`, plus matrices §11 (Expansion Authority Matrix), the who-must-act expansion-design section, and the status corrections in the implementation plan; documentation only, no product code, no migrations, no staging actions
- [x] X1 Document Intelligence authority reconciliation — **COMPLETE 2026-09-03 at `5e996a7c`**; receipt `CARUP_OPERATIONS_O2_X1_DOCUMENT_INTELLIGENCE_AUTHORITY_RECEIPT.md`
- [x] X1.1 Full caller/authority inventory — all five `/api/verification` endpoints, both service authority functions, both TrustService functions, the six table-write classes, and the `/ai` lane resolved (served at `/api/ai/*` via `aiServiceBus`, observation-only); two X0 statements corrected by name (plan "X1 executed" + discovery §5 addendum)
- [x] X1.2 Per-behaviour classification — KEEP extraction · RETIRE router/approval/TrustService/FraudService · UNCHANGED TrustEnforcementEngine · PRESERVED historical rows; dispositions table in the plan and receipt
- [x] X1.3–X1.7 Executed — approval chain deleted (registry rows with synthesized identifiers, override with fabricated provenance, ocr `Verified`, vehicle status flip, +20 trust bump); person-tier promotion deleted; `/api/verification` unmounted incl. its rate-limit line; extraction preserved (diaspora consumer green); canonical-trust one-writer allowlist shrank 3→2 (`v16-authority-hardening` B7)
- [x] X1.8 Fraud-scan review — endpoint + legacy `FraudService` retired (router-only consumer; `'system_user'` provenance); governed `services/fraud/*` lane untouched and green
- [x] X1.9 Tests — new `o2-x1-document-intelligence-authority.test.js` **6/6** (written RED first: 5/6 failed pre-change); targeted **204/204** (7C ×6, dealer ×2, diaspora-ocr, phase-3, v16, hardening); P1-C/O2/seller/registration/trust batch **118/118** (former-seller 11/11 among them); **full backend suite 5795 / 0 fail / 21 skipped** (P1-C baseline 5789 + exactly the 6 new guards); no existing assertion weakened — the three updated pins assert strictly stronger claims
- [x] X1.10 Documentation — plan "X1 executed" section, discovery §5 X1 addendum, matrices §11 enforcement note, 4 dated addenda in `AUTHORITY_AUDIT_REGISTER.md` (3 CLOSED entries resolved by retirement; foreign-writers entry reduced in scope), this tracker, and the X1 receipt
- [x] X2 Registration + Progressive Trust — **COMPLETE 2026-09-03**; receipt `CARUP_OPERATIONS_O2_X2_REGISTRATION_PROGRESSIVE_TRUST_RECEIPT.md`
- [x] X2.1 Entry residuals closed — extraction refuses to run unattributed outside the test suite (both call sites + `/api/ai/ocr` passes the proven id); fallback markers present as `missing` and are refused as profile content at the write boundary
- [x] X2.2 Journey + candidates + confirmed-profile write — `registrationJourneyService` + 3 self-scoped routes; provenance (`user_confirmed`/`user_corrected`/`user_provided`) derived server-side from `candidates_seen` and audited fail-closed; ack instants preserved on update; business `onboarding_status` never regresses; DDL delta NONE
- [x] X2.3 Progressive Trust ladder — derived, advisory, ZERO-write (pinned); identity approval leaves Seller Authority / Dealer Compliance / vehicle registration / Vehicle Trust locked by their own authorities (tested); `who_must_act`/`next_actor`/`required_action` derived at read time (the dormant session columns stay dormant)
- [x] X2.4 Web `/onboarding` — context completion with candidate suggest/confirm, identity wizard on the 7C applicant routes (per-side retryable uploads, visible state), status panel, refresh/relogin resume from server truth; Register success panel links in
- [x] X2.5 Tests — new backend **22/22** (+ red-first write-boundary/scoping proofs) and web **7/7**; targeted **231/231** + **67/67**; **full backend 5817/0/21** (X1 baseline + exactly 22); **full web 1568/1568** (baseline + exactly 7); `tsc` clean; lint gate **NET_NEW 0/0**; interim web flakes (contended runs) named, isolated 31/31, and green in the final uncontended run
- [x] X2.6 Documentation — plan "X2 executed" section, discovery §5 X2 addendum, matrices §11 X2 note, this tracker, the X2 receipt; R1/R2 explicitly avoided and left open for their own lane
- [x] X3 Identity lifecycle / account security — **COMPLETE 2026-09-03**; receipt `CARUP_OPERATIONS_O2_X3_IDENTITY_LIFECYCLE_ACCOUNT_SECURITY_RECEIPT.md`
- [x] X3.1 Current lifecycle over immutable 7C history — append-only `identity_lifecycle_events` (DB-enforced, monotonic `seq`), 7 states + derivation fallback + document-expiry overlay; historical approvals proven byte-identical across transitions
- [x] X3.2 Governed transition policy — total, fail-closed by name; `verified`/`recovered` minted only by the 7C approval hook; subject self-action refused; **revoked never resurrects from an old approval** (hook refusal pinned); every transition audited with reason/trigger/actor/policy/evidence
- [x] X3.3 Triggers — document expiry (derived, nothing fabricated); routine recovery ≠ suspected takeover (router imports no lifecycle code, source-pinned; takeover = governed `compromised`); material-identity-change designed but refused-by-absence (no self-service account-edit route exists — recorded obligation for any future one)
- [x] X3.4 Authentication assurance — `auth_method`/`step_up_at`/`step_up_method` on sessions (additive migration); `session < recent_reauth < strong_authenticator`; classes ordinary/sensitive(15m)/critical(5m); **WebAuthn/passkey/MFA confirmed absent and DEFERRED fail-closed** (`STRONG_AUTHENTICATOR_AVAILABLE=false`, `webauthn` unrecordable, critical's password-re-proof fallback explicit policy — all pinned); forged client assurance proven inert
- [x] X3.5 One step-up guard, mapped — transfer transition [CRITICAL]; seller review, dealer decision, evidence preview, lifecycle transition, revocations [SENSITIVE]; composes after role/capability and substitutes for none (runtime-proven both directions); x-user-id identities refused on every security surface
- [x] X3.6 Session security — governed one/others/all revocation over `is_valid`; self revoke-others keeps the presenting session; `compromised` cascades all sessions in the same action; audits carry session ids never tokens; invalidated sessions re-proven rejected by authMiddleware
- [x] X3.7 Progressive Trust integration — capability-bearing = current lifecycle (`verified`/`recovered`); reverification keeps safe capability + locks identity-gated with the applicant-safe reason; holds fail closed with CarUp as actor; only applicant-safe lifecycle fields reach the subject; domain authorities untouched (suites re-proven); dormant `next_actor`/`required_action`: DERIVATION chosen, columns stay dormant
- [x] X3.8 Tests — new suites **22/22** (PGlite lifecycle 7 · assurance 10 · journey 5); 7C **67/67** through the approval hook; certified-lane batch **165/165** (P1-C 11/11 within); auth contract batch 69/0 (sessions-contract widened to the new columns); dealer 9/9 (harness upgraded to real sessions + step-up); page **9/9**; **full backend 5839/0/21** (X2 baseline + exactly 22); **full web 1570/1570** (baseline + exactly 2); tsc clean; lint gate NET_NEW 0/0
- [x] X3.9 Documentation — plan "X3 executed", discovery X3 addendum, matrices X3 rows (lifecycle + assurance facts), who-must-act lifecycle projection table, this tracker, the X3 receipt
- [x] X4 Biometrics + Explicit Consent — **ARCHITECTURE CERTIFIED 2026-09-03; LIVE BIOMETRIC PROVIDER: NOT ACTIVATED** (two gates, never merged); receipt `CARUP_OPERATIONS_O2_X4_BIOMETRICS_CONSENT_RECEIPT.md`; provider decision `CARUP_OPERATIONS_O2_X4_BIOMETRIC_PROVIDER_DECISION.md` (NOT SELECTED — PO decision on evidence)
- [x] X4.1 Consent ledger — `identity_biometric_consents` (append-only, DB-enforced); affirmative versioned grant (`biometric_consent.v1` + exact text version, unticked box, Terms/uploads refused as consent); self-only; withdrawal = new row, stops new processing (provider-spy-proven), erases nothing; audited + `identity.biometric.consent.granted` emitted
- [x] X4.2 Provider-neutral contract — CarUp vocabularies + server-owned `biometric_threshold.v1` (between-thresholds ⇒ indeterminate); raw-in/normalize-once; registry → honest null provider (`not_configured`, statuses `not_run`); unknown vendor throws; injected doubles test-only; NO fake success anywhere
- [x] X4.3 Evidence persistence — additive columns on append-only `verification_assessments` (face/liveness status+score, provider provenance/reference/state, threshold version, `consent_id`); client scores inert (route takes session id only); session row untouched by any assessment (byte-compared)
- [x] X4.4 Decision integration — `decisionPolicy`+recorder consume the evidence: mismatch/failed-liveness BLOCK approve (escalate/resubmission, never auto-rejection); indeterminate/unavailable keep the human path; provider MATCH lifts nothing (name-binding still gates independently — `identityBinding` unchanged); 7 biometric reason codes with applicant-safe guidance
- [x] X4.5 Surfaces — reviewer Biometric Evidence section (consent, provenance, statuses/scores, flags; ZERO buttons of its own); applicant journey consent block (full disclosure, affirmative box) + run-check leg + truthful unavailable→manual-review fallback; withdrawal control
- [x] X4.6 Data minimisation — no template/embedding store, no fingerprint fields/endpoints/capture (pinned repo-wide incl. expansion-era migrations); CarUp keeps assessment+provenance+consent+decision; provider-held data: none today, DPA-governed at activation; Zimbabwe compliance activation register recorded in the receipt (OPEN items named — no legal approval claimed)
- [x] X4.7 Tests — new **16/16** (consent PGlite 6, assessment/policy/runtime 10; both migrations executed on real PostgreSQL); neighbors smoke 67/67; affected web pages **39/39** (incl. 4 new X4 cases); **full backend 5855/0/21** (X3 baseline + exactly 16); **full web 1574/1574** (baseline + exactly 4); tsc clean; lint gate NET_NEW 0/0
- [x] X4.8 Documentation — plan "X4 executed", discovery X4 addendum, matrices biometric rows updated to IMPLEMENTED (+consent row), provider decision doc, this tracker, the X4 receipt
- [x] X5 Dealer onboarding + workbook migration — **COMPLETE 2026-09-03**; receipt `CARUP_OPERATIONS_O2_X5_DEALER_ONBOARDING_WORKBOOK_MIGRATION_RECEIPT.md`
- [x] X5.1 Bounded applicant access — `assertDealerOnboardingContext` derives business+dealer from the X2 registration profile (server truth, fail-closed 403); own-application only; NO dealer role granted; role matrix + DealerDashboard byte-untouched; workspace dependency recorded honestly (`workspace_access.available=false`, `dependency='governed_dealer_role_or_tenant_relationship'`) — the approved-applicant→active-Dealer path is a named UNRESOLVED dependency, deliberately not fabricated
- [x] X5.2 §4 forgery closure — `tenant_id` REMOVED from `PROFILE_FIELDS` (client payloads can never assign tenant membership); permanent refusal pins added; admin tenant-scoping re-proven from server-seeded facts
- [x] X5.3 Private evidence — uploads under `dealer-compliance/<dealerId>/` in the private bucket; responses carry `has_file` never paths (leak-pinned); applicant preview = short-lived signed URL self-only; reviewer raw preview behind admin role + X3 step-up (SENSITIVE), audited; sanitized admin listing added
- [x] X5.4 Claim ≠ extraction ≠ decision — OCR attributed to the real user, candidates through the X2 truth model (fallback markers refused) persisted per-document as candidates only; applicant confirms/corrects with `candidates_seen` provenance; `recordDecision` remains the sole decision writer; no X5 path can mint VERIFIED/APPROVED (classifier re-pinned)
- [x] X5.5 Workbook migration lane — inspect (upload security reused) → deterministic aliases → AI proposals over HEADERS ONLY (spy-pinned, allowlist-validated, failure→unmapped) → human confirmation recorded in `dealer_workbook_mapping_confirmations` bound to the sha256 checksum (`dealer_workbook_mapping.v1`) → EXISTING `runAndPersistDiasporaWorkbookDryRun` as the truth gate; diaspora chain byte-unchanged (source-pinned); changed file voids confirmation; no second importer
- [x] X5.6 Applicant surface — `/dealer/onboarding` (entry from `/onboarding` at the `prepare_dealer_onboarding` unlock): candidates by explicit click, requirements independent, eight dimensions verbatim, responsible-person identity from X3, who-must-act from P2, workbook lane with dry-run disabled until confirmed, "Applicant — not an active Dealer" badge
- [x] X5.7 Tests — new backend **16/16** (onboarding 8 + mapping 8, migration on real PostgreSQL) and web **4/4**; targeted batch **201/201**; certified-lane batch **64/64**; **full backend 5871 — 5850/0/21** (X4 baseline + exactly 16); **full web 1578/1578** (baseline + exactly 4); tsc clean; lint gate NET_NEW 0/0; an interim 54-fail backend run was traced to the invocation itself (CWD + a route-harness env var exported suite-wide) under a load-107 spike — named in the receipt, re-proven green; RegistrationJourney load effect hardened (keyed on `user.id`, race under accumulated test load eliminated, 3× stable)
- [x] X5.8 Documentation — plan "X5 executed", discovery X5 addendum, matrices X5 note + 2 implemented rows, who-must-act X5 projection section, this tracker, the X5 receipt
- [x] X5A Stakeholder Workbook Catalogue + AI Intake Workspace — **COMPLETE 2026-09-04** (docs-first gate `72acf7e0` BEFORE code); plan `CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_PLAN.md`; manual `CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md`
- [x] X5A.1 Stage A documentation gate — **COMPLETE 2026-09-04 @ `72acf7e0`** (docs-only, before any code): plan + catalogue manual (32 stakeholder dispositions, none absent; field registry v1; exposure matrix; AI authority matrix) + all 6 canonical doc updates; consistency check green
- [x] X5A.2 Workbook Field Registry (code) — versioned; powers templates/labels/help/validation/vocab/stakeholders/worksheets/import-export flags/AI metadata; authority-only fields not importable — **DONE** — `workbookFieldRegistry.js` v1 (vocabularies imported from owning modules; 30 forbidden columns incl. the 11 private-banking keys; template objects for the engine); suite 8/8 incl. the create-route destructure tripwire
- [x] X5A.3 Engine reconciliation — xlsx service accepts template objects (diaspora strings byte-equivalent, xlsx suite green unmodified); X5 mapping service generalized to registry columns — **DONE** — engine accepts template objects (diaspora xlsx 24/24 UNMODIFIED; content-parity pin); X5 mapping service generalized (registry labels deterministic; dealer binding preserved; X5 16/16); migration `20260904090000` loosens two NOT NULLs so the EXISTING stores serve the new template keys
- [x] X5A.4 Template Catalogue API — server-derived available/unavailable + reasons; forged request-body eligibility refused — **DONE** — `workbookCatalogueService` + GET /api/workbook/catalogue + fail-closed `requireTemplateAction` on every route; exposure suite 7/7 incl. forged-actor + deferred-stays-deferred
- [x] X5A.5 Seller/Dealer vehicle workbook — normalized sheets covering the documented current user-enterable Seller contract; import chain (inspect→map→confirm→validate→dry-run→confirm→execute→receipt) through canonical services only — **DONE** — full chain for seller_vehicles/dealer_vehicle_inventory; execution replays canonical POST /api/vehicles/add per vehicle (stable client_submission_id) + canonical evidence upload; existing-Passport VINs rejected; suite 10/10 incl. the NO-RE-ENTRY pin
- [x] X5A.6 Importer/Exporter + other stakeholders — diaspora contracts reused; unsafe/deferred templates honestly unavailable — **DONE** — diaspora templates exposed by VERIFIED trade-profile role (no second schema); garage/mechanic/insurer/lender/government/fleet honestly unavailable with reason codes
- [x] X5A.7 CarUp AI Workbook Assistant — visible UI + endpoints; deterministic first; proposals visually distinct; authority matrix enforced; failure degrades to manual — **DONE** — `workbookAiAssistantService` + assistant routes + the NAMED panel with provider badges (deterministic vs AI PROPOSAL vs unmapped); needs_user_value for the unknowable; AI failure degrades to manual; suite 6/6
- [x] X5A.8 Export + Recent Imports — server-sourced scoped redacted export; existing batch/receipt store reused and caller-scoped — **DONE** — DB export by current_seller_id (+ own dealer BUSINESS/BRANCHES), engine/chassis redacted by default, human labels in cells (4/4); recent imports uploader-scoped over the existing batch store
- [x] X5A.9 Tests — **DONE**: new backend 35/35 (5 suites) + web 7/7; targeted batch 271/271; **full backend 5906 (5885/0/21)** = X5 baseline + exactly 35; **full web 1585/1585** = baseline + exactly 7; tsc 0; lint NET_NEW 0/0; interim failures traced honestly (duplicate hook symbol crash-loading 10 web files — renamed to executeVehicleWorkbookBatch; one navigation-analytics live-HTTP flake outside X5A, 25/25 isolated, green in the certifying rerun)
- [x] X5A.10 Receipt `CARUP_OPERATIONS_O2_X5A_STAKEHOLDER_WORKBOOK_AI_INTAKE_RECEIPT.md` authored; docs stayed live throughout (checklist evidenced per unit; parity correction recorded in-place); STOP before X6 — X6/X7 must use the catalogue §2 roll-call
- [x] X6 Cross-domain assurance + Communications semantics — **COMPLETE 2026-09-04** (docs-first gate `07222eb3` BEFORE code); plan `CARUP_OPERATIONS_O2_X6_ASSURANCE_COMMUNICATIONS_PLAN.md`; roll-call = catalogue §10 (all 32 rows dispositioned in Stage A)
- [x] X6.1 Stage A documentation gate — **COMPLETE 2026-09-04 @ `07222eb3`** (docs-only, before code): plan + catalogue §10 (32/32 rows dispositioned) + 6 doc updates
- [x] X6.2 `identityAssuranceService` (identity_assurance.v1) + additive lifecycle `approved_at`/`document_expiry` (X3 suites green) — **DONE** — identity_assurance.v1 projection (suite 10/10); lifecycle additive approved_at/document_expiry; X3 green
- [x] X6.3 Consumers — registration journey (shape-preserving), dealer onboarding responsible person, ops people review additive block — **DONE** — registration (ONE identityFacts source, shape preserved, +identity_assurance additive; 34/34), dealer overview (+assurance fields; 34/34), ops people review additive block (10/10)
- [x] X6.4 Missing-items batching — `buildDealerActionSummary` + `narrateActionSummary` (AI rephrase optional, structured truth verbatim) — **DONE** — buildDealerActionSummary (domain facts; verified/non-blocking excluded) + narrateActionSummary (structured verbatim by reference; lossy AI refused; failure→deterministic)
- [x] X6.5 Events emitted from authoritative writes — identity.lifecycle.changed · dealer.compliance.evidence_required · seller.authority.superseded · workbook.import.completed; dealer.compliance.decided payload privacy-corrected — **DONE** — identity.lifecycle.changed · dealer.compliance.evidence_required (batched) · seller.authority.superseded (former seller finally told; idempotent) · workbook.import.completed; decided payload privacy-corrected
- [x] X6.6 Bounded Communications wiring — allowlist + policy + template ×5 (coverage CI green; delivery untouched) — **DONE** — allowlist+policy+template ×5 (transactional, in_app, policyChannelsOnly, legal thread types); coverage CI 9/9; delivery untouched
- [x] X6.7 No-grant + privacy + forged-assurance pins (tests 3–10, 13) — **DONE** — no-grant + privacy + forged-assurance pins green (suites 10/10 + 7/7 + 7/7)
- [x] X6.8 32-row roll-call machine-checked; comms contracts reconciled; machine actors excluded; regulated correct; no marketing expansion — **DONE** — 32/32 roll-call machine-checked vs catalogue §10; contracts reconciled; machine actors excluded; regulated correct; zero marketing expansion
- [x] X6.9 Certification — **DONE**: 28 proofs covered by the three X6 suites + batches; **full backend 5930 (5909/0/21)** = X5A baseline + exactly 24; **full web 1585/1585 unchanged** (backend-only phase); tsc 0; lint NET_NEW 0/0; one traced interim failure (eager event-bus import in canonical Trust's env-free graph → lazy emit import) named in the receipt
- [x] X6.10 Receipt authored + docs live throughout (code+receipt `3b4a5598`; gate `07222eb3`); STOP before X7 holds

## Product Owner UAT (2026-09-07)

- [x] UAT.1 PR-head runtime proven byte-identical to certified `7eba353f` — verified, not assumed (`git diff --quiet 7eba353f 71b81d74 -- backend web database shared` clean; the three intervening commits are docs/UAT assets)
- [x] UAT.2 O2's OWN deployed pair walked as real actors, areas A–J — `unpaired:false`, environment `preview`; nothing from #197 or #209 imported, invoked or relied upon; no SQL stood in for an O2 decision
- [x] UAT.3 Findings classified before any code changed — 1 BLOCKING DEFECT · 2 DEFECT · 3 UX DEFECT · 2 KNOWN DEFERRED (LIVE OCR provider; dealer activation) · 0 PREFERENCE dressed as a defect
- [x] UAT.4 Dealer-activation boundary decision — **RECORD, not BLOCK**: the UI makes no activation claim it cannot perform (`/dealer` redirects the applicant away; `/workbook-tools` lists dealer inventory under "Not available to this account (and why)")
- [x] UAT.5 Bounded closure `4002dbea` — step-up on the identity decision route; SQLSTATE→HTTP translation for governed transfer refusals; `/workbook-tools` header/tab wrapping. Held by `o2-owner-uat-closure.test.js` (10 tests); five deliberate reversions, five red
- [x] UAT.6 Re-walk on the fixed deployment — **33 PASS · 0 FAIL**, 0 5xx; identity decision now `403 STEP_UP_REQUIRED` before resource lookup, with the dealer route as positive control; 393px `scrollWidth` 481 → 393
- [x] UAT.7 Certification at `4002dbea` — exact-head CI 15 success/4 skipped/0 failure; backend `5955:5934/0/21`; web `1585/1585`; `tsc -b` 0; migration-integrity green via Passport foundation contracts; four Vercel builds success
- [x] UAT.8 Verdict recorded — **O2-USABLE — OWNER ACCEPTED / READY FOR PARENT-FIRST MERGE AUTHORIZATION**. Not merged. Production untouched. Biometrics still NOT activated.

## Post-Ready automated review closure (2026-09-08)

Separate from, and later than, the Product Owner UAT above. Marking PR #208 Ready for Review
triggered an automated (Codex) review that opened **eight threads on the approved head
`7fe1f821`**. Every one was treated as an allegation and reproduced before any code changed;
**all eight were real**.

- [x] PR.1 C1 **P1** missing client step-up flow — `web/src` contained ZERO step-up references while nine backend routes required one, so every guarded reviewer action was unsatisfiable through the product. Closed with `stepUpSession` + `StepUpDialog` + a retry runner; the guard itself is untouched. 6 mutations red
- [x] PR.2 C2 **P1** wrong identity decision payload — the screen sent `notes`, which the service reads under no name; reject and request-resubmission failed validation every time. Closed with the governed `{action, reasonCode, internalNote, applicantMessage}` shape. Backend validation NOT weakened. 4 mutations red
- [x] PR.3 C3 **P1** unsupported dealer decision — `pass_review` is not in `DECISIONS_ALLOWED`; the primary positive dealer action always failed. Closed by approving NAMED requirements, the grain the ledger already uses. No new vocabulary. 1 mutation red
- [x] PR.4 C4 **P1** receipt unique-key collision — `uq_diaspora_workbook_receipt_row` is `(batch_id,row_number,attempt)` and excludes `sheet_name`. Closed by making the workbook row the receipt grain; evidence outcomes recorded on it and returned per item. Constraint NOT dropped. 2 mutations red
- [x] PR.5 C5 **P1** retry reused attempt 1 — a PARTIALLY_IMPORTED batch could never leave the partial state. Closed with `max+1` attempt allocation, matching diaspora's existing meaning of `attempt`. 2 mutations red
- [x] PR.6 C6 **P2** dealer BUSINESS/BRANCHES silently discarded — deliberately non-persistent (a workbook must not edit a dealer application), so the TRUTH MODEL was corrected: per-row warnings, a count, and `notImported` in both the dry run and the result. 1 mutation red
- [x] PR.7 C7 **P2** VIN written into the uuid `target_record_id` — `vehicles.vin` IS the primary key and the real create route returns no uuid; PostgreSQL refused with 22P02 and nothing checked it. Closed by linking only real uuids and reporting the error. 1 mutation red
- [x] PR.8 C8 **P2** read model hid database errors — a `dealer_profiles` fault became `is_dealer: false`. Closed: every constituent fails closed with a 503 naming the section. 6 mutations red
- [x] PR.9 Root cause of the green suite — the X5A in-memory client enforces no index and no column type, and its dispatch stub invented `vehicle.id`. Added `database/test/o2_workbook_receipt_identity_check.mjs` (real migration DDL in PGlite) **as a CI step**, plus a constraint-enforcing service client
- [x] PR.10 **No migration, no DDL, no schema change** — every fix works inside the existing contract. Receipt: `CARUP_OPERATIONS_O2_POST_READY_REVIEW_CLOSURE.md`

## Fresh automated re-review round 2 (2026-09-08)

A fresh Codex review of the closure head `87684c6a` opened **six new P1 threads**. All six
reproduced. **`87684c6a` is historical.**

- [x] R2.1 D1 **P1** the step-up code never reached the caller — `apiClient` retries every unsafe 403 as a possible stale CSRF token, and the retry path copied `status`/`data` but not `code`, so the round-1 C1 recovery was DEAD for every real API call. One `buildApiFailure()` now serves both paths. 1 mutation red
- [x] R2.2 D2 **P1** the recovery existed on ONE screen — the primary identity console, dealer compliance and vehicle operations all called guarded routes with no step-up path. Extracted `useStepUpGuard()`, adopted by all four screens, plus a WIRING pin that fails by name for the next screen that forgets. 1 mutation red
- [x] R2.3 D3 **P1** imports could not reach the routes they replay — `app.listen` is skipped under `VERCEL` and the dispatch omitted CSRF. Now resolves an explicit base URL, sends a real CSRF pair, and REFUSES up front when nothing is reachable rather than rejecting every row. 2 mutations red
- [x] R2.4 D4 **P1** an evidence failure still wrote the terminal `IMPORTED` — the shortfall became permanent and invisible. Now stays `PARTIALLY_IMPORTED` (retryable) and reports `evidence_failed` / `incomplete_reason`. 1 mutation red
- [x] R2.5 D5 **P1** a batch was finalised after its receipts were lost, so the audit gap was unrepairable and the UI never showed it. Now retryable, and the workspace states it. 1 mutation red
- [x] R2.6 D6 **P1** retries duplicated already-recorded evidence — `withUploadIdempotency` fails OPEN without a key. Deterministic per-item key added. 1 mutation red
- [x] R2.7 Lesson recorded — a fix can be correct and still unreachable; both a mechanism test AND a wiring pin are required. See the closure receipt.

## Independent read-only audit closure — round 3 (2026-09-08)

The third Codex review was unavailable (review quota), so an independent read-only audit of the
`87684c6a → 6f850163` diff and the affected runtime contracts was run instead. It found **three
P1 blockers**; all three reproduced. **`6f850163` is historical.**

- [x] R3.1 E1 **P1** workbook evidence carried no MIME type — reproduced against the REAL validator: the canonical route refuses a remote `file_url` whose declared type is unsupported, so every imported evidence reference failed with "Unsupported file type: unknown". Closed with a REQUIRED `file_mime_type` column whose vocabulary is imported from `evidenceService.allowedMimeTypes`. No guessing from filenames, no server-side URL fetching (SSRF), no broadened allow-list, no second writer. 5 + 2 mutations red
- [x] R3.2 E2 **P1** the mutation target was not proven to be this candidate — `CARUP_PUBLIC_API_URL` is the STABLE public origin (`api-staging.carup.dev`), so a branch preview could have written to stable staging. Closed: public URL no longer accepted; per-deployment `VERCEL_URL` or an explicit internal base only; and `assertDispatchTargetProvenance()` proves SHA+branch against the caller's own provenance BEFORE the first mutation, reusing `config/buildProvenance.js`. No new env var needed. 1 + 3 mutations red
- [x] R3.3 E3 **P1** the canonical replay lost the actor's tenant scope — `authorizeRole` proves membership and sets `userContext.tenantId`, which `buildVehicleListingCandidate` reads; the dispatcher forwarded only the session, so an active Dealer's import became a tenant-less listing. Closed with `trustedActorHeaders()` built at the EXECUTION boundary (not inside one transport, which is why an injected dispatcher never saw it). `x-user-id` never forwarded. 2 mutations red
- [x] R3.4 §5 interaction certified end-to-end for BOTH Owner and active Dealer through a CONTRACT dispatcher that runs the real evidence validator and the real listing-candidate derivation — never an always-201 stub
- [x] R3.5 No regression in C1–C8 or D1–D6 — all guards re-run green
- [x] R3.6 **No migration, no DDL, no schema change; no Vercel config written; production untouched**

## F-round independent re-audit closure (2026-09-08)

A fresh read-only re-audit of the E-round closure found **three more contract failures plus four
overstated certification claims**. All reproduced. **`23d4bfa3` is historical.**

- [x] R4.1 F1 **P1** workbook classification did not match canonical — blank subtype AND wrong-class subtype both passed the dry run and both are refused by `validateEvidenceUploadPayload`. Closed: subtype REQUIRED + the dry run CALLS the canonical validator (`EVIDENCE_CLASSIFICATION_INVALID`). No legacy `evidence_type` added, nothing inferred, no second taxonomy. 2 + 1 mutations red
- [x] R4.2 F2 **P1** the dry run enforced no evidence upload authority — the route runs `canUploadEvidenceRecord` and the workbook ran nothing; real refusals exist (`auction/auction_sheet` owner=false; subtype override `registration/police_clearance_first_registration` government-only). Closed with the canonical check on the SERVER-DERIVED role (`EVIDENCE_ROLE_FORBIDDEN`), worded so a deterministic 403 never reads as retryable. 4 mutations red
- [x] R4.3 F3 Admin catalogue contradiction — an ordinary Admin has NO listing subject (`missing_owner_for_private_listing | unknown_seller_type`) yet was offered `seller_vehicles` under "your own listing authority". Closed by gating on the listing SUBJECT, not the role; an Admin WITH a real tenant is legitimate under the existing contract and is proven. No ownership/tenant workbook field added, no delegation invented. 2 mutations red
- [x] R4.4 F4a the test boundary now CALLS the canonical contracts (payload validation, upload authority, MIME, listing candidate + eligibility, tenant membership, real idempotency) instead of approximating them
- [x] R4.5 F4b a real Admin proof now exists — the E-round receipt claimed one that no committed test contained
- [x] R4.6 F4c the "evidence stays PENDING" assertion was VACUOUS (it read a reduced log object for keys the logger never copied); it now inspects the actual outgoing body
- [x] R4.7 F4d "does not duplicate" is now proven by running `withUploadIdempotency` over shared state across two passes — one record after both — rather than inferred from a stable key
- [x] R4.8 E1–E3 and C1–C8/D1–D6 all preserved and re-run; **no migration, DDL, schema, Vercel or provider change**

## H-round G-finding closure (2026-09-08)

The independent G-round audit returned **RE-AUDIT FAILED — 2 P1, 4 P2, 2 P3**. All eight closed.
**`d2229a5e` is historical.**

- [x] R5.1 G-1 **P1** execute revalidated NOTHING and was the only workbook mutation route with no catalogue gate — the F1/F2 protections were advisory. Closed: execute re-derives listing subject + eligibility, classification, MIME and upload authority from the CURRENT actor before the first write for each row, and applies `requireTemplateAction` against the batch's server-owned template. 5 mutations red
- [x] R5.2 G-2 **P1** `buildVehicleListingCandidate` let `body.owner_id`/`body.tenant_id` outrank validated context for admin/government — role alone could assert a subject. Closed at the canonical authority so every caller benefits. 2 mutations red
- [x] R5.3 G-3 **P2** the subtype vocabulary was `["0","1","2",…]` (Object.keys over an array of objects) — no real subtype, while the field example said `registration_book`. Closed: 68 canonical codes, no indices, no duplicates. 1 mutation red
- [x] R5.4 G-4 **P2** `contractDispatch` is test-only; the claim is narrowed and real production-path execute tests added
- [x] R5.5 G-5 **P2** idempotency was sequential-only. Closed with a partial unique index (repo precedent) + unique-violation handling. **Migration written, NOT applied anywhere.** 1 mutation red
- [x] R5.6 G-6 **P2** government silently lost its dealer-inventory disposition — now explicit with a truthful reason, still unavailable. 1 mutation red
- [x] R5.7 G-7/G-8 **P3** catalogue fixtures now reach the dealer/trade-role branches; the route header comment is true
- [x] R5.8 14 mutations exercised; 13 red in the H-suite, 1 (tenant-membership bypass) red in the E-suite that owns it — recorded honestly rather than claimed here

## I-round closure (2026-09-08)

The independent I-round audit of the H closure returned **RE-AUDIT FAILED — 2 P1, 4 P2**. All
closed. **`75dd17fd` is historical.**

- [x] R6.1 I-1 **P1** the unique index constrained a column the writer never populated — every real row had `idempotency_key NULL`, the partial predicate excluded them all, and the recovery branch was unreachable. The H-round "proof" threw its own 23505. Closed: the canonical writer persists the key to the column (canonical) with metadata as a compatibility mirror; 42703-only pre-migration fallback; recovery scoped to `uq_vehicle_evidence_idempotency_key` by name. **Real PGlite concurrency proof: two concurrent writes → ONE row.** 3 mutations red
- [x] R6.2 I-2 **P1** generic `tenant_users` membership was being turned into Dealer selling authority for admin/government — that table's roles are 'admin'/'manager'/'member' (a mechanic included), no dealer profile or compliance is consulted, and O2's own boundary says Dealer activation has NO governed path. Closed: **fail closed**; only an owner or a genuine dealer effective role has a listing subject. No activation invented. 1 mutation red
- [x] R6.3 I-3 PR body updated to the new candidate, full seven-SHA history preserved
- [x] R6.4 I-4 H15 relabelled handler-level; the database-backed proof replaces the claim
- [x] R6.5 I-5 receiving-side pending/trust guarantee asserted on the real canonical constants
- [x] R6.6 I-6 malformed workbookRoutes header comment repaired
- [x] R6.7 I-7 authority proven through the REAL `authorizeRole` middleware via an additive `supabaseClient` seam (production unchanged); scope stated as middleware-derived, not HTTP. 1 mutation red
- [x] R6.8 **Migration remains applied NOWHERE** — until a separately governed apply, the running system has only the sequential guarantee, and no receipt claims otherwise
- [x] R6.9 Two earlier tests that asserted the wrong authority were INVERTED, not deleted

## M8 tripwires log (fill only if triggered, with evidence, BEFORE building)

- (none)

## Round 7 — J-round closure (candidate `9014cca0` → J head)

- [x] R7.1 J-1 **P1** the deployed writer's `new DatabaseError(message)` destroyed the native 23505, so the race loser got a 500 instead of the winner's id — the I-round proof only passed because its writer threw the RAW error. Closed with `toDatabaseError` (non-enumerable `cause`; public error byte-identical). Closing it exposed a SECOND bug: the guard's `code || cause.code` short-circuited on the truthy `'DATABASE_ERROR'`. Both fixed. 1 mutation red
- [x] R7.2 J-2 **P1** a CLIENT-supplied key was globally unique: measured, a second actor's identical key returned the FIRST actor's evidence id and VIN, and 3 legitimate uploads collapsed to 1 row. Index corrected to `(uploaded_by, idempotency_key)` — CarUp's own convention, which the migration cited and then did not follow. Cross-resource reuse is now an explicit 409, never a silent dedupe. 1 mutation red
- [x] R7.3 J-3 **P1** the `dealer` branch took `ctxTenant` unconditionally, so a platform dealer with a MECHANIC membership in a Garage minted `seller_type=Dealer` for that Garage — I-2 closed the else-branch and missed the branch that carried it. Closed via `resolveDealerListingSubject` over the EXISTING `dealer_profiles(user_id, tenant_id)` binding. No Dealer activation invented. 1 mutation red
- [x] R7.4 J-3 honest boundary recorded: **no product path writes `dealer_profiles.tenant_id`**, so on current data NO dealer has a listing subject — fail-closed, and consistent with O2's documented activation gap
- [x] R7.5 J-4 catalogue now consumes the SAME resolved subject instead of the role string, so it cannot advertise an import execute is certain to refuse. 1 mutation red
- [x] R7.6 J-5 authority proven ACROSS the real Express router boundary (10 cases incl. forged tenant, forged x-user-id, withdrawn dealership); the double refuses an under-scoped dealership query
- [x] R7.7 J-6 PR body corrected from the stale `15 success · 4 skipped · 0 failure` to the measured exact-head result
- [x] R7.8 stale `uploadIdempotency.js` header rewritten to the actual architecture + migration gate; a stray `0x00` byte from the I-round found and removed; all touched files scanned
- [x] R7.9 **Migration still applied NOWHERE**; corrected on the branch BECAUSE it is unapplied. Deployed concurrent idempotency remains UNCERTIFIED until a separate governed apply + verification
- [x] R7.10 Superseded assertions in the C–I suites were UPDATED to the new contract, never deleted; each still tests who may sell / what dedupes

## Round 8 — K-round closure (candidate `83201244` → K head)

- [x] K8.1 K1 **P1** the writer had a 42703 fallback and the READER did not, so on the CURRENT (pre-migration) staging schema the durable lookup's SELECT failed outright and metadata dedupe — which worked before the column was authored — stopped. Reproduced: cold-cache retry created a SECOND row for one operation. Closed with a narrow missing-column-only compatibility read; RLS/auth/FK/syntax/network all still degrade to "treat as new" and never reach it (5 codes asserted, each also asserting no fallback attempt). 1 mutation red
- [x] K8.2 K2 **P1** the key bound to (actor, VIN) but not to the OPERATION: same actor/VIN/key with a different class+subtype+checksum returned the first record and DISCARDED the second upload. Fingerprint is now the existing `evidence_class/evidence_subtype/evidence_type/checksum` columns (no second taxonomy); mismatch = 409. The warm cache carries the operation so the fast path is not a bypass. Compatibility floor documented explicitly. 1 mutation red
- [x] K8.3 K3 **P1 release blocker** the J-round made `dealer_profiles.tenant_id` the SOLE subject; nothing writes it, so every real Dealer lost listing authority. Measured staging: 14 dealer users / 5 memberships / 4 profiles / **0** with tenant_id; all 5 memberships are `admin` of an ACTIVE tenant, but only 4 of those tenants are dealer-typed (the 5th is `import`, excluded). Audit proved **zero backend writes to `tenants` or `tenant_users`** (only migration-002 seeds), so both are genuinely server-controlled. Authority is now role + membership + business-authority membership role + `tenants.type ∈ {dealer,dealership}` + active. 1 mutation red
- [x] K8.4 K3 excluded and REPORTED rather than decided: tenant type `import` (4 tenants, 1 dealer admin) and membership role `manager`. Blast radius of the whole change: 1 vehicle in staging carries a tenant_id, 0 vehicles have a Dealer seller type
- [x] K8.5 K4 **P2** `dealer_vehicle_inventory` advertised `import` from the role string. Root cause was one coarse verb gating five PREPARATION routes plus execution; split into `prepare` (inspect/map/dry-run/assistant) and `import` (execute). Availability preserved, action list narrowed, prose matched. 1 mutation red
- [x] K8.6 K5 **P2** the J-round route proof relabelled accurately as "router + authorizeRole under the test x-user-id fallback"; new suite drives 9 cases through REAL `user_sessions` validation incl. expired/revoked/unknown/foreign-tenant and a session-only route where `x-user-id` must NOT substitute (with positive control)
- [x] K8.7 K6 approval staleness corrected to EIGHT superseding heads; full SHA history preserved
- [x] K8.8 Migration still applied NOWHERE; amended in place (not compensated) since it is unapplied. Three guarantees stated separately: pre-migration sequential ✅, post-migration sequential ✅, post-migration concurrent ✅ in PGlite / **UNCERTIFIED on any deployment**
- [x] K8.9 Recorded but NOT fixed here (other lanes): `staging-integration` has no `timeout-minutes` and hung 78 min during the outage; the marketplace readiness gate reads `supabase.status` and discards it

## Round 9 — L-round closure (candidate `52ec79e2` → L head)

- [x] L9.1 L1 **P1** the K fingerprint missed the canonical REMOTE shape: the route hashes only INLINE files, so workbook evidence stores `checksum = NULL` and a different `file_url` under the same key was deduped and DISCARDED. Closed with a stable remote reference from `storage_bucket`+`file_path` (nothing fetched, no SSRF); signature/expiry stripped; case preserved; CONTENT identity outranks location. 4 mutations red
- [x] L9.2 L2 **P1** K3 fixed CREATION only — measured on real routes, a dealership MECHANIC was refused creation yet could publish/unpublish/reprice/set-status (all 200). Closed with ONE primitive `hasGovernedDealerVehicleAuthority` at 9 seller/commerce surfaces; after the fix mechanic → 403, dealership admin → 200. Service Network, PartSentry and lender/insurer object access deliberately untouched. 4 mutations red
- [x] L9.3 L2 tripwire added: raw seller tenant-equality reappearing in a guarded file fails the suite; a second test pins Service Network keeping its own tenant scope
- [x] L9.4 L3 baseline corrected — all 5 Dealer memberships are `admin` of an ACTIVE tenant but only **4** are dealer-typed (3 `dealer` + 1 `dealership`); the 5th is `import`, excluded. Continuity: **4 of 5 retain listing authority**. `import`/`manager` still excluded pending PO decision
- [x] L9.5 DB authority verified directly — the audit's REASON was wrong: browser roles DO hold table grants on users/tenants/tenant_users; **RLS** is what denies (users: 0 policies; tenants/tenant_users: 1 SELECT-only each). Conclusion holds, reason corrected
- [x] L9.6 **Own finding:** `dealer_profiles` RLS lets `authenticated` INSERT/UPDATE their own row with a WITH CHECK that does not constrain `tenant_id`, so K3's "profile binding grants on its own" was self-assignable. Cannot fire today (custom auth, `auth.users` empty; all 4 profiles have NULL tenant_id) but the binding is now **withdraw-only**. 1 mutation red
- [x] L9.7 L5 wording corrected — `prepare` DOES persist batches/mappings/rows; what it never creates is a vehicle, evidence, listing subject or commerce authority. `export` proven actor-owned (`current_seller_id = actor`, no tenant branch)
- [x] L9.8 dealer_profiles duplicate race AUDITED ONLY — `maybeSingle()` errors on multiples and the resolver denies, so it fails CLOSED and cannot mask a suspension. Reliability debt recorded for a separate lane, direction pinned by a test
- [x] L9.9 K5 scope stated exactly — the workbook router uses `authorizeRole()`; the suite proves session-derived identity through the real router, not that execute is session-only
- [x] L9.10 Migration untouched: L1 changed REQUEST identity only, not the unique-key scope, so no migration churn

## Round 10 — M-round closure (candidate `0ad4747f` → M head)

- [x] M10.1 M1 **P1** a checksum sent beside a remote URL is a caller's assertion; the L rule let it outrank the object location and discard a different document. Closed with `metadata.checksum_source` provenance — content outranks location only when BOTH sides are `server_inline`; historical rows are treated as unverified. No column, no migration, no fetch. 2 mutations red
- [x] M10.2 M2 **P1** stripping every query string collapsed `…?id=A` and `…?id=B` into one reference. Locator rules now depend on what CarUp knows: storage key verbatim · recognised storage URL → key from the path · any other URL opaque with its query intact. Fragment dropped deliberately. 2 mutations red
- [x] M10.3 M3 **P1** link-event read the tenant through a local alias, so a dealership MECHANIC reached the mutation and updated the link (200, 1 row). Closed; after the fix mechanic/garage-admin 403 · dealership admin/owner 200. 1 mutation red
- [x] M10.4 M4 **P1** `/completeness` granted on raw membership despite its own comment claiming it mirrors `loadScopedVehicle`. Closed with the same primitive; Admin and Reviewer preserved; Service Network deliberately NOT routed in. 1 mutation red
- [x] M10.5 **Own find:** `GET /api/vehicles/:vin/evidence` unlocked PRIVATE evidence on a raw membership array. Same class, same closure; the NULL-tenant truthiness guard preserved and now asserted separately
- [x] M10.6 M5 tripwire replaced — the L version never read `server.js` and could not see aliasing. Register of 11 Seller surfaces by file+anchor; any tenant grant in any spelling must reach the governed decision; a second register pins Service Network / PartSentry / lender-insurer as NOT dealer authority; a third fails if an anchor stops resolving. Mutation-proven by restoring the aliased bypass
- [x] M10.7 Three source-shape tests that pinned the OLD spelling were updated, not deleted — including one that asserted the raw completeness equality M4 removed (inverted, with the history recorded)
- [x] M10.8 Migration untouched — M1/M2 changed request identity only, not the unique-key scope

## Predictive closure remediation (candidate `419377f0` → P head) — bounded to four predicted defects

- [x] P1 **REPRODUCED** provenance self-certification. `metadata` is `{ ...clientMetadata, … }` and pre-M nothing overwrote `checksum_source`, so a historical row containing the string `server_inline` was believed: a retry with a DIFFERENT object returned `deduped:true` and the changed document was discarded. Closed with a SERVER-AUTHORED, versioned `carup_provenance` namespace assigned unconditionally AFTER the client spread; the legacy flat key is never read; historical rows have no block and are untrusted. No migration, no rewrite of history. 2 mutations red
- [x] P2 **REPRODUCED** `https://evil.example/storage/v1/object/sign/vehicle-images/A.pdf?id=ONE` and `?id=TWO` both normalised to `vehicle-images/A.pdf`. Storage normalisation now requires the recognised path AND CarUp's own configured origin (`SUPABASE_URL`); a foreign host is opaque and keeps its query. No hard-coded hostname, no fetch, no DNS. 1 mutation red
- [x] P3 **REPRODUCED** the M register omitted two governed surfaces: `POST /api/vehicles/add` existing-Passport reuse and `POST /api/media/upload/document`. Both governed in source, neither covered. Added. Service Network / PartSentry / lender-insurer exclusions preserved. 2 mutations red
- [x] P4 **REPRODUCED** the M5 guard proved source PRESENCE, not behavioural dependence: with the raw grant restored and the governed call's result discarded it stayed GREEN (pass 1 / fail 0). Replaced by a behavioural matrix driving real routes — adversarial actor (platform Dealer + mechanic membership) must get 403 with ZERO rows mutated; legitimate Dealer business actor and canonical Owner must succeed. Against the identical mutation the behavioural proof goes RED. 2 mutations red
- [x] P5 Source register retained for COVERAGE only, with a comment stating it is not the proof of authority
