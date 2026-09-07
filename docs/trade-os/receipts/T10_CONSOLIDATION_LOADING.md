# Trade OS T10 — Consolidation & loading · Receipt

**Status: `T10-PARTIAL` — OWNER ACCEPTANCE REMAINS.** Candidate `353fc38f`.
Authority, services and both convergence slices. **Surfaces and staging journeys are open.**
T11 NOT started. Production untouched. PR #207 Draft.

Plan: `docs/trade-os/T10_CONSOLIDATION_LOADING_IMPLEMENTATION_PLAN.md`.

---

## 1. T10.0 — the audit, and why it is the mirror image of T9's

T9 found nothing: no warehouse, no intake, no measurement anywhere. T10 found the opposite —
**the word "loaded" already exists in five places and the fact exists in none of them.**

| # | where | value | what it means today | owner |
|---|---|---|---|---|
| 1 | `diaspora_import_orders.status` | `READY_FOR_LOADING`, `LOADED` | a **purchase's** lifecycle label | T4 |
| 2 | `diaspora_container_shipments.status` | `LOADING` | a **sailing's** own state | T5 |
| 3 | `diaspora_shipments.status` | `LOADING` | a **shipment's** state, a different record | T11 |
| 4 | `diasporaTradeIntelligenceService` | `LOADING_IN_PROGRESS` | a matching heuristic's vocabulary | intelligence |
| 5 | `tradeTransactionStage` | `{ key: 'LOADING', owner: 'T10' }` | a slot **already reserved for T10** | T4 |

Not one records **what** was loaded, **who** confirmed it, or **when**.

### The hazard, recorded rather than quietly fixed

`POST /api/diaspora/containers/:id/mark-loading` **already works**. It checks only that the
transition is legal and that the caller can manage logistics. There is no manifest, no check that
anything was received, no seal, no loaded volume — and `mark-shipped` sits immediately after it, so
the same unmanifested path reaches a **T11** fact.

The honest statement of today's behaviour: *a sailing can be declared loading and then shipped with
no evidence that any cargo was ever put in it.* T10.1/T10.2 add the fact underneath; **gating or
deriving that route is open work**, recorded here rather than half-done.

### The question the audit had to answer deliberately

**Is an APPROVED reservation load intent?** No — and conflating them is the central error to avoid.
An approved reservation is *capacity entitlement*: T5's invariant is that it consumes booked space.
Whether the cargo is in the building (T9) and whether it went in the box (T10) are two further facts.
A reservation approved months ago whose cargo never arrived must not appear on a manifest, and the
readiness projection refuses it by name (`NOT_RECEIVED`).

## 2. T10.1 — the authority

Migration `20260913090000`, five tables, staging only, all `ENABLE`+`FORCE` RLS with `anon` and
`authenticated` revoked (verified on staging: 5/5, zero public grants).

| table | the fact it owns |
|---|---|
| `diaspora_container_load_plans` | what an operator **intends** to put in a container |
| `diaspora_container_load_plan_items` | per-consignment inclusion / exclusion, with its reason |
| `diaspora_container_loads` | what **actually** happened, who confirmed it, when |
| `diaspora_container_load_items` | line by line, **including what did not go in** |
| `diaspora_container_seal_records` | container number and seal, append-only with history |

**A plan and a loaded fact are two records on purpose.** A plan is provisional and editable; a
loaded fact is an attributed act, like a T9 receipt. Collapsing them is how a plan silently becomes
a claim about reality — and the test that proves it is the plainest one in the suite: planning cargo
in creates no manifest line, and the customer's own view still says loading has not started.

Constraints that carry meaning rather than shape:

- `load_completion_is_attributed` / `load_item_loading_is_attributed` — "loaded, by nobody, at no
  time" is refused by the database, exactly as a T9 receipt is.
- `load_item_left_behind_has_reason` — cargo that did not travel must say why.
- `load_item_left_behind_has_no_figures` — a left-behind line cannot carry a loaded volume, because
  a figure there would say it went in.
- `load_plan_figure_has_source` — a planned number must record **which** number it is. Planning on a
  warehouse measurement and planning on a booking estimate are different acts.
- `seal_record_states_something`, `seal_replacement_has_note` — a seal record records at least one
  identifier, and replacing a seal says why. It is the first thing anybody asks later.
- `uq_container_live_load_plan` / `uq_container_live_load` — one live plan and one live load per
  sailing. A revision **supersedes**; the gate proves the superseded plan survives.

### The three measurements

```
BOOKED / ESTIMATED   3.0 CBM   — T5, never overwritten
WAREHOUSE ACTUAL     3.8 CBM   — T9, never overwritten
ACTUALLY LOADED      3.6 CBM   — T10, new
```

