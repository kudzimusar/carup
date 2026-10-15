# CarUp Corporate Admin 1.0 — Current-State Architecture Map

**Agent:** CA-ARCH  
**Task:** CA-ARCH-01  
**Programme:** CA-1.0  
**Status:** Current-state discovery and target mapping only — no product implementation authority

## 1. Authority and bounded scope

This map was produced under the following exact authorities:

- Canonical programme plan: `docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md` at `5d4997cacaff8068c4ec4c5ae78f562be4249344`.
- Documentation starting authority: `e826e6cb46d12c86feb969c8d6cbbd41914ff09a`.
- Product inspection authority: PR `#222` / `fix/oc5r-real-runtime-source-closure` at `505ffcca6b641c8b3b55f503e0f4fd39d26710dc`.
- Product source, database state, RBAC policy, Admin UI and K2B provenance authority were read-only for this task.
- No corporate legal entity is asserted here.
- No final permission schema, KPI formula or wireframe is established here.

The purpose of this document is to give CA-ORG, CA-RBAC, CA-METRIC, CA-UX and the later Corporate Admin agents a repository-grounded current-state map without creating a competing source of truth.

## 2. Classification vocabulary used in this map

### 2.1 Architectural placement

Every current capability is assigned one primary architectural class:

- **Corporate Intelligence** — consolidated management/executive reads, analytics and governed projections.
- **Business Operations** — domain operating queues and controlled workflows.
- **Platform & Security** — technical platform, feature, AI/provider, security and runtime administration.
- **Shared Governed Service** — a domain authority or composed read model that must be reused by multiple corporate surfaces rather than reimplemented.

This is a current-state mapping aid. It does not replace the canonical Corporate Admin information architecture.

### 2.2 Metric/projection truth posture

For this discovery, existing metrics/projections are classified as:

- **governed actual** — direct governed fact/count from an authoritative domain record.
- **governed derived** — versioned or bounded calculation over governed facts with declared source and scope.
- **advisory** — recommendation, AI output, suggestion or interpretation that must not be presented as an actual.
- **technical operational** — runtime/provider/worker/feature telemetry suitable for platform operations, not corporate performance.
- **contaminated pending K2B** — a value may mix sandbox/test/synthetic/operational provenance or otherwise requires K2B provenance filtering before Corporate Admin activation.
- **unavailable** — the source, denominator, binding or live provider needed to state the metric does not exist.
- **duplicated/conflicting** — more than one current surface or calculation can represent the same concept with inconsistent scope/semantics.
- **unknown** — repository inspection did not prove a safe semantic classification.

These labels are observations for CA-METRIC and K2B consumption. They are not a new provenance authority.

## 3. Executive current-state finding

### Proven repository facts

1. The current web identity model exposes seven shared frontend platform roles: `owner`, `dealer`, `mechanic`, `bank`, `insurance`, `government` and `admin`. The frontend cannot represent `platform_admin` or `super_admin` and deliberately normalizes both to `admin` for routing/presentation.
2. Backend `authorizeRole(...)` treats `admin`, `platform_admin` and `super_admin` as platform-admin roles. A base platform-admin role bypasses an endpoint's ordinary allowed-role list unless a stricter service/capability/tenant gate is also composed.
3. The first bounded server-side capability layer exists in `operationsAuthorizationService.js`, but its compatibility map still grants the full Operations capability set to `admin`, `platform_admin` and `super_admin`.
4. The current `/admin` product is therefore not a corporate-role model. It is a platform-admin shell that aggregates executive-looking intelligence, platform controls, user administration, marketplace moderation, identity/compliance review, fraud, dealer/garage onboarding, referral/growth tooling and communications operations.
5. Some current pages mix architectural planes internally:
   - `/admin/features` combines feature-rollout governance with Navigation Analytics.
   - `/admin/communications` combines customer-thread operations with provider/dead-letter/SLA/platform telemetry.
   - `/admin/users` combines account lifecycle, account creation, platform-role selection and a jump into private People & Compliance review.
6. The current Intelligence programme has already replaced substantial mock/static analytics with governed projections and explicit unavailable states. These services are reusable inputs; Corporate Admin should not recompute them.
7. K2B provenance remains an upstream dependency. No Corporate Admin metric may silently treat sandbox/test/operational rows as corporate actuals.

### Architectural recommendation

Corporate Admin should be built as a new governed presentation and membership layer over existing domain authorities, not as a rename or visual restyle of `/admin`. The current shell is valuable as an inventory of services and operator workflows, but its single-platform-admin assumption is incompatible with the canonical CEO/CFO/COO/BU/analyst/operator/platform/security separation.

## 4. Current authorization model and the admin-conflation problem

