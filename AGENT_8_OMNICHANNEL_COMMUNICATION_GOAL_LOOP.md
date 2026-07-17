# AGENT 8 — CarUp Omnichannel Communication Engine

**Repository:** `kudzimusar/carup`  
**Authoritative repository path:** `/AGENT_8_OMNICHANNEL_COMMUNICATION_GOAL_LOOP.md`  
**Implementation branch target:** `feature/agent-8-omnichannel-communication-engine`  
**Agent role:** Omnichannel Communication Engineer and integration owner  
**Execution mode:** One continuous Codex `/goal` + `/loop` implementation sprint  
**Primary outcome:** A production-testable communication system that connects CarUp users, admins, AI automation, referrals, notifications, marketplace activity, escrow, financing, and future operational devices through one audited event-driven communication fabric.

---

## 0. Executive Objective

Make CarUp accessible and responsive everywhere.

CarUp must not treat WhatsApp, Telegram, email, SMS, Instagram, web chat, mobile chat, push notifications, and in-app notifications as separate disconnected tools. They must operate as one governed communication system with:

- one canonical conversation record,
- one user/contact identity model,
- one notification queue,
- one delivery and retry mechanism,
- one admin communication inbox,
- one AI triage and automation layer,
- one human escalation process,
- one consent and preference model,
- one audit trail,
- one referral-attribution bridge,
- one event-driven connection to marketplace, escrow, finance, trust, import, container, and support workflows.

Every inbound or outbound communication must be attributable, searchable, auditable, deduplicated, status-aware, and recoverable.

The system must prevent a user from being ignored because a webhook failed, an AI answer was unsafe, an agent missed a message, a channel was unavailable, or a notification could not be delivered.

This is a production integration feature, not a UI mock, provider demo, or set of hardcoded share links.

---

## 1. Current Repository State Codex Must Respect

Before changing code, inspect and verify the current repository state.

### Existing foundations already present

The repository already contains:

```text
backend/services/referral/referralChannelGatewayService.js
backend/services/referral/referralChannelPayloadParsers.js
backend/services/referral/referralAgentGatewayServiceSafe.js
backend/routes/referralRoutes.js
backend/tests/referral-channel-gateway-phase3.test.js
backend/services/eventBus/eventWorker.js
backend/services/eventBus/eventBusService.js
backend/services/eventBus/automationWebhookService.js
database/migrations/002_add_notification_queue.sql
database/migrations/011_phase6_schema.sql
backend/services/diaspora/diasporaNotificationService.js
tests/agents/08-whatsapp-telegram.spec.ts
docs/referral-ai-engine/06_SOCIAL_CHANNELS_WHATSAPP_TELEGRAM_FACEBOOK_TRD.md
docs/referral-ai-engine/11_DATA_MODEL_APIS_EVENTS_TRD.md
```

Existing referral-channel work already supports or partially supports:

```text
WhatsApp inbound parsing
Telegram inbound parsing
Facebook Messenger inbound parsing
Instagram inbound parsing
Web chat input
Mobile chat input
Referral-code extraction
Referral attribution
Channel-specific referral share kits
Webhook verification helpers
AI triage gateway entry points
Referral event logging
```

Existing infrastructure also includes:

```text
notification_queue
outbox_events in a legacy migration
domain_events transactional outbox
event worker retry attempts
automation webhook dispatch
correlation IDs
metrics/logging/Sentry foundations
```

### Critical open dependency

At the time this document was created, **PR #88** contains the Referral Engine release candidate and must be treated as a dependency:

```text
PR #88
feat(referrals): Referral Engine Release Candidate
Branch: feat/referral-final-uat-release
```

It includes verified referral attribution, channel inbound attribution, AI triage, marketing, wallet, import/container campaigns, security hardening, and UAT evidence.

### Deterministic branch rule

Codex must not duplicate or overwrite PR #88.

Use this rule:

1. Fetch `main` and inspect all open PRs touching referral, communication, marketplace, notification, event bus, escrow, finance, or mobile.
2. If PR #88 has been merged, create `feature/agent-8-omnichannel-communication-engine` from the latest `main`.
3. If PR #88 is still open and this work is authorized to begin immediately, create the implementation branch from `feat/referral-final-uat-release` and open a stacked PR targeting that branch.
4. After PR #88 merges, rebase or retarget the communication PR to `main`, resolve conflicts, rerun the full regression suite, and keep the communication PR unmerged for review.
5. Never copy referral code into a second parallel implementation.

### Known gaps this sprint must close

Current code is not yet the complete omnichannel engine because the repository does not have a proven unified implementation for:

```text
durable message threads
message participants
canonical individual messages
cross-channel identities
admin ownership and assignment
AI/human handoff state
notification delivery attempts
provider response tracking
webhook receipt logging
webhook idempotency and deduplication
SLA timers and escalation
communication preferences and consent enforcement
quiet hours and channel fallback
dead-letter recovery
unread/read state
user communication history
admin communication command center
thread-linked feedback, inquiries, complaints, and support cases
escrow and financing notification orchestration
end-to-end notification observability
```

These are the target of Agent 8.

---

## 2. Product Vision

CarUp’s communication engine must function as the nervous system of the platform.

A user may begin by:

- opening a referral link,
- sharing a marketplace listing,
- sending a WhatsApp message,
- starting a Telegram bot conversation,
- replying to an email,
- submitting a web inquiry,
- asking AI about a vehicle,
- requesting container space,
- applying for finance,
- entering escrow,
- reporting a scam,
- replying to an SMS,
- responding to an Instagram DM,
- receiving a push notification,
- contacting support from the mobile app.

The system must connect these interactions into the correct customer journey rather than creating isolated records.

The same thread should be able to move through:

```text
user inquiry
→ AI classification
→ safe automated answer
→ human review where required
→ operational action
→ notification
→ user reply
→ resolution
→ feedback
→ analytics and audit
```

The communication engine must preserve context while respecting privacy, consent, tenancy, permissions, and channel limitations.

---

## 3. Scope Boundary

### 3.1 Required production-testable v1 channels

Implement the common communication model and adapter architecture for:

```text
WhatsApp
Telegram
Email
SMS
Instagram Direct Messages
Facebook Messenger
Web chat
Mobile chat
In-app notifications
Push notifications where existing infrastructure permits
```

### 3.2 Provider strategy

Use provider adapters, not provider-specific business logic.

Preferred first adapters:

```text
WhatsApp and Instagram/Facebook:
Meta Graph / Cloud API adapter

Telegram:
Telegram Bot API adapter

Email:
Use an existing repository email provider if present.
Otherwise implement a provider interface with a Brevo-compatible or SMTP-compatible adapter.

SMS:
Implement a provider-neutral adapter contract.
Use an existing configured provider if present.
Do not hardcode a paid vendor or secret.

Push:
Use the existing mobile/web push mechanism if present.
Otherwise leave a fully tested adapter boundary and in-app fallback.
```

Every channel must also have a deterministic fake/test adapter so the complete system can be tested without live third-party credentials.

### 3.3 Explicit v1 exclusions

Do not turn this sprint into an unlimited communications platform.

Unless already available in the repository, v1 does not require:

```text
voice calls
video calls
full call-center telephony
arbitrary bulk marketing blast tools
physical telematics hardware integration
full social-media publishing scheduler
full CRM replacement
full legal e-discovery system
full multilingual speech synthesis
unapproved autonomous financial decisions
```

### 3.4 Connected “IoT-style” architecture

For this sprint, “connected IoT system” means an event-driven operational fabric where services, apps, channels, and future devices publish events into a common outbox and notification system.

Do not invent physical IoT devices.

Prepare a safe future event source contract:

```text
source_type:
  web
  mobile
  admin
  whatsapp
  telegram
  email
  sms
  instagram
  facebook
  system
  automation
  device
```

A future device or telematics service may publish an approved domain event, but it must not bypass authentication, authorization, audit, or notification policies.

---

## 4. Non-Negotiable User Outcomes

A completed implementation must allow users to:

1. Share a marketplace listing through WhatsApp, Telegram, email, SMS, Instagram-compatible sharing, Facebook, native share, QR, and copy link.
2. Preserve referral code, campaign, listing, and source metadata in shared links.
3. Receive alerts about saved listings, inquiries, trust changes, price changes, import/container status, escrow, finance, referrals, and account/security events.
4. Ask AI questions from supported chat surfaces.
5. Continue an AI-started conversation with a human without restating the full issue.
6. Receive escrow updates only from authoritative backend events.
7. Receive financing application and approval updates only from authoritative backend events.
8. Submit feedback, complaints, reports, questions, inquiries, and support requests.
9. See communication history where their role and privacy rules allow.
10. Control communication channels, consent, marketing preference, and quiet hours.
11. Know when a conversation has been received, assigned, escalated, resolved, or requires action.
12. Receive a fallback notification through an allowed alternative channel when the preferred channel repeatedly fails.
13. Never receive fabricated trust, escrow, payment, finance, or approval claims from AI.
14. Be protected from duplicate notifications caused by webhook retries or event reprocessing.

---

## 5. Canonical Architecture

Implement one canonical communication core.

```text
Domain service event
    ↓
Transactional outbox / domain_events
    ↓
Communication orchestrator
    ↓
Notification policy + consent + template rendering
    ↓
notification_queue
    ↓
Channel adapter
    ↓
Provider
    ↓
Delivery receipt / failure / retry / dead letter
    ↓
Thread + message status + audit + metrics

Inbound provider webhook
    ↓
Signature/secret verification
    ↓
webhook_logs receipt + dedupe
    ↓
Provider payload parser
    ↓
Cross-channel identity resolution
    ↓
Thread resolution or creation
    ↓
Canonical inbound message
    ↓
AI triage / deterministic routing
    ↓
Safe auto-reply OR human assignment/escalation
    ↓
Canonical outbound message + notification delivery
```

### Architectural rules

```text
Business services emit domain events; they do not call WhatsApp, Telegram, email, or SMS directly.

Channel adapters deliver messages; they do not decide business truth.

The communication orchestrator decides who should receive what, when, through which permitted channel, using authoritative domain events.

A thread owns conversation state.

A message owns communication content and direction.

notification_queue owns pending delivery work.

message_delivery_attempts owns provider attempts and receipts.

webhook_logs owns inbound webhook idempotency and forensic metadata.

domain_events/outbox owns reliable service-to-communication event propagation.

AI may classify, summarize, draft, translate, and answer from approved context; AI may not manufacture business state.

Human escalation must be explicit, persistent, assignable, and auditable.
```

---

## 6. Canonical Data Model

Create an additive PostgreSQL/Supabase migration after inspecting all existing schemas.

Do not destructively replace existing tables.

### 6.1 Required table: `message_threads`

Minimum columns:

```sql
id UUID PRIMARY KEY
tenant_id TEXT/UUID NULLABLE ACCORDING TO EXISTING TENANCY MODEL
thread_key TEXT NOT NULL
thread_type TEXT NOT NULL
subject_type TEXT NULL
subject_id TEXT/UUID NULL
primary_user_id TEXT/UUID NULL
primary_channel TEXT NULL
status TEXT NOT NULL
priority TEXT NOT NULL
ai_mode TEXT NOT NULL
assignment_type TEXT NULL
assigned_admin_id TEXT/UUID NULL
assigned_team TEXT NULL
referral_code_id TEXT/UUID NULL
referral_campaign_id TEXT/UUID NULL
marketplace_listing_id TEXT/UUID NULL
escrow_id TEXT/UUID NULL
financing_application_id TEXT/UUID NULL
last_message_at TIMESTAMPTZ NULL
first_response_at TIMESTAMPTZ NULL
resolved_at TIMESTAMPTZ NULL
closed_at TIMESTAMPTZ NULL
sla_due_at TIMESTAMPTZ NULL
metadata JSONB NOT NULL DEFAULT '{}'
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Recommended enums/checks:

```text
thread_type:
  support
  marketplace_inquiry
  referral
  escrow
  finance
  import
  container
  trust_safety
  feedback
  complaint
  account
  general

status:
  open
  awaiting_ai
  awaiting_human
  assigned
  awaiting_user
  escalated
  resolved
  closed
  spam

priority:
  low
  normal
  high
  urgent

ai_mode:
  enabled
  draft_only
  disabled
  human_only
```

Required constraints/indexes:

```text
unique thread_key per tenant where appropriate
index primary_user_id + updated_at
index status + priority + sla_due_at
index assigned_admin_id + status
index subject_type + subject_id
index marketplace_listing_id
index referral_campaign_id
index escrow_id
index financing_application_id
```

### 6.2 Required table: `message_participants`

Minimum columns:

```sql
id UUID PRIMARY KEY
thread_id UUID NOT NULL
participant_type TEXT NOT NULL
user_id TEXT/UUID NULL
admin_id TEXT/UUID NULL
external_identity_id UUID NULL
role TEXT NOT NULL
display_name TEXT NULL
joined_at TIMESTAMPTZ NOT NULL
left_at TIMESTAMPTZ NULL
last_read_at TIMESTAMPTZ NULL
notification_muted BOOLEAN NOT NULL DEFAULT FALSE
metadata JSONB NOT NULL DEFAULT '{}'
```

Participant types:

```text
user
admin
agent
system
external_contact
business
```

### 6.3 Supporting required table: `messages`

The initial plan did not list this table, but durable threads cannot exist safely without canonical messages.

Minimum columns:

```sql
id UUID PRIMARY KEY
thread_id UUID NOT NULL
tenant_id TEXT/UUID NULL
direction TEXT NOT NULL
message_type TEXT NOT NULL
sender_participant_id UUID NULL
sender_user_id TEXT/UUID NULL
channel TEXT NOT NULL
provider TEXT NULL
provider_message_id TEXT NULL
client_message_id TEXT NULL
in_reply_to_message_id UUID NULL
content_text TEXT NULL
content_json JSONB NOT NULL DEFAULT '{}'
attachment_metadata JSONB NOT NULL DEFAULT '[]'
language TEXT NULL
ai_generated BOOLEAN NOT NULL DEFAULT FALSE
ai_run_id TEXT/UUID NULL
human_approved BOOLEAN NOT NULL DEFAULT FALSE
status TEXT NOT NULL
sent_at TIMESTAMPTZ NULL
delivered_at TIMESTAMPTZ NULL
read_at TIMESTAMPTZ NULL
failed_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Required uniqueness:

```text
unique provider + provider_message_id where provider_message_id is not null
unique tenant + client_message_id where client_message_id is not null
```

Message statuses:

```text
received
queued
processing
sent
delivered
read
failed
dead_letter
suppressed
```

### 6.4 Supporting required table: `channel_identities`

This connects the same person across channels.

Minimum columns:

```sql
id UUID PRIMARY KEY
tenant_id TEXT/UUID NULL
user_id TEXT/UUID NULL
channel TEXT NOT NULL
provider TEXT NULL
external_id TEXT NOT NULL
normalized_address TEXT NULL
display_name TEXT NULL
verified BOOLEAN NOT NULL DEFAULT FALSE
consent_status TEXT NOT NULL
first_seen_at TIMESTAMPTZ NOT NULL
last_seen_at TIMESTAMPTZ NOT NULL
metadata JSONB NOT NULL DEFAULT '{}'
```

