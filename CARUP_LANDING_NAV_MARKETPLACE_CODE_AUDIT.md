# CarUp Landing, Navigation, and Marketplace Code Audit

Audit date: 2026-06-03  
Scope: homepage/landing page, public navigation, marketplace, search, vehicle cards, vehicle/passport data readiness, mock data, topical pages, and tests.

## 1. Executive Summary

| Finding | Status | Evidence |
|---|---|---|
| The public homepage is `Landing`, served at `/`. | IMPLEMENTED | `web/src/App.tsx:13` imports `Landing`; `web/src/App.tsx:150` maps `/` to `<Landing />`. |
| `web/src/pages/Home.tsx` exists but is not routed and still contains Vite starter UI. | SHOULD_DEFER | `web/src/pages/Home.tsx:4-19` renders "Vite + React"; `web/src/App.tsx:12-33` imports public pages but not `Home`. |
| The current homepage is trust/platform-first, not marketplace-first. | PARTIAL | Hero copy says "Every Car Deserves a Digital Identity" and CTAs route to `/marketplace` and `/register` in `web/src/pages/Landing.tsx:134-157`. |
| Homepage featured vehicles are local mock data, not API/Supabase data. | MOCK_ONLY | `web/src/pages/Landing.tsx:19` imports `vehicles`; `web/src/pages/Landing.tsx:117` derives `featuredVehicles` from mock data. |
| Public top nav has Marketplace, Search, Dealers, Garages, Insurance, and Pricing only. | IMPLEMENTED | `web/src/components/layout/Navbar.tsx:33-40`. |
| Public routes for `/buy`, `/sell`, `/verify`, `/finance`, and `/how-it-works` are missing. | MISSING | `web/src/App.tsx:149-168` registers public routes and does not include those paths. |
| Marketplace is API-powered through `useCarUpApi().fetchVehicles()`, then filtered client-side. | PARTIAL | `web/src/pages/Marketplace.tsx:52-80` fetches `/vehicles`; `web/src/pages/Marketplace.tsx:98-119` filters/sorts in React. |
| `/search` is frontend-only and mock-data-backed. | MOCK_ONLY | `web/src/pages/VehicleSearch.tsx:15` imports mock vehicles; `web/src/pages/VehicleSearch.tsx:26-49` filters local data. |
| Vehicle detail/passport page is the strongest existing Passport/Evidence surface. | IMPLEMENTED | `web/src/pages/VehicleDetail.tsx:200-235` looks up passport/details; `web/src/pages/VehicleDetail.tsx:660-733` renders Evidence Vault; `web/src/pages/VehicleDetail.tsx:895-981` renders ownership, plate history, and trust breakdown. |
| Requested condition category slugs and marketplace tags do not exist as typed fields, DB columns, mock fields, or filters. | MISSING / BACKEND_NEEDED | Current types list `condition?: string` and `category?: string` in `web/src/types/index.ts:19-20`; DB `vehicles` has no category/tag columns in `database/migrations/supabase_schema.sql:44-64` or `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:3-17`. |
| There are duplicated Vehicle models across shared types, web types, mock data, and `useVehicles`. | PARTIAL | `shared/types/index.ts:13-33`, `web/src/types/index.ts:14-63`, `web/src/data/mockData.ts:3-38`, and `web/src/hooks/useVehicles.ts:4-23`. |

Recommended Phase 1: redesign `Landing` and public nav using existing routes, mock/homepage data normalization, and links into `/marketplace`, `/search`, `/marketplace/:id`, `/dashboard/sell-vehicle`, `/dealers`, `/garages`, `/insurance`, and `/pricing`. Defer category/tag schema, ranking, and featured-verified API until Phase 2.

## 2. Route Map

| Route | Component | Navigation Source | Status | Notes |
|---|---|---|---|---|
| `/` | `Landing` | Logo links in `Navbar` and `Footer` | IMPLEMENTED | Registered in `web/src/App.tsx:150`; component in `web/src/pages/Landing.tsx:116`. |
| `/marketplace` | `Marketplace` | Top nav + footer | IMPLEMENTED / PARTIAL | Route in `web/src/App.tsx:151`; nav in `web/src/components/layout/Navbar.tsx:34`; API data with frontend filters in `web/src/pages/Marketplace.tsx:52-119`. |
| `/marketplace/:id` | `VehicleDetail` | Vehicle cards | IMPLEMENTED | Route in `web/src/App.tsx:152`; detail uses passport lookup first in `web/src/pages/VehicleDetail.tsx:200-235`. |
| `/search` | `VehicleSearch` | Top nav + footer | MOCK_ONLY | Route in `web/src/App.tsx:153`; mock import in `web/src/pages/VehicleSearch.tsx:15`. |
| `/dealers` | `DealerDirectory` | Top nav + footer | MOCK_ONLY | Route in `web/src/App.tsx:154`; mock dealers imported in `web/src/pages/DealerDirectory.tsx:7`. |
| `/garages` | `GarageDirectory` | Top nav + footer | MOCK_ONLY / UI_ONLY | Route in `web/src/App.tsx:155`; mock garages imported in `web/src/pages/GarageDirectory.tsx:6`; "Book Service" has no route/action in `web/src/pages/GarageDirectory.tsx:69`. |
| `/insurance` | `InsuranceDirectory` | Top nav + footer | MOCK_ONLY / UI_ONLY | Route in `web/src/App.tsx:156`; mock providers imported in `web/src/pages/InsuranceDirectory.tsx:7`; "Get a Quote" has no wired action in `web/src/pages/InsuranceDirectory.tsx:59`. |
| `/pricing` | `Pricing` | Top nav + footer | MOCK_ONLY | Route in `web/src/App.tsx:157`; plans from mock data in `web/src/pages/Pricing.tsx:8`; CTAs route to `/register` in `web/src/pages/Pricing.tsx:65-70`. |
| `/about` | `About` | Footer | IMPLEMENTED | Registered in `web/src/App.tsx:158`. |
| `/contact` | `Contact` | Footer/company pages | IMPLEMENTED | Registered in `web/src/App.tsx:159`. |
| `/careers` | `Careers` | Footer | IMPLEMENTED | Registered in `web/src/App.tsx:160`. |
| `/press` | `PressKit` | Footer | IMPLEMENTED | Registered in `web/src/App.tsx:161`. |
| `/blog` | `Blog` | Footer | IMPLEMENTED | Registered in `web/src/App.tsx:162`. |
| `/help` | `HelpCenter` | Footer | IMPLEMENTED | Registered in `web/src/App.tsx:163`. |
| `/trust` | `TrustSafety` | Footer | IMPLEMENTED / UI_ONLY | Registered in `web/src/App.tsx:164`; contains verification/safety content but is not `/verify`. |
| `/privacy` | `PrivacyPolicy` | Footer | IMPLEMENTED | Registered in `web/src/App.tsx:165`. |
| `/terms` | `TermsOfService` | Footer | IMPLEMENTED | Registered in `web/src/App.tsx:166`. |
| `/api-docs` | `APIDocs` | Footer | IMPLEMENTED / MOCK_ONLY | Registered in `web/src/App.tsx:167`; sandbox presets are local mocks in `web/src/pages/APIDocs.tsx:26-139`. |
| `/buy` | none | none | MISSING | Not registered in `web/src/App.tsx:149-168`. Use `/marketplace` as Phase 1 buy surface. |
| `/sell` | none | none | MISSING | Public route missing. Authenticated seller flow exists at `/dashboard/sell-vehicle` in `web/src/App.tsx:189`. |
| `/verify` | none | none | MISSING | Public route missing. Existing lookup exists inside `VehicleDetail` and `/search`. |
| `/finance` | none | none | MISSING | Public route missing. Financing exists as detail modal and bank dashboard, not public page. |
| `/how-it-works` | none | none | MISSING | Homepage section only in `web/src/pages/Landing.tsx:313-337`. |
| `/dashboard/admin/evidence-review` | none | none | MISSING | Admin evidence route is `/admin/evidence` in `web/src/App.tsx:242`; dashboard nav label is "Evidence Review" in `web/src/components/layout/DashboardLayout.tsx:80-85`. |

