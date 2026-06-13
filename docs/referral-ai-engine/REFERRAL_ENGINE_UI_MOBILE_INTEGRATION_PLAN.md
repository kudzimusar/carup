# CarUp Referral Engine — UI / Mobile Integration Plan

**Status:** Planning only — no UI code written yet.
**Branch:** `main` (backend phases 1–7 merged; 113/113 referral tests green).
**Author:** Claude Code verification loop.
**Date:** 2026-06-13.

> Scope guard: this document plans the front-end (web + mobile) integration of the
> already-merged Referral Engine backend. It does **not** modify backend referral
> logic. Where a UI surface needs a contract the backend does not yet expose, that
> gap is called out explicitly as a **Missing contract** for a separate, additive
> backend follow-up (no rewrite of existing endpoints).

---

## 1. Current Frontend Architecture Summary

### 1.1 Web (`web/`)
- **Stack:** Vite + React 18 + TypeScript, `react-router-dom` v6, Tailwind + shadcn/ui (`web/src/components/ui/*`), Playwright e2e (`web/e2e/*`).
- **Routing:** all routes declared in [web/src/App.tsx](../../web/src/App.tsx) under two layouts:
  - `MainLayout` — public + auth pages.
  - `DashboardLayout role="<role>"` — role-gated dashboards (owner/dealer/mechanic/insurance/government/admin/bank).
- **Navigation is registry-driven:** [web/src/config/featureRegistry.ts](../../web/src/config/featureRegistry.ts) is the single source of truth. Every nav item is a `FeatureRegistryItem` with `roles`, `placements`, `domain`, `icon`. `DashboardLayout` renders the sidebar from `getDashboardItems(role)`; adding a registry entry auto-adds the sidebar link. A `domain: 'trust'` and `domain: 'commerce'` already exist; we will add `domain: 'referral'`.
- **Role gating:** [web/src/components/layout/DashboardLayout.tsx](../../web/src/components/layout/DashboardLayout.tsx) redirects if `user.role !== role` or `!canRoleAccessRoute(user.role, pathname)`. Backend re-enforces via headers — UI gating is convenience, not the security boundary.
- **API access:** one hook, [web/src/hooks/useCarUpApi.ts](../../web/src/hooks/useCarUpApi.ts), wraps [web/src/lib/apiClient.ts](../../web/src/lib/apiClient.ts). `BASE_URL` already resolves to `<host>/api`. A request `path` of `/referrals/...` therefore hits `/api/referrals/...`. Auth headers are auto-injected from `useAuth()`:
  `x-session-token`, `x-user-id`, `x-stakeholder-role` (= `user.role`), `x-tenant-id` (= `user.active_tenant_id`). Unsafe methods auto-fetch a bound CSRF token. **All referral calls should be added as methods on this hook** — no new client file needed.
- **Roles available (`UserRole`):** `owner | dealer | mechanic | insurance | government | admin | bank`.

### 1.2 Mobile (`mobile/`)
- **Stack:** Expo Router + React Native, NativeWind (Tailwind classes), Zustand stores, FlashList.
- **Navigation:** tab bar in [mobile/app/(tabs)/_layout.tsx](../../mobile/app/(tabs)/_layout.tsx) — current tabs: `index` (Dashboard), `garage`, `escrow`, `marketplace`. A tab = a file in `app/(tabs)/` + a `<Tabs.Screen>` entry. Navy `#0f172a` / orange `#f97316` theme.
- **API access:** [mobile/utils/verificationApi.ts](../../mobile/utils/verificationApi.ts) shows the pattern: `requestJson<T>(path, options)` resolving base from `EXPO_PUBLIC_API_URL`, auth headers from the auth store, CSRF on mutating methods. We will add a sibling **`mobile/utils/referralApi.ts`** mirroring this.
- **Auth/roles:** [mobile/store/authStore.ts](../../mobile/store/authStore.ts) (Zustand) exposes `user` (`id`, `email`, `name`, `role`, `active_tenant_id`), `token`, `isAuthenticated`.
- **Styling convention:** slate palette + orange accents, `Pressable` cards, `FlashList` for lists (see [mobile/app/(tabs)/marketplace.tsx](../../mobile/app/(tabs)/marketplace.tsx)).

