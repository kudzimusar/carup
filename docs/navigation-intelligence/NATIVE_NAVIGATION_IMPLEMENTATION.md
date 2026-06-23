# Native Navigation — Milestone C Implementation

Governed native **drawer hub** + **native route boundaries** for the CarUp
mobile app (`mobile/`). Builds on Milestone A (manifest + selectors + route
evaluator + feature boundary) and Milestone B (governed role-aware bottom tabs).

This milestone adds a fifth **"More"** governed tab that opens a **controlled
custom drawer**, drives the drawer's contents from the same governed feature
truth the tabs consume, and wraps the owner-protected screens in route
boundaries so a deep link is gated identically to a hidden tab.

---

## 1. Drawer implementation decision + rationale (no new dependencies)

**Decision: do NOT install `@react-navigation/drawer`. Implement a controlled,
custom slide-in drawer using only existing dependencies.**

`@react-navigation/drawer` was rejected because:

- It conflicts with the expo-router `Tabs` navigator already in place (mixing a
  Drawer navigator around/inside the Tabs layout fights expo-router's file-based
  routing and the governed `href: null` tab-hiding contract from Milestone B).
- It adds new npm dependencies, which the milestone scope forbids.

Instead, `NativeDrawer.tsx` is a **controlled component**:

- A React Native **`Modal`** (`transparent`, `statusBarTranslucent`) hosts a dim
  overlay + a side panel.
- The slide-in / overlay fade uses the **built-in `Animated`** API (no
  `react-native-reanimated` dependency needed, though it is available).
- Open/close state (`visible`) is **lifted into `app/(tabs)/_layout.tsx`** and
  toggled by the **More tab's `tabBarButton`**. The drawer is fully "controlled"
  via `{ visible, onClose }` props.

This is the "predictable native navigation hub" the navigation plan permits: a
single governed entry point (the More tab) that surfaces every additional
governed destination without exceeding the 5-tab ceiling.

Dependencies used (all pre-existing): `react-native` (Modal/Animated/Pressable/
ScrollView/BackHandler), `expo-router` (`useRouter`, `usePathname`),
`react-native-safe-area-context` (insets), `@expo/vector-icons` (via the
Milestone A `getNativeIcon`). **No new packages.**

---

## 2. Files

Created:

- `mobile/components/navigation/NativeDrawer.tsx` — the controlled drawer panel.
- `mobile/navigation/nativeDrawerSections.ts` — **pure** governance:
  `resolveDrawerSections(ctx)` (sections + items) and `resolveMoreTab(ctx)`
  (the More-tab presentation). RN-runtime-free, unit-tested.
- `mobile/app/(tabs)/more.tsx` — required route stub for the More tab (redirects
  home; the tab opens the drawer instead of navigating here).
- `mobile/tests/native-drawer.test.ts` — pure tests (`npx tsx`), 27 cases.
- `docs/navigation-intelligence/NATIVE_NAVIGATION_IMPLEMENTATION.md` — this doc.

Modified:

- `mobile/app/(tabs)/_layout.tsx` — added the More tab + its custom
  `tabBarButton`, lifted drawer `visible` state, rendered `<NativeDrawer>`.
- `mobile/navigation/featureIcons.tsx` — added the `Menu → menu-outline` glyph.
- `mobile/app/(tabs)/garage.tsx`, `escrow.tsx`, `referral.tsx` — wrapped the
  existing screen body (renamed to an `*Inner` component) in
  `NativeFeatureBoundary` (content unchanged; only wrapped).

Reused (Milestone A/B, unchanged logic): `nativeNavigationManifest.ts`,
`evaluateNativeRouteAccess.ts`, `NativeFeatureBoundary.tsx`, `featureManifest.ts`.

---

## 3. Sections + governance model

`resolveDrawerSections(ctx)` returns ordered, **never-empty** sections built from
the governed selectors (`getNativeTabs`, `getNativeDrawer`) plus auth-driven
account actions. Section order: **Discover → My Work → Trust & Verification →
Account → Support**.

