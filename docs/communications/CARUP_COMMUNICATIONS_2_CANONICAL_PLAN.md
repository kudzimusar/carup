# CarUp Communications 2.0
## Stakeholder Engagement, Conversation Intelligence & Omnichannel Operating Plan

**Document status:** Canonical architecture candidate — intended to become the governing specification after repository review/merge  
**Version:** 1.0  
**Date:** 2026-08-11  
**Repository:** `kudzimusar/carup`  
**Canonical repository path:** `docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`  
**Authoring baseline:** `main` at `f336d2d02731d559187ec6db50e5ee3cc5a048eb`  
**Current staging communications runtime during discovery:** PR #139 candidate at `fe464a52be644641d4e15144c3992f6560270512`  
**Primary market assumption:** Zimbabwe-first, diaspora-connected, mobile-first, WhatsApp-heavy, but architecturally omnichannel  
**Scope:** Marketplace, private seller, buyer, dealer, garage/mechanic, parts, insurance, finance, diaspora/import, logistics/container, referrals, government/public services, admin/support and future stakeholder classes

---

# 0. Governance: how this document must be used

This document is not an optional design note. Once merged, it is the **canonical product and architecture contract** for CarUp communications work.

Any implementation agent working on communications, notifications, stakeholder messaging, Marketplace inquiries, WhatsApp, Telegram, email, SMS, push, voice, templates, campaigns, analytics, AI-assisted communications, dealer/garage/insurance messaging, or communication-related UI must:

1. Read this document before changing code.
2. State the section(s) being implemented in the PR description.
3. Preserve the north-star architecture defined here.
4. Reuse the canonical conversation infrastructure instead of creating feature-specific messaging silos.
5. Treat provider integrations as transports, not as the owner of conversation state.
6. Preserve existing proven provider functionality while extending the conversation model.
7. Add or update automated tests for every acceptance criterion touched.
8. Never weaken authorization, privacy, audit, consent, trust, idempotency or delivery guarantees to make a demo pass.
9. If implementation reality contradicts this plan, stop and propose a documented plan amendment rather than silently diverging.
10. Do not describe Communications 2.0 as complete until the Definition of Done in this document is evidence-backed.

The agent should quote a line such as this in every communications PR:

> Implementation target: `docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`, sections X, Y and Z.

---

# 1. Executive decision

CarUp communications must evolve from an **event notification engine plus provider integrations** into a **stakeholder engagement and conversation intelligence platform**.

The present system has significant infrastructure already built and physically proven:

- WhatsApp real-provider inbound and outbound delivery works in staging.
- Telegram real-provider inbound and outbound delivery works in staging.
- provider webhooks, signatures/secrets, message IDs and delivery workers exist;
- communication threads, messages, queues, audit records, preferences and provider adapters exist;
- the event outbox and scheduled processing path are operational in staging;
- Admin Command Center can view and respond to provider-originated conversations;
- Marketplace emits `marketplace.inquiry.created`;
- sellers receive a Marketplace communication-thread/notification artifact.

However, the product-level communication engine is **not complete**.

Fresh UAT on 2026-08-11 proved that a Marketplace inquiry reaches the correct seller and creates a `marketplace_inquiry` thread shell, but:

- the buyer's exact inquiry is not represented as the canonical inbound conversation message;
- the seller cannot open the thread as a real conversation;
- seller and buyer are not modeled as equal conversation participants;
- ordinary-user thread authorization is still based primarily on a single `primary_user_id`;
- the seller cannot reply through CarUp to the buyer;
- the buyer's WhatsApp response cannot be guaranteed to return to the same Marketplace conversation;
- phone/email remain exposed as escape routes;
- commercial analytics and conversion attribution are not yet first-class conversation capabilities.

Therefore:

> **CarUp Communications 2.0 must make the CarUp conversation the system of record. WhatsApp, Telegram, email, SMS, push, web, mobile and future voice/video are channels through which the same governed conversation can be accessed.**

---

# 2. Evidence baseline: what is true today

## 2.1 Physically proven provider transport

### Telegram
Fresh staging acceptance proved:

`physical Telegram -> Telegram Bot API -> CarUp webhook -> CarUp persisted inbound -> Admin Command Center -> admin reply -> worker -> Telegram provider -> physical Telegram`

The test message and reply were preserved as user-visible text.

### WhatsApp
Fresh staging acceptance proved:

`physical WhatsApp -> Meta WhatsApp Cloud API -> CarUp webhook -> CarUp persisted inbound -> Admin Command Center -> fresh admin reply -> delivery worker -> Meta -> physical WhatsApp`

The buyer's exact inbound text appeared in CarUp and the admin's exact reply appeared on physical WhatsApp.

This means the provider layer is usable as a foundation. It must not be unnecessarily rewritten.

## 2.2 Marketplace discovery result

Fresh Marketplace UAT proved:

`guest buyer -> Toyota listing -> Contact Seller -> marketplace inquiry -> correct seller -> seller inquiry count 3 -> 4`

This is a real functional pass.

The same event also creates a `marketplace_inquiry` communication thread shell for the seller.

But the ordinary seller Communications UI currently renders thread summaries as static rows under a misleading **Support Chat** heading. There is no thread-open interaction and no seller C2C reply flow.

Relevant current source:

- `web/src/pages/dashboard/owner/Communications.tsx`
- `backend/routes/communicationRoutes.js`
- `backend/services/communication/communicationNotificationService.js`
- `backend/services/communication/communicationEventListeners.js`
- `backend/services/marketplace/marketplaceInquiryService.js`

