# I0 EVENT EMISSION INVENTORY — CarUp @ ba208963 (branch feat/carup-intelligence-1-0)

## 1. Navigation analytics (the ONLY purpose-built product-analytics pipeline that exists today)

**Vocabulary (schema_version=1, enum-bounded, mirrored in DB CHECKs)** — `web/src/lib/navigationAnalytics.ts:29-38`, `mobile/utils/navigationAnalytics.ts:17-26`, `backend/services/navigationAnalytics/navigationAnalyticsService.js:37-47`, `database/migrations/20260623130000_navigation_analytics_events.sql:47`:
`navigation_surface_opened | navigation_item_impression | navigation_item_selected | navigation_destination_rendered | navigation_destination_blocked | navigation_role_switched | navigation_drawer_opened | navigation_tab_selected | navigation_error`
- Surfaces: `mega_menu|mobile_drawer|bottom_tabs|sidebar|footer|command_palette|route_guard|unknown`; platforms `web|ios|android`; role buckets `anonymous|owner|dealer|mechanic|insurance|government|admin|bank`.
- Payload fields (all that is EVER persisted): `schema_version, event_type, feature_id, node_id, surface, source_route_pattern, destination_route_pattern, platform, role_category, lifecycle_or_reason_code, build_version, occurred_at` (service.js:185-198). Everything else allowlist-DROPPED.
- Privacy minimization: no PII/VIN/raw URL/IP/device id ever stored; routes collapse to registered manifest routes else literal `'unregistered'` (service.js:112-123); `node_id` must be in `shared/navigation/navigation-nodes.json` else null (service.js:145-152); `role_category` derived server-side from trusted session, client role ignored (service.js:286-294); occurred_at clamped to now (service.js:201-208).
- Transport/batching: bounded in-memory queue (cap 100, drop-oldest), 5s timer flush, web flush on `visibilitychange`/`pagehide` (CSRF-token reuse, sendBeacon deliberately NOT used — web client :245-284), mobile flush on AppState background; batch cap 50 events / 32KB body; POST `/api/analytics/navigation` behind csrfMiddleware, always 202, rate-limited 120/min/IP (`backend/routes/navigationAnalyticsRoutes.js:31-50`). Failure = drop, never retry unboundedly (max 2 attempts).
- Dedupe: client per-session impression suppression `surface:node` (web :159-163); server best-effort in-process `dedupe_key` window of 2000 keys + in-batch set (service.js:210-266). NO durable/db-level dedupe.
- Consumers: admin aggregates `GET /api/admin/analytics/navigation` (`getNavigationAggregates`, grouped only, never raw dump) → `web/src/components/admin/NavigationAnalyticsPanel.tsx`. Each ingest also writes a `NAVIGATION_ANALYTICS_BATCH_INGESTED` trust_audit_events row (routes:71).
- **Actual client wiring is far narrower than the taxonomy**: only 4 of 9 types have producers, all web — `navigation_surface_opened` + `navigation_item_selected` (`web/src/components/layout/Navbar.tsx:58,83`, mega_menu only), `navigation_destination_rendered`/`navigation_destination_blocked` (`web/src/components/routing/RegistryRouteBoundary.tsx:69-73`, route_guard). `navigation_item_impression`, `drawer_opened`, `tab_selected`, `role_switched`, `navigation_error` have ZERO call sites. MobileNavDrawer/Footer/DashboardLayout/bottom tabs: not instrumented.
- **Mobile client exists but is DEAD**: `mobile/utils/navigationAnalytics.ts` has zero importers/`trackNav` callers anywhere under `mobile/`.

## 2. referral_events ledger (`referral_events` table; writer: `ReferralEngineService.recordReferralEvent`, `backend/services/referral/referralEngineService.js:379-399`)

Row shape: `tenant_id, event_type, code_id, campaign_id, coupon_id, wallet_transaction_id, subject_type, subject_id, channel, source, session_id, actor_user_id, actor_type, metadata, occurred_at`. Plain append `insert` (`referralEngineRepository.js:48-50`) — **no idempotency at the event level** except the lead-bridge described below.

