# T11-CAP-LR01-R3 — Checkpoint 5: physical UAT as the real Kingston account (Step K)

Authority: [T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md](../T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md) §30-K, §39, §49, and the Moderator's implementation release (D-1…D-4).
Previous receipt: [Step J and the exact-head UAT candidate](T11_CAP_LR01_R3_STEP_J_AND_CANDIDATE.md).
PR: **#244** (Draft; base `feat/trade-os-t11-cap-lr01-journey-arrival` @ `f4b12b60`; PR #243 untouched).
**No migration. Production not accessed. Canonical staging Garage `8353dbdd` not touched, not aliased, not promoted. The Seller rows were never written.**

## 1. Result

The Owner signed in as Kingston on each exact-head candidate. Every path below was walked by explicit controls only (no browser Back, no typed address except where a page has no link to it, and those are named). The physical UAT found **three defects in R3's own work. All three were fixed and re-proved on a new exact-head candidate**:

| # | Found on | Defect (R3's own) | Fix | Proved on |
|---|---|---|---|---|
| 1 | candidate 1 `2f192631` | A **published** listing had no way into the Seller Studio: R2's static "Edit / continue listing" had been replaced by "Manage listing" → My Listings, and My Listings never links to the Studio. The Serena's Studio was reachable only by typing its address. | `36679d2c`: the published state carries **"Edit listing details"** (a quiet second action, same Studio, this VIN). Only a live listing carries it. My Garage stays a summary. | candidates 2, 3, 4 |
| 2 | candidate 2 `7c538434` | Measured by sampling the trail every 100 ms: Import Order, Trade documents, Container & shipment and Documents & evidence named the Vezel's order **"Import order 3E2B66A0" for 1.6–3.2 s on every load**, then "2018 Honda Vezel". The short-reference fallback was used while the read that names the order was still out. | `adda74b0`: `useOrderVehicleRead` (answered or not, per order) and `settledOrderLabel`. Until the read answers, the order is "Import order"; afterwards it is the vehicle, the request, or the short reference. | candidates 3, 4 |
| 3 | candidate 3 `76aa807e` | Order details hides the chrome's "Back to import order" because it carries its own button, so that button **is** the page's way up. It was the compact button: 44 px under the mobile breakpoint, **32 px from 768 px up**. | `78db685e`: both of the page's way-up buttons carry `min-h-11`. | candidate 4 |

The same commits also fixed two smaller issues found on candidate 1: the customs page's unreadable state now keeps its own `<h1>` (the other three cargo pages already did), and the order header's "Import order" eyebrow moved from gray-400 (2.56:1) to gray-600.

## 2. The exact-head candidate the final evidence names

