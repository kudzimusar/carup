# T11-CAP-LR01-R2 — CARUP CAP 1.0 PRODUCT AUTHORITY

## DATABASE-BACKED REAL CUSTOMER JOURNEY CONVERGENCE

**Repository:** `kudzimusar/carup`  
**Programme:** `CARUP CAP 1.0 / Trade OS Journey & Arrival`  
**Parent unit:** `T11-CAP-LR01-R1`  
**Product PR:** `#243`  
**Product branch:** `feat/trade-os-t11-cap-lr01-journey-arrival`  
**Frozen R1 product head at R2 dispatch:** `304607ea4093af09b8a8cb5fe3223a64f0e7a545`  
**Frozen Trade OS parent:** `577428decfea6beb98e88aa8132a8a8419e3349e`  
**Authorized staging Supabase:** `eoyenigwevnxwwhyhaer`  
**Production Supabase:** `vhmnajoeicasaigiophh` — **FORBIDDEN**

---

# 1. CONTROLLING OWNER INTENT

CarUp is building its own customer-facing Car Arrival Progress capability because CarUp intends to operate its own vehicle yard and shipment-processing operation in Japan and coordinate vehicle movements for its own customers.

The finished product is not a BE FORWARD integration.

It is not a BE FORWARD clone.

It is not a demo.

It is not a temporary evidence viewer.

It is not a Vezel-specific application.

It is the first implementation of the permanent **CarUp CAP** product.

A CarUp customer must ultimately be able to open the CarUp application and follow their real vehicle through the complete journey from acquisition and Japan-side handling to international shipment, destination handling, customs/clearing and final collection or delivery.

The current real 2018 Honda Vezel transaction is the first complete real-world proof of this product.

---

# 2. REAL CUSTOMER JOURNEY — NOT DEMO DATA

Vehicle:

`RU3-1316558`

Canonical staging owner:

`u_66cace85fad949e4`

This is a real vehicle associated with a real CarUp user account.

The information used to reconstruct its historical journey is real information obtained from an Owner-authorized external transaction/account.

Therefore:

- do not describe the Vezel journey as demo data;
- do not create fake journey records for presentation;
- do not create mock timestamps;
- do not invent shipment movements;
- do not invent payments;
- do not invent customs decisions;
- do not invent customer conversations;
- do not create synthetic photographs or documents;
- do not substitute a fabricated VIN for the legitimate Japanese frame/chassis identifier.

Every material record used in final certification must represent a real vehicle, real customer, real document, real photograph, real reported historical event, real shipment fact or genuine CarUp operational record.

---

# 3. AUTHORIZED EXTERNAL RECORD INGESTION RULE

Where CarUp or the Owner has authorized access to records from an external provider/account relating to its own transaction, CarUp may ingest those authorized records into CarUp.

Eligible source records may include, where lawfully and legitimately available:

- vehicle identity;
- vehicle specifications;
- photographs;
- invoices;
- export certificates;
- bills of lading;
- shipping details;
- carrier details;
- vessel details;
- ETD and ETA;
- customer progress stages;
- document dispatch information;
- consignee information;
- notify-party information;
- clearing/delivery information;
- other transaction records legitimately belonging to the authorized account.

The imported records must retain appropriate provenance.

At minimum, provenance must be sufficient to answer:

- what source supplied the fact;
- what external transaction/reference it related to;
- when CarUp observed/imported it;
- what evidence supports it;
- whether the fact was observed, reported, verified, pending review or unknown.

External-source provenance must not be confused with CarUp-originated operational authority.

---

# 4. NO BE FORWARD RUNTIME DEPENDENCY

BE FORWARD is a historical evidence source for the current Vezel transaction.

BE FORWARD must not become a runtime dependency of CarUp CAP.

The finished CarUp CAP must not require:

- the BE FORWARD CAP capability URL;
- a BE FORWARD login/session;
- the CAP access token;
- runtime scraping of the BE FORWARD website;
- a BE FORWARD API;
- hot-linked BE FORWARD images;
- permanent BE FORWARD document URLs;
- BE FORWARD JavaScript;
- BE FORWARD's status engine;
- BE FORWARD customer authentication;
- availability of the original CAP page.

After governed ingestion, CarUp must serve and operate its own records.

A mandatory acceptance condition is:

> The CarUp CAP must remain operational if the original external CAP becomes unavailable.

The CAP access token must never be committed, logged, exposed to the frontend, stored as application data or used as a continuing application credential.

---

