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

---

## OC-5R-PROV-01 update — candidate code `d18936ab` (2026-10-07)

The inventory above is the record at `f8fed206` and is kept unchanged. This section records what PROV-01 changed. The full
programme report is [OC5R_PROV01_PROVIDER_CONVERGENCE_REPORT.md](OC5R_PROV01_PROVIDER_CONVERGENCE_REPORT.md).

### Credentials (names only; no value read, decrypted or printed)

- **`CLOUDFLARE_API_TOKEN` is now set on `carup-backend-staging`**, targets preview and production. The Product Owner set it at
  2026-10-07T14:25:16Z. This is **STAGING CONFIG PREPARED**. It is **not DEPLOYED RUNTIME VERIFIED**: the running staging
  deployment `dpl_91cteUJnAN8218aeCtUPrXHSHLa3` serves `main@bb9d9900`, which predates the variable and this lineage. The
  variable becomes runtime evidence only through `/api/health` (`ai.configured`, `ocr.configured`) after a governed exact-SHA
  deployment.
- **`CLOUDFLARE_TOKEN`** is stale and still present on the production target. No code reads it, and no compatibility was added.
  Removing it is an owner action.
- **GitHub repository secrets** (names read earlier in this session): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and
  `GEMINI_API_KEY` are present. No Resend, Telegram or Meta credential exists as a GitHub secret. A re-read at
  2026-10-07T15:15:11Z got HTTP 500 from the GitHub secrets API.

### The governed harness (D2)

- **Workflow:** `.github/workflows/oc5r-live-provider-smoke.yml`, run by `backend/tests/tools/oc5r-live-provider-smoke.mjs`.
- **How it runs:** manual dispatch only, one provider per run.
  - The checkout is asserted to be the exact SHA.
  - Only the selected provider's credentials are injected.
  - The job has no database credential (the Supabase variables are inert local placeholders) and no `environment:`.
  - A provider without credentials exits 2 as `NOT_CONFIGURED`; nothing is simulated.
- **Guard:** a permanent test (`oc5r-prov01-live-provider-smoke.test.js`) fails the suite if a push, pull_request, schedule or
  workflow_run trigger is added, if a job gains an environment, or if the exact-SHA assertion is removed.

| Provider | Request class (non-writing) |
|---|---|
| Gemma | One advisory JSON completion through CarUp's gateway (`requestAdvisoryJson`), with a fixed instruction and no customer data |
| ECB | One keyless GET of `eurofxref-daily.xml` through `createEcbFxProvider`, bounded by its timeout, plus an in-memory triangulation. No snapshot is written |
| Resend | One authenticated `GET /domains`. No email is sent |
| Telegram | One `getMe`. No message is sent and no chat is read |
| Meta WhatsApp | Two authenticated Graph v20.0 GETs (phone-number quality fields and template status). Nothing is sent |

### Live smokes (D3) — harness at `4a6f96e7`

| Provider | Result | Evidence |
|---|---|---|
| ECB | **SUCCEEDED** → `OC5R-PROV01-ECB-LIVE-SMOKE` | Feed dated 2026-10-07, 29 currencies, ZWG not published, JPY→USD triangulated through EUR, 893 ms, no snapshot written. Executed 2026-10-07T14:43:57.735Z |
| Gemma | **BLOCKED** | The dispatch-only workflow cannot be dispatched until its file exists on `main`: `GET …/actions/workflows/oc5r-live-provider-smoke.yml` → HTTP 404, re-checked 2026-10-07T15:15:11Z. The credential sits only in GitHub secrets and in staging config. The local harness classified it `NOT_CONFIGURED`, which is correct and is not a failure |
| Resend | **NOT_CONFIGURED** | `RESEND_API_KEY` is only a Vercel *sensitive* (write-only) variable |
| Telegram | **NOT_CONFIGURED** | `CARUP_TELEGRAM_BOT_TOKEN`: same as Resend |
| Meta WhatsApp | **NOT_CONFIGURED** | `CARUP_META_ACCESS_TOKEN`, `CARUP_META_PHONE_NUMBER_ID` and `CARUP_META_WABA_ID`: same as Resend |

