# V3 — Evidence Vault and Provenance Foundation Certification

**Date:** 2026-08-28
**Phase:** V3 — Evidence Vault and Provenance Experience
**Status:** PASS — EXACT-HEAD FOUNDATION CERTIFIED

## Scope

V3 establishes the Passport **evidence projection contract** only.

It does not replace or mutate the existing evidence subsystem. It consumes:

- the canonical Vehicle Life evidence taxonomy;
- existing evidence verification states;
- existing visibility levels;
- the canonical tamper-evident provenance chain/public provenance summary.

No migration, evidence upload route, review workflow or Seller evidence write path is changed.

## Files added

- `backend/services/passport/passportEvidenceProjection.js`
- `backend/tests/passport-v3-evidence-provenance.test.js`

CI extended:

- `.github/workflows/vehicle-passport-foundation-ci.yml`

## Canonical dependencies reused

- `backend/services/evidence/evidenceTaxonomy.js`
- `backend/services/evidence/provenanceService.js`
- existing `vehicle_evidence` verification statuses:
  - pending
  - verified
  - rejected
  - disputed
  - superseded
- existing visibility vocabulary:
  - public_safe
  - restricted
  - private
  - government_only

## Projection rules

### Public / buyer

Only evidence that is both:

- `public_safe`; and
- `verified`

may project into the Passport.

### Owner / seller

May receive public-safe, restricted and private evidence after the upstream relationship has already been established.

`government_only` remains withheld.

### Garage / partner

Foundation remains conservative: only verified public-safe evidence is projected until a later purpose-specific evidence grant is explicitly established.

### Governance

May inspect all evidence visibility classes through this projection, but the Passport projection still does not publish raw provenance actor IDs or IP information.

## Whitelist projection

Passport evidence is field-whitelisted rather than built by spreading source database rows.

The projection intentionally excludes fields such as:

- plate/chassis/engine identifiers from evidence rows;
- uploader IDs;
- reviewer IDs;
- tenant ID;
- storage bucket/path;
- raw private provenance actor/IP fields;
- per-evidence Trust-impact fields.

## Trust boundary

The existing evidence rows contain legacy/scoring-support fields such as `trust_impact`, `trust_score_impact` or `confidence_impact`.

Vehicle Passport V3 deliberately does **not** republish or interpret these.

Canonical Trust remains the only Trust decision authority.

## Provenance

The Passport consumes `toPublicProvenanceSummary()` from the canonical provenance service.

It does not create a second evidence ledger.

## Sparse-data behavior

An empty visible evidence collection is `unknown`, not “clean history”.

A caller can explicitly supply collection state such as `unavailable`; Passport preserves it.

## Tests

V3 tests prove:

1. public sees only verified public-safe evidence;
2. public projection is whitelist-based;
3. sensitive evidence-row fields are stripped;
4. per-evidence Trust-impact fields are never republished;
5. owner can see private/restricted but not government-only evidence;
6. governance may see government-only evidence without raw actor/IP provenance fields;
7. sparse evidence remains unknown/unavailable rather than clean;
8. disputed/superseded states remain explicit;
9. Passport reuses canonical taxonomy/provenance modules;
10. Passport evidence projection owns no database or Trust engine.

The dedicated CI also runs the existing canonical Vehicle Life taxonomy/provenance tests.

## Seller dependency

Seller evidence upload/reconciliation and Passport route wiring remain owned by Seller/shared integration and are not changed here.

## Exact-head certification

Certified code head before receipt update:

- exact code head: `80c6122f41a03f73f0381d9528e97c24d7e13e50`
- Vehicle Passport Foundation CI run: `33162225858`
- V1 Passport foundation contract — PASS
- V2 identity/access contract — PASS
- V3 evidence/provenance contract — PASS
- canonical Vehicle Life evidence taxonomy/provenance — PASS
- canonical Passport lookup policy — PASS
- canonical Trust decision authority — PASS
- Passport syntax checks — PASS
- diff hygiene — PASS

## Phase decision

**V3 FOUNDATION PASS.**

No Seller/shared evidence write path was changed. V4 may proceed only as isolated verification/discrepancy projection and orchestration contracts.
