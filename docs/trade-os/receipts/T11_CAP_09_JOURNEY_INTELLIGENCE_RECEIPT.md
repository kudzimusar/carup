# T11-CAP-09 — Journey intelligence: derived statistics · Receipt

**Specialist gate: `SPECIALIST GATE PASSED`** at unit, composed-service and stubbed-browser level.
Recommendation: `RECOMMEND ACCEPT — T11-CAP-09`. The Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Builds on | CAP-08 (`2ba8347f`) |
| Frozen code modified | **none** |
| Schema | **none** — no table, no migration; a read-only derivation |
| Staging / production | nothing deployed; production untouched |
| Real data | none read or written |

## 1. What this is — and the three things it refuses to be

The Journey now carries a **Statistics** section: how long this shipment has been moving, how an arrival
compared with its first estimate, and — where enough has happened — how long this organiser's sailings on the
same route have taken. It is arithmetic on dates somebody **recorded**. It refuses to be:

1. **A number from anything but an observation.** A planned departure and an estimated arrival are intentions;
   they never become a transit time. An arrival is compared with the **first** estimate and only once there is an
   arrival, because an estimate is not an arrival. Where there is nothing to derive from, the value is **absent**
   (`null`, with the reason beside it) — never zero standing in for "unknown". Zero is kept for what it is: a real
   answer ("it arrived on the date first estimated"), distinct from no answer.
2. **A statistic that hides its own thinness.** Below a stated minimum the answer is *not enough data* — and
   that answer **does not say how many** journeys exist, because a count below the minimum is itself information
   about other journeys. The minimum (five sailings) is stated to the reader.
3. **A prediction.** Every statistic says it describes what was recorded and journeys already completed, and is
   "not a prediction for your shipment". No field forecasts, and a test scans for the words.

## 2. The decision this unit makes, and the one it leaves to the Moderator

A route statistic is a statistic about **other journeys**, so *which* journeys is a privacy and policy question,
not a technical one. This unit takes the conservative answer:

- **Only the same organiser's own completed sailings.** Another tenant's operational data is never read into a
  customer's statistic (a test puts twenty of another organiser's sailings beside four of this one's, and the
  answer is still "not enough"). The customer sees their organiser's own track record, with nobody named.
- **It counts sailings, not shipments.** Nine co-loaders on one container are one voyage; counting them as nine
  would present a single sailing as a track record. A sailing with several shipments contributes one value (their
  median), not a weight.
- **Only observed journeys.** A shipment counts only if both its departure and its arrival were recorded; an
  impossible duration (arrival before departure) is dropped; deleted shipments and the journey's own shipment are
  excluded; a shipment with no organiser or without both ports is **fail-closed** ("no route to compare"), not
  guessed.
- **Only aggregates leave the module** — the median, shortest and longest in whole days. A test puts secrets in
  every other field of the compared shipments and proves none reaches the response.

**Decision D8 — for the Moderator.** Whether statistics may eventually be built across organisers (more data,
and a different privacy posture), and whether five sailings is the right floor, are policy choices. Both are
named constants, not hidden behaviour; nothing here pre-empts them.

## 3. What was built

- **[journeyIntelligence.js](../../../backend/services/diaspora/journeyIntelligence.js)** — `median`,
  `projectOwnMetrics` and `projectLaneStatistics`, with `MIN_SAILINGS = 5`. The lane statistic is **one read**
  however many sailings exist (a test grows the history from 5 to 150 and the read count does not move).
- **The Journey** composes it only for a shipment it **plainly** resolved — the order's own, or the one its
  container sails on. Cargo that did not travel, an ambiguous association and an inconsistent one (a shipment on a
  different container than the booking) each say there are no statistics rather than computing them over a
  disagreement. The section cannot move the journey's state (asserted), writes nothing (a trap on every write),
  and carries a provenance entry saying it is derived from recorded dates, stored nowhere, predicting nothing.
- **Web:** a *Statistics* card on the Journey tab. Unknown or missing figures show the reason, not a zero; the
  insufficient route says "not enough" and states the **threshold** from its structured field — not the count;
  and a payload that contradicts itself (an "insufficient" comparison carrying a median) is refused rather than
  shown. A service that predates statistics shows no card and says nothing about them.

## 4. Defects found by the work itself, and fixed

- **Doubled guards hid single-layer removals (I6a/I6b).** Tenant, route, own-shipment, deleted and unobserved
  exclusions are each enforced twice — in the query and again in code. Removing either layer alone is invisible,
  which is the design working. Each **combined** mutant (both layers removed) is killed, so the behaviour is
  protected; the two single-layer tenant survivors are reported as such rather than hidden.
