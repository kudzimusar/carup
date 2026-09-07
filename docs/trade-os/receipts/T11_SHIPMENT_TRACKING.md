# Trade OS T11 — Shipment & tracking · Receipt

**Status: `T11-USABLE` — CONDITIONAL FREEZE. OWNER ACCEPTANCE REMAINS.**
Runtime frozen at the SHA recorded in §9.

T11.0 audit, T11.1 authority hardening, T11.2 operator timeline surface, T11.3 participant tracking
surface, the structural append-only timeline, the T11/T12 coupling closed, and full deployed
certification at a proven FE/BE pairing. **T12.0 audit + T12.1 opened separately (§8).**
Production untouched. `main` unmodified. PR #207 Draft.

Plan: `docs/trade-os/T11_SHIPMENT_TRACKING_IMPLEMENTATION_PLAN.md`.

---

## 1. The audit's finding — the opposite of the last two phases

T9 found **nothing existed**. T10 found **the word in five places and the fact in none**. T11 found a
**substantial, largely sound authority already built**:

| what | where |
|---|---|
| the shipment record | `diaspora_shipments` — carrier, tracking number, ports, `departure_date`, ETA, `actual_arrival_date`, 9-value status |
| the movement timeline | `diaspora_shipment_stage_events` — append-only in *practice*; nothing in the codebase updated or deleted one |
| create / advance / read | `diasporaShipmentService` |
| audit | `writeDiasporaAudit` on create and every stage change |
| events | `DIASPORA_SHIPMENT_<STAGE>` on the domain bus |
| exception communication | `shipmentExceptionNotifier` → T7, **built in T7.5** |

**So T11 creates no second shipment table.** Its job was closing the ways the existing authority
could be made to assert things nobody observed — and then building the two screens through which
anybody could see any of it.

---

## 2. What T11.1 closed

### A shipment for a container that was never loaded

`createShipment` took `container_id` as a free optional field checked by nothing. Now gated on a
**COMPLETED** T10 load. A shipment with no container at all is untouched: not every shipment is a
co-loaded container, and T11 is not the place to make that a requirement.

### A planned departure stored as an observed one

`departure_date` was free at creation, so an intended sail date and the fact that a ship sailed were
the same column. The plan is now kept as `metadata.planned_departure_date` with its source, and the
observed column stays NULL until a real `IN_TRANSIT` transition stamps it. `actual_arrival_date` is
treated the same way.

### A timeline written out of order

**Forward or lateral, never backward.** The first implementation was stricter and wrong: it refused
`PLANNED → IN_TRANSIT`, and the existing authorization suite caught it.

> **A stage nobody recorded is a stage nobody OBSERVED, not one that did not happen.**

Two named exceptions: a **customs hold being LIFTED** (the goods did not move), and **`EXCEPTION`**,
which has no rank because it happens *to* a shipment rather than being a place in its journey.

### A retry appending a second journey

Re-reporting the current stage returns `{ unchanged: true }` with the existing event.

---

## 3. What the deployed product then showed that no unit test could

Four defects, every one found by walking the product or by mutation, none visible in review.

### The operator who loaded the container could not ship it

The **first act** of the T11 journey was a `403` for the person the phase is for.

Shipment authority was read off the affected record's tenant. **A diaspora buyer's import order has
no tenant** — it is a consumer purchase. So on every co-loaded sailing the check fell through to
platform admins and reviewers only, and the container's own operator — who had just planned the
load, loaded it and sealed it under T10, and who could *read* the T11 shipment view of that same
container — could not create or move its shipment. **The read surface knew who ran the sailing; the
write surface did not.**

A shipment on a co-loaded container belongs to the container operation, not to any one buyer's
purchase, so authority is now read off the **container** — the same test T10 applies before it will
let anyone complete a load. `isSailingOperator` becomes the canonical definition of a predicate that
T5, T7, T8, T10 and T11's read surface had each grown a private copy of.

Nothing in the unit suite could see it: **every fixture gave its order a tenant.**

### A shipment could disagree with its own history about when it sailed

The observed time had two unrelated readers. The column took `payload.event_time`; the timeline event
took `payload.metadata.event_time`. So an operator stating the real departure moved the column and
left the timeline stamped `now` — and **every stage that writes no column** (a customs hold, an
exception) reached the timeline through the second path, **where nothing validated it at all**, so a
movement could still be dated a week into the future.

`resolveObservedTime` is now the single validated source. A rule about observation is a rule about
the whole record of observations.

### A ship could arrive before it left

The stage rule stopped `ARRIVED → IN_TRANSIT`. **Nothing stopped `IN_TRANSIT` at 18:24 followed by
`ARRIVED` stated at 15:24.** Both were accepted, and because the timeline is ordered by when things
happened, the customer's own journey showed the arrival first.

An observation may now not precede the movement before it. The **creation record is excluded
deliberately** — "Shipment created" is a record-keeping act, not an observation, and a shipment is
often written up after the ship has already sailed, so the *first* movement may still be back-dated
freely. Only movements are held against each other.

### A timeline read back as an object