## 2.3 Current architectural gap

The existing Marketplace event path is primarily:

`domain event -> notification policy -> seller-targeted thread -> templated notification`

Communications 2.0 requires:

`business intent -> canonical multi-party conversation -> exact user messages -> stakeholder actions -> channel routing -> delivery -> response -> conversion/event analytics`

This distinction must remain explicit throughout implementation.

---

# 3. Product mission

CarUp Communications 2.0 exists to make communication a **transactional, trusted and measurable operating layer** across the automotive ecosystem.

It should allow users to communicate with the people and organizations necessary to complete automotive journeys without losing context when they move between CarUp web/app and external channels.

The platform must support:

- discovery;
- inquiry;
- qualification;
- negotiation;
- quotation;
- booking;
- document/evidence collection;
- inspection;
- finance;
- insurance;
- payment/escrow;
- logistics;
- government/public-service coordination;
- status updates;
- support;
- dispute resolution;
- post-sale service;
- retention;
- reviews;
- referrals and re-engagement.

Communications is therefore not a peripheral "chat feature." It is one of the connective tissues linking Marketplace, Trust, Vehicle Passport, SafePay, Finance, Insurance, Garage, Parts, Diaspora Trade and stakeholder administration.

---

# 4. North-star interaction model

The canonical model is:

```text
                         CARUP
                Canonical Conversation
                         |
        +----------------+----------------+
        |                |                |
      Buyer            Seller           Dealer
      Owner            Garage          Insurer
      Finance          Parts           Importer
      Logistics        Government      Admin
        |                |                |
        +----------------+----------------+
                         |
               Channel Orchestration
                         |
      +----------+-------+--------+----------+
      |          |                |          |
   WhatsApp   Telegram          Email      App/Web
      |          |                |          |
      +----------+-------+--------+----------+
                         |
                 human-visible message
```

A conversation is **not owned by WhatsApp, Telegram or the web UI**.

It is owned by CarUp and has:

- participants;
- business subject/context;
- exact messages;
- media/artifacts;
- identity bindings;
- authorization;
- channel bindings;
- delivery state;
- audit state;
- consent;
- AI-derived metadata;
- funnel/conversion state.

---

# 5. Strategic principles

## 5.1 CarUp stays in the middle

Before a transaction, CarUp should not default to exposing personal contact details so users can bypass the platform.

Contact data may be revealed only when product policy, consent, legal requirements or a later transaction stage explicitly justify it.

The preferred model is:

`buyer -> CarUp -> seller -> CarUp -> buyer`

even if the buyer experiences the conversation through WhatsApp.

## 5.2 Channel-native, conversation-consistent

Messages should feel natural in each channel.

A WhatsApp reply should look like a WhatsApp reply, not a dumped system record. Email can carry richer branded layout. Push should be concise. Web/app can show deep business context.

The underlying semantic message and conversation remain consistent.

## 5.3 Exact user content is preserved

If a buyer writes:

> Hello, I am interested in this Toyota Corolla. Is it still available?

that exact text must be stored as the user's canonical inbound message.

AI interpretation, translated text, summaries and extracted intent are derived fields, never replacements for the original.

## 5.4 Business context follows the conversation

A Marketplace conversation should know the listing/VIN and inquiry. A garage conversation should know the vehicle/work order. An insurance conversation should know the vehicle/policy/quote/claim. A finance conversation should know the application.

Users should not repeatedly re-explain context that CarUp already has permission to use.

## 5.5 Accessibility without spam

CarUp should maximize users' ability to be reached through appropriate channels, but must not send every message through every provider.

Routing should be driven by:

- user preference;
- consent;
- urgency;
- business context;
- channel availability;
- provider rules;
- cost;
- prior engagement;
- deliverability;
- time zone/quiet hours;
- fallback policy.

## 5.6 AI augments people and workflows

AI can classify, summarize, translate, transcribe, extract, recommend and draft.

It must not fabricate business facts, silently change user meaning, impersonate humans where disclosure is appropriate, authorize regulated outcomes, or bypass required human review.

## 5.7 Measure outcomes, not message volume

The communication system is successful when it improves:

- response speed;
- successful contact;
- qualified leads;
- bookings;
- quotations;
- escrow initiation;
- transaction completion;
- renewals;
- referrals;
- user satisfaction;
- stakeholder performance.

Raw message counts alone are not sufficient.

---

# 6. Target architecture

Communications 2.0 has five logical layers.

## Layer 1 — Business workflows

Examples:

- Marketplace;
- Dealer;
- Garage/service;
- Parts;
- Insurance;
- Finance;
- Diaspora Trade;
- Containers/logistics;
- Referral;
- Government/public service;
- Trust and safety;
- Admin/support.

Business workflows create and consume conversation context. They must not build their own isolated messaging stacks.

## Layer 2 — Conversation intelligence

Responsible for:

- intent;
- entity extraction;
- conversation summary;
- language;
- sentiment/risk signals where appropriate;
- lead qualification;
- funnel stage;
- recommended next action;
- AI draft;
- escalation;
- conversion attribution;
- campaign attribution.

## Layer 3 — Canonical conversation domain

Responsible for:

- conversation;
- participants;
- roles;
- subjects;
- messages;
- message parts/media;
- channel identities;
- permissions;
- read state;
- assignment;
- status;
- SLA;
- audit;
- business event linkage.

## Layer 4 — Channel orchestration

Responsible for:

