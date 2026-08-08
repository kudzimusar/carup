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


## Backlog (non-blocking, post-Gate-2)

- **P2 — admin case modal stale after Request Resubmission.** After a successful
  Request Resubmission decision, the open admin case modal may keep rendering the
  previous Rejected/Closed summary until manually refreshed. Fix: auto-refresh the
  case modal/detail and the decision timeline on a successful decision (re-fetch
  the session + decisions, or optimistically apply the returned decision).
  Discovered during the Gate 2 owner device PASS (2026-07-14). Does **not** reopen
  Gate 2.

---

## Reunification addendum (2026-08-08) — dispositions since 2026-07-10

This ledger's rows above were last updated 2026-07-10 and stop at PR #115. Authoritative
continuation, verified against GitHub on 2026-08-08 (full evidence:
`docs/PROJECT_REUNIFICATION_REPORT.md`):

| PR | Branch | Disposition |
|---|---|---|
| #114 | `plan/vehicle-trust-full-activation` | **MERGED 2026-07-14** (release train: VTOS Full Activation + 7C + Gate 2 + PartSentry). Phase 7C production cutover executed same day (`docs/releases/PHASE_7C_PRODUCTION_COMPLETION_REPORT.md`). |
| #116 | `docs/phase7c-production-completion` | MERGED 2026-07-14 |
| #117–#120 | referral V1 stage 0/4 governance + stage 5 acceptance | MERGED 2026-07-16/17 |
| #121 / #105 | referral stage-5 closure docs / Wave A | Auto-closed by the CR-1 history rewrite (2026-07-26); re-created as **#123 / #124** (both open drafts) |
| #122 | `security/cr1-credential-remediation` | MERGED 2026-07-26 (CR-1 executed: history rewrite + rotation; see `docs/security/CR1_EXECUTION_LEDGER.md`) |
| #125 / #126 | diaspora ledger #19 / #20 hardening | MERGED 2026-07-26/27 |
| #129 | `claude/diaspora-go-to-market-activation` | MERGED 2026-07-28 (GTM Issue #127 integration lane) |
| #130 | `fix/diaspora-profile-loop-dashboard-truth` | MERGED 2026-07-27 |
| #131 / #132 | staging GTM migration dispatcher / re-pin | MERGED 2026-07-27 |
| #133 / #134 | staging UAT tenancy bootstrap / TLS fix | MERGED 2026-07-29 |
| #135 / #136 | trade-graph hotfix / workbook schema remediation | MERGED 2026-07-29 |
| #137 | `fix/issue-127-uat-remediation` | OPEN draft, base = current main, CI green; **merge-blocked by one credentialed staging browser retest (owner gate)** |
