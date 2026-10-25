# T11-CAP-LR01 — Journey & Arrival · Final return packet

**Programme:** CarUp Trade OS — reconstruct the Owner-authorised BE FORWARD CAP page with REA, reconcile it against the frozen
Trade OS authorities, build the Journey & Arrival capability, converge it onto staging, and run a real-data physical UAT.

**Branch:** `feat/trade-os-t11-cap-lr01-journey-arrival`, cut from `577428de` (the parent was unchanged at every poll).
**Product commit deployed to staging:** `36aebeb9`. **Production (`vhmnajoeicasaigiophh`): not accessed at any point.**
**Self-acceptance:** none. Each unit carries `SPECIALIST GATE PASSED` / `RECOMMEND ACCEPT` in its own receipt; acceptance is yours.

## 0. Where it stands, in one paragraph

Everything that can be built and proven without your decision **is built and proven**: nine capability units, a tested
convergence harness, three migrations applied to staging and independently re-verified, and an exact-SHA Preview pair deployed
without displacing anything. **The real-data physical UAT (CAP-STG01) has not run.** It is held on decision **D4** (the
purchased vehicle is a 2018 Honda Vezel that staging has no record of) and on an authenticated session for the Owner's
account. Nothing in this packet is a UAT result, and no business fact was invented to get around that.

## 1. Authority

- **Constraints held throughout:** production Supabase forbidden; real data only, no invented business facts; the CAP access
  token never committed, never in a fixture, log or screenshot; no auth bypass, token enumeration or rate-limit bypass; no BE
  FORWARD code or branding copied; no real WhatsApp or email sends; frozen T4–T12 domain code **not modified** (verified against the
  diff from the parent: no T4–T12 service, notifier or page was changed, and a test asserts the T11 shipment service is
  untouched). The **shared infrastructure** that was extended, each at an established additive extension point:
  `diasporaRoutes.js` (route mounts), `server.js` (one listener registration), the Communications subscription list,
  policies and in-code template mirror, the event bus's identity registry, `App.tsx` (one route), the shared API hook (types
  and one method), `ci.yml` (three database checks) and the shared mock-database test helper (two unique-index entries); migrations additive, bounded and reversible; exact-head custody
  (the parent head was polled before every phase; no force-push anywhere).
- **Reconciliation** (Part A inventory + Part B reuse/extend/new decisions) classified every CAP capability before any code,
  and recorded two amendments where reality diverged from plan (A1: legs carry no observed columns; A2: CAP-08 needed one
  migration — and the first version of it was wrong, see §5).

## 2. REA benchmark (CAP-00)

`rea-agents@6.7.0`, the real framework, installed with `--ignore-scripts`, driven through its CLI against **one**
Owner-authorised session; 15 evidence records in one validated bundle (private; redacted manifest committed). Passive CDP
observation plus REA-driven read-only scenarios. Declared deviations D1–D3 are in the CAP-00 receipt.

Findings that shaped the build: CAP is a **server-rendered page, not an application** (no business API); the observed
journey is **single-vessel, single-leg**; CAP shows **no timestamps, no ETA history and no actual arrival date** (all
CarUp differentiators); the consignee is spelled differently from CarUp's canonical account; and **vehicle identity is a
`MISMATCH`** — CAP shows a **2018 Honda Vezel** (ref `CD740269`), the staging seller-authority vehicle is a **2016 Nissan
Serena**, and a read-only search of staging found **0 rows** for the Vezel by chassis, VIN, engine number or owner.

## 3. Architecture matrix (what each CAP capability became)

| CAP capability | Decision | Delivered as |
|---|---|---|
| Vehicle identity panel; consignee (participant-only) | REUSE | Journey projection reads `vehicles` and the order's own fields; chassis/consignee only for the owner and platform admins (**CAP-02/03**) |
| Stage table; carrier / ports / dates | REUSE + EXTEND (read) | T11/T10 composed, every row carrying a source and an **observed time** CAP lacks (**CAP-02**) |
| Vessel and voyage; more than one leg | NEW | `diaspora_shipment_legs` — **declared, never observed**; no multi-leg data created (**CAP-04**) |
| **ETA history and the reason for a change** | NEW | `diaspora_shipment_observations`; current estimate shown **beside** the shipment record's, never over it; no provider integrated (**CAP-05**) |
| Documents | REUSE (T8) | T8's own states and disclaimer; `withheld` ≠ `unavailable` ≠ none; next steps derived only from recorded state (**CAP-06**) |
| Destination / customs; clearing agent | REUSE (T12) | T12's participant status through a pinned whitelist; case/shipment disagreement shows nothing of the case; **a port of discharge is not a destination** (**CAP-07**) |
| Alerts | EXTEND (T7) | Journey notifier consuming T11's existing stage events (T11 not edited); recipients by the **same** function the Journey uses; in-app only; database-enforced one-alert-per-observation (**CAP-08**) |
| Statistics | EXTEND (read) | Derived only from recorded dates; the same organiser's completed **sailings** only; below five → "not enough data" with no count; never a prediction (**CAP-09**) |
| Payments (T13, guarded) | REUSE, guarded | **Not built** — T13 is `PARTIAL`; the Journey's payments section stays "not yet composed" |
| Document alerts | part of EXTEND (T7) | **Not built** — T8 emits no event to consume and is frozen |
| Notification list inside the Journey | — | **Not built** — alerts appear in T7's own inbox; the Messages tab stays "not yet composed" |
| Courier tracking, notify party, upsell, capability-URL login, document→leg binding | SKIP | deliberately not built (Part B R7, R8, R10, R13–R15) |