- preferred channel;
- consent;
- templates;
- brand rendering;
- provider eligibility;
- transactional vs marketing classification;
- quiet hours;
- fallback;
- retry;
- idempotency;
- delivery state;
- cost controls;
- provider policy compliance.

## Layer 5 — Providers/transports

Existing and future transports:

- WhatsApp;
- Telegram;
- email;
- SMS;
- push;
- web chat;
- native mobile;
- Facebook Messenger;
- Instagram messaging;
- future WhatsApp voice/calling/video where supported and justified.

The provider layer must remain replaceable. Business workflows must never couple directly to Meta/Twilio/SendGrid-specific objects when a provider-neutral semantic object is possible.

---

# 7. Canonical domain model

The exact database design is an implementation decision, but the following semantic model is mandatory.

## 7.1 Conversation

A canonical conversation must include at least:

- `id`
- `tenant_id`
- `conversation_type`
- `status`
- `priority`
- `subject_type`
- `subject_id`
- `business_workflow`
- `created_at`
- `updated_at`
- `last_message_at`
- `assigned_team`
- `assigned_user_id`
- `sla_policy_id`
- `funnel_stage`
- `conversion_status`
- metadata

Examples of `subject_type`:

- `marketplace_listing`
- `marketplace_inquiry`
- `vehicle`
- `work_order`
- `insurance_quote`
- `insurance_claim`
- `finance_application`
- `parts_order`
- `diaspora_order`
- `container_booking`
- `government_case`
- `referral_case`

## 7.2 Participants

A conversation must support more than one real participant.

Each participant should carry:

- `conversation_id`
- participant type: user, external identity, organization, team, system;
- user/organization reference;
- stakeholder role;
- permissions;
- display identity;
- join/leave timestamps;
- notification policy;
- read state;
- muted state;
- optional channel preference override.

Examples:

```text
Marketplace:
buyer + seller + CarUp system

Insurance:
vehicle owner + insurer representative + optional CarUp agent

Garage:
vehicle owner + mechanic/garage + optional CarUp support

Government:
citizen/user + government service team + optional CarUp workflow agent
```

## 7.3 Message

A canonical message should preserve:

- original text;
- sender participant;
- direction relative to recipient only at projection/render time, not as the sole source of truth;
- created time;
- edited/deleted state where supported;
- message type;
- source channel;
- reply-to relationship;
- provider IDs;
- business action metadata;
- AI disclosure metadata;
- audit fields.

A seller reply is a seller-authored message, not an "admin notification."

## 7.4 Message parts and media

Messages must be designed for multimodality from the start.

Supported semantic parts should include:

- text;
- image;
- audio/voice note;
- video;
- document;
- location;
- contact;
- structured card;
- button/quick reply;
- quote;
- system event.

Original artifacts must remain retrievable according to retention/privacy policy.

## 7.5 Channel identity

A person can have multiple communication identities:

- WhatsApp number;
- Telegram user/chat;
- email address;
- SMS number;
- CarUp user;
- future social identity.

Channel identity must be normalized and linked carefully.

The system must avoid identity fragmentation such as:

`+263...` vs `263...`

while preserving raw provider values for audit.

## 7.6 Subject linkage

Conversation context must point back to the authoritative business object.

For the reference Marketplace flow:

- listing/VIN;
- inquiry ID;
- seller ID;
- buyer user or external buyer identity;
- referral/campaign attribution where available.

## 7.7 Delivery

Delivery state belongs to a message/channel delivery attempt, not to the semantic conversation itself.

Track:

- queued;
- processing;
- accepted;
- sent;
- delivered;
- read;
- failed;
- retry scheduled;
- dead letter.

Out-of-order callbacks must never regress state from a stronger state such as `delivered` back to `sent`.

## 7.8 Audit

Audit must distinguish:

- human user action;
- AI action;
- system automation;
- provider callback;
- admin override;
- consent change;
- template selection;
- escalation;
- assignment;
- delivery retry.

Audit is append-only for material events.

---

# 8. Authorization and privacy model

The current single-`primary_user_id` access model is insufficient for C2C.

Conversation access must be participant-based and server-authorized.

Minimum rules:

- only authorized participants or permitted internal roles can read a conversation;
- a user cannot add themselves to a conversation by guessing an ID;
- participant access is verified server-side on every read/write;
- internal notes are invisible to external participants;
- provider identifiers and private contact information are not automatically exposed;
- admin observation/moderation does not make admin a conversational party;
- organization/team access is governed by tenant and role;
- sensitive financial/insurance/government artifacts may require stronger scopes than ordinary message text;
- contact data should be revealed only by explicit policy;
- all privileged access is audited.

---

# 9. Stakeholder conversation matrix

| Workflow | Participants | Context | Typical outcome |
|---|---|---|---|
| Marketplace private sale | buyer, seller | listing, VIN, inquiry | viewing, offer, sale |
| Dealer sales | buyer, dealer/team | inventory, budget, trade-in | appointment, quote, sale |
| Garage/service | owner, garage/mechanic | VIN, symptoms, work order | diagnosis, booking, service |
| Parts | buyer/garage, parts seller | VIN, part, image/evidence | correct part purchase |
| Insurance | owner/buyer, insurer | VIN, value, quote/claim | quote, policy, claim |
| Finance | buyer, lender/agent | vehicle, application | approval/decline, funding |
| Diaspora import | buyer, seller/importer | RFQ/order/shipment | purchase/import |
| Container/logistics | customer, operator | capacity, cargo, route | reservation/shipment |
| Government/public service | citizen, authority/team | vehicle/case/reference | application/service completion |
| Referral | referrer, prospect, business | code/campaign/listing | qualified referral/conversion |
| Trust & safety | user, CarUp team | dispute/risk/evidence | resolution/protection |
| Support | user, CarUp | account/system context | issue resolution |

