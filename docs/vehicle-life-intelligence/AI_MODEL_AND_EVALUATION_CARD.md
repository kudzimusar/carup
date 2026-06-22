# AI Model & Evaluation Card (Milestone 3)

Implements master plan §7 (live AI/OCR/similarity layer) and §13.3 (AI quality gate).

## Provider model (master plan §7.2)

One contract (`backend/services/ai/analysisProvider.js`), multiple typed tasks, two backends:

| Backend | Mode | Status |
|---|---|---|
| `mockAnalysisProvider` | `mock` | Always available — deterministic, used in tests/CI + as fallback |
| `liveAnalysisProvider` | `live` | OCR/document/damage/manipulation route to the existing **Gemini 2.5 Flash** client (`GEMINI_API_KEY`); other vision tasks fall back to mock until wired |

`resolveAnalysisProvider()` selects live **only** when `GEMINI_API_KEY` is set and
`ALLOW_OCR_MOCK !== 'true'`; otherwise mock. No capability is claimed that isn't wired.

## Typed tasks (master plan §7.3 — no single opaque prompt)

`image_quality, viewpoint, identity_cues, plate_ocr, vin_ocr, odometer_ocr,
document_extraction, component_detection, damage_detection, repair_paint_inconsistency,
manipulation, near_duplicate, same_vehicle_similarity`.

Each runs as a durable job (`ai_analysis_jobs`) with lifecycle
`queued → processing → succeeded | failed_retryable | failed_terminal | manual_review_required | superseded`,
storing provider/model, latency, confidence, structured result, validation errors, and a
public-safe summary.

## Governance invariants (master plan §2.2)

- AI is **advisory**: a job NEVER changes `verification_status` or trust scores.
- Confidence `< 0.6` → `manual_review_required` (routes to humans, never auto-publishes).
- Temporal findings & disclosure conflicts default to `reviewer_state='pending_review'` and
  are excluded from public output until a reviewer confirms (M5).
- Raw model output / internal explanations are stripped from public responses (allowlist).

## Evaluation (master plan §7.6, §13.3)

Harness: `backend/services/ai/evaluation/runEvaluation.js` against
`evalDataset.json`. Reports **per task** (no single overall number): accuracy,
precision/recall, false-positive rate, abstention rate, average latency.

Run: `node backend/services/ai/evaluation/runEvaluation.js`

**Current numbers are MOCK-provider numbers** (deterministic; they validate the pipeline and
scoring, not real-world accuracy). They are 1.0 by construction because the mock is evaluated
against its own labels. **Real quality numbers require running the harness against the live
provider with a consented/synthetic image+document set** — that is an external/data dependency
(samples + provider budget), explicitly NOT represented as done. The harness is provider-agnostic
so `runEvaluation({ provider: liveAnalysisProvider })` produces live metrics once samples exist.

### Thresholds (initial, conservative — to be calibrated on live data)

| Task | Auto-surface? | Human review trigger |
|---|---|---|
| plate/vin/odometer OCR | advisory only | always for trust-affecting use |
| damage/manipulation | advisory only | confidence < 0.6, or any public surfacing |
| temporal replacement/damage | never auto-public | same-vehicle confidence < 0.75 → review |
| disclosure strong_conflict | never auto-public | always reviewer-confirmed before public |

High-risk public findings require conservative thresholds **and** human confirmation.
