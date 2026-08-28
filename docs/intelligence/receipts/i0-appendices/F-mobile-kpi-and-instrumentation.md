# MOBILE APP AUDIT — CarUp Intelligence 1.0 phase I0 (repo @ feat/carup-intelligence-1-0 == main@ba208963)

Scope: `mobile/` (Expo Router app). Screens: `app/(tabs)/{index,marketplace,garage,referral,escrow,communications,more}.tsx`, `app/vehicle/[vin].tsx`, `app/(auth)/*` (login/register/biometric/verification flow). No dedicated dealer or mechanic screens exist — one shared dashboard with a role switcher (`app/(tabs)/index.tsx:101-140`); dealer/mechanic get the same dashboard + marketplace + More drawer only (tab plan comment `app/(tabs)/_layout.tsx:13-15`). No "saved", "profile", "compare", or search-results screens exist on mobile.

## 1. MOBILE KPI REGISTER

| Screen | Metric/KPI | Class | Evidence | Data source |
|---|---|---|---|---|
| Dashboard `app/(tabs)/index.tsx` | NONE — no counts/metrics anywhere; welcome card, role switcher, verification CTA only | unavailable-truthful (no KPI surface) | whole file, lines 87-195 | n/a |
| Marketplace list `app/(tabs)/marketplace.tsx` | Per-card `trust_score` badge ("{n} Trust") | authoritative-live | :46 | `GET /api/marketplace/listings` via `utils/marketplaceApi.ts:232-234` |
| Marketplace list | Per-card price + currency ("Market Price") | authoritative-live | :55-58 | same |
| Marketplace list | Year/mileage line | authoritative-live | :42 | same |
| Vehicle detail `app/vehicle/[vin].tsx` | Trust gauge `trust_score.toFixed(0)` ("Vehicle Trust Index") | authoritative-live | :109 | `GET /api/marketplace/listings/:id` (`marketplaceApi.ts:236-238`) |
| Vehicle detail | Risk badge (`trust_summary.risk_status`, default `'clear'`) | authoritative-live (client default `'clear'` when absent — fallback) | :61, :102 | same, `trust_summary` |
| Vehicle detail | Trust badges (`public_badge_copy[]`), empty-state text when none | authoritative-live + unavailable-truthful empty state | :123-133 | same |
| Vehicle detail | "PartSentry: X · Evidence: Y" statuses | authoritative-live | :135 | same |
| Vehicle detail | "Ecosystem Audits" rows: Odometer row prints literal "Backend governed"; ZIMRA row reuses `evidence_status`; Police row reuses `suspicion_status` | Odometer: static-demo (hardcoded label, no datum); other two: derived-live (repurposed fields, not per-audit truth) | :151, :160, :169 | same |
| Vehicle detail | "Immutable Ledger History" section — renders only a sentence, no ledger data | unavailable-truthful (placeholder text) | :175-179 | none |
| Vehicle detail | Purchase Total price | authoritative-live | :186-188 | same |
| Garage `app/(tabs)/garage.tsx` | Per-vehicle "Current Mileage" | authoritative-live | :224 | `GET /api/vehicles/me` (:72) |
| Garage | "Ecosystem Trust" `{trust_score}%` (rendered as percent; marketplace renders same field unit-less) | authoritative-live, inconsistent unit presentation | :228 | same |
| Garage | "Equity Value" `${price}` | authoritative-live (relabels listing price as "equity") | :231-234 | same |
| Garage | "Active" status badge — HARDCODED for every vehicle; `item.status` fetched but never rendered | static-demo (misrepresents) | :212-214 | none (ignores `status` field :21) |
| Garage service logs | Cost per log | authoritative-live | :280 | `GET /api/service-history/me` (:90) |
| Garage service logs | "Log State" = `item.status \|\| 'Verified'` — fabricates "Verified" when status missing | fallback (unsafe default) | :293 | same |
| Garage service logs | "Replaced Parts" = `parts_replaced \|\| 'General Maintenance'` | fallback | :289 | same |
| Referral `app/(tabs)/referral.tsx` | Wallet KPIs: Approved / Pending / Settled money tiles | Pending+Settled: authoritative-live; Approved: derived-live (client sums `approved_balance + payable_balance` :74) | :170-182, :71-76 | `GET /api/referrals/wallets/:userId` (`referralApi.ts:166`) |
| Referral | Transaction list w/ amount + status chips | authoritative-live | :190-218 | same response `transactions` |
| Escrow `app/(tabs)/escrow.tsx` | Header count `transactions.length` + "{activeCount} in progress" (client-side filter over statuses) | derived-live | :158, :165-166 | `GET /api/escrow` → `body.sessions` (:66-70) |
| Escrow | Per-tx listing amount / deposit eligibility / payment state (with truthful "Not recorded"/"Not evaluated" fallbacks) | authoritative-live + unavailable-truthful nulls | :111-123 | same |
| Communications `app/(tabs)/communications.tsx` | Notification list (first 5), thread lines (first 3) — no counts/KPI numbers rendered | authoritative-live list, no metrics | :76-83, :88-92 | `GET /api/communications/{notifications,threads,preferences}` |
| More `app/(tabs)/more.tsx` | Pure redirect stub; drawer (`components/navigation/NativeDrawer.tsx`) renders nav entries only, no metrics | n/a | more.tsx:12-14 | n/a |

