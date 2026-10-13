# CA-FIN-01 — CORPORATE FINANCE / MANAGEMENT-ACCOUNTING AUTHORITY MODEL

FROM: CA-MOD — Corporate Admin Programme Moderator
TO: CA-FIN — Finance & Management Accounting Agent
TASK: CA-FIN-01
PROGRAMME: CA-1.0

## Accepted authorities

- Canonical plan: 5d4997cacaff8068c4ec4c5ae78f562be4249344
- CA-ARCH-01 ACCEPTED: 7cae8c3c8c987714a8ca6db2128db3b9a589f141
- CA-ORG-01 ACCEPTED: 705eb6fa1cd89109977052e88e220f0498668060
- CA-RBAC-01 ACCEPTED: 4abdf95e1e1490b01f51cb45106a57fcf7b954b9
- CA-METRIC-01 ACCEPTED: 32c26ce5d89ec3829e2afa9248d1e77a2cb4c784
- Product snapshot for read-only inspection: 505ffcca6b641c8b3b55f503e0f4fd39d26710dc
- PC01-K2B-R1: ACTIVE / NOT YET ACCEPTED

Read in full:
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md
- docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_RBAC_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_METRIC_REGISTRY.md

## MODERATOR AUTHORITY

AUTHORIZED — FINANCE ARCHITECTURE / SOURCE RECONCILIATION / DOCUMENTATION ONLY.

NO PRODUCT IMPLEMENTATION.
NO DATABASE MIGRATION.
NO ACCOUNTING ENTRY CREATION.
NO REVENUE RECOGNITION ASSUMPTION.
NO TAX/LEGAL ADVICE.
NO K2B PROVENANCE IMPLEMENTATION.
NO PAYMENT OR ESCROW MUTATION.
NO PRODUCTION.

---

## 1. Objective

Establish the canonical finance and management-accounting authority model for Corporate Admin 1.0.

The result must answer, with source-level discipline:

- What financial facts does CarUp actually record today?
- Which amounts are commercial intent versus real money movement?
- What can be called GMV, revenue, direct cost, gross profit, cash, receivable, payable or settlement exposure?
- Which required executive finance metrics have no authoritative source yet?
- Which existing tables/services can be reused, wrapped or must remain explicitly unavailable?
- What additional finance system-of-record capability will eventually be required?
- How should Finance & Accounting differ from the Finance/Payments product business unit?

This is finance architecture, not bookkeeping implementation.

---

## 2. Binding semantic rules

Preserve these canonical distinctions:

- listing asking price != transaction value;
- requested finance amount != disbursement;
- quote amount != completed transaction;
- scheduled milestone != cash received;
- sandbox escrow != live settlement;
- escrow held != CarUp revenue;
- cash received != recognized revenue by default;
- GMV != revenue;
- revenue != gross profit;
- gross profit != operating profit;
- operating profit != net profit;
- receivable != cash;
- payable/obligation != expense unless accounting authority establishes it;
- seller/buyer money held on behalf of others is not automatically CarUp income.

Do not weaken these distinctions.

---

## 3. Current finance-source inventory

Inspect the accepted product snapshot and inventory all finance-relevant sources, including where present:

- SafePay / escrow sessions and provider mode;
- settlement state;
- payment intents / payment references;
- subscriptions / billing records;
- referral reward accrual and payment state;
- Marketplace reservation / transaction records;
- vehicle/listing asking prices;
- finance applications / lender requests;
- loan requested amounts / approved amounts / disbursement authority if any;
- insurance premium/payment records where authoritative;
- Diaspora import orders, quotes, payment milestones and SafeTrade;
- container/logistics fees or charges where recorded;
- dealer/garage/service charges or invoices if any;
- refunds/disputes;
- commissions / platform fees;
- provider fees / direct transaction costs;
- invoices / billing documents;
- receivable/payable-like records;
- bank/cash balance authority;
- currency and FX sources;
- existing accounting/export/report structures.

For each source, record:

- exact table/service/API;
- business meaning;
- whether it records intent, authorization, obligation, settlement or accounting recognition;
- live versus sandbox distinction;
- actor/tenant scope;
- currency semantics;
- timestamps;
- reversals/refunds;
- provenance/K2B dependency;
- existing audit authority;
- whether it can support a Corporate Actual finance metric.

---

## 4. Finance truth taxonomy

Define canonical finance fact classes at minimum:

- COMMERCIAL_INTENT
- QUOTE_OR_OFFER
- PAYMENT_INTENT
- CUSTOMER_OBLIGATION
- PLATFORM_OBLIGATION
- ESCROW_HELD
- SETTLEMENT_PENDING
- SETTLEMENT_CONFIRMED
- REFUND_OR_REVERSAL
- ACCOUNTING_REVENUE
- DIRECT_COST
- OPERATING_EXPENSE
- RECEIVABLE
- PAYABLE
- CASH_BALANCE
- NON_CASH_ACCOUNTING_ENTRY
- SANDBOX_SIMULATION
- UNKNOWN_FINANCIAL_AUTHORITY