| Layer | Proven current behavior | Corporate Admin implication |
| --- | --- | --- |
| Shared frontend role type | `UserRole` is one of `owner`, `dealer`, `mechanic`, `bank`, `insurance`, `government`, or `admin`. | No CEO, CFO, COO, analyst, operator, compliance-manager, platform-admin or security-admin corporate principal is representable in the shared frontend role type. |
| Frontend route/nav gate | `featureRegistry.ts` assigns all `/admin/*` corporate/ops/platform features to `roles: ['admin']`. `DashboardLayout` and `routeAccess.ts` use this for discovery/direct-route UX. | Current IA cannot express different corporate memberships or read/write scopes. |
| Platform-role normalization | `platform_admin` and `super_admin` are rendered/routed as `admin`. | Technical platform authority is visually conflated with ordinary Admin. |
| Backend role gate | `authorizeRole` authenticates session, loads `users.role`, verifies active tenant, resolves effective role, and then lets a base platform-admin role bypass normal allowed-role membership. | A platform administrator can reach many business-domain endpoints unless an additional domain/capability rule refuses it. |
| Tenant authority | Verified selected organization is separate from platform role; `requireActiveTenant` has no platform-admin bypass. | This separation is a good reusable pattern. Corporate memberships should not be faked through tenant-role headers. |
| Operations capabilities | Named capabilities exist for vehicle/private reads, evidence review/classification, seller authority, people/private reads, identity review, dealer compliance, account security and garage onboarding. | Strong input for CA-RBAC, but it is a compatibility policy, not the final Corporate Admin permission schema. |
| Consequential actions | Some paths require real session, step-up/authentication assurance and named Operations capability. | Preserve these controls under any future Corporate Admin wrapper. |
| Data/RLS | Modern Intelligence tables and feature/navigation governance tables are service-role-only; backend owns authorization. | Corporate Admin UI must remain advisory/presentational; backend authorization remains authoritative. |

### Where `admin` currently conflates corporate responsibilities

| Responsibility currently reachable through `admin` | Examples | Intended conceptual owner to resolve later |
| --- | --- | --- |
| Executive/CEO-style consolidated intelligence | `/admin` Command Centre | CA-RBAC + CA-METRIC + CA-UX |
| Finance/lending visibility | finance projection admits platform admin; Command Centre links Finance demand | CA-FIN + CA-RBAC |
| Business operations | marketplace moderation, dealer compliance, garage onboarding, communications queues, referral operations | CA-BU + CA-RBAC |
| Compliance/risk | evidence, trust review, governance review, fraud, identity verification | CA-RBAC with existing governed services |
| People/account administration | users, suspension, account creation, private compliance read model | CA-RBAC + CA-ORG |
| Platform administration | feature rollouts, server/AI health, provider/dead-letter operations | CA-PLAT + CA-RBAC |
| Corporate/growth analysis | navigation analytics, referral intelligence, marketplace demand | CA-GROWTH + CA-METRIC |
| Institutional/regulatory review | several services also admit `government`/reviewer paths | CA-RBAC; do not treat institutional actors as corporate admins |

**CA-RBAC input:** role names alone are insufficient. The future model needs separate corporate membership, organisational scope, capability, data classification and mutation authority. This document deliberately does not define that schema.

## 5. Current Admin capability map

### 5.1 Corporate Intelligence and Platform surfaces

| Current capability | Frontend route/component | Backend endpoint/service | Primary source tables/projections | Current authorization | Class | Future primary home | Disposition | Metric / provenance / K2B dependency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ecosystem Command Centre | `/admin` → `AdminDashboard.tsx` → `CommandCentre` | `GET /api/admin/intelligence/command-centre` → `commandCentreService.js` | Direct sections over `users`, `organizations`, `vehicles`, `marketplace_inquiries`, `marketplace_activity_events`, `saved_vehicles`, `vehicle_evidence`, `message_threads`, `messages`, `escrow_trust_sessions`, `insurance_claims`; links to vertical Intelligence services | Frontend `admin`; backend `authorizeRole(['admin'])` plus platform-scope check | Corporate Intelligence | Corporate Overview | **redesign/wrap** | Reuse source-labelled composition; CA-METRIC must certify Corporate KPIs; K2B must filter operational/test provenance. |
| Feature Governance | `/admin/features` → `FeatureGovernanceConsole.tsx` | `/api/admin/features*` → `featureGovernanceService.js` | `feature_rollout_overrides` + `trust_audit_events` + immutable generated feature manifest | `admin`; backend `authorizeRole(['admin'])`; overrides can narrow but not broaden immutable policy | Platform & Security | Platform → Feature Governance | **reuse/move** | Technical governance, not a corporate KPI. Audit lineage must remain intact. |
| Navigation Analytics tab | same `/admin/features` page → `NavigationAnalyticsPanel.tsx` | `GET /api/admin/analytics/navigation` → `navigationAnalyticsService.js` | `navigation_analytics_events`, allowlisted feature/navigation manifest | `admin` | Corporate Intelligence | Customers & Growth → Navigation Intelligence | **move/wrap** | Governed derived product-usage metrics; K2B must preserve source/runtime provenance and known instrumentation coverage. |
| AI/provider monitoring | `/admin/ai` → `AIMonitoring.tsx` | `GET /api/admin/health` | `server_health` | `admin` | Platform & Security | Data & Intelligence for model inventory; Platform for provider/runtime health | **redesign/split** | Current UI explicitly withholds request volume, latency, accuracy and active-session KPIs when no canonical source exists. Treat present rows as technical operational. |
| User Management | `/admin/users` → `UserManagement.tsx` | `GET /api/admin/users`, `PATCH /api/admin/users/:id/suspend`; account creation calls `POST /auth/register` | `users`; registration/auth services | `admin`; platform-admin bypass applies | Platform & Security | People & Access | **redesign/wrap** | Account state is governed actual; “permissions” label currently overstates a single role field. Future membership/access review belongs to CA-RBAC. |
| Server health | consumed by AI Monitoring | `GET /api/admin/health` | `server_health` | `admin` | Platform & Security | Platform → Runtime Health | **reuse/wrap** | Technical operational only; must never become an executive “platform health” KPI without CA-METRIC source definition. |

### 5.2 Marketplace, trust, risk, identity and compliance

