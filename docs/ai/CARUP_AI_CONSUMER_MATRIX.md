# CARUP AI CONSUMER MATRIX

**Programme:** CarUp Global AI Runtime Convergence  
**Source:** AI-01-A inventory, persisted for AI-01-B  
**Baseline main:** bb9d9900c700873ca57df0ac18a1a5c01f77711a  
**Protected OCR evidence anchor:** PR #214 at 4ec68f7e2655575a433172951898f1dd744ad0e3  
**Purpose:** preserve discovered provider/consumer/authority reality while later phases migrate consumers through the canonical CarUp AI Gateway.

> Authority correction: **Qwen is the current certified OCR authority. It is not declared the permanent OCR model.** A Gemma OCR cutover remains unresolved until a later exact-corpus evaluation and independent OCR moderator acceptance.

## Consumer inventory

| Consumer / surface | Current implementation reality | Provider / model reality | Authority boundary | Migration phase |
|---|---|---|---|---|
| Gutu / Intelligence | `backend/services/intelligence/aiIntelligenceContextService.js` builds an authenticated, closed fact context and validates answers against invention, Trust promotion and external-authority promotion. That file does not itself invoke a model. | No model/provider invocation in the governed context service itself. | Gutu may explain grounded facts; it may not invent numbers, authority or access. | AI-01-D |
| Marketplace / Seller / Buyer | `backend/services/marketplace/marketplaceAiAssistantService.js` calls the legacy Gemini client for listing drafting, buyer guidance, pricing annotation, share copy and moderation summaries, with deterministic caller-side behavior when AI is unavailable. | Direct legacy `backend/services/ai/GeminiClient.js`; Gemini 2.5 Flash endpoint in the current client. | Advisory only. Marketplace/domain services remain authoritative for listing state, Trust-derived facts, moderation and transactions. | AI-01-E |
| Communications | `backend/services/communication/communicationAiRuntimeService.js` consumes the explicit `communicationAiProviderFactory.js` boundary. The factory supports Groq and Gemini and fails closed for unknown/unconfigured providers rather than silently switching vendors. | Provider-neutral existing boundary; configured Groq/Gemini, with Groq as the current factory default when no provider is named. | Communications runtime owns its guardrails/derivation shape; AI does not acquire domain authority. | AI-01-F |
| Identity document classification | `backend/services/identity/documentClassifier.js` is a direct provider consumer discovered in AI-01-A. | Direct Gemini Vision path on the accepted main baseline. | Classification/extraction is evidence, not Identity approval. | AI-01-G |
| Document Intelligence on frozen main | Legacy `backend/services/document-intelligence/documentIntelligenceService.js` / `GeminiClient.js` behavior remains outside the new gateway in Phase B. AI-01-A identified frozen-main pseudo-OCR behavior, including text treatment of truncated image data, that must not be copied into the canonical gateway. | Legacy Gemini-oriented path on main. | Document Intelligence observes. Domain authorities decide. This legacy path is not the certified OCR convergence authority. | AI-01-G |
| Certified OCR convergence lane | Protected PR #214 introduces `backend/services/ai/ocrVisionProvider.js` plus `CloudflareVisionClient.js`, with explicit provider selection and no automatic provider fallback. | **Current certified OCR authority:** Cloudflare Workers AI + `@cf/qwen/qwen3.8-27b`. Gemma transport compatibility is evidenced, but Gemma is not selected for OCR. | OCR output is candidate evidence only. Qwen is current certified authority, not permanent. Any Gemma cutover requires later exact-corpus proof and OCR moderator acceptance. | AI-01-G / AI-01-I evaluation; OCR moderator decides cutover |
| Vehicle Passport AI advisory | `backend/services/passport/passportAiAdvisory.js` is a governed advisory envelope/validator. Its permanent anti-fork test asserts that it contains no model invocation, rule-engine fork or database access. | No direct provider/model invocation in this advisory module. | Explain, summarize, guide and recommend only; cannot set Trust, verify ownership, certify evidence, publish, reserve or mutate lifecycle authority. | Preserve in Phase B; wire only through the appropriate later owning consumer phase |
| Generic AI service bus | `backend/services/ai/aiServiceBus.js` directly imports `askGemini` for fraud analysis, OCR parsing and risk scoring; its OCR path places only a truncated base64 prefix into text. | Direct legacy Gemini client. | Existing behavior is not promoted to canonical authority by AI-01-B. | AI-01-H |
| Typed analysis provider | `backend/services/ai/analysisProvider.js` exposes typed tasks and a deterministic mock provider. Its live path calls `aiVisionProvider.js`; for some tasks it can fall back to the mock implementation. | The live wrapper labels results `provider: 'gemini'`, while `aiVisionProvider.js` is simulated/deterministic rather than a real Gemini invocation. | Advisory only, but the provenance is misleading and must be corrected without weakening domain boundaries. | AI-01-H |
| AI vision provider | `backend/services/ai/aiVisionProvider.js` is a simulated analysis implementation driven by `mock_ai_scenario` and deterministic defaults. | Simulated/mock, not a real provider. | Must never be represented as real provider evidence or Trust/verification truth. | AI-01-H |
| Legacy AI provider configuration | `backend/env.example` retains Gemini/Groq/OCR settings, including the historical OCR primary/fallback names. | Configuration surface only; not proof that a provider is active. | Do not delete or rewrite historical provider configuration until consumers are proven migrated. | AI-01-K retirement after proof |

## Canonical Phase-B boundary

AI-01-B adds, but does not yet migrate the consumers above:

`Domain adapter → carUpAiGateway.js → cloudflareGemmaProvider.js → Cloudflare Workers AI → @cf/google/gemma-4-26b-a4b-it`

The canonical gateway is server-side and provider-explicit. It has no silent vendor fallback and no domain-decision methods.

## Frozen known defect

The `analysisProvider.js → aiVisionProvider.js` path can emit simulated output under `provider: 'gemini'`. **This defect remains open for AI-01-H.** The existence of the canonical Phase-B gateway does not resolve it.

## Phase-B preservation statement

AI-01-B does not migrate or rewrite Gutu/Intelligence, Marketplace, Communications, Identity, Document Intelligence, Vehicle Passport advisory, `aiServiceBus.js`, `analysisProvider.js`, or `aiVisionProvider.js`. It establishes only the reusable canonical inference boundary and its offline proof.
