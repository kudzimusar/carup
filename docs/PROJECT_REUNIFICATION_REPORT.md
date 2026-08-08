# CarUp Project Reunification Report

**Date:** 2026-08-08
**Prepared by:** reunification audit session (Claude Code)
**Baseline:** `main` @ `f313fae6d4e66a5b70296e50cbd8f4ac0820f084` (Merge PR #136, 2026-07-29)
**Integration branch:** `integration/project-reunification`

> **Purpose.** One CarUp. One canonical `main`. One current product. This report is the
> authoritative record of what the unified project contains, what is intentionally outside it,
> the disposition of every local worktree and branch, and the single canonical continuation
> point for all future work. Every claim below is evidence-backed (commit ancestry, blob-hash
> comparison across the CR-1 history rewrite, PR metadata, GitHub Actions run IDs, migration
> ledgers, or test runs executed during this audit).

**Baseline inventory at audit start:**

```text
CANONICAL MAIN SHA:    f313fae6d4e66a5b70296e50cbd8f4ac0820f084
DATE:                  2026-08-08
OPEN PR COUNT:         3   (#137, #124, #123)
OPEN ISSUE COUNT:      11
REMOTE BRANCH COUNT:   82 (plus main)
LOCAL WORKTREE COUNT:  34 registered (2 stale/prunable) + 2 standalone clones + 1 backup dir
STASH COUNT:           16 (all preserved as patches in carup-cr1-backups)
```

**Structural fact that shaped this audit:** on 2026-07-26 the repository history was rewritten
(CR-1 credential remediation, `git-filter-repo`, PR #122; see
`docs/security/CR1_EXECUTION_LEDGER.md`). The rewrite was content-preserving (old `main` tip tree
byte-identical to the rewritten tree), but it severed commit ancestry for every branch created
before it. All absorption verdicts for pre-rewrite branches therefore rest on **content evidence**
(blob-hash identity via the preserved mirror at `carup-cr1-backups/carup-mirror.git`, `git cherry`
patch-id matching, and per-file diffs), not on `merge-base` ancestry.

---

## 1. What is now in the unified project

Every major program is present in current `main`. Feature-by-feature, with the PRs that carried it
and the verification used:

| Program | In main via | Evidence |
|---|---|---|
| **Marketplace V1** (buyer/seller/admin/mobile, moderation, inquiries) | PRs #73, #83 (+ earlier #4–#7) | 87 tracked marketplace files; pages `Marketplace/VehicleSearch/VehicleDetail/MarketplaceCompare/SellVehicle/MarketplaceModeration`; closeout `docs/marketplace/MARKETPLACE_V1_MVP_CLOSEOUT.md` |
| **Vehicle Life Intelligence M1–M6** (taxonomy/provenance, ingestion, AI temporal disclosure, buyer report, governance, infra) | Integration PR #98 (merged 2026-07-02); siblings #92–#97 closed superseded | 12 of 15 signature files blob-IDENTICAL in main, 3 evolved supersets; 6 VLI migrations applied to staging **and production** under the VTOS cutover |
| **Vehicle Trust OS** (core MVP + differentiated + full activation control plane) | PRs #103, #106, #114 (all merged); production cutover EXECUTED 2026-07-03 (16/16 migrations, smoke 21/21) and Full Activation staging-verified (8 further migrations) | `docs/vehicle-trust-os/FINAL_COMPLETION_REPORT.md`, `release/ACTIVATION_READINESS_AND_ROLLBACK.md`, `release/MIGRATION_RLS_STORAGE_MATRIX.md` |
| **PartSentry** (read-side suppression + governed review workflow) | PR #11 content ported into main (`20260710130000_partsentry_review_requests.sql` header: "ported from PR #11"); carried by #114 | `partsentryReviewRoutes.js`, `trustPermissionService.js`, `trust-governance.test.js` blob-IDENTICAL; review service hardened superset |
| **Referral Engine** (phases 1–7, RC, V1 stages 0–4 + stage-5 remediation) | PRs #62–#71, #88, #117–#120 (all merged) | 92 tracked referral files; stage ledger in `docs/releases/REFERRAL_V1_ACCEPTANCE_AND_PRODUCTION_CLOSURE.md` |
| **Navigation Intelligence** (registry, analytics, gates, mobile drawer) | PRs #74, #94 (merged); #66 closed superseded (main's `MobileNavDrawer.tsx` is the Milestone-4 successor) | 56 tracked navigation files; `nav-release-gate-fixes` branch proven blob-identical ancestor of pre-rewrite main |
| **Diaspora Trade OS** (phases 1A–2C, 3–7, 8–10, EB-5 production cutover, GTM activation) | PRs #78, #81, #90, #125, #126, #129–#136 (all merged) | 361 tracked diaspora files; migration ledger #3–#20 production-applied; GTM #21–#27 staging-applied (Actions run `30309507308`) |
| **Communications / Agent 8** (omnichannel engine, WhatsApp + Telegram LIVE, worker scheduler, command center) | PRs #100, #109, #111 (merged) — **plus the stranded configuration validator integrated by this branch** (see below) | 116 tracked communication files; production activation ledger `docs/agent-8-omnichannel/PRODUCTION_ACTIVATION_LEDGER.md` |
| **Native Mobile** (monorepo `mobile/`, Phase 7C verification loop, Gate 2 closed) | Phase 7C via #114/#116; production cutover EXECUTED 2026-07-14 | 261 tracked mobile files; full `(auth)/verification/*` capture flow (9 screens); `docs/releases/PHASE_7C_PRODUCTION_COMPLETION_REPORT.md` |
| **Security programs** (containment, CR-1 rewrite + rotation, diaspora grant hardening) | PRs #83, #122, #125, #126 (merged); CR-1 CLOSED (42/42 canonical UAT) | `docs/security/CR1_EXECUTION_LEDGER.md`; freeze manifests + mirror in `carup-cr1-backups/` |

### Added by the integration branch (the only work found stranded anywhere)

The audit examined all 82 remote branches, 99 local heads, 34 worktrees, 16 stashes, and 2
standalone clones. **Exactly one piece of unmerged implementation existed anywhere:**

1. **Communication configuration validator** — commit `90b774e` on
   `fix/issue-108-agent8-admin-reply-queue`, authored 2026-07-16 *after* its PR #113 was closed;
   never reached main through any PR. Integrated here as `6c45e3d`:
   `communicationConfigurationValidator.js` (fail-closed READY/WARNING/BLOCKED per-provider
   validation, fake-adapter detection), startup validation + `communications` block in
   `/api/health`, truthful `/api/communications/health` (503 on BLOCKED — previously
   unconditional `success: true`), 4 tests (communication suite 131 → 135, all pass), and
   `docs/agent-8-omnichannel/CONFIGURATION_VALIDATOR.md`. **This is the one behavioral change in
   this PR** and it directly serves open Issue #110 ("truthful admin status"). Note for the owner:
   on deployments without provider credentials (e.g. `carup-backend`), `/api/communications/health`
   will now truthfully report BLOCKED/503 instead of success.
2. **Phase 7C runbook operational history** (`49fe721`) — 58 append-only lines recording the
   executed 2026-07-14 owner-authorized app-tier rollback (deployment IDs, alias confirmations,
   production test-data cleanup), previously stranded on `release/phase7c-verification-production`.
3. **Migration-ledger truth reconciliation** (`683efd7`) and **integration-request resolutions**
   (`d324fba`) — see §5 and §6.

---

## 2. What remains outside intentionally

Nothing else was left out by accident; each remaining item is gated, and merging it now would
violate the gate. Categories per the directive:

### Owner-UAT-gated
- **PR #137** (`fix/issue-127-uat-remediation`, draft, base = current main, all real CI green,
  MERGEABLE/CLEAN). Status: `IMPLEMENTATION COMPLETE · INTEGRATION CANDIDATE · MERGE BLOCKED BY
  FINAL ACCEPTANCE GATE` — one credentialed R7B staging browser retest remains, per the PR body
  itself. Not merged by this audit.
