# Trade OS T5 — Container Marketplace & Multi-Corridor Compatibility · Implementation Receipt

**Status:** `T5-PARTIAL` — owner UAT required
**Date:** 2026-09-06
**Authorization head:** `3c382bae` · **Actual start:** `d866e2ce` · **Code head:** `84b6de3a`
**Plan:** `docs/trade-os/T5_CONTAINER_MARKETPLACE_MULTI_CORRIDOR_IMPLEMENTATION_PLAN.md`
**Canonical authority:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md` §40, §41
**Production:** UNTOUCHED · **T6:** NOT STARTED · **PR #207:** Draft

---

## 1. What T5 was for

> A customer's final destination must not be assumed to be the destination of the individual
> sailing on which they reserve capacity.

Before T5, `findCompatibleSailings` and `assertProviderMayOfferContainer` both required
`sailing.origin_country == request.origin_country && sailing.destination_country ==
request.destination_country`. A real `Yokohama → Beira` sailing could therefore never serve a
Harare customer — the only way to "make it work" was to lie about one side of the route.

## 2. Baseline proof (T5.0)

| Fact | State at start |
|---|---|
| Branch / head | `feat/trade-os-client-demo-convergence` @ `d866e2ce`, clean tree |
| PR #207 | Draft, OPEN |
| Production | `origin/main` `bb9d9900`, untouched throughout |
| T3 | frozen at `b446d8ea` semantics |
| T4 | **T4-USABLE**, frozen at `736f06c5` |
| Intake 2.0 | `INTAKE-2.0-PARTIAL` — owner UAT outstanding, **not pre-empted by T5** |
| Known red gate | Vehicle Passport Foundation CI (`Diff hygiene`) — 8 trailing-whitespace lines the T5 plan landed with at `70f9a251`; fixed in T5.0 and the gate is green again |

## 3. Authority audit (T5.1)

Searched the entire repository before creating anything.

- **No corridor/route authority exists.** The only `corridor` in the codebase is a display label
  derived from order rows in `tradeIntelligenceService`. Nothing to reuse; the authority was created.
- **Ports were metadata.** `origin_port` / `destination_port` were written by the operator UI into
  `metadata`. The destination port is *the* gateway fact corridor matching reads → promoted to columns.
  `loading_window`, `carrier_name`, `booking_reference`, `documentation_notes`, `participant_notes`
  are matched by nothing and display-only → **deliberately stay metadata**.
- **`metadata.total_capacity_weight` stays put.** It is read by the hardened approval RPC
  (`diaspora_approve_cargo_reservation_atomic`). Promoting it would mean rewriting a certified
  capacity kernel for zero behavioural gain.
- **The status CHECK already supported the lifecycle** — DRAFT/BOOKING_OPEN/BOOKING_CLOSED/CANCELLED
  were present (alongside legacy LOADING/SHIPPED/ARRIVED, which are T10/T11 vocabulary). No CHECK
  change was needed; only the service's hardcoded `BOOKING_OPEN` at creation.
- **Mode mismatch confirmed at CHECK level.** `diaspora_logistics_requests.service_mode_preference`
  admits `roro`; `diaspora_logistics_quotes.service_mode` did not.

## 4. Schema (migration `20260907090000`)

Two new tables, four new columns, one widened CHECK. Nothing dropped, nothing rewritten.

- `diaspora_trade_corridors` — code, display name, origin/destination market, `planning_status`
  (`benchmark_candidate` | `research_candidate`), active. Live-code uniqueness is a **partial**
  index so a soft-deleted code can be re-issued.
- `diaspora_trade_corridor_legs` — ordered `sequence`, origin/destination country + locality,
  `mode_options` constrained to a conceptual vocabulary **wider than CarUp operates** (a leg may
  say `rail`; that is route knowledge, not a booking claim).
- `diaspora_container_shipments` + `origin_port`, `destination_port`, `corridor_id`, `corridor_leg_id`.
- `diaspora_logistics_quotes.service_mode` gains `roro`.
- RLS on both new tables: `authenticated` may SELECT active rows; **no write policy exists**, so
  every non-service write is refused. `anon` revoked.

**Down fails loudly** if any `roro` offer exists. A rollback may not strand rows against the
constraint it restores, and must never delete a provider's commercial offer for convenience.

## 5. Behaviour

**`tradeCorridorService.sailingRouteMatch()`** is the single decision both matching sites use:

- `direct` — the sailing's endpoints equal the request's (the pre-T5 behaviour, still valid);
- `gateway` — an applicable corridor (request origin → request **final** destination) contains a leg
  whose country pair equals the sailing's. The sailing covers **that leg**; `onward_legs` is the
  route that remains.

Matching is by geography. An operator's declared `corridor_leg_id` is corroborating metadata and
cannot widen eligibility; a declared leg is validated on write to actually cover the sailing's route.

**Sailing lifecycle.** `publish:false` records a DRAFT (default remains immediate BOOKING_OPEN, so
every existing caller is unchanged). `openBooking` publishes deliberately. `cancelSailing` is
refused while any REQUESTED/APPROVED reservation exists — a cancellation must not strand a booking.

**Mode.** `roro` is representable. A roro offer **cannot** attach a shared-container sailing,
because the container does not carry it. No RoRo booking or rate integration was built.

**Lifecycle gap (§36.10) — CLOSED.** `cancelMyLogisticsRequest` (pre-acceptance) and
`closeMyLogisticsRequest` (post-award) are requester-only and audited. Both are refused while a live
container reservation is attached: teardown may not discard capacity state the container authority
owns. Because the T4 continuation index treats CANCELLED/CLOSED as non-live, either transition
**frees the one-live-continuation slot** — proven on staging.

**Anti-bypass.** `?status=DRAFT` returns only sailings the caller operates. A foreign DRAFT read by
id returns **404**, indistinguishable from a wrong id, so the endpoint cannot confirm that a
competitor's unpublished sailing exists.

## 6. The UI truth (T5.9)

Rendered verbatim on deployed staging:

```text
Your destination: Harare, Zimbabwe
This sailing covers: Yokohama → Beira — Japan → Beira → Zimbabwe corridor
Then still required: Forbes/Machipanda → Harare — not part of this sailing, not yet arranged.
```

Direct sailings read `Sails to your destination: …`. A direct and a gateway sailing on the same
departure never collapse into one card. The operator form offers **Publish sailing** vs **Save as
draft**, with an optional corridor/leg declaration; drafts carry Open booking / Cancel sailing.
Lifecycle verbs are two-click confirms and surface the server's refusal verbatim.

## 7. Evidence

| Gate | Result |
|---|---|
| PGlite migration gate, own CI step, **confirmed executed** | **16/16** |
| Backend suites | **1549 / 0** (7 skipped) |
| Web diaspora suites | **139 / 0** |
| New tests | 24 backend + 8 web; 8 mutations, **all caught** |
| Staging API certification (real Postgres) | **37/37** |
| Staging browser certification | **25/25** |
| Procurement-origin continuation (case D) | **14/14** |
| Seven-width geometry × 3 routes | **21/21**, screenshots eye-reviewed |
| Settled-page console errors / 5xx | **0 / 0** |
| CI at `84b6de3a` | **7/7 green** |

FE `index-Daou84Dg.js` ↔ BE `f0bcca2a` paired; staging Supabase only.
Evidence: `scratchpad/t5-cert/` (12 screenshots).

## 8. Findings

1. **F1 UX-DESIGN** — publish → detail takes ~13–14s; `setView('detail')` waits on sailing-matches.
2. **F2 MISSING T5 CAPABILITY (performance)** — `findCompatibleSailings` is N+1 over open containers (~5.6s).
3. **F3 UX-DESIGN** — gateway options sort by departure like any other and can sit behind "Show more".
   Ordering is deliberately neutral; this is disclosure, not ranking.
4. **F4 PREFERENCE / fixture hygiene** — legacy synthetic sailings carry raw fixture ids in `origin_city`.
5. **F5** — *fixed in-lane*: the gateway card stuttered ("Japan → Beira — Japan → Beira → Zimbabwe
   corridor"); it now names the sailing's own ports per §T5.9.

## 9. Explicitly NOT built (phase firewall)

No rate engine, FX, landed cost, corridor economics or recommendation scoring (T6). No customs or
tax (T12). No shipment tracker or event ingestion (T11). No warehouse or loading (T9/T10). No
settlement (T13). No reputation (T14). No RoRo commercial integration. `LOADING`/`SHIPPED`/`ARRIVED`
are **not** used as T5 truth.

## 10. Status

**`T5-PARTIAL` — OWNER UAT REQUIRED.** Every technical row of the plan's §8 exit gate is proven.
The owner's product/visual verdict is the only row automation cannot close (§29).
T3 frozen. T4 frozen. Intake 2.0 still awaiting its own owner UAT. **T6 not started. Production untouched.**
