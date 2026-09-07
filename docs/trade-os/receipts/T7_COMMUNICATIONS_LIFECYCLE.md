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

---

# T7 closure and owner acceptance — 2026-09-07

**Status: `T7-USABLE` — OWNER ACCEPTED. Runtime frozen at `3f062fc0`.**

## Chronology — preserved, not tidied

| stage | SHA | verdict |
|---|---|---|
| T7.0–T7.4 first pass | `5ccac408` | `T7-PARTIAL` — the receipt named what was missing |
| closure: shipment exceptions, read/unread, logistics certification | `65447286` | |
| closure: channel routing, action-request boundary | **`3f062fc0`** | **`T7-USABLE`** |

T7 was PARTIAL and said so. That record stands.

## §2 · T7.3 logistics conversations — certified against the ACTUAL policy

Previously "inspected and believed working" with no coverage. Believed working is not certified.

Two of the first tests written asserted refusals that **do not happen**, and the product was right:
while a request is `OPEN_FOR_QUOTES` **any eligible provider may ask before quoting** — deliberate,
and symmetric with the procurement supplier — and a withdrawn offer only bites once the request
closes. The real policy is now documented and pinned:

- one canonical thread per (request, provider); both sides reach the same `subject_id`;
- **competitors never share a thread**, and neither participant list contains the other;
- a **DRAFT** offer is not an engagement, and cannot be used as an existence oracle by the requester;
- once the request is closed, only a provider with an **active** offer may continue;
- reopening returns the same thread — refresh and relogin do not fork the conversation;
- **no conversation service ever deletes a thread**: cancelling a request does not delete what was
  said, because the record of a conversation is evidence and evidence is not tidied away when a deal
  falls through.

## §3 · T7.6 read/unread — certified

It turned out to be **derived correctly by design**: per participant, from
`message_participants.last_read_at`, own messages excluded, internal notes excluded, recomputed on
every read rather than cached, and already batched. What was missing was proof. 13 tests now pin the
whole matrix, including: a person is never unread on their own message; one participant reading does
not clear another's; two Trade OS threads keep independent counts; **muting silences the alert, not
the fact**; a client-supplied `unread_count` is ignored; and a stranger cannot move anybody's read
marker.

**§13 query shape** is pinned in the same suite: 26 threads cost **4 round trips, not 26**.

## §4 · Inbox truth

Measured against the full payload — an earlier helper truncated the body to 300 characters and then
only parsed short ones, so it could never return a thread. A helper that cannot see is not evidence.

Four threads, all three Trade OS kinds present, each with its own subject binding, its own
participant role, an honest preview, ordered newest-first, and no generic label. On screen:
**Sourcing Request RFQ-…**, **Shipping Request SHIP-…**, **Container Sailing SAIL-…** — still legible
at 393px.

## §5 · Shipment-exception communication

**The canonical producer already existed and nobody was listening.** `updateShipmentStage` records
an authoritative `EXCEPTION` stage event, audits it and emits on the domain bus; Communications
subscribed to none of it, so the one stage a customer most needs to hear about was the one nobody
told them. T7 added **the consumer half only**.

`CUSTOMS_HOLD` counts as an exception deliberately: a stop is a stop, and treating it as ordinary
progress because it has its own enum value would follow the vocabulary against its meaning. It makes
no customs claim — **T12 owns customs truth**; this says only that the shipment authority reported a
hold.

**A notice never creates shipment state.** A test asserts the module writes to no table at all.

## §6 · Provider-channel routing

Not a new subsystem — canonical Communications already owns delivery. Certified:

- every Trade OS notification is **subscribed AND has a policy**;
- all route **in-app only**, with `policyChannelsOnly` so a preference cannot widen them into an
  external send — a governed decision, not an accident of unconfigured providers, which is what
  makes "nothing was sent externally" truthful rather than a silent failure;