# 5. ONE CAP PRODUCT — HISTORICAL NOW, CARUP-NATIVE LATER

There must not be one CAP architecture for imported historical records and another CAP architecture for future CarUp shipments.

There is one CarUp CAP product.

Current historical path:

`authorized external records → governed CarUp ingestion → canonical CarUp authorities → CarUp CAP`

Future native path:

`CarUp Japan yard / Trade OS / logistics operations → canonical CarUp authorities → same CarUp CAP`

The origin of an event may differ.

The customer product must not.

Historical provenance belongs in backend governance.

The customer should experience one coherent CarUp journey.

---

# 6. DATABASE-FIRST PRODUCT RULE

The central objective of R2 is not merely to redesign `JourneyArrival.tsx`.

The central objective is to ensure the CarUp database and domain authorities can truthfully represent the complete customer CAP.

The CAP interface is a projection/read model.

It must not become an independent business authority.

The correct order is:

`real facts → canonical authorities → CAP compositor → customer interface`

Never:

`desired screen → hardcoded facts → apparent journey`

UI code must not manufacture business state.

---

# 7. EXISTING AUTHORITIES MUST BE REUSED

R2 must first independently inspect the current repository and classify each capability as:

`REUSE`

`EXTEND`

or

`NEW`

Do not recreate existing authorities.

Existing systems expected to remain authoritative include, where applicable:

**Vehicle / identity**
- canonical `vehicles`;
- Vehicle Passport;
- vehicle ownership;
- vehicle evidence;
- canonical media/listing media.

**T4 — transaction/import order**
- `diaspora_import_orders`;
- order participants;
- order workflow;
- payment milestones;
- consignee/destination fields.

**T7 — communications**
- message threads;
- messages;
- notifications;
- subject association.

**T8 — documents**
- `diaspora_trade_documents`;
- document workspace;
- document verification;
- private storage;
- governed document access.

**T11 — shipment and tracking**
- `diaspora_shipments`;
- shipment stage events;
- shipment legs;
- shipment observations;
- shipment tracking;
- journey association.

**T12 — customs/destination operations**
- customs cases;
- clearing-agent appointments;
- customs events;
- destination/collection/delivery observations.

Do not create CAP-specific replacements for these systems.

---

# 8. REQUIRED PRE-IMPLEMENTATION AUTHORITY MATRIX

Before product mutation beyond this authority document, produce a matrix covering at minimum:

| CAP capability | Current authority | REUSE / EXTEND / NEW | Evidence | Proposed action |
|---|---|---|---|---|
| Vehicle identity | | | | |
| Vehicle specifications | | | | |
| Vehicle media | | | | |
| Import/purchase transaction | | | | |
| Consignee | | | | |
| Notify party | | | | |
| Document delivery | | | | |
| Booking | | | | |
| Customer progress | | | | |
| Shipment | | | | |
| Carrier | | | | |
| Vessel | | | | |
| Loading port | | | | |
| ETD | | | | |
| Discharge port | | | | |
| ETA | | | | |
| Observed movement | | | | |
| Bill of Lading | | | | |
| Export Certificate | | | | |
| Invoice | | | | |
| Document dispatch | | | | |
| Document tracking | | | | |
| Clearing | | | | |
| Customs | | | | |
| Collection | | | | |
| Delivery | | | | |
| Payment | | | | |
| Messages | | | | |
| Notifications | | | | |

Do not replace this matrix with assumptions.

If an existing authority can represent the fact truthfully, reuse it.

Create new persistence only for genuinely missing semantics.

---

# 9. HISTORICAL CUSTOMER-PROGRESS LEDGER

CAP-00 has already established that the authorized historical transaction contains:

- 5 progress groups;
- 14 action rows;
- every row reported as `Completed`;
- actor/action-taker attribution;
- action descriptions;
- no per-row completion date/time.

The groups are:

| Group | Rows |
|---|---:|
| Booking | 7 |
| Departure | 1 |
| B/L | 3 |
| Dispatch | 1 |
| Clearing & Delivery | 2 |
| **Total** | **14** |

This evidence already exists.

R2 must not restart external reverse engineering merely to rediscover these facts.

The historical record must be ingested into CarUp as real historical customer progress with source provenance.

---

# 10. EXTERNAL HISTORICAL PROGRESS MUST NOT CORRUPT T11

The existing `diaspora_shipment_stage_events` authority represents shipment/movement state.

Historical customer-progress actions are broader than shipment movement.

Examples include:

