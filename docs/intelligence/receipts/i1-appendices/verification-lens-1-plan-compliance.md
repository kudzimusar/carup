ADVERSARIAL REVIEW — I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md (verified against plan @0ea51b58 and live schema/code)

**BLOCKER — §4.2 lifecycle events anchored to publication states that do not exist.**
`marketplace_listing_paused` / `_archived` / `_sold` are anchored to "`vehicles.publication_status` transitions (and sold state)". Live enum (20260624140000_listing_publication_lifecycle.sql) is exactly `draft, identity_complete, documents_submitted, review_pending, publishable, published` — no paused, archived, or sold state exists anywhere on `vehicles` (repo-wide grep confirms). A frozen contract tells I2/I3 to emit on transitions the domain cannot produce; extending the enum is a domain change outside the observation-only boundary (§1.1). Fix: register this as a precondition gap (like G1/G3/G5) — "requires publication lifecycle extension by the owning domain" — and mark the three events reserved-until-then; do not present them as anchorable today.

**MAJOR — §7 sales@1 cites a nonexistent escrow state, and reality is sandbox-only.**
"`escrow_trust_sessions` settled" — the live CHECK constraint (20260626180000) has no `settled`; terminal money states are `released_sandbox` / `refunded_sandbox` (all monetary states are sandbox-suffixed; no production settlement state exists). Combined with the missing `_sold` transition above, **neither leg of sales@1 is computable from live reality**. Fix: name the actual status, note the sandbox-only reality, and gate `sales@1` certification on production escrow the same way attribution is gated on G1.

**MAJOR — §7 sales@1 has two authorities and no cross-source dedupe.**
A vehicle sold via escrow will also (once the state exists) transition to sold — both legs count, doubling sales. Uniqueness "session/vin id" doesn't deduplicate across sources. Plan §85 requires a dedupe rule per KPI. Fix: "one sale per vin per window; escrow-settled takes precedence over lifecycle transition."

