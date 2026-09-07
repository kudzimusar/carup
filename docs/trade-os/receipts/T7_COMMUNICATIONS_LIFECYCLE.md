# Trade OS T7 — Communications lifecycle · Receipt

**Status: `T7-PARTIAL` — OWNER ACCEPTANCE REMAINS.** Candidate `5ccac408`. T8 not started.
Production untouched. PR #207 Draft.

## 1. What T7 turned out to be

Not "build chat". CarUp already had a complete Communications authority and Trade OS already
produced into it. The audit (§2) found **no duplicate message or notification store anywhere** — the
healthy starting point the master plan assumed. T7 is therefore convergence: closing the places
where a trade relationship existed and the conversation did not.

## 2. T7.0 — the authority map

| fact | canonical authority |
|---|---|
| conversation / thread | `message_threads` — generic `subject_type` + `subject_id`, `thread_key` idempotency |
| message | `messages` + `message_parts` |
| membership | `message_participants` — `role`, `stakeholder_role`, `permissions`, `last_read_at` |
| notification / outbox | `notification_queue`, via `eventBusService` → `communicationEventListeners` → `NOTIFICATION_POLICIES` → governed templates |
| inbox projection | `communicationInboxProjection` |
| channel binding | `conversation_channel_bindings` |

**The decisive finding:** `subject_type` + `subject_id` is exactly the transaction binding T7 needs.
**No new table was created for any T7 conversation**, and none was needed.

Producers already present: `ensureRfqConversation` (`diaspora_rfq`),
`ensureLogisticsConversation` (`diaspora_logistics_request`), `rfqLifecycleNotifier`,
`logisticsLifecycleNotifier`, and `containerBookingNotifier` — the last of which emitted **one-way
notifications only**.

## 3. What was actually wrong — five defects, all found by using the product

1. **The procurement BUYER could not start a conversation.** Only the supplier could. A buyer
   holding competing offers had no way to ask about any of them, while logistics let both sides
   talk. Closed: every offer card offers *"Ask this supplier"*, naming the supplier from the offer
   being read, and says plainly that asking is not accepting.

2. **A buyer could seat a stranger as "seller".** Closing (1) surfaced it: `sellerId` arrives in the
   request body and nothing verified the named person had any relationship to the order, so a buyer
   could create a canonical thread pairing themselves with an arbitrary user and put the request's
   reference in its metadata. A supplier now earns that place by having made an offer. A hostile
   *seller* was already safe — the server uses the caller's own id, never the body.

3. **Container booking talked at people and gave them nobody to answer.** Notifications only, no
   conversation. Closed with a canonical reference flow bound through the generic
   `subject_type`/`subject_id` — **no booking chat table**. One thread per (sailing, participant),
   because co-loaders share a box, not a group: their questions stay private from each other and
   only the organiser sees them all. Asking *before* approval is allowed, since that is the point.

4. **A sailing's own coordinator was refused on their own sailing.** The operator check required
   platform authority or tenant-admin, and a sailing created by a logistics provider can carry a
   null `tenant_id` — so the coordinator fell through to the participant branch and was told
   *"you have no live booking on this sailing"*. **The unit fixture had quietly given the
   coordinator platform authority as well, which hid it.** The fixture is now an ordinary user and a
   regression test pins the case.

5. **Every trade conversation was called "Marketplace conversation".** All Trade OS threads are
   `marketplace` / `marketplace_inquiry` flows, so a customer with a sourcing request, a shipping
   request and a container booking in flight saw three identical inbox rows. Threads are now named
   by the trade — *Sourcing request RFQ-87B14D63*, *Shipping request SHIP-F2505399*, *Container
   sailing SAIL-561ADEDF* — derived from `subject_id`, which the thread API already sends.
   Non-Trade-OS threads are untouched.

## 4. T7.5 — the `quote_withdrawn` deferral, disposed of

T3 deferred it to T7 deliberately; deferring it again would have been forgetting it.

**Decision: the requester is told when a SUBMITTED offer is withdrawn.** They were told when it
arrived; if it then vanishes they are comparing something that no longer exists and may be about to
award it, and finding out by failure is the opposite of what the rest of this lifecycle promises.

Two silences are deliberate and pinned by tests:
- a **DRAFT** withdrawal emits **nothing** — a draft was never visible to the requester, and
  announcing it would leak that a provider had been considering an offer at all;
- the withdrawing provider is not notified. They did it.

The event is registered **end to end** — subscribed listener *and* notification policy — with a test
asserting both, because an emitted event with neither reaches no human while looking implemented.

## 5. Transaction boundaries — preserved

A conversation is not authority. Nothing in T7 awards a quote, approves capacity, or creates a
warehouse fact. `diaspora_approve_cargo_reservation_atomic` remains the only thing that can approve
a reservation; a message saying *"your space is confirmed"* is a sentence. No T9 warehouse fact is
invented — T7 carries the request and the reply, not the receipt.

## 6. Evidence at `5ccac408`

| gate | result |
|---|---|
| full backend suite (ci.yml env) | **6025 passed / 0 failed** (21 skipped) |
| Communications + Trade OS phase suites | **588/588** |
| T7 conversation authority suite (new) | **16/16** |
| web suite (full) | **1667/1667**, 170 files |
| `tsc -b` · build · lint regression | PASS · PASS · NET_NEW_ERRORS=0 |
| CI | **7 workflows green**, 1 skipped by design |
| responsive, seven widths × three T7 surfaces | no overflow |

**Staging UAT**, FE and BE paired at `5ccac408`, every `/api/` call verified to reach only the
branch backend:

- buyer opens a conversation per offer and lands in canonical Communications;
- organiser opens a conversation with a named participant and lands in the same inbox;
- all three trade threads are individually identifiable there;
- **anti-bypass matrix green**: a non-participant is refused `403 "no live booking on this sailing"`,
  a genuine participant is allowed (so the guard is not blanket-deny), the organiser must name a
  participant, and cannot name a stranger.

Two 503s were observed on `/communications/ai/health` — an unrelated AI-assist health probe, not a
T7 path.

## 7. Not done — what `T7-PARTIAL` is missing

- **T7.3** logistics conversations were verified as already working and left unchanged; they have no
  new test coverage of their own in this pass.
- **T7.6** read/unread truthfulness is only partly addressed: threads are now identifiable, but
  unread counts for Trade OS threads were not certified.
- **Warehouse/action requests (G4)** — the authority is designed for but not built, deliberately:
  T9 owns the facts and T7 must not invent them.
- **Provider-channel routing** stays last, per the master plan.
- Shipment exceptions remain T7 scope and are not started.

**This agent does not mark `T7-USABLE`.**
