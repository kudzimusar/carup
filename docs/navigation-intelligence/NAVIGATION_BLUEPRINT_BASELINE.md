# CarUp Navigation Intelligence Blueprint — Verified Pre-Implementation Baseline

**Milestone 1.3 — Regression Baseline (recorded by lead integrator)**

This document captures the verified pre-implementation baseline for the CarUp
Navigation Intelligence Blueprint. All figures below were measured **before any
implementation changes** and are derived solely from the discovery ground-truth
output. They establish the regression reference point against which all
subsequent milestones (through M8) are compared.

---

## Environment

| Item | Value |
| --- | --- |
| Node | v20.20.2 |
| npm | 10.8.2 |
| TypeScript (tsc) | 5.9.3 |
| Integration branch | `codex/navigation-intelligence-blueprint-completion` |
| Branch base | `main` @ `c25b094` |
| Plan commit | `aa492a4` |
| Working tree | clean |

---

## Baseline Command Results

Run date: **2026-06-21**, BEFORE any changes.

| Command | Exit | Result |
| --- | --- | --- |
| `npm run test:unit --workspace=web` | 0 | PASS — 12 files / 128 tests |
| `npx tsc --noEmit --project web/tsconfig.app.json` | 0 | PASS — clean |
| `npm run build --workspace=web` | 0 | PASS — bundle: main JS 2,033.89 kB / gzip 536.49 kB; CSS 189.96 kB / gzip 32.06 kB; Vite warns chunk > 500kB |
| `git diff --check` | 0 | clean |

---

## NOTE — Backend Integration Suite Deliberately NOT Executed

The backend integration suite (`node backend/tests/run-tests.js`) was
**deliberately NOT executed** as part of this baseline.

This suite **connects to and writes rows to the live shared Supabase project**
(`vhmnajoeicasaigiophh`, `NODE_ENV=development`). Running it would:

- **Violate plan rule #9**, and
- Trip the stop condition: _"production credentials or production data are
  required for testing."_

Because of this, the integration suite is withheld from the regression baseline.

**Still runnable / safe:**

- **DB-free, node-native backend unit tests remain runnable** (e.g.
  `auth-middleware.test.js` and `trust-governance.test.js`, which mock/inject
  rather than touching the live database).
- The **new governance migration is staging-only**, pending **Product Owner
  approval** before any application beyond staging.

---

## Inventory Counts

| Surface | Count / State |
| --- | --- |
| Registry features | 83 |
| `App.tsx` `<Route>` declarations | 91 |
| Hardcoded Navbar nav sources | 6 (`buyMenu`, `sellMenu`, `verifyMenu`, `partsMenu`, `moreMenu`, hardcoded mobile array) |
| Registry selectors | 16 |
| `NavPlacement` values | 5 (`dashboard_sidebar`, `header`, `footer`, `mobile_nav`, `user_menu`) |
| Feature lifecycle model | Booleans `isPlanned` / `isHidden` only |

---

## Performance Baseline (for M8 comparison)

These are the **BEFORE** figures captured from `npm run build --workspace=web`.
They are the reference bundle sizes for the M8 performance comparison.

| Asset | Raw size | Gzip size |
| --- | --- | --- |
| Main JS (`dist/assets/index-*.js`) | 2,033.89 kB | 536.49 kB |
| CSS | 189.96 kB | 32.06 kB |

Vite emits a warning that the main chunk exceeds 500 kB.