| Current capability | Frontend route/component | Backend endpoint/service | Primary source tables/projections | Current authorization | Class | Future primary home | Disposition | Metric / provenance / K2B dependency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Marketplace moderation | `/admin/moderation` → `MarketplaceModeration.tsx` | `/api/admin/marketplace/listings*`, inquiries, analytics, moderation actions → marketplace moderation/inquiry/analytics services | `vehicles`, `marketplace_inquiries` plus moderation/audit state | reviewer-role gate; service rechecks platform/base reviewer authority | Business Operations | Business Units → Marketplace → Operations | **reuse/move** | Listing/inquiry counts are actual; admin analytics are a separate legacy snapshot and must not compete with governed Intelligence projections. AI moderation summary is advisory. |
| Vehicle evidence review | `/admin/evidence` → `EvidenceReview.tsx` | `GET /api/evidence/review`; verify/reject via `/api/vehicles/:vin/evidence/:id/*` | `vehicle_evidence` and canonical evidence/trust change paths | reviewer roles; verify/reject `admin/government` | Shared Governed Service | Trust / Risk / Compliance → Evidence Review | **reuse/wrap** | Evidence statuses are governed actual. AI/OCR analysis is advisory/provenance-bearing and must not become verification authority. Do not duplicate K2B or canonical Trust. |
| VIN-centred Operations review | `/admin/vehicles/:vin/review` → `VehicleOperationsReview.tsx` | `GET /api/admin/vehicles/:vin/review` → `vehicleOperationsReadModel.js` | Read model over `vehicles`, `users`, `vehicle_evidence`, `trust_fact_requests`, `review_tasks`, `disputes`, `fraud_cases`, `trust_audit_events` plus domain evaluators | real session; `admin/government` outer gate + named Operations capability | Shared Governed Service | Operations / Trust drill-down | **reuse/wrap** | Read model only; mutations already return to owning services. Preserve that boundary. |
| People & Compliance review | `/admin/people/:userId/review` → `PeopleComplianceReview.tsx` | `GET /api/admin/people/:userId/review` → `peopleComplianceReadModel.js` | `users`, `tenant_users`, `verification_sessions`, `vehicle_seller_authority`, `vehicles`, `vehicle_ownership_transfers`, `dealer_profiles`, `dealer_compliance_requirements`, `trust_audit_events` + identity assurance projection | real session; `admin/government` outer gate + `PERSON_READ_PRIVATE` capability; tenant admins explicitly do not get this capability | Shared Governed Service | People & Access → Compliance drill-down | **reuse/wrap** | Read model intentionally keeps identity, seller authority, ownership and dealer compliance separate. Never collapse to one “verified person” metric. |
| Identity verification case management | `/admin/verification` → `IdentityVerificationCaseManagement.tsx` | `/api/admin/identity/verification-sessions*` → `verificationSessionService.js` | `verification_sessions`, `verification_decisions`, `verification_ocr_provenance`, `ocr_documents`, `users` + secure storage | `admin`; service rechecks; consequential review uses assurance policy | Shared Governed Service | People & Access / Trust & Compliance | **reuse/wrap** | Identity decision facts are actual; OCR/classifier outputs are evidence/advisory inputs with provenance, not corporate KPIs. |
| Trust Fact review | `/admin/trust-review` → `TrustReviewQueue.tsx` | `/api/verification/review-queue` and trust-fact approve/reject/revoke → `trustFactWorkflowService.js` | `trust_fact_requests`, `vehicles`, `vehicle_evidence`, `trust_audit_events` | `admin/government` | Shared Governed Service | Trust / Risk / Compliance | **reuse/wrap** | Canonical trust authority must remain singular. Corporate Admin may summarize governed outcomes, never recalculate Trust. |
| Governance review | `/admin/governance-review` → `GovernanceReviewQueue.tsx` | `/api/governance/review-queue`, `/api/governance/decisions` → `governanceService.js` | `review_tasks`, `review_decisions`, `trust_change_log`; disputes via dispute service | reviewer roles `admin/government/reviewer` | Shared Governed Service | Trust / Risk / Compliance → Governance | **reuse/wrap** | Governed decision state is actual; trust changes remain through canonical governed path. |
| Fraud Queue | `/admin/fraud-queue` → `FraudQueue.tsx` | `/api/fraud/cases*` → `fraudCaseService.js` / `fraudEngine.js` | `fraud_cases`, `fraud_signals`, `fraud_case_events`, `fraud_case_resolutions` | queue `admin/government/reviewer`; evaluation `admin/reviewer` | Business Operations | Trust / Risk / Compliance → Fraud Operations | **reuse/move** | Case/signal counts are actual; “fraud interception rate” is unavailable in Command Centre and must not be inferred. |
| Dealer compliance | `/admin/dealer-compliance` → `DealerCompliance.tsx` | `/api/admin/dealers*` → `dealerComplianceService.js`; signed evidence via onboarding service | `dealer_profiles`, `dealer_branches`, `dealer_compliance_documents`, `dealer_compliance_requirements`, `dealer_compliance_decisions` | `admin/government/reviewer`; sensitive preview/decision adds real-session/capability/assurance gates | Business Operations | Business Units → Dealer Operations / Compliance | **reuse/move** | Compliance facts are actual. Do not transform lifecycle flags into corporate “performance” KPIs without CA-METRIC. |
| Garage applications | `/admin/garage-applications` → `GarageApplications.tsx` | `/api/admin/garage-applications*` → `garageReviewService.js` / `garageActivationService.js` | `garage_applications`, `garage_application_decisions`, `garage_application_documents` + identity assurance | platform-admin compatibility + `GARAGE_ONBOARDING_REVIEW` capability + step-up for consequential actions | Business Operations | Operations → Service Network / Garage Onboarding | **reuse/move** | Application/decision states are actual. Current policy records garage activation as platform administration; CA-RBAC/CA-BU must decide future operating ownership without weakening assurance. |

