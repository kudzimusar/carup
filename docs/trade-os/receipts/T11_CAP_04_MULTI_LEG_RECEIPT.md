# T11-CAP-04 — Shipment legs · Receipt

**Specialist gate: `SPECIALIST GATE PASSED`** at unit, real-Postgres (PGlite) and stubbed-browser level.
Recommendation: `RECOMMEND ACCEPT — T11-CAP-04`, subject to **amendment A1** and decision **D5** below. The
Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Canonical role | `MULTI-LEG SHIPPING SPECIALIST` |
| Builds on | CAP-03 (`596552c8`) |
| Frozen code modified | **none** (T11 shipment, timeline and tracking code untouched) |
| Schema | **one additive table**, `diaspora_shipment_legs` (migration `20260920090000`) |
| Staging / production | **migration NOT applied to staging**; production untouched |
| Real data | **no real vessel entered** (held on D4) |

## 1. Amendment A1 — legs are declared, not observed (read this first)

CAP-01 Part B §3.1 proposed observed departure/arrival columns on each leg. **This unit did not build
them**, and the table has no observed, actual, status or verified column at all — a real-Postgres check
fails if one is ever added. Per-leg observed columns could only be written through a path other than T11
(a **second place to assert "it sailed"**) or by reopening frozen T11; CAP evidence supports a *declared*
vessel and route, not per-leg observed movement. Part B now records this as amendment A1, and the
question of per-leg observed movement as **decision D5**: it is not required by anything observed, and
nothing here is blocked on it.

## 2. What was built

- **Migration** [20260920090000_trade_os_cap04_shipment_legs.sql](../../../database/migrations/20260920090000_trade_os_cap04_shipment_legs.sql):
  an ordered list of declared legs under a shipment — carrier, vessel, voyage, IMO, MMSI, loading and
  discharge ports, planned departure, estimated arrival, a source and its reference. A single-vessel
  journey is **one leg**; a transshipment is more. Constraints: seven-digit IMO, nine-digit MMSI, a closed
  list of sources, a position from 1, **one live leg per position** (a superseded leg frees its position),
  and a leg must name at least a vessel, carrier or port. A guard trigger makes the shipment, position,
  author and declaration time immutable; deletes are refused (supersede instead); `FORCE` RLS with
  `anon`/`authenticated` revoked — T11's own posture. `-- +migrate Down` included.
- **Write service** [diasporaShipmentLegService.js](../../../backend/services/diaspora/diasporaShipmentLegService.js):
  declare, correct and supersede a leg. **Who may write is T11's own rule**, reused verbatim
  (`assertMayMoveShipment`): a platform admin or reviewer, the record's tenant admin, or the operator of
  the container. A buyer does not declare vessels for their own purchase. IMO numbers are validated with
  the real **check-digit algorithm**, not just their shape. **A caller cannot declare a leg as CARRIER- or
  PROVIDER-sourced** (`PROVIDER INTEGRATION PENDING EXTERNAL AUTHORITY`); a DOCUMENT-sourced leg must
  point at a live document of **this** order. The service writes only legs and audit rows — never a
  shipment, a stage event or a document.
- **Read helpers** [shipmentLegRead.js](../../../backend/services/diaspora/shipmentLegRead.js), apart from
  the write service so the read-only Journey does not import the T11 service and the database singleton.
- **Routes** [diasporaShipmentLegRoutes.js](../../../backend/routes/diasporaShipmentLegRoutes.js): list,
  declare, correct, supersede (`DELETE` supersedes). Allow-listed projections only; no route can move a
  leg to another journey.
- **Journey composition:** `shipping.legs` is now composed. With none declared it says **"No vessel or
  voyage has been declared"** — which is different from "not connected"; where no shipment is shown it is
  `not_applicable`. Legs never change the journey state. A leg whose **first loading port or last
  discharge port contradicts the shipment record** raises a `LEG_PORT_MISMATCH` flag (only the two ends
  are compared, so a legitimate transshipment is not flagged; an unknown port is not a contradiction).
