# T11-CAP-LR01-R2 — specialist evidence return (CarUp CAP 1.0)

**Written for:** the Moderator, who decides whether R2 is accepted. It follows the order of the list in [the authority](../T11_CAP_LR01_R2_CARUP_CAP_PRODUCT_AUTHORITY.md) §33, one numbered section per item.
**Production Supabase `vhmnajoeicasaigiophh`: not accessed** — not queried, migrated, mutated, deployed to or tested against; no production MCP tool was called. The authorised staging project `eoyenigwevnxwwhyhaer` was written only by the certification-branch workflow below, and otherwise read through the read-only staging connection.
**Not self-accepted.** The recommendation is the last line of this document; the Moderator keeps acceptance.

## 0. The result in six sentences

1. The real customer (Kingston Musarurwa, `u_66cace85fad949e4`) opens **one CarUp page** and follows the real 2018 Honda Vezel `RU3-1316558` through the whole known journey — latest update, purchased vehicle with its 50 private photographs, consignee and notify party, document delivery, shipping, the three documents (view and download), destination and agent, the 14 reported progress steps in five groups, payments — in the order of §23.
2. Everything on that page is read from CarUp's own database. Five narrowly-scoped additive tables (one migration) hold what had no home; everything else reuses the authority that already owned it.
3. The sender's report is attributed to the sender, never shown as CarUp's observation: every reported step reads **Completed** with **no invented date**; the shipment is still *planned*, not departed, not arrived; price, tracking number, courier and payments are **Not recorded**.
4. Nothing depends on the external portal at runtime (proved four ways, §17), and a CarUp-native journey fills the **same structures** with no second architecture (§18).
5. The physical UAT, run as the customer in a visible Chromium at 390 / 768 / 1280 / 1920 px, found **two wording defects and one pre-existing side effect** (§16). Both defects are fixed, tested, mutation-tested and redeployed; the side effect is reported, not hidden.
6. Every red in the PR's own CI is inherited and independently reproduced on the PR's parent (§19); nothing R2 added is red.

## 1. SHAs, branch, PR state, ancestry