### 1.3 What does NOT exist yet
- **Zero** referral/campaign/wallet/coupon/QR/share-asset UI in either app. This is greenfield UI over a finished backend.
- The existing `web/src/pages/dashboard/shared/TrustReviewQueue.tsx` is the **vehicle trust-fact** queue (`/verification/*` endpoints) — **unrelated** to referral trust. The referral trust queue is a new, separate surface to avoid confusing the two.
- Dealer `Promotions.tsx` is a simple discount CRUD against `/promotions` — not the referral engine.

---

## 2. Backend Contract Reference (as merged on `main`)

All paths below are relative to `/api/referrals` (web hook `path` = `/referrals/...`). Role groups from [backend/routes/referralRoutes.js](../../backend/routes/referralRoutes.js):

- `OPERATOR_ROLES` = admin, platform_admin, super_admin, dealer, seller, agent, manager, operator, route_agent, marketing_manager, trust_manager, compliance_manager
- `ADMIN_ROLES` = admin, platform_admin, super_admin
- `TRUST_DECISION_ROLES` = admin, platform_admin, super_admin, trust_manager, compliance_manager
- `authorizeRole()` (empty) = any authenticated user

| Group | Method + Path | Auth |
|---|---|---|
| Campaigns | `POST /campaigns`, `GET /campaigns`, `PATCH /campaigns/:id` | OPERATOR |
| Codes | `POST /codes` | OPERATOR |
| Codes | `GET /codes/:code`, `POST /validate` | public |
| Coupons | `POST /coupons` | OPERATOR |
| Coupons | `POST /coupons/apply` | public |
| Coupons | `POST /coupons/redeem` | authed (self) |
| Share assets | `POST /share-assets` (body.code required) | OPERATOR |
| Share kits | `POST /channels/:channel/share-kit`, `POST /local-marketplace/share-kit`, `POST /import-campaigns/share-kit` | gateway/authed |
| Events | `POST /events` | public; `GET /admin/events` | ADMIN |
| Agent | `GET /agent/tools` (public), `POST /agent/triage`, `POST /agent/execute` | gateway/authed |
| Channels | `POST /channels/:channel/inbound`, `POST /channels/web-chat/message`, `POST /channels/mobile-chat/message` | channel access (authed ok) |
| Local mkt | `GET /local-marketplace/rules` (public), `POST /local-marketplace/intent`, `POST /local-marketplace/leads` | user |
| Local mkt | `POST /local-marketplace/referral-bundles`, `POST /local-marketplace/leads/:id/qualify` | OPERATOR |
| Imports | `GET /import-campaigns/rules` (public), `GET /import-campaigns/routes/:routeKey/status` (public) | public |
| Imports | `POST /import-campaigns/routes`, `POST /import-campaigns/routes/:routeKey/capacity`, `POST /import-campaigns/referral-bundles`, `POST /import-campaigns/leads/:id/qualify` | OPERATOR |
| Imports | `POST /import-campaigns/leads` | user |
| Marketing | `GET /marketing/rules` (public) | public |
| Marketing | `POST /marketing/campaign-kits`, `/seo-pages`, `/channel-messages`, `/proof-stories`, `/faqs`, `GET /marketing/assets`, `PATCH /marketing/assets/:id/status`, `POST /marketing/analytics/suggestions` | OPERATOR |
| Trust | `GET /trust/rules`, `POST /trust/risk-checks`, `POST /trust/review-cases`, `GET /trust/review-cases`, `POST /trust/wallet-transactions/:txId/hold`, `GET /trust/audit-export` | OPERATOR |
| Trust | `PATCH /trust/review-cases/:id/decision`, `PATCH /trust/disputes/:id/resolve` | TRUST_DECISION |
| Trust | `GET /trust/benefits/:txId/explain`, `POST /trust/disputes` | authed |
| Wallet | `GET /wallets/:userId` | authed (self-or-admin) |
| Wallet | `POST /wallets/transactions` | OPERATOR; `PATCH /wallets/transactions/:id/status` | ADMIN |

**Reachable-from-UI role reality:** of the operator roles, only **`admin`** (in all three groups) and **`dealer`** (in OPERATOR only) exist in the front-end `UserRole`. So:
- Operator/creation + marketing + trust-list surfaces → gate to **`admin`** (optionally also `dealer` for campaign/lead operator actions).
- Trust **decisions** (`/decision`, `/disputes/:id/resolve`) → **`admin`** only from UI (no `trust_manager` role client-side).
- Owner-facing surfaces (wallet, benefit explain, file dispute, validate, submit lead/intent, redeem coupon) → **any authenticated user** incl. `owner`.

