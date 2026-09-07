# S5 — Service Record, Mileage, PartSentry and Evidence — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

## 1. What S5 builds

The source record of what a garage actually did, plus governed links to the parts and
evidence authorities (plan §7.5, §12, §13).

**Schema** — `20260904160000_service_network_s5_service_records.sql`:
- `service_records` — work performed, service category, **provenance strength**, money,
  `performed_at` (the real-world service time, distinct from when it was typed in), and a
  `CHECK (total_cost IS NULL OR currency IS NOT NULL)` so money integrity is a database
  guarantee rather than a convention.
- `service_mileage_observations` — readings **observed** during service, with their own
  provenance. Never a canonical odometer write.
- `service_record_parts` / `service_record_evidence` — unique governed **references** to
  `partsentry_logs` rows and evidence rows. Neither authority is duplicated or
  re-implemented.
- All four: service-role-only, FORCE RLS, zero policies, sequences revoked from clients.

## 2. The mileage authority decision (plan §13.1)

S0 required this to be adjudicated before any service record wrote mileage. The measured
situation: `vehicles.mileage` has exactly **one** application writer,
`partsentryService.addRepairLog`, which applies a monotonic guard
(`mileage < vehicle.mileage` → reject) and then overwrites — behaviour pinned by
`partsentry-write-truth.test.js` and the golden vehicle specs.

**S5 adds no second canonical-mileage writer.** A reading taken during service is recorded
as an observation and `vehicles.mileage` is never touched. Two consequences were designed
deliberately:

- A reading that **disagrees** with the canonical odometer is still recorded, and the
  disagreement is reported (`disagrees_with_canonical`), rather than being silently
  discarded — the disagreement is the useful signal.
- When there is no canonical odometer to compare against, the answer is `null` — **unknown,
  not "agrees"** (Invariant 10).

Canonical odometer *resolution* is deliberately left outside Foundation 1.0. The real-PostgreSQL
harness proves the property directly: it writes an observation and re-reads `vehicles.mileage`
to confirm it did not move.

## 3. Authority decisions honoured

| Rule | How S5 satisfies it |
|---|---|
| Mileage authority (§13.1) | No second canonical writer; observations only — proven against real PostgreSQL |
| PartSentry owns part records (§13) | Parts are **linked**, never re-implemented; a log from another vehicle or another garage cannot be attached |
| Evidence authority owns evidence (§12) | Evidence is **linked**; cross-vehicle evidence refused |
| Provenance vocabulary (§6.6) | Closed CHECK over the seven values; a strict superset of Passport's `SERVICE_AUTHORITIES` — extended, never forked. `verified_repair` and friends are refused |
| No unearned claims | `evidence_backed` is **earned** by actually attaching evidence — it is never accepted from a client and never assumed |
| Honest defaults | Provenance defaults to `unknown`, not to a flattering value |
| Money (§24.4) | Cost requires an ISO-4217 currency (DB CHECK **and** service); an absent cost stays absent, never zero |
| Terminal work is historical | No service can be recorded against a completed/cancelled work order |
| Tenant safety | Cross-tenant record, read and observation attempts all read as **404** |
| Private text stays private | `work_performed` is a source field; S6 governs what may be projected |

## 4. Verification — commands and results

| Gate | Command | Result |
|---|---|---|
| S5 migration proof (real PostgreSQL) | `node database/test/service_network_s5_check.mjs` | **PASS** — RLS + sequence grants on all four tables, provenance CHECK admits the seven and refuses invented strengths, cost-without-currency refused (23514), **observation leaves `vehicles.mileage` unchanged**, disagreeing and negative readings handled, part/evidence double-attach refused (23505), Down/re-Up with the odometer intact |
| S5 service contracts | `node --test backend/tests/service-network-s5-service-record.test.js` | **PASS** — 14/14 |
| Full backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4429 tests, **4408 pass, 0 fail**, 21 skipped, 48 suites. S4 baseline was 4414/0 fail → +15 tests, **zero regressions** |

CI-wired via `backend/tests/service-network-s5-service-record-migration.test.js`.
`mockSupabase.UNIQUE_INDEXES` gained both S5 link constraints — without them the mock
accepted a duplicate attach that real PostgreSQL refuses, which is precisely the class of
false pass that registry exists to prevent.

## 5. Deliberately NOT in S5

Canonical odometer resolution (left with PartSentry); Passport projection of service
records (S6); Intelligence instrumentation (S7); any change to `partsentryService` or to
the Evidence taxonomy; and any public exposure of `work_performed` free text.

## 6. `[#194-sensitive]` items for the rebase

- #194's `passportServicePartsProjection.js` freezes `SERVICE_AUTHORITIES` as
  {professional_governed, owner_declared, partner_record, unknown}. S5's vocabulary is a
  **superset**; S6 must extend that set rather than fork it, and the S0 re-run must confirm
  the extension lands in the merged file.
- Evidence taxonomy additions, if S6 needs them, must be made module + seed-migration in
  lockstep per the existing `20260621120000` pattern.