Explain which current CarUp sources fit each class and which classes have no source.

---

## 5. GMV authority

Define what CarUp would require before a value may be registered as Corporate GMV.

At minimum specify:

- qualifying completed transaction event;
- authoritative transaction amount;
- currency;
- reversal/cancellation treatment;
- partial payment treatment;
- transaction ownership/CarUp facilitation boundary;
- marketplace versus service versus trade aggregation;
- cross-currency rule;
- whether taxes/shipping/insurance/fees are included or excluded;
- versioning.

Do not choose the business policy if repository evidence does not establish it.

Create Owner Decision IDs.

Until source and policy are proven, keep GMV UNAVAILABLE_NO_SOURCE / PENDING_CA_FIN.

---

## 6. Revenue authority

Determine what source would be required to call an amount CarUp recognized revenue.

Separate possible revenue streams conceptually, without inventing that they currently exist:

- Marketplace transaction/commission fees;
- subscriptions;
- dealer/garage plans;
- Trade/Diaspora fees;
- logistics/container service fees;
- finance referral/origination fees;
- insurance referral/commission income;
- verification/Trust services;
- advertising/promotions;
- other service charges.

For each current source, determine whether it proves:

- quoted fee;
- charged fee;
- payment received;
- earned/recognized revenue;
- refund/reversal;
- nothing sufficient.

Do not infer recognized revenue from payment received alone.

Do not create accounting recognition rules.

---

## 7. Direct cost / gross profit

Determine whether CarUp currently records costs directly attributable to revenue streams.

Potential categories to investigate:

- payment-provider fees;
- messaging/provider fees;
- OCR/AI usage costs;
- logistics/vendor pass-through;
- referral rewards;
- commissions paid;
- verification/provider fees;
- hosting/infrastructure where directly attributable;
- refunds/chargebacks.

Do not classify general operating expenses as COGS/direct cost without authority.

Define the data architecture needed to support:

gross_profit = recognized_revenue - governed_direct_cost

but do not activate that formula until both sides have accepted sources.

---

## 8. Cash / escrow / settlement

Distinguish:

- CarUp cash;
- customer funds;
- escrow funds;
- provider balances;
- pending settlement;
- confirmed settlement;
- sandbox settlement;
- refundable funds;
- cash receipt versus accounting recognition.

Determine whether current sources can answer any of these truthfully.

If no bank/ledger/cash authority exists, state that Corporate cash balance is unavailable.

---

## 9. Receivables / payables / obligations

Identify current records that resemble obligations but do not necessarily constitute accounting receivables/payables.

Examples:
- unpaid subscription invoice;
- seller/buyer obligation;
- trade milestone;
- outstanding settlement;
- referral reward accrued;
- refund due;
- provider payable.

Define what additional authority would be required before Corporate Admin can present accounts receivable or accounts payable.

---

## 10. Finance & Accounting versus Finance/Payments BU

Consume CA-ORG.

Define the hard boundary between:

A. Corporate Finance & Accounting
   - accounting authority;
   - management reporting;
   - cash/treasury;
   - receivables/payables;
   - cost/profit centres;
   - close/reconciliation;
   - executive finance reporting.

B. Finance / Payments product business
   - loan/finance demand;
   - lender integration;
   - SafePay/payment workflow;
   - customer-facing finance products;
   - finance-product commercial performance.

Product demand metrics must never silently become corporate accounting metrics.

---

## 11. Management-accounting dimensions

Consume CA-ORG and define the finance dimensions Corporate Admin will eventually need:

- legal entity when proven;
- BU;
- department;
- cost centre;
- profit centre;
- product/service line;
- geography;
- customer/partner class;
- currency;
- fiscal period;
- transaction/source system;
- live/sandbox environment;
- revenue stream;
- cost category.

Do not assume current product tenants equal cost/profit centres.

---

## 12. Currency / FX

Inspect current currency handling.

Define safe rules:

- source currency always preserved;
- amounts may be grouped by currency;
- no silent cross-currency sum;
- FX conversion requires governed rate source, rate date/time, base/reporting currency and policy;
- historical reports must preserve FX method/version.

If no FX authority exists, consolidated cross-currency totals remain unavailable.

---

## 13. Financial periods

Prepare Owner Decisions for:

- reporting timezone;
- fiscal year;
- month/quarter definition;
- period close;
- partial current period;
- restatement/reopening policy.

Do not assume calendar year or Japan timezone merely from current operations.

---

## 14. Finance access / RBAC

Consume CA-RBAC.

Map finance information classes to conceptual access:

- executive finance summary;
- restricted financial aggregate;
- transaction-level finance detail;
- customer payment details;
- bank/provider account references;
- financial exports;
- accounting configuration;
- approval/reconciliation controls.

Separate aggregate read from line-item access and mutation authority.

Do not design final UI.

---

## 15. Segregation of duties

Define recommended finance governance controls, explicitly marking policy decisions that require Owner approval.

Consider:

- preparer vs approver;
- refund request vs approval;
- settlement initiation vs reconciliation;
- vendor/payee setup vs payment approval;
- accounting adjustment vs report publication;
- finance export access;
- break-glass finance access.

