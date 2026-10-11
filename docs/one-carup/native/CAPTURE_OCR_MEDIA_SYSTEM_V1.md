# CarUp Native Capture / OCR / Media System v1

This document records the reusable capture system implemented by OC-NATIVE-01B and closed by OC-NATIVE-LR1-R1. It does not change backend authority.

**R1 exact product candidate:** `d344f54513c934b89d00324f399ddb08432c5714`

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

`USER_CONFIRMED` is reserved for a compatible domain flow that actually records confirmation. The current Identity API exposes no extracted-field confirmation/correction mutation, so Identity does not create this state or imply that displaying OCR output means the user confirmed it.

## Capture architecture

Reusable primitives live in `mobile/components/capture/CaptureSystem.tsx`:

- CaptureShell
- DocumentTypePicker
- CaptureGuide
- CarUpCameraViewfinder
- CapturePreview
- UploadProgress
- ExtractionField
- EvidenceStatus
- RetryPanel
- PermissionPanel

The R1 camera transport is `expo-camera@17.0.10`, the Expo SDK 54-compatible line.

The reusable sequence is:

`CaptureShell → instruction → CarUpCameraViewfinder → actual captured image → CapturePreview → Retake / Use photo → upload → OCR reading → review / authority result`.

### Live viewfinder behavior

The in-app CarUp viewfinder provides:

- CarUp header/back treatment;
- real `CameraView` feed;
- capture-type framing guide;
- short neutral instruction;
- real shutter through `takePictureAsync`;
- rear-camera flash control;
- requestable, denied, permanently blocked and unavailable permission states;
- Settings handoff when the operating system permanently blocks camera access;
- actual captured image preview;
- Retake;
- Use photo / Use selfie.

Capture requests JPEG base64 for the existing private-evidence transport and explicitly requests no EXIF.

The guide is visual placement help only. It does not claim edge detection, document detection, blur scoring, glare scoring, liveness or any other computer-vision measurement.

## Reusable capture configurations

One camera foundation is reused rather than creating three unrelated implementations:

- **document** — rear camera, rectangular document guide;
- **selfie** — front camera, face-oriented guide, with explicit statement that the viewfinder performs no face/liveness detection;
- **odometer** — rear camera, wide odometer guide.

Identity front/back and selfie capture use the shared viewfinder. My Garage odometer evidence uses the same viewfinder before the existing durable queue and governed OCR candidate path.

## Selection and persistence semantics

Pressing the shutter does not persist the Identity image as the selected submission.

The flow is:

1. real camera capture;
2. local preview;
3. Retake or Use photo;
4. only **Use photo / Use selfie** writes the selected capture into the verification store.

Odometer evidence likewise requires preview acceptance before it enters the durable upload queue.

## Media separation

`mobile/components/media/NativeMedia.tsx` distinguishes public vehicle imagery from private evidence:

- VehicleImage
- EvidenceThumbnail
- PrivateDocumentPreview
- ImageGallery

A missing listing image uses an explicit neutral "No image available" state. It never substitutes stock or generated inventory.

Identity, selfie and odometer captures stay on private evidence paths and are not promoted into Marketplace media or generic analytics.

## Quality language

Allowed instructional copy includes:

- Keep all four corners inside the frame.
- Avoid glare.
- Hold the phone steady.
- Keep the full odometer display inside the frame.

The product does not claim:

- Aligned.
- Sharp.
- Perfect lighting.
- Document detected.
- Face detected.
- Liveness passed.

unless a future real measurement authority supplies that result.

## Upload / network

Exact percentage is shown only when actual progress exists. Otherwise an indeterminate progress state is used. Network failure is visually and linguistically distinct from verification failure.

The odometer path remains capture-first and can retain evidence in its durable retry queue when upload fails. A queued local capture is not described as server-side evidence until upload succeeds.

## OCR copy and extraction review

Customer stages remain small and truthful:

1. Uploading your document.
2. Reading the details.
3. Checking your submission / review state.

The product never labels OCR extraction as verified authority.

The current Identity result renders extracted values read-only because no backend Identity correction/confirmation contract exists in the authorized source. No frontend-only correction state was invented.

## R1 source certification

At exact product candidate `d344f54513c934b89d00324f399ddb08432c5714`:

- `npm test --workspace=mobile`: PASS — 6 Vitest files / 66 tests.
- `npm run test:native --workspace=mobile`: PASS — all 19 chained native guard scripts.
- `npm run test:static --workspace=mobile`: PASS — all 5 chained static scripts; verification smoke reports 59/59 checks.
- `cd mobile && npx tsc --noEmit --pretty false`: PASS.
- `npx expo install --check`: PASS — dependencies are on the expected Expo SDK 54 lines.
- `npx tsx tests/certification/offline-resilience.test.ts`: PASS — 7 checks.
- `npx tsx tests/certification/large-and-edgecases.test.ts`: PASS — 7 checks.
- Android Expo prebuild: PASS.
- iOS Expo prebuild: PASS.
- Android Expo JS export: PASS.
- iOS Expo JS export: PASS.

These are source/build-preparation checks. They are not physical-camera evidence.

## Remaining native-runtime evidence

Physical/simulator camera evidence still requires an installable native build. The current programme cannot claim device camera certification from the source checks above.

The exact install blocker and build-account gate are recorded in `OC_NATIVE_LR1_OWNER_CHECKPOINT.md`.
