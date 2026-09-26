# Trade OS T10 — Consolidation & Loading

**Status: T10.0 authority audit complete. No schema written yet.**
Branch `feat/trade-os-client-demo-convergence` · PR #207 (Draft) · audit performed at `ee747940`.

Prior phases frozen: T3 `b446d8ea` · T4 `736f06c5` · T5 `5079b0b3` · T6 `2d0a0bc0` · T7 `3f062fc0`
· T8 `00f164e4` · T9 (this cycle).

---

## T10.0 — the authority audit

### The finding

**The word "loaded" already exists in five places. The fact exists in none of them.**

This is not the T9 situation, where nothing existed at all. Here the vocabulary is everywhere —
three status enums, a route that sets one of them, a passport slot reserved for the answer — and not
one of them records **what** was loaded, **who** confirmed it, or **when**. A sailing can be marked
`LOADING` today and nothing anywhere says a single consignment went into it.

That shapes T10's job precisely: **do not add a sixth way to say the word. Add the fact, and make
the existing words derive from it.**

### Where the word already lives

| # | Where | Value | What it actually means today | Owner |
|---|---|---|---|---|
| 1 | `diaspora_import_orders.status` | `READY_FOR_LOADING`, `LOADED` | a **purchase's** lifecycle label, set by an order transition. Says nothing about cargo. | T4/procurement |
| 2 | `diaspora_container_shipments.status` | `LOADING` | a **sailing's** own state. Reachable from `BOOKING_OPEN` or `BOOKING_CLOSED`. | T5 |
| 3 | `diaspora_shipments.status` | `LOADING` | a **shipment's** state, a different record from the sailing. | T11 (pre-existing) |
| 4 | `diasporaTradeIntelligenceService` | `LOADING_IN_PROGRESS` | a matching heuristic's own vocabulary, not a stored state. | intelligence |
| 5 | `tradeTransactionStage.UNIMPLEMENTED_STAGES` | `{ key: 'LOADING', owner: 'T10' }` | the passport **already reserves this slot for T10** and reports `NOT_STARTED`. | T4 |

### The hazard the audit found

`POST /api/diaspora/containers/:id/mark-loading` **already exists and works**. It calls
`transitionContainer`, which checks only that the transition is legal in `CONTAINER_TRANSITIONS` and
that the caller can manage logistics. There is:

- no manifest — nothing records which reservations are in the container;
- no check that anything was received (T9 did not exist when this was written);
- no seal, no container number, no loaded volume;
- and `mark-shipped` sits immediately after it, so **the same unmanifested path reaches SHIPPED**,
  which is T11's fact.

So the honest statement of today's behaviour: *a sailing can be declared loading and then shipped
with no evidence that any cargo was ever put in it.* T10 does not get to leave that as it is.

### What owns what, after T10

| fact | existing authority | T10 owner | producer | consumer |
|---|---|---|---|---|
| space is committed on a sailing | `diaspora_cargo_reservations` (APPROVED) — T5 | **unchanged** | T5 approval | T10 readiness |
| booked/estimated capacity | `diaspora_container_shipments.used/available` — T5 | **unchanged, never written by T10** | T5 | T10 comparison only |
| cargo physically arrived | `diaspora_warehouse_intakes` — T9 | **unchanged** | T9 receipt | T10 readiness |
| what the cargo actually measures | `diaspora_warehouse_measurements` — T9 | **unchanged, read-only to T10** | T9 measurement | T10 planning |
| required paperwork present/verified | `diaspora_trade_documents` — T8 | **unchanged** | T8 | T10 readiness (presence only) |
| **is this consignment ready to load** | *nothing* | **T10 — derived projection, not stored state** | T10 | operator queue |
| **the plan for one container** | *nothing* | **T10 — new** | operator | loading crew |
| **planned inclusion / exclusion** | *nothing* | **T10 — new** | operator | participant |
| **what was ACTUALLY loaded** | *nothing* | **T10 — new** | authorized loader | manifest, T11 |
| **actual loaded volume / weight** | *nothing* | **T10 — new** | loader | reconciliation |
| **left behind, and why** | *nothing* | **T10 — new, bounded vocabulary** | loader | participant |
| container number / seal | *nothing anywhere* | **T10 — new, on the load record** | loader | T11, T12 |
| loading evidence (photos, sheets) | `diaspora_trade_documents` — T8 | **reuse via one added subject value**, as T9.5 did | T8 | everyone |
| loading communications | T7 events + policies | **reuse**, register in BOTH halves | T10 emitters | T7 |
| the sailing's own `LOADING` status | `diaspora_container_shipments` — T5 | **T5 keeps it**; T10 makes it *derivable* rather than free | operator | display |
| shipment departed / in transit | `diaspora_shipments` — T11 | **T10 MUST NOT TOUCH** | T11 | T11 |

