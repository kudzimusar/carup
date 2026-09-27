# CarUp — OCR Trade OS Convergence Receipt

> This receipt records the forward-convergence of the accepted isolated OCR
> path-hardening onto the current CarUp Trade OS programme authority. It
> **preserves history**: it does not rewrite the earlier blocked/incomplete O2
> OCR checkpoints, which remain recorded in their own receipts on
> `fix/o2-live-ocr-operationalization`.

## A. Exact lineage

| Anchor | SHA / ref |
| --- | --- |
| Production/main authority (frozen, untouched) | `bb9d9900c700873ca57df0ac18a1a5c01f77711a` |
| Trade OS programme start (`feat/trade-os-client-demo-convergence`, PR #207) | `577428decfea6beb98e88aa8132a8a8419e3349e` |
| Accepted isolated OCR reference (`fix/o2-live-ocr-operationalization`) | `ce780bd283e981bac5556abbdcdce669df94ea2f` |
| Working branch | `fix/o2-ocr-trade-os-convergence` |
| **Final integrated candidate** | `e2961adac17a60270e246f8ff646dad068bf891a` |

Drift check: at task issue the Trade OS branch head equalled the recorded start
SHA `577428d` exactly (no advance beyond it; the OCR-owned and T8 files were
inspected and no conflicting authority change had landed). The forward-port was
therefore based directly on `577428d`. This is a **semantic forward-port of
bounded OCR changes**, not a merge or wholesale cherry-pick of the 74-commit OCR
branch.

## B. Stage 1 — convergence

### Scope decision (why this is not the O2-X1 wholesale retirement)

The isolated OCR branch bundles the O2 **X1 authority retirement** — deleting
the `/api/verification` `documentIntelligenceRouter`, `TrustService` (six-tier
person trust), `FraudService`, and `DocumentIntelligenceService.approveDocumentVerification`.
That is a separate **programme-authority** decision that has **not** been made on
the Trade OS line: those modules exist and are referenced here, and the frozen
`issue164-phase3-trust-authority.test.js` *calls* `approveDocumentVerification`
and pins that its write clears the canonical trust stamp (INV-TRUST-2). Taking
the X1 retirement would roll Trade OS trust/document authority backwards and
break a frozen test, which the task forbids. This convergence therefore
implements only the **three documented OCR closures (A/B/C)** plus the governed
provider boundary, and **preserves** the Trade OS owning authority
(V16-gated `/api/verification`, `approveDocumentVerification` as a governed
admin/government **reviewer** decision, T12.1-hardened so it forges no
government registry rows, `TrustService`/`FraudService`). Extraction observes;
the owning domain / reviewer decides.

### Closure A — legacy generic OCR

* **Previous Trade OS condition:** `POST /api/ai/ocr` → `runOcrParsing()` sent a
  100-char truncated base64 prefix to a text-only Gemini call and substituted
  `result.confidenceScore || 0.5`.
* **Implemented convergence:** `runOcrParsing()` fails closed by throwing a 410
  `LEGACY_OCR_PATH_RETIRED` error (service-level backdoor closed — not route
  order alone). `ocrConvergenceRoutes` registers `POST /api/ai/ocr → 410`
  and is mounted (prefix-less, via `identityVerificationRouter`) ahead of the
  historical `app.post('/api/ai/ocr')` handler and the Diaspora router.
* **Files:** `backend/services/ai/aiServiceBus.js`,
  `backend/routes/ocrConvergenceRoutes.js`,
  `backend/routes/identityVerificationRoutes.js`.
* **Proof:** `o2-ocr-three-problem-hardening` (problem 1),
  `o2-ocr-stakeholder-coverage` (legacy bypass CLOSED), `run-tests.js` Test 7
  asserts the 410.

### Closure B — Diaspora provenance

* **Previous Trade OS condition:** `POST /api/diaspora/documents/:id/extractions`
  accepted client-authored `extraction_provider` / `extracted_fields` /
  `confidence_score` / `raw_response` straight from the request body and recorded
  them as `OCR_EXTRACTED` provider evidence.
* **Implemented convergence:** `recordDocumentExtraction` now calls
  `normalizeProviderBackedExtraction(payload, req)` **before any DB read**. It
  refuses any runtime request not originating from the governed
  `/run-ocr` route (URL check, independent of route ordering), requires the
  server-observed result to carry `executionStatus === 'provider_succeeded'`,
  `success === true`, a `provider` and a `model`, and derives the persisted
  fields/provider/confidence from that result — discarding caller duplicates. The
  client-authored route is retired to `410 CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED`.
  A provider outage / no-execution proof can never mint an `OCR_EXTRACTED` record.
* **Files:** `backend/services/diaspora/diasporaDocumentService.js`,
  `backend/routes/ocrConvergenceRoutes.js`.
* **Proof:** `o2-ocr-three-problem-hardening` (problem 2, incl. mutation),
  `o2-ocr-adversarial-hardening`, `diaspora-ocr-route` (success now requires
  provider provenance; forged/no-execution refused).

### Closure C — local vehicle-document OCR

* **Previous Trade OS condition:** no governed Owner/Seller vehicle-document OCR
  entry point existed.
* **Implemented convergence:** `POST /api/vehicles/:vin/evidence/:evidenceId/run-ocr`
  via `vehicleDocumentOcrService.runVehicleEvidenceOcr`: proven identity +
  `authorizeRole(['owner','dealer','admin','government'])`; server-side vehicle
  scope (owner / current-seller / governed-dealer-tenant); revoked Seller
  Authority denial via `isSellerAuthorityEffectivelyDenied`; canonical
  document-artifact check; private `ocr-documents` bucket only; VIN-prefix +
  no-traversal + no-absolute-path storage guard; **canonical** evidence
  class/subtype (not legacy label) selects the OCR schema; candidate-only
  persistence via `persistExtractions`; explicit `authority_effects` all `false`.
  Supports `registration/registration_book` and `import/customs_entry`. Reuses
  the existing Document Intelligence provider boundary (no second architecture).
* **Files:** `backend/services/evidence/vehicleDocumentOcrService.js`,
  `backend/routes/ocrConvergenceRoutes.js`.
* **Proof:** `o2-ocr-three-problem-hardening` (problem 3),
  `o2-ocr-adversarial-hardening` (scope/bucket/traversal/cross-VIN/revocation),
  `o2-ocr-path-convergence`, `o2-ocr-stakeholder-coverage` (vehicle).

### Governed provider boundary (needed by B/C and by live Qwen)

Forward-ported as new files: `backend/services/ai/CloudflareVisionClient.js`,
`backend/services/ai/ocrVisionProvider.js` (Cloudflare Workers AI default =
`@cf/qwen/qwen3.8-27b`; Gemini reserve; Llama REJECTED; **no** silent fallback),
`backend/services/document-intelligence/documentMedia.js` and `documentSchemas.js`.
`DocumentIntelligenceService.extractDocumentData` was taken from the accepted OCR
service (honest provenance: `executionStatus`/`provider`/`model`/
`confidenceReported`, confidence only when the provider reports it, image quality
NOT measured) and the Trade OS `approveDocumentVerification` reviewer method was
**grafted back** (its quality gate adapted from `!qualityPassed` to
`qualityPassed === false` so honest "not measured" no longer blocks the reviewer,
keeping `issue164` green). `GeminiClient.js` gained `GEMINI_VISION_MODEL` and the
vision timeout/diagnostics. The identity gate (`verificationSessionService.evaluateOcrEvidence`
and `submitVerificationSession`) no longer substitutes an image-quality blur
score for a provider confidence — a null confidence stays null. (The X4-biometrics
and P6 self-review parts of the OCR branch's identity change were **not** ported —
out of OCR scope, and their dependencies are absent on the Trade OS line.)

### How T8 / T-authority was preserved

* T8 verify/reject/workspace/lineage and the document-verification verdict are
  untouched; `OCR_EXTRACTED` is an observation state, never `VERIFIED`.
* `approveDocumentVerification` preserved and still clears the trust stamp
  (INV-TRUST-2); it forges **no** government registry rows (T12.1) — asserted by
  the adapted `o2-x1` and `run-tests.js` Test 27.
* `/api/verification` stays gated by `authorizeSessionRole(['admin','government'])`;
  `non-seller-authority-hardening.test.js` (gated mount) and
  `issue164-phase3-trust-authority.test.js` (65/65) remain green.

### Route table before → after (OCR-relevant)

| Route | Before (Trade OS `577428d`) | After (`e2961ad`) |
| --- | --- | --- |
| `POST /api/ai/ocr` | `runOcrParsing` → Gemini truncated | **410 LEGACY_OCR_PATH_RETIRED** (shadowed + service throws) |
| `POST /api/diaspora/documents/:id/extractions` | client-authored evidence accepted | **410 CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED** + service fail-closed |
| `POST /api/diaspora/documents/:id/run-ocr` | governed, old result shape | governed, provider-observed provenance required |
| `POST /api/vehicles/:vin/evidence/:evidenceId/run-ocr` | *absent* | **governed candidate-only OCR** |
| `/api/verification` (documentIntelligenceRouter) | gated (V16) | **unchanged — preserved gated** |

## C. Stage 2 — credential-free exact-head certification

Zero live Cloudflare calls; `NODE_ENV=test`, fake Supabase.

| Suite | Result |
| --- | --- |
| `o2-ocr-three-problem-hardening` | 7 pass |
| `o2-ocr-path-convergence` | 10 pass |
| `o2-ocr-adversarial-hardening` | 13 pass |
| `o2-ocr-stakeholder-coverage` | 15 pass, 2 skip (X5 dealer-onboarding OCR absent) |
| `o2-live-ocr-operationalization` | 31 pass |
| `o2-cloudflare-ocr-provider` | 21 pass |
| `o2-ocr-accuracy-corpus` | 28 pass (grader-v2) |
| `o2-x1-document-intelligence-authority` (adapted) | 5 pass |
| `diaspora-ocr-route` | 13 pass |
| `diaspora-supabase-integration` | environmental skips |
| **Offline gate (exact CI command)** | **143 pass / 0 fail / 5 skip** |

Adversarial/mutation properties proven by execution (not source-matching):
forged provider name discarded; forged fields discarded; forged confidence cannot
become evidence; missing provider execution cannot become OCR; private-bucket,
VIN-prefix, traversal, cross-VIN scope all bite; revoked Seller Authority denies;
proven-session enforced; dealer tenant scope requires real dealer context;
provider claims (`verified:true`, confidence `1.0`) create no authoritative truth.

Frozen Trade OS owning tests green: `issue164-phase3-trust-authority` +
`non-seller-authority-hardening` = 65/65; `trade-os-t4-transaction-passport`
32/0 (from repo root). Neighbour sweep green: dealer-routes, dealer-compliance,
diaspora-workflow, diaspora-ownership-handoff, evidence-api, evidence-validation,
operations-seller-authority, operations-evidence-semantics.

Full backend `node --test tests/*.test.js` aggregate on this candidate: 5218
tests, 5048 pass, **147 fail (all pre-existing environmental** — live Supabase /
classification-provider fetch / missing optional `@electric-sql/pglite` /
cwd-relative path), 0 import/load failures introduced by this change. Verified
per-file identical to pristine `577428d` for every suite that consumes the changed
symbols; **zero regressions introduced.** (`trade-os-t8-documents.test.js` and
`run-tests.js` require a live Supabase and cannot run credential-free here; their
non-run is environmental, not a failure of this change.)

**Stage 2 acceptance:** working tree clean; OCR lane green; no provider
credentials used; no Cloudflare neuron consumption; production untouched;
candidate SHA `e2961ad` frozen and pushed.

## D. Stage 3 — live Qwen grader-v2 certification

_Live-provider certification dispatched via `workflow_dispatch` only, against the
exact candidate head. Results appended below once the run completes._

* Workflow: `.github/workflows/o2-live-ocr-accuracy.yml` (workflow_dispatch-only)
* Run id: **36287013223** · candidate SHA `e2961ad`
* Provider: Cloudflare Workers AI · Model: `@cf/qwen/qwen3.8-27b` · `ALLOW_OCR_MOCK=false`
* Grader: v2 (no successful provider execution ⇒ no accuracy PASS; quota /
  refusal / timeout / output-budget exhaustion ⇒ INCONCLUSIVE, never PASS)
* Run conclusion: **success** · workflow_dispatch · started 2026-09-27T01:55:57Z
* Provenance proof: the "Prove one real vision request" step succeeded (a real
  Workers AI Qwen vision request), and the exact-head assert confirmed
  `HEAD == e2961ad`.

### D-Results — full corpus (grader-v2, `@cf/qwen/qwen3.8-27b`)

| Fixture | Execution | Extraction status | Confidence | Neurons | Verdict |
| --- | --- | --- | --- | --- | --- |
| national-id-clean | provider_succeeded | Pending_Verification | 0.99 | 175.95 | PASS |
| national-id-rotated | provider_succeeded | Pending_Verification | 0.98 | 279.79 | PASS |
| national-id-blurred | provider_succeeded | Pending_Manual_Review | not reported | 547.15 | PASS (genuine abstention — degraded image, no fabricated fields) |
| national-id-glare | provider_succeeded | Pending_Verification | 0.98 | 206.79 | PASS |
| national-id-cropped | provider_succeeded | Pending_Verification | 0.95 | 204.17 | PASS |
| passport-clean | provider_succeeded | Pending_Verification | 0.98 | 232.30 | PASS |
| drivers-licence-clean | provider_succeeded | Pending_Verification | 0.98 | 180.30 | PASS |
| registration-book-clean | provider_succeeded | Pending_Verification | 0.98 | 250.78 | PASS |
| customs-declaration-clean | provider_succeeded | Pending_Verification | 0.98 | 279.48 | PASS |
| non-document | provider_succeeded | Pending_Manual_Review | not reported | 180.03 | PASS (genuine model execution + abstention — 0 fields, no invented identity) |
| unsupported-file | not_attempted (unsupported_media_type) | Pending_Manual_Review | — | — | PASS (refused at the media boundary, no provider call) |

**Gate verdict:** `OCR_ACCURACY_GATE: PASS` — fixtures **11/11** · fabrications **0**
· shortfalls **0** · INCONCLUSIVE **0**; field results **45 exact, 0 normalized,
6 missing, 0 incorrect, 0 inconclusive**. Total provider spend ≈ **2,536.7
neurons** across the corpus (plus one proof request). No quota exhaustion, no
provider refusal, no timeout: every required fixture genuinely executed.

**Why this is stronger than the historical "11/11".** The two fixtures the old
grader had laundered now genuinely execute and abstain honestly under grader-v2:
`national-id-blurred` ran (547 neurons, 187 s) and reported no confidence →
manual review (no fabrication); `non-document` ran (180 neurons) and returned an
empty field set (no invented identity) rather than being a quota/output-budget
failure counted as success. `unsupported-file` is refused at the correct media
boundary. Zero required fixtures are INCONCLUSIVE.

## E. Stage 4 — real product-journey certification — **BLOCKED (infrastructure)**

Stage 3 produced a valid live-provider result, so Stage 4 was authorized to
begin. It is **blocked** on environment access this cloud session does not have,
and no journey evidence is fabricated in its place:

* **No deployed exact-head preview/staging environment** for
  `fix/o2-ocr-trade-os-convergence`. The four journeys require the app deployed
  at the exact head with a live database, storage buckets and the Cloudflare
  provider wired in; this session cannot deploy, seed or drive such a stack.
* **No session-level live credentials.** Cloudflare and Supabase credentials are
  not present in this interactive session's environment (Cloudflare exists only
  as GitHub Actions **secrets**, usable by the dispatched Stage-3 workflow, not by
  an interactive session). The backend cannot reach a real DB/storage/provider
  here (offline tests surface `Missing SUPABASE_URL` / `fetch failed`).
