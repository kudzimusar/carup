# Fact Model — Issue #164 Phase 2

Analysis only. No source file was modified. Baseline: `01ad3fad` (Phase 0 + Phase 1) on
`integration/canonical-vehicle-truth-closure`.

> **Reading the line anchors in this document.** Every `file:NNNN` here resolves against the baseline
> commit named above and **not** against a current tree — later phases have moved most of them. Use
> `git show 01ad3fad:<file>`, which is what `MEDIA_EVIDENCE_CONTRACT.md` §8 rule 2 prescribes and what
> naming a baseline is for. Stated explicitly because a reader who resolves one of these against the
> working tree will land on unrelated code and may conclude the claim is false when it is not — that
> already happened once during the Phase 5 close-out, to a claim that was true as written.

Canonical contract under consumption, never forked:
`backend/utils/publicVehicleProjection.js` — `FIELD_STATES` / `fieldState` / `statedValue`
(`publicVehicleProjection.js:232-294`).

Prior art this builds on: `PUBLIC_API_INVENTORY.md` §7 row 8 (tri-state facts), §9 (tri-state
migration deferred to Phase 2) and `ADR-001-trust-authority.md` (`vehicles.trust_score` demoted to a
materialized cache with exactly one writer). This document does for the six convenience booleans
what ADR-001 did for `trust_score`.

Ground truth used and **not** re-derived: staging Supabase `eoyenigwevnxwwhyhaer`; the authoritative
record tables `cid_clearance_records`, `cvr_ownership_records`, `vid_inspections`,
`zimra_declarations`, `zinara_licensing_records`, `insurance_records`, `safepay_escrows` are all
empty; `vehicle_evidence` has 1 row; the evidence/provenance subsystem exists and is wired into
`trustDecisionService` via `completenessEvaluator.js` and `sourceVerificationService.js`.

---

## 0. The complete boolean surface on `vehicles`

Enumerated from the live staging column list, not from the migration files (the two disagree: the
migrations create six columns nullable, staging holds four of them `NOT NULL`).

| column | nullable | default | in `PUBLIC_VEHICLE_FIELDS`? |
|---|:--:|---|:--:|
| `duty_paid` | YES | `false` | yes (`publicVehicleProjection.js:48`) |
| `police_verified` | YES | `false` | yes (`publicVehicleProjection.js:48`) |
| `zimra_verified` | **NO** | `false` | yes (`publicVehicleProjection.js:48`) |
| `passport_verified` | **NO** | `false` | yes (`publicVehicleProjection.js:49`) |
| `inspection_ready` | **NO** | `false` | yes (`publicVehicleProjection.js:49`) |
| `safe_pay_ready` | **NO** | `false` | yes (`publicVehicleProjection.js:49`) |
| `public_seller_display_enabled` | YES | `false` | yes (`publicVehicleProjection.js:51`) |

There is **no other** `*_verified` / `*_ready` / `*_cleared` boolean on `vehicles`. Two near-misses
worth naming, because both are precedents rather than problems:

- **`plate_verified` is not a column.** It is derived at read time from `plate_verified_at` /
  `plate_status` (`listingSummaryService.js:194`). This is the pattern every fact in §1 should be
  migrated onto, and it already ships.
- **`vehicle_listing_summaries`** carries `plate_verified`, `passport_verified`, `duty_cleared`,
  `cid_clear`, `partsentry_checked` as `BOOLEAN NOT NULL DEFAULT false`
  (`20260603132036_marketplace_listing_summary_infra.sql:79-93`). The table has 0 rows on staging and
  **zero code references in the entire repository** — see §4.

`public_seller_display_enabled` is a **source fact** (a seller's own consent/preference about
display) and is out of scope here: it asserts nothing about the vehicle and nothing external can
verify it. It stays a stored source fact.

---

## 1. Classification table

| flag | classification | authoritative record that should own it | today's value means | writers in code |
|---|---|---|---|:--:|
| `duty_paid` | **MATERIALIZED CACHE** of a derived fact | `zimra_declarations` (+ `source_verification_results` provider `zimra`; `vehicle_evidence` class `import`) | nothing verifiable — no code path can ever set it `true` | 1 (writes `false` only) |
| `police_verified` | **MATERIALIZED CACHE** of a derived fact | `cid_clearance_records` (+ `source_verification_results` provider `cid`) | "was reported stolen, then recovered" — the *inverse* of the badge it renders | 3 |
| `zimra_verified` | **MATERIALIZED CACHE** of a derived fact | `zimra_declarations` (+ `source_verification_results` provider `zimra`) | nothing — **no writer exists anywhere** | 0 |
| `passport_verified` | **DERIVED FACT** (cache of a governed review decision) | `trust_fact_requests` + `trust_audit_events` | correct and governed: an approved, evidence-validated, audited review decision | 2 (both governed) |
| `inspection_ready` | **DERIVED FACT** (cache of a governed review decision); *conflated* with a registry fact | `trust_fact_requests` for the affordance; `vid_inspections` for roadworthiness — **two different facts** | governed *when* set by the workflow; fixture-set on staging | 2 (both governed) |
| `safe_pay_ready` | **MATERIALIZED CACHE** of a server-authoritative transaction state | `escrow_trust_sessions` / `escrow_trust_events` + `eligibility_requests` / `eligibility_decisions` | nothing — **no writer exists anywhere** | 0 |

**No column in this table is a SOURCE FACT.** Every one of the six is an assertion about an external
authority or an internal review, and every one is stored where nothing can reconstruct why.

Three of the six public verification claims — `zimra_verified`, `safe_pay_ready`, and any `true`
value of `duty_paid` — have **zero writers in the application**. On production the only value they
can ever hold is one a human typed directly into the database. That is the sharpest single finding
in this document, and it is what makes §5 a governance problem and not a data-quality problem.

---

## 2. Per-flag dossiers

Each dossier states the derivation rule an implementer can code, every writer as `file:line`, and the
migration risk of switching the public read to the derived value.

### 2.1 `duty_paid`

*Classification:* materialized cache of a derived fact.
*Schema:* `supabase_schema.sql:57` — `BOOLEAN DEFAULT FALSE`, nullable on staging.
*Authoritative owner:* `zimra_declarations` (`duty_paid_zig`, `duty_calculated_zig`,
`customs_ref_number`, `customs_stamp_date`, `port_of_entry`, `officer_signature_hash`), corroborated
by `source_verification_results` where `provider='zimra'`.

**Derivation rule.**

```
not_applicable  ← isLocalSafeImportSource(vehicle.import_source)         (marketplaceClassificationRules.js:51,75-80)
                  AND no zimra_declarations row exists
verified_clear  ← a zimra_declarations row exists for the VIN
                  AND duty_paid_zig >= duty_calculated_zig
                  AND customs_stamp_date is present
verified_adverse← a zimra_declarations row exists AND duty_paid_zig < duty_calculated_zig
no_record       ← provider 'zimra' was queried and returned result='no_record'
                  (source_verification_results, sourceVerificationService.js:117-137)
source_unavailable ← latest zimra result is 'unavailable' / mode 'unavailable'
unknown         ← otherwise  (this is the state for EVERY staging and production vehicle today)
```

