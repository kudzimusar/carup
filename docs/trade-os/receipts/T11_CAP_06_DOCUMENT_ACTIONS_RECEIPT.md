# T11-CAP-06 — Documents and next steps, composed into the Journey · Receipt

**Specialist gate: `SPECIALIST GATE PASSED`** at unit, composed-service and stubbed-browser level.
Recommendation: `RECOMMEND ACCEPT — T11-CAP-06`. The Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Builds on | CAP-05 (`895329d0`) |
| Frozen code modified | **none** — T8's workspace is *called*, not changed |
| Schema | **none** — no table, no migration; a composition |
| Staging / production | nothing deployed; production untouched |
| Real data | **none read or written** (association held on D4) |

## 1. What this unit is, and the one thing it is not

The Journey now shows **the shipping documents and who is waiting on whom**, composed from records other
layers own. It is not a document system and not a task system:

- **Documents are T8's.** The Journey calls T8's own `buildDocumentWorkspace` and trims the result to the
  six shipping documents (bill of lading, commercial invoice, export certificate, inspection certificate,
  insurance certificate, packing list). It does not re-implement who may see a document or what state a
  document is in, and it forwards **no document id, no user id (who supplied or reviewed), no storage path
  and no extraction id**.
- **Next steps are derived, never invented.** A step exists only where a record says someone must act:
  a document T8 reports `REQUESTED` or `REJECTED`, a document `AWAITING_REVIEW`, or an exception the
  Journey already established (ambiguous shipment, shipment exception, port disagreement, order/container
  mismatch). A merely **missing** document is *not* a demand; a verified, present or not-applicable one asks
  for nothing. An empty list is worded as "nothing is recorded as waiting", with the service's own caveat
  that **an empty list does not mean nothing is needed**.
- **Not the T7 half.** The CAP-05 receipt promised "documents and next actions composed from T8 and T7".
  Only T8 and the Journey's own recorded exceptions are composed here. T7 (notifications) is **CAP-08**;
  nothing in this unit tells anyone anything.

## 2. A finding that shaped the design (recorded, not fixed)

**T8's authority for an order's documents is narrower than the Journey's.** It does not admit a tenant
admin or an assigned participant, both of whom the Journey admits. Rather than widen T8 (frozen) or hide the
Journey from them, the section reports what is true: for those viewers it says **`withheld`** — "The
documents for this order are not available to you here." — and the rest of the Journey renders normally.
`withheld` (a refusal) and `unavailable` (T8 could not be read) are different states with different words,
and **neither is "there are none"**. Whether those viewers *should* see document states is a product question
for the Moderator; this unit does not decide it.

## 3. What was built

- **Service** [journeyProjectionService.js](../../../backend/services/diaspora/journeyProjectionService.js):
  `composeDocuments` (T8 composed → `composed` / `withheld` on `ForbiddenError` / `unavailable` on any other
  error, logged, fail-soft), `deriveActions`, `JOURNEY_DOCUMENT_TYPES`, and a `documents` provenance entry
  naming T8 as the authority. A booking with no order has `documents` and `actions` both `not_applicable`.
  **Documents never move the journey state.** Composing documents adds a constant number of reads — a test
  varies both versions of one document *and* distinct document types and asserts the query count is unchanged.
- **Who it is waiting on.** `kind` is `YOUR_ACTION` or `WAITING_ON`. For the buyer a requested/rejected
  document is `YOUR_ACTION`; for anyone else it becomes `WAITING_ON` *the buyer*. A document awaiting review
  is `WAITING_ON` *CarUp review* **for everyone** — never an action for the buyer. Organiser-side problems
  wait on *the organiser*. A shipment exception is worded "this is not a customs decision".
