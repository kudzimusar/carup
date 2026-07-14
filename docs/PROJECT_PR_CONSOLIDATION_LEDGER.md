# Project PR Consolidation Ledger

Authoritative record of PR dispositions during release consolidation.
Updated 2026-07-10 (Phase 7C consolidation pass).

| PR | Feature | Disposition | Successor | State | Evidence | Remaining dependency |
|----|---------|-------------|-----------|-------|----------|----------------------|
| #72 | Phase 7C verification governance + native Gate 2 | **Superseded — closed without merge.** All 47 unique commits (101-file delta) integrated onto current main via a conflict-resolved merge (19 hunks; newer-main-behavior preserved). | **#115** `release/phase7c-verification-production` | CLOSED (2026-07-10) | Final head `4487eb1`; totals in closing comment & `docs/releases/PHASE_7C_GATE2_CLOSURE_AND_PRODUCTION_PLAN.md` | Owner device Gate 2 + staging gates transfer to #115 |
| #76 | RC1 mega-branch (marketplace, PartSentry, registry, Diaspora + old Phase 7C snapshot) | Phase 7C snapshot superseded by #115 (commented); **PR closed by the owner 2026-07-10**. | #115 (Phase 7C portion only) | CLOSED (2026-07-10) | Comment + owner closure | Any still-unlanded marketplace/PartSentry/registry/Diaspora content must be tracked in new, scoped PRs if needed |
| #115 | Phase 7C clean current-main release | **Active release PR** — cut from `main@ce14e32`, 0 behind main at creation, full verification battery green on head | — | OPEN | PR body: backend 131/131 · web 501/501 · mobile 18/18 + guards · builds/exports ✓ | Owner device Gate 2 · staging migrations+advisors · staging deploy+acceptance · `AUTHORIZE PHASE 7C PRODUCTION CUTOVER` |

## Notes

- **Shallow-clone correction (2026-07-10):** earlier forensic numbers (66/202 and
  335/66 divergence, "no merge base") were artifacts of a shallow local clone
  (3 grafts). After `git fetch --unshallow`: true divergence main↔#72 was
  347/47 with merge-base `dd0b6e5` (Phase 7B OCR persistence), enabling a
  normal history-preserving merge instead of a blind reapply.
- **Known pre-existing main defect (P2):** `mobile/tests/native-boundary-audit.test.ts`
  fails identically on pristine `main@ce14e32` — the communications tab (#100)
  lacks `NativeFeatureBoundary`. Not introduced by, and not fixed in, #115.


## Backlog (non-blocking, post-Gate-2)

- **P2 — admin case modal stale after Request Resubmission.** After a successful
  Request Resubmission decision, the open admin case modal may keep rendering the
  previous Rejected/Closed summary until manually refreshed. Fix: auto-refresh the
  case modal/detail and the decision timeline on a successful decision (re-fetch
  the session + decisions, or optimistically apply the returned decision).
  Discovered during the Gate 2 owner device PASS (2026-07-14). Does **not** reopen
  Gate 2.
