# Trade OS T9 — Warehouse intake & measurement · Receipt

**Status: `T9-USABLE` — OWNER ACCEPTANCE REMAINS.** Runtime candidate `ee747940`.
Certified against the deployed staging product at a proven FE/BE pairing. T10.0 audit complete,
T10 runtime not started. Production untouched. PR #207 Draft.

## 1. T9.0 — the audit

**No warehouse authority existed anywhere in the repository.** No warehouse, yard, CFS, intake,
receipt or measurement table. Every near-match belonged to a different domain:

| table | actual domain |
|---|---|
| `dealer_branches`, `garage_branches`, `organization_branches` | party locations |
| `vid_inspections` | vehicle roadworthiness |
| `diaspora_workbook_import_receipts` | spreadsheet imports |

So T9 creates its authority, exactly as T5 created the corridor authority from nothing.

### What already owns the ESTIMATE

| fact | authority — untouched by T9 |
|---|---|
| booking estimate | `diaspora_cargo_reservations.estimated_volume` / `.estimated_weight` |
| intake estimate | `diaspora_logistics_request_items.estimated_volume_cbm` / `.estimated_weight_kg` |
| capacity ledger | `diaspora_container_shipments.*_capacity_volume` — **frozen by T5** |

## 2. T9.1 — the authority, and the boundary it exists to hold

Migration `20260911090000` creates `diaspora_warehouses`, `diaspora_warehouse_intakes` and
`diaspora_warehouse_measurements`.

**ESTIMATED ≠ ACTUAL.** The estimate is not touched — not one column of it. Actuals live in their own
table with who measured, when, and by what method. Both are true statements about different moments,
and collapsing them destroys the only record of the disagreement. The gate proves the customer's
**3.0 CBM survives a 3.8 CBM measurement**, and that the **+0.8 difference is derivable from both**.

**A receipt is an attributed act, not a status.** `RECEIVED` without a receiver *and* a time is
refused by the database. An exception outcome must say why — a refusal without a reason is unusable
to the customer it affects. A second live intake for the same cargo is refused, because a re-receipt
is a correction rather than a new arrival.

**Unknown stays unknown.** `storage_location` is NULL until actually assigned; no invented bay.

**Condition is an observation, from a bounded vocabulary** (`good`, `minor_damage`, `major_damage`,
`incomplete`, `unverifiable`) — the receiver's own, never an inference from an image.

**What the schema deliberately cannot express:** `LOADED`, `SHIPPED`, `DEPARTED`, `CUSTOMS_CLEARED`,
or a Trust verdict. There is no column to smuggle them into, and the gate proves `status='LOADED'`
is refused. Those remain T10/T11/T12/T14.

**Governed access.** All three tables `ENABLE` + `FORCE` RLS with `anon` and `authenticated`
revoked: the row that decides whether somebody's cargo was received must not be writable from a
browser. (The gate creates those Supabase roles in its fixture rather than weakening the migration.)

## 3. Evidence at `27a2a558`

| gate | result |
|---|---|
| T9 warehouse PGlite gate (own CI step) | **20/20** |
| full backend suite (ci.yml env) | **6091 passed / 0 failed** (21 skipped, 6112 total) |
| all five migration gates (T9 · T8×2 · T6 · integrity) | exit 0 |
| lint regression | NET_NEW_ERRORS=0 |

**Two mutations proven:** allowing `RECEIVED` without attribution, and allowing a weight without its
unit — each turns the gate red.

Applied to **staging only**; verified `FORCE` RLS and no `anon` SELECT on all three tables.

## 4. Not done — what `T9-PARTIAL` is missing

- **T9.2** governed receive/measure services with server-derived warehouse authority — the schema
  exists; no service writes it yet.
- **T9.3** customer and operator surfaces (intake queue, "your cargo", discrepancy view).
- **T9.4** T7 communications convergence (cargo received, discrepancy notice), replay-safe.
- **T9.5** T8 evidence convergence for condition photos — binding through T8, no new file store.
- **T9.6** privacy/adversarial matrix, responsive certification, staging journeys A–E.