`lastObservedMovement` assumed the list Postgres returns. One suite's fake returned a bare object for
every operation on the stage-event table, and the first service to read its own history back got a
500. The fake now returns a list the way the database does, **and** the reader normalises the shape —
because quietly reading an unexpected shape as "there is no previous movement" would leave the rule
silently unenforced, which is the exact failure this programme is about.

---

## 4. The timeline is now append-only *structurally*

The previous receipt recorded this as the largest open item: *"append-only is still convention, not
constraint."*

`20260915090000_trade_os_t11_timeline_append_only.sql` adds a `BEFORE UPDATE` guard and a
`BEFORE DELETE` guard, plus `FORCE ROW LEVEL SECURITY` and a `REVOKE`. Only `deleted_at`,
`updated_by` and `updated_at` remain mutable — **what happened, when, where, and who recorded it
cannot be rewritten**, and a correction is a new event.

Exercised against the **live staging database**, as the most privileged direct caller there is:

| direct write | result |
|---|---|
| rewrite `stage` | REFUSED |
| rewrite `event_time` | REFUSED |
| rewrite `created_by` | REFUSED |
| rewrite `location` | REFUSED |
| hard `DELETE` | REFUSED |
| **POSITIVE CONTROL** — soft-delete via `deleted_at` | **ACCEPTED** (correct) |

The probe rolled itself back. The positive control is the point: a guard that refuses everything
would pass a matrix of refusals while breaking the product.

---

## 5. The T11/T12 coupling — closed, and worse than the audit recorded

`SHIPMENT_TO_IMPORT_STATUS` mapped `CUSTOMS_HOLD → CUSTOMS_IN_PROGRESS` and `RELEASED → RELEASED`.

Reading the import-order ladder settled it: `ARRIVED_AT_BORDER → CUSTOMS_IN_PROGRESS → DUTY_PENDING →
DUTY_PAID → RELEASED`. Because **`RELEASED` sits after `DUTY_PAID`**, a movement action was asserting
that duty had been paid.

The map is reduced to movement facts only. The three stages that were removed are named, with the
reason each belongs to T12, in `STAGES_HANDED_TO_T12` — recorded rather than deleted.

The operator screen's `RECORDABLE_STAGES` deliberately omits `RELEASED` and `COMPLETED`, and
`CUSTOMS_HOLD` **is** offered, because *where the goods are* is T11's to record and *what customs
decided* is not.

---

## 6. Certification

All against the deployed staging product at a proven FE/BE pairing
(`GET {FE}/carup-provenance.json` → `unpaired:false` + `GET {BE}/api/health`), both at the same SHA.

| gate | result |
|---|---|
| staging journeys A–G (`t11-shipment-journeys.mjs`) | **33 / 33** |
| responsive at 7 widths × 2 surfaces (`t11-responsive-certification.mjs`) | **14 / 14** |
| mutation matrix (`t11-mutation-matrix.sh`) | **19 named mutations, 19 red** |
| append-only, direct DB writes on live staging | 5 refused + 1 positive control accepted |
| `trade_os_t11_timeline_check` PGlite gate | 15 / 15 |
| backend suite | §9 |
| web suite | §9 |
| `tsc -b` | clean |
| lint baseline | NET_NEW_ERRORS=0 |

### The journeys

| journey | what it proves |
|---|---|
| **A** normal shipment | a COMPLETED T10 load → shipment → plan kept as a plan, observations NULL → observed departure ≠ plan → shipment and timeline agree → participant sees it |
| **B** skipped observations | a jump `PLANNED → IN_TRANSIT` invents no `BOOKED` and no `LOADING`, for operator or customer |
| **C** ETA vs arrival | an ETA **already in the past** never becomes an arrival; estimate and observation are separate fields and the difference is stated |
| **D** exception | `CUSTOMS_HOLD` recorded; the participant sees the hold and **no** verdict; the purchase is not moved into a customs status |
| **E** privacy | 8 refusals **and 2 positive controls** |
| **F** replay | 3 retries append 0 events; backwards refused; future refused on **both** paths; **a hold may be lifted** (positive control); nothing in the timeline is dated forward |
| **G** loaded ≠ departed | an unfinished load cannot get a shipment — **and the loaded one did** (positive control); `NOT_LOADED` and `LEFT_BEHIND` each get no journey |

### The security matrix

Every refusal is `401`/`403`, never a wrong-route `404`.

| actor / attempt | read | write |
|---|---|---|
| anonymous | 401 | 403 |
| participant (own cargo) | **200 — positive control** | 403 |
| participant → operator view | 403 | 403 |
| co-loader → another participant's tracking | 403 | — |
| foreign logistics tenant | 403 | 403 |
| foreign tenant forging `x-tenant-id` | 403 | — |
| forged shipment id | 404 (authenticated) / 401 (anonymous) | — |
| operator of the sailing | **200 — positive control** | **200 — positive control** |
| future observed departure | — | 400, both paths |
| backwards timeline | — | 400 |
| duplicate stage event | — | 200 `unchanged`, 0 appended |
| direct DB update / delete | — | refused ×5 |

