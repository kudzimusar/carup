# Integration requests — BILLING lane (Issue #127, Deliverable D)

Branch: `claude/gtm-billing-lane`. Nothing here has been applied by this lane; each item names a file
the integrator owns, or a decision only the integrator can make.

---

## 1. No changes are needed to any integration-owned file

Checked explicitly, because the obvious candidates turned out to already be correct:

| Integration-owned file | Why it was checked | Outcome |
|---|---|---|
| `backend/middleware/securityMiddleware.js` | The webhook now REQUIRES the raw body and would 400 without it | **No change needed.** `/api/diaspora/subscription/webhook` is already CSRF-exempt (line ~194) and `backend/server.js` already captures `req.rawBody` for any URL containing `/webhook`. |
| `web/src/hooks/useCarUpApi.ts`, `web/src/types/index.ts` | Three new endpoints were added | **No change requested.** They are backend/operator surfaces (`POST /subscription/reconcile`, `GET /subscription/reconciliation-runs`, `GET /subscription/billing-health`) with no UI in this lane. If a billing operator console is built later, that lane should add the hooks. |
| `shared/navigation/*`, `web/src/config/featureRegistry.ts` | No new navigation nodes | Not touched. |
| `docs/DIASPORA_TRADE_OS_MIGRATION_LEDGER.md` | A new migration was added (see §2) | **Ledger entry needed — see §2.** |
| `docs/DIASPORA_GO_TO_MARKET_ACTIVATION_PROGRESS.md` | Step 3 status changes | **Status update needed — see §3.** |
| `tests/agents/*` | No Playwright work in this lane | Not touched. |

---

## 2. Migration ledger entry (integrator to add)

`database/migrations/20260729090000_diaspora_billing_test_mode_closure.sql` is **ledger #24**. Suggested
row for `docs/DIASPORA_TRADE_OS_MIGRATION_LEDGER.md`:

> **#24 — `20260729090000_diaspora_billing_test_mode_closure.sql`** — Subscription billing closure
> (Issue #127 Deliverable D). Additive. Adds `superseded_by`, `correlation_id`, `attempts`,
> `last_error`, `dead_lettered` to `diaspora_billing_provider_events`; two partial indexes (the
> out-of-order guard's read path, and the dead-letter operator queue); creates
> `diaspora_billing_checkout_sessions` (RLS enabled, zero policies, service-role-only grants applied at
> CREATE time). Down drops only what it created and leaves ledger #21's columns and
> `diaspora_billing_reconciliation_runs` intact. **Not applied to any database.**
> Verified: `node database/test/diaspora_billing_migration_check.mjs` — 36/36 assertions on real
> PostgreSQL 17.5 (PGlite), including the Supabase `ALTER DEFAULT PRIVILEGES` hazard control.

---

## 3. Progress-doc status (integrator to update)

`docs/DIASPORA_GO_TO_MARKET_ACTIVATION_PROGRESS.md` currently says **"3 — Subscription billing (test
mode): NOT STARTED."** Accurate replacement:

> **3 — Subscription billing (test mode): engineering COMPLETE, activation pending.** Provider ADR
> (`docs/adr/ADR-001-diaspora-subscription-provider.md`); provider-neutral test-mode adapter over an
> injectable HTTP transport with two dissimilar wire profiles; durable webhook ledger with
> out-of-order/supersede semantics and raw-body signature verification; reconciliation against
> `diaspora_billing_reconciliation_runs`; observability for failed webhooks, reconciliation mismatch,
> quota anomalies and checkout abandonment; entitlement enforcement extended from 4 to 15 of 19 feature
> keys with the remaining 4 recorded as reasoned gaps. `APPROVED_LIVE_PROVIDERS` still empty; ledger #24
> unapplied; no Chromium matrix in this lane (no UI was built).

---

## 4. Decisions the integrator should be aware of

1. **`docs/adr/` is a new directory.** ADR-001 is the first entry.
2. **The webhook now fails closed without a raw body.** Previously it fell back to
   `JSON.stringify(req.body)`, which is not the bytes the provider signed. Any deployment whose parser
   does not populate `req.rawBody` for the webhook path will now get a 400 instead of silently verifying
   a re-serialization. `backend/server.js` already handles this; a future router remount must preserve it.
3. **The provider identity now comes from the adapter, not the payload.** The handler no longer reads
   `payload.provider`, so a signed event cannot choose its own de-duplication namespace.
4. **Files outside the billing lane's core scope were touched** to complete entitlement enforcement,
   because enforcement lives at domain call sites. Each edit is small and additive, and every one is a
   no-op while `DIASPORA_SUBSCRIPTION_ENFORCEMENT` is off (the default):
   `diasporaStockService.js`, `diasporaSupplyDocumentService.js`, `diasporaRfqService.js`,
   `diasporaAiCommandService.js`, `diasporaContainerMarketplaceService.js`,
   `diasporaWorkbookSyncService.js`, `workbook/diasporaWorkbookDbExportService.js`,
   `routes/diasporaWorkbookXlsxRoutes.js`.
   **Deliberately NOT touched:** anything under `backend/services/diaspora/drive/**` or the Drive sync
   path, to avoid colliding with the Drive lane. `diaspora.drive.connect` / `diaspora.drive.export`
   are therefore recorded as reasoned gaps in
   `backend/services/diaspora/billing/diasporaGatedOperations.js`.
5. **One existing test file was edited**: `backend/tests/diaspora-entitlement-enforcement.test.js`. Its
   free-plan publish-denial test built its fixture by calling `createSupplyDocument` while enforcement
   was ON; creation is now itself gated on `diaspora.stock.create`, which the free plan does not grant,
   so the fixture failed at the wrong step. The fix builds the document with enforcement OFF and then
   turns it on — which is also the realistic scenario (a tenant that created stock on a paid plan and
   has since dropped to free). The assertion under test is unchanged.

---

## 5. Environment note (not a code change)

`node_modules` was missing in this worktree. It is now a symlink to the repo's shared install, and 45
packages (the `exceljs` dependency tree, declared in `backend/package.json` but absent from that
install) were copied in from a sibling worktree's complete install. Without them, 23 tests fail with
`ERR_MODULE_NOT_FOUND` and the stated 2213-test baseline is unreachable. Nothing in the repository was
changed; if the integrator's environment shows the same failures, `npm ci` fixes it.

---

## Resolution status (2026-08-08, reunification audit)
- §2 ledger #24 row: **SATISFIED** (row present; staging-applied 2026-07-27 per ledger reconciliation).
- §3 progress-doc status: **OBSOLETE** — the target "NOT STARTED" line no longer exists; the GTM
  progress doc already records Deliverable D as complete with the §5c defect fixed.
