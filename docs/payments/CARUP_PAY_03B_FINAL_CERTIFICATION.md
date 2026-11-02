# CARUP-PAY-03B-LR01 — Final certification

**Programme:** CarUp Payments 2.0, Dealer & Business Subscriptions.

**Controlling issue:** #247.

**Branch and PR:** branch `feat/carup-pay-03b-dealer-business-subscriptions`, in Draft PR #251. The PR is stacked on `feat/carup-pay-03a-real-report-sandbox-commerce` (PR #250, Draft, unmerged), so `main` does **not** contain PAY-03A or PAY-03B.

**Frozen parent:** `17fad9b6901e459403ea2048feef4a9ea8335d49`.

**Authority used:**
- Level 1 (code, migrations, offline/local tests, the local provider simulator).
- One Owner-authorized Level 2 Stripe **sandbox** rehearsal, exact scope (section 6).
- **No** production, shared-staging, live-financial or merge action.

The design is described in [CARUP_PAY_03B_DEALER_BUSINESS_SUBSCRIPTIONS.md](CARUP_PAY_03B_DEALER_BUSINESS_SUBSCRIPTIONS.md). Sanitized evidence is in [evidence/pay03b/](evidence/pay03b/README.md).

## 1. Source custody, exact SHAs and CI

| Item | SHA | Notes |
|---|---|---|
| Frozen parent | `17fad9b6` | PAY-03A STG01-FINAL |
| Level 1 physical certification (first) | `4863672be42e283075b0f910be522a17a3c547f0` | Browser journey 15/15 and HTTP matrix 29/29 on this exact build (both tiers report it) |
| **Level 2 runtime** | `fd3434eeedf0486dfbd0d4461d60c53d9cc2803c` | Runtime source identical to `4863672b`: only `backend/tests`, `scripts`, `web/e2e` and CI differ. Adds the Level 2 harness. Backend, web, database and harness all ran this commit |
| Level 2 refund-stage harness | `384daa421bd92e1da9ed95620d960140dfc840b9` | The lifecycle spec only. It ran the refund and after-refund stages against the `fd3434ee` runtime (section 6) |
| Level 2 findings fixed | `ccfbbc528a2484067fa596b126d59c80745e9a2d` | F-L2-01..03 (section 9). Of the 12 files changed since `fd3434ee`, 5 are runtime: the subscription migration (one invoice-writer statement), the subscription service (one preview guard), the PAY-03B display helpers, the dealer page and the administrator console. The other 7 are tests and harness |
| **Final runtime** | `248970eec82311d417b6c333482096de1c9ed78d` | Runtime identical to `ccfbbc52`; the only change is the Level 1 spec waiting for settled colours. Level 1 physical re-run: browser 15/15, HTTP 29/29 (section 5) |
| Final head | see section 10 | Evidence and documents only on top of `248970ee` |

**Lineage:** 21 commits from the frozen parent to the final runtime `248970ee`, changing 65 source and test files. This evidence commit is on top. Every commit is listed in `git log 17fad9b6..HEAD`; the main steps are:

1. F5 and the subscription authority (`fa6793c0`).
2. Adapters, simulator and service (`bb7b1154`).
3. Routes and the publish guard (`edfbcb38`).
4. Diaspora bridge (`5c21fc7c`).
5. UAT tooling (`62f2e47d`, `61cd052e`, `15bbbac2`, `4863672b`, `aaf973d3`).
6. Opt-in gate, CI and design document (`4ac81fad`).
7. Level 2 controls (`fff1085d`).
8. UI (`0a8b6cc6`, `211ccedc`, `4007de71`).
9. Independent-review remediation R1–R14 (`3d6c5e32`).
10. Design-document update (`6346006f`).
11. Level 2 harness: a flake fix (`fa17eae6`), lifecycle browser flows and driver (`fd3434ee`), refund-stage soft assertion (`384daa42`).
12. Level 2 findings F-L2-01..03 (`ccfbbc52`).
13. The Level 1 spec measures dialog contrast on settled colours (`248970ee`).

**PAY-03B exact-head CI** (`.github/workflows/pay03b-dealer-business-subscriptions-ci.yml`) has four jobs:

1. Source certification:
   - F5, provider-adapter, Diaspora-bridge and route-hardening contracts;
   - PAY-01A/B/C, PAY-02 and PAY-03A regressions;
   - Diaspora subscription, billing and entitlement continuity, dealer compliance, listing publication and migration integrity;
   - PAY-03B and PAY-03A UI vitest, plus the Diaspora and config suites;
   - the feature manifest check;
   - `tsc -b` and the web build.
2. Disposable PostgreSQL, *baseline-first*: certified PAY-01C/PAY-02/PAY-03A smokes, then the history fingerprint across the PAY-03B migrations, then the F5, subscription and remediation smokes, then the service and authenticated HTTP tests on real SQL (run serially).
3. Disposable PostgreSQL, *PAY-03B-first*.
4. Physical UAT harness availability.

Results per head are in section 10.

**Unrelated workflows (classified, not claimed green):**

