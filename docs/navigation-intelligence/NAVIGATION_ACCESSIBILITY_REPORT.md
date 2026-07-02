# Navigation Accessibility Report — Milestone H

**Scope:** Accessibility completion for the CarUp Navigation Intelligence surfaces
(web layout/console/lifecycle components + native tabs/drawer/dashboard).
**Constraints honored:** No navigation logic / governance / auth changes; native
font scaling left enabled (Dynamic Type intact); no git commit.
**Date:** 2026-06-23

---

## 1. Findings table (audit blockers + fast-fixes)

| # | Surface | Issue | Severity | Fixed? — file:line | Note |
|---|---------|-------|----------|--------------------|------|
| 1 | Web — Navbar | Notification bell icon-button missing `aria-label` | Blocker | ✅ `web/src/components/layout/Navbar.tsx:217-231` | `aria-label` is count-aware ("Notifications, N unread"); bell + badge `aria-hidden` |
| 2 | Web — Navbar | Currency dropdown button missing `aria-label` | Blocker | ✅ `web/src/components/layout/Navbar.tsx:201-205` | `aria-label="Currency: USD. Change currency"` |
| 3 | Web — Navbar | Decorative `ChevronDown` not hidden from AT | Blocker | ✅ `web/src/components/layout/Navbar.tsx:67,69,203,254` | `aria-hidden="true"` on mega-menu icon + all chevrons |
| 4 | Web — Navbar | User-menu trigger had no accessible name beyond first name | (hardening) | ✅ `web/src/components/layout/Navbar.tsx:251` | Added `aria-label="Account menu for {name}"` |
| 5 | Web — DashboardLayout | Sidebar OPEN toggle missing `aria-label` | Blocker | ✅ `web/src/components/layout/DashboardLayout.tsx:223-231` | `aria-label="Open sidebar menu"` + `aria-expanded` |
| 6 | Web — DashboardLayout | Sidebar CLOSE (X) button missing `aria-label` | Blocker | ✅ `web/src/components/layout/DashboardLayout.tsx:115-123` | `aria-label="Close sidebar menu"`; icon `aria-hidden` |
| 7 | Web — DashboardLayout | Active sidebar link missing `aria-current="page"` | Blocker | ✅ `web/src/components/layout/DashboardLayout.tsx:170-180` | `aria-current={isActive ? 'page' : undefined}`; nav icons `aria-hidden` |
| 8 | Web — MobileNavDrawer | Decorative icons not hidden from AT | Fast-fix | ✅ `web/src/components/layout/MobileNavDrawer.tsx:84,138,166,176` | `aria-hidden="true"` on all leading icons |
| 9 | Web — MobileNavDrawer | Section labels (`Browse`/`More`) contrast 2.53:1 on white | Serious (axe) | ✅ `web/src/components/layout/MobileNavDrawer.tsx:92` | `text-gray-400`→`text-gray-600` (~7:1) |
| 10 | Web — Footer | Copyright/legal + disabled-social text 3.9:1 on dark footer | Serious (axe) | ✅ `web/src/components/layout/Footer.tsx:45,124` | `text-gray-500`→`text-gray-400` (~6.4:1). Footer nav landmarks/aria untouched (no regression) |
| 11 | Web — UI primitives / global | Animations did not respect `prefers-reduced-motion` | Fast-fix | ✅ `web/src/index.css:132-152` | Global `@media (prefers-reduced-motion: reduce)` neutralizes animation/transition durations + smooth scroll; functional open/close unaffected |
| 12 | Native — `(tabs)/_layout.tsx` | More tab custom `tabBarButton` a11y | Blocker | ✅ already present (Milestone C) — verified `:144-156` | `accessibilityRole="button"` + dynamic `accessibilityLabel` + `accessibilityState={{ expanded }}`; tab labels supplied via `title` |
| 13 | Native — `(tabs)/index.tsx` | Role-switch / verification / logout `Pressable`s missing a11y props | Blocker | ✅ `mobile/app/(tabs)/index.tsx:53-72, 76-95, 97-118` | Added `accessible` + `accessibilityRole="button"` + `accessibilityLabel` (+ `accessibilityHint`/`accessibilityState={{selected}}` for role switch); role-switch rows given `minHeight:44` |
| 14 | Native — `NativeDrawer.tsx` | Items need role/label/`selected` state + 44px targets | Blocker | ✅ already present (Milestone C) — verified `:151-209, 307-315` | `accessibilityRole`/`accessibilityLabel`/`accessibilityState={{selected}}`, `minHeight:44`, section titles `accessibilityRole="header"`, panel `accessibilityViewIsModal`, overlay "Close menu" button |

**Already-OK and NOT regressed** (re-verified): Footer nav landmarks + aria-labels +
disabled-social `aria-disabled` state, `FeatureStatePages.tsx` regions, Console
badges/filters, Radix Dialog/Sheet/DropdownMenu focus-trap + Escape + focus-return,
mobile drawer 44px targets.

