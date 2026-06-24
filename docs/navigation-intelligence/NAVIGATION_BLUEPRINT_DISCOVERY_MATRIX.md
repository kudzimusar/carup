# CarUp Navigation Intelligence Blueprint — Discovery Matrix

> Source: verified discovery output (run 2026-06-21) against this repository's `web/` and `backend/` trees.
> Every row below traces to a verified fact from that discovery. No items, routes, or counts are invented.
>
> **Lifecycle target legend:** `active` = ship as-is | `beta` = ship behind beta flag | `planned` = registry `isPlanned` / not yet routed | `hidden` = registry `isHidden` | `disabled` = present but non-interactive | `deprecated` = obsolete/duplicate route to retire | `coverage-gated` = resolved via `resolveCoverageNavHref` | `generic-fallback` = currently points at a generic route with no deep-link query.
>
> **Governed-trust rule:** rows tagged *(governed-trust)* — Passport Verified, PartSentry Checked, Dealer Verified, Brand New, Second Hand — MUST NOT be activated by heuristics. Their lifecycle target is `planned` until a real signal/classification source exists.

## Discovery Matrix

| Surface | Parent menu | Section | Label | Current route | Query | Icon | Public/protected | Roles | Lifecycle | Coverage rule | Source file | Registry ID | Duplicate source | Intended action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Desktop header | (root) | Brand | Logo / Home | `/` | none | none documented | public | all | active | none | Navbar.tsx | — | — | keep as home anchor |
| Desktop mega-menu | Buy | Vehicles | Shop All Cars | `/marketplace` | none | missing | public | all | active | none | Navbar.tsx (buyMenu 48-91) | hardcoded | duplicate of /marketplace (canonical Buy target) | keep as canonical Buy entry; dedupe siblings |
| Desktop mega-menu | Buy | Vehicles | Brand New Cars *(governed-trust)* | `/marketplace` | none | missing | public | all | planned | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification; MUST NOT be activated by heuristics |
| Desktop mega-menu | Buy | Vehicles | Recently Imported | `/marketplace` | none | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | Buy | Vehicles | Locally Used | `/marketplace` | `?coverage=locally_used` (resolved) | missing | public | all | coverage-gated | COVERAGE_GATED_NAV `{'Locally Used':'locally_used'}` via resolveCoverageNavHref | Navbar.tsx (buyMenu) + marketplaceParams.ts | hardcoded | duplicates /marketplace base | keep coverage-gated; only Buy menu is currently coverage-resolved |
| Desktop mega-menu | Buy | Vehicles | Second Hand Cars *(governed-trust)* | `/marketplace` | none | missing | public | all | planned | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification; MUST NOT be activated by heuristics |
| Desktop mega-menu | Buy | Vehicles | Dealer Verified Cars *(governed-trust)* | `/marketplace` | `?tag=dealer_verified` | missing | public | all | planned | none | Navbar.tsx (buyMenu) | hardcoded | shares /marketplace base | keep query but gate on real verification signal; MUST NOT be activated by heuristics |
| Desktop mega-menu | Buy | Vehicles | Passport Verified Cars *(governed-trust)* | `/marketplace` | none | missing | public | all | planned | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification; MUST NOT be activated by heuristics |
| Desktop mega-menu | Buy | Popular Categories | SUVs | `/marketplace` | none | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | Buy | Popular Categories | Pickups | `/marketplace` | none | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | Buy | Popular Categories | Hatchbacks | `/marketplace` | none | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | Buy | Popular Categories | Sedans | `/marketplace` | none | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | Buy | Popular Categories | Toyota | `/marketplace` | none (no make filter) | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | Buy | Popular Categories | Honda | `/marketplace` | none (no make filter) | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | Buy | Popular Categories | Mazda | `/marketplace` | none (no make filter) | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | Buy | Popular Categories | Under $5,000 | `/marketplace` | `?maxPrice=5000` | missing | public | all | active | none | Navbar.tsx (buyMenu) | hardcoded | shares /marketplace base | keep (real deep-link query present) |
| Desktop mega-menu | Buy | Popular Categories | Under $10,000 | `/marketplace` | `?maxPrice=10000` | missing | public | all | active | none | Navbar.tsx (buyMenu) | hardcoded | shares /marketplace base | keep (real deep-link query present) |
| Desktop mega-menu | Buy | Buyer Tools | Verify Before You Buy | `/search` | none | missing | public | all | active | none | Navbar.tsx (buyMenu) | hardcoded | shares /search | keep |
| Desktop mega-menu | Buy | Buyer Tools | View Vehicle Passport | `/search` | none | missing | public | all | active | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /search | keep or dedupe vs Verify entries |
| Desktop mega-menu | Buy | Buyer Tools | Highest Trust Listings | `/marketplace` | `?sort=trust` | missing | public | all | active | none | Navbar.tsx (buyMenu) | hardcoded | shares /marketplace base | keep (real deep-link query present) |
| Desktop mega-menu | Buy | Buyer Tools | PartSentry Checked Vehicles *(governed-trust)* | `/marketplace` | none | missing | public | all | planned | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace | needs deep-link query or planned classification; MUST NOT be activated by heuristics |
| Desktop mega-menu | Buy | Trust Guide | Trust Guide entries | `/marketplace`, `/search` | none | missing | public | all | generic-fallback | none | Navbar.tsx (buyMenu) | hardcoded | duplicates /marketplace and /search | needs deep-link query or planned classification |
| Desktop mega-menu | Sell | Sell Vehicles | Sell Your Car | `sellerPath` (`/dashboard/sell-vehicle` if auth else `/register`) | none | missing | public→protected | all (auth-conditional) | active | none | Navbar.tsx (sellMenu 258-292) | hardcoded | sellerPath shared by siblings | keep auth-conditional resolution |
| Desktop mega-menu | Sell | Sell Vehicles | Create Vehicle Passport | `/dashboard/garage` if auth else `/register` | none | missing | public→protected | all (auth-conditional) | active | none | Navbar.tsx (sellMenu) | hardcoded | — | keep |
| Desktop mega-menu | Sell | Sell Vehicles | Dealer Listing | `/dealer/inventory` if auth else `/register` | none | missing | public→protected | dealer (auth-conditional) | active | none | Navbar.tsx (sellMenu) | hardcoded | — | keep; gate on dealer role when authed |
| Desktop mega-menu | Sell | Sell Vehicles | Sell as Private Owner | `sellerPath` | none | missing | public→protected | all (auth-conditional) | active | none | Navbar.tsx (sellMenu) | hardcoded | duplicates sellerPath | dedupe vs Sell Your Car |
| Desktop mega-menu | Sell | Seller Tools | Start with Plate/VIN | `sellerPath` | none | missing | public→protected | all (auth-conditional) | active | none | Navbar.tsx (sellMenu) | hardcoded | duplicates sellerPath | keep |
| Desktop mega-menu | Sell | Seller Tools | Upload Vehicle Evidence | `/dashboard/garage` if auth else `/register` | none | missing | public→protected | all (auth-conditional) | active | none | Navbar.tsx (sellMenu) | hardcoded | duplicates garage route | keep |
| Desktop mega-menu | Sell | Seller Tools | Add Service History | `/dashboard/service-history` if auth else `/register` | none | missing | public→protected | all (auth-conditional) | active | none | Navbar.tsx (sellMenu) | hardcoded | — | keep |
| Desktop mega-menu | Sell | Seller Tools | SafePay/Reservation Ready | `/dashboard/listings` if auth else `/register` | none | missing | public→protected | all (auth-conditional) | active | none | Navbar.tsx (sellMenu) | hardcoded | — | keep |
| Desktop mega-menu | Sell | Sell Parts & Accessories | Sell Car Parts | `/register` | none | missing | public | all | active | none | Navbar.tsx (sellMenu) | hardcoded | duplicates /register | keep |
| Desktop mega-menu | Sell | Sell Parts & Accessories | Sell Accessories | `/register` | none | missing | public | all | active | none | Navbar.tsx (sellMenu) | hardcoded | duplicates /register | keep |
| Desktop mega-menu | Sell | Sell Parts & Accessories | Mechanic/Garage Parts Listing | `/garages` | none | missing | public | mechanic/dealer-facing | active | none | Navbar.tsx (sellMenu) | hardcoded | shares /garages | keep |
| Desktop mega-menu | Sell | Seller Guide | Seller Guide entries | `/register`, `/search` | none | missing | public | all | generic-fallback | none | Navbar.tsx (sellMenu) | hardcoded | duplicates /register and /search | needs deep-link query or planned classification |
| Desktop mega-menu | Verify | Vehicle Verification | Verify by Plate/VIN/Chassis | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu 227-256) | hardcoded | shares /search | keep |
| Desktop mega-menu | Verify | Vehicle Verification | Open Vehicle Passport | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep or dedupe |
| Desktop mega-menu | Verify | Trust Checks | Ownership Privacy Summary | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Verify | Trust Checks | Evidence Timeline | `/dashboard/garage` if auth else `/search` | none | missing | public→protected | all (auth-conditional) | active | none | Navbar.tsx (verifyMenu) | hardcoded | — | keep |
| Desktop mega-menu | Verify | Trust Checks | ZIMRA/Duty Signals | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Verify | Trust Checks | CID/Theft Signals | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Verify | Trust Checks | Odometer/Mileage Signals | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Verify | PartSentry Verification | Check Part History | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Verify | PartSentry Verification | Repair Logs | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Verify | PartSentry Verification | Swapped Parts | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Verify | PartSentry Verification | Stolen Parts | `/search` | none | missing | public | all | active | none | Navbar.tsx (verifyMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Parts | Buy Parts | Browse Car Parts | `/marketplace/parts` | none | missing | public | all | active | none | Navbar.tsx (partsMenu 93-135) | hardcoded | canonical Parts target | keep as canonical Parts entry |
| Desktop mega-menu | Parts | Buy Parts | Verified Parts *(governed-trust)* | `/marketplace/parts` | none | missing | public | all | planned | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification; MUST NOT be activated by heuristics |
| Desktop mega-menu | Parts | Buy Parts | Engines | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Buy Parts | Gearboxes | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Buy Parts | ECUs | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Buy Parts | Body Panels | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Buy Parts | Lights | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Buy Parts | Tyres & Wheels | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Buy Parts | Batteries | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Buy Parts | Accessories | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Sell Parts | Sell a Part | `/register` | none | missing | public | all | active | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /register | keep |
| Desktop mega-menu | Parts | Sell Parts | List Accessories | `/register` | none | missing | public | all | active | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /register | keep |
| Desktop mega-menu | Parts | Sell Parts | Garage Parts Inventory | `/marketplace/parts` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | Sell Parts | Mechanic Parts Catalog | `/marketplace/parts` | none | missing | public | mechanic-facing | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /marketplace/parts | needs deep-link query or planned classification |
| Desktop mega-menu | Parts | PartSentry | Verify Part Origin | `/search` | none | missing | public | all | active | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Parts | PartSentry | Check Repair History | `/search` | none | missing | public | all | active | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Parts | PartSentry | Report Stolen Part | `/search` | none | missing | public | all | active | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Parts | PartSentry | Link Part to Passport | `/search` | none | missing | public | all | active | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /search | keep |
| Desktop mega-menu | Parts | PartSentry | Mechanic Work Orders | `/register` | none | missing | public | mechanic-facing | active | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /register | keep |
| Desktop mega-menu | Parts | Parts Trust Guide | Parts Trust Guide entries | `/search`, `/marketplace` | none | missing | public | all | generic-fallback | none | Navbar.tsx (partsMenu) | hardcoded | duplicates /search and /marketplace | needs deep-link query or planned classification |
| Desktop mega-menu | More/Services | More | Insurance | `/insurance` | none | missing | public | all | active | none | Navbar.tsx (moreMenu 137-151) | hardcoded | — | keep |
| Desktop mega-menu | More/Services | More | Pricing | `/pricing` | none | missing | public | all | active | none | Navbar.tsx (moreMenu) | hardcoded | — | keep |
| Desktop mega-menu | More/Services | More | Diaspora Trade | `/diaspora` | none | missing | public | all | active | none | Navbar.tsx (moreMenu) | hardcoded | — | keep |
| Desktop mega-menu | More/Services | More | How It Works | `/` | none | missing | public | all | active | none | Navbar.tsx (moreMenu) | hardcoded | duplicates home `/` | keep or anchor-link to home section |
| Desktop mega-menu | More/Services | More | Trust & Safety | `/trust` | none | missing | public | all | active | none | Navbar.tsx (moreMenu) | hardcoded | — | keep |
| Desktop mega-menu | More/Services | More | Help | `/help` | none | missing | public | all | active | none | Navbar.tsx (moreMenu) | hardcoded | — | keep |
| Desktop mega-menu | More/Services | More | Contact | `/contact` | none | missing | public | all | active | none | Navbar.tsx (moreMenu) | hardcoded | — | keep |
| Desktop mega-menu | More/Services | More | Blog | `/blog` | none | missing | public | all | active | none | Navbar.tsx (moreMenu) | hardcoded | — | keep |
| Desktop header | (direct link) | — | Dealers | `/dealers` | none | from registry | public | all | active | none | Navbar.tsx (getPublicNavigationItems) | product.dealers | — | keep (registry-driven header link) |
| Desktop header | (direct link) | — | Garages | `/garages` | none | from registry | public | all | active | none | Navbar.tsx (getPublicNavigationItems) | product.garages | — | keep (registry-driven header link) |
| Desktop header | User menu | — | Dashboard | `getDashboardRoute(role)` | none | missing | protected | all roles | active | none | Navbar.tsx (user menu) | — | — | keep (role-resolved) |
| Desktop header | User menu | — | My Garage | `/dashboard/garage` | none | missing | protected | owner | active | none | Navbar.tsx (user menu) | — | duplicates garage route used by Sell/Verify | keep |
| Desktop header | User menu | — | Gutu AI | `/dashboard/ai` | none | missing | protected | all roles | active | none | Navbar.tsx (user menu) | — | — | keep |
| Desktop header | User menu | — | Settings | (settings route) | none | missing | protected | all roles | active | none | Navbar.tsx (user menu) | — | — | keep |
| Desktop header | User menu | Role switcher | Change to {title} (per role) | `getDashboardRoute(role)` for each `getAllRoles()` | none | missing | protected | all roles | active | none | Navbar.tsx (role switcher loop) | — | iterates getAllRoles() | keep; verify guard honors role switch |
| Desktop header | User menu | — | Sign Out | (logout action) | none | missing | protected | all roles | active | none | Navbar.tsx (user menu) | — | — | keep |
| Dashboard sidebar | (per role) | Owner sidebar | Owner dashboard items (11) | role routes under `/dashboard` | none | per registry | protected | owner | active | none | DashboardLayout.tsx + registry getDashboardItems | dashboard_sidebar (owner=11) | — | keep; spec 27/28 asserts owner count = 11 |
| Dashboard sidebar | (per role) | Dealer sidebar | Dealer dashboard items (6) | role routes under `/dealer` | none | per registry | protected | dealer | active | none | DashboardLayout.tsx + registry | dashboard_sidebar (dealer=6) | — | keep; spec asserts dealer count = 6 |
| Dashboard sidebar | (per role) | Mechanic sidebar | Mechanic dashboard items (5) | role routes under `/mechanic` | none | per registry | protected | mechanic | active | none | DashboardLayout.tsx + registry | dashboard_sidebar (mechanic=5) | — | keep; spec asserts mechanic count = 5 |
| Dashboard sidebar | (per role) | Insurance sidebar | Insurance dashboard items (4) | role routes under `/insurance-dash` | none | per registry | protected | insurance | active | none | DashboardLayout.tsx + registry | dashboard_sidebar (insurance=4) | — | keep; spec asserts insurance count = 4 |
| Dashboard sidebar | (per role) | Government sidebar | Government dashboard items (6) | role routes under `/government` | none | per registry | protected | government | active | none | DashboardLayout.tsx + registry | dashboard_sidebar (government=6) | — | keep; spec asserts government count = 6 |
| Dashboard sidebar | (per role) | Admin sidebar | Admin dashboard items (7) | role routes under `/admin` | none | per registry | protected | admin | active | none | DashboardLayout.tsx + registry | dashboard_sidebar (admin=7) | — | keep; spec asserts admin count = 7 |
| Dashboard sidebar | (per role) | Bank sidebar | Bank dashboard items (4) | role routes under `/bank` | none | per registry | protected | bank | active | none | DashboardLayout.tsx + registry | dashboard_sidebar (bank=4) | — | keep; spec asserts bank count = 4 |
| Footer | Product | — | Product links | via `getPublicFooterItems('Product')` | none | per registry | public | all | active | none | Footer.tsx | footer (section=Product) | — | keep registry-driven |
| Footer | Company | — | Company links | via `getPublicFooterItems('Company')` | none | per registry | public | all | active | none | Footer.tsx | footer (section=Company) | — | keep registry-driven |
| Footer | Resources | — | Resources links | via `getPublicFooterItems('Resources')` | none | per registry | public | all | active | none | Footer.tsx | footer (section=Resources) | — | keep registry-driven |
| Footer | Resources | Legal | Privacy / Terms | (under Resources today) | none | per registry | public | all | active | none | Footer.tsx | footer (Resources) | currently nested in Resources, no dedicated legal surface | promote to dedicated legal surface (M-scope) |
| Footer | Stakeholders | — | Stakeholder links (per non-admin role) | `getDashboardRoute(role)` for each `getAllRoles().filter(!=='admin')` | none | per registry | public→protected | owner/dealer/mechanic/insurance/government/bank | active | none | Footer.tsx | getStakeholderLabel + getDashboardRoute | excludes admin | keep |
| Footer | Social | — | Facebook | `#` (placeholder) | none | Facebook icon | external (placeholder) | all | disabled | none | Footer.tsx (~line 92) | — | placeholder href="#", no aria-label/target/rel | M3: replace placeholder, add aria-label + target/rel |
| Footer | Social | — | Twitter | `#` (placeholder) | none | Twitter icon | external (placeholder) | all | disabled | none | Footer.tsx (~line 92) | — | placeholder href="#", no aria-label/target/rel | M3: replace placeholder, add aria-label + target/rel |
| Footer | Social | — | Instagram | `#` (placeholder) | none | Instagram icon | external (placeholder) | all | disabled | none | Footer.tsx (~line 92) | — | placeholder href="#", no aria-label/target/rel | M3: replace placeholder, add aria-label + target/rel |
| Footer | Social | — | Linkedin | `#` (placeholder) | none | Linkedin icon | external (placeholder) | all | disabled | none | Footer.tsx (~line 92) | — | placeholder href="#", no aria-label/target/rel | M3: replace placeholder, add aria-label + target/rel |
| Mobile drawer | (hamburger) | — | Buy | `/marketplace` | none | missing | public | all | active | none | Navbar.tsx (mobile 475-539) | hardcoded (no registry) | duplicates /marketplace; collapses Buy mega-menu | migrate to registry; add focus trap + aria-current |
| Mobile drawer | (hamburger) | — | Sell | `sellerPath` | none | missing | public→protected | all | active | none | Navbar.tsx (mobile) | hardcoded (no registry) | duplicates sellerPath | migrate to registry; add focus trap + aria-current |
| Mobile drawer | (hamburger) | — | Verify | `/search` | none | missing | public | all | active | none | Navbar.tsx (mobile) | hardcoded (no registry) | duplicates /search | migrate to registry; add focus trap + aria-current |
| Mobile drawer | (hamburger) | — | Parts | `/marketplace/parts` | none | missing | public | all | active | none | Navbar.tsx (mobile) | hardcoded (no registry) | duplicates /marketplace/parts | migrate to registry; add focus trap + aria-current |
| Mobile drawer | (hamburger) | — | Dealers | `/dealers` | none | missing | public | all | active | none | Navbar.tsx (mobile) | hardcoded (no registry) | duplicates registry product.dealers | migrate to registry; add focus trap + aria-current |
| Mobile drawer | (hamburger) | — | Garages & Services | `/marketplace/services` | none | missing | public | all | active | none | Navbar.tsx (mobile) | hardcoded (no registry) | distinct /marketplace/services route | migrate to registry; add focus trap + aria-current |
| Mobile drawer | (hamburger) | More | moreMenu[0].items (More group) | per moreMenu (`/insurance`,`/pricing`,`/diaspora`,`/`,`/trust`,`/help`,`/contact`,`/blog`) | none | missing | public | all | active | none | Navbar.tsx (mobile) | hardcoded (reuses moreMenu) | reuses desktop moreMenu | migrate to registry; add focus trap + aria-current |
| Mobile drawer | (hamburger) | Auth | Auth section (sign in / register or user actions) | `/login`,`/register` or user routes | none | missing | public/protected | all | active | none | Navbar.tsx (mobile) | hardcoded (no registry) | — | migrate to registry; add focus trap + aria-current |
| Marketplace (coverage) | Buy | Vehicles | Locally Used (coverage-gated entry) | `/marketplace` | resolved via `fetchMarketplaceNavCoverage()` → `locally_used` | missing | public | all | coverage-gated | COVERAGE_GATED_NAV `{'Locally Used':'locally_used'}`; resolveCoverageNavHref(label, fallbackHref, navCoverage) | marketplaceParams.ts + Navbar.tsx | hardcoded | same /marketplace base as other Buy items | keep coverage-gated; extend coverage resolution beyond Buy menu as planned |

## Discovery Report

All figures below are taken verbatim from the verified discovery run; nothing is inferred beyond what the discovery run recorded.

### 1. Current `App.tsx` route patterns
- **91 `<Route>` declarations** in `App.tsx` (289 lines).
- Layout composition: `MainLayout` (public) + `MainLayout hideNav` (auth pages: `/login`, `/register`, `/verify-otp`, `/kyc`) + one `DashboardLayout role="X"` block per role.
- `MainLayout` calls `getFeatureByRoute` → `isAuthPage` (matches `auth.*` ids) to hide Navbar/Footer on auth pages.
- **No catch-all route** (`<Route path="*">` does not exist) → unknown paths currently render blank. M5 must add a `NotFound`.

### 2. Current guard pattern (`DashboardLayout` only)
- The only access guard is inside `DashboardLayout` (`DashboardLayout.tsx:95-102`): if `!user` → `Navigate /login` with `state={from: location}`; if `user.role !== role` **or** `!canRoleAccessRoute(role, pathname)` → `Navigate getDashboardRoute(role)`.
- **No standalone `ProtectedRoute` / `RequireAuth` / feature-availability component exists yet.**
- `AuthContext` exposes a `loading` state, but `App.tsx` does **not** gate on it → risk of premature redirect during auth bootstrap (M5 must add a loading gate).
- `returnTo` handling (`Login.tsx` reads `searchParams.get('returnTo')`, sanitized via `returnTo.ts` `isSafeReturnTo`/`safeReturnTo`/`resolvePostLoginRoute`) already blocks `//`, `\\`, `://`, and control chars — **already safe, preserve**.

### 3. Registry item count
- **83 features** in `web/src/config/featureRegistry.ts` (1098 lines).
- `FeatureRegistryItem` shape: `{ id, label, route, domain:FeatureDomain, roles:UserRole[], placements:NavPlacement[], requiresAuth:boolean, icon:LucideIconName, badge?, description?, isPlanned?, isHidden? }`.
- `NavPlacement` is a flat string array (`dashboard_sidebar` | `header` | `footer` | `mobile_nav` | `user_menu`) — **no surface/section/order/query model exists yet**.
- Lifecycle today = booleans `isPlanned` / `isHidden` only. **No `beta` | `disabled` | `deprecated` states, no `coverageRule` field, no `buildFeatureHref`, no `NavigationSurface`** — these are the target additions the matrix above anticipates.
- 16 selectors available (incl. `getPublicNavigationItems`, `getPublicFooterItems(section)`, `matchRoutePattern`, `canRoleAccessRoute`, `getDefaultRouteForRole`).

### 4. Hardcoded arrays (6 in `Navbar`)
- **6 hardcoded nav sources** in `Navbar.tsx` (542 lines): `buyMenu` (48-91), `partsMenu` (93-135), `moreMenu` (137-151), `verifyMenu` (227-256), `sellMenu` (258-292), and the **hardcoded mobile drawer array** (475-539).
- Only the Buy menu is currently coverage-resolved (via `marketplaceParams.ts`); the mobile drawer uses **no registry, no focus trap, no `aria-current`**.
- Registry-driven header links are limited to `product.dealers` (`/dealers`) and `product.garages` (`/garages`) — the only items qualifying as header + `!requiresAuth` through `getPublicNavigationItems()`.

### 5. External links (4 placeholder social)
- Footer social row (`Footer.tsx`, ~line 92): **Facebook, Twitter, Instagram, Linkedin — all `href="#"` placeholders**, no `aria-label`, no `target`/`rel`. M3 must fix (replace targets, add labels and `target`/`rel`).

### 6. Missing icons / descriptions
- Every hardcoded mega-menu item (`buyMenu`, `sellMenu`, `verifyMenu`, `partsMenu`, `moreMenu`) and the mobile drawer lacks an icon and a description (these are not registry-backed). Icons/descriptions only exist on the **83 registry items** via `icon:LucideIconName` and optional `description?`.
- Footer social icons exist visually but lack `aria-label`s (accessibility gap, see §5).

### 7. Known route aliases / duplicates
- **`/marketplace/listing/:id` and `/marketplace/:id` both → `VehicleDetail`** (documented alias pair).
- The dominant duplication class: the Buy mega-menu and Parts mega-menu collapse many distinct labels onto a small set of generic routes — most Buy items → `/marketplace`, most Parts items → `/marketplace/parts`, most Verify/PartSentry items → `/search`, most Sell tooling → `sellerPath`/`/register`. See the per-row "Duplicate source" column.
- Mobile drawer items duplicate the desktop mega-menu top-level targets (`/marketplace`, `sellerPath`, `/search`, `/marketplace/parts`, `/dealers`, `/marketplace/services`).

### 8. Current test coverage
- **`featureRegistry.route-validation.test.ts` = 7 tests** (the dead-link / registry CI gate): asserts every non-planned/non-hidden feature has a `Route` in `App.tsx`; **no duplicate active routes**; every role `dashboardRoute` is registered; every header/footer item has a route; and Navbar/Footer/DashboardLayout contain no dead links.
- **Playwright nav specs 27 & 28** (`27-feature-registry-navigation-map.spec.ts`, `28-feature-registry-public-nav-access.spec.ts`) assert dashboard role counts: **owner 11, dealer 6, mechanic 5, insurance 4, government 6, admin 7, bank 4**.
- Baseline regression (2026-06-21, before changes): `npm run test:unit --workspace=web` PASS (12 files, 128 tests); `tsc --noEmit` clean; `web` build PASS (main JS 2,033.89 kB / gzip 536.49 kB; CSS 189.96 kB / gzip 32.06 kB; Vite warns chunk > 500 kB); `git diff --check` clean.
- Backend DB-integration suite (`node backend/tests/run-tests.js`) **withheld** — it connects to live shared Supabase (`vhmnajoeicasaigiophh`) and writes rows. Only DB-free node-native backend tests are safe to run.

### 9. Likely migration risks
- **Shared-route collision vs the `route-validation` "no duplicate active route" assertion.** Because the mega-menu items deliberately share routes (many Buy → `/marketplace`, many Parts → `/marketplace/parts`), promoting them to `active` registry routes would break that gate. **Mitigation: keep a separate navigation manifest** (surface/section/label/query) distinct from the route registry, so multiple nav entries can deep-link into one route without registering duplicate active routes.
- Adding lifecycle/coverage/query fields requires extending `FeatureRegistryItem` and `NavPlacement` (no surface/section/order/query/coverageRule model exists today) — must stay backward-compatible with the 16 existing selectors.
- Activating governed-trust items (Passport Verified, PartSentry Checked, Dealer Verified, Brand New, Second Hand) by heuristic would be incorrect — they remain `planned` until a real signal source exists.
- Mobile drawer migration (no registry, no focus trap, no `aria-current`) must add accessibility without regressing the existing `data-testid="mobile-menu-button"` / `aria-expanded` behavior asserted by tests.
- No PR-triggered CI exists (only 2 manual `workflow_dispatch` diaspora workflows) — the new structural gate needs a workflow YAML plus the vitest structural tests to actually run on PRs.
- Auth-bootstrap `loading` not gated in `App.tsx` (premature-redirect risk) and the missing catch-all (`NotFound`) are pre-existing risks that compound any nav refactor.
- Open **PR #66** (`feature/mobile-registry-drawer`, base `main`, `MERGEABLE=CONFLICTING`, +604/-39) already touches `Navbar.tsx` and `featureRegistry.ts` for a registry-driven mobile drawer — coordinate to avoid re-conflicting; desktop mega-menus and bottom tabs were intentionally omitted there (Lane B.1).

### 10. Ownership (Agent A–G model)
Per the plan's Agent A–G ownership model, work areas map to the verified source files as follows. (Only surfaces and files present in the ground-truth file are assigned; agent letters denote the plan's parallel work lanes.)

