# CarUp AI consumer matrix

**Programme:** One CarUp, OC-3 foundation convergence, then OC-4 source convergence
**State as of:** OC-4B (AI wave 2), on branch `feat/oc4b-ai-wave2-communications`
**Supersedes:** the AI-01-B matrix in PR #217 (head `6c8ff6f7`). That matrix was written against `main` bb9d9900, and several of its rows are no longer true on this lineage.

> **Governing law.** Document Intelligence observes; domain authorities decide. OCR output is candidate evidence. General AI output is advisory machine output. No model answer sets Trust, verifies ownership or identity, approves a listing, publishes, or moves money.

## Two Workers AI policies on one transport

```
Certified OCR    ocrVisionProvider → CloudflareVisionClient (Qwen) ─┐
                                                                    ├─ cloudflareAiTransport → Workers AI
General AI       domain adapter → carUpAiGateway → Gemma provider ─┘
```

- **One transport.** `backend/services/ai/cloudflareAiTransport.js` owns the credentials, the URL, exactly one POST, the timeout versus caller-abort distinction, failure classification and secret redaction. It chooses no model. A source test pins it as the only runtime module that builds a Workers AI URL or reads `CLOUDFLARE_API_TOKEN`.
- **Certified OCR policy.** Cloudflare with `@cf/qwen/qwen3.8-27b` is the current certified OCR authority. It is selected explicitly (`CARUP_OCR_PROVIDER` / `CARUP_OCR_MODEL`) and is never reached by fallback. OCR does not route through the general gateway, and Gemma is not selected for OCR.
- **General gateway policy.** Cloudflare with `@cf/google/gemma-4-26b-a4b-it`, pinned; any other provider or model is refused. Every answer states its nature: `machine_output`, `authority: 'advisory'`, and provenance `{ provider, model, execution }`. The gateway never throws, retries or falls back.

## Consumers

| Consumer | Path on this lineage | Status |
|---|---|---|
| Fraud advisory (`/api/ai/fraud-scan`) | `aiServiceBus.runFraudAnalysis` → `domainAdvisoryAdapter` → gateway | **Converged (wave 1).** A failure is a 503 with `verdict: 'unknown'` and `manual_review_required`, and nothing is persisted. A verdict is persisted under the model that produced it. Authenticated callers only. |
| Risk advisory (`/api/ai/risk-assessment`) | `aiServiceBus.runRiskScoring` → adapter → gateway | **Converged (wave 1).** Advisory, non-binding, not an insurance quote. No premium is produced or passed on. Authenticated callers only. |
| Marketplace assistant: listing draft, buyer guidance, price note, share copy | `marketplaceAiAssistantService` → adapter → gateway | **Converged (wave 1).** Deterministic fallback on any failure. Anonymous or merely asserted callers get the deterministic answer, `ai_reason: 'sign_in_required'`, and zero provider requests. |
| Admin moderation summary | same service, admin/government route | **Converged (wave 1).** Advisory; a human decides. |
| Identity document classifier | `documentClassifier` → `ocrVisionProvider` (Layer 2) | On the certified OCR policy (C2). |
| Document Intelligence extraction | `documentIntelligenceService` → `ocrVisionProvider` | On the certified OCR policy (OCR 1.0). |
| Evidence-image analysis | `aiVisionProvider` / `analysisProvider` | **Simulator**, labelled `simulated` (OC-3B). Scripted scenarios and the mock analysis exist only in the test-fixture runtime (OC-3B-R). No model is called. |
| Communications AI — general text (summary, suggested reply, translation, intent, entities, next-best action) | `communicationAiAssistProvider` → `domainAdvisoryAdapter.requestAdvisoryText` → gateway | **Converged (wave 2, OC-4B).** The runtime's guardrail, derivation types, preserved originals, human-approved send and high-risk routing are unchanged. A gateway failure is a governed 503/502 with no vendor fallback and no derivation. |
| Communications AI — media (audio transcription; image where the account has vision) | `communicationAiAssistProvider` → the media provider selected by `COMMUNICATION_AI_PROVIDER` (`groq`) | **GENERAL TEXT CONVERGED / MULTIMODAL DEFERRED.** Stays on the provider Communications 2.0 certified (Whisper). It is consulted only for a request that carries media; it is never a text fallback. |
| Communications Gemini provider | — | **Retired (OC-4B).** Communications 2.0 shipped with "Gemini = NOT REQUIRED", and it had no remaining role. `COMMUNICATION_AI_PROVIDER=gemini` is refused with a reason. |
| Gemini OCR provider | `ocrVisionProvider` → `GeminiClient.askGeminiVision` | **Remaining direct, not default.** Selectable only by `CARUP_OCR_PROVIDER=gemini`. |
| Legacy client | `GeminiClient.js` | **Vision only (OC-4B).** The text path (`askGemini`, `askGeminiWithProvenance`) and its scripted reply are retired; the sole consumer is the non-default Gemini OCR provider. Vision failures are typed (`AiProviderError`). |
| Generic OCR parser | `aiServiceBus.runOcrParsing` / `/api/ai/ocr` | **Retired** (410). |

