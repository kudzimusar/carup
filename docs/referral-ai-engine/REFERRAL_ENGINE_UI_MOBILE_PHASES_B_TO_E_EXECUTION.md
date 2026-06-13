# CarUp Referral Engine — UI / Mobile Execution Plan (Phases B–E)

**Status:** Execution guide. Phase A (API client layer) is merged on `main` (commit `3ed1d8e`).
**Branch of record:** `main`.
**Companion docs:** [REFERRAL_ENGINE_UI_MOBILE_INTEGRATION_PLAN.md](REFERRAL_ENGINE_UI_MOBILE_INTEGRATION_PLAN.md) (the map this plan executes), [REFERRAL_ENGINE_VERIFICATION_REPORT.md](REFERRAL_ENGINE_VERIFICATION_REPORT.md) (backend verification).

---

## 1. Goal

The CarUp Referral Engine **backend is fully merged to `main` and verified** — 7 phases (PRs #62→#71), `node --test backend/tests/referral-*.test.js` green at **113/113**, route-smoke 8/8, E2E 4/4, Supabase staging verified. The engine is complete but **invisible**: there is no referral UI in either the web app or the mobile app.

The purpose of this plan is **visible UI / mobile integration** — surfacing the referral engine to real users and operators, owner value first, then admin operations, then marketing/trust, then (only if needed) a small set of additive backend read endpoints. **Phase A (the typed API client layer) is already done and pushed**; this document drives Phases B–E.

Guiding principle (from the integration plan):
> "Scope guard: this document plans the front-end (web + mobile) integration of the already-merged Referral Engine backend. It does **not** modify backend referral logic."

---

## 2. Source-of-Truth Documents

These are the authoritative references. Each quote below is verbatim from the named document and is used to constrain UI behavior.

| Doc | Goal (verbatim excerpt) | How it guides the UI |
|---|---|---|
| **UI/Mobile Integration Plan** | "this document plans the front-end (web + mobile) integration of the already-merged Referral Engine backend. It does not modify backend referral logic." | Greenfield UI over a finished backend; owner value loop first, admin later — **no backend logic changes**. |
| **00 — Master Plan (AI-First)** | "CarUp will build an AI-first referral system for local marketplace activity and import flows." | UI prioritizes trustworthy local-marketplace + import flows with AI triage/matching surfaced, not buried. |
| **01 — User Access & Roles** | "Define how users enter and use the referral engine across web, mobile, WhatsApp, Telegram, social links, QR codes, barcodes, and agent-assisted flows." | Support multiple entry channels (QR, barcode, social, chat) and role-based access; AI triage routes users to their primary action. |
| **02 — Codes/Coupons/QR/Attribution** | "Create one traceable identity layer for all referral and campaign activity." | Every share/scan/redeem must be attributable; UI generates + shares traceable codes with QR/barcode and preserves attribution end-to-end. |
| **03 — Rewards/Wallet/Settlement** | "Define how CarUp gives small benefits to buyers, sellers, referrers, ambassadors, and partners without exposing the system to abuse." | Wallet UI shows **pending vs approved** separately, never matures on signup alone, and explains held/rejected benefits clearly. |
| **04 — Local Marketplace Referrals** | "Support local marketplace sharing while import campaigns remain the higher-value priority." | Simple local share flows (customer↔customer, seller→customer) with AI lead/listing creation on scan — secondary to imports. |
| **05 — Import/Parts/Container Referrals** | "Prioritize higher-value import flows while keeping them connected to the local marketplace." | Surface import + container routes prominently; incentives tied to milestones (quote/booking/delivery). |
| **06 — Social Channels** | "Make referral sharing work across WhatsApp, Telegram, Facebook, Instagram, web, and mobile while keeping attribution intact." | Cross-channel share with automatic campaign tracking; **no manual URL copying**. |
| **07 — AI Layer** | "Make AI the operating layer of the referral engine instead of a simple content helper." | Expose AI triage/attribution/channel decisions transparently — user understands how/why they were routed. |
| **08 — Public AI Assistants** | "Allow CarUp users to interact with the referral system through CarUp web chat, mobile chat, WhatsApp, Telegram, and future assistants on ChatGPT, Claude, and Gemini." | Start on any surface and continue on another without losing context or attribution. |
| **09 — AI Marketing/SEO Automation** | "Use AI to turn each referral campaign into useful content, share assets, and searchable landing pages." | Marketing UI surfaces AI **drafts for admin approval**, edit + schedule before publish, attribution preserved on publish. |
| **10 — Trust/Fraud/Compliance Guardrails** | "Protect the referral system from abuse while keeping the user experience simple." | Show clear, non-intrusive fraud checks + hold explanations; backend prevents abuse, UI explains delays without friction. |
| **11 — Data Model / APIs / Events** | "Define the technical foundation for referral attribution, campaign operations, wallet status, and AI tools." | UI exposes code validation, campaign tracking, wallet status, AI tools — all with audit/event logging behind them. |
| **12 — Implementation Roadmap & Test Plan** | "The system is ready only when a referred user can enter from a social channel, create a verified lead or transaction path, retain attribution across the workflow, and produce a reviewable benefit record with a complete event trail." | This is the **acceptance definition** for the whole build — the end-to-end journey the UI must make possible and testable. |

---

## 3. Non-Negotiable Architecture Rules

1. **Use the existing web API hook** [web/src/hooks/useCarUpApi.ts](../../web/src/hooks/useCarUpApi.ts). The 52 referral methods (Phase A) live there. Components call them — never `fetch()` directly and never a second client.
2. **Use the existing mobile API style** from [mobile/utils/verificationApi.ts](../../mobile/utils/verificationApi.ts); referral calls go through [mobile/utils/referralApi.ts](../../mobile/utils/referralApi.ts) (Phase A), which reuses the verification base-URL + CSRF helpers.
3. **Use [web/src/config/featureRegistry.ts](../../web/src/config/featureRegistry.ts) for web navigation.** Add a `FeatureRegistryItem` (new `domain: 'referral'`) — the sidebar link appears automatically. Still add the matching `<Route>` in `App.tsx`.
4. **Do not create duplicate referral/coupon/wallet/trust systems.** There is exactly one backend engine; the UI is a thin client over it. No re-implementing reward math, code validation, or state machines client-side.
5. **Preserve tenant/user/role headers.** Both clients already inject `x-user-id`, `x-session-token`, `x-stakeholder-role`, `x-tenant-id` + CSRF. Never strip or hardcode them.
6. **Keep owner surfaces separate from admin/trust/marketing surfaces.** Owner = `/dashboard/referrals`. Admin = `/admin/referrals/*`. Different routes, different role gates, different files.
7. **Keep referral trust separate from vehicle trust-facts review.** The existing [web/src/pages/dashboard/shared/TrustReviewQueue.tsx](../../web/src/pages/dashboard/shared/TrustReviewQueue.tsx) is the **vehicle** trust-fact queue (`/verification/*`). Referral trust is a **new, distinct** surface (`/admin/referrals/trust`, `/referrals/trust/*`). Never merge them.

---

## 4. Phase B — Owner "Refer & Earn" (do this first)

Owner-facing web + mobile surfaces. **Uses existing endpoints only. No admin features.**

### Required surfaces
- **Web owner route:** `/dashboard/referrals` (inside `DashboardLayout role="owner"`).
- **Mobile tab:** "Referrals" (`mobile/app/(tabs)/referral.tsx`).
- **Wallet benefit status** — pending vs approved balances, transaction list with status badges.
- **Referral code validation** — enter/scan a code, show validity + attribution.
- **Share assets / share kit** — owner's code with QR + copy link + native share.
- **Benefit explanation** — per-transaction "why is this held/pending?".
- **Create dispute** — file a dispute from a transaction row.
- **Agent tool access only where safe** — read the public tool catalog; execute only non-mutating safe tools.

### Endpoint → Phase A method mapping (all already exist)
| Surface | Web (`useCarUpApi`) | Mobile (`referralApi`) | Backend route | Auth |
|---|---|---|---|---|
| Wallet status | `getReferralWallet(userId)` | `getReferralWallet(userId)` | `GET /api/referrals/wallets/:userId` | authed (self) |
| Code validation | `validateReferralCode` / `getReferralCode` | `validateReferralCode` | `POST /validate`, `GET /codes/:code` | public |
| Share kit | `createReferralChannelShareKit(channel, body)` | `createReferralChannelShareKit` | `POST /channels/:channel/share-kit` | authed |
| Benefit explanation | `explainReferralBenefit(txId)` | `explainReferralBenefit(txId)` | `GET /trust/benefits/:txId/explain` | authed |
| Create dispute | `createReferralDispute(body)` | `createReferralDispute` | `POST /trust/disputes` | authed |
| Agent tools (safe) | `getReferralAgentTools` / `executeReferralAgentTool` | `getReferralAgentTools` / `executeReferralAgentTool` | `GET /agent/tools`, `POST /agent/execute` | public / gateway+authed |

> `createReferralShareAssets` (POST `/share-assets`) is **operator-gated** server-side — do **not** wire it to owner UI; owner sharing uses `createReferralChannelShareKit`.

### Files to create
- `web/src/pages/dashboard/owner/ReferralWallet.tsx` (route `/dashboard/referrals`)
- `web/src/components/referral/BenefitStatusBadge.tsx`, `ShareCodeCard.tsx`, `DisputeForm.tsx`
- `web/src/config/featureRegistry.ts` → add `owner.referrals` (`domain: 'referral'`, `roles: ['owner']`, `placements: ['dashboard_sidebar']`)
- `web/src/App.tsx` → `<Route path="/dashboard/referrals" element={<ReferralWallet />} />` under `DashboardLayout role="owner"`
- `mobile/app/(tabs)/referral.tsx` + `<Tabs.Screen name="referral" options={{ title: 'Referrals' }} />` in `mobile/app/(tabs)/_layout.tsx`
- `mobile/components/referral/ShareCodeSheet.tsx`, `DisputeModal.tsx`

### Behavior constraints (from §2)
- Show **pending vs approved separately**; never imply signup matured a benefit (TRD 03).
- Held/rejected transactions must render their **explanation** (TRD 10).
- Share must preserve attribution and avoid manual URL copying (TRD 02, 06).
- QR rendering: **do not add a QR library yet** — first check whether `createReferralChannelShareKit` returns a QR data-URL/payload; only add `qrcode.react` (web) / `react-native-qrcode-svg` (mobile) if the response does not include one. Decide at build time, call it out in the PR.

### Compile + tests (must pass before commit)
- `npm exec --workspace=web -- tsc -p tsconfig.app.json --noEmit`
- `npm run ts:check --workspace=mobile`
- `node --test backend/tests/referral-*.test.js` (must stay 113/113)
- Add `web/src/__tests__` Vitest (or `web/e2e/referral-owner-wallet.spec.ts` Playwright) for the owner wallet view + dispute filing.

### Manual test steps (owner)
**Web:** log in as an `owner` → sidebar shows "Refer & Earn" → click → `/dashboard/referrals` loads → wallet shows pending/approved → a held transaction shows an explanation → "Share" opens a code card with QR + copy + share → enter a referral code to validate → file a dispute on a transaction and see it acknowledged.
**Mobile:** log in → bottom tab "Referrals" appears → wallet card loads → tap a held benefit → see explanation → tap "Share my code" → QR + native share sheet → file a dispute → see confirmation.

---

## 5. Phase C — Admin Referral Operations

Admin web surfaces. Gate to role `admin` (and `dealer` only where the OPERATOR tier genuinely applies — see §6 role note).

### Surfaces
- `/admin/referrals` — **Campaigns** (list/create/edit)
- `/admin/referrals/codes` — **Codes & Coupons** (+ share assets generation)
- `/admin/referrals/local-leads` — **Local Marketplace Leads** (qualify, bundles)
- `/admin/referrals/import-routes` — **Import Routes + Capacity + Container-Space flow**

### Includes → endpoints (Phase A methods)
| Feature | Method | Route | Auth |
|---|---|---|---|
| Campaigns | `listReferralCampaigns`, `createReferralCampaign`, `updateReferralCampaign` | `GET/POST/PATCH /campaigns` | OPERATOR |
| Codes | `createReferralCode` | `POST /codes` | OPERATOR |
| Coupons | `createReferralCoupon`, `applyReferralCoupon`, `redeemReferralCoupon` | `POST /coupons`, `/coupons/apply`, `/coupons/redeem` | OPERATOR / authed |
| Share assets | `createReferralShareAssets` | `POST /share-assets` | OPERATOR |
| Local leads | `createReferralLocalMarketplaceBundle`, `qualifyReferralLocalMarketplaceLead` | `POST /local-marketplace/referral-bundles`, `…/leads/:id/qualify` | OPERATOR |
| Import routes | `createReferralImportRoute`, `getReferralImportRouteStatus`, `updateReferralImportRouteCapacity` | `POST /import-campaigns/routes`, `GET …/:routeKey/status`, `POST …/:routeKey/capacity` | OPERATOR / public status |
| Container-space | `createReferralImportBundle`, `qualifyReferralImportLead` | `POST /import-campaigns/referral-bundles`, `…/leads/:id/qualify` | OPERATOR |

### Missing GET-list endpoints — explicit handling (NO fake data)
The backend has **no** list endpoints for: referral **codes**, **coupons**, **local leads**, **import routes**. Choose, per surface, one of:
- **Interim:** drive the list from `getReferralAdminEvents(filters)` (`GET /admin/events`) — filter by event type (e.g. code issuance/redemption, lead created/qualified). Label these views "Activity (from event log)" so the operator knows it is event-derived, not a table read.
- **Or:** implement the additive **Phase E** endpoint for that resource and use it directly.

**Hard rule:** never render placeholder/mock rows. If neither a list endpoint nor an event-derived view is available for a resource, show an empty state that explains the data source is pending Phase E — do not invent data.

### Files
- `web/src/pages/dashboard/admin/ReferralCampaigns.tsx`, `ReferralCodes.tsx`, `ReferralLocalLeads.tsx`, `ReferralImportRoutes.tsx`
- `featureRegistry.ts` admin entries (`domain: 'referral'`, `roles: ['admin']`) + `App.tsx` routes under `DashboardLayout role="admin"`
- Reuse shadcn/ui `table`, `tabs`, `dialog`, `badge`, `card`.

---

## 6. Phase D — Marketing, Trust, Disputes, Audit

Admin web surfaces.

### Surfaces
- `/admin/referrals/marketing` — AI marketing assets + approve/schedule/publish
- `/admin/referrals/trust` — risk checks, review cases, wallet holds, dispute resolution, audit export

### Includes → endpoints (Phase A methods)
| Feature | Method | Route | Auth |
|---|---|---|---|
| Marketing assets | `listReferralMarketingAssets` | `GET /marketing/assets` | OPERATOR |
| Draft generators | `createReferralMarketingCampaignKit`, `createReferralSeoPage`, `createReferralChannelMessage`, `createReferralProofStory`, `createReferralFaq` | `POST /marketing/*` | OPERATOR |
| Approve/schedule/publish | `updateReferralMarketingAssetStatus` | `PATCH /marketing/assets/:id/status` | OPERATOR |
| Analytics suggestions | `createReferralMarketingAnalyticsSuggestion` | `POST /marketing/analytics/suggestions` | OPERATOR |
| Trust rules / risk | `getReferralTrustRules`, `runReferralRiskCheck` | `GET /trust/rules`, `POST /trust/risk-checks` | OPERATOR |
| Review cases | `listReferralReviewCases`, `createReferralReviewCase`, `decideReferralReviewCase` | `GET/POST /trust/review-cases`, `PATCH …/:id/decision` | OPERATOR / **TRUST_DECISION** |
| Wallet holds | `applyReferralWalletHold` | `POST /trust/wallet-transactions/:txId/hold` | OPERATOR |
| Dispute resolution | `resolveReferralDispute` | `PATCH /trust/disputes/:id/resolve` | **TRUST_DECISION** |
| Audit export | `exportReferralAudit` | `GET /trust/audit-export` | OPERATOR |

### Role gating (v1)
Gate **all** Phase D surfaces to role **`admin`**. The backend operator roles `marketing_manager`, `trust_manager`, `route_agent`, `compliance_manager` have **no front-end `UserRole`** equivalent, so `admin` (the superset role) is the only client role that satisfies `OPERATOR_ROLES`/`TRUST_DECISION_ROLES`. Do **not** widen `UserRole` as part of this phase; if finer roles are wanted later, that is a separate, deliberate change to `UserRole` + the backend `authorizeRole` mapping.

### Separation rule
Build these as **new** files (`ReferralMarketing.tsx`, `ReferralTrustReview.tsx`). **Do not** modify or reuse `web/src/pages/dashboard/shared/TrustReviewQueue.tsx` (vehicle trust-facts). Distinct routes, distinct labels ("Referral Trust" vs "Trust Review").

### Behavior constraints (from §2)
- Marketing: AI output is a **draft for approval** — never auto-publish; preserve disclosure + attribution; reject non-http URLs at the UI layer too (TRD 09).
- Trust: show hold reasons + decision trail; decisions require a reason (TRD 10).

### Files
- `web/src/pages/dashboard/admin/ReferralMarketing.tsx`, `ReferralTrustReview.tsx`
- `web/src/components/referral/AuditExportButton.tsx`
- `featureRegistry.ts` + `App.tsx` (role `admin`)

---

## 7. Phase E — Additive Backend Read Endpoints (only if needed)

Implement **only** after Phase C/D UI confirms the event-derived interim views are insufficient. These are **additive reads**, nothing else.

### Allowed endpoints (and nothing beyond this list)
- `GET /api/referrals/codes`
- `GET /api/referrals/coupons`
- `GET /api/referrals/local-marketplace/leads`
- `GET /api/referrals/import-campaigns/routes`
- `GET /api/referrals/trust/disputes`

### Rules
- **Additive only** — new route handlers + new service read methods. **No rewrite** of any existing referral logic, state machine, or write path.
- **Role-gated** — `OPERATOR_ROLES` for operational lists; `TRUST_DECISION_ROLES` (or OPERATOR per existing convention) for disputes — match the sibling write endpoints' gating.
- **Tenant-safe** — scope every query to the actor's tenant (default to `req.userContext.tenantId`), like `getAdminTimeline`/`listCampaigns` already do. Never pass `limit` as a column filter (the bug fixed during verification).
- **Tested** — extend `backend/tests/referral-engine-route-smoke.test.js` (route registered + auth) and add E2E coverage that the list reflects created rows. Keep the suite green.
- **Wire the client** — when an endpoint lands, replace the interim `getReferralAdminEvents()` view with a real list method added to `useCarUpApi.ts` (e.g. `listReferralCodes`), and remove the corresponding Phase-E TODO comment.

---

## 8. Testing Requirements (run after EVERY phase)

1. **Web TypeScript:** `npm exec --workspace=web -- tsc -p tsconfig.app.json --noEmit` → exit 0.
2. **Mobile TypeScript:** `npm run ts:check --workspace=mobile` → clean.
3. **Backend referral tests:** `node --test backend/tests/referral-*.test.js` → **113/113** (or higher if Phase E adds tests).
4. **Route-smoke / E2E:** `node --test backend/tests/referral-engine-route-smoke.test.js` and `…-e2e-stack.test.js` (especially after Phase E).
5. **Added Playwright/Vitest:** run any new `web/e2e/referral-*.spec.ts` (Playwright) and `web/src/**/*.test.ts(x)` (Vitest).
6. **Registry guard:** `web/src/config/featureRegistry.route-validation.test.ts` must pass — every new registry entry needs a matching `App.tsx` route.

A phase is not done until 1–3 pass (and 4–6 where applicable).

---

## 9. Commit Discipline (one commit per phase)

- Phase B → `feat(referrals): add owner refer and earn UI`
- Phase C → `feat(referrals): add admin referral operations UI`
- Phase D → `feat(referrals): add referral marketing and trust UI`
- Phase E → `feat(referrals): add referral read endpoints`
- Docs → `docs(referrals): add manual testing guide`

Each commit: only that phase's files; checks green before committing; co-author trailer retained. Do not bundle phases. Do not push without explicit approval.

---

## 10. Final Report (produce after each phase)

Report back, every phase:
- **Files changed** (created/modified, with paths).
- **Routes / screens added** (web routes + mobile tabs/screens).
- **Endpoints used** (existing methods consumed).
- **Endpoints added** (Phase E only — with role + tenant gating notes).
- **Tests run** (exact commands).
- **Pass/fail result** (web tsc, mobile tsc, backend suite, any new specs).
- **Remaining risks** (e.g. role-granularity, missing list endpoints still on interim, QR lib decision).
- **Manual testing instructions for you**, including:
  - **What to click in the web UI** — exact path: log in as `<role>` → sidebar item → route → expected content → each action and expected result.
  - **What to test on mobile** — open tab → expected card/state → each tap and expected result.

---

### Appendix — current state
- **Phase A: DONE & pushed** (`3ed1d8e`): `web/src/types/referral.ts` (19 types), 52 methods on `useCarUpApi.ts`, `mobile/utils/referralApi.ts` (9 owner-first methods). Verified: web/mobile `tsc` clean, backend 113/113, adversarial path/verb audit clean.
- **Phases B–E: NOT STARTED.**
- **Preserved:** unrelated `stash@{0}` (phase-7c mobile WIP) — do not pop/drop.
