# CarUp OCR Path Convergence Hardening Receipt

**Lane:** `fix/o2-live-ocr-operationalization`  
**Starting candidate:** `b26c759c4d66c02cf5f3a615b336a8e3332624d2`  
**Scope:** close the three product-integration defects found by the stakeholder coverage audit.  
**Live provider use:** **NONE in this hardening task.**

## Governing law

> **Document Intelligence observes. Domain authorities decide.**

Identity verified ≠ Dealer compliant ≠ Seller authorised ≠ Vehicle registered ≠ Vehicle trusted.

This change does not alter the Qwen model, provider boundary, OCR corpus, grader, prompts, thresholds,
Cloudflare credentials, production, biometrics, O2 authority decisions, or Service Network.

## Problem 1 — legacy generic `/api/ai/ocr`

### Measured defect

The historical endpoint remained reachable for authenticated callers and invoked `runOcrParsing()` in
`aiServiceBus.js`. That function is not the operationalized vision path: it sends a truncated base64
prefix in an ordinary text prompt and has legacy confidence fallback behavior.

### Closure

`POST /api/ai/ocr` is now intercepted before the historical handler and returns HTTP **410** with
`LEGACY_OCR_PATH_RETIRED` after normal authentication. It is deliberately not redirected to a generic
Document Intelligence call because a context-free OCR endpoint cannot prove which domain owns the
document or what authority boundary must apply.

The dormant implementation remains only for compatibility/history; a permanent regression guard pins
that the shipped runtime reaches the retirement route first.

## Problem 2 — client-authored Diaspora OCR provenance

### Measured defect

`POST /api/diaspora/documents/:id/extractions` accepted client-supplied provider, fields, confidence and
raw response and could therefore create an `OCR_EXTRACTED` record without a provider ever executing.
The separate reviewer decision still prevented automatic verification, but the extraction record itself
could masquerade as machine evidence.

### Closure

That client-authored endpoint is intercepted before the Diaspora router and returns HTTP **410** with
`CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED` after authentication.

The genuine provider path remains:

`POST /api/diaspora/documents/:id/run-ocr`

It continues to download the private document server-side, invoke Document Intelligence, and record the
provider-generated extraction separately from the reviewer verify/reject decision.

## Problem 3 — local Owner/Seller vehicle-document OCR wiring

### Measured defect

The Qwen-backed engine supported Registration Book and Customs schemas, and CarUp already had a governed
vehicle Evidence Vault plus field-level `vehicle_document_extractions`, but no canonical local vehicle
route joined those pieces. Schema capability was therefore being mistaken for product integration.

### Closure

New governed route:

`POST /api/vehicles/:vin/evidence/:evidenceId/run-ocr`

The service:

1. requires an authenticated Owner/Dealer/Admin/Government context;
2. proves vehicle object scope from canonical owner/current-seller/tenant state;
3. refuses a former seller whose ownership transfer or explicit authority revocation supersedes stale
   listing/tenant state;
4. loads the exact `vehicle_evidence` row under the VIN;
5. requires a private `ocr-documents` artifact whose storage locator is VIN-scoped;
6. resolves OCR meaning only from canonical `evidence_class + evidence_subtype`;
7. currently supports only exact schema matches:
   - `registration/registration_book` → `registration_book`
   - `import/customs_entry` → `customs_declaration`
8. downloads the real stored bytes and sends them through `DocumentIntelligenceService.extractDocumentData`;
9. writes observed fields to the existing `vehicle_document_extractions` review queue with
   `review_status='pending'` via `persistExtractions`;
10. never changes `vehicle_evidence.verification_status`, ownership, Seller Authority, Zimbabwe
    registration lifecycle, publication status, or canonical Trust.

Unsupported canonical document classes fail before provider execution. Legacy `evidence_type` metadata
alone is deliberately insufficient to select an OCR schema.

## Permanent regression coverage

`backend/tests/o2-ocr-path-convergence.test.js` pins:

- generic OCR retirement and mount ordering;
- Diaspora client-authored extraction retirement while `/run-ocr` remains genuine;
- canonical-only vehicle document type selection;
- observed-only field mapping and null confidence preservation;
- real stored bytes reaching the injected provider seam;
- Registration Book and Customs candidate persistence;
- no mutation of vehicle/evidence authority state;
- unrelated-user refusal;
- former-seller supersession refusal;
- unsupported document refusal before provider execution;
- provider failure producing zero candidate rows and zero authority effects.

These tests use injected provider/storage/persistence seams and make **zero live Cloudflare calls**.

## Certification state after this hardening

This closes product path convergence. It does **not** certify Qwen operationally.

The next real-provider sequence remains frozen and ordered:

**Gate 0 non-document sentinel → Gate 1 clean National ID → Gate 2 unchanged 11-fixture corpus → exact-head staging → §3A stakeholder/product journey.**

A live result is acceptable only with **0 incorrect, 0 fabricated, 0 inconclusive** and with OCR
remaining candidate evidence rather than a domain authority.
