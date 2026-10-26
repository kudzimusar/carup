# T11-CAP-00 — REA benchmark investigation · Receipt

**Specialist gate: `SPECIALIST GATE PASSED` — evidence collection complete, with declared deviations D1–D3 (§3).**
Recommendation: `RECOMMEND ACCEPT — T11-CAP-00`, subject to those deviations. The Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Canonical role | `CARUP CAP REVERSE ENGINEERING SPECIALIST` |
| Branch / parent | `feat/trade-os-t11-cap-lr01-journey-arrival` / Part A checkpoint `bea7ef4f` (parent `577428de`) |
| Investigated | 2026-10-24 ~23:03Z – 23:55Z (machine is JST; times are UTC from `date -u`) |
| Target | `https://www.beforward.jp` — one Owner-authorized CAP session, read-only |
| Production / staging touched | NO / read-only SQL only (identity lookups) |
| Evidence | 15 REA records in one validated bundle, **private**; redacted manifest: [t11-cap-00/EVIDENCE_MANIFEST.json](t11-cap-00/EVIDENCE_MANIFEST.json) |

## 1. Headline findings

1. **Vehicle identity: `MISMATCH`.** The CAP vehicle is a **2018 Honda Vezel Hybrid Z Honda Sensing**
   (model code `DAA-RU3`, BE FORWARD ref `CD740269`, chassis `RU3-1316558`, 134,741 km). The staging
   seller-authority vehicle named in the directive is a **2016 Nissan Serena**, chassis `GFC27-027051`.
   A read-only search of staging (`vehicles`, `diaspora_import_orders`, `vehicle_import_records` by
   chassis, VIN and engine number, plus any Vezel owned by `u_66cace85fad949e4`) returns **0 rows**: the
   purchased vehicle has **no CarUp record**. The association step is stopped; nothing was mutated.
2. **CAP is a server-rendered page, not an application.** All business data arrives in one HTML
   document. There is no business API; every `fetch`/XHR at load is analytics, ads, consent or WAF. No CAP script contains `ETA`, `ETD`, `vessel`, `voyage` or `transship`.
3. **The single observed journey is single-vessel, single-leg**: one carrier, one vessel name on both
   departure and arrival, Shimonoseki → Dar es Salaam. No transshipment was observed.
4. **CAP shows no timestamps, no ETA history and no actual arrival date.** The 14-row status table has
   no date column; dates appear only as ETD/ETA (date-only); the page tells the customer to ask the
   Document Center for the vessel's actual arrival date. These are CarUp differentiators.
5. **Named consignee spelling differs:** CAP prints the consignee as "Kingstone Musaurwa"; CarUp's
   canonical account is "Kingston Musarurwa". The spelling is an identity datum for the later mapping.

## 2. REA identity and environment

`rea-agents@6.7.0` (MIT), installed with `--ignore-scripts` into an isolated directory and driven through
its CLI; the real `rea setup` was not run and no client config was modified. Node 22.23.2, macOS 27.0 /
arm64, Chrome 155.0.8059.86. Passive observation used a dedicated Chrome profile with CDP bound to
`127.0.0.1:9222` only. REA-driven scenarios used **launch mode** (REA-owned temporary Chrome). Readiness
gate (target discovery, page inspection, screenshot, script export, evidence IDs) was proven on a local
probe page before any BE FORWARD traffic. The dedicated browser was stopped and its profile deleted after
collection; the other Chrome on the machine was not touched.

## 3. Evidence modes, and deviations from the directive

| Mode | What it was | Records |
|---|---|---|
| **Passive CDP** | REA attached to the Owner-authenticated tab and read it; the Owner only logged in and opened the page | target list, 2× page inspection, screenshot, bundle analysis, 2× listener inspection |
| **REA scenario** (declared, `READ_ONLY`) | REA navigated to the CAP URL and the public Document Center page; clicked the three document links | SCN-01, 01b (repeat), 02-bl, 02-er, 02-invoice, 04 |
| **Derived** | offline from retained captures | script export, comparison |

- **D1 — REA-08 not performed as written.** No Owner-observed `observe_web_session` windows. In this
  transaction every customer action is already completed and no form or button is rendered, so there was
  no Owner action with evidential value; REA-driven read-only scenarios covered document behaviour
  instead. *Consequence:* no request-initiator attribution, and no runtime evidence of how an *open*
  customer action behaves (those flows are `STATIC_ONLY`, §5).
- **D2 — REA-15 state comparison is weak.** The transaction exposes one state, so the meaningful
  comparisons (shipping expanded, document present/absent, agent hidden/visible) do not exist. Only a
  stability comparison was possible (§6). A passive-to-passive comparison was rejected by REA on input
  shape (HARNESS, §8).
