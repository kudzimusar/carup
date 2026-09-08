# Trade OS T7 — Communications lifecycle · Implementation plan

**Status:** **`T7-USABLE` — OWNER ACCEPTED 2026-09-07. Runtime frozen at `3f062fc0`.**
Chronology: first pass `5ccac408` (`T7-PARTIAL`) → closure `65447286` → `3f062fc0`.
T8 authorized; T9+ NOT authorized.

**Objective:** let human conversation follow the authoritative Trade OS objects — without letting
conversation become authority.

> T7 is **convergence and lifecycle completion, not "build chat from scratch."** CarUp already has a
> complete Communications authority and Trade OS already produces into it. The work is closing the
> gaps and making the canonical system reachable everywhere a trade conversation belongs.

---

## 1. T7.0 — Communications authority audit (COMPLETE)

Repo-wide search for conversation/message/thread/outbox/notification/read-state/inbox/template
authorities, and for every existing Trade OS producer and consumer.

### 1.1 Canonical authorities — REUSE, never duplicate

| fact | canonical authority | notes |
|---|---|---|
| conversation / thread | **`message_threads`** | already carries a *generic* `subject_type` + `subject_id` binding, `thread_key` for idempotency, `tenant_id`, `thread_type`, `conversation_type`, `business_workflow`, plus SLA and assignment columns |
| message | **`messages`** + `message_parts` | |
| membership | **`message_participants`** | `role`, `stakeholder_role`, `permissions`, **`last_read_at`**, `notification_muted`, `notification_policy` |
| notification / outbox | **`notification_queue`** | fed by `eventBusService` domain events → `communicationEventListeners` → `NOTIFICATION_POLICIES` → governed templates |
| inbox projection | `communicationInboxProjection.js` | |
| channel binding | `conversation_channel_bindings` | provider-channel routing lives here (T7 last, per the master plan) |
| templates | `communication_templates` / `_template_versions` | |
| consent / suppression | `communication_preferences`, `communication_suppressions` | |

**The decisive finding:** `message_threads.subject_type` + `subject_id` is exactly the
transaction-binding T7 needs. **No new table is required for any T7 conversation.**

Explicitly forbidden, and unnecessary: `trade_messages`, `trade_chats`, a second notification table,
a second inbox, any feature-specific message authority.

### 1.2 Existing Trade OS producers

| producer | subject_type | kind |
|---|---|---|
| `diasporaRfqConversationService.ensureRfqConversation` | `diaspora_rfq` | two-way conversation |
| `diasporaLogisticsConversationService.ensureLogisticsConversation` | `diaspora_logistics_request` | two-way conversation |
| `rfqLifecycleNotifier` | `diaspora_rfq` | `diaspora.rfq.quote_submitted` … |
| `logisticsLifecycleNotifier` | `diaspora_logistics_request` | `diaspora.logistics.quote_submitted` / `_accepted` / `_not_selected` |
| `containerBookingNotifier` | `container_booking` | **one-way notification only** |

### 1.3 Existing consumers

| surface | conversation entry |
|---|---|
| logistics requester (`TradeShippingRequests`) | ✅ |
| logistics provider (`TradeLogisticsProviderPanel`) | ✅ |
| procurement supplier (`TradeBuyerRequests`) | ✅ |
| **procurement buyer (`TradeRequestDetail`)** | ❌ **none** |
| **container booking / sailing (`DiasporaContainerMarketplace`)** | ❌ **none** |
| canonical inbox (`/diaspora/messages`) | ✅ mounted in the Trade OS shell |

### 1.4 Duplication found

**None.** No competing message store, no second inbox, no Trade OS chat silo. Every existing
producer already writes to canonical Communications. This is the healthy starting point the master
plan assumed.

### 1.5 Gaps → the T7 work

