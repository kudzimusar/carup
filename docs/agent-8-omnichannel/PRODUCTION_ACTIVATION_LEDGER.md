# Agent 8 — Production Activation Ledger

Canonical record of what is LIVE in production for the Omnichannel Communication Engine
(Enterprise Communication Command Center), with the accepted evidence for each activation.
Update this ledger whenever a channel or capability changes production state.

Last updated: 2026-07-12 (worker scheduler LIVE) · Owner: Agent 8 · Status source: production runtime evidence (no secrets recorded here)

## Production deployment

| Item | Value |
|------|-------|
| Integration PR | **#100 — merged to `main`** |
| Production deployment | https://carup-backend-staging-5ajqbhdnl-pay-pass-project.vercel.app |
| Stable alias | https://carup-backend-staging.vercel.app |
| Deployment ID | `dpl_CHpDyWKCX6p1K1tPVm4pzpRRtFUA` |
| Meta App ID | `1034177535612269` (published/live) |
| WABA ID | `2061495501115454` |
| Production phone number ID | `1187129204487046` |
| Webhook URL | `https://carup-backend-staging.vercel.app/api/communications/webhooks/meta/whatsapp` |

## WhatsApp — LIVE / GREEN ✅

All four production smokes passed:

| Smoke | Result |
|-------|--------|
| Outbound production smoke | ✅ passed |
| Status (delivery) webhooks | ✅ passed — Meta status POSTs reached production |
| GET webhook verification | ✅ passed (`hub.challenge` echoed) |
| **Real inbound production smoke** | ✅ **passed — accepted as green 2026-07-11** |

### Inbound evidence (final production smoke)

Real device message, delivered by Meta (not the simulator), captured in production runtime logs of
deployment `dpl_CHpDyWKCX6p1K1tPVm4pzpRRtFUA`:

| Field | Value |
|-------|-------|
| Timestamp | `2026-07-10T16:25:35.666Z` (finalized `16:25:43.946Z`) |
| Route | `POST /api/communications/webhooks/meta/whatsapp` |
| HTTP | **200** |
| `user_agent` | `facebookexternalua` (genuine Meta origin) |
| `x_hub_sig_256` | present — signature verified (the earlier 403 signature-failure mode is resolved after the `CARUP_META_APP_SECRET` update + redeploy) |
| `object` | `whatsapp_business_account` · entry_count 1 · changes_count 1 · field `messages` |
| `message_count` / `status_count` | **1** / 0 |
| `first_message_type` | `text` |
| `normalized_channel` | `whatsapp` |
| `processing_status` | `received` → **`processed`** |
| `persisted_message_id` | `49ace4e2-0c83-40e7-b45c-3adcde4d3afd` |
| `thread_id` | `949f04ec-8c14-478c-997e-6fb616de1e6b` |
| `error_code` / `error_message` | null / null |
| Provider message id (prefix only) | `wamid.HBgMODE4…` |
| Sender (last4 only) | `••••1356` |
| Correlation / request id | `req-bc9a6303-2157-4659-9287-26903e9a929d` |
| Retries / failures | exactly one Meta POST in the window; zero 4xx/5xx on the webhook path |
| Secrets | none printed — tokens, app secret, full phone numbers, and full wamid never appeared in logs or evidence |

Notes:

- `diagnostics_enabled:false` in production is **expected and correct** — the UAT text-preview mode
  (`CARUP_COMMUNICATION_WEBHOOK_UAT_DIAGNOSTICS`) must stay off in production.
- **Message text is not logged in production by design.** The receipt logger emits only redacted
  fields (id prefixes, last4, counts, shapes).
- Optional DB/UI confirmation remains possible at any time via the persisted id:
  `SELECT … FROM messages WHERE id = '49ace4e2-0c83-40e7-b45c-3adcde4d3afd';`
  (expect `direction=inbound`, `channel=whatsapp`, the exact inbound text) — or by opening the thread
  in the Command Center inbox.

## Telegram — LIVE / GREEN ✅ (activated 2026-07-11)

End-to-end production activation: env vars → redeploy → webhook → real inbound → canonical
persistence → admin reply → device receipt.

| Item | Value |
|------|-------|
| Production deployment (serving the accepted webhooks) | https://carup-backend-staging-mfcexxc6j-pay-pass-project.vercel.app |
| Deployment ID | `dpl_9GhjgfSg4WtY2tmew2Gzae1r9KwN` |
| Provider / health | `telegram_bot_api`, `mode=real`, `available=true`, `missing=[]` |
| Webhook URL | `https://carup-backend-staging.vercel.app/api/communications/webhooks/telegram/telegram` |
| Env activation | `CARUP_TELEGRAM_BOT_TOKEN` + `CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN` added as Production-only records by the operator (values never printed; Vercel has no server-side env duplication, so the bot token was re-entered via dashboard reveal→paste and a fresh webhook secret was generated) |

