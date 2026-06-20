# Diaspora Trade OS — Phases 3–7 Hardening Progress Ledger

> Durable session memory for the hardening program on draft PR #81. Directive:
> `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_HARDENING_DIRECTIVE.md`.

- **Program branch**: `claude/diaspora-phases-3-7-program`
- **Base**: `main` @ `3ac2ff2` (Phase 2C) · pre-hardening head `3d30753` · directive `14787e5`
- **PR**: #81 (draft, unmerged)
- **Production Supabase touched**: NO · **`stash@{0}` touched**: NO · **Dependencies added**: NONE
- **Staging project (apply only when authorized)**: `eoyenigwevnxwwhyhaer`
- **Production project (forbidden)**: `vhmnajoeicasaigiophh`
- **Session scope**: H0–H6 fully, H7 prepared (NOT applied), H8 CI; STOP before staging apply for
  explicit authorization (H7 apply, H9 staging smoke, H10 final readiness pending).

## Risk register status

| Risk | Description | State |
| --- | --- | --- |
| A | Stock ledger not atomic | H1 — atomic RPC |
| B | Quote acceptance not atomic | H2 — atomic RPC |
| C | Container approval not serialized | H3 — serialized RPC |
| D | Broad backend roles | H4 — explicit allowlists |
| E | Best-effort audit vs guaranteed claim | H5 — critical audit policy |
| F | Staging contract unproven | H7 — prepared, awaiting staging authorization |
| G | No independent CI | H8 — GitHub Actions workflow |
| H | Drive scaffold/mock-only | H6 — reclassified SCAFFOLD/MOCK-COMPLETE |
| I | Drive mock can fail open | H6 — fail-closed in production |
| J | OAuth state no expiry/replay | H6 — expiry + one-time nonce |

## Milestone log

### H0 — Truthful baseline
- **Objective**: Stop overstating atomicity, guaranteed audit, concurrency safety, and live Drive
  before they are proven; establish honest status labels.
- **Findings**: Pre-hardening services performed ledger insert + balance update + audit as separate
  calls (Risk A); quote acceptance was a multi-call accept/reject/update loop (Risk B); container
  approval recomputed capacity but did not serialize (Risk C); `appendAudit` swallowed failures
  (Risk E); Drive real provider throws external-activation errors and mock can be selected when creds
  absent (Risks H/I); OAuth state was signed + user-bound but had no expiry/replay protection (Risk J).
- **Files changed**: `docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md`,
  `docs/DIASPORA_PHASES_3_TO_7_HANDOFF.md`, `docs/DIASPORA_PHASES_3_TO_7_HARDENING_PROGRESS.md` (new).
- **Status labels adopted**: `IMPLEMENTED — HARDENING IN PROGRESS`,
  `SCAFFOLD/MOCK-COMPLETE — LIVE GOOGLE ACTIVATION NOT IMPLEMENTED`, `STAGING-VERIFIED` (target),
  `BLOCKED`.
- **Commit SHA**: _set on commit_.
- **Next**: H1 atomic stock movement.

### H1 — Atomic stock movement (Risk A)
- **Outcome**: stock movement is one atomic DB transaction.
- **Migration/RPC**: `database/migrations/20260621090000_diaspora_h1_stock_movement_rpc.sql` →
  `diaspora_append_stock_movement_atomic(...)` — `SELECT … FOR UPDATE` on the item, action allowlist,
  ownership/tenant check, idempotency (with conflicting-payload rejection), balance constraints,
  ledger insert, balance update, and a critical audit row, all in one transaction; `SECURITY INVOKER`,
  fixed `search_path`, `EXECUTE` granted to `service_role` only.
- **Service**: `diasporaStockLedgerService.js.appendStockMovement` now calls the RPC only (no
  non-atomic fallback) with sanitized error translation; `reserveStock`/`releaseReservation`/opening
  balance delegate through it.
- **Test infra**: `backend/tests/helpers/mockSupabase.js` gains an `.rpc()` dispatcher + fault hooks;
  `backend/tests/helpers/diasporaRpcReference.js` mirrors the SQL invariants for sequential contract
  tests (true row-lock concurrency is staging-gated, H7/H9).
- **Tests**: `diaspora-stock.test.js` (16) incl. idempotency conflict, audit-failure rollback (zero
  writes), balance-update-failure rollback, cross-tenant denial; `diaspora-ai-command.test.js` (12)
  RESERVE via RPC. 28 pass.
