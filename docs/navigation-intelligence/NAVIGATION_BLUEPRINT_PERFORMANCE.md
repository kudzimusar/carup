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