| # | gap | slice |
|---|---|---|
| **G1** | The **buyer cannot start a conversation from their own request.** Only the supplier can. A buyer receives competing offers and has no way to ask about one — asymmetric with logistics, where both sides can. | T7.2 |
| **G2** | **Container booking has no two-way conversation** — only one-way notifications. A participant cannot ask the organiser anything about a sailing or their reservation. | T7.4 |
| **G3** | `quote_withdrawn` notification was **deliberately deferred to T7** (master plan §T3). Must be disposed of deliberately, not forgotten. | T7.5 |
| **G4** | Warehouse/action request communication has no authority. T7 may carry the *request and the reply*; it must not fabricate T9 facts. | T7.4 (authority only) |
| **G5** | Read/unread truthfulness for Trade OS threads (`last_read_at` exists; the projection must be honest). | T7.6 |

---

## 2. Slices

- **T7.0** Authority audit — **COMPLETE** (§1).
- **T7.1** Conversation-context model: one shared helper for "which Trade OS object is this thread
  about", so no surface invents its own subject vocabulary.
- **T7.2** Procurement conversations — close **G1**, both directions, per offer where that is the
  real question.
- **T7.3** Logistics conversations — verify end-to-end in the product; close anything under-wired.
- **T7.4** Booking / operator conversations — close **G2**; design the action-request authority
  without inventing T9 facts (**G4**).
- **T7.5** Notification / event convergence — no double-send when a conversation is added; dispose
  of **G3**; preserve DRAFT-emits-nothing, withdrawn-is-not-told-it-lost, idempotent-replay-sends-once.
- **T7.6** Read / unread / inbox projection truthfulness — **G5**.
- **T7.7** Privacy and adversarial: Intake PRIVATE facts stay private; membership is server-derived.
- **T7.8** Responsive UX across the seven certified widths.
- **T7.9** Staging certification + owner-UAT proxy.

### Closure — every slice, and where the boundary landed

- [x] **T7.0** authority audit.
- [x] **T7.1** conversation-context model — `subject_type`/`subject_id`, no new table.
- [x] **T7.2** procurement conversations, both directions + the anti-bypass fix.
- [x] **T7.3** logistics conversations **certified against the actual policy** (two of the first
      tests asserted refusals that do not happen; the product was right and the policy is now
      written down).
- [x] **T7.4** booking/operator conversations + the coordinator-authority fix.
- [x] **T7.5** notification convergence — `quote_withdrawn` disposed of, **shipment-exception
      consumer added**, `shipmentId` added to the dedupe discriminator chain.
- [x] **T7.6** read/unread certified (13 tests) — and §13 query shape pinned at 4 round trips for
      26 threads.
- [x] **T7.7** privacy/adversarial, with **positive controls** so a refusal matrix cannot pass by
      denying everything.
- [x] **T7.8** responsive, seven widths.
- [x] **T7.9** staging certification at a paired head.

**Boundaries recorded deliberately, not left ambiguous:**

| responsibility | phase |
|---|---|
| shipment-exception **producer** (the authoritative fact) | **T11** |
| shipment-exception **communications consumer** | **T7 — done** |
| warehouse facts (`received/measured/stored/ready/damaged/loaded`) | **T9** |
| carrying "please provide / confirm / respond to X" | **T7 — done** |
| customs truth (incl. the fabricated-rate T12-BLOCKER) | **T12** |

---

## 3. Contracts T7 must not break

**Conversation context is not transaction authority.** A message saying *"I accept your quote"* does
not award it; *"your space is confirmed"* does not create APPROVED capacity; *"vehicle arrived"* does
not create a warehouse receipt. Messages are communication evidence; domain services stay
authoritative.

**Membership is server-derived.** Never trust a client-supplied buyer id, provider id, tenant id,
participant list or transaction owner.

**Intake privacy holds.** A provider does not gain the private pickup address, private phone,
consignee or clearing-agent details, or an undisclosed budget merely because a thread exists.

**Phase firewall.** T7 implements none of T8 documents, T9 warehouse measurement, T10 loading,
T11 tracking, T12 customs, T13 settlement, T14 reputation, T15 Intelligence, T16 AI authority,
T17 fee policy, T18 production.