### Activation timeline + evidence (2026-07-11 UTC, production runtime logs)

1. Production redeploy #1 (`dpl_6wtZEuehv5XQXNL83VLRdS7v5YsR`) → health flipped to `telegram available=true, missing=[]`; WhatsApp unchanged/green.
2. First `setWebhook` used a secret that did not match the Production env value → Telegram POSTs arrived and were **rejected 403** by the exact-match fail-closed check (`x-telegram-bot-api-secret-token`), retried by Telegram with backoff (nine 403s captured 14:07–14:23). **The fail-closed webhook security check works in production.**
3. Fix: operator replaced the Production `CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN` from one freshly generated mode-600 file; production redeploy #2 (`dpl_9GhjgfSg4WtY2tmew2Gzae1r9KwN`); `setWebhook` re-run with the same file → `ok:true`, `getWebhookInfo` shows the production URL, `allowed_updates:["message"]`, `pending_update_count:0`, no `last_error_message`.
4. **Inbound accepted**: `POST /api/communications/webhooks/telegram/telegram` → **HTTP 200** at `14:24:35Z` (896ms, `req-9e2dfd37…`, the drained pending retry — update handling idempotent-safe) and **HTTP 200** at `14:27:51Z` (5,568ms full inbound pipeline, `req-dff877c5…`) for the fresh **"CarUp production Telegram MVP inbound 001"**. Zero 403s and zero error logs after the secret fix.
5. **Canonical persistence confirmed by operator in the production Command Center**: the Telegram thread with the exact inbound text rendered in the inbox (renders only from `message_threads` + `messages` + `channel_identities` rows).
6. **Admin reply queue → provider delivery confirmed**: operator replied **"CarUp production Telegram MVP reply 001"** from the thread; the reply is enqueued (`status: queued`, `queueExistingMessage`) and delivered asynchronously by the delivery worker — **received on the operator's Telegram device**, proving queue → worker → `telegram_bot_api` end-to-end in production.

Evidence caveats (recorded honestly):

- **Corrected 2026-07-12:** the worker tick was not observable because **no production scheduler
  existed** — direct inspection of production Supabase (`get_communication_scheduler_health()`)
  showed `pg_cron_available=false, pg_net_available=false, job_configured=false` (the earlier
  "pinned deployment URL" hypothesis was wrong). The UAT reply was delivered by a non-scheduled
  worker invocation during the session; the device receipt remains valid proof of the
  queue → worker → `telegram_bot_api` delivery path itself. Scheduler activation is tracked in the
  "Worker scheduler activation" section below. Row-level proof remains available:
  `SELECT * FROM message_delivery_attempts WHERE provider='telegram_bot_api' ORDER BY started_at DESC LIMIT 1;`
  (expect `status=sent` + a Telegram `provider_message_id`).
- **Topology note:** resolved by the topology audit below (the preview-backend traffic observed during
  UAT came from operating the Command Center via a preview *web* URL, not from production config).
- No secrets were printed or recorded at any step; sender identifiers appear as last4 only.

## Production topology (audited + aligned 2026-07-12)

Goal: every production communication runtime path uses the stable backend alias
`https://carup-backend-staging.vercel.app`.

### Audit results (full URL-reference sweep)

| Surface | Target found | Verdict |
|---------|--------------|---------|
| Provider webhooks (WhatsApp + Telegram) | `carup-backend-staging.vercel.app/api/communications/webhooks/…` | ✅ stable alias (unchanged) |
| Production Command Center web (`carup-staging.vercel.app`) | deployed bundle resolves the API base to `https://carup-backend-staging.vercel.app/api`, driven by the **Production env var `VITE_API_URL`** (not hard-coded) | ✅ stable alias — no change needed |
| Web client code (`web/src/hooks/useCarUpApi.ts`, `apiClient.ts`) | reads `VITE_API_URL`; fallback default is `carup-backend.vercel.app/api` | ✅ no preview URL in code |
| Mobile client (`mobile/utils/apiBase.ts`) | requires `EXPO_PUBLIC_API_URL` env; no hard-coded URL | ✅ env-driven |
| Vercel cron (`backend/vercel.json`) | `{}` — no crons defined | ✅ n/a (scheduling is Supabase pg_cron only) |
| Cloudflare worker (`cloudflare/carup-communications-edge`) | only `wrangler.toml.example` placeholder; email not activated | ✅ n/a |
| Repo code/docs sweep for `…-git-feature-agent…` / concrete preview / issue-108/110 URLs | zero hits in runtime code; hits only in historical evidence docs (kept as history) and one unrelated marketplace QA script | ✅ nothing to repoint in code |
| Supabase pg_cron worker job | operator inspected production directly (2026-07-12): `pg_cron`/`pg_net` **available but not installed**, `cron.job` does not exist, `job_configured=false` — **no job has ever existed** | ❌ scheduler never activated → activation migration `20260712100000` (see "Worker scheduler activation") |