### Answers to the questions §24 asks

- **Does a loading authority already exist?** No. Five spellings of the word, zero records of the
  fact.
- **What currently means "manifest"?** Nothing. The closest thing is "the set of APPROVED
  reservations on a container", which is a *booking* list, not a manifest — it says who bought space,
  not what went in.
- **Is an APPROVED reservation load intent?** **No, and conflating them is the central error to
  avoid.** An approved reservation is *capacity entitlement*: T5's invariant is that it consumes
  booked space. Whether that cargo is in the building (T9), and whether it went into the box (T10),
  are two further facts. A reservation approved months ago whose cargo never arrived must not appear
  on a manifest.
- **What owns actual physical loaded truth?** Nothing today. T10 will.
- **Load plan vs loaded event?** Two records, deliberately. A plan is editable and provisional; a
  loaded fact is an attributed act, like a T9 receipt. Collapsing them is how a plan silently becomes
  a claim about reality.
- **How do T9 actuals feed planning without rewriting T5?** T10 *reads* `actual_volume_cbm` and plans
  against it, while T5's ledger continues to be computed from the estimates. Three numbers coexist:
  booked 3.0, warehouse-actual 3.8, loaded-actual 3.6.
- **Container / seal identifiers?** None exist anywhere in the schema. T10 creates them, on the load
  record, and they stay unknown until observed.
- **Does any current state incorrectly imply loading?** Yes — `mark-loading` (above). T10 must either
  gate it behind a manifest or make the sailing status derive from the load record.
- **Which T11 transition must remain untouched?** `diaspora_shipments.status` and
  `diaspora_shipment_stage_events`. `LOADED ≠ DEPARTED`, and T10 writes neither.

### Truth boundaries T10 must hold

```
BOOKED  ≠  RECEIVED  ≠  LOAD-READY  ≠  PLANNED FOR LOAD  ≠  ACTUALLY LOADED  ≠  SHIPPED
  T5         T9           T10 (derived)     T10 (plan)         T10 (fact)        T11
```

And the three measurements that must all stay representable at once:

```
BOOKED/ESTIMATED  3.0 CBM   — T5, never overwritten
WAREHOUSE ACTUAL  3.8 CBM   — T9, never overwritten
ACTUALLY LOADED   3.6 CBM   — T10, new
```

### What T10 will NOT do

- No customs readiness. T12 owns customs, and the `documentIntelligenceService` fabricated customs
  values are **not to be used or fixed here** (carried forward from T8).
- No `CUSTOMS READY` label under any wording.
- No automatic refund, charge, cancellation or re-sailing when cargo is left behind.
- No writing of T5 capacity, T9 measurements, or T11 shipment state.
- No new message authority and no new file authority.

---

## Slices

| slice | scope | state |
|---|---|---|
| **T10.0** | authority audit + master reconciliation | **complete** (this document) |
| T10.1 | load-plan / loaded-fact authority (migration + PGlite gate) | not started |
| T10.2 | readiness projection and governed services | not started |
| T10.3 | operator load workspace + participant projection | not started |
| T10.4 | T7 communications convergence | not started |
| T10.5 | T8 loading-evidence convergence | not started |
| T10.6 | privacy matrix, responsive, staging journeys A–F | not started |

`T10-PARTIAL` is the only status this cycle can reach. Owner acceptance remains.