- **PR #123** (`docs/referral-v1-stage5-closure`, draft, docs-only Stage-5 acceptance receipt).
  It is the owner's acceptance artifact; `referral-ci` is red on its stale base. Recommend: rebase
  onto current main to refresh CI, then owner merges as the act of accepting Stage 5.
- Phase 7C admin case-modal refresh defect (P2, recorded in the PR consolidation ledger) and the
  4 skipped deployed-staging UAT specs (need an owner-provisioned VERIFIED stock-role fixture).

### Security-gated
- **Issue #101 (P0):** ~27 production tables with RLS disabled — table-by-table remediation
  outstanding. This is also why a full live multi-tenancy proof cannot honestly pass today (§7).
- **Issue #77:** production access-control hardening — the standing public-launch gate.
- **Owner follow-up from EB-5:** rotate the production DB password again (it transited an operator
  terminal during EB-5; recorded in the cutover receipt). Referral Stage 9 additionally requires a
  separately authorized credential-rotation workflow.
- **Staging CSRF proof gap:** staging backend runs `NODE_ENV=test`, so CSRF cannot be proven
  there; Referral Stage 9/11 carries the production-side proof obligation.
- Historical git exposure of the production project ref was intentionally preserved by CR-1
  (owner-scoped decision); the credential-shaped URIs were purged (72 → 0).

