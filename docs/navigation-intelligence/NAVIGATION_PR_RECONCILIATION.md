# Navigation Intelligence — PR Reconciliation Decision: PR #66

> **Status:** DECIDED — SUPERSEDE (port concepts, do not blind-merge)
> **Decision owner:** Lead integrator
> **Date:** 2026-06-21
> **Scope:** CarUp Navigation Intelligence Blueprint, Milestone 4 (registry-driven mobile navigation)
> **Integration branch:** `codex/navigation-intelligence-blueprint-completion`

---

## Summary

PR #66 ("feat: implement registry-driven mobile hamburger drawer") proposes a registry-driven
refactor of the mobile hamburger drawer only. Since it was opened, `main`'s `Navbar.tsx` and
`featureRegistry.ts` have advanced independently — `main` now ships 5 hardcoded desktop
mega-menus plus a hardcoded mobile drawer (Navbar lines 475-539). As a result PR #66 is now
`MERGEABLE=CONFLICTING`.

We will **supersede PR #66** with a cleaner, more complete registry-driven mobile navigation
implementation delivered as part of **Milestone 4** on the integration branch, rather than
blind-merging stale, conflicting code. We will **port the useful concepts** from #66 forward.
PR #66 should be **CLOSED as superseded (not merged)** once Milestone 4 lands. Its bundled
`docs/NAVIGATION_INTELLIGENCE_PRODUCTION_COMPLETION_PLAN.md` is itself superseded by the master
plan already present on this branch.

---

## PR #66 facts

| Field | Value |
| --- | --- |
| Title | feat: implement registry-driven mobile hamburger drawer |
| Branch | `feature/mobile-registry-drawer` |
| Base | `main` |
| State | OPEN |
| Mergeable | **CONFLICTING** |
| Diff size | **+604 / -39** |
| Vercel previews | All SUCCESS |

**Files changed:**

| File | Change |
| --- | --- |
| `docs/NAVIGATION_INTELLIGENCE_PRODUCTION_COMPLETION_PLAN.md` | +529 (new file) |
| `web/src/components/layout/Navbar.tsx` | +46 / -24 |
| `web/src/config/featureRegistry.ts` | +29 / -15 |

**Stated body / intent:** Implements a registry-driven mobile hamburger drawer. Desktop
mega-menus and bottom tabs are **intentionally omitted** (declared as Lane B.1 — out of scope
for the PR).

**Why it conflicts:** `main`'s `Navbar.tsx` and `featureRegistry.ts` advanced after #66 was
opened. `main` now contains 5 hardcoded desktop mega-menus (buyMenu, sellMenu, verifyMenu,
partsMenu, moreMenu) and a hardcoded mobile drawer at `Navbar.tsx` lines 475-539 that uses no
registry, no focus trap, and no `aria-current`. #66's drawer rewrite collides with this
evolved baseline.

---

## Options considered

### Option A — Merge PR #66 as-is

- **Evidence against:** PR is `MERGEABLE=CONFLICTING`; merging requires a manual conflict
  resolution against an evolved `main` that #66's diff did not anticipate.
- #66 only refactors the **mobile drawer** (Lane B.1) and explicitly omits desktop mega-menus
  and bottom tabs, so even a clean merge would not deliver Milestone 4's full scope.
- #66 predates the Blueprint's richer `NavigationNode` manifest + lifecycle model. It is built
  on the registry's current primitive `isPlanned` / `isHidden` booleans and the simple
  `NavPlacement` string array — there is no surface/section/order/coverage model. Merging it
  would entrench the soon-to-be-superseded primitive.
- The PR also bundles a 529-line
  `docs/NAVIGATION_INTELLIGENCE_PRODUCTION_COMPLETION_PLAN.md` that is **already superseded**
  by the master plan now on this branch — merging would reintroduce a stale plan document.
- **Verdict:** Rejected. Blind-merging stale conflicting code with partial scope and an
  outdated plan doc is a net regression risk.

### Option B — Port a subset (cherry-pick the drawer hunk only)

- **Evidence:** Avoids the conflicting docs file, but the `Navbar.tsx` (+46/-24) and
  `featureRegistry.ts` (+29/-15) hunks were authored against the *pre-mega-menu* baseline and
  would still require manual reconciliation against `main` lines 475-539 and the evolved
  registry. The net carried-forward value is the *ideas*, not the literal lines.
- A subset port still leaves Milestone 4's requirements unmet: full registry-driven drawer for
  **public + all 7 roles**, focus trap, `aria-current`, a role matrix, and Playwright coverage.