Examples:

```text
WhatsApp phone number
Telegram user/chat ID
email address
SMS phone number
Instagram scoped user ID
Facebook page-scoped user ID
web session ID
mobile installation/user ID
```

Identity linking rules:

- Do not merge identities solely because names match.
- Link automatically only when authenticated account context, verified address/phone, signed referral session, or approved admin process proves the match.
- Store confidence and provenance in metadata if the existing identity service supports it.
- Never expose one channel’s private identifier to another participant.

### 6.5 Required table: `notification_queue`

A table already exists in a legacy migration. Inspect actual deployed and production schema before changing it.

Use one canonical queue. Do not create a second competing queue.

Required production fields, whether added or mapped:

```sql
id UUID/TEXT PRIMARY KEY
tenant_id TEXT/UUID NULL
recipient_user_id TEXT/UUID NULL
recipient_identity_id UUID NULL
thread_id UUID NULL
message_id UUID NULL
event_id UUID/TEXT NULL
notification_type TEXT NOT NULL
channel TEXT NOT NULL
provider TEXT NULL
template_key TEXT NULL
payload JSONB NOT NULL
priority TEXT NOT NULL
status TEXT NOT NULL
dedupe_key TEXT NOT NULL
scheduled_at TIMESTAMPTZ NOT NULL
next_attempt_at TIMESTAMPTZ NULL
attempt_count INTEGER NOT NULL DEFAULT 0
max_attempts INTEGER NOT NULL
last_error_code TEXT NULL
last_error_message TEXT NULL
locked_at TIMESTAMPTZ NULL
locked_by TEXT NULL
sent_at TIMESTAMPTZ NULL
delivered_at TIMESTAMPTZ NULL
dead_lettered_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Required unique constraint:

```text
unique dedupe_key
```

Statuses:

```text
queued
processing
sent
delivered
failed
retry_scheduled
dead_letter
cancelled
suppressed
```

### 6.6 Supporting required table: `message_delivery_attempts`

Minimum columns:

```sql
id UUID PRIMARY KEY
notification_id UUID/TEXT NOT NULL
message_id UUID NULL
attempt_number INTEGER NOT NULL
provider TEXT NOT NULL
channel TEXT NOT NULL
provider_request_id TEXT NULL
provider_message_id TEXT NULL
request_metadata JSONB NOT NULL DEFAULT '{}'
response_metadata JSONB NOT NULL DEFAULT '{}'
status TEXT NOT NULL
error_code TEXT NULL
error_message TEXT NULL
started_at TIMESTAMPTZ NOT NULL
completed_at TIMESTAMPTZ NULL
next_retry_at TIMESTAMPTZ NULL
```

Do not store full secrets, authorization headers, raw tokens, or unnecessary personal content.

### 6.7 Required table: `outbox_events` / canonical domain outbox

The repository currently has both a legacy `outbox_events` migration and the active `domain_events` event worker model.

Do not create a third event table.

Codex must inspect runtime usage and choose a canonical implementation:

- Prefer extending `domain_events` if it is the active production outbox.
- Provide a compatibility path or migration note for legacy `outbox_events`.
- Update services and tests to use one runtime outbox abstraction.
- Do not drop either legacy table without a separate approved migration.

Recommended additional fields for reliable orchestration:

```text
aggregate_type
aggregate_id
correlation_id
causation_id
dedupe_key
available_at
processed_at
locked_at
locked_by
```

### 6.8 Required table: `webhook_logs`

Minimum columns:

```sql
id UUID PRIMARY KEY
tenant_id TEXT/UUID NULL
provider TEXT NOT NULL
channel TEXT NOT NULL
provider_event_id TEXT NULL
dedupe_key TEXT NOT NULL
signature_valid BOOLEAN NOT NULL
payload_hash TEXT NOT NULL
payload_redacted JSONB NULL
headers_redacted JSONB NULL
processing_status TEXT NOT NULL
message_count INTEGER NOT NULL DEFAULT 0
attempt_count INTEGER NOT NULL DEFAULT 0
received_at TIMESTAMPTZ NOT NULL
processed_at TIMESTAMPTZ NULL
error_code TEXT NULL
error_message TEXT NULL
correlation_id TEXT NULL
```

Required unique constraint:

```text
unique dedupe_key
```

Rules:

- Compute dedupe keys from provider event/update/message identifiers where available.
- Fall back to a stable hash of normalized provider + event timestamp window + payload hash.
- Store only redacted payload where full content is not needed.
- Never log provider secrets or raw authorization headers.
- Duplicate webhook delivery must return a safe success response and must not create duplicate messages or notifications.

### 6.9 Supporting table: `communication_preferences`

Minimum columns:

```sql
id UUID PRIMARY KEY
user_id TEXT/UUID NOT NULL
tenant_id TEXT/UUID NULL
transactional_enabled BOOLEAN NOT NULL DEFAULT TRUE
marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE
whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE
telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE
email_enabled BOOLEAN NOT NULL DEFAULT TRUE
sms_enabled BOOLEAN NOT NULL DEFAULT FALSE
push_enabled BOOLEAN NOT NULL DEFAULT TRUE
in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE
preferred_channel TEXT NULL
fallback_channels JSONB NOT NULL DEFAULT '[]'
quiet_hours_start TIME NULL
quiet_hours_end TIME NULL
timezone TEXT NULL
language TEXT NULL
consent_source TEXT NULL
consent_version TEXT NULL
consented_at TIMESTAMPTZ NULL
withdrawn_at TIMESTAMPTZ NULL
updated_at TIMESTAMPTZ NOT NULL
```

Transactional and legally required messages must be separated from marketing messages.

### 6.10 Supporting table: `communication_escalations`

Minimum columns:

```sql
id UUID PRIMARY KEY
thread_id UUID NOT NULL
reason_code TEXT NOT NULL
severity TEXT NOT NULL
source TEXT NOT NULL
assigned_team TEXT NULL
assigned_admin_id TEXT/UUID NULL
status TEXT NOT NULL
due_at TIMESTAMPTZ NULL
resolved_at TIMESTAMPTZ NULL
resolution_summary TEXT NULL
metadata JSONB NOT NULL DEFAULT '{}'
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

### 6.11 RLS, tenancy, and audit

Every new table must follow the repository’s current Supabase/Postgres tenancy and RLS conventions.

Required guarantees:

```text
Users may read only their own permitted threads/messages.
Admins require explicit role permissions.
Service-role access is backend-only.
Cross-tenant reads are denied by default.
Provider webhook routes do not gain arbitrary database access.
Admin actions write audit records.
AI tool calls write audit records.
Sensitive internal risk reasons are not exposed to users.
```

---

## 7. Canonical Channel Contract

Create or formalize shared types/constants used by backend, web, and mobile.

Example:

```ts
export type CommunicationChannel =
  | 'whatsapp'
  | 'telegram'
  | 'email'
  | 'sms'
  | 'instagram'
  | 'facebook'
  | 'web_chat'
  | 'mobile_chat'
  | 'in_app'
  | 'push';

export type ThreadStatus =
  | 'open'
  | 'awaiting_ai'
  | 'awaiting_human'
  | 'assigned'
  | 'awaiting_user'
  | 'escalated'
  | 'resolved'
  | 'closed'
  | 'spam';

export interface CanonicalInboundMessage {
  provider: string;
  channel: CommunicationChannel;
  providerEventId?: string;
  providerMessageId?: string;
  externalSenderId: string;
  externalConversationId?: string;
  text?: string;
  attachments?: CanonicalAttachment[];
  timestamp: string;
  replyToProviderMessageId?: string;
  referralCode?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelSendRequest {
  notificationId: string;
  messageId: string;
  recipient: ChannelRecipient;
  content: RenderedMessageContent;
  idempotencyKey: string;
  correlationId: string;
}

export interface ChannelSendResult {
  accepted: boolean;
  providerRequestId?: string;
  providerMessageId?: string;
  providerStatus?: string;
  retryable?: boolean;
  errorCode?: string;
  errorMessage?: string;
}
```

