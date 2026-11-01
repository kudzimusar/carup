# CARUP-PAY-03B — Dealer & Business Subscriptions

**Programme:** CarUp Payments 2.0 · **Assignment:** CARUP-PAY-03B-LR01 · **Branch:** `feat/carup-pay-03b-dealer-business-subscriptions`
**Frozen parent:** `17fad9b6901e459403ea2048feef4a9ea8335d49` (PAY-03A, PR #250, Draft, unmerged) · **Authority:** Level 1 only (code, migrations, offline/local tests, local simulator). No production, shared-staging or live-financial action.

This document describes what PAY-03B built and how it fits the existing CarUp authorities. The certification evidence, results and recommendation are in [CARUP_PAY_03B_FINAL_CERTIFICATION.md](CARUP_PAY_03B_FINAL_CERTIFICATION.md).

## 1. Architecture reconciled to PAY-02 and Diaspora

| Concern | Authority (single source of truth) | PAY-03B role |
|---|---|---|
| Money (every payment, including each recurring invoice) | `public.payment_transactions` | Writes only through canonical SECURITY DEFINER functions; one row per invoice obligation (`reference = 'pay03b_inv_<uuid>'`). No second ledger. |
| Product identity | `public.pay02_commercial_products` (+ immutable versions) | Plans reference `product_code` + `product_version`. |
| Sellable plan, price and terms | `public.pay03b_subscription_plans` (new, append-only) | Versioned registry. Every paid plan is unpriced and commercially blocked; sandbox fixtures need an Owner/Moderator authorization reference and stay `sandbox_only`. |
| Dealer / garage subscription agreement | `public.pay03b_business_subscriptions` (new) | Owned by the legal organization (`public.organizations`) bound to its operating tenant (`public.tenants`). |
| Diaspora subscription | `public.diaspora_subscriptions` (existing) | Untouched authority. The bridge (`applyVerifiedSubscriptionToDiaspora`) would apply verified provider state only through `syncSubscriptionFromSnapshot` and read only through `resolveEffectiveEntitlements`. **It has no runtime caller in this assignment:** every paid Diaspora plan is commercially blocked, so the bridge is certified by its tests only and is not wired into any route. |
| Provider events | `pay01a_stripe_event_receipts` (payments), `pay03b_provider_event_receipts` (subscription/invoice) | De-duplication indexes, not ledgers. |
| Reconciliation exceptions / operator alerts | `public.pay03b_payment_reconciliation_exceptions` (F5) | Durable, immutable once closed. |
| Audit | `public.trust_audit_events` (canonical) + append-only transition/change-request tables | Admin financial actions are audited **before** the provider call and fail closed. |

The provider adapters implement the existing Diaspora `BillingProvider` capability surface (ADR-001: no provider vocabulary crosses the adapter boundary):

- `Pay03bStripeSandboxProvider`: the official SDK on the PAY-01A CarUp Japan **sandbox** account only. It requires a test key and a verified account id, refuses production, and needs `CARUP_PAY03B_ENABLED=true`.
- `Pay03bLocalSimulatorProvider`: Level-1 UAT only, with a separate gateway (`pay03b_local_provider_simulator`), account (`acct_pay03b_local_simulator`), `sim_*` identifiers and signing secret. Every page reads **SIMULATED PROVIDER — NOT STRIPE**. The database refuses it unless a disposable database enables it in `public.pay03b_runtime_guard`.

## 2. Source files changed

| Area | Files |
|---|---|
| F5 canonical payment integrity | `database/migrations/20261101120000_carup_pay03b_f5_payment_reconciliation_hold.sql`, `backend/services/payment/pay01aContract.js`, `backend/services/payment/pay01aService.js`, `backend/services/payment/pay03aReportCommerceService.js` (admin refund revocation guard), `backend/services/payment/pay03bReconciliationService.js` |
| Subscription authority | `database/migrations/20261101130000_carup_pay03b_business_subscriptions.sql` |
| Services | `backend/services/payment/pay03bContract.js`, `pay03bProviderAdapters.js`, `pay03bLocalSimulator.js`, `pay03bSubscriptionService.js`, `pay03bDiasporaBridge.js` |
| HTTP | `backend/routes/pay03bRoutes.js`, `backend/server.js` (mount, rate limits, simulator raw body), `backend/middleware/securityMiddleware.js` (CSRF exemption scoped to the simulator's provider pages and signed webhook), `backend/routes/vehiclesRoutes.js` (publish-boundary entitlement guard) |
| Web | `web/src/pages/Pricing.tsx`, `web/src/pages/dashboard/dealer/Subscription.tsx` (new), `web/src/pages/dashboard/admin/Pay02CommercialFoundation.tsx`, Diaspora plan status, `web/src/App.tsx`, `web/src/config/featureRegistry.ts`, API client |
| Tests | `backend/tests/pay03b-refund-mismatch.test.js`, `pay03b-provider-reconciliation.test.js`, `pay03b-business-subscriptions.test.js`, `pay03b-tenant-entitlements.test.js`, `pay03b-diaspora-bridge.test.js`, `pay03b-route-hardening.test.js`, `backend/tests/helpers/pgSupabaseShim.js`, `backend/tests/sql/pay03b-f5-reconciliation-postgres-smoke.sql`, `backend/tests/sql/pay03b-subscriptions-postgres-smoke.sql`, `backend/tests/sql/pay03b-remediation-postgres-smoke.sql`; harness updates in the PAY-01A/PAY-01C/PAY-03A suites |
| CI / UAT | `.github/workflows/pay03b-dealer-business-subscriptions-ci.yml`, `scripts/ci/pay03b-postgres-certification.sh`, `scripts/uat/pay03b-*`, `web/e2e/pay03b-dealer-subscription.spec.ts` |

## 3. Product and pricing governance matrix

| PAY-02 product | Plan code (v1) | Authority | Pricing kind | Activation | Status and blocker |
|---|---|---|---|---|---|
| `mkt.dealer.storefront_package` | `dealer_storefront_package` | business subscription (dealer organization) | unpriced | commercially_blocked | COMMERCIAL: no approved tariff, merchant of record, Zimbabwe collection provider, tax authority or entitlement set. Implemented and certified against **sandbox/simulator fixtures only**. |
| `sub.diaspora.free` | `diaspora_free` → plan key `free` | Diaspora | free | approved (ADR-001) | Free tier unchanged; never initiates payment. |
| `sub.diaspora.buyer_pro` | `diaspora_buyer_pro` → `diaspora_buyer` | Diaspora | unpriced | commercially_blocked | COMMERCIAL: tariff and provider allowlist not approved. Bridge implemented; activation refused at the registry. |
| `sub.diaspora.seller_supplier` | `diaspora_seller_supplier` → `seller` | Diaspora | unpriced | commercially_blocked | As above. PAY-02 cites `PLAN_CATALOG.seller_supplier`; the plan key is `seller`. |
| `sub.diaspora.trade_pro` | `diaspora_trade_pro` → `trade_pro` | Diaspora | unpriced | commercially_blocked | As above. |
| `sub.diaspora.enterprise_partner` | `diaspora_enterprise_partner` → `enterprise` | Diaspora | contract_quotation | commercially_blocked | OWNER AUTHORITY: enterprise quotation, MSA and merchant required; never a standard monthly rate ("Request a quote"). |
| `sub.garage.os_plan` | `garage_os_plan` | business subscription (garage organization) | unpriced | commercially_blocked | COMMERCIAL: no SaaS tariff, merchant or Zimbabwe provider. PAY-02 names `public.garages`, which does not exist on this branch (garages are `tenants` of type `garage`). Kept separate from PAY-04 garage-customer payments. |

Every plan version records product and version, target role, eligible tenant category, period, amount, currency and scale, jurisdiction, tax authority, merchant of record, provider allowlist, entitlement set, trial and grace days, change and cancellation policy, refund policy, activation status, approver and effective dates.

Database constraints enforce the commercial rules:

- No paid plan can be `approved` in this foundation.
- `approved_tariff` cannot exist yet.
- A sandbox fixture needs an authorization reference, a sandbox merchant label and exactly one sandbox gateway.
- A commercially blocked plan must state its blocker.

`Pricing.tsx` no longer shows mock prices. It renders the governed status: "Not yet available" (with the blocker), "Request a quote" or "Free".

## 4. Database relationships and constraints

- **`pay03b_business_subscriptions`**
  - **References:** `tenants`, `organizations`, the plan, the PAY-02 product and the billing customer. Owner, organization, scope, gateway, actor and request key are immutable, as are the provider checkout, subscription and customer ids once set. Rows are never deleted.
  - **One live subscription:** one non-terminal subscription per `(tenant, scope)` **and** per `(organization, scope)`.
  - **Idempotency:** `UNIQUE (owner_tenant_id, request_key)`.
  - **Concurrency:** `version` must increase by exactly 1 on every update, and writers take a per-subscription advisory lock.
- **`pay03b_subscription_invoices`**
  - Unique provider invoice id.
  - At most one non-void `subscription_create`/`subscription_cycle` invoice per `(subscription, period_start)`, so no period can be collected twice.
  - One unique canonical payment per invoice; in addition, `payment_transactions.pay01a_intent_id` is unique, so there is one canonical row per PaymentIntent.
  - Identity, period and currency are immutable. Paid and void never regress. An `uncollectible` invoice can still be paid at the provider, and only a `void` invoice cancels its pending payment.
  - A draft invoice's amount and anomaly follow the provider until it is finalized.
  - Anomalies are recorded instead of extending access: `amount_mismatch`, `currency_mismatch`, `unexpected_zero_amount`, `unauthorized_proration`, `credit_only_proration`, `manual_invoice_not_coverage`.
- **`pay03b_subscription_sync_exceptions`:** an invoice the provider lists that the canonical writers refuse (ungoverned price, unsupported billing reason or shape, duplicate period, an irreconcilable payment amount). It is de-duplicated per invoice and code, counts observations, and is visible in the admin console. While one is open the subscription has no paid access (`provider_sync_exception`). It clears when the invoice records cleanly, or when a complete provider listing no longer contains it (a deleted draft).
- **`payment_transactions` hold guard (F5):** a `BEFORE UPDATE OF status` trigger refuses any change that takes a payment out of `reconciliation_hold` or `partially_refunded` unless a governed writer marked its own transaction (`carup.pay03b_hold_release`). This includes direct service-role writes. Leaving either state for `refunded` also needs provider evidence that the full amount was refunded.
- **Append-only tables:** `pay03b_provider_event_receipts`, `pay03b_subscription_transitions`, and `pay03b_subscription_change_requests` (closed requests are immutable).
- **Least privilege:**
  - RLS is enabled on every table.
  - PUBLIC, `anon` and `authenticated` have no grants.
  - `service_role` has SELECT only; every write goes through SECURITY DEFINER functions with a pinned `search_path`.
  - Internal helpers are not executable by any API role.
- **Lock order everywhere:** subscription advisory lock, then payment-reference advisory lock, then rows. The F5 resolver takes the owner lock first through `pay03b_payment_owner_lock`.

## 5. Organization and tenant authority matrix

| Actor | Can view dealer subscription | Can subscribe, change, cancel or update payment method | Can administer |
|---|---|---|---|
| Tenant member with role `admin` / `administrator` / `tenant_admin` (billing authority) | yes, own tenant only | yes (re-checked inside the database) | no |
| Tenant member with another role (for example `dealer` staff) | yes, read-only | no (`PAY03B_BILLING_AUTHORITY_REFUSED`) | no |
| Removed member (row deleted) | no (session middleware 403) | no (database refusal) | no |
| Member of another tenant | no (403 at the session boundary) | no | no |
| Platform admin (`users.role = 'admin'`) | through the admin console | no (never the payer) | reconcile, suspend/resume, governed invoice refund, F5 resolution (verified against `public.users`) |

The legal owner is the dealership organization bound to the request's tenant. A tenant with zero or several active dealership organizations is refused (`PAY03B_NO_LEGAL_ORGANIZATION_BOUND`, `PAY03B_ORGANIZATION_AMBIGUOUS`). The payer is the organization's provider customer, never a user. Switching the active organization never moves an existing subscription.

**Known gap:** no product onboarding path on this branch creates dealer organizations, tenants or memberships. QA seeds them in SQL.

## 6. Subscription state machine and access

Provider status maps to CarUp status as follows:

| Provider status | CarUp status |
|---|---|
| `incomplete` | `incomplete` |
| `incomplete_expired` | `incomplete_expired` |
| `trialing` | `trialing` only if the plan has approved trial days; otherwise `suspended (unauthorized_provider_trial)` |
| `active` | `active` |
| `past_due` | `grace_period` only if the plan has approved grace days; otherwise `past_due` |
| `unpaid` | `suspended (provider_unpaid)` |
| `canceled` | `cancelled` (mode `period_end` or `immediate`) |
| `paused` | `paused` |

One mapping function (`pay03b_map_provider_status`) serves both the snapshot writer and the administrator resume. Rules for observations:

- An administrator suspension is never lifted by a provider observation.
- Older observations are ignored. An observation is stamped **before** the provider read it describes, so a slower, older read can never win.
- An observation more than 5 seconds in the future is refused.
- `canceled` and `incomplete_expired` are terminal at the provider. A later read reporting anything else is out of order and is ignored whole, so an administrator resume, which restores the provider-backed state, cannot revive the subscription. A subscription CarUp holds as `cancelled` stays cancelled.
- An approved trial never lasts longer than `created_at + trial_days`, whatever trial end the provider reports.

Access is decided by `pay03b_resolve_tenant_entitlements`. It is **paid-period based**: `paid_through` is the period end of the latest invoice that meets all of these conditions:

- it is a `subscription_create`, `subscription_cycle` or `subscription_update` invoice (manual invoices are never coverage);
- it is paid in full;
- its amount is non-zero;
- it has no anomaly;
- its canonical payment is `paid`.

Refunded, held, partially refunded, pending or failed invoices never extend access. The entitlement plan is the plan of that covering paid invoice, so an unpaid upgrade grants nothing.

| Situation | Access |
|---|---|
| Checkout started, unpaid (`incomplete`) | none |
| First invoice paid | yes, until `paid_through` |
| Provider says `active` but nothing is paid | none (`no_paid_period`) |
| Failed renewal, no approved grace | until the paid period ends, then none (`past_due_without_approved_grace`) |
| Approved grace (`grace_days`) | until `paid_through + grace_days` |
| Cancel at period end | until `paid_through` (`paid_through_after_period_end_cancellation`) |
| Immediate cancellation (only if the plan allows it) | none from cancellation (`cancelled_immediately`) |
| Any invoice payment in F5 `reconciliation_hold` | none (`payment_reconciliation_hold`) |
| An open provider-sync exception | none (`provider_sync_exception`) |
| Admin suspension | none (`admin_suspension`) |
| Expired / incomplete_expired / paused | none |

**Renewal gap without grace (known behaviour, Owner decision).** Stripe creates a renewal invoice at the period boundary and finalizes and collects it about an hour later. Access is paid-period based and no plan has an approved grace period, so a dealer who pays on time has no paid access from the period end until the renewal is paid and the signed event is processed. That is about an hour in Stripe's default schedule, longer if the webhook is delayed. CarUp does not bridge the gap by trusting the provider's `active` flag. If the Owner approves a grace period on the plan, `grace_days`, which is whole days, covers the gap.

## 7. Provider and invoice event matrix

| Event | Binding | Effect |
|---|---|---|
| `checkout.session.completed` / `expired` (mode `subscription`) | `client_reference_id` → subscription reference; checkout id must match | Fresh read: provider subscription bound, or `incomplete_expired`. |
| `customer.subscription.created/updated/deleted/...` | provider subscription id or `metadata.carup_subscription_reference`; id substitution refused | Fresh subscription snapshot, then every invoice and its payment truth. |
| `invoice.paid` / `payment_failed` / `finalized` / `voided` / ... | invoice subscription id (acacia `subscription` or newer `parent.subscription_details`) | Same sync. A failed attempt leaves the payment `pending`. |
| `charge.refunded`, `refund.*`, `payment_intent.*` on an invoice payment | PaymentIntent → canonical invoice payment | Payment truth through the shared F5 classifier: full refund → `refunded`; partial → `reconciliation_hold` plus an exception. |
| `charge.refunded`, `refund.*` on a PAY-01A payment (including dashboard refunds without CarUp metadata) | metadata **or** PaymentIntent; metadata naming another payment is refused | PAY-01A reconciliation through the F5 writer. |

Every event is verified (raw bytes, signature, account, live mode) and then **re-read from the provider**. Payloads and redirects are never payment proof.

- **Redelivered events.** A redelivered event keeps one receipt, but it is **never** treated as "already done". The work after the receipt (the invoices) may not have completed, so it re-applies the fresh read. Older observations are ignored.
- **Invoices are recorded independently.**
  - A deterministic refusal of one invoice becomes a sync exception (section 4) without blocking the others, and the event is acknowledged.
  - A transient failure (provider or database unavailable) is rethrown after the other invoices are recorded, so the provider redelivers the event.
- **Complete invoice history.** The provider's invoice history is read completely, 100 per page. It has an exact bound of 1,000 invoices and fails closed beyond it. An invoice that cannot be normalized is reported as rejected (and becomes a sync exception) rather than failing the listing.
- **Checkout amount check.** Before a Checkout URL is handed to a buyer, the provider's own amount and currency for the session must equal the governed plan. Otherwise the session is expired unused, the agreement is re-read to `incomplete_expired`, the refusal is audited, and no URL is returned (`502 PAY03B_CHECKOUT_AMOUNT_MISMATCH`).
- **Operator alerts.** A structured operator alert is logged when an invoice payment enters reconciliation hold (`PAY03B_PAYMENT_RECONCILIATION_HOLD_OPENED`) or a sync exception is recorded (`PAY03B_SUBSCRIPTION_SYNC_EXCEPTION`).

Stripe-backed renewals use Stripe's own schedule; CarUp never charges a Stripe subscription itself.

Plan changes:

- **Period end:** `proration_behavior: none`. The new price bills at the next renewal and its entitlements apply when that invoice is paid.
- **Immediate:** only if the plan's change policy approves it, and then with `always_invoice` and `pending_if_incomplete`, so an unpaid upgrade is never applied.

Proration invoices on plans without that approval are recorded as `unauthorized_proration`, and credit-only prorations as `credit_only_proration`; neither ever extends access. The project's Stripe SDK pins API `2025-02-24.acacia`; the normalizers also accept the newer item/parent shapes.

## 8. F5 resolution

See the final certification for the full evidence. In short:

- **Holds.** A provider-confirmed partial refund, pending or succeeded, on a PAY-01A or PAY-03B payment moves the canonical payment to `reconciliation_hold`. It opens an immutable-evidence exception that serves as the operator alert, and suspends report, share and subscription access.
- **What ends a hold.** A hold is never lifted by a later lookup, including one showing the refund failed. Only two things end it:
  - a provider-confirmed full refund (→ `refunded`, superseded);
  - an operator resolution backed by a provider read made within the last 10 minutes. Conditions on the resolution:
    - The verification time is taken **before** that read, and a resolution whose verification is older than the exception's latest provider observation is refused (`PAY03B_PROVIDER_VERIFICATION_SUPERSEDED`).
    - The operator must be a real platform admin who is not the payer. For an invoice payment, no member of the paying tenant may resolve it.
    - The operator must give a reason.

    The outcome is either restore (provider shows nothing refunded) or revoke-final (`partially_refunded`).
- **Database-enforced.** No other path can take a payment out of a hold, including a direct service-role write; see the hold guard in section 4.
- **Unchanged.** Historical PAY-01C and PAY-03A rows are proven unchanged by fingerprint across the migrations.

## 9. Entitlement enforcement matrix

| Entitlement | Domain operation | Enforcement |
|---|---|---|
| `dealer.inventory.published_listing_capacity` | `POST /api/vehicles/:vin/publish` (after the completeness gate, before the write) | The tenant's effective capacity is the higher of the baseline and the paid plan. `403 PAY03B_LISTING_CAPACITY_REACHED`. A read failure, or enforcement with no governed capacity at all (no baseline plan and no paid plan), gives 503 and fails closed (`PAY03B_ENTITLEMENT_BASELINE_MISSING`); it is never treated as unlimited. **Inert unless `CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT=true`.** The capacity values are sandbox and simulator fixtures; retail values are an Owner decision, so current dealers are unaffected outside a governed sandbox. Count and write are separate requests: two simultaneous publishes could exceed the capacity by one. Retail enforcement should move into a publish function. |
| Diaspora `diaspora.*` features | existing `diasporaEntitlementGuard` call sites | Unchanged. The bridge only feeds the existing writer, with paid coverage as the period end. |
| Promotions, storefront page, analytics, team seats | — | **Not sold.** Promotions have no delivery, the storefront page and seats are not implemented, and analytics is currently free (gating it is an Owner product decision). |

## 10. Migration and rollback plan

Both migrations are additive and forward-only:

- `20261101120000_carup_pay03b_f5_payment_reconciliation_hold.sql` runs after `20261101100000`.
- `20261101130000_carup_pay03b_business_subscriptions.sql` runs after the F5 migration.

Each refuses to run without its prerequisites. Each Down section raises, because money, exception and subscription evidence is never deleted automatically. The certified `pay01a_apply_provider_snapshot` keeps its signature and delegates to the new writer, so a stale caller cannot clear a hold.

Rollback is a new forward migration plus switching the routes off. The routes are gated as follows:

- **Dealer and admin subscription routes:** dark (404 `PAY03B_DISABLED`) unless `CARUP_PAY03B_ENABLED=true` in a non-production runtime.
- **F5 operator routes:** need a PAY-01A sandbox or simulator runtime.
- **Provider operations:** also need the sandbox adapter's verified test account.
- **Simulator routes:** return 404 outside explicit simulator mode.
- **Public catalogue:** read-only and governance-only.

Nothing has been applied to production or shared staging, and nothing may be applied without separate authority.

## 11. Independent review remediation (R1–R14)

An independent review of `17fad9b6..fff1085d` reported 2 High, 5 Medium and 6 Low findings. Each was fixed with a failing test first. Each fix was then proven by a mutant that removes it, which the certification or test suite must kill. The evidence is in the final certification.

| # | Finding | Fix | Proof |
|---|---|---|---|
| R1 (High) | A redelivered event short-circuited and skipped invoice work an earlier attempt had not finished | No early return on a duplicate event, in either the snapshot writer or the invoice writer; the fresh read is re-applied | remediation smoke (both writers); real-PG test R1; SQL and service mutants killed |
| R2 (High) | One bad invoice blocked every later invoice | Per-invoice isolation; durable sync exceptions that suspend access; transient failures rethrown after the others; complete paginated history; uncollectible is no longer terminal; credit-only prorations recorded | remediation smoke; real-PG tests R2 (transient and permanent); adapter tests; mutants killed |
| R3 | A draft invoice's amount was frozen | Amount and anomaly follow the provider while the invoice is a draft | remediation smoke; mutant killed |
| R4 | Manual invoices could extend access | `manual_invoice_not_coverage`, and coverage counts only create/cycle/update invoices (each line tested on its own) | remediation smoke; two mutants killed |
| R5 | Self-dealing check was ineffective for invoice payments | `pay03b_payment_payer_conflict` also covers members of the paying tenant | remediation smoke; mutants killed |
| R6 | Observation stamped after the read; a cancelled subscription could be revived | Stamp before the read; 5-second future tolerance; terminal provider states are ignored whole; a cancelled agreement stays cancelled | remediation smoke; real-PG test R6; four mutants killed |
| R7 | Docs and CI referenced web files that did not exist | Resolved by `0a8b6cc6` and `211ccedc`; CI step list verified | CI source-certification job |
| R8 | Trial uncapped | Capped at `created_at + trial_days` | remediation smoke; mutant killed |
| R9 | Capacity guard was unlimited when there was no baseline | Fails closed (503) when enforcement is on | unit test; mutant killed |
| R10 | F5 resolution race against a newer provider observation | `PAY03B_PROVIDER_VERIFICATION_SUPERSEDED`; verification stamped before the read (PAY-03B and PAY-01A readers) | remediation smoke; real-PG and unit tests; mutants killed |
| R11 | Holds were not enforced in the database | Status trigger plus a transaction-local governed-writer marker; full-refund evidence required to leave a hold for `refunded` | remediation smoke; three mutants killed |
| R12 | Provider-calling routes lacked rate limits | Sensitive-tier limiters on verify, change, change-preview, cancel, payment-method, invoices and stripe-sandbox (checkout/abandon and admin routes were already limited) | route-hardening test |
| R13 | Checkout amount and currency were not checked against the plan | Provider-stated amount/currency compared before any URL is handed out; drifted sessions are expired and audited | real-PG test R13; mutant killed |
| R14 | Admin replay with a different action; resume mapping drift; no hold alert | Replay conflict; one shared provider-status mapping; structured alerts | remediation smoke; real-PG test; mutants killed |

## 12. Items for the Owner (not decided by this assignment)

- **Legal text in Terms of Service.** The Terms page no longer shows mock subscription prices ("Price not yet approved"). Its **legal feature descriptions** were left untouched because they are legal text: for example ZINARA references, "100 cars", and the fee table. They describe functionality and limits the current source does not implement or sell. They need Owner/legal review before any commercial launch.
- **Commercial terms:** tariffs, merchant of record, the Zimbabwe collection provider, tax treatment, entitlement values and a grace policy (see the renewal gap in section 6).
- **Onboarding:** no product path creates dealer organizations, tenants or memberships.
- **Garage source authority:** `public.garages` named by PAY-02 does not exist; garages are `tenants` of type `garage`.
- **Disputes:** chargebacks and disputes are not handled by PAY-03B; a dispute event is not bound to a subscription action.
