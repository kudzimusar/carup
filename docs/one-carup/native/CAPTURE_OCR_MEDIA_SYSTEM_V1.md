# CarUp Native Capture / OCR / Media System v1

This document records the reusable capture system implemented by OC-NATIVE-01B. It does not change backend authority.

## Governing rule

**Document Intelligence observes. Domain authorities decide.**

OCR extraction is candidate information. Capture completion, upload completion and OCR completion are not verification.

## State model

The native customer state model distinguishes:

- CAPTURED
- UPLOADING
- UPLOADED
- OCR_READING
- OCR_EXTRACTED
- USER_CONFIRMED
- NEEDS_REVIEW
- UNDER_REVIEW
- DOMAIN_VERIFIED
- RETRY_REQUIRED
- REJECTED
- NETWORK_FAILED

The implementation lives in `mobile/utils/captureState.ts`.

## Capture architecture

Reusable primitives live in `mobile/components/capture/CaptureSystem.tsx`:

- CaptureShell
- DocumentTypePicker
- CaptureGuide
- CapturePreview
- UploadProgress
- ExtractionField
- EvidenceStatus
- RetryPanel
- PermissionPanel

The current camera transport remains Expo Image Picker. Therefore this phase does **not** fake a custom camera-feed/viewfinder. The native screen prepares the person, opens the operating-system camera, then presents the actual captured image for Retake / Use photo. A custom live viewfinder requires a separately approved camera-module decision.

## Media separation

`mobile/components/media/NativeMedia.tsx` distinguishes public vehicle imagery from private evidence:

- VehicleImage
- EvidenceThumbnail
- PrivateDocumentPreview
- ImageGallery

A missing listing image uses an explicit neutral "No image available" state. It never substitutes stock or generated inventory.

## Quality

No capture UI may claim "Aligned", "Sharp", "Well lit" or "Document detected" unless a real measurement source exists. Instructional copy is allowed. Image resolution, MIME type, compression bytes and private file paths remain telemetry/debug concerns rather than primary customer copy.

## Upload / network

Exact percentage is shown only when actual progress exists. Otherwise an indeterminate progress state is used. Network failure is visually and linguistically distinct from verification failure.

## OCR copy

Customer stages are intentionally small and truthful:

1. Uploading your document.
2. Reading the details.
3. Checking your submission / review state.

The product never labels OCR extraction as verified authority.

## Extraction review

When domain flows support confirmation, extracted fields should use:
- Read from your document.
- Please check.
- We couldn't read this clearly.
- You corrected this.

User correction is input, not proof.

## Privacy

Identity/evidence media stays on the private evidence path. The native layer must not promote it into Marketplace media or generic analytics. Generic telemetry must not include ID numbers, extracted identity values, private paths or document images.

## Reuse target

This system is intended for Identity, Seller, My Garage/odometer, Vehicle Passport evidence and later Import/Diaspora evidence without copying an entire new capture UI.