| | |
|---|---|
| Candidate | **`2d2d8df0e9e6e46351c51ee9dcf0232469227dd9`** on `cert/t11-cap-lr01-r3-uat-candidate` (candidate 4) |
| Lineage | runtime canonical `8353dbdd` + R1 + R2 (`e28cbf25`) + the R3 product up to **`78db685e`** |
| Merge commits | `bf7445d1` (R3 `411ba2bd`, 4 conflicts), `53b8f11a` (`d0f7c8c7`), `7c538434` (`36679d2c`), `76aa807e` (`adda74b0`), `2d2d8df0` (`78db685e`, 1 conflict) |
| Runtime-only adaptations | `2ea3bc12` (the `Link` import), `2f192631` (the capability panel keeps the runtime's R7 fail-closed ownership rule) |
| Backend Preview | `https://carup-backend-staging-jkni30f1a-11-11.vercel.app`, `dpl_DV5ES4AxqDD7ccgwWy2H2b8cQSKn`. Its own `/api/health`: `UP`, `commit_sha 2d2d8df0…`, `source explicit_build_input`, `environment preview`, staging project `eoyenigwevnxwwhyhaer`, **`external_sends: disabled`** |
| Web Preview | `https://carup-staging-7jscgwr2o-11-11.vercel.app`, `dpl_AVHA9wieiGnMg6pqFXb8ympM84ka`. Its own `/carup-provenance.json`: `commit_sha 2d2d8df0…`, `api_base_url` = the backend above, `api_base_source "explicit VITE_API_URL"`, `unpaired false`. Its served bundle names that backend 7 times and no earlier candidate's backend |
| Backend code vs candidate 1 | identical (`git diff 2f192631..2d2d8df0 -- backend supabase scripts .github` is empty) |
| Regression at the candidate | web **312 files / 3,412 tests** pass; `tsc` exit 0; the R3 e2e spec **50/50** on the runtime lineage's UI |

The one conflict in `2d2d8df0` is the place `bf7445d1` already met: the unreadable state of Order details. It is resolved as a union: the runtime's `returnTo`-preserving "Sign in" link (`buildLoginRedirect`) **and** R3's `min-h-11` on "Back to import orders". Candidates 1–3 stay up as unaliased Previews behind the same kill switch.

## 3. The Seller rows: D-1 proved on the real rows, every time

Fingerprint expression: `md5(row_to_json(t)::text)`, SELECT only, on the staging project. Fourteen readings from 09:30:10Z (before the first candidate was deployed) to 14:37:17Z (after the last pass). **Every reading is identical:**

| | Before (K0, 09:30:10Z) | After (K13, 14:37:17Z) |
|---|---|---|
| Serena `GFC27-027051` | `e9d216b9ca1eb39440d9be8ab39123e6` | `e9d216b9ca1eb39440d9be8ab39123e6` |
| Vezel `RU3-1316558` | `308677ddad1c6ec206229e9060ff2352` | `308677ddad1c6ec206229e9060ff2352` |
| Vezel's order `3e2b66a0` | `4714abd7b98bd752e093ee02f71a7f59` | `4714abd7b98bd752e093ee02f71a7f59` |
| Vezel listing stamps | `2026-10-26 11:43:07.74+00` (both) | unchanged |
| Rows | 370 vehicles, 221 orders; Serena 10 listing images, Vezel 0 | unchanged |

**Zero-PATCH proof.** The Seller Studio was opened **46 times** across the four candidates, at all four widths: 14 on candidate 1, 2 on candidate 2, 14 on candidate 3, 16 on candidate 4. The positive control applied every time. The Studio's four browser-draft keys were absent before each explicit open (ND-8, §6). The account-draft banner "Existing Seller listing loaded…" was present, so the form had really hydrated, and nothing was edited. The page was then left alone for 3.5–46 s against a 1.2 s debounce. Across all 46 opens, a request listener saw **no non-GET API request** apart from the app's navigation analytics and the CSRF token. The indicator never left "Account draft loaded. Changes will autosave after you pause.". The explicit-UI proofs on the final candidate:

| Vehicle | Entry | Opened (UTC) | Idle | Writes | Fingerprint after |
|---|---|---|---|---|---|
| Serena | Passport → **Edit listing details** | 13:52:02Z | 8 s | none | unchanged (K12) |
| Vezel | Passport → **Sell this vehicle** | 13:53:02Z | 8 s | none | unchanged (K12) |

On candidate 1 the Serena's Studio was opened by its address: no link to it existed, which is finding 1. From candidate 2 on it was reached by "Edit listing details".

## 4. The paths, on the final candidate (explicit controls, real rows)

| Path | What was seen |
|---|---|
| **Serena — Seller** | Sidebar "My Garage" → Garage (My Vehicles) → Serena's Passport. Trail "My Vehicles / 2016 Nissan Serena Highway Star", "Back to My Garage". Panel: **Marketplace "Published on Marketplace"** with "Manage listing" and "Edit listing details", and **nothing about imports**. → Edit listing details → Seller Studio (Marketplace; "Marketplace / 2016 Nissan Serena Highway Star / Seller Studio"; "Back to Vehicle Passport") → back → Manage listing → My Listings (Marketplace; **the Serena only**) → workspace bar "My Vehicles" |
| **Vezel — Seller** | Garage → Vezel's Passport. Panel: **Marketplace "Not listed"** with "Sell this vehicle", and **Trade & Imports "Import journey available"** with "View CAP" and "Import order". → Sell this vehicle → the same Seller Studio as the Serena ("Marketplace / 2018 Honda Vezel / Seller Studio") → Back to Vehicle Passport |
| **Vezel — CAP, and CAP → Vehicle Passport** | Passport → View CAP → CAP (Trade & Imports; "Trade & Imports / Import Orders / 2018 Honda Vezel / Journey & arrival"; "Back to import order") → **View Vehicle Passport** → Passport |
| **Trade: Import Order → CAP → Import Order** | Passport → Import order → Import Order ("2018 Honda Vezel"; actions Journey & arrival · Documents · Shipment · Order details · View Vehicle Passport; "Back to import orders") → Journey & arrival → CAP → **Back to import order** → Import Order |
| **The order's pages** | Documents ("Trade documents"), Shipment ("Container & shipment") and Order details each sit under "2018 Honda Vezel" and come back by their own "Back to import order". Order details' button is 44 px. It is "Order details", not an "Import order passport" |
| **Trade & Imports** | Breadcrumb "Import Orders" → the list ("2018 Honda Vezel", and "Import order 921D09ED" for the order that names no vehicle; **no UUID on the page**; "Back to dashboard") → sections "Messages" → "Import orders" → the Vezel's order → View Vehicle Passport → View CAP → "Open the document workspace" → Documents & evidence → Back to import order |
| **Cargo pages** | Tracking, customs, loading and intake, by address because an import order does not link to them. Each carries the Trade & Imports chrome ("… / Journey & arrival / <page>", "Back to journey & arrival") and its own `<h1>`. For a non-container subject their APIs refuse with a designed 400, and each page says so honestly |

**The order's name in the trail.** Sampled every 100 ms, on explicit navigation and on cold loads: on Import Order, Trade documents, Container & shipment and Documents & evidence it is "Import order" while the read is out, then "2018 Honda Vezel". **The Vezel's order is never called by its short reference.** Order details and CAP draw their chrome only once their own read is done, so they show the vehicle's name from the start.

## 5. Responsive, accessibility, console, network — final candidate

| Check | Result |
|---|---|
| Responsive: 390 / 768 / 1280 / 1920 × 11 pages (Garage, both Passports, My Listings, Import Orders, Import Order, CAP, Documents & evidence, Order details, both Studios), each loaded by its address | **44/44 pass.** No horizontal overflow, no element past the viewport outside an intentional scroller, h1 never clipped, workspace bar 3 × ≥ 44 px with the active workspace on screen, breadcrumb links ≥ 36 px with exactly one `aria-current`, every way up ≥ 44 px and on screen, "Edit listing details" ≥ 44 px, never the order's reference in a trail |
| Accessibility: axe-core 4.12.1 (the repo's own copy, injected), `wcag2a` + `wcag2aa`, 11 pages × 1280 and 390 | **Zero violations in the R3 layer**: workspace bar, breadcrumbs, chrome, capability panel, way-up links, the order header and Order details' way up. Every remaining violation is inherited (§7) |
| Console (22 loads) | zero errors, zero warnings, zero page errors |
| Network (22 loads) | zero failed requests, zero API 4xx/5xx, zero non-GET API requests. Hosts: this candidate's web and backend, the staging Supabase project (signed vehicle images), Google Fonts, `vercel.live`. **No BE FORWARD, no canonical staging, no production** |

**Measurement traps, recorded so the numbers above can be trusted.**
- A generic "wait for an `h1`" can match the previous page during a full load, so each page is measured after a page-specific selector appears.
- The Owner watches the visible window. On candidates 3 and 4, a few samples caught a page already scrolled, or already navigated, by someone else. Each such flag was re-measured with a logger of *trusted* input events: zero inputs, and the page passed. A 12 s instrumented watch of each flagged page showed no scroll and no navigation, so the app does not move by itself.

## 6. Accounted for, not hidden

- **ND-8 (pre-existing, not changed, outside D-1).** The Studio's browser crash-recovery copy of one vehicle can shadow another vehicle's account draft. Every proof cleared the four keys first and required the account-draft banner, so no "zero PATCH" above is vacuous.
- **The Owner's sessions.** Each candidate is its own origin, so the Owner signed in four times. No credential was typed by me or seen by me. Tab 0 (the BE FORWARD CAP page with its original portal token) was never touched.
- **Privacy.** Link enumerations strip query strings: one early enumeration printed a one-hour signed photo URL into a tool output, nowhere else, and it expired at 12:08:54Z. Screenshots are element or header clips only, kept outside the repository. Every page snapshot of the session was deleted, because My Listings carries buyers' contact details.

## 7. Inherited residuals (none introduced by R3; each seen on the real rows)

| Residual | Where | Note |
|---|---|---|
| Brand orange `#ea580c` as small text / under white text (3.4:1) | app-wide (Seller eyebrow, primary buttons, CAP accent) | a design-token decision for the whole product; reported, not changed |
| `aria-progressbar-name` | the trust ring on the Serena's Passport and Garage card | pre-existing component |
| `button-name` ×2 (critical) | the Studio form's Radix Select triggers (Year, registration stage) | pre-existing form fields |
| `link-name` ×1, contrast in the bottom navigation | every dashboard page at 390 | the runtime lineage's header icon link and compact bottom navigation |
| colour contrast in page bodies | Import Orders metrics (3), Order details compliance record (11), Passport/Listings bodies | pre-existing page content |
| Cargo intake prints the backend's refusal text (`Unknown warehouse intake subject "import_order"`) | `/diaspora/cargo/import_order/…`, by address only | the API refuses non-container subjects; the page shows its message verbatim |
| Order details' compliance block shows a truncated order id and participant id | Order details | the viewer's own record; pre-existing |
| CI `backend-and-build`: 1 of 1,458 — *SAILING MATCH* | product lineage only | calendar-expired T3 fixture (`2026-10-01`); passes on the runtime lineage, which carries the OC-4F fix |
| CI `Bootstrap`/`Aggregate`: `UNGOVERNED_BRANCH` | PR #244 (as PR #243) | the gate fails, never skips, on a branch with no governed preview pair |
| Backend on the runtime lineage: `garage-ops03` (expired appointment fixture), FX observation file (9 cancelled) | candidate lineage | identical on the pristine R2 candidate `e28cbf25` |
| Unused reserved `WS_STYLE` tokens | `workspaceStyles.ts` | documented as reserved |

## 8. CI at the final head `78db685e` (live)

| Check | Result | Class |
|---|---|---|
| `backend-and-build` | fail: 1,458 tests, 1,450 pass, **1 fail** (*SAILING MATCH*), 7 skipped | inherited (§7) |
| `Bootstrap`, `Aggregate` | fail: `UNGOVERNED_BRANCH` | inherited (§7) |
| `Passport foundation contracts`, `playwright`, `staging-integration`, `referral-ci`, `communication-unit`, `communication-postgres` | pass | — |
| `Chromium`, `Mobile`, `Tablet`, `communication-staging`, `communication-staging-deploy` | skipped | dependents of the above |

## 9. Tests behind the three fixes

| Fix | Tests | Negative controls |
|---|---|---|
| `36679d2c` Studio route, customs `<h1>`, eyebrow | presentation (published: two actions in order; no other state repeats or invents it; encoded VIN), panel, Passport (owner yes; non-owner, failed scope and never-listed no), Garage (one action), customs heading; e2e: Serena Passport → Edit listing details → Studio (zero PATCH) → back at 390 and 1280; axe now covers the order header | 9/9 presentation, 3/3 customs, 2/2 e2e |
| `adda74b0` order name while loading | hook (8: answered/none/failed, switching orders, late answers either way), label (2), four page tests (two existing tests now wait for the answered state instead of racing it); e2e: the order endpoint answers after 1.5 s and the trail is sampled throughout, on all four pages | 12/12 (one first survivor exposed a missing test, now added and killing it), e2e 1/1 |
| `78db685e` Order details way up | page test pins the target on both buttons; e2e measures it at all four widths | 2/2 page, 1/1 e2e |

Product lineage at `78db685e`: web **220 files / 2,476 tests**; `tsc` 0; lint **0 net-new** against `f4b12b60`; e2e **50/50**.

## 10. Not done here

Nothing in Step K is outstanding. The private evidence (UAT log, fingerprint ledger, four candidate provenance records, screenshots) stays outside the repository. R3 is not merged. The decision is the Moderator's.