- **Web:** a "Vessel and route" card (legs in order; plan and estimate worded as such; IMO/MMSI only when
  recorded; nothing invented) and the port-mismatch alert.
- **CI:** the new DB check is wired in beside T10/T11/T12 (the workflow parses; the step is in `validate`).

## 3. Evidence

| Check | Result |
|---|---|
| Real-Postgres check (PGlite) | **23 / 23**, including the structural "no column can assert a sailing", every refusal, the correction path, `FORCE` RLS and privileges, and Down |
| Migration mutation test | **11 / 11 killed** for the right reason; two needed fixing first — M2 first "died" of a syntax error in my own harness (a crash is not a kill) and M7 survived until the fixture emulated Supabase's default grants (a bare Postgres gives new tables no grants, so the `REVOKE` was untestable) |
| Leg service tests | **33 / 33**; mutation **15 / 15 killed** (one needed both redundant layers removed — service check and DB 23505 mapping — to prove the test guards the behaviour) |
| Leg route tests (real Express) | **10 / 10**; mutation **5 / 5 killed** |
| Journey + legs tests | **49 / 49**; mutation **10 / 10 killed** after the ordering test was strengthened (reversing the legs had survived because my fixture was accidentally symmetric) |
| Targeted backend (new + CAP-02 + frozen T11) | **160 / 160** |
| Migration-integrity test | 27 / 27 |
| Wider regression (24 `trade-os-*` + 76 `diaspora-*` files + new) | **2,129 tests · 2,121 pass · 7 skipped · 1 fail** — the same pre-existing time-bomb fixture in a T3 test, reproduced on the untouched tree in CAP-02 |
| Web (60 new/updated tests; affected 36 files) | **504 / 504**; mutation **9 / 9 killed** (one fixed: an MMSI-without-IMO case so "IMO null" cannot hide) |
| Type-check / lint / build | exit 0 / exit 0 (shared hook's lint count unchanged at 1) / exit 0 |
| Browser check | page loaded in Chromium at 1280 and 390 against a **stubbed API with a synthetic two-leg fixture**; no page-level horizontal scroll |

Staging facts that grounded the design (read-only): foreign-key types match the real schema (`tenants.id`
and `diaspora_shipments.id` are `uuid`, `users.id` is `text`); none of the new objects exist there yet;
the audit table's `action`/`resource_type` are unconstrained text, so the new audit actions are safe.

## 4. What this does **not** prove

- **The migration has not been applied to staging**, so nothing here is verified against the live
  database beyond type compatibility. Applying it belongs to the staging-convergence step and has to
  follow how this repository actually migrates staging.
- **No real vessel has been entered.** The real journey's single leg (a Hoegh vessel from Shimonoseki to
  Dar es Salaam) is held with the rest of the real data on D4. Nothing was invented to demonstrate the UI.
- **There is no operator screen for entering legs** — only the API. Entering one through the existing
  operator workspace would modify frozen T11.2 UI.
- **Multi-leg is capability, not evidence.** Two-leg behaviour is proven by tests and a synthetic fixture
  only; no real transshipment has been observed anywhere.
- **ETA history is not solved here.** A correction to a leg's estimate is attributed with before and
  after in the **audit trail**, but there is no queryable revision history yet — that is CAP-05.
- The full-chain migration claim is **not** made: `migration_pglite_check.mjs` covers other tables, and
  each Trade OS unit has its own check.

## 5. Observations on existing code (not changed)

- T11's own DB check does not emulate Supabase's default privileges, so its `REVOKE` is untestable in the
  same way mine was before I fixed it. Recorded, not touched (frozen).
- The legs read adds **one** query to the Journey and does not grow with the timeline or the leg count
  (asserted by test).

## 6. Next

CAP-05 — the observation layer and ETA history (additive migration). The real-data end remains held on D4.
