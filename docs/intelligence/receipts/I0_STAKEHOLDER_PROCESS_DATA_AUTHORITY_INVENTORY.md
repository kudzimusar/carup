# I0 — Live Stakeholder × Process × Data × Authority Inventory

**Programme:** CarUp Intelligence 1.0 (canonical plan: `docs/intelligence/CARUP_INTELLIGENCE_DATA_ANALYTICS_CANONICAL_PLAN.md` @ PR #184 head `0ea51b58`)
**Lane:** `feat/carup-intelligence-1-0` (PR #185), branched from canonical `main@ba208963d863654157335189c60f587cbe330041`
**Inventory date:** 2026-08-27
**Method:** 8 parallel read-only code audits over the full monorepo + live read-only queries against the staging (and, for integration reality, production) Supabase databases + GitHub/Vercel reconciliation. Full evidence registers are committed as appendices in `i0-appendices/` (file:line citations throughout).

---

## 0. Live reconciliation results

| Item | Result |
|---|---|
| Canonical `main` | `ba208963` — **identical** to the SHA recorded at owner authorization; main had not moved |
| PR #182 (Marketplace Reliability / Reference UX) | OPEN draft @ `1242494e`. Owns: `backend/services/marketplace/{marketplaceDiscoveryService, marketplaceListingDetailService, listingSummaryService, carUpGoldService}.js`, `web/src/pages/{Marketplace, VehicleDetail, MarketplaceCompare}.tsx`, `MarketplaceListingCard/ShareSheet`, `mobile/app/(tabs)/marketplace.tsx`, `mobile/app/vehicle/[vin].tsx`, `shared/types/marketplace.ts`. **These files are the primary future-overlap zone for I3 instrumentation** — coordination required before touching them |
| PR #183 (Email Experience 1.0) | OPEN draft @ `507530aa`. Owns communications/email backend. Its migration `20260826120000_email_1_0_hardening.sql` is **not yet applied to staging and not in this branch's tree** — it belongs to that lane |
| PR #184 (Intelligence plan) | OPEN docs-only draft @ `0ea51b58` (2 files). Stays documentation-only |
| Other Intelligence lanes | **None** — only docs branches (`docs/carup-intelligence-*`, `docs/navigation-intelligence-*`, `docs/vehicle-life-intelligence-*`) |
| Repo migrations | 140 migrations + `supabase_schema.sql` legacy snapshot on this branch. Latest: `20260825090100_revoke_anon_vehicles_select.sql` |
| Staging DB | Migrations through `20260824201057`; ~200 tables in `public`; row counts sampled live (see appendices) |
| Staging deployments | `carup-backend-staging` Vercel project auto-builds a preview per branch push (this lane already has a READY preview @ `47d68f0d`); no production-target deployments in the recent window |
| Production DB | Provider-platform schema (provider_registry, government_source_config, insurer_profiles, lender_profiles, escrow_provider_config) **absent in prod** — staging-only. Prod `notification_queue`: 46 rows all `queued`, zero sends ever (Production Communications inactive, consistent with programme memory) |

---

## 1. Stakeholder × Process × Data × Authority Matrix

Legend for **Current implementation**: FORMAL-ROLE (in `users.role` CHECK), ORG-TYPE (organizations/tenants), PARTNER-SCOPE (`partner_clients`), PARTICIPANT (communications participant role), ANALYTICS-ONLY, NOT-PRESENT.

| Stakeholder | Key process(es) | Current data source | Current consumer | Authoritative owner | Privacy class | Permitted audience today | Current implementation | Missing capability | Planned phase |
|---|---|---|---|---|---|---|---|---|---|
| Anonymous shopper | search, browse, listing view, compare | `GET /api/marketplace/listings*` (no events emitted); nav analytics (web chrome only) | none (no demand analytics) | n/a (behavioural) | anonymous/pseudonymous | none | Request class via `optionalAuth`; public features `roles: []` | Impression/view/search/zero-result/compare events; session model | I2–I4 |
| Registered buyer | save, share, compare, inquire, reserve | `saved_vehicles` (current-state), `marketplace_inquiries`, `vehicle_reservations`/`escrow_trust_sessions` | own dashboards (saved cars); seller sees inquiry | `saved_vehicles`, `marketplace_inquiries`, `escrow_trust_sessions` | authenticated | self; seller/tenant on declared lead | FORMAL-ROLE `owner` (registration force-assigns) | Save/unsave history, share events, funnel telemetry | I2–I4, I7 |
| Private seller | list, price, publish, respond, sell | `vehicles` (+`publication_status`), `listing_images`, `marketplace_inquiries`, comms threads | MyListings (views "not tracked"), SellerInquiriesCard | `vehicles`, `marketplace_inquiries`, Communications | authenticated | self | FORMAL-ROLE `owner` | Listing performance metrics (views/saves/shares), completeness, lost-opportunity, price response | I4, I6, I7 |
| Dealer | inventory, leads, promotions, sales | `vehicles` (tenant-scoped `/api/vehicles/inventory`), `/api/leads`, `dealer_profiles` (compliance) | Dealer dashboard (largely mock/mis-scoped — see §3) | `vehicles`, leads, `dealer_*` compliance family | tenant-scoped | own tenant | FORMAL-ROLE `dealer` + tenant | Real portfolio/lead/promotion analytics; correct tenant scoping of dealer UI | I4, I8 |
| Mechanic | work orders, service logs, parts | `mechanic_work_orders` (converged), `partsentry_logs`, `mechanic_parts` | Mechanic dashboard (derived-live) | `mechanic_work_orders`, `partsentry_logs` | tenant/user-scoped | self/tenant | FORMAL-ROLE `mechanic` | Demand-by-service/make intelligence, funnel, repeat-rate | I9 |
| Garage (organization) | bookings, capacity, team | `organizations.type='garage'` (legacy family; permissions seed-only) | none | organizations/tenants | tenant-scoped | own org | ORG-TYPE only (no dedicated role/surface) | Garage organization model decision + org-level intelligence | I9 |
| Fleet/rental/corporate | fleet mgmt | `organizations.type='fleet'` enum value only | none | — | — | — | ORG-TYPE enum only; no workflows | Everything | post-1.0 unless prioritized |
| Inspector/assessor | inspections | `evidence_sources.source_type='inspector'` taxonomy value; `vid_inspections` (0 rows) | trust/evidence pipeline | evidence family | regulated | trust ops | ANALYTICS-ONLY (taxonomy) | Inspection funnel events, principal model | I6/I9/I15 |
| Parts supplier | catalogue, RFQ | parts routes; `partsentry_logs`; inquiry type `part_quote_request` | parts pages | partsentry/parts family | tenant | own | PARTICIPANT `parts_seller` | Parts demand/zero-result/RFQ intelligence; supplier principal | I12 |
| Insurer | quotes, policies, claims | `insurance_records`, `insurance_claims`, `insurer_profiles` (0 rows), consents/decisions | `/insurance-dash` (home truthful; risk page fabricated) | insurance family | regulated | own product scope | FORMAL-ROLE `insurance` + ORG-TYPE | Commercial demand funnel (opens/quote starts/submissions); provider activation | I10 |
| Bank/lender | applications, decisions | `finance_applications`, `lender_profiles` (0), `eligibility_requests/decisions` (sandbox) | `/bank` (queue live; tiles/charts fabricated) | finance family | regulated | own product scope | FORMAL-ROLE `bank` + ORG-TYPE | Finance demand funnel, price-band demand; provider activation | I11 |
| Payments/escrow provider | escrow lifecycle | `escrow_trust_sessions/_events`, `safetrade_sandbox_*` (live_payment CHECK-forced false), `escrow_provider_config` (0) | escrow dashboards | escrow family | regulated | participants + admin | Admin-configured provider records (no login role); sandbox only | Transaction-funnel intelligence; provider activation (owner-gated) | I13/I16 |
| Referral partner/affiliate | codes, campaigns, rewards | `referral_codes/campaigns/events/wallets` | ReferralWallet (owner), admin referral consoles | referral family | identity-bearing | self + operators | ANALYTICS-ONLY records (no partner login) | Fraud-safe attribution (see P0 §6), channel ROI | I14 |
| Marketing partner | campaigns | Brevo transport class only | — | — | — | — | NOT-PRESENT as principal | Campaign ROI surfaces | I14 |
| Diaspora user/sponsor | import orders, SafeTrade, shipping | `diaspora_*` family (orders 91, quotes 26, milestones 107 on staging) | DiasporaTrade pages, operator consoles | diaspora family | tenant + participant | participants/tenant | Entitlement-gated features on owner/dealer roles (no distinct role) | Trade funnel/corridor intelligence | I13 |
| Overseas dealer/exporter | stock, workbooks | `diaspora_stock_items/ledger`, workbook imports | stock consoles | diaspora stock family | tenant | own tenant | FORMAL-ROLE `dealer` in diaspora tenant | Exporter principal, RFQ conversion intel | I13 |
| Logistics/shipping | shipments, containers | `diaspora_container_shipments/shipments` (0 rows; workbook-fed only, no carrier API) | operator consoles | diaspora logistics tables | tenant | operators | PARTICIPANT `logistics_provider` only | Any real carrier integration; milestone events | I13 |
| Clearing/customs agent | declarations | workbook vocabulary `clearing_agent`; `ocr_customs_declarations` (11 rows **prod**, evidence-based) | evidence review | evidence/OCR family | regulated | trust ops | Vocabulary only | Principal model; authoritative duty states | I15 |
| Government institution | registry/clearance/duty/licensing/inspection | `government_source_config` (0), CVR/CID/ZIMRA/ZINARA/VID parity tables (all 0); `registry_verifications`/`compliance_reports` = **legacy demo seeds** | `/government` pages (largely fabricated — see §3) | provider platform (fail-closed `not_contracted`) | regulated, purpose-limited | none real today | FORMAL-ROLE `government` (currently sees platform-wide marketplace analytics — see §6) | Real integrations (owner-gated); purpose-limited projections; unknown-stays-unknown surfaces | I15 |
| CarUp admin/internal teams | moderation, governance, ops | admin routes; `trust_audit_events`; marketplace admin analytics; comms ops metrics | `/admin/*` consoles | per-domain services | internal | monolithic `admin` role (no scoped sub-roles — `authMiddleware.js:172`) | FORMAL-ROLE `admin` | Command Center (`/admin/intelligence`); scoped internal permissions | I16 |
| External API partner | trust/fraud/dealer summaries | `partner_clients` (staging rows are UAT artifacts; prod rows revoked) + `partner_api_requests` | partner API | partner platform | scoped | per-scope | PARTNER-SCOPE (hashed keys, JSONB scopes) | Real partners; partner ROI reporting | I14 |
| Gutu AI | explain/prioritize | **NONE** — `AIDashboard.tsx` is fully canned (zero API calls, fabricated figures) | owner dashboard CTA | n/a | derived-from-caller | caller-scoped (planned) | NOT-PRESENT (static demo page) | Entire governed-intelligence integration | I18 |

Not present in any form: broker, dedicated inspector login, logistics/clearing logins, marketing-partner principal, distinct `buyer` platform role, fleet workflows.

---

## 2. Current analytics inventory (summary — full register: appendix B)

What actually exists today, in its entirety:

1. **Navigation Analytics** — the only purpose-built product-analytics pipeline. Privacy-minimized by construction (no PII/VIN/URL/IP; server-derived role bucket). But only **4 of 9 event types have producers, all web** (Navbar mega-menu + route guard); `navigation_item_impression`, drawer/tab/role-switch/error types have **zero call sites**; the mobile client is **dead code** (zero importers). Admin aggregates endpoint caps at 50k rows/window (silent truncation). Promised 30-day purge + daily rollup were never built.
2. **Marketplace Admin Analytics** — `GET /api/admin/marketplace/analytics` (admin+government): all-time listing status counts + inquiry counts by type/status/attribution. Platform-wide snapshot, unbounded JS scan. No windowing, no funnel, no views.
3. **Communications Analytics** — richest existing funnel source: per-user `GET /api/communications/analytics` (conversations by workflow/funnel_stage, response times avg/median/p95, delivery success/failure/suppression, attribution by source/referral/campaign, campaign touches/conversions) over `conversation_events` + queue tables, capped at 1k–2k rows; plus admin ops metrics (open/unassigned/overdue threads, dead letters, provider telemetry, worker health). Tenant scope server-validated.
4. **Referral ledger** — `referral_events` (36+ event types, 1,163 staging rows) with admin raw timeline; **no KPI aggregation endpoint**. Includes the referral-conditional `marketplace_listing_viewed`.
5. **Admin platform stats** — `/api/admin/stats`: 4 real counts + **hardcoded `aiConfidence:'98.5%'` and `systemHealth:'Optimal'` served as if live** (`adminRoutes.js:51-52`).
6. **Diaspora operator aggregates** — trade-graph summaries (SQL GROUP BY, server-derived tenant — the best-practice pattern in the codebase), workbook console totals, billing checkout funnel with abandonment rate.
7. **In-memory `metricsHub`** — process-local counters, reset on restart; not durable.

**No dealer, insurance, bank, or government KPI analytics backend exists at all.** No rollup/materialized layer exists anywhere (0 `CREATE MATERIALIZED VIEW` in 140 migrations). Nearly every analytics read is derived-in-JS over bounded row fetches → silent undercount at scale.

**Listing-view measurement reality (verified):** `marketplace_listing_viewed` fires **only** when a referral/campaign param is present on `GET /api/marketplace/listings/:id` (`marketplaceRoutes.js:104-121`), best-effort, non-idempotent (repeat GETs duplicate). Organic views are recorded **nowhere**. No view counter/table/endpoint exists. Mobile never passes attribution → mobile views never emit even the referral event.

**Save/share reality (verified):** save/unsave writes `saved_vehicles` current-state only — an unsave leaves zero trace; save counts are not retroactively computable. Web share buttons are client-side only (`navigator.share`); backend `POST /api/communications/share` exists but has zero web page consumers. **No durable marketplace share event exists.**

---

## 3. Mock/static KPI register (summary — full registers: appendices D, E, F)

Every displayed number on every stakeholder dashboard was classified (authoritative-live / derived-live / static-demo / fallback / unavailable-truthful / deprecated). Headlines:

**Fully-fabricated surfaces (highest priority for replacement/blocking):**
- `AIDashboard.tsx` (owner "Gutu AI") — zero API wiring; canned responses with fabricated valuations, policy numbers, "98.7% fraud detection".
- `CustomerRecords.tsx` (mechanic) — entirely invented CRM data.
- `GovernmentDashboard.tsx` — fabricated tiles (1.2M vehicles, 234 pending), fabricated chart, **fabricated named-officer MFA session log**; ComplianceReports simulates downloads (success toast, no file).
- `BankDashboard.tsx` — fabricated tiles ($1,245,000 / 4 / 7.5% / 1.2%), loan chart, "CBZ Bank" branding, fake AI copilot narrative, 84/12/4% risk bars. `CollateralMap.tsx` injects **fabricated vehicle fleets on both empty and error**. `CreditRiskAnalysis.tsx` fabricated initial state persists on error; fake "0.00% NPL Healthy".
- `RiskAnalysis.tsx` (insurance) — **not remediated** (contradicts the plan's assumption that insurance was clean): fabricated risk-by-category chart, fabricated initial score/premium/factors, hardcoded discount claims; recalculation is **ungrounded LLM output** presented as ledger-based.

**Dealer surfaces (plan's named targets — confirmed and located):**
- `DealerDashboard.tsx:16-22,213-225` static sales chart; `:228-244` static inventory-aging 60/30/10; permissions matrix persists nothing.
- `SalesAnalytics.tsx:28-32` hardcoded $2,090,000 / 53 / $39,400 initial KPIs; `:9-24` mock charts; `:68-71` fake deltas + "4.8" rating (no rating system exists).
- `Promotions.tsx:46` **concatenates mock campaigns into successful API results**; "434 views"/"12.2%" tiles are literals.
- **Wrong-scope live data:** DealerDashboard "Total Inventory"/"Branch Stock" and SalesAnalytics' overwrite read the **public platform-wide** `/api/vehicles` instead of tenant-scoped `/api/vehicles/inventory` — live numbers that are not the dealer's.
- Dealer `Inventory.tsx` renders non-existent fields (`viewCount`/`trustScore`/`condition`) as blank fragments, a hardcoded Unsplash stock photo per row, and invents status 'Available'.

**Admin:** `AdminDashboard.tsx` fabricated user-growth chart, fabricated initial stats that **persist on fetch error**, `'$145,000'` literal shown exactly when escrow count is 0, backend-served fake `98.5%`, fake "AI copilots online" naming real institutions. `AIMonitoring.tsx` fabricated tiles/charts.

**Truthful-posture reference implementations to replicate:** OwnerDashboard tri-state loading/ready/unavailable; `ownerStatedValues.ts` (fails closed); insurance home page (fully remediated); `IdentityVerificationCaseManagement.tsx` ("counts are unavailable — they are NOT zero"); NavigationAnalyticsPanel; LendingQueue.

**Systemic fake-zero/fake-empty defect:** ~12 surfaces render fetch failure as zeros or empty states (MyGarage, MyListings, ServiceHistory, InsuranceRecords, dealer Inventory, WorkOrders, MechanicDashboard tiles, PartsTracking tiles, admin Communications ops strip, ComplianceReports tiles, FraudAlerts tiles, DiasporaCompliance). The Intelligence plan's "no fake zeros" rule requires a shared no-data/unavailable presentation contract (planned in I4/I5).

**Mobile:** no mock data arrays, but hardcoded "Active" status badge for every garage vehicle, fabricated "Verified" log-state default, hardcoded make chips, and a static "Backend governed" audit label. Mobile emits **zero analytics events of any kind** (nav client dead code; no attribution capture; the only demand signal mobile leaves is a completed inquiry with `source_channel:'mobile'`).

---

## 4. Event inventory (summary — full register: appendix C)

Existing ledgers and their reuse posture for Intelligence:

| Ledger | Rows (staging) | Vocabulary | Intelligence posture |
|---|---|---|---|
| `navigation_analytics_events` | 1,554 | 9 types (4 wired) | **Reuse pattern & privacy discipline**; not commercial listing analytics (its privacy contract forbids that overload) |
| `referral_events` | 1,163 | 36+ types incl. referral-conditional marketplace events | **Project** into attribution; do not treat as view/demand ledger; see P0 forgery below |
| `domain_events` (outbox) | 281 | marketplace.inquiry.created (only idempotent type), listing.moderated, finance.*, identity/evidence decided, DIASPORA_* (no subscribers) | Reuse as fact triggers; it is delivery infrastructure, not an analytical store |
| `conversation_events` | 113 | conversation_started, inquiry_created, message_received, stakeholder_first_response, campaign_*, ai_* — with `business_workflow`, `funnel_stage`, `acquisition_source`, referral/campaign cols | **Reuse — richest existing funnel ledger**; Communications remains authority |
| `communication_audit_events` | 1,378 | 26 ops types | Project (ops/SLA intelligence) |
| `message_delivery_attempts` | 363 | per-attempt sent/failed | Reuse (delivery reliability) |
| `trust_audit_events` | 4,805 | ~19 named + dynamic types (incl. security events; carries IP/UA) | Project, compliance-sensitive |
| `escrow_trust_events` | 123 | FSM + `provider:*` transitions | Project (transaction funnel) |
| `diaspora_import_audit_log` (+stage events) | 444 | sealed trade/compliance actions | Project (trade funnel) |
| `blockchain_events` | 23 stg / 716 prod | free-text VIN ledger entries | Project; **it is an internal signature ledger, not a chain — never describe as blockchain** |

**Marketplace actions with NO event today (verified absences):** listing impression; organic detail view; engaged view/dwell; save/unsave history; share; compare; search executed; zero-result search; price change; listing lifecycle (create/publish/sold/delist — only `.moderated` exists); inquiry-started (pre-submit funnel); recommendation served/clicked; **all mobile actions**. This is the I2/I3 build surface.

Declared-but-never-emitted vocabulary (reserved, do not double-define in I1): `marketplace_listing_paid`, `marketplace_purchase_confirmed`, `referral.link_opened`, 5 nav types.

---

## 5. Business-authority table inventory (summary — full register: appendix A)

Authority map that Intelligence must observe and never replace (key rows; full table in appendix A):

- `saved_vehicles` — current save state (4 cols; no history) · `marketplace_inquiries` — inquiries (rich: type/status/attribution/risk) · `vehicles` + `publication_status` — listing/publication truth (`vehicle_listing_summaries` read-model was deliberately **dropped** as a dormant second truth-source — a precedent this programme must respect when designing rollups) · Communications tables — conversation/delivery authority · `escrow_trust_sessions` + `vehicle_reservations` — transaction intent/reservation (idempotency-keyed, RPC-guarded) · trust family (`trust_change_log` is the only governed trust-change path; vehicles trust columns are a stamped provenance cache) · diaspora family · referral family · `mechanic_work_orders` (converged superset) · partner/provider platform (staging-only).
- Base tables `users`, `vehicles`, `organizations*`, `safepay_escrows`, `partsentry_logs`, `insurance_records`, `finance_applications` have **no CREATE migration** — they exist only in the `supabase_schema.sql` legacy snapshot (ALTERed since). Any Intelligence migration touching them must not assume migration-file provenance.
- RLS idioms: modern default = RLS-on + zero policies + REVOKE anon/authenticated + service-role-only writes (backend bypasses RLS by design; CarUp auth is custom so `auth.uid()`-based policies are inert on the primary runtime path). `current_tenant_id()` exists but **no backend code sets `app.current_tenant`**.
- Tenancy typing is inconsistent: `tenant_id` TEXT in most event tables, UUID in `tenants`/diaspora. I2 schema must pick and document one convention per table with explicit mapping.
- **No retention/purge job exists for any event table** (nav analytics' documented 30-day policy was never implemented). I2 must ship retention with the ledger, not after it.

---

## 6. Privacy/access gap register

| # | Severity | Finding | Evidence | Disposition |
|---|---|---|---|---|
| G1 | **P0 (data integrity)** | `POST /api/referrals/events` is **unauthenticated and un-rate-limited**: any caller inserts arbitrary rows (event_type, code/campaign/tenant ids, actor_type header, occurred_at) into `referral_events`. The entire referral/attribution stream — incl. admin analytics `referral_attributed` counts and the `marketplace_listing_viewed` record — is client-forgeable | `referralRoutes.js:155-158`, `referralEngineService.js:379-399` | Must be fixed before any Intelligence surface treats referral attribution as trustworthy. Candidate fix inside this lane at I2 (ingestion hardening) or escalate to owner for immediate out-of-lane fix |
| G2 | P1 (PII) | `GET /api/organizations/:id/users` has **no auth middleware** — returns staff name/email/avatar for any client-supplied org id (same pattern `/branches`, lower sensitivity) | `backend/server.js:1891-1907` | Outside Intelligence scope; escalated to owner in phase report |
| G3 | P1 (cross-tenant) | Referral admin listings prefer client-supplied `req.query.tenant_id` over the verified tenant, gated by `OPERATOR_ROLES` that includes plain `dealer` → a dealer can enumerate other tenants' campaigns/codes/timeline | `referralRoutes.js:16,116,133,252,291,434,468,512` | Fix required before referral data is projected into tenant-scoped Intelligence (I5/I14) |
| G4 | P2 (audit fidelity) | Raw `x-tenant-id` header recorded as `actor_tenant_id` in `trust_audit_events` without membership validation (attribution only, not read scope) | `communicationBaseRoutes.js:23-25`, `promotionsRoutes.js:53` | Register; harden opportunistically |
| G5 | P2 (role-model honesty) | `government` role receives **platform-wide** marketplace admin analytics (`authorizeRole(['admin','government'])`) — contradicts the plan's purpose-limited government posture | `marketplaceAdminRoutes.js:68` | I5 must re-scope; register now |
| G6 | P2 (security hygiene) | `blockchainService.js` persists `private_key_pem` in the `public_keys` table | `backend/services/blockchain/blockchainService.js` | Outside Intelligence scope; escalated to owner |
| G7 | P2 (latent trust) | `optionalAuth` copies raw `x-tenant-id` into `userContext.tenantId` unvalidated — safe only while its consumers stay non-privileged | `authMiddleware.js:247` | Guard: no Intelligence read may derive scope from optionalAuth tenant |
| G8 | Note | Admin is monolithic (any platform admin passes every gate; `organization_permissions` is seed-only dead weight) — the plan's scoped internal-audience model does not exist yet | `authMiddleware.js:172` | I16 design input |
| G9 | Note | `registry_verifications` (2) and `compliance_reports` (2) staging rows are **migration seed demo data** (placeholder VINs, "Interpol database cleared") — must never be surfaced as authoritative government state | `008_domain3.sql:28-38` | Registered; excluded from any "connected" claim |

Privacy classifications used by Intelligence going forward (from live inventory): nav events = pseudonymous-minimized; referral/conversation/trust/escrow/diaspora ledgers = identity-bearing (internal + scoped projections only); `saved_vehicles`/`marketplace_inquiries` = authenticated business data (identity visible to counterparty only through the declared-lead flow, which `marketplace_inquiries` already models correctly).

---

## 7. External-integration reality matrix (summary — full matrix: appendix H)

| Classification | Integrations |
|---|---|
| LIVE/CONNECTED (staging only; prod inactive) | Email Resend (transactional), Email Brevo (marketing), WhatsApp Meta Cloud API, Telegram bot |
| PARTIAL | OCR Gemini/Groq (real clients, key-dependent; 11 real prod customs-doc extractions), Expo push (adapter real, unconfigured/failing), Cloudflare email worker (source present, deployment unevidenced), AI Gemini/Groq comms+fraud |
| BUILT-BUT-INACTIVE (fail-closed) | CVR registry, CID police clearance, ZIMRA API, ZINARA licensing, VID inspections (provider platform: `provider_registry` 0 rows, transports are explicit stubs, sandbox simulator only), insurance providers, banks/lenders (sandbox eligibility only), SafeTrade payments (`live_payment` CHECK-forced false), escrow provider platform, SendGrid, FB Messenger/Instagram, Twilio SMS, Google Drive (flag off), partner API (UAT keys only; prod revoked), JP auction ingestion (fixture-mode by design), n8n automation webhooks |
| EVIDENCE-BASED-ONLY | ZIMRA customs via document upload + OCR + human review (the only real customs data today) |
| PLANNED/ASPIRATIONAL | OpenRouter/Moonshot AI (env flags, no client) |
| NOT-PRESENT | External PSPs (Stripe/Paynow/EcoCash — `APPROVED_LIVE_PROVIDERS` frozen empty), shipping/logistics carrier APIs, external blockchain (internal signature ledger only) |

Structural honesty note: sandbox results cannot be relabelled live in code (`MODE_MAP`, simulator `mode` labels) — the overstatement risk is in prose, not code. This receipt is the prose that must stay honest.

**Production substrate gap:** the entire provider platform schema is staging-only. Any Intelligence phase consuming provider outcomes has no prod substrate until an owner-gated prod migration occurs.

---

## 8. Implementation dependency map (I0 → I19)

```
I0 (this receipt)
 └─ I1 metric/event contract ──────────────┐
     └─ I2 activity ledger (migration:      │  hard deps: G1 fix (ingestion trust),
        marketplace_activity_events;        │  tenancy-typing decision, retention job,
        server-derived scope; idempotency;  │  service-role-only RLS idiom
        bot/test exclusion; retention)      │
         └─ I3 instrumentation (web+mobile) │  COORDINATION: #182-owned files
             └─ I4 rollups/read models      │  (Marketplace.tsx, VehicleDetail.tsx,
                 (calc versions,            │  mobile marketplace/[vin], listing card);
                  reconciliation tests)     │  mobile save/share/compare parity gaps
                 └─ I5 authz projections ───┤  dep: G3/G5 re-scoping
                     ├─ I6 completeness/lost-opportunity (needs search events from I3)
                     ├─ I7 seller/owner surfaces (replaces MyListings "views not tracked")
                     ├─ I8 dealer (replaces SalesAnalytics/DealerDashboard mocks; fixes wrong-scope reads)
                     ├─ I9 mechanic/garage (garage org-model decision first)
                     ├─ I10 insurance (replace RiskAnalysis fabrications; funnel needs I3 events)
                     ├─ I11 finance (BankDashboard/CollateralMap/CreditRisk mock removal)
                     ├─ I12 parts, I13 diaspora/trade (reuse existing diaspora ledgers)
                     ├─ I14 referral/marketing (dep: G1+G3 fixed)
                     ├─ I15 government (dep: real integrations = owner-gated; until then unknown-stays-unknown surfaces only; kill GovernmentDashboard fabrications)
                     └─ I16 Admin Command Center (kill AdminDashboard/AIMonitoring fabrications; scoped-admin design)
                         └─ I17 next-best-action (deterministic rules over I4 rollups; delivery via Communications authority)
                             └─ I18 Gutu (replace static AIDashboard; caller-scoped access only)
                                 └─ I19 reports/certification/manualization
```

Cross-cutting obligations attached to every phase: truthful no-data states (fix the systemic fake-zero defect as surfaces are touched), web/mobile parity, metric registry entries with calculation versions, reconciliation tests, staging controlled-count certification.

---

## 9. I0 gate statement

Per the canonical plan's I0 gate — *no new canonical metric without identified source and authority* — this inventory establishes, for every metric family in the plan, either (a) its authoritative source table/service (§5), (b) the existing observation ledger to project (§4), or (c) its verified absence and the phase that builds it (§8). The mock/static register (§3) is the removal contract; the gap register (§6) is the trust contract.

**I0 is complete. The programme continues into I1 (canonical metric and event contract).**
