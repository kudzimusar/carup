# RX-02A S1-4A — Unified Application Shells: Isolated Visual Prototype

**Status:** DEV-only visual prototype · Owner decision packet (PASS / FIX / HOLD) · not production UI
**Base:** accepted `main` @ `8bc00bd75f5285997065872514d10db8fbecd24f`
**Route:** `/dev/rx02-s1-4a-shells` (DEV-gated in `web/src/App.tsx`; unreachable in production builds)

---

## 1. Purpose and scope

S1-4A renders inspectable instances of the three unified application shells from
`UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv` so the Owner can make a visual decision
**before** any real shell migration is authorized:

- **(A) PublicShell** — public showroom chrome (masthead, mega-menus, footer,
  mobile drawer + bottom tab bar).
- **(B) WorkspaceShell** — signed-in workspace chrome (collapsible rail, compact
  ink header, breadcrumb + object identity, one primary action, status panel,
  slim utility footer — no marketing footer).
- **(C) FocusedShell** — reduced single-task chrome (auth / identity /
  seller-claim / flow / review-decision).

It also ships **(D) typed prototype contracts** (`ShellContext`, `ShellKind`,
`RouteShellAssignment`, brand-asset slots, manifest navigation projection types)
and a **declarative route-to-shell map** generated from the authority register.

### Hard boundaries (what this prototype is NOT)

- NOT an authorization engine. The route-to-shell map is inspection data;
  nothing consults it at runtime, no guard/manifest/auth/registry file changed.
- NOT a replacement for production chrome. `Navbar.tsx`, `Footer.tsx`,
  `DashboardLayout.tsx`, `MainLayout.tsx`, manifests, route guards and the
  backend are untouched. The only existing runtime file edited is the minimal,
  DEV-gated route registration in `web/src/App.tsx` (2 additions).
- NOT S1-4B. No real shell migration, no RX-03, no merge, no deploy.
- Reviewer workbenches (R131–R138) and the Trade family are presented **by
  reference only** — S1-4A builds no reviewer or trade shell chrome.

### How to run

```bash
npm ci --no-audit --no-fund --include-staged=true
npm run dev        # web workspace
# open /dev/rx02-s1-4a-shells   (only when import.meta.env.DEV)
```

## 2. File inventory

| Path | Role |
| --- | --- |
| `web/src/components/ux-prototype/rx02-s1-4a/contracts.ts` | Typed prototype contracts (ShellKind, WorkspaceFamily, FocusedMode, ShellIdentity, ShellContext, BrandAssetSlot, nav + route-assignment types) |
| `web/src/components/ux-prototype/rx02-s1-4a/fixtures.ts` | Fictional labelled fixtures (identities, tenants, vehicle, evidence, journey, reference routes) |
| `web/src/components/ux-prototype/rx02-s1-4a/navProjection.ts` | Manifest-driven navigation projection (mega-menus, direct links, footer, mobile surfaces, workspace rail) |
| `web/src/components/ux-prototype/rx02-s1-4a/routeShellMap.ts` | GENERATED 139-row declarative route→shell map + `lookupRouteShell` (regenerate from the CSV; not an auth engine) |
| `web/src/components/ux-prototype/rx02-s1-4a/BrandMark.tsx` | Reserved brand-asset slot with truthful text "CarUp" fallback |
| `web/src/components/ux-prototype/rx02-s1-4a/fixtureDisplay.tsx` | **Temporary display-only fixture adapters** (see §6) |
| `web/src/components/ux-prototype/rx02-s1-4a/PublicShell.tsx` | PublicShell prototype |
| `web/src/components/ux-prototype/rx02-s1-4a/WorkspaceShell.tsx` | WorkspaceShell prototype |
| `web/src/components/ux-prototype/rx02-s1-4a/FocusedShell.tsx` | FocusedShell prototype |
| `web/src/components/ux-prototype/rx02-s1-4a/pathUtils.ts` | Shared path matching |
| `web/src/components/ux-prototype/rx02-s1-4a/index.ts` | Barrel exports |
| `web/src/components/ux-prototype/rx02-s1-4a/shellPrototype.test.tsx` | 25 prototype tests |
| `web/src/pages/dev/Rx02S14ShellPrototype.tsx` | DEV-only showcase page (scenario controls, journey strip, route explorer) |
| `web/src/App.tsx` | MINIMAL DEV-only route registration (the only existing runtime file edited) |
| `docs/product-experience/RX02_S1_4A_SHELL_PROTOTYPE.md` | This document |

