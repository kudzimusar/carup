# T11-CAP-LR01-R3 — Checkpoint 2: design and navigation primitives (Steps C and D)

Authority: [T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md](../T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md) §21–§26, §30-C/D and §47 (Checkpoint 2), under the Moderator's R3-A ruling (D-2: page-level, shell-agnostic components and a bounded Trade-shell edit; D-4: workspace wording).
Base: audit commit `52595f0174fc9e15171e3eb3358689142dd3edbf`. **No migration. Production not accessed. No backend change in this checkpoint.**

## 1. Result

Checkpoint 2 asks for three things. Each is proved below, not asserted.

| Gate (authority §47) | Proved by |
|---|---|
| The Seller design language was extracted | §2 — every token cites the reference line it came from; one module (`workspaceStyles.ts`) holds them |
| No fourth visual language was invented | §3 — a scan of the new components for the classes §23 forbids finds none; the colour and radius vocabulary is listed |
| Workspace identity is clear | §4 — the same bar names the workspace on the Garage, My Listings, Seller Studio (including its saved and unavailable screens) and, through the shell, every Trade page; "Trade OS" is gone from the shell's customer-facing text |

## 2. The extraction (Step C)

The reference surfaces are the three the Owner chose: `SellerWorkspaceHeader.tsx` (H), `MyGarage.tsx` (G) and the stage hero of `SellVehicle.tsx` (S), plus the square outline controls of `MyListings.tsx` (L). Line numbers are as of the R3 base `f4b12b60`.

| Token (`WS_STYLE`) | Source | Where the new components use it |
|---|---|---|
| `eyebrow` — 10px, black, uppercase, `tracking-[0.22em]`, orange | H:36 | (header; kept in `SellerWorkspaceHeader`) |
| `eyebrowQuiet` — the slate-400 eyebrow of a data row | G:180 | capability panel heading, vehicle context header |
| `gridLabel` / `gridValue` / `grid` / `gridCell` — hairline-divided information grid (`gap-px bg-slate-200`, white cells) | G:198–201 | capability cells |
| `display` — black weight, `tracking-[-0.045em]` | H:37, G:183 | vehicle context header title |
| `focus` — orange 2px ring with offset, never the default outline | H:28 | every new link and control |
| `quietLink` — 44px target, slate-500, darkens on hover | H:28 | `WorkspaceParentLink` (extracted from the header, which now renders it) |
| `primaryAction` — square, slate-950, orange on hover | G:265 | `WorkspaceExitActions` (primary) |
| `accentAction` — square, orange | G:108 | reserved (not yet used) |
| `secondaryAction` — square, hairline border, no fill | derived from G:281 and L:392 | capability actions, exit actions, Passport link |
| `statusRule` — the orange left rule of a status line | H:43 | reserved (the header keeps its own) |
| `unavailable` — the amber "could not read" band | G:121 | reserved for the Garage / Passport fault states |
| `stage` — the deliberate dark stage panel | S:1067 | documented only; chrome does not use it |

Components built from them (`web/src/components/workspace/`), mapped to the responsibilities of authority §25:

| Responsibility (§25) | Component | Notes |
|---|---|---|
| Workspace identity / switching / account | `CarUpWorkspaceBar` | one component, light and dark tone; role-gated through `canRoleAccessRoute`; three equal columns below `sm` so the active workspace is always on screen |
| Breadcrumb / parent context | `WorkspaceBreadcrumbs`, `WorkspaceParentLink`, `WorkspaceChrome` | the trail wraps, never truncates; an ancestor with no `href` is text; the last crumb is plain text with `aria-current="page"` |
| Vehicle identity | `VehicleContextHeader` | frame/VIN printed in full (`break-all`); the Passport link appears only when the caller passes it |
| Capability boundary | `VehicleCapabilityPanel`, `VehicleCapabilityCells`, `capabilityPresentation.ts` | two independent capabilities; `none` produces no import view; a failed read is a fault, never "none" (wired to real data in Step E) |
| Exit / adjacent actions | `WorkspaceExitActions` | an empty list renders no landmark: an unauthorised action is absent, not disabled |
| (model) | `workspaceModel.ts` | the three workspaces and their customer-facing names, defined once; `formatVehicleTitle` |

`SellerWorkspaceHeader` is kept and extended without breaking change: it renders the same DOM unless a page passes the new optional `workspace` / `breadcrumbs` props (a test pins the default). The pre-existing `ui/breadcrumb` primitive is reused, not rebuilt.

## 3. No fourth visual language

Scan of the non-test files in `web/src/components/workspace/` for the classes authority §23 forbids (blur, glass, rounded cards, shadows, gradients, new fonts):