Event types with live producers (`backend/constants/referral/referralConstants.js:39-52` + vertical constants):
- Core engine: `campaign.created`, `referral.code_created`, `referral.code_validated`, `referral.code_failed`, `referral.qr_scanned`, `referral.barcode_scanned` (scan channels, engineService.js:522-540 via `POST /api/referrals/validate` routes:146-151), `coupon.applied`, `coupon.redeemed`, `wallet.transaction_created`, `wallet.transaction_status_changed`.
- **Declared but NEVER emitted**: `referral.link_opened` (constant only, no producer).
- Local marketplace vertical (`referralLocalMarketplaceService.js`): `local_marketplace.lead_created`, `.lead_qualified`, `.intent_classified`, `.referral_bundle_created`, `.reward_eligibility_created`.
- Import campaign vertical (`referralImportCampaignService.js`): `import_campaign.lead_created`, `.milestone_qualified`, `.capacity_updated`, `.referral_bundle_created`, `.reward_eligibility_created`, `.route_page_created`, `.share_kit_prepared`.
- Marketing/SEO (`referralMarketingSeoService.js`): `ai_marketing.kit_created`, `.asset_drafted`, `.status_changed`, `.analytics_suggestion_created`.
- Trust/review (`referralTrustReviewService.js`): `trust.review_case_created`, `.review_case_decided`, `.risk_check_run`, `.dispute_created`, `.dispute_resolved`, `.wallet_hold_applied`, `.ai_recommendation_stored`, `.benefit_explanation_created`, `.audit_export_created`.
- Channel/agent gateway (`referralChannelGatewayService.js`, `referralAgentGatewayServiceSafe.js`): `channel.inbound_received`, `channel.attribution_attached`, `channel.share_kit_prepared`, `agent.triage_completed`, `agent.support_handoff_opened`, `agent.tool_executed`, `agent.tool_failed`.
- Admin audit sidecar table: `referral_admin_audit_events` (repository.js:12).

**Marketplace→referral bridge** (`backend/services/marketplace/marketplaceReferralBridgeService.js`):
- `emitMarketplaceReferralEvent` (:77-140): types from `backend/services/marketplace/marketplaceEventTypes.js:7-17` — `marketplace_listing_viewed`, `marketplace_inquiry_created`, `marketplace_quote_requested`, `marketplace_inspection_requested`, `marketplace_service_booked`, `marketplace_import_interest_created`, `marketplace_container_space_interest_created`. Best-effort (never throws), no dedupe — a repeated GET writes repeated rows.
  - **Declared but NEVER emitted**: `marketplace_listing_paid`, `marketplace_purchase_confirmed` (no producer anywhere).
- `marketplace_listing_viewed` producer: `backend/routes/marketplaceRoutes.js:104-121` — fires ONLY when `?ref=`/`referral_code`/`campaign_code` present (`referralContextFromReq` :38-47). **Organic detail views emit NOTHING.**
- Inquiry creation (`marketplaceInquiryService.js:264-276`): maps inquiry_type→referral event via `INQUIRY_TYPE_TO_REFERRAL_EVENT` (marketplaceEventTypes.js:55-68); fires for EVERY inquiry (attributed or not).
- Lead bridge `bridgeInquiryToReferralLead` (:163-240): idempotent per (tenant, inquiryId) — one inquiry → at most one `local_marketplace.lead_created`; retries/races return existing lead; server-side attribution only.

## 3. domain_events transactional outbox (`backend/services/eventBus/eventBusService.js`)

Mechanics: `emitDomainEvent(pgClient|supabase, type, payload, tenantId)` inserts `domain_events {event_type,payload,status:'pending',attempts,tenant_id}`; also mirrors to in-process `memoryBroker` EventEmitter. Worker (`eventWorker.js`): poll batch 10 `FOR UPDATE SKIP LOCKED`, MAX_OUTBOX_ATTEMPTS=5 → `dead_letter` (migration `20260621170000_outbox_dead_letter.sql`), success → `processed`; serverless drain via pg_cron→pg_net→`POST /api/internal/events/process` every minute (`20260809120000_events_outbox_pg_cron.sql`, worker-secret + Vault gated). Idempotency: ONLY `marketplace.inquiry.created` is db-idempotent by inquiryId (unique `idx_domain_events_dedupe_key` + `trg_marketplace_inquiry_communication_outbox` AFTER INSERT trigger, `20260811132100_communications_2_reliability_closure.sql:14,89`); all other types are non-idempotent inserts. `memoryBroker` has **zero production `.on()` subscribers** — memory mirror is effectively unconsumed.