## 4. Product — what a customer can now do

Open **Journey & Arrival** for an order and see: an honest state (never "arrived" without an observation); departure and
arrival worded as plan / estimate / observation; the estimate and its full revision history with reasons; vessel and route
(declared); the shipping documents in T8's words and who is waiting on whom; the customs steps in T12's words, the clearing
agent, and where the cargo has got to (gateway, destination, release, collection and delivery kept apart); statistics that
say "not enough data" until they can honestly say more; and in-app alerts when the journey moves. Every section the service
cannot compose says so; none renders as an empty list.

## 5. Defects found by the work itself

- **The first CAP-08 migration was wrong, and was caught before anything was applied.** It re-stated the shared
  `communication_domain_event_dedupe_key()`, which every programme re-states wholesale — so it would have deleted Service
  Network's and Garage's idempotency branches on the live staging function. Found during staging reconnaissance from the
  ledger and a recorded hazard; replaced by a dedicated trigger (`03336fd0`); the convergence harness now enforces it with a
  tripwire inside each migration's transaction. Its first check had passed because it modelled the function only as Email 1.0
  left it.
- **Test blind spots found by mutation, each closed:** a fixture that resolved the same shipment for everyone; whole-day
  durations hiding a missing rounding; two checks guarding one thing so either could be deleted unseen (a recurring pattern —
  proven with combined mutants each time); a mock that stamps `created_at = now` hiding a superseded-revision survivor; a
  race that was never exercised; a partial-failure test that could not see the bug; a test that compared a result to itself.
- **Harness portability:** PGlite does not return `rowCount`, so existence checks silently read as "absent" — found because
  the same harness runs on two engines.
- **My own tooling failed silently twice** (an unset variable; a per-call `globalThis`). Both were noticed from empty or
  contradictory output and re-run, not assumed.

## 6. Real data

**None read, none written, none invented.** The association step stopped on the vehicle mismatch at CAP-00 and has not
resumed. No estimate revision, leg, alert or statistic exists on staging; both new tables hold 0 rows.

## 7. Testing

| Layer | Result |
|---|---|
| Full backend regression, final head (trade-os, diaspora, T11 harness, communications, email, outbox, migration; 143 files) | **3,025 tests · 3,017 pass · 7 skipped · 1 fail** — the single failure is `diaspora-logistics-rfq.test.js:236`, a T3 fixture whose hard-coded dates are now in the past; it reproduces on an untouched tree |
| Real-Postgres (PGlite) checks | CAP-04 **23/23** · CAP-05 **39/39** · CAP-08 **32/32** |
| Web (`src/pages/diaspora`, `src/hooks`) | **34 files · 599 / 599** |
| Mutation testing, every unit | backend, SQL, web and harness: all killed except solo survivors that are redundant layers, each proven protected by its combined mutant |
| Convergence harness | 37 tests; **30 / 30** mutants killed |
| Type-check / lint / build | `tsc -b` exit 0 with negative controls; 0 lint errors (1 warning predating this work); build exit 0 |
| Browser | Chromium at 1280 and 390 against a stubbed API with synthetic fixtures, each unit; page-level horizontal overflow **0** throughout |

## 8. Staging

Detailed in [T11_CAP_STG_CONVERGENCE_RECEIPT.md](T11_CAP_STG_CONVERGENCE_RECEIPT.md). In short: the three migrations applied
through a certification-branch workflow (12/12 steps green, ledger 281 → 284); **independently verified** — the shared
dedupe function is byte-identical before and after, other programmes' triggers intact, new tables forced-RLS with no browser
grants and no rows; an **exact-SHA Preview pair** deployed (backend `dpl_AqAsVVS7…`, web `dpl_2C1fifAc…`), identified from
its own health and provenance and from the served bundle's contents; **canonical staging unchanged** (Garage `8353dbdd`).

## 9. UAT

**CAP-STG01 not performed.** The exact steps that run it once released are in the convergence receipt §6.

## 10. Unknowns

- No authenticated request has yet been made to the Preview pair; everything behind the login is proven only on mocks and
  PGlite. The queries' columns were checked against the real staging catalog (all 47 exist).
- The alert path has never run end to end — a Preview cannot process events.
- The web build on this lineage cannot state its own commit.
- Statistics describe **recorded** dates (T11 permits back-dating and late recording), not true times; on real staging data
  they will read "not enough data".
- The workflow's own logs and artifact were not opened (the public API gave per-step results only).

## 11. Blockers and decisions for you

| | Needed | Blocks |
|---|---|---|
| **D4** | Which vehicle is the programme's real transaction, and may a vehicle + order + shipment for the Vezel be created on staging under `u_66cace85fad949e4` from verified facts only? | **the real-data UAT** |
| **Session** | The Owner signs in on the web Preview, or a reversible credential window is authorised for that identity | the real-data UAT |
| **D9** | A runtime that processes events with this code (canonical serves Garage and must not be displaced) | proving alerts end to end |
| D1–D3, D5–D8 | T4 rail; T11 `shipments[0]`; the legacy exception notice's recipient (approving it would give buyers two exception notices); per-leg observed movement; document and customs visibility for non-buyers; cross-organiser statistics and the floor of five | nothing delivered |

## 12. Recommendation

Each of CAP-00 to CAP-09 and the staging convergence carries its own `RECOMMEND ACCEPT`. The programme as defined includes a
real-data physical UAT that has **not** run; it is blocked on D4 and an authenticated session, not on any defect I know of.

`RECOMMEND BLOCK — T11-CAP-LR01`
