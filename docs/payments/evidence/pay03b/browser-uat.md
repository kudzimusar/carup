# PAY-03B physical browser UAT (Level 1, local provider simulator)

**Runtime:**
- Final run: candidate `248970eec82311d417b6c333482096de1c9ed78d`, the final runtime after the Level 2 findings were fixed. The first certification ran at `4863672be42e283075b0f910be522a17a3c547f0` (run history below). The first test proves the candidate on both tiers (web `carup-provenance.json` and backend `/api/health`); the spec ran from the same commit.
- Production web build served by `vite preview` on 127.0.0.1:5193; backend on 127.0.0.1:5041.
- Dedicated `carup-pay03b-supabase` stack: the database was rebuilt from the candidate's migrations with a 44-entry ledger, the two PAY-03B migration hashes were matched, and synthetic QA data was seeded.

**Provider:** the clearly labelled **LOCAL PROVIDER SIMULATOR**, not Stripe. No money moves.

**Browser and checks:**
- Real Chromium, run **headed** (in a visible window).
- Viewports: 1440×900, 768×1024 and 390×844.
- On every PAY-03B surface: axe WCAG 2 A/AA scan (`@axe-core/playwright`, tags `wcag2a`, `wcag2aa`) and a no-horizontal-overflow check.

Spec: `web/e2e/pay03b-dealer-subscription.spec.ts` (serial; paced inside the shared per-IP sensitive rate-limit budget).

## Result at `248970ee`: 15 / 15 passed (2026-11-02, 00:00–00:06 UTC)

At desktop, the administrator test now also opens the **refund** and **suspension** dialogs. It runs axe on each once its confirm button has settled, then closes it without confirming; opening a dialog makes no request. This is the physical check for Level 2 finding F-L2-02. The same 15 tests (without the dialog checks) passed at `4863672b`.

```
✓   1 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:79:1 › runtime provenance: web build and backend are the candidate; provider is the local simulator
✓   2 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:88:3 › Pricing shows governed status, never a mock price (desktop)
✓   3 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:88:3 › Pricing shows governed status, never a mock price (tablet)
✓   4 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:88:3 › Pricing shows governed status, never a mock price (mobile)
✓   5 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:100:3 › staff member sees Plan & Billing read-only (desktop)
✓   6 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:100:3 › staff member sees Plan & Billing read-only (tablet)
✓   7 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:100:3 › staff member sees Plan & Billing read-only (mobile)
✓   8 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:114:1 › billing admin reviews terms, pays on the SIMULATED provider page, and the server confirms access (desktop)
✓   9 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:145:3 › entitled dealer page is readable and contained (desktop)
✓  10 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:145:3 › entitled dealer page is readable and contained (tablet)
✓  11 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:145:3 › entitled dealer page is readable and contained (mobile)
✓  12 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:156:1 › cancel at period end keeps paid access, then resume (mobile)
✓  13 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:176:3 › administrator console: subscriptions, plan governance and F5 exceptions (desktop)
✓  14 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:176:3 › administrator console: subscriptions, plan governance and F5 exceptions (tablet)
✓  15 [chromium] › e2e/pay03b-dealer-subscription.spec.ts:176:3 › administrator console: subscriptions, plan governance and F5 exceptions (mobile)
```

## Run history

Two earlier runs failed, and each failure was fixed at its source:

