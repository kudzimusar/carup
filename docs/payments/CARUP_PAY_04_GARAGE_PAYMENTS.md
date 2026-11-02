# CARUP-PAY-04 — Garage invoices, parts and workshop service payments

Programme issue #247 · Moderator framework 11-11-GM-GC-001 v1.0 · Branch `feat/carup-pay-04-garage-payments`
Authority: **Level 1 only** (internal implementation, off-platform payment declaration, offline provider simulation,
isolated physical UAT). Production: none. Shared staging mutation: none. Live payment: none. Merge: none.

This document is the design and integration record. The certification evidence and the recommendation are in
[`CARUP_PAY_04_FINAL_CERTIFICATION.md`](CARUP_PAY_04_FINAL_CERTIFICATION.md); sanitized evidence is under
[`evidence/pay04/`](evidence/pay04/).

## 1. What PAY-04 does

PAY-04 connects the Garage 1.0 Business OS (OPS01–OPS07) to the Payments 2.0 foundation (PAY-01A, PAY-02, PAY-03A,
PAY-03B) so a garage customer's journey runs end to end:

appointment → estimate → customer authorization → diagnostic / labour / parts work → **invoice** → **payment
instructions** → **payment evidence** → declared or provider-confirmed payment state → **allocation** → **receipt** →
refund or reversal → customer history → garage financial overview.

It creates no new garage OS, no second invoice authority and no new billing system:

| Authority | Owner | PAY-04 relation |
|---|---|---|
| The invoice (obligation) | Garage OPS07 `garage_invoices` / `garage_invoice_lines` | unchanged; one additive line-provenance guard |
| Declared payments | Garage OPS07 `garage_payment_records` (`source = 'garage_recorded_external'` only) | never written by PAY-04 |
| Declared receipts | Garage OPS07 `garage_receipts` | never written by PAY-04; receipt numbers shared |
| The money ledger | PAY-01A `payment_transactions` + PAY-02 commercial columns | provider-confirmed garage payments are canonical rows of **third-party** money |
| Reconciliation holds | PAY-03B F5 | reused through its own functions (one bounded garage branch each) |
| Provider-confirmed allocation, provider receipts, discrepancies | **PAY-04** (new, additive) | `pay04_*` tables |

## 2. The financial rule

Garage customer revenue belongs to the garage. PAY-04 keeps five things apart and never lets one stand for another:

1. **CarUp's own SaaS charges** — PAY-03B; untouched.
2. **The garage's customer invoice** — OPS07; an obligation, never proof of payment.
3. **Payments the garage declares it received off-platform** — OPS07 `garage_payment_records`, labelled *"Recorded by the
   garage. CarUp has not processed or verified this payment."* everywhere they appear.
4. **Payments confirmed by a provider acting for the garage's own merchant** — PAY-04 collections: a canonical
   `payment_transactions` row with `pay02_product_code = 'gar.invoice.customer_payment'`,
   `pay02_commercial_category = 'category_b_third_party'`, `pay02_funds_owner = 'garage_business_tenant'`,
   `pay02_legal_beneficiary = 'tenant:<garage>'`, `pay02_settlement_status = 'not_applicable_sandbox'`. Labelled
   *"Confirmed by the garage's payment provider. The money is paid to the garage, not to CarUp."*
5. **Refunds and adjustments** — attributed to the original merchant and payment (declared reversal rows; provider
   refunds through the same collection; void + re-issue for invoice adjustments).

CarUp Japan's Stripe merchant can never collect garage money: no PAY-04 table admits a Stripe gateway value, the PAY-02
catalogue lists `stripe_carup_japan_sandbox` as prohibited for every garage product, and the merchant registration
function refuses any gateway the runtime guard does not permit.

## 3. Source custody and integration

The two accepted lineages had never met. PAY-04 integrated them before writing integration code.