Dashboard routes are role-scoped in `web/src/App.tsx:178-243`, with sidebar links defined in `web/src/components/layout/DashboardLayout.tsx:42-93`.

## 3. Navigation Map

| Navigation Area | Items | Status | Evidence |
|---|---|---|---|
| Public desktop nav | Marketplace, Search, Dealers, Garages, Insurance, Pricing | IMPLEMENTED | `navLinks` array in `web/src/components/layout/Navbar.tsx:33-40`; rendered desktop in `web/src/components/layout/Navbar.tsx:83-98`. |
| Public mobile nav | Same as public desktop nav | IMPLEMENTED | Mobile menu state in `web/src/components/layout/Navbar.tsx:42-43`; mobile nav rendered in `web/src/components/layout/Navbar.tsx:236-280`. |
| Public auth actions | Sign In, Get Started | IMPLEMENTED | `web/src/components/layout/Navbar.tsx:213-220` and mobile buttons in `web/src/components/layout/Navbar.tsx:269-276`. |
| Currency selector | USD, ZiG, ZAR, BWP | IMPLEMENTED | `web/src/App.tsx:112-138`; selector in `web/src/components/layout/Navbar.tsx:102-116`. |
| Notifications in public nav | Mock notifications | MOCK_ONLY | `web/src/components/layout/Navbar.tsx:31` imports `notifications`; renders dropdown in `web/src/components/layout/Navbar.tsx:118-148`. |
| Footer Product links | Marketplace, Vehicle Search, Dealer Directory, Garage Directory, Insurance, Pricing | IMPLEMENTED | `web/src/components/layout/Footer.tsx:4-12`. |
| Footer Stakeholder links | Car Owners, Dealers, Mechanics, Insurance, Government | PARTIAL | Links go directly to dashboards in `web/src/components/layout/Footer.tsx:27-33`; these may require authenticated context. |
| Dashboard sidebar nav | Role-specific owner/dealer/mechanic/insurance/government/admin/bank links | IMPLEMENTED | `roleNavItems` in `web/src/components/layout/DashboardLayout.tsx:42-93`. |
| Dashboard mobile sidebar | Collapsible drawer/sidebar | IMPLEMENTED | `sidebarOpen` state and mobile overlay/sidebar in `web/src/components/layout/DashboardLayout.tsx:105-147`. |
| Dashboard settings route | `/settings` link only | MISSING / BROKEN | Link exists in `web/src/components/layout/DashboardLayout.tsx:237-243`; no `/settings` route in `web/src/App.tsx:149-243`. |

Navigation labels to consider for the new strategy:

| Current Label | Proposed Product Strategy Label | Status |
|---|---|---|
| Marketplace | Buy Cars | PARTIAL |
| Search | Verify / Lookup | PARTIAL |
| Dealers | Dealers | IMPLEMENTED |
| Garages | Garages | IMPLEMENTED |
| Insurance | Insurance | IMPLEMENTED |
| Pricing | Pricing | IMPLEMENTED |
| Get Started | Sell / Register Vehicle | PARTIAL |

## 4. Homepage Current Implementation

