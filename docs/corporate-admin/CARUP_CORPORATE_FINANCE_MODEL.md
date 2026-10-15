# CARUP CORPORATE FINANCE MODEL

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-FIN — Corporate Finance & Management Accounting Authority Agent  
Task: CA-FIN-01  
Status: FINANCE AUTHORITY / DOCUMENTATION ONLY — NOT ACCEPTED UNTIL CA-MOD REVIEW

## 1. Authority and custody

This Corporate Finance and Management Accounting authority model is produced under the following exact authorities:

- Canonical programme plan: `docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md`
- Canonical programme authority: `5d4997cacaff8068c4ec4c5ae78f562be4249344`
- Accepted CA-ARCH-01 authority: `7cae8c3c8c987714a8ca6db2128db3b9a589f141`
- Accepted CA-ORG-01 authority: `705eb6fa1cd89109977052e88e220f0498668060`
- Accepted CA-RBAC-01 authority: `4abdf95e1e1490b01f51cb45106a57fcf7b954b9`
- Accepted CA-METRIC-01 authority: `32c26ce5d89ec3829e2afa9248d1e77a2cb4c784`
- Current documentation starting head: `68d2b6e0e76d3e2c98dbabef085fed2e8de313c7`
- Product/reference snapshot inspected read-only: `505ffcca6b641c8b3b55f503e0f4fd39d26710dc`
- Parallel dependency: **PC01-K2B-R1 — ACTIVE / NOT YET ACCEPTED**

The live PR #222 advanced beyond the supplied product snapshot during execution. CA-FIN-01 remained pinned to `505ffcca6b641c8b3b55f503e0f4fd39d26710dc` and does not adopt later product or K2B state as Corporate Admin authority.

This document establishes finance truth boundaries and the future minimum system-of-record architecture only. It does **not** implement accounting, define statutory accounting policy, create journals, change product code, mutate payment/escrow logic, alter database schema, create migrations, classify K2B rows, or activate any financial KPI.

---

## 2. Executive conclusion

### PROVEN CURRENT FINANCE FACT

At the inspected authority, CarUp has several product and operational systems that record financial-looking facts:

- listing prices and transaction-intent snapshots;
- Marketplace deposits, payment-intent identifiers and provider-normalized lifecycle states;
- reservation and settlement-operation workflow state;
- finance applications and lender/eligibility decisions;
- governed vehicle-finance encumbrance states;
- insurance premium/product records and insurer eligibility decisions;
- Diaspora import/logistics quotes, requested budgets, payment milestones, commercial charge components and charge allocations;
- SafeTrade transaction/milestone/provider-operation state;
- Diaspora subscription and provider-event state;
- referral reward wallet transactions;
- garage/service work-order cost fields;
- provider configuration, reconciliation and reference-FX records.

Those systems do **not**, by themselves, establish a Corporate Accounting system of record.

### PROVEN CURRENT ABSENCE

No accepted current source was found that can truthfully serve as the corporate authority for:

- a chart of accounts;
- double-entry general ledger postings produced by the current canonical product flows;
- accounting periods and close state;
- legal-entity books;
- recognized revenue;
- direct cost / COGS;
- operating expense;
- gross profit or operating profit;
- bank/cash balance;
- accounts receivable;
- accounts payable;
- consolidated FX accounting;
- corporate GMV;
- company-wide completed transaction value;
- company-wide refunds/cash reversals;
- contribution margin;
- take rate.

A historical `financial_ledger` schema exists, but it is **not accepted as the Corporate Finance system of record** because:

1. the repository contains conflicting historical definitions of `financial_ledger`;
2. the current canonical Marketplace transaction/payment path no longer posts through the legacy SafePay writer;
3. the historical gateway callback path is retired;
4. no current canonical accounting posting service was found that reliably produces accounting entries from all active product domains;
5. its existence does not establish legal entity, accounting period, revenue-recognition, cost classification, close or reconciliation policy.

Therefore the current Corporate Accounting truth state is:

**PRODUCT FINANCIAL FACTS EXIST; CORPORATE ACCOUNTING AUTHORITY DOES NOT YET EXIST.**

---

## 3. Non-negotiable semantic separations

The following are binding finance invariants:

- **listing price ≠ transaction value**
- **transaction-intent listing amount ≠ completed sale value**
- **deposit amount ≠ vehicle transaction value**
- **requested finance amount ≠ disbursement**
- **finance approval/decision ≠ cash disbursement**
- **insurance premium/quote ≠ premium paid**
- **quote ≠ completed sale**
- **accepted quote ≠ settlement**
- **scheduled milestone ≠ cash received**
- **milestone confirmation ≠ accounting revenue unless CA-FIN recognition authority says so**
- **sandbox escrow ≠ live settlement**
- **test-mode billing ≠ live billing**
- **provider event ≠ accounting journal**
- **provider reconciliation ≠ revenue recognition**
- **escrow held ≠ CarUp revenue**
- **custodial money ≠ unrestricted corporate cash**
- **commercial fee classification ≠ recognized revenue**
- **reward payable status ≠ accounts payable without accounting recognition**
- **work-order total ≠ CarUp revenue**
- **inventory/parts value ≠ accounting inventory without accounting authority**
- **GMV ≠ revenue**
- **revenue ≠ gross profit**
- **gross profit ≠ contribution margin**
- **gross profit ≠ operating profit**
- **operating profit ≠ net profit**
- **cash ≠ receivable**
- **receivable ≠ invoice amount unless accounting policy establishes it**
- **payable ≠ product obligation without accounting recognition**
- **reference FX ≠ settlement FX**
- **reference FX ≠ accounting consolidation FX**
- **reference FX ≠ customs valuation FX**

No Corporate Admin surface may collapse these distinctions to produce a visually complete dashboard.

---

## 4. Finance fact-class taxonomy

Every finance-relevant source must be classified by what it actually proves.

| Fact class | Definition | What it does NOT prove |
| --- | --- | --- |
| `COMMERCIAL_INTENT` | A stated/requested commercial amount, price, budget or prospective term. | Completion, settlement, cash or revenue. |
| `QUOTE_OR_OFFER` | A price/offer made by a seller/provider/lender/insurer/logistics party. | Acceptance, delivery, settlement or recognition. |
| `PAYMENT_INTENT` | A payment/checkout/provider intent has been created. | Authorization, capture, settlement or cash receipt. |
| `CUSTOMER_OBLIGATION` | A governed customer-side amount is contractually due under an accepted commercial obligation. | CarUp revenue or cash until recognition/settlement authority exists. |
| `PLATFORM_OBLIGATION` | CarUp has a governed programme/provider/vendor obligation to another party. | Accounting payable until an accounting subledger recognizes it. |
| `ESCROW_HELD` | A live, provider-confirmed amount is held under a governed escrow/custody relationship. | CarUp revenue or unrestricted corporate cash. |
| `SETTLEMENT_PENDING` | Live settlement/release has been claimed/initiated but not conclusively completed. | Cash movement completion. |
| `SETTLEMENT_CONFIRMED` | An approved live provider has authoritatively confirmed settlement/release and CarUp has reconciled it into governed product state. | Accounting revenue or bank-cleared cash by itself. |
| `REFUND_OR_REVERSAL` | A live provider has confirmed a refund/reversal and governed product state reconciled it. | Accounting treatment, expense or cash-bank finality without finance posting/bank reconciliation. |
| `ACCOUNTING_REVENUE` | Revenue recognized under approved accounting policy in the Corporate Finance system of record. | Cash collection. |
| `DIRECT_COST` | Cost classified as directly attributable to a recognized revenue stream under approved policy. | Operating expense or cash payment. |
| `OPERATING_EXPENSE` | Expense classified as operating expense under approved accounting policy. | Cash paid in the same period. |
| `RECEIVABLE` | Amount due to CarUp recognized in an accounting receivables subledger. | Cash. |
| `PAYABLE` | Amount CarUp owes recognized in an accounting payables subledger. | Cash paid. |
| `CASH_BALANCE` | Bank/payment-account balance from an approved treasury/bank authority reconciled to books. | Revenue. |
| `NON_CASH_ACCOUNTING_ENTRY` | Accounting journal not representing immediate cash movement. | Settlement/cash movement. |
| `SANDBOX_SIMULATION` | A real record of a test/sandbox workflow where no live money moved. | Any live financial fact. |
| `UNKNOWN_FINANCIAL_AUTHORITY` | Financial-looking value/state whose authoritative meaning cannot be proven. | Any Corporate Actual metric. |