**MAJOR — §9 gate overstates the registry: no per-metric privacy class or audiences.**
The gate claims all metrics carry "privacy class, audiences", but the §7 table has no such columns and the "audiences follow §6" default cannot resolve them: §6 classifies *events*, and several metrics span classes (conversions cross P1 opens/P2 saves/P3 inquiries; lost_opportunity joins P1 searches into a seller-facing insight; attribution, response_time unclassified). I5 (authorization projections) will have to invent these. Fix: add privacy-class and audience columns per metric row. Same fix should note plan §85 also requires `unit` and a per-metric dedupe rule, neither stated (dedupe matters exactly where the idempotency default doesn't apply: sales, net_watchlist, inquiries).

**MAJOR — §3 vs §5.4 contradiction on `time_adjusted`.**
§3 lists `time_adjusted` inside `exclusion_flags` with "events are stored with flags, excluded at rollup"; §5.4 says clamped late events are "accepted within 24h clamp window and included in rollups". §5.3 (cross-referenced from §3 for the flag) never defines `time_adjusted` at all. Under one reading every clock-skewed mobile device silently vanishes from KPIs. Fix: declare `time_adjusted` informational-only (not a rollup exclusion) or move it out of `exclusion_flags`.

**MAJOR — §7 attribution@1 is internally uncomputable as written.**
"First-touch capture … persisted per actor for 30 days; conversion credit = last non-direct touch within 30 days pre-conversion." If only the first touch is persisted, the last non-direct touch is unknowable. Fix: either persist *all* touches for 30 days and credit last-non-direct, or credit the persisted first touch — pick one and say which.

**MAJOR — retention/erasure absent and not registered as a gap.**
Plan §82 requires "retention" and "deletion/erasure compliance" among data-quality controls. The contract freezes an envelope carrying `authenticated_user_id` and P2/P3 personal classes with zero retention or erasure semantics (what happens to a deleted user's events?), and — unlike G1/G3/G5 — the omission is silent, so §9's "registered, not deferred silently" claim is false for this control. Fix: add a retention/erasure clause or register it as an explicit I2 precondition.

**MINOR — §4.1/§4.2 emitter headers contradict their rows.**
§4.2's header says "server-emitted in the same request as the domain write", but `marketplace_inquiry_started` is client-emitted with no domain write (belongs in §4.1); §4.1's header says "client-emitted", but `marketplace_search_zero_results` is "server-emitted alongside" and `marketplace_search_performed`'s trigger is a server-side list call. Fix: per-event emitter column instead of section-level claims.

**MINOR — undefined sequence tokens in idempotency keys.**
`action_seq` (§4.1 compare), `state_change_seq` (§4.2 saved), `transition_seq` (§4.2 lifecycle) are never defined — I2 cannot compute a "DB-unique server-computed key" from an unspecified input. Fix: define each (e.g. authority-row id or authority `updated_at`).

**MINOR — §7 inquiries@1 counts spam as leads.**
Live `marketplace_inquiries` statuses include `spam` and `rejected` (marketplaceEventTypes.js); "rows in window, by type/status" doesn't exclude them, so a seller's headline "Leads" includes spam — against §82's exclusion spirit. Fix: state status exclusions for the headline count.

**MINOR — undocumented funnel deviation from plan §31.**
Plan's marketplace funnel has IMPRESSION→DETAIL VIEW and a FINANCE/INSURANCE stage between inspection and reservation. The conversion family has no impression→view metric and no finance/insurance stage (no event either — only reserved verticals), and `conv_inquiry_reservation` skips the stage. Deviation may be right, but the contract must declare it explicitly.

**MINOR — §7 active_user@1 counts an unobservable action.**
"listing edit" is a qualified action, but the taxonomy has no listing-edit event (only lifecycle transitions and `marketplace_price_changed`; `process_step_recorded` covers creation, not edits). Fix: drop it or add the event.

**MINOR — completeness@LC1 "12-group score" arithmetic is ambiguous.**
Two of the 12 named groups are excluded from the score (trust state "never inside the score", transaction readiness "(separate)"), yet the metric is called a 12-group score with "earned group points / total applicable". Plan §33 only mandates trust displayed separately. Fix: state explicitly which N groups sum into the percentage before I6 fixes weights under LC1.

**MINOR — undocumented envelope deltas vs plan §29.**
Plan fields `authenticated_user_id_internal` / `tenant_id_internal` / `organization_id_internal` / `metadata_allowlist` are renamed without noting the delta; the `_internal` marker encodes "never exposed externally", an intent the contract should preserve in words, not drop with the suffix. (page_view_id / exclusion_flags additions are fine as additive.)

**MINOR — benchmark transparency requirement dropped.**
Plan §49: "Benchmark methodology and cohort size must be transparent enough to avoid misleading users." §6 sets only the min-cohort-8 floor; nothing requires surfacing methodology/cohort size on benchmark outputs. Fix: add it to the §6 benchmark clause (it is a metric-contract display rule like §8, not an I4 detail).

**MINOR — `marketplace_reservation_completed` name collides with live status semantics.**
It fires on `vehicle_reservations` *active*-row creation, but the live enum (20260819110000) has a distinct `completed` status meaning the reservation ran to term. Fix: note the event marks reservation *establishment*, not status `completed` — or re-anchor `_started`/`_completed` to intent-creation / active-row respectively and name the terminal transition separately.

**MINOR — §3 tenant derivation undefined for objectless events.**
`tenant_id`/`organization_id` "derived from the object (listing's owning tenant)" — searches, zero-result searches, and cross-tenant compare views have no single owning tenant. Fix: declare these fields nullable with a stated null rule.

Verified-clean (no finding): §88 metric list fully covered; §30's 24 events all present; churn family matches Part XXII with cohort/window/denominator; G1 claim matches live unauthenticated `referralRoutes.js:155`; `saved_vehicles(user_id, vin)` matches; `first_response_at` exists; fixture rules exist (`marketplaceClassificationRules.getFixtureExclusion`); "could not be confidently matched" matches plan §34 verbatim; reserved names exist in `marketplaceEventTypes.js` and are not ledger-emitted.