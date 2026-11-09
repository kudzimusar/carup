# S7 — Intelligence Convergence — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

## 1. Scope decision — what S7 can honestly deliver on this base

The Pre-S0 reconnaissance predicted this and the base confirms it: **the entire I9
Intelligence layer exists only in unmerged PR #194.** Verified on `ba208963`:

- `backend/services/intelligence/` contains only `disclosureConflict.js` and
  `temporalComparison.js` (Milestone-3 visual/disclosure AI);
- there is **no** `serviceIntelligenceService.js`, no `NOT_MEASURABLE` registry, no
  `marketplace_activity_events` ledger, no rollup or projection services;
- the only intelligence migration is `20260621140000_ai_temporal_disclosure_intelligence.sql`.

S7's plan bullets split cleanly along that line:

| S7 bullet | Status |
|---|---|
| Service event/activity instrumentation | **Already satisfied** — S2 emits the canonical `service.*` events on the existing `domain_events` outbox; Intelligence consumes that, and no parallel ledger is created |
| Measurable metric catalogue | **Delivered here** |
| I9 not-measurable reconciliation | **Delivered here** (§3) |
| Mechanic-person / garage-tenant scope | **Delivered here**, enforced by `assertScopeAllowed` |
| Branch and service-category metrics where authoritative | **Delivered here** |
| Unavailable semantics | **Delivered here** |
| Wiring into the I9 projection + activity ledger | **Deferred to rebase** — the target does not exist on this base |

Building a parallel intelligence service now would create exactly the duplicate authority
the programme exists to prevent, and would be discarded at rebase. It was not built.

## 2. What S7 builds

`backend/services/serviceNetwork/serviceMetricCatalogue.js` — a governed, testable
declaration of **which service metrics are answerable and from which authoritative
sources**. It deliberately **computes nothing**: Intelligence observes, it never becomes
business truth (Invariant 7), and a test asserts the module never returns a `value`,
`count`, `total` or `score`.

Each entry states its numerator, denominator, timestamp and scope sources, so plan §19.3's
bar is **checkable rather than asserted**. `violatesMeasurabilityBar()` applies that bar to
every entry, and `evaluateMeasurability()` re-checks the declared sources against the
**live schema** rather than trusting the file — which is what keeps the catalogue honest
across a rebase that moves or renames an authority.

## 3. I9 reconciliation (plan §19.3)

A metric moves to measurable **only** when numerator, denominator, timestamp and scope all
have governed sources. Applying that to what S1–S6 actually built:

**Now measurable — and why they were not before:**

| Metric | The Foundation fact that unlocked it |
|---|---|
| `request_to_accept_elapsed` | `service_cases.accepted_at` (S2) |
| `accept_to_completion_elapsed` | `service_cases.completed_at` (S2) |
| `cancelled_cases`, `work_orders_cancelled` | dedicated `cancelled_at` columns (S2/S4) |
| `contributing_mechanics` | `work_order_assignments` (S4) — previously the creator was the mechanic |
| `branch_activity` | `branch_id` on cases and work orders (S2/S4) |
| `service_category_demand` | structured `service_category` (S2) |
| `service_records_logged`, `part_records_logged` | `service_records`, `service_record_parts` (S5) |
| `service_requests`, `accepted_requests`, `declined_requests`, `work_orders_opened/completed`, `repeat_customers`, `demand_by_make_model` | the Service Case authority itself (S2) |

**The plan fact #6 contradiction is resolved.** Older I9 text calls cancellation
not-measurable while the work-order route already accepted `Cancelled`. S2 and S4 gave both
a governed `cancelled_at` timestamp, so cancellation is now genuinely measurable at both
levels — recorded as such, with a test pinning it.

**Still not measurable (plan §19.2)** — each names the *missing fact*, not a bare refusal:
bay capacity utilisation, appointment no-show rate, staffing utilisation, task-level
technician productivity, estimate approval rate, estimate-to-invoice variance,
comeback/warranty rate, customer rating, first-time-fix rate.

**One honest downgrade.** Plan §19.1 lists *response time from Communications* as
potentially measurable after Foundation. It is recorded as **not measurable**: Communications
owns the fact and no governed join from a thread to a Service Case exists yet (S3 binds the
conversation but the timing fact stays with Communications). Claiming it would have meant
inventing a numerator.

## 4. Authority decisions honoured

| Rule | How S7 satisfies it |
|---|---|
| Intelligence observes, never becomes truth (Invariant 7) | The catalogue computes nothing; asserted by test |
| Garage ≠ mechanic (Invariant 3) | Scope is declared per metric; `assertScopeAllowed` refuses a tenant metric at person scope and vice versa |
| Unknown is not zero (Invariant 10) | A missing source yields `availability:'unavailable'` **with no value field at all** |
| No duplicate authority | No parallel ledger, projection or analytics endpoint was created |
| Do not infer (§19.2) | Every forbidden metric is present in the registry as explicitly not-measurable — silence would have been worse than refusal |

## 5. Verification

| Gate | Command | Result |
|---|---|---|
| Catalogue and reconciliation contracts | `node --test backend/tests/service-network-s7-metric-catalogue.test.js` | **PASS** — 12/12 |
| Full backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4453 tests, **4432 pass, 0 fail**, 21 skipped. S6 baseline 4441/0 → +12, **zero regressions** |

## 6. `[#194-sensitive]` — the rebase work this phase specifies

1. Reconcile #194's `serviceIntelligenceService.NOT_MEASURABLE` registry against §3 above:
   move `turnaround_time`, `cancellation_rate` and `service_category_demand` to measurable
   (Foundation now provides their governed sources), and keep the §19.2 set refused.
2. Re-point I9's service-demand read: it currently counts `marketplace_inquiries.seller_id`
   as the provider target, which §10.2 forbids — it must read
   `target_provider_tenant_id` (S3) or `service_cases.garage_tenant_id` (S2).
3. Extend `activityEventTypes.js` and the `marketplace_activity_events` CHECK **in lockstep**
   (the taxonomy is 3-way pinned) if service activity is to enter that ledger.
4. I9 was certified against an empty authority (0 work orders in staging); real Foundation
   facts will materially re-open those projections.