### 4.1 Product state versus accounting state

A source may prove more than one product fact while proving no accounting fact.

Example:

- Marketplace `payment_state = released` from a **live approved provider** could prove `SETTLEMENT_CONFIRMED`.
- The same row does **not** prove `ACCOUNTING_REVENUE`.
- If the amount is a deposit, it still does not prove full transaction value.
- Bank clearing can later prove cash.
- Corporate Finance policy can separately determine revenue recognition.

---

## 5. Current finance-relevant source inventory

Disposition vocabulary:

- **REUSE** — source is a valid authority for the specific product fact it claims.
- **WRAP** — source is useful but must be wrapped in Corporate finance semantics/provenance/access.
- **REPLACE** — current source/label must not be used as Corporate finance authority; lower-level product facts may remain.
- **DEPRECATE** — historical/legacy finance path must not drive new Corporate finance reporting.

### 5.1 Listings and Marketplace commercial terms

| Source | Current fact | Fact class | What it proves | What it does not prove | Corporate disposition |
| --- | --- | --- | --- | --- | --- |
| `vehicles.price` + `vehicles.currency` + provenance | Current governed listing economics where provenance is valid | COMMERCIAL_INTENT | Seller/listing asking amount and currency | Completed sale, GMV, revenue, cash | **REUSE/WRAP** as listing price only |
| `vehicle_listings.asking_price_cents` legacy/current listing contract | Listing asking-price representation | COMMERCIAL_INTENT | Asking price for that listing contract | Transaction completion or payment | **WRAP** only if canonical listing authority says it remains active |
| `escrow_trust_sessions.listing_amount/listing_currency` | Server-snapshotted listing terms at transaction-intent creation | COMMERCIAL_INTENT | Terms the transaction intent began against | Final negotiated consideration, settlement amount, GMV | **REUSE** for lineage only |
| Marketplace inquiry | Buyer purchase interest | COMMERCIAL_INTENT | Intent to transact | Sale, obligation or payment | **REUSE** as intent only |

### 5.2 Marketplace transaction, reservation and deposit

Current canonical authority is the Issue #164 transaction stack:

- `marketplaceTransactionAuthority.js`
- `reservationService.js` / `vehicle_reservations`
- `marketplacePaymentService.js`
- `escrowTrustService.js` / `escrow_trust_sessions`

| Source/state | Fact class | Proven meaning | Corporate finance boundary |
| --- | --- | --- | --- |
| transaction intent created | COMMERCIAL_INTENT | A governed buyer/seller/listing/inquiry intent exists | Not a sale |
| active reservation | COMMERCIAL_INTENT / operational reservation | Vehicle temporarily reserved for transaction participant | No amount/cash/revenue |
| reservation completed after canonical payment release | Operational completion evidence | Product lifecycle reached completed reservation | Still not a full purchase-price amount authority |
| deposit eligibility | COMMERCIAL_INTENT | Product policy says deposit may be initiated | No payment |
| payment intent ID | PAYMENT_INTENT | Provider payment intent exists | No capture/release |
| `authorized` | PAYMENT_INTENT / provider state | Authorization state | No settlement/cash |
| `captured` on live provider | ESCROW_HELD candidate | Provider says amount captured/held, subject to approved live provider/reconciliation | Not revenue; current accepted source does not establish an approved live provider |
| settlement operation claim | SETTLEMENT_PENDING candidate | Release attempt has durable attributable identity | Not released money |
| provider `released` + canonical reconciliation | SETTLEMENT_CONFIRMED candidate | Provider-confirmed release, if genuinely live | At current snapshot live external provider authority is not certified |
| provider `refunded` + canonical reconciliation | REFUND_OR_REVERSAL candidate | Provider-confirmed refund, if genuinely live | Current actual live-money authority not established |

### 5.3 Marketplace deposit amount

`MARKETPLACE_DEPOSIT_POLICY` is versioned and currently defines USD deposit policy amount 500.

This proves:

- product deposit policy;
- eligible deposit amount for a qualifying transaction;
- payment intent/capture amount where used.

It does **not** prove:

- full vehicle consideration;
- GMV;
- seller proceeds for the full vehicle;
- platform fee;
- revenue;
- take rate.

Any average transaction value based on Marketplace deposit is prohibited.

### 5.4 Payment providers and live-money availability

Current payment capability evidence establishes:

- sandbox payment capabilities are proven for test purposes;
- external candidate providers have unverified/unknown capabilities;
- Marketplace sandbox runtime is test/development/staging only;
- production fails closed without a separately approved live adapter;
- the durable sandbox provider is explicitly `live:false` and performs no real-money/network operation.

Therefore:

**Current live Marketplace settlement/cash authority = UNAVAILABLE_NO_SOURCE at this accepted snapshot.**

The existence of provider-control-plane tables does not change this conclusion.

### 5.5 Escrow provider configuration and reconciliation

`escrow_provider_config` contains:

- jurisdiction;
- currency;
- transaction caps;
- fee schedule;
- settlement terms;
- KYC/KYB requirement;
- credential reference;
- active/kill-switch controls.

These are **configuration facts**, not financial postings.

`escrow_reconciliation_ledger` stores external-versus-internal money comparison records and match state.

Classification:

- provider configuration → operational/control fact;
- reconciliation ledger → settlement-integrity/reconciliation evidence;
- neither is a general ledger;
- neither recognizes revenue, cost, receivable or payable.

A fee schedule is not an actual fee expense or revenue charge.

### 5.6 Legacy SafePay, payment tables and historical financial ledger

Historical sources include:

- `safepay_escrows`;
- `financial_ledger`;
- `payments`;
- `payouts`;
- `refunds`;
- `payment_transactions`;
- legacy `currency_rates`.

Critical repository facts:

1. the legacy SafePay writer is disabled and throws;
2. the historical gateway webhook is retired with HTTP 410;
3. current Marketplace payment truth uses the canonical transaction/provider path instead;
4. repository history contains conflicting `financial_ledger` definitions;
5. current canonical payment services were not found posting a Corporate accounting journal into the legacy ledger.

Corporate classification:

**UNKNOWN_FINANCIAL_AUTHORITY / DEPRECATED FOR NEW CORPORATE ACCOUNTING.**

Do not count historical `payments.status = SUCCESS` or `payouts.status = SUCCESS` as current Corporate cash without a separately certified migration/reconciliation and source-custody decision.

Owner decision: `OD-CAFIN-043`.

### 5.7 Legacy currency-rate table

`currency_rates` contains a historically seeded rate representation.

It does not establish:

- accounting rate policy;
- approved provider governance;
- fiscal-period translation;
- transaction-date accounting;
- settlement rate;
- current bank conversion;
- consolidated reporting FX.

Disposition: **DEPRECATE for Corporate accounting FX** unless separately recertified.

### 5.8 Finance applications

`finance_applications` establishes:

- applicant-requested amount;
- requested currency and provenance;
- application lifecycle;
- provider/lender decision provenance where recorded;
- APR/monthly-payment terms for appropriate terminal decisions.

Classification:

- requested amount → COMMERCIAL_INTENT;
- approved/declined decision → product/provider decision;
- `Disbursed` status, if present, remains a product lifecycle/decision fact unless a separate disbursement-money authority proves funds moved.

No accepted disbursement transaction/cash source was found.

Therefore:

**requested finance amount ≠ disbursement**  
**application status ≠ lender cash movement**  
**finance application book ≠ CarUp loan-book asset**

### 5.9 Lender eligibility/provider decisions

Lender workflow stores coarse eligibility/provider outcomes and uses the provider platform.

It intentionally does not store applicant financial detail as a public/corporate fact.

Classification:

- eligibility request → COMMERCIAL_INTENT;
- provider decision → governed provider outcome;
- no cash movement;
- no disbursement;
- no Corporate revenue.

### 5.10 Vehicle finance obligations / encumbrances

`vehicle_finance_obligations` is a governed vehicle encumbrance authority.

It proves:

- existence/type/state of an external/governed vehicle-finance obligation;
- coarse lifecycle such as active, arrears, settlement pending, settled pending release, released, disputed;
- optional provenance-backed valuation at origination.

It explicitly does **not** hold:

- outstanding principal;
- payment schedule;
- arrears amount;
- CarUp receivable;
- CarUp payable;
- CarUp cash;
- CarUp loan book.

Classification: **CUSTOMER/ASSET ENCUMBRANCE FACT**, not Corporate AR/AP.

