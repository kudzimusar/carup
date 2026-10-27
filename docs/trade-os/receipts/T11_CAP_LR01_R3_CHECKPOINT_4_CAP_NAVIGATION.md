# T11-CAP-LR01-R3 — Checkpoint 4: CAP navigation (Steps G and H), with Step I

Authority: [T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md](../T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md) §7, §30-G/H/I, §47 (Checkpoint 4), under Moderator rulings D-1 (autosave guard), D-2 (page-level chrome), D-3 and D-4 (wording).
Commits: Step G `3e04cd83`; Step H `79d66849` and `24707f70`; Step I `9814a1c3`. Base for this receipt: Checkpoint 3 `f0445d48`.
**No migration. Production not accessed. Staging not read in this step.**

## 1. Result

| Gate (authority §47, Checkpoint 4) | Proved by |
|---|---|
| CAP clearly belongs to Trade & Imports | §2 — the journey draws the Trade & Imports workspace bar (once: the shell draws it, the page does not repeat it), the trail `Trade & Imports / Import Orders / <vehicle> / Journey & arrival`, and never a Seller or Marketplace control. The Seller pages draw `Marketplace`; the Garage and Passport draw `My Vehicles`. |
| No navigation dead end | §3 — every page between the Import Orders list and the customer's cargo pages has a labelled way up, and every way up and every exit is a real link. Every hop in the matrix of §3 is a test that clicks the control and reads where the router lands; none uses the browser Back button. |
| Import Order and Passport are both understandable parent / adjacent contexts | §3 rows 2, 5, 11, 13 — the journey's parent is its **Import Order**; the **Vehicle Passport** is an adjacent exit, offered only when the order endpoint has shown the viewer owns the vehicle, and it is also offered from the Order, Documents and Order details pages. |

## 2. What a user sees now, page by page

| Page | Route | Workspace bar | Trail | Way up | Adjacent |
|---|---|---|---|---|---|
| Import Orders | `/diaspora/imports` | Trade & Imports | — (it is the workspace root) | Back to dashboard | rows → Import Order |
| Import Order | `/diaspora/imports/:id` | " | Trade & Imports / Import Orders / **2018 Honda Vezel** | Back to import orders | **Journey & arrival (primary)**, Documents, Shipment, Order details, View Vehicle Passport (owner only) |
| Trade documents | `…/:id/documents` | " | … / <order> / Trade documents | Back to import order | — |
| Container & shipment | `…/:id/shipment` | " | … / <order> / Container & shipment | Back to import order | — |
| Order details (was "Import order passport") | `…/:id/passport` | " | … / <order> / Order details | Back to import order (its own button) | Journey & arrival, View Vehicle Passport (owner only) |
| **Journey & arrival (CAP)** | `/diaspora/journey/…` | " | … / <vehicle> / Journey & arrival | **Back to import order** | **View Vehicle Passport** (owner only); R2's own Documents / customs links unchanged |
| Documents & evidence (T8) | `/diaspora/documents/…` | " | for an import order: … / <order> / Documents & evidence; any other transaction: Trade & Imports / Documents & evidence | Back to import order (import orders only) | Journey & arrival, View Vehicle Passport (owner only) |
| Where your cargo is / Your cargo & customs / Your cargo and the container / Your cargo | `/diaspora/tracking`, `…/my-customs`, `…/cargo-loading`, `…/cargo` | " | Trade & Imports / **Journey & arrival** / <page> | Back to journey & arrival | the pages' own links (unchanged) |
| Messages (inside the Trade shell) | `/diaspora/messages` | " (shell) | — | — | labelled **Messages**; the same inbox as `/dashboard/communications` |

An order is **named** from the most specific thing the viewer is entitled to know: the vehicle it carries (owner or current seller only) → what was requested → `Import order 3E2B66A0`. It is never "Vehicle request" and never `Import <uuid>`; the whole id is never printed (asserted).

## 3. The navigation matrix — explicit controls only

Each row is a test that clicks the control and reads the router's location.

