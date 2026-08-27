# I1 — Canonical Metric and Event Contract (v1, revision 2)

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Depends on:** `I0_STAKEHOLDER_PROCESS_DATA_AUTHORITY_INVENTORY.md`
**Status:** FROZEN for implementation. Revision 2 incorporates the adversarial verification pass (3 independent reviewers; findings reconciled against live migrations/services). Any later semantic change requires a version bump per §2, never a silent edit.

This contract freezes what CarUp Intelligence measures and what each event/metric *means*, before any ledger schema (I2) or instrumentation (I3) is written.

---

## 1. Governing rules inherited (non-negotiable)

1. **Observation, not authority.** An activity event records that an action occurred; it never manufactures the business state the action concerns. Authorities (I0 §5): `saved_vehicles` (current save state), `marketplace_inquiries` (inquiries/leads), Communications tables (conversations, response, delivery), `vehicles.publication_status` (publication lifecycle), `vehicles.status`/`vehicle_listings.status` (availability/sold), `escrow_trust_sessions` + `vehicle_reservations` (transaction intent/reservation), trust family (Trust), diaspora family (trade).
2. **Unknown remains unknown.** A metric whose read model is unavailable is *unavailable*, never 0. `not_evaluated` never renders as 0/failed/poor.
3. **Server-derived privilege.** Authenticated identity, tenant/organization scope and seller identity are derived server-side. Client-supplied values for these fields are ignored on privileged paths.
4. **No duplicate vocabularies.** The canonical activity ledger (I2: `marketplace_activity_events`) is the single analytical event store for marketplace behaviour. Existing ledgers keep their roles: `referral_events` = referral-engine workflow ledger (projected for attribution only; not trusted until gap G1 is fixed), `conversation_events` = Communications funnel ledger (reused), `navigation_analytics_events` = navigation telemetry (never overloaded with commercial identity). §4.6 defines precedence where names overlap.

## 1a. Precondition gap register (blocking specific metrics, not the programme)

| Gap | Blocks | Resolution owner |
|---|---|---|
| G1 (I0): `POST /api/referrals/events` unauthenticated | certification of every attributed metric | fix at I2 ingestion hardening or owner-directed hotfix |
| G3/G5 (I0): cross-tenant referral reads; government platform-wide analytics | tenant-scoped referral projections; government projections | I5 |
| **G10 (new):** no `paused`/`archived` publication states exist (live enum: `draft, identity_complete, documents_submitted, review_pending, publishable, published` — `20260624140000`); no pause/archive workflow exists | `marketplace_listing_paused` / `_archived` events (reserved, §4.4) | owning marketplace domain must extend its lifecycle first; Intelligence will not invent domain states |
| **G11 (new):** no production settlement state exists — `escrow_trust_sessions` status CHECK terminates at `released_sandbox` / `refunded_sandbox` (verified in `20260626180000`; there is no `settled`). `vehicles.status` is uncontrolled free TEXT with live case drift — staging today holds `Available` 23, `Sold` 8, `Reserved` 3, `available` 3 (queried 2026-08-27) | production certification of `sales@1` | production escrow activation (owner-gated); the `upper()` normalization rule in §4.2 covers the lifecycle leg |
| **G12 (new):** no platform-wide billing/subscription authority exists (only diaspora entitlements) | platform-wide `partner_churn@1` (v1 scoped to diaspora — §7) | future billing phase |
| **G13 (new):** user-erasure semantics for the activity ledger (§5.5) must ship WITH I2, and no retention/purge job exists anywhere today (I0 §5) | I2 exit gate | this lane, I2 |

---

## 2. Versioning policy

- **`schema_version`** (integer, per event): envelope+payload contract version; this contract defines `1`. Additive optional fields don't bump it; meaning/requiredness/enum changes do.
- **`event_version`** (integer, per event type): bumped when one type's trigger/dedupe semantics change. Rollups group by it or map versions explicitly.
- **`calculation_version`** (string, per metric, e.g. `views@1`): bumped on any change to numerator, denominator, window, uniqueness, dedupe, or exclusions. Dashboards display values only with a known calculation_version; mixed-version windows are recomputed or visibly annotated.
- The metric registry (§7) ships in I2 as a code-adjacent constant so tests can assert dashboards ↔ registry ↔ rollup agreement.