- **Whole-day fixtures hid a rounding defect (I17).** Every fixture duration was an integer, so removing the
  rounding changed nothing. Real durations have hours in them; two tests now use fractions.
- **A mutant that proved nothing (J4).** My "N+1" mutant added a *constant* number of queries, which a growth
  test correctly cannot see. I replaced it with a genuine per-row query, which the bounded-reads tests kill.
- **A self-contradicting payload (WS8).** The page would have shown a median the payload itself called
  insufficient. It is now refused, and tested.
- **A duplicated sentence found only by reading the rendered text.** The insufficient state said "Not enough
  completed sailings…" twice, once as the headline and once as the service's note. The second line now comes from
  the structured `minimum_sailings` field, not from cutting up a sentence.
- **My tooling failed silently once** (the web mutation pass printed nothing because an environment variable was
  unset); I noticed the empty output and re-ran it unfiltered rather than assume.
- Two tests carried drafting debris (unused variables, an assertion-free second render); both were cleaned before
  any mutation result was taken.

## 5. Evidence

| Check | Result |
|---|---|
| CAP-09 backend tests | **47 / 47** |
| Intelligence + composition mutation | **32 of 34 killed**, test count constant at 47 (no crash counted as a kill). The two survivors are the single-layer tenant filters (I6a, I6b); their combined form **I6c is killed**. The same holds for the route, own-shipment, deleted and unobserved filters, whose combined forms are all killed |
| Web, the two Journey files | **178 / 178** |
| Web mutation | **18 / 18 killed** (one only after a test was added, WS8) |
| Targeted backend (Journey, T7, Communications, email, outbox, T8, T11, T12, migration — 54 files) | **1,164 / 1,164** |
| Wider regression (24 `trade-os-*` + 76 `diaspora-*` files + new) | **2,347 tests · 2,339 pass · 7 skipped · 1 fail** — the same pre-existing `diaspora-logistics-rfq.test.js:236` (a T3 fixture whose hard-coded dates are now in the past; reproduces on an untouched tree). Up from 2,300 by exactly the 47 CAP-09 tests |
| Web, `src/pages/diaspora` + `src/hooks` | **34 files · 599 / 599** |
| Type-check (`tsc -b`) | exit 0 — **targeted negative control exit 2**: reading `intelligence.own` without narrowing the availability is rejected |
| Lint | 0 errors; 1 warning that already existed in the shared hook, unchanged |
| Build | exit 0 |
| Browser | Chromium at 1280 and 390 against a **stubbed API with synthetic fixtures**, four variants each (sufficient route, insufficient route, arrived, not yet departed): page-level overflow **0** in all eight; three screenshots filed privately (`~/carup-launch-evidence/t11-cap-lr01/cap-09/screens/`, not committed) |

## 6. What this does **not** prove

- **Nothing here ran against staging or any real journey.** On real staging data the route statistic will almost
  certainly read "not enough data", which is the designed, honest outcome — there are not yet five completed
  sailings by one organiser on one route.
- **These are RECORDED dates, not true times.** A transit time is the interval between when an operator recorded
  the departure and when they recorded the arrival. T11 allows a first movement to be back-dated and an arrival to
  be recorded late, so the statistics describe recording behaviour as much as sailing. They are labelled
  "recorded", and that is the limit of what they can claim.
- **Routes match on the ports exactly as recorded** (trimmed, case-sensitive). "Dar es Salaam" and
  "Dar Es Salaam" are different routes. That can only make a statistic rarer, never invent one.
- **A completed sailing is counted by its container.** A shipment with no container counts as its own sailing.
- **Only the most recent 500 completed shipments on a route are read.** That can only make a statistic more
  conservative.
- **"Compared with the first estimate" relies on T11's estimate being the original.** T11 has no function that
  updates a shipment's estimate (a CAP-05 finding); if one is ever added, this comparison silently changes meaning.
- **"Days so far" uses the server's clock** and is rounded down.
- **Every viewer the Journey admits sees the same aggregates**, including co-loaders and administrators; nothing
  here is private to the buyer. The organiser is not named, but the customer is told it is "this organiser's"
  history — which is D8's question.
- **No prediction exists.** Nothing here estimates when a shipment will arrive; it was never in scope.

## 7. Next

Staging convergence, in this order: the three held migrations (`20260920090000`, `20260921090000`,
`20260922090000`) through the repo's real staging workflow, **then** the code that depends on them. CAP-STG01's
real-data UAT remains held on D4. After that, the final return packet.