| Agent | Ownership area | Primary source files (verified) |
|---|---|---|
| Agent A | Registry schema & selectors — extend `FeatureRegistryItem`/`NavPlacement`, add lifecycle/coverage/query model and `buildFeatureHref`, preserve 16 selectors | `web/src/config/featureRegistry.ts`, `web/src/config/featureRegistry.route-validation.test.ts` |
| Agent B | Desktop top nav — migrate the 6 hardcoded arrays (`buyMenu`/`sellMenu`/`verifyMenu`/`partsMenu`/`moreMenu` + mobile array) to a navigation manifest | `web/src/components/layout/Navbar.tsx` |
| Agent C | Mobile drawer — registry-drive the hamburger drawer, add focus trap + `aria-current` (coordinate with PR #66) | `web/src/components/layout/Navbar.tsx` (mobile 475-539) |
| Agent D | Footer — Product/Company/Resources/Stakeholders surfaces, dedicated legal surface, M3 social-link fix | `web/src/components/layout/Footer.tsx` |
| Agent E | Routing & guards — add `NotFound` catch-all, auth `loading` gate, evaluate standalone `ProtectedRoute`/`RequireAuth`; preserve `returnTo` safety | `App.tsx`, `web/src/components/layout/DashboardLayout.tsx`, `web/src/lib/returnTo.ts` |
| Agent F | Coverage & deep-linking — extend `resolveCoverageNavHref`/`fetchMarketplaceNavCoverage` beyond Buy menu; add deep-link queries for generic-fallback items | `web/src/lib/marketplaceParams.ts` |
| Agent G | Test & CI gate — `route-validation` (7 tests), Playwright nav specs 27/28 (role counts), add PR-triggered workflow YAML + structural vitest | `web/src/config/featureRegistry.route-validation.test.ts`, `tests/agents/27-*.spec.ts`, `tests/agents/28-*.spec.ts`, `.github/workflows/*` |

---
*Generated from verified discovery facts only. Any item not present in the verified discovery run was intentionally omitted.*