The authority and its truth boundaries are in place and proven; the product on top of them is not
built. **This agent does not mark `T9-USABLE`.**

## 5. Carried forward

**T12-BLOCKER unchanged.** `documentIntelligenceService` still writes a fabricated customs exchange
rate (13.5) and duty (50000). No T9 surface reads it.

---

# T9 closure — services, surfaces, convergence and certification

`27a2a558` was the authority and nothing else. Everything below is what made it a phase.

## 3. T9.2 — the governed service

`warehouseIntakeService.js` is the only way to write the three tables; RLS is FORCE and
`anon`/`authenticated` hold nothing, so no browser path exists at all.

Three refusals carry the phase, and each is mutation-proven:

1. **A customer cannot mark their own cargo received.** Receiving authority is derived from the
   WAREHOUSE — its named operator, or a tenant admin of the tenant running it — and the cargo's
   owner is refused outright. A platform admin who owns the cargo is refused too: seniority is not
   the question. Receiving is somebody *else* confirming your goods arrived; a party confirming it
   about themselves is a claim, not a receipt.
2. **`received_by` is the authenticated actor.** A forged one in the request body has nowhere to
   land. `received_at` may be *stated* by the receiver (an arrival logged an hour late is real), but
   never in the future, never more than 30 days back, and the row records which of the two it was.
3. **Nothing writes another phase's authority.** Proven by a trap client that fails the test if
   `diaspora_cargo_reservations`, `diaspora_container_shipments`, `diaspora_logistics_requests` or
   `_request_items` is written by any T9 call.

### The intake anchor was decided, not inherited

| anchor | required state | why |
|---|---|---|
| `cargo_reservation` | **APPROVED** | T5's invariant is that only an approved reservation holds space. Receiving against an unapproved one means holding goods for a booking nobody accepted — and the customer would reasonably read the receipt as acceptance. |
| `logistics_request` | **AWARDED** | T3's premise is a provider with no CarUp sailing, whose own warehouse receives cargo before any container reservation exists. But before a quote is accepted nobody has agreed to carry anything. |

An arbitrary UUID resolves to nothing and is refused; a subject in the wrong state is refused with
the state named, so the operator can see why.

### Measurement

Volume is **derived by the server** from the dimensions on the row. A client-supplied CBM is never
stored — the staging journey sends real dimensions alongside a deliberately wrong `0.1`, and the
server records `3.800`. With no dimensions the volume stays unknown rather than becoming somebody's
number.

The dimensions describe **the consignment as presented**, not one carton, so package count does not
multiply the volume. Multiplying would invent cubic metres the moment a receiver counted five boxes
and measured the stack once. The form says so in words.

Measurements are append-only: a correction is a new observation, the latest is authoritative, and
the earlier ones stay readable with their own measurer and time.

## 4. Estimate vs actual — and why "partial" needed its own answer

The estimate is never written. The certification fixture is the directive's: **3.0 booked, 3.8
measured, +0.8 stated**, with the booking's `estimated_volume` still `3.000` afterwards.

The case that needed real thought is the **incomplete** estimate. A shipping request whose items
include one with no stated volume does not have a 3.0 CBM estimate — it has "at least 3.0, and one
item nobody measured". Summing a column containing NULLs and calling it the estimate is the
unknown-becomes-zero collapse, and every later discrepancy computed from it would be a lie. So
completeness is reported (`COMPLETE` / `PARTIAL` / `UNKNOWN`), the screen says *"At least 3.000 CBM —
1 of 2 cargo items had no stated volume, so this is a floor rather than a total"*, and the
discrepancy reports `NOT_COMPARABLE` with the reason instead of inventing a difference.

Covered: actual larger, actual smaller, actual equal, weight discrepancy, missing estimate, missing
actual — each with its own test and its own sentence.

## 5. A discrepancy is a fact, not a commercial decision

