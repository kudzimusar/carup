# Communication Configuration Validator

The Omnichannel Communication Engine validates provider readiness at backend startup, `/api/health`, and `/api/communications/health`.

## Status Values

- `READY`: all required provider credentials, webhook secrets, webhook URLs, scheduler secrets, and real adapters are configured.
- `WARNING`: no blocking provider issues were found, but a non-fatal operational condition should be reviewed.
- `BLOCKED`: at least one required secret, webhook URL, scheduler secret, or real adapter is missing. The application must not claim the affected provider is available.

`/api/communications/health` returns HTTP `503` when the communication configuration is `BLOCKED`; the JSON body includes every missing or unsafe configuration item.

## Required Runtime Contract

Set one scheduler secret:

- `COMMUNICATION_WORKER_SECRET` or `CRON_SECRET`

Set a public webhook base URL:

- `COMMUNICATION_WEBHOOK_BASE_URL` or `CARUP_PUBLIC_API_URL`

Keep fake adapters disabled for real readiness:

- `COMMUNICATION_FAKE_ADAPTERS_ENABLED=false`

Provider requirements:

| Channel | Required provider credentials | Required webhook secrets | Required webhook URL |
| --- | --- | --- | --- |
| WhatsApp | `CARUP_META_ACCESS_TOKEN`, `CARUP_META_PHONE_NUMBER_ID` | `CARUP_META_WEBHOOK_VERIFY_TOKEN`, `CARUP_META_APP_SECRET` | derived from webhook base |
| Facebook | `CARUP_META_ACCESS_TOKEN`, `CARUP_META_PAGE_ID` | `CARUP_META_WEBHOOK_VERIFY_TOKEN`, `CARUP_META_APP_SECRET` | derived from webhook base |
| Instagram | `CARUP_META_ACCESS_TOKEN`, `CARUP_META_PAGE_ID` | `CARUP_META_WEBHOOK_VERIFY_TOKEN`, `CARUP_META_APP_SECRET` | derived from webhook base |
| Telegram | `CARUP_TELEGRAM_BOT_TOKEN` | `CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN` | derived from webhook base |
| Email, SendGrid | `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` | derived from webhook base |
| Email, Cloudflare | `CLOUDFLARE_EMAIL_FROM` plus either Worker credentials or REST credentials | `CLOUDFLARE_EMAIL_INBOUND_SECRET` | derived from webhook base |
| SMS, Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER` | provider-authenticated callback | `TWILIO_STATUS_CALLBACK_URL` |
| Push, Expo | `EXPO_ACCESS_TOKEN` | none | none |

The validator treats empty strings, whitespace-only strings, `''`, and `""` as missing. For example, Telegram is `BLOCKED` when `CARUP_TELEGRAM_BOT_TOKEN` is empty, even if a fake adapter exists in local/test mode.

The validator reports names of missing keys only. It must not log or return secret values.
