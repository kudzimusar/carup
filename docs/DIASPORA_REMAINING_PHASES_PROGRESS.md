# Diaspora Remaining Phases — Progress Ledger

> **Integration-owned file (§7.2).** Only the Program Integrator edits this serially.
> Canonical contract: `docs/CLAUDE_CODE_DIASPORA_REMAINING_PHASES_TO_PRODUCTION_MASTER_DIRECTIVE.md`.
> No milestone may rely on hidden chat memory — state lives here.

## Program coordinates

| Field | Value |
| --- | --- |
| Program branch | `claude/diaspora-phases-8-10-production-program` |
| Base branch | `claude/diaspora-phases-3-7-program` (PR #81), head `5996227` |
| `origin/main` at start | `c25b094` |
| Worktree | `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10` (isolated) |
| Stacked draft PR | **#90** (draft) → base `claude/diaspora-phases-3-7-program` — https://github.com/kudzimusar/carup/pull/90 |
| Status legend | `PASSED` / `FAILED` / `SKIPPED — SECRET UNAVAILABLE` / `NOT RUN` / `PENDING` |

## Wave/track status overview

| Track | Owner role | Status |
| --- | --- | --- |
| R0 — Phases 3–7 release readiness | B (Release Gate & Security) | Discovery done; H9 = `SKIPPED — SECRET UNAVAILABLE`; needs staging secret |
| Track W — XLSX workbook | C (Workbook/Drive) | Discovery done; not started |
| Track D — Google Drive | C (Workbook/Drive) | Activation-ready scaffold verified; keep prod-disabled |
| Phase 8 — Entitlements | D | Discovery done; not started |
| Phase 9 — SafeTrade | E | Discovery done; not started |
| Phase 10 — Trade Graph | F | Discovery done; not started |
| Gate P — Production readiness | A + B | Docs scaffolded; not started |

---

## Milestone log

### M0 — Wave 0 baseline (COMPLETE)
- **Objective:** Establish isolated program branch, durable docs, stacked draft PR, agent ownership.
- **Assigned:** Agent A (Program Integrator).
- **Repository findings:** PR #81 diaspora-scoped (69 files); only shared file touched is
  `web/src/config/featureRegistry.ts`. No unrelated workstream changes in PR #81.
- **Schema findings:** latest migration `20260621094000_diaspora_h7_rpc_execute_grants.sql`;
  full inventory in Discovery §0/§7.
- **Files changed (this milestone):** `docs/DIASPORA_REMAINING_PHASES_DISCOVERY.md`,
  `docs/DIASPORA_REMAINING_PHASES_PROGRESS.md`, `docs/DIASPORA_REMAINING_PHASES_RISK_REGISTER.md`,
  `docs/DIASPORA_PRODUCTION_READINESS_MATRIX.md`, `docs/DIASPORA_PRODUCTION_RELEASE_RUNBOOK.md`,
  `docs/DIASPORA_PRODUCTION_ROLLBACK_RUNBOOK.md`.
- **Migrations:** none.
- **Routes / UI routes:** none.
- **Security decisions:** isolate via worktree (no nav/stash leakage); accept PR #81 as reviewed
  dependency for stacking; treat credential leak (CR-1) as a release-blocking external boundary.
- **Tests:** none added this milestone.
- **CI run IDs:** PR #81 latest `27890263887` — `backend-and-build` PASSED, `playwright` PASSED,
  `staging-integration` **SKIPPED — SECRET UNAVAILABLE** (log-confirmed), Vercel previews green.
- **Staging evidence:** none yet (H9 needs `DIASPORA_STAGING_DATABASE_URL`).
- **Known limitations:** implementation waves 2–7 not started.
- **Blockers:** none for M0.
- **Commit SHA:** `c1e62c8` (baseline docs); ledger PR-coordinate update follows.
- **PR:** #90 (draft) opened targeting `claude/diaspora-phases-3-7-program`.
- **Next milestone:** M1 — Wave 2 entry. Recommended first vertical slice: **Phase 8 entitlement
  foundation** (plan catalog + `diasporaEntitlementService` + one enforced feature end-to-end with
  atomic quota), because §83 sequences "Phase 8 entitlement service and schema first" and Tracks W/
  Drive/SafeTrade all depend on entitlement checks. Parallel-safe: Track W XLSX dependency decision
  + prototype (no shared-file edits). Blocked-on-external: R0 H9 (EB-1), live Drive (EB-2).

---

## Agent ownership (Section 7)

| Agent | Owns | Branch/worktree |
| --- | --- | --- |
| A — Program Integrator | branch strategy, shared-file integration, migration ordering, CI/release gates, PR body, this ledger | program branch |
| B — Release Gate & Security | R0 H9/H10, credential incident, authz review, secret scan, readiness checklist | `claude/diaspora-r0-release-gates` |
| C — Workbook/XLSX & Drive | XLSX parse/gen/template/export, Drive provider + OAuth/vault boundary | `claude/diaspora-workbook-drive-completion` |
| D — Phase 8 Entitlements | plans, entitlements, quotas, metering, billing abstraction, UI/tests | `claude/diaspora-phase8-entitlements` |
| E — Phase 9 SafeTrade | state machine, milestones, gates, disputes, delivery, sandbox provider | `claude/diaspora-phase9-safetrade` |
| F — Phase 10 Trade Graph | event model, projection, queries, dashboards, AI-ready reads | `claude/diaspora-phase10-trade-graph` |
| G — Frontend/A11y/E2E | routes/pages, accessibility, error/loading/empty states, Playwright | `claude/diaspora-e2e-production-readiness` |

**Integration-owned shared files (no concurrent specialist edits):**
`backend/routes/diasporaRoutes.js`, `web/src/App.tsx`, `web/src/config/featureRegistry.ts`,
`web/src/hooks/useCarUpApi.ts`, `web/src/types/index.ts`, `package.json`, `package-lock.json`,
`.github/workflows/*`, this file, `docs/CARUP_WORKSTREAM_SEPARATION_AND_HANDOFF.md`.

## Commit structure (recommended, §84)
`docs: establish remaining diaspora program baseline` → `fix: complete diaspora phases 3 to 7
release evidence` → `feat: add diaspora xlsx workbook contract` → … (see directive §84). Do not
squash milestone history until final review policy is decided.