Origination valuation is a valuation fact, not outstanding balance.

### 5.11 Insurance records and insurer workflow

Legacy/current insurance records can hold:

- premium amount;
- policy/product state.

Insurer provider workflow holds:

- eligibility outcome;
- provider reference;
- conditions;
- validity;
- activation mode.

No accepted payment/cash source was found that proves a premium was collected by CarUp or an insurer through CarUp.

Therefore:

- premium amount → QUOTE_OR_OFFER / product commercial amount;
- insurer eligibility → provider outcome;
- insurance record active → policy/product state subject to its authority;
- none automatically proves premium paid, commission earned or revenue recognized.

### 5.12 Diaspora import orders and procurement quotes

Current sources hold:

- requested budgets;
- import orders;
- procurement quotes;
- accepted quote state.

Classification:

- requested budget → COMMERCIAL_INTENT;
- quote amount → QUOTE_OR_OFFER;
- accepted quote → accepted commercial offer;
- neither proves delivery, settlement, GMV or revenue.

### 5.13 Diaspora payment milestones

`diaspora_payment_milestones` records scheduled milestone amounts and confirmation fields.

Classification:

- scheduled amount → COMMERCIAL_INTENT / prospective CUSTOMER_OBLIGATION candidate depending on commercial contract;
- confirmed milestone → product milestone fact;
- no live-money conclusion unless linked to a certified live provider settlement/cash source.

Binding invariant:

**scheduled milestone ≠ cash received.**

### 5.14 SafeTrade

SafeTrade transaction/milestone/provider-operation sources model a rigorous transaction state machine.

At the accepted snapshot:

- live money paths fail closed;
- `live_payment` is constrained/guarded so sandbox/fake provider paths are the usable money path in the inspected authority;
- SafeTrade comments explicitly state no real money moves before external activation;
- money-truth projection deliberately separates commercial source money, milestone state, provider state and settlement conversion.

Classification of current money-like SafeTrade states:

**SANDBOX_SIMULATION** unless a later accepted authority establishes a genuinely approved live provider and provider-confirmed/ledger-applied money truth.

SafeTrade `SETTLED` state under sandbox does not become Corporate settlement/cash/revenue.

### 5.15 SafeTrade money-truth projection

`diasporaSafeTradeMoneyTruthService.js` is architecturally useful because it preserves separation among:

- source commercial amount;
- planned milestone amount;
- held/released/refunded state;
- provider acknowledgement;
- ledger-applied state;
- settlement FX.

Corporate disposition: **WRAP future live operational settlement evidence**, not an accounting ledger.

### 5.16 Diaspora subscriptions/billing

Current subscription architecture contains:

- plan catalogue / price configuration;
- tenant subscription lifecycle;
- checkout session lifecycle;
- billing provider event ledger;
- provider reconciliation;
- invoice-state parser capability in provider profiles.

Current safety facts:

- live billing is default off;
- approved live provider list is empty;
- real Stripe integration is external-activation gated;
- sandbox/test providers return `live:false`;
- test mode explicitly moves no money.

Therefore current subscription financial states prove:

- entitlement/subscription workflow;
- checkout intent;
- sandbox/test provider behavior;
- provider-shaped event handling.

They do **not** establish:

- cash;
- accounts receivable;
- recognized subscription revenue;
- refund accounting;
- Corporate invoice book.

### 5.17 Billing provider events

The billing event ledger explicitly records what a provider claims and handles deduplication/order/retry.

It does not itself move money or create accounting recognition.

Classification:

- live provider event, if later approved → possible settlement/payment evidence;
- current sandbox/test → SANDBOX_SIMULATION;
- never ACCOUNTING_REVENUE merely because event type is `payment.succeeded`.

### 5.18 Referral rewards and wallets

`referral_wallet_transactions` records amount, currency and a programme lifecycle:

`created → pending → eligible → approved → payable → paid_or_applied`, with held/rejected paths.

This can establish programme obligations/status.

Corporate classification:

- pending/eligible/approved → programme COMMERCIAL_INTENT / obligation candidate;
- payable → PLATFORM_OBLIGATION candidate;
- paid_or_applied → programme terminal state.

It does not, without finance source linkage, prove:

- accounting payable;
- direct cost;
- expense;
- cash payment;
- bank settlement.

At the current accepted intelligence evidence point, no referral reward had been proven paid; accrued value and paid value were deliberately separated.

### 5.19 Coupons/discounts

Referral coupon records can prove:

- discount terms;
- application/redemption state;
- calculated product discount.

They do not establish accounting contra-revenue, marketing expense or subsidy treatment.

Accounting treatment remains Owner Decision / future Finance policy.

### 5.20 Service / garage work orders

`mechanic_work_orders` contains `labor_cost` and `total_cost` fields.

These are product/service work-order amounts.

No accepted invoice/payment/accounting linkage was found that proves:

- amount billed;
- amount collected;
- CarUp revenue;
- provider revenue;
- CarUp commission;
- direct cost;
- cash.

Some historical/converged numeric fields default to zero. Therefore zero must not be treated as a measured accounting amount unless source semantics prove zero.

Disposition: **WRAP as operational service amount only; Corporate revenue/cost unavailable.**

### 5.21 Parts inventory amount

Mechanic parts can hold unit price and stock quantity, enabling a product inventory-value calculation where both are recorded.

This is not automatically:

- accounting inventory;
- balance-sheet asset;
- COGS;
- direct cost;
- cash paid to supplier.

No accounting inventory method, ownership policy or cost basis has been established.

### 5.22 Dealer charges/fees

No accepted canonical source was found for dealer subscription fee, marketplace commission, listing fee, dealer invoice or payment that can be treated as Corporate revenue.

Status: **UNAVAILABLE_NO_SOURCE** until a source/stream is established.

### 5.23 Logistics quotes

Diaspora logistics quotes can contain:

- freight;
- handling;
- origin charges;
- destination charges;
- documentation fees;
- total;
- currency.

Classification: **QUOTE_OR_OFFER.**

Quote acceptance/award is a commercial commitment state but not payment, expense or revenue recognition.

### 5.24 Trade commercial charge components

`diaspora_trade_charge_components` is a strong structured commercial source.

It distinguishes:

- source amount/currency;
- inclusion status;
- commercial status;
- provenance;
- cost stage;
- revenue class.

Revenue-class vocabulary includes:

- `PASS_THROUGH_COST`
- `GOVERNMENT_DUTY`
- `TAX`
- `PARTNER_CHARGE`
- `CARUP_SERVICE_FEE`
- `CARUP_COMMISSION`
- `CARUP_LOGISTICS_MARGIN`
- `CONTINGENT_COST`

This is **commercial classification**, not accounting recognition.

A component labelled `CARUP_SERVICE_FEE` proves that the commercial quote says the component is a CarUp charge. It does not prove:

- it was invoiced;
- it became receivable;
- it was paid;
- it was recognized as revenue;
- which legal entity earned it;
- which period recognizes it.

Disposition: **REUSE for commercial-source lineage; WRAP before any finance reporting.**

### 5.25 Shared trade charge allocations

`diaspora_shared_charge_allocations` exactly allocates a quoted charge across approved capacity reservations.

It proves:

- commercial allocation of an existing source charge under a stated basis.

It does not prove:

- invoice;
- receivable;
- payment;
- accounting cost;
- revenue.

### 5.26 Trade FX

`diaspora_fx_rate_snapshots` provides immutable reference FX sourced from ECB where supported.

The service explicitly states:

- source money remains permanent commercial truth;
- reference USD is display/comparison only;
- reference FX is not settlement FX;
- reference FX is not customs valuation FX;
- unsupported currencies remain unavailable.

Corporate Finance classification:

**REFERENCE MARKET DATA — NOT ACCOUNTING FX AUTHORITY.**

It may be useful for management comparison after Owner policy, but it cannot silently translate accounting books.

### 5.27 Legacy FX

Legacy `currency_rates` is separately present and historically seeded.

This creates a source conflict with the newer explicit reference-FX architecture and still does not establish Corporate accounting FX.

Disposition: **DEPRECATE FOR CORPORATE CONSOLIDATION.**

### 5.28 Provider fees / payment processing costs

Potential source: `escrow_provider_config.fee_schedule`.

This is configuration, not actual charged fee.

No accepted source was found for actual:

- payment provider fee charged per live transaction;
- provider invoice;
- processor settlement fee;
- bank fee.

