# CAP-01 AUTHORITY RECONCILIATION — PART B

**Specialist gate: `SPECIALIST GATE PASSED` (documentation).** Recommendation: `RECOMMEND ACCEPT — CAP-01 Part B`
subject to the Moderator decisions in §7. The Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Canonical role | `TRADE OS JOURNEY AUTHORITY SPECIALIST` |
| Consumes | CAP-00 receipt + evidence register (checkpoint `16781210`); Part A inventory (`bea7ef4f`) |
| Parent | `577428de` (PR #207 head) — re-checked before writing: unchanged |
| Frozen code modified | NONE |
| Truth classes | `OBSERVED` · `INFERRED` · `STATIC_ONLY` · `PUBLIC_DOCUMENTED` · `UNKNOWN` |

## 1. Rules that govern every decision

1. **One shipment lifecycle.** T11 stays the only movement authority. Journey & Arrival is a *read
   composition*; it never stores a canonical fact.
2. **T11 distinctions are preserved, not simplified:** planned departure ≠ observed departure ·
   ETA ≠ actual arrival · carrier reference ≠ movement · `LOADED` ≠ `SAILED` · customs observation ≠
   customs decision · a provider observation is not automatically a canonical event.
3. **A requirement needs evidence.** `OBSERVED` or `INFERRED` CAP evidence can justify a requirement;
   `STATIC_ONLY` and `UNKNOWN` cannot justify a build. Requirements that come from CarUp's own product
   standard (not from CAP) are labelled `CARUP-STANDARD`.
4. **No invented business fact** — a vessel, ETA, leg, customs result, document, agent or payment that
   was not observed is shown as unknown, never defaulted.

## 2. Requirement register and decision

`REUSE` = use as is · `EXTEND` = additive change to an existing authority · `NEW` = new authority ·
`SKIP` = not built.

| # | Capability (CAP evidence) | Class | Decision | Owning authority |
|---|---|---|---|---|
| R1 | Vehicle identity panel: 16 fields + options + photo set (**OBSERVED**) | **REUSE** | read `vehicles` / vehicle passport by the order's VIN or chassis; show only recorded fields | vehicle passport |
| R2 | Actor-attributed stage table (**OBSERVED**) | **EXTEND (read)** | compose T11 stage events, T10 load completion, T12 observations; each row carries a *source* (operator-declared / provider-observed / customer-declared) and an **observed time** — CAP has none | T11 + T10 + T12 |
| R3 | Carrier / POL / POD / ETD / ETA and a "load confirmed" marker (**OBSERVED**) | **REUSE** | `diaspora_shipments` columns + `metadata.planned_departure_date` | T11 |
| R4 | A **vessel name** (and voyage) bound to a journey (**OBSERVED**) | **NEW** | additive leg model, §3 | new, subordinate to T11 |
| R5 | More than one vessel / transshipment (**INFERRED** capability only; not observed) | **NEW, capability only** | the leg model supports N ordered legs; **no multi-leg data is created or demonstrated** | new |
| R6 | Documents: B/L, export certificate, invoice, guide, download (**OBSERVED**) | **REUSE** | T8 workspace read; T8 states verbatim, no duplicate state machine | T8 |
| R7 | Document → shipment/leg binding (CAP binds documents to the *purchase*, not a leg — **OBSERVED**) | **SKIP** | keep transaction ownership and project (§4 G6) | T8 |
| R8 | Customer B/L proofreading and amendment, address confirm/amend (**STATIC_ONLY**; completed here) | **SKIP (deferred)** | not provable at runtime; first usable Journey derives *next actions* from T8 state only (upload / awaiting review / verified / re-upload) plus "contact the responsible party" via T7 | T8 + T7 |
| R9 | Consignee shown to the customer (**OBSERVED**) | **REUSE (participant-only)** | read the order's own `consignee_*` for its buyer; **never exposed to any other party** (Intake 2.0 PRIVATE doctrine) | intake / orders |
| R10 | Notify party (**OBSERVED**; CarUp has no such field) | **SKIP as stored data** | where a *verified* B/L carries one, show it from T8 extraction with provenance; otherwise "not on a verified document" | T8 |
| R11 | Port-keyed document-centre / agent contacts with a services list (**OBSERVED** + directory **PUBLIC_DOCUMENTED**) | **REUSE + EXTEND** | T12 agent appointment where one exists; a document centre is **not** a customs agent and is not conflated with one; a port directory is **not built** in this programme | T12 |
| R12 | Destination / customs state (CAP shows none) | **REUSE** | T12 `getMyCustomsStatus` verbatim; Journey never states a customs outcome | T12 |
| R13 | Courier tracking for dispatched originals (**OBSERVED**; the field held free text in this transaction) | **SKIP (deferred)** | needs a data model and a legitimate source; not required for first usable | — |
| R14 | Upsell inquiry (**OBSERVED/STATIC_ONLY**) | **SKIP** | not a journey capability | — |
| R15 | Capability-URL access without login (**OBSERVED**) | **SKIP — do not copy** | CarUp access stays authenticated and participant-scoped | auth |
| R16 | **ETA change history and the reason for a change** (CAP shows none — `CARUP-STANDARD`) | **NEW** | provider/operator observation layer, §3 | new |
| R17 | Alerts on loaded / departed / ETA changed / arrived / document available / exception (`CARUP-STANDARD`) | **EXTEND** | T7 pipeline, new Journey-scoped notifier, in-app channel only | T7 |
| R18 | Statistics (`CARUP-STANDARD`) | **EXTEND (read)** | derived only from real observations; below a minimum sample, report "insufficient data" | derived |
| R19 | Payments panel | **REUSE, guarded** | T13 read, only when SafeTrade is enabled; labelled with T13's real status (`PARTIAL`) | T13 |

## 3. Additive authority (the only new tables)

All additive, `-- +migrate Up/Down`, no change to any frozen column, FORCE RLS with `anon`/`authenticated`
revoked like T11's tables. Names are provisional and fixed at CAP-04/05.

**3.1 Shipment legs (R4, R5).** `diaspora_shipment_legs`: `shipment_id` (FK) · `leg_sequence` (unique per
shipment) · `carrier_name` · `vessel_name` · `voyage_ref` · `imo` / `mmsi` (nullable) · `port_of_loading` ·
`port_of_discharge` · `planned_departure_date` · `estimated_arrival_date` · `observed_departure_at` ·
`observed_arrival_at` · `source` · provenance. A single-vessel journey is **one leg**. The shipment row
keeps the journey-level facts and remains the status authority: shipment `IN_TRANSIT` follows leg 1's
observed departure and `ARRIVED` the final leg's observed arrival, written **only through the T11
service in the same transaction** as the stage event. Intermediate legs never change shipment status.
`observed_*` columns are immutable once set (trigger, like the T11 timeline); plan and ETA fields may be
revised, and every ETA revision is recorded (3.2).

**3.2 Observation layer (R16, and the provider contract for R5/R17).** `diaspora_shipment_observations`:
`provider_id` · `provider_event_id` · `kind` (ETA_REVISION, VESSEL_IDENTITY, SCHEDULE, PORT_EVENT,
AIS_POSITION, EXCEPTION) · `observed_at` · `received_at` · `payload` · `source_ref` · `status`
(RECEIVED, VALIDATED, ACCEPTED, REJECTED, SUPERSEDED) · unique `(provider_id, provider_event_id)` ·
`reconciled_stage_event_id` (nullable). An *accepted* ETA revision updates the leg/shipment estimate via
the T11 service and leaves a revision row, which is what answers "has the ETA changed, and why". The
only provider available now is `OPERATOR_DECLARED`; **no live carrier or AIS integration exists**, so the
status is `PROVIDER INTEGRATION PENDING EXTERNAL AUTHORITY` and the UI says live data is unavailable.

**3.3 Nothing else.** No documents table, no customs table, no payments table, no contacts table, no
second timeline. The Journey projection is code, not storage.

## 4. Part A gaps — final dispositions

| Gap | Disposition | Reasoning and evidence |
|---|---|---|
| **G1** no vessel / voyage / leg model | **ADDITIVE NEW AUTHORITY REQUIRED** | a vessel name and carrier are `OBSERVED` and have no home; §3.1. Multi-leg is capability only. |
| **G3** stale T4 rail | **BOUNDED EXISTING-AUTHORITY REMEDIATION REQUIRED (narrow)** | the rail states shipment/customs "not connected" although T11/T12 exist. The Journey page is the truthful composition; the passport rail should read the Journey projection when one exists and keep the honest "not connected" otherwise. Touches frozen T4 UI/service → **Moderator decision D1 (§7)**. |
| **G4** shipment selection | **JOURNEY PROJECTION CAN SAFELY COMPOSE AROUND IT** — with the legacy defect left open | see 4.1. |
| **G5** exception recipient | **JOURNEY PROJECTION CAN SAFELY COMPOSE AROUND IT** for Journey alerts; **legacy notifier left open** | Journey alerts resolve recipients from the order's buyer (and co-loader reservations) in a *new* Journey notifier; the frozen notifier is untouched and still addresses the operator → **Moderator decision D3 (§7)**. |
| **G6** T8 binding | **NOT REQUIRED BY CAP EVIDENCE** | CAP binds documents to the purchased vehicle, not to a leg or shipment (`OBSERVED`). Journey composes documents from the order subject (plus booking/load subjects when a container exists). |
| **G7** sailing vs shipment status | **JOURNEY PROJECTION CAN SAFELY COMPOSE AROUND IT** | Journey reads shipment status as movement authority and shows the sailing's status only as a labelled plan. |
| **G8** legacy `GET /shipments*` leak `metadata`/`created_by` | **NOT REQUIRED BY CAP EVIDENCE** (recorded) | Journey never serializes those fields; the legacy endpoints are unchanged. Recorded as an existing-authority exposure for the Moderator. |
| **G9** timeline not stage-filtered | **JOURNEY PROJECTION CAN SAFELY COMPOSE AROUND IT** | Journey filters to participant-safe stage fields. |
| **G10** `openCase` shipment ownership unchecked | **NOT REQUIRED BY CAP EVIDENCE** (recorded) | Journey reads customs by subject and verifies the case's `shipment_id` belongs to the resolved shipment before composing. |
| **G11** UI labels | **NOT REQUIRED BY CAP EVIDENCE** (recorded) | Journey UI uses T11's own planned/observed wording. |

### 4.1 G4 in full — the three questions the Moderator set

*Measured, not assumed.* `createShipment` performs **no dedupe**: no unique constraint on `container_id`
or on `(import_order_id, container_id)`, and no existing-shipment check, so two live shipments for one
container are possible and `(shipments||[])[0]` would then be arbitrary. **Staging data today: 1 live
shipment in total; 0 containers and 0 orders with more than one.** So the defect is a **proven code
path with no occurrence in staging data** — latent, not observed.

1. **Can Journey select the right shipment from existing authority? Yes**, deterministically and
   fail-closed: live shipments with `import_order_id` = the order and, if the order's reservation has a
   container, the same `container_id` → exactly one is used. If the order has no exact match but its
   container has exactly one shipment, that one is used and labelled `association: container`. If more
   than one candidate remains the projection returns an explicit `shipment_ambiguity` and **makes no
   movement claim**; it never picks `[0]`.
2. **Does the legacy participant endpoint stay exposed? Yes** — `GET /my-tracking/...` is unchanged.
3. **Must frozen T11 be reopened? Recommended, not required.** A narrow T11 change (deterministic
   selection with the same fail-closed rule, and optionally a partial unique index on live
   `container_id`) would close it at the source. CAP evidence does not require it and staging shows no
   occurrence, so it is **not done** → **Moderator decision D2 (§7)**. The programme must not be called
   clean while it is open.

## 5. Journey subject, scope and projection contract

**Subject key:** the **import order** (the transaction). Aliases resolve to it: a `cargo_reservation` id
(the key T11/T12 participant views use) and a shipment id. A vehicle bought outside the marketplace (the
real case here) is an import order with its own shipment; a RoRo carrier has **no container**, which T11
already allows (`container_id` is nullable).

**Participant scope:** the order's buyer or creator. **Operator scope:** the container's operator or the
record's tenant admin. **Reviewer / admin:** as T11. Everyone else gets 403 and learns nothing about
existence. Consignee data is shown to the order's own buyer only. No co-loader data, no other order's
shipment identity, no `metadata`, no `created_by`.

**Projection (read-only, assembled by calling the owning services — never by reading their tables
around them):** `asset` · `transaction` · `journey` (state derived from observed facts) · `shipping`
(journey-level facts + `legs[]`) · `timeline` (merged, each row `{kind, observed_at, source, actor_role}`)
· `documents` (T8 states verbatim) · `contacts` · `actions` (derived from authority state) · `exceptions` ·
`customs` (T12, verbatim) · `payments` (T13, guarded) · `notifications` · `provenance` (per-fact source
map). Every date is labelled **planned / estimated / observed**. Unknown stays unknown.

**What the Journey must never say:** that a vehicle sailed because it was loaded; that it arrived
because the ETA passed; that customs cleared because a hold ended; a vessel or ETA nobody recorded.

## 6. Implementation contract

| Unit | Scope | Migration | Exit evidence |
|---|---|---|---|
| **CAP-02** projection | `journeyProjectionService`, `GET /api/diaspora/journeys/:subjectType/:subjectId`, participant/operator scoping, shipment selection rule (§4.1), provenance map | none | unit + mutation-style tests incl. unrelated user = 403, co-loader no leakage, ambiguity fails closed, T11 distinctions held |
| **CAP-03** experience | Journey page (header, journey, documents, vehicle, customs, messages; payments guarded), phone/tablet/desktop, truthful empty/unknown states; narrow T4 rail reconciliation **only if D1 is approved** | none | web tests + visible-browser checks |
| **CAP-04** legs | `diaspora_shipment_legs`, service writes via T11, immutable observed columns, ordering rules | additive | DB tests incl. trigger refusal; single-leg real shape; no multi-leg demo data |
| **CAP-05** observations | `diaspora_shipment_observations`, idempotency, validate → accept/reject → T11, `OPERATOR_DECLARED` provider, ETA revision history | additive | idempotent replay, rejected input cannot move state, `PROVIDER INTEGRATION PENDING EXTERNAL AUTHORITY` surfaced |
| **CAP-06** documents + actions | compose T8; derive next actions from T8 state only; T7 "contact" action | none | access tests, no storage path/URL leak, state mapping table |
| **CAP-07** destination + customs | compose T12; verify case `shipment_id` belongs to the resolved shipment; gateway ≠ destination | none | T12 boundary tests, "no customs claim" assertions |
| **CAP-08** alerts | Journey notifier on T7, in-app only, buyer + co-loader recipients, idempotent on `(event kind, subject, observation id)` | none (policy rows only if T7 needs them) | no duplicates, no storm; **no real WhatsApp/email send without the Owner's own words** |
| **CAP-09** intelligence | derived metrics with minimum-sample guard | none | "insufficient data" shown honestly |
| **CAP-STG01** | real-data UAT | — | **held** — see §7 D4 |

Test discipline: narrow tests first, then the T10/T11/T12/T8/T7 regression suites and the 59 existing T11
tests; no existing test is weakened. Migrations follow `-- +migrate Up/Down` and the repository's
migration-integrity checks. Synthetic fixtures exist only inside automated tests and are labelled as
such; none is written to staging.

## 7. Decisions needed from the Moderator

| ID | Decision | Blocks |
|---|---|---|
| **D1** | Authorize a **narrow** reopening of frozen T4 (rail/copy only, no schema) so the passport reads the Journey projection? | CAP-03 passport link only; Journey page itself does not need it |
| **D2** | Authorize a **narrow** T11 remediation of `shipments[0]` selection (and optionally a partial unique index on live `container_id`)? Evidence: latent, 0 occurrences in staging. | nothing in this programme |
| **D3** | Authorize a **narrow** T7.5 fix so the legacy exception notice addresses the order's buyer? | nothing; Journey alerts use their own notifier |
| **D4** | **Vehicle identity.** CAP shows a **2018 Honda Vezel** (ref `CD740269`); the staging seller-authority vehicle is a **2016 Nissan Serena** (`GFC27-027051`); staging has **no record** of the Vezel. Which is the programme's real transaction, and may a vehicle + import order + shipment for the Vezel be created on staging under `u_66cace85fad949e4`, from verified facts only? | real-data convergence and CAP-STG01 |

D1–D3 are recommendations, not blockers. **D4 is the only thing that holds the real-data end of the
programme**; CAP-02 to CAP-09 do not depend on it.

## 8. Amendments made during implementation

### A1 (CAP-04) — legs carry no observed columns

§3.1 above proposed `observed_departure_at` / `observed_arrival_at` on each leg, written through the T11
service. **CAP-04 did not build them**, and the table has no observed, actual, status or verified column
at all (a database check enforces it structurally).

*Why.* Per-leg observed columns have only two possible homes. Either they are written by a path other
than T11 — a **second place to assert "it sailed"**, which can disagree with the shipment's own observed
dates and breaks the T11 rule this programme exists to protect — or they are written through
`diasporaShipmentService`, which means **reopening frozen T11**. Neither is justified by CAP evidence:
the real journey observed is a single leg (CAP-00), and the evidence supports a *declared* vessel and
route, not per-leg observed movement.

*What replaces them.* A leg is a **declared** fact (vessel, voyage, IMO/MMSI, ports, planned departure,
estimated arrival) with a provenance, and the Journey labels it "declared, not observed". Movement stays
the shipment's. If per-leg observed movement is ever needed, it should enter as an observation that T11
accepts (CAP-05), not as a column here.

### Decision D5 — for the Moderator

If per-leg **observed** movement (arrived at the transshipment port, departed on the second vessel) is
required, T11 must be narrowly reopened so such events enter its append-only timeline. **Not required by
anything observed so far; nothing in this programme is blocked on it.**

### A2 (CAP-08) — "no schema" became one additive migration

The CAP-08 row of §6 said the schema change was *none (policy rows only if T7 needs them)*. **CAP-08 needs
one migration**, `20260922090000_trade_os_cap08_journey_alerts.sql`, and the reason is the idempotency
requirement the same row sets.

*Why.* "Idempotent on (event kind, subject, observation id)" is only real if the database enforces it. The
event worker re-runs **every** handler of an event when any one throws, so a handler that told two people
before failing on the third runs again for all three. The notification layer's own dedupe is keyed to the
outbox row id, which is new for every emit, so it cannot catch this. The repo's proven mechanism is a key in
the bus's JS registry plus a matching branch in the `communication_domain_event_dedupe_key()` trigger
function (used for `user.email.verified` and the Trust presentation events), and that branch is a migration.
The same migration registers the governed template `journey_update_v1`: the governed registry **fails
closed** for an unregistered key, and the registered `logistics_update_v1` says "Shipping request … update",
the wrong noun for a shipment's journey.

*What it is.* One `CREATE OR REPLACE` of that function — the three existing branches carried over
byte-for-byte, one branch added — and two `INSERT … ON CONFLICT DO NOTHING` rows. A PGlite check runs the
same inputs through the old and the new function and requires identical answers. Down restores the old
function; the template is not deleted (retiring one is its own decision).

*A consequence for staging.* The migration must be applied **before** the code that subscribes to the
alerts: with the registry present and the template absent, every alert would dead-letter at render time.

### Decision D6 — for the Moderator (T8 visibility)

T8 refuses a tenant admin and an assigned participant sight of an order's documents, although the Journey
admits both. The Journey says **withheld** for them rather than widening T8. Whether they *should* see
document states is a product question; nothing in this programme is blocked on it.

### Decision D7 — for the Moderator (customs visibility)

`getMyCustomsStatus` admits only the booking's buyer, so platform admins, tenant admins and participants see
the Journey's customs section as **withheld**. The coordinator's own customs view is a separate T12 surface
and is untouched. Not blocking.