| Section | Current Implementation | File | Data Source | Reusable? | Gap |
|---|---|---|---|---|---|
| Route/component | `/` renders `Landing` | `web/src/App.tsx:150`, `web/src/pages/Landing.tsx:116` | Static component | Yes | None for routing. |
| Hero | Badge, headline "Every Car Deserves a Digital Identity", subheadline, CTAs | `web/src/pages/Landing.tsx:121-176` | Hardcoded JSX | Partially | Not shopping-first; no search form; no sell plate/VIN entry. |
| Hero CTAs | `Explore Marketplace` to `/marketplace`; `Register Your Vehicle` to `/register` | `web/src/pages/Landing.tsx:147-157` | Hardcoded links | Yes | Seller CTA should likely route to a seller flow, not generic registration. |
| Trust badges | Blockchain Verified, Full Transparency, Bank-Grade Security, AI-Powered | `web/src/pages/Landing.tsx:160-173` | Hardcoded array inline | Yes | Could become Passport/Evidence tags. |
| Stats | 12,000+ vehicles, 850+ dealers, 320+ garages, 98.7% fraud detection | `web/src/pages/Landing.tsx:60-65`, `web/src/pages/Landing.tsx:178-190` | Hardcoded `stats` array | Yes | Not backed by API. |
| Product pillars | Six platform pillars | `web/src/pages/Landing.tsx:21-58`, `web/src/pages/Landing.tsx:192-214` | Hardcoded `pillars` array | Partial | More platform than marketplace category discovery. |
| Featured vehicles | Four featured vehicle cards | `web/src/pages/Landing.tsx:116-117`, `web/src/pages/Landing.tsx:216-283` | `web/src/data/mockData.ts` vehicles | Yes, but normalize first | Uses mock `trustScore`, `isVerified`, `fuelType`; not API `trust_score`, `police_verified`, `fuel_type`. |
| Stakeholders | Cards for owners/dealers/mechanics/insurance/government/banks | `web/src/pages/Landing.tsx:91-98`, `web/src/pages/Landing.tsx:285-311` | Hardcoded | Partial | Cards are informational only; no direct routes. |
| How It Works | Four-step section | `web/src/pages/Landing.tsx:313-337` | Hardcoded inline array | Yes | No standalone `/how-it-works` page. |
| Testimonials | Three testimonials | `web/src/pages/Landing.tsx:67-89`, `web/src/pages/Landing.tsx:339-368` | Hardcoded | Optional | Not tied to marketplace conversion. |
| Final CTA | `Get Started Free` and `Contact Sales` | `web/src/pages/Landing.tsx:370-391` | Hardcoded links | Yes | Needs buy/sell/verify split. |
| Responsive behavior | Tailwind responsive classes (`md:`, `lg:`, `sm:`) | Example: `web/src/pages/Landing.tsx:132`, `web/src/pages/Landing.tsx:137`, `web/src/pages/Landing.tsx:181`, `web/src/pages/Landing.tsx:200`, `web/src/pages/Landing.tsx:229` | CSS classes | Yes | No dedicated responsive tests for new homepage sections. |
| Test IDs | None on landing sections/cards | `rg data-testid web/src/pages/Landing.tsx` returned no matches | none | Needs additions | Add stable test IDs before/with redesign. |

Homepage does route users to marketplace and registration, but not directly to Search, VehicleDetail, Sell, Verify, or Dashboard flows except through nav or later browsing. Existing card links use `/marketplace/${vehicle.id}` in `web/src/pages/Landing.tsx:231`, while API marketplace cards use VIN links in `web/src/pages/Marketplace.tsx:276`.

Files likely modified for Phase 1 homepage redesign:

| File | Why | Risk |
|---|---|---|
| `web/src/pages/Landing.tsx` | Main homepage redesign surface. | Medium: currently mock camelCase fields. |
| `web/src/components/layout/Navbar.tsx` | Public nav labels/order, possible Buy/Sell/Verify links. | Medium: affects desktop/mobile nav and auth actions. |
| `web/src/components/layout/Footer.tsx` | Footer product links may need Buy/Sell/Verify/Finance. | Low. |
| `web/src/data/mockData.ts` | Phase 1 featured cards/categories may need temporary frontend-only fields. | Medium: file is shared by many pages. |
| `web/src/types/index.ts` | If Phase 1 uses normalized UI-only category/tag fields. | Medium: duplicated vehicle types. |
| `tests/agents/01-buyer-journey.spec.ts` | Existing homepage assertions will change. | Medium. |

## 5. Marketplace/Search Implementation

### Marketplace

| Capability | Exists? | Frontend/Backend | File | Gap |
|---|---:|---|---|---|
| Listing fetch | Yes | API via backend base URL | `web/src/pages/Marketplace.tsx:52-80`; `web/src/hooks/useCarUpApi.ts:73-78` | No fallback to mock data in component if API returns empty/fails. |
| Search by make/model/location | Yes | Frontend filter over fetched results | `web/src/pages/Marketplace.tsx:98-103` | Does not search VIN, plate, chassis, tags, evidence, or seller. |
| Make filter | Yes | Frontend | `web/src/pages/Marketplace.tsx:22`, `web/src/pages/Marketplace.tsx:104`, `web/src/pages/Marketplace.tsx:190-195` | Static options, not generated from API. |
| Category/body type filter | Yes | Frontend | `web/src/pages/Marketplace.tsx:20`, `web/src/pages/Marketplace.tsx:103`, `web/src/pages/Marketplace.tsx:197-202` | Uses generic `category`, not requested condition/category slug model. |
| Condition filter | Yes | Frontend | `web/src/pages/Marketplace.tsx:21`, `web/src/pages/Marketplace.tsx:105`, `web/src/pages/Marketplace.tsx:204-209` | Only `New`, `Used`, `Certified Pre-Owned`; no `brand_new`, `recently_imported`, `locally_used`, `second_hand`, `certified_dealer`, `unknown`. |
| Fuel/transmission/location filters | Yes | Frontend | `web/src/pages/Marketplace.tsx:106-108`, `web/src/pages/Marketplace.tsx:211-233` | No API query integration. |
| Price range | Yes | Frontend | `web/src/pages/Marketplace.tsx:64`, `web/src/pages/Marketplace.tsx:109`, `web/src/pages/Marketplace.tsx:235-239` | No persisted URL params. |
| Mileage filter | No | none | Mileage is displayed only in `web/src/pages/Marketplace.tsx:309-313` | Add in Phase 1 frontend only if data present. |
| Trust score sort | Yes | Frontend | `web/src/pages/Marketplace.tsx:117`, sort option in `web/src/pages/Marketplace.tsx:160-164` | No trust threshold filter in UI. |
| Plate/VIN/chassis/temp ID search | No | none in marketplace | `web/src/pages/Marketplace.tsx:100-103` search only make/model/location | Use `/search` or add lookup bar in Phase 1. |
| Evidence count/tag search | No | none | No evidence fields in listing card data | Needs API or derived Passport summary. |
| Card trust/passport markers | Partial | Frontend | Verified from `police_verified` and featured from `trust_score > 90` in `web/src/pages/Marketplace.tsx:284-295` | No "Passport Verified", evidence count, plate verified, or View Passport CTA. |
| Card test IDs | No | none | `rg data-testid web/src/pages/Marketplace.tsx` returned no matches | Add `marketplace-search-input`, `vehicle-card`, `vehicle-card-passport-link`, etc. |