Status: **UNAVAILABLE_NO_SOURCE** for direct-cost/opex reporting.

### 5.29 Messaging, OCR, AI and platform costs

Operational telemetry/logs may exist for usage, requests, tokens or provider health.

No accepted Corporate Finance source was found for actual vendor invoice/cost allocation for:

- communications provider spend;
- OCR provider spend;
- AI/model spend;
- hosting/infrastructure spend;
- storage/network spend.

Status: **UNAVAILABLE_NO_SOURCE** for accounting cost.

### 5.30 Cash / bank authority

No accepted bank-account, treasury balance or bank-statement source was found that can prove Corporate cash.

Provider transaction state is not a bank balance.

Status:

**CASH_BALANCE = UNAVAILABLE_NO_SOURCE.**

---

## 6. Current source-to-fact authority matrix

| Source family | Intent | Quote | Obligation | Settlement | Cash movement | Accounting recognition | Sandbox simulation | Current Corporate conclusion |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| Listing price | ✓ | — | — | — | — | — | — | Asking/commercial price only |
| Marketplace inquiry | ✓ | — | — | — | — | — | — | Buyer intent only |
| Transaction-intent listing snapshot | ✓ | — | — | — | — | — | — | Snapshotted asking terms |
| Reservation | ✓ | — | — | — | — | — | — | Reservation lifecycle |
| Marketplace payment intent | ✓ | — | — | — | — | — | current provider may be sandbox | Deposit payment intent |
| Marketplace captured/released state | — | — | possible held/settled fact when live | candidate when live | provider movement candidate when live | — | ✓ at accepted source evidence | Do not activate live financial metrics yet |
| Legacy SafePay | unknown historical | — | unknown | unknown | unknown | unknown | historical | Deprecated |
| Legacy financial ledger | — | — | — | — | — | structurally claims entries | — | Conflicting/uncertified authority |
| Finance application | ✓ | lender terms | — | — | — | — | provider eligibility may be sandbox | Not disbursement |
| Vehicle finance obligation | — | — | ✓ external encumbrance | coarse obligation settlement state | — | — | — | Not CarUp AP/AR |
| Insurance premium/policy | — | ✓ / product amount | possible policy obligation outside Corporate books | — | — | — | provider eligibility may be sandbox | Not premium paid/revenue |
| Import order budget | ✓ | — | — | — | — | — | — | Request amount |
| Import/logistics quote | — | ✓ | candidate when contract accepted | — | — | — | — | Quote only |
| Payment milestones | ✓ / scheduled | — | candidate | product confirmation only | — | — | current SafeTrade money path sandbox | Not cash |
| SafeTrade | ✓ | — | possible workflow obligation | sandbox operational states | no live authority at snapshot | — | ✓ | No live settlement metric |
| Subscription checkout | ✓ | offer/plan | candidate subscription relationship | — | — | — | ✓ current | No revenue |
| Billing provider event | — | — | — | candidate only if live/verified | candidate only if live/verified | — | ✓ current | Event ≠ journal |
| Referral wallet | — | — | ✓ programme obligation candidate | product terminal state only | not proven | — | — | Not AP/expense/cash |
| Work-order costs | — | service amount | possible customer/provider commercial amount | — | — | — | — | Not accounting |
| Trade charge components | — | ✓ | candidate quoted/accepted charge | — | — | — | — | Commercial classification only |
| Reference FX | — | — | — | — | — | — | — | Comparison data only |
| Bank/treasury | — | — | — | — | no accepted source | — | — | Corporate cash unavailable |

---

## 7. GMV authority

### 7.1 Canonical semantic

GMV may only be defined after Owner policy.

A future GMV metric requires at minimum:

1. a unique qualifying completed transaction identity;
2. a product/domain transaction type;
3. an authoritative completion event/state;
4. an authoritative transaction consideration amount;
5. currency;
6. legal entity / reporting entity attribution;
7. BU attribution;
8. transaction date/timestamp authority;
9. cancellation/refund/reversal treatment;
10. partial settlement treatment;
11. tax/shipping/insurance/fees inclusion policy;
12. live-vs-sandbox provenance;
13. deduplication/version;
14. cross-currency policy.

### 7.2 Current status

No single current source satisfies those requirements across CarUp.

Particularly:

- listing price is asking price;
- transaction-intent amount snapshots listing price;
- Marketplace payment amount is a deposit;
- reservation completion does not carry full transaction consideration;
- finance requested amount is not disbursement;
- insurance premium is not proven payment;
- trade quote is not settlement;
- logistics quote is not settlement;
- scheduled milestones are not received cash;
- current SafeTrade money path is sandbox;
- subscription billing is not live;
- commercial CarUp fee labels are not recognized accounting revenue.

Therefore:

**Corporate GMV = PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE.**

### 7.3 No synthetic GMV

Corporate Admin must not calculate GMV from:

- sum of listing prices;
- sum of transaction-intent listing amounts;
- sum of reservations;
- sum of deposits;
- sum of finance applications;
- sum of approved finance amounts;
- sum of insurance premiums;
- sum of accepted quotes;
- sum of scheduled milestones;
- sum of sandbox settlements;
- sum of `CARUP_*` charge components;
- sum of “sold” listing statuses without completed transaction-value authority.

---

## 8. Revenue authority

### 8.1 Recognition boundary

Revenue exists in Corporate Admin only when:

- a revenue stream is approved;
- the earning legal entity is known;
- an authoritative source transaction/contract exists;
- recognition policy defines when/how the amount is earned;
- the Corporate Finance SOR posts the recognized amount;
- period, currency and dimensions are present;
- reversal/refund treatment is governed.

### 8.2 Commercial charge versus revenue

Examples of commercial facts that are **not yet revenue**:

- marketplace commission configured on a product;
- Trade charge marked `CARUP_COMMISSION`;
- Trade `CARUP_SERVICE_FEE`;
- quoted logistics margin;
- subscription plan price;
- insurer/lender referral fee configuration;
- dealer listing fee;
- verification fee configuration.

They become accounting revenue only through a governed recognition process.

### 8.3 Current status

No accepted accounting recognition source exists.

Therefore:

- recognized revenue → **UNAVAILABLE_NO_SOURCE**
- revenue by BU → **UNAVAILABLE_NO_SOURCE**
- subscription revenue → **UNAVAILABLE_NO_SOURCE**
- marketplace commission revenue → **UNAVAILABLE_NO_SOURCE**
- logistics/service-fee revenue → **UNAVAILABLE_NO_SOURCE**
- finance/insurance referral commission revenue → **UNAVAILABLE_NO_SOURCE**
- Trust/verification revenue → **UNAVAILABLE_NO_SOURCE**

All remain **PENDING_CA_FIN**.

---

## 9. Direct cost, operating expense and profit authority

### 9.1 Direct cost

Potential future direct-cost streams may include, subject to Owner/accounting policy:

- payment-provider fees;
- escrow/custody provider fees;
- lender/insurer referral partner costs;
- logistics pass-through amounts borne by CarUp;
- referral rewards;
- communications/OCR/AI usage tied directly to a revenue stream;
- service-provider payouts;
- acquisition costs directly attributable under approved policy.

Current product fields/configuration do not establish accounting direct cost.

Status: **UNAVAILABLE_NO_SOURCE.**

### 9.2 Operating expense

Potential categories may include:

- payroll;
- office/admin;
- hosting/platform;
- general software;
- professional/legal;
- marketing;
- central communications/AI/OCR spend not treated as direct cost.

No accepted accounting expense source currently exists.

Status: **UNAVAILABLE_NO_SOURCE.**

### 9.3 Gross profit

Conceptual finance identity only:

**gross profit = recognized revenue − governed direct cost**

This is not an active CarUp formula until the numerator/source and direct-cost policy are accepted.

Status: **UNAVAILABLE_NO_SOURCE.**

### 9.4 Gross margin

Requires governed gross profit and governed revenue under the same scope/version/currency.

Status: **UNAVAILABLE_NO_SOURCE.**

### 9.5 Contribution margin

Requires Owner policy defining which variable/direct/semi-variable costs are included.

Status: **UNAVAILABLE_NO_SOURCE / OWNER DECISION REQUIRED.**

### 9.6 Operating profit

Requires governed recognized revenue and operating costs/expenses under accepted management-accounting policy.

Status: **UNAVAILABLE_NO_SOURCE.**

### 9.7 Net profit

Requires complete accounting policy including finance costs, tax and other income/expense as applicable.

