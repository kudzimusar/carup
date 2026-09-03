# O2 — People & Compliance Operations: Progress / Roll-call Tracker

States: `[ ]` not started · `[~]` in progress · `[x]` done with evidence · `[!]` blocked with reason.
Every `[x]` names its evidence. No item may be closed by assertion.

**Branch:** `feat/operations-o2-people-compliance` · **Base:** integrated candidate `dd94c56d`
**State:** P0–P6 complete and locally green (backend 5778/0 fail, web 1561/1561, tsc clean, lint NET_NEW 0/0). **P7 (staging certification) designed, NOT started** — see the P7 note below.
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

- [x] P1.1 `supersedeSellerAuthorityOnOwnershipTransfer` in sellerAuthorityService — audit-first fail-closed, revocation never deletion, `SELLER_AUTHORITY_SUPERSEDED` event, disputed rows superseded, idempotent no-op on revoked/absent rows
- [x] P1.2 Invoked from `transitionOwnershipTransfer` on canonical `complete` only; a supersession failure is returned by name in `authority_supersession` while the registry-backed completion stands
- [x] P1.3 No authority fabricated for the incoming owner — asserted in proof (d)
- [x] P1.4 PGlite behavioral proof — `backend/tests/o2-transfer-authority-supersession.test.js`, 6/6 through the REAL migrations and REAL service functions
- [x] P1.5 Full backend suite 5752/0 fail after P1; 5778/0 fail at P6 head

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