### Search Page

| Search Feature | Exists? | Frontend/Backend | File | Gap |
|---|---:|---|---|---|
| Make/model | Yes | Frontend mock | `web/src/pages/VehicleSearch.tsx:29-30` | Mock only. |
| VIN | Yes | Frontend mock | `web/src/pages/VehicleSearch.tsx:31` | Mock only. |
| Location | Yes | Frontend mock | `web/src/pages/VehicleSearch.tsx:32`, `web/src/pages/VehicleSearch.tsx:47` | Mock only. |
| Plate number | Yes | Frontend mock | `web/src/pages/VehicleSearch.tsx:33-36` | Mock only and only one mock vehicle has a plate. |
| Normalized plate | Yes | Frontend mock | Normalized query in `web/src/pages/VehicleSearch.tsx:28`; normalized compare in `web/src/pages/VehicleSearch.tsx:34-35` | No API lookup. |
| Chassis number | Yes | Frontend mock | `web/src/pages/VehicleSearch.tsx:37-40` | Mock only. |
| Temporary ID | Yes | Frontend mock | `web/src/pages/VehicleSearch.tsx:41-44` | Mock only. |
| Price/mileage/body type | Partial | Frontend mock | Category filter in `web/src/pages/VehicleSearch.tsx:20`, `web/src/pages/VehicleSearch.tsx:24`, `web/src/pages/VehicleSearch.tsx:46`; price/mileage absent | Add filters or use marketplace. |
| Trust score/evidence count/tags | No | none | No field references in `VehicleSearch` | Requires model/API or frontend mock extension. |
| Natural language terms | No | none | Filter is direct substring/identifier matching in `web/src/pages/VehicleSearch.tsx:26-49` | Add parser only after tags exist. |
| Playwright coverage | Yes, narrow | E2E mock/local | `web/e2e/plate-privacy.spec.ts:124-151` tests plate/chassis/temp ID search | No tests for categories/tags or natural language. |

Recommendation: category/tag search should start as a frontend-only Phase 1 filter on normalized UI fields if speed matters, but the durable implementation belongs in a backend/API layer because marketplace currently fetches live data and `/search` is mock-only.

## 6. Vehicle Data Model Readiness

| Needed Field | Exists? | File/Table/API | Current Type | Gap |
|---|---:|---|---|---|
| `vin` | Yes | `shared/types/index.ts:13-15`; DB `database/migrations/supabase_schema.sql:44-45`; mock `web/src/data/mockData.ts:19` | `string` | Implemented. |
| `plate_number` | Yes | `web/src/types/index.ts:49`; DB migration `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:4`; mock optional in `web/src/data/mockData.ts:34` | `string?` | Only one mock vehicle includes it at `web/src/data/mockData.ts:212`. |
| `normalized_plate_number` | Yes | `web/src/types/index.ts:50`; DB migration `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:5`; mock optional in `web/src/data/mockData.ts:35` | `string?` | Not on marketplace cards. |
| `chassis_number` | Yes | `web/src/types/index.ts:52`; DB migration `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:7`; mock optional in `web/src/data/mockData.ts:36` | `string?` | Only one mock vehicle includes it at `web/src/data/mockData.ts:214`. |
| `engine_number` / `engineNumber` | Yes, duplicated naming | `web/src/types/index.ts:43` and `web/src/types/index.ts:53`; DB migration `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:8`; mock `web/src/data/mockData.ts:20` | `string?` | Naming mismatch between API/mock/UI. |
| `mileage` | Yes | `shared/types/index.ts:21`; DB `database/migrations/supabase_schema.sql:52`; mock `web/src/data/mockData.ts:10` | `number` | Implemented. |
| `images` | Partial | Web type `web/src/types/index.ts:18`; listing table type `web/src/types/index.ts:418-425`; storage migration `database/migrations/012_storage_and_media_schema.sql:3-15` | `string[]?` | Shared `Vehicle` has no `images`; marketplace card falls back to Unsplash in `web/src/pages/Marketplace.tsx:273-274`. |
| `trust_score` | Yes | `shared/types/index.ts:29`; DB `database/migrations/supabase_schema.sql:60`; web type inherited | `number` | Mock uses `trustScore` camelCase in `web/src/data/mockData.ts:31`. |
| `trustScore` | Yes, mock/web only | `web/src/types/index.ts:22`; mock `web/src/data/mockData.ts:31` | `number?` | Duplication risk with `trust_score`. |
| `evidence` / `evidenceSummary` | Partial | `VehiclePassport.evidenceTimeline`, `evidenceVault` in `web/src/types/index.ts:473-484`; `VehicleEvidence` in `web/src/types/index.ts:349-380` | Passport-only | No listing-card summary field. |
| `sourceCoverage` | No | none found | none | Missing. |
| `dataConfidence` | No | none found | none | Missing. |
| `ownershipSummary` | Yes | `web/src/types/index.ts:464-484` | `OwnershipSummary` on `VehiclePassport` | Only available after passport lookup/detail. |
| `plateHistory` | Yes | `web/src/types/index.ts:442-484`; DB table in `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:19-40` | `VehiclePlateHistory[]` on `VehiclePassport` | Only available after passport lookup/detail. |
| `dealer_id` | No exact field | `tenant_id`, `sellerId`, `current_seller_id` exist in `web/src/types/index.ts:46-47`, `web/src/types/index.ts:60` | mixed strings | Need canonical seller/dealer identity. |
| `seller_id` | Partial | `sellerId` in `web/src/types/index.ts:47`; `current_seller_id` in `web/src/types/index.ts:60`; mock `sellerId` in `web/src/data/mockData.ts:27` | mixed strings | API payloads may use different names. |
| listing `status` | Yes | `shared/types/index.ts:28`; web type `web/src/types/index.ts:30`; DB `database/migrations/supabase_schema.sql:59` | string/union | Web type allows many strings; shared type narrower. |
| `vehicle_condition_category` | No | none | none | BACKEND_NEEDED. |
| `marketplace_tags` | No | none | none | BACKEND_NEEDED. |
| `import_status` | No | none | none | `import_source` and `duty_paid` exist in `shared/types/index.ts:25-27`; not a status field. |
| `duty_status` | Partial | `duty_paid` boolean in `shared/types/index.ts:26`; DB `database/migrations/supabase_schema.sql:57`; trust metric `zimra_duty` in `web/src/types/index.ts:385` | boolean | Need explicit display/status if product wants `duty_cleared`. |
| `zimra_status` | Partial | Trust metric `zimra_duty` in `web/src/types/index.ts:385`; timeline source `zimra` in `web/src/types/index.ts:268` | boolean/source | No DB/listing field. |
| `cid_status` | Partial | Trust metric `zrp_police_cleared` in `web/src/types/index.ts:386`; timeline source `cid` in `web/src/types/index.ts:271` | boolean/source | No explicit `cid_status`. |
| `low_mileage` | No | none | none | Can derive frontend from mileage, but field/tag missing. |
| `dealer_verified` | No exact field | Dealer mock `isVerified` in `web/src/data/mockData.ts:54`; vehicle mock `isVerified` in `web/src/data/mockData.ts:30`; vehicle API `police_verified` | booleans | Need canonical meaning. |

