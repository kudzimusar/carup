# CarUp Workstream Separation and Handoff

## Active Workstream

Diaspora Trade OS

## Correct Agent

Codex

## Current Completion State

CarUp Diaspora Trade OS is complete through Phase 2B: Operator Console UX Stabilization.

Phase 2C Workbook Intake and Dry-Run UI is in progress.

Latest completed Diaspora UI commit:

- `821106e7ee9563439fefe558ec4b729e00290bcb` - `feat: polish diaspora workbook operator console ux`
- `a1642c96f6390c6799a1f8c1abc8a15e01aed116` - `feat: add diaspora workbook operator console ui`

Phase 2B stabilized the operator console UX without adding backend execution behavior.

## Completed Phases

### Phase 1A - Diaspora Workbook Center and Dry-Run Validation

Added the workbook schema contract, template schema service, dry-run validation service, workbook sync guard, and workbook routes under `/api/diaspora/workbook/*`.

Commit SHA: available in earlier remote history; not singled out in this handoff context.

### Phase 1B - Schema Gap Report and Database Foundation

Created the schema gap report and added the missing repository migration for the staging-applied database foundation.

Known commits:

- `6d0026f32cd533952d8af17da28892166678b4f0` - schema gap report
- `215550e` - `feat: add diaspora trade os phase 1b migration`

### Phase 1C - Persist Dry-Run Batches and Row Diagnostics

Persisted workbook dry-run batches and row diagnostics into workbook import batch/row tables while keeping live trade-table writes disabled.

Known commits:

- `00b43efa8c8019adb9d112be2a59ce76d9aa8d6a`
- `d25e0d5d909c48c8c221ac3b0b0f3fd00849b679`
- `753cbd3ed2db4e6c1cce941fd1178082234368eb`
- `bd38bc4f47aab79b13b28875091e111629cb39ca`
- `064ff4c85ee2db8b27c2c47549424999f19435d7` - `test: cover persisted workbook dry-run diagnostics`

### Phase 1D - Workbook Import Review Dashboard/Service

Added backend read/review endpoints for persisted batches, including batch list/detail, row diagnostics, summary, cancel, and mark-ready flows. Live import execution remained disabled.

Known commit:

- `4546797` - `feat: add diaspora workbook import review endpoints`

### Phase 1E - Controlled Workbook Import Planning Layer

Added a planning layer that maps workbook rows to safe proposed actions, blocks unsafe lifecycle/status changes, and keeps execution disabled.

Known commit:

- `55fdbff` - `feat: add diaspora workbook import planning layer`

### Phase 1F - Controlled Draft-Only Workbook Import Execution

Added controlled draft-only execution for allow-listed safe draft records, with idempotency, row import results, and batch status updates. No live approvals, releases, verification, AI execution, or Drive sync were added.

Known commit:

- `2c3b077` - `feat: add controlled diaspora workbook draft import execution`

### Phase 1G - Draft Import Audit and Recovery Visibility

Added read-only audit and recovery visibility for draft import execution outcomes, retry planning visibility, duplicate-risk detection, and rollback planning fields without implementing retry or rollback execution.

Known commit:

- `52b0fdbebc0cd8f4183b14c983640f074026770c` - `feat: add diaspora workbook draft import audit and recovery`

Important separation rule:

- Phase 1G belongs to Diaspora Trade OS, not Navigation Intelligence.

### Phase 1H - Backend Operator Console API and Import Batch Control Polish

Added backend operator console API and import batch control polish for operational visibility and safer batch control around the Diaspora workbook workflow.

Known commit:

- `d99a96623ec2c32510bd430c3ce3436e42c9b0ac` - `feat: add diaspora workbook operator console api`

### Phase 1I - Backend Hardening, Consistency, Access-Control, and Observability Review

Hardened the existing Diaspora workbook backend without adding new import behavior. Phase 1I added metadata normalization helpers, hardened malformed metadata handling, sanitized database errors, and added backend hardening tests.

Known commit:

- `fcb9d660bcf31c08010ff7fdc6fcd20bbd5c36ca` - `test: harden diaspora workbook backend controls`

Phase 1I did not add live import, retry execution, rollback execution, AI execution, Drive/OAuth, frontend UI, migrations, or production Supabase changes.

### Phase 2A - Workbook Operator Console UI Shell

Added the initial frontend operator console route at `/admin/diaspora/workbooks`, consuming existing Phase 1H read/metadata APIs and keeping execution controls out of the UI.

Known commit:

- `a1642c96f6390c6799a1f8c1abc8a15e01aed116` - `feat: add diaspora workbook operator console ui`

### Phase 2B - Operator Console UX Stabilization

Phase 2B completed:

- Added guarded admin/government navigation to `/admin/diaspora/workbooks`.
- Added loading, empty, and error states.
- Hardened API-state rendering.
- Added read-only blocked guardrail indicators.
- Improved note/hold double-submit behavior.
- Expanded focused Playwright coverage.
- No backend execution behavior was changed.

Phase 2B does not add live import, retry execution, rollback execution, AI execution, Drive/OAuth, backend import execution, migrations, or production Supabase changes.

### Phase 2C - Workbook Intake and Dry-Run UI

Phase 2C is in progress.

Current scope:

- JSON-only workbook file intake.
- JSON paste/edit intake.
- Template schema selection and preview.
- Template download unavailable state.
- Dry-run submission to the existing JSON backend contract.
- Validation result and persisted batch confirmation.
- Links back to the workbook operator console.