### Remaining direct model-vendor modules

`backend/tests/oc3e-w1-ai-consumer-convergence.test.js` pins this list exactly, so it can only shrink:

1. `GeminiClient.js` (vision only)
2. `ocrVisionProvider.js` (the non-default Gemini OCR provider)
3. `communicationGroqProvider.js` (Communications media only)

`communicationGeminiProvider.js` left the list in OC-4B.

### Health truth (OC-4B)

`/api/health` reports what runs, not which vendor keys exist:

- `ai: { provider, model, configured, authority: 'advisory' }` is the general gateway runtime.
- `ocr` is the canonical OCR projection.
- `ocrProviders` now holds only the certified provider's flag (`cloudflare`).

The Gemini, Groq, OpenRouter and Moonshot key-presence flags are gone from health and from the metrics snapshot. OpenRouter and Moonshot keys had no client at all.

Strict OCR mode used to require a Gemini or Groq key. It now requires the **selected** OCR provider to be configured.

## Paid inference needs a proven caller: route decisions

Every endpoint that can reach a model, traced to its UI, with its OC-3E-W1 decision. The policy for real provider inference is:

**proven session → rate limit → input limit → explicit unavailable answer.**

Guests get deterministic, non-provider content until a guest-AI commercial policy is approved.

| Endpoint | UI caller (traced) | Before wave 1 | Decision |
|---|---|---|---|
| `POST /api/marketplace/ai/buyer-assistant` | `BuyerAssistantDrawer` on the public Landing page | Public. Any visitor triggered Gemini. | **Public deterministic for guests; authenticated provider call for sessions.** A guest gets safe guidance with `ai_reason: 'sign_in_required'`, and the drawer says "Sign in for AI-assisted guidance". |
| `POST /api/marketplace/ai/listing-draft` | None. The hook exists; no component calls it. | Public, paid. | Same split. Dormant in the UI. |
| `POST /api/marketplace/ai/price-estimate` | None (hook only). | Public, paid. | Same split. The deterministic all-in price stays authoritative; AI may only annotate. |
| `POST /api/marketplace/ai/share-copy` | None (hook only). | Public, paid. | Same split. |
| `POST /api/admin/marketplace/ai/moderation-summary` | `MarketplaceModeration` (admin) | Admin/government session. | **Authenticated provider call.** Advisory; a human decides. |
| `POST /api/ai/fraud-scan` | None (hook `runFraudScan` only). | Any authenticated user. | **Authenticated provider call.** Input bounded (`vin` ≤ 64, `listingTitle` ≤ 300, numeric `price`), otherwise 400 `AI_INPUT_REJECTED` before inference. |
| `POST /api/ai/risk-assessment` | None (hook `runRiskAssessment` only). | Any authenticated user. | **Authenticated provider call.** Input bounded (`vin`, numeric `mileage` and `basePrice`). |
| `POST /api/ai/ocr` | Mobile `garage.tsx` still calls it. | Retired. | **Historical/dead (410).** The mobile caller is recorded as debt. |

Supporting rules:

- **Session-proven only.** "Proven" means `authenticationMethod: 'session'`. An identity merely asserted through the dev/test `x-user-id` fallback is not proven.
- **Input limit.** Marketplace requests whose AI input serialises beyond 4,000 characters are answered deterministically with `ai_reason: 'input_too_large'`, and no provider is called.
- **Rate limit.** The limiter's test bypass header is refused in any runtime that declares a deployment, because the limiter is the cost control on authenticated inference.
- **Fraud persistence.** A fraud verdict is persisted only as advisory machine analysis. The row's `risk_score` is the model's own stated 0–100 index, or no row is written; `reasons_json` carries `{ advisory, machine_output, binding: false, source }`.

## PR #217 disposition

**Converged in parts; not merged wholesale.** OC-3C re-homed these onto the shared transport, with request bodies proven byte-identical:

- the gateway;
- capabilities;
- runtime config;
- the Gemma provider;
- the gateway test suite (34 of 36 cases unmodified).

OC-3E wave 1 gave the gateway its first consumers. #217's own matrix is superseded by this document. #217's master-plan document remains a planning reference and is not carried onto the lineage.