Domain event types with live producers:
| event_type | producer |
|---|---|
| `marketplace.inquiry.created` | `marketplaceInquiryService.js:224` + DB trigger |
| `marketplace.inquiry.referral_bridge_requested` | `marketplaceInquiryService.js:247` |
| `marketplace.listing.moderated` | `marketplaceModerationService.js:141` |
| `finance.application.approved` / `.declined` / `.status_changed` | `routes/financeRoutes.js:230-234`, `financeService.js:124` |
| `identity.verification.decided` | `identity/decisionRecorder.js:288` |
| `evidence.review.decided` | `evidence/evidenceReviewNotifier.js:31` |
| `DIASPORA_CONTAINER_CREATED`, `DIASPORA_CONTAINER_{DRAFT\|BOOKING_OPEN\|BOOKING_CLOSED\|LOADING\|SHIPPED\|ARRIVED\|CANCELLED}` | `diasporaContainerService.js:59,90` via `emitDiasporaEvent` |
| `DIASPORA_SHIPMENT_{stage}` | `diasporaShipmentService.js:137` |
| `DIASPORA_CARGO_RESERVATION_REQUESTED` / `_{APPROVED\|REJECTED\|CANCELLED…}` | `diasporaReservationService.js:116,175,205` |

Consumers (`server.js:355-356`): `registerDomainListeners` (`eventBus/listeners.js`) — `marketplace.inquiry.referral_bridge_requested`→referral bridge; legacy `VEHICLE_RESERVED`/`PAYMENT_RECEIVED`/`ESCROW_CREATED` subscribers are audit/log-only compat with **no remaining emitters**. `registerCommunicationListeners` (`communication/communicationEventListeners.js:6-22`) subscribes exactly: `marketplace.inquiry.created`, `marketplace.listing.moderated`, `finance.application.{status_changed,approved,declined}`, `identity.verification.decided`, `evidence.review.decided` → communication orchestrator (notification_queue etc.). DIASPORA_* events have NO subscriber (outbox rows are drained but unhandled → notification value only if a handler existed; none does).

Separate non-ledgered hook: `dispatchAutomationWebhook` (`eventBus/automationWebhookService.js`, disabled by default via `ENABLE_AUTOMATION_WEBHOOKS`) — fire-and-forget HTTP to n8n for `DOCUMENT_OCR_STARTED|DOCUMENT_OCR_EXTRACTED|DOCUMENT_OCR_LOW_CONFIDENCE|DOCUMENT_FLAGGED_FOR_REVIEW|DOCUMENT_VERIFICATION_APPROVED|DOCUMENT_VERIFICATION_REJECTED` (documentIntelligenceService.js) and `VEHICLE_QUARANTINED` (trustEnforcementEngine.js:241). No table.

## 4. Communication events

- **conversation_events** (writer `communicationConversationService.recordAnalytics` :367-390; fail-soft): columns `thread_id,message_id,participant_id,event_type,business_workflow,funnel_stage,acquisition_source,referral_code,campaign_code,attribution,metadata,occurred_at`. Types emitted today: `conversation_started`, `inquiry_created` (conversationService.js:584,594), `message_received` / `stakeholder_first_response` (:649-653, media :263-267, inbound :321-325, workflow :116-120), `campaign_queued` / `campaign_suppressed` / `campaign_conversion` (campaignService.js:349-389), `ai_assisted_response` / `ai_{derivationType}` (intelligenceService.js:65-69). Read by `communicationAnalyticsService.js` (aggregates for owner dashboard). No dedupe.
- **communication_audit_events** (writer `communicationAuditLog.js`, fail-soft, append-only): 26-type vocabulary `inbound_received, webhook_processed, ai_classified, ai_drafted, assigned, reassigned, escalated, reply_sent, internal_note, queue_claimed, delivery_attempt, delivery_receipt, retry_scheduled, cancelled, dead_lettered, resolved, reopened, priority_changed, sla_paused, sla_resumed, identity_linked, preference_changed, consent_changed, marked_read, feedback_received, smoke_test` (:8-36). Actor-typed (`agent|admin|system|worker|ai|customer|platform`), carries thread/message/notification ids + correlation_id.
- **message_delivery_attempts** (writer `communicationDeliveryWorker.js:124-152`): one row per attempt; `status` = `sent|failed`; `request_metadata.idempotency_key = notification.dedupe_key`; provider/provider_message_id recorded for webhook reconciliation. Parent `notification_queue` statuses observed in worker: `queued|processing|sent|retry_scheduled|fallback_queued|cancelled|dead_letter`; queue idempotent via unique `dedupe_key` (notificationService.js:215,398-400). Provider callbacks land in `webhook_logs` (`communicationWebhookService.js:684`) + canonical webhook service.

## 5. Trust / escrow / diaspora audit ledgers

