# OC-4C — Native Garage OCR convergence

**Branch:** `feat/oc4c-native-garage-ocr-convergence`. It is based on the OC-4B head `a3e15e43`.

**Status:** source only. Nothing has been deployed, and no device or Expo run has been made. Device behaviour is a deferred deployed test.

## What was wrong

The native garage odometer scan (`mobile/app/(tabs)/garage.tsx`) had three defects:

1. It sent the photo to `POST /api/ai/ocr`. That route was retired and answers 410.
2. On that 410 it told the owner: "The image has been saved for manual review". It had not been saved.
3. Its durable offline queue sent a body the server never accepted:
   - the bytes went in `base64Data`, but the server only reads `file`;
   - it set `evidence_type: 'odometer_reading'`, which is not an evidence type the server accepts.

   So every queued capture failed and retried indefinitely. The queue test checked only the request header, never the body.

On the server, two more pieces were missing:

- The governed vehicle-evidence OCR route had no odometer contract.
- Document Intelligence had no odometer schema. An `odometer_reading` request silently fell back to the **business document** schema.

## The journey now

1. **Capture.** The photo is taken.
2. **Durable queue, before any network call.** It survives a failed request, an app restart, or having no signal. The queue de-duplicates the same capture.
3. **Upload.** `POST /api/vehicles/:vin/evidence/upload`:
   - `evidence_class: current_condition`, `evidence_subtype: odometer`;
   - `visibility_level: private`, so it is stored in the `ocr-documents` bucket;
   - `file`, the data URI of the photo;
   - an `Idempotency-Key` header, so a retry never creates a second evidence row;
   - authenticated and object-scoped (owner, current seller, or governed dealer).
4. **OCR.** `POST /api/vehicles/:vin/evidence/:evidenceId/run-ocr`. This is the existing vehicle-evidence authority boundary, now extended to mileage-bearing **private** photos. The request goes:
   - to Document Intelligence, using the new `odometer_reading` schema. That schema reads only the ODO total, never the trip meter. A decimal is refused, not rounded.
   - then through the OCR provider boundary to Cloudflare, using `@cf/qwen/qwen3.8-27b`.
5. **Result.** A **candidate** reading:
   - stored in `vehicle_document_extractions` as `review_status: pending`, `match_status: inconclusive`;
   - the response returns `reading: { odometer_reading, odometer_unit, status: 'candidate_pending_review' }` and `authority_effects.mileage_recorded: false`.
6. **Human review.** It uses the existing extraction review route. **Even a confirmed candidate writes no mileage.** A recorded mileage is a lifecycle consequence that only a domain authority produces, such as a reviewed service record.

What is preserved:

- **Manual fallback.** If the photo cannot be read, or OCR is unavailable, the photo is still stored as private evidence and can be reviewed by hand.
- **VIN association** is kept throughout.
- **The app never calls an AI gateway or a model for OCR.**

What the owner is told:

| Situation | Message |
|---|---|
| Candidate read | The reading, labelled "pending review", plus "does not change your vehicle's recorded mileage". |
| Not read, or OCR unavailable | "Stored as private evidence … reviewed manually". |
| Still queued | "Saved on this device; uploads automatically, once". Nothing is claimed as stored on the server until it is. |

## `/api/ai/ocr`, by caller evidence

| Item | Disposition |
|---|---|
| The route | **410, kept** for app builds in the field. It now names the replacement routes. |
| The dead `server.js` handler (shadowed by the 410) | **Removed.** |
| The `runOcrParsing` symbol | **Removed.** It had no importer left. |

Remaining product callers in `web/` and `mobile/`: **none**. The mobile source guard enforces this.

## Contract on both sides of the wire

`shared/contracts/native-odometer-capture.contract.json` is read by both test suites:

- `mobile/tests/garage-odometer-ocr.test.ts` and `mobile/tests/upload-queue-drain.test.ts`. These check the client constants and the uploader's body.
- `backend/tests/oc4c-native-odometer-ocr.test.js`. This checks that the real routes accept exactly that body.

Neither side can drift from the contract without failing.

## Tests

- **Backend** (`oc4c-native-odometer-ocr`, 8 tests). These go through the shipped app with real session auth, the real Document Intelligence, and the real Qwen provider and transport. Cloudflare is intercepted at `fetch`. They cover:
  - the native contract is accepted;
  - idempotent retry;
  - the odometer schema reaches Qwen with the stored bytes;
  - the result is a candidate, and mileage is never written, even after review confirmation;
  - unreadable photos and decimal readings produce no candidate;
  - OCR is refused for a public photo or a stranger;
  - the 410 response.
- **Mobile** (`garage-odometer-ocr`, 7 tests; `upload-queue-drain` +2). They cover:
  - the contract;
  - the upload-then-OCR journey;
  - an OCR failure or a throwing follow-up never un-uploads a capture;
  - an offline capture survives a restart and uploads once;
  - the truthful messages;
  - a source guard: no retired route, no AI endpoint, no mileage write.
- **Mutation testing:** 9 of 9 mutations killed (5 backend, 4 mobile). The 4th mobile mutation exposed a missing test, and the test was added.
- **Updated deliberately:** the OCR-lineage pins on the removed symbol and handler, and the `authority_effects` contract, which now also states `mileage_recorded: false`.