- document upload;
- customer B/L proofreading;
- feedback processing;
- document dispatch;
- originals received;
- delivery-service cancellation/document collection.

These are not all shipment movements.

Therefore do not force all 14 historical actions into T11 movement events merely to make the CAP appear complete.

If no existing authority can truthfully represent the complete historical progress ledger, add a narrowly scoped additive historical/external-progress representation.

The representation must support at minimum:

- import-order association;
- vehicle association where appropriate;
- shipment association where appropriate;
- group/stage;
- deterministic sequence;
- action sequence;
- action taker;
- action text;
- reported status;
- optional event timestamp;
- source system;
- source reference;
- evidence/provenance reference;
- source observation/import time;
- review/verification classification where appropriate.

For the currently proven 14 CAP rows:

`reported_status = COMPLETED`

The completion timestamp must be:

`NULL`

unless separately established by authoritative evidence.

---

# 11. COMPLETED DOES NOT REQUIRE A FABRICATED TIMESTAMP

The source proves that the historical workflow actions were completed.

The source does not provide a completion timestamp for those rows.

Therefore CarUp must be capable of representing:

`Completed`

with:

`completion timestamp unknown / not supplied by source`.

Do not convert the database record creation time into the historical event time.

Do not invent a time.

Do not downgrade a proven Completed state to Planned merely because the completion date is unknown.

---

# 12. SHIPPING TRUTH MUST REMAIN STRICT

Preserve the following distinctions:

`planned departure ≠ observed departure`

`ETA ≠ actual arrival`

`loading confirmed ≠ vessel sailed`

`customer-progress stage completion ≠ CarUp-observed physical movement`

`external historical report ≠ CarUp physical observation`

It is valid for the CAP to state:

`Departure — Completed`

with provenance from the historical transaction while separately stating:

`Observed departure timestamp — Not recorded`

if that is the evidence state.

These statements are not contradictory.

---

# 13. REAL VEZEL DATA CONVERGENCE

The current Vezel is intentionally under-populated.

R2 must converge its real, source-backed data into the appropriate canonical CarUp representation.

Known authorized information includes at least:

- Make: Honda
- Model: Vezel
- Year: 2018
- Grade: HYBRID Z HONDA SENSING
- Model code: DAA-RU3
- Frame/chassis: RU3-1316558
- Engine number: LEB6736579
- Mileage: 134,741 km
- Registration: 2018/12
- Manufacture: 2018/6
- Engine size: 1490 cc
- Drive: 2WD
- Exterior colour: Pearl
- Steering: Right
- Transmission: Automatic
- Fuel: Hybrid/Petrol
- Seats: 5
- Doors: 5
- External reference: CD740269

Where the canonical vehicle schema already holds the fact, use it.

Where an existing governed supplemental authority holds the fact, use it.

Where a genuinely necessary known vehicle attribute has no appropriate representation, propose the narrowest additive governed representation.

Do not hardcode missing vehicle specifications in React.

---

# 14. PRICE TRUTH

The existing `vehicles.price = 0` value is a schema/convention placeholder for an unlisted vehicle.

It is not proven historical purchase price.

The customer CAP must not present `$0` as the actual purchase price.

If no real purchase price is available from authorized evidence, show an honest state such as:

`Not recorded`

or equivalent.

Do not manufacture a currency or amount.

---

# 15. CANONICAL MEDIA CONVERGENCE

The Vezel currently has 50 real imported photographs in `vehicle_evidence`.

They are:

- real;
- tied to the Vezel;
- owner-authorized;
- private;
- pending review.

The Vezel currently has no canonical `listing_images` records.

This is why Evidence & Media can show the photographs while My Garage and Vehicle Passport cannot.

R2 must converge those real existing images into canonical vehicle presentation/media without destroying their evidence lineage.

Target:

`existing governed image assets → canonical vehicle media references → My Garage → Vehicle Passport → Seller workspace → CarUp CAP`

Avoid unnecessary binary duplication.

Preserve provenance/evidence linkage.

`Pending Review` controls verification/publication truth.

It must not make the authenticated owner unable to see their own vehicle photographs.

`Private` means not publicly published.

It does not mean invisible to the authorized owner.

---

# 16. JAPANESE FRAME / CHASSIS IDENTIFIERS

The current seller/listing flow has a 12-character identifier floor.

The legitimate vehicle identifier:

`RU3-1316558`

contains 11 characters.

CarUp must not fabricate, pad or transform it into a false VIN.

R2 is authorized to remediate this validation defect narrowly because it directly blocks the real Vezel's canonical seller/media workflow.

