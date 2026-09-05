# CarUp — Live OCR Operationalization: Plan & Certification Contract

- **Lane:** `fix/o2-live-ocr-operationalization`, branched from
  `feat/operations-o2-people-compliance@71b81d74` · opened 2026-09-04
- **Purpose (single):** make document field extraction genuinely image-based and
  production-honest, preserving the certified candidate → confirmation → governed-decision
  boundary. O2 stays frozen; PR #208 stays draft/unmerged.

## The law this lane must not touch

OCR extraction **≠** identity verification. OCR may produce machine candidates, provider
provenance, confidence and quality observations, and may report missing fields. OCR may never
produce identity approval, Dealer Compliance, Seller Authority, Vehicle Trust, ownership or
registration truth. The X1 boundary and its guard suite stand.

## Defects this lane closes (all read from the current source, not assumed)

| # | Defect | Evidence |
|---|---|---|
| 1 | **Extraction is not image-based at all.** `extractDocumentData` calls `askGemini` (text) with `base64Data.slice(0, 150)` — 150 characters of base64 header. The model never sees the document; any "extraction" is invention conditioned on the doc type | `documentIntelligenceService.js:95-99` |
| 2 | **Fabricated quality evidence.** `analyzeImageQuality` derives blur, glare and tamper-suspicion from an **MD5 hash** of the payload and presents them as measurements, driving `Poor_Image_Quality` / `Suspected_Tampering` verdicts | same file `:35-53` |
| 3 | **Invented candidate defaults.** `'Unknown'`, `'N/A'`, **today's date as DOB**, `'M'` as sex, `2020` as year, and the **national-ID number reused** as plate number and customs bill-entry number | same file `:170-201` |
| 4 | **Invented confidence.** `parsedData.confidenceScore \|\| 0.9`, and the identity lane falls back to the hash-derived **`blurScore` as a confidence value** | same file `:101`; `verificationSessionService.js:162,500` |

## What this lane changes

1. **Real vision.** Route extraction through the existing `askGeminiVision`, which sends the
   document bytes as `inline_data` parts and **throws** on provider failure. No base64 in a text
   prompt, ever. Authenticated-user attribution is preserved unchanged.
2. **Per-document schemas** for Zimbabwe National ID, passport, driver's licence, vehicle
   registration book and customs declaration. Only fields actually observed are output; the model
   is instructed to omit what it cannot read rather than guess.
3. **No invented defaults at runtime.** A structured candidate row is written **only when the
   fields it requires were genuinely observed**. The `ocr_national_ids` schema is NOT NULL on
   name/number/DOB/confidence — that constraint is precisely what forced the fabrication, so the
   truthful resolution is *absence of a row = absence of a candidate*, not a placeholder row. No
   migration is needed and no historical row is touched. Test-mode mocks stay behind the existing
   `NODE_ENV=test && ALLOW_OCR_MOCK=true` gate.
4. **Honest image quality (disposition B).** Hash-derived blur/glare/tamper are removed. The
   service reports what is genuinely derivable from the bytes — container format, pixel
   dimensions from the PNG/JPEG header, byte size — and returns an explicit `measured: false`
   with `not_measured` for blur, glare and tamper. No large CV subsystem is introduced to
   manufacture precision the product does not have.
5. **Provenance recorded:** provider, model, execution status, extraction timestamp, latency,
   and confidence **only when the provider genuinely supplies it** (never a substituted default,
   never a blur score).

## Out of scope (explicitly)

O2 architecture, Dealer activation, Service Network #197, biometric activation, production
deployment, provider credentials.

## Accuracy corpus and gate

Synthetic fixtures only, with machine-known expected values (national ID already recorded in
`uat-assets/FIXTURE_EXPECTED_VALUES.md`), extended with controlled variants: clean, rotated,
blurred, low-contrast/glare, cropped, non-document, unsupported document. HTTP 200 is not
success: each fixture is measured field by field — expected vs extracted, classified exact /
normalized / missing / **incorrect** — with provider, model, latency and confidence. **A
plausible but wrong value is a FAILURE; missing is preferable to fabrication.**

## Provider activation boundary