## 3. The three shells

### 3.1 PublicShell

- Ink masthead with the **reserved logo location** (dashed slot,
  `data-brand-slot`, `data-brand-fallback="text-wordmark"`) and truthful text
  "CarUp". No invented/traced/substituted artwork anywhere.
- Navigation is **projected from the production manifest**: Buy/Sell/Verify/Parts
  mega-menus (`getDesktopMegaMenu`), direct links (Dealers/Garages), and the
  public footer columns (`getFooterNavigation`). Planned items render as
  non-navigating, accessible "Soon" entries (`aria-disabled="true"`) — never as
  fake links.
- Search link, guest Sign In + "Sell Your Car" CTA; signed-in members get the
  "My CarUp" workspace entry (`data-testid="shell-workspace-entry"`).
- Mobile: focus-trapped drawer (Escape closes and returns focus; Tab cycles),
  5-slot bottom tab bar with `env(safe-area-inset-bottom)` padding and
  `scroll-padding-bottom`, exactly one `aria-current` item.
- Projected public footer (desktop only); social links are planned and render
  disabled per the manifest contract.

### 3.2 WorkspaceShell

- **Ink chrome permanently** (workspace is not "dark mode"; light tokens remain
  reserved for the dark-body variant pending D-07).
- Collapsible rail (`aria-controls="shell-ws-rail"` on the toggle; the rail is a
  landmark `aside` with a matching `id`), projected per fixture role from
  `getDashboardItems` + `resolveFeatureVisibility` — **no cross-family leakage**
  (only items registered for that role appear; shared multi-role diaspora
  features render for both, as on production).
- Compact global header: family label + **fictional tenant label** (e.g.
  `fixture-dealer-001 · Avondale Motors (Pvt) Ltd`), Search/Notifications/
  Account affordances.
- Breadcrumb + object identity (title, mono reference, tone-mapped status chip,
  meta) and **exactly one** prioritized primary action
  (`data-testid="shell-ws-primary-action"`).
- Contextual status/evidence panel; content density per UI_DESIGN_REFERENCE
  (task-first overview; **no decorative stat-card fleet**).
- Mobile: overlay drawer + bottom task nav sized to its item count.
- Slim utility footer ("Server authorization remains authoritative…") — **no
  public marketing footer**.

### 3.3 FocusedShell

- Reduced chrome: optional back button, brand slot, explicit exit (Escape also
  exits; the exit `aria-label` names the fixture identity).
