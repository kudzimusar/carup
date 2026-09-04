# Web Dashboard KPI Register — Part A (owner/seller, dealer, mechanic)

Repo: `/Users/shadreckmusarurwa/Project AI/carup-kimi`. All paths below relative to `web/src/` unless noted. Route map from `web/src/App.tsx:311-341`. All API paths are backend-relative (`/api` prefix added by `request()` in `hooks/useCarUpApi.ts:445`).

**Classification key**: authoritative-live / derived-live / static-demo / fallback / unavailable-truthful / deprecated.

---

## 1. Owner Dashboard — `/dashboard` → `pages/dashboard/owner/OwnerDashboard.tsx`

| Metric | file:line | Data source | Class | Notes |
|---|---|---|---|---|
| Automotive Wallet (USD) | OwnerDashboard.tsx:215-217 | none (no wallet endpoint exists) | unavailable-truthful | Renders "Not available" + "No wallet established". Comment :84-87 records prior fabricated balances were removed |
| Automotive Wallet (ZiG) | OwnerDashboard.tsx:230-232 | none | unavailable-truthful | Same posture |
| Locked SafePay Escrows ($ total + count) | OwnerDashboard.tsx:246-255 | GET `/api/safepay/list` (useCarUpApi.ts:887) | derived-live | Sum of USD escrows client-side. Loading→"Loading…", error→"Not available" + "Could not load your escrows". No fake zeros |
| Auto-calculated Trust Index (account-level) | OwnerDashboard.tsx:268-270 | none (no per-user trust endpoint) | unavailable-truthful | "Not calculated". Caveat: static subtitle "Verification pending" (:270) implies a process that isn't running |
| Needs-attention: N vehicles without trust assessment | OwnerDashboard.tsx:119,129-135 | GET `/api/vehicles/me` + canonical `trust` projection via `readOwnerTrustClaim` | derived-live | Gated on successful read (`vehiclesState==='ready'`); failure shows explicit "could not be loaded, not an empty garage" item :136-141 |
| Needs-attention: N unread notifications | OwnerDashboard.tsx:118,143-150 | GET `/api/notifications/me` | derived-live | Gated on `notificationsState==='ready'` |
| Per-vehicle Trust Index score + bar (My Vehicles rows) | OwnerDashboard.tsx:313-328 | canonical `trust.score` from `/api/vehicles/me`, narrowed by `ownerStatedValues.ts:39-53` | authoritative-live | Score prints only in `evaluated` state; otherwise italic state text, **no progress bar at all** (comment :322-323). Fails closed |
| Per-vehicle mileage | OwnerDashboard.tsx:311 | `/api/vehicles/me` via `statedMileage` (ownerStatedValues.ts:60-62) | authoritative-live | Absent → "Mileage not recorded" |
| Notifications "N new" badge | OwnerDashboard.tsx:412 | `/api/notifications/me` | derived-live | **Two caveats**: counts only the sliced first 3 (`recentNotifications`), not all unread; and on fetch error the badge still renders "0 new" (only the attention rail is error-gated) — mild fake-zero |
| Vehicle Value Trend | OwnerDashboard.tsx:372-380 | none | unavailable-truthful | Text: "Valuation history is not available for your account yet" (previously a fixed $28k→$26.3k series, per comment :369-371) |
| Digital Document Vault | OwnerDashboard.tsx:342-364 | none (no per-user doc store) | unavailable-truthful | Upload button disabled; comment :337-341 records removed fake-OCR flow |
| WhatsApp-verified status | (removed) OwnerDashboard.tsx:75-80 comment | — | deprecated | Fabricated `whatsappLinked=true` state removed entirely |
| Low-bandwidth toggle | OwnerDashboard.tsx:161-176 | local state | — | Toast text corrected to not claim compression |

## 2. My Garage — `/dashboard/garage` → `pages/dashboard/owner/MyGarage.tsx`