---

## 3. UI Integration Map (Step 5 — the 11 surfaces)

For each: **W** = web route, **M** = mobile route, **API**, **Data**, **Role**, **File(s)**, **Missing dep**.

### 3.1 Admin Referral Campaigns
- **W:** `/admin/referrals` (list + create/edit drawer). **M:** — (admin-only; defer mobile).
- **API:** `GET/POST /referrals/campaigns`, `PATCH /referrals/campaigns/:id`.
- **Data:** campaign name, type, status, priority_scope, tenant, date range, counts.
- **Role:** `admin`.
- **Files:** create `web/src/pages/dashboard/admin/ReferralCampaigns.tsx`; add methods to `useCarUpApi.ts`; register in `featureRegistry.ts`; route in `App.tsx`.
- **Missing dep:** none.

### 3.2 Referral Codes & Coupons
- **W:** `/admin/referrals/codes` (codes + coupons tabs). **M:** owner sees *their* code on the Referrals tab (read-only) via share-kit.
- **API:** `POST /referrals/codes`, `POST /referrals/coupons`, `POST /referrals/coupons/apply`, `POST /referrals/coupons/redeem`, `GET /referrals/codes/:code` (single validate).
- **Data:** code string, campaign link, reward rule, status, redemption count.
- **Role:** create = `admin`; apply/redeem = any authed (owner).
- **Files:** `web/src/pages/dashboard/admin/ReferralCodes.tsx`; hook methods.
- **Missing dep:** ⚠️ **No `GET /codes` / `GET /coupons` list endpoint.** The admin list needs an additive backend read endpoint (e.g. `GET /referrals/codes?campaign_id=`). Interim: drive the list from `GET /referrals/admin/events` (issuance/redemption events) until the read endpoints land.

### 3.3 QR / Barcode / Share Assets
- **W:** modal on a code row (`/admin/referrals/codes` → "Share"). **M:** "Share my code" sheet on Referrals tab (QR + copy link + native share).
- **API:** `POST /referrals/share-assets` (admin, body.code), and/or `POST /referrals/channels/:channel/share-kit`, `POST /referrals/local-marketplace/share-kit`, `POST /referrals/import-campaigns/share-kit` (return links/QR payloads).
- **Data:** deep link, QR image/data-URL or encodable string, per-channel copy.
- **Role:** generate = `admin`/operator (share-assets) or gateway/authed (share-kit); display = the owner.
- **Files:** `web/src/components/referral/ShareAssetModal.tsx`; `mobile/app/(tabs)/referral.tsx` share sheet; QR lib (see Missing dep).
- **Missing dep:** ⚠️ **QR rendering library.** Web: add `qrcode.react` (or render server-provided data-URL if share-kit returns one). Mobile: add `react-native-qrcode-svg`. Confirm whether share-kit responses already include a QR data-URL before adding a client lib. No read-by-code endpoint for stored assets → use the share-kit POST as the generator.

### 3.4 Local Marketplace Referral Leads
- **W:** `/admin/referrals/local-leads` (operator queue: qualify). Public intent capture can ride existing marketplace flows. **M:** owner can submit an intent/lead from a vehicle/chat surface.
- **API:** `POST /referrals/local-marketplace/intent`, `POST /referrals/local-marketplace/leads` (user); `POST /referrals/local-marketplace/referral-bundles`, `POST /referrals/local-marketplace/leads/:leadEventId/qualify` (operator); `GET /referrals/local-marketplace/rules` (public).
- **Data:** lead flow type (sell/buy/parts/mechanic/inspection/safepay), contact, attribution code, qualification state.
- **Role:** submit = any authed; qualify/bundle = `admin`/`dealer`.
- **Files:** `web/src/pages/dashboard/admin/ReferralLocalLeads.tsx`; hook methods; optional `mobile` lead form.
- **Missing dep:** ⚠️ **No `GET` list of local leads** — qualify endpoints exist but there's no leads-list read. Interim: surface leads via `GET /referrals/admin/events` filtered by event type. Flag additive `GET /local-marketplace/leads` for follow-up.

