# CarUp Global Vehicle Taxonomy Contract

**Status:** Platform-wide canonical contract — S0 foundation in progress  
**Initiating programme:** Seller Journey 1.0 / S0  
**Ownership:** CarUp platform contract, not Seller-specific  
**Created:** 2026-08-28  
**Canonical schema:** `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_SCHEMA.md`  
**Migration plan:** `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_MIGRATION_PLAN.md`  
**Repository:** `kudzimusar/carup`

---

## 1. Purpose

CarUp must have **one global vehicle taxonomy**.

Seller Journey 1.0 is the programme currently exposing and hardening the taxonomy gaps, but the completed taxonomy is not owned by Sell and must not be recreated independently by any product surface.

The same canonical taxonomy must be consumed by:

- Sell / Seller Journey;
- Buy / Marketplace;
- Home discovery and marketing entry points;
- Verify;
- Vehicle Passport / VLI;
- Vehicle Detail;
- Intelligence / analytics / AI context;
- Imports / Diaspora Trade;
- dealer inventory and acquisition;
- mechanics / garages where vehicle classification is required;
- Parts / PartSentry fitment where applicable;
- finance / insurance / valuation where vehicle identity/classification is required;
- admin / moderation / operations;
- web;
- mobile/native;
- backend services;
- public/partner APIs;
- future regional products.

The governing rule is:

> **Define vehicle vocabulary once. Resolve aliases once. Version it once. Reuse it everywhere.**

A product surface may present a subset appropriate to its task, but it must not invent a competing vocabulary.

---

## 2. Global taxonomy is vocabulary, not evidence

The taxonomy answers questions such as:

- what canonical make does “VW” map to?
- are “Honda Fit” and “Honda Jazz” regional aliases of the same model family?
- which transmission values does CarUp recognize?
- what is the canonical body-style vocabulary?
- which model-year ranges are known for a generation?

It does **not** by itself prove that a particular vehicle has that value.

Example:

- taxonomy knows `Honda Fit` and `Jazz` are related regional names;
- seller states the vehicle is a `Honda Fit`;
- evidence may later verify the model/variant/year;
- canonical Trust decides what CarUp can publicly assert as governed fact.

Therefore:

`taxonomy vocabulary ≠ vehicle fact authority`

Fact provenance remains governed separately.

---

## 3. Permanent global invariants

### GVT-1 — One canonical vocabulary

No product surface may create an independent hardcoded make/model/year/fuel/transmission/body-style vocabulary when the global taxonomy already covers that dimension.

### GVT-2 — Stable canonical identifiers

Display labels may evolve. Canonical identifiers must remain stable enough for:

- stored vehicle records;
- analytics;
- filters;
- URLs/API contracts where appropriate;
- imports;
- partner integrations;
- migrations/backfills.

Where feasible, the mature contract should distinguish stable IDs/codes from presentation labels.

### GVT-3 — Aliases are first-class

Regional and historical naming must be represented as aliases or market-specific names, not duplicate vehicle identities.

Examples include:

- Honda Fit / Jazz;
- Mazda Demio / Mazda2;
- Mazda Axela / Mazda3;
- Toyota Aqua / Prius C;
- Toyota Vitz / Yaris;
- Honda Vezel / HR-V;
- Mitsubishi Triton / L200.

### GVT-4 — Unknown is allowed

CarUp must be able to accept a real vehicle the taxonomy does not yet know.

Unknown/unrecognized values must:

1. be preserved as seller/importer/source-stated raw values;
2. not be silently mapped to a plausible known value;
3. be eligible for taxonomy review;
4. become canonical through a governed mapping process when resolved.

### GVT-5 — Inventory facets are derived, vocabulary is canonical

Marketplace may expose only values present in eligible inventory as live facets.

That does not make Marketplace inventory the taxonomy authority.

The global taxonomy defines the recognized vocabulary; inventory facets define which recognized values are currently useful to buyers.

### GVT-6 — Same semantics across surfaces

If `CVT`, `Plug-in Hybrid`, `Pickup`, or a model alias has a canonical meaning, that meaning must be identical in Sell, Buy, Verify, Intelligence, Imports and APIs.

### GVT-7 — Versioned change

Every material taxonomy change must be versioned and migration-aware.

Changes must distinguish:

- additive taxons;
- aliases;
- corrected mappings;
- deprecated labels;
- semantic changes;
- merged/split taxons.

