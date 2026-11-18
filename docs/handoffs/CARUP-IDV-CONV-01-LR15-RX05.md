# LR15 identity verification contract for RX-05

Keep the existing /admin/verification page, applicant /kyc view and Expo verification routes. The current reviewer shell is the existing browser verification surface.

| Component | Authority and UI behavior |
| --- | --- |
| Capture and media | Use session upload for front, reverse and selfie. Zimbabwe national ID and driving licence require the reverse. Existing records honor their stored requirements. Upload checks MIME, encoded length, actual decoded image integrity, a 16 million pixel limit and single-frame images. A retake supersedes the current side assessment. |
| OCR | Show classification and reading separately. OCR classifies and reads each supplied side independently. When shared fields differ after normalization, the protected case displays DOCUMENT_SIDE_MISMATCH and field names. Approval is refused and review or retake remains available according to policy. Consistent overlap is a reading comparison, so authentic identity still requires separate evidence and authority. Uncompared means there were no shared values. |
| Provenance | Private case detail includes ocr_side_assessment. It carries per-side classification, extraction states, comparison and front/back field attribution. The underlying OCR provenance associates the evidence hashes and schema/version. The applicant projection preserves allowed observations and applicant confirmations separately. Queue and applicant projections exclude the side assessment. |
| Facial matching and liveness | biometric_checks reports provider_state=not_configured and both checks not_performed. Render these separately from selfie capture and reviewer disposition. Ignore legacy positive fields for biometric authority. |
| Decisions and communications | Use current revision, CSRF, reviewed case and operation-specific reviewer proof, and existing idempotency. Retain decision policy, including failure and conflict refusal. Display authoritative receipt and distinguish a queued outbox item from actual delivery. |
| Accessibility | Render textual states and a programmatically announced conflict. Keep keyboard focus within the active confirmation or preview dialog, give it back to the triggering control afterwards, and test on device. |

## O2-X4 handoff and qualification gate

Source authority is PR #208 at e65c0bb835c65abce43ea1a0407406e4bf6456bb, in backend/services/identity/biometrics/ and the recorded 20260903210000 and 20260903211000 contracts. O2-X4 defines consent, provider-normalized evidence, versioned threshold policy and an intentionally disabled provider. Reuse these boundaries for integration.

Obtain Owner and Security approval for the engine, synthetic or explicitly consented evidence, processing locations and lifecycle before collecting or analyzing biometric data. Evaluate the two operations independently. For face matching, require usable portraits on both inputs and verify wrong applicant, different document portrait, multiple faces, recapture, uncertain score and provider failure. For liveness, test fresh authorized capture, expired attempt, concurrent completion, interruption, authorized presentation/replay negatives and inconclusive results. Binding must cover applicant, case, evidence revision and operation. Persist qualified assessment metadata after authorized proof consumption. Retain minimal normalized outcomes and versions. Raw vendor payloads, templates and unsupported scores have no approved persistence path.

No new approval policy is implied. The existing technical-failure refusal remains. Evaluate proposed human-only exceptions separately with Review Product and Security.

## Runtime owners

- Identity and OCR owners validate the configured provider with approved synthetic samples across front and reverse, malformed responses, provider timeout and document/field ground truth. The local raw-text probe is independent of the configured service.
- Expo Native and Phase 7C own the clean Reanimated 4.1.7 / Worklets 0.5.1 build and escrow convergence. Use the existing identity app for physical Android and independent iOS UAT. The LR14 scratch APK is diagnostic.
- Storage and Security own managed bucket policy, malware scanning, bearer expiry/revocation, audit visibility and role parity. Continue direction B for lifecycle and deletion policy. External notification delivery is a separate operational gate.