- **D3 — the token left the Owner's browser.** Scenarios ran in a second, REA-owned browser on the same
  machine. The token was supplied only as a REA **env-secret reference** (never in a file, argument or
  transcript). Negative control: occurrences of the token value in every scenario envelope and in the
  manifest = **0**; REA rendered it as `[REDACTED:cap_t]` in captured URLs. The CAP link is a capability
  URL (see §5), so this is the same access the Owner already holds, but it is recorded as a deviation.

## 4. CAP functional reconstruction

### 4.1 Page anatomy (OBSERVED — rendered)
Message panel (support-agent avatar, document tracking number, "contact the Document Center for the
vessel's actual arrival date") · **Status** table · **Information** (ETA disclaimer) · **Document** ·
**Consignee / Notify party** · **Purchased product** · **Shipping information** · **Documents** ·
**Delivery** (document delivery address, courier tracking number, Document Center) · Inquiry · language
switch (9 languages). The "Shipping information / Documents / Delivery" headings are sections of one
page; `customer.js` has no tab logic.

### 4.2 Vehicle (OBSERVED)
Reference no., mileage, model code, registration year/month, manufacture year/month, model grade,
chassis no., engine size, drive, exterior colour, steering, transmission, fuel, seats, doors, engine no.,
options list, **50 photographs** with downloads (single zip; without-logo sets 1–30 and 31–50), plus a
notice to check the customer's country's import regulations. No VIN field distinct from chassis.

### 4.3 Journey (OBSERVED)
A table of **14 rows in 5 stage groups**, columns Stage · Action Taker · Status · Action. Every row reads
"Completed":

| Stage | Action takers observed |
|---|---|
| Booking (7 rows) | BE FORWARD; Shipping Company ("allocated a vessel"); BE FORWARD / CAP ("reflect shipping company's vessel plan on to CAP") |
| Departure (1) | Shipping Company ("confirmed the loading of your vehicle to the vessel") |
| B/L (3) | BF Document Center (uploaded; completed customer feedback); **You! (Customer)** ("proofread B/L … gave feedbacks") |
| Dispatch (1) | BF Document Center ("sent out B/L documents and reflected tracking number") |
| Clearing & Delivery (2) | BE FORWARD Tanzania (originals received); **You! (Customer)** ("canceled the delivery service and documents have been collected") |

Actors are attributed per row; **no row carries a date or time**. Pending, in-progress, delayed and
failed row renderings were **not observed** (all rows completed).

### 4.4 Shipping (OBSERVED)
Carrier (one), **Departure** block (vessel name with a "Load Confirmed" marker, port of loading, ETD) and
**Arrival** block (vessel name, port of discharge, ETA). Observed: one carrier, the same vessel name in
both blocks, Shimonoseki → Dar es Salaam, ETD and ETA as date-only values 20 days apart. "Destination" is
rendered as a blank (`-`).
*INFERRED:* the page has separate vessel-name labels for departure and arrival, so the model can
represent different vessels; nothing observed shows it doing so. *UNKNOWN:* how multiple vessels,
transshipment ports or legs would render.

### 4.5 ETA (OBSERVED / INFERRED / UNKNOWN)
OBSERVED: ETA is a single date-only value; the page states that ETA changes are *at the shipping lines'
full discretion* and that the customer or their agent must track it, and BE FORWARD disclaims
responsibility. OBSERVED: the Booking row "Reflect shipping company's vessel plan on to CAP" is performed
by *BE FORWARD / CAP*. INFERRED: ETD/ETA are copied from the shipping line's vessel plan by BE FORWARD.
UNKNOWN: how often or how ETA is revised, and whether any history exists server-side (none is displayed;
two loads were identical).

### 4.6 Documents (OBSERVED)
B/L, Export Certificate (with a "how to read this certificate" guide PDF) and Invoice, each a single
`GET` to a document endpoint that returns 200 and a file download; suggested names
`BL_<ref>.pdf`, `ExportCertificate_<ref>.pdf`, `<invoiceId>INVOICE.pdf`; the page stays on CAP. The B/L link
has **no JavaScript listeners** (REA listener inspection: found, 0 listeners); the other two links were not
inspected and are *INFERRED* to be plain anchors the same way. A note says an Adobe
Reader is needed for the B/L. A "Request Invoice Update" link leaves CAP for a different subdomain
(`mypage`). The document URLs carry **no token**; how they are authorized is `UNKNOWN` and deliberately
untested (§9).
Lifecycle as visible: *uploaded → customer proofread → feedback reflected → dispatched by courier*. The
dispatch tracking number is rendered as a DHL deep link; in this transaction the "tracking number" field
holds the **free text "Arrived at delivery address"**, and the DHL link is built around that text.

### 4.7 Stakeholders (OBSERVED / INFERRED)
Consignee block (the customer) and Notify-party block (BE FORWARD Tanzania), each with address and
contact fields; a "Document Center" panel (an agent at the discharge port); an "Agent" panel
("BFT (DOCUMENT)"); a support-agent avatar. INFERRED: the Document Center is chosen **by discharge
port** — the link is `/document_processing_centers#port49`, and that public page's `port49` section
("Dar Es Salaam") lists several centres, each with address, hours and a **SERVICES AVAILABLE** list (B/L
issue, delivery order issue, document dispatch, document holding, goods handover). The centre shown on
CAP matches one of those entries (same company and address), with a different contact email, so they are
related, not identical. *PUBLIC_DOCUMENTED:* the directory itself.

### 4.8 Customer actions
- **Exercised at runtime (REA scenario):** download B/L, export certificate, invoice. **Rendered only,
  not exercised:** photo downloads, the Document Center link (its public page was fetched separately),
  the language switch, and the invoice-update link (not followed — it leaves CAP).
- **`STATIC_ONLY`** (`customer.js`, not rendered here): **address confirmation/amendment** (confirm =
  `confirm_state=1`; amend → review → send = `confirm_state=2`) and **B/L proofreading** (confirm
  unchanged = `confirm_state=1`; amend in three groups — consignee fields, notify-party fields, free-text
  "other" — review → send = `confirm_state=2`; only changed groups are shown for review).
- **Inquiry** (`capfollowmail.js`, not triggered; it is a mutating POST): `POST /ajax/cap_follow_mail/<id>`
  for BE FORWARD's local clearing/forwarding services.
Because the transaction is past these steps, **no form and no `.btn` control exists in the rendered DOM**
(REA: selector `.btn` → `not_found`; 0 `<form>` elements).

### 4.9 Exception catalogue (observed anomalies)
- tracking-number field carrying a status sentence, rendered as a courier link;
- "Destination" blank;
- no actual arrival date (delegated to the Document Center);
- no per-row timestamps; no ETA history;
- a WAF challenge in front of the page (§5);
- typographic defects in status text ("Comfirmed").

## 5. Network contract and runtime/static findings

**OBSERVED (REA scenario network, metadata only).** `GET /customer/cap` first returns **202** (an AWS WAF
challenge: a challenge script, an `inputs` fetch and an `mp_verify` POST) and then **200** with the real
document. After that: 5 first-party scripts, 3 stylesheets and 17 images on `www.beforward.jp`, **51
requests to the image CDN**, and dozens of analytics/ad/consent/WAF requests. **No fetch/XHR in the load
carries business data**: all are analytics, ads, consent or WAF (some on `beforward.jp` subdomains such as
a server-side tagging host). No polling in the 2.5 s window; two loads had identical visible text (238 lines each,
0 differences) and identical tag structure.
**Access model (OBSERVED):** a **capability URL** — `/customer/cap?t=<32-hex>`, no username or password.
**STATIC_ONLY.** 16 scripts exported with a manifest; REA's analyzer parsed 12 scripts (6,173 AST nodes,
0 failures) and found **0 routes, 0 endpoints, 0 WebMCP declarations, no source maps** — but it **missed**
the concatenated URL `'/ajax/cap_follow_mail/' + uuid` that manual reading found, a limitation of the
analyzer. No `setInterval`/`setTimeout`/`EventSource`/`WebSocket` in any CAP script (**no polling**). The
AJAX that exists is site search autocomplete, the follow-mail inquiry and site-wide form helpers.
**Reconciliation.** Static and runtime agree that business data is server-rendered and that no client
logic computes status, ETA, transshipment or agents; the customer-action flows exist in code but their
runtime behaviour is unobserved. There is **no static/runtime contradiction**. Server-side behaviour
(how stage is derived, how a vessel plan updates, how agents are resolved) is **invisible to this method**.

