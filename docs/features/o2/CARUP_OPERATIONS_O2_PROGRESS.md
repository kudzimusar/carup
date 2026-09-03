# O2 — People & Compliance Operations: Progress / Roll-call Tracker

States: `[ ]` not started · `[~]` in progress · `[x]` done with evidence · `[!]` blocked with reason.
Every `[x]` names its evidence. No item may be closed by assertion.

**Branch:** `feat/operations-o2-people-compliance` · **Base:** integrated candidate `dd94c56d`
**State:** P0–P6 complete, plus the **P1-C effective-authorization correction** (see the correction notice under P1). **P7 (staging certification) designed, NOT started** — see the P7 note below.
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

## M8 tripwires log (fill only if triggered, with evidence, BEFORE building)

- (none)
