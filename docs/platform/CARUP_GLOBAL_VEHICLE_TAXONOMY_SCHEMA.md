# CarUp Global Vehicle Taxonomy — Canonical Schema & Vocabulary Contract

**Status:** S0 design freeze candidate  
**Platform authority:** `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md`  
**Initiating programme:** Seller Journey 1.0 / S0  
**Created:** 2026-08-28

---

## 1. Purpose

This document defines the data model that every CarUp vehicle-taxonomy consumer must eventually share.

It separates four things that must never be conflated:

1. **canonical vehicle identity vocabulary** — make/model/generation/trim;
2. **canonical technical dimensions** — body, powertrain, transmission, drivetrain;
3. **product-facing grouping** — buyer filters and display labels;
4. **vehicle fact authority** — who actually stated or verified a value for a specific VIN.

Taxonomy recognition does not verify a vehicle fact.

---

## 2. Stable identity hierarchy

Canonical hierarchy:

`Make → Model → Generation → Variant/Trim → Model Year`

### 2.1 Stable IDs

Display labels are mutable presentation. IDs are integration contracts.

Recommended ID shapes:

- `make:toyota`
- `model:toyota:hilux`
- `generation:toyota:hilux:<carup-generation-key>`
- `trim:toyota:hilux:<generation-key>:<carup-trim-key>`

Rules:

- IDs are lowercase ASCII;
- IDs do not change when a display label changes;
- regional aliases do not receive duplicate model identities unless they are genuinely distinct products;
- an ID may be deprecated but must not be silently reused for a different meaning;
- merges/splits require explicit migration metadata.

CarUp-specific IDs may coexist with manufacturer/chassis/platform codes as external identifiers.

---

## 3. Make taxon

Conceptual shape:

```text
MakeTaxon
  id
  canonical_name
  aliases[]
  origin_markets[]
  status
  introduced_year?
  discontinued_year?
  external_ids{}
  provenance{}
```

### Alias record

```text
TaxonomyAlias
  value
  alias_type
  markets[]
  languages[]
  valid_from?
  valid_to?
```

Suggested `alias_type` values:

- regional_name
- former_name
- abbreviation
- transliteration
- spelling_variant
- colloquial
- manufacturer_alias

Example:

`Volkswagen` may carry `VW` as an abbreviation.

---

## 4. Model taxon

Conceptual shape:

```text
ModelTaxon
  id
  make_id
  canonical_name
  aliases[]
  known_body_styles[]
  generations[]
  market_names[]
  introduced_year?
  discontinued_year?
  status
  external_ids{}
  provenance{}
```

Example:

`model:honda:fit`

may carry regional alias metadata for `Jazz`.

The alias does not erase the raw source label.

---

## 5. Generation taxon

Generation is optional when CarUp cannot resolve it.

Conceptual shape:

```text
GenerationTaxon
  id
  model_id
  canonical_name?
  manufacturer_generation_code?
  platform_codes[]
  aliases[]
  model_year_start?
  model_year_end?
  production_start?
  production_end?
  markets[]
  body_styles[]
  powertrain_options[]
  transmission_options[]
  drivetrain_options[]
  status
  provenance{}
```

### Important

Model year and production year are not guaranteed to be identical.

The taxonomy may know a likely model-year range, but a specific VIN's model year remains a vehicle fact requiring its own provenance.

---

## 6. Variant / trim taxon

Trim/variant is optional and must not block a legitimate vehicle from existing in CarUp.

Conceptual shape:

```text
TrimTaxon
  id
  generation_id
  canonical_name
  aliases[]
  markets[]
  model_year_start?
  model_year_end?
  engine_codes[]
  powertrain?
  transmission?
  drivetrain?
  body_style?
  status
  provenance{}
```

Trims often vary significantly by market. Market metadata is therefore first-class.

---

## 7. Model-year policy

### Canonical technical validity

- integer year;
- minimum technical bound: **1886**;
- normal maximum: **current calendar year + 1**;
- values outside a known model/generation range are a **review signal**, not an automatic rewrite.

### Product projection

Individual surfaces may show a narrower convenient year picker, but they must:

- use the same underlying validator;
- allow legitimate older values through an advanced/manual path where appropriate;
- never default a year as a vehicle fact;
- not maintain competing year semantics.

### Known-range state

A model-year relationship may be:

- known_valid
- known_outside_range
- range_unknown

`known_outside_range` is not equivalent to “impossible”; imports, registration dates, regional launch timing and source errors require reconciliation.

---

## 8. Body-style vocabulary

Canonical body-style IDs should be presentation-neutral.

Initial global vocabulary:

- `sedan`
- `hatchback`
- `wagon`
- `coupe`
- `convertible`
- `suv`
- `crossover`
- `pickup`
- `mpv`
- `van`
- `minibus`
- `bus`
- `truck`
- `chassis_cab`
- `commercial`
- `other`

Presentation aliases may include:

- estate → wagon;
- bakkie → pickup where market-appropriate;
- ute → pickup where market-appropriate;
- people carrier → MPV.

### Critical separation

Body style is not:

- seller condition;
- import status;
- commercial Marketplace category;
- Trust tag.

---

## 9. Powertrain and energy model

The current product uses a single `fuel_type` string, which conflates fuel and electrification.

The global taxonomy should separate them conceptually.

### 9.1 Energy source

Initial canonical energy-source vocabulary:

- `petrol`
- `diesel`
- `electricity`
- `hydrogen`
- `lpg`
- `cng`
- `ethanol_flex`
- `other`

### 9.2 Electrification / propulsion type

Initial canonical propulsion vocabulary:

- `ice`
- `mild_hybrid`
- `hybrid`
- `plug_in_hybrid`
- `battery_electric`
- `fuel_cell`
- `other`

### 9.3 Buyer-facing filter groups

Buyer filters may project these into task-friendly labels such as:

- Petrol
- Diesel
- Hybrid
- Plug-in Hybrid
- Electric
- Other

This projection must be centralized.

A buyer-facing label is not the canonical storage model.

---

## 10. Transmission vocabulary

Initial canonical transmission-family vocabulary:

- `manual`
- `torque_converter_automatic`
- `cvt`
- `dct`
- `automated_manual`
- `single_speed`
- `other`

Optional metadata may include:

- gear count;
- manufacturer transmission code;
- marketing name.

### Buyer-facing grouping

CarUp may group detailed values for filters, for example:

- Manual
- Automatic
- CVT
- Other

If DCT/AMT/single-speed are grouped under Automatic for a particular surface, the grouping rule must be global and versioned rather than reimplemented per component.

---

## 11. Drivetrain vocabulary

Passenger/light-vehicle canonical drive layout:

- `fwd`
- `rwd`
- `awd`
- `4wd`
- `other`

Commercial/heavy vehicles may additionally require axle configuration:

- `4x2`
- `4x4`
- `6x2`
- `6x4`
- `6x6`
- `8x4`
- other governed configurations.

Drive layout and axle configuration are separate dimensions where necessary.

---

## 12. Colour vocabulary

Canonical colour should support a normalized buyer-facing family plus optional raw/manufacturer colour.

Example:

```text
canonical_colour_family = silver
source_colour_label = "Sonic Silver Metallic"
manufacturer_colour_code = "..."
```

Initial normalized families may preserve the current CarUp set:

- black
- white
- silver
- grey
- blue
- red
- green
- brown
- beige
- gold
- orange
- yellow
- purple
- maroon
- bronze
- other

Unknown is a state, not a colour.

---

## 13. Seller condition vs commercial classification

These remain separate.

### Seller-stated physical/commercial condition vocabulary

Initial presentation may include:

- New
- Used
- Certified Pre-Owned

But “Certified Pre-Owned” must only be available where the certification meaning is governed. A seller must not self-create a certification status merely by selecting a label.

S0 therefore needs a precise policy before runtime implementation.

### Governed Marketplace classification

Examples already present in Marketplace include:

- brand_new
- recently_imported
- locally_used
- second_hand
- certified_dealer

Those values come from a governed classification contract and must not be overwritten by a Seller body-style or condition input.

---

## 14. Market and regional naming

Every make/model/generation/trim may carry market metadata.

Suggested market code convention:

- ISO country code when country-specific;
- region groups only where explicitly defined.

Examples relevant to CarUp launch:

- ZW — Zimbabwe
- JP — Japan
- ZA — South Africa
- GB — United Kingdom
- regional SADC grouping where useful

A model may have different names in different markets without becoming a different canonical vehicle family.

---

## 15. Unknown and unrecognized values