| Metric | file:line | Data source | Class | Notes |
|---|---|---|---|---|
| Asking Price | MyGarage.tsx:77-82 | `/api/vehicles/me` price via `statedPrice` | authoritative-live | Relabeled from "Current Value" (comment :75-76); absent → "Price not recorded" |
| Mileage / Added date | MyGarage.tsx:86-88 | same, `statedMileage`/`statedDate` | authoritative-live | Absent → words, never "Invalid Date" |
| Verified documents / services / active policies / parts-tracked counts | MyGarage.tsx:89,112-114 | `vehicle.counts.*` from `/api/vehicles/me` via `statedCount` (ownerStatedValues.ts:87-94) | derived-live | Absent key → "X not recorded" (fix for prior `|| 0` fabricated zeros, comment ownerStatedValues.ts:79-85) |
| Trust Score + bar | MyGarage.tsx:92-108 | canonical trust projection | authoritative-live | Bar only when score exists |
| Status badge | MyGarage.tsx:55-64 | `vehicle.status` | authoritative-live | Absent → grey "Status not recorded" (no invented "Active") |
| **Empty/error behaviour** | MyGarage.tsx:18-20 | — | **fallback hazard** | `fetchOwnedVehicles().then(setVehicles)` — **no catch, no loading state**: a failed read renders the empty grid, i.e. failure looks like an empty garage (the exact defect OwnerDashboard.tsx:55-57 fixed on its own surface) |

## 3. My Listings — `/dashboard/listings` → `pages/dashboard/owner/MyListings.tsx`

| Metric | file:line | Data source | Class | Notes |
|---|---|---|---|---|
| Header "N listings · M conversations · K unread" | MyListings.tsx:124-135 | `/api/vehicles/me` + GET `/api/communications/threads` | derived-live | Comms fetch failure caught with `{threads:[]}` (:98) → **silently reports "0 conversations · 0 unread" on comms outage** (fallback) |
| Per-listing views | MyListings.tsx:202-205 | `listing.viewCount` (not produced by backend) | unavailable-truthful | Non-number → "Views not tracked" (comment :200-201: nothing counts views) |
| Per-listing trust | MyListings.tsx:206-213 | canonical trust projection | authoritative-live | |
| Per-listing conversations/unread | MyListings.tsx:162-164,214 | `/api/communications/threads` filtered by VIN | derived-live | |
| Listing date | MyListings.tsx:218 | none (no governed publication date) | unavailable-truthful | Literal "Listing date not recorded" (comment :215-217) |
| Status / publication badges | MyListings.tsx:35-39,185-196 | `/api/vehicles/me` + publish/unpublish responses | authoritative-live | Absent status → "Status not recorded" |
| **Empty/error behaviour** | MyListings.tsx:94-106 | — | **fallback hazard** | `Promise.all` has no catch: if `/vehicles/me` rejects, state stays `[]` → "No Listings Yet" empty-state renders for a failed read (fake-empty) |

## 4. Saved Cars — `/dashboard/saved` → `pages/dashboard/owner/SavedCars.tsx`
Listing cards from GET `/api/marketplace/saved` (`fetchSavedMarketplaceListings`); price/mileage via `statedPrice/statedMileage`; location absent → "Location not recorded" (:116). Loading and error states explicit (:50-60); error card says "Could not load saved cars" — **derived-live, truthful posture, no KPIs beyond card fields**.

## 5. Service History — `/dashboard/service-history` → `pages/dashboard/owner/ServiceHistory.tsx`

| Metric | file:line | Data source | Class | Notes |
|---|---|---|---|---|
| Total Services | ServiceHistory.tsx:58 | GET `/api/service-history/me` filtered to selected VIN | derived-live | |
| Total Spent | ServiceHistory.tsx:32,59 | sum of `total_cost` | derived-live | Missing cost coerced to 0 in sum |
| **Next Service "500 km"** | **ServiceHistory.tsx:60** | **hardcoded literal** | **static-demo** | Fixed "500 km" for every account/vehicle; no service-interval source exists |
| Per-service cost | ServiceHistory.tsx:85 | `total_cost || 0` | fallback | Prints "$0" when cost absent (unmeasured zero) |
| Empty/error | ServiceHistory.tsx:16-22 | — | fallback hazard | `Promise.all` no catch → failure renders as zero services / $0 spent |

## 6. Insurance Records — `/dashboard/insurance` → `pages/dashboard/owner/InsuranceRecords.tsx`
Cards render `vehicle.insurance_records` from `/api/vehicles/me` (premium, dates, coverage) — derived-live. `new Date(record.start_date || '')` prints "Invalid Date" for absent dates (:60-61). No catch on fetch (:14-19) → failure = empty page. Expired-policy alert (:77-88) derived-live. No aggregate KPIs.