Proven together in the PGlite gate by a join across all three authorities, and again in the service
suite after a completed load.

### The T11 firewall

The load vocabulary stops at `COMPLETED`. There is no `DEPARTED`, no `SHIPPED`, no `IN_TRANSIT`.
The gate additionally proves **no column NAME anywhere in T10 could hold a later phase's fact**, and
that the migration does not reference `diaspora_shipments` at all.

Two notes on making that check honest:

- The first version's regex flagged every `metadata` column on the substring `eta`. A firewall check
  that cries wolf gets switched off, which is worse than not having one — it now matches whole words.
- `metadata jsonb` is deliberately **not** treated as a hole. It is unstructured by design across the
  codebase, and what stops it becoming a shadow state machine is the service layer refusing to read a
  status out of it, not a column name. The schema-level claim is narrower and true.

## 3. T10.2 — readiness, the plan, the loaded fact

`containerLoadService.js` is the only way to write those tables.

**Readiness is DERIVED, never stored.** A stored `is_ready` boolean is a fact about the past that
keeps asserting itself after the facts underneath it change, and a magic true/false gives an operator
nothing to act on. So it is computed on read, and always carries its blockers:

| blocker | means |
|---|---|
| `NOT_APPROVED` | the booking has no committed space (T5) |
| `NOT_RECEIVED` | the warehouse does not have it (T9) |
| `REFUSED_AT_INTAKE` | the warehouse did not take it in (T9) |
| `NOT_MEASURED` | there is no actual size to plan against (T9) |
| `CONDITION_NOTED` | the warehouse recorded a problem — advisory, so the operator sees it rather than the system deciding |

**It counts documents and never interprets them.** T8 knows a file exists; T12 will know what the law
wants. `documents_present: 3` is true; "customs ready" would not be, and the payload says so in words
so no screen can upgrade it. The T12 fabricated customs values are untouched and unused.

Server-derived throughout: the planned figure comes from the warehouse measurement when one exists
and the booking estimate otherwise — never from the client, and the row records which. The loader is
the authenticated actor; the server checks the cargo is booked on **this** sailing; cargo no
warehouse ever received cannot have gone into a container.

**A total is only stated when every loaded line has a figure.** One unmeasured line makes
`actual_loaded_volume_cbm` null rather than a partial sum dressed as a complete one.

**Truthful absence for participants.** Before loading starts: *"Loading this container has not
started."* During, with nothing recorded about their cargo: `NOT_RECORDED`, never a silent
"left behind". After a completed load with nothing recorded: *"Loading finished and nothing was
recorded about your cargo. Ask the organiser what happened to it."*

And the sentence a customer most needs at the moment they start assuming their goods are moving:
*"Loaded means your cargo is inside the container. It does not mean the container has sailed."*

## 4. Gates

| gate | result |
|---|---|
| PGlite `trade_os_t10_loading_check` | **34/34**, exit 0, its own CI step |
| T10 mutations | **14/14 red** |
| `trade-os-t10-loading.test.js` | **39/39** |
| backend suite | 0 failures |
| lint | NET_NEW_ERRORS=0 |
| staging schema | 5 tables, FORCE RLS, 0 anon/authenticated grants |

### Mutation matrix

| mutation | verdict |
|---|---|
| a load can be COMPLETED with no confirmer and no time | RED |
| cargo can be LOADED with no loader and no time | RED |
| cargo can be left behind with no reason | RED |
| left-behind cargo can carry a loaded volume | RED |
| **`DEPARTED` becomes a legal load status — the T11 firewall falls** | RED |
| a planned figure needs no provenance | RED |
| the exclusion vocabulary becomes free text | RED |
| two live plans per container are allowed | RED |
| two live loads per container are allowed | RED |
| a seal record can record neither identifier | RED |
| a seal can be replaced with no note | RED |
| **a `departed_at` column is added to the load** | RED |
| the tables lose FORCE RLS | RED |
| anon regains privileges on the load items | RED |

Plus a trap client in the service suite proving no T10 call writes `diaspora_cargo_reservations`,
`diaspora_container_shipments`, `diaspora_warehouse_intakes` or `diaspora_warehouse_measurements`.

## 5. Deployed reachability — the services ARE wired

The recurring defect of this programme is a module that is correct and unreachable: T6's whole
commercial layer, T6.8's allocation engine, T7's advisor and T7's exception consumer all shipped with
passing tests and no path to them. So the T10 services were walked over HTTP as four real signed-in
people at a proven pairing — `scripts/uat/t10-loading-smoke.mjs`, **19/19**.

