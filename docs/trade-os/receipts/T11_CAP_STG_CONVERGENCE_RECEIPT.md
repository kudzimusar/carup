# T11-CAP-LR01 — Staging convergence · Receipt

**Specialist gate: `SPECIALIST GATE PASSED` for convergence** (migrations applied, catalog verified, exact-SHA Preview pair
deployed and identified). **CAP-STG01 (real-data physical UAT) is NOT performed — it is held on decision D4 and on an
authenticated session**, both of which belong to the Moderator and the Owner (§6). Nothing here is a UAT result.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Product commit applied and deployed | `36aebeb9435fba2295166caf0d18ee092bd6aec1` on `feat/trade-os-t11-cap-lr01-journey-arrival` |
| Staging project | `eoyenigwevnxwwhyhaer` — shared with other programmes |
| Production (`vhmnajoeicasaigiophh`) | **not accessed** |
| Canonical staging runtime | **not touched** — both canonical hosts still serve Garage `8353dbdd` |
| External sends | none — Preview has `COMMUNICATION_OUTBOUND_DISABLED`; nothing was sent |

## 1. What was applied, and how

Three **additive** migrations, through the repo's own pattern for writing to staging: a certification branch whose push
runs a workflow that holds the staging database secret. It is modelled on the accepted Garage STG01 harness.

| Migration | Adds |
|---|---|
| `20260920090000_trade_os_cap04_shipment_legs.sql` | table `diaspora_shipment_legs`, its guard and no-delete triggers |
| `20260921090000_trade_os_cap05_shipment_observations.sql` | table `diaspora_shipment_observations`, its guard and no-delete triggers |
| `20260922090000_trade_os_cap08_journey_alerts.sql` | a **dedicated** dedupe function + a `WHEN`-scoped trigger on `domain_events`, and the governed template `journey_update_v1` |