The engine must be generic enough to serve these workflows without duplicating provider logic.

---

# 10. Channel strategy

## 10.1 WhatsApp: primary external conversational channel for Zimbabwe-first adoption

WhatsApp should be treated as a strategic primary interface, not as a simple link button.

CarUp should support:

- inbound customer initiation;
- CarUp-mediated stakeholder replies;
- approved business-initiated templates where required;
- quick replies/interactive actions where provider support allows;
- media;
- documents;
- voice notes as provider support matures;
- click-to-message campaign attribution;
- delivery/read analytics;
- opt-in/opt-out and quality controls.

WhatsApp must remain a transport into the canonical conversation.

## 10.2 Telegram

Use for users and stakeholder groups that prefer it, including:

- direct conversation;
- bots/automation;
- structured commands;
- notifications;
- media.

Maintain one canonical Telegram webhook path for the Communications engine and prevent alternate feature-specific paths from silently bypassing it.

## 10.3 Email

Email is essential for:

- formal quotes;
- insurance/finance documents;
- receipts;
- long-form confirmations;
- government/public-service correspondence;
- branded summaries;
- secure links to larger artifacts.

Email must use branded reusable templates and authenticated sending domains. Sensitive files should prefer secure, expiring links rather than indiscriminate attachments.

## 10.4 SMS

Use for high-reach fallback and time-sensitive concise communication, not rich conversation.

Examples:

- OTP/security;
- urgent appointment changes;
- failed WhatsApp/email fallback;
- critical transaction update where consent permits.

## 10.5 Push

Use for app-native immediacy and re-engagement.

A push must deep-link into the canonical conversation or business object.

## 10.6 Web and native mobile

These should provide the richest view because they can combine:

- conversation;
- listing/vehicle/work order context;
- trust;
- files;
- actions;
- payment;
- appointments;
- analytics.

## 10.7 Facebook/Instagram

When configured, these should route into the same conversation infrastructure rather than maintaining separate inbox silos.

---

# 11. Channel selection and fallback

The routing decision should evaluate:

1. message classification: transactional, service, marketing, security;
2. participant consent;
3. participant preferences;
4. provider eligibility;
5. active service window/rules;
6. channel address availability;
7. urgency;
8. business workflow;
9. prior successful channel;
10. delivery failures;
11. cost;
12. quiet hours/time zone;
13. regulatory/policy constraints.

A typical transactional strategy might be:

```text
preferred active channel
    -> in-app/push mirror if appropriate
    -> approved fallback
    -> escalation to human/support where necessary
```

The system must avoid sending the same low-value message to every possible channel unless the business policy explicitly requires multi-channel escalation.

---

# 12. Templates, personalization and professional brand system

Communications 2.0 needs a first-class **Template Registry** and **Brand Asset Registry**.

## 12.1 Template registry

Every reusable template should have:

- stable template key;
- version;
- business workflow;
- stakeholder audience;
- funnel stage;
- channel;
- language;
- transactional/marketing/security classification;
- required variables;
- optional variables;
- approval status;
- provider template reference where required;
- legal/compliance footer rules;
- CTA definitions;
- owner/team;
- active/retired state;
- analytics experiment metadata.

## 12.2 Personalization

Template variables may include:

- first name;
- organization/dealer/garage/insurer;
- vehicle make/model/year;
- VIN/public reference where safe;
- inquiry/quote/application reference;
- price;
- location;
- appointment date/time;
- assigned representative;
- trust status;
- next action;
- referral/campaign context.

Personalization must be relevant, truthful and permission-aware.

## 12.3 Stakeholder-specific voice

Templates should differ by purpose.

Examples:

**Marketplace**
- availability response;
- inspection invitation;
- offer update;
- reservation reminder.

**Dealer**
- lead acknowledgement;
- appointment;
- trade-in information;
- financing handoff.

**Garage**
- booking confirmation;
- diagnosis update;
- authorization request;
- vehicle ready.

**Insurance**
- quote intake;
- missing document;
- quote ready;
- claim update.

**Finance**
- application intake;
- document request;
- decision;
- next-step disclosure.

**Government**
- reference confirmation;
- appointment;
- missing requirement;
- case status.

## 12.4 Brand asset registry

Approved assets may include:

- CarUp master logo;
- CarUp SafePay badge;
- Marketplace artwork;
- verified dealer badge;
- Garage/service artwork;
- insurance artwork;
- finance artwork;
- Diaspora Trade artwork;
- partner logo;
- stakeholder logo;
- government authority logo where officially authorized.

Assets must be referenced from governed IDs/URLs, not duplicated throughout code.

## 12.5 Channel-native visual policy

Do not attach a large poster to every conversational reply.

Use rich branded media at meaningful moments:

- quote;
- vehicle card;
- inspection card;
- appointment;
- invoice/receipt;
- policy/certificate;
- shipment milestone;
- referral reward;
- campaign;
- price drop.

Routine replies should stay conversational.

---

# 13. AI and multimodal communication

## 13.1 AI capability levels

### Level A — understanding
- intent classification;
- language detection;
- entity extraction;
- conversation summarization;
- voice transcription;
- image/document classification;
- urgency/risk signal;
- duplicate/spam detection.

