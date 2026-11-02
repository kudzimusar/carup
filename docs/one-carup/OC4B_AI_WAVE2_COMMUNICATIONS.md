# OC-4B — AI wave 2: Communications

**Branch:** `feat/oc4b-ai-wave2-communications`. It is based on the OC-4A head `c8f7962c`, so the lineage stays linear.

**Status:** source only. Nothing is deployed. Live provider behaviour is the deferred deployed test.

## The route

```
CommunicationAiRuntimeService   (guardrail prompt, derivation types, preserved originals,
                                 human-approved send, high-risk routing — unchanged)
  → communicationAiAssistProvider
      text  → domainAdvisoryAdapter.requestAdvisoryText → CarUp AI gateway → Cloudflare Gemma
                → cloudflareAiTransport → Workers AI
      media → the media provider selected by COMMUNICATION_AI_PROVIDER (groq)   [MULTIMODAL DEFERRED]
```

**General text: converged.** Six operations now run on the gateway: summary, suggested reply, translation, intent, entity extraction and next-best action.

- A gateway failure becomes a governed error:
  - **503 `communication_ai_provider_unavailable`** for: unconfigured, unavailable, timeout, rate-limited, capacity, auth, transport.
  - **502 `communication_ai_provider_error` / `communication_ai_empty_response`** for: malformed, rejected, contract violation, empty answer.
- **No vendor fallback.** A configured Groq key is never asked to answer a text request.
- **No derivation** is recorded on failure.

**Media: multimodal deferred.** This covers audio transcription (Whisper), and images only where the Groq account has a vision model. This lineage's certified Groq account has none, so images fail closed.

The capability stays on the explicit provider that Communications 2.0 certified on staging. The media provider is consulted only for a request that carries media.

## Disposition by caller proof

| Module | Runtime callers before OC-4B | Proof | Disposition |
|---|---|---|---|
| `communicationGeminiProvider.js` | Only when `COMMUNICATION_AI_PROVIDER=gemini` | `CARUP_COMMUNICATIONS_2_PHASE_CLOSURE_MATRIX.md`: "provider = Groq · Gemini = NOT REQUIRED FOR THIS RELEASE" | **Retired.** The value `gemini` is now refused, with a reason. |
| `communicationGroqProvider.js` | The default Communications provider (text and media) | The same closure matrix: 6/6 text operations and Whisper audio PASS on staging Groq | **Kept, media only.** Text moved to the gateway. |
| `GeminiClient.askGemini` / `askGeminiWithProvenance` | None at runtime; only tests used them | Import scan: the only runtime importer of `GeminiClient` is `ocrVisionProvider` (vision) | **Retired**, together with `simulatedReply`. That function was the canned generator of a "Low" fraud verdict and a named OCR identity. |
| `GeminiClient.askGeminiVision` | The non-default Gemini OCR provider | `ocrVisionProvider.geminiProvider` | **Kept.** Its failures are now typed `AiProviderError`, with unchanged messages. |

## Gemini key is no longer required

Strict OCR mode used to refuse to boot without `GEMINI_API_KEY` or `GROQ_API_KEY`. Neither of those is the OCR authority.

`config/ocrStartupGuard.js` now asks the canonical resolver which OCR provider is selected, and requires **that** provider to be configured. As a result:

- Cloudflare credentials with no Gemini or Groq key **boot**. They used to be refused.
- A stray Gemini key with no Cloudflare credentials is **refused**. It used to boot into an OCR runtime that could not read a document.

## Health truth

`/api/health` now reports `ai: { provider, model, configured, authority }`, the general gateway runtime. `ocrProviders` holds only the certified provider's flag.

The following key-presence flags are removed:

| Flag | Removed from |
|---|---|
| `gemini`, `groq` | `/api/health` and the metrics snapshot |
| `openrouter`, `moonshot` (no client existed for either) | `/api/health`, the metrics snapshot and the root `.env.example` |

Nothing in the runtime reads a Moonshot or OpenRouter key; a test pins this.

## Recorded, not changed

**Evidence-image analysis seam.** `analysisProvider.isLiveConfigured()` still selects the labelled simulator seam when `GEMINI_API_KEY` is present. That seam calls no Gemini, so a key cannot bring Gemini back into use. OC-3 accepted "stays a labelled simulator".

- **Recommendation:** when an evidence-vision provider is chosen, select the seam by that provider's own configuration and retire the Gemini-key switch.

**Stage-4 readiness.** `o2-ocr-stage4-policy.mjs` still reports `gemini_present`. It is informational only and never used for readiness. Now that health does not report the flag, it reads `false`.

## Tests

- **`oc4b-communications-ai-convergence.test.js`** (23 tests). It covers:
  - routing of all six text operations and of media;
  - the failure map, with no fallback and no derivation;
  - the authority boundary: no send, consent, preference or campaign call, no approved send, no auto-execute;
  - vendor retirement;
  - the strict-OCR guard;
  - `/api/health` through the shipped app.

  8 of 8 mutations were killed.
- **Updated deliberately:**
  - `communications-2-ai-provider-neutrality` (selection);
  - `communications-2-product-capabilities` (the Gemini fail-closed case became the gateway fail-closed case, with no fallback);
  - `oc3b-ai-provider-failure-contract`, `ocr-mock-guard` and `oc3b-r-simulation-steering-guard` (the typed-failure and fixture-guard contracts are now proven on `askGeminiVision`);
  - the OC-3 vendor-module and AI-scope pins.
