# CAP-01 AUTHORITY INVENTORY — PART A

> **This is not the final CAP-01 authority reconciliation.**
> It is an inventory of what CarUp already owns. The REUSE / EXTEND / NEW decisions require the CAP-00
> competitor-evidence register, which does not exist yet (REA-03, the Owner-authenticated CAP session,
> is outstanding). Nothing below classifies a BE FORWARD capability, and nothing below is accepted
> architecture. Every "gap" is a hypothesis for CAP-01 Part B to dispose of.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Canonical role | `TRADE OS JOURNEY AUTHORITY SPECIALIST` |
| Branch | `feat/trade-os-t11-cap-lr01-journey-arrival` |
| Parent | `577428de` = head of PR #207 (`feat/trade-os-client-demo-convergence`; OPEN, DRAFT, UNMERGED). Re-checked with `git ls-remote` before this checkpoint: unchanged. |
| Frozen authority touched | NONE — no T4/T5/T7/T8/T10/T11/T12 file is modified |
| Production touched | NO |
| Method | Read-only code inventory by a delegated agent, then re-verification by the lead. **V** = the lead re-read the code or the staging schema; **agent** = agent-reported with file:line, not yet re-read by the lead |

## 1. Authority status (corrects the long-run directive)

| Layer | Status | Frozen at |
|---|---|---|
| T4 Order & Booking Passport | USABLE, frozen | `736f06c5` |
| T5 Container Marketplace | USABLE, frozen | `5079b0b3` |
| T7 Communications | USABLE, frozen | `3f062fc0` |
| T8 Documents & Evidence | USABLE, frozen | `00f164e4` |
| T10 Consolidation & Loading | USABLE, frozen | `d6918041` |
| T11 Shipment & Tracking | USABLE, frozen | `9ce19115` |
| T12 Customs & Destination | USABLE, frozen | `4d880f59` |
| **T13 SafeTrade** | **`T13-PARTIAL` — not accepted** | none |

The directive describes T13 as accepted. It is not. A Journey surface that composes SafeTrade state
composes an authority with no Owner acceptance.

## 2. What exists

- **Shipment (T11):** `diaspora_shipments` — `carrier_name`, `tracking_number`, `origin_port`,
  `destination_port`, `departure_date`, `estimated_arrival_date`, `actual_arrival_date`, `status`,
  `metadata` — and the append-only `diaspora_shipment_stage_events`. Nine statuses; forward-or-lateral
  only. Planned departure is `metadata.planned_departure_date`; `departure_date` is stamped only by a
  real `IN_TRANSIT` transition and `actual_arrival_date` only by `ARRIVED`. **V** (columns confirmed
  against the staging schema).
- **Participant read surface:** `GET /api/diaspora/my-tracking/:subjectType/:subjectId`, keyed on a
  `cargo_reservation`; state is derived from observed dates, not from the status enum.
- **Loading (T10):** `diaspora_container_loads`; a shipment carrying a `container_id` requires a
  COMPLETED load.
- **Documents (T8):** `diaspora_trade_documents` with a governed subject vocabulary. Types include
  `bill_of_lading`, `commercial_invoice`, `export_certificate`, `inspection_certificate`.
- **Customs (T12):** `diaspora_customs_cases` (nullable `shipment_id`), agent appointments, and 14
  event types split into CarUp-observed vs ATTRIBUTED. There is no `cleared` boolean.
- **Communications (T7):** domain events → `notification_queue`; all Trade OS events are `in_app` only
  today.
- **Sailing (T5):** `diaspora_container_shipments` with ETD/ETA; corridor legs exist as *templates*.
- **Vehicle key:** `vehicles.vin`. The chain to a shipment is VIN → import order → reservation →
  container → shipment; no row on a shipment or load item carries a VIN.

## 3. Gaps and defect candidates

### G1 — No first-class vessel/leg model  · `PROVEN` · **V**

CarUp holds single-shipment carrier / tracking / origin-port / destination-port fields, but has **no
first-class vessel, voyage, IMO/MMSI or ordered shipment-leg representation**. It therefore cannot
faithfully represent per-leg vessel / voyage / port / date truth for transshipment without an additive
model. (A repo-wide search for `vessel|voyage|imo|transship` in services and migrations finds only T6
charge labels and one code comment.) The existing `origin_port` and `destination_port` are real and
are **not** treated as absent.

```text
CURRENT                              MISSING
shipment                             shipment
 ├── carrier                          ├── leg 1: vessel · voyage · POL · POD · dates
 ├── origin_port                      ├── leg 2: vessel · voyage · POL · POD · dates
 ├── destination_port                 └── ...
 ├── departure (observed)
 └── ETA
```

### G2 — No view composes T10/T11/T12/T13/T8  · agent
Projections are keyed differently: tracking and customs by `cargo_reservation`, documents by order /
logistics request / container / load, SafeTrade by import order.

### G3 — T4 rail is stale against T11 and T12  · `PROVEN COMPOSITION/PROJECTION GAP` · **V**
`backend/services/diaspora/tradeTransactionStage.js` still carries later stages through
`UNIMPLEMENTED_STAGES`: Shipment `NOT_CONNECTED`, Customs `NOT_RECORDED`, Zimbabwe handoff
`NOT_RECORDED`. The T4 next-step copy (`tradeTransactionStage.js:199`) says *"The later stages of the
journey are not connected yet."* T11 and T12 now exist, so this is stale projection/product wiring, not
absent underlying authority.