The participant projection was asserted field-by-field to carry no other participant's booking, no
operator identity, no tenant id, and none of `load`/`container_id`/`import_order_id`/`shipment`.

### The mutation matrix — including two of its own

19 named mutations, all red. Two of them only after the matrix was fixed:

- it passed `--reporter=basic`, which this vitest does not have. It **died loading the reporter, ran
  zero tests, and exited 0** — so both web mutations "survived" while never being tested at all. The
  runner now requires a `Tests N passed` line before it will believe a run;
- a third mutation silently matched nothing because its expression interpolated `${when(...)}`. It
  was reported `SKIPPED` rather than passing, which is how it was caught.

The matrix exists to find checks that cannot see what they claim. It found two in itself.

---

## 7. Deliberate design decisions, recorded

- **The operator screen cannot record a customs outcome.** `RELEASED` and `COMPLETED` are reachable
  in the enum and are not offered; `CUSTOMS_HOLD` is.
- **A stage may be skipped.** Forcing invented intermediate states is the failure this programme
  exists to prevent.
- **The first movement may be back-dated.** A shipment is often written up after the ship sailed.
- **An `ABANDONED` T10 load is refused** as the conservative reading of a question with no repository
  evidence either way — flagged, not presented as an owner ruling.
- **The ±60 s skew allowance is kept.** A consequence, recorded: a stated time inside that window is
  accepted, and subsequent server-clock observations are then correctly refused as preceding it. The
  refusal is right; the message names both times.

---

## 8. T12.0 — the audit, and what it already forced

The first thing T12's audit found is not a gap. It is a forgery.

Approving an OCR document **INSERTed a row into `zimra_declarations`** — a table that models an act
by the Zimbabwe Revenue Authority — in which almost every field was manufactured:

| field | what was written | what it asserts |
|---|---|---|
| `customs_ref_number` | `'CUS_' + random uuid` | a ZIMRA reference nobody issued |
| `port_of_entry` | defaulted to `'Beitbridge'` | a port nobody recorded |
| `duty_calculated_zig` | defaulted to `50000` | an amount nobody assessed |
| `duty_paid_zig` | the same `50000` | **that duty was PAID** |
| `exchange_rate_used` | hardcoded `13.5` | a rate with no date and no source |
| `customs_stamp_date` | today | a stamp date nobody stamped |
| `officer_signature_hash` | `sha256(our own document id)` | **a ZIMRA officer's signature** |

`cvr_ownership_records` the same, down to one real-looking national ID number defaulted onto every
registration book.

**The write is removed, not disabled.** A photograph read by OCR and approved by a CarUp
administrator is evidence that a document exists and what it appeared to say. It is not a customs
declaration, and **CarUp is not ZIMRA**: the provider cannot mint the authority it relies on.

A prior phase had recognised the danger downstream — `vehicleFactResolver` marks `CUS_`/`REG_`/`LB_`
rows as `document_intelligence` and refuses to let them substantiate a claim. **But it was not the
only reader.** `trustGraphService` scored the mere *existence* of a row (`!!zimra`), so a declaration
this codebase had synthesised itself was worth **+10 trust** there while being refused there. Both
readers now ask one question through one exported predicate.

What CarUp actually observed is untouched and still recorded: `ocr_documents` holds the document,
`ocr_customs_declarations` holds what was read off it *with a confidence*, and
`administrative_overrides` holds who approved it and why. Those are CarUp's own facts.

**Blast radius:** staging holds **zero** rows in either table — the path was never exercised there.
**Production is out of scope by directive, so its blast radius is UNMEASURED.** A read-only count is
flagged for owner decision (§10).

---

## 9. Numbers

Recorded at freeze; see the PR for the exact SHA and CI run.

| suite | result |
|---|---|
| backend | 6316 tests · 0 fail · 21 skipped |
| web | 1837 tests · 180 files · 0 fail |
| migration gates | 7 / 7 exit 0 |
| `tsc -b` | clean |
| lint baseline | NET_NEW_ERRORS=0, NET_NEW_WARNINGS=0 |

---

## 10. Open, carried forward

- **Owner acceptance of T11 remains.** This is a conditional freeze.
- **The production blast radius of the registry forgery is UNMEASURED**, because production is out of
  scope. **Owner decision required** on authorising a read-only count of `zimra_declarations` and
  `cvr_ownership_records` rows carrying `CUS_`/`REG_`/`LB_` identifiers, `exchange_rate_used = 13.5`,
  `duty_paid_zig = 50000` or `owner_id_number = '29-198427-G-45'`.
- **`isSailingOperator` is canonical but not yet sole.** Four frozen phases (T5, T7, T8, T10) and
  T11's read surface still carry private copies. Consolidating them touches frozen lanes and was not
  taken inside this phase.
- **T12 legal and tariff policy is UNRESOLVED and deliberately unwritten.** No duty percentage, VAT
  rate, surtax, age rule, exchange rate, valuation formula, import ban, rebate, broker fee or port
  charge has been introduced anywhere. See the T12 plan §BLOCKED.
- Carried forward unchanged: T8's live-OCR and storage-failure residuals; T9's outbox-drain residual.