### 3.5 Import Campaign Routes & Capacity
- **W:** `/admin/referrals/import-routes` (route pages + capacity editor + live status). **M:** public route status view (optional) on Import surface.
- **API:** `POST /referrals/import-campaigns/routes`, `POST /referrals/import-campaigns/routes/:routeKey/capacity`, `GET /referrals/import-campaigns/routes/:routeKey/status` (public), `GET /referrals/import-campaigns/rules` (public).
- **Data:** route key, origin/destination, capacity (CBM/slots), used/remaining, status.
- **Role:** create/update = `admin`/operator; status = public.
- **Files:** `web/src/pages/dashboard/admin/ReferralImportRoutes.tsx`; hook methods.
- **Missing dep:** ⚠️ **No list-all-routes endpoint** (only per-`routeKey` status). Admin needs the route keys from somewhere — interim: track created routes via admin events or maintain the list from create responses; flag additive `GET /import-campaigns/routes`.

### 3.6 Container-Space Referral Flow
- **W:** part of `/admin/referrals/import-routes` (capacity-bounded lead) + reuses existing diaspora container UI patterns. **M:** owner submits a container-space lead from Import surface.
- **API:** `POST /referrals/import-campaigns/leads` (user, capacity-checked), `POST /referrals/import-campaigns/leads/:id/qualify` (operator milestone), `POST /referrals/import-campaigns/share-kit`.
- **Data:** route, requested capacity, owner contact, milestone/qualification, reward.
- **Role:** submit = any authed; qualify = `admin`/operator.
- **Files:** reuse 3.5 page + a lead drawer; `mobile` lead form.
- **Missing dep:** same leads-list gap as 3.4/3.5 (interim via admin events).

### 3.7 Wallet Benefit Status & Explanation
- **W:** `/dashboard/referrals` (owner wallet card) + admin can view any via `/admin/referrals`. **M:** **primary surface** — Referrals tab wallet card.
- **API:** `GET /referrals/wallets/:userId` (self-or-admin), `GET /referrals/trust/benefits/:transactionId/explain` (authed).
- **Data:** wallet balance, transaction list w/ status (pending/held/rejected/paid_or_applied), human-readable benefit explanation.
- **Role:** owner (self) + `admin`.
- **Files:** `web/src/pages/dashboard/owner/ReferralWallet.tsx`; `mobile/app/(tabs)/referral.tsx`; hook + `referralApi.ts` methods.
- **Missing dep:** confirm `getWallet` response includes the transaction list (it returns wallet + transactions per service); if a transaction id is needed for `explain`, it comes from the wallet response. No blocker.

### 3.8 AI Marketing Draft Review Queue
- **W:** `/admin/referrals/marketing` (asset list + approve/schedule/publish; draft generators). **M:** — (defer).
- **API:** `GET /referrals/marketing/assets`, `PATCH /referrals/marketing/assets/:assetId/status`, `POST` draft generators (`campaign-kits`, `seo-pages`, `channel-messages`, `proof-stories`, `faqs`), `GET /referrals/marketing/rules`.
- **Data:** asset type, draft body, disclosure/attribution flags, status (draft→approved→scheduled→published), safety findings.
- **Role:** `admin` (no `marketing_manager` web role — see §5).
- **Files:** `web/src/pages/dashboard/admin/ReferralMarketing.tsx`; hook methods.
- **Missing dep:** none (list endpoint exists). Role granularity gap noted in §5.

### 3.9 Trust Review Queue
- **W:** `/admin/referrals/trust` (review-cases list + risk-checks + wallet holds). **M:** — (defer).
- **API:** `GET /referrals/trust/review-cases`, `POST /referrals/trust/risk-checks`, `POST /referrals/trust/review-cases`, `PATCH /referrals/trust/review-cases/:caseEventId/decision` (TRUST_DECISION), `POST /referrals/trust/wallet-transactions/:txId/hold`, `GET /referrals/trust/rules`.
- **Data:** case id, subject, risk metrics, status, decision + reason, linked wallet tx hold.
- **Role:** list/create = `admin`/operator; **decision = `admin`** only (TRUST_DECISION).
- **Files:** `web/src/pages/dashboard/admin/ReferralTrustReview.tsx` (distinct from the existing vehicle `TrustReviewQueue.tsx`); hook methods.
- **Missing dep:** none.