## 7. PartSentry (owner) — `/dashboard/partsentry` → `pages/dashboard/owner/PartSentry.tsx`

| Metric | file:line | Data source | Class | Notes |
|---|---|---|---|---|
| Logged Repairs / Parts Replaced / Inspections | PartSentry.tsx:179-181 | GET `/api/partsentry/:vin` | derived-live | Counts of real ledger rows |
| Last Service | PartSentry.tsx:139,182 | same | derived-live | No rows → "—" (unavailable-truthful) |
| Ledger Verified / Tampered badge | PartSentry.tsx:148-155 | `verifyLedger` API | authoritative-live | Verification error → "Verification unavailable" badge |
| Empty/error | PartSentry.tsx:194-206 | — | good | Distinct error card with Retry vs. genuine-empty card |

## 8. Referral Wallet — `/dashboard/referrals` → `pages/dashboard/owner/ReferralWallet.tsx`
Approved / Pending / Settled balances (:302-310) from `getReferralWallet` (`/api/referrals/...`); Approved = `approved_balance + payable_balance` (:137) — derived-live. `money()` renders "—" for non-numbers (:65-67); `walletError` shown in red, loading state explicit (:293-296). Truthful posture throughout.

## 9. Gutu AI — `/dashboard/ai` → `pages/dashboard/owner/AIDashboard.tsx` — **entirely static-demo**
No API call anywhere. Keyword-matched canned responses (`aiResponses`, :33-40; `getAIResponse` :42-57) containing **fabricated authoritative-sounding figures presented as live analysis**: "$11,800" valuation with "3.2% decrease" (:34), "500km or 30 days" service due (:35), a specific NicozDiamond policy number and expiry (:36), named mechanics with ratings/distances (:37), "fraud detection rate: 98.7%" (:51). Typing indicator is `setTimeout(...,1200)` (:75-80). OwnerDashboard's "Ask Gutu AI" CTA routes here. Highest-priority mock surface on the owner side.

## 10. Owner shell — `components/owner/OwnerNotificationBell.tsx`
Unread badge (:61,87-92) from `/api/notifications/me` — derived-live; fetch error → aria "count unavailable" and **no badge** rather than 0 (:72-74). Truthful. `components/layout/DashboardLayout.tsx` sidebar has a badge slot (:192-196) but no static badge values are configured.

---

## 11. Dealer Dashboard — `/dealer` → `pages/dashboard/dealer/DealerDashboard.tsx`

| Metric | file:line | Data source | Class | Notes |
|---|---|---|---|---|
| Total Inventory | DealerDashboard.tsx:101 | GET `/api/vehicles` (`fetchVehicles`, useCarUpApi.ts:528) | **derived-live, mislabeled** | `/api/vehicles` is the **public marketplace read** (backend/server.js:669-681: publicly visible, publication-gated, all sellers) — the count is "publicly listed vehicles platform-wide", not this dealer's inventory. The tenant-scoped endpoint (`/api/vehicles/inventory`, server.js:2510) exists but this page doesn't use it |
| Leads / Monthly Sales / Revenue (USD) | DealerDashboard.tsx:102-104 | none wired | unavailable-truthful | Literal "Not available"; comment :98-100 records removal of fabricated `dashboardStats.dealer` |
| Branch Stock List | DealerDashboard.tsx:41,138-160 | same public `/api/vehicles` filtered `v.location === selectedBranch` | derived-live, mislabeled | Same wrong-scope source; branch options Harare/Bulawayo hardcoded (:89-91). Carries a "Live" badge (:135). Empty→"No inventory found for {branch}"; error→empty list (catch :36 sets []) — **failure indistinguishable from empty branch** |
| Branch stock price | DealerDashboard.tsx:153-157 | vehicle price+currency | authoritative-live | Absent → "Price not recorded"; blanket "ZIMRA Cleared" badge removed (comment :150-152) |
| **Sales Performance chart** | **DealerDashboard.tsx:16-22 (data), 213-225 (render)** | **`salesData` static array Jan-May 8/10/12/9/14** | **static-demo** | The plan's "static sales-chart remnant" — confirmed, module-level constant fed to Recharts BarChart |
| **Inventory Aging (Harare)** | **DealerDashboard.tsx:228-244** | **hardcoded 60% / 30% / 10%** | **static-demo** | The plan's "inventory-age remnant" — three literal Progress bars (values at :232-233, :236-237, :240-241), fixed for every dealer, labeled "(Harare)" regardless of selected branch |
| Team Permissions Matrix | DealerDashboard.tsx:51-65,168-208 | local `useState` only | static-demo | Checkbox toggles mutate local state and toast "Permission updated" — **nothing persisted, no backend** |
| Marketplace inquiries count | via `SellerInquiriesCard` :126 | GET `/api/marketplace/my-listings/inquiries` (SellerInquiriesCard.tsx:131-145, backend marketplaceRoutes.js:152) | authoritative-live | Ownership-scoped. On endpoint failure the whole card returns `null` (:146) — hides rather than fakes, but outage is invisible |

