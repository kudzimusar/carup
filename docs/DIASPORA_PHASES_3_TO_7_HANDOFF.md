# Diaspora Trade OS — Phases 3–7 Handoff

> Program branch: `claude/diaspora-phases-3-7-program` · Base: `main` @ `3ac2ff2` (Phase 2C).
> Directive: `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md`.
> Status: implemented, tested, **PR open and unmerged**. Do not merge or apply migrations to
> production without explicit approval.

## What shipped

> **Hardening in progress (PR #81).** The states below reflect feature breadth delivered with
> mock-tested coverage. A hardening program is converting this to database-safe, authorization-safe,
> integration-proven code (atomic RPCs, explicit role allowlists, critical audit, OAuth replay
> protection, staging validation, independent CI). See
> `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_HARDENING_DIRECTIVE.md` and
> `docs/DIASPORA_PHASES_3_TO_7_HARDENING_PROGRESS.md`. Do not treat these as production-safe until the
> hardening merge gates pass.

| Phase | Title | State | Commit |
| --- | --- | --- | --- |
| 3 | Online Stock & Supply Documents | IMPLEMENTED — HARDENING IN PROGRESS | `94b6dce` |
| 4 | Buyer Orders & Reverse RFQ | IMPLEMENTED — HARDENING IN PROGRESS | `0c8f6b7` |
| 5 | AI Command Hardening | IMPLEMENTED — HARDENING IN PROGRESS | `93ca439` |
| 6 | Container Co-Loading | IMPLEMENTED — HARDENING IN PROGRESS | `4d7e79c` |
| 7 | Google Drive Integration | SCAFFOLD/MOCK-COMPLETE — LIVE GOOGLE ACTIVATION NOT IMPLEMENTED | `900f02c` |

Discovery baseline: `1b3395e`. Per-phase detail (files, endpoints, tests, limitations) lives in
`docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md`.

## Endpoints added (all under `/api/diaspora`)

- **Stock/Supply**: `GET/POST /stock`, `GET/PATCH /stock/:id`, `GET/POST /stock/:id/ledger`,
  `POST /stock/:id/reserve`, `POST /stock/:id/release-reservation`, `GET/POST /supply-documents`,
  `GET/PATCH /supply-documents/:id`, `POST /supply-documents/:id/{publish,unpublish}`.
- **Buyer Orders / RFQ**: `GET/POST /buyer-orders`, `GET/PATCH /buyer-orders/:id`,
  `POST /buyer-orders/:id/publish-rfq`, `GET /buyer-orders/:id/matches`,
  `POST /buyer-orders/:id/quotes`, `POST /buyer-orders/:id/accept-quote`, `GET /rfqs`,
  `PATCH /quotes/:id`, `POST /quotes/:id/{submit,withdraw}`.
- **AI**: `POST /ai-commands/parse`, `GET/POST /ai-commands`, `GET /ai-commands/:id`,
  `POST /ai-commands/:id/{confirm,approve,reject,execute}`.
- **Container marketplace**: `GET/POST /container-marketplace/containers`,
  `GET /container-marketplace/containers/:id/capacity`,
  `GET/POST /container-marketplace/containers/:id/reservations`,
  `POST /container-marketplace/containers/:id/close-booking`,
  `POST /container-marketplace/reservations/:id/{approve,reject,cancel}`.
- **Drive**: `GET /drive/status`, `GET /drive/google/authorize`, `GET /drive/google/callback`,
  `POST /drive/disconnect`, `GET /drive/files`, `POST /drive/{upload,export,sync}`.

## Frontend routes added

`/diaspora/stock`, `/diaspora/rfq`, `/diaspora/ai-commands`, `/diaspora/containers`,
`/diaspora/drive` — each guarded by role, registered in `featureRegistry.ts`, route-validation green.

## Migrations

- `database/migrations/20260620120000_diaspora_phase3_stock_ledger_idempotency.sql` — additive
  `idempotency_key` + partial unique index on `diaspora_stock_ledger`. **Not applied to production.**
- No other migrations: all Phase 3–7 tables already existed (Phase 1B foundation migration).

### Staging apply steps (when authorized)
Apply the Phase 3 migration to an authorized dev/staging DB only, e.g. via the existing
`scripts/` migration runner or `psql` against the staging connection string. Verify the column and
index exist, then run `RUN_DIASPORA_SUPABASE_INTEGRATION=true` integration checks. Do not run against
production.

## Environment variables (no real values; see `backend/env.example`)

Phase 7 Drive only: `DIASPORA_DRIVE_ENABLED`, `DIASPORA_DRIVE_MOCK`, `DIASPORA_DRIVE_STATE_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI`. With none set, Drive is
disabled and the mock provider is used in tests/dev.

## Safety posture

Design intent (the hardening program proves these at the transaction/authorization/staging boundaries):

- **Stock**: quantities change only through the immutable ledger; available never negative;
  idempotent movements; `ADJUST_WITH_APPROVAL` gated to reviewer/admin. **Hardening (H1):** the
  insert+update+audit sequence is being replaced by a single atomic `SELECT … FOR UPDATE` RPC.
- **RFQ**: idempotent acceptance that rejects siblings; buyers/sellers scoped. **Hardening (H2):**
  multi-call accept/reject/update being replaced by an atomic RPC (concurrency-safe).
- **AI**: low → draft only; medium → confirm; high → reviewer approval but execution always blocked;
  execution re-validates permission/risk/gate; AI never directly mutates domain records.
- **Container**: server-side capacity authority rejects overfill. **Hardening (H3):** approval being
  serialized via a row-locking atomic RPC so concurrent approvals cannot overfill. Closing booking ≠
  shipment completion.
- **Drive**: minimal scope; tokens never persisted/returned/logged. **Hardening (H6):** fail-closed
  production provider selection, OAuth state expiry + one-time replay protection; classified
  SCAFFOLD/MOCK-COMPLETE until live Google operations are implemented and staging-verified.
- Tenant/ownership isolation on every mutation. **Hardening (H4/H5):** explicit backend role
  allowlists and a critical-audit policy that rolls back the mutation when audit insertion fails. No
  automatic payment/escrow/compliance/verification/shipment/reputation. No XLSX faking.

Until the hardening gates pass (atomicity, authorization, audit, staging, CI, Drive/OAuth,
regression), these are design guarantees enforced by mock-tested code, not yet by applied database
transactions or live integration.

## Test evidence

- Backend (node:test): full diaspora suite **275 pass / 0 fail / 3 skipped** (live Supabase
  integration intentionally skipped). New phases contribute 59 focused tests.
- TypeScript: `tsc --noEmit` clean. Route validation: 7/7.
- Playwright: 20 new E2E + 18 Phase 2C regression = **38 pass**.
- Build: `npm run build` succeeds (pre-existing Vite chunk-size warning only).

## Not done / deferred

- Live Google Drive (real OAuth credentials + Google API client + authorized E2E) — external step.
- OneDrive (interface only). Binary XLSX export/template (Phase 2C remains JSON-only).
- Phase 8–10 (Subscription Gate, SafeTrade, Trade Graph) — entitlement hook seams only.

## Recommended review & merge sequence

1. Review the discovery + progress ledger, then phases in order (3 → 7) — each is a self-contained
   commit with its own tests.
2. Apply the Phase 3 migration to staging and run the live integration checks.
3. Confirm Vercel preview is green on the PR.
4. Squash-merge once approved; do not enable Drive in production until OAuth credentials and an
   authorized end-to-end test are in place.