### Level B — assistance
- suggested reply;
- translation;
- follow-up recommendation;
- next-best action;
- lead qualification;
- missing-information checklist;
- conversation briefing for stakeholder teams.

### Level C — bounded automation
AI may automatically handle allowlisted low-risk workflows such as:

- FAQ;
- appointment slot collection;
- acknowledgement;
- document checklist;
- simple status query;
- inventory discovery.

Higher-risk actions require human or deterministic business-rule authorization.

## 13.2 Voice

Architecture must support voice notes as messages.

The derived AI pipeline may produce:

- transcript;
- translated transcript;
- intent;
- entities;
- summary.

The original audio remains authoritative.

## 13.3 Images

Useful applications:

- vehicle inquiry images;
- damage photos;
- part identification assistance;
- document page detection;
- inspection evidence;
- condition triage.

AI findings must be labeled as AI-derived and cannot silently become verified evidence.

## 13.4 Documents

The conversation may collect:

- registration;
- insurance;
- quotation;
- invoice;
- finance documents;
- shipment documents;
- government forms.

Document intelligence should return structured extraction plus confidence and provenance.

## 13.5 Translation

CarUp should support multilingual conversation without losing originals.

Store:

- original;
- detected language;
- translated rendering;
- translation model/version where appropriate.

Do not overwrite original content.

## 13.6 AI transparency

Where a user is directly interacting with autonomous AI, provide appropriate disclosure.

Human-authored or human-approved messages should be distinguishable in audit even if AI drafted them.

---

# 14. Conversation intelligence and conversion analytics

Every business conversation should be analytically useful without turning into surveillance.

## 14.1 Core analytics events

Track events such as:

- conversation_started;
- inquiry_created;
- message_received;
- stakeholder_first_response;
- AI_assisted_response;
- lead_qualified;
- appointment_requested;
- appointment_booked;
- quote_requested;
- quote_sent;
- offer_made;
- reservation_started;
- escrow_started;
- finance_started;
- insurance_started;
- document_requested;
- document_received;
- transaction_completed;
- conversation_resolved;
- referral_created;
- referral_converted;
- customer_opted_out.

## 14.2 Funnel model

A generic commercial funnel:

```text
discovery
 -> conversation
 -> intent identified
 -> lead qualified
 -> stakeholder response
 -> appointment/quote
 -> negotiation
 -> reservation/application
 -> escrow/payment
 -> completed
 -> review
 -> referral/retention
```

Each workflow may define a specialized funnel while preserving common metrics.

## 14.3 Metrics

Minimum dashboard metrics:

- new conversations;
- unique participants;
- first-response time;
- median response time;
- SLA breach;
- delivery success by channel/provider;
- read rate where available;
- unresolved backlog;
- dead-letter rate;
- lead qualification rate;
- inquiry-to-appointment conversion;
- inquiry-to-sale conversion;
- quote-to-bind conversion for insurance;
- finance application conversion;
- referral conversion;
- revenue/GMV attributed to conversations;
- channel conversion rate;
- template performance;
- campaign attribution;
- AI suggestion acceptance;
- AI containment rate;
- human escalation rate;
- opt-out/block rate;
- stakeholder responsiveness/trust indicators.

## 14.4 Attribution

Store acquisition and referral context where known:

- UTM;
- referral code;
- campaign;
- click-to-message source;
- listing;
- social source;
- QR code;
- partner.

Attribution should survive when a user moves from web to WhatsApp to app.

## 14.5 Stakeholder performance

CarUp may derive business performance signals such as:

- response speed;
- completion reliability;
- missed leads;
- appointment conversion;
- complaint rate.

These signals must be governed and should not silently modify Trust Score unless an explicit reviewed trust policy says they do.

---

# 15. Marketplace Buyer ↔ Seller: reference implementation

Marketplace is the first required end-to-end implementation because current UAT has clearly identified the gap.

## 15.1 Required buyer journey

A guest or authenticated buyer:

1. views listing;
2. clicks Contact Seller;
3. enters/uses identity details;
4. writes a fresh inquiry;
5. submits once;
6. receives confirmation;
7. can continue the same conversation through CarUp or a linked external channel.

The exact buyer message must enter the canonical conversation.

## 15.2 Required seller journey

The actual listing owner:

1. sees an unread conversation on My Listings and Communications;
2. sees vehicle context;
3. opens it;
4. sees exact buyer message;
5. sees safe buyer identity information;
6. types a fresh reply;
7. sends through CarUp;
8. sees delivery status appropriate to channel;
9. receives future buyer replies in the same thread.

## 15.3 WhatsApp continuation

When buyer WhatsApp identity is linked/consented and a WhatsApp send is eligible:

`seller CarUp reply -> canonical message -> queue -> WhatsApp -> physical buyer`

Then:

`physical buyer WhatsApp reply -> CarUp webhook -> identity resolution -> same Marketplace conversation -> seller`

No duplicate shadow conversation is allowed.

## 15.4 Marketplace UI redesign

Current My Listings UX repeats large inquiry cards separately from listing cards. Replace this with listing-centric communication.

Target concept:

```text
My Listings

3 Active Listings   4 Inquiries   2 Unread

2018 Toyota Corolla                         AVAILABLE
$9,500
4 inquiries · 1 unread
Latest: "Is it still available?"

[Conversations] [View listing] [Mark sold]
```

Opening Conversations shows buyer threads for that listing.

## 15.5 Privacy

Before policy permits otherwise, do not make direct phone/email the primary seller action.

Primary action:

`Reply in CarUp`