| # | From → To | Control | Test |
|---|---|---|---|
| 1 | Import Orders → Import Order | the row | `DiasporaTrade.workspace` "Import Orders → Import Order, by the row" |
| 2 | Import Order → CAP | the primary **Journey & arrival** button | " it.each × 5 |
| 3 | Import Order → Documents / Shipment / Order details / Vehicle Passport | its buttons | " it.each × 4 |
| 4 | Import Order → Import Orders | Back to import orders | " |
| 5 | **CAP → Import Order** | Back to import order, and the vehicle's step in the trail | `JourneyArrival.workspace` × 2 |
| 6 | CAP → Import Orders / Trade & Imports | the trail and the workspace tab | " |
| 7 | **CAP → Vehicle Passport** (owner) | View Vehicle Passport | " |
| 8 | CAP → Documents | R2's own link inside the journey (unchanged) | " |
| 9 | CAP → My Vehicles / Marketplace | the workspace bar | " |
| 10 | Trade documents / Container & shipment → Import Order | Back to import order | `DiasporaTrade.workspace` × 2 |
| 11 | T8 Documents → Import Order, Journey, Vehicle Passport | way up + exits | `TradeDocumentsWorkspace.workspace` |
| 12 | Order details → Import Order, Journey, Vehicle Passport | its back button + exits | `DiasporaOrderPassport.workspace` × 3 |
| 13 | Tracking / Customs / Loading / Intake → Journey | Back to journey & arrival | `cargoPages.workspace` × 4 |
| 14 | Customs → Tracking, Tracking → Loading | the pages' own links (unchanged) | " |

## 4. Who is offered what

* **A link is offered only if the viewer's role can open its destination** (the feature registry's rule — the one the router and the workspace bar already apply). A dealer or reviewer may read the journey but cannot open the owner's Import Order page: for them the trail is complete **as text**, the way up is absent, and exits they cannot open are dropped. Asserted for the trail, the way up and the exits, in `TradeOrderChrome`, `TradeCargoChrome`, the journey and the T8 workspace.
* **The Vehicle Passport link needs proof of ownership, not a role.** It appears only when `GET /diaspora/import-orders/:id` named the vehicle to the viewer — the endpoint does that only for the vehicle's owner or current seller (Checkpoint 3). No answer, a null answer, a failed read, or a late answer for an order you have left all mean *no link and no claim* (asserted, including the race and an unstable-fetcher fetch storm).
* **An unreadable page does not leak.** The journey and T8 workspace, when they cannot be read, show a generic trail and link to no order the viewer may have been refused; the order id is never printed.
* **No private identifier was added to a default view.** The CAP header does not print the chassis or frame number (it is already inside the Vehicle section for the viewer who is shown it).

## 5. Decisions taken inside the ruling (so they can be overruled)

