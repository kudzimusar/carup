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

## 7. Final closure cycle (`be432647`)

### 7.1 The interpretation that was corrected

PRIVATE never meant *"do not collect until a later phase"*. It means **collect where the journey
needs it, and do not expose it outside the authorized context**. A shipper who asks for pickup must
be able to say where and who to call, or the request cannot be served.

Now collected, and every one named in `NEVER_MARKETPLACE_VISIBLE`: pickup address, contact name and
phone, access notes, available-from, loading equipment; delivery address, contact name and phone,
unloading requirement; consignee name and phone; clearing-agent name, country and contact; cargo
current location and accompanying goods; preferred language and contact channel.

**Certified on staging:** a logistics request carrying thirteen private sentinels was published, and
the provider projection leaked **none** of them — while the five facts a provider needs to decide
(`non_running`, `batteries`, `oversized`, `used`, destination) all crossed.

### 7.2 Logistics intake

Persisted and read back on staging: `pickup_required`, `origin_site_type`, loading equipment,
`unloading_required`, `destination_outcome`, `shipping_objective`, `service_mode_preference`,
inspection / insurance / clearing intent, contact channel, timing window — plus cargo
`packaging_type`, `goods_nature`, `handling_flags`, `content_declarations`,
`vehicle_running_state`, `vehicle_keys_state`, `export_clearance_state`, `inspection_state`,
`accompanying_parts`, `current_location`, `declared_value`, with `measurement_basis` deriving
`PROVIDED` from a stated volume.

### 7.3 Document readiness — surfaced, and honest

`POST/GET /diaspora/{import-orders|logistics-requests}/:id/document-readiness`.

Staging: 201, every row `verified=false` / `source=CUSTOMER_STATED`; **no percentage and no
completeness flag** because the required set is unknown and a denominator would invent a claim; the
payload carries the sentence *"These are the customer's own answers. CarUp has not seen or checked
any document."*; `verified` is refused as a readiness state; re-answering corrects rather than
duplicating. **No T8 functionality was added** — no file is stored and nothing is classified.

### 7.4 Governed supplier fixture

`/diaspora/rfqs` requires the governed `dealer` role and public registration correctly refuses to
grant it. **That control was not weakened.** The fixture is defined in the existing
`scripts/provision-staging-qa-accounts.mjs`, which already refuses the production ref, reads
passwords from the environment and hashes them with the real login scheme — run-scoped via
`TRADEOS_SUPPLIER_RUN_TAG`, unmistakably synthetic, and pinned by a test asserting **exactly one**
dealer so provisioning cannot quietly mint privileged accounts.

The script's own pg path could not run here (the stored staging database password is stale — an
operator credential issue, not a design one), so the account was provisioned through the approved
staging authority with a hash generated by the same `hashPassword` the script uses. No credential
was committed.

### 7.5 Supplier journey, walked

buyer publishes → **supplier sees the opportunity (200)** → opens detail (200) → submits an offer
(201, `ISSUED`) → buyer compares (identity + amount) → **buyer awards (200)** → T4 continuation
(201) inheriting `door_delivery`, `lowest_cost` and the cargo identity, with measurements still
`UNKNOWN` and no private commercial fact crossing.

Projection at that boundary: **0 of 12 private sentinels crossed** (delivery area and address,
consignee name and phone, clearing agent and contact, undisclosed budget, budget maximum, payment
intent, buyer id, language, channel) while **10 of 10** quote-relevant facts did.

### 7.6 A real defect the supplier journey exposed

**The buyer could see a supplier's DRAFT offer, including its amount.** `createQuote` already
documented the intent — *"A DRAFT is private to the supplier — only a real submission is news for
the buyer"* — and T3 already filtered drafts, but T2's read returned every row. Drafts are now
withheld from the buyer entirely; a supplier still sees their own, and privileged readers see
everything.

The pre-existing assertion accepted the draft row as long as its identity was stripped. It has been
**strengthened deliberately**, because the row still carried the price.

### 7.7 Gates at closure

Intake **25/25** · T4 **32/32** · T3 **12/12** · adversarial projections **27/27** ·
provisioning **10/11** (the one failure connects to a real database and fails on the stale staging
password; pre-existing and green in CI) · migration integrity **27/27** · real-Postgres intake
**20/20** · real-Postgres T4 **11/11** · tsc clean · lint NET_NEW **0/0** · build ✓.