Status: **UNAVAILABLE_NO_SOURCE.**

---

## 10. Cash, escrow, settlements and refunds

### 10.1 Corporate cash

Cash requires:

- approved bank/payment account identity;
- legal owner/entity;
- balance/transaction authority;
- bank/provider statement feed or equivalent;
- reconciled book balance;
- currency;
- as-of timestamp.

No accepted source currently satisfies this.

**Corporate cash = UNAVAILABLE_NO_SOURCE.**

### 10.2 Escrow held

A future `ESCROW_HELD` metric requires:

- approved live provider;
- provider-confirmed captured/held state;
- amount and currency;
- transaction/escrow ID;
- custody relationship;
- reconciliation status;
- no sandbox/test provenance;
- policy defining whether amount is custodial/restricted/off-balance/other for reporting.

At the current snapshot, live provider activation is not established.

**Escrow held Corporate Actual = UNAVAILABLE_NO_SOURCE.**

### 10.3 Settlement exposure

A future settlement-exposure metric requires a precise population such as:

- live held amounts awaiting approved release;
- live approved release awaiting provider confirmation;
- live provider-confirmed release not reconciled;
- unmatched provider/internal settlement.

Each state must be separately defined.

Current status: **PENDING_SOURCE / PENDING_K2B / OWNER DECISION REQUIRED.**

### 10.4 Refunds

Current canonical Marketplace payment service has a governed refund workflow and provider-normalized refund state.

For Corporate finance, refund reporting requires:

- live provider authority;
- refunded amount;
- currency;
- source transaction;
- provider confirmation;
- accounting reversal/contra-revenue policy;
- cash/bank reconciliation where relevant.

Current Corporate refund amount = **PENDING_SOURCE / UNAVAILABLE for accounting treatment**.

Legacy `refunds` table is not accepted as current Corporate authority.

---

## 11. Accounts receivable

A product invoice, quote or charge does not automatically create accounting AR.

A future receivable subledger needs:

- receivable ID;
- legal entity creditor;
- customer/debtor;
- originating contract/order/invoice;
- original amount/currency;
- recognized amount;
- due date;
- issue date;
- status;
- settlement applications;
- credit notes/reversals;
- write-off policy;
- BU/department/cost-profit dimensions;
- accounting period;
- immutable source linkage.

No accepted AR source currently exists.

**Accounts receivable = UNAVAILABLE_NO_SOURCE.**

---

## 12. Accounts payable and obligations

Product obligations currently include concepts such as:

- referral rewards;
- partner/provider commercial charges;
- logistics allocations;
- external vehicle-finance encumbrances.

Those do not automatically become CarUp AP.

A future payable subledger needs:

- payable ID;
- CarUp legal debtor entity;
- vendor/payee;
- source contract/bill/invoice/approved obligation;
- amount/currency;
- due date;
- approval status;
- payment applications;
- credit/reversal;
- cost/expense classification;
- BU/cost centre;
- accounting period.

Current Corporate AP = **UNAVAILABLE_NO_SOURCE.**

Referral `payable` is a programme obligation candidate, not certified accounting payable.

Vehicle finance obligations are vehicle encumbrances owed by vehicle/borrower parties, not CarUp payables.

---

## 13. Average transaction value, take rate and contribution margin

### 13.1 Average transaction value

Requires:

- accepted completed transaction population;
- qualifying transaction amount;
- same GMV definition;
- explicit currency handling.

Current status: **UNAVAILABLE_NO_SOURCE.**

Do not use:

- listing average price;
- deposit average;
- quote average;
- requested finance average.

### 13.2 Take rate

Requires Owner-defined numerator and denominator.

Possible conceptual shape:

- numerator: specific recognized CarUp revenue stream(s);
- denominator: specific accepted GMV population.

Neither is currently authoritative.

Current status: **UNAVAILABLE_NO_SOURCE.**

### 13.3 Contribution margin

Requires:

- recognized revenue;
- Owner-approved variable/direct contribution cost set;
- consistent period and scope.

Current status: **UNAVAILABLE_NO_SOURCE.**

---

## 14. Corporate Finance & Accounting versus Finance / Payments BU

### 14.1 Corporate Finance & Accounting

CA-ORG proposed internal authority:

`CF_FINANCE_ACCOUNTING`

Corporate Finance & Accounting owns, subject to Owner decisions:

- accounting policy;
- chart of accounts;
- legal-entity books;
- period calendar/close;
- journal controls;
- accounting recognition;
- management accounting;
- revenue/cost classification;
- AR/AP;
- treasury/cash;
- accounting FX;
- bank/payment-account reconciliation;
- consolidation;
- cost centres/profit centres;
- finance report publication;
- finance data stewardship;
- accounting-system integration;
- finance audit/evidence.

It does not own customer-facing lender underwriting or product eligibility merely because the word “finance” is used.

### 14.2 Finance / Payments as customer-facing BU/product

CA-ORG proposed:

`BU_FINANCIAL_SERVICES`

Customer-facing Finance/Payments may own:

- finance application experience;
- lender/provider integration;
- eligibility/prequalification;
- finance-product funnel;
- insurance-product funnel where organizationally assigned;
- Marketplace payment UX;
- escrow/transaction workflow as a product capability;
- provider operational lifecycle;
- product settlement/reconciliation workflow;
- customer-facing payment support.

Product authority answers:

**What happened in the product workflow?**

Corporate Finance answers:

**What accounting/management-finance fact does that workflow create, for which legal entity, in which period, under which accounting policy?**

These are separate authorities.

### 14.3 Binding separation

- Finance application count belongs to product/BU performance.
- Cash balance belongs to Corporate Finance/Treasury.
- Payment success belongs to product/provider operations.
- Recognized revenue belongs to Corporate Finance.
- Escrow state belongs to transaction/payment authority.
- Accounting treatment of escrow belongs to Corporate Finance.
- Provider fee schedule belongs to provider configuration.
- Actual provider fee expense belongs to Corporate Finance once invoiced/settled/posted.
- Commercial CarUp charge class belongs to Trade/product.
- Accounting revenue stream mapping belongs to Corporate Finance.

---

## 15. Management-accounting dimensions

The future finance SOR must support dimensions independently rather than encoding them into account names.

### Required dimensions

- legal entity;
- corporate parent/consolidation scope;
- business unit;
- corporate function;
- department;
- team where materially useful;
- cost centre;
- profit centre;
- product/service line;
- revenue stream;
- cost category;
- geography/country/region;
- source market/destination market where relevant;
- customer/partner/vendor class;
- transaction/source-system domain;
- provider;
- currency;
- transaction currency;
- functional currency;
- reporting currency;
- accounting/reporting period;
- provenance/environment eligibility;
- source transaction/reference.

### 15.1 Organisational constraints

- Product tenant/organisation records are not automatically internal cost/profit centres.
- External dealer/garage/bank/insurer/provider is not an internal department.
- BU is not automatically legal entity.
- legal entity is not inferred from product route/domain.
- cost centre and profit centre are accounting/reporting dimensions, not organisational membership by default.

### 15.2 Revenue by BU

Revenue by BU becomes available only after:

- recognized accounting revenue exists;
- each revenue line has governed BU attribution;
- shared/cross-BU transactions have allocation policy;
- legal entity and period are known.

Status today: **UNAVAILABLE_NO_SOURCE.**

---

## 16. Currency and FX authority

### 16.1 Source currency

Every product financial fact must preserve original amount and original currency.

No source currency may be silently defaulted at Corporate reporting time.

### 16.2 Trade reference FX

Current Trade OS reference FX is:

- immutable/reproducible;
- sourced from ECB where supported;
- explicitly for comparison/display;
- not settlement FX;
- not customs FX.

It may become an input to management reporting only if Owner/CA-FIN approves a reporting use-case.

It is **not automatically accounting FX**.

### 16.3 Accounting FX requirements

Corporate Finance must define:

- functional currency per legal entity;
- reporting currency;
- approved FX provider/source;
- rate class: spot, transaction-date, period average, period-end, etc.;
- effective-date rule;
- fallback/stale policy;
- unsupported currency treatment;
- triangulation rule;
- rounding;
- realized/unrealized FX treatment where applicable;
- correction/restatement/versioning.

Until then:

- source currency totals remain grouped by currency;
- no consolidated multi-currency revenue/GMV/cost/cash total is certified.

### 16.4 Missing rates

Missing/unsupported accounting rate = **UNAVAILABLE**, not 1:1, zero or last-known without policy.

