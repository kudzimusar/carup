# One CarUp — Provider readiness package (RC1, Phase 8)

This document covers every external provider the RC1 runtime depends on:
- what it is allowed to decide;
- which switch selects it;
- which configuration it needs (variable **names** only — never values);
- how readiness is observed;
- how a failure must look.

It also covers the smoke harness that checks a deployed RC1 against all of the above.

**Status at RC1:**
- **Source:** ready.
- **Deployed:** unverified. Canonical staging (`carup-staging`, `eoyenigwevnxwwhyhaer`) is unavailable; its backend answered 500 on 2026-10-04.
- **Live calls:** none were made in this programme. No live credentials were authorized for it.

## The governing law, per provider

| Provider | Role | Authority | Selected by | Never |
|---|---|---|---|---|
| **Cloudflare Workers AI — Qwen** `@cf/qwen/qwen3.8-27b` | OCR: classification and reading of documents | **Candidate evidence only.** A human or the owning domain decides. | `CARUP_OCR_PROVIDER` (default `cloudflare`) and `CARUP_OCR_MODEL` (default Qwen) | Moved to Gemma. Allowed to verify, approve or write Trust. |
| **Cloudflare Workers AI — Gemma** `@cf/google/gemma-4-26b-a4b-it` | General AI: fraud scan, buyer assistant, listing draft, Communications text | **Advisory only.** No vendor fallback. | `CARUP_AI_PROVIDER` (`cloudflare` only) and `CARUP_AI_MODEL` (pinned) | Allowed to exercise domain authority. Spending capacity on an anonymous visitor. |
| **Groq** | Communications **media only**: Whisper audio; images only with a vision model | Advisory | `COMMUNICATION_AI_PROVIDER=groq` | Used for text. Text runs on the gateway. |
| **Gemini** | Retired for text (OC-4B). Its vision path remains a non-default OCR reserve. | — | Only an explicit `CARUP_OCR_PROVIDER=gemini` | Brought back because a key exists. |
| **Supabase** | Database and storage | System of record | `SUPABASE_URL` | Used as a substitute staging. Production used as staging. |
| **Ledger** (`blockchainService`) | Records domain decisions | **Records only** | Issue #158 custody contract | Hash v2 enabled live without the staged migration. |
| **Communications providers** (Meta WhatsApp, Telegram, email, Twilio) | Delivery | The owning lane's governed templates | `COMMUNICATION_ENGINE_ENABLED` and provider configuration | Sending copy that has no governed registration. |
| **Vercel** | Hosting | — | Release-only (`git.deploymentEnabled: false`) | Deploying automatically from Git. |

## Configuration by area (names only)

| Area | Required | Notes |
|---|---|---|
| OCR boundary | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | With `OCR_MODE=strict`, the server refuses to boot unless the **selected** OCR provider is configured (OC-4B `ocrStartupGuard`). A Gemini or Groq key does not satisfy it. |
| General AI gateway | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | One shared Cloudflare transport for both (OC-3C). |
| Communications media | `GROQ_API_KEY` | MULTIMODAL DEFERRED. |
| Database / storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `SUPABASE_DB_URL` for migration runners only | No migration is applied by RC1. |
| Ledger custody | `CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET`, `CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET`, `CARUP_BLOCKCHAIN_KEY_VERSION` | The rollout contract must be **FINALIZED** at the runtime's custody generation. Otherwise stakeholder-signed writes refuse (`UPGRADE_REQUIRED` / `PREPARED`). `CARUP_LEDGER_HASH_VERSION` stays `1`. |
| Sessions | `JWT_SECRET` | Custom backend auth; `auth.users` is not used. |
| Identity fallback | `CARUP_ALLOW_X_USER_ID_FALLBACK` | **Must be unset** in every deployed environment. Production refuses the fallback regardless. |
| Test fixtures | `ALLOW_OCR_MOCK` | **Must be unset or `false`** when deployed. `testFixtureGuard` refuses it under `VERCEL_ENV` production/preview and `CARUP_ENV` production/staging. |
| Observability | `SENTRY_DSN` | Shown as `sentry.enabled` in health. |
| Retired names | `OCR_PRIMARY_PROVIDER`, `OCR_FALLBACK_PROVIDER` | Nothing reads them. `backend/env.example` already documents them as retired. |

