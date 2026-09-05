# CarUp OCR Three-Problem Hardening Receipt

## Scope

Follow-up hardening on top of `fix/o2-live-ocr-operationalization@3fe16f0f447324884fef2163cb46210bbfea2d89`.

This slice closes the three product-path findings from the stakeholder OCR audit without making any live Cloudflare call:

1. the historical generic `/api/ai/ocr` path retained an executable text-only/truncated-base64 parser;
2. Diaspora could record client-authored OCR-looking evidence and could mark an outage/no-reading as `OCR_EXTRACTED`;
3. local Owner/Seller vehicle OCR needed a service-level private-document authority boundary, not only a route-level one.

## Problem 1 — legacy generic OCR

`runOcrParsing()` remains exported only as a compatibility symbol. It now always throws `410 LEGACY_OCR_PATH_RETIRED` and contains no inference, no Base64 truncation, no OCR persistence and no confidence substitution.

The existing convergence route continues to return 410 earlier in normal routing, so the product has two independent fail-closed layers rather than relying on route order alone.

## Problem 2 — Diaspora provenance

`recordDocumentExtraction()` now validates the runtime source before any document/database read:

- an HTTP request must originate from `/api/diaspora/.../run-ocr`;
- the raw Document Intelligence result must report `executionStatus = provider_succeeded`;
- `success` must be true;
- provider and model must be present;
- provider, extracted fields and confidence are derived from the raw provider result, not duplicated request-body fields.

Therefore a client-authored `/extractions` request cannot mint OCR evidence even if route ordering changes, and a provider outage/no-reading cannot become `OCR_EXTRACTED`.

The schema still stores numeric zero when the provider reports no confidence because the existing Diaspora extraction column is `NOT NULL`; `raw_response.confidenceReported` remains the authority for whether a confidence measurement existed. No fake confidence is introduced.

## Problem 3 — local vehicle OCR authority

`runVehicleEvidenceOcr()` now independently enforces:

- an allowed OCR role;
- a proven session outside tests;
- platform-wide scope only for admin/platform-admin/super-admin/government;
- owner or current-seller scope for individual users;
- tenant scope only while acting in the governed dealer context.

Mere tenant membership no longer grants private vehicle-document OCR authority to an owner/member role.

The service still writes only review-pending `vehicle_document_extractions` candidates. It does not modify identity verification, Dealer Compliance, Seller Authority, vehicle registration, canonical Trust or listing publication.

## Regression guard

`backend/tests/o2-ocr-three-problem-hardening.test.js` adds zero-provider-call checks for all three closures, including:

- permanent retirement of `runOcrParsing`;
- client-authored Diaspora extraction refusal;
- provider outage/no-reading refusal;
- provider-derived Diaspora provenance;
- same-tenant non-dealer denial;
- ineligible role denial;
- route-level proven-identity and candidate-only authority contract.

## Provider / environment posture

- Qwen remains selected: `@cf/qwen/qwen3.8-27b`.
- Llama remains rejected.
- Gemma remains reserve.
- No corpus, grader, prompt, model, Cloudflare credential, Vercel environment, production, biometric, Service Network or PR #208 merge state is changed by this slice.
- No live OCR provider call is required by this hardening.

---

# Certification of the three closures

The sections above record what was *implemented*. This section records what was independently
**verified**, on the principle that an implementation commit is not evidence and a test is not
coverage until it is shown to fail when the property it names is broken.

## What the audit found in the pre-existing work

All three closures are structurally sound. Two material weaknesses were found in their **evidence**:

**1. Four guards asserted source text, not behaviour.** `problem 2: runtime persistence derives
provider fields from raw provider result` and `problem 3: vehicle OCR route still requires proven
identity` were `assert.match()` calls against file contents. Source-text assertions cannot
distinguish a working guard from a renamed one, and the first of these covers the single most
consequential anti-forgery property in Problem 2.

**2. The vehicle evidence object scope had no coverage at all.** `loadEvidenceForOcr` enforces four
distinct protections — canonical document-artifact form, the private `ocr-documents` bucket, a
VIN-scoped storage prefix, and traversal/absolute-path refusal. No test exercised any of them.

Additionally, `assertVehicleOcrActor` and `normalizeProviderBackedExtraction` both relax under
`NODE_ENV=test`, so **no test running in the suite could reach their runtime branches** — the proven
-session requirement and the no-request refusal were structurally untestable as written.

## Net-new coverage

`backend/tests/o2-ocr-adversarial-hardening.test.js` — 13 tests, zero live provider calls:

| Property | Proven by executing |
|---|---|
| Forged provider, confidence and fields are discarded, not merged | Caller sends `FORGED_PROVIDER` / `confidence 1` / extra fields; result carries the observed provider, the observed confidence and only observed fields |
| An unreported confidence is the zero sentinel, never a caller value | `confidenceReported:false` with `confidence 0.99` and caller `1` → `0` |
| Missing execution proof is refused | 7 shapes: no model, no provider, `success:false`, non-`provider_succeeded`, absent status, `mocked` status, no raw response |
| A successful read of nothing invents nothing | `extractedData` absent → `{}` fields, `0` confidence |
| Only the governed run-ocr route may record extraction | 3 accepted forms vs 6 refused, incl. `run-ocr-evil`, a traversal suffix, and the *vehicle* run-ocr route |
| The `NODE_ENV=test` passthrough does not exist at runtime | Executed with `NODE_ENV=production` |
| Evidence object scope cannot be escaped | 8 cases: two wrong buckets, foreign-VIN path, `..` traversal, absolute path, VIN-prefixed lookalike directory, absent path, photo-not-document — each asserting storage, provider and persistence were never touched |
| A foreign evidence id is not found under this VIN | Cross-VIN lookup → `NotFoundError` |
| A legacy label alone cannot select a schema | Document artifact, no canonical class → refused before provider execution |
| The governed dealer branch is live, not dead code | Matching tenant **proceeds**; foreign tenant and absent tenant refused |
| Revoked seller authority denies private document processing | `status:'revoked'` → refused before storage |
| Runtime requires a proven session | `NODE_ENV=production`: absent and `x-user-id-fallback` methods refused; `session` proceeds |
| Candidates only, under adverse conditions | A provider asserting `verified:true`/`identity_verified:true` plus a **throwing** audit sink still yields pending candidates, `pending` evidence status, six false authority effects, and no write to `vehicles`, `vehicle_evidence` or `vehicle_seller_authority` |

`backend/tests/o2-ocr-stakeholder-coverage.test.js` — 14 tests, retained from the stakeholder
coverage certification. Its pin on the **open** `/api/ai/ocr` bypass has been *flipped, not deleted*:
it now asserts each of the four original fabrications is physically absent, that executing the
retired symbol raises `410 LEGACY_OCR_PATH_RETIRED`, and that the mount ordering the retirement
depends on still holds.

One testability change was required: `normalizeProviderBackedExtraction` is now `export`ed. It is a
pure function and its behaviour is unchanged; without the export the anti-forgery property could
only be asserted against source text, which is the weakness being corrected.

## Mutation testing — proof the guards bite

A test that passes against correct code has not yet demonstrated it can fail. Each guard was
verified by breaking the implementation and confirming the suite goes red:

| Mutation | Result |
|---|---|
| Normalizer honours `payload.extraction_provider` | 13 → 12 pass (caught) |
| Normalizer honours `payload.extracted_fields` | 13 → 12 pass (caught) |
| Private-bucket check removed | 13 → 12 pass (caught) |
| VIN-prefix / traversal check removed | 13 → 9 pass (caught) |
| Runtime proven-session check removed | 13 → 12 pass (caught) |
| `isDealerTenant` no longer requires `role === 'dealer'` | 20 → 19 pass (caught) |

All six were reverted; the tree was confirmed clean before certification.

## Defect found and fixed: the retirement broke a certified O2 guard

The full backend suite at the candidate head was **red**, by one test:

```
not ok 4605 - X2: outside the test suite, extraction without a user id refuses to run — at BOTH call sites
  expected /requires the authenticated user id/
  actual   LegacyOcrPathRetiredError: The legacy generic OCR parser is retired.
```

`backend/tests/o2-x2-registration-journey.test.js` is a certified O2 attribution guard, last modified
at `71b81d74`. The three-problem hardening at `748783fe` retired `runOcrParsing`, changing the error
that guard asserts. The hardening was pushed with the suite red.

**Why CI did not catch it.** `o2-ocr-hardening-offline.yml` is path-filtered to files that look like
OCR-lane files. `o2-x2-registration-journey.test.js` does not, so it was never triggered — while
being a direct consumer of the symbol the lane retired. A path-filtered gate is only as honest as
its list of dependants.

