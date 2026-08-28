# CarUp Global Vehicle Taxonomy — Migration & Rollout Plan

**Status:** S0 design / no runtime migration authorized  
**Platform contract:** `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md`  
**Schema contract:** `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_SCHEMA.md`  
**Initiating programme:** Seller Journey 1.0 / S0  
**Created:** 2026-08-28

---

## 1. Objective

Move CarUp from feature-local vehicle strings/lists to one global taxonomy **without destroying existing vehicle data, breaking active Marketplace behavior, or fabricating mappings**.

The rollout is additive first.

Permanent migration principle:

> Preserve what CarUp currently knows, add canonical mapping beside it, prove the mapping, then cut consumers over.

Do not rewrite old vehicle rows in place merely to make the data look clean.

---

## 2. Existing vehicle storage relevant to S0

The repository's baseline `vehicles` schema already contains:

- `vin TEXT PRIMARY KEY`
- `make TEXT NOT NULL`
- `model TEXT NOT NULL`
- `generation TEXT`
- `trim TEXT`
- `year INTEGER NOT NULL`
- `color TEXT`
- `mileage INTEGER NOT NULL`
- `fuel_type TEXT`
- `drivetrain TEXT`
- `transmission TEXT`
- `import_source TEXT`

Later migrations/contracts add further listing, publication, provenance and classification fields.

The important S0 observation is that the core taxonomy-bearing dimensions are currently mostly plain strings.

That is useful for backward compatibility but insufficient as a global taxonomy authority because aliases and regional names can fragment the same vehicle identity.

---

## 3. Do-not-destroy rule

Existing raw/current values must be preserved during taxonomy migration.

Examples:

- `VW`
- `Volkswagen`
- `Honda Fit`
- `Honda Jazz`
- `Mazda Demio`
- `Mazda2`

A taxonomy backfill may resolve them to canonical IDs, but it must not erase the value CarUp originally received where provenance/audit requires it.

No migration may turn an uncertain match into a verified vehicle fact.

---

## 4. Pre-migration evidence gate — M0

Before creating a production backfill:

1. obtain read-only CarUp staging access;
2. enumerate distinct values/counts for:
   - make;
   - model by make;
   - generation;
   - trim;
   - year;
   - fuel_type;
   - transmission;
   - drivetrain;
   - color;
   - import_source;
3. identify null/blank/malformed values;
4. identify alias candidates;
5. identify conflicting spellings/casing;
6. identify values not present in the current taxonomy;
7. measure how many rows can be exact-mapped;
8. measure how many require alias mapping;
9. leave ambiguous rows unresolved.

The currently connected Supabase project exposed in this session is not CarUp, so no live CarUp DB assertions are recorded in this plan.

M0 remains a blocking evidence gate before runtime backfill.

---

## 5. Runtime taxonomy registry

The canonical definitions should remain repository-versioned and reviewable.

Runtime needs additionally require:

- normalization lookup;
- unknown observation capture;
- review status;
- mapping provenance;
- taxonomy version traceability.

Recommended architecture:

### Repository authority

`shared/taxonomy/vehicle/`

contains versioned canonical taxonomy data/contracts suitable for generated/runtime adapters.

### Backend authority

A backend taxonomy service consumes the same canonical dataset and is authoritative for persistence-time normalization.

### Database runtime registry / observation state

Database structures may hold runtime mapping/review state and/or a materialized taxonomy registry, but must be traceable to the repository taxonomy version.

This gives CarUp:

- code review;
- deterministic CI;
- web/mobile sharing;
- server authority;
- runtime unknown-value review.

---

## 6. Additive canonical references — M1

Do not immediately replace `vehicles.make` or `vehicles.model`.

Introduce nullable canonical references/mapping state beside existing values.

Conceptual fields may include:

- `make_taxon_id`
- `model_taxon_id`
- `generation_taxon_id`
- `trim_taxon_id`
- `body_style_taxon_id`
- canonical powertrain fields;
- canonical transmission family;
- canonical drivetrain;
- `taxonomy_version`;
- `taxonomy_mapping_state`;
- `taxonomy_mapped_at`.

Exact column design must be reconciled against current live schema before migration.

Possible mapping states:

- canonical_exact
- canonical_alias
- unresolved
- needs_review
- not_recorded

These states describe vocabulary resolution, not Trust.

---

## 7. Raw observation / review model — M2

Create a governed way to capture taxonomy values CarUp cannot yet resolve.

Conceptual observation fields:

- dimension;
- raw value;
- normalized candidate;
- source surface;
- source record/VIN/order reference;
- market;
- proposed canonical ID;
- review state;
- taxonomy version;
- created/reviewed timestamps.

Sources may include:

- Seller;
- Imports/Diaspora;
- dealer acquisition;
- partner/API ingestion;
- evidence extraction;
- admin correction.

This queue becomes how the taxonomy grows from real market activity instead of requiring a full world catalogue before launch.

---

## 8. Backfill — M3

Backfill only deterministic mappings first.

### Safe automatic mappings

- exact canonical label;
- exact approved alias;
- approved case/spacing normalization.

### Not safe for automatic mapping

- fuzzy similarity alone;
- guessed model from partial text;
- guessed generation from year;
- guessed trim from features;
- guessed powertrain from model;
- guessed market variant.

Ambiguous rows stay unresolved.

Backfill receipt must report counts:

- total eligible rows;
- exact mapped;
- alias mapped;
- unresolved;
- conflicting;
- failed.

