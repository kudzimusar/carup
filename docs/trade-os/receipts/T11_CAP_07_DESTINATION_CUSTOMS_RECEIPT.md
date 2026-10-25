# T11-CAP-07 — Destination and customs, composed into the Journey · Receipt

**Specialist gate: `SPECIALIST GATE PASSED`** at unit, composed-service and stubbed-browser level.
Recommendation: `RECOMMEND ACCEPT — T11-CAP-07`. The Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Builds on | CAP-06 (`a99d2c3f`) |
| Frozen code modified | **none** — T12's status and case services are *called*, not changed |
| Schema | **none** — no table, no migration; a composition |
| Staging / production | nothing deployed; production untouched |
| Real data | **none read or written** (association held on D4) |

## 1. What this unit is, and what it refuses to be

The Journey now shows **customs status, the clearing agent, and where the cargo is going**, composed from
records other layers own. It is not a customs system and it **never states a customs outcome of its own**:

- **Customs is T12's.** The Journey calls T12's own participant status (`getMyCustomsStatus`) and forwards
  it. It does not re-derive a step, an amount, a sentence or a handoff, and a test deep-compares every
  forwarded field with T12's own output. T12's wording — "Reported, no document", "Release reported", "Not
  yet assessed", "an assessment is the agent's figure, not the authority's" — arrives unchanged, because the
  page imports T12's own display module rather than copying it.
- **A gateway is not a destination.** T12 already keeps gateway arrival, destination arrival, release,
  collection and delivery as separate observations with an explicit note; the Journey forwards that and the
  page renders each on its own line. A customs observation never moves the Journey's state, never fills the
  shipment's arrival date, and never enters the movement timeline (all three asserted).
- **The port of discharge is not the destination either.** The Customs tab opens with a *Where it is going*
  card that shows the **port of discharge (from the shipment record)** and the **destination (from the
  order)** as two separate facts, for every viewer, with a note that the port is where the shipment is
  unloaded and is not the final destination. The shipping references are relabelled **Port of loading /
  Port of discharge** (they said "From / To"), and the header route now says what it is made of — *ports on
  the shipment record* or *places on the order* — so a discharge port is never read as the end of the trip.
- **The clearing agent** is named by display name and role only — never an id, never a licence reference, and
  never a claim that CarUp verified anything.

## 2. The authority problem, and how it is closed

**T12's authority is narrower than the Journey's.** `getMyCustomsStatus` admits only the cargo booking's own
buyer. Platform admins, tenant admins and assigned participants — all of whom the Journey admits — are
therefore told the section is **`withheld`**, in the same words every time. That answer is **identical whether
or not a case exists, and whether or not the case is consistent** (a test compares the three), so the
section is not an oracle for customs cases.

**G10 — a case carries a shipment id nobody verified.** `openCase` accepts `shipment_id` and
`import_order_id` from its payload and checks only that the shipment *exists* and the operator owns its
container. So a case keyed to one booking can name another order's shipment. The Journey now:

1. calls T12 first, so **T12's own authorisation decides who proceeds** — checking the case first would let a
   non-owner probe whether a mismatch exists (a mutant that does this is killed);
2. only then compares the case's shipment and order with what the Journey resolved;
3. on any disagreement — a different shipment, a different order, or a case naming a shipment when the Journey
   resolved **none** — shows **nothing from the case** (no reference, no agent, no events), raises a
   `CUSTOMS_CASE_MISMATCH` exception on the Journey tab, and adds a step *waiting on the organiser*.
   A case linked to no shipment contradicts nothing and is composed. A case on a container-level shipment
   matches when the Journey resolved the same shipment by container.

The T12 defect itself (no validation at `openCase`) stays where Part B classified it — **recorded, not fixed**
— because the Journey-level guard makes the unverified id harmless to this surface.

Every other state says what it is, and none is "no customs": `not_applicable` (no container booking, or cargo
that did not travel), `ambiguous` (several bookings on one order — by booking it composes),
`unavailable` (T12 could not be read; fail-soft, never fails the Journey), `disagrees`, `withheld`.

## 3. What was built

- **Service** [journeyProjectionService.js](../../../backend/services/diaspora/journeyProjectionService.js):
  `composeCustoms` (one T12 call plus one case lookup — a constant number of reads however many customs events
  exist), a **whitelisted** forward (a test pins the exact key set so a new T12 field cannot reach the
  Journey by accident), `contacts.agents` composed from the same read and following the same availability, a
  `customs` provenance entry naming T12, and one new step: **customs documents the agent asked for and nobody
  has supplied** are the buyer's action, linked to the customs page. Only a *recorded* request is a step; T12's
  "Next: …" is what has not been recorded yet, and an unrecorded step is not an obligation. The actions note
  now also says when customs steps are missing because customs was not shown.
- **Web:** a real **Customs tab** — destination card, T12's sentence and next step, the agent, duty and tax,
  payment, release, the separate handoffs, the step list in T12's states, the event list with T12's source
  strength, T12's own notes, and a link to the customer's own customs page. Unknown states fail honestly: an
  unrecognised step state reads "Status not recognised", an unrecognised source reads "Source not stated", an
  unrecognised section state reads "could not be shown … does not mean nothing has happened". A cargo with
  **no case** renders without inventing a checklist, an amount or a handoff.
