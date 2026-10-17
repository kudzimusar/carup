# OC-3: remaining direct-provider and legacy-ledger inventory (Phase 7)

**Regenerated from:** the code at the head of `feat/oc-3d-ledger-hardening-offline`, the end of the OC-3B-R → OC-3C → OC-3E-W1 → OC-3D lineage. The source-scan results in this inventory are pinned by tests where noted, so this document is checked against the code rather than a snapshot.

**Classifications:**
- **MIGRATED**: on the canonical path.
- **INTENTIONALLY DOMAIN-GOVERNED**: deliberately separate, under its own authority.
- **NEXT WAVE**: queued for a later convergence phase.
- **LEGACY RETIREMENT**: to be removed.
- **TEST ONLY**: unreachable outside the test-fixture runtime.

## AI

| Path | Where | Classification |
|---|---|---|
| Fraud advisory | `aiServiceBus.runFraudAnalysis` → adapter → gateway → Gemma | **MIGRATED** (OC-3E-W1) |
| Risk advisory | `aiServiceBus.runRiskScoring` → adapter → gateway | **MIGRATED** (OC-3E-W1) |
| Marketplace assistant (draft, buyer guidance, price note, share copy, moderation summary) | `marketplaceAiAssistantService` → adapter → gateway | **MIGRATED** (OC-3E-W1). Anonymous callers get no inference. |
| Cloudflare Workers AI HTTP | `cloudflareAiTransport.js`: the only builder of a run URL and the only reader of the token | **MIGRATED** (OC-3C; pinned by `oc3c-cloudflare-ai-transport.test.js`) |
| Certified OCR (Qwen) | `ocrVisionProvider` → `CloudflareVisionClient` (policy) → transport | **INTENTIONALLY DOMAIN-GOVERNED.** The OCR model authority is unchanged. Gemma is not selected for OCR. |
| Gemini OCR provider | `ocrVisionProvider` `geminiProvider` → `GeminiClient.askGeminiVision` | **NEXT WAVE / LEGACY.** Selectable only by `CARUP_OCR_PROVIDER=gemini`; not the default. It is the last runtime caller of `GeminiClient`. |
| `GeminiClient` text path (`askGemini`, `askGeminiWithProvenance`) | No runtime caller after wave 1; tests only | **LEGACY RETIREMENT** |
| Groq direct calls | `communicationGroqProvider.js` | **NEXT WAVE** (Communications) |
| Communications AI | `communicationAiProviderFactory` → Gemini / Groq providers; explicit boundary with no silent fallback | **NEXT WAVE** |
| Workbook / narration AI | None on this lineage. The O2 workbook AI assistant (X5A) lives on unmerged PR #208. The diaspora workbook services here make no model call. | **NEXT WAVE** (when #208 converges) |
| Evidence-image analysis | `aiVisionProvider` / `analysisProvider` live seam: a **simulator** labelled `simulated` | **NEXT WAVE.** A real vision provider has not been chosen; until then it stays a labelled simulator. |
| Scripted scenarios, mock analysis, Gemini canned reply, OCR sample documents, classifier mock approval | Behind `config/testFixtureGuard.js`: `NODE_ENV=test` and `ALLOW_OCR_MOCK=true`, and no declared deployment | **TEST ONLY** (OC-3B-R) |
| Government-source sandbox adapters | `sourceVerification/governmentActivation.js`, `sandboxAdapterFactory.js`: not AI; governed by their own activation; tagged `SANDBOX` | **INTENTIONALLY DOMAIN-GOVERNED** |
| `/api/ai/ocr` and the `runOcrParsing` symbol | 410 on this lineage; mobile `garage.tsx:130` still calls it | **LEGACY RETIREMENT** (the mobile caller must move to a governed OCR workflow) |
| `MOONSHOT_API_KEY` presence flag | `/api/health` and `metrics.js` report a provider that has no client | **LEGACY RETIREMENT** |

