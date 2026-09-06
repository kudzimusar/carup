# O2-X4 — Biometric Provider Decision

- **Status: NOT SELECTED.** No vendor is chosen, configured or integrated. The runtime resolves
  the honest null provider (`provider_state = not_configured`); configuring any vendor name
  fails loudly (`resolveBiometricProvider` throws by name). Selection is a **Product Owner
  decision** taken on evidence — never because an SDK is easiest.
- **Date:** 2026-09-03 · **Owner of the decision:** Product Owner, with a signed data-processor
  agreement as a precondition of activation.

## Decision criteria and current evidence

Candidate columns reflect publicly documented capability at the time of writing; every row
marked *verify* must be re-confirmed against current vendor documentation and a sandbox trial
before selection. Nothing here commits CarUp.

| Criterion | Veriff | Sumsub | Notes / what to verify |
|---|---|---|---|
| Zimbabwe passport / National ID / driver's licence support | Publicly lists Zimbabwe passport, ID card and driver's licence | Broad global document coverage; Zimbabwe coverage to *verify* per document type | Trial with REAL Zimbabwe documents incl. the metal-strip National ID |
| Face ↔ document comparison | Yes (documented) | Yes (documented) | Score exposure + calibration for Zimbabwean documents |
| Genuine liveness | Yes (documented active/passive) | Yes (documented) | Which liveness class; replay/deepfake resistance claims |
| Web/mobile browser support | Hosted SDK + web flows | Hosted SDK + web flows | Must run in low-end Android browsers used in Zimbabwe |
| Low-bandwidth behaviour / retry UX | *verify* | *verify* | Test on throttled 2G/3G profiles; resumable capture |
| API/SDK maturity | Mature | Mature | Webhook + REST verification of session results |
| Provider provenance/audit data | Assessment ids, timestamps | Assessment ids, timestamps | Must satisfy CarUp's provenance columns (reference, model, timestamps) |
| Retention options / deletion capability | Configurable retention; deletion API *verify* | Configurable retention; deletion API *verify* | Needed for the withdrawal → deletion_requested/completed design |
| Geographic processing / cross-border transfer | EU processing (typ.) | EU/other regions | Zimbabwe Data Protection Act cross-border conditions apply (see receipt §compliance) |
| Webhook security | Signed webhooks *verify* | Signed webhooks *verify* | Signature verification mandatory before any result is trusted |
| Pricing/commercial dependency | Per-check pricing (public tiers vary) | Per-check pricing | Commercial review outside engineering scope |
| Graceful fallback | Session expiry/retry semantics *verify* | *verify* | Must map onto CarUp's provider_failed/unavailable → manual review path |
| CarUp avoids storing raw biometric templates | Provider-held computation | Provider-held computation | HARD REQUIREMENT — any design requiring CarUp-side embeddings is rejected |

## What selection requires (in order)

1. Product Owner shortlist approval on this matrix, updated with sandbox evidence;
2. Data-processor agreement + retention/deletion terms in writing;
3. Zimbabwe compliance activation register satisfied (receipt §7 — controller obligations,
   sensitive-data consent, cross-border conditions, breach handling);
4. Vendor adapter implemented behind the existing `BiometricVerificationProvider` contract
   (raw payload in → CarUp normalization; signed-webhook verification; no client-trusted
   completion callbacks);
5. Sandbox certification (its own receipt) with REAL Zimbabwe document trials;
6. Only then: `BIOMETRIC_PROVIDER` configured per environment — production last, behind the
   LIVE-activation gate in the X4 receipt.

## Explicitly rejected shortcuts

- Choosing by SDK convenience; committing before Zimbabwe-document sandbox evidence;
- storing provider media/templates in CarUp to "simplify" retries;
- treating a client-side completion callback as a verified result;
- enabling any simulated provider outside the test suite.