```
grep -nE "backdrop-blur|blur-|glass|rounded-(md|lg|xl|2xl|3xl|full)|shadow-|\bshadow\b|bg-gradient|bg-\[radial|font-(serif|display)|font-\[" <non-test files>
→ 1 hit: a code COMMENT in workspaceStyles.ts ("no blur or glass"). No class.
```

Vocabulary actually used by the new components: radius — `rounded-none` only; shadow — none; gradient — none; font — the existing stack (`font-black`, `font-bold`, `font-mono` for identifiers, as the Garage already does); colour — slate, orange, white and amber only (the amber is the existing "could not read" convention). No new font and no new colour.

## 4. Workspace identity (Step D)

| Page | Before | After |
|---|---|---|
| My Garage | eyebrow "Vehicle workspace"; back link "Seller / Owner home" | workspace bar (My Vehicles current); eyebrow "My Vehicles"; back link "Back to dashboard" |
| My Listings | eyebrow "Commerce workspace"; back link "Seller / Owner home" | workspace bar (Marketplace current); eyebrow "Marketplace"; back link "Back to dashboard" |
| Seller Studio | static "Back to My Garage" | workspace bar (Marketplace current); trail `Marketplace / <vehicle> / Seller Studio` once the vehicle is in the seller's Garage scope; the parent is the vehicle's **Vehicle Passport** ("Back to Vehicle Passport"), or My Garage for a brand-new listing. The saved ("Draft saved") and unavailable screens carry the bar too |
| Trade shell (every Trade page) | brand text "Trade OS"; only exit = CarUp logo → public Home | workspace bar, dark tone (Trade & Imports current) with **My Vehicles** and **Marketplace** as real exits wherever the role may open them; nav landmark renamed "Trade & Imports sections"; the unreadable-context line says "Trade & Imports" |
| A page inside the Trade shell that also asks for a bar | would have drawn a second one | draws none: `WorkspaceBarProvidedContext` (set by the shell around its outlet) makes the bar decline, while the page keeps its own trail |

The user-visible words are exactly the Moderator's D-4 set: **My Vehicles · Marketplace · Trade & Imports**. "Trade OS" no longer names the workspace on any R3-touched page; the programme codes appear only in code comments and tests.

Decisions taken inside the ruling (recorded so they can be overruled):
1. **Workspace-root pages carry no breadcrumb trail.** On My Garage and My Listings the page *is* the workspace root, so a trail would read "My Vehicles / My Garage" and link to itself. The bar plus the eyebrow answer "where am I"; the back link answers "where did I come from".
2. **The Seller Studio's parent is the vehicle's Passport** when the vehicle exists in the seller's Garage scope. The Passport is the durable vehicle identity and the bridge the authority describes; My Garage remains one tap away through the bar.
3. **"Seller / Owner home" is retired from the three Seller pages** (finding NV-5/WI-2). "Back to dashboard" replaces it; a contract test now fails if the string returns.
4. The Trade function tabs (Request quotes, My requests, … Messages) are untouched: they are the *within-workspace* navigation, the bar is the *between-workspace* navigation, and they are now visibly different rows.

## 5. Evidence

| Check | Result |
|---|---|
| Tests in the new component files, the new shell test and the header test file | 62 tests, all passing (4 of them were already in the header file; 2 header tests and every other test are new). Writing them found and fixed two real defects: a nested `<li>` from the shadcn separator, and the shadcn "current page" primitive announcing the current crumb as a dimmed link |
| Regression over every directory touched (`components/workspace`, `components/seller`, `components/layout`, `pages/dashboard/owner`) | **31 files, 252 tests, all passing** |
| Types gate (`tsc --noEmit -p tsconfig.app.json`, the CI app project) | exit 0 after Step D |
| Negative control for the types gate | a deliberate `TS2322` in a **non-test** source file → exit 2, file removed. (A first control placed in a `*.test.ts` file passed, because `tsconfig.app.json` excludes test files by design — so test files are *not* type-checked by this gate; the vitest run is their check.) |
| Shell test is not vacuous | the role-gating test asserts its precondition (`dealer` cannot open the Garage or Marketplace) instead of silently skipping when no such role exists |
| e2e | `trade-shipping-rfq.spec.ts` looked up the removed "Trade OS" brand text for its 393px collision test; it now uses the logo link and also asserts the workspace name is wholly inside the 393px viewport. Not run here (mocked Playwright; it runs in CI) |

Not yet done, by design: a mutation pass over the new guards (scheduled with the final regression), responsive geometry at 390 / 768 / 1280 / 1920 (Step J), and physical Owner UAT (Step K). Capability *data* is not yet wired — the panel is proved on typed input only; Step E builds the server read model before any page shows a capability.

## 6. Next

Step E: the additive read model (`getVehicleImportCapability`, `deriveMarketplaceCapability`, the owner-only `capabilities` block) and then the Vehicle Passport, so capability truth precedes capability styling.