The remaining direct model-vendor modules are pinned **exactly** in `oc3e-w1-ai-consumer-convergence.test.js`: `GeminiClient.js`, `ocrVisionProvider.js`, and the two Communications providers.

## Evidence and ledger

| Item | State | Classification |
|---|---|---|
| Direct ledger writers | **One**, `blockchainService.addEvent`. The diaspora handoff now submits a request (pinned by `oc3d-ledger-write-boundary.test.js`). | **MIGRATED** |
| Fixture teardown that deletes ledger, checkpoint and provenance rows | `goldenVehicleFixture` (staging) | **OWNER DECISION.** It collides with the append-only triggers. |
| Legacy "blockchain" naming | `blockchain_events`, `services/blockchain/`, `CARUP_BLOCKCHAIN_*`; the `supabase_schema.sql` comment "Immutable ledger" is historical and not rewritten | **Compatibility names kept.** User-facing text corrected (OC-3D 4A). |
| Unprotected history: `blockchain_events` | No PostgreSQL trigger in the repository | Candidate prepared (`database/migration-candidates/oc3d/`), **not applied** |
| Unprotected history: `partsentry_logs`, `ocr_documents`, `financial_ledger` | Their only "protection" is the 004 SQLite triggers, which never parsed on PostgreSQL | **NEXT WAVE.** Extend the append-only candidate after the production audit. |
| `evidence_provenance_events` TRUNCATE | Not covered by its row triggers | Candidate prepared, **not applied** |
| Ledger retention (`vin` FK CASCADE), provenance FK CASCADE | | Candidate RESTRICT, **not applied** |
| `public_keys.user_id` CASCADE | Erasing a user erases the means to verify their historical signatures | **OWNER DECISION** |
| Unversioned hashes | Every existing ledger row and provenance row is v1. Ledger v2 is behind `CARUP_LEDGER_HASH_VERSION=2`; provenance writes v2 now. | No backfill; v1 is verified as written |
| Unverified signatures | `legacy_unverified` (placeholders, tokens, stakeholder signatures without key history) are now reported, not absorbed. Stakeholder keys are custodial, so a stakeholder signature does not give non-repudiation. | Reported (OC-3D 4H) |
| Chain forks from concurrent writers | Unique `(vin, previous_hash)` candidate that refuses to run over existing forks | Candidate, **not applied** |
| Audit write failures swallowed | `auditLogger` legacy organization write skipped without an FK-backed identity; trade-graph query audit "non-fatal"; workbook DB-export audit "skipped"; `addEvent` ignores a failed checkpoint upsert; `trustGraphService.recordTrustScoreHistory` swallows errors | **NEXT WAVE.** An audit write that can fail silently is not an audit. |
| Production-only functions | `check_blockchain_events_tamper`, `check_financial_ledger_tamper`, `check_ocr_documents_tamper`, `check_partsentry_logs_tamper` (OC-3A). Not re-verified: production catalog access was unavailable in OC-3. | **UNKNOWN** until the read-only audit |
| `ai_fraud_scans` | No advisory or status column. Rows now carry the model's own index and an advisory envelope in `reasons_json`. | Schema debt |
| Deprecated trust writer | `trustGraphService.calculateVehicleTrustScore`: exported, no runtime caller (pinned uncalled) | **LEGACY RETIREMENT** (Trust authority owns it) |
| Provenance read route | `GET /api/vehicles/:vin/evidence/:evidenceId/provenance` admits any authenticated user, with no object-authority check. Its public summary omits IPs and actor ids. | **NEXT WAVE.** Object authority, as `verify-ledger` received in OC-3B. |
| Migration hygiene | `004_add_tamper_proofing.sql` (SQLite) sits in the PostgreSQL migrations directory. `20260814085000` needs `signature_verification_logs`. PGlite is only a transitive (prisma) dependency. | **NEXT WAVE** |
