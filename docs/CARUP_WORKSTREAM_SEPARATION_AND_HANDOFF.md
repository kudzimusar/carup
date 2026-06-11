# CarUp Workstream Separation and Handoff

## Active Workstream

Diaspora Trade OS

## Correct Agent

Codex

## Current Completion State

CarUp Diaspora Trade OS is complete through Phase 1H: Backend Operator Console API and Import Batch Control Polish.

Latest completed commit:

- `d99a96623ec2c32510bd430c3ce3436e42c9b0ac` - `feat: add diaspora workbook operator console api`

No next phase has started as part of this handoff reset.

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

## Paused Workstreams

- Navigation Intelligence - Antigravity
- Vehicle Evidence AI/Fraud Controls - separate PR/workstream
- Mobile Identity Verification - separate workstream
- PartSentry Governance - separate workstream

These workstreams must remain separate from Diaspora Trade OS unless an explicit handoff starts them.

## Current Safe Next Options

### Option A - Codex: Phase 1I Backend Hardening Only

Continue backend-only hardening for Diaspora Trade OS, focused on tests, access controls, consistency checks, observability, and documentation. Do not broaden import capabilities.

### Option B - Codex/Frontend: Phase 2A UI Shell

Start the Phase 2A UI shell only after explicit handoff approval. This should not begin during the handoff reset.

### Option C - Antigravity: Resume Navigation Intelligence Separately

Resume Navigation Intelligence as a separate Antigravity workstream, not as part of Diaspora Trade OS.

## Recommendation

Do not start Phase 2A yet.

First complete this handoff reset, verify repository and deployment state, and confirm the next agent/workstream explicitly before starting new implementation.

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
- Production Vercel check `carup` is success.
- Production Vercel check `carup-backend` is success.
- Staging Vercel failures for `carup-staging` and `carup-backend-staging` are build-rate-limit only.
- No next phase has started.