The `not_applicable` branch is exactly the case the contract's own doc comment anticipates: "import
duty on a locally assembled unit" (`publicVehicleProjection.js:229-230`). Reuse
`isLocalSafeImportSource` / `isRealImportSource` / `isPoisonedSeedValue`
(`marketplaceClassificationRules.js:69-80`) rather than writing a second import-source vocabulary.

**Value today.** Nothing verifiable. The single application writer sets it to `false` on creation;
every `true` in the database came from a seed script or a hand edit.

**Writers.**

| # | site | what it writes |
|---|---|---|
| W1 | `POST /api/vehicles/add` (`backend/server.js`) | `duty_paid: false` on **every** created vehicle — asserts a negative that was never evaluated |
| W2 | `database/migrations/supabase_schema.sql:347` | demo seed, `duty_paid: true` |
| W3 | `database/seeds/marketplace_v1_staging_qa_seed.sql:43,47,50,53` | staging QA fixtures, `true` |
| W4 | `scripts/migrate-to-supabase.js:125-127` | migration fixtures, `true` |
| W5 | `backend/db/database.js:299` | legacy local SQLite seed |

**Readers that publish it.** `listingSummaryService.js:196` → tag `duty_cleared`;
`listingSummaryService.js:253` → `duty_cleared` field; `marketplaceTrustSummaryService.js:31` → badge
copy "Import duty cleared"; `server.js:458` → an anonymous **filter** (`?dutyPaid=true`), which turns
the flag into a queryable oracle over a fact nothing established; `trustGraphService.js:302` →
`dutyPaidReal = !!zimra || !!vehicle.duty_paid`.

**Migration risk (low–medium).** Deriving flips the flag to `unknown` for all 16 staging vehicles
(9 currently `true`) and removes the `duty_cleared` tag and badge from every listing. No writer is
lost because none produces `true`. The `?dutyPaid=` filter (`server.js:458`) must be removed or
re-pointed at the derived state, or it silently becomes a filter on "never evaluated". `trustGraph`'s
`|| vehicle.duty_paid` fallback (`:302`) is the defect ADR-001 already names and disappears with the
engine.

### 2.2 `police_verified`

*Classification:* materialized cache of a derived fact.
*Schema:* `supabase_schema.sql:58` — `BOOLEAN DEFAULT FALSE`, nullable on staging.
*Authoritative owner:* `cid_clearance_records` (`stolen_check_status`, `clearance_ref_number`,
`station_name`, `authorized_by_officer`, `cleared_at`), corroborated by `source_verification_results`
where `provider='cid'`. Adverse signal from `fraud_cases` / `fraud_signals`.

**Derivation rule.**

```
verified_adverse ← latest cid_clearance_records.stolen_check_status indicates stolen/flagged
                   OR latest cid source result is 'high_risk'
verified_clear   ← latest cid_clearance_records.stolen_check_status === 'Cleared'
                   AND cleared_at is present
no_record        ← provider 'cid' queried, result='no_record'
                   — NOT a clearance. "Not found in the stolen register" is not "police cleared".
source_unavailable ← latest cid result 'unavailable'
unknown          ← otherwise  (every staging and production vehicle today)
```

The `no_record` ≠ `verified_clear` line is the whole point of principle 9 here, and the source
contract already encodes it: `VERIFICATION_RESULTS` lists `no_record` and `unavailable` as
first-class outcomes, with the comment "unavailable and no_record are first-class — NOT match"
(`verificationContract.js:26-33`).

**Value today.** A `true` set by code means "this vehicle **was reported stolen** and the alert was
later cleared" (`securityService.js:50-53`). The public surface renders that byte as the badge
"Police (CID) clearance on record" (`marketplaceTrustSummaryService.js:33`). A vehicle that was never
stolen and a vehicle that was stolen-and-recovered are indistinguishable, and only the second one can
earn the badge through code. Every other `true` on staging is fixture-set.

**Writers.**

| # | site | what it writes |
|---|---|---|
| W1 | `POST /api/vehicles/add` (`backend/server.js`) | `police_verified: false` on every created vehicle |
| W2 | `backend/services/security/securityService.js:22` | `false` + `status:'Flagged'` when a theft is reported |
| W3 | `backend/services/security/securityService.js:53` | **`true`** + `status:'Available'` when a theft alert is cleared — the only code path that writes `true` |
| W4 | `database/seeds/marketplace_v1_staging_qa_seed.sql:43,47,50,53`; `supabase_schema.sql:347`; `scripts/migrate-to-supabase.js:125-127`; `backend/db/database.js:299` | fixtures |

W2/W3 additionally depend on `stolen_vehicles`, which **does not exist on staging**
(`to_regclass('public.stolen_vehicles')` is null) while `securityService.js:13,34,50` and
`trustGraphService.js:357` all read or write it. The only `true`-writing path is therefore inert on
staging and its failure mode is an exception, not a wrong value — but `checkStolenStatus`
(`securityService.js:31-44`) fails the same way, and it backs the anonymous
`/api/security/check-stolen/:vin`.

**Readers that publish it.** `listingSummaryService.js:198` → tag `cid_clear`;
`listingSummaryService.js:255` → `cid_clear` field; `marketplaceTrustSummaryService.js:33` → badge;
`server.js:459` → anonymous `?policeVerified=` filter; `trustGraphService.js:311` →
`policeVerifiedReal = (cid && …'Cleared') || !!vehicle.police_verified`.

**Migration risk (medium).** Deriving removes the `cid_clear` badge from every staging listing.
Unlike `duty_paid`, a real writer exists — but it writes the wrong fact, so the migration must
**retarget** it rather than delete it: `clearStolenStatus` should insert a `cid_clearance_records`
row (or a `manual_verification` result via `recordManualVerification`,
`sourceVerificationService.js:156-190`) instead of stamping a boolean. Retargeting W2/W3 is also the
opportunity to stop `reportVehicleStolen` from overloading `status` with theft state.

### 2.3 `zimra_verified`

*Classification:* materialized cache of a derived fact.
*Schema:* `20260603132036_marketplace_listing_summary_infra.sql:8` — `BOOLEAN NOT NULL DEFAULT false`.
*Authoritative owner:* the **same** record as `duty_paid` — `zimra_declarations` plus
`source_verification_results` provider `zimra`.

`duty_paid` and `zimra_verified` are two badges over one authority, and the marketplace publishes
both ("Import duty cleared" at `marketplaceTrustSummaryService.js:31`, "ZIMRA duty verified" at
`:32`), ordered as if they were independent corroboration (`BADGE_ORDER`,
`marketplaceTrustSummaryService.js:43-56`). They are not independent. Separate them explicitly or
collapse them:

```
zimra_verified : verified_clear ← the ZIMRA SOURCE was queried and returned result='match'
                                  (source_verification_results, provider='zimra')
duty_paid      : verified_clear ← the DECLARATION shows duty settled (§2.1)
```

Under that split, `zimra_verified` is a statement about *source coverage* and `duty_paid` about
*the content of the record*. The `source_coverage` dimension already computes exactly the first
(`trustDecisionService.js:64-78`), so `zimra_verified` should be read from the decision rather than
recomputed.

**Value today.** Nothing. There is **no writer in the application at all** — no insert, no update, no
patch. Its only non-default value on staging comes from `marketplace_v1_staging_qa_seed.sql:45,52`
(3 vehicles). On production its only possible source is a hand edit.

**Writers.** None in code. Fixtures only: `database/seeds/marketplace_v1_staging_qa_seed.sql:45,52`.

**Readers that publish it.** `listingSummaryService.js:197` → tag `zimra_verified`;
`listingSummaryService.js:254` → field; `marketplaceTrustSummaryService.js:32,45` → badge, ranked
second-strongest of twelve.

**Migration risk (low).** Nothing writes it, so nothing breaks. The only visible change is that three
staging listings lose the badge. `shared/types/index.ts:48,91` and `web/src/types/index.ts:74` type it
as a boolean and must accept the stated shape.

### 2.4 `passport_verified`

*Classification:* **derived fact** — a materialized cache of a governed review decision. This is the
one flag whose write path is already correct, and it is the template for the other five.
*Schema:* `20260603132036_marketplace_listing_summary_infra.sql:5-7` — `BOOLEAN NOT NULL DEFAULT
false`, plus `passport_verified_at` and `passport_verification_source`.
*Authoritative owner:* `trust_fact_requests` (status lifecycle `pending → approved | rejected |
revoked | superseded`) with `trust_audit_events` as the immutable ledger.

**Derivation rule.**

```
verified_clear ← EXISTS trust_fact_requests r
                   WHERE r.vin = :vin AND r.trust_fact = 'passport_verified'
                     AND r.status = 'approved'
                   AND NOT EXISTS a later 'revoked' request for the same (vin, fact)
                 -- approval already required, at approve() time:
                 --   ≥1 evidence_id, all rows vin-matched and verification_status='verified'
                 --     (trustFactWorkflowService.js:229-263)
                 --   ≥1 of evidence_type ∈ {registration_document, ownership_transfer_document}
                 --     (trustFactWorkflowService.js:265-270)
                 --   reviewer role admin|government, no self-review
                 --     (trustPermissionService.js:19-20; trustFactWorkflowService.js:412-414)
                 --   two audit events written and asserted before the vehicle is patched
                 --     (trustFactWorkflowService.js:447-450)
unknown        ← otherwise. There is no 'false' state: the workflow refuses requests that ask for
                 anything but true (trustFactWorkflowService.js:212-217).
```

**Value today.** Correct where set, and `false` for all 16 staging vehicles — the staging seed
deliberately refuses to set it: "No FAKE public trust claims: passport_verified is NOT set here
(governed-only)" (`marketplace_v1_staging_qa_seed.sql:17`). `trust_fact_requests` has 0 rows, so the
`false` is honest.

**Writers.**

| # | site | what it writes |
|---|---|---|
| W1 | `backend/services/trustGovernance/trustFactWorkflowService.js:101-107` → applied at `:450` via `updateVehicle` (`:397-403`) | `passport_verified:true`, `passport_verified_at`, `passport_verification_source:'trust_fact_request:<id>'` |
| W2 | `backend/services/trustGovernance/trustFactWorkflowService.js:118-123` → applied at `:540` | revocation: `false`, `null`, `'revoked_trust_fact_request:<id>'` |

No other writer exists. `marketplaceClassificationRules.js:29,200-208` hard-blocks inference
("`passport_verified` … NEVER inferred — governed approval only"), and
`marketplaceBackfill.js:23-27` hard-rejects it as a backfill target.