Duplicated and weak typing risks:

| Risk | Status | Evidence |
|---|---|---|
| Duplicate Vehicle type in shared package | PARTIAL | `shared/types/index.ts:13-33`. |
| Duplicate web Vehicle extending shared type | PARTIAL | `web/src/types/index.ts:14-63`. |
| Duplicate mock Vehicle | PARTIAL | `web/src/data/mockData.ts:3-38`. |
| Duplicate hook-local Vehicle | PARTIAL | `web/src/hooks/useVehicles.ts:4-23`. |
| Weak `any` in API hook | PARTIAL | Generic default `request<T = any>` in `web/src/hooks/useCarUpApi.ts:26`; many functions return `Promise<any>` in `web/src/hooks/useCarUpApi.ts:66`, `122`, `126`, `133`, etc. |
| Weak `any` in domain types | PARTIAL | `WorkOrder.parts?: any` in `web/src/types/index.ts:83`; `ApiMutationResponse` index signature in `web/src/types/index.ts:524-531`. |

## 7. Mock Data Readiness

| Question | Status | Evidence / Answer |
|---|---|---|
| Which mock vehicle data files exist? | IMPLEMENTED | Primary file is `web/src/data/mockData.ts`; mock `Vehicle` starts at `web/src/data/mockData.ts:3`. |
| How many mock vehicles exist? | IMPLEMENTED | 12 mock vehicles, IDs `v1` through `v12` in `web/src/data/mockData.ts:195`, `230`, `260`, `291`, `321`, `352`, `383`, `413`, `443`, `473`, `503`, `533`. |
| Which pages still depend on mockData? | PARTIAL | Imports found in `Landing`, `VehicleSearch`, `DealerDirectory`, `GarageDirectory`, `InsuranceDirectory`, `Pricing`, `Navbar`, and multiple dashboards. |
| Plate/chassis/temp ID in mockData? | PARTIAL | Optional fields in `web/src/data/mockData.ts:34-37`; only `v1` visibly includes plate/chassis/temp ID in `web/src/data/mockData.ts:212-215`. |
| Mileage/images/trust score in mockData? | IMPLEMENTED | Fields in `web/src/data/mockData.ts:10`, `18`, `31`; vehicles include local images such as `web/src/data/mockData.ts:209`. |
| Evidence count/tags in mockData? | MISSING | No `evidence_count`, `evidenceSummary`, or `marketplace_tags` fields in `web/src/data/mockData.ts:3-38`. |
| Vehicle condition category in mockData? | PARTIAL | Has `condition: 'New' | 'Used' | 'Certified Pre-Owned'` in `web/src/data/mockData.ts:14`; no requested slug field. |
| Marketplace tags in mockData? | MISSING | No tag field in mock Vehicle interface `web/src/data/mockData.ts:3-38`. |
| Brand New representation | PARTIAL | Mock type allows `New` in `web/src/data/mockData.ts:14`; actual sampled vehicles shown are mostly `Used` or `Certified Pre-Owned`, e.g. `web/src/data/mockData.ts:205`, `240`, `301`, `513`. |
| Recently Imported representation | MISSING | No `import_status`, `recently_imported`, or `fresh_import` field. |
| Locally Used / Second Hand | PARTIAL | Generic `Used` exists, but no distinction between locally used and second hand. |
| Dealer Certified | PARTIAL | `Certified Pre-Owned` exists at `web/src/data/mockData.ts:240` and `web/src/data/mockData.ts:513`; no `certified_dealer` slug/tag. |
| Vehicle images | IMPLEMENTED | Local image paths under `/images/vehicles/...`, e.g. `web/src/data/mockData.ts:209`, `244`, `274`. |
| Fake images presented as verified historical evidence? | IMPLEMENTED / No finding | Mock listing images are not presented as historical evidence. Evidence UI uses Passport timeline/evidence data, not `mockData` listing images. |

Pages importing mock data:

| File | Mock import | Status |
|---|---|---|
| `web/src/pages/Landing.tsx` | `vehicles` | MOCK_ONLY for featured vehicles |
| `web/src/pages/VehicleSearch.tsx` | `vehicles`, `zimbabweLocations` | MOCK_ONLY search |
| `web/src/pages/DealerDirectory.tsx` | `dealers` | MOCK_ONLY |
| `web/src/pages/GarageDirectory.tsx` | `garages` | MOCK_ONLY |
| `web/src/pages/InsuranceDirectory.tsx` | `insuranceProviders` | MOCK_ONLY |
| `web/src/pages/Pricing.tsx` | `subscriptionPlans` | MOCK_ONLY |
| `web/src/components/layout/Navbar.tsx` | `notifications` | MOCK_ONLY |
| `web/src/pages/dashboard/dealer/DealerDashboard.tsx` | `vehicles as mockVehicles`, `dashboardStats` | FALLBACK MOCK |
| `web/src/pages/dashboard/owner/SellVehicle.tsx` | locations/provinces only | PARTIAL |