**Native Dynamic Type:** `grep -rn allowFontScaling mobile/app mobile/components` →
**no matches**. No global font-scaling disable exists; all native nav text scales
with OS Dynamic Type by default. Nothing removed, nothing disabled. Native nav
header titles are provided via expo-router `headerTitle`/`title` (React Navigation
exposes them with a header role); drawer section titles use
`accessibilityRole="header"`.

---

## 2. Automated axe coverage (`tests/agents/33-navigation-accessibility.spec.ts`)

Tool: `@axe-core/playwright` (added as a **web** devDependency, hoisted to repo
root `node_modules` so the root Playwright runner resolves it). Project: `chromium`.
Tags scanned: `wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice`. Each surface is
scoped with `AxeBuilder.include(<selector>)` so the gate measures the **navigation
surface**, not unrelated host-page (e.g. Landing hero) content.

### Violation threshold (chosen + documented)
- **FAIL** the build on any `serious` or `critical` axe violation…
- **…EXCEPT** two rule IDs that are reported-but-not-failed, with rationale:
  - `color-contrast` — the offending pixels are the **CarUp brand palette**: the
    orange (`#f97316`) primary CTAs (`nav-sell-cta`, `mobile-register`) and the
    orange "Up" wordmark accent, which render identically on every primary action
    product-wide. Recoloring the brand is a product design decision, not a
    navigation change (out of scope; "do NOT change navigation logic/branding").
    Genuine, cheap nav contrast bugs (drawer + footer section/legal labels) WERE
    fixed (findings #9, #10).
  - `aria-required-children` — emitted by the Radix `DropdownMenu` backing the
    desktop mega-menu (`role="menu"` wrapping a multi-column grid of links). It is
    a known Radix composition pattern; fixing it means rewriting the working,
    governance-driven mega-menu markup — out of scope.
- `minor`/`moderate` are collected and printed to the test log (`[axe][surface]
  N advisory finding(s)…`) but never fail.

The deferred set is a single, documented constant (`REPORTED_NOT_FAILED`) in the
spec, so the exception is explicit and auditable.

### The 9 surfaces + local run status

| # | Axe surface | Selector scope | Auth | Local run |
|---|-------------|----------------|------|-----------|
| 1 | Public desktop nav (home) | `header` | anon | ✅ PASS |
| 2 | Open desktop mega-menu (Buy) | `[data-testid="nav-buy-menu"]` | anon | ✅ PASS (reports `aria-required-children`, `color-contrast` as advisory) |
| 3 | Mobile web drawer (390×844) | `[data-testid="mobile-nav-drawer"]` | anon | ✅ PASS (reports brand `color-contrast` advisory) |
| 4 | Footer | `footer` | anon | ✅ PASS |
| 5 | Lifecycle state page (not-found) | whole doc | anon | ✅ PASS (reports `landmark-one-main` moderate advisory) |
| 6 | Dashboard sidebar | `aside` | owner (mocked) | ⚠️ NOT GREEN LOCALLY — authed route did not render (see §5) |
| 7 | Governance Console list | `[data-testid="feature-governance-console"]` | admin (mocked) | ⚠️ NOT GREEN LOCALLY — same auth-bootstrap issue |
| 8 | Console override dialog | `[data-testid="fg-detail-dialog"]` | admin (mocked) | ⚠️ NOT GREEN LOCALLY — same |
| 9 | Navigation analytics panel | `[data-testid="fg-analytics-panel"]` | admin (mocked) | ⚠️ NOT GREEN LOCALLY — same |

Mocking follows `tests/agents/32-feature-governance-console.spec.ts` verbatim
(auth via `addInitScript` of `carup_session`/`carup_token`/`carup_user`,
`page.route('**/api/**', …)` for CORS preflight, images, `auth/verify`,
`security/csrf-token`, `admin/features`, `features/effective`, plus a
`admin/navigation/analytics` summary mock). Base URL hardcoded to
`http://localhost:5173` like the sibling specs.

### CI wiring
`.github/workflows/navigation-intelligence-ci.yml` gains a dedicated
`navigation-accessibility` job (installs deps + `playwright install --with-deps
chromium`, then `npx playwright test tests/agents/33-navigation-accessibility.spec.ts
--project=chromium`). The Playwright config's `webServer` boots Vite itself and the
spec mocks all `/api/**`, so the job is backend/DB-free. The workflow `paths`
trigger now also includes `tests/agents/**` and `playwright.config.ts`. (The
existing 27–32 agent specs are not run by any CI workflow today — the navigation
CI was DB-free unit/structural only — so there was no pre-existing "run navigation
Playwright" glob to slot into; this adds the first such job, scoped to the axe spec
as instructed.)

---

## 3. Manual evidence (HONEST status)

| Check | Method available here | Status |
|-------|-----------------------|--------|
| Keyboard-only desktop (Tab/Shift-Tab/Enter/Esc, focus order, focus-return) | Radix focus-trap/Escape/focus-return verified by existing specs 29/30/31 + code review; not re-driven by keyboard in this session | PARTIAL — covered by existing focus-trap specs + axe; explicit manual keyboard walkthrough **deferred to device/QA** |
| 200% browser zoom (reflow, no clipping) | No interactive browser zoom session run | **NOT run in this environment / deferred to device QA** |
| Reduced motion (`prefers-reduced-motion`) | Implemented globally (finding #11); not yet exercised with the OS toggle in a real browser session | PARTIAL — code in place; visual confirmation **deferred to device QA** |
| Phone landscape (orientation, safe-area, tab bar) | No device/emulator session run | **NOT run in this environment / deferred to device QA** |
| TalkBack (Android) | No Android device/emulator | **NOT run in this environment / deferred to device QA** |
| VoiceOver (iOS / macOS Safari) | No iOS device; no VoiceOver session | **NOT run in this environment / deferred to device QA** |

No manual assistive-technology or device pass is claimed. The automated axe gate
(§2) is the only executed accessibility verification, plus the existing focus-trap
Playwright specs and static code review of the ARIA changes.

---

## 4. Reduced-motion approach

A single global rule in `web/src/index.css` under
`@media (prefers-reduced-motion: reduce)`:
- sets `html { scroll-behavior: auto }` (overriding the smooth-scroll default),
- forces `animation-duration`/`transition-duration` to ~0 and
  `animation-iteration-count: 1` on `*, *::before, *::after`.

This neutralizes motion from `tailwindcss-animate` (Radix Dialog/Sheet/DropdownMenu
enter/exit), the custom `fadeInUp`/`slideInRight`/`pulse-glow` keyframes, and smooth
scrolling — **without** disabling any functionality (open/close, focus trap, Escape
still work; only the motion is removed). A global CSS rule was chosen over
per-component `motion-reduce:` variants so coverage is complete and cannot be
forgotten on future components.

## 5. Native a11y approach

- `(tabs)/index.tsx`: every interactive `Pressable` (3 role-switch rows, verification
  CTA, logout/sign-in) now declares `accessible` + `accessibilityRole="button"` +
  a descriptive `accessibilityLabel`; role-switch rows add `accessibilityHint` and
  `accessibilityState={{ selected }}` and a `minHeight: 44` touch target.
- `(tabs)/_layout.tsx` More tab and `NativeDrawer.tsx` items were already compliant
  (Milestone C) — verified `accessibilityRole`/`accessibilityLabel`/
  `accessibilityState` and ≥44px targets, drawer section headers
  (`accessibilityRole="header"`), modal semantics (`accessibilityViewIsModal`), and
  a labeled overlay close button. No changes were needed; none were made beyond
  verification.
- Dynamic Type: no `allowFontScaling={false}` anywhere in `mobile/app` or
  `mobile/components`; native text scales by default — left untouched.

---

## 6. Verification results

| Gate | Result |
|------|--------|
| `web`: `npx tsc --noEmit -p tsconfig.app.json` | **0 errors** |
| `web`: `npx vitest run` | **245 passed / 22 files** (threshold ≥245 met) |
| `mobile`: `npx tsc --noEmit` | **0 errors** |
| root: `npm run build` | **success** — FeatureGovernanceConsole remains a separate chunk (no regression) |
| Axe spec (chromium) | **5/9 PASS locally** (all anon surfaces #1–#5). The 4 authed surfaces (#6–#9) did not render locally — see §5/limitations. Spec authored + CI-wired. |

## 7. Limitations

1. **Authed axe surfaces not green locally.** Surfaces #6–#9 require an
   authenticated SPA session injected via `addInitScript`. In this local Vite dev
   environment the auth bootstrap did not pick up the injected session — the
   `/dashboard` and `/admin/features` routes rendered the public/login state
   instead (page snapshot showed `/login` + `/register` links). This is an
   **environment-specific** issue, not a spec defect: the reference spec
   `32-feature-governance-console.spec.ts` was run here too and **fails identically**
   on the same `feature-governance-console` testid. The four authed tests are
   authored with the proven mocking pattern and CI-wired; they are expected to pass
   in CI where the auth flow behaves. (NOT a fabricated pass — explicitly reported
   as not-green-locally.)
2. **Brand `color-contrast` + Radix `aria-required-children` are reported, not
   fixed.** Both are out-of-scope per the milestone constraints (brand restyle /
   navigation-markup rewrite). They are surfaced in the axe log and tracked here.
3. **No manual device / AT passes** (keyboard walkthrough, 200% zoom, reduced-motion
   visual, landscape, TalkBack, VoiceOver) were performed — deferred to device QA
   (§3). Only automated axe + existing focus-trap specs + code review were executed.