### 3.10 Disputes
- **W:** owner files from `/dashboard/referrals`; admin resolves in `/admin/referrals/trust`. **M:** owner files a dispute from wallet transaction row.
- **API:** `POST /referrals/trust/disputes` (authed), `PATCH /referrals/trust/disputes/:disputeEventId/resolve` (TRUST_DECISION).
- **Data:** dispute reason, linked transaction/benefit, status, resolution outcome + decision trail.
- **Role:** file = any authed (owner); resolve = `admin`.
- **Files:** dispute form in owner wallet page + mobile; resolution in trust page; hook methods.
- **Missing dep:** ⚠️ **No `GET` list of disputes** — resolution needs the dispute id. Interim: disputes surface via `GET /referrals/trust/review-cases` / admin events, or flag additive `GET /trust/disputes`.

### 3.11 Audit Export
- **W:** button + preview in `/admin/referrals/trust` (and/or `/admin/referrals`). **M:** —.
- **API:** `GET /referrals/trust/audit-export` (OPERATOR).
- **Data:** export rows + checksum + limit; downloadable (CSV/JSON).
- **Role:** `admin`/operator.
- **Files:** `web/src/components/referral/AuditExportButton.tsx`; hook method.
- **Missing dep:** none. (Backend records the export event + checksum + enforces limit.)

---

## 4. Proposed Navigation Changes

### 4.1 Web — `featureRegistry.ts` additions (new `domain: 'referral'`)
Admin sidebar (`roles: ['admin']`, `placements: ['dashboard_sidebar']`):
- `admin.referrals` → `/admin/referrals` — "Referral Campaigns" (icon `Tag`)
- `admin.referral-codes` → `/admin/referrals/codes` — "Codes & Coupons" (icon `Tag`)
- `admin.referral-local-leads` → `/admin/referrals/local-leads` — "Local Leads" (icon `Users`)
- `admin.referral-import-routes` → `/admin/referrals/import-routes` — "Import Routes" (icon `MapPin`)
- `admin.referral-marketing` → `/admin/referrals/marketing` — "Referral Marketing" (icon `BookOpen`)
- `admin.referral-trust` → `/admin/referrals/trust` — "Referral Trust" (icon `ShieldAlert`)

Owner sidebar (`roles: ['owner']`):
- `owner.referrals` → `/dashboard/referrals` — "Refer & Earn" (icon `Heart`/`Tag`)

> Adding these registry entries is what makes them appear in the sidebar; `App.tsx`
> still needs the matching `<Route>` inside the correct `DashboardLayout`.
> New `LucideIconName`s may need adding to the registry's icon union.

### 4.2 Mobile — new tab
- Add `mobile/app/(tabs)/referral.tsx` and a `<Tabs.Screen name="referral" options={{ title: 'Referrals' }} />` to `_layout.tsx`. Owner-centric: wallet, refer-&-earn share sheet, dispute filing, benefit explanation. (Admin/operator surfaces stay web-only for v1.)

---

## 5. Role / Permission Handling

- **UI gating** via `featureRegistry` `roles` + `DashboardLayout` redirect; **backend** re-checks every call via `x-stakeholder-role` (already auto-sent by `useCarUpApi` and the mobile request helper).
- **Role-mapping gap (must flag to product):** backend operator roles `marketing_manager`, `trust_manager`, `route_agent`, `compliance_manager`, `seller`, `agent`, `operator`, `manager` have **no front-end `UserRole`**. Consequences:
  - Marketing review, trust review-list, audit export, campaign/route/bundle creation → only `admin` (and `dealer` for the OPERATOR-tier subset) can use them from the UI.
  - Trust **decisions** and dispute **resolution** → `admin` only.
  - **Options:** (a) ship v1 gating everything operator/trust to `admin`; (b) later extend `UserRole` + backend `authorizeRole` mapping so a CarUp staffer can hold `marketing_manager`/`trust_manager` and the header carries it. Recommend (a) now, (b) as a follow-up — **no backend change required for v1**.
- **Owner surfaces** (wallet, benefit explain, dispute filing, validate, lead/intent submit, coupon redeem) work for any authenticated user — no special role.
- **Tenant scoping:** `x-tenant-id` auto-sent; admin campaign/event queries already default to `req.userContext.tenantId`.