Channel adapters must implement a common interface:

```ts
interface CommunicationChannelAdapter {
  channel: CommunicationChannel;
  validateConfiguration(): AdapterConfigurationStatus;
  verifyWebhook?(input: WebhookVerificationInput): Promise<WebhookVerificationResult>;
  parseWebhook?(input: WebhookInput): Promise<CanonicalInboundMessage[]>;
  send(input: ChannelSendRequest): Promise<ChannelSendResult>;
  normalizeReceipt?(input: WebhookInput): Promise<CanonicalDeliveryReceipt[]>;
}
```

---

## 8. Core Services to Implement

Use repository naming and module conventions discovered during implementation.

Expected service boundaries:

```text
communicationRepository
communicationThreadService
communicationIdentityService
communicationInboundService
communicationOrchestratorService
communicationNotificationService
communicationDeliveryWorker
communicationWebhookService
communicationTemplateService
communicationPreferenceService
communicationEscalationService
communicationAiService
communicationMetricsService
communicationAuditService
communicationReferralBridgeService
communicationMarketplaceBridgeService
communicationEscrowBridgeService
communicationFinanceBridgeService
```

Do not create unnecessary classes if the repository uses functions. Preserve local conventions.

### 8.1 Thread service

Responsibilities:

```text
resolve or create thread
attach participants
link subject entities
assign admin/team
change thread state
record first response
record unread/read markers
resolve/reopen/close
apply SLA
write audit record
```

### 8.2 Identity service

Responsibilities:

```text
normalize phone/email/channel IDs
find known identity
link authenticated user safely
prevent unsafe identity merges
record consent source
update last-seen metadata
```

### 8.3 Inbound service

Responsibilities:

```text
verify webhook was accepted and deduplicated
resolve channel identity
resolve/create thread
persist canonical inbound message
extract referral context through existing referral gateway
classify intent
detect urgent/safety cases
invoke AI only when allowed
route to human when required
queue outbound reply
```

### 8.4 Orchestrator

Responsibilities:

```text
subscribe to domain events
map event to notification policy
select recipients
apply preference/consent/quiet-hour rules
select channel and fallback order
render approved template
create canonical message
enqueue notification with dedupe key
```

### 8.5 Delivery worker

Responsibilities:

```text
claim queued notifications safely
use SKIP LOCKED or equivalent concurrency control
deliver through adapter
record delivery attempt
update notification/message status
schedule exponential backoff with jitter
move permanent failures to dead letter
trigger permitted fallback channel
emit metrics and audit events
```

### 8.6 Webhook service

Responsibilities:

```text
verify signatures/secrets before processing
log receipt
deduplicate
parse bounded message batches
persist provider event identifiers
process messages transactionally where feasible
acknowledge duplicates safely
handle delivery/read receipts
redact logs
```

---

## 9. AI Automation and Human Communication

AI is a communication assistant, not the source of business truth.

### 9.1 Allowed AI functions

AI may:

```text
classify intent
detect language
summarize long threads
draft replies
answer approved FAQ and help content
explain backend-provided status
extract structured inquiry details
suggest next action
translate draft replies
detect probable frustration or urgency
detect probable spam/scam language
recommend escalation
prepare an admin handoff summary
generate channel-appropriate share copy
```

### 9.2 Prohibited autonomous AI behavior

AI must not:

```text
approve finance
approve escrow release
confirm a payment not proven by backend state
promise a refund
award referral rewards
invent verification/trust status
disclose private evidence
reveal internal risk signals
make binding legal claims
make definitive mechanical-condition claims
close urgent complaints without human review
send marketing without consent
merge user identities from weak evidence
```

### 9.3 AI response modes

Implement thread-level modes:

```text
enabled:
  AI may answer low-risk requests using approved context.

draft_only:
  AI drafts; human must approve before sending.

disabled:
  AI is not used.

human_only:
  all communication requires a human.
```

### 9.4 Mandatory human handoff conditions

Escalate immediately when:

```text
user explicitly asks for a human
AI confidence is below configured threshold
user repeats the same unresolved issue
negative/frustrated sentiment crosses threshold
payment, escrow release, refund, fraud, safety, legal, identity, or finance decision is involved
AI lacks authoritative status
message contains threat, abuse, self-harm, or emergency language
high-value transaction exceeds configured threshold
VIP/business account rule requires human handling
provider delivery failures make communication uncertain
```

Use safe policy handling for self-harm/emergency content; do not attempt to implement clinical decision-making.

### 9.5 No-client-left-frustrated policy

Implement measurable controls:

```text
Every inbound message receives a persisted acknowledgement or assignment state.
Every open thread has an owner: AI queue, human team, or named admin.
Every high-priority thread has an SLA due time.
Overdue threads escalate.
Repeated user messages increase priority.
AI handoff includes summary and recommended next action.
Admins can see unanswered and overdue threads.
Resolution requires a reason/summary.
User feedback can reopen a thread.
```

Default initial SLA values may be configuration-driven:

```text
urgent: 15 minutes
high: 1 hour
normal: 8 business hours
low: 24 hours
```

Do not hardcode business-hour calendars deeply; expose configuration.

---

## 10. Referral System Integration

The communication engine must extend the existing referral engine rather than recalculate referral logic.

### Required behavior

```text
All listing share links preserve referral code, campaign, listing, and source channel.
Inbound messages attempt referral extraction through the existing referral channel gateway.
Valid attribution attaches to the thread and relevant inquiry/event.
Invalid codes do not block communication.
Referral validation failure produces a safe explanation and optional human handoff.
Communication code never calculates wallet rewards.
Reward and coupon truth comes only from the referral engine.
Thread views may show referral context to authorized admins.
User-facing messages must not expose another referrer’s private information.
```

### Required bridge events

At minimum:

```text
communication.inbound_received
communication.thread_created
communication.message_received
communication.message_queued
communication.message_sent
communication.message_delivered
communication.message_failed
communication.thread_escalated
communication.thread_resolved
communication.feedback_received
communication.referral_attribution_attached
communication.share_link_created
```

Consume relevant referral events:

```text
referral.code_validated
referral.coupon_applied
referral.wallet_status_changed
campaign.status_changed
referral.review_required
```

Do not invent event names that conflict with existing constants; align after inspection.

### Share-link requirements

The generated link or payload must preserve:

```text
listing_id
referral_code
campaign_id where safe
utm_source
utm_medium
utm_campaign
channel
share_id or dedupe-safe event reference
```

Do not expose internal database IDs where public tokens are safer.

---

## 11. Marketplace Integration

Required marketplace communication flows:

```text
share listing
ask seller/dealer a question
request quote
request inspection
request import quote
request parts availability
request garage/service booking
saved-search alert
price-change alert
trust/evidence status change alert
listing approved/rejected/suppressed alert
new inquiry alert to seller/dealer
inquiry reply alert to buyer
```

Rules:

```text
Use canonical marketplace listing IDs and public URLs.
Do not expose suppressed/private listing data.
Do not let AI fabricate seller availability, price, trust, or evidence.
Marketplace inquiry creates or reuses a marketplace_inquiry thread.
Referral context from the listing/share session must attach to the inquiry.
Seller and buyer must remain separate participants with role-aware visibility.
Admin may join a thread only with authorized support/moderation context.
```