No `deprecated`-class KPI found. No static-demo mock DATA arrays found in mobile screens (all lists are fetched); the static-demo issues are hardcoded LABELS ("Active", "Backend governed") and the hardcoded make-filter chips `['Toyota','Mercedes-Benz','Mazda']` (`marketplace.tsx:90`) which are not fed by `GET /api/marketplace/categories` even though `getMarketplaceCategories()` exists unused (`marketplaceApi.ts:240-242` — no call site in app code).

## 2. MOBILE INSTRUMENTATION REALITY

**navigationAnalytics is DEAD CODE in the shipped app.** `utils/navigationAnalytics.ts` implements a full client (`NativeNavigationAnalytics`, `trackNav`, singleton `navAnalytics`; bounded queue, CSRF-stamped POST to `/api/analytics/navigation`, event taxonomy incl. `navigation_item_impression`, `navigation_tab_selected`, `navigation_destination_blocked` — :17-26, :199). Zero import/call sites in `app/`, `components/`, `navigation/`, `providers/`, `hooks/`, `store/` (grep across all — no output). Only consumer: `tests/native-analytics.test.ts:18`. Neither `navAnalytics.start()` nor `trackNav()` is ever invoked in production paths — no flush timer, no events, ever. (Backend route exists: `backend/routes/navigationAnalyticsRoutes.js`; web DOES wire its counterpart: `web/src/components/layout/Navbar.tsx`, `web/src/context/AuthContext.tsx`, `web/src/components/routing/RegistryRouteBoundary.tsx`.)

**What mobile actually emits today (complete list):**
1. **Inquiry**: `POST /api/marketplace/inquiries` with forced `source_channel:'mobile'` (`marketplaceApi.ts:245`) from the detail screen's "Express Interest" (`[vin].tsx:29`). This is the ONLY marketplace demand signal mobile leaves. `MobileInquiryInput` supports `referral_code`/`campaign_code` (:163-164) but the call site passes neither.
2. **Referral share-kit / validate / dispute** posts on the Refer & Earn tab (`referral.tsx:94,108,147` → `/api/referrals/...` endpoints, `referralApi.ts:158-228`) — server-side referral events, channel `'mobile'`.
3. **Communications**: support thread create/send with `metadata:{source:'mobile_support_entry'}`, WhatsApp share-link creation `POST /api/communications/share` accepting `referral_code` (`communications.tsx:45,65`).
4. **Odometer OCR upload** `POST /api/ai/ocr` + durable offline upload queue (`garage.tsx:130,172-179`).

**Referral/campaign attribution on listing views: ABSENT.** `getMarketplaceListingDetail(vin, attribution?)` accepts an attribution query object (`marketplaceApi.ts:236-238`) but `[vin].tsx:17` calls it without one. The backend emits a best-effort `marketplace_listing_viewed` referral event ONLY when `ref`/`campaign` params arrive (`backend/routes/marketplaceRoutes.js:104-119`), so mobile detail views NEVER produce it. Web does forward attribution (`web/src/pages/VehicleDetail.tsx:1349` passes `ref/campaign/source`; `Marketplace.tsx:434` captures URL UTM once). Mobile has no deep-link attribution capture at all.

