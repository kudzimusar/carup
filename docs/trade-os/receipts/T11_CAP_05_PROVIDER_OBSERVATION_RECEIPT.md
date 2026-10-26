# T11-CAP-05 — Provider observation layer and estimate history · Receipt

**Specialist gate: `SPECIALIST GATE PASSED`** at unit, real-Postgres (PGlite) and stubbed-browser level.
Recommendation: `RECOMMEND ACCEPT — T11-CAP-05`, subject to the design decision in §1. The Moderator holds
acceptance.

`PROVIDER INTEGRATION PENDING EXTERNAL AUTHORITY` — **no carrier, AIS or other live provider is integrated**,
and none was faked. The layer's contract exists and is tested; the only thing that can be ingested today
is an authorised operator's own declaration.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Canonical role | `SHIPMENT OBSERVATION INTEGRATION SPECIALIST` |
| Builds on | CAP-04 (`1a88b3df`) |
| Frozen code modified | **none** (T11 shipment, timeline and tracking code untouched) |
| Schema | **one additive table**, `diaspora_shipment_observations` (migration `20260921090000`) |
| Staging / production | **migration NOT applied to staging**; production untouched |
| Real data | **no real estimate revision recorded** (held on D4) |

## 1. The design decision that shapes this unit

T11 has **no function that updates a shipment's estimated arrival.** So a revised estimate cannot be
"accepted into T11", and writing `estimated_arrival_date` from new code would bypass the shipment
authority this programme exists to protect. So the observation layer is the authority for **estimate
revisions only**, and the Journey shows the estimate as **two values, never merged**:

- `original` — the shipment record's own estimate (T11's, untouched);
- `current` — the latest **accepted** revision, shown beside it, with the full history and reasons.

`shipping.dates.estimated_arrival` stays exactly the shipment's value — a test deep-compares the Journey's
dates with T11's own participant projection — and nothing in this unit can write the shipment (a trap on
every write proves it). The cost is honest: there are two estimates on screen, labelled for what they are.

## 2. What was built

- **Migration** [20260921090000_trade_os_cap05_shipment_observations.sql](../../../database/migrations/20260921090000_trade_os_cap05_shipment_observations.sql):
  append-only evidence with a closed state machine — `RECEIVED → ACCEPTED → SUPERSEDED`, and
  `RECEIVED → REJECTED`. What was observed (provider, event id, kind, time, content, source) is immutable
  once recorded; only the decision about it can change, once. **Idempotency is a constraint**: one
  `(provider_id, provider_event_id)` can exist once. A decision must name who made it. An estimate
  revision must carry an estimate — **with `COALESCE`**, because `jsonb_typeof` of a *missing* key is NULL
  and a `CHECK` that evaluates to NULL passes; the unguarded version let a date-less revision through
  and the mutation test proved it. No deletes. `FORCE` RLS with `anon`/`authenticated` revoked.
  It has **no link to the movement timeline** and writes nothing to `diaspora_shipments`. `Down` included.
- **Write service** [diasporaShipmentObservationService.js](../../../backend/services/diaspora/diasporaShipmentObservationService.js):
  records an estimate revision. Authority is T11's own rule via the shared
  [shipmentWriteContext.js](../../../backend/services/diaspora/shipmentWriteContext.js) (extracted so the
  legs and observations services share one loader), checked first. **A caller cannot name the provider,
  the status, the decision or the kind** — unknown or non-assertable fields are refused. An authorised
  operator declaring their own shipment's estimate is accepted on arrival, attributed to them; an
  external provider's observation would arrive `RECEIVED`. A newer revision **supersedes** the older one,
  which stays in the history; a **backdated revision entered late is superseded on arrival** and can never
  become current. Replaying an event is idempotent; reusing its id for different content, or an id
  belonging to another shipment, is a **conflict that reveals nothing** about the other shipment.
  Validation: a readable estimate, not before the shipment's planned or observed departure, an
  observation not dated in the future, a bounded reason (blank means unknown).
