# Diaspora Trade OS — Phases 3–7 Hardening Report

> Draft PR #81 · branch `claude/diaspora-phases-3-7-program` · base `main` @ `3ac2ff2`.
> Status: hardening milestones H0–H8 complete; H7-apply / H9 staging smoke / H10 final readiness are
> **pending explicit staging authorization**. PR remains **draft and unmerged**.

## Risk register → remediation

| Risk | Remediation | Evidence |
| --- | --- | --- |
| A — stock not atomic | `diaspora_append_stock_movement_atomic` RPC (FOR UPDATE + ledger + balance + critical audit in one tx); service calls RPC only | `diaspora-stock.test.js` (16) incl. rollback + idempotency-conflict + cross-tenant |
| B — quote acceptance not atomic | `diaspora_accept_quote_atomic` RPC (accept one + reject siblings + stamp order + audit in one tx) | `diaspora-rfq.test.js` (14) incl. audit-rollback, conflict, draft/cross-order rejection |
| C — container approval not serialized | `diaspora_approve_cargo_reservation_atomic` RPC (lock container, recompute, reject overfill) | `diaspora-container-marketplace.test.js` (13) incl. audit-rollback |
| D — broad backend roles | explicit per-route allowlists + matrix; service ownership retained | `diaspora-route-authorization.test.js` (8): 403s, spoof, cross-tenant |
| E — best-effort audit vs guaranteed claim | `appendCriticalAudit` (fail-loud) + `appendBestEffortAudit`; critical paths audit in-tx; docs corrected | `diaspora-audit-policy.test.js` (4) + in-RPC rollback tests |
| F — staging unproven | migration set + staging plan + gated integration suite (not applied) | `STAGING_PLAN.md`, `tests/staging/*` (skipped) |
| G — no independent CI | GitHub Actions acceptance workflow | `.github/workflows/diaspora-phases-3-7-validation.yml` |
| H — Drive scaffold/mock | classified SCAFFOLD/MOCK-COMPLETE; real provider auth-URL only | `diaspora-drive.test.js` |
| I — Drive mock fail-open | production never auto-selects mock; `DIASPORA_DRIVE_MOCK` rejected in prod | `diaspora-drive.test.js` H6 cases |
| J — OAuth no expiry/replay | signed state w/ issued-at+expiry+nonce; one-time consumption; prod secret required | `diaspora-drive.test.js` H6 cases |

## Migration / RPC names

- `diaspora_append_stock_movement_atomic` — `20260621090000_diaspora_h1_stock_movement_rpc.sql`
- `diaspora_accept_quote_atomic` — `20260621091000_diaspora_h2_quote_acceptance_rpc.sql`
- `diaspora_approve_cargo_reservation_atomic` — `20260621092000_diaspora_h3_container_approval_rpc.sql`
- `diaspora_oauth_states` — `20260621093000_diaspora_h6_oauth_state_nonce.sql`
- `diaspora_stock_ledger.idempotency_key` — `20260620120000_diaspora_phase3_stock_ledger_idempotency.sql`

## Migrations applied / production

- Applied to staging: **NO** (awaiting authorization). Staging `eoyenigwevnxwwhyhaer`.
- Production Supabase touched: **NO**. Production `vhmnajoeicasaigiophh` forbidden, untouched.

## Audit policy

Critical mutations (stock movement, quote acceptance, container approval) audit **inside** the atomic
RPC transaction → audit failure rolls the mutation back. AI approve/reject/execute, reservation
reject/cancel, and Drive connect/disconnect/upload use `appendCriticalAudit` (fail-loud). Descriptive
create/update/publish and telemetry use `appendBestEffortAudit`. Known limitation (disclosed): the
fail-loud JS lifecycle mutations are single-statement; wrapping them in full RPC transactions for true
rollback is a tracked follow-up.

## Drive / OAuth classification

`SCAFFOLD/MOCK-COMPLETE — LIVE GOOGLE ACTIVATION NOT IMPLEMENTED`. The real `GoogleDriveProvider`
builds the authorization URL from config; token exchange/refresh/revoke/folder/upload/metadata throw
`EXTERNAL_ACTIVATION_REQUIRED`. Provider selection fails closed in production; OAuth state is
short-lived, user-bound, signed, and one-time (nonce). Tokens are never persisted (only an opaque
`credential_reference`) or returned/logged.

