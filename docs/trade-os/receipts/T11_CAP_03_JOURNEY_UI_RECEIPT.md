# T11-CAP-03 — Journey & Arrival experience · Receipt

**Specialist gate: `SPECIALIST GATE PASSED`** for the page, its wording and its wiring, at unit and
stubbed-browser level. Recommendation: `RECOMMEND ACCEPT — T11-CAP-03`. The Moderator holds acceptance.

| | |
|---|---|
| Programme | T11-CAP-LR01 · Journey & Arrival |
| Canonical role | `JOURNEY EXPERIENCE SPECIALIST` |
| Builds on | CAP-02 (`0c9d3c54`) |
| Frozen code modified | **none** — two shared files gain additions only (68 insertions, 0 deletions) |
| Schema / migrations | none |
| Staging / production / real data | not touched |

## 1. What was built

- [JourneyArrival.tsx](../../../web/src/pages/diaspora/JourneyArrival.tsx) — route
  `/diaspora/journey/:subjectType/:subjectId`. A **view** over the CAP-02 projection; it records nothing.
- [journeyDisplay.ts](../../../web/src/pages/diaspora/journeyDisplay.ts) — the pure wording module (the
  words a customer reads), reusing T11's own departure/arrival wording so both pages read identically.
- `useTradeLogisticsApi.ts` — `getJourney` and the `Journey` types (additive, in the shared hook so the
  API base URL, the production-pointing guard and the auth headers have one source). `App.tsx` — one
  import and one route.
- CarUp's own design language (the T11 slate/orange system); no BE FORWARD branding or assets.

## 2. The experience

**Header:** the recorded vehicle (or "Your vehicle" — a request is never shown as a vehicle), the route
(shipment ports first, the order's places as a labelled fallback, otherwise "Route not recorded"), a
state badge, the sentence the service produced, and the **last recorded update** with its time.
**Tabs** — Journey · Documents · Vehicle · Payments · Customs · Messages (a real `tablist`).
**Journey tab:** exception alerts; *Leaving* and *Arriving* cards; the recorded timeline, each row with
its **source in words** ("Recorded at loading" / "Source not stated"); a vessel-and-route note; shipping
references labelled as paperwork; a next-steps note; and **"Where this comes from"** naming the owning
record of each part in plain language (no internal codes).
**Vehicle tab:** recorded fields with "Not recorded" for gaps; chassis and engine rows only if the
service sent them; the consignee card only if the service sent it, labelled "Only you can see this".
**Documents / Payments / Customs / Messages:** each says it is **not connected to this view yet**, and
that this is not a statement that nothing exists.

## 3. The rules the page holds

- A plan is worded as a plan, an estimate as an estimate; only an observed date is "Departed" / "Arrived".
- A section the projection has not composed is never rendered as an empty list.
- A field the service did not send is **not rendered at all**, so a private value cannot appear through a
  layout that expected it.
- An ambiguous shipment shows **no dates, no references, no carrier**, and says why; a customs hold says
  "not a customs decision".
- The full order id is never printed — only a short reference.
- Every state the backend can produce has wording; a test reads the service source and enforces it.

## 4. Evidence

| Check | Result |
|---|---|
| New web tests | **47 / 47** (wording module + page) |
| Affected areas (`pages/diaspora`, `components/layout`, `hooks`) | **36 files · 491 tests · all pass** |
| Mutation test (12 mutants) | **12 / 12 killed**, originals restored and re-verified: a state losing its wording; "No documents" wording; chassis rendered unsent; full order id printed; legs note hidden; engineer code shown; customs hold loses its caveat; every tab "selected"; next-steps note hidden; departure derived from the plan; ambiguous shipment still showing dates; consignee shown unsent |
| Type-check (CI command `tsc --noEmit -p web/tsconfig.app.json`) | exit 0. **Negative control:** a planted type error → exit 2 naming the file and line |
| ESLint on the new files | exit 0. **Negative control:** a planted `var` → exit 1 naming the rule. The two shared files: no new problems (1→1, 2→2) |
| Production build (`tsc -b && vite build`) | exit 0; the Journey page is in the bundle (the large-chunk warning pre-exists) |
| Real-browser check | page loaded in Chromium at **1280, 820 and 390 px** against the real dev server, with the API stubbed in the browser (§5): no page-level horizontal scroll at 820 or 390 (the tab strip scrolls inside its own container); the ambiguous, vehicle and documents states checked in the DOM; 6 screenshots kept privately |

## 5. What this does **not** prove

- **The visual check is not UAT.** It used a **stubbed API with an obviously synthetic fixture** — no
  staging, no real transaction, no real vehicle. The dev server's API base was pinned to a dead local
  port and every non-local request was aborted, so nothing could reach a real service.
- The full web suite (185 files) was **not** run: swap on this machine was at ~15.6 of 16 GB, which my
  notes say turns slow tests into bogus failures. The 36 affected files were run at low concurrency.
- Documents, customs, payments, messages, agents, legs and next steps are **not composed** (CAP-04, 06,
  07, 08); the page says so rather than hiding it.
- The T4 passport still does not link to the Journey page (Part B decision **D1** is the Moderator's), so
  there is no navigation to it yet.

## 6. Harness findings

- **The shared `node_modules` is x64-native** (rollup, esbuild, lightningcss) on an arm64 Node, so
  vitest cannot start there ("Cannot find module @rollup/rollup-darwin-arm64"). Rather than mutate the
  shared install, tests were run in an **isolated, space-free git worktree** with its own arm64
  `npm ci -w web --ignore-scripts`. Files were copied in, then proven byte-identical before commit.
- **A service worker bypasses Playwright's `page.route`.** After the first load the app's PWA worker took
  over and the stubbed calls returned 503; blocking worker registration fixed it.
- **One unexplained transient:** a single screenshot showed the Documents tab selected although I never
  clicked it. It did **not reproduce** in six controlled cold loads with resizes (always Journey), so it
  is recorded, not explained.

## 7. Next

CAP-04 (additive vessel legs) and CAP-05 (observation layer + ETA history) are the first schema changes
and the first work that replaces a `not_yet_composed` placeholder with real data. The real-data end
remains held on D4.