* **Dealer journey OCR path absent (X5 residual).** Journey 2's governed dealer
  onboarding OCR (`dealer/dealerOnboardingService.js :: runOwnDealerDocumentOcr`)
  is an O2-X5 feature not present on the Trade OS line, so the Dealer OCR journey
  cannot be exercised here even against a deployed environment. The governed
  dealer BUSINESS document *schema* is proven offline.

**Supporting (NOT a substitute for Stage 4) — journey invariants proven at the
route/service level by the Stage-2 offline suites, and the same governed provider
boundary proven live in Stage 3:**

* **Person Identity** — `verificationSessionService`: extraction is candidate
  only; `evaluateOcrEvidence` refuses to verify on an unreported confidence and no
  longer substitutes an image-quality number; a session reaches at most
  `PARTIALLY_TRUSTED` from extraction. (verification-session-workflow / stakeholder
  suites.)
* **Dealer** — the dealer BUSINESS document schema routes apart from identity
  schemas; the governed onboarding-OCR service is an X5 residual (above).
* **Diaspora** — genuine `/documents/:id/run-ocr` records provider provenance and
  `OCR_EXTRACTED` (never `VERIFIED`); the client-authored `/extractions` path is
  `410 CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED` and refused at the service level.
  (diaspora-ocr-route / three-problem / adversarial suites.)
