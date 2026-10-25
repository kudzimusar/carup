# T11-CAP-08 — Journey alerts, through T7 · Receipt

**Specialist gate: `SPECIALIST GATE PASSED`** at unit, real-communications-pipeline and real-Postgres level.
Recommendation: `RECOMMEND ACCEPT — T11-CAP-08`. The Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Builds on | CAP-07 (`fdd6ceeb`) |
| Frozen domain code modified | **none** — T11's shipment service is not edited (a test asserts it) |
| Shared infrastructure touched | the bus's identity registry, the Communications subscription list, policies and in-code template mirror, and one line in `server.js` — each an established, additive extension point |
| Schema | **one additive migration** (`20260922090000`): one function branch and one governed template. **Not applied to staging** — see §6 |
| Real data | none read or written |
| Real sends | **none** — in-app only, by policy; nothing external is addressed |

## 1. What this is

A customer is told, in the app, when their shipment's journey moves:

| Alert | Raised by | Words |
|---|---|---|
| Departed | T11 records `IN_TRANSIT` | "recorded your shipment as **departed**" |
| Arrived | T11 records `ARRIVED` | "recorded … as **arrived** — it is not delivery to you and it is not customs clearance" |
| Exception / hold | T11 records `EXCEPTION` or `CUSTOMS_HOLD` | "a problem" / "a hold … **it is not a customs decision**" |
| Estimate changed | an estimate revision becomes **current** (CAP-05) | "the estimated arrival … has changed. **An estimate is not an arrival.**" |

Every sentence says what the shipment authority recorded **and what that is not**, points at the Journey, and
embeds **no date** (a later revision would make it stale). **A notification never creates state:** nothing
here writes a stage, a date or an estimate (a trap on every write proves it).

**Not alerted, deliberately.** *Loaded* already has its own notice (T10.4). `RELEASED` and `COMPLETED` are
T12's: T11 itself hands them over because a release asserts that duty was paid. *Document available* has no
event to consume — T8 emits none and is frozen. Customs milestones are T12's.

**T11 is not hooked.** It already emits `DIASPORA_SHIPMENT_<STAGE>` on the bus after each audited stage change.
The notifier subscribes to the four stages worth saying and ignores the rest. The legacy exception notice
(`shipmentExceptionNotifier`) is untouched; it addresses the shipment's creator, i.e. the operator (G5 / D3).

## 2. Who is told — and why it cannot drift from the Journey

The people told are **exactly the people whose Journey shows that shipment**, by construction: the Journey's
"which shipment is this order's" logic was extracted into one exported `resolveJourneyShipment`, and both the
Journey and the notifier call it. A parity test then checks it from the other side — for every candidate user it
calls the real `getJourney` and requires that "was alerted" equals "their Journey shows this very shipment".

So: a co-loader whose cargo was **left behind**, or was never loaded, is not told it sailed; an **ambiguous**
association and one that sails on a **different container** tell nobody (the Journey flags those rather than
announcing a movement); a co-loader with their **own** shipment on the same container is not told someone
else's moved; the operator is told nothing by this notifier.

Each person is told about **their own order only**. The payload carries their user, their order, a short
shipment reference (the one the Journey prints), the sentence and a path to *their* journey — and a scan proves
it carries no other participant, no other order, no operator, no container, no tenant, and no shipment id.

## 3. One observation, one alert

The event worker **re-runs every handler of an event when any one throws**. A handler that told two people
before failing on the third therefore runs again for all three — so de-duplication cannot be a convention. It is
database-enforced: each alert carries an `alertKey` (kind · order · person · observation), the bus derives
`domain_events.dedupe_key` from it, and the partial unique index refuses a second. The three pieces are the
repo's existing pattern: a JS registry key, a matching SQL trigger branch, and tests pinning them together.

- The key for a stage comes from the **outbox event's own id**, stable across redelivery. With none, it comes
  from a hash of the shipment's own record — a missing identity can never become a random key that defeats the
  dedupe.
- A handler that fails for one person still tells the **others** (whichever one fails — the test fails the first,
  the middle and the last), then throws, so the worker retries and completes only the missing alert.
- **Storm control.** An estimate change is keyed to a **30-minute window of the revision's own recorded time**,
  so a burst of edits is one alert per person, the same revision replayed is the same alert whenever it is
  replayed, and a later window is a new alert. A **superseded** (late-entered, older) revision announces nothing.
- **Replay re-attempts.** Replaying a revision request — including a request that lost the insert race to an
  identical one — re-attempts the alert and never repeats a delivered one, so a missed alert is recoverable.
- A notification failure **never fails the revision** that was already recorded and audited.

## 4. Where this differs from the plan, and why

1. **Part B said "no schema". It needed one migration** — recorded as **Amendment A2** in Part B. The idempotency
   the same row demands is only real if the database enforces it, and that is a trigger-function branch. The
   migration also registers the governed template, because the registry **fails closed** and the existing
   `logistics_update_v1` says "Shipping request … update". The three existing branches are carried over
   byte-for-byte, and a PGlite check runs the same inputs through the old and new function.