---

## 6. API Client Additions

### 6.1 Web — extend `useCarUpApi.ts` (no new file)
Add ~30 methods following the existing `request<T>(path, options)` pattern, e.g.:
```ts
// Campaigns
const fetchReferralCampaigns = useCallback((f?) => request('/referrals/campaigns' + qs(f)), [request])
const createReferralCampaign = useCallback((b) => request('/referrals/campaigns', { method:'POST', body: JSON.stringify(b) }), [request])
const updateReferralCampaign = useCallback((id,b) => request(`/referrals/campaigns/${id}`, { method:'PATCH', body: JSON.stringify(b) }), [request])
// Wallet / benefits / disputes
const fetchReferralWallet = useCallback((userId) => request(`/referrals/wallets/${userId}`), [request])
const explainReferralBenefit = useCallback((txId) => request(`/referrals/trust/benefits/${txId}/explain`), [request])
const fileReferralDispute = useCallback((b) => request('/referrals/trust/disputes', { method:'POST', body: JSON.stringify(b) }), [request])
// Trust ops
const fetchReferralReviewCases = useCallback((f?) => request('/referrals/trust/review-cases' + qs(f)), [request])
const decideReferralReviewCase = useCallback((id,b) => request(`/referrals/trust/review-cases/${id}/decision`, { method:'PATCH', body: JSON.stringify(b) }), [request])
const exportReferralAudit = useCallback((f?) => request('/referrals/trust/audit-export' + qs(f)), [request])
// Marketing
const fetchReferralMarketingAssets = useCallback((f?) => request('/referrals/marketing/assets' + qs(f)), [request])
const transitionReferralAsset = useCallback((id,b) => request(`/referrals/marketing/assets/${id}/status`, { method:'PATCH', body: JSON.stringify(b) }), [request])
// Imports / local
const fetchImportRouteStatus = useCallback((k) => request(`/referrals/import-campaigns/routes/${k}/status`), [request])
const createImportRoute = useCallback((b) => request('/referrals/import-campaigns/routes', { method:'POST', body: JSON.stringify(b) }), [request])
// Share assets
const createReferralShareAssets = useCallback((b) => request('/referrals/share-assets', { method:'POST', body: JSON.stringify(b) }), [request])
```
Add corresponding TypeScript types to `web/src/types/index.ts` (or a new `web/src/types/referral.ts`).

### 6.2 Mobile — new `mobile/utils/referralApi.ts`
Mirror `verificationApi.ts`: reuse its base-URL resolver + auth headers + CSRF helper; export `getReferralWallet(userId)`, `explainBenefit(txId)`, `fileDispute(body)`, `prepareShareKit(channel, body)`, `submitLead(body)`. Mutating calls auto-attach CSRF.

---

## 7. Proposed Web Screens (files to create)
| Screen | Path | Route |
|---|---|---|
| ReferralCampaigns | `web/src/pages/dashboard/admin/ReferralCampaigns.tsx` | `/admin/referrals` |
| ReferralCodes | `web/src/pages/dashboard/admin/ReferralCodes.tsx` | `/admin/referrals/codes` |
| ReferralLocalLeads | `web/src/pages/dashboard/admin/ReferralLocalLeads.tsx` | `/admin/referrals/local-leads` |
| ReferralImportRoutes | `web/src/pages/dashboard/admin/ReferralImportRoutes.tsx` | `/admin/referrals/import-routes` |
| ReferralMarketing | `web/src/pages/dashboard/admin/ReferralMarketing.tsx` | `/admin/referrals/marketing` |
| ReferralTrustReview | `web/src/pages/dashboard/admin/ReferralTrustReview.tsx` | `/admin/referrals/trust` |
| ReferralWallet (owner) | `web/src/pages/dashboard/owner/ReferralWallet.tsx` | `/dashboard/referrals` |
| Shared components | `web/src/components/referral/{ShareAssetModal,AuditExportButton,BenefitStatusBadge}.tsx` | — |

Reuse shadcn/ui (`table`, `tabs`, `dialog`, `badge`, `card`, `sonner` toasts). Add Playwright specs under `web/e2e/`.

