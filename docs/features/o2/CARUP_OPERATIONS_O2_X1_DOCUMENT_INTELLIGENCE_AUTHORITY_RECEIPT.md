# O2-X1 — Document Intelligence Authority Reconciliation: Certification Receipt

- **Branch:** `feat/operations-o2-people-compliance`
- **Starting head:** `eb33f778` (X0 docs) · **Code commit:** `5e996a7c` · **Date:** 2026-09-03
- **Scope executed:** X1 ONLY. X2–X7 not started; **P7 remains BLOCKED / NOT EXECUTED**; P1/P1-C untouched.
- **Result:**

> **Document Intelligence extracts and assesses. Identity Verification, Dealer Compliance,
> Seller Authority, Vehicle Passport/registration and canonical Trust remain the only
> authorities for their respective facts.**

## 1. What X1 found (inventory, step X1.1)

The full protocol answers live in the plan's "X1 executed" section
(`CARUP_OPERATIONS_O2_IDENTITY_ONBOARDING_EXPANSION_PLAN.md`) and the discovery §5 X1 addendum.
The decisive facts:

- `POST /api/verification/ocr/:id/approve` → `approveDocumentVerification` was the most serious
  path: on machine+match checks it wrote `cvr_ownership_records` / `zimra_declarations` rows —
  with SYNTHESIZED fallback identifiers (generated `REG_`/`LB_`/`CUS_` references, a hard-coded
  default National ID, default duty 50000, fixed exchange rate 13.5) — plus an
  `administrative_overrides` row with fabricated ip/user-agent, `ocr_documents.status='Verified'`,
  a +20 `vehicles.trust_score` bump and vehicle `status='Available'`. Those registry rows are
  consumed as FACTS by the canonical trust resolver: machine approval manufactured the facts
  canonical Trust then trusted.
- `/promote-trust` → `TrustService.assignTrustLevel` wrote a six-tier person trust
  (`kyc_profiles.overall_status`) whose only reader was `calculateUserTrustScore` — reachable
  only through the same lane's `/trust-score/:userId`. The loop was closed inside the retired
  surface. No reason codes, no reviewer attribution, no decision record anywhere in the lane.
- `/fraud-scan` (+ the auto-scan inside `/ocr` attributed to `'system_user'`) used the legacy
  `FraudService` device heuristics; no consumer existed outside the router. The governed fraud
  lane (`backend/services/fraud/*`, `fraudRoutes.js`) is a different, untouched system.