### 5.3 Customers, growth, referrals and communications

| Current capability | Frontend route/component | Backend endpoint/service | Primary source tables/projections | Current authorization | Class | Future primary home | Disposition | Metric / provenance / K2B dependency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Referral campaigns | `/admin/referrals` → `ReferralCampaigns.tsx` | `/api/referrals/campaigns*` → `ReferralEngineService` | referral campaign/code/event family | operator-role gate | Business Operations | Customers & Growth → Referral Operations | **reuse/move** | Campaign state is actual; performance should use governed Referral Intelligence, not raw event counts. |
| Referral codes/coupons/rewards | `/admin/referrals/codes` → `ReferralCodes.tsx` | code/coupon/wallet endpoints in `referralRoutes.js` | `referral_codes`, `referral_coupons`, wallet/transaction/event family | operator/admin roles depending mutation | Business Operations | Customers & Growth → Referral Operations | **reuse/move** | Accrued and paid value must stay distinct. Current governed intelligence reports no paid rewards at its evidence point. |
| Local referral leads | `/admin/referrals/local-leads` → `ReferralLocalLeads.tsx` | `/api/referrals/local-marketplace/*` | referral events + marketplace lead/inquiry facts | mixed optional/public create paths and operator list/qualify paths | Business Operations | Customers & Growth → Acquisition / Local Marketplace | **reuse/move** | Attribution coverage is incomplete; K2B and CA-GROWTH must prevent channel/source gaps from reading as full-funnel truth. |
| Referral import routes | `/admin/referrals/import-routes` → `ReferralImportRoutes.tsx` | `/api/referrals/import-campaigns/*` | referral/import campaign event state | operator roles for governance/mutation | Business Operations | Customers & Growth with Diaspora Trade linkage | **reuse/move** | Route/capacity objects are operational facts; commercial ROI is unavailable without cost/revenue authority. |
| Referral marketing | `/admin/referrals/marketing` → `ReferralMarketing.tsx` | `/api/referrals/marketing/*` → Marketing/SEO benchmark service | marketing asset/event state | operator roles | Business Operations | Customers & Growth → Marketing | **redesign/wrap** | Generated campaign copy, SEO pages, channel messages, proof stories, FAQs and analytics suggestions are advisory until human-governed state says otherwise. |
| Referral trust review | `/admin/referrals/trust` → `ReferralTrustReview.tsx` | `/api/referrals/trust/*` → ReferralTrustReview service | review cases, disputes, wallet holds, referral event/audit state | operator/trust-decision roles | Business Operations | Trust / Risk / Compliance with Referral linkage | **reuse/move** | Trust/risk review outcomes are governed facts; do not mix them into growth success metrics. |
| Communications Command Center | `/admin/communications` and nested inbox/section aliases → `AdminCommunications` | `/api/admin/communications/*` → communication service factory/repository | `message_threads`, `messages`, `message_participants`, `communication_escalations`, `channel_identities`, `message_delivery_attempts`, `communication_preferences`, `communication_audit_events`, `notification_queue` plus provider/worker telemetry | admin-role routes; some diagnostics also require base platform admin or worker secret | Mixed: Business Operations + Platform & Security | Customers & Growth → Communications Operations; Platform → Communications Integrations/Delivery | **redesign/split** | Thread/funnel/delivery facts are actual/derived. Dead letters, provider health and worker state are technical operational. Keep the two planes distinct. |

### 5.4 Diaspora / Trade operating surfaces

| Current capability | Frontend route/component | Backend endpoint/service | Primary source tables/projections | Current authorization | Class | Future primary home | Disposition | Metric / provenance / K2B dependency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Diaspora compliance queue | `/admin/diaspora/compliance` → Diaspora Trade compliance Admin view | `GET /api/diaspora/compliance` plus document/profile review endpoints | Diaspora compliance/profile/document families | frontend registry `admin/government`; backend domain gates | Business Operations | Business Units → Diaspora Trade → Compliance | **reuse/move** | Compliance states are actual. Government/reviewer access is not corporate admin membership. |
| Workbook operator console | `/admin/diaspora/workbooks` → `DiasporaWorkbookOperatorConsole.tsx` | operator-dashboard, batch-summary, next-actions, notes, hold, export endpoints | persisted workbook import batches, row diagnostics, operator notes/holds; database-sourced exports | authorized reviewer roles | Business Operations | Business Units → Diaspora Trade → Data Intake Operations | **reuse/move** | Operational counts only. Console explicitly blocks live import, retry execution, rollback, AI execution and Drive/OAuth where unavailable. |
| Workbook dry-run | `/admin/diaspora/workbooks/new` → `DiasporaWorkbookDryRun.tsx` | `POST /api/diaspora/workbook/dry-run` plus template/schema endpoints | dry-run import-batch + row-diagnostic records; no live trade-table writes | authorized reviewer roles | Business Operations | Business Units → Diaspora Trade → Data Intake Operations | **reuse/move** | Dry-run rows are operational/test provenance and must not enter corporate actuals. K2B dependency is explicit. |

## 6. Current intelligence and metric/projection inventory

The table below classifies the existing projection families at the inspected product SHA. “Primary class” describes the data currently served, not the future KPI importance.