## 12. Dealer Inventory — `/dealer/inventory` → `pages/dashboard/dealer/Inventory.tsx`
Source: GET `/api/vehicles/inventory` (tenant-scoped raw `vehicles` rows, server.js:2510-2524). The `vehicles` table (database/migrations/supabase_schema.sql:44-63) has **no `viewCount`, `images`, `condition`, `isVerified`, or camelCase `trustScore` columns**, so:

| Metric | file:line | Class | Notes |
|---|---|---|---|
| Header "(N total)" | Inventory.tsx:90 | derived-live | |
| Price | Inventory.tsx:153 | authoritative-live | **Crash hazard**: `vehicle.price.toLocaleString()` throws if price null (column NOT NULL so latent only) |
| "{viewCount} views" | Inventory.tsx:168 | **unavailable-untruthful** | Field never exists on this endpoint → renders "` views`" with blank number (undefined renders as nothing). Not tracked anywhere; contrast MyListings' honest "Views not tracked" |
| "Trust: {trustScore}" | Inventory.tsx:169 | **deprecated/broken** | camelCase field never exists → renders "Trust: " blank. Also bypasses the canonical trust projection mandated by #164 |
| Condition badge | Inventory.tsx:167 | broken | Renders an empty outline badge (no `condition` column) |
| Verified badge | Inventory.tsx:170 | dead code | `isVerified` never present → never renders |
| Vehicle image | Inventory.tsx:141-147 | **static-demo fallback** | Hardcoded Unsplash stock-car URL for every row (no `images` column) — the exact stock-photo fabrication removed from owner surfaces |
| Status | Inventory.tsx:67,139 | fallback | Absent status defaults to `'Available'` (:67,:139) — invented lifecycle state (contrast MyListings.tsx:35-39) |
| Empty/error | Inventory.tsx:47-58,125-135 | fallback | catch only logs; `loading` cleared → error renders the "No inventory found" empty state (fake-empty) |

## 13. Dealer Leads — `/dealer/leads` → `pages/dashboard/dealer/Leads.tsx`
Source: GET `/api/leads` (dealer-scoped, backend/routes/leadsRoutes.js:52) — derived-live rows; catch is truthful (comment :35 "never backfill with mock leads"), empty state distinguishes "No leads yet" vs filtered (:83-93). Field-level fallbacks: name/vehicle 'Unknown', email/phone 'N/A' (:24-27); **date fallback `new Date().toLocaleDateString()` (:30) stamps today's date on a lead missing `created_at` — fabricated timestamp**. Also embeds authoritative-live `SellerInquiriesCard` (:76). No numeric KPI tiles.

## 14. Dealer Promotions — `/dealer/promotions` → `pages/dashboard/dealer/Promotions.tsx`