**Migration risk (low, and mostly a rename).** The column is already a faithful cache of
`trust_fact_requests`; the change is to stop treating the column as the authority and to derive from
the request ledger, keeping the column as the cache (exactly ADR-001's INV-TRUST-2 shape). The one
real change is that `false` must project as `unknown`, not as a denial.

### 2.5 `inspection_ready`

*Classification:* derived fact (governed review decision) — but **conflated with a registry fact**.
*Schema:* `20260603132036_marketplace_listing_summary_infra.sql:11` — `BOOLEAN NOT NULL DEFAULT false`.
*Authoritative owners:* **two different facts share one column.**

| fact | meaning | authority |
|---|---|---|
| inspection **available** | an independent inspection can be arranged / inspection evidence is on file | `trust_fact_requests` (`trust_fact='inspection_ready'`) |
| road**worthiness** | the vehicle passed a VID mechanical inspection | `vid_inspections` (`inspection_status`, `braking_efficiency_pct`, `suspension_passed`, `steering_passed`, `odometer_reading`) |

The public badge reads "Independent inspection available"
(`marketplaceTrustSummaryService.js:36`) — the first fact. The approval gate requires verified
`inspection_photo` evidence (`trustFactWorkflowService.js:272-277`) — also the first fact. But
`trustGraphService.js:321-328` scores `vid_inspections.inspection_status` as the same concept. Keep
them separate: publishing a roadworthiness pass as "inspection available" (or the reverse) is a
category error that no amount of provenance can repair.

**Derivation rule (for the column's own meaning).**

```
verified_clear ← latest non-revoked approved trust_fact_requests row for
                 (vin, 'inspection_ready'), which already required verified
                 evidence_type='inspection_photo'  (trustFactWorkflowService.js:272-277)
unknown        ← otherwise
-- roadworthiness is a SEPARATE resolver over vid_inspections + source provider 'vid',
-- surfaced as its own fact key, never merged into this one.
```

**Value today.** Governed when the workflow sets it; fixture-set on staging
(`marketplace_v1_staging_qa_seed.sql:45,52`, 3 vehicles) with `trust_fact_requests` empty — so every
staging `true` is unbacked.

**Writers.**

| # | site | what it writes |
|---|---|---|
| W1 | `trustFactWorkflowService.js:108-110` → applied at `:450` | `inspection_ready: true` |
| W2 | `trustFactWorkflowService.js:125-127` → applied at `:540` | `inspection_ready: false` |
| W3 | `database/seeds/marketplace_v1_staging_qa_seed.sql:45,52` | staging fixtures |

Advisory only, not a writer: `marketplaceAiAssistantService.js:67` emits `recommended_tags:
['inspection_ready']` — copy suggestion, no persistence. Verify it cannot reach a listing body as a
tag.

**Migration risk (low for the column, medium for the semantics).** Deriving is a no-op for
governed rows and drops 3 unbacked staging badges. The medium risk is the split: any consumer reading
`inspection_ready` as roadworthiness must be found and re-pointed before `vid_inspections` gains rows,
or the first real VID row will silently change what an existing badge claims.

### 2.6 `safe_pay_ready`

*Classification:* materialized cache of a **server-authoritative transaction state** — arguably not a
vehicle fact at all.
*Schema:* `20260603132036_marketplace_listing_summary_infra.sql:10` — `BOOLEAN NOT NULL DEFAULT false`.
*Authoritative owner:* `escrow_trust_sessions` / `escrow_trust_events` (the better-governed of the two
escrow engines per `PUBLIC_API_INVENTORY.md` §G) plus `eligibility_requests` / `eligibility_decisions`.
`safepay_escrows` is the legacy engine and is empty.

**Derivation rule.** Do not write a new one — the canonical decision already computes this:

```
escrow_eligibility = eligibilityDimension(escrow, 'escrow', PUBLIC)   trustDecisionService.js:198
  input from fetchEscrow(vin) — latest escrow_trust_sessions row       trustDecisionService.js:354-360
  status 'not_requested' or absent  → 'not_evaluated'                  trustDecisionService.js:109,122-124

safe_pay_ready : verified_clear ← decision.dimensions.escrow_eligibility.status is an
                                  eligible/active state
                 unknown        ← status === 'not_evaluated'
```

`notEvaluated()` already carries the exact comment this fact needs: "Never reported as clear/eligible
— it is explicitly 'not_evaluated'" (`trustDecisionService.js:118-124`). The column should be deleted
from the public projection and the dimension published in its place.

**Value today.** Nothing. **No writer exists in the application** — no insert, no update, no patch,
in any service, route or script. Its only non-default values on staging come from
`marketplace_v1_staging_qa_seed.sql:45,52`. `escrow_trust_sessions` has 3 rows on staging, none of
which is connected to this flag.

**Writers.** None in code. Fixtures only: `database/seeds/marketplace_v1_staging_qa_seed.sql:45,52`.
`trustPermissionService.js:29` reserves it as a `FINANCE_FACTS` governance target, but no workflow
implements it — the governance vocabulary is ahead of the write path.

**Readers that publish it.** `listingSummaryService.js:204` → tag `safe_pay_ready`;
`marketplaceTrustSummaryService.js:35,54` → badge "SafePay-ready transaction". This is a **payment
affordance** advertised to buyers on the strength of a byte nothing writes.

**Migration risk (low technically, high in consequence).** Nothing breaks; three staging listings lose
the badge. It is listed as high-consequence because it is the only one of the six that shapes a money
decision, and because `PUBLIC_API_INVENTORY.md` §7 row 10 already records that
`buildTransactionIntent` (`marketplaceListingDetailService.js:63-73`) returns hardcoded constants — so
today *both* halves of the SafePay story are unbacked.

---

## 3. Provenance map of the existing subsystems

Roles: **SE** source evidence · **AEF** authoritative external fact · **RD** reviewer decision ·
**DF** derived fact · **MCF** materialized convenience flag · **PL** provenance ledger.

### 3.1 Evidence & provenance layer

| subsystem | role | wired into | status |
|---|:--:|---|---|
| `vehicle_evidence` (`evidenceService.js`; 1 row) | SE | **`completenessEvaluator.js:65-69,110-122`** (blocking ownership doc + advisory docs, by `evidence_type` + `verification_status`); `trustFactWorkflowService.js:236-287` (approval gate); `listingSummaryService.js` (evidence count/tags); `reportService.js:103-104`; `trustGraphService.js:346-352` | **live** — the spine of every governed claim |
| `evidence_class_taxonomy` (59 rows) | reference | **nothing**: the runtime vocabulary is the JS module `evidenceTaxonomy.js` ("what the upload validator and the taxonomy-discovery endpoint use at runtime so validation never depends on a live DB round-trip", `evidenceTaxonomy.js:5-9`) | **duplicated state** — the table can drift from the module with no detector |
| `evidence_sources` (5 rows, `sourceRegistryService.js:10`) | SE registry | only `GET /api/evidence/sources` (`listPublicSources`, `:26-32`). `sourcePermitsClass` (`:41-53`) exists but is not enforced on any governed fact | **near-orphan** |
| `source_records` (0 rows, `ingestionService.js:28,39,42,251`) | SE | the ingestion pipeline only; no governed fact reads it | **orphan** |
| `evidence_sets` (0 rows, `evidenceSetService.js:10`) | SE grouping | `GET /api/vehicles/:vin/evidence-sets` (`evidenceCatalogRoutes.js:74`) only | **orphan** |
| `evidence_provenance_events` (0 rows, `provenanceService.js:22`) | **PL** | `GET /api/vehicles/:vin/evidence/:id/provenance` (`evidenceCatalogRoutes.js:81-94`) only. **Not read by `completenessEvaluator`, `trustFactWorkflowService`, or `trustDecisionService`** | **orphan — the highest-consequence one** |

The chain is hash-linked and tamper-evident by construction (`computeContentHash`,
`provenanceService.js:26-41`; DB blocks UPDATE/DELETE per its header, `:5-8`). It is exactly the
artifact "provenance before claims" requires — and no claim consults it.

### 3.2 Source verification layer

| subsystem | role | wired into | status |
|---|:--:|---|---|
| `source_verification_results` (3 rows) | AEF, append-only | **`sourceVerificationService.js:117-140`** (persist), **`getCoverage` :193-200** via view `source_verification_coverage_public` → **`trustDecisionService.js:311`** → `source_coverage` / `source_conflicts` / `fraud_risk` dims (`:191-193`) | **live** |
| registry adapters, 5 providers (`registryAdapters.js:20-56`) | AEF | `initSourceVerification` (`sourceVerificationService.js:34-40`) | **live but all SANDBOX** — honestly mode-labelled, and scored **+0** (`trustDecisionService.js:245-246`) |
| `recordManualVerification` (`sourceVerificationService.js:156-190`) | RD | same table, `mode:'manual_verification'`, actor + reason required | **live, unused** — the correct retarget for `securityService.js:53` |
| `registry_verifications` (2 rows) | AEF | `complianceRoutes.js:15,26` only | **orphan** relative to the fact model |

### 3.3 Authoritative Zimbabwe registry records

| table | role | rows | read by | written by |
|---|:--:|:--:|---|---|
| `zimra_declarations` | AEF | 0 | `trustGraphService.js:15,301` **only** | `documentIntelligenceService.js:348` (OCR admin approval) |
| `cvr_ownership_records` | AEF | 0 | `trustGraphService.js:16,315` **only** | `documentIntelligenceService.js:337` |
| `cid_clearance_records` | AEF | 0 | `trustGraphService.js:18,307` **only** | none |
| `vid_inspections` | AEF | 0 | `trustGraphService.js:17,321` **only** | none |
| `zinara_licensing_records` | AEF | 0 | `trustGraphService.js:19` (timeline only) | none |
| `insurance_records` | AEF | 0 | `trustGraphService.js:13`; `insuranceService.js` | `insuranceService.js:35` |

**Every one of the five registry tables is read exclusively by `trustGraphService`, the engine
ADR-001 deprecates.** The canonical authority never opens them: `getTrustDecision`'s vehicle select is
`vin, make, model, year, chassis_number, engine_number, plate_number, temp_plate_id, tenant_id`
(`trustDecisionService.js:302`) and its only other inputs are completeness, coverage, fraud and
eligibility. Retiring `trustGraphService` without re-homing these reads would leave the authoritative
external facts with no consumer at all.

Note also that the only writer of `zimra_declarations` fabricates its numbers:
`duty_calculated_zig` / `duty_paid_zig` default to `50000` and `exchange_rate_used` is the literal
`13.5` (`documentIntelligenceService.js:353-355`), and `cvr_ownership_records` gets a synthesised
`registration_number`, `owner_id_number` `'29-198427-G-45'` and a random `logbook_serial_number`
(`:339-343`). Any derivation over these tables must treat rows written by this path as
`manual_review`, not as authority.

### 3.4 Review / decision layer

| subsystem | role | wired into | status |
|---|:--:|---|---|
| `trust_fact_requests` (0 rows) + `trust_audit_events` (3514 rows) | **RD + PL** | `trustFactWorkflowService.js` end-to-end; gates `passport_verified` and `inspection_ready` | **live and correct — the model to reuse** |
| `trustPermissionService.js:1-29` | RD policy | `canSetTrustFact` | **live**, but its `SOURCE_TRUST_FACTS` set (14 facts) is far wider than the 3 `PHASE_2A_FACTS` any workflow implements — `zimra_verified`, `cid_clear`, `plate_verified`, `safe_pay_ready` are governed on paper only |
| `partsentry_logs` (1 row) + `partsentry_review_requests` (0) | SE + RD | `partsentryService.js:25,38,71-90`; `listingSummaryService.js:340-380`; `partsentryReviewService.js` | **live** — and the best existing example of a multi-condition governed derivation (`partsentryCheckedStatus`, `marketplaceClassificationRules.js:213-232`) |
| `verification_sessions` (31) / `verification_assessments` (35) / `verification_decisions` (19) | RD | `services/identity/*` — **user KYC**, keyed on `user_id`, never on `vin` | **orphan from vehicle truth** (not from identity truth) |
| `review_tasks` (0) / `review_decisions` (0) / `trust_change_log` (0) | RD + PL | `governanceService.js:206,247,276` | **orphan** — a second, unused review ledger alongside `trust_fact_requests` |
| `verification_ocr_provenance` (2) | PL | `verificationSessionService.js` `recordOcrProvenance` (`:39-60`) | live, user-identity scoped |

### 3.5 Derived / analytic layer

| subsystem | role | wired into | status |
|---|:--:|---|---|
| `completenessEvaluator.evaluateCompleteness` | **DF** | `trustDecisionService.js:309` → `evidence_completeness` + `evidence_confidence` + `publication_eligibility` dims; `/api/vehicles/:vin/completeness`; publish gate `vehiclesRoutes.js:160` | **live — the canonical evidence derivation** |
| `trustDecisionService.assembleDecision` | **DF** | pure, versioned `trust-decision-1.0.0` (`:20`), 11 dimensions, `toPublicDecision` (`:279-293`) | **live — the canonical authority (ADR-001)** |
| `disclosure_claims` (0) / `disclosure_conflicts` (0) | DF | `disclosureConflict.js:10-11`; `reportService.js:111`; `governanceService.js:50` | **orphan from the decision** — never reaches `trustDecisionService` |
| `temporal_findings` (0) | DF | `temporalComparison.js:12`; `reportService.js:108` | same |
| `listing_snapshots` (0) | SE | `listingSnapshotService.js:11`; `reportService.js:106` (mileage history) | orphan |
| `vehicle_ownership_history` (4) | AEF-ish | `server.js:567,1486`; `escrowService.js:177`; `trustGraphService.js:11`; drives the `one_owner` tag (`listingSummaryService.js:200`) | live |
| `blockchain_events` (2) + `verifyChain` | PL | `trustGraphService.js:334`; `/verify-ledger` | live, but only the deprecated engine scores it |
| `reportService.assembleReport` (`:98-140`) | DF | `/api/vehicles/:vin/report` | live — and the **only** derivation that already filters on `verification_status='verified' AND visibility_level='public_safe'` before publishing (`:104`) |
| `vehicle_listing_summaries` (0 rows) | **MCF** | **nothing** — zero references in the repository | **fully dead** |
| `trust_score_history` (0) / `stakeholder_profiles` (5) | MCF/PL | `trustGraphService.js:275-289`; `trustEnforcementEngine.js:160` | tied to the deprecated engine |

### 3.6 The six flags themselves

All six are **MCF**. None is read by `trustDecisionService`. All six are read by
`listingSummaryService.js:186-212` → `deriveMarketplaceTags` → `marketplaceTrustSummaryService.js`
badges, and all six are selected into `LISTING_SELECT_COLUMNS`
(`listingSummaryService.js:429,430,443,444,445` and `:442`) and into `PUBLIC_VEHICLE_FIELDS`
(`publicVehicleProjection.js:48-49`). The public marketplace is the only consumer that treats them as
truth.

---

## 4. The canonical fact / provenance relationship

### 4.1 The chain a public claim must be able to replay

```
  SOURCE                EVIDENCE / RECORD             PROVENANCE               REVIEW
  ───────               ─────────────────             ──────────               ──────
  evidence_sources  →   vehicle_evidence          →  evidence_provenance_  →  trust_fact_requests
  (registry, dealer,    (artifact + checksum +       events (hash chain,      (approved | rejected |
   partner, owner)       image_hash + source_id)      append-only)             revoked | superseded)
                                                                                    +
  registry adapter  →   source_verification_      →  append-only row with     trust_audit_events
  (zimra|cvr|zinara|     results (mode, result,       mode + legal_basis +     (immutable ledger)
   vid|cid)              confidence, retrieved_at)    requested_by
                                        │
                                        ▼
                              CANONICAL FACT  (derived, never stored as the authority)
                                        │
                                        ▼
                              PUBLIC CLAIM  (tag / badge / projected field)
```

Every arrow is a precondition. A claim that cannot walk the chain leftwards to a real source is not
publishable — and "the boolean column says true" is not a leftwards step.

### 4.2 The fact vocabulary

Consume `FIELD_STATES` from `publicVehicleProjection.js:232-237`; do not fork it. A fact needs one
more axis than the four states carry, because the contract's `state` answers *"does this audience get
a value"* while a verification fact must also answer *"what did the authority say"*. Two fields, one
of which is already canonical:

```js
// state: EXACTLY publicVehicleProjection.FIELD_STATES — recorded | not_recorded | withheld | not_applicable
// status: what the authority returned. Closed vocabulary.
export const FACT_STATUS = Object.freeze({
  VERIFIED_CLEAR:     'verified_clear',      // a source was queried / a reviewer approved, and it is affirmative
  VERIFIED_ADVERSE:   'verified_adverse',    // a source was queried and it is negative. A real fact, not a gap.
  PENDING_REVIEW:     'pending_review',      // evidence exists, no decision yet
  NO_RECORD:          'no_record',           // the source WAS queried and holds nothing. NOT a clearance.
  SOURCE_UNAVAILABLE: 'source_unavailable',  // the source could not be reached. NOT a clearance.
  NOT_APPLICABLE:     'not_applicable',      // the fact cannot apply to this vehicle
  UNKNOWN:            'unknown',             // nothing was ever queried. THE DEFAULT.
});
```

Mapping to the canonical states, so one convention governs both:

| status | `state` (FIELD_STATES) | `value` | public claim emitted? |
|---|---|---|:--:|
| `verified_clear` | `recorded` | `true` | **yes** |
| `verified_adverse` | `recorded` | `false` | yes — as an adverse finding, never as a gap |
| `pending_review` | `not_recorded` | `null` | no |
| `no_record` | `recorded` | `false` | no — surfaced as "checked, nothing on file" |
| `source_unavailable` | `not_recorded` | `null` | no |
| `not_applicable` | `not_applicable` | `null` | no |
| `unknown` | `not_recorded` | `null` | no |

`statedValue()` (`publicVehicleProjection.js:291-294`) already yields `null` for everything but
`recorded`, so the projection layer needs no new null-handling — only the `status` field alongside it.

Note the deliberate asymmetry with `isRecordedValue` (`publicVehicleProjection.js:256-261`), which
counts a raw `false` as RECORDED. That is correct **for a column**: a genuine `duty_paid:false` is
data. It is wrong **for a fact**, because the columns in §1 are `NOT NULL DEFAULT false` — their
`false` is a schema artifact, not an observation. The resolver, not `isRecordedValue`, is where that
distinction is made; `isRecordedValue` must not be changed.

### 4.3 The resolver an implementer can code

```js
/**
 * @returns {{
 *   fact: string,
 *   status: string,            // FACT_STATUS
 *   state: string,             // FIELD_STATES — from fieldState(), never hand-set
 *   value: boolean|null,       // from statedValue(), null unless state === 'recorded'
 *   authority: string|null,    // 'zimra_declarations' | 'trust_fact_requests' | 'source_verification_results' | ...
 *   provenance: Array<{ kind, ref, recorded_at, mode }>,  // [] iff status is unknown/not_applicable
 *   evaluated_at: string|null,
 *   calculation_version: string,
 * }}
 */
async function resolveVehicleFact(vin, factKey, ctx)
```

Non-negotiable rules for every resolver:

1. **`unknown` is the default and the only fallback.** The function starts at `UNKNOWN` and can only
   be moved by a row it actually read. No `||`, no `??`, no `!!vehicle.<flag>` anywhere in a resolver
   — the pattern at `trustGraphService.js:302` and `:311` is the defect being removed, not a fallback
   to preserve.
2. **Absence never becomes affirmative.** `no_record` and `source_unavailable` are terminal, distinct
   states and must never collapse into `verified_clear`. `verificationContract.js:26-33` already
   encodes this at the source layer; the resolver must not undo it.
3. **`provenance` is non-empty for every affirmative status.** If `status ∈ {verified_clear,
   verified_adverse, no_record}` and `provenance.length === 0`, that is a bug — fail closed to
   `unknown`. This is what makes principle 3 mechanically checkable rather than aspirational.
4. **A sandbox source is not a live confirmation.** Carry `mode` through into `provenance[].mode` and
   refuse to emit a public claim from `mode ∈ {sandbox, unavailable}`. `trustDecisionService.js:245`
   already scores sandbox as `+0`; the fact layer must be at least as strict.
5. **The stored column is never consulted.** The six columns become read-through caches of the
   resolver output, written by exactly one updater, on ADR-001's INV-TRUST-2 pattern. Reads go to the
   resolver; the column exists for indexing and for the historical record.
6. **Versioned and reproducible.** Stamp `calculation_version` and keep the resolver pure over its
   fetched inputs, the way `assembleDecision` is (`trustDecisionService.js:163-211`), so a claim can
   be replayed from recorded inputs.

### 4.4 The explicit "no authoritative record" state

Stated plainly, because it is the requirement most likely to be softened under delivery pressure:

> When no authoritative record exists for a fact, the fact is `unknown` / `not_recorded`. It is
> **never** `verified_clear`, and it is never rendered as a badge, a tag, a checkmark, a green state,
> or a filter match. `verified_clear` requires that a source was actually queried and returned an
> affirmative result, or that a reviewer approved a request over verified evidence.

Today's schema states the opposite. `NOT NULL DEFAULT false` on four of the six columns means the
database has already answered every question about every vehicle before anything was checked, and the
read path cannot tell that answer from an evaluated one. Deriving is what makes the honest answer
representable at all.

Concretely, on staging **all six facts resolve to `unknown` for all 16 vehicles**: the five registry
tables are empty, `trust_fact_requests` is empty, `escrow_trust_sessions` holds 3 rows unrelated to
`safe_pay_ready`, and `source_verification_results` holds 3 sandbox rows. That is the correct output,
and it is the same shape of consequence ADR-001 already accepted for `trust_score`.

### 4.5 Invariants this creates

- **INV-FACT-1** — every public verification claim resolves through `resolveVehicleFact`; no public
  read path reads a `vehicles` boolean directly.
- **INV-FACT-2** — each of the six facts has exactly one writer (the cache updater), mirroring
  INV-TRUST-2.
- **INV-FACT-3** — `status === 'verified_clear'` implies `provenance.length > 0` and every entry has
  `mode ∉ {sandbox, unavailable}`.
- **INV-FACT-4** — a vehicle with no authoritative record and no approved review request emits **no**
  verification tag and **no** badge.
- **INV-FACT-5** — `no_record` and `source_unavailable` never render as the affirmative claim, on any
  surface, in any audience.
- **INV-FACT-6** — resolvers are reproducible: replaying one with its recorded inputs yields the
  identical `{status, state, value}`.

---

## 5. What must NOT be rewritten

### 5.1 Data a naive backfill would corrupt

**Production hand-set flags are the primary hazard.** Issue #164 §7 forbids blind rewriting of
historical data, and ADR-001 already applied that to `trust_score`. The same reasoning is stronger
here, because these booleans have *even less* provenance: for `zimra_verified` and `safe_pay_ready`
there is no writer at all, so every non-default value in production was set by a person who had a
reason that exists nowhere in the system. A backfill that "corrects" them to `false` destroys the only
copy of that judgement; a backfill that promotes them into `zimra_declarations` or
`escrow_trust_sessions` rows manufactures registry records that no registry issued — which is worse,
because it launders a hand edit into apparent authority.

Specific hazards, in priority order:

1. **`police_verified = true` set by `securityService.js:53`.** These rows carry real, recoverable
   history: this vehicle was reported stolen and the alert was cleared. That history also lives in
   `stolen_vehicles` and in the blockchain event written at `securityService.js:56`. Overwriting the
   flag without first reading those is a data loss, and the flag alone cannot tell you which rows
   they are. **Do not touch `police_verified` before enumerating `stolen_vehicles` in production.**
   (`stolen_vehicles` does not exist on staging, so staging cannot be used to test this path.)
2. **`passport_verified = true` and `inspection_ready = true` set by
   `trustFactWorkflowService.js:101-110`.** Fully governed and fully reconstructible from
   `trust_fact_requests` + `trust_audit_events` (3514 rows on staging). These are correct data. A
   backfill must **reconcile**, not overwrite: any production row where the column says `true` and no
   approved request exists is a finding to investigate, not a row to flip.
3. **Staging fixture flags.** `marketplace_v1_staging_qa_seed.sql:43-53` sets
   `duty_paid`/`police_verified` on three vehicles and `zimra_verified`/`safe_pay_ready`/
   `inspection_ready` on one; `scripts/migrate-to-supabase.js:125-127` and `supabase_schema.sql:347`
   set more. These are safe to change *on staging*, and they are exactly the rows whose disappearance
   from the marketplace proves the migration worked. The seed file must be updated in the same change
   or the next apply reintroduces them.
4. **`duty_paid = false` / `police_verified = false` written by `POST /api/vehicles/add`.** Indistinguishable
   from the column default and from a real negative finding. They cannot be interpreted and must not
   be interpreted — they become `unknown` by derivation, and the insert should stop writing them
   (`PUBLIC_API_INVENTORY.md` §8 S3 already schedules this).
5. **`vehicle_condition_category`.** Not one of the six, but adjacent and already protected:
   `marketplaceBackfill.js:20-27` restricts writes to `locally_used` / `recently_imported`, hard-rejects
   `passport_verified` and `partsentry_checked` as targets, and excludes fixture rows via
   `getFixtureExclusion` (`marketplaceClassificationRules.js:116-128`). Any Phase 2 migration script
   must reuse those guards rather than write its own.

### 5.2 Safe migration strategy

Ordered lowest-risk first. Every step is independently shippable and independently verifiable against
the three gates. Nothing here writes to production.

**M1 — Add the resolver, change nothing else.** Implement `resolveVehicleFact` over the existing
tables. No column is written, no read path is re-pointed. Unit-test each resolver against fixture
inputs including the empty case, and assert INV-FACT-3 and INV-FACT-5 directly.
*Risk: none.* *Verify:* new `node --test` file alongside `issue164-phase1-read-contract.test.js`.

**M2 — Shadow-compare.** Run the resolvers read-only against staging and diff resolved status against
the stored boolean, per VIN, per fact. The expected result is a 100% divergence to `unknown`; anything
else is a resolver bug or an undiscovered writer. Record the diff as the migration's evidence.
*Risk: none — read-only.*

**M3 — Stop asserting negatives at creation.** Sequenced with `PUBLIC_API_INVENTORY.md` §8 S3.

> **Partly done, and the original prescription was wrong. Corrected 2026-08-19.**
>
> **`trust_score` — CLOSED.** The handler no longer writes `trust_score: 50`; it writes an explicit
> `trust_score: null` (Phase 3, INV-TRUST-2). The explicit null is load-bearing rather than redundant:
> `public.vehicles.trust_score` is `REAL DEFAULT 80.0` (`supabase_schema.sql:60`), so *omitting* the
> column would hand every new listing a fabricated 80 — worse than the 50 it replaced. Only
> `refreshCanonicalTrust()` may **STAMP** a score, i.e. write a number *together with* the
> `calculation_version` that makes it publishable. That is narrower than "may write the column":
> three other writers put numbers there today — `trustGraphService.js`, `trustEnforcementEngine.js`
> and `documentIntelligenceService.js` — which is why `PUBLIC_API_INVENTORY.md` §9 schedules
> reconciling them onto one. The invariant is about the stamp, not about the number.
>
> **`duty_paid` / `police_verified` — STILL OPEN, and this item's original advice would not have
> closed them.** M3 said to remove the writes "so new rows carry no explicit claim". That outcome is
> false of this schema: both columns are `BOOLEAN DEFAULT FALSE` (`supabase_schema.sql:57-58`), so
> deleting the write-site leaves the identical unevaluated `false` on the row — it only changes who
> is doing the inventing. This document already says so in §5.1, hazard 4: *"indistinguishable
> from the column default"*. Closing them requires the **tri-state migration scheduled in
> `PUBLIC_API_INVENTORY.md` §9** (`BOOLEAN DEFAULT FALSE` → nullable/enum), not a write-site deletion.
>
> Recorded at this length because the error is the programme's own thesis turned on itself: the
> column-DEFAULT check was run for `trust_score` in one sentence and not run for the two columns in
> the next.

*Risk: low.* Check `buildVehicleListingCandidate` / `getListingEligibility`
first — the eligibility gate runs before the insert and must not depend on the removed fields.

**M4 — Flip the public read to the resolver, staging only.** Point `deriveMarketplaceTags`
(`listingSummaryService.js:186-212`) and the six projected fields
(`publicVehicleProjection.js:48-49`) at the resolver, and emit `{value, state, status}` per
`PUBLIC_API_INVENTORY.md` §7's `*_state` convention. Expect the `duty_cleared`, `cid_clear`,
`zimra_verified`, `safe_pay_ready` and `inspection_ready` badges to vanish from every staging listing.
*Risk: medium.* `shared/types/index.ts:26,48,55,91`, `web/src/types/index.ts:74` and
`web/src/hooks/useVehicles.ts:17,61` type these as plain booleans and must accept the stated shape in
the same commit. Remove or re-point the anonymous `?dutyPaid=` / `?policeVerified=` filters
(`server.js:458-459`) — a filter over `unknown` is a filter over nothing.

**M5 — Retarget the one real writer.** Change `clearStolenStatus` (`securityService.js:50-53`) to
record a `cid_clearance_records` row or a `recordManualVerification` result
(`sourceVerificationService.js:156-190`) instead of stamping `police_verified: true`, and stop
overloading `status`. `reportVehicleStolen` (`:22`) becomes an adverse finding rather than a flag
reset.
*Risk: medium.* Cannot be exercised on staging (`stolen_vehicles` absent); needs a fixture-backed
unit test.

**M6 — Reconcile production, read-only, no writes.** Run M2's diff against production and classify
every divergence: governed (backed by `trust_fact_requests`), historical (backed by
`stolen_vehicles`), or unattributable. Publish the counts. **Do not write.** The unattributable set is
a product decision, not an engineering one — the honest options are to leave the column untouched as
a historical artifact while the public read derives, or to have a reviewer re-approve each one through
`trustFactWorkflowService`, which is exactly what that workflow is for.

**M7 — Demote the columns.** Only after M6: keep them as caches with a single writer (INV-FACT-2),
drop `NOT NULL` on `passport_verified` / `zimra_verified` / `safe_pay_ready` / `inspection_ready` so
`NULL` can mean unknown, and drop the `DEFAULT false` that currently answers the question before it is
asked. Retire `idx_vehicles_marketplace_flags`
(`20260603132036_marketplace_listing_summary_infra.sql:105-106`) if the derived read makes it dead.
*Risk: high — schema change on a live table.* Sequenced last on purpose: by M7 nothing reads the
columns, so the change is inert.

### 5.3 What this deliberately does not propose

No new tables. Every fact in §1 already has a mature owner: `zimra_declarations`,
`cid_clearance_records`, `vid_inspections`, `trust_fact_requests` + `trust_audit_events`,
`escrow_trust_sessions`, `source_verification_results`. No new review workflow — `trustFactWorkflowService`
is the model and should be extended to the remaining facts rather than duplicated (its permission
vocabulary at `trustPermissionService.js:1-29` already names them). No new provenance ledger —
`evidence_provenance_events` exists and needs consumers, not a successor. No new trust authority —
ADR-001 settled that.

---

## 6. Top 3 orphaned subsystems

**1. `evidence_provenance_events` + `provenanceService.js` — provenance exists and gates nothing.**
0 rows. Hash-chained, append-only, UPDATE/DELETE blocked at the DB
(`provenanceService.js:1-11`, `computeContentHash` `:26-41`), with a verifier
(`verifyProvenanceChain`) already exposed at `evidenceCatalogRoutes.js:81-94`. It is read by that one
authenticated endpoint and by nothing else: `completenessEvaluator.js` never opens it,
`trustFactWorkflowService.validateEvidenceForApproval` (`:229-287`) checks `verification_status` and
`evidence_type` but not the chain, and `trustDecisionService` has no provenance input. A trust fact
can therefore be approved over evidence with no chain of custody at all. Wiring this in is the single
highest-leverage change available: it converts principle 3 from a policy into a precondition, and
INV-FACT-3 is unenforceable without it.

**2. The five Zimbabwe registry record tables — authoritative external facts with one deprecated
reader.** `zimra_declarations`, `cvr_ownership_records`, `cid_clearance_records`, `vid_inspections`,
`zinara_licensing_records`, all empty, all read **only** by `trustGraphService`
(`:15-19` for the timeline; `:301,307,315,321` for scoring) — the engine ADR-001 deprecates. The
canonical authority never opens them (`trustDecisionService.js:302`). Two of the five are written only
by `documentIntelligenceService.js:337,348`, which fabricates duty amounts (`50000`), exchange rates
(`13.5`) and owner identifiers (`:339-343`). These tables are where four of the six facts in §1 must
get their authority, so retiring `trustGraphService` without re-homing these reads would strand the
external-fact layer entirely.

**3. The evidence source-registry layer — `evidence_sources`, `source_records`,
`evidence_class_taxonomy`, `evidence_sets`.** `evidence_sources` (5 rows) is reachable only through
`GET /api/evidence/sources`; its `sourcePermitsClass` guard (`sourceRegistryService.js:41-53`) is
never called on a governed fact. `vehicle_evidence.source_id` is nullable and unvalidated at write, so
evidence can exist with no declared source — which is the "3 provenance before claims" gap restated at
the artifact level. `source_records` (0 rows, `ingestionService.js:28`) and `evidence_sets` (0 rows,
`evidenceSetService.js:10`) have no governed consumer. `evidence_class_taxonomy` (59 rows) is worse
than orphaned: it duplicates the runtime vocabulary that actually governs validation
(`evidenceTaxonomy.js:1-13`) with nothing detecting drift between them.

**Dishonourable mention — `vehicle_listing_summaries` is entirely dead.** Created at
`20260603132036_marketplace_listing_summary_infra.sql:60-105` with its own `plate_verified`,
`passport_verified`, `duty_cleared`, `cid_clear`, `partsentry_checked` booleans and a
`seller_display_label` defaulted to the literal `'Private seller'` (`:94`). 0 rows on staging and
**zero references in the entire repository** — the only surviving trace is the governance string
`'vehicle_listing_summaries_refresh'` (`trustPermissionService.js:30`). It is a second materialized
convenience-flag surface that would have reproduced every defect in §1 one layer down. It should be
dropped, not populated.

---

## 7. Verification note

Analysis only; no source file was modified, so the three gates are unchanged from the `01ad3fad`
baseline: `npx tsc --noEmit --project web/tsconfig.app.json` exit 0 · `cd web && npx vitest run` ·
`node --test backend/tests/issue164-phase0-public-projection.test.js
backend/tests/issue164-phase1-read-contract.test.js backend/tests/db-compat-legacy-scopes.test.js`
57 passed.

> **Correction (Phase 5 close-out).** This note previously recorded the type gate as
> `npx tsc -b --force --pretty false` exit 0. **That command has never worked in this repository
> and could not have returned exit 0.** There is no root `tsconfig.json` — `git log --all --
> tsconfig.json` is empty, and the file is absent from the `c662d1a4` tree — so `tsc -b` exits **1**
> with `error TS5083: Cannot read file '<repo>/tsconfig.json'`. The recorded "exit 0" was an
> artifact of reading the exit status of a pipeline (`… | head`) rather than of `tsc`. The working
> type gate is the `--project web/tsconfig.app.json` form above, re-measured at the current tree as
> **exit 0**. The same false claim appeared in `PUBLIC_API_INVENTORY.md` §10 and is corrected there.
>
> The vitest count is left unnumbered rather than restated: it must be run with cwd `web/`, because
> `src/lib/service-worker.test.ts` resolves `process.cwd() + "public/sw.js"`, and the 812/91 figure
> was taken at the `01ad3fad` baseline, not at this tree. Re-measured at the Phase 5 close-out for
> the record: **95 files / 977 tests, 0 fail**, and the type gate above **exit 0**.

> **Row-count re-measurement (Phase 5 close-out, read-only on `eoyenigwevnxwwhyhaer`).** Every
> `0 rows` claim in §§3–5 still reproduces exactly — `vehicle_listing_summaries`,
> `trust_fact_requests`, `source_records`, `evidence_sets` and `evidence_provenance_events` are all
> still empty, so the orphan/dead-table verdicts built on them stand unchanged.
>
> **One number is now stale by construction and is reclassified rather than refreshed:**
> `trust_audit_events` is recorded as `3514 rows` and measures **3515** today. It is an append-only
> hash-chained audit table, so any exact count in a document is a timestamp, not a fact — it was
> already wrong the moment it was written. Read it as **"non-trivially populated, and growing"**,
> which is the only property the surrounding argument (*"live and correct — the model to reuse"*)
> actually rests on. The `0 rows` counts are different in kind: for those, zero-versus-nonzero is
> the whole claim, which is why they are worth re-measuring and this one is not.

Staging reads used to establish §0 and the row counts in §3 were read-only
(`information_schema.columns`, `pg_stat_user_tables`, `to_regclass`, and one `SELECT` over
`vehicles`). No database write was performed.