---

## 3. Canonical activity event envelope (schema_version 1)

**S** = server-derived (client value ignored), **C** = client-supplied (validated/allowlisted), **O** = optional.

| Field | Src | Contract |
|---|---|---|
| `event_id` | S | UUID |
| `schema_version` | C | must equal a supported version (1) |
| `event_type` / `event_version` | C/S | §4 taxonomy only; unknown types rejected; version stamped server-side |
| `occurred_at_client` | C | raw client timestamp, stored verbatim (null for server-emitted events) |
| `occurred_at` | S | effective time. Client-emitted: `occurred_at_client` clamped to `[received_at − 24h, received_at]`. Server-emitted: the domain-write/serve time (= `received_at`; never flagged). |
| `received_at` | S | server clock |
| `actor_scope` | S | `anonymous` \| `authenticated` \| `system` |
| `pseudonymous_session_key` | C | opaque device/profile key (§5.1). Required on user-originated events; server-emitted events copy it from the triggering request when present |
| `authenticated_user_id` | S | from session; null when anonymous. **Internal-only** (plan §29's `_internal` intent): never exposed in any external projection |
| `tenant_id` / `organization_id` | S | **internal-only.** Derived from the event's *object*: listing-anchored events → the listing's owning tenant/org; searches & zero-result searches → null (platform scope); `marketplace_compare_viewed` → null on the event (rollups fan out per compared listing); process steps → the bound listing's tenant, else null. Never from actor headers |
| `listing_id` / `vehicle_reference` | C | validated to exist; events on unknown objects rejected |
| `object_type` / `object_id` | C/S | non-listing objects (search, compare set, inquiry, reservation) |
| `source_surface` | C | enum: `marketplace_list` \| `marketplace_detail` \| `marketplace_compare` \| `dashboard` \| `saved` \| `search` \| `external_link` \| `communications` \| `other` |
| `source_platform` | S | `web` \| `ios` \| `android` \| `server` |
| `source_channel` | C/S | inquiry-style channel where applicable |
| `campaign_code` / `referral_code` | C | format-validated; existence-checked before any attributed rollup counts them |
| `page_view_id` | C | opaque UUID per rendered page/screen instance; **rotates on every SPA route transition / native screen focus** (mandatory) |
| `event_nonce` | C | client-minted UUID per user action, for client-emitted action events (§4.1 keys); protects transport retries |
| `idempotency_key` | S | computed per event type (§4); DB-unique (insert-ignore; duplicates counted in observability) |
| `privacy_class` | S | §6, stamped from taxonomy |
| `exclusion_flags` | S | §5.3/§5.4 flag set; stored, never silently dropped |
| `metadata` | C | per-type allowlisted keys only (plan §29 `metadata_allowlist`); everything else dropped |

Envelope deltas vs plan §29, declared: `authenticated_user_id_internal`/`tenant_id_internal`/`organization_id_internal` are carried as `authenticated_user_id`/`tenant_id`/`organization_id` with the internal-only rule stated inline; `metadata_allowlist` is enforced as the `metadata` allowlist; `occurred_at_client`, `page_view_id`, `event_nonce`, `exclusion_flags` are additive.

Regional dimensions (plan Part XV): `country`, `region`, `currency`, `source_market`, `destination_market` ride in allowlisted metadata where the emitting flow knows them, defaulting from platform configuration — never hardcoded into event names or rollup logic.

---

## 4. Event taxonomy v1

Each table has an explicit **Emitter** column (verification finding: section-level emitter claims were wrong for individual rows).

### 4.1 Discovery & engagement

| event_type | Emitter | Trigger (deterministic) | Idempotency key (server-computed) |
|---|---|---|---|
| `marketplace_search_performed` | **server** (list API handler) | search/filter request executed; payload: normalized filter set, result_count, **and the LO1 snapshot inputs (§7 lost_opportunity): per-filter eligibility of near-miss listings captured in the same request** | hash(session_key, normalized_query, page_view_id) |
| `marketplace_search_zero_results` | **server** (same handler) | result_count = 0 | same + `:zero` |
| `marketplace_listing_impression` | client (batched) | listing card ≥50% visible for ≥1s on a result/discovery surface (IntersectionObserver web; viewability callback native) | hash(session_key, listing_id, source_surface, page_view_id) |
| `marketplace_listing_opened` | **server** (detail GET handler) | listing detail served — organic and attributed alike (closes I0's organic-view hole). **Client context contract:** clients send `x-carup-session-key` + `x-carup-page-view`; when both absent (crawler/curl/API consumer/SSR without context) **no event is emitted** and an `opened_without_context` observability counter increments — an honest, bounded undercount. Prefetch suppression: `Sec-Purpose`/`Purpose: prefetch` or explicit `x-carup-prefetch: 1`. A retry under the same page_view_id dedupes; a client that re-navigates with a new page_view_id counts as a new view (accepted, documented) | hash(session_key, listing_id, page_view_id) |
| `marketplace_listing_engaged` | client | within one opened detail: dwell ≥10s tab-visible, OR gallery interaction, OR spec-section expand, OR any §4.1/§4.2 action on that listing. ≤1 per open | opened-event key + `:engaged` |
| `marketplace_inquiry_started` | client | inquiry form/flow opened | hash(session_key, listing_id, page_view_id) |
| `marketplace_compare_added` / `_removed` | client | compare-set membership change | hash(session_key, listing_id, action, event_nonce) — nonce protects transport retries; client-emitted class is best-effort by declaration |
| `marketplace_compare_viewed` | client | compare surface rendered with ≥2 listings | hash(session_key, sorted_listing_ids, page_view_id) |
| `marketplace_contact_clicked` | client | contact affordance activated (pre-form) | hash(session_key, listing_id, page_view_id, affordance) |
| `marketplace_listing_shared` | client | share completed where detectable (`navigator.share` resolved / share sheet success), else affordance activation; payload `share_resolution: confirmed\|initiated` — never conflated in metrics | hash(session_key, listing_id, page_view_id, channel) |

### 4.2 Authoritative-action observations — all **server-emitted in the same request as the domain write**. The write is authority; if the event insert fails the domain write still succeeds. **Reconciliation sweep is scoped to events whose authority retains a row** (saved, inquiry, reservation, lifecycle-current-state); delete-shaped and transition-shaped events without a surviving anchor (`_unsaved`, historical transitions) are explicitly excluded from backfill — a missed one stays missed and is visible only in the duplicate/loss observability counters.

| event_type | Authority anchoring | Idempotency key |
|---|---|---|
| `marketplace_listing_saved` | `saved_vehicles` insert (no-op re-save emits nothing — service already short-circuits, `marketplaceSavedService.js`) | hash(user_id, vin, 'saved', saved_row.created_at) |
| `marketplace_listing_unsaved` | `saved_vehicles` delete. I3 changes `unsaveListing` to a **delete-returning** call (`.delete().select()`) — today it deletes blind (`marketplaceSavedService.js`), which yields no key material; with the returned row a retried delete returns no row → no-op → no event | hash(user_id, vin, 'unsaved', deleted_row.created_at) |
| `marketplace_inquiry_created` | `marketplace_inquiries` row | inquiry_id |
| `marketplace_inspection_requested` | inspection-type inquiry / inspection workflow start | inquiry/workflow id |
| `marketplace_reservation_started` | `escrow_trust_sessions` intent created | session id |
| `marketplace_reservation_completed` | `vehicle_reservations` **active row established**. Naming note: this marks reservation *establishment*, NOT the table's own terminal `completed` status (`active\|expired\|cancelled\|completed`, `20260819110000`); terminal transitions get the reserved name `marketplace_reservation_closed` (§4.4) | reservation id |
| `marketplace_price_changed` | vehicle price/currency update **committed with an actual value change** (a retry finds old == new → no-op → no event); payload old/new price+currency | hash(vin, old_price, old_currency, new_price, new_currency, post-commit vehicles.updated_at) |
| `marketplace_listing_created` | vehicle/listing row created (initial `publication_status = 'draft'`) | hash(vin, 'created', row created_at) |
| `marketplace_listing_submitted` | `publication_status` transition **into `review_pending`** (= submitted for publication review; `documents_submitted` entry is observable via §4.3 process steps, not this event) | hash(vin, from, to, post-commit updated_at) |
| `marketplace_listing_published` | `publication_status` transition into `published` | hash(vin, from, to, post-commit updated_at) |
| `marketplace_listing_sold` | **`upper()`-normalized** transition of `vehicles.status` → `SOLD` or `vehicle_listings.status` → `SOLD` (live writes are case-inconsistent — G11); one event per VIN per underlying transition | hash(vin, 'sold', post-commit updated_at) |

Transition events emit only on actual committed transitions; since each commit stamps a distinct `updated_at`, the key is unique per real occurrence and stable across request retries (retry → no state change → no event).

### 4.3 Process-step telemetry (client-emitted funnels)

`process_step_recorded` with allowlisted `process` (`listing_creation`, `inquiry_form`, `reservation_flow`, + registered futures), `step`, `outcome` (`started|completed|abandoned|failed|resumed`), `elapsed_ms`, `validation_error_code` (enum). Idempotency: hash(session_key, process, step, outcome, page_view_id).

### 4.4 Reserved names (not emitted; do not redefine)

`marketplace_listing_paused`, `marketplace_listing_archived` (**gated on G10** — the domain has no such states), `marketplace_reservation_closed`, `marketplace_listing_paid`, `marketplace_purchase_confirmed` (already reserved in `marketplaceEventTypes.js`), `marketplace_recommendation_served/_clicked`, `referral.link_opened`, vertical taxonomies (parts/insurance/finance/diaspora) added by their phases under this envelope and versioning.

### 4.5 Reused external ledgers (never re-emitted)

Response time / conversation funnel / delivery → Communications (`message_threads`, `conversation_events`; authority). Referral workflow → `referral_events`. Navigation → `navigation_analytics_events`. Rollups may join them; Intelligence never writes them.

### 4.6 Name-collision precedence

`marketplace_inquiry_created` / `marketplace_inspection_requested` also exist as `referral_events` bridge copies — for analytics the canonical activity ledger is authoritative; bridge copies are referral-engine internals. The legacy referral-conditional `marketplace_listing_viewed` is **superseded by `marketplace_listing_opened`** and never counted as views.

---

## 5. Identity, sessions, uniqueness, exclusions

### 5.1 Session key
`pseudonymous_session_key` (short: **session_key**) = client-minted opaque UUID per device/browser profile, stored locally, rotated on privacy reset/logout. Not derived from any identifier. Distinct concept from the *activity session* below.

### 5.2 Actor key, link key, activity session
- `actor_key := authenticated_user_id` if present else session_key. **Unique-reach metrics** count `DISTINCT actor_key`.
- **`link_key := session_key`** on every user-originated event (server-emitted §4.2 events copy it from the triggering request). **Funnel/conversion metrics stage-link and count on `link_key`**, which survives the anonymous→authenticated boundary within a device (verification finding F4: actor_key switches at login and would zero out browse-anonymously-then-sign-up conversions). Cross-device same-user journeys therefore undercount conversions — a declared limitation of `@1` versions, revisited only via a calculation_version bump.
- No retroactive identity merge in v1 (an event's keys never change after write).
- *Activity session* = activity of one link_key with gaps < 30 min (used for session-windowed metrics only).

### 5.3 Exclusion flags and the rollup exclusion set
Flags stamped at ingest: `self_traffic` (actor is the listing's owner or a member of its owning tenant), `staff` (platform admin/internal accounts, server-maintained list), `fixture` (reuse `getFixtureExclusion` in `backend/services/marketplace/marketplaceClassificationRules.js` — synthetic/integration VIN rules; I0 G9 demo rows never enter rollups), `bot_suspect` (known bot UAs + versioned heuristics), `synthetic` (declared by controlled UAT scripts; accepted only with the worker secret or in non-production).

**Exclusion semantics, explicit:** business rollups exclude `staff`, `fixture`, `bot_suspect`, and (in production) `synthetic`. `self_traffic` is additionally excluded from seller/dealer-facing counts and all benchmarks, but retained in internal diagnostics. `clock_skew_adjusted` (§5.4) excludes nothing. `late_beyond_window` is excluded from certified windows only. Certification runs (I19) count `synthetic` deliberately.

### 5.4 Time discipline & duplicates
- Client-emitted events store `occurred_at_client` raw; effective `occurred_at` clamps small skews into `[received_at − 24h, received_at]`, flagging `clock_skew_adjusted` (informational only, included everywhere).
- An event whose client timestamp is older than 24h is stored with `occurred_at = received_at − 24h` **plus flag `late_beyond_window`** — the raw column preserves true lateness; such events are excluded from certified windows and from any already-certified rollup period.
- Duplicates: DB-unique idempotency_key, insert-ignore, duplicate counter observable (plan §110). Rollup watermark re-runs (I4) absorb in-window late arrivals.

### 5.5 Retention & erasure (G13 — ships WITH I2, not after)
- Raw activity events: retained 24 months, then purged after the covering certified rollups exist; the purge job is part of the I2 deliverable (I0 found zero purge jobs exist platform-wide — this programme does not repeat that omission).
- Erasure: on user deletion/erasure request, `authenticated_user_id` on that user's events is tombstoned (nulled with an `erased` marker) within 30 days; session keys minted by their devices are unlinked; **aggregated rollups are unaffected** (aggregate exemption, documented in the privacy register).
- Aggregates/rollups: retained indefinitely; they carry no direct identifiers.

---

## 6. Privacy classes, audiences, benchmark transparency

| Class | Meaning | Examples | Audiences |
|---|---|---|---|
| P1 pseudonymous-behavioural | session-key-only or aggregated | impressions, searches, opens, engaged | aggregates: seller/dealer (own objects), scoped admin; never row-level to sellers |
| P2 authenticated-personal | user-attributable behaviour | saves, compares by logged-in buyer | the user (own history); sellers see aggregates only |
| P3 declared-lead/workflow | user deliberately identified into a workflow | inquiry, reservation, conversation | workflow counterparty, tenant-scoped (as `marketplace_inquiries` models) |
| P4 regulated/institutional | government/finance/insurance workflow data | provider outcomes, compliance states | purpose-limited, audited (I5); government is not a super-admin (G5) |

A **metric's** privacy class = the highest class among its inputs (each §7 row states it). **Benchmark transparency (plan §49):** every benchmark output must surface its cohort size and a methodology reference; minimum cohort of 8 comparable listings, below which the surface renders `insufficient_data` — never a fabricated percentile.

---

## 7. Metric registry v1

Defaults unless a row overrides: source = `marketplace_activity_events` via I4 daily rollups; **unit = count**; dedupe = event idempotency (§4); exclusions = §5.3 set as defined there; windows = 7/30/90-day UTC (Africa/Harare display mapping in I4); grain = per listing, with seller/tenant/platform rollups; audiences: seller/dealer see own-object aggregates, admin sees scoped aggregates (I5).

**Conversion-metric composition rule (uniform):** conversion metrics are defined at listing grain: numerator = distinct link_keys with the earlier AND later stage **on the same listing** in-window; denominator = distinct link_keys with the earlier stage on that listing. Seller/tenant/platform level: numerator = distinct link_keys with a same-listing stage pair on **any** listing in the scope (an actor counts once); denominator = distinct link_keys with the earlier stage on any listing in the scope.

| Metric | calc_version | Definition · numerator/denominator | Uniqueness/dedupe | Privacy → audience | Notes |
|---|---|---|---|---|---|
| Impressions | `impressions@1` | accepted impression events · count | event key; not unique-actor | P1 → seller agg, admin | |
| Unique reach | `unique_reach@1` | distinct actors with ≥1 impression in scope · distinct actor_key | §5.2 actor_key | P1 → seller agg | |
| Views | `views@1` | accepted `marketplace_listing_opened` · count | per (session_key, listing, page_view) | P1 → seller agg | no prior *certified* view metric existed; the legacy referral-conditional event is superseded (§4.6) and never counted |
| Unique viewers | `unique_viewers@1` | distinct actors with ≥1 open · distinct actor_key | §5.2 | P1 → seller agg | |
| Engaged views | `engaged_views@1` | accepted engaged events · count | ≤1 per open | P1 → seller agg | |
| Engagement rate | `engagement_rate@1` | engaged/views | ratio | P1 | shown only when views ≥ 20 in window |
| Impression→view rate | `conv_impression_view@1` | composition rule over (impression, open) | link_key | P1 | plan §31 funnel stage, restored per verification |
| Saves (activity) | `saves@1` | `_saved` state-change events · count | one per actual state change | P2 → seller agg | history; current state remains `saved_vehicles` |
| Unsaves | `unsaves@1` | `_unsaved` events · count | same | P2 → seller agg | backfill-excluded class (§4.2): certified only from ledger inception |
| Net watchlist | `net_watchlist@1` | live `saved_vehicles` count, snapshotted daily by I4 | n/a (authority read) | P2 → seller agg | unit: listings-saved; snapshot is the baseline for watchlist_churn |
| Shares | `shares@1` | share events by `share_resolution` · counts | per (session_key, listing, page_view, channel) | P1 → seller agg | confirmed vs initiated never summed silently |
| Compare adds | `compare_adds@1` | compare_added · count | per action nonce | P1 | best-effort class, labeled as such in internal docs |
| Leads/Inquiries | `inquiries@1` | `marketplace_inquiries` rows in window **excluding status `spam` and `rejected`** (reported separately) · count | inquiry id | P3 → seller (own), admin | authority count IS the displayed number; unit: inquiries |
| Inquiry starts | `inquiry_starts@1` | `marketplace_inquiry_started` · count | per (session_key, listing, page_view) | P1 | funnel-only; never labeled "inquiries" |
| Inspections | `inspections@1` | inspection-type inquiries / workflow starts (authority) · count | id | P3 | |
| Reservations | `reservations@1` | active `vehicle_reservations` established in window (authority) · count | reservation id | P3 | starts (intents) reported separately |
| Transactions/Sales | `sales@1` | **distinct VINs** in window with (a) `escrow_trust_sessions` terminal release (today only `released_sandbox` exists — G11; `refunded_*` is NOT a sale) OR (b) `marketplace_listing_sold` transition. **Dedupe: one sale per VIN per window; escrow release takes precedence over the lifecycle leg** | VIN | P3 → seller (own), admin | production certification gated on G11; never inferred from disappearing inventory |
| Conversion family | `conv_view_save@1`, `conv_view_inquiry@1`, `conv_save_inquiry@1`, `conv_inquiry_inspection@1`, `conv_inquiry_reservation@1` | composition rule above | link_key | max(P-classes of stages) → seller agg | denominators ≥ 20 else `insufficient_data`. Declared deviation from plan §31: the FINANCE/INSURANCE stage has no events yet (reserved for I10/I11); `conv_inquiry_reservation` spans it until then |
| Response time | `response_time@1` | seller first-response latency from **`message_threads.first_response_at`** (Communications-stamped; semantics: first *human* outbound of the current SLA cycle — AI replies excluded; **reset on thread reopen**) · avg/median/p95 | thread | P3 → seller (own), admin | unit: minutes. Communications remains sole writer; I4 aggregates over the column with 7/30/90 windows (the existing per-user endpoint cannot serve windows — I0 §2) |
| Listing Completeness | `completeness@LC1` | deterministic explainable score over **groups 1–10** (vehicle identity, seller profile, pricing, specifications, location, description, exterior media, interior media, evidence coverage, service/history) · earned points / applicable points. Groups 11 (trust-evaluation state) and 12 (transaction readiness) are **displayed alongside, never inside the score** | n/a | P1 → seller (own) | unit: percent. NOT a Trust score. Field weights fixed in I6 under LC1 |
| Lost Opportunity | `lost_opportunity@LO1` | searches in window whose LO1 snapshot (§4.1) shows the listing matched all *present*-field criteria but was excluded solely by missing field(s) · count | per search event | P1 → seller (own) | phrased exactly "could not be confidently matched" (plan §34) |
| Price response | `price_response@1` | Δ in views/saves/inquiries rate between equal-length windows before/after a price change · per-metric rates | — | P1/P3 → seller (own) | changes < 7 days apart, or before-windows predating ledger inception → `insufficient_data`; strong/moderate/weak bands always shown with the underlying numbers; no intent claims |
| Active user | `active_user@1` | actor with ≥1 qualified action in window: `marketplace_search_performed`, `_listing_opened`, `_listing_saved`, `_inquiry_created`, `_reservation_started`, `_listing_created/_published`, `_price_changed`, or a Communications message **sent by** the actor · distinct actor_key | §5.2 | P1 → admin | every qualified action is an observable event (verification: "listing edit" removed — unobservable) |
| Retention | `retention@1` | cohort (first-seen week/month) actors active again in the following window · returning/cohort | actor_key | P1 → admin | |
| Attribution | `attribution_first_touch@1`, `attribution_last_nondirect@1` | **all** validated touches (ref/campaign/UTM) are persisted per link_key with 30-day TTL; at login the user_id is forward-linked to the device's touch history (no retro merge). `first_touch` reports the earliest touch; `last_nondirect` credits the latest non-direct touch ≤30 days pre-conversion and is the default model for partner ROI reports; every report labels its model | per conversion | P1/P3 → admin, partner-scoped | **gated on G1**; two named models replace rev-1's incoherent single definition |

### Churn family

| Metric | calc_version | Definition (cohort · window · denominator) |
|---|---|---|
| Listing interest decay | `interest_decay@1` | (views+saves+inquiries rate this 7-day window) vs prior window per listing; "cooling" = ≥40% drop with prior-window events ≥ 20 |
| Watchlist churn | `watchlist_churn@1` | unsaves in window / (net_watchlist **daily snapshot at window start** + new saves in window) — snapshot-based baseline per verification F12; certified only for windows fully post-ledger-inception |
| Lead abandonment | `lead_abandonment@1` | inquiries created in window still `new` after 14 days / inquiries created (spam/rejected excluded) |
| Funnel abandonment | `funnel_abandonment@1` | per stage pair: 1 − conversion (same denominators) |
| Partner/subscription churn | `partner_churn@1` | **v1 scope: diaspora subscriptions only** (`diaspora_subscriptions` authority): tenants active at window start that cancel/lapse in window / actives at start. Platform-wide version gated on G12 |
| User churn | `user_churn@1` | actors active in prior 30-day window with zero qualified actions in current window / prior actives |
| Partner inactivity | `partner_inactivity@1` | active organizations with zero publish/respond/process actions in 30 days / active organizations |

---

## 8. Data-availability states (uniform display contract)

Every KPI surface renders exactly one of: `value` (with calculation_version + window), `insufficient_data` (below minimum denominators/cohorts, or guards like price-response spacing), `unavailable` (read model failed/absent — **never 0**), `not_applicable`. Required acceptance criterion for every Intelligence surface from I4 onward; remedy for I0 §3's systemic fake-zero defect.

---

## 9. I1 gate statement

Every plan-§88 metric is defined with definition, source, authority, numerator/denominator, window, uniqueness, dedupe, exclusions, unit, privacy class, audiences, and calculation version. The taxonomy covers plan §30 in full, with two events moved to reserved under G10 (domain states absent) rather than anchored to fiction. All known preconditions are registered in §1a — nothing is deferred silently. An adversarial verification pass (3 lenses) ran before freezing; every BLOCKER/MAJOR finding is resolved in this revision.

**I1 is frozen. The programme continues into I2 (first-party activity ledger).**