| Intelligence family | Existing projection / source | Existing metric families | Current classification | Corporate Admin use |
| --- | --- | --- | --- | --- |
| Navigation Intelligence | `navigationAnalyticsService.js` over `navigation_analytics_events`; admin aggregate `/api/admin/analytics/navigation` | event count; impressions; selections; destination renders/blocks; errors; selection-through rate; platform/role/event/surface splits | **governed derived**, with coverage limits; some rows may be **contaminated pending K2B** if test/runtime provenance is not separated | Reuse under Customers & Growth after CA-GROWTH/CA-METRIC define coverage and K2B eligibility. Do not duplicate inside Platform Feature Governance. |
| Command Centre | `commandCentreService.js`, `command_centre@1` | users/organizations; vehicle supply; inquiries/saves/activity; evidence reviewed/pending; thread/message volumes; escrow sessions live vs sandbox; claims recorded; links to vertical projections | Direct counts are **governed actual/derived**; revenue, customer health, platform health and fraud interception rate are explicitly **unavailable** | Use as composition precedent, not final Corporate Overview KPI contract. Recompose only certified metrics. |
| Marketplace Admin analytics | `marketplaceAnalyticsService.js` over `vehicles` + `marketplace_inquiries` | listing status totals; inquiry totals/by type/by status; referral-attributed; high-risk; diaspora-demand inquiry count | **governed actual** counts but **duplicated/conflicting** with newer windowed Intelligence semantics; inquiry-table absence historically resolves to a note/zero structure | Keep as operations queue summary only; Corporate Intelligence should prefer governed Intelligence projections with explicit availability. |
| Marketplace/Seller/Dealer Intelligence | `intelligenceProjectionService.js` over `listing_daily_metrics`, `seller_daily_metrics`, `tenant_daily_metrics`, `platform_daily_metrics` plus authoritative inventory | impressions, views, unique viewers, engaged views, saves/unsaves, shares, inquiry starts/inquiries, inspections, watchlist state, view→save, view→inquiry, impression→view, dealer tenant demand | **governed derived**; versioned rollups and fail-closed freshness. Dealer completed sales/revenue/average sale are **unavailable** | Reuse. CA-METRIC must decide which become Corporate/BU KPIs; CA-GROWTH owns funnel semantics. |
| Garage / Service Intelligence | `serviceIntelligenceService.js`; `/api/mechanic/analytics` and `/api/garage/analytics` | work-order/service record/inquiry facts; completion; repeat/customer/demand views; newer Service Network case metrics where records exist | Measured facts **governed actual/derived**; booking/capacity/utilisation and unsupported service-category demand remain **unavailable** unless backed by Service Network records | Reuse at BU/Operations level. Do not infer capacity or booking conversion from work orders. |
| Insurance Intelligence | `insuranceIntelligenceService.js`; `insurance_demand@1` | provider state; live eligibility requests/eligible/not-eligible/pending/rate; sandbox activity separately | live side **governed derived**; sandbox is **technical/contaminated pending K2B** and explicitly excluded from demand; product views, quote submissions, offers, policies bound-through-CarUp, renewals, source attribution **unavailable** | Corporate/BU view may show only K2B-eligible live demand and explicit unavailable states. Risk/underwriting/claims remain separate governed domain. |
| Finance Intelligence | `financeIntelligenceService.js`; `finance_demand@1` | active lenders/provider state; applications received; authoritative decisions; awaiting decision; decision rate; live eligibility; sandbox eligibility | observed applications/decisions **governed actual/derived**; sandbox **contaminated pending K2B**; disbursement, portfolio value/APR/default risk/collateral binding and several attribution measures **unavailable** | Input to CA-FIN, but this is commercial demand, not management accounting, revenue or balance-sheet truth. |
| Parts / Provenance Intelligence | `partsIntelligenceService.js`; `parts_demand@1` | RFQ received/responded/awaiting/response rate; PartSentry logs/verified/pending/public/flagged; garage stock counts/value where recorded | **governed actual/derived** for recorded facts; compatibility, supplier performance, demand-by-part and zero-result parts demand **unavailable**; suspicion status is not a fraud verdict | Reuse. PartSentry/provenance must remain a separate governed source and K2B dependency, never a second Trust classifier. |
| Diaspora / Trade Intelligence | `tradeIntelligenceService.js`; `trade_demand@1` over authoritative order/quote/milestone/escrow records; older Trade Graph service remains separate derived graph authority | order funnel, corridor counts, quote counts/acceptance, request/offer funnel, milestone confirmations, escrow session live vs sandbox, currency-grouped amounts | authoritative row counts **governed actual/derived**; sandbox escrow **contaminated pending K2B**; settled trade value, live SafeTrade outcomes, shipment/route demand, landed cost, trade↔vehicle linkage, counterparty reputation **unavailable** at the evidence point; graph service is a separate derived projection | Reuse authoritative projection for BU scorecard. Do not merge graph-derived opportunity with recorded actuals without CA-METRIC provenance labels. |
| Referral / Marketing Intelligence | `referralIntelligenceService.js`; `referral_intelligence@1` over filtered referral event domain, reward ledger and attributed inquiries | referral-domain event count; codes; validation success; coupon actions; channel/source distribution with coverage; reward accrual/paid state; referral-attributed inquiries/rate | filtered counts **governed derived**; source attribution is coverage-limited; marketing generated content/suggestions **advisory**; ROI and completed-sale conversion **unavailable** without cost/revenue/sale authority | Reuse for Customers & Growth. CA-GROWTH/CA-METRIC must define attribution denominator and K2B eligibility. |
| Institutional / Government Intelligence | `governmentIntelligenceService.js`; provenance projection | provider contract state; CarUp-assessed evidence; live vs sandbox registry checks; audit posture | CarUp review/audit counts **governed actual/derived**; sandbox checks **contaminated pending K2B**; authoritative government verification/national counts/duty authority **unavailable** because no live authoritative provider is connected | Keep institutional portal distinct from Corporate Admin. Corporate Admin may see internal integration status, not represent simulator results as government truth. |
| AI moderation / AI-generated operating assistance | marketplace moderation summaries, referral marketing suggestions, OCR/classifier aids | summaries, recommendations, generated copy, confidence only where provider executed | **advisory** | Never activate as Actual KPI. Store/display provenance and human decision separately. |
| Runtime/feature/provider telemetry | `server_health`, feature rollout state, communication dead letters/provider telemetry | model/provider status, override state, worker/delivery operational signals | **technical operational** | Platform & Security only unless CA-METRIC explicitly promotes a well-defined reliability KPI. |