| Section | Source | Rule |
| --- | --- | --- |
| **Discover** | governed tab entries (Marketplace) | real screens only; deduped against visible tabs ⇒ normally omitted because Marketplace is always a visible tab |
| **My Work** | `getNativeDrawer` + owner tab entries (SafePay/escrow, Garage) | owner-only governed items; deduped vs tabs (Garage is a tab for owner, so it dedupes out; **SafePay/escrow is drawer-only ⇒ surfaces here**) |
| **Trust & Verification** | (empty set) | **only real native screens** — there is no native verify/search screen, so the section is **omitted** rather than leaking a web-only route |
| **Account** | auth store | role label + role switch (non-owners → "Switch to Owner") + Sign out; anon → **Sign in** |
| **Support** | (none) | no native help/about screen ships ⇒ omitted (no web-only link) |

Resulting drawer per role (links + account actions):

- **Owner** (owner featureIds in parentheses):
  - My Work → **SafePay** (`owner.listings`, `/(tabs)/escrow`).
    (Garage `owner.garage` and Marketplace `product.marketplace` are visible
    tabs ⇒ deduped out; Referrals `owner.referrals` is a visible tab too.)
  - Account → "Signed in as Owner", **Sign out**.
- **Non-owner authed** (dealer / mechanic / bank / insurance / government /
  admin): no owner-only links (no Garage/SafePay/Referrals — no fabricated
  screens); Marketplace is a visible tab ⇒ deduped. Account → role label,
  **Switch to Owner**, **Sign out**.
- **Anonymous**: no owner links; Marketplace is the visible tab ⇒ deduped.
  Account → **Sign in** only.

Every link maps to a manifest entry whose owning feature passed eligibility
(role + auth) **and** lifecycle/backend visibility — i.e. the same truth that
governs the tabs. Backend kill-switches (`enabled:false` / `visible:false`) and
lifecycle gates (`planned`/`hidden`/`disabled`/`deprecated`) remove items here
exactly as they remove tabs.

---

## 4. The "More" tab → drawer wiring + dedupe + ≤5 tabs

- A fifth `more` tab is declared in `(tabs)/_layout.tsx`. Its presentation comes
  from `resolveMoreTab(ctx)`:
  - **authed** → label "More", icon `menu-outline`, `action: 'drawer'`.
  - **anonymous** → label "Sign in", `action: 'signin'`.
- The tab uses a **custom `tabBarButton`** (a `Pressable`) that **intercepts the
  press** and:
  - opens the drawer (`setDrawerOpen(true)`) for authed users, or
  - `router.push('/login')` for anonymous users.
  It **never navigates to the `more` route**; `more.tsx` only `Redirect`s home as
  a safety net for direct/deep-link hits.
- **Dedupe vs tabs:** `resolveDrawerSections` computes the visible-tab set via
  `getNativeTabs(ctx)` and drops any entry already shown as a tab, so the drawer
  never repeats a bottom-tab destination.
- **≤5 tabs:** owner = index + marketplace + garage + referral + More = **5**;
  every other role = index + marketplace + More = **3**; anon = marketplace +
  Sign-in = **2**. A test asserts `visibleTabs + 1 ≤ 5` for all roles, so the
  ceiling always holds and no real tab needs demoting to the drawer.

---

## 5. Native route boundaries (deep-link gating)

The owner-protected screens are wrapped in `NativeFeatureBoundary` so a deep
link / direct nav resolves through the **same governed decision** that hides the
tab/drawer entry (`evaluateNativeRouteAccess`):

| Screen | Boundary `featureId` | Behaviour |
| --- | --- | --- |
| `(tabs)/garage.tsx` | `owner.garage` | owner-only, requiresAuth |
| `(tabs)/escrow.tsx` | `owner.listings` | owner-only, requiresAuth (SafePay) |
| `(tabs)/referral.tsx` | `owner.referrals` | owner-only, requiresAuth |

Outcomes (from the Milestone A evaluator): anonymous → `Redirect` to `/login`;
wrong-role → `Redirect` to `/` (own dashboard); `disabled`/`planned`/`hidden`/
`deprecated` → a safe state screen; active owner → renders the original screen
body unchanged. Each screen's existing component was preserved verbatim and
simply moved into an `*Inner` function wrapped by the boundary export.

**Public screens confirmed open:** `(tabs)/marketplace.tsx` (`product.marketplace`,
no auth, empty roles) and `vehicle/[vin].tsx` (governed by `product.marketplace`)
render publicly — they are intentionally **not** wrapped, matching the manifest
(public, requiresAuth:false). The route evaluator already returns `render` for
them, and the marketplace screen itself prompts sign-in only at the point of
inquiry.