## Test results (local)

- Backend diaspora suite: **300 pass / 0 fail / 3 skipped** (live integration) — `node --test backend/tests/diaspora-*.test.js`.
- TypeScript: clean. Route validation: 7/7. Build: OK (pre-existing chunk-size warning).
- Playwright (Phase 2C + 3-7): **38 pass**.
- CI workflow: present on the branch; runs independently on push/PR (run links to be recorded once the
  branch CI executes).

## Dependencies added

None.

## Environment variables required

Drive only (no real values; see `backend/env.example`): `DIASPORA_DRIVE_ENABLED`,
`DIASPORA_DRIVE_MOCK` (must be false/unset in prod), `DIASPORA_DRIVE_STATE_SECRET` (required in prod),
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI`.

## Remaining external blockers / pending

- **BLOCKED — staging project unreachable.** Staging apply was authorized for `eoyenigwevnxwwhyhaer`,
  but the connected Supabase MCP returns `permission denied` for it and lists only one project,
  `sfhtlzcgrnrdznhvdrbn` ("production-os") — which is neither the authorized staging nor the named
  forbidden production. No migration was applied; the "production-os" project was **not** touched.
  Resolution options in `docs/DIASPORA_PHASES_3_TO_7_STAGING_PLAN.md`. H7-apply + H9 remain blocked.
- **Live Google Drive** activation (real OAuth credentials + Google API client) — out of this scope.

## Adversarial review (independent verification)

A 4-dimension adversarial review (atomicity/parity, authorization, audit, OAuth/Drive) verified the
core hardening **clean**: SQL↔JS-reference parity, no non-atomic production fallback, critical-audit
policy, OAuth state expiry/nonce/replay, and fail-closed provider selection. Three findings:

1. **[HIGH · PRE-EXISTING · UNRELATED] Committed production DB credentials.** Nine
   `backend/scripts/*.js` utility scripts (e.g. `apply_migration.js`, `query_users.js`) hardcode a
   plaintext Supabase connection string for the **forbidden production project**
   (`db.vhmnajoeicasaigiophh.supabase.co`). These files are **not part of Phase 3-7** and were **not
   modified by this branch** (`git diff main...HEAD` does not list them). This is a real security
   incident that predates this program. **Required user action (outside this PR's scope): rotate the
   Supabase password immediately, purge it from git history, and parameterize the scripts via
   `process.env.DATABASE_URL`.** Editing the files here would not remove the secret from history and
   would violate the directive's "do not touch unrelated files" rule, so it is surfaced rather than
   silently changed. (The H8 secret-scan guard was intentionally not extended to fail on this
   pre-existing path, to avoid masking unrelated baseline debt as a Phase 3-7 failure.)
2. **[MEDIUM · PRE-EXISTING · OUT OF SCOPE] Legacy `authorizeRole()` with no allowlist.**
   `backend/routes/diasporaRoutes.js:27` (`const auth = authorizeRole()`) guards the legacy
   Phase 1/2 routes (import-orders, documents, shipments, etc.) as "any authenticated user," relying
   on service-level ownership/tenant checks (covered by the existing reservation-auth and
   logistics-auth tests). All **Phase 3-7** routes use explicit allowlists (Risk D resolved for the
   new modules). Tightening the legacy guard is a recommended follow-up, deferred here to avoid
   changing Phase 1/2 behavior and tests outside this program's scope.
3. **[MEDIUM · FIXED] Route-auth test gap.** `diaspora-route-authorization.test.js` now also asserts
   a seller (`dealer`) is denied container creation (reviewer-only), in addition to the buyer case.

## Merge readiness

Not yet review-ready: merge gates for staging (Gate 4) and CI run evidence (Gate 5) and the H9 smoke
test depend on staging authorization. All code-side gates (atomicity, authorization, audit, Drive/
OAuth, regression) are implemented and locally green. **Recommended next step: authorize staging
migration application** (or explicitly defer staging), then complete H7-apply/H9 and mark the PR ready.