- **Diaspora Deployed Staging UAT:** fails closed with `UNGOVERNED_BRANCH`. This branch has no governed preview pair. The refusal happens on a local pairing-file lookup, before dependency install and before any staging access. Making it pass would mean deploying staging-paired previews, which this assignment is not authorized to do.
- **Diaspora Phases 3-7 Validation:** fails on exactly one test, `diaspora-logistics-rfq.test.js` "SAILING MATCH". The test hardcodes `booking_deadline: '2026-10-01'`, and today is 2026-11-01. The file and the Diaspora services are byte-identical to the frozen parent, and the test fails identically locally. It is a pre-existing, date-expired fixture.

## 2. F5 resolution and regression proof

**Closed.** A partial refund, pending or succeeded, of any canonical PAY-01A or PAY-03B payment behaves as follows:

- **Hold.** The payment moves to the sticky `reconciliation_hold` status.
- **Operator alert.** An immutable-evidence exception opens (`pay03b_payment_reconciliation_exceptions`), and the service logs a structured operator alert.
- **Access suspended.** Report, share and subscription access is suspended.

Only two things end a hold:

1. A provider-confirmed full refund, which moves the payment to `refunded` (superseded).
2. A governed resolution:
   - **Fresh read:** backed by a provider read made within the last 10 minutes. The read is stamped before it is made, and it is refused if a newer provider observation exists (`PAY03B_PROVIDER_VERIFICATION_SUPERSEDED`).
   - **Who may resolve:** a real platform admin who is not the payer and not a member of the paying tenant, giving a written reason.
   - **Outcome:** restore (only if the provider shows nothing refunded) or revoke-final (`partially_refunded`).

The database enforces it. A `BEFORE UPDATE OF status` trigger refuses any exit from `reconciliation_hold` or `partially_refunded` unless a governed writer marks its own transaction. Leaving for `refunded` additionally needs full-refund evidence.

Proof:

- **SQL smokes:** `pay03b-f5-reconciliation-postgres-smoke.sql` and `pay03b-remediation-postgres-smoke.sql`, in both migration orders (see [pg-certification.md](evidence/pay03b/pg-certification.md)).
- **Contract and webhook tests:** `pay03b-refund-mismatch.test.js` (24 tests), with dashboard refunds that carry no CarUp metadata.
- **Real-PG tests:** F5 on a recurring invoice, R10 and R14.
- **HTTP matrix:** H18a and H18b.
- **Mutants:** 8 F5 mutants and the R5, R10 and R11 remediation mutants are all killed.

**Historical rows.** PAY-01C and PAY-03A payment rows are fingerprinted before and after the PAY-03B migrations and are unchanged. The PAY-01C, PAY-02 and PAY-03A smokes pass on the new writers in both orders. The certified `pay01a_apply_provider_snapshot` keeps its signature and delegates to the F5 writer.