- **Verdict:** Partially useful — the *concepts* are worth carrying, but cherry-picking the
  literal hunks buys little over re-implementing cleanly. Subsumed into Option C.

### Option C — Supersede with a clean Milestone 4 implementation (chosen)

- **Evidence for:** Milestone 4 requires a complete registry-driven mobile drawer covering the
  **public surface plus all 7 roles** (`owner`, `dealer`, `mechanic`, `bank`, `insurance`,
  `government`, `admin`), with a **focus trap**, **`aria-current`**, a **role matrix**, and
  **Playwright coverage** — none of which PR #66 provides.
- The Blueprint introduces a richer `NavigationNode` manifest and lifecycle model that #66's
  primitive `isPlanned` / `isHidden` drawer predates; building Milestone 4 fresh on the
  Blueprint model is cleaner than retrofitting #66.
- Implementing on the integration branch lets us reconcile against the *current* `main`
  (mega-menus + hardcoded drawer at 475-539) intentionally, instead of resolving a stale
  conflict.
- **Verdict:** **Chosen.** Supersede #66; port its useful concepts forward; close #66 as
  superseded once Milestone 4 lands.

---

## Decision

**SUPERSEDE PR #66** with a cleaner, more complete registry-driven mobile navigation
implementation delivered in **Milestone 4** on the integration branch
(`codex/navigation-intelligence-blueprint-completion`), and **port the useful concepts** from
#66 forward into that implementation.

**Rationale:**

1. **(a) Stale + conflicting + partial scope.** PR #66 only refactors the mobile drawer and is
   already `CONFLICTING` with the current `main`. Blind-merging stale conflicting code is not
   acceptable.
2. **(b) Milestone 4 scope exceeds #66.** Milestone 4 requires a full registry-driven mobile
   drawer for the public surface and all 7 roles, with focus trap, `aria-current`, a role
   matrix, and Playwright coverage — capabilities #66 does not deliver.
3. **(c) Model has moved on.** The Blueprint introduces a richer `NavigationNode` manifest +
   lifecycle model. #66's drawer is built on the primitive `isPlanned` / `isHidden` booleans
   and predates that model.

PR #66 is to be **CLOSED as superseded (not merged)** once Milestone 4 lands. The
`docs/NAVIGATION_INTELLIGENCE_PRODUCTION_COMPLETION_PLAN.md` bundled in #66 is itself
**superseded** by the master plan already present on this branch.

---

## Concepts preserved (ported forward into Milestone 4)

These useful ideas from PR #66 are carried into the Milestone 4 implementation:

- The **`mobile_nav` placement** idea (driving the drawer from the registry's `NavPlacement`).
- A **`getMobileNavItems` / `getMobileNavigation`** selector concept for resolving drawer
  entries from the registry.
- **Public-vs-authenticated filtering** (different drawer contents for signed-out vs signed-in
  users).
- **Role-aware entries** (drawer contents vary by `UserRole`).
- **Icon resolution** (mapping registry `icon` / `LucideIconName` values to rendered icons).
- **Registry-driven drawer rendering** (the drawer is generated from registry data rather than
  a hardcoded array).

---

## Action items

1. Implement the full registry-driven mobile drawer in **Milestone 4** on the integration
   branch: public surface + all 7 roles, with **focus trap**, **`aria-current`**, a **role
   matrix**, and **Playwright coverage**.
2. Port the preserved concepts above into the Milestone 4 implementation (mobile_nav placement,
   `getMobileNavItems` / `getMobileNavigation`, public/authenticated filtering, role-aware
   entries, icon resolution, registry-driven rendering).
3. Reconcile the new drawer against the **current** `main` Navbar (hardcoded drawer at lines
   475-539) and registry — replacing the hardcoded drawer rather than colliding with it.
4. Once Milestone 4 lands and is verified, **close PR #66 as superseded (not merged)**, citing
   this reconciliation decision.
5. Treat #66's
   `docs/NAVIGATION_INTELLIGENCE_PRODUCTION_COMPLETION_PLAN.md` as **superseded** by the master
   plan on this branch — do not carry it forward.

---

## What we explicitly will NOT do

- **We will NOT merge stale conflicting code.** PR #66 is `CONFLICTING` and will not be
  blind-merged.
- **We will NOT merge PR #66 at all** — it will be closed as superseded, not merged.
- **We will NOT merge docs PR #86** merely to obtain the master plan. The master plan was
  already preserved on this branch via `git show`, so merging #86 is unnecessary.
- **We will NOT carry forward #66's bundled
  `docs/NAVIGATION_INTELLIGENCE_PRODUCTION_COMPLETION_PLAN.md`** — it is superseded by the
  master plan now on this branch.