---

## 12. Escrow Integration

The communication engine must subscribe to authoritative escrow events.

Minimum events to support if present:

```text
escrow.created
escrow.deposit_requested
escrow.deposit_received
escrow.funded
escrow.inspection_required
escrow.release_requested
escrow.released
escrow.disputed
escrow.refund_requested
escrow.refunded
escrow.failed
```

Required behavior:

```text
Create notifications from persisted escrow state.
Use approved templates.
Never expose full payment credentials.
High-risk or dispute events require human/admin routing.
AI may explain status but may not change or promise status.
Every escrow notification includes a stable user-facing reference.
Duplicate domain events must not create duplicate notifications.
```

If the repository does not yet emit all events, implement the bridge contract and tests for available events without inventing false transaction behavior.

---

## 13. Financing Integration

Subscribe to authoritative finance events.

Minimum event contract:

```text
finance.application_received
finance.documents_required
finance.under_review
finance.additional_information_required
finance.prequalified
finance.approved
finance.declined
finance.offer_expiring
finance.disbursed
finance.cancelled
```

Rules:

```text
AI may explain a backend-provided status.
AI may collect missing non-sensitive form fields through approved flow.
AI may not approve, decline, score, or alter financing.
Sensitive financial documents must not be copied into general message logs.
Templates must not promise guaranteed approval.
Approval notifications require authoritative persisted approval state.
Admin finance queues must be permission-scoped.
```

---

## 14. Feedback, Complaints, Questions, and Support

Every user communication must be classified into an auditable intent.

Minimum intents:

```text
general_question
marketplace_inquiry
listing_share
parts_request
garage_request
import_request
container_request
escrow_question
finance_question
referral_question
technical_support
account_access
feedback
complaint
fraud_report
safety_report
privacy_request
human_request
spam
unknown
```

Required behavior:

```text
Feedback is persisted and linked to user/thread.
Complaints receive priority and SLA.
Fraud/safety reports route to trust and safety.
Privacy requests route to an authorized admin workflow.
Unknown intents receive acknowledgement and human fallback.
Closing a complaint requires a resolution summary.
Admins can filter by intent, priority, channel, assignment, age, and SLA.
```

---

## 15. Admin Communication Command Center

Add a role-protected admin communication area.

Use existing dashboard/navigation/Feature Registry patterns.

Expected route:

```text
/dashboard/admin/communications
```

Do not hardcode a disconnected route if the Feature Registry has an established model.

### Required admin UI

Inbox list:

```text
thread subject
user/contact summary
channel icon
latest message preview
intent
priority
status
assigned team/admin
unread count
age
SLA state
linked listing/referral/escrow/finance reference
AI/human mode
```

Thread workspace:

```text
canonical conversation timeline
channel/source labels
participant list
linked business entities
referral context
AI summary
AI suggested reply
reply composer
channel selection
template selection
assign/reassign
priority control
escalate
resolve/reopen/close
internal notes separated from user-visible messages
audit timeline
delivery status and retry visibility
```

Command-center filters:

```text
unassigned
awaiting human
overdue
urgent
failed delivery
dead letter
complaints
fraud/safety
marketplace
referrals
escrow
finance
channel
assigned admin/team
```

Dashboard metrics:

```text
open threads
unanswered threads
SLA breaches
median first response
median resolution time
AI-contained rate
human-handoff rate
delivery success by channel
retry rate
dead-letter count
duplicate webhook count
user satisfaction/feedback where available
```

### Role rules

```text
Support agents see permitted support threads.
Finance staff see permitted finance threads.
Trust/safety staff see permitted risk threads.
Marketplace admins see permitted marketplace threads.
Super admins see broader operational data.
No role receives unrestricted access merely because it can open the dashboard.
```

---

## 16. User Communication Surfaces

### Web

Add or integrate:

```text
in-app notification center
unread badge
notification list
thread/message detail where appropriate
communication preferences
support/contact entry point
listing inquiry flow
Ask AI entry point
```

### Mobile

Use the same backend APIs and canonical types.

Add or integrate:

```text
notification center
push-to-thread deep link
chat/support entry
marketplace inquiry
referral share sheet
communication preferences
read/unread synchronization
```

Do not create separate mobile business logic.

### Public/guest users

Allow limited guest inquiries only where the current product already permits them.

Required protections:

```text
rate limiting
CAPTCHA or abuse control where available
validated contact method
consent capture
no private thread enumeration
guest access token with narrow scope if implemented
```

---

## 17. Notification Policy

Create a configuration-driven notification policy map.

Example:

```ts
{
  eventType: 'escrow.funded',
  notificationType: 'escrow_status',
  audience: ['buyer', 'seller'],
  priority: 'high',
  channels: ['in_app', 'push', 'whatsapp', 'email'],
  fallbackChannels: ['sms'],
  templateKey: 'escrow_funded_v1',
  transactional: true,
  quietHoursBypass: true
}
```

### Rules

```text
Transactional notifications do not require marketing opt-in, but require a valid relationship and lawful contact basis.
Marketing notifications require explicit consent.
Quiet hours suppress or delay non-urgent messages.
Security alerts may bypass quiet hours.
Fallback must respect consent and available verified identities.
One event-recipient-template combination must produce one dedupe key.
Users must not receive the same alert repeatedly because a worker retried.
```

---

## 18. Templates and Content Safety

Implement versioned templates or an equivalent repository-approved structure.

Required template metadata:

```text
template_key
version
channel
language
transactional/marketing classification
subject where applicable
body
required variables
approved status
fallback text
```

Required initial template families:

```text
message acknowledgement
human handoff
marketplace inquiry received
marketplace reply received
listing shared
saved-listing alert
escrow status
finance status
referral/coupon status
import/container status
verification/trust status
support assigned
support resolved
delivery failure fallback
security/account alert
feedback request
```

Rules:

```text
Escape untrusted variables.
Do not render raw HTML from users.
Do not include secrets or internal risk reasons.
Do not allow AI-generated templates to become active without review.
Keep provider-specific length and formatting constraints in adapters/templates.
```

---

## 19. Retry, Backoff, Fallback, and Dead Letter

### Required retry behavior

Use exponential backoff with jitter.

A reasonable default contract:

```text
attempt 1: immediate
attempt 2: ~1 minute
attempt 3: ~5 minutes
attempt 4: ~30 minutes
attempt 5: ~2 hours
then dead letter
```

Exact values must be configuration-driven and testable.

### Error classification

```text
Retryable:
  timeout
  network failure
  provider 429
  provider 5xx
  temporary provider unavailable

Non-retryable:
  invalid recipient
  blocked recipient
  invalid template
  revoked consent
  invalid credentials/configuration
  provider 4xx indicating permanent rejection
```

Credential/configuration failure should alert operations and stop wasteful repeated delivery.

### Fallback

After configured failure threshold:

```text
try next permitted verified channel
record fallback reason
do not duplicate content on already successful channels
preserve thread/message relationship
respect consent and quiet hours
```

### Dead-letter recovery

Admins must be able to:

```text
see dead-letter notifications
inspect redacted failure reason
retry after correction
cancel permanently
switch permitted channel
link the action to an audit record
```

---

## 20. Webhook Security and Deduplication

Required controls:

```text
Meta webhook verification token/challenge
Meta request signature validation where supported
Telegram secret-token validation
provider-specific email/SMS webhook verification
strict bounded payload size
bounded message count
rate limiting
timestamp/replay protection where supported
constant-time secret comparison
redacted logging
idempotent processing
```

### Deduplication algorithm

Prefer provider identifiers:

```text
provider + channel + provider_event_id
provider + channel + provider_message_id
telegram + update_id
meta + entry/change/message id
email + provider event id
sms + provider callback id
```