| Item | Value |
|---|---|
| Accepted Payments parent | `c2d548edbe4cc7ac9528f3c4a2c7f55a1d8bad88` (PAY-03B, PR #251 Draft; PAY-03A PR #250 Draft) |
| Accepted Garage parent | `69e12e21941a318c1ad6a3266cc8144de44c5d32` (Garage Final, PR #242 Draft; on OPS03 `07b60e5d`, PR #241) |
| Shared ancestor | `577428de` (2026-09-26; not on `main`) |
| Divergence | Payments +186 commits / 424 files / 11 migrations; Garage +667 commits / 1,156 files / 44 migrations |
| Integration merge | `3ab0d7eb` (parents `c2d548ed`, `69e12e21`): 32 overlapping files, 21 conflicts, each resolution recorded in the commit message |
| Verification | byte-identity of 1,516 one-sided paths against their parent (4 documented integration edits differ); `tsc -b`; 0 net-new lint; both lineages' suites (Garage new domains 120/120, inherited 642/642, races 16/16; PAY-03B steps 53/90/229, PG certification both orders, real-PG 29/29; web 3,545/3,545) |
| Post-merge fixes | `0ee715ae`: an OPS03 fixture that had expired on its own calendar (failed identically on `69e12e21`), the REL-02 label order, and the legacy-hash chain check |

Mechanism: one merge commit with both accepted heads as parents, rather than cherry-picking the 141-file Garage PR,
so every Garage commit keeps its original identity and attribution and `git merge-base --is-ancestor` proves custody.
The PAY-04 CI re-proves it on every run (both parents are ancestors; no migration either parent shipped is rewritten;
PAY-04 migrations sort after both tips and carry `-- +migrate Up/Down`).

**Integration hazards found and how they are handled**

- *Out-of-order migrations.* Four T11-CAP migrations (2026-09-20…26) on the Payments line sort before the
  Garage/staging ledger tip. A Garage-lineage database receives them out of order. The integrated PostgreSQL
  certification therefore runs **both** orders (`payments-first`, `garage-first`).
- *Single-lineage custody in `garage-final-ci.yml`.* Its PR trigger never fires for a PR based on the Payments line, and
  its custody checks assume one parent. PAY-04 adds `pay04-garage-payments-ci.yml` with two-parent custody instead of
  editing the Garage workflow.
- *Shared function re-statement.* Several lineages re-state `communication_domain_event_dedupe_key()`; the last writer
  wins. PAY-04 adds its notification identity with its **own** trigger (the T11-CAP-08 pattern) and does not touch the
  shared function.
- *PAY-03B F5 functions re-created by PAY-04.* Four F5 functions carry one garage branch each. A static test
  (`pay04-f5-extension-drift.test.js`) fails if the transition function differs from F5 in anything but its two
  identifier-shape lines, if a hook loses a PAY-03B line, or if a later migration re-states one without the garage
  branch.

## 4. Database changes (all additive)

### 4.1 `20261102100000_carup_pay04_garage_invoice_integrity.sql` (Garage-only)

- **Invoice-line provenance** (`trg_pay04_guard_invoice_line_provenance`, BEFORE INSERT on `garage_invoice_lines`,
  after OPS07's own guard). A line that names a source must be true about it:

  | `source_kind` | Rule | Refusal |
  |---|---|---|
  | `part_usage` | category `part`; a recorded OPS06 consumption of this garage **on this job**; not reversed; quantity billed across live invoices ≤ quantity consumed | `PAY04_LINE_SOURCE_CATEGORY_MISMATCH`, `PAY04_LINE_SOURCE_NOT_ON_THIS_JOB`, `PAY04_LINE_SOURCE_REVERSED`, `PAY04_LINE_QUANTITY_EXCEEDS_RECORDED_USAGE` |
  | `service_record` | not category `part`; one of this job's service records | `PAY04_LINE_SOURCE_CATEGORY_MISMATCH`, `PAY04_LINE_SOURCE_NOT_ON_THIS_JOB` |
  | `manual` | never category `part` (a part is billed only from recorded consumption) | `PAY04_PART_LINE_REQUIRES_RECORDED_USAGE` |

  Lines issued before PAY-04 are history: never re-judged (OPS07 lines are immutable). Stock is deducted exactly once —
  when consumption is recorded (OPS06) — never by invoicing, a payment or a provider webhook.
- **Garage payment instructions** (`pay04_garage_payment_instructions`): the garage's own words on how to pay it
  (payee, text, accepted methods, currencies). Versioned and append-only (one active version; the only change is
  active → superseded); set only by a garage administrator through `pay04_set_garage_payment_instructions`; audited in
  `trust_audit_events`. Customers always see them with *"These payment instructions come from the garage. Pay the
  garage directly. CarUp does not receive, hold or verify this money."*
- **Adjustment policy**: void + re-issue (OPS07). One live invoice per job; the voided invoice stays readable with its
  history; no credit notes; no edits.

### 4.2 `20261102110000_carup_pay04_garage_provider_payments.sql`

| Object | Purpose |
|---|---|
| `pay04_runtime_guard` | singleton; the simulator gateway is refused unless a disposable database enables it |
| `pay04_garage_merchant_accounts` | the garage's merchant identity at a provider; Level 1 admits only `pay04_garage_provider_simulator` with status `simulated` / `suspended`; registered and suspended only by a platform administrator; immutable except suspension |
| `pay04_garage_collections` | one provider checkout for one invoice by one payer; immutable identity; provider ids and cancellation written once; `expires_at` bounds the reservation |
| `pay04_garage_payment_allocations` | **append-only** ledger counting provider money toward the invoice (allocation / deallocation); its insert guard keeps every invariant even for a direct writer: governed writer only, binding to the collection, net 0…amount per collection, declared + provider ≤ total per invoice, live invoice only |
| `pay04_garage_provider_receipts` | one **live** receipt per collection, equal to the money it currently counts; numbered from the garage's own `RCT-` counter (shared with OPS07, gapless); voided, never deleted |
| `pay04_garage_collection_events` | append-only history (who: the payer, the garage, an operator or `provider:<gateway>`) mirrored to `trust_audit_events` |
| `pay04_provider_event_receipts` | provider event identity (`evt_gsim_…`): a replay changes nothing; a replay against another collection is refused |
| `pay04_garage_payment_discrepancies` | provider evidence that does not match (`merchant_mismatch`, `currency_mismatch`, `amount_mismatch`) or money the invoice cannot absorb (`unallocated_provider_money`); first-detection evidence immutable; closed only by a platform operator, separated from the payer and the garage, with a written note — or automatically when the provider confirms a full refund |

**Derived money.** `pay04_invoice_money(invoice)` returns total, declared, provider-confirmed, paid, balance,
**reserved** (provider money in flight: a live checkout, a refund in progress, an F5 hold, an unresolved provider
mismatch) and the **uncommitted balance** (total − paid − reserved). OPS07's `garage_ops07_invoice_balance` is
re-created with the **same signature and vocabulary**: declared net + provider allocated net. For an invoice without
provider money every value is identical to OPS07's; the certification proves it by fingerprinting every invoice
balance before and after PAY-04.

**Guards on OPS07 paths** (additive triggers): a declared payment may not commit reserved money
(`PAY04_PAYMENT_EXCEEDS_UNCOMMITTED_BALANCE`); an invoice cannot be voided while provider money is counted, present or
in flight (`PAY04_INVOICE_HAS_PROVIDER_PAYMENTS`, `PAY04_INVOICE_HAS_PAYMENT_IN_PROGRESS`).

**Governed writers** (SECURITY DEFINER, `service_role` only): register / suspend merchant; begin collection (customer
only — requester or registered owner of the case's vehicle; never a garage member; invoice currency only; precision;
≤ uncommitted balance; idempotent per payer key); attach provider ids once; **apply provider snapshot** (the single
provider-state writer); request a full refund (garage administrator); cancel a checkout (payer or garage
administrator; the canonical payment stays `pending` until the provider says otherwise, so a late confirmation is still
recorded); resolve a discrepancy.

**PAY-03B F5 reuse.** The snapshot writer computes every transition with `pay03b_payment_transition_target`, records
holds and exceptions with `pay03b_record_payment_hold`, and leaves holds only through the governed GUC
(`pay03b_guard_payment_hold_release`). A provider-reported partial refund therefore puts a garage payment on the same
sticky reconciliation hold as a CarUp payment; the operator resolves it through the existing PAY-03B surface
(`pay03b_resolve_payment_reconciliation_exception`), which now re-projects the garage invoice in the same transaction.
The four re-created F5 functions:

| Function | Garage branch |
|---|---|
| `pay03b_payment_transition_target` | the garage simulator shares the simulator identifier shapes (`sim_pi_` / `sim_re_`); Stripe rows keep `pi_` / `re_` |
| `pay03b_payment_owner_lock` | a garage collection serializes on its invoice before the payment-reference lock |
| `pay03b_after_payment_resolution` | an operator resolution re-projects the garage allocation and receipt |
| `pay03b_payment_payer_conflict` | every member of the beneficiary garage is conflicted, like the payer |

**Allocation semantics.** The counted amount of a collection follows the canonical payment state: `paid` → the
collection amount; `partially_refunded` (operator-confirmed final partial refund) → amount − verified refund; anything
else (`pending`, `cancelled`, `refund_pending`, `refunded`, `reconciliation_hold`) → 0 (fail closed). It is capped by
what the invoice still owes; any excess is an open `unallocated_provider_money` discrepancy.

**Lock order** (every garage-collection writer and the F5 resolution): invoice advisory lock → payment-reference
advisory lock (the PAY-03A/F5 lock) → rows.

### 4.3 `20261102120000_carup_pay04_garage_payment_notifications.sql`

`garage.payment.confirmed` and `garage.payment.refunded` get a once-only database identity from their own trigger
(`event_type:notificationKey`), agreeing with `eventBusService` (`PAY04_DEDUPED_EVENTS`). They use the governed in-app
template `garage_commercial_update_v1`; the headline names what the **provider** confirmed and never an amount.

### 4.4 Privacy and privilege

All `pay04_*` tables: RLS enabled; no grant to `anon` or `authenticated`; `service_role` SELECT only; every write
through a SECURITY DEFINER writer owned by `postgres` (on Supabase `postgres` and `service_role` have BYPASSRLS, so RLS
is enabled rather than forced). Internal helpers (re-projection, discrepancy recording, logging, guards) are executable
by no API role.

## 5. Provider adapter interface (Mode 2)

`backend/services/payment/pay04ProviderAdapters.js` defines the interface every garage provider implements, always for
one registered garage merchant and never for CarUp:

`createCheckout` (idempotent per collection) · `cancelCheckout` · `refund` (full, idempotent per key) ·
`getPaymentTruth` (status, reported amount / currency / merchant, refund evidence classified by the PAY-01A/F5
classifier) · `verifyWebhook` (signature, replay window, shape).

Money truth is always a **fresh `getPaymentTruth()` read** applied through `pay04_apply_garage_provider_snapshot`. A
signed webhook only names the trigger and the event identity; a browser return proves nothing.

| Gateway | Status |
|---|---|
| `pay04_garage_provider_simulator` | Level 1, local disposable environments only: own `gsimsec_` secret, `gsim_co_` / `sim_pi_gar_` / `sim_re_gar_` / `evt_gsim_` identifiers, refuses production, every page says SIMULATED |
| `paynow_zimbabwe` | candidate; every call refuses `PAY04_PROVIDER_AUTHORITY_PENDING`. Needs the garage's merchant contract, provider credentials held by CarUp, Owner authorization, a migration admitting the gateway value and PAY-05 provider certification |

## 6. Application surfaces

| Who | Where | What |
|---|---|---|
| Customer | My Service Requests (invoice card) | lines, amount due; money **by source** (recorded by the garage / confirmed by the provider / in progress, not counted); declared payments and receipts with the "not verified" label; provider payments and receipts with the garage-not-CarUp label; **How to pay**: the garage's instructions and disclosure, online payment only where it really exists (clearly simulated in Level 1), own provider payments with *Check payment status* / *Stop*; back from the provider, one fresh provider read before anything is called paid |
| Garage administrator | Garage Hub invoice view | money breakdown by source; provider payments with refund (reason required), check-with-provider and stop; provider receipts; provider payment activity |
| Garage administrator | `/garage/payments` | money per currency (never summed across currencies; never called CarUp's); provider connection; payment-instructions publisher and version history |
| Platform operator | `/admin/garage-payments` | discrepancies with evidence and audit trail, governed closure; garage F5 holds (resolved in the existing reconciliation console); simulated merchant accounts |

Every failed read renders as an explicit error with a retry — never as an empty list or "nothing owed".

## 7. Security, authority and limits

- Identity always from the proven session; customers act only on cases they follow and only on their own collections
  (anything else is a 404, never a 403 that confirms existence); garage routes act on the session's verified garage
  (`requireActiveTenant`, admin role) and the database re-checks the tenant and the role; operator routes need the
  platform `admin` role and the database re-checks it and separation of duties.
- Provider-calling routes (checkout creation, provider re-read, checkout stop, refund) use the shared sensitive limiter
  with the payment routes' 60 s window, mounted in `server.js` before the PAY-04 router (PAY-03B R12); read-only routes
  stay on the global limiter.
- Provider, operator and simulator routes return 404 unless `CARUP_PAY04_ENABLED=true` outside production; simulator
  routes also need `CARUP_PAY04_PROVIDER_MODE=local_simulator`. The simulator's webhook and hosted-page form are CSRF
  exempt exactly as the PAY-03B simulator's are (they carry no CarUp session).

## 8. Product inventory (directive §4)

Derived from the PAY-02 catalogue by `backend/services/payment/pay04ProductInventory.js` (tested: no price, no
Zimbabwe provider access, CarUp Japan Stripe never eligible, no CarUp beneficiary). Facts below are PAY-02's.

| Product | Owner / source | Seller = beneficiary | Payer | Currencies | Tariff | Provider authority | Refund rules | Fulfilment | PAY-04 status | Blocker → resolver |
|---|---|---|---|---|---|---|---|---|---|---|
| `gar.invoice.customer_payment` | `garage_ops07` / `garage_invoices` | garage business tenant | vehicle owner customer | USD, ZWG | none approved (invoice-backed) | eligible `garage_recorded_external`; prohibited `stripe_carup_japan_sandbox` | garage invoice adjustment policy | OPS07 allocation and receipt | **IMPLEMENTED_LEVEL1** (Mode 1 live-capable; Mode 2 simulated) | no ZW provider, merchant contract or credentials (L2); production forbidden (L3) → Owner + garage + provider (PAY-05) |
| `gar.appointment.booking_deposit` | `garage_ops03` / `garage_appointments` | garage | vehicle owner customer | USD, ZWG | none approved (unapproved_missing) | prohibited Stripe | appointment cancellation policy (unapproved) | deposit credit to invoice | **BLOCKED_NO_APPROVED_BOOKING_POLICY** | no deposit / cancellation policy or tariff → Owner |
| `gar.work_order.diagnostic_fee` | `garage_ops04` / `garage_estimates` | garage | vehicle owner customer | USD, ZWG | none approved (invoice-backed) | prohibited Stripe | waived or credited per garage policy | OPS07 invoice line | **IMPLEMENTED_AS_INVOICE_LINE** (fee / labour line from the job's service record) | as the invoice payment → Owner + provider |
| `gar.parts.retail_sale` | `garage_ops06_parts` / `parts` | parts supplier or garage | vehicle owner or garage | USD, ZWG | none approved (invoice-backed) | prohibited Stripe | return and restock policy | OPS06 consumption and invoice | **WORKSHOP_CONSUMPTION_IMPLEMENTED_RETAIL_SALE_DEPENDENCY** | no governed counter / retail sale authority → product owner |
| `gar.fleet.scheduled_maintenance` | `garage_operations` / `garage_invoices` | garage | fleet operator | USD | none approved | prohibited Stripe | B2B fleet agreement | consolidated statement | **DEPENDENCY_NO_FLEET_SOURCE** | no fleet account / contract → product owner + Owner |
| `gar.towing.breakdown_dispatch` | `service_network` / `mechanic_work_orders` | towing or garage operator | vehicle owner customer | USD | none approved (unapproved_missing) | prohibited Stripe | refundable if cancelled before en route | dispatch completion | **DEPENDENCY_NO_DISPATCH_SOURCE** | no dispatch record / distance tariff → product owner + Owner |

No price, Zimbabwe provider access or settlement arrangement was invented. Where no source exists, the inventory says
so instead of building a contract on an imagined source.

## 9. How to run it

| What | Command |
|---|---|
| Integrated PostgreSQL certification (disposable PG ≥ 16, database `pay01c_sandbox_ci`) | `PAY04_DISPOSABLE_PG=1 bash scripts/ci/pay04-postgres-certification.sh payments-first` and `… garage-first` |
| Real-PG service, F5 resolution and concurrency tests (after a certification run) | `PAY04_TEST_PGURL=postgresql://…/pay01c_sandbox_ci node --test --test-concurrency=1 backend/tests/pay04-garage-payments.test.js` |
| Static contracts | `node --test backend/tests/pay04-f5-extension-drift.test.js backend/tests/pay04-garage-notifications.test.js backend/tests/pay04-invoice-failure-mapping.test.js backend/tests/pay04-product-inventory.test.js backend/tests/pay04-route-hardening.test.js` |
| Isolated physical UAT | `scripts/uat/pay04-local-stack.sh start` → `scripts/uat/pay04-local-db-build.sh` → `PAY04_EXPECTED_SHA=<sha> scripts/uat/pay04-local-runtime.sh <worktree> backend` (and `web`) → `node scripts/uat/pay04-qa-seed.mjs` → `node scripts/uat/pay04-http-matrix.mjs` → `PAY04_EXPECTED_SHA=<sha> PAY04_EVIDENCE_DIR=… PLAYWRIGHT_BASE_URL=http://127.0.0.1:5203 npx playwright test e2e/pay04-garage-payments.spec.ts --project=chromium --headed --retries=0` (from `web/`) |
| CI | `.github/workflows/pay04-garage-payments-ci.yml` |

The UAT stack is dedicated (`carup-pay04-supabase`, API 56321, DB 56322) and refuses the PAY-01C/PAY-03A and PAY-03B
evidence stacks. Public registration needs the CA-K3-AUTH-05 session authority, whose pool is TLS-pinned to Supabase's
CA and cannot reach a local stack; the QA seed therefore creates the synthetic accounts with the backend's own password
hashing, and every session is minted by the real `POST /api/auth/login` (the AUTH-05 local/test session adapter,
disabled in every declared deployment).

## 10. What is not done, and why

- **Level 2** (a real garage-provider sandbox) needs the garage's merchant identity, an approved test account,
  currency, credentials, a permitted transaction count and refund authority — none exists. **Level 3** is forbidden.
- **Deposits** need an approved booking policy; none exists.
- **Retail parts sales, fleet billing, towing**: no underlying source exists; classified, not invented.
- **Garage-side push notifications**: Communications addresses a person, not a tenant; picking a garage member to stand
  for the garage would be a guess (the existing Communications rule). The garage sees provider outcomes in the Hub, its
  overview and the discrepancy alert.