Unknown handling is mandatory.

Conceptual raw-observation shape:

```text
TaxonomyObservation
  id
  dimension
  raw_value
  normalized_candidate?
  canonical_taxon_id?
  source_type
  source_reference?
  market?
  observed_at
  review_status
  reviewed_by?
  reviewed_at?
```

Recommended review states:

- unresolved
- auto_suggested
- mapped
- rejected
- needs_research

### Rules

- never discard `raw_value`;
- never silently map low-confidence observations;
- mapping an alias does not verify the corresponding fact on a VIN;
- repeated unresolved demand should be visible to taxonomy maintainers.

Imports/Diaspora is a major source of legitimate new observations.

---

## 16. Taxonomy provenance

Taxonomy provenance is about **why CarUp recognizes a vocabulary relationship**.

Vehicle fact provenance is about **why CarUp believes a specific VIN has a value**.

They must be stored and presented separately.

Taxonomy provenance may include:

- source reference;
- source type;
- reviewer;
- added_at;
- updated_at;
- confidence/review state;
- external identifier.

A taxonomy relationship may be well established while a particular seller's assertion remains unverified.

---

## 17. Versioning

Recommended contract version:

`carup-global-vehicle-taxonomy@MAJOR.MINOR.PATCH`

Suggested semantics:

### PATCH

- spelling/presentation correction with no identity change;
- non-semantic metadata correction.

### MINOR

- new make/model/generation/trim;
- new alias;
- additive vocabulary;
- new non-breaking metadata.

### MAJOR

- meaning of an existing canonical ID changes;
- taxons merge/split in a way that changes consumer behavior;
- dimension semantics change;
- API/storage contract becomes incompatible.

Every runtime projection should expose or be traceable to a taxonomy version.

---

## 18. Deprecation, merge and split

Taxons must not simply disappear.

Conceptual lifecycle metadata:

```text
status = active | deprecated | merged | split | review
replaced_by_ids[]
effective_version
reason
```

Stored historical records must remain explainable after taxonomy evolution.

---

## 19. Canonical API / shared-consumer contract

Every runtime consumer should ultimately be able to request/use:

- taxonomy version;
- makes;
- models for make;
- generations for model;
- trims for generation;
- canonical dimensions;
- aliases;
- normalization result;
- buyer-filter projection;
- market-specific presentation;
- unknown/unrecognized result.

Conceptual normalization response:

```text
raw_value
dimension
state = canonical | alias_match | unrecognized | not_recorded
canonical_id?
canonical_label?
matched_alias?
taxonomy_version
```

This response contains vocabulary resolution, not factual verification.

---

## 20. Repository architecture direction

The repo already has a `shared` workspace and both web/mobile define `@shared/*`.

Therefore S0 should prefer a platform-owned shared boundary rather than a web-owned taxonomy.

Candidate logical shape:

```text
shared/
  taxonomy/
    vehicle/
      <canonical data>
      <shared types/contracts>
      <generated/runtime adapters>
```

Backend must consume the same authority through a Node-compatible runtime artifact/service.

The exact file/runtime implementation remains blocked until active source-lane ownership permits implementation and compatibility tests prove the chosen approach.

---

## 21. Anti-fork rule

After a dimension is migrated to the global taxonomy, CI should fail on newly introduced feature-local authoritative lists for that dimension unless explicitly exempted as a presentation subset validated against the global contract.

Examples that should eventually become regressions:

- a new `const MAKE_FILTERS = [...]` in mobile;
- a new local fuel enum in Sell;
- a new year range with different bounds in Marketplace;
- an Imports-only model dictionary;
- an Intelligence alias map independent of platform taxonomy.

Curated UI subsets are allowed only when they reference/validate canonical IDs.

---

## 22. S0 schema exit gate

This schema is ready for runtime implementation only when:

- stable-ID policy is accepted;
- alias model is accepted;
- generation/trim model is accepted;
- year policy is accepted;
- body-style vocabulary is accepted;
- powertrain/energy model is accepted;
- transmission model is accepted;
- drivetrain model is accepted;
- unknown-observation model is accepted;
- taxonomy provenance is distinct from vehicle-fact provenance;
- version/deprecation rules are accepted;
- web/mobile/backend sharing strategy passes repository compatibility review.

No runtime migration should precede this contract.
