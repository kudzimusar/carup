# S0 — Vehicle Taxonomy & Seller Contract Foundation

**Programme:** Seller Journey 1.0  
**Phase:** S0 — PREREQUISITE  
**Status:** IN PROGRESS — contract/audit work active; runtime source changes intentionally blocked by current lane ownership  
**Programme manual:** `docs/seller/SELLER_JOURNEY_1_0_CANONICAL_PLAN.md`  
**Seller runtime audit anchor:** PR #182 exact head `0d6df68f5003e209269f19cca54ead85cdab0748`  
**Latest checked PR #182 head:** `9508f0fe48ed344610d25e727311233afedaa2bb`  
**Canonical main at phase start:** `ba208963d863654157335189c60f587cbe330041`  
**Created:** 2026-08-28

---

## 1. S0 objective

S0 establishes CarUp's **global governed vehicle language** and one complete Seller data contract before Seller Journey 1.0 expands runtime UX. Seller Journey is the initiating programme; the resulting taxonomy is a platform-owned contract for all CarUp products.

Canonical global taxonomy authority: `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md`

Canonical schema/vocabulary contract: `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_SCHEMA.md`

The S0 production invariants are:

> A value accepted from Sell must have a canonical destination, known authority/provenance, and a deliberate projection policy across Marketplace, Home, Verify/Passport, Communications and Intelligence.
>
> A taxonomy value defined or resolved in S0 must be globally reusable by Buy/Marketplace, Home, Verify/Passport, Intelligence, Imports/Diaspora, mobile, backend services, APIs and future CarUp surfaces without local reimplementation.

S0 does not attempt to hard-code every vehicle ever manufactured. It creates an **extensible exhaustive system** with a high-quality Zimbabwe/JDM/SADC seed, explicit unknown handling, aliases, versioning and review governance. Global does not mean every surface shows every value; it means every surface derives its task-appropriate subset from the same canonical contract.

---

## 2. Live-head drift captured during S0

While this S0 document was being created, PR #182 advanced by seven commits from `0d6df68f5003e209269f19cca54ead85cdab0748` to `be38e48c447ad19a4b50cddd29c8747e5da80811`.

The intervening commits are visual/communicative Home and Marketplace work. They do not modify `GuestSell.tsx`, `SellVehicle.tsx` or `vehicleTaxonomy.ts`; `Marketplace.tsx` did move.

The S0-critical contracts were immediately re-read at `be38e48c…` and the following baseline facts remain unchanged:

- taxonomy version `carup-vehicle-taxonomy-1.0.0`;
- 43 makes / 212 model entries;
- Guest Sell fuel values still include Plug-in Hybrid and Other;
- Marketplace direct fuel filter still omits them;
- Guest Sell transmission still includes CVT and Other;
- Marketplace direct transmission still omits them;
- Guest Sell year validation remains 1900 through current year + 1;
- authenticated Sell remains a 60-year generated list and still defaults year to 2020;
- Marketplace year generation remains a separate policy.

This drift capture is intentional. Future phases must repeat the same exact-head reconciliation rather than relying on this snapshot.

---

## 3. Current lane decision

S0 runtime source work MUST NOT start from `main` today.

PR #182 currently owns:

- `web/src/data/vehicleTaxonomy.ts`;
- `web/src/pages/GuestSell.tsx`;
- `web/src/pages/dashboard/owner/SellVehicle.tsx`;
- Marketplace filter contracts;
- Marketplace listing/public presentation;
- Home;
- Verify;
- Vehicle Detail.

PR #183 owns Communications implementation.

PR #185 owns Intelligence implementation.

Repository policy freezes a maximum of two active source-write PRs. Therefore this phase is currently limited to **audit, canonical contract design, field mapping, test design and merge sequencing**. This is intentional compliance with the programme rules, not a pause in S0.

Runtime implementation may begin only after exact-head lane reconciliation establishes an allowed write lane and a canonical base that includes or explicitly reconciles #182.

