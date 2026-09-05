# CarUp OCR Three-Problem Hardening Receipt

## Scope

Follow-up hardening on top of `fix/o2-live-ocr-operationalization@3fe16f0f447324884fef2163cb46210bbfea2d89`.

This slice closes the three product-path findings from the stakeholder OCR audit without making any live Cloudflare call:

1. the historical generic `/api/ai/ocr` path retained an executable text-only/truncated-base64 parser;
2. Diaspora could record client-authored OCR-looking evidence and could mark an outage/no-reading as `OCR_EXTRACTED`;
3. local Owner/Seller vehicle OCR needed a service-level private-document authority boundary, not only a route-level one.

## Problem 1 — legacy generic OCR

`runOcrParsing()` remains exported only as a compatibility symbol. It now always throws `410 LEGACY_OCR_PATH_RETIRED` and contains no inference, no Base64 truncation, no OCR persistence and no confidence substitution.

The existing convergence route continues to return 410 earlier in normal routing, so the product has two independent fail-closed layers rather than relying on route order alone.

## Problem 2 — Diaspora provenance

`recordDocumentExtraction()` now validates the runtime source before any document/database read:

- an HTTP request must originate from `/api/diaspora/.../run-ocr`;
- the raw Document Intelligence result must report `executionStatus = provider_succeeded`;
- `success` must be true;
- provider and model must be present;
- provider, extracted fields and confidence are derived from the raw provider result, not duplicated request-body fields.

Therefore a client-authored `/extractions` request cannot mint OCR evidence even if route ordering changes, and a provider outage/no-reading cannot become `OCR_EXTRACTED`.

The schema still stores numeric zero when the provider reports no confidence because the existing Diaspora extraction column is `NOT NULL`; `raw_response.confidenceReported` remains the authority for whether a confidence measurement existed. No fake confidence is introduced.

## Problem 3 — local vehicle OCR authority

`runVehicleEvidenceOcr()` now independently enforces:

- an allowed OCR role;
- a proven session outside tests;
- platform-wide scope only for admin/platform-admin/super-admin/government;
- owner or current-seller scope for individual users;
- tenant scope only while acting in the governed dealer context.

Mere tenant membership no longer grants private vehicle-document OCR authority to an owner/member role.

The service still writes only review-pending `vehicle_document_extractions` candidates. It does not modify identity verification, Dealer Compliance, Seller Authority, vehicle registration, canonical Trust or listing publication.

## Regression guard

`backend/tests/o2-ocr-three-problem-hardening.test.js` adds zero-provider-call checks for all three closures, including:

- permanent retirement of `runOcrParsing`;
- client-authored Diaspora extraction refusal;
- provider outage/no-reading refusal;
- provider-derived Diaspora provenance;
- same-tenant non-dealer denial;
- ineligible role denial;
- route-level proven-identity and candidate-only authority contract.

## Provider / environment posture

- Qwen remains selected: `@cf/qwen/qwen3.8-27b`.
- Llama remains rejected.
- Gemma remains reserve.
- No corpus, grader, prompt, model, Cloudflare credential, Vercel environment, production, biometric, Service Network or PR #208 merge state is changed by this slice.
- No live OCR provider call is required by this hardening.
