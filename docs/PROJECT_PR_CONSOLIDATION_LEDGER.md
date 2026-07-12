# Project PR Consolidation Ledger

Authoritative record of PR dispositions during release consolidation.
Updated 2026-07-10 (Phase 7C consolidation pass).

| PR | Feature | Disposition | Successor | State | Evidence | Remaining dependency |
|----|---------|-------------|-----------|-------|----------|----------------------|
| #72 | Phase 7C verification governance + native Gate 2 | **Superseded — closed without merge.** All 47 unique commits (101-file delta) integrated onto current main via a conflict-resolved merge (19 hunks; newer-main-behavior preserved). | **#115** `release/phase7c-verification-production` | CLOSED (2026-07-10) | Final head `4487eb1`; totals in closing comment & `docs/releases/PHASE_7C_GATE2_CLOSURE_AND_PRODUCTION_PLAN.md` | Owner device Gate 2 + staging gates transfer to #115 |
| #76 | RC1 mega-branch (marketplace, PartSentry, registry, Diaspora + old Phase 7C snapshot) | Phase 7C snapshot superseded by #115 (commented); **PR closed by the owner 2026-07-10**. | #115 (Phase 7C portion only) | CLOSED (2026-07-10) | Comment + owner closure | Any still-unlanded marketplace/PartSentry/registry/Diaspora content must be tracked in new, scoped PRs if needed |
| #115 | Phase 7C clean current-main release | **Superseded by the #114 release train** — closed by the owner (2026-07-12) after Gates 1–4 passed on it (staging DB 5/5, acceptance 26/26 ×2 + 13/13, P1 idempotency fix). Final branch tip `ce6ed83` merged INTO #114 on 2026-07-13 so no 7C work is stranded. | **#114** `plan/vehicle-trust-full-activation` | CLOSED | `docs/reports/PHASE_7C_STAGING_ACCEPTANCE_REPORT.md`; merge recorded on #114 | — |
| #114 | Unified Production Release Train (Vehicle Trust FA + 7C + Gate 2 + PartSentry) | **Active release vehicle.** Was carrying a stale 7C snapshot (up to `3d67bcf`); unified 2026-07-13 by merging `release/phase7c-verification-production@ce6ed83` (P1 idempotency fix, classifier vision fix, staging tooling, acceptance report, cutover runbook) + current main. Train verification: backend 7C 132/132 · web tsc 0 · mobile tsc 0. | — | OPEN | This ledger + #114 comment | Owner device Gate 2 · owner merge approval · `AUTHORIZE PHASE 7C PRODUCTION CUTOVER` |
| #105 | Referral Wave A identity attribution | Independent program — no 7C overlap | — | OPEN | — | own review track |
| #81 / #90 | Diaspora phases 3–7 / 8–10 | Independent program drafts — no 7C overlap | — | OPEN (draft) | — | own program |

## Notes

- **Shallow-clone correction (2026-07-10):** earlier forensic numbers (66/202 and
  335/66 divergence, "no merge base") were artifacts of a shallow local clone
  (3 grafts). After `git fetch --unshallow`: true divergence main↔#72 was
  347/47 with merge-base `dd0b6e5` (Phase 7B OCR persistence), enabling a
  normal history-preserving merge instead of a blind reapply.
- **Known pre-existing main defect (P2):** `mobile/tests/native-boundary-audit.test.ts`
  fails identically on pristine `main@ce14e32` — the communications tab (#100)
  lacks `NativeFeatureBoundary`. Not introduced by, and not fixed in, #115.
