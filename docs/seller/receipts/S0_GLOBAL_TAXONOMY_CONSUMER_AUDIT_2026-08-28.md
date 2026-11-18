# S0 Global Taxonomy Consumer & Shared-Architecture Audit — 2026-08-28

**Programme:** Seller Journey 1.0  
**Platform contract:** `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md`  
**Phase:** S0 — Global Vehicle Taxonomy & Seller Contract Foundation  
**Status:** IN PROGRESS  
**Canonical main:** `ba208963d863654157335189c60f587cbe330041`  
**Marketplace live head at latest check:** `9508f0fe48ed344610d25e727311233afedaa2bb`  
**Seller docs PR:** #186

---

## 1. Decision

The vehicle taxonomy produced by S0 is a **CarUp platform contract**.

Seller Journey initiates and exercises it first because Seller is a high-density vehicle-authoring surface, but no Seller-specific taxonomy will be created.

Permanent rule:

> Define once, normalize once, version once, reuse globally.

---

## 2. Consumer audit

| Consumer | Current behavior | Global convergence requirement |
|---|---|---|
| Guest Sell | Uses #182 web make/model/body-style seed; local year/fuel/transmission rules | Consume global taxonomy; preserve unknown raw values |
| Authenticated Sell | Uses web seed; local 60-year list; defaults year to 2020 | Consume global taxonomy/year policy; remove fact default |
| Marketplace web | Uses web make/model/colour taxonomy but local year/fuel/transmission lists | Use global canonical vocabulary; live inventory facets remain derived |
| Home | Curated structured links hardcode vehicle/fuel/transmission values | Editorial shortcuts may remain curated, but values must validate against global contract |
| Verify | Browse make selector is derived from currently returned listings | Normalize/display through global taxonomy; inventory subset is not taxonomy authority |
| Passport / Vehicle Detail | Projects stored vehicle values with Truth/Trust governance | Use same canonical names/IDs while preserving fact provenance |
| Mobile Marketplace | Hardcodes five makes: Toyota, Mercedes-Benz, Mazda, Nissan, Honda | Remove local make authority; consume global taxonomy or governed live facets |
| Intelligence | Completeness uses make/model/year/fuel/transmission; some matching is raw string comparison | Group/compare using canonical mapping so aliases do not fragment metrics |
| Imports / Diaspora | Free-text requested_make/requested_model/year | Use global autocomplete + safe unrecognized fallback; import demand may extend taxonomy |
| Dealer inventory | Primarily displays stored make/model today | Any future author/edit controls must consume global contract |
| Admin moderation | Primarily displays stored values today | Must not introduce independent taxonomy on future edit/moderation tools |
| Backend vehicle creation | Accepts make/model strings; no platform vehicle-taxonomy service found in tree | Server must normalize/validate against platform authority while preserving raw/source values |
| APIs / integrations | Vehicle strings are part of contracts | Mature taxonomy should expose stable canonical identifiers/labels consistently |

---

## 3. Repository taxonomy inventory

Recursive tree audit at #182 latest checked head found these taxonomy-named assets:

- `web/src/data/vehicleTaxonomy.ts`
- `web/src/data/vehicleTaxonomy.test.ts`
- evidence-taxonomy assets under backend/docs/database

There is **no existing platform-level vehicle make/model taxonomy service or shared vehicle taxonomy package**.

The evidence taxonomy is a different domain and must not be conflated with vehicle make/model taxonomy.

---

## 4. Shared-code feasibility

The repository is a workspace monorepo with:

- `web`
- `mobile`
- `shared`
- `backend`

Both web and mobile TypeScript configs already define:

`@shared/* → ../shared/*`

Vite also aliases `@shared` to the shared directory.

This means the repository already has a natural platform boundary for runtime-neutral taxonomy contracts.

Backend is Node ESM and can consume a compatible shared runtime artifact/service, but it cannot simply import a TypeScript-only client file without an execution strategy.

---

## 5. Recommended S0 architecture direction

This is the architecture direction to validate before runtime implementation:

### A. Platform-owned source

Create a versioned vehicle taxonomy domain under a platform/shared boundary, rather than leaving authority in:

`web/src/data/vehicleTaxonomy.ts`

Candidate logical boundary:

`shared/taxonomy/vehicle/`

### B. Runtime-neutral canonical data

Canonical taxonomy data should be stored in a runtime-neutral form that can feed:

- backend normalization;
- web;
- mobile;
- tests;
- generated API documentation/projections.

Implementation may use a versioned data artifact plus generated/adapted JS/TS consumers, or a governed backend registry with generated client snapshot. S0 must prove compatibility before freezing the exact implementation.

### C. Server-authoritative normalization

Backend should own authoritative normalization/mapping decisions for persisted business data and ingestion.

Clients may use the same snapshot/helpers for UX, but a client mapping must not be the sole authority for what is stored.

### D. Client consumption

Web/mobile should consume the shared/global taxonomy or a versioned projection from it.

No local lists for:

- makes;
- models;
- fuel;
- transmission;
- body style;
- year policy;
- drivetrain

once those dimensions are covered globally.

### E. Unknown queue

Unknown/raw values from Seller, Imports, ingestion or partners should be preserved and mapped separately.

They can become inputs to a future taxonomy-review workflow.

---

## 6. Important distinction: taxonomy vs live facets

Marketplace should not necessarily show all global makes/models in every filter at all times.

Two concepts remain separate:

- **Global taxonomy:** everything CarUp recognizes.
- **Live facet:** values actually present/relevant in the current eligible result population.

This allows a single global taxonomy without producing unusably huge buyer filter menus.

---

## 7. Intelligence consequence

Once canonical IDs/mappings exist, Intelligence should aggregate by the canonical identity rather than raw label.

Example:

`Honda Fit` and `Honda Jazz` must not become two unrelated demand buckets merely because different users/sources supplied regional labels.

Raw observed text may still be retained for audit/provenance.

---

## 8. Imports consequence

Imports are a particularly important AUTHOR surface.

A buyer may legitimately request a model CarUp has never seen before.

Therefore Imports must:

1. suggest canonical values;
2. allow an unrecognized request;
3. preserve the raw requested value;
4. map it later when resolved;
5. feed genuine new-market demand into taxonomy review.

Global taxonomy must not become a gate that prevents new vehicles from entering CarUp.

---

## 9. Current lane safety

No runtime taxonomy files were changed.

PR #182 moved again during S0 from `be38e48c447ad19a4b50cddd29c8747e5da80811` to `9508f0fe48ed344610d25e727311233afedaa2bb`.

The intervening commit changes only:

`web/src/components/home/JourneyMediaStory.tsx`

Therefore the taxonomy/Seller audit remains valid, but future runtime work must still re-read the then-current exact head.

---

## 10. Next S0 work

Before runtime mutation:

1. freeze canonical data shapes/IDs and version policy;
2. define global fuel/transmission/body-style/drivetrain/year vocabularies;
3. design make/model/generation/trim/market alias schema;
4. define unknown/raw mapping record;
5. define taxonomy API/shared-consumer contract;
6. define migration/backfill strategy for existing vehicle rows;
7. define anti-fork tests that reject local competing vocabularies;
8. only then implement when lane ownership becomes legal.