- **Web:**
  [useTradeLogisticsApi.ts](../../../web/src/hooks/useTradeLogisticsApi.ts) types the new sections
  (mirroring the backend); [journeyDisplay.ts](../../../web/src/pages/diaspora/journeyDisplay.ts) holds the
  wording; [JourneyArrival.tsx](../../../web/src/pages/diaspora/JourneyArrival.tsx) renders a real **Documents
  tab** (counts, each document in T8's own words with version / supplied / reviewed dates — **never who** —
  T8's own disclaimer, and a link to the document workspace for the **order**) and a **What to do next** card.
  Unknown states fail honestly: an unrecognised document state reads "Status not recognised" (never "Not
  supplied"), an unrecognised section state reads "could not be read" (never "no documents"), and an
  unrecognised next-steps state shows the not-connected placeholder rather than vanishing.
- A link is followed **only** if the page understands it — `document_workspace` on an `import_order` — and
  is built from the named subject, never from an address the data supplied.
- **T8 parity without touching T8.** T8's page exports no wording and is frozen, so the labels are mirrored
  and a test **reads T8's own source** and fails if any state's label differs: a document reads the same on
  the Journey and in the workspace.

## 4. Defects found by the work itself, and fixed

1. **A read failure was worded as a permission refusal.** With documents `unavailable`, the steps note said
   the documents were "not available to you here". It now says they "could not be read right now"; `withheld`
   keeps its own wording. Found by reading the code after the first green run; a failing test was written
   first, and two mutants (swap the two sentences) are killed.
2. **A survivor that exposed a blind test (D15).** The bounded-reads test varied the *versions* of one
   document type, which T8 collapses into one item — so a per-document query ("N+1") survived. The fixture now
   also varies distinct present types.
3. **Two test gaps found *before* mutating the web:** the fixture's subject id equalled its order id, so a
   workspace link built from the wrong id could not be caught (a cargo-booking case now pins it to the order);
   and nothing pinned a state's *colour*, so a rejected document in green would have passed.

## 5. Evidence

| Check | Result |
|---|---|
| Journey projection + route tests | **95 / 95** (the projection file 86, of which **25 are CAP-06**) |
| Service mutation | **18 / 18 killed** for the right reason, test count constant at 86 (no crash counted as a kill). D15 first **survived** (§4.2); D10's pattern was rewritten by §4.1 so it was **retargeted and re-run**, not skipped |
| Journey-dependent + frozen T11/T8 backend suites (21 files) on the **final** code | **465 / 465** |
| Wider regression before the §4.1 fix (24 `trade-os-*` + 76 `diaspora-*` files + new) | **2,202 tests · 2,194 pass · 7 skipped · 1 fail** — the same pre-existing failure `diaspora-logistics-rfq.test.js:236` (a T3 fixture whose hard-coded dates are now in the past; reproduces on an untouched tree). Up from 2,178 by exactly the 24 CAP-06 tests then written |
| Web, the two Journey files | **113 / 113** (23 page + 16 display tests are CAP-06) |
| Web mutation | **26 / 26 killed**, total constant at 113 |
| Web, `src/pages/diaspora` + `src/hooks` | **34 files · 534 / 534** |
| Type-check (`tsc -b`) | exit 0 — **negative control exit 2** (an injected type error is caught) |
| Lint | 0 errors; 1 warning that already existed in the shared hook (unused directive), unchanged |
| Build | exit 0 |
| Browser | Chromium at 1280 and 390 against a **stubbed API with a synthetic fixture**; page-level horizontal overflow **0** on the Journey and Documents tabs; long state badges wrap onto their own line at 390 |

Screenshots are private evidence (`~/carup-launch-evidence/t11-cap-lr01/cap-06/screens/`), not committed.
The only console errors in the browser run were the app shell's CSRF fetch hitting the stub with a wildcard
CORS header — a harness artifact, not the Journey page. The web mutation WD23 ("a withheld viewer is
offered the workspace") was in fact killed by the *no-order* test; the withheld branch renders no link at all
and a test asserts that, but that exact mutant was not run.

## 6. What this does **not** prove

- **Nothing here ran against staging or any real document.** The T8 states are proven against T8's own
  service over a mock database, not the live one. Real-data UAT remains held on **D4**.
- **"Requested" depends on T8's readiness rows.** Who or what creates a document request is outside this
  unit; if nothing creates one, no `DOCUMENT_REQUESTED` step will ever appear, and that would be correct.
- **"Waiting on CarUp review"** repeats T8's own state ("awaiting review"); this unit does not know *who* at
  CarUp reviews or how quickly.
- **The Journey does not upload, download or open a document** — it links to the workspace, which is T8's.
- **Customs documents are not shown** — they are CAP-07's.
- **Tone colours are not mirrored from T8** — the labels are pinned to T8's source; the colours are this
  page's own (a test pins only that a verified document is green and nothing else is).
- **Viewers T8 refuses (tenant admin, participant) see no document states** — see §2; a decision for the
  Moderator, not made here.

## 7. Next

CAP-07 — destination and customs composed from T12 (the gateway is not the destination; a customs case must
belong to the resolved shipment; a hold is not a decision). Then CAP-08 (alerts through T7) and CAP-09
(derived analytics, only from real observations).