---

## 4. Current taxonomy inventory at PR #182

The current file declares:

`VEHICLE_TAXONOMY_VERSION = 'carup-vehicle-taxonomy-1.0.0'`

It explicitly describes itself as a **discovery/listing vocabulary, not a globally exhaustive taxonomy**.

Measured at #182 exact head:

- **43 makes**
- **212 model entries**
- make aliases supported;
- model aliases supported;
- body-style hints per model supported;
- canonical make normalization supported;
- canonical model normalization supported;
- taxonomy search terms supported.

The current seed is useful and should be preserved as a starting asset.

It already contains Zimbabwe-relevant and regional/JDM naming examples such as:

- Toyota Aqua / Prius C;
- Toyota Vitz / Yaris;
- Honda Fit / Jazz;
- Honda Vezel / HR-V;
- Mazda Demio / Mazda2;
- Mazda Axela / Mazda3;
- Mitsubishi Triton / L200;
- GWM / Great Wall;
- Mitsubishi Fuso;
- UD Trucks / Nissan Diesel.

However, it does **not** yet model:

- generation;
- variant/trim;
- model-year validity;
- market/region availability;
- engine family;
- drivetrain taxonomy;
- powertrain detail beyond broad fuel;
- canonical seller-stated condition;
- taxonomy provenance/review state;
- deprecated/renamed taxons;
- vehicle-model lifecycle dates.

---

## 5. Confirmed S0 contract defects

### S0-P0-01 — Year vocabulary is inconsistent across Seller and Marketplace

At the 2026-08-28 reference date:

- Guest Sell accepts years from **1900 through 2027** by validation.
- Authenticated Sell generates **60 values**, **2027 through 1968**.
- Marketplace generates **2027 through 1961**.

Therefore a valid guest-entered year may not be selectable in authenticated Sell, and an authenticated/guest year contract is not identical to Marketplace discovery.

Further, none of these year lists prove that a selected model actually existed in that model year.

**Required resolution:** one shared year policy plus optional model-year validity metadata. Invalid/unknown combinations should be flagged, not silently rewritten.

---

### S0-P0-02 — Fuel vocabulary is asymmetric

Guest Sell exposes:

- Petrol
- Diesel
- Hybrid
- Electric
- Plug-in Hybrid
- Other

Marketplace direct filter exposes:

- Petrol
- Diesel
- Hybrid
- Electric

A seller can therefore state `Plug-in Hybrid` or `Other` while a buyer cannot directly filter for the same stored vocabulary.

**Required resolution:** one canonical fuel/powertrain vocabulary shared by Sell and discovery, with aliases/presentation labels kept separate from stored canonical values.

---

### S0-P0-03 — Transmission vocabulary is asymmetric

Guest Sell exposes:

- Automatic
- Manual
- CVT
- Other

Marketplace direct filter exposes:

- Automatic
- Manual

The same parity failure exists for `CVT` and `Other`.

**Required resolution:** shared canonical transmission taxonomy with clear handling for CVT, automated manual, dual-clutch where needed, and unknown/other.

---

### S0-P0-04 — Body style is collected but not yet a governed Marketplace filter

Sell uses `BODY_STYLES` and stores the UI value in the field currently called `category`.

Marketplace's URL contract explicitly states that body type is intentionally absent until Marketplace has a governed body-style field in its public contract.

At the same time Marketplace `category` currently means a governed commercial classification such as:

- Brand New
- Recently Imported
- Locally Used
- Second Hand

These are not body styles.

**Required resolution:** separate:

- `body_style`
- `seller_stated_condition`
- governed/commercial `condition_category`
- Trust/verification tags.

No single field may carry multiple semantic meanings.

---

### S0-P0-05 — Authenticated Seller still defaults model year to 2020

Authenticated `SellVehicle.tsx` currently initializes:

`year: '2020'`

Guest Sell correctly starts year empty.