## 6. REA-14/15 reconciliation matrix

| CAP question | Rendered | Runtime | Network | Static JS | Classification |
|---|---|---|---|---|---|
| Visible milestones | 14 rows / 5 groups | passive and scenario agree | document only | none | **OBSERVED** |
| How current stage is determined | all rows Completed; no current marker | — | none | none | **UNKNOWN** |
| Where ETA originates | ETD/ETA + "reflect vessel plan" row + disclaimer | — | server-rendered | none | **OBSERVED** (text) / **INFERRED** (source = shipping line) |
| ETA history | none shown | stable across 2 loads | none | none | **UNKNOWN** (none displayed) |
| Transshipment modelling | separate departure/arrival vessel labels; same vessel | — | — | no vessel/transship strings | **INFERRED** (capable) · not observed · server logic `UNKNOWN` |
| How documents load | 3 links + notes | click → GET 200 + download | plain GET, 0 listeners | none | **OBSERVED** |
| Destination agent resolution | agent + centre panels; port-anchored link | public directory captured | server-rendered | none | **INFERRED** (by discharge port) · directory **PUBLIC_DOCUMENTED** |
| How amendment works | no form rendered | `.btn` not found | none triggered | `customer.js` flows | **STATIC_ONLY** |
| Courier tracking | DHL link around status text | — | external link, not requested | none | **OBSERVED** (link) · call not observed |
| What controls conditional sections | completed state shows no forms | — | — | show/hide animations | **INFERRED** |