**Fix.** The guard is corrected rather than deleted, and strengthened. Retirement *supersedes* the
attribution concern — the path can no longer extract anything for anyone — so it now asserts
`410 LEGACY_OCR_PATH_RETIRED` and additionally asserts the refusal is identical **with** a user id,
proving the refusal is retirement rather than missing attribution. Reviving the path without
attribution still fails here.

A repository-wide sweep found every test consuming the retired symbols or routes. Two were absent
from the gate — `o2-x2-registration-journey.test.js` and `diaspora-supabase-integration.test.js`.
Both are now in its path filter and its run list.

## Authoritative OCR route table

Every path in the repository that can reach document extraction:

| Route | Authorization | Extraction path | State |
|---|---|---|---|
| `POST /api/identity/verification-sessions/:sessionId/submit` | `authorizeRole()`; session scoped to `user_id === actor` | `verificationSessionService` → `extractDocumentData` | Governed |
| `POST /api/dealer-onboarding/documents/:docId/ocr` | `authorizeRole()` + `requireDealerOnboardingContext()` | `dealerOnboardingService` → `extractDocumentData` | Governed |
| `POST /api/diaspora/documents/:id/run-ocr` | `reviewerAuth` + `requireProvenIdentity()` | `diasporaRoutes` → `extractDocumentData` → `recordDocumentExtraction` | Governed |
| `POST /api/vehicles/:vin/evidence/:evidenceId/run-ocr` | `authorizeRole(['owner','dealer','admin','government'])` + `requireProvenIdentity()`, re-checked in the service | `vehicleDocumentOcrService` → `extractDocumentData` | Governed (added by this lane) |
| `POST /api/ai/ocr` | `authorizeRole()` | — | **Retired, 410** |
| `POST /api/diaspora/documents/:documentId/extractions` | `authorizeRole()` | — | **Retired, 410** |

The two retired routes still have historical handlers behind them (`server.js` and
`diasporaRoutes.js:192`). Both are shadowed by `ocrConvergenceRouter`, mounted via
`identityVerificationRoutes.js` at `server.js:399` — ahead of the legacy handler at `1929` and of
`/api/diaspora` at `417`. That ordering is asserted by index comparison in two suites, and each
retirement additionally fails closed in its own service, so neither depends on route ordering alone.

## Residual finding — reported, not changed

The identity and dealer-onboarding OCR routes do **not** compose `requireProvenIdentity()`, and
their services do not re-check `authenticationMethod`. The diaspora and vehicle routes do both.

This is a defence-in-depth asymmetry, **not a live bypass**: the only way to reach those routes
without a real session is the `x-user-id` fallback, which `isUserIdFallbackAllowed()` refuses
whenever `VERCEL_ENV`/`CARUP_ENV` is `production` or `NODE_ENV` is not test/development/local, and
`fetchSession` independently scopes the session to `user_id === actor`.

It is left unchanged because it sits outside this lane's three-defect scope and touches
already-certified O2 identity and dealer paths. Closing it is a one-line addition per route plus a
service-level re-check, and is recommended as a follow-up under O2 rather than here.

## Verification state

- Full backend suite from repo ROOT under the CI env contract, run twice (6072 tests, 21 skipped):

  | | Before the fix | After the fix |
  |---|---|---|
  | `X2 … BOTH call sites` | **not ok** | ok |
  | `rate limit returns 429 after N` | ok | **not ok** |
  | Totals | 6050 pass / 1 fail | 6050 pass / 1 fail |

  The X2 defect is closed. The rate-limit failure in the second run is an environment flake, not a
  regression: it is in `navigation-analytics.test.js`, which this lane does not touch; it errors with
  `fetch failed` from a locally-bound server; it passed in the first full run; and it passes
  **25/25 twice** in isolation. The machine was in swap exhaustion (7.5 GB of 8 GB) throughout, the
  known cause of socket/port flakes in this repository. It is reported rather than suppressed — no
  retry, skip or threshold was added to make the number look clean.
- The CI gate as the workflow now composes it: **162 tests, 159 pass, 0 fail, 3 skipped**.
- OCR lane suites: **146/146 pass**, zero live provider calls.
- Six mutation tests: all caught, all reverted.
- Provider posture unchanged: Qwen `@cf/qwen/qwen3.8-27b` selected, Llama rejected, Gemma reserve, no fallback.
- Corpus, manifest, answer key, normalization, grader thresholds and prompts: **untouched**.
- No database migration was introduced or required.
- No Cloudflare call was made and no neuron was spent by this work.
- Live-provider workflows remain `workflow_dispatch`-only; the credential-free offline gate keeps
  its push trigger and now also runs the two suites above.
