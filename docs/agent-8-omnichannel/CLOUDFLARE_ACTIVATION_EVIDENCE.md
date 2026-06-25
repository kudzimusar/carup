# Agent 8 Cloudflare Activation Evidence

Last updated: 2026-06-25

Scope: PR #100 on `feature/agent-8-omnichannel-communication-engine`.

Production was not changed. No Cloudflare Worker, DNS, Email Service, Queue, R2 bucket, WAF rule, or Cron Trigger was deployed during this run.

## Access Discovery

| Resource | Discovery result | Auth/config status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Cloudflare Codex connector | Not exposed by available tool search | Not available | Tool search for Cloudflare returned GitHub/Gmail/multi-agent tools only | Add a Cloudflare connector/tool or use Wrangler/API token locally |
| Wrangler CLI | Not installed locally | Not available | `which wrangler` returned `wrangler not found` | Install Wrangler for staging deployment/UAT |
| Local Cloudflare env vars | None present | Not configured | Redacted env-name scan returned `NO_CLOUDFLARE_ENV_VARS_PRESENT` | Add staging-only secrets/env vars |
| Cloudflare account | Not discoverable | Blocked | No connector, no token, no Wrangler auth | Provide account access/token with Email/Workers/Queues/R2 permissions |
| Cloudflare zone | Not discoverable | Blocked | No zone token/access | Configure staging/test domain only |
| Email Service | Code-ready only | Not configured/deployed | Adapter and Worker implemented; no live API token/sender domain | Enable Email Service and verify sender/domain |
| Email Routing | Code-ready only | Not configured/deployed | Worker `email()` handler implemented | Configure routing addresses to Worker |
| Worker | Source added under `cloudflare/carup-communications-edge/` | Not deployed | `node --check` passed locally | Deploy to staging Worker with Wrangler |
| Queues | Bindings defined in `wrangler.toml.example` | Not created/deployed | Worker producer/consumer tests passed locally | Create inbound/outbound/DLQ staging queues |
| R2 attachments | Binding documented | Not created/deployed | Worker extracts metadata only; canonical attachment truth remains Supabase/message evidence | Create staging bucket and connect secure upload/reference path |
| Cron Trigger | `*/2 * * * *` in example config | Not deployed | Worker scheduled unit test calls protected CarUp processor | Deploy staging Worker cron after disabling duplicate scheduler |
| WAF/security | Backend/Worker auth implemented | Cloudflare dashboard rules not configured | HMAC timestamp/nonce/body-hash tests passed | Add staging WAF/rate-limit rules around Worker endpoints |

## Provider Matrix

| Email capability | Cloudflare component | Implemented | Configured | Deployed | Live-tested | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Email Sending | Email Service REST API and Worker `send_email` binding | Yes | No | No | No | Code-ready, blocked by account/token/sender verification |
| Email Routing | Worker `email()` handler | Yes | No | No | No | Code-ready, blocked by routing address/domain setup |
| Email Worker | `cloudflare/carup-communications-edge` | Yes | No | No | No | Source and tests ready; Wrangler unavailable locally |
| Queue inbound | Cloudflare Queues producer/consumer | Yes | No | No | No | Bindings documented; no live queue created |
| Queue outbound | Cloudflare Queues transport fallback | Yes | No | No | No | Transport only; Supabase remains canonical |
| DLQ | Cloudflare Queue DLQ handoff | Yes | No | No | No | Worker sends terminal failures to DLQ binding when configured |
| Cron Trigger | Worker scheduled handler | Yes | No | No | No | Calls protected CarUp processor with Worker secret |
| R2 attachments | Attachment reference path | Partial | No | No | No | Metadata extraction implemented; secure binary storage awaits bucket/scan path |
| DNS authentication | Email Service domain config | No code needed | No | No | No | Operator must configure SPF/DKIM/DMARC/MTA-STS as required |
| WAF/security | Worker auth + backend HMAC verification | Yes | No | No | Local only | Dashboard WAF/rate limits still operator work |
| Delivery-state evidence | Cloudflare receipt extraction | Yes | No | No | No | Backend maps Cloudflare delivery events when received |
| Inbound threading | Message-ID/In-Reply-To/References preservation | Yes | No | No | Local only | Unit-tested; live mailbox UAT blocked |
| Outbound reply | Canonical queue -> Cloudflare adapter -> Worker/REST | Yes | No | No | Local only | Unit-tested; live inbox UAT blocked |
| SendGrid fallback status | Explicit fallback flag only | Yes | No | No | No | Suppressed unless `EMAIL_PROVIDER` is set back to SendGrid |