## How readiness is observed

`GET /api/health` is the single source. It reports no secret values.

| Field | Ready means |
|---|---|
| `build.commit_sha` | The **exact** RC commit under test (pairing). |
| `ocr.selectedProvider` / `ocr.selectedModel` | `cloudflare` / `@cf/qwen/qwen3.8-27b` |
| `ocr.configured` | `true` |
| `ocr.mockRuntimeAllowed` | `false` |
| `ocrProviders.cloudflare` | `true` |
| `ai.provider` / `ai.model` / `ai.configured` / `ai.authority` | `cloudflare` / `@cf/google/gemma-4-26b-a4b-it` / `true` / `advisory` |
| `supabase.status` / `supabase.outboxBacklog` | `healthy` / a backlog the operator expects. Production read 312 on 2026-10-04, with Communications inactive. |
| `communications.*` | Per-channel readiness. Production Communications is **inactive** by decision. |

## Failure contracts (what "down" must look like)

**OCR provider unavailable, timed out, refused or malformed**
- The domain gets a typed failure, and the document stays **unread** or **pending review**.
- A reading is never invented. Mileage is never written. Nobody is verified.
- Pinned by: OC-3B, OC-4C and the journey suites.

**General AI unavailable**
- Communications returns `503 communication_ai_provider_unavailable`.
- Malformed or empty output returns `502`.
- Buyer and seller surfaces show the deterministic safe answer.
- There is no vendor fallback, and no derivation is recorded.

**Anonymous visitors**
- They get the deterministic answer with `ai_reason: 'sign_in_required'`.
- **Zero** provider calls.

**Ledger custody not FINALIZED**
- Stakeholder-signed writes refuse.
- Recorded gap (residual-scan finding D): PartSentry has already saved its log and odometer at that point.

**Unregistered governed template**
- Fails closed: `template_not_registered`.
- Six policy keys are in this state (residual-scan finding C).

## The smoke harness

`backend/scripts/one-carup-provider-smoke.mjs` — tests: `backend/tests/oc4f-provider-smoke-harness.test.js`, 7/7 passing, 6/6 mutants killed.

```text
# 1. PLAN (default): no network; lists the checks; reports which variables are set or missing.
node backend/scripts/one-carup-provider-smoke.mjs --env staging

# 2. LIVE, no provider capacity spent: provenance, OCR boundary, AI gateway, anonymous AI, ledger gate.
CARUP_SMOKE_AUTHORIZED=yes node backend/scripts/one-carup-provider-smoke.mjs --env staging --live \
  --base-url https://carup-backend-staging.vercel.app --expected-sha <full 40-hex RC commit>

# 3. LIVE + exactly ONE Gemma call: authenticated advisory fraud scan on a fake VIN.
CARUP_SMOKE_AUTHORIZED=yes CARUP_SMOKE_SESSION_TOKEN=<staging smoke session> \
  node backend/scripts/one-carup-provider-smoke.mjs --env staging --live \
  --base-url https://carup-backend-staging.vercel.app --expected-sha <sha> --provider-calls
```

**Safety rails** (each one is mutation-tested):
- PLAN is the default.
- LIVE needs `CARUP_SMOKE_AUTHORIZED=yes` for that run.
- `--env production` is refused, and so is every production host.
- The target host must be on an exact allow-list:
  - the stable staging backend;
  - `api-staging`;
  - staging-backend previews;
  - localhost.
- `--expected-sha` must be the full commit.
- Only fake VINs are used, and nothing is ever POSTed to a verification endpoint.
- The single paid check needs both `--provider-calls` and a session. The session is sent as a header and never printed.

**What the harness does not re-run.** Live OCR accuracy has its own manual, corpus-based workflow (`o2-live-ocr-accuracy.yml`, dispatch only). A push trigger once spent about 42% of the daily Cloudflare allocation per run, so it stays manual and bounded.

## Readiness verdict

| Dimension | RC1 |
|---|---|
| Source wiring (gateway, OCR boundary, failure contracts, health truth) | **Ready.** Proven offline and in local journeys. |
| Deployed configuration (exact-head staging) | **Unverified.** Waits on canonical staging being restored. |
| Live provider behaviour | **Not exercised.** No credentials authorized. The harness is ready to run on authorization. |
| Production | **Untouched.** It still runs `78303ed6`. |