| Metric | file:line | Class | Notes |
|---|---|---|---|
| **Seeded promotion list** | Promotions.tsx:13-17,21 | **static-demo** | `mockPromotions` (3 fake campaigns with views 245/189/0, clicks 32/21/0) is the *initial state*; on successful API read the real rows are **concatenated with the mocks** (`[...formatted, ...mockPromotions]`, :46) — mocks are never removed, even with live data; on API failure mocks stand alone (:48-50 "use mock") |
| Active Promotions count | Promotions.tsx:134 | static-demo-contaminated derived | Counts the state list, which always contains 2 'active' mocks → minimum reading of 2 for every dealer |
| **Total Views "434"** | **Promotions.tsx:135** | **static-demo** | Hardcoded literal (= 245+189 of the mocks) |
| **Click Rate "12.2%"** | **Promotions.tsx:136** | **static-demo** | Hardcoded literal |
| Per-promo views/clicks | Promotions.tsx:149-150 | mixed | Mock rows static; live rows `d.views || 0` / `d.clicks || 0` (:41-42) — no click/view counter exists backend-side (promotionsRoutes.js has no tracking), so live rows always print unmeasured "0 views / 0 clicks" |
| Created promo | Promotions.tsx:66-76 | fallback | Locally prepended with `views: 0, clicks: 0` and `id: Math.random()` fallback |

## 15. Sales Analytics — `/dealer/analytics` → `pages/dashboard/dealer/SalesAnalytics.tsx` (plan target — confirmed)

| Metric | file:line | Class | Notes |
|---|---|---|---|
| Total Revenue / Units Sold / Avg. Sale Price | SalesAnalytics.tsx:28-32 (init), 34-46 (overwrite), 68-70 (render) | **static-demo initial + derived-live overwrite, mislabeled** | Initial state is **hardcoded $2,090,000 / 53 / $39,400** shown to every dealer; replaced only when GET `/api/vehicles` returns `data.length > 0` — on empty or failed fetch the invented figures stand. When it does overwrite, the source is the **public marketplace list** (see §11), and public reads exclude sold vehicles (server.js:678 status filter), so the "sold" computation (:37) is structurally near-zero — either way the numbers are not this dealer's sales |
| Change badges "+12% / +8% / −2%" | SalesAnalytics.tsx:68-70 | **static-demo** | Hardcoded trend deltas rendered as green/red movement badges regardless of the value shown |
| Customer Rating "4.8" (+0.2) | SalesAnalytics.tsx:71 | **static-demo** | No rating system exists anywhere in the codebase |
| **Monthly Sales bar chart** | **SalesAnalytics.tsx:9-15 (data), 90-101 (render)** | **static-demo** | `mockMonthlySales` Jan-May 8/10/12/9/14 with revenue figures — never replaced by any fetch |
| **Sales by Category pie (SUVs 45% …)** | **SalesAnalytics.tsx:17-22, 104-126** | **static-demo** | `categorySplit` literal; legend prints the fixed percentages as facts |

---

## 16. Mechanic Dashboard — `/mechanic` → `pages/dashboard/mechanic/MechanicDashboard.tsx`

| Metric | file:line | Data source | Class | Notes |
|---|---|---|---|---|
| Active Orders / Completed (Mo) / Revenue (USD) / Total Orders | MechanicDashboard.tsx:61-70,117-138 | GET `/api/mechanic/work-orders` (workOrdersRoutes.js:15, role-scoped) | derived-live | Revenue = sum `total_cost` of this-month completed. Fetch error → all four read 0 with only the list-card showing the error (:153-157) — **stat tiles fake zeros during outage** |
| Jobs This Week chart | MechanicDashboard.tsx:20-30,198-209 | same rows, trailing-7-day weekday counts | derived-live | Replaced a static chart; honest zeros only insofar as fetch succeeded |
| Recent Work Orders list | MechanicDashboard.tsx:152-177 | same | authoritative-live | Distinct error banner (:153-157) vs genuine-empty state (:158-163) — good posture |
| PartSentry ledger card | MechanicDashboard.tsx:182-193 | none on this page | unavailable-truthful | Pointer to Service Logs instead of a fake ledger |

## 17. Work Orders — `/mechanic/work-orders` → `pages/dashboard/mechanic/WorkOrders.tsx`
Rows from GET `/api/mechanic/work-orders`; status transitions via PATCH with optimistic update + rollback on failure (:96-113) — authoritative-live. Field fallbacks: cost `?? 0` (:44, but rendered only when `> 0`, :202 — truthful-by-omission), mechanic "Unassigned" (:45), vehicle/customer 'Unknown' (:38-39). Load failure → toast + empty list; "No work orders found" empty state (:271-277) then **doubles as the error state** (fake-empty). No KPI tiles.