The remediation must distinguish legitimate Japanese frame/chassis identifiers from VIN validation where VIN-specific semantics apply.

Do not simply reduce every VIN validator to an unsafe generic minimum.

Add regression coverage for:

- legitimate Japanese frame/chassis identifiers;
- normal VIN validation;
- malformed/unsafe identifiers;
- existing Serena behavior.

---

# 17. DOCUMENT AUTHORITY

Reuse T8.

The Vezel already has real CarUp records for:

- Bill of Lading;
- Commercial Invoice;
- Export Certificate.

Do not create duplicate CAP document rows.

The customer CAP must compose these real T8 documents.

Where the customer is authorized, provide a governed document view/download action using CarUp-controlled private storage and short-lived access.

Do not expose raw storage paths.

Do not depend on external historical document URLs.

Document presence must not be presented as CarUp verification unless verification actually occurred.

---

# 18. CONSIGNEE / NOTIFY PARTY / DOCUMENT DELIVERY

Use existing governed transaction/customer fields where they correctly fit.

Import authorized historical details where appropriate and permitted.

Sensitive personal information must remain protected.

The authenticated owner may see the relevant private transaction information.

A future shared/public view must not expose private addresses, telephone numbers, email addresses or other PII without explicit authorization.

Do not store the external CAP capability token as provenance.

---

# 19. SHIPPING INFORMATION

Reuse T11 shipment and shipment-leg authorities.

The currently established Vezel shipment information includes:

- Carrier: Hoegh Autoliners K.K.
- Vessel: HOEGH TRACER (V-61)
- Port of loading: Shimonoseki, Japan
- ETD: 29-Aug-2026
- Port of discharge: Dar es Salaam
- ETA: 18-Sep-2026

Preserve date semantics.

Do not manufacture:

- actual departure date;
- actual arrival date;
- IMO;
- MMSI;
- voyage number;
- transshipment;
- container number for this RoRo transaction.

---

# 20. CUSTOMS / CLEARING / DELIVERY

Reuse T12 for CarUp customs/destination authority.

Do not fabricate a T12 customs case merely to mirror the historical CAP.

Historical external progress may truthfully say:

`Clearing & Delivery — Completed`

where that is what the authorized source reported.

That must remain distinguishable from:

- a CarUp-observed customs event;
- an appointed CarUp clearing agent;
- a ZIMRA decision;
- a CarUp-observed destination arrival;
- a CarUp-observed collection;
- a CarUp-observed delivery.

The CAP can display historical reported progress and CarUp-native customs authority together, clearly attributed.

---

# 21. PAYMENT AUTHORITY

Reuse existing payment milestone authorities.

Do not manufacture payment records to fill the CAP.

Where no real payment record exists, render an honest unrecorded/unavailable state.

Do not infer payment from document presence, vehicle ownership or price placeholders.

---

# 22. COMMUNICATIONS AUTHORITY

Reuse T7.

Do not create a second CAP messaging system.

Where real vehicle/order/shipment-linked threads or notifications exist, compose them.

Where none exist, do not invent historical messages.

Future CarUp-native shipment events should be capable of producing subject-linked customer notifications through the existing communication infrastructure.

---

# 23. CUSTOMER CAP INFORMATION ORDER

The final CarUp customer page should follow this core information order:

## 23.1 Important update

Current meaningful customer update or document-tracking information where a real record exists.

## 23.2 Purchased Vehicle

Show:

- hero photograph;
- gallery;
- vehicle identity;
- complete known specifications;
- relevant reference.

## 23.3 Consignee / Notify Party

Show appropriate governed transaction-party information.

## 23.4 Document Delivery / Tracking

Show real document-dispatch/tracking information where available.

## 23.5 Shipping Information

Show:

- carrier;
- vessel;
- loading port;
- ETD;
- discharge port;
- ETA;
- later observed movement facts where real evidence exists.

## 23.6 Documents

Show real:

- B/L;
- Export Certificate;
- Invoice;
- appropriate authorized actions.

## 23.7 Destination / Delivery / Agent

Show real governed destination/agent information where available.

## 23.8 Progress

Show:

- Booking;
- Departure;
- B/L;
- Dispatch;
- Clearing & Delivery;

with the real action rows under each group.

CarUp may add stronger provenance, alerts, trust, passport, customs and operational capabilities.

Do not destroy this core customer flow.

---

# 24. CUSTOMER EXPERIENCE RULE

The customer-facing experience is a native CarUp journey.