- **trust_audit_events** (writer `backend/services/auditLogger.js#logAuditEvent`, redacts sensitive keys, fail-soft, legacy `organization_audit_logs` mirror FK-safe): literal vocabulary today: `DISPUTE_OPENED, DISPUTE_RESOLVED, EVIDENCE_VERIFIED, EVIDENCE_REJECTED, EVIDENCE_UPLOADED, EVIDENCE_LINKED_TO_EVENT, GOVERNANCE_DECISION_APPLIED, GOVERNED_TRUST_CHANGE, FEATURE_ROLLOUT_CREATED, FEATURE_ROLLOUT_UPDATED, FEATURE_ROLLOUT_RESET, NAVIGATION_ANALYTICS_BATCH_INGESTED, SECURITY_CSRF_VIOLATION, SECURITY_RATE_LIMIT_EXCEEDED, SECURITY_MALWARE_DETECTED, SECURITY_MIME_SPOOFING_DETECTED, SECURITY_MEDIA_UPLOAD_DENIED, SECURITY_DOCUMENT_READ_DENIED, SECURITY_SIGNED_UPLOAD_URL_GENERATED` + dynamic types from identity/trust workflow services. Identity-bearing (actor ids, IP, user agent, VIN). Producers: governance, dispute, evidence, featureGovernance, identity, trustGovernance, securityMiddleware, mediaRouter, navigationAnalyticsRoutes.
- **escrow_trust_events** (append-only): base FSM transitions written server-side by RPC `issue164_transition_session_atomic` (`escrowTrustService.js:189-196`); provider lifecycle appended with `provider:` prefixed from/to statuses over states `funding→inspection→release→payout→reconciliation` + `dispute|refund|cancellation` (`escrowProviderService.js:38-51,114`). Carries actor_id/actor_role/reason/payload.
- **diaspora_import_audit_log** (writer `diasporaAuditService.js:27`, cryptographically sealed rows): actions incl. `CONTAINER_CREATED, CONTAINER_STATUS_CHANGED, SHIPMENT_CREATED, SHIPMENT_STAGE_CHANGED, COMPLIANCE_REVIEW_CREATED, COMPLIANCE_{status}, GOVERNMENT_DOCUMENT_UPSERTED, TRADE_PROFILE_{CREATED|UPDATED|REVIEW_REQUESTED|VERIFIED|SUSPENDED}, PAYMENT_MILESTONE_CREATED, VEHICLE_IMPORT_RECORD_LINKED, TRADE_DOCUMENT_{UPLOADED|OCR_EXTRACTED|VERIFIED|REJECTED}`. Plus `diaspora_shipment_stage_events` (shipmentService.js:97-100).
- **blockchain_events** (hash-chained per VIN, `blockchainService.addEvent` :60+): free-text event types `'Vehicle Reservation Recorded', 'Escrow Ledger Initiated', 'Mechanic Inspection', 'Insurance Insured', 'Financing Application', 'Stolen Vehicle Flagged', 'Stolen Vehicle Cleared'`.

## 6. Other web/mobile instrumentation

**None.** No gtag/PostHog/Mixpanel/Amplitude/Segment/Firebase-analytics/Plausible in `web/src` or `mobile/` (grep hits were "PartSentry" substrings / read-side dashboards). Backend has Sentry error telemetry only (`services/ai/sentry.js`). All web "analytics" components (`NavigationAnalyticsPanel`, owner `Communications.tsx`, `ProviderTelemetryPanel`) are read-side. Client-side emission total = 5 `trackNav` call sites in web (Navbar, RegistryRouteBoundary); mobile emits zero events of any kind.

## EVENT INVENTORY TABLE