No “100% mapped” target should pressure the system into inventing facts.

---

## 9. Dual-write new vehicle authoring — M4

Once the backend taxonomy service is ready, new authoring flows should persist:

1. source/raw user value where required;
2. canonical taxon ID when resolved;
3. mapping state;
4. taxonomy version;
5. vehicle-fact provenance separately.

Seller/Imports clients may suggest canonical values, but backend normalization remains authoritative.

Example:

```text
seller entered: "Jazz"
taxonomy result:
  state = canonical_alias
  canonical_model_id = model:honda:fit
  canonical_label = Honda Fit
  matched_alias = Jazz

vehicle fact authority:
  source = seller_stated
  verified = false
```

The alias mapping does not make the seller's model claim verified.

---

## 10. Read projection — M5

During transition, API projections should be able to expose:

- canonical display value when a mapping exists;
- mapping state;
- raw/original value where the audience and contract require it;
- unresolved/not-recorded states honestly.

Consumers must not infer:

`unresolved taxonomy = invalid vehicle`

or

`canonical taxonomy match = verified vehicle fact`.

---

## 11. Consumer cutover — M6

Cut consumers over in controlled order.

Recommended sequence:

1. backend normalization contract;
2. shared web/mobile taxonomy helpers/data;
3. Seller authoring;
4. Marketplace/Buy filters and search;
5. Home shortcut validation;
6. Verify browse/presentation;
7. Passport/Vehicle Detail presentation;
8. Imports/Diaspora authoring;
9. mobile Marketplace;
10. dealer/admin authoring/edit surfaces;
11. Intelligence grouping/rollups;
12. partner/public APIs.

Each consumer must prove compatibility before the next dependent stage relies on it.

---

## 12. Marketplace facet rule

Global taxonomy and live facets remain separate.

Marketplace should:

1. normalize eligible listing values globally;
2. derive live facet counts from the eligible inventory/result set;
3. display only useful facets for the buyer context;
4. use global canonical labels/IDs for emitted filters.

This avoids showing thousands of irrelevant global models while preserving one taxonomy.

---

## 13. Intelligence cutover — M7

Intelligence needs special care because historical rollups may have grouped aliases separately.

Before switching analytics:

1. inventory historical grouping keys;
2. define canonical remapping;
3. decide whether old rollups are recomputed or version-separated;
4. stamp calculation/taxonomy versions;
5. preserve “unavailable” rather than fake zero during cutover.

No metric should silently jump because alias buckets merged without version disclosure.

---

## 14. Imports/Diaspora cutover — M8

Import requests should move from free text only to:

- taxonomy autocomplete;
- canonical make/model IDs when selected;
- raw requested text preserved;
- unrecognized request allowed;
- market/origin metadata preserved.

A new import model not yet known to CarUp should create a taxonomy observation, not block the order.

Once an imported vehicle is linked to a VIN, its canonical vehicle identity should converge with Passport/Marketplace taxonomy.

---

## 15. Anti-fork CI — M9

After each dimension is cut over, add guard tests.

Examples:

- reject newly added authoritative `MAKE_FILTERS` arrays outside taxonomy adapters;
- reject Sell-local fuel enums once fuel is global;
- reject Marketplace-local year policy once year is global;
- reject Imports-only make/model dictionaries;
- verify web/mobile/backend taxonomy version parity;
- verify Home curated shortcuts reference canonical IDs/valid projections;
- verify Intelligence alias normalization uses the platform service/helper.

Allow presentation subsets only when derived from canonical IDs.

---

## 16. Deprecation / cleanup — M10

Legacy strings should not be deleted merely because canonical IDs exist.

Cleanup is allowed only when:

- all consumers have cut over;
- historical audit/provenance remains available;
- migrations are reversible or safely recoverable;
- exact-head staging proof passes;
- Intelligence history remains explainable;
- public API compatibility is addressed.

In many cases, keeping the human-readable value beside the canonical ID may remain beneficial.

---

## 17. Rollback model

Every migration phase must fail safely.

Examples:

- taxonomy service unavailable → retain raw value; do not invent canonical mapping;
- unknown alias → unresolved state;
- client taxonomy version mismatch → backend authority wins / client refresh required;
- new taxonomy version breaks consumer → rollback consumer projection without deleting stored raw facts.

No provider/service failure should corrupt the vehicle record.

---

## 18. S0 runtime authorization gate

No M1–M10 runtime work is authorized while current active PR ownership makes Seller/Marketplace/global taxonomy changes a conflicting write lane.

Before first implementation commit:

1. re-read live main;
2. re-read #182/#183/#185 or their successors;
3. determine active source-write capacity;
4. choose canonical implementation base;
5. run shared-file/merge-tree analysis;
6. obtain CarUp staging read-only M0 inventory;
7. freeze exact migration/test plan.

---

## 19. Migration Definition of Done

Global taxonomy migration is complete only when:

- existing raw values remain explainable;
- canonical IDs normalize aliases consistently;
- unresolved values are preserved safely;
- new authoring dual-writes canonical mapping;
- backend is authoritative;
- web/mobile use the same version;
- Marketplace filters operate on canonical semantics;
- Home validates shortcuts;
- Verify/Passport project canonical vocabulary without changing fact authority;
- Imports can create new observations;
- Intelligence groups through canonical identity;
- anti-fork CI prevents regression;
- exact-head staging proof passes.

Until then legacy fields remain supported and the migration is considered transitional.