- A customs link is followed **only** if the page understands it (`customs_status` on a `cargo_reservation`),
  built from the named subject and never from an address the data supplied.

## 4. Defects found by the work itself, and fixed

1. **A wrong assumption about T12's output — found by a failing test.** The customs-documents step read the
   checklist's `requested` flag, but T12's *participant* projection strips it, so the step could never fire.
   The recorded request is in the forwarded timeline (`DOCUMENT_REQUESTED`); the step now derives from that.
2. **A survivor that exposed an unexercised fallback (C27).** The "no agent" test always had a case, so T12
   supplied the note and the Journey's own fallback wording — used when no case exists — was never run. A
   no-case test now pins it, including that absence is never worded as "not needed".
3. **A missing test dimension, found before mutating:** nothing pinned the *exact* fields forwarded from T12.
4. **Two of my own test expectations were wrong** (the timeline legitimately holds the loading entry; a loaded
   cargo with no shipment is `LOADED`, not `NO_SHIPMENT`) — corrected against the real behaviour, not the code.
5. **A layout flaw found only in the browser:** the new "ports on the shipment record" qualifier landed in its
   own flex column at 390px. It now flows with the route text.

## 5. Evidence

| Check | Result |
|---|---|
| Journey projection + route tests | **126 / 126** (the projection file 117, of which **31 are CAP-07**) |
| Service mutation | **27 / 27 killed** in one clean run on the final code, test count constant at 117 (no crash counted as a kill). The first run had **two survivors**: one was a real gap (C27, §4.2); the other (C28) appended an empty string to an empty string — an equivalent mutant of my own making, **discarded, not counted** |
| Journey-dependent + frozen T8 / T11 / T12 backend suites (24 files) on the **final** code | **564 / 564** |
| Wider regression (24 `trade-os-*` + 76 `diaspora-*` files + new) | **2,234 tests · 2,226 pass · 7 skipped · 1 fail** — the same pre-existing failure `diaspora-logistics-rfq.test.js:236` (a T3 fixture whose hard-coded dates are now in the past; reproduces on an untouched tree). Up from 2,202 by exactly the 31 CAP-07 tests plus the 1 caveat test added after the previous shard |
| Web, the two Journey files | **153 / 153** (27 page + 11 display tests are CAP-07) |
| Web mutation | **28 / 28 killed**, total constant at 153 |
| Web, `src/pages/diaspora` + `src/hooks` | **34 files · 574 / 574** |
| Type-check (`tsc -b`) | exit 0 — **targeted negative control exit 2**: reading `customs.sentence` without narrowing the availability is rejected |
| Lint | 0 errors; 1 warning that already existed in the shared hook, unchanged |
| Build | exit 0 |
| Browser | Chromium at 1280 and 390 against a **stubbed API with a synthetic fixture**; the composed, **withheld** and **disagreeing** states each checked at 390: page-level overflow **0**, the destination card present in all three, no customs card for withheld or disagreeing, and the mismatch alert on the Journey tab only for the disagreeing case |

Screenshots are private evidence (`~/carup-launch-evidence/t11-cap-lr01/cap-07/screens/`), not committed. The
only console errors in the browser runs were the app shell's own CSRF fetch hitting the stub — a harness
artifact, not the Journey page. In the browser harness, a first attempt to switch fixture variants did not
take effect because each tool call has its own `globalThis`; the stub now reads the variant from the page's
`?v=` query. That was a harness fault, not a page fault. Web mutants WC28 ("a customs link offered where the
section is withheld") was killed by the *link-not-understood* test; the withheld branch renders no link at
all and a test asserts that, but that exact mutant was not run.

## 6. What this does **not** prove

- **Nothing here ran against staging or any real customs case.** T12's output is proven by T12's own service
  over a mock database. Real-data UAT remains held on **D4**.
- **The Journey forwards T12's claims, including T12's own wording** — for example T12 says "Every customs and
  destination step recorded for your cargo has been completed" when no step is outstanding. That is T12's
  sentence, not the Journey's, and it is as strong as T12 chose to make it.
- **Customs steps appear only for the booking's buyer**, because that is who T12 admits. A platform admin or
  tenant admin sees the section as withheld; the coordinator's own view is a separate T12 surface this unit
  does not touch.
- **A customs-documents step needs a recorded `DOCUMENT_REQUESTED` event and an unsatisfied Documents step.**
  The Journey cannot tell several requests apart, or whether a later one was answered.
- **`CLOSED` cases produce no steps**, and the Journey does not say why a case closed.
- **The clearing agent is not verified by anything.** The page shows a display name and role; the licence
  reference T12 holds (and labels as unverified) is deliberately not forwarded.
- **Payments remain not composed** (T13 is partial) and **notifications** are CAP-08.
- **The header/port wording is this programme's own (CAP-03) and was changed here**; no frozen page was edited.

## 7. Next

CAP-08 — Journey alerts through T7 (in-app only; the buyer and co-loaders as recipients; idempotent; no real
WhatsApp or email without the Owner's own words). Then CAP-09 (derived analytics from real observations only,
with an "insufficient data" guard), then staging convergence — applying the two held migrations
(`20260920090000`, `20260921090000`) through the repo's real staging workflow.