- **Read module** [shipmentObservationRead.js](../../../backend/services/diaspora/shipmentObservationRead.js):
  `projectEta` — original, current, basis (`revision` / `shipment_record` / `none`), change in days
  (signed), revision count, and revisions oldest first with reasons. Never who decided, who recorded,
  an event id or a reference; a missing reason stays missing.
- **Routes** [diasporaShipmentObservationRoutes.js](../../../backend/routes/diasporaShipmentObservationRoutes.js):
  `GET` and `POST /shipments/:id/eta-revisions` only. **No PATCH, PUT or DELETE** — evidence is not
  editable — and a test asserts the production router has exactly those two routes.
- **Journey:** `shipping.eta` composed for the selected shipment; `not_applicable` where no shipment is
  shown (ambiguous, cargo not on it). Received/rejected observations, other kinds and other shipments'
  observations count for nothing. +1 query regardless of how many revisions exist.
- **Web:** the Arriving card shows the **current** estimate (still "Not recorded as arrived"), a basis line
  ("Latest revised estimate" / "From the shipment record"), and an **Estimate history** card — current
  beside original, the signed move in plain words, each revision with when, by whom-by-kind, and why
  ("No reason was recorded." when none). Shown only when something was actually revised.
- **CI:** the DB check is wired in beside T10/T11/T12/CAP-04 (the workflow parses; the step is in `validate`).

## 3. Evidence

| Check | Result |
|---|---|
| Real-Postgres check (PGlite) | **39 / 39**, timezone-independent (Tokyo, Los Angeles, UTC) |
| Migration mutation test | **13 / 13 killed** for the right reason — including the NULL-passes `CHECK`. Two needed fixing first: a fixture that depended on the machine's timezone, and M13 ("observation wired to the timeline") which only *crashed* until the fixture had a timeline table |
| Observation service tests | **27 / 27**; mutation **17 / 17 killed** |
| Observation route tests (real Express) | **10 / 10**; mutation **4 / 4 killed** (DELETE added, PATCH added, auth removed, unmounted) |
| Journey + estimate tests | **61 / 61**; mutation **9 / 9 killed** |
| Targeted backend (new + CAP-02 + CAP-04 + frozen T11) | **209 / 209** |
| Migration-integrity test | 27 / 27 |
| Wider regression (24 `trade-os-*` + 76 `diaspora-*` files + new) | **2,178 tests · 2,170 pass · 7 skipped · 1 fail** — the same pre-existing time-bomb fixture in a T3 test |
| Web (74 new/updated tests; affected 36 files) | **518 / 518**; mutation **11 / 11 killed** (one fixed: swapping the current and original *values* had survived because the test only checked the labels) |
| Type-check / lint / build | exit 0 / exit 0 (shared hook's lint count unchanged at 1) / exit 0 |
| Browser check | Chromium at 1280 and 390 against a **stubbed API with a synthetic fixture**; no page-level horizontal scroll |

## 4. What this does **not** prove

- **The migration has not been applied to staging**, so nothing here is verified against the live database.
- **No provider is integrated.** `RECEIVED` and `REJECTED` — and the other observation kinds (vessel identity,
  schedule, port event, position, exception) — exist as the **contract** for a future provider and are
  proven at the database level, but **no code path creates or consumes them yet**. Only `ETA_REVISION` from
  an authorised operator does anything.
- **No real estimate revision exists.** The real journey's ETA history, if any, is held with the rest of the
  real data on D4. No revision, reason or date was invented.
- **There is no operator screen** for recording a revision — only the API.
- **"Accepted on arrival" for an authorised operator is a policy choice**, not a requirement from CAP
  evidence: an authorised operator is the authority for their own shipment's estimate, and a second
  approval step would be friction without a second person. External providers will not get that treatment.
- **Alerts on an estimate change are CAP-08**; this unit records the change and the reason, it does not
  tell anyone.

## 5. Next

CAP-06 (documents and next actions composed from T8 and T7) and CAP-07 (destination and customs composed from
T12). Both are compositions: no new tables.