## 8. Passport/Evidence Field Readiness

| Capability | Current Status | Evidence | Gap |
|---|---|---|---|
| Homepage can access evidenceSummary | MISSING | Homepage imports only `vehicles` from mock data in `web/src/pages/Landing.tsx:19`; mock vehicles have no evidence fields in `web/src/data/mockData.ts:3-38`. | Needs card summary field or per-vehicle passport calls. |
| Marketplace cards can show evidence count | MISSING | Marketplace card reads images, police verification, trust score, price, mileage, transmission, fuel, seller, location in `web/src/pages/Marketplace.tsx:270-324`; no evidence count. | Needs `evidence_count`/summary from API or derived query. |
| Marketplace cards can show plate verified status | PARTIAL | Data model has `plate_verified_at` in `web/src/types/index.ts:58` and DB migration `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:13`; card does not render it. | Add card UI and ensure listing API returns it. |
| Marketplace cards can show trust score | PARTIAL | Cards sort by `trust_score` in `web/src/pages/Marketplace.tsx:117` and mark featured when `trust_score > 90` in `web/src/pages/Marketplace.tsx:290-292`; visible numeric trust badge is absent on marketplace cards. | Add badge. |
| Homepage cards can show trust score | MOCK_ONLY | Landing cards show `Trust {vehicle.trustScore}` in `web/src/pages/Landing.tsx:249-252`. | Mock-only camelCase field. |
| Cards can show Passport Verified | MISSING | No `passport_verified` field in types/mock/DB; VehicleDetail uses Passport but listing cards do not. | Define semantics. |
| Cards link to VehicleDetail / Passport page | IMPLEMENTED | Landing cards link to `/marketplace/${vehicle.id}` in `web/src/pages/Landing.tsx:231`; Marketplace cards link to `/marketplace/${vehicle.vin}` in `web/src/pages/Marketplace.tsx:276`; route is `web/src/App.tsx:152`. | Landing should use VIN or lookup-safe ID, not mock ID, if Passport lookup expects VIN/plate/chassis. |
| VehicleDetail displays Evidence Timeline / Evidence Vault | IMPLEMENTED | Evidence tab in `web/src/pages/VehicleDetail.tsx:660-733`; test in `web/e2e/evidence-timeline.spec.ts:127-147`. | Good reusable proof surface. |
| VehicleDetail displays trust/verification sources | IMPLEMENTED | `buildVerificationSources` in `web/src/pages/VehicleDetail.tsx:71-129`; verification tab in `web/src/pages/VehicleDetail.tsx:735-770`. | Listing cards do not reuse this. |
| VehicleDetail displays ownership summary and plate history | IMPLEMENTED | `web/src/pages/VehicleDetail.tsx:895-956`; tested in `web/e2e/plate-privacy.spec.ts:5-122`. | Detail-only. |
| API/hook for featured verified vehicles | MISSING | `useCarUpApi.fetchVehicles(filters?)` exists in `web/src/hooks/useCarUpApi.ts:73-78`; no dedicated featured endpoint. `useVehicles` can query Supabase and order by trust score in `web/src/hooks/useVehicles.ts:55-67` but is not used by homepage. | Phase 1 use mock or existing `/vehicles`; Phase 2 add endpoint/view. |
| Backend endpoint for featured verified vehicles | BACKEND_NEEDED | No hook function other than generic `fetchVehicles`; no category/tag endpoint in `web/src/hooks/useCarUpApi.ts:402-467`. | Add `/vehicles/featured` or query params when backend supports tags/summary. |

## 9. Topical Page Readiness

| Page | Route | Component | Exists? | Current Functionality | Gap | Recommended Hero Direction |
|---|---|---|---:|---|---|---|
| Buy | `/buy` missing; `/marketplace` is current substitute | `Marketplace` | PARTIAL | Shows API-backed listings with filters in `web/src/pages/Marketplace.tsx:133-333`. | No shopping-first `/buy` route or homepage buy hero. | Use `/marketplace` for Phase 1 "Buy Cars"; add `/buy` only if routing strategy requires it. |
| Sell | `/sell` missing; `/dashboard/sell-vehicle` exists | `SellVehicle` | PARTIAL | Authenticated multi-step listing form in `web/src/pages/dashboard/owner/SellVehicle.tsx:46-157`; route in `web/src/App.tsx:189`. | No public seller landing or plate/VIN prefill flow. | Public sell CTA with plate/VIN/VIN entry, then auth/listing handoff. |
| Verify | `/verify` missing | none; partial via `VehicleSearch`, `VehicleDetail`, `TrustSafety` | PARTIAL | `/search` supports VIN/chassis/plate/temp ID over mock data in `web/src/pages/VehicleSearch.tsx:26-49`; detail lookup form routes to `/marketplace/:id` in `web/src/pages/VehicleDetail.tsx:184-190`. | No dedicated public verification page. | "Verify a car by plate, VIN, chassis, or temporary ID" backed by passport lookup. |
| Finance | `/finance` missing | none public; detail modal + bank dashboards | PARTIAL | Detail finance CTA/modal in `web/src/pages/VehicleDetail.tsx:837-844` and `web/src/pages/VehicleDetail.tsx:1029-1069`; API hook `submitFinancing` in `web/src/hooks/useCarUpApi.ts:176-181`. | No public finance education/prequalification page. | "Finance verified cars with trust-score-backed checks." |
| Dealers | `/dealers` | `DealerDirectory` | MOCK_ONLY | Search/filter mock dealers in `web/src/pages/DealerDirectory.tsx:10-14`; cards route to `/marketplace` in `web/src/pages/DealerDirectory.tsx:69-70`. | No real dealer inventory scoping. | "Shop verified dealer inventory." |
| Garages | `/garages` | `GarageDirectory` | MOCK_ONLY / UI_ONLY | Search mock garages in `web/src/pages/GarageDirectory.tsx:9-13`; "Book Service" button in `web/src/pages/GarageDirectory.tsx:69`. | Button not wired; no real booking. | "Inspection-ready garages and service evidence." |
| Insurance | `/insurance` | `InsuranceDirectory` | MOCK_ONLY / UI_ONLY | Mock provider list in `web/src/pages/InsuranceDirectory.tsx:9-13`; "Get a Quote" in `web/src/pages/InsuranceDirectory.tsx:59`. | No quote flow on public page. | "Insure verified vehicles faster." |
| Pricing | `/pricing` | `Pricing` | MOCK_ONLY | Mock subscription plans and stakeholder pricing in `web/src/pages/Pricing.tsx:10-99`. | Not marketplace conversion-focused. | Keep as pricing, but connect seller/dealer plans. |
| How It Works | no route | Landing section | PARTIAL | Homepage section in `web/src/pages/Landing.tsx:313-337`. | No standalone page/nav link. | Keep homepage band Phase 1; add route later only if content depth warrants. |
| Marketplace | `/marketplace` | `Marketplace` | PARTIAL | API-backed listing grid and client-side filters. | Missing passport/evidence tags and listing summary. | Primary buy surface. |
| Search | `/search` | `VehicleSearch` | MOCK_ONLY | Local VIN/chassis/plate/temp ID search. | Needs Passport API integration. | Rename/merge into Verify or add prominent lookup on homepage. |