No message was sent and no response was fabricated.

**To unblock a provider, the owner:**
1. Lands the workflow file on `main` (file only).
2. Adds the provider's credential as a GitHub secret, for Resend, Telegram or Meta.
3. Runs `gh workflow run oc5r-live-provider-smoke.yml --ref fix/oc5r-real-runtime-source-closure -f provider=<gemma|resend|telegram|meta_whatsapp>`.

The run's exact-SHA receipt is then recorded.

### Rows that changed

| Provider | Was (at `f8fed206`) | Now (at `d18936ab`) |
|---|---|---|
| Qwen (OCR, DI) | SOURCE PENDING; staging token absent | **SOURCE PASS** (`OC5R-PROV01-QWEN-SOURCE`, 21/21 mutants). LIVE PASS stands on `OC5R-OCR-QWEN-LIVE-SMOKE`: of its 18-file import closure, only `testFixtureGuard.js` (B1) and `sentry.js` (C3, additive) changed, and neither alters that path. Staging config is prepared but the deployed runtime is not verified. The 11-fixture accuracy gate has not run, so no accuracy statement is made |
| Gemma (gateway) | No harness | **SOURCE PASS** (`OC5R-PROV01-GEMMA-SOURCE`, 14/14). The harness exists. LIVE is BLOCKED (see above) |
| Native odometer | SOURCE PENDING | **SOURCE PASS** (`OC5R-PROV01-ODOMETER-SOURCE`, 12/12 + 4/4 mobile). Device/Expo runtime not exercised |
| Marketplace advisory | SOURCE PENDING | **Still PENDING**: a scoped receipt only (`OC5R-PROV01-ADVISORY-SOURCE`, 12/12). The price band and unfiltered `ai_notes` block promotion |
| Communications transports | No capability row | `communications.transport_boundary`: **SOURCE PASS** (`OC5R-PROV01-COMMS-SOURCE`, 18/18). LIVE is PENDING (no credentialed context) |
| ECB FX | No timeout; a GET inserted rows; no harness | `trade.reference_fx`: **SOURCE PASS** (`OC5R-PROV01-C1-SOURCE`) and **LIVE PASS** (`OC5R-PROV01-ECB-LIVE-SMOKE`) |
| Billing | Untyped 500, which also broke reads | Typed 503 / 502 / 4xx; reads work (`OC5R-PROV01-C2-SOURCE`) |
| SafeTrade | 500, committed secret, fixed clock | 503 `SAFETRADE_WEBHOOK_UNAVAILABLE` without an approved provider (`OC5R-PROV01-B3-SOURCE`) |
| Sentry | Health said `enabled` | Health says `unavailable` / `not_configured` (`OC5R-PROV01-C3-SOURCE`) |
| Government registries | Synthetic `partner_file` counted as connected | Only `source_connected` counts (`OC5R-PROV01-A1-SOURCE`) |

### Disposition of the source findings recorded above

1. **Government synthetic payloads counted as connected:** CLOSED (A1).
2. **Two definitions of "production", committed fallback secrets, the eligibility key header, escrow PATCH, SafeTrade:** CLOSED
   (B1–B5).
3. **Communications:**
   - CLOSED: the deployed `NODE_ENV=test` signature bypass (B2) and the comparisons that were not timing-safe (G3).
   - CLOSED beyond the inventory: G1, G2 and G4–G8.
   - **OPEN:** there is no send kill-switch; several env vars are dead; the admin credential-check `send_probe` still sends one
     message through the raw `MetaWhatsAppAdapter`, not the governed adapter. That path is admin-only and needs an explicit opt-in.
4. **ECB timeout and GET insert, eager billing selection, the billing untyped 500:** CLOSED (C1, C2). **OPEN:** the untyped 500s
   in Drive / vault and deposits.
5. **Sentry health and Help Center payment claims:** CLOSED (C3, C4).
6. **Smaller items:** not addressed in PROV-01, and all remain open:
   - Document Intelligence labels an unconfigured provider `provider_failed`;
   - the Diaspora confidence default;
   - the fixture-guard note;
   - the Gemini key in the URL.
