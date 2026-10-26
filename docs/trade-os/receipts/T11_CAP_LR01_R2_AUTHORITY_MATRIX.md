# T11-CAP-LR01-R2 — Step B · Authority inventory (REUSE / EXTEND / NEW)

**Written for:** the Moderator. Controlling authority: [T11_CAP_LR01_R2_CARUP_CAP_PRODUCT_AUTHORITY.md](../T11_CAP_LR01_R2_CARUP_CAP_PRODUCT_AUTHORITY.md) §8.
**Starting product SHA:** `304607ea4093af09b8a8cb5fe3223a64f0e7a545` · **Trade OS parent:** `577428decfea6beb98e88aa8132a8a8419e3349e` (unchanged).
**Production Supabase `vhmnajoeicasaigiophh`: not accessed.** Staging `eoyenigwevnxwwhyhaer` was read through the read-only staging MCP only; nothing was written for this step.

## 0. How this was produced

Not from assumption. Each row below was checked against (a) the **live staging schema** (`information_schema`, `pg_constraint`, `pg_trigger`, `storage.buckets`),
(b) the **repository at the starting SHA** (`git grep`, the services that own each authority), and (c) the **already-authorised CAP-00 evidence**
(the private bundle, read once, not re-captured and not re-fetched from the external site).

## 1. The matrix