## Implemented Code

- Added `CloudflareEmailAdapter` with provider name `cloudflare_email`.
- Added `EMAIL_PROVIDER=cloudflare` selection while preserving existing SendGrid default and explicit `EMAIL_PROVIDER_FALLBACK` health metadata without automatic fallback delivery.
- Added authenticated Worker outbound path using `CLOUDFLARE_EMAIL_WORKER_URL` and `CLOUDFLARE_EMAIL_WORKER_SECRET`.
- Added official Cloudflare Email Sending REST path `POST /client/v4/accounts/{account_id}/email/sending/send`.
- Added Cloudflare email inbound webhook verification using exact raw request body, timestamp, nonce, body hash, HMAC signature, and optional Cloudflare Access service-token headers.
- Added recipient allow-list, inbound size limit, unsafe attachment rejection, canonical message attachment metadata persistence, Message-ID dedupe, and threading metadata.
- Added Worker project with `fetch`, `email`, `queue`, and `scheduled` handlers.
- Added environment placeholders for Cloudflare account, zone, Email Service, Worker, inbound secret, Access service tokens, R2, queues, DLQ, recipient allow-list, and signature tolerance.

## Tests

Passing on 2026-06-25:

- `/usr/bin/env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY node --test backend/tests/communication-engine.test.js` - 42 passed.
- `node --test cloudflare/carup-communications-edge/test/edge.test.js` - 6 passed.
- `node --check cloudflare/carup-communications-edge/src/index.js` - passed.

Cloudflare-specific coverage includes:

- primary provider selection with `EMAIL_PROVIDER=cloudflare`
- SendGrid fallback suppression/health metadata
- authenticated Worker outbound request
- official REST fallback request
- valid raw-body HMAC inbound webhook
- modified payload signature failure
- expired timestamp rejection
- unsupported recipient rejection
- unsafe attachment rejection
- Worker `send_email` binding use
- Worker queue fallback
- Worker inbound signing for CarUp backend
- Worker scheduled processor call
- Worker handler presence for `fetch`, `email`, `queue`, and `scheduled`

## Security Guarantees

- Cloudflare Worker sends never create business truth; they only deliver canonical Supabase `notification_queue` work.
- Cloudflare Queues are transport only; canonical state remains in Supabase/PostgreSQL.
- Inbound email is accepted into CarUp only after signature verification and recipient/attachment checks.
- HMAC covers exact raw body and a separately supplied body hash.
- Expired signatures and tampered payloads are rejected with 403 before ingest.
- Optional Cloudflare Access client ID/secret checks are enforced if configured.
- Secrets are represented only as empty examples or Wrangler-secret comments.

## Blocked Live UAT

The Cloudflare integration is not production-complete yet because the required live staging evidence is unavailable:

- no outbound transactional email to a real inbox
- no inbound routed email to the CarUp admin command center
- no live admin reply to the original sender
- no live Message-ID threading proof
- no live queue retry/DLQ proof
- no deployed Cron Trigger evidence
- no Cloudflare DNS authentication evidence
- no WAF/rate-limit evidence
- no R2 attachment storage/quarantine evidence

Recommendation: `NOT READY`.