| what it proved | result |
|---|---|
| readiness reachable, blockers derived, unmeasured reported as `null` | booked 3 vs warehouse 4; 1 ready of 5, 4 unmeasured |
| readiness never claims customs or clearance | documents counted, never interpreted |
| a plan line takes the WAREHOUSE figure and says so | `4 CBM from WAREHOUSE_ACTUAL` |
| **planning is not loading** | the customer still reads *"Loading this container has not started."* |
| the loader is the authenticated actor | a forged `loaded_by` did not land |
| **all three measurements distinct** | booked 3 · warehouse 4 · loaded 3.6 |
| **T5 capacity still computed from the estimates** | `used 5.5` |
| left behind needs a reason, keeps its line, tells the participant | refused without one, kept with one |
| a seal replacement keeps the first | current SEAL-0002, 2 records |
| **completing says nothing about departure** | no `departed`/`shipped`/`sailed` in the data |
| privacy, **with positive controls** | operator 200; customer 403×4; co-loader 403; foreign 403; anon 401/403 |

Note the warehouse figure is **4.0, not 3.8** — the T9 journeys legitimately left a later correction
as the current measurement. The first version of this harness asserted a magic 3.8 and failed on the
data being *correct*; it now asserts the **invariant** (three distinct values, none overwriting
another), which is what the phase actually guarantees.

**This is not the T10.6 journey suite,** and the harness says so in its own output: no T10 surface
exists, so nothing here walks a person through anything.

### Journey F, at the database level

The payload check above proves T10's *output* never says "departed". The stronger question is whether
a completed load moved anything a later phase owns. Read from staging after the completed load:

| | |
|---|---|
| completed loads on the sailing | **1** |
| `diaspora_shipments` for the container | **0** |
| `diaspora_shipment_stage_events` for the orders | **0** |
| the sailing's own status (T5's) | `BOOKING_OPEN` — untouched |
| the import orders' status (T4's) | `CONTAINER_BOOKED` — untouched |

A container was loaded and **no shipment came into existence**. That is the T11 firewall holding on
a real database rather than in a JSON string.

## 6. T10.4 / T10.5 — convergence, following the pattern rather than inventing one

**T10.5 — evidence through T8.** Migration `20260914090000` adds one value, `container_load`. No
table, no column, no store, no second upload path. A loading photo is therefore an ordinary T8
document: `PRESENT`, never `VERIFIED`, and **a container with forty photos and no attributed
manifest line has not been loaded.**

The risk with a *second* extension is that the bound quietly stops being a bound, so the gate proves
it is still closed: free text is still refused, `warehouse_intake` still works, and `Down` reverts to
exactly the T9.5 vocabulary rather than the original one.

Who may open a load's evidence: whoever runs the sailing, and any participant with cargo on it —
because loading documents are about the *container*, not about one consignment. Somebody with no
cargo on the sailing is refused.

**T10.4 — communications through T7.** Two events, registered in **both** the listener and the
policy, with **literal** event types at the emit sites. A threaded variable is invisible to
`communication-event-coverage`; T7 and T9 each learned that separately, and a test now asserts the
literals directly so a third lesson is not needed.

The event that matters is the second one:

| event | priority | why |
|---|---|---|
| `diaspora.loading.cargo_loaded` | normal | good news to have, not urgent |
| `diaspora.loading.cargo_left_behind` | **high** | somebody at the other end is waiting for goods that are not coming |

The left-behind notice carries the bounded reason **in plain words**, and an unrecognised code yields
**no sentence rather than a guess at one**. `NOT_PRESENTED` is worded as *"the cargo was not brought
to the container in time for loading"* rather than the operational term, which invites a customer to
think they did something wrong.

It promises nothing about what happens next — no refund, no re-booking, no next sailing — because
none of those is T10's to promise. `next_step_promised: false` says so in the payload.

The direction stays one-way: a notification failure does not unload the container, and the test
proves the manifest line commits regardless.

Gates: PGlite **42/42**, convergence suite **16/16**, `communication-event-coverage` green.

## 7. Open — and it is most of the product

`T10-PARTIAL` means the authority and its services exist and are proven; **the product on top of them
is not built.**

- **T10.3 surfaces** — no operator load workspace, no participant load projection on any screen. The
  services are reachable by HTTP and by nothing a person uses. This is the exact gap T9.1 had, and
  the reason T9 was not accepted at `27a2a558`.
- ~~T10.4 T7 convergence~~ — **done** (§6).
- ~~T10.5 T8 convergence~~ — **done** (§6).
- **T10.6** — a deployed reachability and privacy pass exists (§5, 19/19 with positive controls), but
  the **seven-width responsive certification and journeys A–F have not run**, because there is no
  surface to run them against. They are blocked on T10.3, not skipped.
- **The `mark-loading` hazard is recorded, not closed.** The unmanifested route still exists.

Carried forward unchanged: **T12-BLOCKER**; T8's live-OCR and storage-failure residuals; T9's
outbox-drain residual.