**User actions leaving NO signal on mobile today:**
- Listing impressions (list scroll/render) — nothing.
- Listing detail views — no view event, no attribution (above).
- Search — client-side filter over the fetched array (`marketplace.tsx:26-30`); the query string never reaches the server; only the make chip becomes a `?make=` param (:21). No search analytics.
- Tab/drawer navigation, blocked-route encounters, role switches — taxonomy exists, client unwired (above).
- Saves — feature absent entirely (below), so no signal.
- Shares — no listing-level share on list/detail; `Share.share` exists only for referral codes (`referral.tsx:119`).
- Compare — feature absent.
- Screen/session analytics, crash/error reporting — none found (no Sentry/analytics SDK in `mobile/package.json` usage sites).

## 3. WEB/MOBILE PARITY NOTES (marketplace actions)

| Action | Web | Mobile | Divergence |
|---|---|---|---|
| Save/favorite | YES — server-backed `saveMarketplaceListing`/`unsave`/`fetchSaved` for authed users, browser-local fallback for guests (`web/src/pages/Marketplace.tsx:429,481-482,629-646`; `VehicleDetail.tsx:1363-1413`). Backend: `GET /api/marketplace/saved`, `POST|DELETE /api/marketplace/listings/:id/save` (`backend/routes/marketplaceRoutes.js:138-147`) | ABSENT — `marketplaceApi.ts` has no save functions; no UI | Mobile users cannot save; backend endpoints ready and unused by mobile |
| Share listing | YES — `navigator.share` per card + detail (`Marketplace.tsx:40-50,1098`; `VehicleDetail.tsx:1417-1418`), plus report share links (`VehicleDetail.tsx:1226-1229`) | Listing share ABSENT; only referral-code share (`referral.tsx:119`) and WhatsApp link builder requiring manual listing-ID entry (`communications.tsx:63-67`) | No card/detail share affordance on mobile |
| Inquire | YES — `InquiryModal.tsx`, forwards captured UTM/referral attribution | YES — `[vin].tsx:22-36`, `source_channel:'mobile'`, but NO referral/campaign attribution | Shared backend endpoint; mobile drops attribution web preserves |
| Compare | YES — up to 4 VINs, `/marketplace/compare` page + `POST /api/marketplace/compare` (`Marketplace.tsx:437-445,1188-1201`; `MarketplaceCompare.tsx`) | ABSENT | Backend compare endpoint unused by mobile |
| Reserve | YES — `reserveVehicle(vin, 7)` with server-authoritative "Reserved" status (`VehicleDetail.tsx:1425-1444,1604`) | ABSENT — mobile renders `reservation_summary` types (`marketplaceApi.ts:73-92`) but detail screen shows no reservation state and offers no reserve action | Mobile is read-only-and-blind on reservations despite typed contract |
| Escrow/transactions | Web dashboard flows | YES — view + `cancel`/`dispute` only (`escrow.tsx:73-87`), server authorizes | Roughly aligned; mobile intentionally minimal |
| Categories/filters | Web: server-driven filters | Mobile: hardcoded 3-make chips (`marketplace.tsx:90`); `getMarketplaceCategories()` client exists, no call site | Filter truth forked from backend taxonomy |
| Listing media | Web renders gallery (`VehicleDetail.tsx` media contract work) | Mobile renders NO images anywhere — explicitly documented (`marketplaceApi.ts:30-34`: "NOTHING ON THIS SCREEN READS THEM YET") | Media types declared, unrendered |
| Nav analytics | Wired (Navbar/AuthContext/RegistryRouteBoundary) | Client exists, unwired (section 2) | Parity gap is wiring, not implementation |

**Shared-contract notes:** both platforms hit the same canonical endpoints (`/api/marketplace/listings[...]`, inquiries) — mobile via `marketplaceApi.ts` mirroring web's CSRF/session plumbing (headers `x-session-token`, `x-stakeholder-role`, `x-tenant-id`, dev-only `x-user-id` behind `EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK` — `marketplaceApi.ts:168-182`). Garage/escrow bypass that client and hand-roll `fetch` with `apiUrl()` (`garage.tsx:72,90,130`; `escrow.tsx:66,75`) — no CSRF cache reuse, divergent error envelopes. Base URL: `EXPO_PUBLIC_API_URL` required, localhost rejected on device (`utils/apiBase.ts:32-40`).