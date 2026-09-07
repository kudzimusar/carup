# Trade OS T11 — Shipment & tracking · Receipt

**Status: `T11-PARTIAL` — OWNER ACCEPTANCE REMAINS.** Candidate `bf52a6d9`.
T11.0 audit + T11.1 hardening. **No T11 surface exists.** T12 NOT started.
Production untouched. PR #207 Draft.

Plan: `docs/trade-os/T11_SHIPMENT_TRACKING_IMPLEMENTATION_PLAN.md`.

---

## 1. The audit's finding — the opposite of the last two phases

T9 found **nothing existed**. T10 found **the word in five places and the fact in none**. T11 found a
**substantial, largely sound authority already built**:

| what | where |
|---|---|
| the shipment record | `diaspora_shipments` — carrier, tracking number, ports, `departure_date`, ETA, `actual_arrival_date`, 9-value status |
| the movement timeline | `diaspora_shipment_stage_events` — append-only in practice; nothing in the codebase updates or deletes one |
| create / advance / read | `diasporaShipmentService` |
| audit | `writeDiasporaAudit` on create and every stage change |
| events | `DIASPORA_SHIPMENT_<STAGE>` on the domain bus |
| exception communication | `shipmentExceptionNotifier` → T7, **built in T7.5** |

**So T11 creates no second shipment table.** Its job is closing the ways the existing authority could
be made to assert things nobody observed.

## 2. T11.1 — the four gaps, closed

### A shipment for a container that was never loaded

`createShipment` took `container_id` as a free optional field checked by nothing — a shipment for a
container with no manifest, no cargo and no T10 load. The same free-claim shape T10 had just closed
on `mark-loading`.

Now gated on a **COMPLETED** T10 load. A shipment with no container at all is untouched: not every
shipment is a co-loaded container, and T11 is not the place to make that a requirement.

### A planned departure date stored as an observed one

`departure_date` was free at creation, so an intended sail date and the fact that a ship sailed were
the same column. A customer reading "departed" deserves the second.

The plan is now kept as `metadata.planned_departure_date` with its source, and the observed column
stays NULL until a real `IN_TRANSIT` transition stamps it — **never in the future**, because nothing
has departed at a time that has not happened. `actual_arrival_date` is treated the same way.

### A timeline written out of order

**The rule: forward or lateral, never backward.**

The first implementation was stricter, and getting it wrong is the most useful thing in this receipt.
It demanded the ordinary sequence and refused `PLANNED → IN_TRANSIT`. The **existing authorization
suite caught it** — a test whose fixture is a PLANNED shipment being moved to IN_TRANSIT.

> **A stage nobody recorded is a stage nobody OBSERVED, not one that did not happen.**

An operator who learns a ship sailed, having logged neither BOOKED nor LOADING, would have had to
invent two facts in order to record the one they had. **Forcing invented intermediate states is
precisely the failure this programme exists to prevent**, and the over-strict map committed it.

So skipping forward is allowed. Rewinding is refused, and the refusal says why in those terms:
*"that would say the goods moved back."*

Two named exceptions, each for a reason:

- **a customs hold being LIFTED** is a legitimate backward step — the goods did not move, a hold was
  placed and released, and they are still arrived;
- **`EXCEPTION` has no rank at all**, because it happens *to* a shipment rather than being a place in
  its journey. Leaving it returns to wherever the operator says the goods are, which they know and
  the map does not.

### A retry appending a second journey

Re-reporting the stage a shipment is already at now returns `{ unchanged: true }` with the existing
event, rather than appending a second one. A timeline saying the ship arrived twice is a record of
something that did not happen.

## 3. §23 — answered from repository evidence, not guessed

> **A COMPLETED T10 load is the requirement. Left-behind lines are expected and do not block.**

Derived, not invented: a completed load may legitimately carry `LEFT_BEHIND` lines — that is T10's
certified design, and its participant projection exists to tell somebody their cargo did not travel.
Demanding "all cargo loaded" would make that path unable to ever produce a shipment.

**An `ABANDONED` load is refused**, and the plan says plainly that this is the *conservative* reading
of a question with no repository evidence either way — rather than pretending to an owner ruling. If
the owner rules otherwise, that is the single line to change.

## 4. The T12 boundary — recorded, not extended

`SHIPMENT_TO_IMPORT_STATUS` already maps `CUSTOMS_HOLD → CUSTOMS_IN_PROGRESS` and
`RELEASED → RELEASED`, so **the shipment service writes customs-shaped order statuses today**. T11 did
not deepen it. **T12 owns customs.**

The firewall test probes rather than greps: `CLEARED`, `DELIVERED`, `SETTLED`, `PAID` and
`DUTY_ASSESSED` are each attempted as a transition target and must be refused as stages a shipment
cannot be at. T11 may record that customs are **holding** goods — an observation of where the cargo
is — and may never record that they cleared them.

## 5. Gates

| gate | result |
|---|---|
| `trade-os-t11-shipment-authority.test.js` | 16 tests, including a positive control walking the whole ordinary journey |
| existing shipment/authorization suites | green — and one of them caught the over-strict map |
| backend suite | see §7 |
| lint | NET_NEW_ERRORS=0 |

## 6. Open — and it is most of the product

- **T11.2 operator timeline surface — NOT built.**
- **T11.3 participant-scoped tracking surface — NOT built.** A customer cannot see their own cargo's
  journey through any screen.
- **T11.4** T7 convergence beyond the existing T7.5 exception path — not started.
- **T11.5** privacy matrix, responsive certification, staging journeys — **not run**, because there is
  no surface to run them against.
- **Stage-event append-only is still convention, not constraint.** Nothing writes over one today; a
  database-level guarantee is not in place.

**No T11 surface exists** — the same gap that kept T9 and T10 from acceptance at their first
candidates, and the reason this is `T11-PARTIAL`.

Carried forward unchanged: **T12-BLOCKER**; T8's live-OCR and storage-failure residuals; T9's
outbox-drain residual.