---

## 17. Reporting period, close and restatement

Operational event timestamps do not establish accounting periods.

Future Corporate Finance must define:

- fiscal year;
- fiscal periods;
- timezone;
- open period;
- soft close;
- hard close/lock;
- late posting;
- adjustment journal;
- reopening authority;
- restatement;
- prior-period correction;
- report version.

A product event occurring on a date is not automatically recognized in accounting on that date.

Until Owner/CA-FIN policy exists:

**Accounting period assignment = PENDING_CA_FIN.**

---

## 18. Finance RBAC, segregation of duties and export

Consume CA-RBAC / CA-RBAC-01.

### 18.1 Classification

Typical finance classifications:

- high-level certified financial summaries → Internal Confidential or Restricted Financial according to policy;
- journals/line items → Restricted Financial;
- bank/payment-account details → Restricted Financial;
- provider settlement references → Restricted Financial;
- employee payroll/private finance → separately restricted People + Financial;
- payment/escrow customer identity → may also intersect Restricted Identity/Compliance.

### 18.2 Aggregate versus line item

`corporate.finance.summary.read`-style permission must not imply:

- journal-line access;
- bank details;
- customer payment detail;
- vendor bill detail;
- payout destination;
- provider secret/config.

### 18.3 Segregation-of-duties model

Future controls should separately authorize at minimum:

- prepare journal vs approve/post journal;
- create vendor vs approve vendor;
- record bill vs approve payment;
- initiate refund vs approve refund;
- approve settlement/release vs reconcile settlement;
- change bank/payment-account mapping vs approve mapping;
- create period adjustment vs approve period adjustment;
- reopen period vs post into reopened period;
- prepare management report vs approve/publish report;
- finance-data export vs ordinary summary read.

Exact approval thresholds/role assignments remain Owner Decisions.

### 18.4 Break-glass

Any emergency financial override should be:

- time-bound;
- explicitly approved;
- high assurance;
- reason-bearing;
- fully audited;
- reviewed after use.

### 18.5 Export

Financial export is a distinct permission and may require stronger assurance than screen-level aggregate read.

---

## 19. Corporate finance metric readiness

Classification meanings:

- **CERTIFIABLE_FROM_CURRENT_SOURCE** — current source can support the finance fact once provenance/access certification is complete.
- **WRAPPABLE** — operational/commercial fact exists, but Corporate semantics must constrain it.
- **PENDING_SOURCE** — architecture/source concept exists but current accepted source does not establish the live/complete fact.
- **UNAVAILABLE_NO_SOURCE** — no accepted source exists.

| Metric | Current readiness | Reason |
| --- | --- | --- |
| Listing price | WRAPPABLE | Governed commercial intent, not accounting |
| Transaction-intent listing amount | WRAPPABLE | Snapshotted asking terms |
| Marketplace deposit amount | WRAPPABLE | Product deposit, not full consideration |
| Requested finance amount | WRAPPABLE | Applicant request, not disbursement |
| Trade requested budget | WRAPPABLE | Commercial intent |
| Import/logistics quote amount | WRAPPABLE | Quote/offer only |
| Trade CarUp fee component | WRAPPABLE | Commercial fee classification, not revenue |
| Referral accrued/payable reward | WRAPPABLE | Programme obligation state, not AP/expense |
| GMV | UNAVAILABLE_NO_SOURCE | No accepted completed transaction-value authority |
| Completed transaction count for GMV | PENDING_SOURCE | Product completion facts exist in domains but no cross-domain finance definition/value authority |
| Recognized revenue | UNAVAILABLE_NO_SOURCE | No Corporate accounting recognition SOR |
| Revenue by BU | UNAVAILABLE_NO_SOURCE | Requires recognized revenue + BU attribution |
| Direct cost / COGS | UNAVAILABLE_NO_SOURCE | No accounting cost authority |
| Gross profit | UNAVAILABLE_NO_SOURCE | Revenue and direct cost absent |
| Gross margin | UNAVAILABLE_NO_SOURCE | Gross profit/revenue absent |
| Operating expense | UNAVAILABLE_NO_SOURCE | No accounting expense authority |
| Operating profit | UNAVAILABLE_NO_SOURCE | Full P&L source absent |
| Net profit | UNAVAILABLE_NO_SOURCE | Full accounting source/policy absent |
| Cash balance | UNAVAILABLE_NO_SOURCE | No bank/treasury authority |
| Cash receipts | UNAVAILABLE_NO_SOURCE | Provider states do not equal bank cash |
| Live escrow held | PENDING_SOURCE | Architecture exists; approved live provider/current live money not established |
| Live settlement exposure | PENDING_SOURCE | Requires live provider and exposure definition |
| Live settlement confirmed | PENDING_SOURCE | Provider/canonical path exists; no accepted current live provider |
| Refund amount | PENDING_SOURCE | Governed refund path exists; live accounting/cash source absent |
| Accounts receivable | UNAVAILABLE_NO_SOURCE | No accounting receivables subledger |
| Accounts payable | UNAVAILABLE_NO_SOURCE | No accounting payables subledger |
| Average transaction value | UNAVAILABLE_NO_SOURCE | GMV/completed consideration absent |
| Take rate | UNAVAILABLE_NO_SOURCE | Revenue + GMV definitions absent |
| Contribution margin | UNAVAILABLE_NO_SOURCE | Revenue + contribution cost policy absent |
| Provider processing cost | UNAVAILABLE_NO_SOURCE | Fee config is not actual incurred cost |
| Subscription revenue | UNAVAILABLE_NO_SOURCE | Billing currently sandbox/test; no recognition |
| Dealer revenue | UNAVAILABLE_NO_SOURCE | No certified dealer billing/accounting source |
| Service revenue | UNAVAILABLE_NO_SOURCE | Work-order totals not invoice/payment/recognition |
| Finance/insurance commission revenue | UNAVAILABLE_NO_SOURCE | No recognized commission source |
| Trade/logistics recognized revenue | UNAVAILABLE_NO_SOURCE | Commercial CarUp charge classes not journaled |

---

## 20. Future minimum Corporate Finance system-of-record architecture

Current product sources are insufficient for Corporate Accounting. A future finance authority must be introduced without replacing domain transaction authorities.

This section defines the minimum conceptual architecture only.

### 20.1 Source transaction registry

Every financial posting must reference an immutable source identity:

- source domain;
- source transaction/event ID;
- source version;
- provenance;
- live/sandbox class;
- original timestamp;
- original amount/currency;
- legal entity mapping;
- idempotency key.

One source event must not be posted twice.

### 20.2 Legal-entity books

The system must know:

- which legal entity owns the books;
- functional currency;
- fiscal calendar;
- consolidation relationship;
- effective dates.

Unknown legal structure remains Owner Decision from CA-ORG.

### 20.3 Chart of accounts

A versioned chart of accounts is required.

It must not be inferred from product table names.

### 20.4 Journal authority

Minimum accounting journal concept:

- journal header;
- immutable source reference;
- posting date/period;
- transaction date;
- legal entity;
- currency;
- balanced debit/credit lines;
- account;
- amount;
- dimensions;
- preparer/approver;
- posted state;
- reversal link;
- reason/evidence.

Corrections should use reversal/adjusting entries, not destructive mutation.

### 20.5 Revenue subledger / billing bridge

Need a governed bridge from product commercial facts to accounting recognition:

- source charge;
- invoice/billing event if applicable;
- revenue stream;
- legal entity;
- recognition trigger;
- recognized amount;
- deferred/unearned amount if applicable;
- refund/credit linkage.

### 20.6 Accounts receivable subledger

Need customer balances, invoices/claims, due dates, settlement applications, credits, write-offs and reconciliation.

### 20.7 Accounts payable subledger

Need vendor/provider/referral obligations, bills, approvals, payments, credits, settlement and reconciliation.

### 20.8 Cash / treasury subledger

Need:

- approved bank/payment accounts;
- balances;
- statements/transactions;
- legal ownership;
- provider/bank references;
- reconciliation;
- restricted/custodial versus unrestricted classification.

### 20.9 Escrow/custodial subledger

If CarUp controls or reports escrow/custodial funds, a separate subledger is required so customer funds cannot be mixed with:

- revenue;
- operating cash;
- ordinary receivables/payables.

Accounting presentation remains Owner policy.

### 20.10 Cost and expense subledger

Need actual cost facts from:

- provider bills;
- vendor invoices;
- payment processor settlements;
- payroll/accounting systems;
- cloud/platform billing;
- communications/OCR/AI providers;
- referral reward settlement;
- partner/logistics/provider invoices.

Configuration/rate cards are not enough.

### 20.11 FX authority

Accounting conversion must reference a versioned approved rate source and rate-type/effective-date policy.

### 20.12 Period-close authority

Need:

- period state;
- close timestamp;
- approver;
- reopen control;
- adjustment window;
- audit trail.

### 20.13 Reconciliation layer

At minimum:

**Product source → finance subledger → General Ledger → bank/provider statement**

Reconciliation must expose:

- matched;
- missing source;
- missing finance posting;
- missing bank/provider transaction;
- amount mismatch;
- currency mismatch;
- duplicate posting;
- unresolved timing difference.

### 20.14 Management-report snapshot

Published finance reports should retain:

- report ID/version;
- accounting period;
- metric-registry version;
- book/legal entity;
- source close state;
- FX version;
- generated/approved timestamps;
- signer/approver;
- reproducible snapshot reference.

### 20.15 External accounting platform

CarUp may implement its own authoritative accounting service or integrate an external accounting/ERP platform.

The Owner must select the authoritative arrangement.

No specific vendor is declared by CA-FIN-01.

---

## 21. Product-to-finance integration contract

Future accounting integration must not let the accounting layer become a second product authority.

Examples:

- Marketplace owns transaction status.
- Finance SOR owns accounting posting generated from accepted transaction facts.
- Trade owns quote/charge facts.
- Finance SOR owns recognized revenue/cost.
- Referral owns reward eligibility/status.
- Finance SOR owns expense/payable recognition.
- Bank/provider owns external cash truth.
- Finance SOR owns reconciled cash book.

### 21.1 Fail-closed posting

If required finance mapping is absent:

- product transaction still follows its own valid domain rules;
- finance posting is marked blocked/unmapped;
- Corporate financial metric remains unavailable/degraded;
- no default revenue/cost account is silently chosen.

### 21.2 Idempotency

A source fact may create at most one posting for a given posting rule/version unless explicitly reversed/reposted under a governed correction workflow.

---

## 22. PENDING_K2B boundary

PC01-K2B-R1 is active and unaccepted.

CA-FIN defines provenance requirements only.

Financial metrics sourced from product operational tables remain PENDING_K2B where operational/test contamination is possible, including:

- Marketplace transaction intents;
- payment intents;
- escrow/provider operation records;
- reservations;
- Diaspora orders/quotes/milestones;
- SafeTrade;
- subscriptions/billing;
- referral rewards;
- service work orders;
- insurance/finance product activity;
- provider reconciliation records.

CA-FIN does not:

- classify current rows;
- adopt the active K2B implementation;
- create a finance-specific provenance classifier;
- mutate/delete test rows.

### 22.1 Accounting provenance requirement

Future accounting entries should retain their source provenance and reject non-business/sandbox sources from Corporate Actual books unless the entry is explicitly in a non-production/test ledger.

---

## 23. Owner Decision Register

| Decision ID | Owner decision required | Why it matters | Safe default until resolved |
| --- | --- | --- | --- |
| `OD-CAFIN-001` | What exact event/state qualifies a transaction for GMV? | Defines denominator of major Corporate metric | GMV unavailable |
| `OD-CAFIN-002` | Which product domains are included in GMV? | Marketplace, Trade, Service, parts etc. may differ | No cross-domain GMV |
| `OD-CAFIN-003` | Does GMV include taxes, duties, shipping, insurance, financing, CarUp fees or pass-through charges? | Changes value materially | Exclude nothing/invent nothing; keep components separate |
| `OD-CAFIN-004` | How do cancellations, refunds, partial refunds and reversals affect GMV? | Gross vs net GMV distinction | No GMV |
| `OD-CAFIN-005` | How are partially paid/completed transactions treated? | Prevents intent/deposit inflation | Do not count as completed GMV |
| `OD-CAFIN-006` | What are CarUp’s canonical revenue streams? | Required before recognition/mapping | No revenue catalogue assumed |
| `OD-CAFIN-007` | What accounting standard/policy governs revenue recognition? | Defines recognition timing | Revenue unavailable |
| `OD-CAFIN-008` | What is Marketplace commission/listing/service-fee policy? | Needed for product→revenue mapping | Do not infer fee from price/deposit |
| `OD-CAFIN-009` | How is subscription revenue recognized? | Plan price/payment/recognition differ | No subscription revenue |
| `OD-CAFIN-010` | How are Diaspora Trade/Logistics CarUp fees recognized? | Commercial `CARUP_*` charge class is not accounting | Treat as quoted commercial charge only |
| `OD-CAFIN-011` | Does CarUp earn lender/finance referral/origination commission, and when? | Product application is not revenue | No finance commission revenue |
| `OD-CAFIN-012` | Does CarUp earn insurance referral/commission revenue, and when? | Premium/product state not revenue | No insurance commission revenue |
| `OD-CAFIN-013` | Are Trust/verification/provider services revenue streams? | No current accounting source | No revenue |
| `OD-CAFIN-014` | What qualifies as direct cost/COGS by revenue stream? | Required for gross profit | Direct cost unavailable |
| `OD-CAFIN-015` | How are payment/escrow provider fees classified? | Could be direct cost or operating expense | No classification |
| `OD-CAFIN-016` | How are referral rewards classified? | Programme obligation may become cost/marketing expense | Do not call payable/direct cost |
| `OD-CAFIN-017` | How are logistics/vendor pass-through charges classified? | Gross/net presentation and margin | Preserve as commercial components |
| `OD-CAFIN-018` | How are communications/OCR/AI/provider costs classified? | Direct vs operating cost | No accounting cost |
| `OD-CAFIN-019` | What is the accounting/presentation treatment of escrow/custodial funds? | Held funds may not belong to CarUp | Never call revenue/unrestricted cash |
| `OD-CAFIN-020` | What exact states constitute settlement exposure? | Needed for risk/cash operations | Show named operational states only |
| `OD-CAFIN-021` | What is the accounting treatment/effective date of refunds? | Revenue/cash/AR effects differ | Product refund state only |
| `OD-CAFIN-022` | How are disputes/chargebacks recognized? | Could affect revenue/cash/reserves | No accounting inference |
| `OD-CAFIN-023` | What is the canonical take-rate formula? | Numerator/denominator policy | Take rate unavailable |
| `OD-CAFIN-024` | What is contribution margin and which costs belong in it? | Management-accounting decision | Contribution margin unavailable |
| `OD-CAFIN-025` | Which internal units are profit centres? | Required for P&L ownership | None inferred from BU/routes |
| `OD-CAFIN-026` | Which internal units are cost centres? | Required for expense ownership | None inferred from departments |
| `OD-CAFIN-027` | Which legal entities maintain separate books? | Accounting/consolidation authority | Legal status unknown from product |
| `OD-CAFIN-028` | What is CarUp’s fiscal year/calendar? | Period close/reporting | No fiscal calendar assumed |
| `OD-CAFIN-029` | What is functional currency per legal entity? | Accounting books | Preserve source currencies |
| `OD-CAFIN-030` | What is Corporate reporting currency? | Consolidated management reporting | No consolidated currency total |
| `OD-CAFIN-031` | What approved accounting FX source and rate policy apply? | Translation/revaluation | Do not use Trade reference FX automatically |
| `OD-CAFIN-032` | What period-close, lock and reopen policy applies? | Historical reproducibility | No accounting close assumed |
| `OD-CAFIN-033` | How are late transactions/prior-period adjustments handled? | Restatement | Preserve source date; no accounting period inference |
| `OD-CAFIN-034` | Which bank/payment accounts are authoritative Corporate cash accounts? | Treasury/cash metric | Cash unavailable |
| `OD-CAFIN-035` | What event creates a Corporate receivable? | AR subledger | AR unavailable |
| `OD-CAFIN-036` | What event creates a Corporate payable? | AP subledger | AP unavailable |
| `OD-CAFIN-037` | What is management-accounting versus statutory-accounting scope in CA-1.0? | Prevents dashboards pretending to be statutory books | Treat CA-1.0 as management architecture only |
| `OD-CAFIN-038` | What approval thresholds/SoD apply to journals, refunds, settlements and payments? | Financial control | No generic admin override |
| `OD-CAFIN-039` | Who may export restricted financial data? | RBAC/data leakage | Export separately gated |
| `OD-CAFIN-040` | What finance-data retention/audit policy applies? | Regulatory/audit requirements | Preserve governed history; do not delete by convenience |
| `OD-CAFIN-041` | Will Corporate Accounting be internal, external ERP/accounting platform, or hybrid? | Determines system of record | No vendor/system selected |
| `OD-CAFIN-042` | What chart-of-accounts structure and versioning apply? | Posting authority | No accounts inferred |
| `OD-CAFIN-043` | What is the disposition of legacy `financial_ledger`, `payments`, `payouts`, `refunds` and `payment_transactions` data? | Conflicting historical authority | Do not use for Corporate Actual without forensic recertification |
| `OD-CAFIN-044` | Are Trade `CARUP_SERVICE_FEE/COMMISSION/LOGISTICS_MARGIN` classes always quote/commercial classifications until posted to Finance SOR? | Prevents quoted fee = revenue | **Yes as safe default**; no revenue without accounting posting |
| `OD-CAFIN-045` | How is recognized revenue allocated across BUs for shared/cross-domain transactions? | Revenue-by-BU | No allocation |
| `OD-CAFIN-046` | How are shared corporate costs allocated across BUs/functions? | BU profitability | No allocation |
| `OD-CAFIN-047` | What completed-transaction identity prevents duplicate GMV across Marketplace, Trade, Logistics and payments? | Cross-domain double counting | Do not aggregate adjacent transaction records |
| `OD-CAFIN-048` | What invoice/billing authority is canonical for each revenue stream? | AR/revenue/source lineage | No invoice assumed |
| `OD-CAFIN-049` | How are coupons/discounts accounted for: contra-revenue, marketing expense, subsidy or other? | Revenue/gross margin | Product discount only |
| `OD-CAFIN-050` | How are taxes/duties collected or passed through presented in management reporting? | Gross/net revenue and liabilities | Keep government duty/tax separate from CarUp revenue |
| `OD-CAFIN-051` | What exact authority proves cash receipt: bank feed, provider settlement, treasury service or combination? | Cash metric | No cash metric |
| `OD-CAFIN-052` | What policy governs stale/unreconciled provider money states? | Settlement/cash exposure | Keep operationally separate; no accounting finality |
| `OD-CAFIN-053` | How are opening balances introduced when Corporate Finance SOR begins? | Historical reporting | No fabricated historical opening |
| `OD-CAFIN-054` | Which historic product financial facts are migrated versus retained only as product history? | Avoids false historical books | No automatic migration |
| `OD-CAFIN-055` | What is the accounting treatment of customer funds held in escrow if CarUp is not beneficial owner? | Balance sheet/cash presentation | Never present as revenue/unrestricted cash |
| `OD-CAFIN-056` | What is the management-report materiality/rounding policy? | Financial report consistency | Preserve source precision; no materiality assumptions |