1. **Each trail ends on the page's own title** ("Journey & arrival", "Trade documents", "Documents & evidence", "Container & shipment", "Order details", …), not on a programme name. Two document pages exist today (the legacy "Trade documents" and T8 "Documents & evidence"); each is named truthfully rather than merged — the duplication is a classified legacy defect I was told not to repair.
2. **"Import order passport" → "Order details"** (the Moderator's D-4 list). Test ids, routes and the registry label are unchanged so no e2e, link or gate moves; one T5 link's text changed with it (`View Order Passport` → `View order details`).
3. **Messages: LABEL only (audit WI-4).** Inside the Trade shell the inbox is called **Messages** and says it mixes import, shipping and Marketplace conversations. The default filter is **unchanged on purpose**: Trade OS conversations are stored as `marketplace` workflows (`threadLabel.ts` says so; the thread's *subject* tells them apart), so no existing filter isolates them and defaulting one would hide threads on an assumption. A real "Trade & Imports" filter on `subject_type` would be a new feature — **offered to the Moderator, not built.**
4. **The shell's tab "Orders" → "Import orders"**, so the tab, the page and the trail use the same words.
5. **Cargo pages go up to the booking's journey, not to the order.** They do not know the order and must not go and find it; the journey is addressable from the booking (`/diaspora/journey/cargo_reservation/:id`).
6. **No Documents exit was added to the top of the journey.** R2's own links already open the document workspace wherever the viewer may; duplicating them would offer more than the page does.
7. **The journey now asks the order endpoint one more question** (the vehicle) for the Passport link. It degrades to "no link" on any failure.
8. **R2's tests were touched in exactly one way:** the three journey test files gained a one-line `getOrderVehicle` stub in their hook mock; no assertion changed.

## 6. Step I — VIEW != EDIT in the Seller Studio (Moderator D-1)

*The defect.* After the account draft hydrated, the autosave effect PATCHed the unchanged form back 1200 ms later, and the server stamped `seller_listing_recorded_at` / `listing_location_recorded_at`. Looking at a vehicle recorded that its owner had "entered" a listing — which is how the never-listed Vezel acquired Seller state.

*The rule, as ruled.* A comparison of data, not a page flag: the autosave payload against the payload the server is **known to hold** (`sellerAutosave.ts`). Not mount state, not elapsed time, not `serverDraftLoaded`, not "the first autosave".

* **Baseline** = the payload built from the **same hydrated fields the form is set from** (one mapping — "nothing changed" cannot mean two things), then the payload of the last PATCH acknowledged for the current revision.
* **In flight = nothing is clean.** A revert while an edit's PATCH is still travelling is itself written; otherwise the edit would outlive its own undo.
* A failed or unacknowledged PATCH leaves nothing clean: the next change is written, and there is no retry storm.
* The payload builder moved out of the component **unchanged** (price/currency only when stated, only answered disclosures). The revision / stale-response protection is intact and tested. **The Vezel's six columns were not restored.**

*Proof.* 21 policy tests and 23 Studio tests that drive the real Studio with the real debounce (only `setTimeout` faked): open Serena / open Vezel / move between stages / arrive at review / five odd hydration shapes → **0 PATCH after 10 s**; a real edit → **exactly 1 PATCH with the intended payload** (the payload is asserted field for field); edit + revert before the pause → 0; a save becomes the baseline (no repeat); after a save, undo-before-the-pause → still 1; undoing a saved edit → written; slow earlier PATCH cannot mark a newer form saved; revert while in flight is written; failed PATCH → error, no storm, next change written; guest draft untouched; the Vezel renders the same Studio as the Serena and the Studio never reads import provenance. **Mutation: 27 mutants — 26 killed, 1 was dead code (JSON already drops `undefined` keys) and was removed.** The mutant that deletes the guard (the original defect) is killed by every open-and-leave test.

*Not yet done:* the physical zero-PATCH proof on the real Serena and Vezel rows (Step K), under the Moderator's protocol: record fingerprints, open each Studio, make no edit, wait beyond the debounce, expect no PATCH and no fingerprint movement; if either row moves, stop.

## 7. Evidence

| Check | Result |
|---|---|
| New test files / tests since Checkpoint 3 | **12 files / 169 tests**, all passing (+2 in the shell test) |
| Web mutation passes on the new guards | Step G **27/27**, Step H **52/52**, cargo pages **4/4**, Step I **26/27 + 1 dead-code removal** |
| Full web suite | **219 files / 2,455 tests, all passing** (baseline at R3 start: 198 / 2,189) |
| Types (`tsc --noEmit -p tsconfig.app.json`; negative control proved in Checkpoint 2) | exit 0 |
| Lint, whole `web` project, R3 head vs the R2 head `f4b12b60` | **0 net-new findings** (135 errors / 10 warnings on both — historical debt) |
| Backend | not touched in this step (Checkpoint 3's 68 tests stand) |

## 8. Defects found while doing this, and fixed in it

* `SellerResume.contract.test.ts` **had been red since Step E.** It pinned the Passport and the Garage building the Studio address and deciding published-versus-draft themselves; Step E moved both into one shared description. My Checkpoint 3 regression covered only `src/pages/dashboard/owner`, so it missed a test one directory up. The test now pins the shared description; **I now run the whole web suite, not the directories I touched.**
* Testing Library's `findBy*`/`waitFor` finish by awaiting a *real* zero-delay timer, so with a faked `setTimeout` they hang forever. The Studio tests poll through `act` instead.

## 9. Newly discovered defect (pre-existing, NOT fixed — outside D-1's authority)

**ND-8 — a browser's crash-recovery copy of one vehicle shadows another vehicle's account draft.** The Studio saves a crash-recovery copy of whatever it shows to `sessionStorage` and `localStorage` 300 ms after opening, *including when the data came from the account*. On the next open, `readGuestSellDraft()` returns the newest copy (no expiry, no VIN match), and `if (guestDraft || …) return` skips loading the account draft. Verified by driving the real Studio: open the Serena's Studio, then `?vin=<Vezel>` in the same browser → the page shows **VIN GFC27-027051 / Nissan** with the *guest-draft* banner, and the Vezel's account draft is never fetched. No server write results (`serverDraftLoaded` stays false, so no autosave), but the Studio then shows the wrong vehicle under the right URL.
*Consequence for Step K:* opening the Vezel's Studio after the Serena's in one browser would make the zero-PATCH proof **vacuous** (no hydration, so nothing could have been written). The UAT therefore clears the Studio's two browser keys before each open and asserts the account-draft banner (`seller-server-draft-loaded`) as a positive control. Browser state only; no server row is touched.
*Suggested minimal remedy for the Moderator to authorise or defer:* apply a guest draft only when `resumeVin` is empty or equals the draft's VIN.

## 10. Not yet done

Step J (responsive and accessibility at 390 / 768 / 1280 / 1920, with a deterministic Playwright spec and the web mutation pass over it), the R3 Draft PR, the exact-head candidate and Step K (physical Kingston UAT), CI classification, and the final return.
