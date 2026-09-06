# O2-X7 — Intelligence + Integrated Expansion Certification Receipt (2026-09-04)

**Scope:** certification only — X7 adds no product surface and redesigns no authority.
Suite: `backend/tests/o2-x7-integrated-certification.test.js` (13/13).

## The binding register — 32/32, both dimensions

Machine-checked from `CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md`: §2 carries all
32 stakeholders with a workbook disposition, §10 carries all 32 with an assurance disposition
AND a Communications disposition. No silent omission is possible — the test parses the tables
and fails by row number. Machine/internal actors (15, 22, 25, 29, 30, 32) are pinned as
NOT_APPLICABLE/INTERNAL in both registers: never human subjects, never human recipients.
Deferred rows (9 garage, 10 mechanic) name PR #197, and the branch is proven to contain no
Service Network code — X7 certifies the boundary only.

## Intelligence is advisory — proven, not asserted

- **Write surface:** every `from(table)…insert/update/upsert/delete` chain in
  `backend/services/intelligence/` is enumerated and must name an Intelligence-owned
  observation table (activity ledger, `listing/seller/tenant/platform_daily_metrics`).
  Writing any of the 17 enumerated AUTHORITY tables (verification/lifecycle/biometric/dealer/
  seller-authority/ownership/evidence/users/sessions/registration/finance/insurance) fails the
  suite by file and table name.
- **Outcome surface:** the lane may not call `recordDecision`, `reviewSellerAuthority`,
  `submitSellerClaim`, `transitionIdentityLifecycle`, `onVerificationApproved`,
  `refreshCanonicalTrust` or `assignTrustLevel`, and may not set `publication_status:'published'`,
  `verification_status:'verified'`, `can_publish:true` or `identity_status:'verified'`.
  Intelligence therefore cannot manufacture identity approval, Dealer Compliance, Seller
  Authority, ownership, registration, Vehicle Trust, biometric verification, finance or
  insurance approval.
- **Unknown stays unknown:** a failed projection read may not degrade into a fabricated zero.

## Cross-domain boundaries re-certified on one candidate

X1 retirement holds in source (no `/api/verification` mount, no router import, file deleted) ·
X2/X3/X4/X5/X5A/X6 modules present, with X4's registry resolving the honest `not_configured`
null provider and **no live vendor wired** · assurance grants nothing (the three authority
services never import the projection) · P1-C present exactly once with **no duplicated
migration** from the #194 merge · the canonical six-value `who_must_act` is the only
responsibility language (no `dealer_action`/`customer_action`/`AI_action` anywhere) · the P7
gate is exact-head bound, fail-closed on project, and applies exactly the six O2 migrations.

## Staging cross-reference

P7 PASS at `463507d1`, run `33839364831`, 21/21 across desktop/tablet/mobile — receipt
`CARUP_OPERATIONS_O2_P7_STAGING_CERTIFICATION_RECEIPT.md`.

## Final matrix — measured at the certification candidate `7eba353f`

| Gate | Result |
|---|---|
| Full backend | **5945 tests — 5924 pass / 0 fail / 21 skipped** (the prior clean candidate's 5932 plus exactly the 13 new X7 certification tests) |
| Full web | **1585 / 1585** (164 files) |
| `tsc --noEmit` | clean (exit 0) |
| Production build (`npm run build`, i.e. `tsc -b && vite build`) | success — the gate that caught the X5A build break, now green |
| Lint NET_NEW gate vs `origin/main` | **NET_NEW_ERRORS=0 · NET_NEW_WARNINGS=0** |

One interim web failure was recorded and classified honestly rather than waived: a 5s timeout
in `SellFlow.identification.test.tsx` — a file this programme never touched — while the
production build held ~147% CPU on the same machine. Re-run in isolation: 8/8; full web suite
re-run uncontended: 1585/1585. Contention, not a regression (the documented hazard: never
measure certification numbers from a contended run).

## Unresolved dependencies (carried, not invented)

Dealer activation (no governed applicant→active-Dealer path exists; X7 did NOT write
`users.role='dealer'` or mint tenant membership) · Service Network (PR #197) · expiry-warning
events (needs a scheduled evaluation lane) · biometric provider activation (PO decision + DPA
+ Zimbabwe register) · production promotion (separate gate; nothing deployed).