Optional contact reveal must be a deliberate policy/consent decision.

---

# 16. Dealer experience

Dealers should have:

- shared team inbox;
- conversation assignment;
- lead ownership;
- inventory context;
- response templates;
- appointment booking;
- trade-in context;
- finance/insurance handoff;
- manager analytics;
- missed-lead recovery;
- WhatsApp continuation;
- organization branding.

Dealer response speed and conversion can become useful analytics, but not an unreviewed trust penalty.

---

# 17. Garage/mechanic experience

Conversation context should include:

- vehicle/VIN;
- reported symptom;
- voice note;
- photos/video;
- prior service history where authorized;
- appointment;
- estimate;
- work order;
- authorization;
- parts;
- completion.

Example:

`owner voice note -> transcription -> likely intent "brake noise" -> garage receives original + transcript + vehicle context -> appointment -> estimate -> owner approval -> work order`

---

# 18. Insurance experience

The engine should support:

- quote lead;
- vehicle data reuse with permission;
- document checklist;
- image collection;
- quote delivery;
- questions;
- policy activation;
- renewal;
- claim intake/status.

AI can assist with intake and document/image classification, but underwriting/coverage decisions remain with authorized business logic/humans.

---

# 19. Finance experience

Support:

- finance interest from listing;
- application thread;
- document collection;
- status updates;
- appointment/call;
- human handoff;
- decision notification;
- next steps.

Sensitive information requires stricter visibility and retention.

---

# 20. Parts experience

Support:

- VIN/vehicle context;
- part request;
- photo;
- compatibility question;
- seller quote;
- availability;
- order.

Image AI may suggest part categories but must not make unqualified safety-critical compatibility guarantees.

---

# 21. Diaspora, container and logistics

Conversation context should reuse existing Diaspora objects:

- RFQ;
- import order;
- supplier;
- container reservation;
- shipment;
- milestone;
- document request;
- exception.

Cross-border users should be able to continue through WhatsApp without losing their CarUp order/shipment context.

---

# 22. Government/public-service communications

Government integrations should use the same conversation infrastructure with stronger permission boundaries.

Potential uses:

- case/reference acknowledgement;
- inspection appointment;
- document request;
- registration update;
- clearance;
- status;
- fraud/stolen-vehicle coordination where lawful.

Official branding must only be used when explicitly authorized.

Government workflow messages must preserve auditability and clear authority attribution.

---

# 23. Referral, growth and campaign communications

Referrals and campaigns must connect acquisition to conversation to outcome.

Examples:

`QR/referral/social ad -> CarUp landing/listing -> WhatsApp -> canonical conversation -> booking/sale -> referral attribution`

Campaign functions should support:

- segment;
- consent;
- approved template;
- send window;
- frequency cap;
- suppression;
- A/B testing;
- conversion attribution;
- opt-out;
- channel cost;
- ROI.

Campaign functionality must not pollute transactional threads or create spam.

---

# 24. User experience surfaces

## 24.1 Ordinary user Communications

Replace the current generic Support Chat aggregation with a true inbox.

Required features:

- conversation list;
- business context;
- participant display;
- latest message;
- unread count;
- channel indicator;
- timestamp;
- status;
- search;
- filters;
- open conversation;
- reply;
- media;
- read state.

Support Chat becomes a conversation type, not the page identity.

## 24.2 Contextual entry points

Business pages should deep-link to filtered conversations.

Examples:

- My Listings -> listing conversations;
- Garage -> vehicle/service conversations;
- Insurance -> quote/claim conversations;
- Finance -> application conversation;
- Diaspora -> order/shipment conversation.

## 24.3 Admin Command Center

Admin remains an operational observability and exception-management surface.

It should support:

- inbox;
- team queues;
- audit;
- provider health;
- delivery attempts;
- SLA;
- recovery/dead letter;
- escalation;
- assignment;
- template management;
- analytics.

Admin should not automatically become a participant in every C2C conversation.

## 24.4 Native mobile

The native app should consume the same conversation API and semantic model rather than invent a separate chat backend.

---

# 25. Reliability and delivery semantics

Non-negotiable:

- idempotent webhook processing;
- provider-message dedupe;
- message-level idempotency;
- retry with bounded backoff;
- dead-letter recovery;
- provider-neutral delivery state;
- monotonic status progression;
- safe fallback;
- no silent message loss;
- correlation IDs;
- delivery audit;
- queue observability;
- no fake adapters in real staging/provider acceptance paths.

A provider acceptance response is not the same thing as physical delivery. Where providers expose delivery/read callbacks, preserve them. Where they do not, distinguish provider acceptance from user-confirmed receipt.

---

# 26. Consent, quality and anti-spam

The engine must classify communication as:

- security;
- transactional;
- service;
- marketing.

Marketing must require the appropriate consent and provider compliance.

Support:

- opt-in;
- opt-out;
- per-channel preferences;
- quiet hours;
- frequency caps;
- suppression lists;
- campaign caps;
- unsubscribe/STOP equivalents;
- provider-quality feedback;
- block/complaint monitoring.

The goal is maximum useful reach, not maximum send volume.

---

# 27. Current defects discovered during UAT

These are separate from the main C2C architecture but should be remediated in the implementation program.

## P1 product gap — Marketplace is notification-only, not true C2C
This is the principal Communications 2.0 gap.

## P2 — Public Marketplace page requests protected intelligence endpoints
Anonymous buyers trigger avoidable 401 console errors for endpoints such as temporal findings/disclosure/trust-related data.