| # | CAP capability | Current authority | Verdict | Evidence | Proposed action |
|---|---|---|---|---|---|
| 1 | Vehicle identity | `vehicles` (`vin`, `make`, `model`, `year`, `chassis_number`, `engine_number`) · Vezel row `RU3-1316558` exists | **REUSE** | `information_schema.columns`; R1 seed row (chassis-as-vin convention, acceptance-matrix row 24) | Keep. **EXTEND the identifier validators** (§16): the rule is duplicated in 5 places and floors at 12 characters, so the Vezel's real 11-character frame number is refused by the Seller flow. |
| 2 | Vehicle specifications | `vehicles`: `trim` (grade), `color`, `mileage`, `fuel_type`, `drivetrain`, `transmission`, `engine_number`, `chassis_number`, `year`, `make`, `model` → **11 of the 19 §13 facts live in `vehicles`**, and a 12th (the external reference `CD740269`) in the order's metadata. **7 have no home**: model code, registration year/month, manufacture year/month, engine size, steering, seats, doors — plus the source's equipment list and the raw `Hybrid(Petrol)` wording, which §13 does not list but the source states. | **REUSE** (12) + **NEW** (the rest) | `vehicles` has no JSON/metadata column. `vehicle_taxonomy_observations` normalises 8 taxonomy dimensions only. `vehicle_document_extractions` compares fields read off *reviewed documents* (0 rows for this VIN). `diaspora_trade_fact_observations` is a uuid-keyed Intake 2.0 measurement ledger. | **NEW `vehicle_specification_observations`** — one narrow, provenance-carrying observation per spec fact, with a controlled key list. Nothing hard-coded in React. Canonical columns stay the authority for what they already hold. |
| 3 | Vehicle media | `vehicle_evidence` (50 photos + 3 documents; **private** bucket `ocr-documents`; `pending`; `private`) · `listing_images` (public marketing URLs; **0 rows** for the Vezel) · `vehicleMediaProjection` (#164 contract) | **EXTEND** + **NEW** | The #164 contract fixes two *disjoint* blocks — listing media (never signed, "commercial media") and verified evidence — and states a listing photo and an evidence artifact must never be conflated. `GET /api/vehicles/me` builds the owner's media from `listing_images` only ("an owner may not know less true media than an anonymous buyer"). `vehicle-images` is the only public bucket. | **NEW `vehicle_media_references`** (a governed *reference* to an existing evidence asset: position, primary, label, provenance) + a **third, disjoint, owner-authorised media block** served with short-lived signed URLs using the existing `generateSecureReadUrl`. **No binary copied. No `listing_images` row written for evidence.** See §3 D-1. |
| 4 | Import / purchase transaction | `diaspora_import_orders` (T4) · order `3e2b66a0…` exists, `DOCUMENTS_PENDING` | **REUSE** | R1 seed; status moved by the product's own first-document transition | Keep. **Purchase price: not recorded** — `budget_*` is a request budget and `vehicles.price = 0 / currency NULL` is the schema placeholder. **Fix the owner surfaces** that print it as `$0` (`statedPrice` in My Garage and Vehicle Profile); the passport already requires amount **and** currency. |
| 5 | Consignee | T4 intake columns `consignee_kind/name/phone`, `delivery_address` (all NULL for this order) · Journey `contacts.consignee` | **REUSE** (intake) + **NEW** (as declared on the paperwork) | The intake fields record what a customer *asked for*; the source records who the *paperwork names*, spelled differently from the account. | Declared consignee stored as a party row with provenance (§3 D-3). The canonical account identity (`u_66cace85fad949e4`, *Kingston Musarurwa*) is **never** overwritten. |
| 6 | Notify party | **None.** | **NEW** | `git grep -i "notify[_ -]?party"` over `backend database shared web/src` → **0 hits**. Order participant roles are `buyer, seller, exporter, agent, dealer, company, coordinator, customs_reviewer` (authority-bearing, not declared text). | **NEW `diaspora_order_parties`**, role `NOTIFY_PARTY`. |
| 7 | Document delivery (where originals are sent) | **None.** | **NEW** | same table as #6 | `diaspora_order_parties`, roles `DOCUMENT_DELIVERY`, `DOCUMENT_CENTRE`. |
| 8 | Booking | T5 `diaspora_cargo_reservations` (**container** cargo — does not apply to a RoRo vehicle) · `diaspora_shipments.status = BOOKED` | **REUSE** (native) | Vezel shipment is `PLANNED`; the source reports 7 booking-stage actions | CarUp-native booking stays in T5/T11. The 7 reported actions go to the progress ledger (#9). |
| 9 | Customer progress | **None.** | **NEW** | Independently confirmed absent: `diaspora_shipment_stage_events` = movement only; `diaspora_import_audit_log` = CarUp-internal audit; `diaspora_trade_fact_observations` = measurements; `vehicle_import_records` = ZIMRA ownership hand-off; `evidence_provenance_events` = per-file chain. None carries actor + ordered action + reported status per customer stage. | **NEW `diaspora_external_progress_entries`** — externally *reported* progress only (the doc's §10). Native progress is **composed** from the owning authorities, never stored twice (§4). |
| 10 | Shipment | T11 `diaspora_shipments` · `f8cb8f50…` `PLANNED` | **REUSE** | R1 seed | Keep. |
| 11–16 | Carrier · Vessel · Loading port · ETD · Discharge port · ETA | `diaspora_shipments` (`carrier_name`, `origin_port`, `destination_port`, `estimated_arrival_date`, `metadata.planned_departure_date`) + `diaspora_shipment_legs` (`vessel_name`, `port_of_loading`, `port_of_discharge`, `planned_departure_date`, `estimated_arrival_date`) | **REUSE** | Hoegh Autoliners K.K. · HOEGH TRACER (V-61) · Shimonoseki, Japan · 2026-08-29 (plan) · Dar es Salaam · 2026-09-18 (estimate); no IMO / MMSI / voyage / container | Keep exactly. Date semantics preserved (plan ≠ observation; ETA ≠ arrival). |
| 17 | Observed movement | T11 stage events / observations · T10 loads | **REUSE** | 1 stage event (`PLANNED` creation); 0 observations | Nothing added. *"Departure — Completed"* is a **reported** progress entry, **not** a T11 movement fact (§10, §12). |
| 18–20 | Bill of Lading · Export Certificate · Invoice | T8 `diaspora_trade_documents` — 3 rows, `UPLOADED`, private `storage_path`, no OCR, no verification · plus 3 copies in passport evidence | **REUSE** + **EXTEND** | `getTradeDocument` **redacts** `storage_path`; the only signed URL minted for T8 is server-side for OCR. **There is no customer view/download route.** | **EXTEND T8** with one governed access route (same read predicate as `getTradeDocument`, short-lived signed URL, audited), and let the Journey forward the document id to the **owner only**. No CAP document rows. Document presence is not shown as verification. |
| 21–22 | Document dispatch · Document tracking | **None.** | **NEW** | `git grep -i "courier\|document[_ -]?dispatch\|awb\|envelope"` (excluding HTTP `rawBody`/event-envelope hits) → **0 relevant hits**. `diaspora_shipments.tracking_number` is the *cargo* reference. | **NEW `diaspora_document_dispatches`**. The source states *"Arrived at delivery address"* in the tracking-number field — recorded verbatim as the reported status; **no tracking number or courier is invented**. |
| 23–26 | Clearing · Customs · Collection · Delivery | T12 `diaspora_customs_cases / _events / _agent_appointments` (event types include `COLLECTION_OBSERVED`, `DELIVERY_OBSERVED`; `CARUP_OBSERVED` vs `ATTRIBUTED`) | **REUSE** (read-only) | 0 cases for this order | **No T12 case is created.** The source's *Clearing & Delivery — Completed* is a reported ledger group, labelled as such, and stays distinguishable from any CarUp-observed customs event. |
| 27 | Payment | `diaspora_payment_milestones` (T4) · Journey currently says "not yet composed (T13)" | **REUSE** + **EXTEND** (compositor) | 0 milestones for this order | Compose **read-only**; with none, say "No payment is recorded for this purchase." Nothing manufactured; nothing inferred from documents or ownership. |
| 28 | Messages | T7 `message_threads` (`subject_type/subject_id`) + `messages` | **REUSE** | 0 threads for this order | Compose where real; with none, say so. No second messaging system. |
| 29 | Notifications | T7 `notification_queue` + R1's Journey alerts | **REUSE** | — | Keep. |
| 30 | Important update | **None as such** | **COMPOSE** | The source's operator message accompanies the dispatch status | A read-model composition of the latest *real* record (dispatch status/message first). Stores nothing. |
| 31 | Destination · Agent | T4 `destination_*`, `clearing_agent_*` · T12 appointments | **REUSE** | Source: *Destination* "-" (blank), *Agent* "BFT (DOCUMENT)" | Destination stays **Not recorded** (the order's `Zimbabwe` is a schema default, not a stated destination). The source's agent is stored as a **reported** party (`DESTINATION_AGENT`) and is **not** presented as a T12-appointed clearing agent. |

## 2. What the inventory changed about the plan

The directive presumed **one** missing capability (historical progress). Independent verification finds **five** pieces of genuinely missing persistence — each tied to a §23 section, each with no
existing home:

| New object | §23 section it serves | Why nothing existing fits |
|---|---|---|
| `diaspora_external_progress_entries` | 8 Progress | #9 above |
| `diaspora_order_parties` | 3 Consignee / Notify · 4 Document delivery · 7 Destination / Agent | #5–7, #31; no JSON blob (Intake 2.0's own rule: validated and privacy-gated facts get structured columns) |
| `diaspora_document_dispatches` | 1 Important update · 4 Document delivery / tracking | #21–22 |
| `vehicle_specification_observations` | 2 Purchased vehicle (complete specifications) | #2 |
| `vehicle_media_references` | 2 Purchased vehicle (hero + gallery) | #3 |

All five are **additive**, reversible, forced-RLS with no browser grants (the pattern R1's tables use), idempotent on a natural key, and carry the same provenance block
(`source_system`, `source_reference`, `observed_at`, `imported_at`, `verification_status`, `ingestion_run`, supporting-evidence digest).

## 3. Decisions taken where the authority document leaves room — for the Moderator to confirm or overrule

- **D-1 Media is a reference, not a copy and not a listing row.** §15 says "canonical vehicle media references" and "avoid unnecessary binary duplication". The #164 contract (marked *final*, with tests) forbids
  conflating listing photos and evidence, and its listing block is *never signed*. Writing 50 `listing_images` rows would either publish private files, or point a public gallery at private objects that cannot render. So:
  references point at the existing evidence assets; the owner / tenant / admin / government get a **third, key-disjoint block** with short-lived signed URLs (the same predicate and the same minting function the
  evidence route already uses); the public passport gets **nothing** — not even a count. `Pending Review` governs verification and publication; it does not hide the owner's photos. Publication to the marketplace remains a
  separate act that copies to the public bucket and writes `listing_images`; R2 does not do it.
- **D-2 Evidence rows are not edited.** The 53 R1 evidence rows have null `source_*` columns and a `captured_at` equal to the import time (the schema makes it NOT NULL; the source supplied no capture time). They are
  immutable proof; provenance is carried by the new rows. **`captured_at` will not be shown as a photo date.**
- **D-3 The declared consignee is a party row, not an overwrite of the T4 intake fields.** Intake records what a customer asked for; paperwork records who is named. The compositor shows the declared party when one exists
  and labels an intake-only consignee as "requested".
- **D-4 Gallery order is derived and says so.** The R1 import code (read back from the R1 session) iterated the source page's images in DOM order, uploading the first image, then batch windows `[0,9)`, `[9,21)`, `[21,33)`, `[33,60)` of the
  remainder in increasing order, naming each file with its 1-based position; the 50 evidence rows have 50 distinct upload instants. Position = rank by `uploaded_at`, recorded with `ordinal_basis = SOURCE_GALLERY_ORDER`. This is an
  inference from the import sequence (the original filename is not stored on the row), and it is labelled as one. Position 1 is primary with `primary_basis = SOURCE_FIRST_IMAGE`, because primacy must be a stated choice, never an election by the projection.
- **D-5 Third-party individuals are not stored.** The source names a staff operator by first name beside the tracking message; only the role is kept. Business contact details of the notify party and document centre are stored; the
  consignee's own details are stored as `PRIVATE` and are visible only to the order owner and platform admins, exactly as the existing consignee rule.
- **D-6 The owner price rule joins the passport's.** A price is an amount **and** a currency; otherwise "Price not recorded".

## 4. One CAP, two origins (§5, §22, §32)

The Progress section reads **two** sources into one shape. `origin = external_report` rows come from the new ledger. `origin = carup` rows are **derived at read time** from the authorities that already own the fact —
Booking ← T5 reservation / T11 `BOOKED` and a declared leg; Departure ← T10 load confirmation and T11 *observed* departure; B/L ← the T8 document and its verification; Dispatch ← `diaspora_document_dispatches`;
Clearing & Delivery ← T12 events. Nothing is stored twice, so a CarUp-native shipment needs no second architecture and the two cannot disagree. Tests will exercise a native-only fixture through the same function.

## 5. What R2 will deliberately **not** do

No T11 movement event, status change or date for any historical row · no T12 case · no payment, price or currency · no message thread · no edit to an R1 evidence row · no `listing_images` row for evidence · no copy of a binary ·
no change to T3 or to branch governance (the two inherited CI reds) · no Production access · no external-site access of any kind (the CAP token is not used and not held).

## 6. Plan and commit sequence

C migration + PGlite proof → D idempotent ingestion script (staging only, INSERT-only, conflict-detecting, rollback documented) → E canonical Vezel convergence → F media references + projection →
G compositor → H T8 access route → I CAP UI → J responsive/accessibility → K regression → L exact-head deploy → M physical UAT. The identifier-rule fix (§16) and the owner price rule are independent and land early.