## 18. Service Logs — `/mechanic/service-logs` → `pages/dashboard/mechanic/ServiceLogs.tsx`
VIN-keyed ledger from GET `/api/partsentry/:vin` — authoritative-live; write via POST `/api/partsentry/add` with server-confirmed id required before success toast (:75-84). Empty states distinguish "no vehicle loaded" from "no logs for {vin}" (:199-213) — good posture. No KPI tiles.

## 19. Parts Tracking — `/mechanic/parts` → `pages/dashboard/mechanic/PartsTracking.tsx`

| Metric | file:line | Class | Notes |
|---|---|---|---|
| Total Parts Types / Inventory Value / Low Stock / Out of Stock | PartsTracking.tsx:130-133 | derived-live | From GET `/api/mechanic/parts` (partsRoutes.js:13). Fetch error → toast + zeros in all four tiles (fake zeros on outage) |
| Low-stock threshold | PartsTracking.tsx:34 | fallback | `min_stock ?? 5` — invented default drives the Low Stock KPI and amber row styling |
| Supplier | PartsTracking.tsx:35,67 | fallback | Absent → invented "Internal" |
| **"Upload Invoice" action** | **PartsTracking.tsx:190-197** | **static-demo (fabricated success)** | File-picker `onChange` fires `toast.success("Invoice uploaded…")` **without uploading anything anywhere** — no request, no store |

## 20. Customer Records — `/mechanic/customers` → `pages/dashboard/mechanic/CustomerRecords.tsx` — **entirely static-demo**
Module-level `customers` array (:8-13) with invented names, phones, emails; every displayed number is fabricated: visits badges (:45), "N vehicles" (:52), "$total spent" (:53), last-visit dates (:54). No fetch of any kind; "Add Customer" button is inert. Whole page is demo data presented as a CRM.

---

## Cross-cutting findings for the mock-removal programme

1. **Fully-mock surfaces (2)**: `AIDashboard.tsx` (owner) and `CustomerRecords.tsx` (mechanic) — zero API wiring, fabricated figures presented as analysis/records.
2. **The plan's named dealer remnants confirmed at**: DealerDashboard.tsx:16-22 + 213-225 (static sales chart), DealerDashboard.tsx:228-244 (static inventory-aging 60/30/10); SalesAnalytics.tsx:9-24 (mock chart data), :28-32 (hardcoded $2.09M/53/$39.4k initial KPIs), :68-71 (hardcoded deltas + 4.8 rating).
3. **Mock contamination of live data**: Promotions.tsx:46 concatenates mocks *into* successful API results; its 434-views and 12.2% tiles are literals.
4. **Wrong-scope live data**: DealerDashboard "Total Inventory"/"Branch Stock" and SalesAnalytics' overwrite all read public `/api/vehicles` (platform-wide, publication-gated, excludes sold) instead of tenant-scoped `/api/vehicles/inventory`.
5. **Broken-field renders on dealer Inventory.tsx**: `viewCount`/`trustScore`/`condition`/`isVerified` don't exist on the endpoint's rows (schema supabase_schema.sql:44-63) → blank fragments like "Trust: "; hardcoded Unsplash stock photo :141; default-'Available' status :67.
6. **Fabricated success actions**: PartsTracking invoice upload (:193-197); DealerDashboard permissions matrix persists nothing (:57-65).
7. **Failure-renders-as-empty (fake-empty/fake-zero) sites**: MyGarage.tsx:19, MyListings.tsx:94-106, ServiceHistory.tsx:16-22, InsuranceRecords.tsx:14-19, Inventory.tsx:47-58, WorkOrders.tsx:49-52, MechanicDashboard stat tiles :61-70, PartsTracking tiles :130-133, OwnerDashboard "0 new" badge :412.
8. **Best-practice reference implementations** (posture to replicate): OwnerDashboard loading/ready/unavailable tri-state (:58-69), `ownerStatedValues.ts` (score-fails-closed, stated counts), PartSentry owner page error/empty split, ServiceLogs VIN-scoped honesty, OwnerNotificationBell error-aware badge, SellerInquiriesCard (though its `return null` on failure hides outages).
9. **Remaining single-literal KPI**: ServiceHistory.tsx:60 "Next Service 500 km".