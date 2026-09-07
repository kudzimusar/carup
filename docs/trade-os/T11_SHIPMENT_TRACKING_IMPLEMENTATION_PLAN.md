# Trade OS T11 — Shipment & tracking

**Status: T11.0 authority audit complete. Schema decision recorded; no new table.**
Branch `feat/trade-os-client-demo-convergence` · PR #207 (Draft).

Prior phases frozen: T3 `b446d8ea` · T4 `736f06c5` · T5 `5079b0b3` · T6 `2d0a0bc0` · T7 `3f062fc0`
· T8 `00f164e4` · T9 `ee747940` · T10 (this cycle).

---

## T11.0 — the authority audit

### The finding

**A substantial shipment authority already exists, and it is largely sound.** This is neither T9's
situation (nothing existed) nor T10's (the word existed and the fact did not). Here the fact exists,
is audited, emits domain events, and already has a consumer in T7.

**So T11 creates no second shipment table.** Its job is to close the specific ways the existing
authority can be made to assert things nobody observed.

### What exists

| fact | authority | state |
|---|---|---|
| the shipment record | `diaspora_shipments` — carrier, tracking number, ports, `departure_date`, `estimated_arrival_date`, `actual_arrival_date`, 9-value `status` | **canonical, reuse** |
| the movement timeline | `diaspora_shipment_stage_events` — shipment, stage, notes, location, `event_time`, actor | **canonical, reuse** |
| create / advance / read | `diasporaShipmentService` — `createShipment`, `updateShipmentStage`, `getShipmentTimeline` | **canonical, harden** |
| audit | `writeDiasporaAudit` on create and every stage change | present |
| events | `DIASPORA_SHIPMENT_<STAGE>` on the domain bus | present |
| exception communication | `shipmentExceptionNotifier` → T7, consuming `EXCEPTION` and `CUSTOMS_HOLD` | **built in T7.5, reuse** |
| order lifecycle coupling | `SHIPMENT_TO_IMPORT_STATUS` auto-transitions the import order | present, **see boundary risk** |

Stage events are **append-only in practice**: nothing in the codebase updates or deletes them. That
should be made structural rather than incidental.

### The gaps — what T11 must actually close

| # | gap | why it matters |
|---|---|---|
| **1** | **`createShipment` accepts `container_id` as a free optional field.** Nothing checks that the container was ever loaded. | A shipment can be created for a container with no manifest, no cargo, and no T10 load — the same free-claim shape T10 just closed on `mark-loading`. |
| **2** | **`departure_date` is a free field on create.** | Planned and observed departure are the same column. A booking's intended sail date and the fact that it sailed are different facts (§25), and a customer reading "departed" deserves the second. |
| **3** | **No transition legality map.** Unlike containers, any stage may follow any stage. | History can be asserted out of order — `ARRIVED → IN_TRANSIT` would say the goods went back to sea. |
| **4** | **No idempotency on `updateShipmentStage`.** | A retried request appends a second identical stage event, and the timeline says the ship arrived twice. |
| **5** | **`SHIPMENT_TO_IMPORT_STATUS` maps `CUSTOMS_HOLD → CUSTOMS_IN_PROGRESS` and `RELEASED → RELEASED`.** | The shipment service is already writing customs-shaped order statuses. **T12 owns customs.** T11 must not deepen this, and should record it as a T12 boundary question rather than extend it. |
| **6** | Stage-event append-only is convention, not constraint. | See above. |

### §23 — what the container → shipment transition must require

**Answered from repository evidence, not invented.**

A T10 load may be `COMPLETED` while carrying `LEFT_BEHIND` lines: that is a first-class, governed
outcome with a bounded reason, and T10's participant projection is built around telling somebody
their cargo did not travel. **Requiring "all cargo loaded" would make T10's left-behind path unable
to ever produce a shipment**, which contradicts T10's own design.

Therefore:

> **A COMPLETED T10 load is the requirement. Left-behind lines are expected and do not block.**

This does not need an owner ruling — it is derivable from T10's schema and its certified behaviour.
What *would* need one, and is **not** decided here, is whether a shipment may be created for a
container whose load was `ABANDONED`. That is an operational policy question with no repository
evidence either way, and T11 refuses it by default (the conservative reading) rather than guessing.

### The rule, and the version of it that was wrong

**Forward or lateral, never backward.**

The first implementation was stricter: it demanded the ordinary sequence and refused
`PLANNED → IN_TRANSIT`. The existing authorization suite caught it, and the failure was the right
one to have. **A stage nobody recorded is a stage nobody OBSERVED, not one that did not happen** — an
operator who learns a ship sailed, having never logged BOOKED or LOADING, would have had to invent
two facts in order to record the one they had. Forcing invented intermediate states is precisely the
failure this programme exists to prevent, and the over-strict map committed it.

So skipping forward is allowed; rewinding is refused. The one legitimate backward step is a customs
hold being **lifted** — the goods did not move, a hold was placed and released, and they are still
arrived. `EXCEPTION` has no rank at all, because it happens *to* a shipment rather than being a place
in its journey; leaving it returns to wherever the operator says the goods are, which they know and
the map does not.

### Truth model T11 must hold

```
LOADED ≠ SHIPMENT CREATED ≠ DEPARTED ≠ IN TRANSIT ≠ ARRIVED ≠ RELEASED ≠ DELIVERED
 T10          T11              T11        T11         T11       T12?       T12
```

- a carrier booking or reference **is not** departure;
- an ETA **is not** an actual arrival;
- a tracking message **is not** shipment state;
- a bill of lading **is not** departed.

### T11's own firewall

T11 may record movement. It must not manufacture customs clearance or release, broker authority,
payment settlement, reputation, Trust, or a delivery nobody observed. **T12 owns customs and
destination; T13 owns settlement.** Gap #5 above is the live risk and is recorded, not extended.

---

## Slices

| slice | scope | state |
|---|---|---|
| **T11.0** | authority audit + master reconciliation | **complete** (this document) |
| T11.1 | container → shipment gate; planned vs observed departure; transition legality; stage idempotency | **specified, not implemented** |
| T11.2 | operator timeline surface | not started |
| T11.3 | participant-scoped tracking surface | not started |
| T11.4 | T7 convergence beyond the existing exception path | not started |
| T11.5 | privacy matrix, responsive, staging journeys | not started |

`T11-PARTIAL` is the only status this cycle can reach, and only if T11.1 lands. Owner acceptance
remains either way.
