# Trade OS T3 — Logistics RFQ implementation receipt

- **Programme authority:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md` §10
- **Branch:** `feat/trade-os-client-demo-convergence`
- **Draft PR:** #207
- **Production:** untouched
- **Status:** T3-PARTIAL at head `afa80e35` — everything provable without a deployed environment
  is proven; nothing on staging has been run. This receipt is evidence, **not a competing plan**.

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

## Stabilization and completion cycle — head `afa80e35`

The three receipt gaps below are now **closed**, and two real defects were found while stabilizing
the previous head. The canonical record is the execution entry
"2026-09-05 · T3 stabilization and completion cycle" in the master plan §30; this section is the
short form.

### Closed since `f6c10e9b`

- **T2 → T3 handoff.** `Ship something` no longer claims multi-provider logistics quotation is
  unavailable. It leads with *Ask providers to quote → Create a shipping request*, keeps
  *Find container space* as the direct second route, and never shows internal RFQ terminology.
- **CarUp vehicle identity reuse.** A vehicle cargo group offers the requester's own vehicles from
  `/api/vehicles/me` — a strict subset of what `resolveVehicleObjectAuthority` permits, so the
  picker can never offer a vehicle the server would refuse. Not-read, genuinely-empty and
  read-FAILED stay three distinct states, and a failed read never blocks manual capture.
- **Lifecycle notifications.** Decided for T3 rather than deferred: three outbox events on the
  existing Communications authority (`quote_submitted` / `quote_accepted` / `quote_not_selected`),
  no new notification store or chat authority. DRAFT emits nothing, WITHDRAWN is never told it
  lost, and an idempotent acceptance replay re-notifies nobody.

### Defects found and fixed

- The logistics provider could never land on `Provider requests`: the tab was seeded from
  `useState` before the shell had fetched the trade context, so `isProvider` was always false at
  seed time. The tab is now derived during render and lives in the URL.
- Wrapping `/diaspora/containers` in the Shipping workspace bypassed the container product's own
  access-denied gate, giving an unauthorized role a working shipping surface. The workspace is now
  gated on the canonical Feature Registry rule.
- A 393px horizontal overflow in the offer composer (a `w-24` appended to a class string already
  carrying `w-full`, which narrows nothing).

### Verified at this head

`tsc` clean · lint gate `NET_NEW_ERRORS=0` · backend 41/41 across the T3, T3-adversarial and
container-auth suites · communications coverage 9/9 · browser 48/48 across
`trade-shipping-rfq` (7), `diaspora-container-marketplace` (16) and `trade-request-quotes` (25).
Adversarial matrix and seven-viewport geometry both proven — see §30 for the itemized list.

## Known work still required before T3 closure

The following are deliberately **not yet certified complete**:

- full T3 deployed staging migration (`20260905090000_trade_os_logistics_rfq.sql` is unapplied);
- staging backend and frontend provenance on one exact candidate;
- the exact-head unmocked requester → provider → offer → award → container-space journey;
- final CI result on the exact candidate;
- owner visual/product UAT, which automation cannot replace.

**T3 is T3-PARTIAL.** Do not call it usable/client-ready/production-ready until the staging and
owner-UAT rows in the master plan's T3 acceptance ledger are satisfied.