### External-contract / live-money-gated (all fail-closed OFF, engineering complete)
- Diaspora ledger **#21–#27 production application** (staging-applied; production gated on explicit
  release authorization).
- Real-money SafeTrade (EB-4 + ST-3 legal determination), live billing provider (EB-3, ADR-001
  corporate-entity precondition), live Google Drive OAuth + managed vault (EB-2), Trade Graph UI
  flags, scheduler activation (VAULT request §2 Vercel cron — deferred; `backend/vercel.json` is
  `{}` and `enabled` defaults FALSE in ledger #27).
- Vehicle Trust OS provider activations: ZIMRA/CVR/ZINARA/VID/CID, licensed insurer, regulated
  lender, real-money escrow — all `ENGINEERING_COMPLETE_EXTERNAL_CONTRACT_REQUIRED`.
- VLI live provider APIs, production infra accounts (Redis/Cloudflare/Fly/PITR), live AI quality
  evaluation.

### Hardware-gated
- Mobile certification on physical Android/iOS and Android emulator: engineering complete, zero
  platforms exercised on hardware (`docs/vehicle-trust-os/mobile-certification/MOBILE_CERTIFICATION_REPORT.md`).

### Superseded / historical (intentionally NOT integrated)
- **PR #124** (Referral Wave A, draft, CONFLICTING with main). Explicitly excluded from Referral V1
  closure governance ("do not merge, rebase, deploy, or migrate" — scope lock in
  `docs/releases/REFERRAL_V1_ACCEPTANCE_AND_PRODUCTION_CLOSURE.md`). Needs a rebase and a program
  decision after V1 closes; not reunification's call.
- All E-class branches in §4 (docs/planning-only branches, release pointers, superseded snapshots).
- The uncommitted alternative migration layout rescued from `carup-refv1-fix` (see §3): it deletes
  two migrations that main kept (`20260715205718…`, `20260716033000…`) and both are
  **production-applied context** — the rescued form is an abandoned iteration, preserved on
  `rescue/carup-refv1-fix-20260808` but not integrated. Its two novel HTTP/integration test files
  are available there if a future referral session wants them.

---

## 3. Worktree disposition

All paths under `/Users/shadreckmusarurwa/Project AI/` unless noted. "SAFE TO REMOVE" is a
recommendation with evidence — **nothing was deleted by this audit** (directive rule 3). Removal
is `git worktree remove <path>` + optional `git branch -d`; do it only after this PR merges.

| Worktree | Branch @ HEAD | State | Disposition | Evidence |
|---|---|---|---|---|
| `carup-kimi` | `main` @ f313fae | clean | **KEEP** — primary worktree | — |
| `carup-cr1` | `fix/diaspora-profile-loop-dashboard-truth` @ 859caed | clean | SAFE TO REMOVE | PR #130 merged; post-merge tip diff vs main empty on all 4 touched files |
| `carup-diaspora-3-7` | `claude/diaspora-phases-3-7-program` @ bbcf421 | clean | SAFE TO REMOVE | PR #81 merged 2026-07-25; branch pushed |
| `carup-diaspora-8-10` | `claude/diaspora-phases-8-10-production-program` @ 7ae80e3 | clean | SAFE TO REMOVE | PR #90 merged 2026-07-26; branch pushed |
| `carup-gtm` | detached @ f313fae (= main) | clean | SAFE TO REMOVE | identical to main tip |
| `carup-gtm-billing` | `claude/gtm-billing-lane` @ e9fb768 (local-only) | clean | SAFE TO REMOVE | all 3 unique commits absorbed into main via #129 (`git cherry` twin 5aa38b6 + adapted re-commits 4b470a5/af9861b; all 10 symbols verified in main) |
| `carup-gtm-drive` | `claude/gtm-drive-lane` @ 6e2a134 (local-only) | clean | SAFE TO REMOVE | all 5 unique commits patch-identical in main (`git cherry`) |
| `carup-gtm-ent` | `claude/gtm-ent` @ f1ae98d (local-only) | clean | SAFE TO REMOVE | 3 commits re-committed to main (db60999/0f0163c/ed79345); main strict superset |
| `carup-gtm-sched` | `claude/gtm-sched` @ 36e2568 (local-only) | clean | SAFE TO REMOVE | pure ancestor of main (0 ahead) |
| `carup-gtm-vault` | `claude/gtm-vault` @ 82aae87 (local-only) | clean | SAFE TO REMOVE | all 3 commits patch-identical in main; main newer (fff8813 lease fix) |
| `carup-hotfix-audit` | `hotfix/audit-logger-fk-safe-fallback` @ 681de89 | clean | SAFE TO REMOVE | PR #102 merged |
| `carup-int` | `integration/vehicle-life-m1-m6` @ e0c94fd | clean | SAFE TO REMOVE | PR #98 merged |
| `carup-issue110` | `feature/agent-8-omnichannel-communication-engine` @ f21808f | `.gitignore` mod + untracked `.mcp.json` (local tool config, no secrets) | SAFE TO REMOVE **after this PR merges** | PR #100 merged; the branch's stranded validator commit is integrated by this PR (`6c45e3d`) |
| `carup-m1`…`carup-m6` | `feat/vehicle-life-m1…m6` @ 6c885d0/a174bef/12a2bbc/0d5ac0c/ae23657/cf721ad | clean | SAFE TO REMOVE (all six) | absorbed via #98; sibling PRs #92–#97 closed superseded |
| `carup-main-lint-baseline` | detached @ c25b094 | clean | SAFE TO REMOVE | historical lint-baseline checkout (pre-rewrite main base) |
| `carup-navigation-release` | `nav-release-gate-fixes` @ 8091f33 (local-only) | clean | SAFE TO REMOVE | entire branch ancestor of pre-rewrite main; spot blobs identical in current main (5320dd4f, f6ffd41) |
| `carup-ops-dispatcher` | `ops/diaspora-dispatcher-repin` @ 4267d1f | clean | SAFE TO REMOVE | PR #132 merged; workflow file diff vs main empty |
| `carup-pa` | `plan/vehicle-trust-full-activation` @ 117b997 | clean | SAFE TO REMOVE | PR #114 merged 2026-07-14 |
| `carup-phase7c` | `phase-7c-native-verification-production-loop` @ 4487eb1 | clean | SAFE TO REMOVE | PR #72 closed superseded; tip ancestor of pre-rewrite main; 7C shipped via #114/#116 |
| `carup-phase7c-release` | `release/phase7c-verification-production` @ 4839ee7 | untracked `.mcp.json` only | SAFE TO REMOVE **after this PR merges** | PR #115 closed; sole residue (58 runbook lines) ported by `49fe721` |
| `carup-prod-migration-2e88f50` | detached @ 2e88f50 | clean | SAFE TO REMOVE | historical production-migration checkout |
| `carup-referral-wt` | `feat/referral-final-uat-release` @ e7a2f60 | clean | SAFE TO REMOVE | PR #88 merged |
| `carup-refv1-docs` | `docs/referral-v1-stage0-baseline` @ aa775a2 | clean | SAFE TO REMOVE | PR #117 merged |
| `carup-refv1-fix` | `fix/referral-v1-stage4-journey-closure` @ dd50e85 | **was DIRTY: 23 modified + 3 untracked** | **RESCUED → ARCHIVE** | full dirty state preserved verbatim on `rescue/carup-refv1-fix-20260808` (@ `62c0c7c`, pushed to origin) via temp-index snapshot; worktree untouched. Committed work = pre-rewrite equivalent of merged PR #118. Remove after owner reviews the rescue branch |
| `carup-refv1-stage1` | detached @ 6214f3d | clean | SAFE TO REMOVE | historical stage-1 checkout (= #116 docs commit) |
| `carup-security-containment` | `security/production-access-containment` @ ac1fdee | clean | SAFE TO REMOVE | PR #83 merged |
| `carup-vli-pr98` | `fix/pr98-ci-20260622` @ bf504c3 (local-only) | clean | SAFE TO REMOVE | merged via #98 pre-rewrite; blobs identical in main (ef22d9b, dcd7576) |
| `/private/tmp/carup-deploy` | detached @ fff8813 | **stale** (gitdir gone) | SAFE TO REMOVE via `git worktree prune` | prunable per `git worktree list` |
| `/private/var/…/lint-base-iCzW6n` | detached @ d7ce28b | **stale** (dir gone) | SAFE TO REMOVE via `git worktree prune` | prunable |

**Non-worktree directories:**

| Directory | What it is | Disposition |
|---|---|---|
| `car-up` | **Different repository** — full clone of `kudzimusar/carup-os` (4 modified + 14 untracked files) | **OUT OF SCOPE — KEEP, flag to owner.** Not part of `kudzimusar/carup`; this audit did not touch it. Its dirty state belongs to the carup-os product |
| `carup-freshclone` | Clean clone of `kudzimusar/carup` @ 44dfccd (post-rewrite main, no local branches/stashes) | SAFE TO REMOVE |
| `carup-cr1-backups` | CR-1 pre-rewrite archive: mirror repo, `carup-pre-cr1-all.bundle`, `preserved-stash.bundle`, 15 stash patches, manifests, checksums | **KEEP — ARCHIVE PERMANENTLY.** This is the only pre-rewrite history that exists anywhere; it also carries this audit's absorption proofs |

**Stashes (16 in the shared repo):** all preserved as objects and — for the 15 pre-CR-1 ones — as
patch files + bundle in `carup-cr1-backups`. Disposition: **ARCHIVE — do not pop.** Every stash
predates programs that later merged (aborted navigation cleanups, pre-pull WIP, workbook WIP,
phase-7c UI WIP now shipped, premium-evidence WIP). Governance note stands: the
`wip-communication-before-vehicle-trust` stash "must not be applied" per
`docs/CARUP_WORKSTREAM_SEPARATION_AND_HANDOFF.md`. `refs/preserved/diaspora-wip-cc42b41` remains
intact (byte-identical re-creation, per CR-1 plan).

---

## 4. Branch and PR classification (A–G)

Full 82-branch census. Verdicts and method:

- **A — already absorbed into main (67 branches).** Every branch whose PR merged (list:
  #1–#10 era, #12–#15, #20/#21/#28/#44, #57, #60–#65, #67–#69, #71, #73, #74, #78, #81, #83, #88,
  #90, #91, #94, #98, #100, #102, #103, #106, #109, #111, #112, #114, #116–#120, #122, #125, #126,
  #129–#136), plus content-verified locals: 5 GTM lanes, `nav-release-gate-fixes`,
  `fix/pr98-ci-20260622`, `ops/diaspora-dispatcher-repin`, `fix/diaspora-profile-loop-dashboard-truth`,
  `checkpoint/pr129-freeze-e002b86`, `safety/local-main-before-remote-align-20260717` (legal
  endpoints verified in main), and closed-PR branches proven ported: PartSentry #11, shipment
  read-scoping #58, VLI #92–#97, Phase 7C #72 + `mimo/phase7c-verification-case-management`.
- **B — unique work not in main (1):** the communication configuration validator on
  `fix/issue-108-agent8-admin-reply-queue` — **integrated by this PR** (`6c45e3d`). No B-class
  work remains outside main.
- **C — open and ready to integrate (0).** No open PR is both gate-free and canonical.
- **D — open but blocked by an explicit gate (2):** PR #137 (owner staging UAT retest),
  PR #123 (owner acceptance receipt; stale-base CI). Both documented in §2, neither merged.
- **E — superseded / historical (12):** #66 `feature/mobile-registry-drawer` (superseded by
  Milestone-4 `MobileNavDrawer`), #76 `release/carup-v1-rc1`, #115 `release/phase7c-verification-production`
  (residue ported), `release/production` (deploy pointer @ old-main commit), 7 docs/planning-only
  branches (#75, #79, #80, #82* , #85*, #86, #87, #89, #99*, #104 — *those marked were also
  content-identical in main, i.e. A-grade docs), plus local snapshots
  `backup/phase-2b-from-fix-evidence-backend-blockers` and `rescue/accidental-vli-on-navigation-20260622`.
- **F — dirty local work requiring rescue (1):** `carup-refv1-fix` — rescued to
  `rescue/carup-refv1-fix-20260808` @ `62c0c7c` (pushed). Assessed as an abandoned alternative to
  the merged form of PR #118 (§2), preserved not integrated.
- **G — unknown (0).** Nothing remains unclassified.
- **PR #124** (Wave A): D/E hybrid — open draft, CONFLICTING, excluded by the Referral V1 scope
  lock; requires an owner program decision, not integration.

---

## 5. Migration and schema reconciliation

- **Runner truth:** `backend/db/migrate.js` applies `database/migrations/*.sql` in lexical
  filename order and tracks by **full filename** in `schema_migrations(version)`. The 8
  duplicate-timestamp-prefix groups (002, 013, 014, 20260621120000, 20260621130000,
  20260621140000, 20260624120000, 20260626120000) are therefore deterministic and cannot collide.
  No duplicate full filenames exist (100 migration files checked).
- **Applied-state ledger (authoritative summary):**
  - Vehicle Trust OS migrations 1–16: **production-applied 2026-07-02/03** (16/16, SHA-verified,
    smoke 21/21). Full-activation migrations (8): **staging-applied**, production gated.
  - Phase 7C: `20260618040000` + `20260618050000` **production-applied 2026-07-14** (one
    transaction, PITR restore point recorded).
  - Communication scheduler `20260712100000`: **production-applied 2026-07-12** (pg_cron live).
  - Diaspora ledger **#3–#20: production-applied** (EB-5 2026-07-26 + #20 on 2026-07-27);
    **#21–#27: staging-applied 2026-07-27** (Actions run `30309507308`, verified success via
    `gh run view` during this audit), **production NOT applied** — gated.
  - Navigation governance/analytics migrations: staging-applied; production application remains
    a PO-authorized post-merge step per `docs/navigation-intelligence/PRODUCTION_INTEGRATION.md`.
- **Contradictions found and resolved in-place this audit** (dated supersession blocks, original
  text preserved): the Diaspora ledger's stale "#21–#27 NOT APPLIED" header/rows; the Marketplace
  closeout §6 "production not applied" statement (superseded by EB-5 ledger #4/#6); the PR
  consolidation ledger frozen at 2026-07-10.
- **Contradictions found and left OPEN (owner/next-session attention):**
  1. **Two-production-databases identity conflict** —
     `docs/agent-8-omnichannel/PRODUCTION_ACTIVATION_LEDGER.md` treats `vhmnajoeicasaigiophh` as
     the comms/staging DB behind `carup-backend-staging`, while every VTOS/7C/Diaspora cutover doc
     treats it as **production**; `carup-backend` (259 real vehicles) points at another database.
     The 2026-07-12 Command-Center promotion block (route parity PASS, data parity FAIL) is the
     symptom. This is the most load-bearing unresolved question in the corpus and only the owner
     can rule on it.
  2. Diaspora ledger rows **#3–#10 staging cells are unreceipted** (header asserts applied;
     no dated receipt) — flip only after a credentialed `schema_migrations` read.
  3. `DIFFERENTIATED_MVP_STATUS.md` (WS3–WS8 "not built") vs `FINAL_COMPLETION_REPORT.md`
     (complete + cutover) — same date; the earlier snapshot is not marked superseded.
  4. VLI `PROGRAM_FINAL_REPORT.md` §6 still says its migrations were never applied to a real
     database — superseded by the VTOS staging/production application, unannotated.
  5. `docs/DIASPORA_REMAINING_PHASES_RISK_REGISTER.md` re-asserts CR-1 OPEN (2026-07-26) while
     the CR-1 execution ledger records CLOSED with the canonical 42/42 UAT — the risk-register row
     predates CR-1's final phases; ST-3's own closure (#22/#23) is likewise not reflected there.
  6. Issue #77's status is asserted only in the marketplace closeout; no later doc re-states it.
  7. Legacy numbered migrations 001–015 are SQLite-flavored and were never run against Supabase
     (`docs/DATABASE_MIGRATION_RECONCILIATION.md`); rows #1/#2 of the diaspora ledger record this.

---

## 6. Verification evidence (this audit, this machine)

Baseline `main` @ f313fae and the integration branch were both verified on 2026-08-08:

| Check | Baseline main @ f313fae | Integration branch @ d324fba |
|---|---|---|
| Web lint (raw eslint) | exits 1 — **143 errors / 9 warnings** (documented pre-existing baseline; canonical gate below) | same inventory |
| **Canonical lint gate** (`scripts/lint-baseline-gate.mjs` vs origin/main) | — | **PASS — NET_NEW_ERRORS=0, NET_NEW_WARNINGS=0** |
| Web build (`tsc -b && vite build`) | **PASS** (32.8s) | **PASS** (2m44s under load) |
| Web unit (vitest) | **747/747 pass, 82 files** | **747/747 pass, 82 files** |
| Backend governance/integration suite (`backend/tests/run-tests.js`) | **PASS, exit 0** ("ALL GOVERNANCE, INTEGRATION, & TRUST ENGINE TESTS PASSED") | **PASS, exit 0** |
| Backend full suite (`node --test backend/tests/*.test.js`, CI parity) | 12 environment-dependent failures (see below) | **2682 tests: 2658 pass · 12 fail (env) · 12 skipped** |
| Communication suite (validator integrated here) | 131 tests | **135/135 pass** (+4 validator tests) |
| Migration verification (PGlite real Postgres, Up/Down/re-Up) | — | **PASS** (19 tables after re-up) |
| Diaspora ledger harnesses (`database/test/diaspora_*_check.mjs`, 11 harnesses incl. #26 50/50, #27) | — | **11/11 PASS, 0 failures** |
| Tenant-scope suites (drive-vault scope + trade-graph isolation) | — | **16/16 pass** |
| Mobile `tsc --noEmit` | clean | clean |
| Mobile vitest | 53/53 | **53/53** |

**The 12 backend failures are pre-existing and environment-dependent, not introduced by this
branch.** Attribution was proven directly: the same test files
(`provision-staging-qa-accounts.test.js` — live staging accounts/DNS;
`verification-ocr-provenance.test.js` and `verification-terminal-and-consistency.test.js` — require
a real OCR provider key, absent in this environment) fail with identical test names on a pristine
checkout of baseline `f313fae` (run in the clean detached `carup-gtm` worktree). This matches the
documented precedent: the VTOS release qualification recorded `provision-staging-qa-accounts` as
its one known live-infra failure, and the 7C staging report records the missing `GEMINI_API_KEY`.
In CI these paths run with secrets (PR #137's full CI is green on this same base).

Real staging/production behavior (Vercel deploys, credentialed browser UAT, live provider calls)
was NOT exercised by this audit — the canonical deployed-staging evidence remains the CI-attested
runs cited in §5 and the receipts in the program docs.

---

## 7. Multi-tenancy: honest status

**What is proven locally (this audit):** tenant-scope suites
`diaspora-drive-vault-tenant-scope.test.js` + `diaspora-trade-graph-route-isolation.test.js`
(16/16 pass); the real-PostgreSQL ledger harnesses (`database/test/diaspora_*_check.mjs`) prove
the RLS + grant + RPC-ACL contracts (anon = NONE, authenticated = SELECT-only or none,
service_role-only mutation RPCs) against PGlite-backed real Postgres.

**What exists for staging:** the bounded UAT tenancy bootstrap (`diaspora-staging-uat-tenancy.yml`
+ `backend/scripts/staging-uat-tenancy-bootstrap.mjs`, PRs #133/#134) — credential-gated,
owner-triggered; canonical deployed-staging UAT last ran 74 passed / 0 failed / 4 skipped.

**What is NOT proven, and why it cannot honestly be claimed today:** the directive's full
Tenant-A/B/C live isolation proof (dealer↔dealer↔garage, RLS + backend enforced, no mocks).
Blockers: (a) **Issue #101 — ~27 production tables still have RLS disabled**, so a live proof
would currently *fail*, correctly; (b) staging credentials are CI-secret-only post-CR-1 (no local
credentialed session); (c) multi-role garage/dealer fixtures need owner-provisioned verified
roles (the same gap behind the 4 skipped staging specs). **Multi-tenancy live proof is therefore
recorded as an open release blocker, not claimed.** The sanctioned path: close #101, then run the
staging tenancy workflow with a three-tenant matrix.

---

## 8. Canonical continuation point

```text
AUTHORITATIVE REPOSITORY:  https://github.com/kudzimusar/carup
AUTHORITATIVE BRANCH:      main
AUTHORITATIVE SHA:         f313fae6d4e66a5b70296e50cbd8f4ac0820f084
                           (after this PR merges: the merge commit of
                            integration/project-reunification supersedes it)
STAGING FRONTEND:          carup-staging.vercel.app        (Vercel project `carup-staging`)
STAGING BACKEND:           carup-backend-staging.vercel.app (Vercel project `carup-backend-staging`)
STAGING DATABASE:          eoyenigwevnxwwhyhaer (ap-southeast-2) — schema through diaspora ledger #27
PRODUCTION FRONTEND:       carup.vercel.app                 (Vercel project `carup`)
PRODUCTION BACKEND:        carup-backend                    (see §5 open contradiction #1)
PRODUCTION DATABASE:       vhmnajoeicasaigiophh (ap-south-1) — schema through diaspora ledger #20,
                           VTOS 16/16, Phase 7C, comms scheduler; all risky flags fail-closed OFF
PRODUCTION STATUS:         LIVE (WhatsApp + Telegram comms live; no live money movement anywhere)

OPEN RELEASE BLOCKERS (each named in §2/§5/§7):
  1. PR #137 — one credentialed staging browser retest (owner)
  2. Issue #101 — P0 RLS remediation (~27 production tables)
  3. Issue #77 — production access-control hardening gate
  4. Production DB password re-rotation (EB-5 follow-up, owner)
  5. Diaspora ledger #21–#27 production application (owner authorization)
  6. Two-production-databases identity ruling (owner; §5 open contradiction #1)
  7. Referral V1 stages 5–13 closure (PR #123 acceptance onward; Stage 9 credential rotation)
  8. External activations: EB-2/EB-3/EB-4, VTOS provider contracts, mobile device certification
  9. Diaspora ledger rows #3–#10 staging receipts (credentialed schema_migrations read)
```

**Rule for future agents:** work only from this canonical state. Branches classified A/E in §4 are
dead — do not resume work on them. The rescue branch and `carup-cr1-backups` are archives, not
work surfaces. Any new claim of "applied" or "complete" must carry a receipt, per the governance
protocol (`docs/project-governance/MILESTONE_EXECUTION_PROTOCOL.md`).
