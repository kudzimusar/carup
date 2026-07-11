# Agent 8 — Production Activation Ledger

Canonical record of what is LIVE in production for the Omnichannel Communication Engine
(Enterprise Communication Command Center), with the accepted evidence for each activation.
Update this ledger whenever a channel or capability changes production state.

Last updated: 2026-07-11 · Owner: Agent 8 · Status source: production runtime evidence (no secrets recorded here)

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

## Closure matrix

| Capability | Production state | Notes |
|------------|------------------|-------|
| **WhatsApp** (`meta_whatsapp_cloud_api`) | 🟢 **LIVE / GREEN** | Outbound + status webhooks + GET verification + real inbound all passed; health `available=true, missing=[]` |
| **Telegram** (`telegram_bot_api`) | 🟡 Code-ready, **not activated** | Production env missing `CARUP_TELEGRAM_BOT_TOKEN` (+ webhook secret); proven live on staging previews |
| **Email** | 🟡 Code-ready / feature-gated, not activated | SendGrid / Cloudflare Worker paths exist; no production credentials configured |
| **Admin reply queue** | 🟢 Code-ready | Live delivery depends on the active providers above; queue → worker → provider path proven via WhatsApp |
| **Worker scheduling** | 🟢 GREEN | Automatic delivery active (worker/cron), no manual invocation required |
| **Messenger** | ⚪ Out of scope | Not started, per activation plan |
| **Instagram** | ⚪ Out of scope | Not started, per activation plan |

## Boundaries observed for this ledger entry

- Production was not modified to produce this evidence (read-only log pulls + public health probes).
- No secrets were rotated, printed, or recorded.
- No Telegram, Messenger, Instagram, or email activation work was started.
