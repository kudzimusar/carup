# ADR-001 — Canonical Trust Authority (Issue #164 Phase 3)

**Status:** DECIDED by lead architect. Not a product-owner question — Issue #164 §8 and
Principle 2/9 mandate the outcome; this ADR records *which existing subsystem* satisfies them.

## Decision

`backend/services/trustDecision/trustDecisionService.js` becomes the **sole canonical Trust
authority**. `vehicles.trust_score` is demoted to a **materialized cache** of
`decision.overall_trust.value`, stamped with `calculation_version`, and is written by nothing else.

`backend/services/trustGraph/trustGraphService.js` `computeVehicleTrustScore` /
`calculateVehicleTrustScore` are **deprecated as a public trust authority**.

## Why (evidence, not preference)

Issue #164 §8 requires: deterministic, auditable, versioned, reproducible, confidence separate
from score, absence never positive, one VIN = one score everywhere.

| Requirement | trustDecisionService | trustGraphService |
|---|---|---|
| Versioned | `CALCULATION_VERSION='trust-decision-1.0.0'` (:20) | none |
| Reproducible | `assembleDecision()` is **pure/no-I/O** (:doc) — replay from inputs | I/O-interleaved, not replayable |
| Absence ≠ proof | starts at **0**; "never starts from a flattering baseline" (:227-230) | starts at **70** baseline |
| Sandbox honesty | sandbox source = **+0**, explicitly (:245-246) | n/a |
| Explainable | `scoreReasons` e.g. `completeness:+35` (:238-256) | none surfaced |
| Confidence ≠ score | `evidence_confidence` dim + `scoreBand()` incl. `insufficient_evidence` (:213-224) | single number only |
| Governance | `manual_override`/`override_actor`/`override_reason` per dimension (:35-37) | none |
| Public projection | `toPublicDecision()` strips PRIVATE dims (:279-293) | none — raw metrics |
| Honest gaps | `known_limitations[]` (:262-276) | absence scored as verified |
| Dimensions preserved | 11 dims, never collapsed into "verified" | collapsed |

The trustGraph engine additionally accepts a bare denormalized boolean in place of an
authoritative record (`dutyPaidReal = !!zimra || !!vehicle.duty_paid`, :302; same for police, :311)
and scores an **empty ledger** and **zero odometer observations** as verified (:331-335) — the
exact defects Principle 9 forbids.

## Consequence that must be stated plainly

For staging vehicles with no evidence, the canonical score will be **far lower** than today's
displayed 84/80 (both of which were unfounded: 84 was hand-written by the UAT fixture, 80 came
from the 70-baseline engine). A near-zero score for an unevidenced vehicle is the **correct**
output under Principle 9, not a regression.

This is why Phase 7 (Golden Reference Vehicle) must seed **real evidence** — Golden Vehicle A
earns a high score through the pipeline; Golden Vehicle B honestly shows pending/unknown.

## Non-negotiable invariants this creates

- INV-TRUST-1: one VIN yields one `overall_trust.value` + `calculation_version` on every public surface.
- INV-TRUST-2: `vehicles.trust_score` has exactly one writer (the trust decision cache updater).
- INV-TRUST-3: a vehicle with zero evidence and zero connected sources must NOT score as `high`.
- INV-TRUST-4: the decision is reproducible — replaying `assembleDecision` with recorded inputs
  yields the identical score.

## Migration safety

`vehicles.trust_score` values on **production must not be blindly rewritten** (Issue #164 §7,
"no blind rewriting of historical data"). Recompute in shadow, diff, and only flip the read path
on staging within this programme. Production remains untouched.
