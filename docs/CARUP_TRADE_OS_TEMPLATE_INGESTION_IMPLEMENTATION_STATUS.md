# CarUp Trade OS — Template Ingestion & Scenario Testing Implementation Status

> **Status:** IMPLEMENTED — awaiting alignment review and hardening  
> **Date:** 2026-09-13  
> **Branch:** `feat/trade-os-template-ingestion-scenarios`  
> **Draft PR:** #211  
> **Parent planning lane:** `docs/trade-os-template-ingestion-scenario-testing` / PR #210

## 1. Purpose

This note records the implementation state of the approved Template Ingestion & Scenario Testing architecture. It does not replace the canonical system plan or the detailed architecture plan.

The implementation is intentionally bounded to T5. It does not claim production certification and it does not activate T6 landed-cost/rates, T8 document expansion, T9 yard operations, T11 shipment visibility, T12 customs/transit, T13 financial reconciliation, or T17 commercialization.

## 2. Implemented

### 2.1 Canonical five-template contract

The lower-level workbook schema now agrees with the existing XLSX catalog on all five template families:

- `buyer`
- `seller`
- `supplier`
- `enterprise`
- `container_reservation`

Supplier and container-reservation workbooks no longer fall through to the enterprise schema during shared normalization/validation.

### 2.2 Explicit service scope

`DIASPORA_IMPORT_ORDERS` now supports a governed `SERVICE_SCOPE` value so partial journeys can be represented without pretending every customer buys the vehicle through CarUp.

Initial allowed scopes:

- `FULL_TRADE`
- `VEHICLE_PROCUREMENT`
- `PARTS_PROCUREMENT`
- `SHIPPING_ONLY`
- `CLEARING_ONLY`
- `INLAND_DELIVERY_ONLY`

`SHIPPING_ONLY` requires a concrete vehicle reference at dry-run time.

### 2.3 Validation layers

Workbook findings now identify their layer:

- `STRUCTURAL`
- `DOMAIN`
- `BUSINESS_RULE`

Role-specific workbooks now distinguish an invalid internal reference from a legitimate external Trade OS reference. Example: a supplier quote workbook may reference an RFQ already in Trade OS without embedding the buyer's order row in the supplier file. The role workbook receives a domain warning requiring authoritative server resolution; a combined enterprise/scenario validation remains strict.

### 2.4 Scenario provenance

Existing workbook batch/row metadata now carries, when supplied:

- scenario ID;
- scenario run ID;
- scenario version;
- source type;
- fixture class;
- production-forbidden state.

No database migration was required.

### 2.5 Reference packs

The implementation includes small governed reference packs for:

- scenario-scoped synthetic buyers;
- synthetic Japan→Zimbabwe vehicle references;
- a small legacy-derived Universal Motors parts subset.

Every fixture is labelled by provenance. Legacy-derived records are not represented as current stock, current pricing, live fitment authority, or verified commercial truth.

### 2.6 Golden Scenarios

Implemented:

1. `SCN-ALPHARD-HARARE-001`
   - independent vehicle RFQ;
   - three competing provider quotes;
   - submitted / expired / rejected quote-history facts;
   - JPY and USD source currencies preserved;
   - full-trade scope.

2. `SCN-PARTS-CONTAINER-001`
   - parts procurement request;
   - legacy-derived structural part references;
   - two supplier responses;
   - original-currency quote facts preserved;
   - parts-procurement scope.

3. `SCN-BYO-VEHICLE-SHIPPING-001`
   - customer-owned vehicle;
   - `SHIPPING_ONLY` scope;
   - concrete linked vehicle identifier;
   - no Marketplace vehicle purchase requirement;
   - logistics-provider quote.

### 2.7 Canonical scenario preview pipeline

The scenario runner does not invent a second ingestion stack. For every input it uses:

```text
Scenario workbook facts
→ existing XLSX exporter
→ XLSX bytes
→ existing XLSX parser
→ role-specific dry-run validation
→ combined strict enterprise validation
→ existing workbook row diagnostics
→ existing import planner
→ machine-readable scenario assertions
```

The preview returns `dryRunOnly: true` and `wroteToDatabase: false`.

### 2.8 Production safety

Scenario preview and fixture-workbook generation fail closed when the server environment resolves to production.

The HTTP surface is operator/reviewer scoped and contains only:

- scenario list;
- scenario detail;
- zero-write preview;
- fixture workbook download.

There is deliberately no scenario `seed` or `execute` route and no client-supplied environment override.

## 3. Tests added

Focused backend coverage now checks:

- five-template schema/catalog parity;
- external role-reference warnings vs false rejection;
- shipping-only vehicle-reference requirement;
- reviewer-only preview/download surface has no scenario execution route;
- exactly three T5 Golden Scenarios are registered;
- real XLSX round-trip for each scenario;
- strict combined dry-run;
- zero-write invariant;
- import-plan blocked count;
- machine-readable scenario assertions;
- Alphard competing quote history and JPY preservation;
- BYO shipping-only scope and Marketplace-purchase independence;
- scenario provenance persistence;
- production fail-closed behavior.

CI evidence must be recorded after GitHub Actions completes; this document does not pre-claim green status.

## 4. Explicit non-goals of this implementation

Not implemented here:

- live exchange-rate retrieval;
- quote normalization into USD;
- corridor-rate engine;
- landed-cost calculation;
- customs/tax rule execution;
- RoRo/container freight pricing;
- yard measurement workflow;
- carrier/AIS tracking;
- ASYCUDA integration;
- transit guarantee lifecycle;
- live payment or escrow behavior;
- production fixture seeding.

Those remain owned by their later T-tracks.

## 5. Known hardening questions for the next pass

These should be checked after the initial CI/alignment review rather than silently widening this T5 implementation.

1. **Imported quote lifecycle fidelity.** The existing workbook draft-execution layer intentionally stages quote records as drafts. The scenario source can preserve `SUBMITTED`, `EXPIRED`, and `REJECTED` facts in its validated/audited workbook rows, but the next hardening pass must decide how historical terminal quote states are projected into authoritative RFQ state without creating a workbook bypass around the RFQ service state machine.

2. **Structured parts request lines.** The online RFQ domain already supports multi-line request records, but the current workbook contract still represents the T5 parts fixture primarily through order fields/notes rather than a dedicated request-lines sheet. A later hardening decision should determine whether workbook request lines belong in T5 or a subsequent sourcing-contract expansion.

3. **Authoritative external-reference resolution at import time.** Role-workbook dry-run correctly identifies external references as domain warnings. Confirmed import must continue to resolve those references through tenant/participant/service authorization before any authoritative relationship is created.

4. **Scenario reset execution.** The fixture catalog is isolated and deterministic, but no generic database reset/seed endpoint was added. If staging scenario execution is later authorized, cleanup should be scenario-run scoped and implemented through existing deletion/rollback/governed services rather than raw fixture truncation.

5. **Vehicle ownership authority for BYO execution.** T5 validates that a shipping-only request identifies a vehicle. Actual operational execution must still use the canonical vehicle-object authority before that vehicle is attached to privileged shipment/ownership workflows.

## 6. Next gate

The next process is:

```text
CI evidence
→ owner goal/alignment review
→ architecture/code gap audit
→ hardening fixes
→ Golden Scenario execution/UAT decision
→ certification/freeze decision
```

Until those gates pass, PR #211 remains a draft implementation lane and must not be treated as a production-ready feature.