- Clear title + progress context (`role="progressbar"`, labelled "illustrative
  in this prototype").
- Truthful validation presentation: error summary `role="alert"`, focused on
  submit; per-field `aria-invalid` + `aria-describedby`; summary links jump to
  fields.
- Exactly one primary action. A valid submit renders
  **"Prototype ends here — nothing is submitted or saved."** — the prototype
  never claims to save or complete.

## 4. Route-to-shell ownership matrix

The authority register (`UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv`, 139 rows
R001–R139) is the single source of truth. The prototype map is **generated** from
it; do not hand-edit. Summary by route group (full detail in the CSV and in the
in-page route explorer):

| Group | Rows | Proposed shell(s) |
| --- | --- | --- |
| G1 | 9 | PublicShell (showroom: /, /marketplace, search, shared report…) |
| G2 | 4 | FocusedShell ×2 (seller-claim), WorkspaceShell(personal) ×2 |
| G3 | 7 | FocusedShell (auth/identity flows) |
| G4 | 11 | WorkspaceShell(personal) (owner dashboard family) |
| G5 | 5 | PublicShell (dealer research profile), WorkspaceShell(dealer) ×2, FocusedShell ×2 (claim/correction) |
| G6 | 13 | WorkspaceShell(dealer) ×12, FocusedShell ×1 |
| G7 | 8 | **ReviewWorkbench — all reviewer_isolated=yes** (main-backed; reference only here) |
| G8 | 11 | WorkspaceShell(trade) ×9, PublicShell ×1, FocusedShell ×1 |
| G9 | 8 | WorkspaceShell(trade) |
| G10 | 4 | WorkspaceShell(institutional) ×3, WorkspaceShell(trade) ×1 |
| G11 | 24 | WorkspaceShell(admin) ×21, WorkspaceShell(personal) ×3 (dashboard/admin aliases) |
| G12 | 6 | WorkspaceShell(institutional) |
| G13 | 6 | PublicShell ×1 (garage directory), WorkspaceShell(garage) ×5 |
| G14 | 9 | PublicShell ×1, WorkspaceShell(institutional) ×8 |
| G15 | 13 | PublicShell (diaspora public surfaces) |
| G16 | 1 | Context-aware NotFound (R139) |

**How real route families map:** the explorer on the page resolves any concrete
path against the register (parameterized segments match any concrete segment at
the same position, e.g. `/marketplace/abc` → R008 `/marketplace/:id`). The map
records the *proposed* shell family, focused mode, reviewer-isolation flag and
migration caution per route — it makes **no runtime decision**.

## 5. Brand-asset slots

`BrandAssetSlot` enumerates every logo location (public masthead/footer,
workspace masthead/rail, focused header, mobile drawer) with a `tone`
(`ink` | `light`) and `fallbackToText: true` pinned for S1-4A. `BrandMark`
renders a dashed reserved slot plus the truthful text wordmark and an
orange-signal dot used only as a non-text accent (active markers). When the
Owner approves brand artwork, a resolver fills the slot content; shell chrome
does not change. Both tones are demonstrated (ink workspace rail/masthead, light
public footer/focused header, light mobile drawer on ink page).

## 6. Temporary display-only fixture adapters (explicit disclosure)

The S1-3 truth components (PR #264) are **not yet merged**, so this prototype
cannot consume them. `fixtureDisplay.tsx` therefore carries a clearly labelled,
**throwaway** adapter set:

| Adapter | Enforced truthfulness |
| --- | --- |
| `FixtureNotice` | "Fictional fixture — not real data" chip beside every rendered fixture |
| `FixtureMoney` | amount + currency + "· fixture", `tabular-nums`; never a real value |
| `FixtureTrustChip` | tone-mapped state label only; **no scores, no "verified" wording** |
| `FixtureEvidenceLine` | fictional actor · source · time on every row |
| `FixtureVehicleIdentity` | VIN withheld on public surfaces |
| `FixtureStatusBadge` | tone-mapped label |

**Replacement plan (S1-4B):** once PR #264 merges, these adapters are deleted
and replaced by the S1-3 truth components. They must **not** be copied forward
as a second production implementation — no file outside this directory imports
them.

## 7. Security model (preserved conceptually)

- Server authorization remains authoritative; every shell states this in its
  utility footer or fixture labelling.
- Reviewer independence: the eight R131–R138 workbench routes stay on their
  canonical main-backed paths with their proven backend session/step-up checks.
  The prototype renders reference cards only — no reviewer chrome, no simulated
  reviewer access.
- Membership-derived access: workspace rails are projected per fixture role from
  the registry; the projection only mirrors what the production dashboard would
  show a signed-in member of that role. The fixture identities are fictional and
  labelled; no tenant or role state is implied or granted.
- Step-up authentication is never client-side; nothing in this prototype
  performs, bypasses, or simulates an authentication step.
- The route-to-shell map is declarative data, not a guard; activating any of it
  is an S1-4B+ decision gated on Owner approval.

## 8. Visual-verification evidence (this branch)

Captured with Playwright (chromium headless) against the dev server on the
exact tested tree; 44 screenshots at 360/390/768/1280/1920 covering all three
shells, guest + member states, drawers, collapsed rail, validation state,
references, journey strip and the route explorer.

- **Overflow:** `OVERFLOW_OK: true` at every width (no horizontal overflow).
- **axe-core:** **0 violations** (no critical/serious/moderate) across all
  scanned states. Two real defects found during capture were fixed: the showcase
  tablist lacked `flex-wrap` (481px page overflow at 360/390) and Tailwind v3
  cannot apply `/opacity` modifiers to hex CSS-variable colors (drawer/footer
  rendered transparent) — replaced with `color-mix(in srgb, var(--token) N%,
  transparent)` values; rail section titles raised from 40%→50% opacity to meet
  contrast (public mega-menu titles at 50% already passed).
- **Keyboard:** drawer Escape closes and returns focus; error summary receives
  focus on submit; skip link moves focus into `#shell-public-main`.
- **Journey strip:** Home → Marketplace → Vehicle detail → My CarUp → Dealer →
  Independent reviewer (reference), `aria-current="step"` present.

## 9. Test evidence

- `npx tsc --noEmit --project web/tsconfig.app.json` — clean.
- Prototype tests: **25/25** (map fidelity incl. CSV cross-check and 8
  reviewer-isolated rows, projection truthfulness, per-shell contract
  guarantees, adapter truthfulness).
- Full web suite: **171 files / 1630 tests, all pass** (unchanged vs base).
- `npm run build` — succeeds; production bundle contains no prototype route
  (DEV-gated at compile time).
- Lint baseline gate: **NET_NEW_ERRORS=0, NET_NEW_WARNINGS=0**.
- `App.tsx` diff vs pristine `main` tarball: exactly 2 additive hunks (static
  import + DEV-gated route); no production route, layout, manifest, guard or
  auth code touched.

## 10. Proposed S1-4B implementation plan (for approval; NOT started)

Prerequisites: Owner PASS on this packet; PR #264 (S1-3 truth components)
merged; PR #263 and #265 resolved per their own gates.

1. **Consume truth components:** delete `fixtureDisplay.tsx`; wire S1-3 money /
   trust / evidence / identity components into the migrated shells. One
   implementation, no adapter fork.
2. **Migrate route families per the register, group by group, behind existing
   guards:** G1 public surfaces keep MainLayout until PublicShell reaches parity
   (mega-menus + footer already project identically); G4/G6/G11/G12/G13/G14
   workspace families adopt WorkspaceShell inside the existing authenticated
   boundaries (DashboardLayout → WorkspaceShell reparent); G2/G3/G5 focused
   routes adopt FocusedShell for their focused_mode.
3. **Security dependencies (must land with or before migration):** server-side
   shell-context derivation (role/tenant from session, never from client
   payload); route-boundary audit confirming R131–R138 reviewer isolation is
   untouched; step-up flows remain server-side; no route-to-shell activation
   without the guard audit.
4. **Cutover mechanics:** per-route verification (URL retention per register
   cautions), existing tests stay green at each step, lint gate stays at zero,
   a11y gate (axe) runs per migrated family.
5. **Files expected to change in S1-4B (illustrative, not authorized now):**
   production layout files (`Navbar.tsx`, `Footer.tsx`, `DashboardLayout.tsx`,
   `MainLayout.tsx`) reparent onto the (renamed/moved) shell components; the
   `ux-prototype/rx02-s1-4a` directory is the source of the shell chrome and
   either graduates out of `ux-prototype/` or is deleted after cutover; the
   fixture adapters are deleted; the route map stays generated and declarative.

## 11. Owner decision packet

**Decision requested:** PASS (proceed to S1-4B planning with PR #264 as a
dependency) / FIX (specific shell or density changes) / HOLD (do not migrate).

Checklist for the review walkthrough:

- [ ] PublicShell: masthead + reserved logo slot (both tones), mega-menu
      planned-"Soon" truthfulness, drawer focus trap, bottom bar, footer.
- [ ] WorkspaceShell: rail collapse/expand, tenant context, one primary action,
      status panel, no marketing footer, mobile drawer + bottom nav.
- [ ] FocusedShell: reduced chrome, progress context, validation presentation,
      prototype-ends note (no false save).
- [ ] Route explorer: spot-check R003, R008, R016, R131, R139.
- [ ] References: reviewer (G7) and Trade presented by reference only.
- [ ] Density/content rules respected (no glassmorphism, no stat-card fleets,
      no placeholder trust, no fake money, no invented imagery, no new
      colors/fonts).
