# Agent 8 — Production Activation Ledger

Canonical record of what is LIVE in production for the Omnichannel Communication Engine
(Enterprise Communication Command Center), with the accepted evidence for each activation.
Update this ledger whenever a channel or capability changes production state.

Last updated: 2026-07-11 (Telegram activation) · Owner: Agent 8 · Status source: production runtime evidence (no secrets recorded here)

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

- The worker cron's `POST /api/internal/communications/process` tick was not observable in the
  current-deployment log windows (the scheduler evidently targets a pinned deployment URL); the
  delivery proof is the operator-confirmed device receipt of the queued reply. Row-level proof remains
  available: `SELECT * FROM message_delivery_attempts WHERE provider='telegram_bot_api' ORDER BY started_at DESC LIMIT 1;`
  (expect `status=sent` + a Telegram `provider_message_id`).
- **Topology note (follow-up recommended):** the production Command Center UI (and likely the worker
  cron) currently operate against the **git-branch preview** deployment of `carup-backend-staging`,
  while the Telegram/WhatsApp webhooks hit the **production alias**. Both share the production
  Supabase, so data is unified and everything works — but UI + cron should be repointed to the stable
  production alias so a preview redeploy cannot disturb production operations. Not changed in this
  activation (out of scope).
- No secrets were printed or recorded at any step; sender identifiers appear as last4 only.

## Closure matrix

| Capability | Production state | Notes |
|------------|------------------|-------|
| **WhatsApp** (`meta_whatsapp_cloud_api`) | 🟢 **LIVE / GREEN** | Outbound + status webhooks + GET verification + real inbound all passed; health `available=true, missing=[]` |
| **Telegram** (`telegram_bot_api`) | 🟢 **LIVE / GREEN** (2026-07-11) | Real inbound POST 200 + canonical persistence + admin reply received on device; fail-closed webhook secret verified in production (403s until secrets matched) |
| **Email** | 🟡 Code-ready / feature-gated, not activated | SendGrid / Cloudflare Worker paths exist; no production credentials configured |
| **Admin reply queue** | 🟢 **LIVE** | Proven in production via the Telegram reply (queued → worker → `telegram_bot_api` → device); WhatsApp path previously proven |
| **Worker scheduling** | 🟢 GREEN | Automatic delivery active (worker/cron), no manual invocation required |
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