- the canonical record provably **precedes** the channel decision (thread → message → queue row),
  and delivery **drains** that queue rather than originating sends;
- staging reports `communications: BLOCKED, ready=false` with named missing credentials — the
  truthful unavailable state, not a faked delivery.

**A real gap found while proving idempotency:** the dedupe discriminator chain listed `quoteId`,
`rfqId`, `reservationId` and `containerId` but **not `shipmentId`**, so two different shipments
raising an exception for the same person could have collapsed into one notification. Added.

## §7 · Warehouse / action-request boundary

No new entity was needed: a "please provide X" is a **message on a thread already bound to an
authoritative Trade OS object**. The boundary is now asserted rather than assumed —
**no Trade OS communication module writes to any table at all.** A conversation may READ authority to
decide membership; it may never write it. A second test names the six T9 facts
(`received, measured, stored, ready, damaged, loaded`) and fails if any becomes settable from the
communication layer, so a later phase cannot quietly turn a request into a fact.

## §9/§10 · Regression and anti-bypass — green, with positive controls

Anonymous refused · forged order id refused · a rival with no booking refused · a supplier sees no
booking thread of the buyer's · **POSITIVE CONTROL: a genuine participant is allowed** ·
**POSITIVE CONTROL: the sailing coordinator is allowed on their own sailing**. Both controls exist so
an authorization result cannot pass merely because everything is denied. No 404 was accepted as
authorization evidence.

## §14 · Mutation testing — every load-bearing guard

| broken guard | result |
|---|---|
| buyer↔supplier relationship proof | red |
| booking participant isolation (shared subject) | red |
| coordinator authority | red |
| draft existence-oracle guard | red |
| DRAFT-silence on withdrawal | red |
| exception stage set (CUSTOMS_HOLD dropped) | red |
| unread: own messages counted | red |
| unread: read marker ignored | red |
| unread: internal messages counted | red |
| unread: unbatched per-thread queries | red |
| channel policy widened | red |
| a conversation module writing a domain fact | red |
| `shipmentId` dropped from the dedupe chain | red |

**One mutation initially SURVIVED** and is worth recording: my DRAFT-silence test asserted the return
value was `null`, which is *also* null when the outbox is merely unavailable — so it stayed green
after the guard was deleted. The emitter is now injectable and the test observes that nothing was
**sent**. A check that cannot see what it claims is the failure this programme keeps producing.

**A second self-inflicted catch:** renaming that emitter to a bare `emit(...)` made
`quote_withdrawn` look emitter-less to `communication-event-coverage`, which scans for an `…Event(`
shape to prove every subscribed event has a real, addressable emitter. The gate was right; the name
is restored and the reason is written down beside it.

## Gates at `3f062fc0`

| gate | result |
|---|---|
| full backend suite (ci.yml env) | **6061 passed / 0 failed** (21 skipped) |
| Communications + Trade OS phase suites | **627/627** |
| T7 suites (conversations · read/unread · channel/action) | **31 + 13 + 8** |
| web suite | **1667/1667** (frontend byte-identical to the certified head) |
| `tsc -b` · build · lint regression | PASS · PASS · NET_NEW_ERRORS=0 |
| CI | **7 workflows green**, 1 skipped by design |
| responsive, seven widths | inbox clean; trade references legible at 393px |
| FE/BE provenance | both `3f062fc0`, `unpaired:false`, paired backend only |

Production untouched. `main` unchanged.

## `T7-USABLE` does not mean production-ready

Production readiness remains **T18**, and production is NOT AUTHORIZED.

## Carried forward

- **Shipment-exception PRODUCER** stays with **T11**. T7 owns the communications consumer; the
  master plan records that split explicitly.
- **Warehouse facts** stay with **T9**. T7 carries the request and the reply, never the receipt.
- **T12-BLOCKER** unchanged: `documentIntelligenceService.js` still writes a fabricated customs
  exchange rate and duty. T7 does not read it.
