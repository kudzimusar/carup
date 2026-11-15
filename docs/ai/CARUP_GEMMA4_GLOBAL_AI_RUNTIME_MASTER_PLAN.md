# CARUP GEMMA 4 GLOBAL AI RUNTIME MASTER PLAN

**Programme:** CarUp Global AI Runtime Convergence  
**Canonical subordinate AI authority:** this document  
**Phase implemented in this branch:** AI-01-B only  
**Repository baseline:** main at bb9d9900c700873ca57df0ac18a1a5c01f77711a  
**Status:** Phase-B implementation candidate; moderator acceptance required before AI-01-C.

## 1. Governing law

AI MAY OBSERVE, EXTRACT, CLASSIFY, EXPLAIN, SUMMARIZE, DRAFT AND RECOMMEND. DOMAIN AUTHORITIES DECIDE.

The canonical gateway is an inference boundary. It does not approve Identity, grant Seller Authority, approve Dealer/Garage status, set Canonical Trust, verify ownership, publish listings, release SafeTrade/payment, approve finance/insurance, declare customs/government truth, or execute legal/compliance decisions.

## 2. Canonical runtime target

Provider: Cloudflare Workers AI  
Model: @cf/google/gemma-4-26b-a4b-it

Server-side inference flow:

Domain adapter
→ backend/services/ai/carUpAiGateway.js
→ backend/services/ai/cloudflareGemmaProvider.js
→ Cloudflare Workers AI
→ @cf/google/gemma-4-26b-a4b-it

The gateway exposes one reusable public inference abstraction. Domain consumers are not migrated in AI-01-B.

## 3. Phase-B files

- backend/services/ai/carUpAiGateway.js — public gateway operations and explicit result/error envelopes.
- backend/services/ai/cloudflareGemmaProvider.js — Cloudflare Workers AI transport for Gemma.
- backend/services/ai/aiCapabilities.js — supported inference capabilities and unsupported modality declaration.
- backend/services/ai/aiRuntimeConfig.js — canonical provider/model resolution plus safe configuration inspection.
- backend/tests/ai01b-carup-ai-gateway.test.js — offline transport/gateway contract proof.
- backend/env.example — explicit server-side runtime configuration names.
- docs/ai/CARUP_AI_CONSUMER_MATRIX.md — persisted AI-01-A inventory.

## 4. Public inference contract

The gateway foundation supports:

- generateText — generic text generation.
- generateJson — generic structured JSON generation.
- analyzeImage — generic image observation/explanation.
- classifyImage — generic image classification with JSON output.
- extractStructuredData — generic structured extraction from text and optionally one image.
- inspect — bounded runtime/capability inspection with provider/model/configuration presence only.

No domain-specific approval or decision methods belong in this layer.

## 5. Configuration

Canonical environment contract:

- CARUP_AI_PROVIDER=cloudflare
- CARUP_AI_MODEL=@cf/google/gemma-4-26b-a4b-it
- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_API_TOKEN

Cloudflare credentials are server-only. The gateway code lives under backend/services and no VITE_, EXPO_PUBLIC_, or NEXT_PUBLIC_ Cloudflare credential is introduced.

AI-01-B does not delete or retire existing Gemini, Groq, Qwen, OpenRouter or Moonshot configuration. Retirement is a later proof-driven phase.

## 6. Provider behavior

The Cloudflare provider:

- sends explicit system/user messages;
- supports text generation;
- requests strict JSON through output instructions and fail-closed parsing;
- uses the measured Gemma image_url content-part transport for one image;
- supports caller abort plus bounded timeout;
- returns provider/model provenance;
- classifies provider HTTP, rate-limit and capacity failures;
- rejects empty/malformed responses;
- redacts account/token values from surfaced errors;
- never silently retries through another AI provider.

Cloudflare Workers AI transport evidence for Gemma image handling was taken only from the protected OCR lane PR #214. OCR domain semantics and authority were not copied.

## 7. OCR freeze

Current certified OCR authority remains:

provider = cloudflare  
model = @cf/qwen/qwen3.8-27b

Qwen is the currently certified OCR authority. It is not declared the permanent OCR model.

AI-01-B does not change OCR provider selection, fixtures, grader, thresholds, 11/11 historical evidence, receipts, or OCR consumers. Gemma OCR compatibility/cutover remains unresolved pending later exact-corpus evaluation and independent OCR moderator acceptance.

## 8. Unsupported media

AI-01-B does not add Whisper or any audio/video model. Audio and video fail closed at the canonical gateway boundary. Existing Communications media behavior remains outside this phase.

## 9. Consumer migration phases

- AI-01-D — Gutu / Intelligence
- AI-01-E — Marketplace / Seller / Buyer
- AI-01-F — Communications
- AI-01-G — Document Intelligence and Identity
- AI-01-H — generic aiServiceBus and simulated-AI cleanup
- AI-01-I — cross-domain evaluation
- AI-01-J — staging certification
- AI-01-K — provider retirement

AI-01-C and all later phases require explicit moderator release.

## 10. Known defects intentionally not resolved in Phase B

The AI-01-A inventory proved that analysisProvider.js can surface synthetic aiVisionProvider.js output while labeling the live path as provider: gemini. That provenance defect remains open for AI-01-H.

Frozen-main Document Intelligence and generic aiServiceBus retain legacy Gemini/pseudo-OCR behavior until their governed migration phases. Existing consumer defects are not made truthful merely by creating the canonical gateway.

## 11. Phase-B certification rule

Phase B must be certifiable offline. Tests mock fetch/transport and must cover canonical configuration, text/JSON/image request construction, provider/model provenance, timeout, abort, provider/rate-limit/capacity errors, malformed response, missing credentials, unsupported modality, no fallback, no credential leakage, and the absence of domain-authority methods.

No live model invocation or production mutation is required or authorized for Phase B.