Fallback:

```text
SHA-256(provider + channel + normalized external sender + normalized timestamp bucket + normalized payload hash)
```

Duplicate webhook handling must:

```text
return 200/accepted where provider protocol expects it
increment duplicate metric
not create a second message
not create a second referral event
not create a second notification
not invoke AI twice
```

---

## 21. Privacy, Consent, Retention, and Security

### Privacy

```text
Minimize stored provider payloads.
Redact authorization headers, tokens, passwords, card/payment data, identity documents, and unnecessary attachments.
Encrypt or use repository-standard secure storage for sensitive fields.
Do not expose raw provider IDs in public APIs.
Separate internal notes from user-visible messages.
```

### Consent

```text
Record source, version, timestamp, channel, and purpose.
Marketing opt-out must take effect promptly.
Transactional communications remain limited to legitimate active workflows.
STOP/unsubscribe keywords must be handled for SMS/WhatsApp where applicable.
Telegram/email unsubscribe flows must be supported where applicable.
```

### Retention

Implement configuration or documented policy hooks for:

```text
webhook raw/redacted payload retention
message retention
attachment retention
audit retention
dead-letter retention
user deletion/anonymization requests
```

Do not silently delete financial/audit records that have a separate lawful retention requirement.

### Security tests

At minimum prove:

```text
invalid webhook secrets rejected
duplicate webhook ignored
cross-tenant thread access denied
user cannot read another user’s thread
non-admin cannot use admin communication routes
AI cannot receive private fields not in approved context
provider secrets do not enter logs/build artifacts
marketing opt-out suppresses marketing sends
```

---

## 22. APIs

Align with existing Express route conventions.

Suggested route group:

```text
/api/communications
```

### User routes

```text
GET    /api/communications/threads
GET    /api/communications/threads/:id
POST   /api/communications/threads
POST   /api/communications/threads/:id/messages
POST   /api/communications/threads/:id/read
POST   /api/communications/threads/:id/feedback
GET    /api/communications/notifications
POST   /api/communications/notifications/:id/read
GET    /api/communications/preferences
PATCH  /api/communications/preferences
POST   /api/communications/share
```

### Admin routes

```text
GET    /api/admin/communications/threads
GET    /api/admin/communications/threads/:id
POST   /api/admin/communications/threads/:id/reply
PATCH  /api/admin/communications/threads/:id/assignment
PATCH  /api/admin/communications/threads/:id/priority
POST   /api/admin/communications/threads/:id/escalate
POST   /api/admin/communications/threads/:id/resolve
POST   /api/admin/communications/threads/:id/reopen
GET    /api/admin/communications/dead-letter
POST   /api/admin/communications/dead-letter/:id/retry
POST   /api/admin/communications/dead-letter/:id/cancel
GET    /api/admin/communications/metrics
```

### Provider webhook routes

Preserve existing referral webhook paths where they are public provider endpoints unless a safe migration is required.

Do not create duplicate webhook consumers.

Either:

- extend existing `/api/referrals/channels/.../webhook` handlers so they delegate to the canonical communication inbound service while retaining referral attribution, or
- introduce `/api/communications/webhooks/:provider` and keep compatibility aliases.

Required behavior must be tested either way.

### API response rules

```text
structured errors
correlation ID
no provider secrets
no internal risk details
pagination
role-scoped results
idempotency key support for message creation
safe retry semantics
```

---

## 23. Event Taxonomy

Use existing event naming conventions after inspection.

Required event families:

```text
communication.thread.*
communication.message.*
communication.notification.*
communication.delivery.*
communication.webhook.*
communication.escalation.*
communication.preference.*
communication.feedback.*
```

Minimum events:

```text
communication.thread.created
communication.thread.assigned
communication.thread.escalated
communication.thread.resolved
communication.thread.reopened
communication.message.received
communication.message.queued
communication.message.sent
communication.message.delivered
communication.message.read
communication.message.failed
communication.notification.queued
communication.notification.dead_lettered
communication.webhook.received
communication.webhook.duplicate
communication.feedback.received
```

Every event must carry:

```text
event_id
event_type
occurred_at
tenant_id where applicable
aggregate_type
aggregate_id
correlation_id
causation_id where available
actor type/id
schema_version
safe payload
```

---

## 24. Observability and Operational Controls

Add metrics compatible with the existing metrics hub.

Required metrics:

```text
communication_inbound_total{channel}
communication_outbound_total{channel}
communication_delivery_success_total{channel,provider}
communication_delivery_failure_total{channel,provider,error_class}
communication_retry_total{channel}
communication_dead_letter_total{channel}
communication_webhook_duplicate_total{provider}
communication_webhook_invalid_total{provider}
communication_open_threads
communication_unassigned_threads
communication_sla_breaches_total
communication_first_response_seconds
communication_resolution_seconds
communication_ai_reply_total
communication_ai_handoff_total
communication_ai_failure_total
```

Required structured log context:

```text
correlation_id
tenant_id
thread_id
message_id
notification_id
event_id
channel
provider
attempt
status
```

Do not log full message content by default.

Add health/readiness checks for configured adapters without exposing secrets.

---

## 25. Required Tests

The feature is not complete until tests prove behavior.

### 25.1 Original Agent 8 tests

#### TEST 1 — WhatsApp share link operational

Prove:

```text
valid listing + referral context generates a WhatsApp-compatible share URL
listing URL is present
referral code/campaign attribution is preserved
share event is recorded
no complex manual URL construction is required by the user
```

#### TEST 2 — Notifications queued

Prove:

```text
authoritative domain event creates notification_queue record
recipient and permitted channel selected
template rendered
dedupe key present
canonical message linked
```

#### TEST 3 — Retries successful

Prove:

```text
fake adapter fails with retryable error
attempt is recorded
notification moves to retry_scheduled
next_attempt_at follows configured backoff
later attempt succeeds
message/notification status becomes sent/delivered
no duplicate canonical message created
```

#### TEST 4 — Webhook deduplication operational

Prove:

```text
same provider webhook delivered twice
one webhook log is canonical
duplicate is recognized
one inbound message created
one AI invocation maximum
one referral event maximum
safe success acknowledgement returned
```

### 25.2 Backend unit/integration tests

Add tests for:

```text
thread creation and reuse
participant access
cross-channel identity resolution
unsafe identity merge prevention
inbound WhatsApp/Telegram/Instagram/Facebook parsing
email/SMS adapter contract
web/mobile message ingestion
user/admin authorization
RLS or repository tenancy filters
AI safe response and handoff
human assignment
SLA escalation
preference and consent enforcement
quiet hours
fallback channel
dead-letter behavior
admin retry/cancel
domain event deduplication
escrow notification mapping
finance notification mapping
marketplace inquiry thread
referral attribution bridge
read/unread state
feedback/reopen flow
payload redaction
```

### 25.3 Existing referral regression

The existing referral-channel gateway tests must remain green.

At minimum rerun:

```bash
node --test backend/tests/referral-channel-gateway-phase3.test.js
```

If PR #88 is the branch base, rerun its complete referral regression and UAT-safe suites that do not require unauthorized production access.

### 25.4 Web tests

Prove:

```text
admin communication route protected
inbox loads
thread opens
reply composer works
assignment works
escalation works
resolve/reopen works
delivery failure/dead-letter visible
notification center works
preferences save
listing share action works
```

### 25.5 Mobile tests

Prove:

```text
notification center loads
deep link opens correct permitted thread/listing
referral share action includes attribution
support/chat entry creates message
preferences synchronize
mobile consumes backend contract
```

### 25.6 Playwright

Replace the current skipped placeholder in:

