# S9 — UX, Accessibility and Mobile Convergence — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

## 1. What S9 builds

The garage-side surfaces S2–S5 require, and the removal of the last fabricated dataset on
a live product surface.

- `backend/services/serviceNetwork/garageQueueService.js` — the garage **service queue**
  and the garage's **real customers**.
- `backend/routes/garageQueueRoutes.js` — `GET /api/garage/queue`, `GET /api/garage/customers`.
- `web/src/pages/dashboard/mechanic/CustomerRecords.tsx` — rewritten against the projection.

**No new migration.** S9 is a surface phase.

## 2. The last fabrication, removed

`CustomerRecords.tsx` shipped four invented people — Tendai Moyo, Sarah Chikomo, James
Ncube and Grace Mupfumi — with fabricated phone numbers, email addresses, visit counts and
spend totals, presented as a garage's real customer book. The Pre-S0 reconnaissance flagged
it as the same class of truth debt the S1 empty-state policy exists to prevent.

It is replaced with **truth rather than deletion**: after S2 a garage has actual customers —
the requesters of its own service cases — so every figure is now counted from records that
garage owns.

Two deliberate absences, both load-bearing:

- **No contact details.** Communications owns reaching a customer (Invariant 6), so the
  garage messages through the canonical conversation rather than a harvested phone number.
  A test asserts no `@` and no `+263` can appear in the rendered page even when the seeded
  user row carries them.
- **No "Add Customer" action.** A customer relationship is created by a real service case,
  not typed in. A test asserts the affordance is absent.

## 3. Honest-state rules applied throughout

| Situation | What the surface says |
|---|---|
| No cost recorded for a customer | **"No cost recorded"** — an empty spend map, never `0` |
| Spend in several currencies | Rendered per currency (`ZWG 250 · USD 100`); **never summed** |
| Name not resolvable | **"Unnamed customer"** — never invented |
| Vehicle not resolvable in the queue | Reported by VIN with `vehicle: null` — no placeholder |
| No service category recorded | `null` — never defaulted to "General" |
| No service date | "No service date recorded" |
| Load failure | Reported as a failure, explicitly **not** as "you have no customers" |

The queue's `next_action` is derived from real state (`accept_or_decline` →
`open_work_order` → `start_work` → `record_service`), never guessed, and closed cases are
excluded from the open queue.

## 4. Authority decisions honoured

| Rule | How S9 satisfies it |
|---|---|
| Tenant isolation | Both projections scope to the membership-verified session tenant; another garage's cases and customers are never visible — asserted by test |
| Communications is canonical (Invariant 6) | Contact is a `conversation_thread_id`, not scraped contact data |
| Unknown is not zero (Invariant 10) | Applied to spend, names, vehicles, categories and dates |
| Money (§24.4) | Per-currency totals; cross-currency addition refused |
| No invented facts | The fabricated dataset is gone, and tests assert those four names cannot reappear |

Accessibility: search inputs on the new and rewritten surfaces carry explicit
`aria-label`s, decorative icons are `aria-hidden`, and layouts use responsive
`flex-wrap`/`min-w-0` so the surfaces degrade correctly at mobile widths.

## 5. Verification

| Gate | Command | Result |
|---|---|---|
| Garage surface projections | `node --test backend/tests/service-network-s9-garage-surfaces.test.js` | **PASS** — 11/11 |
| Customer Records truth contract | `npx vitest run src/pages/dashboard/mechanic/CustomerRecords.test.tsx` | **PASS** — 8/8 |
| Web typecheck | `npx tsc --noEmit --project web/tsconfig.app.json` | **PASS** — zero diagnostics |
| Full backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4482 tests, **4461 pass, 0 fail**, 21 skipped. S8 baseline 4471/0 → +11, **zero regressions** |
| Full web suite | `npx vitest run` (in `web/`) | **PASS** — 108 files, **1115 tests, 0 fail** (was 107/1107) → +8, **zero regressions** |

## 6. Deliberately NOT in S9

A garage queue **page** (the API and projection land here; the plan's remaining garage UI
work depends on design-system decisions outside Foundation scope); QR scanning UI; and any
mobile-app work — the mobile workspace is deliberately not installed in this lane.

## 7. `[#194-sensitive]` items for the rebase

- `web/src/App.tsx` and `MainLayout.tsx` route/nav additions remain hotspots (#194 adds
  public routes and `CompactBottomNav`).
- #194 fully rewrites `PartsTracking.tsx`; any Service Network edit there must be authored
  post-rebase rather than on this base.
- #194 places its ServiceIntelligence panel on `MechanicDashboard`; a future garage-queue
  page should converge with that panel rather than duplicate its KPIs.