`projectDiscrepancy` has no branch that produces money. A test serializes the object and fails on
`amount`, `charge`, `surcharge`, `price`, `currency`, `usd`, `invoice`, `fee` or `total` appearing as
a **field** — the prose disclaimer is allowed to say *"it does not by itself change the price"*,
because that is the sentence doing the work. Mutating `commercial_effect` to `'surcharge'` with an
amount turns the gate red.

The customer screen says it out loud, because a person told their 3.0 CBM booking measured 3.8 will
otherwise assume a bill is coming.

## 6. The T5 capacity firewall

T5 computes `usedVolume` as the sum of APPROVED reservations' **estimated** volume. So the strongest
available assertion is not "the stored column is unchanged" but **"the ledger still sums the
estimates"**: with 3.0 + 1.5 + 0.5 + 0.5 booked and a 3.8 CBM measurement recorded, the deployed
capacity endpoint still answers `used 5.5 / available 27.5`. Had T9 written its actual into the
estimate, that would read 6.3. Mutation-proven both ways.

## 7. T9.5 — evidence through T8, not around it

Migration `20260912090000` adds **one value** to T8's governed subject vocabulary:
`warehouse_intake`. It creates no table, no column, no store and no second upload path. A condition
photo is therefore an ordinary T8 document, and everything T8 enforces keeps applying — including
**presence is not verification**: an uploaded photo is `UPLOADED`, and the checklist row reads
*"Supplied"*, never *"Verified"*.

The direction stays one-way and is tested from both sides: the intake record is complete and true
with no image attached, and attaching an image does not receive the cargo or record a condition.

The PGlite gate proves the extension did not loosen anything: before it, `warehouse_intake` is
refused; after it, a free-text subject is *still* refused, a document still cannot belong to two
things at once, all four frozen T8 subjects still work, and `Down` reverts to exactly the frozen
vocabulary.

Two parties may open an intake's evidence — the receiving warehouse, and the customer whose cargo it
is. A co-loader on the same sailing gets `403`: sharing a container is not sharing consignments.

## 8. T9.4 — communications through T7

Three events, registered in **both** the listener and the policy:
`diaspora.warehouse.cargo_received`, `.condition_issue` (high priority — the customer may need to
act), `.measurement_discrepancy`. The intake id joins the outbox dedupe chain so two consignments for
one person cannot collapse into one notice.

The emit sites keep their **literal** event types. The first version threaded the type through a
helper, and `communication-event-coverage` failed: a subscription whose emitter the gate cannot see
is one that looks alive and is dead. Same shape as T7. The comment says so.

Measured on the deployed system: **18 outbox events, 18 addressable** (10 received · 2 condition ·
6 discrepancy), every one carrying `recipientUserId`.

A replayed receive returns before the notifier is reached, so one arrival sends one notice — proven
with an **injected emitter**, because asserting `result === null` also passes when the outbox is
simply unavailable.

## 9. T9.3 — the two surfaces

Before these, the central act of the phase could only be performed with a SQL statement.

**Operator** (`/diaspora/warehouse`) — queue, receive, condition, piece count, measure, storage
position, evidence link. Receiving is **confirmed, not clicked**: the panel will not submit until the
operator types the consignment's own reference. The measurement form deliberately does **not**
pre-fill the estimate, because a pre-filled number nobody re-measured is how an estimate quietly
becomes an observation.

**Customer** (`/diaspora/cargo/:subjectType/:subjectId`) — has it arrived, what was found, both
measurements, the difference, storage if known, and the reason if it was refused. No progress bar
implying motion nobody observed. Unknown is written as unknown, never as `0.000`.

Somebody with no warehouse authority sees an **empty queue**, not a locked door — there is nothing
there that is theirs to be refused.

## 10. The defect the deployed product found

Reading the operator queue at 393px on staging, **four consignments all read `WHIN-99994444`**.