```text
tests/agents/08-whatsapp-telegram.spec.ts
```

with meaningful tests or add a properly configured Agent 8 suite.

Do not claim live WhatsApp, Telegram, Meta, email, or SMS delivery unless provider credentials and sandbox/test accounts were actually used.

Use fake adapters for deterministic CI and separately document live provider verification status.

### 25.7 Migration tests

Prove:

```text
migration applies cleanly
required indexes and unique constraints exist
migration is additive
no destructive data loss
rollback notes are accurate
RLS policies compile
```

---

## 26. Required Implementation Order

Follow this dependency order unless code inspection proves a safer sequence.

```text
1. Inspect main, PR #88, open communication/referral/marketplace/notification PRs, and git status.
2. Record a current-state gap matrix before editing.
3. Resolve the canonical outbox and notification_queue runtime strategy.
4. Define shared communication constants/types.
5. Add additive database migration and RLS/indexes.
6. Implement communication repository and thread/message/identity services.
7. Implement notification policy, templates, and queue orchestration.
8. Implement delivery worker and deterministic fake adapters.
9. Integrate Telegram and existing Meta/WhatsApp/Instagram/Facebook parsers.
10. Add email and SMS adapter contracts and configured adapters where credentials/providers exist.
11. Add webhook_logs, signature verification, dedupe, receipts, and redaction.
12. Bridge existing referral gateway into canonical inbound/thread flow.
13. Bridge marketplace inquiry/share events.
14. Bridge escrow events that exist.
15. Bridge finance events that exist.
16. Implement AI triage/drafting/safe-answer/handoff using existing agent gateway patterns.
17. Implement SLA assignment/escalation and no-client-left-frustrated controls.
18. Add user notification center/preferences/support surfaces.
19. Add admin communication command center.
20. Add mobile parity using same APIs/types.
21. Replace skipped Agent 8 test and add backend/web/mobile tests.
22. Run targeted tests, then full regression, type checks, builds, and Playwright.
23. Document live-provider credentials/configuration separately without committing secrets.
24. Open PR with complete evidence and stop before merge.
```

---

## 27. Expected File Areas

Codex must discover actual conventions before creating files.

Likely areas:

```text
backend/routes/communicationRoutes.js
backend/routes/adminCommunicationRoutes.js
backend/services/communication/
backend/services/communication/adapters/
backend/services/communication/templates/
backend/tests/communication-*.test.js
database/migrations/<timestamp>_omnichannel_communication_engine.sql
shared/types/communication.ts
web/src/pages/dashboard/admin/Communications.tsx
web/src/components/communication/
web/src/lib/communicationApi.ts
mobile/app/... communication/notification screens
mobile/utils/communicationApi.ts
tests/agents/08-whatsapp-telegram.spec.ts
```

Do not force these exact paths if established repository patterns differ.

---

## 28. Environment and Configuration

Document required environment variables in the repository’s safe example configuration.

Possible variables:

```text
COMMUNICATION_ENGINE_ENABLED
COMMUNICATION_WORKER_ENABLED
COMMUNICATION_WORKER_INTERVAL_MS
COMMUNICATION_MAX_ATTEMPTS
COMMUNICATION_RETRY_BASE_MS
COMMUNICATION_AI_MODE_DEFAULT
COMMUNICATION_SLA_URGENT_MINUTES
COMMUNICATION_SLA_HIGH_MINUTES
COMMUNICATION_SLA_NORMAL_MINUTES
COMMUNICATION_SLA_LOW_MINUTES

CARUP_CHANNEL_WEBHOOK_SECRET
CARUP_META_WEBHOOK_VERIFY_TOKEN
CARUP_META_APP_SECRET
CARUP_META_ACCESS_TOKEN
CARUP_META_PHONE_NUMBER_ID
CARUP_TELEGRAM_BOT_TOKEN
CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN

EMAIL_PROVIDER
BREVO_API_KEY or SMTP_* according to selected adapter
SMS_PROVIDER
SMS provider credentials according to selected adapter

PUSH_PROVIDER
EXPO_ACCESS_TOKEN where applicable
```

Rules:

```text
No real secret in source, tests, logs, docs, or build artifacts.
Feature remains bootable when optional provider credentials are absent.
Missing optional provider configuration marks adapter unavailable.
Fake adapter is used only in development/test, never silently in production.
```

---

## 29. Failure-Safe Behavior

The system must degrade safely.

```text
If AI is unavailable:
  acknowledge and route to human or deterministic FAQ fallback.

If a provider is unavailable:
  retry, then use permitted fallback.

If notification worker is unavailable:
  retain queued work; do not lose domain event.

If webhook processing fails after receipt:
  log status and allow controlled replay without duplication.

If referral validation fails:
  continue support/inquiry without attribution.

If marketplace/escrow/finance service is unavailable:
  do not invent state; explain temporary unavailability and escalate.

If database transaction fails:
  do not report success to internal callers unless persistence is confirmed.

If optional provider config is missing:
  expose adapter as unavailable; do not crash the full API.
```

---

## 30. Acceptance Criteria

Agent 8 is complete only when all of these are true:

### Architecture

```text
One canonical thread/message model exists.
One canonical notification queue is used.
One active outbox abstraction is documented and used.
Provider adapters do not own business logic.
Inbound and outbound paths are idempotent.
```

### Channels

```text
WhatsApp, Telegram, Instagram/Facebook, email, SMS, web chat, mobile chat, in-app, and push have a common adapter/contract path.
At minimum WhatsApp and Telegram operate end-to-end through deterministic tests.
Optional live providers are configuration-gated.
```

### User experience

```text
Users can share listings with referral attribution.
Users receive authoritative alerts.
Users can ask AI and reach a human.
Users can submit feedback, inquiries, complaints, and questions.
Users can control communication preferences.
Users can see relevant communication/notification history.
```

### Admin

```text
Admins can see, assign, answer, escalate, resolve, and audit threads.
Overdue and unanswered threads are visible.
Delivery failures and dead letters are actionable.
Role restrictions are enforced.
```

### Reliability

```text
Notifications are queued.
Retries use backoff.
Fallback respects consent.
Dead-letter recovery exists.
Webhook deduplication works.
No duplicate message/referral/notification is created.
```

### Integration

```text
Referral gateway is reused.
Marketplace inquiries/shares are linked.
Available escrow events generate authoritative updates.
Available finance events generate authoritative updates.
Notifications and domain events are connected.
```

### Safety

```text
No secret leakage.
No cross-tenant data leak.
No unsupported AI business claim.
No marketing send without consent.
No finance/escrow approval by AI.
No private evidence leaked.
```

### Verification

```text
Backend targeted tests pass.
Existing referral tests pass.
Web type check/build/tests pass.
Mobile type check/tests pass.
Agent 8 Playwright tests are no longer a meaningless skip.
Migration and security tests pass.
PR contains exact evidence and known live-provider limitations.
```

---

## 31. Minimum Verification Commands

Codex must inspect repository scripts and adapt commands accurately.

Expected baseline:

```bash
git status --short
git branch --show-current
git log -1 --oneline

node --test backend/tests/referral-channel-gateway-phase3.test.js
node --test backend/tests/communication-*.test.js
node backend/tests/run-tests.js

npx tsc --noEmit --project web/tsconfig.app.json
npm run build --workspace=web
npm run test --workspace=web

npx tsc --noEmit --project mobile/tsconfig.json

npx playwright test tests/agents/08-whatsapp-telegram.spec.ts
```

Run the current repository’s actual supported commands. Do not preserve obsolete commands merely because they appear here.

If a command cannot run, report:

```text
exact command
exact error
environment limitation
whether behavior was verified another way
remaining risk
```

