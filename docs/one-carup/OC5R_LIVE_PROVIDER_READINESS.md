# OC-5R — Live-provider readiness inventory (PR #222 lineage)

**Layer:** SOURCE → DATABASE → **LIVE PROVIDERS** → DEPLOYED STAGING → OWNER UAT → PRODUCTION.
**Lineage:** `fix/oc5r-real-runtime-source-closure`, inventoried at `f8fed206`. Nothing was deployed. Production was not called.

## Rules applied

- **Evidence from other lineages is not inherited.** A prior run counts only if it is a valid LIVE-PROVIDER receipt whose sha is an
  ancestor of this head **and** whose code path is unchanged since that sha. No earlier provider evidence meets both conditions.
  - The Qwen run 36287013223 at `e2961ad` is an ancestor, but the OCR path has changed since then.
  - GMO-8 at `ce45e16f` (PR #209) is not an ancestor.
  - The communications receipts are pre-policy prose, written against older adapter code.
- **Credentials are named, never read.**
  - Staging runtime: the `carup-backend-staging` Vercel project, production target.
  - GitHub: repository and environment secrets.
  - Runtime values were never decrypted.
- **A live call was made only through an existing governed in-lineage harness.** That limits it to the manual-dispatch OCR proof
  workflow. Every other smoke would need new automation or decrypted runtime credentials. Both are next-block work, not ad hoc work.
- **A live output is candidate or advisory evidence only.** It grants no identity, Trust, registry, compliance or payment authority.

## Earned in this block

| Receipt | Provider / model | SHA | Run | Result |
|---|---|---|---|---|
| `OC5R-OCR-QWEN-LIVE-SMOKE` | Cloudflare Workers AI `@cf/qwen/qwen3.8-27b` | `f8fed206` | 37607951170 | Proof call through `CloudflareVisionClient` answered `{"ok":true}` (42.3 neurons). One synthetic fixture through Document Intelligence: 8/8 fields exact, 0 fabrications, held as a candidate. **Not** an accuracy claim (PARTIAL by design). |

## Inventory and classification

| Provider | Model / service | Canonical source in #222 | Credentials (names only) | Mock / simulation | Unavailable behaviour | Live receipt (this lineage) | Class | Next safe live request |
|---|---|---|---|---|---|---|---|---|
| Cloudflare Workers AI — Qwen (OCR, DI) | `@cf/qwen/qwen3.8-27b`, `/ai/run` | `ocrVisionProvider` → `CloudflareVisionClient` → `documentIntelligenceService`; identity, vehicle evidence, native odometer, garage, Diaspora | GitHub: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` ✓. Staging runtime: `CLOUDFLARE_ACCOUNT_ID` ✓, **`CLOUDFLARE_API_TOKEN` absent** (`CLOUDFLARE_TOKEN` is present, but no code reads it) | DI simulated reader only under `testFixtureGuard` | Typed failure. The document stays unread or pending review; identity goes to manual review | `OC5R-OCR-QWEN-LIVE-SMOKE` | READY_FOR_LIVE_SMOKE — **executed** | The full 11-fixture accuracy gate, by owner dispatch, is required for any accuracy statement |
| Cloudflare Workers AI — Gemma (general AI gateway) | `@cf/google/gemma-4-26b-a4b-it` | `carUpAiGateway` via `domainAdvisoryAdapter`; fraud/risk, marketplace assistant, workbook mapping, communications text | Same as Qwen | None at runtime (test seams only) | 503, or the deterministic answer; advisory only | None on any lineage | READY_FOR_LIVE_SMOKE — not executed (no non-writing in-lineage harness) | One `generateJson` call with a fixed prompt from a governed dispatch-only harness |
| Groq | `whisper-large-v3` (audio); `llama-3.3-70b-versatile` (text, superseded) | `communicationGroqProvider` (media only) | Runtime: `GROQ_API_KEY` ✓ | None (503) | 503 | Prose only (PR #148) | INTENTIONALLY_NOT_CONFIGURED (multimodal deferred) | None until multimodal is activated |
| Gemini | `gemini-2.5-flash` (vision reserve) | `GeminiClient`, only with `CARUP_OCR_PROVIDER=gemini` | GitHub `GEMINI_API_KEY` ✓ (no workflow uses it) | Simulated reply in fixtures | `AI_PROVIDER_UNCONFIGURED` | None | INTENTIONALLY_NOT_CONFIGURED (retired for text) | — |
| Evidence-image vision | — | `evidenceVisionProvider` (certified adapters: none) | — | Simulators under the fixture guard | `ai_not_configured` / `AI_ANALYSIS_UNAVAILABLE` | None | PROVIDER_NOT_SELECTED | — |
| Biometrics (X4) | — | `biometricProvider` (null provider) | — | Null provider | `not_configured` | None | PROVIDER_NOT_SELECTED | — |
| Resend | `/emails`; inbound `GET /emails/{id}`; Svix webhooks | `ResendEmailAdapter` via `EmailTransportRouter` | Runtime: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_AUTH_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `CARUP_EMAIL_REPLY_TOKEN_SECRET` ✓ | Fake adapter outside deployed runtimes | `provider_not_configured` → dead-letter (auth mail has no fallback) | Prose only (PR #163) | READY_FOR_LIVE_SMOKE — not executed (credential only in the stale runtime) | Read-only `GET /emails/{id}` via a harness, or one send to the controlled test inbox through an exact-SHA staging pair |
| Brevo (marketing) | `/v3/smtp/email` | `BrevoMarketingAdapter` (classification `marketing`) | Runtime: `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `BREVO_WEBHOOK_SECRET` ✓ | Fake adapter | Dead-letter | Prose only (E7, never PASS) | READY_FOR_LIVE_SMOKE — not executed | One governed campaign to the controlled opted-in inbox through an exact-SHA staging pair |
| Meta WhatsApp Cloud API | Graph v20.0 messages/templates | `CommunicationMetaWhatsAppGovernedAdapter` | Runtime: `CARUP_META_ACCESS_TOKEN`, `_APP_SECRET`, `_PHONE_NUMBER_ID`, `_WABA_ID`, `_WEBHOOK_VERIFY_TOKEN` ✓ | Fake adapter | Dead-letter plus fallback | Prose only (July activation ledger) | READY_FOR_LIVE_SMOKE — not executed (sends reach real phones) | `provider-credential-check` **without** `send_probe` (read-only Graph GET), plus template status |
| Meta Messenger / Instagram | Graph messages | Adapters exist | `CARUP_META_PAGE_ID` absent | Fake adapter | Dead-letter | None | CREDENTIAL_MISSING | — |
| Telegram Bot API | `sendMessage` | `TelegramBotAdapter` | Runtime: `CARUP_TELEGRAM_BOT_TOKEN`, `CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN` ✓ | Fake adapter | Dead-letter | Prose only (July ledger) | READY_FOR_LIVE_SMOKE — not executed | `getMe` / `getWebhookInfo` only (never `setWebhook`) |
| Expo push | `exp.host` push/send | `ExpoPushAdapter`; mobile registration | `EXPO_ACCESS_TOKEN` absent everywhere | Fake adapter | Dead-letter | None | CREDENTIAL_MISSING (plus an owner device) | `getReceipts` with a dummy id, then a physical owner device |
| Twilio SMS | `Messages.json` | `TwilioSmsAdapter` | `TWILIO_*` absent | Fake adapter | Dead-letter | None | CREDENTIAL_MISSING | `GET /Accounts/{SID}.json` |
| SendGrid / Cloudflare Email (legacy) | Legacy senders and edge worker | Legacy adapters | Absent | — | — | None | INTENTIONALLY_NOT_CONFIGURED | — |
| n8n automation webhook | `POST $AUTOMATION_WEBHOOK_URL` | `automationWebhookService` | `ENABLE_AUTOMATION_WEBHOOKS` is set; no URL | — | Non-fatal | None | INTENTIONALLY_NOT_CONFIGURED | — |
| Google OAuth + Drive v3 | `drive.file` | `diasporaDriveSyncService` / `GoogleDriveProvider` | `GOOGLE_CLIENT_*`, `DIASPORA_DRIVE_*` absent | `MockDriveProvider` outside deployed runtimes | 400 disabled / NOT_CONFIGURED / untyped 500 (vault) | None | EXTERNAL_ACTIVATION_REQUIRED | `GET /drive/status` (no Google call), then owner OAuth with a test account |
| GCP Secret Manager vault | Secret Manager v1 | `GoogleSecretManagerVault` | `DIASPORA_VAULT_GCP_*` absent | Test overrides | `VAULT_NOT_CONFIGURED` (500) | None | EXTERNAL_ACTIVATION_REQUIRED | None is safe |
| ECB reference FX | `eurofxref-daily.xml` | `tradeFxRateService.createEcbFxProvider` | Keyless | Injected fetch in tests | `UNAVAILABLE` / `STALE`; **no fetch timeout**; a GET inserts snapshot rows | Prose only (T6, off-lineage) | READY_FOR_LIVE_SMOKE — not executed (no in-lineage harness) | One provider fetch with the snapshot insert bypassed |
| Subscription billing (Stripe/Paynow) | — | `billingProvider` (live stub throws) | `APPROVED_LIVE_PROVIDERS = []` | Sandbox outside deployed runtimes | Untyped 500, which also breaks read endpoints | None | EXTERNAL_ACTIVATION_REQUIRED (ADR-001 accepted, not activated) | — |
| SafeTrade / marketplace payments | Candidates unverified | Stubs; durable sandbox (database only) | None | Sandbox | 500 | None | PROVIDER_NOT_SELECTED | — |
| Escrow provider platform | — | Framework + simulator | Webhook secret absent | Framework refuses synthetic execution when deployed | 409 blocked | None | EXTERNAL_ACTIVATION_REQUIRED (contract) | — |
| Government registries (ZIMRA, CVR, ZINARA, VID, CID) | — | `governmentActivation` (stub: `credential_pending`) | — | Sandbox adapters | `not_contracted` | None | EXTERNAL_ACTIVATION_REQUIRED (contracts) | — |
| Insurers / lenders | — | Eligibility sandbox and workflows | — | Sandbox | `unavailable` rows | None | EXTERNAL_ACTIVATION_REQUIRED (contracts) | — |
| Sentry | — | Logger stub; SDK not installed | `SENTRY_DSN` absent | — | — | None | SOURCE_NOT_IN_CURRENT_LINEAGE | — |

**The deployed staging runtime is not this lineage.** `carup-backend-staging` production runs `bb9d9900`, an ancestor 476 commits behind
`f8fed206`. So the "unavailable behaviour" column above describes this source, not a deployed runtime.

## Blocked

- **By missing source integration** (fix in source, do not work around):
  - The Sentry SDK.
  - Governed dispatch-only harnesses for Gemma, ECB, Resend and Telegram.
  - SOURCE certification for `ocr.qwen_boundary` (and DATABASE), `ai.general.gemma_gateway`, `marketplace.ai_advisory` and `garage.native_odometer_candidate`.
  - Capability rows for the communications transports and ECB FX.
- **By credentials or activation:**
  - `CLOUDFLARE_API_TOKEN` is not set on the staging runtime's production target.
  - `EXPO_ACCESS_TOKEN`, `TWILIO_*` and `CARUP_META_PAGE_ID` are not set.
  - Google OAuth, vault and Drive need activating.
  - Billing, escrow, government, insurer and lender contracts are outstanding.
  - The Groq multimodal decision is pending.

## Source findings recorded for the next source-convergence block (not fixed here)

1. **Government `partner_file` / `manual` modes return synthetic SANDBOX payloads, and they are allowed in production.** A synthetic
   `partner_file` match counts as "connected" Trust coverage (`governmentActivation.js`, `vehicleFactResolver.js`,
   `trustDecisionService.js`).
2. **There are two definitions of "production".** Webhook secrets, the dev bypass, eligibility and the escrow provider key on
   `NODE_ENV` / `CARUP_ENV` only. So committed fallback secrets are live in staging and preview.
   - The eligibility `x-provider-id` header selects the HMAC key.
   - The escrow PATCH route has no participant check.
   - The SafeTrade webhook uses a committed secret, a fixed replay clock, and bypasses the deployed gate.
3. **Communications:**
   - Webhook signatures are bypassed when `NODE_ENV=test`, even when deployed.
   - Some secret comparisons are not timing-safe.
   - There is no send kill-switch.
   - Several env vars are dead.
   - The credential-check `send_probe` bypasses the governed adapter.
4. **ECB FX fetch has no timeout, and a GET inserts snapshot rows.** Billing provider selection is eager, so its read endpoints
   return 500 when deployed. "Fail closed" is an untyped 500 in billing, Drive and deposits.
5. **Sentry health reports `enabled` with no SDK installed.** The Help Center claims EcoCash/InnBucks are accepted, with no integration
   behind it.
6. **Smaller items:**
   - Document Intelligence labels an unconfigured provider `provider_failed`.
   - The Diaspora confidence score defaults to 0.
   - The fixture guard has a gap on non-Vercel hosts.
   - The Gemini key travels in the URL.
