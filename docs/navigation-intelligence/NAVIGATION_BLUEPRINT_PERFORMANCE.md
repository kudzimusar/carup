# Navigation Intelligence Blueprint — Performance Impact

Measured with `npm run build --workspace=web` (Vite production build) on the same machine, before vs after the Blueprint.

## Bundle size

| Artifact | Baseline (main `c25b094`) | After Blueprint | Δ raw | Δ gzip |
|---|---|---|---|---|
| Main JS (`dist/assets/index-*.js`) | 2,033.89 kB (gzip 536.49) | 2,079.38 kB (gzip 548.46) | **+45.5 kB** | **+11.97 kB** |
| CSS (`dist/assets/index-*.css`) | 189.96 kB (gzip 32.06) | 190.85 kB (gzip 32.17) | +0.89 kB | +0.11 kB |

**Δ ≈ +12 kB gzip on the main bundle (~2.2%).** Sources: the navigation manifest data, lifecycle/route-boundary modules, the centralized icon resolver, the Radix Sheet-based mobile drawer, and the admin governance console (dialogs/alert-dialog/select). The console is only used by admins but is currently in the main chunk.

### Mitigation (documented, not blocking)
- The Vite "chunk > 500 kB" warning pre-existed on `main` and is unchanged in character. The single largest follow-up win is **code-splitting the admin dashboard** (incl. the governance console) behind `React.lazy`, which would move ~console-sized weight out of the public main bundle. Tracked as a follow-up; not required by this Blueprint.
- The navigation manifest is plain data (tree-shsafe) and adds no runtime cost beyond array filtering in selectors (pure, O(n) over ≤ ~90 nodes per surface).

## Runtime / network

- **No blocking governance request before first paint.** `FeatureGovernanceLoader` renders static defaults immediately and hydrates `GET /api/features/effective` in a non-blocking `useEffect`; a failed/slow fetch leaves static defaults intact (no spinner-gating of public navigation).
- **Number of blocking requests before public nav render: 0** added by this Blueprint. Marketplace coverage (`/api/marketplace/nav-coverage`) was already fetched non-blocking by the Navbar and is unchanged.
- **Governance API latency / cache:** the backend service uses a short bounded per-environment cache (30 s TTL) invalidated on mutation; reads are a single indexed Supabase query (`feature_rollout_overrides` has indexes on `feature_id`, `environment`, `updated_at`). `/api/features/effective` returns the sanitized projection only.
- **Navigation render cost:** selectors are pure and side-effect free; resolving a mega-menu is a filter + sort over the manifest subset for that surface.

## Notes
- Bundle figures are deterministic per build input; hashes in filenames vary per build and are not significant.
- Staging Lighthouse / Web Vitals are part of the staging smoke (M8.5) and are **pending the PO-approved staging deploy**.

---

## Milestone D — Lazy-load the Admin Feature Governance Console

Delivers the mitigation flagged above: the admin-only Feature Governance Console is now route-level **`React.lazy`** code-split, so it ships as its own on-demand chunk instead of bloating the public main bundle. Authorization is unchanged — the `<DashboardLayout role="admin">` guard still runs and only renders `<Outlet/>` (the lazy element) after the auth/role gate passes (guard → `LazyRouteBoundary` → `Suspense` → lazy console).

### Bundle size (BEFORE = this branch pre-split, AFTER = lazy-split)

Measured with `npm run build --workspace=web` (Vite 7 production build) on the same machine.

| Artifact | BEFORE (eager) | AFTER (lazy) | Δ |
|---|---|---|---|
| Main entry JS (`dist/assets/index-*.js`) | 2,083.29 kB (gzip 549.13) | 2,065.14 kB (gzip 544.35) | **−18.15 kB raw / −4.78 kB gzip** |
| Console chunk (`dist/assets/FeatureGovernanceConsole-*.js`) | — (inside entry) | 21.78 kB (gzip 6.38) | new separate chunk |
| Total JS chunks | 1 | 2 | console now on-demand |

The console marker (`data-testid="feature-governance-console"`) is verified present **only** in the console chunk and **absent** from the entry chunk. Non-admins never fetch the console chunk.

### Build warnings
- The pre-existing Vite "chunk > 500 kB" warning still appears for the main entry chunk (unchanged in character; the entry is still large because the rest of the app is not split — out of scope for Milestone D). The console chunk itself is well under the limit. Build exit code: **0**.

### Admin preload
- On idle (`requestIdleCallback`, falling back to a 2 s `setTimeout`), the console chunk is preloaded **only when the current user is an authenticated `admin`** (reuses `AuthContext`). It is a strict no-op for every other role/anonymous visitor, and the dynamic import is memoized so it fetches at most once. Preload only warms the cache — it does not bypass the route guard, which re-evaluates auth/role on actual navigation.

### Chunk-error retry
- `web/src/components/routing/LazyRouteBoundary.tsx` is a class `ErrorBoundary` that catches chunk-load failures (`ChunkLoadError` / "Failed to fetch dynamically imported module") and renders an accessible `role="alert"` retry shell ("Couldn’t load this section" + **Retry** button). Retry bumps a reset key to remount the `Suspense` child, re-attempting the dynamic import.

### CI gate
- `web/scripts/assert-console-chunk.mjs` (wired into `.github/workflows/navigation-intelligence-ci.yml` after the web build) reads `dist/index.html` to find the entry chunk (no hashed filename hardcoding), scans `dist/assets/*.js` for the stable console marker, and **fails non-zero** if the console is missing its own chunk or has regressed into the entry chunk.

### Verification
- `npm run build --workspace=web` → exit 0, console split present.
- `cd web && npx vitest run` → 239 passed (21 files).
- `node web/scripts/assert-console-chunk.mjs` → exit 0 ("split present"); negative test (marker injected into entry) → exit 1 as expected.
