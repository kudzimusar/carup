# WhatsApp Provider Smoke Test — Communication Engine

Issue #110 UAT support. Adds a protected endpoint (and admin UI action) that sends **one real
message through the Communication Engine's own queue + delivery-worker path** to confirm live
provider delivery, and **refuses to report success from a fake adapter**.

## Why this exists

There was no application route to send a WhatsApp message to an arbitrary recipient through the
engine — admin replies (`/api/admin/communications/threads/:id/reply`) require an existing thread
with a participant. This endpoint fills that gap for provider smoke testing without touching the
Meta dashboard.

## Endpoint

`POST /api/admin/communications/test/provider-smoke`

Auth (never public — see [adminCommunicationRoutes.js](../../backend/routes/adminCommunicationRoutes.js)):
- a valid **platform-admin session** — `authorizeRole(['admin','platform_admin','super_admin'])`
  **and** the platform *base* role must itself be an admin role, so tenant-scoped role elevation
  (`x-tenant-id` + `x-stakeholder-role`) cannot reach this arbitrary-external-send endpoint, **or**
- the **worker secret** header `x-communication-worker-secret: $COMMUNICATION_WORKER_SECRET`
  (or `Authorization: Bearer $COMMUNICATION_WORKER_SECRET`), constant-time compared.

Body:

```json
{ "channel": "whatsapp", "to": "818081201356", "message": "optional text", "client_message_id": "optional" }
```

Behaviour (`sendProviderSmokeTest`):
1. Resolve the adapter for the channel from the **same registry the delivery worker uses**.
2. **Refuse fake success:** if the adapter is a fake (`validateConfiguration().mode === 'fake'` —
   the fake adapter is the only one that reports that sentinel) → HTTP **409** `fake_adapter_refused`
   with **no** side effects. If the real adapter is missing credentials → HTTP **424**
   `provider_not_configured` (lists missing env vars).
3. Create real rows: `channel_identities` → `message_threads` → `messages` → `notification_queue`
   (deferred due-time + `max_attempts: 1` so the pg_cron worker never independently claims it).
4. Deliver **synchronously** via `deliveryWorker.deliverNotification(...)` — the real adapter POSTs
   to `https://graph.facebook.com/v20.0/{phone_number_id}/messages` and the attempt is recorded in
   `message_delivery_attempts`.
5. Response is `ok: true` **only** when the worker returned `sent` **and** a real
   `provider_message_id` (Meta `wamid...`) exists. A provider rejection returns HTTP **502** with
   `ok: false` and the error — never a fake success.

Success response (shape):

```json
{
  "ok": true,
  "channel": "whatsapp",
  "provider": "meta_whatsapp_cloud_api",
  "recipient": "818081201356",
  "adapter": { "channel": "whatsapp", "provider": "meta_whatsapp_cloud_api", "mode": "real", "available": true },
  "thread_id": "…", "message_id": "…", "notification_id": "…", "correlation_token": "…",
  "delivery": {
    "status": "sent", "worker_result": "sent",
    "provider": "meta_whatsapp_cloud_api",
    "provider_message_id": "wamid.…",
    "provider_request_id": "wamid.…",
    "attempt_number": 1, "error_code": null, "error_message": null
  },
  "inspect": { "messages": "SELECT …", "notification_queue": "SELECT …", "message_delivery_attempts": "SELECT …", "webhook_logs": "…" }
}
```

## Admin UI action

The Admin → Communications page ([Communications.tsx](../../web/src/pages/dashboard/admin/Communications.tsx))
gains a **"WhatsApp provider smoke test"** card (recipient prefilled with the Meta test number).
A logged-in admin can trigger the real send and see the `provider_message_id` — no secrets needed.

## Tests

`backend/tests/communication-engine.test.js` (all **63 pass**, `web` `tsc --noEmit` clean):
- refuses a fake adapter (409) and creates **no** rows;
- sends via the **real** `MetaWhatsAppAdapter` (stubbed fetch), asserts the Graph API URL + bearer +
  `to`, and a real `provider_message_id`; asserts `messages` / `notification_queue(sent)` /
  `message_delivery_attempts(meta_whatsapp_cloud_api)` / `channel_identities` rows;
- a real provider **rejection (401)** yields `ok: false` with a recorded `failed` attempt (never fake success);
- real adapter missing credentials → HTTP 424 `provider_not_configured` (no provider call, no rows);
- endpoint is **not public**: no-auth → 401, wrong secret → 401, valid worker secret → real send
  (with route-boundary assertions on the Graph API URL + E.164 recipient);
- source assertions: route gated by `requireAdminOrWorkerSecret`, fake-adapter refusal (`mode === 'fake'`),
  constant-time `safeEqual`, and the platform-admin `SMOKE_TEST_ADMIN_ROLES` restriction.

Deferred follow-up (low): a dedicated HTTP-level test of the admin-**session** accept/deny path
(valid admin session → 200, non-admin → 403) using a stubbed Supabase client. The worker-secret,
no-auth, and wrong-secret paths are covered here; the session path uses the shared `authorizeRole`
middleware already tested elsewhere in the suite.

## Running the live test against staging (`+81 80-8120-1356` / E.164 `818081201356`)

The staging backend preview for branch `fix/issue-110-agent8-telegram-auto-delivery` reports
`whatsapp: mode=real, available=true` at `GET /api/communications/health`. After this branch
redeploys (so the preview contains the endpoint), trigger the send by **either**:

- **Admin UI:** log in as admin on the staging web app → Admin → Communications → *WhatsApp provider
  smoke test* → recipient `818081201356` → **Send**. Confirm the `provider_message_id` and the
  message arriving on the device.
- **Worker secret (operator shell, secret from the environment — do not paste it anywhere):**
  ```bash
  curl -sS -X POST "$STAGING_BACKEND/api/admin/communications/test/provider-smoke" \
    -H "x-communication-worker-secret: $COMMUNICATION_WORKER_SECRET" \
    -H 'content-type: application/json' \
    -d '{"channel":"whatsapp","to":"818081201356","message":"CarUp WhatsApp smoke test"}'
  ```
  where `$STAGING_BACKEND` is the latest **Ready** preview URL for the branch.

## Supabase verification (run against the CarUp Supabase the staging backend uses)

```sql
SELECT id, channel, direction, status, provider_message_id FROM messages WHERE id = '<message_id>';
SELECT id, channel, status, dedupe_key FROM notification_queue WHERE id = '<notification_id>';
SELECT provider, provider_message_id, status, error_code FROM message_delivery_attempts WHERE notification_id = '<notification_id>';
-- webhook_logs receives Meta delivery/read receipts asynchronously (inbound webhook) after the device acks.
```

## Status / handoff

- **Code + tests: complete and green.** The endpoint exercises the real adapter and refuses fake success.
- **Not yet done (requires operator with admin session or the worker secret, plus recipient
  confirmation):** the actual live send to `818081201356`, on-device receipt, and reading the real
  Meta provider attempt back from the CarUp Supabase. WhatsApp is **not** claimed complete until the
  registered recipient receives the message and Supabase shows a real `meta_whatsapp_cloud_api`
  delivery attempt with a `wamid...` id.
