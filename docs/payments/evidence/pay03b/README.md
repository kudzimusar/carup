# CARUP-PAY-03B-LR01 — sanitized evidence

Evidence for [../../CARUP_PAY_03B_FINAL_CERTIFICATION.md](../../CARUP_PAY_03B_FINAL_CERTIFICATION.md).

**Sanitization:** nothing here contains a credential, session token, password, signed or hosted provider URL, client secret, test-card detail, customer contact detail or secret provider material.
- QA identities are synthetic (`.invalid`).
- Provider identifiers are object ids only.
- The full working evidence, including logs, the protected UAT account file (0600) and full-page captures, stays outside the repository in `~/carup-launch-evidence/pay03b/`.

| File | What it proves | Candidate |
|---|---|---|
| [pg-certification.md](pg-certification.md) | Disposable PostgreSQL in both migration orders:<br>• certified PAY-01C, PAY-02 and PAY-03A smokes<br>• history fingerprint across the PAY-03B migrations<br>• F5, subscription and remediation (R1–R14) smokes | `248970ee` (SQL of `ccfbbc52`, including the L2-03 smoke) |
| [http-matrix.json](http-matrix.json) | Authenticated HTTP matrix 29/29 on the physical runtime (local provider simulator); also 29/29 at `4863672b` | `248970ee` |
| [browser-uat.md](browser-uat.md) and [screens/](screens/) | Real headed Chromium at three viewports:<br>• dealer journey 15/15, axe WCAG 2 A/AA clean, no overflow, plus the refund and suspension dialogs<br>• existing Diaspora browser regressions 30/30<br>• every earlier failed run and its fix | `248970ee` (first certified at `4863672b`) |
| [mutation-results.md](mutation-results.md) | 70 unique mutants, all killed: the 63 from the review remediation plus 7 for the Level 2 findings | current SQL, services and UI |
| [owner-decision-level2.json](owner-decision-level2.json) | The Owner's recorded Level 2 decision and exact limits (2026-11-01T11:03:51Z) | — |
| [level2/](#level-2) | The Owner-authorized Stripe sandbox rehearsal: the full recurring lifecycle, its independent provider readback and the canonical records | runtime `fd3434ee` |

## Level 2

The Owner-authorized Stripe **sandbox** rehearsal (test mode, account `acct_1UVnGaEjgXqvlsJk`) ran on 2026-11-01 from 23:08 to 23:23 UTC. Backend, web and database were at `fd3434ee`. The refund and after-refund browser stages ran from harness `384daa42`, which differs only in the lifecycle spec.

| File | What it proves |
|---|---|
| [level2/provisioning.json](level2/provisioning.json) | The authorized sandbox objects: 1 product, 1 JPY 500/month price, 1 test clock. Ids only |
| [level2/checkout.json](level2/checkout.json) | The one Checkout session and the canonical subscription it created. The response amount was not captured (the page went to Stripe first), so it is recorded as `null` |
| [level2/test-clock-ledger.json](level2/test-clock-ledger.json) | The one test-clock advance, recorded before the provider call |
| [level2/driver-log.json](level2/driver-log.json) | The advance and the reconciles, through CarUp's administrator API with real sessions and CSRF |
| [level2/ui-observations.json](level2/ui-observations.json) | What the customer and administrator pages showed after each transition, next to the canonical state |
| [level2/event-receipts.json](level2/event-receipts.json) | The 14 signed Stripe events (one receipt each) and every lifecycle transition |
| [level2/canonical-readback.json](level2/canonical-readback.json) | The final canonical records: subscription, invoices, payments, entitlements, change requests, audit, duplicate checks |
| [level2/provider-readback.json](level2/provider-readback.json) | Independent read-only `stripe get` readback: `WITHIN_AUTHORIZED_SCOPE` (1 session, 2 ¥500 charges, 1 refund, nothing live) |
| [level2/protected-records-fingerprint.txt](level2/protected-records-fingerprint.txt) | The protected PAY-01C/PAY-03A payment tables are identical before and after the rehearsal (read-only fingerprint) |
| [level2/screens/](level2/screens/) | Customer and administrator captures for each transition (JPEG; see the list below) |
| [level2/screens-sha256.txt](level2/screens-sha256.txt) | SHA-256 of every Level 2 capture, including those kept outside the repository |

**Captures in the repository:**
- **Checkout:** `01`–`05`, Stripe's hosted page shown *before* card entry.
- **After each transition:** `10` (checkout), `12` (renewal), `20`–`21` (cancel), `29`–`31` (refund), `32` (after refund). Customer pages appear at desktop and mobile.
- **Administrator panels:** `34`–`36`, captured as elements: the subscription detail, its row and the F5 panel.
- **Finding F-L2-02:** `30a` shows the first refund attempt stopped at the accessibility check before the confirm click.

**Kept outside the repository and listed by hash:**
- `04-test-card-entered.png`, which shows test-card entry.
- The tablet captures.
- The administrator full-page captures (about 23,000 px tall).

All three stay in `~/carup-launch-evidence/pay03b/screens/level2/`. Playwright's full-page mode does not render the console's PAY-03B panels: it shows the PAY-02 catalogue and repeats the page's top section. That is why the administrator evidence is the element captures (`29`–`31`, `34`–`36`) and the DOM assertions in the lifecycle spec.

Runtime provenance is proven inside each run:
- **Web:** `carup-provenance.json` matches the candidate.
- **Backend:** `/api/health` `build.commit_sha` matches the candidate.
- **Database:** the UAT database was rebuilt from the candidate's migrations, with a 44-entry ledger and the two PAY-03B migration SHA-256 values matched.
