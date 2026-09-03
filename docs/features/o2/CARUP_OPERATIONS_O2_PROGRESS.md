# O2 — People & Compliance Operations: Progress / Roll-call Tracker

States: `[ ]` not started · `[~]` in progress · `[x]` done with evidence · `[!]` blocked with reason.
Every `[x]` names its evidence. No item may be closed by assertion.

**Branch:** `feat/operations-o2-people-compliance` · **Base:** integrated candidate `dd94c56d`
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

- [ ] P1.1 `supersedeSellerAuthorityOnOwnershipTransfer` in sellerAuthorityService (audit-first, fail-closed, no deletion)
- [ ] P1.2 Invoked from `transitionOwnershipTransfer` on `complete`; failure surfaces loudly, completion stands
- [ ] P1.3 No authority fabricated for the incoming owner
- [ ] P1.4 PGlite behavioral proof (a)–(g) from the lifecycle design
- [ ] P1.5 Full backend suite: zero failures vs base

## P2 — Responsibility projection (ADR vocabulary verbatim)

- [ ] P2.1 Shared six-string vocabulary module; no table, nothing persisted
- [ ] P2.2 Identity mapping + totality test
- [ ] P2.3 Seller Authority mapping + totality test
- [ ] P2.4 Dealer Compliance mapping + totality test
- [ ] P2.5 Transfer display mapping + totality test

## P3 — People & Compliance operating view (read-only)

- [ ] P3.1 Capabilities added to the STATIC map (`person.read_private`, `identity.review`, `dealer_compliance.review`); derived from platformRole/baseRole only; proven sessions only
- [ ] P3.2 `GET /api/admin/people/:userId/review` read model — no writes, no artifacts, no email/phone leakage rules violated
- [ ] P3.3 Workspace page with separate concept rows (email / identity / authority / ownership / dealer) — never one boolean
- [ ] P3.4 Feature registry + nav wiring
- [ ] P3.5 Read-model tests + UI tests + axe

## P4 — Reviewer actions (existing endpoints only)

- [ ] P4.1 Identity decide (approve/reject/resubmit/escalate/note) wired to the identity service routes
- [ ] P4.2 Seller Authority review wired (existing M5 route)
- [ ] P4.3 Dealer compliance decision wired (existing service route)
- [ ] P4.4 Server-derived `allowed_actions` only; UI grants nothing

## P5 — Communications events

- [ ] P5.1 `identity.verification.decided` emitted (emit-only)
- [ ] P5.2 Dealer compliance decision event emitted if absent
- [ ] P5.3 Emission tests; Communications code untouched

## P6 — Privacy + adversarial

- [ ] P6.1 Unauthenticated / x-user-id fallback / forged role / forged tenant refused WITH valid CSRF
- [ ] P6.2 Self-review refused (applicant on own session; seller on own authority)
- [ ] P6.3 Tenant admin refused everywhere in the matrix
- [ ] P6.4 Identity artifacts unreachable outside the owning service's scoped preview

## P7 — Staging certification

- [ ] P7.1 Spec + workflow (dedicated identities; queue-never-cancel; exact-head pair asserted)
- [ ] P7.2 Journeys 1–14 of the certification matrix green
- [ ] P7.3 Desktop + tablet + mobile; axe serious/critical = 0
- [ ] P7.4 Regression roll call at the same SHA (Seller/Passport/Marketplace/Serena/backend-0-fail)
- [ ] P7.5 Credential/test-data cleanup audit
- [ ] P7.6 Certified O2 candidate SHA frozen; STOP for Product Owner review

## M8 tripwires log (fill only if triggered, with evidence, BEFORE building)

- (none)