- The X0 "dangling" `/ai/ocr` + `/ai/fraud-scan` frontend calls ARE served: inline `/api/ai/*`
  routes in `backend/server.js` behind `authorizeRole()` via `aiServiceBus` — observation-only
  writes (`ai_inference_logs`, `ai_fraud_scans`, candidate `ocr_documents`). No product component
  invokes the web hook methods (OwnerDashboard's truthfulness test pins non-use).
- `DocumentIntelligenceService.extractDocumentData` has a live governed consumer
  (`diasporaRoutes.js` run-ocr) and is the natural X2 candidate-extraction engine.

## 2. Dispositions (step X1.2) — per behaviour, not one broad brush

| Component | Disposition |
|---|---|
| `extractDocumentData`, `analyzeImageQuality`, test-gated mock (`NODE_ENV=test` + `ALLOW_OCR_MOCK`) | **KEEP** — observation/extraction |
| `approveDocumentVerification` (all writes: registry, override, ocr `Verified`, vehicle status, trust) | **RETIRED** (deleted) |
| `documentIntelligenceRouter.js` + `/api/verification` mount + its path-scoped rate-limit line (`server.js`) | **RETIRED** (deleted / unmounted) |
| `POST /ocr` · `POST /ocr/:id/approve` · `POST /fraud-scan` · `GET /trust-score/:userId` · `POST /promote-trust` | **RETIRED** — all five endpoints gone; no `/api/verification` surface remains |
| `TrustService` (`assignTrustLevel`, `calculateUserTrustScore`, the Anonymous→Dealer-Certified tier vocabulary) | **RETIRED** (deleted); the linear person-tier concept is NOT migrated into O2 |
| `FraudService` (legacy device-heuristic scanner) | **RETIRED** (deleted) |
| `TrustEnforcementEngine` | **UNCHANGED** — other consumers; its two trust-penalty sites remain the register's reduced-scope OPEN entry |
| `/api/ai/*` + `aiServiceBus` | **DOCUMENTED / KEEP** — observation-only; X2 residuals recorded (default `'u1'` attribution; candidate-row fallback defaults) |
| Historical `kyc_profiles` / `trust_score_history` / `security_events` rows | **PRESERVED** — no data deleted, no migration |
| `cvr_ownership_records` / `zimra_declarations` | **zero in-product writers** now; fact-resolver reads unchanged |

No behavior was "moved to a governed domain" as a shortcut rewrite: the governed writers already
exist (7C `reviewVerificationSession`, Dealer `recordDecision`, `reviewSellerAuthority`, the
passport/evidence lanes, `refreshCanonicalTrust`) — retirement leaves them as the ONLY paths,
which is the target architecture.

## 3. Code changed (commit `5e996a7c`)

| File | Change |
|---|---|
| `backend/services/document-intelligence/documentIntelligenceRouter.js` | **deleted** |
| `backend/services/trust-service/trustService.js` | **deleted** |
| `backend/services/fraud-service/fraudService.js` | **deleted** |
| `backend/services/document-intelligence/documentIntelligenceService.js` | `approveDocumentVerification` + `UNSTAMPED_TRUST_CACHE` removed; O2-X1 boundary contract documented at the top; extraction untouched |
| `backend/server.js` | router import, gated mount and the `/api/verification` rate-limit line removed; retirement tombstone comment |
| `backend/tests/o2-x1-document-intelligence-authority.test.js` | **new** — 6 permanent guards (written RED first: 5/6 failed pre-change) |
| `backend/tests/non-seller-authority-hardening.test.js` | section-2 pins strengthened: from "gated at the mount" to "surface absent"; `authorizeSessionRole` fallback-disabled pin kept |
| `backend/tests/issue164-phase3-trust-authority.test.js` | §11 foreign-writer set 3→2; the OCR-approval unstamp test replaced by a stronger retirement pin |
| `backend/tests/v16-authority-hardening.test.js` | B7 canonical-trust writer allowlist 3→2 (structural scan unchanged) |
| `backend/tests/run-tests.js` | legacy Test 28 now asserts the retirement instead of exercising the approval chain |

**No migrations. No web changes. No staging actions. No deploys.**

## 4. Gates (all at `5e996a7c`, CI-equivalent env: `NODE_ENV=test` + placeholder Supabase/JWT + `ALLOW_OCR_MOCK=true`)

| Gate | Result |
|---|---|
| New X1 boundary suite (6 guards) | **6/6** (RED first: 5/6 failed pre-change, proving the guards bite) |
| Targeted batch: 7C verification ×6 · dealer ×2 · diaspora-ocr-route · phase-3 trust authority · v16 authority hardening · non-seller hardening · X1 suite | **204/204** |
| P1-C / O2 / seller / registration / canonical-trust batch (o2-former-seller-authorization 11/11 among them) | **118/118** |
| **Full backend suite** (`node --test backend/tests/*.test.js`) | **5795 tests / 0 fail / 21 skipped** (P1-C baseline 5789/0/21 + exactly the 6 new guards) |
| Lint regression | web-only gate (`scripts/lint-baseline-gate.mjs` lints `web/`); zero web files touched → NET-NEW 0 by construction |
| Migration integrity | no migrations added — unchanged |

Gates NOT run, and why — no PASS is claimed for any of these: the four staging UAT workflows
(exact-head pairing for this branch still deliberately absent while #194 is unmerged — the same
P7 blocker recorded at P1-C), and the GitHub-hosted CI workflows without `workflow_dispatch`
(every step reproduced locally above, the approach this repository already uses).

## 5. Consumers preventing full retirement

**None.** Every retired element had zero consumers outside the retired surface itself; the two
pre-existing test consumers (`run-tests.js` Test 28, phase-3 §11 first test) were updated to
assert the retirement — strictly stronger claims than the ones they replace.

## 6. Invariants confirmed intact

- P1/P1-C seller-authority behaviour untouched (suites green, no seller files changed).
- Canonical Vehicle Trust one-writer invariant STRENGTHENED: foreign-writer set is now two, both
  unstamping; only `refreshCanonicalTrust` stamps.
- 7C identity review remains the only identity-verification decision writer.
- Dealer Compliance, workbook/diaspora, registration lifecycle: untouched and green.
- **P7 remains BLOCKED / NOT EXECUTED.** Nothing here added pairing entries, staging migrations,
  fixtures or deployments.

## 7. Residuals handed to X2 (recorded, deliberately not fixed here)

- `aiServiceBus.runOcrParsing` defaults attribution to `'u1'` when no user id is passed
  (candidate-provenance blemish in the live `/api/ai` lane).
- Extraction's structured candidate rows carry fallback defaults (sex `'M'`, DOB today,
  year 2020, plate ← national-id field, bill-entry ← national-id field): X2 consumption rules
  must treat every `ocr_*` row as an UNCONFIRMED candidate and never auto-trust a defaulted field.
- The two `trustEnforcementEngine` penalty sites still lack a re-materialisation path — the
  register's foreign-writers entry stays OPEN at reduced scope.
- `POST /api/vehicles/:vin/evidence-sets` + extractions route object-scope gaps (R1/R2) —
  unchanged, still assigned to a dedicated hardening lane.

## Stop condition

X1 is reconciled and certified. **X2 was not begun.** The O2 candidate stops here for Product
Owner review, exactly as the core programme's merge rule requires.
