# T11-CAP-LR01-R3 — R3-A audit: route · workspace · capability matrix

Controlling authority: [T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md](../T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md) §27 (the matrix) and §28 (the classification), as released by the Moderator's custody ruling. This is the audit the dispatch requires **before any product implementation**.

**Production Supabase `vhmnajoeicasaigiophh`: not accessed.** Staging `eoyenigwevnxwwhyhaer`: read-only SELECTs only — no write, no migration. **No product code changed.** **Seller Studio was not opened** (its autosave-on-open writes the vehicle row, §2.1); it is audited from its code.

## 0. Result

* The model holds. **No stop condition is proven** (§7). Seller and Trade share no conflicting write authority, vehicle identity is single, "does this vehicle have a readable import journey?" is answerable from the resolver that already exists, Kingston's authority is consistent, R2 is intact.
* **25 findings**, every one bounded UI / navigation / read-model work: 4 capability-visibility · 3 read-model · 5 navigation · 5 workspace-identity · 2 visual-consistency · 0 authorization · 6 pre-existing out-of-scope — plus seven `NO_DEFECT` determinations (§6).
* The three that matter most: **the Passport offers "Journey & arrival" for every vehicle** (the Serena gets one; it opens "no journey"); **the CAP page has no exit** (no link to its Import Order, none to the Vehicle Passport — Passport→CAP is one-way); and **My Listings treats every owned vehicle as a listing**, so the never-listed Vezel appears as an unpublished draft "needing action" with Publish and Buyer Preview buttons while My Garage says "Sell this vehicle".
* **A disclosure (§2.1):** the Vezel's vehicle row changed again **after R2 closed** — a second Seller Studio autosave at 2026-10-26T11:43:07Z, while this session was idle. It is the same six seller-draft columns R2 already explained; it is **not** caused by R3. The Serena's protected baseline is intact.
* **Decisions needed (§9):** D-1 (Seller Studio autosave vs. physical UAT) **before Step K**; D-2 (integration with the runtime lineage's different shells) and D-3 (My Listings semantics) carry stated defaults; D-4 wording is applied unless you object.

## 1. Custody and basis

| | |
|---|---|
| Authority commit / blob | `baf6804773a45ad03dc226f613088e1048ffd57d` / `35d94b60d63e312e16ce0c7030aaa93df7bfb9f6` (the dispatch, verbatim; two independent transcriptions byte-identical) |
| R3 branch | `feat/t11-cap-lr01-r3-workspace-navigation` (local = origin; no PR opened) |
| Starting parent | `f4b12b608efb7a9285d97bab01f44c17b8cbab0a`, the accepted R2 evidence head. R2 product authority `6c13fdc4481aec703b0b2189027143a8e3d1fe9d` is an ancestor; the range is three commits changing one file (the R2 return). PR #243 re-read: OPEN, DRAFT, head `f4b12b60`, unmerged |
| Code read | the R3 branch at `f4b12b60` — the **product lineage** |
| Physically observed | the R2 final Preview pair (web `carup-staging-cxz32nfyh-11-11.vercel.app`; exact deployed integration SHA `e28cbf25f05a76a05f3b41bacd95c586a36bb365` = the **runtime lineage** + R2), signed in as the real customer Kingston Musarurwa. Read-only walk **2026-10-27T02:52:37Z → 03:04:32Z**, then three as-is screenshots 03:09:34Z → 03:10:55Z (timestamps from the session log). **Page loads and read-only DOM measurements only — no click, no typing, no submit** |
| Data read | staging, read-only SELECTs: orders 02:59Z, trade profile 03:06Z, vehicles and counts 03:23Z–03:26Z (database clock 03:24:43Z) |
| Private evidence (not committed) | `~/carup-launch-evidence/t11-cap-lr01-r3/audit-as-is-r2-final-pair/` — three screenshots (Garage, Vezel Passport, Import Order detail), mode 600 |

**Evidence labels used below.** **L** = observed live in this audit. **L-R2** = observed live in the R1/R2 physical UAT, not re-opened here. **C** = read from source on the R3 branch.

**Two lineages — a constraint on the plan.** The product branch and the deployed candidate are different lineages (AUTH-05). Files R3 will touch that are **identical** in both: `SellerWorkspaceHeader.tsx`, `JourneyArrival.tsx`, `DiasporaTrade.tsx`, `TradeDocumentsWorkspace.tsx`, `MyShipmentTracking.tsx`, `MyCustomsDestination.tsx`. Files that **differ** (lines added/removed, candidate vs. product): `App.tsx` +252/−124, `DashboardLayout.tsx` +101/−67, `featureRegistry.ts` +319/−4, `VehicleProfile.tsx` +139/−30, `SellVehicle.tsx` +18/−8, `MyListings.tsx` +9/−1, `TradeOSWorkspaceLayout.tsx` +8/−3, `Communications.tsx` +6/−3, `DiasporaOrderPassport.tsx` +6/−3, `MyGarage.tsx` +1/−1. The candidate also adds a whole shell layer the product lineage lacks (`OrganisationSwitcher`, `CompactBottomNav`, a rewritten `MobileNavDrawer`/`Navbar`) and `web/api/public-page.ts`. Every claim below says which lineage it comes from.

## 2. The real data (staging, read-only)

| Fact | Value |
|---|---|
| Kingston's account | `u_66cace85fad949e4` — platform role `owner`, Trade participant (the trade profile has no organisation) |
| **Serena** `GFC27-027051` | 2016 Nissan Serena Highway Star · `owner_id` **and** `current_seller_id` = Kingston · `publication_status` `published`, `status` `Available` · `import_source` `import` · **no import order of any buyer links it** (an orders query by `linked_vehicle_vin` returned only the two orders below) |
| **Vezel** `RU3-1316558` | 2018 Honda Vezel · `owner_id` Kingston · `current_seller_id` **NULL** · `publication_status` `draft` (column default; NOT NULL), `status` `Pending` · `import_source` `diaspora_import` (written by the T4 ownership handoff) · governed photographs (50) · **one** linked, readable import order |
| Kingston's import orders | **two**, `buyer_id` = Kingston on both: `3e2b66a0-1e8b-43c9-bd48-507f88016f71` (2026-10-25; linked to the Vezel; `DOCUMENTS_PENDING`; 1 shipment; 3 T8 documents; requested make/model null) and `921d09ed-420d-46b1-8414-46376e0a29dd` (2026-09-05; **no linked vehicle**; `QUOTE_ISSUED`; no shipment; no make/model) |
| Trade profile | one `diaspora_trade_profiles` row: `role_type` `seller`, Japan / Tokyo, `PENDING_REVIEW`, created 2026-10-10 — a **profile classification** that gates nothing in the import or CAP paths (ND-5) |

### 2.1 Baselines at R3-A — and one disclosure

Re-read read-only, 2026-10-27 03:23Z–03:26Z.

| Record | Fingerprint now (`md5(row_to_json(t)::text)`) | Last recorded | Status |
|---|---|---|---|
| Serena `GFC27-027051` | `e9d216b9ca1eb39440d9be8ab39123e6` | same (R1; R2 return §13) | **unchanged — the protected baseline holds** |
| Vezel `RU3-1316558` | `308677ddad1c6ec206229e9060ff2352` | R2 return §16.3/§16.4: `1c764dc858b0029a011480a10d4bb4e6`; at ingestion `80823a186bc7beb2c071b64a0be677fd` | **changed after R2 closed** |
| Table counts | domain_events 1,947 · notification_queue 1,888 · import orders 221 · shipments 4 · vehicles 370 | identical to R2's end-of-run counts (R2 return §13) | nothing emitted, queued or created |

**The Vezel row moved again, and not through R3.** Setting the same six seller-draft columns (`seller_features`, `seller_listing_recorded_at`, `listing_location_recorded_at`, `listing_location_source`, `listing_location_visibility`, `seller_listing_claim_source`) back to NULL in a copy of the current row reproduces the ingestion baseline `80823a186bc7beb2c071b64a0be677fd` **exactly** — the R2 §16.3 method — so nothing except those six columns differs from ingestion. Their values are now `seller_listing_recorded_at = listing_location_recorded_at = 2026-10-26 11:43:07.74+00`, `seller_declared`, visibility `withheld`, `seller_features = []`; R2's first autosave stamped 07:46:00.978Z. That is a **second** autosave write, 1 h 27 min after R2's §16.4 re-pass ended (10:15:39Z).

*Why it is not R3 or this session:* this session made no tool call between 2026-10-26T10:23:34Z and 2026-10-27T01:34:22Z; its first browser action was at 02:52:37Z; every R3-A browser action was a page load or a DOM measurement; the counts above are unchanged. *What the evidence does show:* the signed-in browser's own console log (`.playwright-mcp/console-2026-10-26T10-13-47-986Z.log`, last written 11:42Z) ends with a request for `/api/marketplace/listings/RU3-1316558` answered 404 "Listing not found" at +5,304,015 ms, i.e. 11:42:12Z — someone opened the Vezel's listing page in that window 55 seconds before the autosave stamp. That is the path My Listings invites for a never-listed vehicle (CV-4: "Buyer Preview", "Continue listing"). The evidence does not say who.

*Consequences:* (i) the Vezel's R3 baseline is `308677dd…` (R2's `1c764dc8…` was correct when written); (ii) this is the live proof of PE-1 and the reason D-1 must be decided before Step K; (iii) **no restoration was attempted** — restoring the six columns is a staging write nobody has authorised.