### GVT-8 — No destructive normalization

Normalization should preserve the original observed/stated value when useful for provenance and audit.

A mapping such as `VW → Volkswagen` should not erase the fact that the source originally supplied `VW` where that provenance matters.

### GVT-9 — Global by default, localized by projection

Zimbabwe/JDM/SADC coverage is the initial high-priority seed because it matches CarUp's launch market.

The architecture itself must support later regional expansion without replacing the contract.

### GVT-10 — No reimplementation

Once a taxonomy dimension is canonical, future agents must extend or consume it. They must not create a second list because it is locally convenient.

---

## 4. Canonical hierarchy

The target hierarchy is:

`Make → Model → Generation → Variant/Trim → Model Year`

Independent dimensions include:

- body style;
- colour;
- fuel / electrification;
- transmission;
- drivetrain;
- engine/powertrain family where justified;
- market/region;
- seller-stated condition vocabulary;
- commercial classification vocabulary;
- import classification;
- features/equipment vocabulary where standardized;
- vehicle class/use type where required.

The hierarchy must not collapse unrelated concepts.

For example, one vehicle may simultaneously be:

`Toyota → Hilux → [generation] → [trim] → 2021`

and independently:

`Pickup · Used · Recently Imported · Diesel · Automatic · 4WD · Harare · Passport Verified`

---

## 5. Current implementation baseline

At the audited Marketplace/Seller branch, `web/src/data/vehicleTaxonomy.ts` is a useful first seed but is currently a **web-layer discovery/listing vocabulary** rather than a platform-wide contract.

Current measured seed:

- 43 makes;
- 212 model entries;
- make aliases;
- model aliases;
- body-style hints;
- canonical make/model normalization helpers;
- taxonomy search terms.

This asset should be evolved, not discarded.

However, its current location and shape mean backend, mobile, Intelligence, Imports and external APIs cannot all treat it as their single source of truth.

S0 must therefore define the platform-level source-of-truth architecture before runtime migration.

---

## 6. Current global consumer audit

### Sell / Seller Journey

Current state:

- consumes the #182 web taxonomy for make/model/body style;
- maintains local year policy;
- maintains local fuel vocabulary;
- maintains local transmission vocabulary;
- authenticated Seller still has a local 2020 year default.

Required convergence:

- consume global make/model/generation/trim/year policy;
- consume global fuel/transmission/body-style/drivetrain vocabulary;
- preserve unknown seller-stated values;
- no business-fact defaults.

### Buy / Marketplace

Current state:

- consumes `VEHICLE_MAKES`, `VEHICLE_TAXONOMY`, models and colours from the web taxonomy;
- still declares local fuel values;
- still declares local transmission values;
- still declares its own year range;
- condition/category is a separate governed commercial classification.

Required convergence:

- use global canonical vocabulary;
- inventory facets remain server-derived over normalized values;
- no local duplicate lists.

### Home

Current state:

Home has structured deep links such as:

- Toyota Hilux;
- Honda Fit;
- Mazda Demio;
- Diesel;
- Automatic;
- Harare;
- Recently Imported.

These links correctly target structured Marketplace filters, but the labels/values are currently hand-authored in Home.

Required convergence:

- curated marketing shortcuts may remain editorial choices;
- every vehicle/fuel/transmission value used by a shortcut must validate against the global taxonomy/filter contract;
- Home must not create taxonomy values.

### Verify / Vehicle Search / Passport

Current state:

Verify browses published Marketplace inventory and currently derives the make selector from returned listings rather than the global taxonomy.

Required convergence:

- exact identifier lookup remains governed by Verify policy;
- make/model browsing and presentation normalize through the global taxonomy;
- Passport facts retain provenance and do not become verified merely because they map to a canonical taxon.

### Intelligence

Current state:

Intelligence Listing Completeness already treats make/model/year, mileage, transmission and fuel as meaningful listing dimensions.

Some matching logic compares raw normalized strings, e.g. make matching by lowercase text.

Required convergence:

- aggregate and compare on canonical taxonomy identifiers/values where possible;
- retain raw source values for audit when needed;
- do not split one model across alias spellings;
- lost-opportunity and demand analytics must use the same dimensions buyers can actually filter.

### Imports / Diaspora Trade

Current state:

The import-order form currently accepts free-text:

- `requested_make`;
- `requested_model`;
- `requested_year_min/max`.