Do not claim a regulatory/legal mandate unless independently proven.

---

## 16. Financial metric candidates

For each candidate below, classify as CERTIFIABLE_FROM_CURRENT_SOURCE, WRAPPABLE, PENDING_SOURCE, or UNAVAILABLE_NO_SOURCE:

- GMV;
- recognized revenue;
- revenue by BU/revenue stream;
- direct cost;
- gross profit;
- gross margin;
- operating expense;
- operating profit;
- net profit;
- cash balance;
- cash receipts;
- escrow held;
- settlement exposure;
- refunds;
- receivables;
- payables;
- outstanding obligations;
- average transaction value;
- take rate;
- revenue per customer;
- contribution margin.

Do not invent values.

Do not activate formulas whose component authorities are missing.

---

## 17. Required source-of-record recommendation

If current sources are insufficient for Corporate finance, define the minimum future finance system-of-record architecture needed.

Consider conceptually:

- finance ledger;
- journal/entry model;
- chart of accounts;
- subledgers;
- source transaction references;
- immutable posting identity;
- reversals rather than destructive edits;
- period/version authority;
- external accounting integration;
- reconciliation;
- bank/payment-provider imports;
- audit trail.

This is architectural recommendation only.

Do not create schema or migrations.

---

## 18. K2B boundary

PC01-K2B-R1 remains active/unaccepted at dispatch.

CA-FIN may identify which finance metrics require operational provenance and must mark them PENDING_K2B.

CA-FIN must not adopt unaccepted K2B implementation details or classify staging rows.

---

## 19. Owner Decision Register

Create OD-CAFIN-* decisions for unresolved policy including at minimum:

- qualifying GMV transaction;
- GMV inclusion/exclusion;
- revenue streams;
- accounting recognition authority;
- direct-cost policy;
- treatment of payment-provider fees;
- treatment of referral rewards;
- escrow accounting presentation;
- settlement exposure definition;
- refund/reversal treatment;
- take-rate definition;
- profit-centre ownership;
- cost-centre ownership;
- fiscal year;
- reporting currency;
- FX source/method;
- period close/restatement;
- cash/treasury authority;
- receivable definition;
- payable definition;
- management versus statutory reporting;
- finance approval/SoD policy;
- financial export authority;
- finance data retention;
- accounting platform/integration decision.

Every decision must state safe default and what must not be assumed.

---

## 20. Required deliverable

Create only:

docs/corporate-admin/CARUP_CORPORATE_FINANCE_MODEL.md

Must include:

1. authority/custody;
2. current finance-source inventory;
3. finance truth taxonomy;
4. GMV authority model;
5. revenue authority model;
6. cost/gross-profit model;
7. cash/escrow/settlement model;
8. receivables/payables model;
9. Finance & Accounting vs Finance/Payments boundary;
10. management-accounting dimensions;
11. currency/FX policy requirements;
12. period/close policy inputs;
13. finance RBAC/SoD inputs;
14. current candidate metric classification;
15. source-of-record gap / future architecture;
16. PENDING_K2B register;
17. Owner Decision Register;
18. downstream inputs for CA-UX, CA-BU, CA-REPORT, CA-CERT;
19. open risks;
20. recommended next task.

---

## 21. Evidence rules

Distinguish:

PROVEN CURRENT FINANCIAL FACT
PROPOSED FINANCE ARCHITECTURE
PENDING_CA_FIN POLICY
PENDING_K2B
OWNER DECISION REQUIRED

Do not label product workflow values as accounting facts.
Do not expose secrets, account credentials or unnecessary PII.

---

## 22. Repository scope

AUTHORIZED MUTATION:
docs/corporate-admin/**

READ-ONLY INSPECTION:
web/**
backend/**
shared/**
database schema/migration history
accepted docs

FORBIDDEN MUTATION:
web/**
backend/**
shared/**
database/**
mobile/**
.github/**
staging database
production
deployments

---

## 23. Stop conditions

STOP rather than guess if:

- accounting recognition requires policy not in evidence;
- transaction completion authority is unclear;
- cash/bank source is absent;
- cross-currency consolidation requires missing FX authority;
- product amounts could be confused with accounting values;
- a conclusion depends on unaccepted K2B;
- legal/tax treatment would have to be invented;
- product/database mutation appears necessary.

---

## 24. Return receipt

AGENT: CA-FIN
TASK: CA-FIN-01
EXACT STARTING AUTHORITIES
EXACT RESULTING AUTHORITY
FILES / SYSTEMS INSPECTED
FILES CHANGED
PROVEN CURRENT FINANCE FACTS
PROPOSED FINANCE AUTHORITY MODEL
PENDING_K2B ITEMS
OWNER DECISIONS REQUIRED
OPEN QUESTIONS
DOWNSTREAM INPUTS
STOP CONDITIONS
RECOMMENDED NEXT AGENT/TASK

Final line exactly:

CA-FIN-01 CORPORATE FINANCE MODEL READY FOR MODERATOR REVIEW

Do not self-accept.