### G4 — Participant tracking selects a shipment non-deterministically  · `PROVEN EXISTING T11 DEFECT CANDIDATE` · **V**
`shipmentTrackingService.js` (~L277) loads shipments by `container_id` only and takes
`(shipments || [])[0]`. There is no ordering, no `import_order_id` match, and no reservation→shipment
or cargo→shipment relationship. *Potential consequence:* a participant on a co-loaded container can be
projected a shipment row that is not deterministically associated with their own order or cargo.
Not fixed here. Not to be hidden behind a new projection.

### G5 — Exception notices are not addressed to the buyer  · `PROVEN T7/T11 ADDRESSABILITY DEFECT CANDIDATE` · **V**
Mechanism, exactly:
1. `updateShipmentStage()` (`diasporaShipmentService.js` ~L430) calls
   `notifyShipmentException({ shipment, stage, notes, tenantId })` — **no `buyerId`**.
2. The notifier computes `recipientUserId = buyerId || shipment?.buyer_id || shipment?.created_by`.
3. `diaspora_shipments` has **no `buyer_id` column** (confirmed against the staging schema), so the
   fallback is `shipment.created_by` — ordinarily the shipment creator / operator.
4. **Internal contradiction:** the file header states *"the buyer is resolved here from the
   authoritative order."* The function body contains no order lookup (the only `import_order` reference
   is copying `shipment.import_order_id` into the payload).

Not fixed here. CAP-08 owns communications convergence unless CAP-01 Part B finds this needs an
earlier bounded remediation.

### G6 — T8 cannot bind a document to a shipment or customs case  · `PROVEN AUTHORITY-MODEL GAP` · **V**
The governed `subject_type` vocabulary (`20260914090000`) is `import_order`, `logistics_request`,
`container_booking`, `trade_order`, `warehouse_intake`, `container_load`. It contains neither
`diaspora_shipment` nor `customs_case`. A B/L can therefore be attached through transaction, booking or
load authority rather than directly to the shipment it documents. Whether CarUp should keep transaction
ownership and project, add an explicit evidence relationship, or add another bounded mechanism is **not
decided here**; CAP-00 must first establish how CAP relates documents to journeys.

### Further candidates (agent-reported; not yet re-read by the lead)
- **G7** Sailing status (SHIPPED/ARRIVED) and shipment status (IN_TRANSIT/ARRIVED) are independent
  writes; nothing reconciles them.
- **G8** Legacy `GET /shipments*` return full rows including `metadata` and `created_by`, bypassing the
  participant projection.
- **G9** The participant timeline is not stage-filtered; `RELEASED`/`COMPLETED` are API-reachable
  though the operator UI does not offer them.
- **G10** `openCase` does not verify that a supplied `shipment_id` belongs to the subject.
- **G11** `DiasporaTrade.tsx` labels `departure_date` "Estimated departure" although that column is
  now the OBSERVED departure; operator shipment page needs a pasted id.

## 4. Disposition — pending CAP-01 Part B

Each item must end in exactly one of:
`JOURNEY PROJECTION CAN SAFELY COMPOSE AROUND IT` ·
`BOUNDED EXISTING-AUTHORITY REMEDIATION REQUIRED` ·
`ADDITIVE NEW AUTHORITY REQUIRED` ·
`NOT REQUIRED BY CAP EVIDENCE`.

| Item | Disposition |
|---|---|
| G1 vessel/leg model | PENDING PART B |
| G3 stale T4 rail | PENDING PART B |
| G4 shipment selection | PENDING PART B — must answer: (1) can Journey select the correct shipment using existing authority; (2) does the legacy participant endpoint remain exposed; (3) must frozen T11 be narrowly reopened |
| G5 exception recipient | PENDING PART B |
| G6 document binding | PENDING PART B |
| G7–G11 | PENDING PART B (verify first) |

**No frozen T11/T12 code is modified by this part.** Only after Part B places an item may product
authority be mutated, and a change to frozen code is a separate, explicitly scoped change.

## 5. Staging identity baseline (read-only; nothing mutated)

- Canonical account candidate: staging user `u_66cace85fad949e4`, display name **"Kingston Musarurwa"**
  (the directive's "Kingstone" is a spelling variant), platform role `owner`. Moderator-verified; the
  lead re-verified the seller-authority row below. No second account is to be created and the user is
  not renamed.
- `vehicle_seller_authority` for chassis `GFC27-027051`: seller `u_66cace85fad949e4`, claim `owner`,
  status `confirmed`, basis `existing_relationship`. **V**
- The matching `vehicles` row exists on staging with `current_seller_id` and `owner_id` equal to that
  account. **V** (descriptive attributes are kept in the private CAP-00 evidence folder, not in this
  repository).
- **Vehicle match against the CAP vehicle: `MATCH NOT YET PROVEN`** — no CAP evidence exists yet. If
  CAP identifies a different vehicle, the association step stops and the discrepancy is reported.

## 6. Preservation proof carried forward

`planned departure ≠ observed departure`, `ETA ≠ actual arrival`, `LOADED ≠ SAILED`,
`customs observation ≠ customs decision`. Baseline `backend/tests/trade-os-t11-*.test.js`:
**59/59 pass** at `577428de`.

## 7. Not done in this part

REUSE / EXTEND / NEW classification; the implementation contract for CAP-02..09. Both wait on CAP-00.