## 8. Proposed Mobile Screens (files to create)
| Screen | File | Notes |
|---|---|---|
| Referrals tab | `mobile/app/(tabs)/referral.tsx` | wallet card, refer-&-earn, share sheet, disputes |
| Share sheet | `mobile/components/referral/ShareCodeSheet.tsx` | QR + copy + native `Share` |
| Dispute modal | `mobile/components/referral/DisputeModal.tsx` | from wallet tx row |
| API util | `mobile/utils/referralApi.ts` | mirrors `verificationApi.ts` |

Match marketplace styling (slate/orange, `Pressable`, `FlashList`).

---

## 9. Testing Plan
- **Web unit/integration:** Vitest for new `useCarUpApi` methods (path + headers + CSRF), mirroring `web/src/lib/apiClient.test.ts`.
- **Web e2e (Playwright):** `web/e2e/referral-admin.spec.ts` (campaign create/list, marketing approve, trust decision, audit export), `web/e2e/referral-owner-wallet.spec.ts` (wallet view, benefit explain, file dispute). Gate-by-role assertions (owner cannot see `/admin/referrals`).
- **Mobile:** extend `mobile/tests/` with a referral-api smoke (base URL, headers, CSRF on mutate) mirroring `verification-api.test.ts`.
- **Registry guard:** `web/src/config/featureRegistry.route-validation.test.ts` already mirrors registry↔routes — new entries must have matching `App.tsx` routes or the test fails (good safety net).
- **Backend (unchanged):** keep `node --test backend/tests/referral-*.test.js` green; if any read-endpoint follow-up is added, add its regression test there.

## 10. Rollout Order
1. **Phase A — API layer:** add `useCarUpApi` methods + `referralApi.ts` + types. No UI. Ship behind nothing (pure additions).
2. **Phase B — Owner value loop (highest user value, lowest risk):** web `/dashboard/referrals` + mobile Referrals tab — wallet, benefit explanation, share-kit/QR, file dispute. All owner-scoped endpoints already exist.
3. **Phase C — Admin operations:** `/admin/referrals` (campaigns) → codes/coupons → local leads → import routes.
4. **Phase D — Marketing + Trust:** `/admin/referrals/marketing`, `/admin/referrals/trust` (incl. decisions, holds, disputes resolve, audit export).
5. **Phase E — Backend read-endpoint follow-up (additive):** `GET /codes`, `GET /coupons`, `GET /local-marketplace/leads`, `GET /import-campaigns/routes`, `GET /trust/disputes` to replace the interim admin-events workarounds.

## 11. Risks
- **R1 — Role granularity (medium):** only `admin`/`dealer` can reach operator endpoints from the UI; no `marketing_manager`/`trust_manager` client role. v1 gates to `admin`. Mitigate later by extending `UserRole` + header mapping (no existing-logic rewrite).
- **R2 — Missing list/read endpoints (medium):** codes, coupons, local leads, import routes, disputes have no GET-list. Interim via `GET /admin/events`; clean fix is the additive Phase E endpoints. **This is the only place a backend change is implied — and it is additive, not a referral-logic change.**
- **R3 — QR generation (low):** need a client QR lib unless share-kit returns a data-URL. Verify response shape first.
- **R4 — Two "Trust Review" surfaces (low):** keep referral trust (`/admin/referrals/trust`) clearly separate from vehicle trust-facts (`/admin/trust-review`) to avoid operator confusion. Distinct labels + routes.
- **R5 — CSRF/identity binding (low):** both clients already bind CSRF to identity headers; new mutating calls must go through the shared helpers (not raw `fetch`) or they'll 403.
- **R6 — Tenant leakage (low):** ensure admin list calls pass/inherit `tenant_id`; backend already defaults to the actor's tenant.

---

## 12. Summary
The backend is complete and verified; the front-end is greenfield. The cleanest path is: **(A)** extend the single web hook + add one mobile util, **(B)** ship the owner refer-&-earn loop first (all endpoints exist), then **(C–D)** layer admin/marketing/trust surfaces gated to `admin`. The **only** backend work implied is a small, **additive** set of GET-list endpoints (Phase E) to replace interim `admin/events` workarounds — no modification of existing referral logic, consistent with the goal's constraint. Role granularity beyond `admin`/`dealer` is a deliberate v1 limitation with a clear later upgrade path.
