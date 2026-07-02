# Navigation Analytics (Milestone F)

Privacy-minimized aggregate navigation analytics across web and native. Measures
discovery and routing **without collecting personal data**.

## Event taxonomy (versioned — `schema_version = 1`)

`navigation_surface_opened`, `navigation_item_impression`, `navigation_item_selected`,
`navigation_destination_rendered`, `navigation_destination_blocked`,
`navigation_role_switched`, `navigation_drawer_opened`, `navigation_tab_selected`,
`navigation_error`.

## Data minimization (hard contract)

Stored columns (`navigation_analytics_events`) — **only** these:
`schema_version, event_type, feature_id, node_id, surface, source_route_pattern,
destination_route_pattern, platform, role_category, lifecycle_or_reason_code,
build_version, occurred_at` (+ `id`, `created_at`).

**Never stored** (rejected by app-layer allowlist projection AND DB CHECK constraints):
names, email, phone, VIN, tokens, free text, raw URLs, IP, device ids, raw tenant ids.

- `feature_id` is kept only if it is a registered manifest feature; otherwise null.
- `source/destination_route_pattern` is sanitized against the
  `shared/navigation/feature-manifest.json` route allowlist; anything unregistered
  becomes the constant `'unregistered'` — a raw URL is never persisted.
- `role_category` is derived from the **trusted server session** (`resolveRequestContext`);
  a client-sent role is ignored (defaults to `anonymous`).

## Backend

- **Table:** `database/migrations/20260623130000_navigation_analytics_events.sql`
  — RLS on, `REVOKE` anon/authenticated, `GRANT service_role` only; indexes on
  `occurred_at, feature_id, event_type, surface, platform`; CHECK enums + bounded
  lengths. **Retention:** raw events retained ~30 days then aggregated/purged
  (rollup job documented, not yet scheduled). **Staging-first; not applied to production.**
- **Ingestion** `POST /api/analytics/navigation` (public, bounded): `rateLimiter` 120/min/IP,
  ≤50 events/batch, ≤32 KB body, `schema_version` pinned, per-event allowlist projection,
  enum validation, route sanitization, optional `dedupe_key`, responds `202` fast, and
  **never throws to the client** — a storage failure does not block navigation. Service:
  `backend/services/navigationAnalytics/navigationAnalyticsService.js`,
  route: `backend/routes/navigationAnalyticsRoutes.js` (registered in `backend/server.js`).
- **Admin aggregates** `GET /api/admin/analytics/navigation` (`authorizeRole(['admin'])`):
  date range + optional feature filter → impressions, selections, destination renders,
  blocked attempts, selection-through rate, platform split, role-category split, top
  surfaces, zero-selection items. Grouped/bounded — never dumps raw events.

## Clients (navigation NEVER waits for analytics)

- **Web** `web/src/lib/navigationAnalytics.ts`: bounded queue (cap 100, drop-oldest),
  5 s timed flush + flush on `visibilitychange`→hidden / `pagehide` via `sendBeacon`
  (fallback `fetch` keepalive), capped retry, per-surface+node impression dedupe,
  SSR-safe, all calls non-throwing. A stable opaque `x-nav-cohort` is sent (no PII).
- **Native** `mobile/utils/navigationAnalytics.ts`: same contract; flush on
  `AppState`→background, network-aware capped retry, purely in-memory (no unbounded
  local storage), canonical `apiUrl('/api/analytics/navigation')`.
- **Admin UI:** `web/src/components/admin/NavigationAnalyticsPanel.tsx` (a tab in the
  governance console) — date range, feature filter, the aggregate metrics, platform/role
  split, top/low discovery, truthful no-data/error states, and **textual table fallbacks**
  for every chart.

## Tests

`backend/tests/navigation-analytics.test.js` (DB-free fake client, 19 cases): only allowed
fields persisted; unknown fields stripped; invalid event_type dropped; oversized batch
handled; rate-limit 429; non-admin aggregate denied; dedupe; storage-failure non-throwing;
route sanitization → `'unregistered'`; role derived from trusted session (spoof ignored).
Web: `web/src/lib/navigationAnalytics.test.ts` (queue bounds/flush/dedupe).

## Staging apply status

Both Milestone F/G migrations are **staging-first** for project `eoyenigwevnxwwhyhaer`.
Application/verification is performed by the release engineer (the staging Supabase project
is administered outside this agent's tooling); see `NAVIGATION_BLUEPRINT_STAGING_PLAN.md`.
**Production is not migrated.**