This is valuable because import demand can include vehicles not yet present in CarUp inventory, but it means the import domain currently has no canonical taxonomy enforcement/normalization.

Required convergence:

- autocomplete/search from the global taxonomy;
- preserve free-text/unrecognized requests;
- record canonical mapping separately where resolved;
- allow import demand to expand taxonomy coverage;
- linked imported vehicles must converge to the same canonical vehicle identity used by Marketplace/Passport.

### Mobile Marketplace

Current state:

The mobile Marketplace currently contains a local hardcoded make list:

`Toyota, Mercedes-Benz, Mazda, Nissan, Honda`

Required convergence:

- remove local make authority;
- consume platform/global taxonomy or governed live facet projection.

### Dealer/Admin/Other stakeholder surfaces

Dealer inventory and moderation currently mostly display existing vehicle values rather than authoring a separate taxonomy.

As vehicle-authoring/editing capability expands, those surfaces must consume the global contract rather than add local vocabularies.

---

## 7. Target platform architecture

S0 must choose and certify one authoritative implementation model that can be consumed by both frontend and backend.

The target must support:

1. a platform-owned canonical taxonomy source;
2. shared types/codes;
3. backend normalization/validation;
4. web consumption;
5. mobile consumption;
6. public/partner API projection;
7. versioning;
8. alias resolution;
9. taxonomy review workflow;
10. unknown/raw-value preservation.

Acceptable implementation patterns may include a versioned shared package/data artifact, a governed backend taxonomy service/registry, or a combination where generated client artifacts derive from one canonical registry.

What is not acceptable:

- a web-only source copied into mobile;
- backend string lists separate from frontend lists;
- per-feature hardcoded make/model/fuel/transmission arrays;
- Intelligence-specific normalization rules that differ from Marketplace;
- Imports-specific make/model vocabularies.

The detailed stable-ID, alias, generation/trim, year, powertrain, transmission, drivetrain, unknown-observation and versioning contract is defined in `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_SCHEMA.md`.

The exact storage/runtime architecture is an S0 implementation decision and must be chosen against the live repository before code changes.

---

## 8. Global consumer contract

Every consuming surface must declare which of these modes it uses:

### AUTHOR
Creates or proposes a vehicle taxonomy value.

Examples:

- Seller;
- importer;
- dealer acquisition;
- external source ingestion.

AUTHOR surfaces may submit unknown raw values.

### NORMALIZE
Maps source values/aliases to canonical taxonomy values.

Examples:

- backend ingestion;
- import reconciliation;
- seller draft persistence.

### BROWSE
Uses taxonomy values for user selection/search.

Examples:

- Marketplace;
- Verify browse;
- Seller autocomplete;
- dealer inventory tools.

### PROJECT
Displays already-resolved values.

Examples:

- Home listing cards;
- Passport;
- Vehicle Detail;
- admin moderation.

### ANALYZE
Groups/compares values without changing them.

Examples:

- Intelligence;
- reporting;
- market demand analysis.

No consumer mode may silently upgrade taxonomy recognition into factual verification.

---

## 9. Global completion gate

The Global Vehicle Taxonomy is not production-certified until:

- one authoritative source is identified and versioned;
- make/model aliases normalize consistently;
- year policy is shared;
- fuel vocabulary is shared;
- transmission vocabulary is shared;
- body style is separated from commercial condition;
- drivetrain policy is shared;
- unknown/unrecognized values are safely preserved;
- Seller consumes it;
- Marketplace/Buy consumes it;
- Home shortcuts validate against it;
- Verify/Passport consumes it;
- Intelligence aggregates through it;
- Imports/Diaspora consumes it;
- mobile consumes it;
- backend validates/normalizes through it;
- APIs expose the same semantics;
- tests prevent local taxonomy forks;
- exact-head staging certification proves cross-surface parity.

After this gate, future work must **extend the global taxonomy rather than recreate taxonomy locally**.

---

## 10. Relationship to Seller Journey S0

Seller Journey S0 remains the initiating prerequisite because Sell is where the highest-density vehicle authoring occurs.

However:

> **S0 discovers and hardens the taxonomy; CarUp Platform owns the resulting taxonomy.**

Seller Journey cannot mark S0 complete until the global contract is usable by the required platform consumers.

The Seller programme manual and S0 receipt must reference this document as the taxonomy authority.