Form UAT (earlier build, unchanged by this cycle): deep detail hidden until opened, Request Brief
answered-only, privacy preview intact, **7/7 widths, 0 console errors, 0 5xx**.

### 7.8 Three wiring gaps, one lesson

This cycle found its third instance of the same class: `normalizeLineIntake` written but never
called, and the readiness service implemented but unreachable (404 on staging). Both were found by
walking the deployed product, not by a unit test. **A module being correct is not the same as a
module being wired** — route mounting is now verified by enumerating the live Express stack.

## 8. Known limitations

- ~~**Logistics intake UI** surfaces only part of the fields~~ — **CLOSED** (`fb3acc16`). The T3
  wizard now carries the full adaptive intake, proven across nine scenarios.
- ~~**Supplier UI walked through the API, not the browser**~~ — **CLOSED** (`c84ac9b5`), and the
  browser walk immediately found what the API walk structurally could not: see §11.
- **Document readiness has no upload.** Deliberate — T8 owns files.
- **Managed import** is a usable intent with its facts carried; decomposition stays later-phase.
- **Provenance ledger is written by services, not yet by a customer-facing screen.**
- Rates and landed cost remain **T6**.

## 9. Standing gap, still carried

**A procurement-linked live logistics request cannot be cancelled or closed through the product**
(§35, §36.10). Not Intake 2.0's. **Required before production readiness.**

## 10. Status

**INTAKE-2.0-PARTIAL — remaining for OWNER PRODUCT / VISUAL UAT**, plus the limitations named in §8.
T3 frozen. T4 frozen at `736f06c5`. Production untouched. T5 not started.

## 11. Last technical closure — what the browser found that the API could not

Candidate **`c84ac9b5`**. Master plan §39 carries the full account.

§7.8 recorded three wiring gaps and drew the lesson that *a module being correct is not the same as
a module being wired*. Walking the counterparty screens in a browser — which §8 had listed as
outstanding — found the fourth and largest instance of exactly that.

**The payload was right; the screen was empty.** Every richer answer the buyer gave was allow-listed
and published by `projectRfqForMarketplace()`. Asserting on that payload passed, and had passed all
along. The supplier's card rendered a title, a route, a needed-by and a budget line, and dropped the
rest. The provider's card showed route, volume and weight but not whether the vehicle runs, whether
the keys exist, or what was declared inside it — the facts that decide a logistics price.

Both briefs now render, in the **reader's** voice rather than the customer's, with declarations
shown as customer statements ("confirm before carriage") and unanswered questions omitted rather
than printed as a wall. The logistics projection was widened through a **named** allow-list so the
*shape* of the job crosses while the *address it happens at* does not.

**The guards were the fourth gap too.** They enumerated the allow-lists by hand, so a new allow-list
was covered by nothing. They now discover every `MARKETPLACE_SAFE_*` export, and a test asserts the
discovery actually finds something.

**Proven in the browser** (staging FE `index-B1QVphEW.js`, BE `c84ac9b5`): supplier and provider
walks complete through submit; buyer **awards** (`Supplier selected` / `Accepted`); requester
compares the provider offer; **0** private sentinels leaked on either counterparty screen; **0** raw
enums, UUIDs or internal field names; **28/28** seven-width geometry checks with no overflow; **0**
console errors on a settled page and **0** 5xx across every walk. CI green at `c84ac9b5` — 7 gates,
all steps executed.

**Method note.** `tsc -p web/tsconfig.json` checks nothing (`files: []` with references) and
reported "clean" on code with real type errors; `tsc -b` is the gate, verified by deliberately
breaking a file first. **A gate is not a gate until you have watched it fail.**

**Two findings recorded, not fixed** — beyond this closure's scope, neither blocking:

1. *(MISSING CAPABILITY)* The requester's own shipping list reads "Waiting for offers" while a
   submitted offer waits; the list payload carries no `quote_count`. The supplier's equivalent list
   *does* show "1 offer sent".
2. *(UX-DESIGN)* The requester's read-only detail does not echo their own private answers (pickup
   address and contact); they are visible only by editing.