| event | ledger table | producer | consumer(s) | idempotency | privacy class | Intelligence suitability |
|---|---|---|---|---|---|---|
| navigation_* (4 live of 9) | navigation_analytics_events | web Navbar/RegistryRouteBoundary → POST /api/analytics/navigation | admin aggregates endpoint + NavigationAnalyticsPanel | best-effort in-process dedupe_key window; client impression suppression | pseudonymous/minimized (no user id, coarse role, allowlisted routes) | **reuse** (pattern + table), but coverage too narrow for marketplace intel |
| marketplace_listing_viewed | referral_events | marketplaceRoutes.js:104 (only if ref/campaign param) | referral dashboards/benchmarks | none — duplicates on every GET | identity-bearing (actor_user_id, session_id) | **project** — referral-conditional, not an impression/view ledger |
| marketplace_inquiry_created / _quote_requested / _inspection_requested / _service_booked / _import_interest_created / _container_space_interest_created | referral_events | marketplaceInquiryService.js:264 (every inquiry) | referral verticals | none | identity-bearing | reuse (funnel bottom), join via subject_id=inquiry id |
| marketplace_listing_paid, marketplace_purchase_confirmed, referral.link_opened | — | **no producer (declared only)** | — | — | — | not-commercial (vocabulary reserved) |
| referral.code_validated/failed/qr_scanned/barcode_scanned, coupon.*, wallet.*, campaign.created | referral_events | referralEngineService | referral admin/benchmarks | none | identity-bearing | project (attribution graph) |
| local_marketplace.lead_created (+vertical events) | referral_events | referralLocalMarketplaceService via bridge | admin qualify→reward flow | idempotent per (tenant, inquiry) | identity-bearing | reuse |
| marketplace.inquiry.created | domain_events | inquiryService + DB trigger | communication orchestrator | db-unique by inquiryId (only idempotent type) | identity-bearing payload | reuse (canonical inquiry fact) |
| marketplace.listing.moderated | domain_events | marketplaceModerationService.js:141 | communication listeners | none | identity-bearing | reuse (listing lifecycle: moderation only) |
| finance.application.* / identity.verification.decided / evidence.review.decided | domain_events | financeRoutes/financeService/decisionRecorder/evidenceReviewNotifier | communication listeners | none | identity-bearing | project |
| DIASPORA_CONTAINER_* / _SHIPMENT_* / _CARGO_RESERVATION_* | domain_events | diaspora services | **none (no subscriber)** | none | identity-bearing | project |
| conversation_started / inquiry_created / message_received / stakeholder_first_response / campaign_* / ai_* | conversation_events | communication services | communicationAnalyticsService aggregates | none | identity-bearing (thread/participant + attribution) | **reuse** (richest funnel ledger that exists) |
| 26 communication audit types | communication_audit_events | communicationAuditLog callers | admin communication routes | none (append audit) | identity-bearing | project (ops SLA intel) |
| delivery attempt (sent/failed) | message_delivery_attempts | communicationDeliveryWorker | webhook reconciliation, admin | parent notification dedupe_key unique | identity-bearing | reuse (delivery reliability) |
| trust audit vocabulary (~19 types + dynamic) | trust_audit_events | auditLogger callers (governance/evidence/security/nav-ingest) | admin/audit reads | none | identity-bearing (IP/UA/actor) | project (compliance-sensitive) |
| escrow FSM + provider:* transitions | escrow_trust_events | RPC + escrowProviderService | getSession reads | FSM-guarded transitions | identity-bearing | project |
| diaspora audit actions | diaspora_import_audit_log (+ shipment_stage_events) | diaspora services | admin reads | sealed append | identity-bearing | project |
| VIN ledger entries | blockchain_events | blockchainService.addEvent callers | vehicle history report | hash-chained | identity-bearing (VIN, signer) | project |
| DOCUMENT_OCR_* / VEHICLE_QUARANTINED webhooks | — (HTTP only, default-disabled) | documentIntelligence / trustEnforcement | external n8n | none | identity-bearing payload | not-commercial |

## MARKETPLACE ACTIONS WITH NO EVENT TODAY (verified absences)

- **Listing impression** (search-results/card render): nothing. `navigation_item_impression` exists in taxonomy but has zero call sites, and is nav-chrome-scoped anyway.
- **Detail view, direct/organic**: `GET /api/marketplace/listings/:id` emits only when referral/campaign param present (marketplaceRoutes.js:107-108). No view ledger, no view counter.
- **Engaged view / dwell**: nothing anywhere.
- **Save/unsave history**: `saved_vehicles` is current-state (user_id, vin) only (`marketplaceSavedService.js:2,19`) — no event, no timestamped history of unsaves.
- **Share**: AI share-copy endpoint exists (`/api/marketplace/ai/share-copy`) but no share event; referral `channel.share_kit_prepared` covers referral kits only.
- **Compare**: `POST /api/marketplace/compare` (routes:99) emits nothing.
- **Search executed / query / filters**: `GET /api/marketplace/listings|parts|services` emit nothing; no search_events table.
- **Zero-result search**: nothing (only a UI comment in `web/src/pages/Landing.tsx:37`).
- **Price change**: no listing price-history events (only an evidence taxonomy label `price_history`, `evidenceTaxonomy.js:91`).
- **Listing lifecycle** (created/published/edited/sold/delisted/expired): only `marketplace.listing.moderated`; no create/publish/sold/delist events.
- **Inquiry-started funnel** (form opened/abandoned before submit): nothing — the first event in the funnel is the completed inquiry row.
- **Recommendation served/clicked**: `/api/marketplace/recommendations` + `recommendationService.js` emit nothing.
- **Mobile: everything** — mobile emits zero events (nav client dead code, no other instrumentation).