**Stability comparison (REA `compare_web_captures`, two identical SCN-01 runs):** REA reports `changed`
because the DOM hash differs by 36 bytes; the visible-text diff shows **0 changed lines** and the tag
histograms are identical, so the difference is attribute volatility, not content. State: **stable**.
An earlier comparison of two *different* scenarios returned `unknown` (different capture selections) and
supports no claim.

## 7. Unknowns register (not established; do not convert to implementation facts)

U1 pending / in-progress / delayed / failed row rendering · U2 how a stage becomes current · U3 ETA
revision frequency, mechanism and history · U4 multi-vessel / transshipment rendering and data model ·
U5 how document endpoints are authorized (not tested) · U6 actual-arrival date source · U7 open
address-confirmation and B/L-proofreading runtime behaviour · U8 what happens when a document is not yet
uploaded · U9 how the Document Center is chosen per transaction (rule) · U10 whether the Notify party is
ever someone other than the destination agent · U11 courier integration beyond a deep link ·
U12 customs/clearing state rendering for a customer who did not buy clearing.

## 8. Harness findings (not product defects)

- **HARNESS — connect-mode scenario fails on Chrome 155 with REA's default `service_workers:"block"`**:
  the initial navigation fails ("Scenario navigation failed before the initial state was captured").
  `"allow"` works; launch mode works. REA surfaces no exception text.
- **HARNESS — `compare_web_captures` rejected passive-capture JSON** (routed it down the scenario
  branch). Scenario-to-scenario comparison works.
- **HARNESS — evidence IDs are content hashes**, so a passive envelope containing the token cannot be
  edited into a shareable copy; the shareable artefact is the redacted manifest, not a bundle.
- **HARNESS — REA's endpoint extractor misses string-concatenated URLs**; read scripts manually too.
- The first CAP-SCN-01 attempt ran in connect mode against the Owner's tab and failed at the initial
  navigation; the tab was still on the CAP page afterwards (confirmed by a later target listing).

## 9. Boundaries kept

No authentication bypass, no token enumeration, no other transaction identifiers, no administrator
probing, no copying of BE FORWARD code, branding or assets into CarUp. Document endpoints were **not**
requested without the session, and neighbouring identifiers were not tried. No mutating action
(address, B/L amendment, invoice update, inquiry) was triggered. REA downloads were cancelled, so **no
document content was retained**, only metadata.

## 10. Preliminary gap view (not the REUSE/EXTEND/NEW decision — that is CAP-01 Part B)

| CAP capability | CarUp today (Part A) |
|---|---|
| Vehicle identity panel + photo set | vehicle passport exists; not shown in a journey |
| Actor-attributed stage table | T11 stage events carry actor and time (stronger than CAP); T4 rail is stale |
| Carrier / POL / POD / ETD / ETA | carrier, ports, planned vs observed dates exist; **no vessel/voyage/leg model** |
| Transshipment | none |
| B/L, certificate, invoice set | T8 documents with verification exist; cannot bind to a shipment |
| Customer B/L proofreading and amendment | none (T8 verification is reviewer-side) |
| Consignee / notify party | not yet confirmed (Part B to check) |
| Port-keyed agent directory with services | T12 per-case agent appointments only |
| Courier tracking number | none |
| ETA change alert / history | none (opportunity: CAP has neither) |

## 11. CAP-00 completion test (directive §5.21)

REA version: `rea-agents@6.7.0`. Target: one Owner-authorized CAP page on `www.beforward.jp`. Passive
evidence: target list, 2 inspections, screenshot, bundle analysis, listener inspections. REA-driven
actions: 6 page loads and 3 document-link clicks, all read-only. Rendered: §4. Runtime: §5–6 (customer
interaction not exercisable, D1). Network: §5. Static: §5. Agreement and conflict: no contradiction;
server-side logic invisible. Limitations: §3, §7, §8. Product contract: a server-rendered, capability-URL,
actor-attributed stage table with a vehicle panel, a single-vessel shipping panel, three documents with a
customer B/L proofreading flow, port-keyed document-centre contacts, and no timestamps, ETA history or
actual-arrival date.

**Handoff:** CAP-01 Part B may proceed — none of its decisions depends on which vehicle is linked. The
real-data association and CAP-STG01 UAT **do** depend on the vehicle decision (§1.1) and are held.