Code correction and provider activation are separate gates. No credential enters the repository,
logs or production. Without Product Owner authorization for staging-only OCR provider activation
against synthetic documents, this lane completes code + tests and stops at
**LIVE OCR CODE READY — STAGING PROVIDER AUTHORIZATION REQUIRED**.

## Privacy contract

Images travel only to the configured provider; no base64 or document content in application
logs; only provenance/result fields persist; private storage stays private; no real identity
document is ever required or used.

## Certification

New permanent regression tests (image bytes actually sent; the truncated-text path cannot
return; missing stays missing; no runtime default invention; provider-unavailable fails
honestly; malformed output fails closed; provenance retained; candidate ≠ verification; user
confirmation still required; governed reviewer remains the only identity decision writer), plus
X1, X2, 7C identity, X7 authority guards, full backend, full web, TypeScript, production build
and lint NET_NEW 0.


---

## Provider selection record (appended 2026-09-05)

The plan above was written for a single provider. Provider selection became the hard part, so the
outcome is recorded here permanently. Full measurements: the
[receipt](CARUP_LIVE_OCR_OPERATIONALIZATION_RECEIPT.md) §4D–§4E and
[uat-assets/OCR_ACCURACY_RUN_HISTORY.md](uat-assets/OCR_ACCURACY_RUN_HISTORY.md).

| Provider / model | Verdict | Reason |
|---|---|---|
| Gemini `gemini-2.5-flash` | Blocked, not rejected | Reads accurately (48 fields correct, none ever wrong) but every credential CarUp holds is metered free tier at 20 requests/day |
| Cloudflare `@cf/meta/llama-3.2-11b-vision-instruct` | **REJECTED — FABRICATION** | Shown a landscape photograph containing no document, returned a complete invented Zimbabwean identity at confidence 1, reproducibly, across three prompt variants at temperature 0. **It reads clean documents well — that is not a reason to reselect it.** Blocked in `ocrVisionProvider.js`; reinstatement requires a separately governed investigation |
| Cloudflare `@cf/qwen/qwen3.8-27b` | Leading candidate, unproven | Passed the abstention sentinel and Gate 1 (8/8 exact). Gate 2's PASS is not certifiable: the sentinel and the blurred fixture were graded on provider outages |
| Cloudflare `@cf/google/gemma-4-26b-a4b-it` | Reserve candidate | Passed the abstention sentinel; 8/8 in the schema probe; Gate 2 not reached |

**Two integration lessons worth keeping.** Workers AI models do not share one contract — Qwen
accepts Llama's top-level `image` field with HTTP 200 and silently ignores it, so a naive port
yields an extraction that never saw the document. And CarUp's own `response_format` schema was
suppressing readable fields on both candidates (4–5 of 8 instead of 8 of 8); Cloudflare documents
JSON mode as best-effort and lists neither model.

**A standing rule this round established.** The accuracy gate cannot tell "the model abstained"
from "the provider never answered". Until it can, a corpus run in which any negative or degraded
fixture failed to reach the provider is **not** a certification, however the summary line reads.


## Grader governance (appended 2026-09-05)

`backend/tests/tools/ocrAccuracyGrading.mjs` is **VERSIONED AND CHANGE-CONTROLLED**, not immutable.
It was corrected once, under Product Owner authorization, from v1 to v2 — see the
[receipt](CARUP_LIVE_OCR_OPERATIONALIZATION_RECEIPT.md) section 4F for the before/after hashes,
the defect and the offline replay proving the correction reverses a false pass.

The distinction that matters:

- **Benchmark material is immutable** — the 11 fixtures and their bytes, the manifest, expected
  values, missing-field rules, normalization and thresholds. Moving any of these to suit a
  candidate destroys the benchmark's meaning, and their hashes are checked before every
  qualification round.
- **The grader is code, and code has bugs.** v1 read an empty result as abstention without asking
  whether the model had run, so a quota refusal passed the fabrication sentinel. Freezing that bug
  would have preserved a falsehood. Fixing it requires authorization, a recorded rationale, and
  before/after hashes — never a silent edit.

The standing law the grader now enforces:

> **NO SUCCESSFUL PROVIDER/MODEL EXECUTION = NO ACCURACY PASS.**
> HTTP 200 is not evidence. A fixture the model did not demonstrably run on is INCONCLUSIVE, and
> one INCONCLUSIVE fixture makes the whole corpus non-PASS.
