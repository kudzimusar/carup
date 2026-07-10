# Full Activation — Integrated UAT Report

**Program:** Vehicle Trust OS Full Activation & Mobile Certification
**Branch:** `plan/vehicle-trust-full-activation` (PR #114 → `main`) · **Code SHA:** `87be672`
**Staging:** `eoyenigwevnxwwhyhaer` (`https://eoyenigwevnxwwhyhaer.supabase.co`)
**Verdict:** PASS — all internally-controllable engineering complete and green; external provider
activations clearly gated. **No P0/P1 internal defects.**

## 1. Integrated 15-step acceptance journey

`backend/tests/full-activation-journey.test.js` drives all five workstreams through the single
shared provider control-plane over one in-memory Supabase mock. **Result: 15/15 green.**

| # | Property (goal §175-193) | Evidence | Result |
|---|---|---|---|
| 1 | Onboard provider configs without exposing secrets | secret-looking `credential_ref` rejected; new providers fail-closed (`not_configured`, kill switch ON) | ✅ |
| 2 | Mobile captures offline + uploads exactly once | certification run records `offline_queue_persist_restart` + `upload_exactly_once_after_reconnect` = pass (device proof: mobile suite) | ✅ |
| 3 | OCR/provenance complete | `ocr_provenance_complete` = pass | ✅ |
| 4 | Source adapters: mixed match/mismatch/high-risk/unavailable, honest labels | ZIMRA CLEAN→match, MISMATCH→mismatch, STOLEN→high_risk — all `mode='sandbox'`, never `live` | ✅ |
| 5 | Conflicts create fraud + human review | 2 fraud cases opened; publication blocked | ✅ |
| 6 | Dealer + publication gates work | unpublishable listing → declined, provider never called | ✅ |
| 7 | Insurer returns conditional eligibility | MISMATCH VIN → `conditional` (mode sandbox) | ✅ |
| 8 | Lender returns manual review | NORECORD VIN → `manual_review` (provider called) | ✅ |
| 9 | Escrow provider-test txn + signed events | initiate → `funding` (sandbox, `is_real_money=false`) → signed webhook → `inspection` | ✅ |
| 10 | Reconciliation succeeds + mismatch enters review | clean window `succeeded`; amount mismatch queued `open` | ✅ |
| 11 | Buyer + partner responses redacted | no refs / owner identity / underwriting / tenant in projections | ✅ |
| 12 | Cross-user / cross-tenant access fails | buyer → `forbidden` on cert matrix; no tenant/owner ids leak | ✅ |
| 13 | Append-only audit complete | attempts logged; ledger `UPDATE` rejected (DB proof: PGlite 23/23/23 + staging triggers) | ✅ |
| 14 | Kill switches stop new calls, history intact | gov + escrow kill switch → new calls blocked; prior history untouched | ✅ |
| 15 | No simulator value appears as live/official | every observed mode ∈ {sandbox, unavailable}; sandbox escrow never real money | ✅ |

## 2. Test totals (exact)

| Suite | Result |
|---|---|
| **Backend `node --test backend/tests/`** | **1267 tests · 1258 pass · 8 skipped** (the lone "fail" in a full run is the untouched `evidence-ai-fraud.test.js` IPC flake — passes 5/5 in isolation) |
| Government activation | 31 / 31 |
| Insurance provider | 19 / 19 |
| Finance (lender) provider | 20 / 20 |
| Escrow provider | 19 / 19 |
| Mobile certification (backend) | 10 / 10 |
| Provider platform | 15 / 15 |
| Provider platform routes + reconciliation | 8 / 8 |
| Provider load/resilience (concurrency, circuit recovery, outage, dead-letter, cross-provider, replay) | 11 / 11 |
| Lender routes object-level authorization | 5 / 5 |
| Webhook security wiring (CSRF bypass + raw-body capture) | 3 / 3 |
| Integrated 15-step journey | 1 / 1 (15/15 properties) |
| **Mobile (tsx) offline-resilience** | 7 / 7 |
| **Mobile (tsx) large-and-edgecases** | 7 / 7 |
| **PGlite migration harness** (Up/Down/re-Up, invariant-gated) | 24 / 24 / 24 |
| Mobile certification standalone migration harness | 14 / 14 assertions |
| **Web build** (`tsc -b && vite build`) | ✅ green (2618 modules) |
| Secret scan (51 Full Activation files) | ✅ clean |

**Note (transparency):** one intermittent Node test-runner IPC artifact ("Unable to deserialize
cloned data") was observed on `evidence-ai-fraud.test.js` in a full-suite run; the file is
**untouched by this cycle**, has **zero Full Activation dependencies**, and passes 5/5 in isolation.
It is runner noise, not a defect.

## 2b. Adversarial re-verification & hardening pass

A 27-agent adversarial re-verification (10 audit dimensions × 2-lens verify) re-ran every suite
from scratch and hunted for defects the happy-path testing masked. It **confirmed 9 real defects
introduced by this program** — all now fixed with regression tests, staging updated, production
untouched. **0 confirmed defects remain.**

| # | Sev | Defect | Fix | Guard |
|---|---|---|---|---|
| F1 | P1 | `csrfMiddleware` blocked all 5 signed provider webhooks (403 in prod before HMAC) | added insurer/lender/escrow-provider/escrow-trust/eligibility to the bypass list | `webhook-security-middleware.test.js` |
| F2 | P1 | circuit breaker latched open permanently (shed + kill-switch rows counted; no recovery) | half-open probe after cooldown; gate/shed rows excluded from the window | `provider-resilience.test.js` (recovery + no-latch) |
| F3 | P1 | any `owner`-role user could read any VIN's private lender decisions / erase any consent | bound to actual vehicle/consent ownership | `lender-routes-authz.test.js` (5) |
| F4 | P2 | global `express.json` consumed the body → webhook HMAC checked a re-serialized body | capture `req.rawBody` for `/webhook` paths in the global parser | `webhook-security-middleware.test.js` |
| F5 | P2 | idempotent replay of a retry-then-success returned the intermediate timeout | claim the key on the TERMINAL attempt | `provider-resilience.test.js` (replay) |
| F6 | P2 | cross-capability idempotency-key collision (global UNIQUE) | migration → `UNIQUE(provider_id, idempotency_key)` + per-provider dedupe (staging-verified) | `provider-resilience.test.js` (cross-provider) |
| F7 | P2 | `dealer-routes.test.js` unconditional `JSON.parse` of a non-JSON error body flaked the file | guarded parse | file no longer flakes |
| F8 | P2 | PGlite harness recorded immutability assertions but never failed on them | invariant gate flips overall PASS + exit code; `tables_after_down` extended to all 22 FA tables | gate proof (forced-fail → exit 1) |
| F9 | P3 | escrow-trust webhook reused the `finance_sandbox` HMAC secret | own `ESCROW_TRUST_WEBHOOK_SECRET` | `escrow-trust.test.js` |

Everything else the audit surfaced was refuted, pre-existing baseline (unchanged from `main`), or
by-design fail-closed behavior. `npm run lint` (web `eslint .`): the branch had introduced 31 new
errors from **earlier** program cycles (0 from the provider-activation work) — these were fixed in
this hardening pass (see the web-lint delta below); the web app builds green throughout.

## 3. Device matrix (mobile certification — HONEST)

| Target | Status |
|---|---|
| Certified logic / offline store / drain / backend / migration | ✅ green (Node 20.20.2 tsx + node:test; PGlite PG 17.5) |
| Physical Android (Pixel 6a / Android 14; Galaxy A14 / Android 13) | ⛔ **not executed** — no device attached (external hardware gate) |
| Android emulator | ⛔ no AVD/system-image configured on the build host |
| Physical iOS (iPhone 13 / iOS 17.x) | ⛔ **not executed** — no Apple hardware + no signing identity |

No physical/simulator certification is claimed as passed. The harness, capture-admission gate,
append-only results ledger, and runner script (`scripts/mobile-cert/run-android-emulator-cert.sh`,
which exits `3 = NO_DEVICE` honestly) are complete and ready to run the moment hardware + signing
are available. See `docs/vehicle-trust-os/mobile-certification/MOBILE_CERTIFICATION_REPORT.md`.

## 4. Security suite coverage

Webhook signature/replay/duplicate, missing-secret-fail-closed-in-production, SSRF endpoint
allowlist, secret-reference-only credentials, RLS on every table, private storage policies,
append-only immutability, circuit breaker + dead-letter, per-provider + global kill switches —
all exercised in the domain suites and the integrated journey. See `security/THREAT_MODEL.md`
(T1-T14) and `security/WEBHOOK_AND_RECONCILIATION_RUNBOOK.md`.
