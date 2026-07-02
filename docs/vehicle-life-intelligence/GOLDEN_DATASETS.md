# Golden Vehicle Datasets (Milestone 6, master plan §13.2)

Synthetic/consented golden vehicle histories with **versioned expected findings**, used to gate AI
quality, privacy, governance, and report correctness. These are a test plan; the synthetic fixtures
build on the M2 sandbox ingestion + M3 mock provider so they run without live providers.

| # | Scenario | Inputs | Expected outcome (reviewed) |
|---|---|---|---|
| 1 | Clean, well-documented | full evidence across classes, consistent mileage | report shows high completeness, no alerts; NOT a false "perfect" — limitations still listed |
| 2 | Auction-damaged → repaired | 2021 auction damage + 2022 repair set | temporal finding `repaired`/`replaced` (pending_review → confirm); shows in report after governance |
| 3 | Mileage rollback | odometer 62k (2021) then 48k (2022) | `mileage_history.anomaly=true`; high-severity mileage alert |
| 4 | Reused listing images | same perceptual hash under two VINs | cross-vehicle reuse flagged by similarity; routed to review |
| 5 | Ambiguous identity | record with make/model/year only | `needs_identity_review`; NOT auto-attached; appears in identity queue |
| 6 | Private evidence must not leak | restricted/government_only + pending evidence | absent from public report + public APIs; visible only to privileged audience |
| 7 | Seller dispute & correction | listing "no accident" + accident evidence | disclosure `strong_conflict` (pending) → seller response → governed correction; public shows neutral/resolved state |
| 8 | Incomplete history | only current-condition evidence | completeness low; limitations explicit; NEVER presented as clean |

## How they run

- Datasets 2–5,7 seed via the M2 sandbox adapter / fixtures + M3 engines (mock provider for
  determinism). 6 & 8 assert the public-safe serialization boundaries.
- Each scenario has expected findings that are **versioned + reviewed** (master plan §13.2); changes
  to expectations require review.
- Existing automated coverage already asserts many invariants (idempotency, quarantine, identity
  routing, public-safe boundaries, mileage anomaly, governance). A dedicated
  `backend/tests/golden-datasets.test.js` should assemble each scenario end-to-end and assert the
  expected outcome — tracked as the M6B validation follow-up.

## Status

Test plan + fixtures foundation complete; the consolidated end-to-end golden harness + live-provider
quality numbers are the remaining M6B items (the latter gated on real AI samples/budget).
