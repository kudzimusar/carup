# Trade OS — Comprehensive Intake 2.0

**Starting SHA:** `86006034` (T4-USABLE, frozen `736f06c5`)
**Final code SHA:** `c4bb5425` · Branch `feat/trade-os-client-demo-convergence` · Draft PR #207
**Production touched:** NO · **T5 started:** NO

Governing contract: master plan **§36 — Trade OS Transaction Intake Contract**.

---

## 1. What was audited before anything was designed

| Concern | Authority found | Decision |
|---|---|---|
| Procurement header | `diaspora_import_orders` | reuse + extend |
| Procurement detail | `diaspora_import_order_request_lines` — already `item_kind`, `part_number_known`, `condition_preference` | reuse + extend (a real line structure, not a blob) |
| RFQ intent | `diaspora_import_orders.metadata.rfq` | metadata already carried intake; the queryable/privacy-bearing parts move to columns |
| Logistics header/cargo | `diaspora_logistics_requests` / `_items`, incl. **`measurement_basis`** | reuse; `measurement_basis` is the existing provenance seed |
| Supplier visibility | `projectRfqForMarketplace`, `projectRequestLineForMarketplace`, `projectLogisticsRequestForMarketplace` | documented **allow-lists** — extend the same way, never return a raw row |
| Vehicle identity | canonical Passport + `resolveVehicleObjectAuthority` | reuse; a VIN is linked through authority, never free text |
| Documents / Communications | `diaspora_trade_documents`, `ensureReferenceFlow` | readiness only; no second inbox |

**No new transaction authority.** The only new table is an observation ledger that owns no identity,
status or lifecycle.

## 2. Persistence decisions

**Structured columns** for every fact that is validated, matched, queried or privacy-gated —
procurement header (outcome, budget meaning + disclosure, four intentions, timing windows, requested
quote scope, alternatives policy), procurement lines (steering, drivetrain, transmission, fuel, body,
mileage ceiling, seats, colour, trim, generation, engine range, auction grade, accident/rust
tolerance, intended use, alternative models, part side/origin/brand), logistics header (pickup, site
type, outcome, objective, timing) and cargo items (packaging, nature, value, handling flags, content
declarations, running/keys/export state).

**Not metadata**, and the reason is concrete: a JSON blob cannot be CHECK-constrained, cannot be
indexed for matching, cannot be partially projected to a supplier, and would leave every later phase
re-reading a blob and inventing its own interpretation of it.

**The one new authority — `diaspora_trade_fact_observations`** — is append-only by policy. A
customer's *"about 400 kg"* and a warehouse scale's *"437 kg"* are two observations of one thing, and
a `(value, provenance)` column pair cannot hold both. T9 will INSERT a measurement, never UPDATE the
estimate. RLS enabled + forced, named revokes from `anon`/`authenticated`, service_role only.

## 3. Provenance

`CUSTOMER_STATED · CUSTOMER_ESTIMATED · CARUP_CALCULATED · PROVIDER_STATED · WAREHOUSE_MEASURED ·
CARRIER_STATED · DOCUMENT_DERIVED · VERIFIED`

A customer-facing caller may assert **only** the first two. Marking anything `VERIFIED`, or speaking
as a warehouse, carrier, provider or document, is refused — the authority flag is set by the service
that owns the measuring capability, never by request input. `currentFact` returns the value **with**
its provenance and superseded history; there is deliberately no accessor that returns a bare number,
so a screen cannot render an estimate as though someone had weighed it.

`canActAsAuthority` is narrow on purpose: platform admin/reviewer only, because warehouse, carrier
and inspection authorities do not exist yet (T9/T11/T12). Pre-authorising roles with no capability
behind them would be exactly the kind of fiction this contract forbids.

## 4. Privacy

Both marketplace projections gain the new intake **strictly through enumerated allow-lists**, so a
column added to the schema is invisible to suppliers until someone names it on purpose.

Deliberately excluded: delivery area, consignee kind, budget basis/maximum/flexibility, payment,
clearing, insurance and inspection intent, declared cargo value, export clearance state, every
locating field, VIN/chassis/lot, internal ids and raw metadata. Declared cargo **value** is excluded
because it is commercial and useful to a thief; **export clearance state** because it is operational
readiness released to an engaged counterparty, not to a browser.