* **Owner/Seller vehicle** — `run-ocr` for `registration/registration_book` and
  `import/customs_entry` persists candidates only with `authority_effects` all
  `false`; scope/bucket/traversal/revocation guards proven adversarially.
  (three-problem / adversarial / path-convergence suites.)

These offline proofs and the live Stage-3 provider certification are recorded as
**supporting evidence only**; they are explicitly **not** represented as the
deployed Stage-4 product-journey certification, which remains outstanding pending
a staging/preview environment.

## Final disposition

* Stage 1 (forward-convergence): **COMPLETE**.
* Stage 2 (credential-free exact-head recertification): **COMPLETE** — offline
  gate 143 pass / 0 fail / documented skips; zero regressions.
* Stage 3 (live Qwen grader-v2 certification): **COMPLETE & VALID** — full corpus
  11/11 PASS, 0 fabrications, 0 shortfalls, 0 INCONCLUSIVE, exact head `e2961ad`.
* Stage 4 (deployed product-journey certification): **BLOCKED** on staging/preview
  infrastructure + session-level live DB/storage/provider access (and the Dealer
  OCR journey's absent X5 path).
* `main` (`bb9d9900…`) and production remain **untouched**.

## F. Residuals

* **O2-X1 wholesale authority retirement** (`/api/verification`, `TrustService`,
  `FraudService`, `approveDocumentVerification`) is a separate programme decision
  NOT taken on the Trade OS line — deliberately out of OCR-convergence scope.
* **O2-X2 registration-journey** and **O2-X5 dealer-onboarding OCR**
  (`runOwnDealerDocumentOcr`) features are absent on the Trade OS line; the
  stakeholder suite's probes of them are skipped with explicit deferral notes,
  and the governed dealer BUSINESS document schema is still proven.
* **Garage/Mechanic business OCR** deferred (Service Network absent) — no
  garage/mechanic document class invented.
* Live provider cost/quota is bounded to the single authorized full-corpus run.
