# Trade OS T9 — Warehouse intake & measurement · Implementation plan

**Status:** IN IMPLEMENTATION. Authorized 2026-09-07 at head `e81fb7e9`, immediately after the T8
freeze (`T8-USABLE`, runtime `00f164e4`). T10+ NOT authorized.

**Objective:** move Trade OS from *"the customer says this cargo exists"* to *"an authorized
receiving operation physically received and measured it"* — without letting the second silently
overwrite the first.

---

## 1. T9.0 — warehouse authority audit (COMPLETE)

Repo- and schema-wide search for warehouse / yard / CFS / intake / receipt / measurement /
dimensions / weight / CBM / condition / storage location / inspection / handoff.

### 1.1 The finding

**No warehouse authority exists anywhere.** There is no warehouse, yard, intake, receipt or
measurement table. The only near-matches belong to other domains:

| table | domain |
|---|---|
| `dealer_branches`, `garage_branches`, `organization_branches` | party locations, not receiving operations |
| `vid_inspections` | vehicle roadworthiness, not cargo receipt |
| `diaspora_workbook_import_receipts` | spreadsheet import receipts, not physical cargo |

So T9 **creates** its authority, exactly as T5 created the corridor authority.

### 1.2 What already owns the ESTIMATE — and must never be overwritten

| fact | authority |
|---|---|
| booking estimate | `diaspora_cargo_reservations.estimated_volume`, `.estimated_weight` |
| intake estimate | `diaspora_logistics_request_items.estimated_volume_cbm`, `.estimated_weight_kg`, `.dimension_unit` |
| container capacity ledger | `diaspora_container_shipments.total/used/available_capacity_volume` — **frozen by T5** |

**Nothing in T9 writes any of these.** The estimate is what the customer said; the actual is what the
warehouse observed; both are true statements about different moments, and collapsing them destroys
the only record of the disagreement.

### 1.3 Authority map

| fact | T9 owner | source | consumer |
|---|---|---|---|
| receiving operation exists | `diaspora_warehouses` (new) | operator | intake |
| cargo was physically received | `diaspora_warehouse_intakes` (new) | authorized receiver | customer view, T10 |
| actual dimensions / weight | `diaspora_warehouse_measurements` (new) | authorized receiver | discrepancy, T10 planning |
| condition evidence | **T8** Documents & Evidence — no warehouse file store | receiver | customer view |
| customer notification | **T7** Communications — domain fact first | T9 event | participant |
| booked capacity | **T5, unchanged** — T9 records a discrepancy, it does not rewrite the ledger | — | T10 |

### 1.4 Intake anchor

An intake is anchored to what was actually booked or requested, using the same generic
`subject_type`/`subject_id` idiom the rest of Trade OS now uses (T6 charge components, T7 threads,
T8 documents): `cargo_reservation` or `logistics_request`.

**A reservation is not a receipt.** An APPROVED booking means space was committed, not that anything
arrived.

---

## 2. The truth boundaries

**ESTIMATED ≠ ACTUAL.** Never overwrite an estimate. Actuals are stored separately with who
measured, when, where, by what method, and in what unit.

**A receipt requires an authorized receiving action.** Not a message ("I dropped it off"), not a
photo, not an approved booking. Evidence *supports* an observation; it is not the observation.

**A discrepancy is a recorded fact, not a decision.** `+0.8 CBM` is visible and audited. It does not
raise a charge (T6 owns commercial), re-plan a load (T10), settle anything (T13) or mutate T5's
hardened capacity ledger.

**Unknown stays unknown.** No invented storage location.

**T9 never writes** `LOADED`, `SHIPPED`, `DEPARTED`, `CUSTOMS_CLEARED`, or a Trust verdict.

## 3. Slices

- **T9.0** authority audit — **COMPLETE**.
- **T9.1** the authority: warehouses, intakes, measurements; estimate preserved; discrepancy derived.
- **T9.2** governed receive/measure services with server-derived warehouse authority.
- **T9.3** customer + operator surfaces.
- **T9.4** T7 communications convergence (domain fact → notification, replay-safe).
- **T9.5** T8 evidence convergence (condition photos bind through T8, no new file store).
- **T9.6** privacy/adversarial, responsive, staging certification.

## 4. Phase firewall

T10 loading · T11 shipment · T12 customs · T13 settlement · T14 reputation · T15 Intelligence remain
their own authorities. **T12-BLOCKER carried forward unchanged.**
