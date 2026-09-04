# Trade OS T3 — Logistics RFQ implementation receipt

**Programme authority:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md` §10  
**Branch:** `feat/trade-os-client-demo-convergence`  
**Draft PR:** #207  
**Production:** untouched  
**Status:** implementation in progress; this receipt is evidence, **not a competing plan**.

## Why T3 exists

T2 Request Quotes answers: **“I need to buy/find something.”**

T3 answers a different user intention: **“I already own or bought cargo and need to move it.”**

A logistics request is therefore not stored as a procurement order and is not created as a cargo reservation. A reservation is only created after an actual logistics offer is selected and, for a CarUp shared-container offer, the participant explicitly requests space. That reservation remains `REQUESTED`; the existing organiser-side atomic approval remains authoritative.

## Current implementation cycle

### New authoritative schema

Migration:

`database/migrations/20260905090000_trade_os_logistics_rfq.sql`

Adds:

- `diaspora_logistics_requests`
- `diaspora_logistics_request_items`
- `diaspora_logistics_quotes`
- atomic `diaspora_accept_logistics_quote_atomic(...)`

The request is private while `DRAFT`, market-visible through a safe projection only when `OPEN_FOR_QUOTES`, and becomes `AWARDED` only through the atomic quote-selection RPC.

### Cargo model

Current cargo categories:

- vehicle
- parts
- household / personal effects
- furniture / appliances
- boxes / cartons
- machinery / equipment
- pallet / crate
- general eligible cargo
- other eligible cargo

Per cargo group the model can record:

- plain-language description
- quantity
- L × W × H
- cm / m
- calculated estimated CBM
- provider/customer-supplied estimated CBM
- estimated weight
- `CALCULATED` / `PROVIDED` / `UNKNOWN` measurement basis
- optional governed linked Vehicle VIN
- notes

Unknown measurements remain `NULL`/`UNKNOWN`; they are never replaced with zero.

### Vehicle-link security

`linked_vehicle_vin` is checked server-side with the canonical `resolveVehicleObjectAuthority` before item writes.

The HTTP create/update routes also preflight all linked VINs **before request-header mutation**, so a forged vehicle link cannot leave an orphan request or partially updated route state.

Missing/foreign VINs are non-enumerating at the public boundary.

### Provider eligibility

A logistics provider is a commercial context, not a new global role.

Provider-side opportunity/quote access is derived from:

`user_registration_profiles.business_type = logistics_provider`

plus authenticated tenant context. Platform review roles retain governed oversight.

### Marketplace privacy

Provider discovery returns an explicit allow-list projection. It excludes:

- requester user id
- tenant id
- email / phone
- unrelated CarUp records
- linked vehicle VIN

A provider may see only that a vehicle is linked, not the VIN itself.

Provider draft offers remain private to the provider; requester HTTP reads exclude `DRAFT` logistics quotes.

### Customer experience

New T3 Shipping workspace under the existing Trade OS operational shell:

`/diaspora/containers`

The route now presents three operational modes rather than treating container co-loading as the whole logistics product:

1. **My shipping** — request quotes for cargo already owned/bought;
2. **Provider requests** — visible only for a real logistics-provider commercial profile;
3. **Container space** — the existing hardened Container Co-Loading surface, preserved intact.

Customer wizard:

`Cargo → Size & weight → Route → Review → Publish`

It is intentionally written for non-freight users:

- plain-language cargo categories;
- multiple item groups;
- `Help me calculate it`;
- `I know the total volume`;
- `I don't know yet`;
- explanation of CBM;
- estimates explicitly remain estimates;
- privacy preview before publish.

### Logistics provider experience

Provider workspace supports:

- safe open opportunities;
- requester-private discovery;
- service mode;
- optional real CarUp container sailing;
- freight charge;
- handling;
- origin charges;
- destination charges;
- document fees;
- offer total + currency;
- stated transit time;
- validity;
- pickup included / not included / not provided;
- delivery included / not included / not provided;
- inclusions;
- exclusions;
- conditions;
- draft/edit/submit/withdraw lifecycle;
- explicit **Review offer** before submission.

Unknown fee components stay `Not provided`; the UI does not call a total “all-in” when components are absent.

### Container connection

A logistics provider may attach a CarUp container only when the server proves they coordinate/administer that sailing.

The sailing must be:

- `BOOKING_OPEN`;
- route-compatible by recorded origin/destination country.

Customer-side compatible-sailing discovery uses:

- real open containers;
- actual approved-reservation capacity recomputed by the existing capacity engine;
- route compatibility;
- cargo estimated volume when all item groups have one.

Matching is read-only and always reports that organiser confirmation remains required.

After a shared-container offer is selected:

`Selected logistics offer → Request container space → REQUESTED reservation → organiser reviews → existing atomic approval`

The conversion is idempotent and carries the logistics request/quote references in reservation metadata. It does **not** auto-approve capacity.

### Communications

No logistics-specific chat table was created.

Requester/provider clarification uses canonical CarUp Communications reference-flow infrastructure with a logistics-request subject reference.

### Current test additions

Backend:

`backend/tests/diaspora-logistics-rfq.test.js`

Pins:

- safe marketplace projection;
- logistics-provider eligibility;
- cross-tenant discovery;
- deterministic CBM calculation;
- unknown measurement truth;
- foreign/own VIN authorization;
- foreign/own container authority;
- no reservation on mere quote submission;
- route + recomputed-capacity sailing matching;
- matching remains read-only.

Web mocked comprehension:

`web/e2e/trade-shipping-rfq.spec.ts`

Pins:

- layman shipping-request entry;
- unknown-size path;
- guided dimensions;
- privacy/review messaging;
- provider opportunity workspace;
- transparent charge composer;
- review-before-submit;
- provider-safe opportunity display.

## Known work still required before T3 closure

The following are deliberately **not yet certified complete**:

- final update of the T2 `Ship something` handoff copy so it no longer says multi-provider logistics RFQ is unavailable;
- customer UI selector for an existing CarUp vehicle on vehicle cargo (backend authority already exists);
- quote lifecycle notifications/events beyond the canonical direct conversation entry;
- full T3 deployed staging migration + exact-head real buyer/provider/container journey;
- desktop/narrow-desktop/tablet/mobile visual/geometry review;
- final CI result on the exact candidate;
- master-plan checkbox/evidence reconciliation after the T3 slice reaches a stable candidate.

Do not call T3 usable/client-ready/production-ready until these are resolved or explicitly reclassified in the canonical master plan.