| Candidate | Result | Cause | Fix |
|---|---|---|---|
| `15bbbac2` | 7 passed, 1 failed, 7 not run | axe `color-contrast` on the billing administrator's Plan & Billing page: white on orange-500 buttons (2.8:1), and an orange-600 eyebrow (3.4:1) | `4007de71`: AA contrast across the PAY-03B UI; axe extended to every PAY-03B surface |
| `4007de71` | 14 passed, 1 failed | `429` at the third administrator view. R12 made more routes count against the one shared per-IP sensitive budget (backend log: `Rate limit exceeded ... /api/pay03b/admin/subscriptions`) | `4863672b`: the journey and the HTTP matrix are paced inside the budget. The limiter itself follows the repository convention; see the certification observation |
| `4863672b` | **15 / 15 passed** | — | — |
| `ccfbbc52` (after the Level 2 findings) | 12 passed, 1 failed, 2 not run | axe on the new refund-dialog check measured 4.24:1. A read-only probe showed why: once enabled, the confirm button fades from opacity 0.5 to 1 over 150 ms (the Button's `transition-all`), sampled at 0.59, 0.85 and 1.0 at 36, 70 and 153 ms. axe ran during the fade. The settled colours are red-700 on white, 6.5:1 | `248970ee`: the spec waits until the confirm button is enabled and at opacity 1 before measuring (harness only) |
| `248970ee` | **15 / 15 passed**, including both dialog checks | — | — |

**Backend log, final run:**
- *Browser run.* 4 ERROR lines, all from the dealer dashboard's leads widget (`GET /api/marketplace/my-listings/inquiries`: the payments-focused UAT database has no `marketplace_inquiries` table). The identical 4 lines are in the `4863672b` run. No PAY-03B route logged an error, and nothing was rate-limited.
- *HTTP matrix run.* 0 ERROR lines, one F5 operator alert (H18a), nothing rate-limited.

## Existing Diaspora browser regressions: 30 / 30 passed

The two existing Diaspora browser specs passed 30/30 at `4863672b`, and again at `ccfbbc52` on 2026-11-01 between 23:40 and 23:41 UTC, from the clean harness worktree. Their source and the app source are identical at `248970ee`. They were run against the candidate source:

- Specs: `web/e2e/diaspora-subscription.spec.ts` and `web/e2e/diaspora-billing-operations.spec.ts`.
- Dev build with `VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED=true`, headed Chromium.
- Both specs fully mock the API. The build was pointed at dead local endpoints (`VITE_API_URL=http://127.0.0.1:5999`, `VITE_SUPABASE_URL=http://127.0.0.1:5998`), so any request the mocks do not intercept fails locally. It never reaches the PAY-01C runtime or production.

The PAY-03A purchase spec (`web/e2e/pay03a-real-report-purchase.spec.ts`) was **not** run: it performs a real Stripe sandbox Checkout, and the PAY-03A authorization does not carry over to PAY-03B. PAY-03A continuity is proven instead by:

- the PAY-03A backend suite;
- the PAY-03A SQL smoke (both certification orders);
- `VehicleHistoryCommerce.test.tsx`;
- HTTP matrix item H21.

```
✓   2 [chromium] › e2e/diaspora-subscription.spec.ts:141:3 › Diaspora Subscription (Phase 8) › route is hidden/unavailable when the flag is OFF, full UI when ON (adaptive)
✓   3 [chromium] › e2e/diaspora-subscription.spec.ts:153:3 › Diaspora Subscription (Phase 8) › page loads for an authed tenant user; plans render from the MOCKED api (not hardcoded)
✓   1 [chromium] › e2e/diaspora-billing-operations.spec.ts:135:3 › reconciliation freshness is judged independently of mismatches › a stale scheduler with zero mismatches is NOT reported as healthy
✓   4 [chromium] › e2e/diaspora-subscription.spec.ts:168:3 › Diaspora Subscription (Phase 8) › current plan is highlighted; synthetic Free shown
✓   5 [chromium] › e2e/diaspora-billing-operations.spec.ts:143:3 › reconciliation freshness is judged independently of mismatches › a never-run reconciliation is called out rather than shown as clean
✓   6 [chromium] › e2e/diaspora-subscription.spec.ts:179:3 › Diaspora Subscription (Phase 8) › active paid sandbox subscription renders active + period
✓   7 [chromium] › e2e/diaspora-billing-operations.spec.ts:149:3 › reconciliation freshness is judged independently of mismatches › a fresh reconciliation with no dead letters raises no operator alarm
✓   8 [chromium] › e2e/diaspora-subscription.spec.ts:189:3 › Diaspora Subscription (Phase 8) › usage meters render with truthful unavailable + exhausted; quota-exhausted is text not color
✓   9 [chromium] › e2e/diaspora-billing-operations.spec.ts:158:3 › dead-lettered provider events › are reported as terminal, not as pending retries
✓  10 [chromium] › e2e/diaspora-subscription.spec.ts:202:3 › Diaspora Subscription (Phase 8) › unlimited usage is shown truthfully (no bounded progressbar)
✓  11 [chromium] › e2e/diaspora-billing-operations.spec.ts:167:3 › operator reconcile action › reports mismatches without claiming success
✓  12 [chromium] › e2e/diaspora-subscription.spec.ts:211:3 › Diaspora Subscription (Phase 8) › ordinary member is read-only (no management controls)
✓  14 [chromium] › e2e/diaspora-subscription.spec.ts:221:3 › Diaspora Subscription (Phase 8) › tenant admin sees management controls + the sandbox notice
✓  13 [chromium] › e2e/diaspora-billing-operations.spec.ts:178:3 › operator reconcile action › a double click starts exactly one run
✓  15 [chromium] › e2e/diaspora-subscription.spec.ts:232:3 › Diaspora Subscription (Phase 8) › ordinary member cannot manage via a DIRECT request — the 403 is surfaced safely
✓  17 [chromium] › e2e/diaspora-subscription.spec.ts:248:3 › Diaspora Subscription (Phase 8) › change-plan requires confirmation
✓  16 [chromium] › e2e/diaspora-billing-operations.spec.ts:193:3 › authorization and money-safety wording › a non-manager sees no operations panel rather than an empty dashboard
✓  18 [chromium] › e2e/diaspora-subscription.spec.ts:260:3 › Diaspora Subscription (Phase 8) › cancel requires confirmation and states the at-period-end effect
✓  19 [chromium] › e2e/diaspora-billing-operations.spec.ts:199:3 › authorization and money-safety wording › the page never claims a real charge, live activation or refund
✓  21 [chromium] › e2e/diaspora-billing-operations.spec.ts:206:3 › authorization and money-safety wording › billing operations are labelled test mode
✓  20 [chromium] › e2e/diaspora-subscription.spec.ts:274:3 › Diaspora Subscription (Phase 8) › duplicate submission is prevented (controls disable while in flight)
✓  22 [chromium] › e2e/diaspora-billing-operations.spec.ts:215:5 › responsive › desktop: health renders without horizontal page scroll
✓  23 [chromium] › e2e/diaspora-subscription.spec.ts:296:3 › Diaspora Subscription (Phase 8) › backend failure shows a safe, retryable state
✓  24 [chromium] › e2e/diaspora-billing-operations.spec.ts:215:5 › responsive › mobile: health renders without horizontal page scroll
✓  25 [chromium] › e2e/diaspora-subscription.spec.ts:309:3 › Diaspora Subscription (Phase 8) › missing tenant context shows the tenant-context state
✓  27 [chromium] › e2e/diaspora-subscription.spec.ts:319:3 › Diaspora Subscription (Phase 8) › keyboard navigation reaches and operates the actions
✓  28 [chromium] › e2e/diaspora-subscription.spec.ts:346:3 › Diaspora Subscription (Phase 8) › aria-live region carries the action result
✓  26 [chromium] › e2e/diaspora-billing-operations.spec.ts:240:3 › request containment › the operations panel issues one health read per mount
✓  29 [chromium] › e2e/diaspora-subscription.spec.ts:358:3 › Diaspora Subscription (Phase 8) › sandbox wording is visible and never claims a real charge
✓  30 [chromium] › e2e/diaspora-subscription.spec.ts:371:3 › Diaspora Subscription (Phase 8) › existing diaspora routes are unaffected (drive/rfq/stock reachable)
```

## Screenshots (`screens/`, JPEG)

- `01`–`08` (from `248970ee`): the dealer journey across the three viewports.
  - Pricing; staff read-only; billing administrator before purchase.
  - Terms review; the simulated provider page.
  - Entitled; cancel at period end.
- `11-admin-refund-dialog-desktop.jpg` and `12-admin-suspension-dialog-desktop.jpg` (from `248970ee`): element captures of the two destructive dialogs, with the AA-compliant red-700 confirm button.
- `09-admin-*-mobile-element.jpg` (from `4863672b`): element captures of the administrator console at 390 px, taken read-only after that run.
  - The subscription list.
  - The subscription detail, including provider-sync exceptions, transitions and change requests.
  - The F5 queue.
- **Full-page administrator captures are not evidence of the PAY-03B panels.** Playwright's full-page mode renders the long console only partly: the files show the PAY-02 catalogue and then repeat the page's top section. That is why `09-admin-console-*` and `10-admin-subscription-detail-desktop` are byte-identical at `4863672b` and `248970ee`. What *is* evidence is the DOM assertions in the spec (row text, F5 open count, invoice payment badges, refund-control counts, axe on each PAY-03B section) and the element captures. The full-page files stay in the protected local evidence directory, identified by SHA-256 (`248970ee` run):

```
d2ebfacd0081e205ea3717b95652220b4eaef54e1a3799f5be9c6c5f5c8ed536  09-admin-console-desktop.png
6a7edfe4965a924f6467d1623ad6dc061db39f24bb434e8dcb14021328366c13  09-admin-console-mobile.png
817da3a0766c7858749769cbbe81ad21a6915640a1a290a656d857e3d03e0dc3  09-admin-console-tablet.png
ffca05f4cd8af9f64c81992b73f40bfc193179c03d5a2c15df5dcf134663fafa  10-admin-subscription-detail-desktop.png
0e19d699ce6d324bd48bc1a3e4a79fe43f23839d1f1d58ce261fa91f3727b046  10-admin-subscription-detail-mobile.png
0ca0a8fe7f472dc71081eccdb141f9a81b13529b04f2080a3b5963005d53895d  10-admin-subscription-detail-tablet.png
```