### 6.1 Specific duplicated/conflicting semantics to resolve

1. Marketplace operations analytics and Intelligence rollups can both show marketplace activity but use different grains/windows. Corporate Admin should not select one based on convenience.
2. The Command Centre is intentionally compositional, while vertical services are domain-specific. A future Overview must link/drill into those domain projections rather than copy formulas.
3. Navigation Analytics currently lives under the Feature Governance route even though its semantics belong to Customers & Growth.
4. Communications has both customer/funnel analytics and delivery/provider operational telemetry. One “communications health” number would conflate business and platform meaning.
5. Diaspora authoritative-table intelligence and the older derived Trade Graph intelligence answer different questions. They must remain visibly distinct.
6. “Trust”, “evidence verified”, “fraud flagged”, “PartSentry verified” and “identity verified” are separate governed facts. No Corporate Admin rollup may collapse them into one trust/verification percentage.

## 7. Reporting and management-information current state

### Proven repository facts

- The Intelligence programme includes `reportService.js` and stakeholder report/manualization work, but the canonical Corporate Admin historical management-report/board-pack architecture does not yet exist.
- Command Centre explicitly has no revenue source, no customer-health model and no measured platform-health figure.
- Intelligence daily rollups are versioned and service-role protected, but they are product/marketplace analytical projections, not a general corporate accounting/reporting ledger.
- Current downloadable/export functions are domain-specific (for example Diaspora workbook/database exports and referral audit export), not a unified management-report snapshot system.

### Architectural recommendation for CA-REPORT

CA-REPORT should treat present exports and Intelligence reports as source capabilities, not as the Corporate Admin reporting architecture. Historical reproducibility will require CA-METRIC version references, organisational scope from CA-ORG, access scope from CA-RBAC and finance semantics from CA-FIN.

## 8. Finance current-state boundary

### Proven repository facts

- `financeIntelligenceService.js` is explicitly **commercial demand intelligence**, not accounting.
- It can count applications and authoritative decisions where recorded and split live eligibility from sandbox activity.
- The repository evidence states no authoritative disbursement state and no reliable finance↔collateral binding for management-accounting use.
- Command Centre declares revenue unavailable because completed payment/revenue authority is absent across the relevant product flows.
- Escrow/SafeTrade sessions include sandbox/provider semantics that must not be promoted into corporate revenue.

### Input for CA-FIN

CA-FIN must establish the management-accounting source map independently of the lending-demand projection. Do not derive revenue, GMV, cash, margin, receivables, payables or settlement KPIs merely from application, scheduled milestone or sandbox escrow state.

## 9. Business-unit current-state observations

The codebase has product/domain structures that are candidates for business-unit reporting, but CA-ARCH does **not** declare them legal entities or subsidiaries.

Repository-visible operating domains include at least:

- Marketplace / dealer ecosystem.
- Diaspora Trade / import operations.
- Service Network / garages/mechanics.
- Insurance.
- Finance/lending.
- Parts / PartSentry.
- Referral / marketing.
- Communications.
- Trust / evidence / identity / governance / fraud as cross-cutting governed services.
- Platform / AI / integrations / feature governance.

Whether any of these is a company, subsidiary, business unit, department, cost centre or merely product domain is **open for CA-ORG**.

## 10. Open questions for CA-ORG

CA-ORG / CA-ORG-01 should resolve, without reusing external tenant concepts by assumption:

1. What is the top-level internal corporate entity represented in Corporate Admin?
2. Are any product domains separate legal entities or subsidiaries? No answer is inferable from route names.
3. Which domains are business units versus departments/capabilities shared across business units?
4. Is Diaspora Trade an internal BU, a product line, or an operating programme within another entity?
5. Is Marketplace a BU or the parent commercial platform?
6. Where do Service Network, Dealer Operations, Insurance, Finance and Parts sit organisationally?
7. Are Trust/Risk/Compliance, Communications, Data/Intelligence and Platform central shared functions?
8. What internal organisational hierarchy is required: company → BU/subsidiary → department → team, and which levels need P&L/reporting scope?
9. Which current `organizations` / `tenants` records represent external/customer organizations versus internal corporate structure? They must not be conflated.
10. What is the authoritative mapping between an employee/corporate member and the internal organisation they act for?
11. Which corporate units own each current governed service and each management metric?
12. What currencies, fiscal entities and reporting dimensions attach to each organisational unit? CA-ORG should answer structure; CA-FIN should answer accounting semantics.

## 11. Inputs required by CA-RBAC

CA-RBAC / CA-RBAC-01 should start from these proven boundaries:

- Current frontend has one `admin` corporate/platform bucket.
- Backend has broader platform-admin compatibility roles, but UI normalizes them to `admin`.
- Base platform admins bypass many ordinary `authorizeRole` role lists.
- Named Operations capabilities already exist and are a better pattern than adding more raw role checks.
- Verified active-tenant membership is separate from platform role and should stay separate from corporate membership.
- Some sensitive operations already require real session, named capability and step-up/authentication assurance.
- Data classifications in the canonical plan require aggregate visibility to be separable from record-level PII/financial/security access.
- Domain services already own decisions; Corporate Admin must not create generic mutation endpoints around them.
- External/institutional roles such as `government`/reviewer are not corporate executives merely because they share review endpoints.

CA-RBAC should therefore define corporate membership and delegated authority without changing the existing domain authorities in the first step.

## 12. Inputs required by CA-METRIC

CA-METRIC / CA-METRIC-01 should receive the following source posture:

### Ready to register as candidate governed sources

- Versioned Intelligence daily rollups and projection services.
- Direct governed entity/count sources used by Command Centre.
- Navigation Analytics event pipeline and aggregates, subject to instrumentation/provenance coverage.
- Communications event/delivery/response data, with business and technical semantics separated.
- Referral Intelligence filtered event-domain projection.
- Diaspora authoritative order/quote/milestone projection.
- Finance/insurance live-demand projections with sandbox kept separate.
- Service Network/mechanic/garage governed projections.
- Evidence/trust/governance/fraud/identity/dealer/garage lifecycle facts as operational facts, not automatically strategic KPIs.

### Must not be activated as corporate Actual without further authority

- Revenue/GMV/margin/cash/settlement claims.
- Customer health/churn/retention/satisfaction where no source is defined.
- Platform health represented by generic labels rather than measured uptime/latency/error definitions.
- Fraud interception rate.
- Dealer sales/revenue where completed-sale authority is absent.
- Insurance policies-bound conversion through CarUp.
- Finance disbursement/default/portfolio value.
- Parts compatibility/supplier performance.
- Trade settled value/shipment demand where live authority is absent.
- Referral ROI/completed-sale conversion.
- Government verification/national statistics while only sandbox/no provider authority exists.
- Any AI-generated number or recommendation.
- Any sandbox/test/dry-run figure unless explicitly classified as non-actual.

CA-METRIC must consume K2B provenance. This map does not define new KPI formulas.

## 13. Inputs required by CA-UX

CA-UX / CA-UX-01 should preserve the following current-state lessons:

1. The present `/admin` sidebar is organized by implementation history, not by executive information architecture.
2. Corporate Overview should not reproduce the current mixed command-center menu; it should prioritize governed strategic status and drill into owning domains.
3. Operations queues need task-oriented layouts; executive views need aggregate-to-drill-down layouts. These are different surfaces.
4. Technical Platform controls must not be visually adjacent to CEO/finance metrics merely because the same `admin` role can access both today.
5. Navigation Analytics should move out of Feature Governance presentation.
6. Communications needs a clear split between customer operations and delivery/provider operations.
7. “Unavailable” is a first-class visual state. Existing Intelligence work already establishes this pattern.
8. Advisory AI must be visually distinguished from governed actuals/decisions.
9. Sensitive People/identity evidence should stay behind dedicated drill-down/preview controls, not be surfaced in executive cards.
10. No final wireframe is established by CA-ARCH-01.

## 14. Reuse / move / wrap / redesign / retire summary

### Reuse as governed services

- Intelligence vertical services and versioned rollups.
- Vehicle Operations and People & Compliance read models.
- Evidence, Trust Fact, Governance, Fraud, Identity, Dealer Compliance and Garage onboarding services.
- Feature-governance service and audit.
- Navigation analytics ingestion/aggregate service.
- Communications domain services.
- Diaspora workbook/compliance services.
- Referral engine/trust/marketing services with advisory labeling.

### Move or wrap into Corporate Admin IA

- Marketplace moderation.
- Dealer/garage operating consoles.
- Referral operations.
- Diaspora operating consoles.
- Communications customer operations.
- Feature governance.
- User/account lifecycle.
- Platform technical health.
- Corporate/growth intelligence projections.

### Redesign presentation/composition

- `/admin` Overview.
- `/admin/features` because it mixes Platform governance and Growth analytics.
- `/admin/communications` because it mixes customer operations and technical delivery operations.
- `/admin/users` because a role field is presented as “permissions” and account creation is mixed with access governance.
- `/admin/ai` because technical health must be separated from Data & Intelligence model governance and any future quality/cost metrics.

### Retire from Corporate Admin semantics, not necessarily delete code

- Any legacy/static/mock KPI presentation already superseded by governed projections.
- Generic “system health/AI confidence/fraud rate” literals or inferred business metrics without governed sources.
- Duplicate calculations of Trust, revenue, sales, conversion or provenance when an owning governed service exists.

## 15. Dependency and collision map

