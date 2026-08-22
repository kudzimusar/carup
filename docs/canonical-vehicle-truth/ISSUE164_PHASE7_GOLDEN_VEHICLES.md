# Issue #164 Phase 7 — Golden Reference Vehicle Dataset

Phase 7 replaces the old thin UAT fixture with **staging-only, synthetic, idempotent, removable**
reference vehicles that exercise the real canonical CarUp pipeline end to end. It is a truth-model
validation, not a demo-data exercise: the Golden Vehicles prove that identity, evidence, provenance,
review, trust, publication, communications and transaction state all compose around one VIN **without
any fabricated fact or manually-seeded conclusion**.

## Source

- Specifications (deterministic, declarative): `backend/services/golden/goldenVehicleSpecs.js`
- Orchestration (bootstrap / verify / cleanup): `backend/services/golden/goldenVehicleFixture.js`
- Runner (staging guard, receipts, §9 sequence): `backend/scripts/issue164-golden-vehicles.mjs`
- Certification tests: `backend/tests/issue164-phase7-golden-vehicles.test.js`
- Owner-governed staging dispatcher: `.github/workflows/issue164-golden-vehicles-dispatcher.yml`

## The two Golden Vehicles

| | Golden A (`CARUPGLDNA0000001`) | Golden B (`CARUPGLDNB0000002`) |
|---|---|---|
| Intent | complete / healthy — **earns** its trust | intentionally incomplete / pending |
| Identity | vin + chassis + engine + plate (→ identity `complete`) | same identity fields present |
| Ownership document | uploaded **and governed-verified** | uploaded and **left pending** |
| Advisory evidence | police-clearance, inspection, insurance docs (synthetic, verified) | none |
| Source coverage | governed manual review (cvr, zinara) | none |
| Publication | becomes `published` because it is genuinely publishable | stays `draft` (not publishable) |
| Trust | **derived** by `refreshCanonicalTrust`, read via `toPublicTrust` | derived — honestly low / not-evaluated |
| Transaction | inquiry → finance intent → escrow intent (server-authoritative, no money) | none (eligibility correctly refused) |

Every synthetic identity carries a `@carup-staging.test` marker email; every evidence document carries
`CARUP SYNTHETIC TEST RECORD — PHASE 7 GOLDEN VEHICLE — NOT AN OFFICIAL DOCUMENT`; every fixture row with
a metadata column carries `CARUP_PHASE7_GOLDEN`. No record impersonates ZRP / ZIMRA / ZINARA / VID / an
insurer / a bank / a dealer / a registry / a real person.

## Hard invariant — never seed a conclusion

The fixture seeds **inputs and provenance** and performs **governed review decisions**; it never writes a
trust score, a final tier, a verified badge, or a `*_verified=true` authority. Trust is produced only by
`refreshCanonicalTrust`. Golden A earns `identity=complete` + `evidence_completeness=complete` from real
seeded inputs; Golden B stays pending because its evidence really is incomplete — absence never becomes a
positive verification. This is proven bidirectionally in the tests (verifying Golden B's ownership
document would flip publishability, so B's incompleteness is a meaningful assertion, not a vacuous one).

## The three operations

- **bootstrap** — create-or-reuse the two vehicles and their governed graph. Idempotent: every write is
  keyed on a deterministic id / VIN / email and preceded by an existence check or upsert.
- **verify** — read-only invariant proof (non-zero exit on any failed invariant).
- **cleanup** — remove only the deterministic fixture rows, child-tables-first, scoped by the exact VIN /
  user-id set. No `TRUNCATE`, no pattern-wide delete, no cascade beyond the fixture.

`--mode=sequence` runs the full §9 idempotency + containment proof (baseline → bootstrap → verify →
bootstrap → no-duplicate → cleanup → absence → cleanup-idempotent → bootstrap → verify) and captures
unrelated-data snapshots before and after, writing `issue164-golden-vehicles-receipt.json`.

## Staging execution (owner-governed)

Local credentials cannot write to staging (the service-role credential is owner-only, in the `staging`
GitHub environment). The staging run is therefore performed exactly like the Phase 6 cutover: the owner
triggers `Issue 164 Phase 7 Golden Vehicles (staging)` via `workflow_dispatch` (owner-only, actor-gated),
which runs the runner against `eoyenigwevnxwwhyhaer` through the real canonical services and uploads the
receipt. It performs no migration, no schema change, no production write, and no live
payment/provider/Gemini activation. The workflow requires the `staging` environment to carry
`STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` secrets.

## Integration finding — writer-less government-registry tables (Domain 6)

Phase 7 surfaces a real, pre-existing integration gap (recorded here as evidence, not worked around): the
substantiating government-registry tables — `cid_clearance_records`, `cvr_ownership_records`,
`zimra_declarations`, `vid_inspections`, `zinara_licensing_records` — have **no governed application
write path**. `source_verification_results` yields only coverage (which the fact resolver maps to
`UNKNOWN`, never a substantiated fact), and `documentIntelligenceService` writes deliberately
non-substantiating rows. Only `insurance_records` has a legitimate governed writer
(`insuranceService.createInsurancePolicy`).

Consequently a Golden Vehicle cannot produce a substantiated `verified_clear` police/customs/inspection/
licensing registry fact through any legitimate service call. Rather than fabricate those registry rows
(which would be exactly the manually-seeded conclusion Phase 7 forbids), Golden A models the police /
inspection / insurance **sources** through the governed evidence path — a synthetic document uploaded to
`vehicle_evidence` and then verified by a governed review — which is a real, trust-moving, governed
substantiation. Closing the registry-writer gap is a follow-up governed-write lane, not a Phase 7 hack.