---

## 32. One-Time Codex `/goal` Prompt

Use this exact prompt:

```text
/goal
You are Agent 8, the Omnichannel Communication Engineer, working only in the CarUp Kimi repository: kudzimusar/carup.

Use /AGENT_8_OMNICHANNEL_COMMUNICATION_GOAL_LOOP.md as the authoritative execution brief.

Implement the complete production-testable Omnichannel Communication Engine in one continuous engineering sprint. The engine must unify WhatsApp, Telegram, email, SMS, Instagram/Facebook messaging, web chat, mobile chat, in-app notifications, and configured push notifications around durable threads, participants, messages, cross-channel identities, one notification queue, delivery attempts, webhook logs, deduplication, retry/backoff, fallback, dead-letter recovery, admin assignment, SLA escalation, AI triage/drafting/safe answers, human handoff, communication preferences, audit, metrics, and role-safe web/mobile surfaces.

Do not duplicate the existing referral-channel gateway. Reuse and extend it. Treat PR #88 as the Referral Engine dependency and follow the deterministic branch rule in section 1. Preserve referral attribution in listing shares and inbound messages. Do not calculate rewards in communication code.

Connect authoritative marketplace, escrow, finance, import/container, trust, account, and referral events to notification policies. AI may explain persisted status but may not create financial, escrow, payment, trust, verification, or approval truth.

Before coding:
1. inspect current main, PR #88, all relevant open PRs, git status, migrations, runtime queue/outbox usage, tests, navigation, web, and mobile;
2. produce a concise current-state gap matrix in the task log;
3. choose the canonical notification queue and outbox strategy without creating competing tables.

Then implement the complete vertical system, migrations, APIs, adapters, fake providers for CI, admin command center, user notification/preferences surfaces, mobile parity, tests, observability, security, and documentation.

Do not stop for ordinary implementation choices. Make repository-consistent decisions, document assumptions, and continue. Stop only for a genuine safety or product-authority blocker that cannot be resolved from the repository.

Run targeted tests after each vertical slice, then the complete regression/build/type-check/Playwright suite. Fix failures caused by your work.

Create logical commits, push the implementation branch, and open a PR with complete evidence. Do not merge, enable auto-merge, deploy production, or claim live provider delivery without actual sandbox/live evidence.
```

---

## 33. Continuous Codex `/loop` Prompt

Use this exact prompt:

```text
/loop
Continue Agent 8 implementation from /AGENT_8_OMNICHANNEL_COMMUNICATION_GOAL_LOOP.md until every acceptance criterion in section 30 is satisfied or a genuine human-authority blocker is documented.

For every loop:
1. inspect git status, current branch, latest commits, and relevant changed files;
2. state the next smallest complete vertical slice;
3. implement backend, database, shared types, web, mobile, tests, and docs required for that slice;
4. run targeted tests immediately;
5. fix regressions before moving forward;
6. preserve PR #88 referral behavior and existing architecture;
7. keep all writes idempotent and auditable;
8. never expose secrets, private evidence, internal risk details, or cross-tenant data;
9. never let AI invent business state or make finance/escrow decisions;
10. update the acceptance ledger with PASS, PARTIAL, BLOCKED, or NOT STARTED and exact evidence;
11. commit logical completed slices with clear messages;
12. continue automatically to the next unmet criterion.

After each loop report:
- sub-goal completed;
- files changed;
- migration/API/event changes;
- tests and exact results;
- acceptance criteria advanced;
- security/privacy checks;
- remaining risks;
- next loop target.

Do not merge, enable auto-merge, or deploy production.
```

---

## 34. Codex Working Rules

```text
Do not ask the user to choose routine implementation details.
Do not stop after scaffolding.
Do not replace tested referral code with a new parallel engine.
Do not create fake provider-success claims.
Do not make runtime code depend on test adapters in production.
Do not commit secrets.
Do not skip migrations, RLS, or authorization.
Do not build only the admin UI without the backend delivery engine.
Do not build only provider webhooks without durable threads.
Do not build only notification_queue records without a worker.
Do not build only retries without dedupe.
Do not build only AI chat without human escalation.
Do not silently swallow delivery failures.
Do not merge automatically.
```

---

## 35. PR Body Template

Codex must use this structure:

```markdown
# Agent 8 — Omnichannel Communication Engine

## Summary

## Dependency / Base
- Main SHA:
- Referral PR #88 status:
- Branch strategy used:

## Current State Before This PR

## Architecture Implemented

## Database and Migrations

## Canonical Threads, Messages, and Identities

## Notification Queue and Outbox Strategy

## Channel Adapters
- WhatsApp
- Telegram
- Instagram/Facebook
- Email
- SMS
- Web/Mobile chat
- In-app/Push

## Webhooks, Security, and Deduplication

## Retry, Fallback, and Dead Letter

## AI Automation and Human Handoff

## Referral Integration

## Marketplace Integration

## Escrow Integration

## Financing Integration

## Admin Command Center

## User Web and Mobile Surfaces

## APIs and Events

## Observability

## Privacy, Consent, and Authorization Guarantees

## Files Changed

## Tests Run and Results

## Live Provider Verification
- Provider:
- Environment:
- Result:
- Limitations:

## Known Limitations

## Migration / Deployment Order

## Rollback Plan

## Manual QA Checklist

## Follow-Up Work
```

---

## 36. Manual QA Checklist

Before declaring the PR ready:

```text
[ ] Create a marketplace share link for WhatsApp and verify referral/listing parameters.
[ ] Create a Telegram share/start link.
[ ] Send duplicate fake WhatsApp webhook and confirm one message.
[ ] Send duplicate Telegram update and confirm one message.
[ ] Create web chat inquiry and confirm thread/admin inbox.
[ ] Ask safe FAQ and confirm AI answer.
[ ] Ask for a human and confirm escalation.
[ ] Trigger low-confidence AI path and confirm human handoff.
[ ] Trigger marketplace inquiry notification.
[ ] Trigger available escrow status notification.
[ ] Trigger available finance status notification.
[ ] Simulate retryable provider failure and successful retry.
[ ] Simulate permanent failure and dead letter.
[ ] Retry dead-letter item as admin.
[ ] Confirm marketing opt-out suppression.
[ ] Confirm quiet-hour delay for non-urgent message.
[ ] Confirm urgent/security bypass rule where configured.
[ ] Confirm fallback uses only permitted verified channel.
[ ] Confirm user cannot read another user’s thread.
[ ] Confirm non-admin cannot open admin communication routes.
[ ] Confirm internal note is not visible to user.
[ ] Confirm logs contain no provider token or raw authorization header.
[ ] Confirm mobile deep link opens permitted destination.
[ ] Confirm unread/read synchronization.
[ ] Confirm feedback can reopen resolved thread.
```

---

## 37. Final Definition of Done

Agent 8 is finished only when CarUp has one reliable, auditable communication system rather than several channel demos.

A real user must be able to discover or share a CarUp product, contact CarUp through an available channel, receive an acknowledgement, obtain a safe AI answer or human handoff, receive authoritative transaction updates, reply without losing context, and have the complete interaction recorded under appropriate permissions.

A real admin must be able to see who is waiting, understand the context, take ownership, respond, escalate, resolve, recover failed notifications, and audit what happened.

A webhook retry, provider outage, worker restart, duplicate event, absent AI provider, or failed channel must not silently lose the user’s communication.

Referral attribution must survive the communication journey without communication code taking ownership of reward decisions.

Marketplace, escrow, finance, import/container, trust, notification, web, and mobile systems must connect through the same event-driven communication fabric.

Tests must prove the original four Agent 8 requirements and the complete production reliability contract.

Anything less is not complete.
