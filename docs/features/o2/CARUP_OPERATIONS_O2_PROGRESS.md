# O2 — People & Compliance Operations: Progress / Roll-call Tracker

States: `[ ]` not started · `[~]` in progress · `[x]` done with evidence · `[!]` blocked with reason.
Every `[x]` names its evidence. No item may be closed by assertion.

**Branch:** `feat/operations-o2-people-compliance` · **Base:** integrated candidate `dd94c56d`
**State:** P0–P6 complete, plus the **P1-C effective-authorization correction** (see the correction notice under P1). **P7 (staging certification) designed, NOT started** — see the P7 note below. **Expansion:** X0–X5 complete (X1 = Document Intelligence authority retirement @ `5e996a7c`; X2 = Registration + Progressive Trust; X3 = Identity Lifecycle + Account Security; X4 = Biometrics + Explicit Consent — ARCHITECTURE CERTIFIED, live provider NOT ACTIVATED; X5 = Dealer onboarding + governed workbook migration @ `0d1a3a74` — see the receipts); **X5A COMPLETE 2026-09-04** (stakeholder workbook catalogue + AI intake; docs-first gate `72acf7e0`; 32 stakeholder dispositions; suites 5906:5885/0/21 + 1585/1585); **X6 COMPLETE 2026-09-04** (identity_assurance.v1 + semantic events; docs-first gate `07222eb3`; suites 5930:5909/0/21 + 1585/1585); **X7 NOT started** — see the expansion section near the end. *(Corrected 2026-09-04: this line previously said "X5+ NOT started" after X5 had completed — the X5 history below was always accurate.)*
**Rule:** do not merge; stop at a certified O2 candidate for Product Owner review.

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

- [ ] P7.1 Spec + workflow (dedicated identities; queue-never-cancel; exact-head pair asserted)
- [ ] P7.2 Journeys 1–14 of the certification matrix green
- [ ] P7.3 Desktop + tablet + mobile; axe serious/critical = 0
- [ ] P7.4 Regression roll call at the same SHA (Seller/Passport/Marketplace/Serena/backend-0-fail)
- [ ] P7.5 Credential/test-data cleanup audit
- [ ] P7.6 Certified O2 candidate SHA frozen; STOP for Product Owner review

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
- [x] X6.10 Receipt authored + docs live throughout; STOP before X7 holds
- [ ] X7 Intelligence + integrated expansion certification (runs only after P7 is unblocked and executed; **must use the X5A stakeholder register as its roll-call**)

## M8 tripwires log (fill only if triggered, with evidence, BEFORE building)

- (none)