The earlier "UI on preview backend" observation is explained: production web deployments were already
stable-aliased; the preview-backend traffic came from a browser session on a **preview web URL**
(whose branch-scoped `VITE_API_URL` bakes the preview backend). Operational rule recorded here:
**use `https://carup-staging.vercel.app` as the production Command Center.**

### Known limitation (documented, intentionally not changed)

The main production web (`carup.vercel.app`) has no `VITE_API_URL` and falls back to
`carup-backend.vercel.app`, which has **no communication credentials**
(health: whatsapp + telegram `available=false`). Fixing that requires either provisioning provider
credentials on `carup-backend` or repointing the entire main app — both out of scope for this
alignment (no credential changes; no engine rewrites). Until then the communications Command Center
is served by `carup-staging.vercel.app`.

## Worker scheduler activation (in progress 2026-07-12)

**Corrected status:** worker scheduling was previously recorded green — that was wrong. Direct
production inspection (2026-07-12, `SELECT public.get_communication_scheduler_health();`) returned:
`pg_cron_available=false`, `pg_net_available=false`, `job_configured=false`, `job_config=null`,
`latest_run=null`, `latest_http_call=null`, `stale_lock_count=0`; `cron.job` does not exist and
`pg_available_extensions` shows both extensions available but **not installed**. Root cause: the
original scheduler migration (`20260626120000_communication_supabase_cron.sql`) deliberately skips
job creation when the extensions are absent, and they were never enabled on production.

**Activation path** — migration `database/migrations/20260712100000_communication_scheduler_production_activation.sql`:

- `CREATE EXTENSION IF NOT EXISTS pg_cron` + `pg_net`, then idempotently (unschedule-then-recreate)
  schedules exactly one job `carup-communication-worker-every-minute`, `* * * * *`.
- The job command reads **both** the endpoint URL and the worker secret from **Supabase Vault at
  execution time** (`CARUP_WORKER_ENDPOINT_URL`, `CARUP_WORKER_SECRET`) — no secret in source
  control, in `cron.job.command`, in logs, or in health output; guard clauses make runs a no-op
  until both Vault entries exist. `timeout_milliseconds=20000` so real worker batches (5–8s
  provider sends) record a `status_code=200` instead of a client-side timeout.
- Target URL (stable alias, via Vault): `https://carup-backend-staging.vercel.app/api/internal/communications/process`
- Auth: `Authorization: Bearer <CARUP_WORKER_SECRET>` matching Vercel Production
  `COMMUNICATION_WORKER_SECRET` (accepted by the endpoint's constant-time check).
- **Rollback:** the migration's Down unschedules the job only (health function belongs to
  `20260626120000`; extensions are left installed as shared infrastructure).

**Operator runbook (SQL editor, production `vhmnajoeicasaigiophh`):**

```sql
-- 1) Vault secrets (one secure paste; values never enter chat/repo):
SELECT vault.create_secret(
  'https://carup-backend-staging.vercel.app/api/internal/communications/process',
  'CARUP_WORKER_ENDPOINT_URL');
SELECT vault.create_secret('<COMMUNICATION_WORKER_SECRET value>', 'CARUP_WORKER_SECRET');
-- (if a name exists: SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='…'), '<value>');)

-- 2) Run the Up section of 20260712100000_communication_scheduler_production_activation.sql

-- 3) After ≥1 minute, verify:
SELECT public.get_communication_scheduler_health();
--   expect pg_cron_available=true, pg_net_available=true, job_configured=true,
--          job_config={jobname:'carup-communication-worker-every-minute', schedule:'* * * * *', active:true},
--          latest_run.status='succeeded', latest_http_call.status_code=200
SELECT COUNT(*) FROM cron.job WHERE command ILIKE '%communications%';  -- expect exactly 1
```

**Evidence: ✅ ACTIVE — first verified successful authenticated run 2026-07-12T06:32:00Z.**

Applied to production `vhmnajoeicasaigiophh` (2026-07-12). Final `get_communication_scheduler_health()`:

| Field | Value |
|-------|-------|
| `pg_cron_available` / `pg_net_available` | `true` / `true` (extensions installed by the migration) |
| `job_configured` | `true` |
| `job_config` | `{ jobname: 'carup-communication-worker-every-minute', schedule: '* * * * *', active: true }` |
| `latest_run` | `status: succeeded`, `2026-07-12T06:32:00Z`, `return_message: "1 row"` |
| `latest_success` | `status: succeeded`, `2026-07-12T06:32:00Z` |
| `latest_http_call` | **`status_code: 200`**, `timed_out: false`, `2026-07-12T06:32:00Z` |
| `stale_lock_count` | `0` |
| Job uniqueness | exactly **1** active job with this name; **0** other communication cron jobs |

Secret handling (no value ever printed/committed): URL + worker secret read from Vault at execution
time. Vercel Production `COMMUNICATION_WORKER_SECRET` matches Vault `CARUP_WORKER_SECRET`
byte-for-byte (the endpoint's check is constant-time, no-trim).

**Activation incident + remediation (recorded honestly):**

- During activation the two Vault entries were initially swapped — `CARUP_WORKER_ENDPOINT_URL` held
  the secret — so `net.http_post` failed with `Bad scheme` and **wrote the worker secret in plaintext
  into `cron.job_run_details.return_message`** (also echoed to CLI/logs). Treated as a real exposure.
- Remediation: the worker secret was **rotated** (operator: new value → Vercel Production
  `COMMUNICATION_WORKER_SECRET` → production redeploy; same value → Vault `CARUP_WORKER_SECRET`), which
  neutralized the leaked value. The Vault URL entry was corrected. Next: a `401` run confirmed the URL
  was fixed (real request enqueued) and isolated a secret mismatch; after a byte-exact re-sync of the
  Vault secret to the Vercel value, the `06:32:00Z` tick returned **HTTP 200 / succeeded**.
- **Operator follow-up (audit hygiene, non-blocking):** delete the failed run rows that captured the
  (now-dead) leaked value —
  `DELETE FROM cron.job_run_details WHERE status='failed' AND jobid=(SELECT jobid FROM cron.job WHERE jobname='carup-communication-worker-every-minute');`
  The leaked value is already invalidated by the rotation, so this is cleanup, not exposure closure.

**Rollback:** run the Down section of `20260712100000` (unschedules the job only; extensions + health
function retained). Vault entries and Vercel env are managed independently of the migration.

**Post-activation regression (2026-07-12, stable alias):** WhatsApp `available=true, missing=[]` ·
Telegram `available=true, missing=[]` · Command Center `/admin/communications` + `/inbox` → HTTP 200 ·
no provider webhook changed · only `COMMUNICATION_WORKER_SECRET` rotated (required by the leak); no
provider credentials rotated.

### Smoke evidence (2026-07-12, post-audit)

- Stable alias health: whatsapp `available=true, missing=[]` · telegram `available=true, missing=[]` ✅
- `carup-staging.vercel.app` Command Center routes `/admin/communications`, `/admin/communications/inbox` → HTTP 200 ✅
- No provider credentials changed; no webhooks touched; no redeploys were required (no Vercel-side
  configuration change was needed).

## Closure matrix

| Capability | Production state | Notes |
|------------|------------------|-------|
| **WhatsApp** (`meta_whatsapp_cloud_api`) | 🟢 **LIVE / GREEN** | Outbound + status webhooks + GET verification + real inbound all passed; health `available=true, missing=[]` |
| **Telegram** (`telegram_bot_api`) | 🟢 **LIVE / GREEN** (2026-07-11) | Real inbound POST 200 + canonical persistence + admin reply received on device; fail-closed webhook secret verified in production (403s until secrets matched) |
| **Email** | 🟡 Code-ready / feature-gated, not activated | SendGrid / Cloudflare Worker paths exist; no production credentials configured |
| **Admin reply queue** | 🟢 **LIVE** | Proven in production via the Telegram reply (queued → worker → `telegram_bot_api` → device); WhatsApp path previously proven |
| **Worker scheduling** | 🟢 **LIVE / GREEN** (2026-07-12) | Supabase pg_cron every-minute job active; first authenticated run `06:32:00Z` returned `latest_http_call.status_code=200`, `latest_run=succeeded`; single job, `stale_lock_count=0`; secret read from Vault. Worker secret was rotated during activation (leak remediation) |
| **Messenger** | ⚪ Out of scope | Not started, per activation plan |
| **Instagram** | ⚪ Out of scope | Not started, per activation plan |

## Boundaries observed

- WhatsApp entry (2026-07-11): produced with read-only evidence only (log pulls + public health probes).
- Telegram activation (2026-07-11): authorized production changes only — two Production env records
  added by the operator (values never shared with tooling or printed) and two `vercel redeploy` runs;
  webhook registered by the operator with the bot token kept in their shell. WhatsApp untouched
  (regression-checked green after each redeploy).
- No secrets were rotated beyond the intended fresh webhook secret, printed, or recorded.
- No Messenger, Instagram, or email activation work was started.