---

## 6. Anti-leakage (no web-only routes)

- Every drawer link's `expoRoute` is a real, shipped native route (asserted in
  tests against `KNOWN_NATIVE_ROUTES`).
- **Trust & Verification** and **Support** are omitted entirely because no real
  native screen backs them — we never link to a web-only `/search` / `/verify` /
  help route. A test asserts no surfaced route contains `search` or `verify`.
- The drawer route → href mapping (`routeToHref`) strips the `(tabs)` group and
  maps `/index` → `/`, producing only navigable expo-router paths.

---

## 7. Android hardware-back behaviour

While the drawer is visible, `NativeDrawer` registers a `BackHandler`
`hardwareBackPress` listener that calls `onClose()` and returns `true`
(consumes the event) — so Android back **closes the drawer first** instead of
popping the screen. The listener is removed when the drawer hides. The `Modal`'s
`onRequestClose` also routes to `onClose` as a backstop.

---

## 8. Accessibility

- Link/action rows: `accessibilityRole="button"`, `accessibilityLabel`, and
  links carry `accessibilityState={{ selected }}` (current-route highlight via
  `usePathname`). Read-only rows (role label) use `accessibilityRole="text"`.
- Section headers use `accessibilityRole="header"`.
- The overlay close target and the More tab button are labelled
  ("Close menu" / "Open menu" / "Sign in"); the More button exposes
  `accessibilityState={{ expanded }}`.
- All touch targets are **≥44px** (`minHeight: 44` on rows and the tab button).
- The panel is marked `accessibilityViewIsModal` so assistive tech treats it as
  modal while open.
- The content is in a `ScrollView` for long lists, and the panel respects
  **safe-area insets** (top + bottom padding).

---

## 9. Known limitations

- **Discover / Trust / Support are usually empty.** Given today's screen
  reality, Marketplace is always a visible tab (deduped) and there is no native
  verify/search/help screen, so these sections are omitted by design. They are
  kept as seams (`DISCOVER_ENTRY_IDS`, `TRUST_ENTRY_IDS`) that auto-populate when
  a real native screen is added to the manifest — no UI change required.
- **Role switching is one-way to Owner.** `AuthUser` exposes a single `role`
  with no available-roles list, so the drawer offers only "Switch to Owner"
  (the `switchRole('owner')` action). A richer multi-role picker needs an
  available-roles field from the backend (out of scope; no backend changes).
- **Animation is the built-in `Animated` API** (timing slide + overlay fade), not
  gesture-driven. There is no swipe-to-open/close gesture; the drawer opens from
  the More tab / closes via overlay tap / Android back. (A reanimated +
  gesture-handler upgrade is possible later without new deps.)
- **`more.tsx` is a redirect stub.** expo-router requires a route file for the
  declared tab; the tab never navigates there, but a direct deep link to
  `/(tabs)/more` redirects to `/`.
- The current-route highlight assumes the tabs root maps to `/` (expo-router's
  reported pathname for `(tabs)/index`); other route groups would need extending
  `routeToHref` if added later.

---

## 10. Verification

- `cd mobile && npx tsc --noEmit` → **0 errors** (no new errors introduced;
  baseline was also 0).
- `npx tsx tests/native-drawer.test.ts` → **27 passed, 0 failed**.
- `npx tsx tests/native-tabs.test.ts` (Milestone B) → **18 passed, 0 failed**.
- `npx tsx tests/native-navigation.test.ts` (Milestone A) → **18 passed, 0 failed**.

---

## 11. Native governance boundary audit (route-level enforcement)

Codex P2 follow-up: the tab bar hides a governed tab, but a deep link / typed
route / the INITIAL navigation could still reach a screen that lacked a
route-level boundary. `index` (Dashboard) and `marketplace` were the two
unguarded governed tab screens; both are now wrapped. The structural test
`mobile/tests/native-boundary-audit.test.ts` reads each governed `NATIVE_NAV`
tab/drawer screen from disk and asserts it imports + uses `NativeFeatureBoundary`
with the governing owner (so this can never silently regress).