| Dependency / collision | Stable owner | CA-ARCH-01 finding |
| --- | --- | --- |
| Provenance eligibility | **K2B** | Corporate Admin must consume K2B provenance and may not create a parallel classifier. |
| Corporate entity / BU hierarchy | **CA-ORG / CA-ORG-01** | Unresolved; route/domain names are not legal-entity evidence. |
| Membership / permissions / delegated authority | **CA-RBAC / CA-RBAC-01** | Current monolithic `admin` is insufficient; existing Operations capabilities are reusable input, not final schema. |
| Metric registry / formulas / source lineage | **CA-METRIC / CA-METRIC-01** | Existing Intelligence projections are primary candidates; unavailable/advisory/technical states must remain explicit. |
| Executive/dashboard composition | **CA-UX / CA-UX-01** | Current sidebar/page grouping is not target IA; specific mixed-plane pages identified above. |
| Finance/accounting semantics | **CA-FIN / CA-FIN-01** | Current Finance Intelligence is demand, not management accounting. |
| Customer/growth funnel semantics | **CA-GROWTH / CA-GROWTH-01** | Navigation, marketplace, referral and communications sources exist but have different coverage/grains. |
| BU scorecards and operating ownership | **CA-BU** | Must consume CA-ORG, CA-RBAC and CA-METRIC rather than derive BU identity from routes. |
| Historical management reporting | **CA-REPORT** | Domain exports/reports exist; no unified versioned corporate reporting/snapshot authority yet. |
| Platform/security boundary | **CA-PLAT** | Feature governance, AI/server health and communications delivery/provider ops are platform concerns currently mixed into Admin. |
| Cross-role certification | **CA-CERT / CA-CERT-01** | Should later prove no Corporate role gains domain mutation or restricted data merely by UI visibility. |

## 16. Evidence inspected

The discovery was performed against exact product SHA `505ffcca6b641c8b3b55f503e0f4fd39d26710dc` and included, at minimum:

- `web/src/App.tsx`
- `web/src/config/featureRegistry.ts`
- `web/src/components/layout/DashboardLayout.tsx`
- `web/src/lib/routeAccess.ts`
- `web/src/hooks/useCarUpApi.ts`
- Admin page components under `web/src/pages/dashboard/admin/**`
- Diaspora operator/workbook pages under `web/src/pages/diaspora/**`
- `backend/middleware/authMiddleware.js`
- `backend/routes/adminRoutes.js`
- `backend/routes/marketplaceAdminRoutes.js`
- `backend/routes/intelligenceProjectionRoutes.js`
- `backend/routes/featureGovernanceRoutes.js`
- `backend/routes/navigationAnalyticsRoutes.js`
- `backend/routes/adminCommunicationRoutes.js`
- `backend/routes/vehicleOperationsRoutes.js`
- `backend/routes/peopleOperationsRoutes.js`
- `backend/routes/identityVerificationAdminRoutes.js`
- `backend/routes/dealerRoutes.js`
- `backend/routes/garageReviewRoutes.js`
- `backend/routes/fraudRoutes.js`
- `backend/routes/governanceRoutes.js`
- `backend/routes/trustFactRoutes.js`
- `backend/routes/vehiclesRoutes.js`
- `backend/routes/referralRoutes.js`
- `backend/services/operations/operationsAuthorizationService.js`
- `backend/services/operations/vehicleOperationsReadModel.js`
- `backend/services/operations/peopleComplianceReadModel.js`
- Intelligence services for command centre, projections, service/garage, insurance, finance, parts, trade, referral and government
- Navigation Analytics and Feature Governance services/migrations
- Intelligence receipts `I0`, `I8`–`I16` and `I19` as supporting design/evidence history

No database mutation or runtime mutation was performed.

## 17. Claims, proven facts and architectural recommendations

### Claims

- The supplied canonical plan and exact authorities are the controlling inputs for this task.
- The future Corporate Admin programme will consume the outputs of the named stable agents according to moderator dispatch.

These are programme-authority claims, not independently inferred product facts.

### Proven repository facts

- PR #222 is Draft/Open/Unmerged at exact head `505ffcca6b641c8b3b55f503e0f4fd39d26710dc` at inspection time.
- Documentation branch `docs/corporate-admin-1-canonical-plan` was identical to `e826e6cb46d12c86feb969c8d6cbbd41914ff09a` before this artifact was written.
- The current Admin route/service/table/auth mappings and Intelligence classifications above are grounded in repository source at the exact product SHA.
- Current Admin authority is monolithic at the frontend role level and broad at the backend platform-admin compatibility level, with bounded exceptions through tenant/capability/assurance checks.
- Existing Intelligence services deliberately expose unavailable and sandbox-separated states in multiple domains.

### Architectural recommendations

- Build Corporate Admin as a governed layer over current domain services, not as a new domain authority.
- Separate Corporate Intelligence, Business Operations and Platform & Security in navigation and access semantics.
- Reuse current bounded read models and governed projections.
- Split mixed-plane pages rather than carrying current UI grouping forward.
- Make CA-ORG, CA-RBAC, CA-METRIC, CA-UX, CA-FIN and CA-GROWTH resolve their respective open authorities before product implementation.

## 18. Stop conditions and non-actions

No stop condition requiring escalation was encountered.

The following prohibited actions were not performed:

- no Corporate Admin application code implementation;
- no database mutation;
- no RBAC mutation;
- no Admin UI redesign;
- no K2B/provenance classifier duplication;
- no corporate legal-entity invention;
- no final KPI formula;
- no final permission schema;
- no final wireframe;
- no product deployment or merge.

## 19. Recommended next bounded tasks

1. **CA-ORG / CA-ORG-01** — resolve internal company/BU/department/team hierarchy and ownership questions in section 10.
2. **CA-RBAC / CA-RBAC-01** — consume section 4 and section 11 to design the corporate membership/permission model without weakening existing domain authority.
3. **CA-METRIC / CA-METRIC-01** — consume section 6 and section 12, plus K2B, to establish the governed metric registry/source-owner map.
4. **CA-UX / CA-UX-01** — consume sections 5, 6 and 13 to design the executive/operations/platform information architecture and wireframe system.
5. **CA-FIN / CA-FIN-01** and **CA-GROWTH / CA-GROWTH-01** may then refine their domain semantics against the same source map.
6. **CA-CERT / CA-CERT-01** should perform the architecture consistency/collision audit before any K3A product implementation authority.

This document does not self-accept.