A default year can become a seller-stated-looking fact without deliberate seller selection.

**Required resolution:** remove the business-fact default. Unknown stays unknown until explicitly supplied or governed evidence provides it.

---

### S0-P0-06 — Accepted Seller fields are still silently discarded

PR #182 backend explicitly documents that:

- `condition`
- `category`
- `description`

are accepted by `POST /api/vehicles/add` but **not stored** by the handler.

The authenticated Seller UI also collects `features`, but the submit payload does not send `features` to `createVehicleListing`.

This violates the permanent Seller invariant:

> If CarUp asks the seller a question, CarUp must have a canonical destination for the answer.

**Required resolution:** create canonical seller-stated persistence for each field. Do not misuse the governed classification column simply to avoid adding the correct seller-stated contract.

---

### S0-P0-07 — Generation and trim exist structurally but are not collected

The backend currently writes:

- `generation: null`
- `trim: null`

with an explicit note that neither is collected by the current endpoint.

**Required resolution:** generation and trim become optional canonical dimensions, populated where the taxonomy/evidence/user can support them, while preserving unknown when not known.

---

### S0-P0-08 — Drivetrain is supported by backend but absent from current Seller form

The backend accepts `req.body.drivetrain` without fabrication.

The audited Seller forms do not currently collect drivetrain.

**Required resolution:** decide whether drivetrain belongs in required, recommended or advanced vehicle specifications and use the same canonical vocabulary in Sell and discovery.

---

### S0-P0-09 — Media primacy contract exists but UI cannot express it

Backend accepts:

- bare URL = no primary-photo claim;
- `{ url, is_primary: true }` = explicit seller-selected primary.

Current real Seller client sends bare URL strings. The first image is visually labelled “Cover” in authenticated Sell, but the seller does not actually choose a primary photo and the submit payload does not assert primacy.

**Required resolution:** S4 will add explicit primary/reorder UX, but S0 records the canonical media contract now so taxonomy/listing data work does not accidentally assign primacy.

---

### S0-P0-10 — Location visibility is not yet a seller choice

Backend has canonical location provenance/visibility fields, but current form does not expose visibility control.

The current write path treats form-entered listing location as public when visibility is omitted.

**Required resolution:** S3 must make public location projection an explicit seller-facing privacy choice; S0 records the vocabulary and destination now.

---

## 6. Global taxonomy ownership and consumer scope

S0 is now explicitly a platform-foundation phase initiated by Seller Journey.

The completed taxonomy MUST be reused by:

- Sell / Seller Journey;
- Buy / Marketplace;
- Home discovery/marketing shortcuts;
- Verify and Vehicle Passport;
- Vehicle Detail;
- Intelligence / AI / analytics;
- Imports / Diaspora Trade;
- mobile/native Marketplace and future mobile authoring;
- dealer/admin/stakeholder tools;
- backend normalization and validation;
- public/partner APIs;
- future regional CarUp products.

Current audit already shows local divergence outside Seller: mobile Marketplace hardcodes five makes, Verify derives makes only from returned listings, Intelligence compares some vehicle dimensions as raw strings, and Diaspora import orders accept free-text make/model/year. These are consumer-convergence findings, not reasons to create separate taxonomies.

See `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md` for the permanent platform contract and `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_SCHEMA.md` for stable IDs, aliases, generation/trim, year, powertrain, transmission, drivetrain, unknown handling and versioning.

---

## 7. Canonical taxonomy model to freeze

S0 proposes the following conceptual hierarchy:

`Make → Model → Generation → Variant/Trim → Model Year`

with independent canonical dimensions:

- body style;
- colour;
- fuel / electrification;
- transmission;
- drivetrain;
- seller-stated condition;
- governed commercial classification;
- mileage;
- import state;
- market/region;
- price/currency;
- location;
- features/equipment;
- vehicle identity;
- evidence/verification state;
- canonical Trust signals.

### Important rule

A vehicle can simultaneously be:

`Toyota Hilux · Pickup · Used · Recently Imported · Diesel · Automatic · Harare · Passport Verified`

Those are independent facts/classifications. They must not be collapsed into one `category` field.

---

## 8. Taxonomy authority states

Every taxonomy value should be representable with an authority state appropriate to its source.

Recommended states:

### canonical
Recognized by CarUp taxonomy and stored as the canonical vocabulary.

### seller_stated
Supplied by the seller but not independently verified.

### evidence_backed
Supported by admitted evidence but not necessarily institutionally verified.

### verified_governed
Resolved by a CarUp-governed verification/source contract.

### unrecognized
A non-empty seller value CarUp cannot yet map to the canonical taxonomy.

### not_recorded
No value was supplied or resolved.

Unknown/unrecognized values must never be silently mapped to a plausible canonical value.

---

## 9. Alias and regional naming policy

The canonical taxonomy must support multiple market names without duplicating vehicle identity.

Examples:

- Honda Fit ↔ Jazz;
- Mazda Demio ↔ Mazda2;
- Mazda Axela ↔ Mazda3;
- Toyota Aqua ↔ Prius C;
- Toyota Vitz ↔ Yaris;
- Honda Vezel ↔ HR-V;
- Mitsubishi Triton ↔ L200.

Each taxon should be able to carry:

- canonical CarUp display name;
- aliases;
- region/market aliases;
- active/deprecated state;
- start/end model years where known;
- body-style possibilities;
- review provenance.

The canonical name is a normalization choice, not a claim that one regional name is more “true” than another.

---

## 10. Year policy

S0 freezes the following design direction:

1. One shared dynamic upper bound: current year + 1 unless a future vehicle-order flow requires otherwise.
2. One shared lower-bound policy for free entry / discovery.
3. Model-year validity should be metadata, not a destructive validation rule.
4. A seller may provide a year outside CarUp's known model-year range, but the system should surface the mismatch for review/verification rather than fabricate a correction.
5. A verified source may later resolve the governed model year.
6. UI defaults must not pre-populate a year as a fact.

The precise lower bound and historical-vehicle policy remain an S0 decision to complete before runtime implementation.

---

## 11. Initial Seller Data Contract Matrix

| Seller input | Current accepted? | Current canonical persistence | Authority target | Marketplace/filter target | S0 status |
|---|---:|---|---|---|---|
| VIN | yes | yes | identity / governed | exact lookup / Verify | retain |
| Make | yes | yes | seller-stated + canonical taxonomy | display/filter/search | converge |
| Model | yes | yes | seller-stated + canonical taxonomy | display/filter/search | converge |
| Generation | no | null only | seller/evidence/governed | optional display/search | add contract |
| Trim/variant | no | null only | seller/evidence/governed | optional display/search | add contract |
| Year | yes | yes | seller/evidence/governed | display/filter | fix parity/default |
| Colour | yes | yes | seller-stated | display/filter | retain/converge |
| Mileage | yes | yes | seller-stated/evidence | display/filter/intelligence | retain |
| Fuel | yes | yes | seller-stated/evidence | display/filter | fix vocabulary |
| Transmission | yes | yes | seller-stated/evidence | display/filter | fix vocabulary |
| Drivetrain | backend only | yes if sent | seller/evidence | display/filter if adopted | add Seller UX decision |
| Body style | yes as `category` | not stored canonically | seller-stated taxonomy | display/filter | P0 split |
| Seller condition | yes | not stored | seller-stated | display | P0 persistence |
| Governed condition category | derived | governed elsewhere | governed | category filter | keep separate |
| Description | yes | not stored | seller-stated | listing detail | P0 persistence |
| Features/extras | yes | not sent by authenticated Sell | seller-stated | detail/search/intelligence | P0 persistence |
| Price | yes | yes | seller-stated | display/filter | retain |
| Currency | yes | yes + provenance | seller-stated | display | retain |
| City | yes | yes + provenance | seller-stated | display/filter if public | add privacy choice |
| Province | yes | yes + provenance | seller-stated | display/filter if public | add privacy choice |
| Import state | yes | partial | seller/evidence/governed | display/classification | normalize |
| Engine number | yes | yes | protected identity | Verify/readiness | retain |
| Chassis number | yes | yes | protected identity | Verify/readiness | retain |
| Plate/temp ID | yes | yes | protected identity | governed lookup/readiness | retain |
| Listing photos | yes | yes | commercial media | listing media | retain |
| Primary photo | backend supports | UI cannot assert | seller-stated media choice | listing cover | S4 contract |
| Public seller identity | not in Sell | model exists | seller consent | Marketplace/Passport | S3 |
| Location visibility | not in Sell | backend contract exists | seller consent | public projection | S3 |
| Communication preferences | not in Sell flow | Communications-owned | user consent | inquiry/delivery | S3/S10 |