## 3. The matrix (authority §27)

Defect IDs are those of §6. Evidence labels (L / L-R2 / C) are defined in §1.

| SURFACE | ROUTE | WORKSPACE | CANONICAL SUBJECT | PARENT CONTEXT | CURRENT ENTRY PATH | CURRENT EXIT PATH | CAPABILITY SOURCE | DESIGN FAMILY | DEFECT / NO DEFECT |
|---|---|---|---|---|---|---|---|---|---|
| **My Garage** | `/dashboard/garage` | self-labelled "Vehicle workspace"; owner shell — a 20-item sidebar (L) and an "Active portal" control (C: `DashboardLayout.tsx:151-154`) | the account's owned vehicles (`GET /api/vehicles/me`; two for Kingston) | back link "Seller / Owner home" → `/dashboard` — the Seller header's default (L, C) | sidebar "My Garage"; Passport "Back to Garage"; Seller Studio "Back to My Garage" | per vehicle: "View Vehicle Passport" → `/dashboard/garage/:vin` and one contextual button (published → "Manage listing" → `/dashboard/listings`; started → "Continue listing"; else "Sell this vehicle" → Seller Studio); "Add or sell a vehicle" → `/sell` (the public guest-sell funnel, another shell). **No Trade link.** (L: Vezel = Passport + Sell this vehicle; Serena = Passport + Manage listing) | client heuristic `contextualAction()` (`MyGarage.tsx:42-67`) over `current_seller_id`, `seller_description`, `seller_features`, `publication_status`; Trade: none | **F1 Seller editorial** (L: font-black 23, rounded-none 3, shadow 0, blur 0) | CV-3, DR-1, NV-5, WI-2, PE-6 |
| **Vehicle Passport** | `/dashboard/garage/:vin` | owner shell; **no workspace label** (L) | one vehicle (`/api/vehicles/:vin/passport` + evidence) | "Back to Garage" (static) (L) | Garage "View Vehicle Passport"; My Listings "Evidence & Trust"; Seller Studio ("Upload evidence to this Passport", post-save Passport link) | header row of **four static actions for every vehicle**: Back to Garage · **Journey & arrival** → `/diaspora/journey/vehicle/:vin` · **Edit / continue listing** → Seller Studio · **Listing & Marketplace** (orange primary) → `/dashboard/listings`; tabs Documents · Service History · Insurance · Parts · Evidence & Media (L: the same four for the Serena and the Vezel) | **none** — the actions are literals (`VehicleProfile.tsx:353-363`) | **F2 dashboard / shadcn** (L, Vezel: font-black 0, shadow 16, rounded-lg 9, text-gray 15) | **CV-1, CV-2**, DR-1, DR-3, VC-1, NV-5, WI-2 |
| **Seller Studio** | `/dashboard/sell-vehicle?vin=&stage=` | "Seller Studio" eyebrow; owner shell (C) | one vehicle's Seller listing draft (`PATCH /api/vehicles/:vin/seller-draft`) | "Back to My Garage" (static: `SellVehicle.tsx:1061-1062`) (C) | Garage contextual button; Passport "Edit / continue listing"; My Listings "Continue listing" / "Publication readiness"; guest `/sell` "Open my saved-draft flow" (`GuestSell.tsx:870`) | Back to My Garage; after save: Manage & publish listing → `/dashboard/listings`, Edit this draft, Passport link, Open My Listings (`:997-1033`); "Buyer Preview — not public" → `/marketplace/:vin?mode=seller_preview` (`:1123`); "Upload evidence to this Passport" (`:1302`) | the vehicle row; **no Trade, import or CAP reference in the page or its route** (C, grep) | **F1** editorial header over form cards (C: font-black 8, tracking-[ 7; but rounded-xl 6, rounded-lg 7, shadow 3) | **NO_DEFECT** (ND-1, ND-2); NV-5; **PE-1** |
| **My Listings** | `/dashboard/listings` | self-labelled "Commerce workspace"; owner shell | "vehicle listings" = **every owned vehicle** (`fetchOwnedVehicles`, `MyListings.tsx:152`) plus communications | back link "Seller / Owner home" | sidebar "My Listings"; Garage "Manage listing"; Passport "Listing & Marketplace"; Seller Studio "Open My Listings" | per row: Marketplace page, Continue listing, Buyer Preview / Public detail, Evidence & Trust (→ Passport), Publication readiness, Conversations, Publish / Unpublish; "Sell another vehicle" → `/sell` (L: "2 vehicle listings", Published 1, Need action 1; buttons "Publish to Marketplace" on the Vezel row, "Unpublish" on the Serena row) | `publication_status !== 'published'` over **all** owned vehicles (`:191-197`); no listing-capability filter | **F1** with card remnants (L: font-black 31, rounded-none 22, rounded-lg 8, shadow 27) | **CV-4**, WI-2, NV-5 |
| **Marketplace listing** | `/marketplace/:id` (+ `?mode=seller_preview`) — `VehicleDetail.tsx` | public Marketplace (public shell; not a protected business workspace) | one published listing (`/api/marketplace/listings/:id`) | "Home" and "Marketplace" links at the top of the page (L) | My Listings; Seller Studio Buyer Preview; public browse | "Back", "Compare this vehicle", "View All Listings", site navigation (L) | public projection | **F3 public marketing** (L: rounded-xl 17, shadow 42, backdrop-blur 4, text-gray 121) | NO_DEFECT for R3 (L: no CAP wording on the public listing — authority §20 holds); **PE-2**; (L: the Vezel's request returns 404 "Listing not found" — §2.1) |
| **Trade OS shell** | every operational `/diaspora/*` route (`TradeOSWorkspaceLayout`) | self-labelled "Trade OS" (rendered uppercase); identity line "Kingston Musarurwa · Trade participant · Zimbabwe trade operations" (L) | none (shell) | none (the logo → `/`, `TradeOSWorkspaceLayout.tsx:125`) | owner sidebar items (Import Orders, Start Import Order, Trade Profile, Request Quotes, Container Co-Loading…); direct URLs | Trade nav only, role-filtered (L: Request quotes · My requests · Shipping · Orders · Messages); **no link to My Vehicles or Marketplace** | registry `canRoleAccessRoute` | **S2** — slate-950 header, orange tracked eyebrow, tab nav (already echoes the Seller palette) | **WI-3, NV-4** |
| **Import Orders** | `/diaspora/imports` | Trade & Imports (shell) | the account's import orders (`/api/diaspora/import-orders`) | none (no crumb) (L) | owner sidebar "Import Orders"; Trade nav "Orders"; after "New import order" | row → order detail; "New import order"; shell nav | orders by `buyer_id`; **rows carry no vehicle identity** — the title is `requested_make \|\| 'Import'` + `requested_model \|\| order.id` (`DiasporaTrade.tsx:719`); L: both rows read "Import <order UUID> Vehicle from…" | **F4 Trade generic gray** (L: text-gray 73, rounded-xl 6, shadow 2) | **DR-2**, WI-3 |
| **Import Order Detail** | `/diaspora/imports/:id` | Trade & Imports | one order — H1 "Vehicle request" (`requested_make \|\| 'Vehicle'` + `requested_model \|\| 'request'`, `DiasporaTrade.tsx:556`); the linked vehicle is not shown | **none** — no "Back to Import orders", no crumb (L: 0 crumbs, no back link) | list row; creation redirect (`:771`) | three outline buttons at the foot of the page: Documents → `/diaspora/imports/:id/documents` · Shipment → `…/shipment` · **Journey & arrival** → CAP (`:1071-1081`). No Passport or vehicle link; no link to the order passport | order record; `linked_vehicle_vin` is not read | **F4** (L: text-gray 42, rounded-lg 4, shadow 12) | **NV-2**, DR-2, PE-4 |
| **CAP / Journey** | `/diaspora/journey/:subjectType/:subjectId` (order, or the vehicle resolver) | Trade & Imports (shell) | one import order's journey, titled by its vehicle ("2018 Honda Vezel") | **not shown** — the eyebrow reads "Journey & arrival · 3E2B66A0" only | Import Order "Journey & arrival"; Passport "Journey & arrival" (vehicle resolver); the multi-order chooser | shell nav; "Open the document workspace" ×4; eight in-page anchors and a six-tab strip. **No link to the Import Order, none to the Vehicle Passport** (L: both 0) | `getJourney`; the vehicle subject → `getVehicleJourney` (none / one / many, fail-closed) | **F5 Trade slate card** (L: text-slate 297, rounded-xl 17, rounded-lg 27, shadow 0) | **WI-5, NV-1**, VC-2; content frozen (ND-3) |
| **Documents** | T8 `/diaspora/documents/:subjectType/:subjectId`; legacy `/diaspora/imports/:id/documents` | Trade & Imports | the order's paperwork — "PURCHASE 3E2B66A0"; no vehicle identity (L) | none | CAP "Open the document workspace" ×4; Import Order "Documents" goes to the **legacy** page | **none** (L: 0 links, 0 buttons, 0 back) | T8 workspace read | F5-editorial hybrid (L: slate-950 18, text-slate 55, border-b-2 1, no rounded-xl/lg, no shadow) | **NV-3**, DR-2; PE-4 (legacy page) |
| **Shipping** | customer `/diaspora/imports/:id/shipment` ("Container & shipment"); Trade nav "Shipping" → `/diaspora/containers` | Trade & Imports | a container reservation for the order / the account's shipping requests | none | Import Order "Shipment"; Trade nav | none (L: 0 links; one "Request container space" button) | T5 reservations / T2 requests — **not** the T11 shipment CAP shows | F4 (shipment: L text-gray 22, shadow 3) / F5-editorial (containers: L slate-950 6, no rounded, no shadow) | **NV-3**; **PE-3** (L: "Nothing to ship yet" for an account with a live import shipment) |
| **Customs** | customer `/diaspora/my-customs/:subjectType/:subjectId`; operator `/diaspora/customs` | Trade & Imports | customs status of a **cargo reservation** | none | CAP link, only when a cargo-reservation link exists (none for the Vezel; `customsPath`) | none (L: 0 links) | T12 / T5 | F5 | NV-3; PE-5 (L: HTTP 400 for an `import_order` subject; the page says "We could not load the customs status… it is not a report that nothing has happened") |
| **Messages** | `/diaspora/messages` (Trade shell) **and** `/dashboard/communications` (owner shell) — one component, `App.tsx:334,405` | **both** | the account's conversations (L: "Your CarUp conversations across Marketplace and connected services · 23 unread"; My Listings counts 34 Marketplace conversations) | none | Trade nav "Messages"; owner sidebar "Communications Inbox"; My Listings "Conversations" | none | `fetchCommunicationThreads` (`business_workflow`, `thread_type`) | F4/F2 cards (L: rounded-xl 42, shadow 49, text-gray 96) | **WI-4** |

**Other order-scoped views** (outside the minimum list; they change the answer to "where is the order's home?"): the **Import order passport** `/diaspora/imports/:id/passport` (T4 compliance record) is the only order page with a parent link ("Import orders") and a link to the **transaction view** `/diaspora/transactions/:kind/:id` — but nothing on the Import Order Detail links to it (it is reached from `DiasporaContainerMarketplace.tsx:1008` and `TradeRequestDetail.tsx:419`). The order has three views — detail, passport, transaction — plus CAP, and none is connected to the others (NV-2); the word "passport" collides with the Vehicle Passport (WI-3).

**Target workspace per surface** (authority §12): *My Vehicles* — Garage, Vehicle Passport. *Marketplace / Selling* — Seller Studio, My Listings, the Marketplace listing. *Trade & Imports* — Import Orders, Import Order, CAP, Documents, Shipping, Customs, order passport. *Shared* — Messages (named by context, not owned by a workspace).

## 4. End-to-end journeys

### 4.1 Serena — `My Garage → Serena Passport → Seller / Marketplace`

| # | From → to | Control (label) | Target | Verified | Finding |
|---|---|---|---|---|---|
| 1 | Garage → Passport | "View Vehicle Passport" | `/dashboard/garage/GFC27-027051` | L, C | — |
| 1b | Garage → listings | "Manage listing" (published) | `/dashboard/listings` (generic, not vehicle-specific) | L, C | CV-4 |
| 2 | Passport → CAP | **"Journey & arrival"**, offered for every vehicle | `/diaspora/journey/vehicle/GFC27-027051` → "No journey yet" (the sentence is *"No import order or shipment is recorded for this vehicle that you can view, so there is no journey to show yet."*) | L (the action), L-R2 (the target page) | **CV-1** — a CAP action on a vehicle with no import order |
| 3 | Passport → Seller Studio | "Edit / continue listing" — the same label for a **published** listing (the Garage says "Manage listing") | `/dashboard/sell-vehicle?vin=GFC27-027051` | L, C | **CV-2** |
| 4 | Passport → listings | "Listing & Marketplace" (orange primary) | `/dashboard/listings` | L, C | CV-2 |
| 5 | Seller Studio → back | "Back to My Garage" (always) | `/dashboard/garage` | C | NV-5 |
| 6 | My Listings → Passport | "Evidence & Trust" | `/dashboard/garage/GFC27-027051` | C | — |
| 7 | My Listings → public page | the listing title | `/marketplace/GFC27-027051` | L, C | PE-2 |

### 4.2 Vezel local-sale path — `My Garage → Vezel Passport → Seller Studio`

| # | From → to | Control | Target | Verified | Finding |
|---|---|---|---|---|---|
| 1 | Garage → Seller Studio | "Sell this vehicle" (the Garage derives "no Seller activity yet") | `/dashboard/sell-vehicle?vin=RU3-1316558` | L, C | — |
| 1b | **Garage vs. My Listings** | the Garage says "Sell this vehicle"; **My Listings lists the same vehicle as an unpublished active draft "needing action"** with "Publish to Marketplace" and Buyer Preview | `/dashboard/listings` | L, C | **CV-4** — two Seller surfaces disagree about one vehicle |
| 2 | Passport → Seller Studio | "Edit / continue listing" | same URL | L, C | CV-2 |
| 3 | Seller Studio | the same page and route as the Serena; no import branching | — | C | **ND-1** |
| 4 | Seller Studio → back | "Back to My Garage" | `/dashboard/garage` | C | NV-5 |

### 4.3 Vezel Trade path — `Trade & Imports → Import Orders → Import Order → CAP`

| # | From → to | Control | Target | Verified | Finding |
|---|---|---|---|---|---|
| 1 | owner shell → Trade shell | sidebar **"Import Orders"** (one flat list shared with My Listings, Saved Cars…) | `/diaspora/imports` — the chrome changes to the dark "Trade OS" header; the sidebar disappears | L, C | WI-1, NV-4 |
| 2 | Import Orders → order | row titled **"Import 3e2b66a0-1e8b-43c9-bd48-507f88016f71 Vehicle from…"** (no vehicle) | `/diaspora/imports/3e2b66a0-…` | L, C | **DR-2** |
| 3 | Order → CAP | third of three outline buttons, "Journey & arrival" | `/diaspora/journey/import_order/3e2b66a0-…` | L, C | NV-2 |
| 4 | CAP → order | **none** | — | L, C | **NV-1** |
| 5 | CAP → documents | "Open the document workspace" | `/diaspora/documents/import_order/3e2b66a0-…` → a page with **no links** | L, C | NV-3 |
| 6 | Order → "Documents" / "Shipment" | outline buttons | the **legacy** documents page (C) and the **container** shipment page (L) — neither is what CAP shows | L, C | PE-4 |

### 4.4 Cross-workspace — `Vezel Passport → CAP → Vezel Passport`

| # | From → to | Control | Target | Verified | Finding |
|---|---|---|---|---|---|
| 1 | Passport → CAP | "Journey & arrival" | `/diaspora/journey/vehicle/RU3-1316558` — resolves the single readable order **in place** (`getVehicleJourney`, `readable.length === 1`); the URL stays the vehicle's | L (the action), C (resolver), L-R2 (the rendered journey) | WI-5 — the move changes shell with no label |
| 2 | CAP → Passport | **none**. The Trade shell has no My Vehicles link; its logo goes to the public home | — | L, C | **NV-1, NV-4** — one-way |

## 5. Design-family inventory

**Method.** **L** = the number of elements inside `<main>` whose class attribute *contains* the substring (a read-only DOM measurement of the rendered page; `text-gray` is `text-gray-`, `text-slate` is `text-slate-`). **S** = occurrences of the substring in the TSX source (`grep -o | wc -l`). The two are different metrics and are never mixed in one cell. Seller Studio was not opened, so it has S only.

| Family | Where | Signature |
|---|---|---|
| **F1 Seller editorial** *(the selected authority)* | `SellerWorkspaceHeader`; My Garage; My Listings; Seller Studio | `text-[10px] font-black uppercase tracking-[0.22em] text-orange-600` eyebrow; `border-b border-slate-200` header; back link `min-h-11 text-sm font-bold text-slate-500` with an orange focus ring (header lines 26–36). Garage L: font-black 23, rounded-none 3, shadow 0, blur 0 (S: font-black 15). Listings L: font-black 31, rounded-none 22, shadow 27 (S: 14 / 17 / 0). Header S: font-black 2, tracking-[ 2. Studio S: font-black 8, tracking-[ 7, with rounded-xl 6, rounded-lg 7, shadow 3 in its form cards |
| **F2 Dashboard / shadcn** | Vehicle Passport; most owner-dashboard pages; `DashboardLayout` | Passport L: font-black 0, shadow 16, rounded-lg 9, rounded-xl 4, text-gray 15, orange 61 (S: font-black 0, tracking-[ 0) |
| **F3 Public marketing** | Marketplace listing (`VehicleDetail.tsx`); public shell | L: rounded-xl 17, shadow 42, backdrop-blur 4, text-gray 121 |
| **F4 Trade generic gray** | Import Orders, Order detail, shipment, Messages, order passport | Orders list L: text-gray 73, rounded-xl 6, shadow 2 · detail L: text-gray 42, rounded-lg 4, shadow 12 · shipment L: text-gray 22, shadow 3 · Messages L: text-gray 96, rounded-xl 42, shadow 49 · order passport L: rounded-xl 12, shadow 38 |
| **F5 Trade slate** | CAP; customs; tracking; Documents; Shipping | CAP L: text-slate 297, rounded-xl 17, rounded-lg 27, shadow 0 (S: text-slate 97) · Documents L: slate-950 18, text-slate 55, border-b-2 1 (closest to F1) · Shipping L: slate-950 6, no rounded, no shadow |
| Shells | **S1** owner (`DashboardLayout`): white 64-wide sidebar, orange-50 active item, `bg-white/95 backdrop-blur` bar, "Active portal" · **S2** Trade OS (`TradeOSWorkspaceLayout`): `bg-slate-950`, `text-[11px] uppercase tracking-[0.18em] text-orange-400` eyebrow, tab strip · **S3** public (`MainLayout`) | |

Findings from this: **VC-1** (the Passport is F2 between two F1 pages) and **VC-2** (the Trade workspace is F4 and F5, never F1).

## 6. Findings (authority §28 — exactly one class each)

| ID | Class | Surface | Finding | Evidence | R3 disposition |
|---|---|---|---|---|---|
| **CV-1** | CAPABILITY_VISIBILITY_DEFECT | Passport | A "Journey & arrival" action is rendered for **every** vehicle; the Serena (no import order) gets one and it opens "No journey yet". R1 chose a universal link on purpose ("the Journey page itself says which of those it is"); the R3 authority (§8) supersedes that — the CTA must follow a real readable capability. | `VehicleProfile.tsx:357`; `VehicleProfile.journeyLink.test.tsx` (two tests assert the same link for any vehicle; the third — order detail → `/diaspora/journey/import_order/<id>` — stays); L, Serena Passport | **Fix** — conditional on the capability; replace the two tests |
| CV-2 | CAPABILITY_VISIBILITY_DEFECT | Passport | The Marketplace actions are static: "Edit / continue listing" for any state (published → the Garage says "Manage listing"), and the orange primary "Listing & Marketplace" goes to the generic list. No Marketplace state is shown. | `VehicleProfile.tsx:360,363`; L | **Fix** — one derived Marketplace capability |
| CV-3 | CAPABILITY_VISIBILITY_DEFECT | Garage | The base vehicle card carries Seller concepts for every vehicle ("Asking Price", "Commerce lifecycle: Draft") and **no Trade & Import state** — the Vezel's card never mentions its import journey. | `MyGarage.tsx:191,204`; L | **Fix** — identity first, then independent Marketplace and Trade rows |
| CV-4 | CAPABILITY_VISIBILITY_DEFECT | My Listings (+ Garage) | "My Listings" is populated from **all owned vehicles**, so a never-listed vehicle shows as an unpublished active draft needing action with Publish and Buyer Preview; the Garage derives the same vehicle's state differently. `VEHICLE != MARKETPLACE LISTING` is violated in the UI, and the invitation is not harmless — it is the path that reaches the autosave (§2.1). | `MyListings.tsx:152,191-197`; L ("2 vehicle listings", Need action 1) | **Fix** — one derivation; D-3 |
| DR-1 | DATA_READ_MODEL_DEFECT | Passport, Garage | No lightweight, authorization-safe answer to "does this vehicle have a readable import journey: none / one / many / unavailable?". The resolver exists only inside the full journey composition. | `journeyProjectionService.js:574-617` | **Additive read** (§8); no migration |
| DR-2 | DATA_READ_MODEL_DEFECT | Import Orders, Order detail, Documents | Orders carry no vehicle identity: rows titled by UUID, H1 "Vehicle request", "PURCHASE 3E2B66A0". The data exists (`linked_vehicle_vin` → `vehicles`); the order endpoints do not read it. | `DiasporaTrade.tsx:719,556`; L | **Additive field** — a minimal linked-vehicle title, only when the viewer owns the vehicle (§8) |
| DR-3 | DATA_READ_MODEL_DEFECT | `/vehicles/me`, Passport | No derived Marketplace capability; clients infer it from field heuristics. `'draft'` is the column default for every vehicle, and the heuristic reads `seller_features`/`seller_description`, which the Studio autosave writes on open. | `MyGarage.tsx:42-67`; `server.js:3963`; column default `'draft'::text` | **Additive block** in the R2 pattern |
| NV-1 | NAVIGATION_DEFECT | CAP | No exit to the Import Order, none to the Vehicle Passport. | L: 0 / 0; `JourneyArrival.tsx:190-202` | **Fix** — `WorkspaceExitActions` + breadcrumbs (chrome only) |
| NV-2 | NAVIGATION_DEFECT | Import Order detail | No parent link, no vehicle/Passport link, no link to the order passport; CAP is the third outline button at the foot. | `DiasporaTrade.tsx:1071-1081`; L | **Fix** |
| NV-3 | NAVIGATION_DEFECT | Documents, import shipment, customs | Dead ends: 0 links in `<main>`, no parent or subject link. | L; `TradeDocumentsWorkspace.tsx` imports no `Link` | **Fix** — back-to-order + breadcrumb |
| NV-4 | NAVIGATION_DEFECT | Trade shell | No route to My Vehicles or Marketplace; the logo goes to the public home. The owner sidebar reaches the Trade shell, but nothing returns. | `TradeOSWorkspaceLayout.tsx:19-30,125`; L | **Fix** — cross-workspace links in the shell nav |
| NV-5 | NAVIGATION_DEFECT | Passport, Seller Studio, Garage, Listings | Parent links are static literals ("Back to Garage", "Back to My Garage", "Seller / Owner home"), not where the user came from or what they are working on. | `VehicleProfile.tsx:353`; `SellVehicle.tsx:1061-1062`; header default `SellerWorkspaceHeader.tsx:9-10` | **Fix** — canonical breadcrumb parent |
| WI-1 | WORKSPACE_IDENTITY_DEFECT | Owner shell | One flat sidebar mixes My Vehicles, Marketplace and Trade items (Import Orders, Start Import Order, Trade Profile, Drive Connections, Request Quotes, Container Co-Loading beside My Listings, Saved Cars…); the only identity is "Active portal" (a platform role). | L: 20 items | **Fix at page level**; D-2 |
| WI-2 | WORKSPACE_IDENTITY_DEFECT | Garage, Listings, Studio, Passport, Trade pages | Workspace names disagree: "Vehicle workspace", "Commerce workspace", "Seller Studio", the header default "Seller workspace"; the Passport and every Trade page name none. | `SellerWorkspaceHeader.tsx:6`; `MyGarage.tsx:97`; `MyListings.tsx:217` | **Fix** — My Vehicles / Marketplace / Trade & Imports |
| WI-3 | WORKSPACE_IDENTITY_DEFECT | Trade shell, order pages | The workspace calls itself "Trade OS"; the T4 "Import order passport" collides with "Vehicle Passport". | `TradeOSWorkspaceLayout.tsx:131`; L | **Fix** wording; D-4 |
| WI-4 | WORKSPACE_IDENTITY_DEFECT | Messages | One inbox mounted in both shells; Marketplace conversations appear under the Trade workspace chrome. | `App.tsx:334,405`; L | **Fix** — label / default filter only |
| WI-5 | WORKSPACE_IDENTITY_DEFECT | CAP | The header names no workspace and no parent; the in-page "Journey / Documents / Vehicle / Payments / Customs / Messages" tab strip can read as workspace navigation. | `JourneyArrival.tsx:192-239`; L | **Fix** — chrome above the tabs only |
| VC-1 | VISUAL_CONSISTENCY_DEFECT | Passport | The base vehicle page is the shadcn card family (font-black 0, shadow 16) between two editorial pages. | §5 | **Fix** — header/chrome grammar; the body is not restyled |
| VC-2 | VISUAL_CONSISTENCY_DEFECT | Trade pages | Trade pages use F4 and F5; none uses the Seller grammar. | §5 | **Fix** only the chrome R3 introduces (§30-G) |
| PE-1 | PRE_EXISTING_OUT_OF_SCOPE | Seller Studio | Autosave-on-open `PATCH`es six draft columns on the real row; **it has now happened twice on the Vezel** (07:46Z in R2, 11:43Z after R2 closed) and would happen on the Serena the first time its Studio is opened. | `SellVehicle.tsx:479-520` (guard `:480`, debounce `:518`); §2.1 | **Not repaired** unless the Moderator authorises (D-1; authority §39) |
| PE-2 | PRE_EXISTING_OUT_OF_SCOPE | Marketplace listing | The runtime lineage's `web/api/public-page.ts` answers HTTP 503 + `noindex` for `/marketplace/:id`; L: the Serena's listing returns 503 on the Preview, `carup-staging.vercel.app` and `staging.carup.dev` (the list page returns 200; the SPA still renders the listing). Not in the product lineage. | live `curl`; candidate `public-page.ts:11-26` | Note for UAT |
| PE-3 | PRE_EXISTING_OUT_OF_SCOPE | Trade "Shipping" | "Nothing to ship yet" for an account with a live import shipment: that page is T2 requests / T5 co-loading, not T11 shipments. | L | Separate programme |
| PE-4 | PRE_EXISTING_OUT_OF_SCOPE | Order detail | T3-era "Required documents: Pending" beside "Uploaded documents: … Uploaded", and a container-era status timeline for a RoRo vehicle order. | L | Separate programme; R3 relabels entries only |
| PE-5 | PRE_EXISTING_OUT_OF_SCOPE | Customs | `my-customs` serves cargo reservations; an `import_order` subject returns 400 and is unreachable from the UI. The page words the failure honestly. | L; `journeyDisplay.ts` `customsPath` | — |
| PE-6 | PRE_EXISTING_OUT_OF_SCOPE | Garage | "Add or sell a vehicle" leaves the owner shell for the public guest-sell funnel `/sell`. | `MyGarage.tsx:109`; `GuestSell.tsx:869-870` | — |

**`NO_DEFECT`.**
**ND-1** Seller Studio is one product for any vehicle. In the Seller-side files there is no import-specific branch: `MyGarage` and `SellerWorkspaceHeader` have no Trade/journey reference at all; `SellVehicle`'s only hits are a comment on the R2 private-photograph fallback and a comment containing "Seller Journey S4"; `MyListings`' only hit is the words "Seller journey"; the `seller-draft` route (`server.js:3486-3700`) has none. The **only** Seller-side Trade reference is the Passport's CAP link (CV-1). The §18 rule therefore holds by construction, and R3 only has to *prove* and *guard* it.
**ND-2** Seller Studio's own header answers where / what / from-where / next (eyebrow, object identity, back link, stage controls).
**ND-3** CAP content and semantics (R2, frozen).
**ND-4** Authorization. `getVehicleJourney` filters every order through `canReadImportOrder`; an unrelated viewer gets the same denial whether the vehicle is missing or just not theirs; an owner whose vehicle has no order *they may read* gets the neutral "no journey… that you can view" sentence, so an order they may not read is indistinguishable from none, by design. **No `AUTHORIZATION_DEFECT` found.**
**ND-5** The trade-profile `role_type` (`seller`) is used only for profile CRUD and graph constants, never to gate an import, order or CAP read; order authority is `buyer_id`.
**ND-6** Several readable orders ⇒ the chooser, never a guess (`JourneyArrival.tsx:260-274`; R1 tests).
**ND-7** The governed-media / listing-media boundary (R2).

## 7. Stop conditions (authority §29 conditions 1–8, plus the two the Moderator's release added)

| # | Condition | Proven? | Evidence |
|---|---|---|---|
| 1 | Seller and Trade share a conflicting write authority | **No** | No code in `backend/services/diaspora` updates, upserts or deletes a `vehicles` row (grep: only `select`, plus one `insert`). That insert, `insertVehicleIdentity` in the T4 handoff, creates an identity row **only when the VIN has none** — `status 'Pending'`, `publication_status 'draft'`, `price 0`, `import_source 'diaspora_import'`, **no owner or seller columns** — and refuses with a typed 409 (`OWNERSHIP_HANDOFF_CONFLICT`) when the VIN belongs to another context. Its other writes are two link columns (`vehicle_import_records.vehicle_vin`, `diaspora_import_orders.linked_vehicle_vin`), a timeline event, a domain event, a notification and the order's handoff marker. Trade writes the vehicle row once, at creation; Seller flows write it afterwards. |
| 2 | Safe CAP availability needs a material backend redesign | **No** | `getVehicleJourney` already resolves none / one / many with `canReadImportOrder` (`journeyProjectionService.js:574-617`); a thin read sharing its first lines answers the question (§8). |
| 3 | Vehicle identity duplicated between Marketplace and Trade | **No** | One `vehicles` table; orders link by `linked_vehicle_vin`; `diaspora_stock_items` is **parts** stock (`part_name`, `part_number`, `oem_number`, SKU, vehicle fitment make/model/year range), not vehicles. |
| 4 | Kingston's transaction authority materially inconsistent | **No** | Buyer on both orders; owner of the Vezel; owner and seller of the Serena; the `seller` trade profile gates nothing (ND-5). |
| 5 | Current R2 product head no longer matches accepted authority | **No** | `6c13fdc4` is an ancestor of `f4b12b60`; the range is three docs-only commits changing the R2 return; PR #243 re-read OPEN / DRAFT / head `f4b12b60`; the R2 branch on origin is at `f4b12b60`. |
| 6 | Authority document differs from the dispatch | **No** | committed verbatim (blob `35d94b60…`; two independent transcriptions byte-identical). |
| 7 | Fix requires Production access | **No** | — |
| 8 | Scope requires reopening T8 / T11 / T12 | **No** | all fixes are chrome, links, labels and additive reads. |
| 9 | The Seller design-reference surfaces materially differ from the authority | **No** | `SellerWorkspaceHeader`, `MyGarage` and `SellVehicle` exhibit exactly the §22 grammar (§5). |
| 10 | Scope materially larger than workspace / navigation / capability | **No** | Every finding is chrome, a link, a label or an additive read. The lineage drift (§1) is an **integration** constraint, not extra scope; it is handled in D-2. |

## 8. Can the read model answer the capability questions?

| Question | Today | Gap | Proposal (read-only, no migration) |
|---|---|---|---|
| Does this vehicle have a **readable import journey**: none / one / many / unavailable? | Only inside the full `getVehicleJourney` → `getJourney` composition | no cheap, batchable answer; an Owner list would need N full compositions | `getVehicleImportCapability` in the same service, sharing the resolver (refactor `getVehicleJourney` to call it so the rule lives once): `{state: 'none' \| 'single' \| 'multiple' \| 'unavailable', order_id?, count}`; batched for `/vehicles/me` (one orders read `IN (vins)` + one participants read) |
| What is this vehicle's **Marketplace capability**: published / in progress / not listed? | `publication_status` (`'draft'` for every vehicle by default) + seller columns, inferred client-side | no single derivation; Garage and Listings disagree (CV-4) | a pure `deriveMarketplaceCapability(vehicle)` in `backend/utils` (unit-testable), exposed as an additive owner-only `capabilities.marketplace` |
| What is the **vehicle behind this order**? | `orders.linked_vehicle_vin` → `vehicles` (not read by the order endpoints) | DR-2 | add `vehicle: {vin, title}` to the order list/detail **only when the viewer owns that vehicle** — the precedent is `tradeTransactionPassportService.js:522-535`, which carries a VIN "ONLY when the vehicle exists and belongs to this buyer" |
| Did the read **fail**? | n/a | must never become "none" | each block carries `unavailable` on a fault and never fails the host response (the R2 `governed_media` pattern) |

**Two traps the derivation must avoid.**
(1) **`import_source` is not a capability signal.** It is free-text provenance ('local', 'Local', 'Japan', 'UK', 'import', 'diaspora_import'…). The Serena carries `import_source = 'import'` and has no Trade order; a CTA keyed on that word would misclassify it. The CTA is driven by a readable linked order, nothing else.
(2) **Autosave-stamped columns are not Seller activity.** `seller_listing_recorded_at` and `listing_location_recorded_at` are written by merely opening the Studio (PE-1); counting them would flip a never-listed vehicle to "in progress" the moment anyone looked at it. Seller activity means real content (`current_seller_id`, description, selected features, a price, a publication).

**Authorization vs. fault.** An order the viewer may not read ⇒ `none` (by design; no information leaks). A read that *failed* ⇒ `unavailable`, with no CTA and the plain sentence that the status could not be loaded — never "no journey". The customs page already words its own failure this way (PE-5).

Delivery pattern: the R2 `governed_media` block on `/api/vehicles/me` and the passport route (key-disjoint, owner-only, fault-isolated, `Cache-Control: private`). No table, column or policy change.

## 9. Recommended implementation scope (exact) and the decisions needed

### Decisions for the Moderator

* **D-1 — Seller Studio autosave vs. physical UAT (needed before Step K).** §34 requires entering Seller Studio from the Vezel Passport, and §31 requires the Serena journey to reach "Manage Listing / Seller Studio" without changing the Serena's real business state. Opening the Studio fires `PATCH /api/vehicles/:vin/seller-draft` and re-stamps `seller_listing_recorded_at` / `listing_location_recorded_at` (§2.1 shows it has now happened twice on the Vezel); on the Serena it would move the protected fingerprint `e9d216b9…`. Options:
  **(a)** Authorise a minimal, separately classified guard in R3 — send no `PATCH` until the form differs from the loaded draft (one effect in `SellVehicle.tsx`, tested, no lifecycle change). This is a Seller-lifecycle product change, so under §39 it is your decision. **Recommended:** it makes both vehicles safe to open and removes the hazard the Owner just triggered unaided.
  **(b)** **Default if no ruling:** no product change. UAT opens the Studio **only for the Vezel** (as §34 requires), with a before/after fingerprint ledger starting from `308677dd…` and the six-column proof; the Serena goes Passport → Manage Listing (My Listings, which writes nothing) and the Studio's appearance is evidenced by code and test equivalence (the Studio is one component for both vehicles, ND-1), not by opening it.
  **(c)** (b) plus an authorised staging restoration of the six Vezel columns after UAT.
  Until ruled, **Seller Studio is not opened on any real row.**
* **D-2 — integration with the runtime lineage.** The runtime lineage's owner shell differs materially (§1). Recommended: do **not** rewrite `DashboardLayout` or the registry sidebar; ship workspace identity, breadcrumbs, capability and exits as **page-level, shell-agnostic components**, and limit shell edits to the Trade shell's navigation (a small change, near-identical in both lineages). The pages R3 edits are the same ones the UAT-candidate merge has to reconcile anyway.
* **D-3 — My Listings semantics.** Show only vehicles whose derived Marketplace capability is *published*, *in progress* or *sold*; a never-listed vehicle is absent (it remains in My Garage). This changes locked Seller UX (`SellerWorkspaceConvergence.test.ts`, the `MyListings.*` tests); they are updated deliberately, not weakened.
* **D-4 — wording (applied unless you object):** workspaces **My Vehicles · Marketplace · Trade & Imports**; the Trade eyebrow "Trade OS" → "Trade & Imports"; the action "Journey & arrival" → **"View CAP"** (the page keeps its content); "Import order passport" is never adjacent to "Vehicle Passport" without a qualifier.

### Scope

**Web (product lineage), in the authority's order.**
1. **Step C — extraction, documented before use** (`web/src/components/workspace/`; none exists today; `ui/breadcrumb.tsx` already exists and is reused): `WorkspaceBreadcrumbs`, `VehicleContextHeader`, `VehicleCapabilityPanel` (Marketplace and Trade & Import rows, independent), `WorkspaceExitActions`, a page-level workspace bar/label, and one `workspaceModel` (the three workspaces, their labels and roots). `SellerWorkspaceHeader` stays and gains no breaking change.
2. **Pages.** *Garage* (capability rows on the base card; one derivation). *Vehicle Passport* (header + capability panel replace the four static buttons; the CAP action targets `/diaspora/journey/import_order/:orderId` when the capability is *single* and the vehicle resolver/chooser when *multiple*; the body is not restyled). *My Listings* (derivation + workspace label). *Seller Studio* (workspace label and contextual parent only — no behaviour change unless D-1(a)). *Import Orders / Order detail* (vehicle identity, breadcrumbs, CAP as the primary action, Passport link where the viewer owns the vehicle, link to the order passport). *CAP* (chrome above the tabs only: breadcrumbs, workspace label, Back to Import Order, View Vehicle Passport, links to Documents / Shipping / Customs / Messages that exist). *Documents / import documents / import shipment / customs / order passport* (breadcrumb + back-to-order). *Trade shell* (label; links to My Vehicles and Marketplace). *Messages* (workspace label; default filter).
3. **Tests.** Replace the two R1 universal-link tests with the capability matrix (Serena: no CAP action; Vezel: View CAP; several orders: chooser, no guess; read failed: not "none"); one navigation test per hop in §4; domain-isolation tests (CAP availability ≠ Seller state; publication ≠ CAP state; account role ≠ transaction role; Seller Studio contains no Trade control); component tests (workspace label, breadcrumb parent, focus order, 390 / 768 / 1280 / 1920); the existing Seller, CAP, D2 and isolation suites stay green; `SellerWorkspaceConvergence.test.ts` changes only where D-3 requires. Negative controls for every new guard (`tsc -b`, mutation at ≤ 2 workers).

**Backend (additive, read-only, no migration).** `getVehicleImportCapability` (+ batched) and `deriveMarketplaceCapability`; an owner-only `capabilities` block on `/api/vehicles/me` and the passport route; a `vehicle` title on the order list/detail only where the viewer owns the vehicle. Faults degrade to `unavailable`. Tests: pure derivation, authorization (an unrelated user learns nothing; "none" and "not yours" read identically), the batching bound, and no write.

**Not touched:** the R2 CAP compositor and its 14-row ledger, T8 / T11 / T12, D2, private media/document security, every migration, Production. `DashboardLayout.tsx`, the registry sidebar and `App.tsx` routes are left alone unless D-2 is overruled.

**Process.** On opening the R3 PR, re-verify the inherited CI reds live (T3 SAILING MATCH, UNGOVERNED_BRANCH, the FX file) rather than assuming them. Step K needs a new exact-head integration candidate (a backend built from the product lineage cannot sign in — AUTH-05) that names both SHAs, keeps runtime-only changes attributable and never mutates canonical staging. Record fresh fingerprints at the start of Step K; do not rely on this document's.

**Order:** C extraction → D workspace identity → E Passport capability → F Garage → G CAP chrome → H Trade parent flow → I Seller regression → J responsive / accessibility → K physical UAT as Kingston (D-1 resolved first).

## 10. Recommendation

No stop condition is proven; every finding is bounded UI, navigation or additive read-model work; the model, the real data and R2's frozen plumbing agree with the authority. The one thing the audit turned up that nobody asked for — the Vezel row's second autosave — is disclosed, attributed to neither R3 nor this session, and is the argument for deciding D-1 early. Decisions D-2, D-3 and D-4 carry stated defaults; **D-1 must be decided before physical UAT**.

`RECOMMEND PROCEED TO R3 IMPLEMENTATION`