- **Staging-gated**: real concurrent over-reservation test (pending staging authorization).
- **Commit SHA**: _set on commit_.

### H2 — Atomic quote acceptance (Risk B)
- **Outcome**: quote acceptance is one atomic DB transaction.
- **Migration/RPC**: `database/migrations/20260621091000_diaspora_h2_quote_acceptance_rpc.sql` →
  `diaspora_accept_quote_atomic(...)` — `SELECT … FOR UPDATE` on the order + selected quote, authority
  check, idempotent replay / different-quote conflict, accept one + reject siblings + stamp order +
  critical audit, all in one transaction; service-role-only execute.
- **Service**: `diasporaBuyerOrderService.js.acceptQuote` now calls the RPC only (no multi-call
  accept/reject/update loop) with sanitized error translation.
- **Tests**: `diaspora-rfq.test.js` (14) incl. one-accepted-rejects-siblings, idempotent replay,
  different-second-quote conflict, draft rejected, cross-order rejected, non-owner denied, and
  audit-failure rollback (quote stays ISSUED, siblings untouched, order unstamped).
- **Staging-gated**: true concurrent two-quote acceptance test (pending staging authorization).
- **Commit SHA**: _set on commit_.

### H3 — Serialized container approval (Risk C)
- **Outcome**: reservation approval is serialized on the container row; concurrent approvals cannot overfill.
- **Migration/RPC**: `database/migrations/20260621092000_diaspora_h3_container_approval_rpc.sql` →
  `diaspora_approve_cargo_reservation_atomic(...)` — `SELECT … FOR UPDATE` on the container (the
  contended resource) + reservation, authority check (platform reviewer/admin or tenant admin of the
  container's tenant), in-transaction recompute of approved volume (+ weight when configured),
  overfill rejection, reservation + cached-capacity update with 90%/98% flags, and a critical audit
  row. Service-role-only execute.
- **Service**: `diasporaContainerMarketplaceService.js.approveReservation` now calls the RPC only.
- **Tests**: `diaspora-container-marketplace.test.js` (13) incl. overfill rejected, concurrent
  recompute, exact 90%/98%, weight overfill, unauthorized denied, and audit-failure rollback
  (reservation stays REQUESTED, capacity unchanged).
- **Staging-gated**: true simultaneous approval race (pending staging authorization).
- **Commit SHA**: _set on commit_.

### H4 — Explicit backend authorization (Risk D)
- **Outcome**: every Phase 3-7 route uses an explicit role allowlist; broad `authorizeRole()` removed.
- **Matrix**: `docs/DIASPORA_PHASES_3_TO_7_AUTHORIZATION_MATRIX.md` (sellerAuth / buyerAuth /
  reviewerAuth / participantAuth; mechanic/insurance/bank excluded).
- **Routes changed**: `diasporaStockRoutes.js` (sellerAuth), `diasporaBuyerOrderRoutes.js` (buyer vs
  seller), `diasporaAiCommandRoutes.js` (participant; approve = reviewer), `diasporaContainerMarketplaceRoutes.js`
  (participant browse/request/cancel; reviewer create/close/approve/reject), `diasporaDriveRoutes.js`
  (participant, per-user scoped). Service-level ownership/tenant checks retained as defense in depth.
- **Tests**: `backend/tests/diaspora-route-authorization.test.js` (8) drives the real router over
  HTTP — owner/mechanic denied on stock, dealer denied on buyer-orders, owner denied on /rfqs,
  buyer/seller denied on container create/approve, dealer denied on ai approve, spoofed
  x-stakeholder-role cannot escalate, cross-tenant x-tenant-id rejected, unauthenticated 401.
- **Commit SHA**: _set on commit_.

### H5 — Critical audit policy (Risk E)
- **Outcome**: audit is no longer uniformly best-effort while docs claim guaranteed audit.
- **Policy**:
  - The integrity-critical mutations (stock movement, quote acceptance, container approval) write
    their audit row INSIDE the atomic RPC transaction → audit failure rolls the mutation back
    (proven by the H1/H2/H3 rollback tests).
  - `appendCriticalAudit` (throws / fail-loud) is used for the security-relevant JS-orchestrated
    lifecycle mutations: AI approve/reject/execute (+ execution-blocked), cargo reservation
    reject/cancel, and Drive connect/disconnect/upload — audit failure surfaces as an error and is
    never silently swallowed.
  - `appendBestEffortAudit` (returns null) is reserved for descriptive create/update/publish and
    telemetry; `appendAudit` is an explicit alias of it.
- **Files**: `diasporaServiceUtils.js` (helpers), `diasporaAiCommandService.js`,
  `diasporaContainerMarketplaceService.js`, `diasporaDriveSyncService.js`.
- **Tests**: `backend/tests/diaspora-audit-policy.test.js` (4) — critical throws on failure,
  best-effort/ alias never throw; plus the in-RPC rollback tests from H1/H2/H3.
- **Known limitation (documented, not hidden)**: the fail-loud JS lifecycle mutations are
  single-statement (not multi-statement transactions); converting AI lifecycle + reservation
  reject/cancel + Drive to full RPC transactions for true rollback is a tracked follow-up. The three
  highest-integrity paths already have true transactional rollback.
- **Commit SHA**: _set on commit_.

### H6 — Drive & OAuth boundaries (Risks H, I, J)
- **Classification (Risk H)**: Phase 7 = `SCAFFOLD/MOCK-COMPLETE — LIVE GOOGLE ACTIVATION NOT
  IMPLEMENTED` (the real Google provider implements the auth-URL only; token exchange/refresh/revoke/
  folder/upload/metadata throw `EXTERNAL_ACTIVATION_REQUIRED`).
- **Fail-closed provider selection (Risk I)**: `shouldUseMockProvider()` returns false in production;
  `assertDriveProductionSafety()` rejects `DIASPORA_DRIVE_MOCK=true` in production; missing Google
  config → real provider throws `NOT_CONFIGURED` (safe error); disabled → truthful status. No mock URL
  is emitted in production.
- **OAuth state hardening (Risk J)**: signed state now carries userId, tenantId, issued-at, expiry,
  and a random nonce. A nonce row (`diaspora_oauth_states`, additive migration
  `20260621093000_diaspora_h6_oauth_state_nonce.sql`) is issued at authorize and consumed once at
  callback via a conditional `UPDATE … WHERE consumed_at IS NULL`, so tampered/expired/foreign/
  replayed/consumed state is rejected. `DIASPORA_DRIVE_STATE_SECRET` is required in production (no
  fixed fallback secret).
- **Files**: `diasporaDriveConstants.js`, `drive/driveProvider.js`, `diasporaDriveSyncService.js`,
  `database/migrations/20260621093000_diaspora_h6_oauth_state_nonce.sql`, `backend/env.example`.
- **Tests**: `diaspora-drive.test.js` (17) incl. minimal scope, signed/tampered/foreign state,
  expiry, replay rejection, production never auto-selects mock, mock rejected in production, missing
  production state secret fails closed, tokens never returned, sanitized errors.
- **Commit SHA**: _set on commit_.

### H7 — Migration & staging validation (PREPARED, NOT APPLIED) (Risk F)
- **Migration set** (additive): phase3 idempotency, h1 stock RPC, h2 quote RPC, h3 container RPC,
  h6 oauth nonce — listed with order, pre-apply inspection, advisors, and rollback in
  `docs/DIASPORA_PHASES_3_TO_7_STAGING_PLAN.md`.
- **Gated suite**: `backend/tests/staging/diaspora-staging-integration.test.js` — skipped by default
  (2 skipped); refuses the forbidden production project; proves RPC existence + concurrent
  over-reserve prevention against a real DB when enabled.
- **Applied to staging**: NO — awaiting explicit authorization (STOP gate).
  Staging `eoyenigwevnxwwhyhaer`; production `vhmnajoeicasaigiophh` forbidden.
- **Commit SHA**: _set on commit_.

### H8 — CI acceptance workflow (Risk G)
- **Workflow**: `.github/workflows/diaspora-phases-3-7-validation.yml` (PR + push + dispatch).
- **backend-and-build job**: `npm ci`; secret-scan guard (Google/JWT/refresh-token value formats);
  migration sanity (each hardening migration has Up+Down); `node --test backend/tests/diaspora-*.test.js`;
  `tsc --noEmit`; route validation; `npm run build`.
- **playwright job**: install chromium, start the web dev server, run the Phase 2C + Phase 3-7
  specs; upload report on failure.
- **staging-integration job**: gated on `DIASPORA_STAGING_DATABASE_URL`; prints
  `skipped — secrets unavailable` when absent (never false success).
- **Note**: CI runs independently once the workflow is on the PR branch; run IDs/links recorded in
  the hardening report after the branch is pushed.
- **Commit SHA**: _set on commit_.