Do not label the Vezel CAP:

- demo;
- mock;
- simulation;
- external clone;
- test shipment.

The customer is following their real vehicle in CarUp.

Backend provenance must remain intact and auditable.

Do not erase source attribution from the database merely to make the page look native.

Provenance and customer presentation are separate concerns.

---

# 25. R1 CAPABILITIES THAT MUST NOT REGRESS

Preserve:

- D2 order/shipment association;
- sharing a container is not shipment association;
- multiple shipments fail closed;
- multiple orders are never guessed;
- generic vehicle Journey resolution;
- order authorization;
- unrelated-user isolation;
- Serena isolation;
- declared vessel legs;
- ETA history semantics;
- T8 least privilege;
- T12 least privilege;
- provenance;
- exact-head custody;
- no Production access.

Do not weaken these controls to obtain visual parity.

---

# 26. AUTH-05 / PHYSICAL UAT RUNTIME RULING

A backend built directly from the frozen Trade OS base cannot authenticate against the current staging session authority.

Therefore R2 may use a runtime-compatible integration candidate for physical UAT.

This is permitted only under the following rules:

1. PR #243 remains the product authority.
2. The integration candidate is a runtime vehicle, not replacement product authority.
3. The candidate must cleanly include the exact R2 product candidate.
4. Relevant product files must be proven byte-identical or the ancestry/diff must independently prove exact inclusion.
5. Runtime-only compatibility changes must remain separately attributable.
6. Physical UAT evidence must identify both:
   - exact product SHA;
   - exact deployed integration SHA.
7. No unrelated integration change may silently become accepted R2 product scope.

Canonical staging deployment must not be mutated merely for convenience unless separately authorized.

An isolated paired preview connected to authorized staging is preferred.

---

# 27. INHERITED PR #243 CI FAILURES

At R2 dispatch, PR #243 has inherited CI red states relating to:

- an expired T3 date fixture;
- `UNGOVERNED_BRANCH`.

These are not presumed R2 product defects.

Do not change unrelated T3 product behavior merely to make PR CI green.

Do not weaken branch-governance controls.

R2 must nevertheless execute its relevant exact-head:

- backend tests;
- frontend tests;
- type checks;
- builds;
- migration tests;
- authority regression tests;
- D2 tests;
- privacy/security tests;
- media tests;
- historical-progress tests.

Inherited failures must be clearly separated from new R2 failures.

If new evidence proves R2 caused an aggregate failure, treat it as R2.

---

# 28. STAGING ONLY

Authorized staging project:

`eoyenigwevnxwwhyhaer`

Forbidden production project:

`vhmnajoeicasaigiophh`

Production must not be accessed or mutated.

Historical backfill/import operations must be:

- staging-only;
- idempotent;
- non-destructive;
- conflict-detecting;
- provenance-carrying;
- independently verifiable;
- rollback/recovery documented.

Do not silently overwrite an existing contradictory fact.

Stop on conflict and report it.

---

# 29. IMPLEMENTATION ORDER — MANDATORY

Execute R2 in this order:

## A. Exact-head custody

Reverify PR #243, parent, working tree and this controlling authority.

## B. Authority inventory

Produce the REUSE / EXTEND / NEW matrix.

## C. Database-model closure

Identify and implement only genuinely missing semantics, particularly historical customer progress if independently confirmed absent.

## D. Historical real-data ingestion

Import the authorized real progress records with provenance.

## E. Canonical Vezel convergence

Complete source-backed vehicle/customer/transaction information.

## F. Canonical media convergence

Link/promote the real 50 photographs into canonical vehicle media.

## G. Journey compositor convergence

Extend the existing read-only Journey projection.

Do not create a competing Journey service.

## H. Document customer actions

Expose authorized T8 document view/download where required.

## I. Customer CAP UI

Only after C–H are proven, converge the customer interface.

## J. Responsive/accessibility convergence

Validate phone, tablet and desktop.

## K. Regression certification

Protect Serena, unrelated users, D2 and existing authorities.

## L. Exact-head deployment

Deploy an exact, proven product/runtime candidate.

## M. Physical Owner UAT

Use the actual authenticated customer and real Vezel.

Do not skip ahead to UI implementation.

---

# 30. FORBIDDEN SHORTCUTS

R2 must not:

- hardcode `RU3-1316558` into general product behavior;
- create a Vezel-specific endpoint;
- use mock Vezel data for final certification;
- create synthetic CAP completion rows;
- fabricate timestamps;
- use record `created_at` as historical event time;
- convert historical progress into false movement state;
- mark ETA as actual arrival;
- mark loading as sailing;
- create fake customs decisions;
- create fake payment history;
- create fake communication threads;
- expose the CAP token;
- hot-link external images;
- depend on the external CAP at runtime;
- create duplicate T8 documents;
- create parallel customs/payment/message authorities;
- weaken authorization;
- weaken D2;
- weaken tests;
- copy BE FORWARD proprietary source code or branding;
- manufacture screenshots or success evidence;
- mutate Production;
- merge PR #243 without explicit Owner authority.

---

# 31. REQUIRED PHYSICAL UAT

Final certification must prove, using the real customer account:

### Vehicle and media

- Vezel appears in My Garage with a real photograph.
- Vehicle Passport shows real Vezel media.
- Canonical owner/seller tooling can use governed Vezel media where lifecycle authority allows.
- CAP page displays the real vehicle gallery.
- The owner can access the imported photographs.
- Public users cannot access private media without authority.

### Vehicle data

- source-backed known specifications are visible;
- no fabricated specification appears;
- `$0` is not represented as actual purchase price;
- legitimate frame/chassis identity is accepted without fabrication.

### Historical progress

- all 5 groups appear;
- all 14 proven action rows appear;
- every proven row displays Completed;
- action takers remain accurate;
- no invented completion timestamp appears;
- source provenance is retained in backend records.

### Shipping

- carrier is correct;
- vessel is correct;
- loading port is correct;
- ETD is correct;
- discharge port is correct;
- ETA is correct;
- unknown actual movement dates remain unknown.

### Documents

- B/L is visible;
- Export Certificate is visible;
- Invoice is visible;
- authorized customer view/download works;
- private storage implementation is not exposed.

### Privacy

- sensitive consignee/contact information is appropriately protected;
- unrelated users cannot access the journey;
- CAP source secrets are absent.

### Regression

- Serena remains isolated and truthful;
- Vezel data does not leak into Serena;
- multiple-order ambiguity remains fail-closed;
- D2 remains intact.

### Responsive behavior

Validate at minimum:

- 390 px;
- 768 px;
- 1280 px;
- 1920 px.

No material horizontal overflow or inaccessible core information.

---

# 32. FUTURE CARUP-NATIVE OPERATION PROOF

R2 is not complete if it works only for imported BE FORWARD history.

The specialist must explain and prove through architecture/tests how the same CAP will work when CarUp itself generates the records.

Future expected native journey:

`vehicle acquisition`

→ `CarUp Japan yard intake`

→ `yard inspection / preparation`

→ `shipping booking`

→ `vessel allocation`

→ `vehicle loading`

→ `departure`

→ `document generation`

→ `international transit`

→ `arrival`

→ `customs / clearing`

→ `collection / final delivery`

The same CarUp CAP must consume those CarUp-native records.

There must not be a future rewrite merely because the origin changes from imported historical evidence to CarUp operations.

---

# 33. SPECIALIST EVIDENCE RETURN

Return a complete packet containing:

- exact starting product SHA;
- exact final product SHA;
- exact deployed runtime SHA where different;
- product/runtime ancestry proof;
- branch;
- PR state;
- commit sequence;
- changed-file list;
- migration list;
- REUSE / EXTEND / NEW authority matrix;
- database-model explanation;
- historical-ingestion receipt;
- provenance proof;
- idempotency proof;
- conflict behavior;
- Vezel data-convergence proof;
- media-convergence proof;
- Serena before/after proof;
- backend test results;
- frontend test results;
- build/type-check results;
- database/migration tests;
- D2 regression tests;
- authorization/privacy tests;
- exact-head deployment provenance;
- physical UAT evidence;
- external-runtime-independence proof;
- inherited-vs-new CI classification;
- remaining limitations;
- explicit statement that Production was not accessed.

Do not self-accept.

The specialist may end only with:

`RECOMMEND ACCEPT`

or

`RECOMMEND REMEDIATE`

or

`RECOMMEND BLOCK`

The Moderator retains final acceptance authority.

---

# 34. SUCCESS CONDITION

R2 succeeds when CarUp has a real database-backed CAP product where the actual Vezel customer can open one CarUp page and follow their real vehicle through the complete known historical journey, using CarUp-held data and documents, while preserving truthful provenance and without depending on BE FORWARD at runtime.

The same product and database architecture must be capable of serving future CarUp customers whose journeys originate directly from CarUp's own Japan yard and shipment operations.

That is the controlling product objective.