Phase 2C must not add XLSX parsing, binary template generation, backend dry-run behavior changes, live import, execute-drafts controls, retry execution, rollback execution, AI execution, Drive/OAuth, migrations, production Supabase changes, Vehicle Evidence work, Navigation Intelligence work, Mobile Identity work, or PartSentry work.

## Paused Workstreams

- Navigation Intelligence - Antigravity
- Vehicle Evidence AI/Fraud Controls - separate PR/workstream, now merged into main via PR #60
- Vehicle Evidence QA backend blockers - separate PR/workstream, now merged into main via PR #61
- Mobile Identity Verification - separate workstream
- PartSentry Governance - separate workstream

These workstreams must remain separate from Diaspora Trade OS unless an explicit handoff starts them.

## Current Safe Next Options

### Option A - Codex: Diaspora Phase 2C Workbook Upload/Dry-Run UI

In progress on branch `codex/diaspora-phase-2c-workbook-dry-run-ui`.

### Option B - Codex: Diaspora Phase 1J Backend Readiness Checklist

Run a backend readiness checklist before any UI or execution expansion.

### Option C - Codex: Vehicle Evidence stash/PR61 cleanup review as a separate workstream

Review Vehicle Evidence stash or PR #61 follow-up separately from Diaspora Trade OS.

### Option D - Antigravity: Resume Navigation Intelligence Separately

Resume Navigation Intelligence as a separate Antigravity workstream, not as part of Diaspora Trade OS.

## Recommendation

Do not start Phase 2C, Vehicle Evidence cleanup, or Navigation Intelligence without an explicit handoff.

## Guardrails

- No AI execution
- No Drive/OAuth
- No live import
- No retry execution
- No rollback execution
- No stock overwrite
- No payment release
- No compliance approval
- No document auto-verification
- No shipment delivery/release automation
- No automatic reputation creation
- No production Supabase touch

## Verified Handoff State

- `git status --short` was clean before this handoff document was added.
- Local `main` is aligned with `origin/main`.
- Phase 1G commit exists: `52b0fdbebc0cd8f4183b14c983640f074026770c`.
- Phase 1H commit exists: `d99a96623ec2c32510bd430c3ce3436e42c9b0ac`.
- Phase 1I commit exists: `fcb9d660bcf31c08010ff7fdc6fcd20bbd5c36ca`.
- Vercel check `carup` is success.
- Vercel check `carup-staging` is success.
- Vercel check `carup-backend` is success.
- Vercel check `carup-backend-staging` is success.
- Phase 2B PR #65 merged.
- Phase 2B squash merge commit exists: `821106e7ee9563439fefe558ec4b729e00290bcb`.
- PR #65 checks passed before merge.
- Current main includes later PR #61 Vehicle Evidence QA backend blocker merge.
- Current Vercel build-rate-limit statuses, if present, are quota/deployment-limit signals, not Phase 2B code failures.
- `stash@{0}` remains unapplied/unpopped.
- `stash@{0}` is not Diaspora Trade OS.
- `stash@{0}` must not be applied during Phase 2C.

## Mainline Reconciliation Update

1. Diaspora Trade OS is complete through Phase 2B.
2. Latest completed Diaspora UI commit: `821106e7ee9563439fefe558ec4b729e00290bcb`.
3. Phase 1I was backend hardening only.
4. Phase 2A was frontend operator-console UI only.
5. Phase 2B was frontend operator-console UX stabilization only.
6. PR #60 Vehicle Evidence AI/Fraud Controls has been merged into main.
7. PR #60 merge commit: `3fd0d157755da737a9c8e3c71ea55d0231b0ca36`.
8. PR #60 must remain classified as a separate workstream from Diaspora Trade OS.
9. PR #61 Vehicle Evidence QA backend blockers has been merged into main.
10. PR #61 merge commit: `9d56b353a5a64cafbd548b41cf2cc17de068f817`.
11. PR #61 is separate from Diaspora Trade OS.
12. PR #61 must not be mixed into Diaspora Phase 2C.
13. Navigation Intelligence remains paused and belongs to Antigravity.
14. No Navigation Intelligence work has resumed.
15. No new feature should start until the user chooses one of:
    - Codex: Diaspora Phase 2C Workbook Upload/Dry-Run UI
    - Codex: Diaspora Phase 1J backend readiness checklist
    - Codex: Vehicle Evidence stash/PR61 cleanup review as a separate workstream
    - Antigravity: Resume Navigation Intelligence separately

## Phase 2B Completed Update

1. Phase 2A is now present on main at `a1642c96f6390c6799a1f8c1abc8a15e01aed116`.
2. Phase 2B is now present on main at `821106e7ee9563439fefe558ec4b729e00290bcb`.
3. Phase 2B added guarded admin/government dashboard navigation to `/admin/diaspora/workbooks`.
4. Phase 2B added explicit dashboard and selected-batch loading, empty, and error states.
5. Phase 2B added fixed read-only guardrail indicators for live import, retry execution, rollback execution, AI execution, and Drive/OAuth.
6. Phase 2B hardened malformed/missing dashboard, summary, audit, retry plan, notes, warnings, next actions, and hold reason rendering.
7. Phase 2B refreshes dashboard and selected-batch summary after note, hold, and clear-hold success.
8. Phase 2B prevents note and hold repeat submissions while requests are in flight.
9. No backend execution behavior was changed.

## Stash Note

1. `stash@{0}` remains unapplied/unpopped.
2. `stash@{0}` is not Diaspora Trade OS.
3. `stash@{0}` must not be applied during Phase 2C.
4. No stash was applied or modified as part of this work.
