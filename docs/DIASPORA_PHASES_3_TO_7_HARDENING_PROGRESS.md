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

### H4 — Explicit backend authorization
_pending_

### H5 — Critical audit policy
_pending_

### H6 — Drive & OAuth boundaries
_pending_

### H7 — Migration & staging validation (prepared, not applied)
_pending_

### H8 — CI acceptance workflow
_pending_