The workflow (run `40156210257`, 2026-10-25 02:54:14Z → 02:56:12Z, **12 of 12 steps green**) checked custody (the exact
product commit, on the product branch, a workflow-only diff, the three migrations' pinned git blobs); refused anything but
the approved staging project (production refused by name, twice); re-ran the rehearsal gates with no database access
(three PGlite checks, the harness tests, the coverage gates); ran a **read-only preflight** against the live catalog; and
applied each migration in **one transaction together with its ledger row**. It then verified the live catalog against a
manifest **generated from a PGlite world** — not typed by hand. The push trigger was retired to dispatch-only afterwards
(`17946f3b`), so editing that branch can never re-run a staging writer; a hand re-run is an idempotent re-verify.

## 2. The hazard this convergence existed to catch

`communication_domain_event_dedupe_key()` is **re-stated wholesale** by every programme that adds a branch to it, so the
last writer wins and each must know every earlier branch. The live staging function carries **Email 1.0, Service Network
O4 (`service.case.*`) and Garage 1.0 (`garage.*`)** branches, none of which this lineage can see. **My first CAP-08
migration re-stated it and would have deleted the O4 and Garage branches** (found before anything was applied, from the
staging ledger and a recorded hazard; fixed in `03336fd0` — see the CAP-08 receipt §4.1). The replacement is a dedicated
function and trigger that touches no existing function.

The harness enforces this with a **tripwire inside each migration's transaction**: if the shared function's source differs
by one byte before commit, that migration is rolled back. It did not fire; the property held.

## 3. Verified independently — through the read-only staging connection, not the workflow's own word

| Check | Result |
|---|---|
| Ledger | 281 → **284** rows; three new rows, `created_by = t11-cap-lr01-convergence`, each carrying commit `36aebeb9`, the git blob and the Up-SQL hash; version = the full filename (the repo's documented contract) |
| **Shared dedupe function** | md5 **`cc6c203c60f1acddb466d42f3b0d13ff` before and after — identical**; O4 and Garage branches still present; no Journey branch in it (by design) |
| `domain_events` triggers | exactly three, all enabled: the two that existed, plus `trg_domain_events_journey_alert_dedupe` |
| Journey trigger | `BEFORE INSERT … FOR EACH ROW WHEN (event_type = ANY (ARRAY['diaspora.journey.alert','diaspora.journey.exception']))` |
| New tables | both: row-level security **enabled and forced**; no privileges for `anon` or `authenticated`; **0 rows** |
| New function | `communication_journey_alert_dedupe_key`: not executable by `anon` or `authenticated` |
| Governed template | `journey_update_v1`: active, transactional, approved, in-app, body `{{status}}`, required `["reference","status"]` |
| Nothing written | 0 Journey events exist; no data row was created |
| Columns the new queries use | all **47** exist on the real staging tables (no mismatch between fixtures and the real schema) |

## 4. The exact-SHA Preview pair

Built with the cached CLI from a clean worktree at the exact commit. **Preview only** (`target: null`): no alias moved, no
promotion, canonical staging untouched.

| | Backend | Web |
|---|---|---|
| Deployment | `dpl_AqAsVVS7DoPoLk8GxA3E5sWX4Zg5` | `dpl_2C1fifActEVgfzgyH7LvHfyyFGH3` |
| Immutable host | `https://carup-backend-staging-jrdh3j6ri-11-11.vercel.app` | `https://carup-staging-qexz7c39k-11-11.vercel.app` |

- **Backend identity:** `/api/health` reports commit `36aebeb9`, `environment: preview`, and the deployment id. The
  Journey, vessel-leg and estimate-revision route families each answer **401** (mounted and guarded); an unknown route
  answers 404. Communications read `BLOCKED` — correct for a Preview.
- **Pairing is proven from what is served, not assumed:** the web provenance file reports `api_base_url` =
  the immutable backend host above, `unpaired: false`, and the built bundle contains that host.
- **Web identity is proven by contents.** This lineage's web build takes its commit only from `VERCEL_GIT_COMMIT_SHA`,
  which does not exist for CLI deploys, so its provenance `commit_sha` reads `null` — it cannot state its own commit.
  Instead the served bundle was searched for each unit's unique UI strings (CAP-03 through CAP-09), and all are present.
- **Canonical is unchanged:** `api-staging.carup.dev` and `carup-backend-staging.vercel.app` both report commit `8353dbdd`,
  deployment `dpl_76Zt2nhw…`, environment production.
- **Why a Preview cannot touch other programmes' events:** no `EVENT_WORKER_INTERVAL_ENABLED` is set for Preview (the
  serverless runtime skips the interval poller), the worker secret is scoped to other branches, and outbound sends are
  disabled. This was checked from the variable *names* before deploying, because a Preview that polled the shared outbox
  could have dead-lettered Garage's events — which is exactly what happened to 27 of them in an earlier campaign.

## 5. What this does **not** prove

- **No authenticated request has been made to the Preview pair.** The routes are proven mounted and guarded; no Journey
  has been *rendered with data* on staging, no leg or estimate revision has been recorded there, and no statistic has been
  computed from real rows. Everything behind the login is proven only against mocks and PGlite.
- **The alert path cannot be exercised on a Preview, by design.** Alerts are produced by the event worker, which a Preview
  does not run and which is driven by a scheduler pointed at the canonical host. Proving alerts end to end needs a runtime
  that *processes events with this code* — that is a decision (D9) not taken here, because the canonical runtime serves
  another programme's certified build and must not be displaced.
- **The workflow's own logs and evidence artifact were not opened** — I could read the run's per-step results from the
  public Actions API, not its logs. The verification in §3 is independent of them for that reason.
- **The web Preview cannot state its commit** (above). The identification by contents is strong, not equivalent.
- **Rollback is documented, not rehearsed on staging.** Each migration has a Down path that is tested on PGlite; Down for
  CAP-08 drops only its own trigger and function and leaves the template.

## 6. CAP-STG01 — held, and exactly what releases it

| Needed | Why | Owner |
|---|---|---|
| **D4 — vehicle identity.** CAP shows a **2018 Honda Vezel** (BE FORWARD ref `CD740269`); the staging seller-authority vehicle is a **2016 Nissan Serena**; staging has **no record** of the Vezel. Which is the programme's real transaction, and **may a vehicle + import order + shipment for the Vezel be created on staging under `u_66cace85fad949e4` from verified facts only?** | The real-data association step stops on a mismatch; nothing may be invented | Moderator |
| **An authenticated session** for that account on the Preview pair — either the Owner signs in themselves at the web Preview URL (the Preview backend authenticates against the same staging database), or a reversible credential window is authorised for that identity | No Journey can be read without one | Owner |
| **D9 — a runtime that processes events with this code**, if alerts are to be proven end to end | Previews do not run the worker; canonical serves Garage | Moderator |

**Once D4 and a session exist, the physical UAT is:** open `/diaspora/journey/import_order/<order id>` on the web Preview;
confirm the header names ports *and* what they are ("ports on the shipment record"); that **Port of discharge** and
**Destination (on the order)** are separate facts; that nothing says arrived, cleared or delivered unless a record says so;
that Documents show T8's own states and Customs shows T12's own words (or "withheld" for a non-buyer); that Statistics
read **"not enough data"** (there are not five completed sailings by one organiser on that route); and that at 390 px
nothing scrolls sideways. Record an estimate revision with a reason and confirm the history shows current beside original.

## 7. Decisions outstanding for the Moderator

D1 (T4 rail), D2 (T11 `shipments[0]`), D3 (legacy exception notice addresses the operator; approving it would give buyers
two exception notices), **D4 (vehicle identity — the only decision that holds the real-data end)**, D5 (per-leg observed
movement), D6 (document visibility for tenant admin / participant), D7 (customs visibility for admins / participants),
D8 (cross-organiser statistics, and the floor of five sailings), **D9 (a runtime for alert UAT)**. D1–D3 and D5–D9 do not
block anything delivered.