## 10. Phase 1 Frontend-Only Implementation Recommendation

Can we implement the new homepage without backend changes? Yes, with limits.

| Task | Files | Backend Needed? | Risk | Priority |
|---|---|---:|---|---:|
| Redesign `Landing` into marketplace-first first viewport with buy/search/sell/verify entry points. | `web/src/pages/Landing.tsx` | No | Medium | 1 |
| Reuse mock featured vehicles for homepage card prototypes, but normalize card reads to tolerate API-style fields. | `web/src/pages/Landing.tsx`, possibly `web/src/data/mockData.ts` | No | Medium | 1 |
| Add a homepage lookup form that routes to `/marketplace/:identifier` or `/search?q=...` without calling a new API. | `web/src/pages/Landing.tsx` | No | Low | 1 |
| Add visible "View Passport" CTA by linking cards to `/marketplace/:vin`. | `web/src/pages/Landing.tsx` | No | Low | 1 |
| Add category tiles using existing `category` values (`Sedan`, `SUV`, `Hatchback`, `Pickup`, `Luxury`, `Commercial`). | `web/src/pages/Landing.tsx`; optionally URL params later | No | Low | 2 |
| Add temporary frontend-only labels for "Fresh Import", "Duty Paid", "Low Mileage", etc. derived from existing fields where available. | `web/src/pages/Landing.tsx` | No | Medium | 2 |
| Update nav labels/order to Buy/Search/Dealers/Garages/Insurance/Pricing or Buy/Sell/Verify as product decides. | `web/src/components/layout/Navbar.tsx`, `web/src/components/layout/Footer.tsx` | No | Medium | 2 |
| Add stable test IDs to homepage, marketplace cards, and lookup controls. | `web/src/pages/Landing.tsx`, `web/src/pages/Marketplace.tsx`, `web/src/pages/VehicleSearch.tsx` | No | Low | 1 |
| Update Playwright buyer journey assertions for new hero and marketplace-first flows. | `tests/agents/01-buyer-journey.spec.ts` | No | Medium | 1 |

Safest Phase 1 scope:

1. Keep routes unchanged except nav labels/links where necessary.
2. Use `/marketplace` as Buy.
3. Use `/dashboard/sell-vehicle` or `/register` as the seller handoff until public `/sell` exists.
4. Use `/marketplace/:identifier` for Passport lookup because `VehicleDetail` already calls `lookupVehiclePassport(id)`.
5. Avoid schema changes and do not introduce canonical tag fields until backend design is settled.

Existing tests likely to break:

| Test | Why |
|---|---|
| `tests/agents/01-buyer-journey.spec.ts:50-55` | Expects current homepage badge and "Explore Marketplace" CTA. |
| `tests/agents/01-buyer-journey.spec.ts:57-64` | Marketplace search placeholder may change if redesigned. |
| `web/e2e/vehicle-detail.spec.ts` | It appears to expect `a[href*="/vehicles/"]` and `waitForURL('**/vehicles/**')`, while current marketplace uses `/marketplace/:vin` in `web/src/pages/Marketplace.tsx:276`. Verify before relying on it. |

## 11. Phase 2 Backend/Category-Service Recommendation

Defer the durable marketplace category/tag model until Phase 2.

| Need | Status | Backend/Data Work |
|---|---|---|
| `vehicle_condition_category` enum | BACKEND_NEEDED | Add canonical enum/constraint or lookup table for `brand_new`, `recently_imported`, `locally_used`, `second_hand`, `certified_dealer`, `unknown`. |
| `marketplace_tags` | BACKEND_NEEDED | Add array/table/view for tags such as `passport_verified`, `plate_verified`, `duty_cleared`, `cid_clear`, `safe_pay_ready`. |
| Featured verified vehicles endpoint | BACKEND_NEEDED | Add `/vehicles/featured` or support `fetchVehicles({ featured, verified, tags })`; include card-ready fields. |
| Listing card evidence summary | BACKEND_NEEDED | Add API field(s): `evidence_count`, `verified_evidence_count`, `evidence_summary`, `passport_verified`, `plate_verified`. |
| Search/ranking upgrades | BACKEND_NEEDED | Add backend query support for make/model/location/price/mileage/body type/condition/tags/trust/evidence plus VIN/plate/chassis lookup. |
| Natural language category parsing | SHOULD_DEFER | Implement after tags exist; map "fresh import" to `recently_imported`/`fresh_import`, "duty cleared" to `duty_cleared`, etc. |
| Dealer/public seller identity | BACKEND_NEEDED | Normalize `tenant_id`, `sellerId`, `current_seller_id`, `current_seller_type`, and dealer verification into card-ready seller fields. |
| Supabase public reads | BACKEND_NEEDED | If using direct Supabase `useVehicles`, ensure RLS and exposed columns match public marketplace needs; current `useVehicles` reads `vehicles.select('*')` in `web/src/hooks/useVehicles.ts:55`. |