Proven at runtime, not by inspection: a test populates every private field with a distinctive
sentinel and asserts none appears in the projected payload — a leak shows up as the sentinel rather
than as a field name someone remembered to check.

## 5. Progressive disclosure

All capabilities exist; they are not all shown. The four-step path is unchanged — *"find me an
Alphard and get it to Harare"* still publishes without opening anything — and the depth sits behind
three optional sections. Verified on the deployed build: **the steering control is not visible until
the section is opened.**

Every select's blank option reads *"No preference / not sure"* and is a real answer. The disclosure
label reads *"Optional — it may help suppliers quote more accurately"*, never *"incomplete"*.

## 6. Evidence

**Local:** intake contract suite **17/17** · T4 passport **32/32** · T3 logistics **12/12** ·
existing adversarial projection suites **27/27** unchanged · migration integrity **27/27** ·
real-Postgres intake gate **20/20** · real-Postgres T4 gate **11/11** · web **1572/1572** ·
tsc clean · lint NET_NEW **0/0** · build ✓.

**Staging (FE `index-Cy1R0_rM.js` / BE `c4bb5425`, paired):**

- comprehensive request persisted **all 17 header facts + the quote-component array in columns**,
  and all line preferences (`rhd`, `automatic`, `4wd_awd`, 80000, `none`, `personal_family`,
  `["Toyota Vellfire"]`) — with an unstated preference still `null`;
- an invented `destination_outcome` was **refused 400**, not stored;
- **T4 reuse**: the continuation inherited `door_delivery`, `lowest_cost`, all three timing fields,
  the route and the cargo identity, while `measurement_basis` stayed `UNKNOWN`, volume and weight
  `null`, and running/export state `unknown`;
- **private commercial intent did NOT cross** to the logistics authority: budget maximum, budget
  basis, payment intent, clearing intent and delivery area all absent;
- form UAT: deep detail hidden by default, available when opened, Request Brief showing only
  answered questions, privacy preview intact, **7/7 widths clean, 0 console errors, 0 5xx**.

### A defect the deployed journey caught that no local suite could

A comprehensive request persisted every header fact and **every vehicle preference as null**. The
normalizer was correct, the columns were correct, and `replaceRequestLines` never called it — so
steering, drivetrain, mileage ceiling, accident tolerance and intended use died silently between the
form and the database, which is precisely what Intake 2.0 exists to prevent. Fixed in `c4bb5425`;
the regression test drives the **real write path**, because a test that exercised only the
normalizer would have stayed green through it. Same class as T4's cargo line: a module being correct
is not the same as a module being wired.

## 7. Known limitations and deferred work

- **Supplier-side projection not walkable on staging.** `/diaspora/rfqs` needs governed `dealer`
  authority; the available fixture is `owner` and public registration correctly refuses to grant it.
  The allow-list is proven by the sentinel test instead. Needs a governed supplier tenant fixture.
- **Pickup contact/address, consignee contact, clearing-agent contact and document upload** are
  contracted (§36.6) but not yet surfaced in the form — they are PRIVATE-class fields whose UI
  belongs with the pickup and documents work (**T8**).
- **Logistics-side intake UI** (cargo declarations, running state, pickup) is persisted and
  projected but the T3 wizard has not yet been expanded to collect it.
- **Managed Import** is captured as an intent (`intake_intent`) and its facts are carried; the
  decomposition into sub-journeys remains later-phase.
- **No rates, no landed cost** — T6 owns pricing. Intake records only what the number *means*.

## 8. Standing gap, carried not lost

**A procurement-linked live logistics request still cannot be cancelled or closed through the
product** (§35, §36.10). Not Intake 2.0's to fix. **Required before production readiness**, owned by
logistics request-lifecycle work.

## 9. Status

**INTAKE-2.0-PARTIAL.** The contract, persistence, provenance, privacy, adaptive forms, review brief
and T4 reuse are implemented and certified on a deployed pair. It is PARTIAL because the logistics
intake UI and the PRIVATE-class contact/document fields are contracted but not yet surfaced, and
because supplier-side projection lacks a governed fixture to walk.

**Owner UAT required: YES.** T3 frozen. T4 frozen at `736f06c5`. Production untouched. T5 not started.