2. **Two event types, not one** — an exception is **high priority** (as the legacy notice is) and the rest are
   ordinary; a policy has one priority, so priority needs its own event type.
3. **Estimate dedupe is keyed to a time window, not to the observation id.** The Part B contract said
   "(kind, subject, observation id)". A key that included the revision id would make every edit its own alert,
   which is the storm. The window is derived from the revision's own time, so the same observation still cannot
   alert twice.

## 5. Defects found by the work itself, and fixed

- **A "no effect" survivor that was a fixture blind spot (N4).** Every fixture resolved the *same* shipment for
  every person, so "any resolved shipment counts" passed. A co-loader with their own shipment on the container
  is now a test, in both directions.
- **One defence hiding another (N30).** A superseded revision's alert was suppressed — but by the **window key**,
  because the mock stamps every row "now", so the supersede check could be deleted unseen. The test now pins the
  clock so the superseded revision lands in a *later* window.
- **A mock default hiding a wrong field (N35).** The alert window was read from `observed_at` instead of the
  recorded time; the mock fills `created_at`, so a wrong choice looked identical. A test now makes them differ.
- **An untested race (N34).** Losing the insert race to an identical request was never exercised. (My first
  wrapper did not fire — chained mock calls return the raw chain — and the test's own "the race was actually
  exercised" assertion caught it.)
- **A partial-failure test that could not see the bug.** It failed the *last* recipient, so a handler that
  aborts at the *first* failure passed. It now fails each in turn.
- **Order-dependence in my own tests**, and a fixture id that contained another as a substring — both fixed.
- The established lesson from the R4 incident is applied: payloads in the pipeline tests are **the notifier's
  actual output**, and the governed registry is **parsed out of the migration**, so neither can drift from
  reality.

## 6. Evidence

| Check | Result |
|---|---|
| CAP-08 tests (`trade-os-t11-cap-08-journey-alerts.test.js`) | **66 / 66** |
| Real-Postgres check (PGlite) | **23 / 23** — the new identity, the unchanged Email 1.0 branches, privileges, the template, idempotent re-apply, Down |
| Migration mutation | **19 / 19 killed** for the right reason |
| Notifier + estimate-wiring mutation | **35 of 36 killed.** The one solo survivor (N2: removing the notifier's own left-behind gate) is **masked** — `resolveJourneyShipment` already returns no shipment for such cargo, and the Journey has its own branch, so there are three layers. Removing the helper's guard **and** the notifier's gate together (N2c) is **killed by 23 tests**, so the behaviour is protected |
| Policy / subscription / template / registry / server / migration-wording mutation | **13 / 13 killed** (a 14th was an identical-text placeholder I wrote; the script refused to count it, so it is discarded) |
| Journey, T7, Communications, email, outbox, T8, T11, T12 and migration suites (53 files) | **1,117 / 1,117** — including the three gates that enforce an emitter literal, an addressable recipient, and a template registered by a migration |
| Wider regression (24 `trade-os-*` + 76 `diaspora-*` files + new) | **2,300 tests · 2,292 pass · 7 skipped · 1 fail** — the same pre-existing `diaspora-logistics-rfq.test.js:236` (a T3 fixture whose hard-coded dates are now in the past). Up from 2,234 by exactly the 66 CAP-08 tests |
| CI | the new check is wired in beside T10/T11/T12/CAP-04/CAP-05 |

## 7. What this does **not** prove

- **Nothing here ran against staging.** The migration is **not applied**, and **it must be applied before the
  code is deployed**: with the registry present and the template absent, every alert would dead-letter at render
  time (a test shows exactly that). Without the database trigger branch the alerts would still send but a retry
  could double them. This is added to the staging-convergence plan: migrations `20260920`, `20260921`,
  `20260922`, then the code.
- **The legacy exception notice still goes to the operator** (D3 is undecided). A buyer therefore gets one
  Journey exception alert and the operator one legacy notice. If D3 is later approved so the legacy notice also
  addresses the buyer, buyers would get **two**; that approval should retire one of them.
- **The Journey's Messages tab is still "not yet composed".** The alerts appear in T7's own inbox; the Journey
  does not list them. That would be a read-side composition of a person's own notices and was not built.
- **A person's own notification preferences are T7's logic and unchanged.** These alerts are capped to in-app by
  policy; whether a user can mute in-app notices is not something this unit tested or changed.
- **Priority is ordinary for departed, arrived and estimate changes** — a deliberate choice, not a finding.
- **Recipients are resolved when the event is processed, not when it happened.** A worker retry minutes later
  tells whoever is then on the shipment.
- **A window boundary can produce two estimate alerts a moment apart,** and a later revision inside an
  already-announced window is not announced again — the text carries no date, and the Journey shows the latest.
- **Delivery timing is the event worker's** (1-second polling, five attempts, then dead letter), unchanged.
- **No real provider is integrated**; the only estimate revisions that exist are an operator's own declarations.

## 8. Next

CAP-09 — derived analytics from real observations only, with an "insufficient data" guard. Then staging
convergence in the order above, and the real-data UAT that remains held on D4.