Current backend/data foundations:

| Foundation | Status | Evidence |
|---|---|---|
| Base `vehicles` table | IMPLEMENTED | `database/migrations/supabase_schema.sql:44-64`. |
| Plate/chassis/temp ID fields | IMPLEMENTED | `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:3-17`. |
| Plate lookup indexes | IMPLEMENTED | `database/migrations/013_zimbabwe_plate_and_owner_privacy.sql:42-46`. |
| Evidence table | IMPLEMENTED | `database/migrations/014_passport_evidence_architecture.sql:3-38`. |
| Evidence public verified RLS | IMPLEMENTED | `database/migrations/015_vehicle_evidence_timeline.sql:52-66`. |
| Category/tag schema | MISSING | No matching fields in migrations searched. |

## 12. Risks and Files to Avoid Touching

| Risk | Status | File(s) | Recommendation |
|---|---|---|---|
| Accidentally editing unused `Home.tsx` | SHOULD_DEFER | `web/src/pages/Home.tsx:4-19` | Do not use for homepage unless routing changes; current homepage is `Landing`. |
| Breaking API marketplace by assuming mock camelCase fields | PARTIAL | `web/src/pages/Landing.tsx`, `web/src/pages/Marketplace.tsx`, `web/src/types/index.ts`, `web/src/data/mockData.ts` | Normalize card data or support both `trustScore`/`trust_score` and `fuelType`/`fuel_type`. |
| Making `/search` look real while it is mock-only | MOCK_ONLY | `web/src/pages/VehicleSearch.tsx:15-49` | Label internally as mock/Phase 1 or integrate Passport lookup before marketing as verification. |
| Adding DB-backed tags in frontend only | SHOULD_DEFER | `web/src/data/mockData.ts`, `web/src/types/index.ts` | Frontend-only tags are fine for Phase 1 display, but do not treat as canonical. |
| Touching Passport detail logic unnecessarily | SHOULD_DEFER | `web/src/pages/VehicleDetail.tsx` | It already supports the trust differentiation; only link into it from homepage/cards. |
| Touching migrations during Phase 1 | SHOULD_DEFER | `database/migrations/*` | No schema changes needed for frontend-only redesign. |
| Directly using `useVehicles` without RLS/API decision | SHOULD_DEFER | `web/src/hooks/useVehicles.ts` | Hook is Supabase-powered and unused by current marketplace; decide architecture first. |
| Breaking dashboard role navigation | SHOULD_DEFER | `web/src/components/layout/DashboardLayout.tsx` | Public nav redesign should not alter dashboard nav unless requested. |
| Stale Playwright selectors | PARTIAL | `web/e2e/vehicle-detail.spec.ts`, `tests/agents/01-buyer-journey.spec.ts` | Update tests alongside UI changes. |

## 13. Testing Plan

Existing relevant tests:

| Test File | Coverage | Status |
|---|---|---|
| `tests/agents/01-buyer-journey.spec.ts:50-55` | Homepage badge + Explore Marketplace CTA | IMPLEMENTED but will need update after redesign. |
| `tests/agents/01-buyer-journey.spec.ts:57-64` | Marketplace heading and search input | IMPLEMENTED. |
| `tests/agents/01-buyer-journey.spec.ts:66-72` | Vehicle detail page basics with mocked API | IMPLEMENTED. |
| `web/e2e/plate-privacy.spec.ts:5-122` | Detail page plate, registration status, ownership privacy, plate history | IMPLEMENTED. |
| `web/e2e/plate-privacy.spec.ts:124-151` | `/search` matches plate, normalized plate, chassis, temp ID | IMPLEMENTED for mock search. |
| `web/e2e/plate-privacy.spec.ts:153-179` | Unverified plate advisory | IMPLEMENTED. |
| `web/e2e/evidence-timeline.spec.ts:127-147` | Evidence Vault timeline renders linked evidence | IMPLEMENTED. |

Missing tests to add:

| Test | Suggested Test IDs | Why |
|---|---|---|
| Marketplace-first homepage hero renders buy/sell/verify flows | `home-hero`, `home-buy-search`, `home-sell-lookup`, `home-verify-lookup` | Current homepage has no test IDs and no marketplace-first assertions. |
| Homepage search routes correctly | `home-search-input`, `home-search-submit` | Verify AutoTempest-style one-search behavior. |
| Homepage sell plate/VIN entry routes to intended handoff | `home-sell-input`, `home-sell-submit` | Validate CarMax-inspired sell flow without backend. |
| Featured verified vehicle cards render trust and passport CTA | `featured-vehicle-card`, `featured-trust-score`, `featured-view-passport` | Ensure trust/passport differentiation survives redesign. |
| Popular categories render and link/filter correctly | `category-tile-suv`, `category-tile-pickup`, etc. | Required for Cars.com-style category discovery. |
| Public nav desktop and mobile include intended labels | `public-nav-buy`, `public-nav-sell`, `public-nav-verify` | Current Navbar has no nav test IDs. |
| Marketplace cards expose stable selectors | `vehicle-card`, `vehicle-card-trust-score`, `vehicle-card-verified-badge` | `web/e2e/vehicle-detail.spec.ts` already expects `vehicle-card` but current `Marketplace` does not provide it. |
| Search category/tag parser, once added | `search-tag-filter`, `search-results-count` | Needed after Phase 2 tags. |

Recommended verification command after Phase 1 changes:

| Command | Purpose |
|---|---|
| `cd web && npm run build` | Type/build safety. |
| `npx playwright test -c playwright.config.ts tests/agents/01-buyer-journey.spec.ts` from repo root | Buyer/home/marketplace regression. |
| `cd web && npx playwright test e2e/plate-privacy.spec.ts e2e/evidence-timeline.spec.ts` | Verify Passport/evidence regressions. |