| Route (screen file) | Owning feature | Tab rule | Drawer rule | Route-level boundary? | Deep-link / direct-nav behavior |
| --- | --- | --- | --- | --- | --- |
| `app/(tabs)/index.tsx` | `${role}.overview` (role-resolved: owner/dealer/mechanic/bank/insurance/government/admin) | Always present (the home tab); `resolveTabBar` may hide if the role overview is non-visible | n/a | **Yes** — `featureId={`${role}.overview`}`, route from manifest (default `/dashboard`); anon (no role) short-circuits to `<Redirect href="/login" />` | Anon → redirect to sign-in; authed wrong-state (disabled/planned/hidden/deprecated) → safe state screen; active → render |
| `app/(tabs)/marketplace.tsx` | `product.marketplace` | Visible when `product.marketplace` is eligible + visible (`getNativeTabs`) | n/a | **Yes** — `featureId="product.marketplace"` | disabled/`accessible:false`/planned/hidden/deprecated → safe/redirect state; active → render (public — no auth gate) |
| `app/(tabs)/garage.tsx` | `owner.garage` | Owner-only tab; hidden for non-owners / non-visible | n/a | **Yes** (pre-existing) — `featureId="owner.garage"` | anon → sign-in; wrong-role → own dashboard; disabled/planned/… → safe state; active → render |
| `app/(tabs)/referral.tsx` | `owner.referrals` | Owner-only tab | n/a | **Yes** (pre-existing) — `featureId="owner.referrals"` | anon → sign-in; wrong-role → own dashboard; lifecycle-gated → safe state; active → render |
| `app/(tabs)/escrow.tsx` | `owner.listings` | Always hidden in the tab bar (drawer-only entry) | Drawer "SafePay" section; visible when `owner.listings` eligible + visible | **Yes** (pre-existing) — `featureId="owner.listings"` | anon → sign-in; wrong-role → own dashboard; lifecycle-gated → safe state; active → render |
| `app/vehicle/[vin].tsx` | `product.marketplace` | n/a (`placement: 'none'`) | n/a | Deep-link boundary only (exempt from the tab/drawer audit) | governed identically to marketplace via the route boundary if wrapped |
| `app/(tabs)/more.tsx` | — (no owning feature) | Custom button: opens drawer (authed) / sign-in (anon); never navigates | n/a | Exempt (redirect stub, no governed feature) | direct deep link → redirects to `/` |

**Identity-transition readiness (fail-closed).** The boundary now also consumes
`isGovernanceReadyForIdentity(currentKey, loadedForKey, loading, error)` before
evaluating a governed route:

- **A→B transition** — `computeRefreshStart` clears A's map (`loadedForKey→null`,
  `loading→true`), so the boundary shows a spinner and blocks until B's states
  load. B is **never** evaluated against A's `accessible:true` map.
- **Failed B load** — `fetchEffectiveStates()` now returns a discriminated
  `{ ok:false }` (distinct from a success-empty `{ ok:true, map:{} }`); the store
  sets `error:true` and does **not** set `loadedForKey`. The boundary renders a
  retryable **"Temporarily unavailable"** screen (Retry → `refresh()`), staying
  blocked rather than un-gating.
- **Cold-start (never loaded)** — `loadedForKey === null && !loading && !error`
  proceeds with the documented static-manifest fallback (public boot routes
  aren't blocked) and kicks a one-shot `refresh()` via a guarded effect; protected
  routes still gate via auth inside `evaluateNativeRouteAccess`.
- **Same-identity transient failure** — keeps the last-good map (still loaded for
  this identity) and flags `error:true` so a Retry is offered; the dangerous case
  (an identity CHANGE failure) stays blocked because `loadedForKey` is null.

## 12. Verification (governance boundary follow-up)

- `cd mobile && npx tsc --noEmit` → **0 errors**.
- `npx tsx tests/native-boundary-audit.test.ts` → **18 passed, 0 failed**.
- `npx tsx tests/native-governance-refresh.test.ts` → readiness-contract cases
  added (A→B blocks; B ready only after load; denied-B never sees A; failed-B
  safe+retryable; same-identity keeps map; stale in-flight A discarded; logout
  clears protected; tenant + role switch both block; cold-start fallback).
- `npx tsx tests/native-tabs.test.ts` / `native-navigation.test.ts` /
  `native-drawer.test.ts` → unchanged, still pass.