## 3. Acceptance criteria (directive §13)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | F5 closed without breaking PAY-03A | **Met** | Section 2; the PAY-03A backend suite, SQL smoke and UI tests; HTTP matrix H21; PAY-02/PAY-03A CI green |
| 2 | Subscription catalogue correctly mapped | **Met** | 7 products, each with its authority, pricing kind, activation and blocker (design document §3); SQL smoke S1–S2; HTTP H01; Pricing at 3 viewports |
| 3 | Dealer subscription has a real authoritative organization owner | **Met** | Owner is `organizations` bound to `tenants`; a missing or ambiguous organization is refused; HTTP H03; smoke S4. Known gap: no onboarding path creates dealer organizations (§8) |
| 4 | No duplicate money ledger | **Met** | Every invoice is one canonical `payment_transactions` row (`pay03b_inv_*`); one payment per invoice and per PaymentIntent; smokes |
| 5 | Recurring invoices and payment references are canonical | **Met** | Invoice table, canonical payment, unique period; HTTP H10 and H13 |
| 6 | Provider, event and entitlement state converge | **Met** | Fresh-read reconciliation; out-of-order convergence; terminal provider states; R1/R2/R6 tests; HTTP H10–H14. Level 2 on Stripe (section 6): 14 signed events, and the provider and canonical records agree object by object |
| 7 | Retries and renewals idempotent | **Met** | Same-key replay (H08b); one live subscription (H08c); renewal collected once (H13); redelivered events finish the work without duplicating it (R1). Level 2 on Stripe (section 6): one renewal invoice, one renewal payment, 0 duplicates |
| 8 | Plan changes, failed payments, grace, cancellation and refunds handled | **Met** | HTTP H14–H19; smoke S9–S17; real-PG tests; browser cancel/resume. Level 2 on Stripe (section 6): cancel at period end and the governed refund of the renewal, both provider-confirmed |
| 9 | Dealer feature guards enforced server-side | **Met (sandbox enforcement)** | Listing-capacity guard at `POST /api/vehicles/:vin/publish`; fails closed (R9). Inert outside a governed sandbox until the Owner approves retail entitlement values |
| 10 | Diaspora subscription authority intact | **Met** | `diaspora_subscriptions` is untouched; 229 Diaspora, dealer and publication continuity tests; 30/30 Diaspora browser regressions; the bridge has no runtime caller (paid Diaspora plans are blocked) |
| 11 | Garage, enterprise and unapproved products blocked | **Met** | Registry constraints: no paid plan can be approved; enterprise is quotation-only; the garage plan is commercially blocked |
| 12 | Customer and administrator interfaces function | **Met** | Browser journey at three viewports with axe WCAG 2 A/AA. Level 2 on Stripe (section 6): customer and administrator flows after every transition. F-L2-02 (destructive-button contrast) was found there and fixed in `ccfbbc52` (section 9) |
| 13 | Full PostgreSQL, HTTP and browser evidence | **Met** | [pg-certification.md](evidence/pay03b/pg-certification.md), [http-matrix.json](evidence/pay03b/http-matrix.json), [browser-uat.md](evidence/pay03b/browser-uat.md), [level2/](evidence/pay03b/README.md#level-2) |
| 14 | Exact-head CI passes on all PAY-03B workflows | **Met** | Section 10 |
| 15 | Independent review: no unresolved high-severity defect | **Met** | Section 9: R1–R14 fixed and mutation-proven (63 mutants killed, plus 7 for the Level 2 fixes: 70/70); Level 2 findings F-L2-01..03 (none high) fixed test-first in `ccfbbc52` |
| 16 | Provider operations have Owner authorization and independent readback | **Met** | Owner decision 2026-11-01T11:03:51Z. The read-only `stripe get` readback, independent of CarUp, reports `WITHIN_AUTHORIZED_SCOPE`: 1 session, 2 ¥500 charges, 1 refund, nothing live (section 6) |

## 4. Required test matrix (directive WU08, items 1–30)

Mechanisms:
- **H##** — authenticated HTTP matrix item ([http-matrix.json](evidence/pay03b/http-matrix.json)).
- **S##** — `pay03b-subscriptions-postgres-smoke.sql` section.
- **R##** — the remediation item, proven by `pay03b-remediation-postgres-smoke.sql` and the named tests.
- **PG** — `pay03b-business-subscriptions.test.js` and `pay03b-tenant-entitlements.test.js` on real PostgreSQL.
- **UI** — the physical browser journey.

| # | Requirement | Proven by |
|---|---|---|
| 1 | Approved plan discoverable | Free tier approved and shown "Free"; sandbox fixtures shown only in a sandbox runtime; H01; UI Pricing; S1–S2. No paid plan is approved (no approved tariff exists) |
| 2 | Draft/unapproved plan cannot be purchased | S3 (`PLAN_NOT_PURCHASABLE`, sandbox plan needs an authorization reference); the claim refuses commercially blocked plans |
| 3 | Incorrect merchant/currency refused | Registry constraints (sandbox merchant, single gateway); R13 checkout amount/currency check (PG R13, mutant); `currency_mismatch` anomaly; H07/H08a (browser money fields ignored) |
| 4 | Free tier initiates no payment | `PAY03B_FREE_PLAN_NEEDS_NO_PAYMENT`; Pricing "Free" links to registration only |
| 5 | Correct dealer organization bound | H03; PG authority; S4. L2: the Stripe customer's metadata names the paying organization; the purchaser is its billing `admin` |
| 6 | Unauthorized staff refused | H05; PG; UI staff read-only (3 viewports); billing authority re-checked in SQL; mutant killed |
| 7 | Cross-tenant checkout refused | H06; H20; middleware 403 |
| 8 | Same idempotency key gives the same subscription | H08b; PG |
| 9 | Conflicting requests cannot duplicate | H08c; unique live indexes (S5); PG resume/abandon |
| 10 | Valid signed webhook processed once | H10; one receipt per event; R1 (redelivery finishes the work). L2: 14 real Stripe events, 14 receipts, 14 distinct ids |
| 11 | Forged webhook rejected | H11; PG reference substitution; simulator signature tests |
| 12 | Out-of-order events converge | Smoke out-of-order checks; R6 (stamped before read; terminal states); mutants. L2: first-invoice events that arrived before the subscription link were ignored without a write, then recorded by the next fresh read |
| 13 | First invoice paid | H10; PG; UI purchase. L2: `in_1UX7tc…` paid ¥500 on Stripe, canonical payment `paid` |
| 14 | Activated only when entitled | H09a (the redirect grants nothing); `active` without a paid period grants nothing (mutant); UI. L2: the provider `active` snapshot carried no paid-through; access began at `invoice_paid` |
| 15 | Renewal paid exactly once | H13; PG renewal; unique-period constraint. L2: one test-clock advance produced one renewal and one charge |
| 16 | Failed renewal fabricates no payment | H14a; PG; S9 |
| 17 | Grace only when authorized | S14; shared status mapping (R14); `grace_without_approval` mutant |
| 18 | Plan change applies correct policy | H15a, H15b; PG |
| 19 | Unauthorized proration or charge refused | H15a (immediate upgrade refused); `unauthorized_proration` and `credit_only_proration` never extend access |
| 20 | Cancel at period end preserves paid-through | H16; PG; UI cancel/resume. L2: provider-confirmed cancel at period end; paid-through unchanged; access active |
| 21 | Immediate cancellation follows terms | S15; `immediate_cancel_keeps_access` mutant |
| 22 | Refund exception suspends paid capabilities | H18a; PG F5; S13 |
| 23 | F5 partial refund cannot leave access active | Section 2; R11 database guard; mutants |
| 24 | Provider outage fabricates no success | R2 transient test (retried, never quarantined, never granted); F5 failed read refuses (502, no change); adapter failures map to 502 |
| 25 | Diaspora entitlements remain correct | Criterion 10 |
| 26 | PAY-03A report entitlements and refunds remain correct | Criterion 1 |
| 27 | RLS blocks direct tenant-data access | S1 (RLS on every table; no `anon`/`authenticated` grants; `service_role` SELECT only); sync-exceptions table included |
| 28 | Admin audit attributable | H17; H19 (audited before and after the provider call); PG suspension and refund; actor taken from the session, never the body. L2: the advance, both reconciles and the refund are audited (requested before, result after the provider call) |
| 29 | Browser UI matches server state | UI asserts server-confirmed access, capacity and invoice state plus database counts; redirect pages show "confirmation pending" until the server confirms. L2: every customer and administrator view is compared with the canonical database after each transition |
| 30 | No production or shared-staging mutation | Section 7 |

## 5. Backend and frontend UAT

**Disposable PostgreSQL** (both migration orders, at the candidate):

- PAY-01C, PAY-02 and PAY-03A certified smokes;
- the history fingerprint;
- the F5, subscription and remediation smokes;
- `PAY03B_POSTGRES_CERTIFICATION_PASS`.

**Real-PG service and HTTP tests:** 28/28, run serially.

**HTTP matrix:** 29/29 at `4863672b` on the physical runtime: real sessions and CSRF, the canonical database, and simulator events delivered over the real webhook path. Notably:

- the operator alert is visible in the runtime log during H18a;
- no backend ERROR-level log line occurred.

**Browser:** real headed Chromium at 1440×900, 768×1024 and 390×844.

- **Dealer journey:** 15/15, with axe WCAG 2 A/AA clean on every PAY-03B surface and no horizontal overflow.
- **Diaspora regressions:** 30/30 (mocked API, flag on).

Two earlier runs failed and were fixed at source, and both are recorded in [browser-uat.md](evidence/pay03b/browser-uat.md):

- WCAG contrast in the purchase UI;
- a `429` from the shared sensitive rate-limit budget.

**Local suites at `ccfbbc52`, whose runtime code is identical to the final `248970ee`, with the CI environment:**

- PAY-03B unit tests: 53/53;
- PAY-01A/B/C, PAY-02 and PAY-03A regressions: 90/90;
- Diaspora, dealer, publication and migration continuity: 229/229;
- real-PostgreSQL service and HTTP tests: 29/29 (serial);
- disposable-PostgreSQL certification: passes in both orders, including the new L2-03 smoke;
- web vitest CI list: 68 files, 1,084 tests;
- feature manifest in sync; `tsc -b` and the web build pass.

**Level 2 browser flows** (section 6): checkout, then views after checkout, renewal, cancel, refund and after refund. They covered customer and administrator, at three viewports, with every value compared to the canonical database.

**Existing Diaspora browser regressions at `ccfbbc52`:** 30/30 (headed, fully mocked API, dead local endpoints), from the harness worktree at `ccfbbc52`. The app source and these specs are identical at `248970ee`.

**Level 1 physical re-run at the final runtime `248970ee`** (2026-11-02). The Owner closed the Level 2 windows at 23:49:59Z, which freed port 5041. Backend, web, database and spec were all at `248970ee`.
- **Database:** rebuilt fresh for each run (44-entry ledger; both PAY-03B migration hashes matched).
- **Browser journey:** 15/15, headed, at three viewports. It now also runs axe on the refund and suspension dialogs, the physical check for F-L2-02.
  - The first attempt at `ccfbbc52` failed that new check at 4.24:1. A read-only probe showed axe was measuring a frame of the button's 150 ms enable fade (opacity 0.59, 0.85 and 1.0 at 36, 70 and 153 ms).
  - `248970ee` makes the spec wait for the settled state. The settled red-700 is 6.5:1. The old colour fails even when settled, at 3.76:1.
- **HTTP matrix:** 29/29, with no backend ERROR line, one F5 operator alert (H18a) and nothing rate-limited.
- **Backend log of the browser run:** the same 4 ERROR lines as at `4863672b`, from the dealer dashboard's leads widget (`marketplace_inquiries` is absent from the payments UAT database). Not PAY-03B.
- **Full-page administrator captures:** these do not render the console's PAY-03B panels. The capture shows the PAY-02 catalogue and repeats the page top, so those files are identical across runs. The PAY-03B administrator evidence is the spec's DOM assertions and the element captures ([browser-uat.md](evidence/pay03b/browser-uat.md)).

## 6. Level 2 Stripe sandbox rehearsal (Owner-authorized exact scope)

**Authorization.** The Owner selected these options (AskUserQuestion) at **2026-11-01T11:03:51Z**: "Authorize exact scope (Recommended)" and "Claude pays (Recommended)". The record is [owner-decision-level2.json](evidence/pay03b/owner-decision-level2.json).

**Authorized scope:**
- Test account `acct_1UVnGaEjgXqvlsJk`.
- Objects: 1 Product, 1 JPY 500/month Price (a sandbox test plan, not a tariff), 1 test clock, 1 Customer.
- Exactly one subscription Checkout, paid by Claude with test card 4242 in a visible browser.
- One test-clock advance, producing one renewal.
- Cancel at period end.
- One governed full refund of the renewal invoice.
- Totals: 2 test charges of JPY 500 and 1 refund. Nothing live.

**Result: complete and within the authorized scope.** One recurring subscription ran end to end against the real Stripe sandbox (test mode): first purchase, renewal, cancellation at period end, and the governed refund of the renewal. The independent provider readback agrees with CarUp's canonical records object by object.

**Runtime and custody:**
- **Runtime:** backend and web at `fd3434ee`. Each run checked the backend's `/api/health` `build.commit_sha` and the web's `carup-provenance.json`.
- **Worktree:** `~/carup-pay03b-uat`, clean, no runtime dotfiles, a path without spaces.
- **Database:** the dedicated stack (55321/55422), rebuilt from the `fd3434ee` migrations at 22:13Z. It has a 44-entry ledger, and both PAY-03B migration SHA-256 values matched.
- **Harness:** the Checkout spec, the lifecycle spec and the driver at `fd3434ee`. The refund and after-refund stages ran from `384daa42`; its only difference from `fd3434ee` is the lifecycle spec (it records finding F-L2-02 as a soft assertion and adds element captures).
- **Credentials:** the Owner started the listener and the backend, typing the `sk_test_` key and the `whsec_` secret into hidden prompts. Neither was echoed, stored or passed in argv.

**Timeline (UTC, 2026-11-01):**

| Time | Step | Through | Result |
|---|---|---|---|
| 23:08:28 | Provisioning (Owner's launcher) | Stripe API, test key | 1 Product `prod_VYEKWgl2XWS0Ar`; 1 Price `price_1UX7rTEjgXqvlsJkEFogJ0kM` (JPY 500/month); 1 test clock `clock_1UX7rUEjgXqvlsJk5NKgD3fh` (frozen at 23:08:27Z) |
| 23:10:28 | **Checkout** (customer, headed browser) | rehearsal spec | One `cs_test_` session. The Sandbox badge and ¥500 were asserted before card entry; Subscribe was clicked once. The server confirmed Active |
| 23:11:12 | After-checkout views | lifecycle spec | Customer and administrator at three viewports, axe clean, the UI matches the database |
| 23:13:01 | **Test-clock advance** (administrator API) | driver | HTTP 200. The clock moved to 2026-12-02T01:08:27Z; the ledger was written before the provider call |
| 23:13:13 | **Renewal** converged | signed webhooks | Renewal `in_1UX7vxEjgXqvlsJkyy1GVtl9` paid ¥500; a second canonical payment |
| 23:14:02 | After-renewal views and administrator *Reconcile* | lifecycle spec | Paid through 2027-01-01; a fresh provider read changed nothing |
| 23:15:41 | **Cancel at period end** (customer, browser) | lifecycle spec | HTTP 200, with a CSRF token and an idempotency key. The provider confirmed it by webhook at 23:15:57 |
| 23:17:20 | Refund, first attempt (administrator, browser) | lifecycle spec | Stopped at the accessibility check **before** the confirm click (F-L2-02). Nothing was sent: 0 refund audit events, both payments still `paid` |
| 23:20:58 | **Governed refund** (administrator, browser) | lifecycle spec at `384daa42` | HTTP 200. Audited before and after the provider call. Refund `re_3UX7vzEjgXqvlsJk0hHiXD4R`, ¥500, succeeded |
| 23:22:15 | After-refund views | lifecycle spec | The renewal shows *Refunded*; paid-through is back to 2026-12-01 |
| 23:22:41 | Final reconcile and canonical readback | driver | `synchronized`, no duplicates |
| 23:22:54 | **Independent provider readback** | `stripe get` (Owner's CLI login) | `WITHIN_AUTHORIZED_SCOPE` |
| 23:23:22 | Protected-records fingerprint | `psql`, read-only | Unchanged |

**Provider against canonical record** ([provider-readback.json](evidence/pay03b/level2/provider-readback.json), [canonical-readback.json](evidence/pay03b/level2/canonical-readback.json)):

| Object | Stripe (independent readback) | CarUp canonical record |
|---|---|---|
| Customer | `cus_VYEMBbCsex91rn` on the test clock; metadata organization `org_pay03b_qa_dealer_c` | Billing customer bound to `org_pay03b_qa_dealer_c`. The purchaser is the tenant's billing `admin` |
| Checkout | `cs_test_a15L…`, mode subscription, `complete`, `paid`, ¥500. Its `client_reference_id` is CarUp's subscription reference | The subscription's `provider_checkout_id` is the same session |
| Subscription | `sub_1UX7tcEjgXqvlsJkfasaqc8Z`, active, `cancel_at_period_end` true, period 2026-12-01 → 2027-01-01 | Active, cancelling at period end, same period |
| First invoice | `in_1UX7tcEjgXqvlsJk48KV7ung`, `subscription_create`, paid ¥500, 2026-11-01 → 2026-12-01 | Same. Canonical payment `pay03b_inv_fdacd461…`, **paid** (`pi_3UX7tcEjgXqvlsJk1sCw9KkO`) |
| Renewal invoice | `in_1UX7vxEjgXqvlsJkyy1GVtl9`, `subscription_cycle`, paid ¥500, 2026-12-01 → 2027-01-01 | Same. Canonical payment `pay03b_inv_8eba638f…`, **refunded** (`pi_3UX7vzEjgXqvlsJk09ZYCY52`) |
| Charges | 2 succeeded, ¥500 each. The renewal charge is refunded in full; the first is not | 2 canonical payments: one paid, one refunded |
| Refund | `re_3UX7vzEjgXqvlsJk0hHiXD4R`, ¥500, `succeeded`, metadata `carup_programme=PAY-03B` | `pay01a_refund_id` is the same refund |
| Totals | 1 customer, 1 session, 1 subscription, 2 invoices, 2 charges, 1 refund. No live object | 1 subscription for the organization, 2 invoices, 2 payment rows in the whole database. 0 duplicate invoices, payments or intents |

**Entitlement through the lifecycle** (dealer C, scope `dealer_storefront`; [ui-observations.json](evidence/pay03b/level2/ui-observations.json)):

| After | Paid through | Access | What the customer page shows |
|---|---|---|---|
| Checkout | 2026-12-01 23:08:27Z | Active (`paid_period`) | Active; up to 10 published listings |
| Renewal | 2027-01-01 23:08:27Z | Active | Both invoices *Payment confirmed* |
| Cancel | Unchanged | Active | "Renewal cancelled — paid access continues until 2 Jan 2027, 08:08 GMT+9" |
| Refund | 2026-12-01 23:08:27Z | Active until then, because the first period stays paid | Renewal *Refunded*; paid-through equals the after-checkout value |

Access began only with the paid invoice. The transition to `active` from the provider snapshot carried no paid-through; access started at `invoice_paid`.

**Time.** The Stripe test clock runs ahead of real time; it ends at 2026-12-02T01:08Z. CarUp evaluates access against real time. So after the refund, the dealer keeps access until the end of the first paid period (2026-12-01 23:08Z) and then has none, because the renewal is refunded and the subscription is cancelling. Showing Stripe end the subscription would need a second advance, which is outside the authorized scope.

**Webhooks** ([event-receipts.json](evidence/pay03b/level2/event-receipts.json)):
- 14 signed events, one receipt per event id (14 distinct).
- The first invoice's `invoice.*` events arrived before CarUp had linked the subscription id. They were acknowledged as unmatched, with no write. The `checkout.session.completed` fresh provider read then recorded that invoice. Events trigger provider reads; they are never applied as data.
- The PAY-01A webhook path wrote no receipt (0).

**F5 and integrity during the rehearsal:**
- The governed refund opened no reconciliation exception. A full, provider-confirmed, CarUp-initiated refund is not an anomaly; F5 holds are for refunds made outside CarUp (section 2).
- The first payment stayed `paid`.
- After the refund and a fresh provider read, the cancellation still stands. Nothing was reinstated.

**Findings.** The rehearsal found three defects, all fixed afterwards in `ccfbbc52` (section 9):
- F-L2-01: plan actions offered across gateways, and the preview called the provider first.
- F-L2-02: WCAG contrast on the destructive confirm buttons.
- F-L2-03: the refund's coverage transition was labelled `invoice_paid`.

## 7. Financial and environment safety

**Production:** no access of any kind during PAY-03B.
- No production MCP call at any point in the session.
- No production deploy, secret, webhook or database operation.
- Executable paths assemble project references from fragments and refuse production and staging references.

**Shared staging:** no access and no mutation during PAY-03B.
- The PAY-03B directive arrived at 2026-11-01T09:18:05Z.
- The session's only staging calls were ten read-only `SELECT`s at 02:31–07:51Z, for the earlier PAY-03A assignment.
- The pre-existing "Diaspora Deployed Staging UAT" workflow refused before any staging access (section 1).

**Local evidence stacks:**
- The PAY-01C/PAY-03A evidence stack (54321/54322) was never written. A read-only fingerprint (row count and content MD5 of all 9 payment tables, inside a `READ ONLY` transaction) is identical before (23:09:47Z) and after (23:23:22Z) the Level 2 rehearsal: [protected-records-fingerprint.txt](evidence/pay03b/level2/protected-records-fingerprint.txt).
- All UAT ran on the dedicated `carup-pay03b-supabase` stack (55321/55422).
- The Supabase CLI ran only from the isolated stack directory, under `env -i`.

**Owner processes:**
- *PAY-03A backend (port 5031, pid 47337).* It was running at 22:13Z and had stopped by 23:08Z. The Owner's PAY-03B listener then ran in the same Owner terminal (same parent process). I never signalled it.
- *PAY-01C listener (pid 25878, forwarding to port 5017).* It kept running. Nothing listened on 5017, so the copies of Level 2 events it received were delivered nowhere.
- *PAY-03A runtime.* It ignores any event without a `pay01a_` reference before any database access.
- *The Level 2 listener and backend.* The Owner started both, and they were closed by the Owner.

**Money:**
- Level 1 used only the labelled local simulator; HTTP H22 proves no Stripe object was created in Level 1.
- Provider-side operations happened only within the Level 2 scope (section 6). The independent readback counts exactly that:
  - 1 product, 1 price, 1 test clock, 1 customer;
  - 1 Checkout session;
  - 1 advance;
  - 2 succeeded ¥500 charges and 1 refund.
- No live key was ever used. Adapters refuse live keys and live objects.

**Repository:** nothing committed contains a credential, signed URL, test-card detail, secret provider material or private user data.
- QA identities are synthetic (`.invalid`).
- Screenshots that show card entry are kept out of the repository. Stripe's publicly documented test-card number appears only as a constant in the rehearsal spec (committed earlier, at `aaf973d3`).
- Full-page captures are referenced by SHA-256. The administrator full-page captures do not show the PAY-03B panels (section 5); the element captures and DOM assertions are the evidence.

**Merge:** no merge, force-push or rebase. PR #251 remains a Draft, stacked on PR #250.

## 8. Genuine blocker classification (commercial activation; none block QA mechanical acceptance)

| Blocker | Class | Owner of the decision |
|---|---|---|
| No approved retail tariff for any paid plan (dealer storefront, Diaspora paid tiers, garage plan) | COMMERCIAL | Owner |
| Merchant of record, Zimbabwe collection provider, tax treatment and customer agreements not approved | COMMERCIAL / LEGAL | Owner |
| Retail entitlement values (listing capacity) and a renewal grace policy (without approved grace, about one hour of no paid access at each Stripe renewal) | PRODUCT / COMMERCIAL | Owner |
| Terms of Service legal feature text (ZINARA references, "100 cars", fee table) describes functionality not implemented or sold | LEGAL | Owner / legal |
| No product onboarding path creates dealer organizations, tenants or memberships | PRODUCT | Moderator / Owner |
| `public.garages` (named by PAY-02) does not exist; garages are `tenants` of type `garage` | ARCHITECTURE | Moderator |
| Disputes and chargebacks are not handled by PAY-03B | SCOPE | Moderator (later programme) |
| Production activation, live keys and webhooks | LEVEL 3 — forbidden here | Owner |

## 9. Independent certification challenge

**Independent review.** The review of `17fad9b6..fff1085d` found 2 High, 5 Medium and 6 Low issues, R1–R14. All are fixed.

**Test-first.** Each fix had a failing test written first: the remediation smoke, real-PG tests, unit tests and adapter tests. Each fix was then proven by a mutant that removes it. The table is in design document §11.

**Mutation testing:** 63 unique mutants for the review remediation, all killed (42 SQL and 21 JS). A further 7 cover the Level 2 fixes, all killed, for 70/70 in total. See [mutation-results.md](evidence/pay03b/mutation-results.md).
- Four stale substitutions were re-targeted after the remediation rewrote their code.
- One initial survivor (the invoice-history bound) led to a stronger test, after which it was killed.

**Defects found by the challenge itself and fixed:**
- An admin resume could revive a cancelled subscription from a stale "active" provider read. Terminal provider states are now ignored whole.
- Assertions were made NULL-safe so that mutants cannot pass vacuously.
- Masked second-line defences (manual-invoice coverage, cancelled status) are now tested on their own.
- A QA seed re-run defect.
- WCAG contrast in the purchase UI.

**Defects found by the Level 2 rehearsal, fixed in `ccfbbc52`.** Each fix is bounded and had a failing test written first. None affected money, access or the lifecycle path itself.

| Finding | Severity | Root cause | Fix | Proof |
|---|---|---|---|---|
| **F-L2-01** Plan actions across gateways | Low | The plan-change *preview* checked scope but not gateway compatibility, so it called the provider with another gateway's price reference. The dealer page offered Subscribe or Change on plans whose provider allowlist excluded the billing gateway. The database already refused the change and the checkout before any provider call. Reachable only where plans of two gateways coexist (QA fixtures); production permits neither the simulator gateway nor sandbox fixtures | The preview applies the database's gateway rule before any provider call (`PAY03B_TARGET_PLAN_NOT_PURCHASABLE`). The page offers Subscribe or Change only when the billing gateway is on the plan's allowlist | Real-PG test: preview and change refused with **zero provider calls** (RED: "Missing expected rejection"). Vitest covers the helpers and both page cases |
| **F-L2-02** WCAG 2 AA contrast | Medium (accessibility) | PAY-03B destructive confirm buttons (refund, suspend, immediate cancel, abandon checkout) used the theme's `bg-destructive`. White on `#ef4444` is 3.7:1, below 4.5:1. None of these four dialogs was opened in the Level 1 axe pass | One PAY-03B class, red-700 (6.5:1) in every colour mode. The shared theme is untouched | Vitest asserts it on all four buttons (RED first). The Level 1 browser spec now runs axe on the refund and suspension dialogs (section 5) |
| **F-L2-03** Refund transition label | Low (audit clarity) | After the governed refund, the transition that revoked the renewal's coverage was recorded as `invoice_paid`. Its cause came from the provider invoice status, which stays `paid` after the charge is refunded | The cause names the canonical payment outcome (`invoice_paid:payment_refunded`). The administrator list formats compound causes ("Invoice paid · payment refunded") | Remediation smoke L2-03 in both migration orders. RED: "recorded as invoice_paid". The inverted-condition mutant is killed. Vitest covers the formatter |

**Residual observations (not defects in PAY-03B, recorded for the Moderator):**
1. **Shared sensitive rate-limit budget.** Every sensitive route in the repository (login, checkouts, admin consoles, and now the R12 provider-calling PAY-03B routes) shares one per-IP counter, with a 10/min budget on most PAY-03B routes. One administrator view spends three sensitive reads. Heavy operator use from one IP or office NAT can exhaust the budget, including for login. PAY-03B follows the repository convention; a per-route or per-user budget for authenticated administrator reads is a cross-programme recommendation.
2. **Publish capacity race.** The listing-capacity count and the publish write are separate requests, so two simultaneous publishes could exceed capacity by one. Retail enforcement should move into a publish function.
3. **Renewal gap.** See the grace-policy blocker in §8.
4. **No runtime caller.** The Diaspora bridge has none, by design, until paid Diaspora plans are approved.

## 10. Recommendation and progression

**Exact-head CI on PR #251:**

| Head | PAY-03B workflow (4 jobs) | Every other workflow |
|---|---|---|
| `fa17eae6` | **Attempt 1:** the *baseline-first* PostgreSQL job failed at job setup. Docker Hub timed out pulling `postgres:17-alpine` three times, before any SQL ran; the other three jobs were green. **Attempt 2** re-ran the failed job with no code change: **4/4 green** | Green except the two classified below |
| `fd3434ee` (Level 2 runtime) | **4/4 green** | Green except the two classified below |
| `384daa42` | **4/4 green** | Green except the two classified below |
| `ccfbbc52` | **4/4 green** | Green except the two classified below |
| `248970ee` (final runtime) | **4/4 green** | Green except the two classified below |
| Final head (evidence only) | Reported in the specialist's return; a commit cannot contain its own CI result | — |

"Green" covers PAY-01B UI R1, PAY-01C source certification, PAY-02 and PAY-03A commerce, Communication Command Center, and Referral Engine.

The two workflows that are not green are unrelated, pre-existing, and unchanged since section 1:
- **Diaspora Deployed Staging UAT** fails closed with `UNGOVERNED_BRANCH` before any staging access.
- **Diaspora Phases 3-7 Validation** fails only on the date-expired "SAILING MATCH" fixture (1 of 1,458 tests).

**Recommendation: RECOMMEND ACCEPT.** This is QA and sandbox mechanical acceptance of PAY-03B, not commercial readiness.

The full recurring lifecycle is certified in the isolated sandbox: first purchase, provider-confirmed renewal, cancellation at period end, and governed refund. It ran on the real Stripe sandbox, within the Owner's exact recorded scope, and is backed by:
- an independent provider readback that agrees with the canonical records object by object;
- PostgreSQL certification in both orders;
- real-PG, unit and UI suites;
- physical HTTP and browser evidence at the final runtime;
- green exact-head PAY-03B CI.

The rehearsal found three defects; all were fixed test-first and re-verified physically. No high-severity defect is open.

Commercial activation stays blocked by the Owner, legal and product items in section 8. Production activation is Level 3, which this assignment forbids.

**Progression: PAY-04, Garage Invoices, Parts and Workshop Service Payments.** After the Moderator accepts PAY-03B, freeze its accepted scope at the final head. PR #251 stays a Draft, stacked on PR #250; the merge order (#250, then #251) is the Owner's. PAY-04 should:
- reuse the canonical `payment_transactions` ledger, the F5 hold protections and the governed refund path;
- keep the **Garage financial authority separate**. Garages are `tenants` of type `garage`, and `public.garages` does not exist (section 8);
- **not** route one-off garage invoices or parts payments through the PAY-03B subscription authority;
- treat garage tariffs, the merchant of record and tax as Owner decisions that block any commercial activation.