The reference was the subject id's first eight hex characters, and the receive confirmation asked the
operator to type exactly that string before recording that somebody else's goods were in their
building. So the one check standing between a mis-tap and receiving the wrong participant's cargo
could not distinguish the two consignments it existed to distinguish. **A disambiguator that does not
disambiguate is worse than none, because it looks like a check.**

Fixed at `ee747940`: the reference derives from the intake's own id. Idempotency is untouched —
`uq_warehouse_intake_subject` keys on the subject, not the reference. The detail panel now also shows
the customer's full reference, so the operator checks against paperwork rather than against another
line on the same screen. Re-verified on the deployed product: five distinct references.

Every unit test passed before this, against a fixture whose ids happened to differ.

## 11. Certification

**FE/BE pairing proven** — `carup-provenance.json` reports `commit_sha ee747940`, `unpaired: false`,
and the paired backend alias answers `commit_sha_short ee747940`.

| gate | result |
|---|---|
| staging journeys A–F | **34/34**, deployed, as four real signed-in people |
| privacy matrix | included above, **with positive controls** — the owner and the operator succeed |
| responsive, 7 widths × 2 surfaces | **14/14**, `scrollWidth <= innerWidth + 1` plus a per-element sweep, plus visual inspection |
| backend suite | 0 failures |
| web suite | 0 failures |
| PGlite gate `trade_os_t9_warehouse_check` | **29/29**, exit 0, its own CI step |
| mutations | **12 required + 2 extra, all red** |
| `tsc -b` · lint | clean · NET_NEW_ERRORS=0 |

### Mutation matrix

| # | mutation | verdict |
|---|---|---|
| 1 | a customer CAN mark their own cargo received | RED |
| 2 | cargo received with no actor and no time | RED |
| 3 | the actual overwrites the customer estimate | RED |
| 4 | the measurement rewrites the T5 capacity ledger | RED |
| 5 | a client-supplied receiver is trusted | RED |
| 6 | a co-loader can read another participant's cargo | RED |
| 7 | a foreign warehouse operator can receive | RED |
| 8 | a photo alone creates the receipt | RED |
| 9 | a duplicate receive re-receives already-received cargo | RED |
| 10 | a discrepancy automatically creates a charge | RED |
| 11 | a notification replay duplicates the notice | RED |
| 12 | `LOADED` accepted as a T9 state | RED |
| 13 | the one-live-intake unique index is dropped | RED |
| 14 | **only** the early return removed (compare-and-set intact) | **SURVIVED — expected** |

Mutation 14 was extra, and it found something worth writing down: the early return in
`receiveIntake` is a **fast path**, and the conditional `UPDATE … .eq('status','EXPECTED')` below it
is the actual concurrency guarantee. Mutation 9 removes both and goes red. Both now carry comments
saying which is which, so a later reader does not delete the one that matters.

### Stated limitations — not hidden

- **The outbox drain was not exercised.** On staging the domain-event drain is a secret-guarded
  endpoint whose cron points at the stable staging host, and **142 events across all types sat
  unprocessed in 24h with 0 processed** — an environment fact affecting every phase equally, not a
  T9 defect. T9's producer half is proven on the deployed system (18/18 addressable); the generic
  worker → policy → `notification_queue` half is T7's frozen machinery, certified there. The endpoint
  exists and refuses without the secret (401, not 404).
- **A volume with no dimensions cannot be recorded.** The schema requires a dimension, a weight or a
  count, and a stated CBM without dimensions is refused rather than stored as a claim. A receiver who
  can only eyeball an irregular stack therefore records weight or count instead. Deliberate, and
  worth revisiting if real warehouse use disagrees.
- **T12-BLOCKER carried forward unchanged.** T8's residuals (live OCR unavailable on staging; no
  destructive storage-failure test) are also carried forward, untouched by T9.

## 12. Still open

T9 records that cargo arrived and how big it actually is. It does **not** decide what happens next:
no loading, no planning, no re-pricing. The schema cannot express `LOADED`, `SHIPPED`, `DEPARTED` or
`CUSTOMS_CLEARED`, and both screens are tested for that vocabulary at every width.