Public pages should call public-safe endpoints or conditionally avoid authenticated-only requests.

## P2 — SLA values on reused threads
Fresh communications can display absurd historical overdue-minute values. SLA calculation/state needs correction.

## P2 — Delivery callback monotonicity
Late weaker callbacks must not regress stronger delivery states.

## P2 — Delivery receipt attribution
Where safe and provider-supported, callback association should have resilient matching without weakening security.

## P2 — Identity canonicalization
Normalize channel identities consistently while preserving raw provider values.

## P2 — Telegram alternate webhook risk
There must be one canonical Communications persistence/dedupe path for provider messaging.

## Product capability gap — WhatsApp business-initiated templates
A complete system needs a governed template-send path for cases outside the customer-service window, subject to Meta rules.

---

# 28. Implementation phases

This is a single program, but implementation should use explicit internal gates to prevent a monolithic untestable rewrite.

## Phase 0 — Reconcile source and preserve proven transport

Before coding:

1. inspect current `main`;
2. inspect PR #139/current communication candidate;
3. reconcile staging runtime;
4. enumerate existing migrations/tables;
5. preserve proven WhatsApp/Telegram paths;
6. identify compatibility/migration strategy.

No blind replacement of working provider adapters.

## Phase 1 — Canonical multi-party conversation core

Implement:

- conversation participant model;
- participant authorization;
- subject/context linkage;
- exact semantic messages;
- media-ready schema;
- read/unread per participant;
- server-side participant access control;
- projection compatibility for Admin Command Center.

Maintain legacy compatibility where needed during migration.

## Phase 2 — Marketplace reference flow

Implement Buyer↔Seller completely:

- exact inquiry becomes inbound message;
- conversation links inquiry/listing/VIN;
- buyer + seller participants;
- seller inbox;
- My Listings conversation affordance;
- seller reply;
- buyer CarUp/web reception;
- WhatsApp continuation;
- WhatsApp reply returns to same thread;
- privacy-first contact handling;
- physical UAT.

## Phase 3 — Template + brand system

Implement:

- registry;
- versions;
- audience/workflow/channel;
- personalization;
- CarUp assets;
- stakeholder/partner branding;
- provider template mapping;
- CTA;
- language;
- preview;
- approval/retirement;
- tests.

## Phase 4 — Analytics and conversion intelligence

Implement canonical analytics events and dashboards for:

- response;
- delivery;
- funnel;
- conversion;
- attribution;
- stakeholder performance;
- template performance;
- channel performance;
- campaign ROI.

## Phase 5 — AI and multimodal

Implement safe pipeline for:

- summarization;
- intent;
- entity extraction;
- suggested replies;
- translation;
- voice transcription;
- image/document interpretation;
- next-best action;
- human approval and audit.

## Phase 6 — Expand stakeholder workflows

In priority order, reuse the same conversation contract for:

1. dealer;
2. garage/mechanic;
3. insurance;
4. finance;
5. parts;
6. diaspora/import;
7. container/logistics;
8. referrals;
9. government/public service.

No workflow gets a separate bespoke chat backend.

## Phase 7 — Growth/campaign orchestration

Add:

- consented segments;
- click-to-message attribution;
- template campaigns;
- frequency control;
- experimentation;
- re-engagement;
- ROI.

---

# 29. Definition of Done

Communications 2.0 is **not complete** until all of the following are evidence-backed.

## Core
- multi-party participant model works;
- participant authorization works;
- exact message preservation works;
- cross-channel identity works;
- delivery state is reliable;
- audit is complete;
- preferences/consent govern routing.

## Marketplace reference
- physical/real buyer inquiry creates canonical Marketplace conversation;
- correct seller receives exact text;
- seller replies in CarUp;
- buyer receives exact seller reply in CarUp and/or chosen external channel;
- buyer replies from WhatsApp and seller sees it in the same conversation;
- no duplicate shadow thread;
- direct contact details are not the primary C2C mechanism;
- listing context remains attached;
- Admin can observe/audit without hijacking conversation.

## Templates
- stakeholder-specific templates exist;
- brand assets render appropriately;
- provider-required template mapping works;
- personalization is tested;
- transactional vs marketing policy is enforced.

## Analytics
- conversation funnel events exist;
- channel performance is measurable;
- response time is measurable;
- at least Marketplace inquiry-to-next-step conversion is measurable;
- acquisition/referral attribution persists into conversation.

## AI/media
- original content preserved;
- AI-derived fields labeled;
- safe AI draft/summary works;
- voice/image/document architecture supports real artifacts;
- high-risk actions remain governed.

## Stakeholder expansion
At minimum, reference flows are proven for:

- Marketplace buyer↔seller;
- dealer lead;
- garage/service;
- insurance;
- finance;
- diaspora/logistics.

## Operations
- provider health is channel-specific;
- dead letters are recoverable;
- SLA works;
- no obvious public console-auth noise;
- staging UAT passes before production;
- production change is separately owner-authorized.

---

# 30. Required acceptance test for Marketplace

A future owner UAT must be able to perform:

```text
BUYER
opens real staging listing
        |
sends fresh inquiry
        |
        v
SELLER CARUP
sees exact inquiry in listing conversation
        |
types fresh reply
        |
        v
BUYER WHATSAPP
receives exact seller text
        |
types fresh WhatsApp reply
        |
        v
SELLER CARUP
sees exact reply in SAME Marketplace conversation
```

Receipts required:

- listing/inquiry ID;
- conversation ID;
- participant IDs;
- buyer inbound message ID;
- seller outbound message ID;
- delivery attempt/provider message ID;
- buyer WhatsApp inbound provider ID;
- final same-thread proof;
- no duplicate thread;
- audit entries;
- production writes = 0 during staging UAT.

---

# 31. Testing strategy

Required layers:

## Unit
- participant authorization;
- identity normalization;
- routing policy;
- template variable validation;
- funnel event generation;
- status monotonicity;
- consent;
- dedupe.

## Integration
- business event -> conversation;
- conversation -> notification/delivery;
- provider webhook -> correct conversation;
- cross-channel continuation;
- media pipeline;
- analytics event projection.

## E2E
- web buyer -> seller;
- seller -> WhatsApp buyer;
- WhatsApp buyer -> seller same thread;
- Telegram equivalent;
- dealer/garage/insurance reference flows as implemented.

## Physical provider UAT
Automated tests cannot replace physical provider acceptance for final channel certification.

---

# 32. Migration and compatibility rules

Implementation must:

- inspect existing `message_threads`, `messages`, `message_participants`, identities, queues and audit tables before migration;
- prefer additive, reversible migration steps;
- preserve existing Admin provider threads;
- migrate or project legacy `primary_user_id` threads into the participant model safely;
- avoid destructive migration until data compatibility is proven;
- retain historical provider IDs/audit;
- preserve existing event/outbox semantics;
- keep production migrations explicitly gated.

---

# 33. Implementation non-goals

Do not:

- rebuild every provider from scratch;
- create separate chat databases for each feature;
- couple Marketplace directly to Meta;
- turn AI into an unbounded autonomous salesperson;
- expose phone numbers as the default solution to missing C2C functionality;
- spam every channel;
- mark a conversation successful merely because a provider returned HTTP 200;
- silently merge marketing and transactional consent;
- make public/private data boundaries weaker to improve UX;
- declare completion on synthetic-only evidence where physical acceptance is required.

---

# 34. External product/industry signals informing this plan

This architecture aligns with current customer-engagement direction.

## Meta / WhatsApp

Meta announced expanded business AI support, centralized marketing across WhatsApp/Facebook/Instagram, and calling/voice capabilities for businesses using the WhatsApp Business Platform. This supports designing CarUp beyond text-only notifications and keeping voice/media in the long-term semantic model.

Reference:
- Meta, **Centralized Campaigns, AI Support and More for Businesses on WhatsApp** (2025):  
  https://about.fb.com/news/2025/07/centralized-campaigns-ai-support-businesses-whatsapp/

Meta also describes user controls, marketing-message limits, pre-approved templates for business-initiated Platform messaging, and basic performance signals such as read rates. This supports CarUp's consent, template governance, quality and frequency-control requirements.

Reference:
- Meta, **Ways To Manage Your Businesses Chats On WhatsApp** (2025):  
  https://about.fb.com/news/2025/04/ways-to-manage-your-businesses-chats-on-whatsapp/

Meta has also expanded WhatsApp discovery via Status/promoted channels, reinforcing the value of click/discovery-to-conversation attribution.

Reference:
- Meta, **Helping You Find More Channels and Businesses on WhatsApp** (2025):  
  https://about.fb.com/news/2025/06/helping-you-find-more-channels-businesses-on-whatsapp/

## Twilio customer engagement research

Twilio's 2025 State of Customer Engagement research emphasizes AI, real-time personalization, transparency, reliability and outcome-oriented engagement. CarUp should therefore make conversation context and real-time relevance central while preserving consent and trust.

References:
- https://www.twilio.com/en-us/state-of-customer-engagement
- https://www.twilio.com/en-us/press/releases/socer-2025

## GOV.UK Notify

GOV.UK Notify demonstrates the value of a reusable cross-service communication platform with templates, personalization, branding, delivery tracking, attachments/secure links, API automation, permissions and security controls.

References:
- https://www.notifications.service.gov.uk/features
- https://www.notifications.service.gov.uk/using-notify
- https://www.notifications.service.gov.uk/using-notify/templates
- https://www.notifications.service.gov.uk/using-notify/personalisation
- https://www.notifications.service.gov.uk/features/security

The lesson for CarUp is to build one governed communication primitive that many services consume rather than multiple feature-specific notification stacks.

---

# 35. Agent execution contract

Before implementation, the assigned development agent must produce a short discovery note containing:

1. exact current `main` SHA;
2. exact current PR #139 status/head or its successor;
3. exact staging runtime/deployment;
4. existing communication schema inventory;
5. current Marketplace inquiry/event path;
6. migration strategy;
7. files/services expected to change;
8. tests to be added;
9. explicit statement that production writes are prohibited without separate owner approval.

During implementation the agent must maintain a checklist mapped to the phases and acceptance criteria in this document.

Every substantial implementation decision must answer:

> Does this make CarUp the canonical conversation system, or does it create another feature-specific messaging island?

If the latter, redesign before proceeding.

---

# 36. Final product statement

CarUp Communications 2.0 should make it possible for a Zimbabwean user to discover a car, ask a question on Marketplace, continue on WhatsApp, send a voice note, receive a dealer response, arrange an inspection, request finance or insurance, upload documents, track the transaction and later receive service/referral follow-up — while CarUp preserves identity, context, trust, consent, evidence, analytics and business continuity across the entire journey.

That is the target.

The platform is not finished when WhatsApp and Telegram can send messages.

It is finished when **the ecosystem can conduct useful, trusted, measurable business conversations through CarUp regardless of which channel the human chooses to use.**