---

## 24. Required source state before key metrics can activate

### GMV

Requires:
- accepted OD-CAFIN-001 through 005;
- completed transaction amount authority;
- cross-domain transaction identity;
- K2B provenance;
- currency policy.

### Recognized revenue

Requires:
- revenue stream catalogue;
- recognition policy;
- Finance SOR journal;
- legal entity;
- period;
- source lineage.

### Revenue by BU

Requires recognized revenue plus governed BU mapping and cross-BU allocation.

### Direct cost / gross profit / gross margin

Requires cost source/subledger and approved cost classification.

### Operating expense / operating profit / net profit

Requires complete expense/accounting books and period close.

### Cash

Requires treasury/bank authority and reconciliation.

### Escrow held

Requires approved live provider, provider-confirmed held amount, custody classification and reconciliation.

### Settlement exposure

Requires live-money source and Owner-approved exposure states.

### Refunds

Requires live provider refund amount + accounting reversal treatment.

### Receivables/payables

Require dedicated accounting subledgers.

### Average transaction value / take rate / contribution margin

Require certified lower-level source metrics and Owner definitions.

---

## 25. Downstream inputs

### CA-UX

Must display:

- unavailable instead of invented financial values;
- product commercial values with precise labels;
- live versus sandbox;
- source currency;
- reconciliation/freshness;
- restricted-financial access state;
- no “Revenue”, “Profit”, “Cash”, “GMV”, “Margin” card until certified.

### CA-REPORT

Must reference:

- finance metric ID/version;
- legal entity;
- period/close state;
- reporting currency/FX version;
- source snapshot;
- approval state.

### CA-BU

May consume operational/commercial financial metrics such as quote volumes/amounts or product deposit activity, but must not call them P&L.

### CA-GROWTH

Customer acquisition/campaign metrics may link to finance only after revenue/cost authority exists. No ROI from referral/campaign activity alone.

### CA-METRIC

Should update finance metrics from `PENDING_CA_FIN` only after accepted finance-source/Owner decisions exist.

### CA-RBAC

Must preserve Restricted Financial aggregate/line-item separation and SoD.

### CA-CERT

Must certify:

- source-to-posting lineage;
- idempotency;
- live/sandbox separation;
- legal entity;
- period;
- currency/FX;
- balance/reconciliation;
- access;
- version;
- reversal behavior.

---

## 26. Open risks

1. **Legacy ledger ambiguity** — conflicting `financial_ledger` shapes can be mistaken for an active General Ledger.
2. **Legacy success statuses** — old payment/payout/refund rows could be mistaken for current cash.
3. **Deposit-as-GMV** — Marketplace provider only processes a governed deposit in the inspected path.
4. **Listing-price-as-GMV** — asking price can overstate transaction value.
5. **Sold-status-as-sale-value** — lifecycle status may exist without certified transaction consideration.
6. **Finance-request-as-loan-book** — requested amount is applicant intent.
7. **Insurance-premium-as-revenue** — product premium does not prove payment/commission.
8. **Scheduled-milestone-as-cash** — planned/confirmed workflow is not bank receipt.
9. **Sandbox-as-money** — durable sandbox records look authoritative because they persist.
10. **Commercial fee-as-revenue** — Trade `CARUP_*` classes may be mistaken for recognized revenue.
11. **Referral payable-as-AP** — product wallet state is not accounting payable.
12. **Work-order zero/defaults** — default numeric fields may create fabricated zero revenue/cost.
13. **Reference-FX misuse** — ECB display reference may be incorrectly used for settlement/accounting.
14. **Cross-domain double count** — Marketplace transaction, escrow, reservation, Trade order and payment records may describe one economic journey.
15. **Escrow ownership confusion** — customer-held funds may be shown as CarUp cash/revenue.
16. **Provider reconciliation-as-journal** — reconciliation evidence is not accounting posting.
17. **Missing legal entity** — product domain/tenant does not determine accounting entity.
18. **No close state** — operational data can change after a management report if no finance snapshot/period lock exists.
19. **K2B contamination** — test/UAT/sandbox rows can contaminate operational amounts before accepted provenance filtering.
20. **Incomplete cost base** — profit metrics would be structurally overstated without vendor/payroll/platform costs.

---

## 27. Stop conditions encountered

CA-FIN stopped rather than guessing on:

- qualifying GMV transaction;
- transaction consideration authority;
- revenue stream catalogue;
- revenue recognition;
- accounting legal entities;
- fiscal year;
- functional/reporting currencies;
- accounting FX;
- direct-cost classification;
- provider-fee accounting;
- referral-reward accounting;
- escrow balance-sheet treatment;
- cash source;
- AR/AP recognition;
- BU allocations;
- contribution margin;
- take rate;
- chart of accounts;
- period close;
- accounting platform;
- legacy finance-data migration.

Each unresolved policy is represented by `OD-CAFIN-*` rather than a fabricated rule.

---

## 28. Recommended next steps after moderator review

If CA-MOD accepts CA-FIN-01:

1. Owner decisions for legal entity, accounting platform, fiscal calendar, reporting currency, GMV and revenue streams should be prioritized before finance implementation.
2. CA-UX may proceed with finance-safe unavailable/product-commercial states without inventing accounting values.
3. CA-REPORT may define report containers but should not publish unrecognized P&L values.
4. A future bounded finance-system task should design the approved SOR integration only after Owner authority exists.
5. CA-CERT should later certify the complete chain:
   **product fact → finance posting → subledger → GL → provider/bank reconciliation → report**.

No product code, payment system, escrow state, database schema, migration, K2B implementation or production data was changed by CA-FIN-01.

This document does not self-accept.

CA-FIN-01 CORPORATE FINANCE MODEL READY FOR MODERATOR REVIEW