This matrix is the first S0 baseline. It must be expanded against schema, API, public projection and Intelligence/Communications contracts before S0 certification.

---

## 12. Communications boundary frozen in S0

S0 does not add provider-specific seller logic.

Seller Journey will emit governed domain events and rely on Communications for:

- in-app;
- email;
- WhatsApp;
- Telegram;
- push;
- future supported transports.

Communications remains owner of channel policy, preferences, consent, retries, deduplication, provider adapters and canonical conversation/notification state.

---

## 13. Intelligence boundary frozen in S0

Seller Journey domain state leads; Intelligence observes.

S0 reserves meaningful event boundaries including:

- sell started;
- draft saved;
- account handoff;
- vehicle identified;
- draft persisted;
- evidence uploaded;
- discrepancy detected/resolved;
- previewed;
- publish attempted/published;
- price changed;
- inquiry;
- unpublish;
- sold.

Authoritative lifecycle events must be emitted server-side adjacent to the authoritative mutation.

---

## 14. S0 implementation sequence once a runtime lane is legal

1. Reconcile exact live main and PR heads.
2. Choose the canonical implementation base containing accepted #182 work.
3. Freeze current behavior with tests before mutation.
4. Introduce shared canonical taxonomy types/constants.
5. Separate body style from governed commercial condition/category.
6. Unify fuel/transmission/year vocabularies.
7. remove the authenticated 2020 default.
8. Add canonical storage for seller-stated description/features/body-style/condition.
9. Preserve provenance/unknown semantics.
10. Wire Marketplace discovery to the same vocabulary.
11. Wire Verify/Passport/public projections deliberately.
12. Pair Communications/Intelligence event seams without duplicating their systems.
13. Add S0 cross-surface contract tests.
14. Run staging migration/projection proof.
15. Deposit exact-head S0 certification receipt.

---

## 15. S0 measurable exit gate

S0 is PASS only when all of the following are proven at one exact candidate head:

- every Seller field has a canonical destination;
- no accepted field is silently discarded;
- guest/authenticated Seller share the same taxonomy contract;
- Marketplace direct filters use the same canonical vocabularies;
- Home vehicle shortcuts validate against the same taxonomy;
- Verify/Passport uses the same normalization semantics;
- Intelligence groups aliases through the same canonical mapping;
- Imports/Diaspora can select canonical values while safely preserving unrecognized requests;
- mobile does not maintain a local make/model taxonomy;
- backend/web/mobile/API consumers derive from the same platform authority;
- years use one policy;
- body style and commercial condition are separate;
- unknown/unrecognized values remain honest;
- no seller-stated value becomes verified merely through submission;
- public projection has known provenance/visibility rules;
- Verify/Passport consumes the same canonical facts;
- Communications and Intelligence boundaries are wired without architectural duplication;
- automated contract tests pass;
- staging evidence proves write/read/filter parity.

After S0 certification, any future feature needing vehicle taxonomy must extend or consume the global contract rather than recreate taxonomy locally.

Until then S0 remains IN PROGRESS.