| | |
|---|---|
| **Starting product SHA** (R1's last commit, where R2 began) | `304607ea4093af09b8a8cb5fe3223a64f0e7a545` |
| PR #243's parent (Trade OS base) — unchanged by R2 | `577428decfea6beb98e88aa8132a8a8419e3349e` |
| **Final product CODE head** | `6c13fdc4481aec703b0b2189027143a8e3d1fe9d` |
| Above the code head | this packet only — a docs-only commit; no code, test, migration or workflow changes after `6c13fdc4` |
| **Deployed integration SHA** (where it differs) | `e28cbf25f05a76a05f3b41bacd95c586a36bb365` on `cert/t11-cap-lr01-r2-uat-candidate` |
| Branch | `feat/trade-os-t11-cap-lr01-journey-arrival` |
| PR | #243 · **OPEN · DRAFT · MERGEABLE** · base `feat/trade-os-client-demo-convergence` · **not merged, and will not be without the Owner's explicit authority** |
| Canonical staging (Garage `8353dbdd`) | **not mutated** — read at the end of the run: both canonical backend hosts still report `8353dbdd` (`dpl_76Zt2nhwLD7HDs94QfDBEuJxNxxH`), and both canonical web hosts' own provenance still says `8353dbdd` |

### Ancestry and inclusion proof (authority §26.3, §26.4, §26.6)

* `git merge-base --is-ancestor 6c13fdc4… e28cbf25…` → **yes**. The candidate is the R1 candidate `b1de0372` (runtime canonical `8353dbdd` + R1) plus a clean `--no-ff` merge of **each** R2 product head in turn; its first-parent history above `b1de0372` is exactly: merge of product `9dfdb5ec`, **one runtime adaptation (`d065047e`)**, then merges of product `23f0a5d8`, `40cb6c46`, `856eaa05`, `bd164d1e`, `6c13fdc4`.
* **Byte identity.** Of the 77 files the R2 range touched, **65 are byte-identical** (same git blob) in the candidate.
* **The 12 that differ** are files the runtime lineage also changed, so a 3-way merge produced a different blob. For 11 of them every one of the **270** non-blank lines R2 added is present in the candidate's file and no line R2 removed has come back (script run, 0 missing). The twelfth, `backend/services/marketplace/marketplaceClassificationRules.js`, is the single explained exception: on the runtime lineage that rule was moved into the one provenance authority (`services/provenance/recordProvenance.js`, PC01-K2B), so R2's six-line hunk there does not apply and is **superseded by the attributable runtime adaptation** `d065047e` (§15).
* The runtime backend served by the final Preview is **byte-identical** to the one UAT pass 1 ran against: `git diff 02507825…e28cbf25 -- backend ':!backend/scripts' ':!backend/tests'` is empty. The only deltas are a CI probe script (+ its test) and the two web files of §16.

## 2. Commit sequence (19 commits, R2 only)

| Commit | Subject |
|---|---|
| `aa73b059` | docs(trade-os): T11-CAP-LR01-R2 controlling product authority (as supplied by the Moderator) |
| `90f3aaeb` | docs(trade-os): T11-CAP-LR01-R2 step B — authority inventory (REUSE / EXTEND / NEW) |
| `1f447158` | feat(trade-os): T11-CAP-LR01-R2 step C — the five customer-journey authorities (additive migration + proof) |
| `c947a9c9` | fix(trade-os): T11-CAP-LR01-R2 §16 — a documented Japanese frame number shorter than 12 characters is a vehicle identifier |
| `b002cb0b` | feat(trade-os): T11-CAP-LR01-R2 step F (backend) — governed vehicle media, the third key-disjoint block |
| `2bec325e` | feat(trade-os): T11-CAP-LR01-R2 step D — idempotent, conflict-stopping historical ingestion + converge harness (staging only) |
| `471f7680` | feat(trade-os): T11-CAP-LR01-R2 step G — the customer's CAP composed into the existing read-only Journey (no new authority) |
| `0d566a04` | ci(trade-os): T11-CAP-LR01-R2 — keep the verbatim authority document byte-identical and still pass `git diff --check` |
| `8035f394` | feat(trade-os): T11-CAP-LR01-R2 step H (backend) — open one of MY documents: a short-lived, audited, owner-only view of a T8 file |
| `6c8f6421` | feat(trade-os): T11-CAP-LR01-R2 steps E+F (web) — the owner's private photographs on every owner surface; an unpriced record is not "$0" |
| `e33755e6` | feat(trade-os): T11-CAP-LR01-R2 steps H+I (web) — the customer's Car Arrival Progress page, in the customer's order |
| `9dfdb5ec` | test(trade-os): T11-CAP-LR01-R2 — CarUp's CAP does not depend on the external CAP (runtime-independence proofs) |
| `23f0a5d8` | test(trade-os): T11-CAP-LR01-R2 — register the two governed-media entitlement reads in the anonymous-vehicle-read guard |
| `b591ffc3` | docs+test(trade-os): T11-CAP-LR01-R2 — staging application and ingestion receipt; the independence scan is scoped to the CAP read path |
| `40cb6c46` | fix(trade-os): T11-CAP-LR01-R2 — a response that carries the owner's photograph links is never stored; two guards no longer assume one lineage |
| `856eaa05` | test(trade-os): T11-CAP-LR01-R2 — isolation probe for every surface R2 made private (journey, private gallery, document links, public passport, own list) |
| `bd164d1e` | test(web): T11-CAP-LR01-R2 — the owner passport test holds on lineages whose VehicleProfile also reads management scope and service history |
| `b998d311` | fix(trade-os): T11-CAP-LR01-R2 isolation probe — a restricted public lookup may ask a visitor to sign in |
| `6c13fdc4` | fix(web): T11-CAP-LR01-R2 physical UAT — a typed system label is never echoed to the customer, and a reported update's time says "as of" |

(Everything before `aa73b059` is T11-CAP and R1, already returned. Commit trailers and the PR description follow the Moderator's attribution rules.)

## 3. Changed files

**77 files, +12,079 / −215** since R1's return.

| Area | Added | Modified |
|---|---:|---:|
| `database/migrations` | 1 | — |
| `database/test` | 1 | — |
| `backend` runtime (services, routes, utils, `server.js`) | 4 | 9 |
| `backend/scripts` (+ one data file) | 5 | — |
| `backend/tests` | 9 | 5 |
| `web` runtime (pages, components, hooks, types, lib) | 16 | 11 |
| `web` tests | 9 | 2 |
| `docs` | 3 | — |
| repo config (`.gitattributes`, `ci.yml`) | 1 | 1 |

The full list is in the appendix.

## 4. Migration list

**One migration added by R2:** `database/migrations/20260926090000_trade_os_cap_r2_customer_journey_authorities.sql` (git blob `49d75cb5…`). It is additive — it alters no existing table, column, function or policy — and carries the `-- +migrate Up` marker the migration-integrity guard requires. (Earlier on this PR, before R2: `20260920090000_trade_os_cap04_shipment_legs.sql`, `20260921090000_trade_os_cap05_shipment_observations.sql`, `20260922090000_trade_os_cap08_journey_alerts.sql`.)
Applied to the authorised staging project in **one transaction together with its ledger row**: catalog after = functions 4 · tables 5 · triggers 11 · constraints 97 · indexes 18, 0 problems (workflow run `40274757763`; receipt: [T11_CAP_LR01_R2_STAGING_RECEIPT.md](T11_CAP_LR01_R2_STAGING_RECEIPT.md)).

## 5. REUSE / EXTEND / NEW authority matrix

Full 31-row matrix with the evidence for each row: [T11_CAP_LR01_R2_AUTHORITY_MATRIX.md](T11_CAP_LR01_R2_AUTHORITY_MATRIX.md). Condensed:

| Capability | Authority | Verdict |
|---|---|---|
| Vehicle identity & 11 of the 19 §13 facts | `vehicles` | **REUSE** (+ **EXTEND** the identifier validators, §16) |
| Import / purchase transaction | T4 `diaspora_import_orders` | **REUSE** |
| Shipment, carrier, vessel, ports, ETD/ETA, observed movement | T11 `diaspora_shipments`, `_legs`, observations, stage events; T10 loads | **REUSE** |
| Documents (B/L, invoice, export certificate) | T8 `diaspora_trade_documents` | **REUSE** + **EXTEND** (an owner-only, short-lived, audited view/download route) |
| Customs / clearing / delivery | T12 `diaspora_customs_cases` | **REUSE**, read-only; **no case was created** |
| Payments | T4 `diaspora_payment_milestones` | **REUSE** + **EXTEND** (compositor) — none recorded, says so |
| Messages, notifications | T7 | **REUSE** |
| Vehicle media | `vehicle_evidence` (private bucket), `listing_images` (public, 0 rows for the Vezel) | **EXTEND** + **NEW** (`vehicle_media_references`, a governed third block) |
| Specification facts with no column | — | **NEW** `vehicle_specification_observations` |
| Customer progress as the sender reported it | none | **NEW** `diaspora_external_progress_entries` |
| Consignee / notify party / document delivery / document centre / agent as the paperwork names them | none | **NEW** `diaspora_order_parties` |
| Document dispatch and tracking | none | **NEW** `diaspora_document_dispatches` |
| Important update | none as such | **COMPOSE** (read model; stores nothing) |

## 6. Database-model explanation

Five tables, one migration, because the inventory found exactly five capabilities with **no** home anywhere in the schema or code. Each answers a different question about a customer's purchase and none can say that something moved:

| Table | Holds | Why nothing existing fits |
|---|---|---|
| `diaspora_external_progress_entries` | What an **external** provider reported, stage by stage (stage, order within the stage, who the source says acted, the action's words, reported status, an optional time **with** its stated basis) | T11 stage events are *movement*; the audit log is CarUp-internal; trade-fact observations are measurements |
| `diaspora_order_parties` | Who the **paperwork** names (consignee, notify party, document delivery, document centre, destination agent) — declared, not verified | T4 intake records what the customer *asked for*; order participants are authority-bearing roles, not declared text |
| `diaspora_document_dispatches` | The posting of the **original** documents: where, by whom, the sender's status phrase, optional times | nothing; `diaspora_shipments.tracking_number` is the *cargo* reference |
| `vehicle_specification_observations` | Spec facts `vehicles` has no column for (model code, registration and manufacture year/month, engine size, steering side, seats, doors, fuel detail, equipment), each with its **raw source value** | `vehicles` has 11 of the 19 §13 facts and no home for the rest |
| `vehicle_media_references` | A governed **reference** from a vehicle to an existing evidence image — gallery position, primary choice and its basis; **never a copy, never a listing row** | the #164 contract keeps listing media and verified evidence disjoint and never signs the former |

**Rules that run through all five** (each enforced in the database, each proved by the 267-check PGlite suite):

* **Forced row-level security, no policy, no grant to `anon` or `authenticated`**; only the service role reads or writes.
* **Recorded facts are immutable.** One generic guard rejects any change to any column not named as mutable — *including a column added later*. Correction is *supersede* (set `deleted_at`, record a new entry). A second guard forbids `DELETE`.
* **A time is never defaulted.** `event_time` has no default and is accepted only with a stated basis and never in the future of its own observation; an unknown time is `NULL`. Creation time is not event time.
* **Structural impossibility, not convention.** No column in the progress ledger could assert movement, money or a customs decision, and it has no `origin` column — it can only ever hold what *others* reported. A tracking number must look like one (letters, digits and hyphens, 6–40 characters), so a status phrase can never be stored in that column; a dispatch's times are ordered (`dispatched_at ≤ delivered_at`, delivered only when the status is `DELIVERED`) and a status is never observed in the future.
* **Same provenance block everywhere:** `source_system`, `source_reference`, `source_position`, `evidence_ref`, `evidence_digest` (sha-256 of the captured text), `observed_at` (when CarUp saw it — **not** the import time), `imported_at`, `verification_status` (starts at `REPORTED`), `ingestion_run`, `metadata`.
* **One CAP, two origins.** CarUp's own progress is **not** stored here: it is composed at read time from the authority that owns each fact, so the two origins can never disagree (§18).

## 7. Historical-ingestion receipt

Full receipt: [T11_CAP_LR01_R2_STAGING_RECEIPT.md](T11_CAP_LR01_R2_STAGING_RECEIPT.md). Run `40274757763`, 16 of 16 steps green: rehearsal gate → a **whole-write inside a rolled-back transaction** (`committed:false`) → apply (`committed:true`) → independent verify (`MATCHES`) → an idempotent second apply.

Created **exactly** what the rolled-back preflight said it would: parties **5** · dispatches **1** · reported progress rows **14** · specification observations **13** · media references **50**. Source of the facts: the Owner-authorised capture of the Owner's own purchase, transcribed verbatim into `backend/scripts/data/t11-cap-r2-historical-facts.json` (sha-256 `b1c48fdd…1516`). The capability token was never held, and is in no file, log or database.

**Independent post-state, read again at the end of this return** (read-only staging connection, after the physical UAT): the same 14 / 5 / 1 / 13 / 50; ledger `entry_sequence` 1…14 contiguous; **`event_time` and `event_time_basis` NULL on all 14**; all 14 `COMPLETED`; all `REPORTED`; none superseded; consignee `address_line`, `phone`, `email` NULL; dispatch `tracking_number`, `courier_name`, `dispatched_at`, `delivered_at` all NULL; 50 media references with 50 distinct positions (1…50) and 50 distinct assets, exactly one primary (`SOURCE_FIRST_IMAGE`).

## 8. Provenance proof

Every ingested row carries, **in backend columns**, `source_system = BE_FORWARD_CAP`, `source_reference = CD740269` (read back from all five tables and from the order's metadata `{system: BE FORWARD, reference: CD740269, basis: CAP_OBSERVED}`), `source_position`, `evidence_ref`, `evidence_digest`, `observed_at = 2026-10-24T23:46:01Z` (the capture's time), `imported_at`, `ingestion_run = t11-cap-lr01-r2-ingest-1`, and `metadata.provenance` naming the programme and the facts file's digest. The customer page shows **attribution** ("Reported by …", "as of …") drawn from that data; the source's name is data (`source_label`), never code. Provenance is a record, not a dependency; presentation and provenance are separate (§24).

## 9. Idempotency proof

* A second `apply` **in the same run**: `created: {}`, `existing` = all **83** rows (5 + 1 + 14 + 13 + 50), verdict `MATCHES`, **no new audit entry**.
* Keyed on natural keys (order + stage + sequence; order + role; order + document type; vehicle + spec key + raw value; vehicle + evidence), so a re-run cannot duplicate.
* 64 ingestion tests + 36 harness tests; **mutation pass 67 mutants, 67 killed** (the first pass left 7 survivors; each was a test that passed through a sibling layer and was rewritten to name the specific rule).
* Recovery is `--mode=supersede` — marks only *this run's* rows `SUPERSEDED`, needs a typed confirmation, is audited, and has its own tripwire.

## 10. Conflict behaviour

The ingestion **stops and reports; it never "fixes"** (each is a tested stop condition): a vehicle owned by someone else · two live orders for the vehicle · an order naming a *different* external reference · two live shipments · a photograph count other than 50 · two photographs sharing an upload instant (the order would be a guess) · a non-image or rejected asset · a prerequisite migration not applied · an existing row that **disagrees** with the plan (reported by table, never overwritten) · a live row the plan does not contain · an existing row carrying a completion time · a divergent dispatch, specification or media reference. And the **tripwire**: if the protected vehicle, the target vehicle, the order, the shipment, any movement event, any notification or any count outside the five tables moves, the whole run **rolls back**. On the real data every precondition held.

## 11. Vezel data-convergence proof (§13, §14, §16)

Each §13 fact and where it now lives (read from staging at the end of this return):

| §13 fact | Value | Lives in |
|---|---|---|
| Make / Model / Year | Honda / Vezel / 2018 | `vehicles.make`, `.model`, `.year` |
| Grade | Hybrid Z Honda Sensing | `vehicles.trim` |
| Frame / chassis | RU3-1316558 | `vehicles.vin` and `.chassis_number` |
| Engine number | LEB6736579 | `vehicles.engine_number` |
| Mileage | 134,741 km | `vehicles.mileage` |
| Exterior colour | Pearl | `vehicles.color` |
| Drive | 2WD | `vehicles.drivetrain` |
| Transmission | Automatic | `vehicles.transmission` |
| Fuel | Hybrid / Petrol | `vehicles.fuel_type` = Hybrid **and** observation `FUEL_DETAIL` = "Hybrid (Petrol)" (raw `Hybrid(Petrol)`) |
| Model code | DAA-RU3 | observation `MODEL_CODE` |
| Registration | 2018/12 | observation `REGISTRATION_YEAR_MONTH` = 2018-12 (raw `2018/12`) |
| Manufacture | 2018/6 | observation `MANUFACTURE_YEAR_MONTH` = 2018-06 (raw `2018/6`) |
| Engine size | 1490 cc | observation `ENGINE_DISPLACEMENT_CC` = 1490 cc |
| Steering | Right | observation `STEERING_SIDE` = RIGHT (raw `Right`) |
| Seats / Doors | 5 / 5 | observations `SEAT_COUNT`, `DOOR_COUNT` |
| Equipment | A/C, Airbag, Alloy Wheels, Power Steering, Power Window | five `EQUIPMENT_ITEM` observations |
| External reference | CD740269 | the order's metadata and every R2 row's `source_reference` |

All 13 observations are `REPORTED` / `EXTERNAL_REPORT` and the page marks each † *"as recorded; not independently verified"*. **Nothing is hard-coded in React**; the page draws the specifications from the Journey composition.

**Price truth (§14).** `vehicles.price = 0` / `currency NULL` is the schema placeholder and is **never** shown as a price. A price is an amount **and** a currency, or the surface says **"Price not recorded"** — enforced on My Garage, the Vehicle Passport, Seller Studio and the Journey (`ownerStatedValues.statedVehiclePrice`; the compositor's purchase price is one frozen `not_recorded` statement that carries no number). Seen in the browser on every surface: no `$0`, and the Serena's listing price ($12,800) never appears on the Vezel's Journey.

**Identifier (§16).** A documented Japanese frame number shorter than 12 characters is a vehicle identifier: one shared rule (`^(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,7}-[0-9]{6,8}$`) in `utils/sellerVehicleIdentifier.js`, used by the marketplace eligibility and classification rules and the Seller form, with a one-place test that scans **all** backend runtime files for a restated copy. Seller Studio accepts `RU3-1316558`; synthetic, underscore and integration markers stay excluded.

## 12. Media-convergence proof (§15)

* **A reference, never a copy, never a listing row.** 50 `vehicle_media_references` point at 50 existing private evidence assets: 50 distinct positions 1…50, one stated primary (position 1, `SOURCE_FIRST_IMAGE`), ordering basis `SOURCE_GALLERY_ORDER` (derived from the import sequence, and labelled as an inference). `listing_images` for the Vezel: **0** before and after; the 53 evidence rows were not edited.
* **A third, key-disjoint block** (`governed_media`) beside listing media and verified evidence — owner or platform admin only, from a **proven** identity, authorised-or-absent, signed URLs that live **3600 s**, identical 404 for every refusal (`GET /api/vehicles/:vin/governed-media`). The **public** passport carries nothing — not a count. Capability responses are `Cache-Control: private, no-store`.
* **Seen in the browser as the customer:** My Garage (real private hero, "Private · Awaiting review"), the Vehicle Passport (hero + 50-photograph gallery), the Journey (hero + 50), and Seller Studio ("Photographs on file for this vehicle"). 51 images load on the Journey; none broken.
* **Public users cannot reach it:** the isolation probe (§14) — two unrelated ordinary users and no session, measured three times (the first measurement failed on its own judge, not on the product), the last on the final deployed pair.
* The photographs carry the original seller's watermark **inside the pixels** (the customer's own purchased-vehicle images, stored unaltered as evidence). No external image is hot-linked (§17).

## 13. Serena before / after

| Fingerprint `md5(row_to_json(t)::text)` | Before R2's ingestion | Inside the ingestion transaction, after | **After the physical UAT** |
|---|---|---|---|
| Nissan Serena `GFC27-027051` | `e9d216b9ca1eb39440d9be8ab39123e6` | `e9d216b9ca1eb39440d9be8ab39123e6` | `e9d216b9ca1eb39440d9be8ab39123e6` |
| Import order `3e2b66a0…` | `4714abd7b98bd752e093ee02f71a7f59` | same | `4714abd7b98bd752e093ee02f71a7f59` |
| Shipment `f8cb8f50…` | `4f7431fda0687016896867f2370b5e06` | same | `4f7431fda0687016896867f2370b5e06` |
| Honda Vezel `RU3-1316558` | `80823a186bc7beb2c071b64a0be677fd` | same | `1c764dc858b0029a011480a10d4bb4e6` — **changed; explained and proved in §16.3** |

Counts, unchanged at the end of the run: stage events 1 · observations 0 · legs 1 · shipments 4 · orders 221 · vehicles 370 · evidence rows Vezel 53 / Serena 5 · `listing_images` Vezel 0 / Serena 10 · T8 documents on the order 3 · payment milestones 0 · customs cases 0 · `domain_events` 1,947 · `notification_queue` 1,888 (nothing emitted, nothing queued — including by the UAT). The Serena's Journey in the browser reads "No journey yet" and contains **no** Vezel token in its text or HTML.

## 14. Test evidence

All run in clean throwaway worktrees; Node 22; the backend suite under the `ci.yml` environment contract; the full backend suite in 12 watchdog shards.

### Backend
| Lineage | Head | Files | Tests | Pass | Fail | Cancelled |
|---|---|---:|---:|---:|---:|---:|
| Product | `b998d311` (no backend/database/shared file changed since — `git diff --name-only` over those paths is empty) | 459 | 7,228 | 7,206 | **1** — inherited T3 `SAILING MATCH` | 0 |
| Candidate | `e28cbf25` | 642 | 9,747 | 9,698 | **1** — `lender-routes-authz` consent deletion, **did not reproduce** (file alone 5/5; the exact shard re-run 754/754) | **9** — inherited FX file |

R2's own 14 backend test files (9 new, 5 extended): **444 tests, 444 pass** — migration/ingest/harness (64 + 36), compositor (60), document access (14), headers (3), isolation judge (12), external independence (4), governed media (31 + 14), identifier rule and marketplace rules (15 + 20 + 29), the #164 read-contract register (24), the Journey projection (118).

### Frontend, type-check, build, lint
| | Product `6c13fdc4` | Candidate `e28cbf25` |
|---|---|---|
| Full web suite (vitest) | **198 files / 2,189 tests, all pass** | **290 files / 3,125 tests, all pass** |
| `tsc -b` | exit 0 (negative control: a deliberate type error → exit 2) | exit 0 |
| CI's own step `tsc --noEmit -p web/tsconfig.app.json` | exit 0 (negative control exit 2) | — |
| `npm run build` | built, exit 0 | the Vercel builds of both Previews succeeded |
| Lint regression gate (re-implemented without its `git fetch --depth 1`, same eslint binary, base vs head) | base 135 errors / 10 warnings; head **135 / 10**; **net-new 0 / 0 — PASS** | — |
| Route validation (a CI step the red job masks) | 7 / 7 | — |

### Database / migration
`database/test/trade_os_cap_r2_authorities_check.mjs` (PGlite, run from a space-free worktree at the product head): **267 / 267**, covering apply, idempotent re-apply, scope (exactly five tables, nothing existing altered), structural impossibilities, immutability, no-delete, the dispatch time guard, NULL-safe shape rules and RLS/grants. **Mutation pass: 156 mutants, 155 killed** (the one solo survivor, the dispatch-recipient FK action, is shadowed by the party guard).

### D2 and R1 non-regression
`trade-os-t11-cap-02-journey-projection` **118 / 118** (five tests are explicitly tagged R1 D2: a co-loader whose own order has no shipment is shown nothing; two live shipments on a container neither attached to my order are not mine and not "ambiguous"; and the same for the vessel, the estimate history and a customs case) and `trade-os-t11-r1-vehicle-journey` **26 / 26** (vehicle subject, ambiguity fails closed, honest empty state). **Sharing a container is not an association; multiple orders are never guessed.**

### Authorisation, privacy and security
* **Document access** — 14 HTTP-level tests through the real router, auth and error middleware: owner, uploader and platform admin only; a buyer who is not the owner is refused; every refusal is the identical `404 "Document not found"`; the link lasts **300 s**, is audited as `TRADE_DOCUMENT_ACCESSED` **before** it is returned, and is `private, no-store`. Mutation 43 / 43 (after 3 survivors were fixed).
* **Capability headers** — a response that carries the owner's photograph links is never stored (5 / 5 header mutants killed).
* **Journey privacy in the compositor** — a participant who can read the journey but is not the owner is shown **nothing** of the CAP, in the same words as if none existed; a stranger is refused; a buyer who is not the owner does not get the owner's photographs; a document id is forwarded only to a viewer with private access and never a storage path.
* **Isolation probe, three measurements on deployed Previews** (synthetic outsider identities with the ordinary `owner` role, plus no session; read-only apart from sign-in rows): run `40282302930` **failed on its own judgement, not on the product** (a visitor who asks for a restricted frame-number lookup is correctly asked to sign in — `401` — which the judge had not allowed; the judge was corrected and its tests extended in `b998d311`, no product change); run `40282570631` PASS; **run `40297968122` PASS on the final deployed pair** — 37 observations: every journey, private-gallery and document-link request for a purchase that is not theirs answered with the identical refusal for a thing that exists and one that does not (`403 "You do not have access to this journey"`, `404 "Not found"`, `404 "Document not found"`); the public passport carried no `governed_media`, signed link or storage word; each user's own list carried no Vezel or Serena identifier. The run first proves from the host's own `/api/health` that it answers as exactly `e28cbf25` (a Preview build) and that the candidate contains the product head.
* **Reads write nothing** — a trap on every new table (G-W1); the reads are bounded (fourteen ledger rows or fourteen hundred cost the same number of queries).

### Media and historical progress
Governed media: 31 + 14 tests and 76 web mutants killed. Historical progress: compositor G-PROG1…6 and G-J1…J10 (five groups of 7 / 1 / 3 / 1 / 2 rows, every one Completed with no invented time; **reported progress did not become movement**). Compositor mutation pass **109 / 109**. Web mutation pass **76 / 76**.

## 15. Exact-head deployment provenance

**Why a candidate.** A backend built directly from the frozen Trade OS base cannot authenticate against the current staging session authority (AUTH-05), so the Preview pair is built from an integration candidate under the seven rules of §26:

| §26 rule | How it is met |
|---|---|
| 1–2. PR #243 stays the product authority; the candidate is a vehicle | PR #243 is the only place R2 product code lives; the candidate branch holds nothing but merges of its heads and one runtime adaptation |
| 3–4. Includes the exact product SHA; byte-identity or an independent inclusion proof | §1: ancestry, 65 / 77 byte-identical files, and a line-level inclusion proof for the 12 that a lineage merge changed (one explained exception) |
| 5. Runtime-only changes separately attributable | **Exactly one**: `d065047e` — `services/provenance/recordProvenance.js` now calls the shared identifier helper (+ test `t11-cap-r2-runtime-identifier.test.js`). On the runtime lineage that file kept its own 12–17-character floor, so `RU3-1316558` was still classed `invalid_vin_format` there. Nothing refused before starts passing (`GFC27-02705`, `ABC-123`, underscored, synthetic and integration markers stay excluded) |
| 6. Evidence names both SHAs | product `6c13fdc4` and deployed `e28cbf25` appear together in the run `40297968122` log (the custody step prints both) and in this document |
| 7. No unrelated integration change becomes R2 scope | the candidate's only own commits above the R1 candidate are the six merges and `d065047e` — there is no other integration change |
| Canonical staging not mutated | §1: all four canonical hosts still `8353dbdd`; the Previews are immutable `…-11-11.vercel.app` hosts, no alias moved, no `--prod` |

**The final pair** (built from a clean detached worktree at `e28cbf25`, cached Vercel CLI, scope `11-11`, no `--prod`):

| | Backend | Web |
|---|---|---|
| Deployment | `dpl_Aqn2JaeVvooJ6RLSiJsxNgGXuiC4` | `dpl_C5aMJ7r8tkdmBr4TwQActqW2RjU4` |
| Host | `carup-backend-staging-atkd1zlff-11-11.vercel.app` | `carup-staging-cxz32nfyh-11-11.vercel.app` |
| Self-reported build | `/api/health`: `commit_sha e28cbf25…`, `environment preview`, `source explicit_build_input`; external sends **disabled** (kill switch active) | `/carup-provenance.json`: `commit_sha e28cbf25…`, `api_base_url` = the backend host above, `unpaired: false` |
| Pairing proof | — | the served index bundle contains the immutable backend host 7×, the build SHA 1×, **no** `beforward` string; the journey chunk contains the new wording (`Recorded in CarUp`, `Taken from a document`, `Reported by the carrier`, `Reported by a tracking provider`, three `as of `) and **no** `Source: ` template and no `certification seed` |

The earlier pair UAT pass 1 ran on — backend `dpl_6ehpn5c6…` (`…iqhe00j6w…`), web `dpl_GZCDNdp…` (`…eq4av12qr…`), candidate `02507825` — is superseded by the pair above.

## 16. Physical UAT (§31)

Run **as the real customer, Kingston Musarurwa**, in a **visible Chromium** window the Owner could watch. **The Owner signed in themselves; no credential was typed by the specialist.** Every observation below is from the page, not from a mock.

### 16.1 Pass 1 — pair at candidate `02507825` (backend runtime identical to the final)

| Surface | 390 | 768 | 1280 | 1920 |
|---|:-:|:-:|:-:|:-:|
| Journey `/diaspora/journey/vehicle/RU3-1316558` | ✔ | ✔ | ✔ | ✔ |
| My Garage | ✔ | ✔ | ✔ | — |
| Vehicle Passport `/dashboard/garage/RU3-1316558` | ✔ | ✔ | ✔ | — |
| Seller Studio `?vin=RU3-1316558` | — | — | ✔ | — |
| Serena Journey `/diaspora/journey/vehicle/GFC27-027051` | — | — | ✔ | — |

Measured at each width on the Journey: **no horizontal page overflow** (`scrollWidth = clientWidth`); the only horizontal scrollers are three *contained* tab strips (the app's top navigation, the Journey tab strip, the "On this page" pills); every image loads (51); the only clipped text is screen-reader-only; the 24 headings are in §23 order. The page text was read in full at 1280. **§31 checklist, as seen:**

* **Vehicle and media:** the Vezel is in My Garage with its real private photograph; the Passport and the Journey show the real 50-photograph gallery; Seller Studio shows "Photographs on file for this vehicle" and states honestly "0 listing photos · cover not chosen".
* **Vehicle data:** every source-backed specification is shown, each †-marked as recorded and not independently verified; nothing fabricated; **no `$0`** anywhere ("Price not recorded", "Purchase price — Not recorded"); `RU3-1316558` is accepted as the frame number.
* **Historical progress:** all five groups; all **14** rows; every one **Completed (reported)**; action takers as stated by the source (BE FORWARD, SHIPPING COMPANY, BF DOCUMENT CENTER, BE FORWARD TANZANIA, and the customer's own two actions); **no completion date anywhere** ("The source did not supply a date for this step."); the source's own misspelling "Comfirmed" kept.
* **Shipping:** carrier Hoegh Autoliners K.K.; vessel HOEGH TRACER (V-61); Shimonoseki, Japan → Dar es Salaam; planned departure Aug 29, 2026; estimated arrival Sep 18, 2026; **"Not recorded as departed"**, **"Not recorded as arrived"**.
* **Documents:** the B/L, the commercial invoice and the export certificate are each listed ("Supplied — awaiting review"; inspection, insurance and packing list "Not supplied"). **View** opened each in a new tab (a short-lived signed storage link, 300 s: `iat`→`exp` = 300). **Download** of the B/L delivered a valid one-page PDF named "Bill of lading.pdf" (3,204,341 bytes) — a friendly filename, not a storage path. The page's DOM carries **no** storage path, bucket or token for any document (the only signed URLs in the DOM are the 51 photographs and the "Open full size" link, all owner-only).
* **Privacy:** the consignee shows a name and "HARARE, Zimbabwe" and the sentence "Contact details are kept on your CarUp account and are not repeated here"; unrelated users — §14.
* **Regression:** the Serena's Journey says "No journey yet" with no Vezel token; D2 and ambiguity — §14.
* **External independence:** the network log of the Journey page shows only the pinned immutable backend, the staging Supabase project (51 signed image requests), the Preview web host, the Vercel Preview toolbar and Google Fonts — **no external-portal host**; console: **0 errors, 0 warnings**.

Evidence (private, **not committed**): 16 screenshots and a token-redacted network log. No screenshot of any document was kept — the B/L carries the consignee's private details — and the downloaded PDF was deleted.

### 16.2 Findings from pass 1, and what was done

| # | Finding | Class | Fix |
|---|---|---|---|
| F1 | The movement timeline row read **"Source: certification seed"**: `sourceLabel()` echoed any source string it had no wording for. A label somebody typed made a genuine record look like test data (§24). | Defect, R1-origin code surfaced by R2's real data | Unknown labels are worded "Recorded in CarUp" and never echoed; the four sources the leg service allows keep their own plain wording whatever the casing. Page-level test + unit test + **10-mutant pass, all killed** |
| F2 | The Latest Update line read "Reported by BE FORWARD portal · Oct 25, 2026, 8:46 AM". That time is **when the page was read** (`observed_at`), not when the thing happened, and a bare "· date" invites the second reading. | Defect in R2 code | A reported update now says **"as of <date>"** (as the delivery block and progress sources already did); CarUp's own update keeps "Recorded by CarUp · <date>". Held in both directions |
| F3 | Opening Seller Studio **wrote to the customer's real vehicle row** — see §16.3. | Pre-existing product behaviour | Reported, not changed (outside R2) |

Both fixes are product commit **`6c13fdc4`**, merged into the candidate as `e28cbf25`, rebuilt and redeployed as the final pair.

### 16.3 F3 in full — the Vezel's fingerprint moved, and exactly why

The Vezel vehicle's fingerprint is `1c764dc8…` now, not the `80823a18…` recorded at ingestion. Cause: **opening Seller Studio as the signed-in customer** triggers the product's own account-draft autosave (`PATCH /api/vehicles/:vin/seller-draft`, in the product since `92fc3731`, 2026-08-30; the page's effect fires once the server draft is loaded) at **2026-10-26T07:46:00.978Z**. It recorded six *seller-draft* columns: `seller_features` (NULL → `[]`), `seller_listing_recorded_at`, `listing_location_recorded_at`, `listing_location_source` (`seller_declared`), `listing_location_visibility` (`withheld`), `seller_listing_claim_source` (`seller_declared`).

**Proof it is *only* those six:** setting exactly those six columns back to NULL in a copy of the current row reproduces the recorded baseline `80823a186bc7beb2c071b64a0be677fd` **exactly**. Identity, specification, price (`0` / currency `NULL`), status (`Pending`), publication (`draft`), owner, evidence and media were not touched; nothing was published; the Serena, the order and the shipment fingerprints are unchanged. This is what the page does for any seller who opens it; R2 did not introduce it. It is disclosed because the UAT, not the ingestion, moved a protected-looking fingerprint.

### 16.4 Final pair — what was and was not re-verified

| Check | Result |
|---|---|
| The deployed web chunk contains the new wording and none of the old template | ✔ (§15) |
| Pair provenance, health and pairing proof | ✔ (§15) |
| Third isolation probe against the final backend host | ✔ PASS, run `40297968122` (§14) |
| Full backend, web, type-check, build, lint, DB suites at the final heads | ✔ (§14) |
| **Physical re-pass of the Journey page on the final web host at 390 / 768 / 1280 / 1920** | **Pending the Owner's own sign-in on the new Preview origin** — the specialist does not enter credentials. The visible Chromium tab is open on that origin's sign-in page. The pass (the Journey page at the four widths, the two corrected lines, one document View) takes minutes once signed in, and its result will be appended to this section. Its subject is two display strings whose deployed bytes, unit tests and mutation pass are already evidenced above |

## 17. External-runtime-independence proof

If the original portal vanished tomorrow, nothing in CarUp would stop working. Four independent proofs:

1. **No runtime reference** (`t11-cap-r2-external-independence` **X1**): no file that ships on the CAP read path, and no shipped file with an address shape, names the source's host, a capability URL or a token (scoped through `CAP_PATH_FILES` plus `web/src/pages/diaspora` and `web/src/components/media`, with negative controls).
2. **The facts are data read once, offline** (**X2**): the ingestion reads a FILE; nothing in the request path imports the ingestion or its data.
3. **No network on the read path** (**X3**): the whole CAP is composed with `fetch`, `http`, `https` and `net` booby-trapped to throw — it still answers, because it reads only CarUp's database.
4. **No secret in the tree** (**X4**): the capability token's shape appears in nothing tracked by git.

Plus the browser: no external-portal host in the page's network log; **0** `beforward` strings in the deployed bundle; no hot-linked image. The token is held by no one in this programme and the specialist never used it.

## 18. A CarUp-native journey fills the same structures (§32)

The five tables hold **only what an external source reported**. CarUp's own journey is **composed at read time from the authority that owns each fact**, into the *same* five stages and the *same* row shape:

| Stage | CarUp-native row derived from |
|---|---|
| Booking | a T5 reservation / T11 `BOOKED`, and a declared leg |
| Departure | a T10 load confirmation (**only when the cargo's load state is LOADED** — cargo left behind is not "loaded") and a T11 *observed* departure |
| B/L | the T8 document and its **verification** (an unverified document is not a verified one) |
| Dispatch | a document dispatch **CarUp itself recorded** (a sender's or an owner's statement never becomes CarUp's row) |
| Clearing & Delivery | T12 customs events, **keeping the strength customs gave them** (an agent's report is not CarUp's observation) |

Proved by the compositor tests **G-NATIVE1–6** and **G-N1–N5** (a native journey with **no** external ledger populates the same progress structure; a native row has the reported row's shape, so one component draws both; a recorded exception outranks everything as the important update; a native journey has no external source anywhere and its price is still not recorded) and in the browser tests of the page ("one CAP, two origins": CarUp's rows are told apart by their *words*, not by a different layout). **There is no future rewrite when the origin changes** — the native path is already the second reader of the same composition.

## 19. Inherited-versus-new CI classification

PR #243 at head `6c13fdc4`, as it stands on GitHub:

| Check | Result | Class | Evidence |
|---|---|---|---|
| Diaspora Deployed Staging UAT — **Bootstrap**, **Aggregate** (Chromium, Tablet, Mobile skipped as a consequence) | fail | **INHERITED** — `UNGOVERNED_BRANCH`: the branch has no governed preview pair in `web/preview-*-pairing.json`. Branch governance is not changed (§27) | the log's own refusal text; identical at R1's return |
| diaspora-phases-3-7 — **backend-and-build** | fail | **INHERITED** — its step "Backend focused Diaspora tests" fails on `diaspora-logistics-rfq.test.js` **SAILING MATCH** (the expired T3 date fixture). **The same test fails on the PR's parent `577428de`** (17 / 18) and the file is untouched by the PR | reproduced on the parent. **That failure stops the job, so the three steps after it never ran in CI.** All three were run locally: `tsc` (app) exit 0, route validation 7 / 7, production build OK |
| Passport foundation contracts, communication-unit, communication-postgres, playwright, referral-ci, staging-integration | pass | — | — |

Also red **only** on a lineage the PR does not target, and not R2's: the FX file `oc5r-prov01-fx-observation-policy.test.js` — 9 tests cancelled (*"Promise resolution is still pending but the event loop has already resolved"*), **identical blob and identical result on the canonical base `8353dbdd` and on the candidate**.
Reds R2 **introduced and fixed** along the way (not red now): diff-hygiene on the verbatim authority document (scoped `.gitattributes`), the anonymous-vehicle-read guard and the #164 read-contract register (two entries registered with their reasons), and four lineage-fragile guards found only by running the suites on the runtime lineage. **No new R2 failure remains.**

## 20. Limitations and notes for the Moderator

* **Final physical re-pass** — see §16.4.
* **Merge-time note.** #243 targets the Trade OS base, where `recordProvenance.js` does not exist. Merged into any lineage that has it (PC01-K2B), R2's hunk in `marketplaceClassificationRules.js` conflicts by design: take that lineage's file and apply `d065047e` (one helper call) — otherwise `RU3-1316558` is classed `invalid_vin_format` there.
* **Seller Studio autosaves on open** (pre-existing, §16.3) — the product writes six draft columns when a seller merely views the page. Worth its own ticket; unchanged here.
* **The gallery order is inferred** from the import sequence (the original filename is not stored) and is labelled as an inference; the primary is a *stated* choice.
* **The three documents are "Supplied — awaiting review"** — CarUp has not reviewed them, by design. The B/L itself carries a shipped-on-board date; that is a claim in an unverified document and was **not** ingested as a movement.
* **Stale estimate.** The estimated arrival (Sep 18, 2026) is in the past and no arrival is recorded. The page says it is an estimate and not a record, and shows "Not recorded as arrived"; no staleness alert fires (outside R2).
* **The consignee's name is spelled differently** on the source page, the B/L and the account; it is shown as *declared, not verified* and "does not change who the buyer is".
* **The photographs carry the seller's watermark** in their pixels (§12).
* **Accessibility.** No overflow at any width; the contained tab strips scroll; two standalone text links ("Open full size", "Open the document workspace") are 16–20 px tall — below a comfortable tap target — and were not changed (R1 styling + one R2 link).
* **Vercel's Preview toolbar** (a round button) appears on Preview hosts only; it is not product.
* The machine slept for roughly an hour during the candidate backend run (shard 1 shows 4,228 s of wall time); no test was affected.
* **One non-reproducing failure** in the first complete candidate backend run (`lender-routes-authz`, consent deletion, `400 !== 403`): not R2 code, passes alone (5 / 5) and in its exact shard (754 / 754).

## 21. Production

**Production Supabase `vhmnajoeicasaigiophh` was not accessed, queried, migrated, mutated, deployed to or tested against. No production MCP tool was called. No external site was contacted by any program written for R2; the capability token was never held or used.**

## 22. Recommendation

Every item of §33 is evidenced above; every red in the PR's own CI is inherited and reproduced on the PR's parent; the two defects the physical UAT found are fixed and the one pre-existing side effect is disclosed. The single item the specialist could not complete alone is the physical re-pass of the final web host (§16.4), which needs the Owner's own sign-in on the new Preview origin; the Moderator retains acceptance and may require that re-pass first.

`RECOMMEND ACCEPT`

---

## Appendix A — changed files (R2 range, `304607ea` → `6c13fdc4`)

```
A  .gitattributes
M  .github/workflows/ci.yml
M  backend/routes/diasporaJourneyRoutes.js
M  backend/routes/diasporaRoutes.js
A  backend/routes/governedMediaRoutes.js
A  backend/scripts/data/t11-cap-r2-historical-facts.json
A  backend/scripts/t11-cap-r2-converge.mjs
A  backend/scripts/t11-cap-r2-expected-manifest.json
A  backend/scripts/t11-cap-r2-ingest.mjs
A  backend/scripts/t11-cap-r2-isolation-probe.mjs
M  backend/server.js
M  backend/services/diaspora/diasporaDocumentService.js
A  backend/services/diaspora/journeyCapComposition.js
M  backend/services/diaspora/journeyProjectionService.js
A  backend/services/evidence/governedVehicleMediaService.js
M  backend/services/marketplace/marketplaceClassificationRules.js
M  backend/services/marketplace/marketplaceListingEligibility.js
M  backend/services/storage/storageService.js
A  backend/tests/governed-media-wiring.test.js
A  backend/tests/governed-vehicle-media.test.js
M  backend/tests/issue164-phase1-read-contract.test.js
M  backend/tests/marketplace-classification-rules.test.js
M  backend/tests/marketplace-listing-eligibility.test.js
M  backend/tests/seller-vehicle-identifier.test.js
A  backend/tests/t11-cap-r2-capability-headers.test.js
A  backend/tests/t11-cap-r2-converge-harness.test.js
A  backend/tests/t11-cap-r2-document-access.test.js
A  backend/tests/t11-cap-r2-external-independence.test.js
A  backend/tests/t11-cap-r2-ingest.test.js
A  backend/tests/t11-cap-r2-isolation-probe.test.js
A  backend/tests/t11-cap-r2-journey-cap.test.js
M  backend/tests/trade-os-t11-cap-02-journey-projection.test.js
A  backend/utils/governedVehicleMedia.js
M  backend/utils/sellerVehicleIdentifier.js
A  database/migrations/20260926090000_trade_os_cap_r2_customer_journey_authorities.sql
A  database/test/trade_os_cap_r2_authorities_check.mjs
A  docs/trade-os/T11_CAP_LR01_R2_CARUP_CAP_PRODUCT_AUTHORITY.md
A  docs/trade-os/receipts/T11_CAP_LR01_R2_AUTHORITY_MATRIX.md
A  docs/trade-os/receipts/T11_CAP_LR01_R2_STAGING_RECEIPT.md
A  web/src/components/listing/OwnerVehicleHero.tsx
A  web/src/components/media/GovernedGallery.test.tsx
A  web/src/components/media/GovernedGallery.tsx
A  web/src/components/media/GovernedPhoto.tsx
M  web/src/hooks/useCarUpApi.ts
M  web/src/hooks/useTradeLogisticsApi.ts
A  web/src/lib/governedMedia.test.ts
A  web/src/lib/governedMedia.ts
M  web/src/lib/sellerVehicleIdentification.test.ts
M  web/src/lib/sellerVehicleIdentification.ts
M  web/src/pages/GuestSell.tsx
A  web/src/pages/dashboard/owner/MyGarage.governedMedia.test.tsx
M  web/src/pages/dashboard/owner/MyGarage.tsx
A  web/src/pages/dashboard/owner/SellVehicle.governedMedia.test.tsx
M  web/src/pages/dashboard/owner/SellVehicle.tsx
A  web/src/pages/dashboard/owner/VehicleProfile.governedMedia.test.tsx
M  web/src/pages/dashboard/owner/VehicleProfile.tsx
A  web/src/pages/dashboard/owner/ownerStatedValues.test.ts
M  web/src/pages/dashboard/owner/ownerStatedValues.ts
A  web/src/pages/diaspora/JourneyArrival.cap.test.tsx
M  web/src/pages/diaspora/JourneyArrival.tsx
A  web/src/pages/diaspora/cap/CapNav.tsx
A  web/src/pages/diaspora/cap/DestinationAgent.tsx
A  web/src/pages/diaspora/cap/DocumentAccessButtons.tsx
A  web/src/pages/diaspora/cap/DocumentDelivery.tsx
A  web/src/pages/diaspora/cap/DocumentsList.tsx
A  web/src/pages/diaspora/cap/ImportantUpdate.tsx
A  web/src/pages/diaspora/cap/PaymentsSection.tsx
A  web/src/pages/diaspora/cap/ProgressGroups.tsx
A  web/src/pages/diaspora/cap/PurchasedVehicle.tsx
A  web/src/pages/diaspora/cap/TransactionParties.tsx
A  web/src/pages/diaspora/cap/ui.test.tsx
A  web/src/pages/diaspora/cap/ui.tsx
A  web/src/pages/diaspora/capDisplay.test.ts
A  web/src/pages/diaspora/capDisplay.ts
M  web/src/pages/diaspora/journeyDisplay.test.ts
M  web/src/pages/diaspora/journeyDisplay.ts
M  web/src/types/index.ts
```
