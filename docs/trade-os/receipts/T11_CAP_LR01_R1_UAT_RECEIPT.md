# T11-CAP-LR01-R1 — Real-data convergence, D2 remediation and physical UAT · Receipt

**Written for:** the Moderator, who set the R1 disposition and decides acceptance. Specialist gate language only; nothing here is self-acceptance.

**Production (`vhmnajoeicasaigiophh`): not accessed at any point.** Canonical staging still serves Garage `8353dbdd` (deployment
`dpl_76Zt2nhw…`); no alias moved.

## 0. The one-paragraph answer

D2 is fixed in T11 and in the Journey's own code. The Owner-authorised real purchase (a 2018 Honda Vezel) exists on staging as an
**additional** vehicle, order, shipment and declared vessel leg, created only from facts read off the Owner's BE FORWARD CAP page;
the existing Nissan Serena is byte-identical. Journey & Arrival was run physically, authenticated as the Kingston account, for the
Vezel (a rich international journey with plan-only evidence) **and** for the Serena (no Trade OS history at all), at phone, tablet and
desktop widths. Both render truthfully, borrow nothing from each other, and two unrelated ordinary identities are refused every
request for either, identically for what exists and what does not. The real alert path was certified on the real staging database
(§11) without committing a row. Along the way the physical run found seven defects of my own or of the platform's drift — listed in
§9 — all fixed or recorded.

## 1. Custody

| | |
|---|---|
| Remediation base | `32d5228d` (the previous return) |
| Parent (`feat/trade-os-client-demo-convergence`) | `577428de` — unchanged at every poll |
| **D2 fix** | `1a985971` |
| Vehicle subject + discoverability | `5cfccdf0` |
| Vezel seed (script, facts, tests) | `fe066465` |
| Journey wording found in the UAT | `95d23ab5` |
| Journey route + T8 route registration | `831fbeef`, `aa953e09` |
| Isolation probe, D9 harness (scripts and tests only) | `b54a0e18`, `26f64113` |
| **Deployed final candidate** | **`b1de03726866d46d9ce1a3c52eb6a6a930b9e016`** — branch `cert/t11-cap-lr01-r1-uat-candidate` (§2); it contains the feature branch through `aa953e09`. Everything the feature branch gained after that touches **no served code** (six files: the probe, the harness, its client, and their tests) — checked by `git diff` |
| Changed since the previous return (`32d5228d`) | 31 files, +3,441/−144. Served code: `shipmentTrackingService.js`, `journeyProjectionService.js`, `journeyAlertNotifier.js`, the Journey page and its display module, the API hook, the owner vehicle page and the import-order page (one link each), the feature registry and its governed manifest. **No migration** was added in R1 |
| Migration state | unchanged by R1: the three CAP migrations applied earlier remain applied; the Vezel records were written by an INSERT-only script |
| Backend Preview | `dpl_3YjzzxjkNWadqBpJ4rtdUkMPhKs8` · `carup-backend-staging-1vzys96ks-11-11.vercel.app` |
| Web Preview | `dpl_2NsEfzijAERNPf968ymBm4KDGNWG` · `carup-staging-84jumrkrx-11-11.vercel.app` |
| Pairing | proven from what is served: the web provenance file states commit `b1de0372…`, `unpaired: false`, API base = the immutable backend host above; the backend reports the same commit; a browser capture of every `/api` request shows exactly one host |

## 2. Why the candidate is an integration merge — a finding the Moderator should know

On 2026-10-16/17 staging's migration `ca_k3_auth_05_session_identity_authority` revoked the PostgREST role's access to
`public.user_sessions`. The Trade OS base (`577428de`) still writes sessions through PostgREST, so a backend built from it answers
**every correct sign-in with HTTP 500** — nobody can authenticate against current staging. This was measured, not inferred: wrong
passwords got a clean 401, the synthetic outsiders' correct credential got 500, `service_role` holds no privilege on the table, and
the Owner's own sign-in on the first Preview failed the same way.

The runtime canonical staging serves (`8353dbdd`) carries the dedicated session authority. The UAT candidate is therefore my branch
merged onto it. **Nothing in the Journey, D2, vehicle or seed code differs**: seven representative files were compared by git blob
and are identical. Six additive conflicts were resolved as unions (CI steps, one template entry, the event-identity registry, lazy
route imports, the vehicle page's actions, and the web build identity, where the sibling lineage's existing mechanism replaces my
`commitIdentity` helper). The merge is also a forward-compatibility result: the Journey runs on the current platform.

## 3. D2 — a shipment belongs to one order

*Defect.* `getMyShipmentTracking` took the first live shipment on the booking's container, so on a co-loaded container a participant
could be shown another order's carrier, tracking number, dates and timeline.

*Invariant, as ruled.* A booking may resolve only the shipment attached to **its own order and its own container**; sharing a
container is not an association; two live shipments for that one order/container fail closed; array order is never evidence.

*Delivered.* The T11 service change is surgical (one block). The same invariant reaches my own Journey: the old "container
association" tier is removed, so a co-loaded order is never shown, alerted about, or given statistics for another order's shipment,
and alert recipients are exactly the shipment's own order. 14 D2 regression tests cover: two orders on one container (either row
order), no shipment for the participant's order, left-behind and not-loaded unchanged, ambiguous duplicates, soft-deleted duplicates,
an order-less booking, operator and admin views unaffected, no other participant's detail, and a no-write trap. About thirty CAP-02/
CAP-08 tests that had encoded the retired co-loader behaviour were rewritten to the ruled rule with positive controls — not weakened.
Mutation: every mutant killed; the doubled guards (query filter + in-code filter) proven by combined mutants.

## 4. The Vezel — real data and its provenance

Facts were read from the Owner's own CAP page (private evidence bundle, never committed; the access token appears nowhere in this
repository). Every value in the seed carries its basis: `CAP_OBSERVED`, `SCHEMA_DEFAULT`, `SCHEMA_MANDATORY_PLACEHOLDER` (with the
existing CarUp convention it follows), `CARUP_CONVENTION` or `OWNER_AUTHORISED`.

| Record | Staging id | Content |
|---|---|---|
| Vehicle | `RU3-1316558` | 2018 Honda Vezel, grade Hybrid Z Honda Sensing, Pearl, 134,741 km, engine `LEB6736579`, hybrid, 2WD, automatic; owner = the Kingston account; **Pending / draft, not listed** |
| Import order | `3e2b66a0-1e8b-43c9-bd48-507f88016f71` | `vehicle`, Japan → Zimbabwe, status `IMPORT_REQUESTED` at creation; BE FORWARD ref `CD740269` in metadata only |
| Shipment | `f8cb8f50-ba8d-4cff-b515-1fb1fbe9c1fb` | `PLANNED`; Hoegh Autoliners K.K.; Shimonoseki, Japan → Dar es Salaam; ETA 2026-09-18 (date only, an estimate); planned departure 2026-08-29 in metadata |
| Declared leg | `1568f390-0179-43fb-bb6e-b622b9759992` | one leg, vessel `HOEGH TRACER (V-61)` **verbatim** (the parenthetical is not interpreted as a voyage), `OPERATOR_DECLARED` |
| Creation event | `ca6d91ed-…` | `PLANNED` "Shipment created" |

*Identifier policy.* CAP shows a chassis number and no separate VIN. CarUp's own Japan-import convention keys the vehicle on the
chassis (`docs/DIASPORA_TRADE_OS_MVP_ACCEPTANCE_MATRIX.md` row 24; `CARUP_REAL_LISTING_ELIGIBILITY_CONTRACT.md`). At 11 characters
it is below the marketplace-listing floor of 12 — it is not a listing and is not published.

*Deliberately not recorded* (no truthful representation; none invented): purchase amount (the schema forces `vehicles.price`, so the
existing "not listed for sale" `0` convention is used and labelled as a placeholder), duty, customs outcome, payment state, any
actual departure or arrival, release, delivery, inspection or government verification, agent, transshipment, any estimate revision,
the consignee's name/phone/street address, and CAP's per-stage workflow (it carries no times, so no `IN_TRANSIT`/`ARRIVED` was
backfilled). Attribution is honest: `created_by` and the audit actor are `NULL`; each row says it was recorded by this certification
run from the named evidence.

*How it was written.* A bounded, idempotent, INSERT-only script run from a certification branch (run `40161210296`, 13/13 steps).
The existing Serena is fingerprinted before and after inside the same transaction and the run rolls back on any difference. **I
verified it independently through the read-only connection**: Serena `GFC27-027051` md5 `e9d216b9ca1eb39440d9be8ab39123e6`
unchanged; vehicles 369 → 370; Kingston's other order (`921d09ed…`, an RFQ) untouched; zero Journey events; zero estimate revisions.
26 tests on a staging-shaped world with the real CAP-04/05 migrations; mutation 18/18 killed.

## 5. Physical UAT — the Vezel

Authenticated as `u_66cace85fad949e4` (Kingston Musarurwa), the Owner signing in themselves in a visible Chromium window.

| Check | Result |
|---|---|
| Identity | "2018 Honda Vezel"; the vehicle panel shows make, model, year, colour, mileage, chassis and engine (owner-only); nothing of the Serena |
| State | "Shipment set up — nothing moving yet" |
| Plan vs record | "Not recorded as departed — It was planned to leave around Aug 29, 2026. That is a plan, not a record that it left." |
| Estimate vs arrival | "Not recorded as arrived — Estimated Sep 18, 2026. An estimate can move, and it is not a record that anything arrived." (the ETA is already in the past; it is still not an arrival) |
| ETA history | "No change to this estimate has been recorded. It is the estimate on the shipment record." — no invented revision, no history card |
| Route | "Shimonoseki, Japan → Dar es Salaam · ports on the shipment record"; the port of discharge and the order's destination ("Zimbabwe") are separate facts, with the sentence saying so |
| Vessel / legs | exactly one leg, `HOEGH TRACER (V-61)`, "declared, not observed" |
| Timeline | one entry: "Shipment set up (a plan, not a movement)" — no movement |
| Documents | after the Owner's import: 3 of 6 supplied, all "Supplied — awaiting review · Nobody has checked it yet"; before it: 0 of 6 "Not supplied yet" (both captured) |
| Customs | "Customs tracking follows a container booking, and this order has none." — no outcome inferred |
| Actions | the three waiting-on-CarUp-review items, derived only from recorded state |
| Statistics | **"No organiser is recorded for this shipment, so there is nothing to compare it with."** — the directive expected "not enough data"; the shipment has no tenant, so there is no cohort to count. Same meaning, different words; reported rather than massaged |
| One journey, three ways | by vehicle, by order and by shipment return the identical journey (same reference, state, dates) |

## 6. Physical UAT — the Serena (the generalisation case)

`GFC27-027051`, a 2016 Nissan Serena Highway Star that CarUp already held, with **no** order and **no** shipment. The Journey page
identifies it, says "No journey yet", and states "No shipment, vessel, estimate, shipping document or customs record is connected to
this yet. That is not a report that nothing has happened — it means nothing has been recorded." Documents and Customs say there is no
order, not that something failed. No shipping card is rendered; every tab opens; no string from the Vezel appears anywhere on the
page or in the API response (checked by pattern, in both directions). Chassis and engine show because the viewer is the owner.

## 7. Isolation

- **Kingston** reads the Vezel by vehicle, order and shipment (200), the Serena (200), and his own unrelated RFQ order (200, with
  nothing of the Vezel in it).
- **Unrelated ordinary users.** The probe signs in as the staging project's own synthetic outsider identities (ordinary `owner` role,
  the same platform role as the purchaser, so the route admits them and the refusal measured is the service's) with the protected
  staging-only secret, against the final backend (workflow run `40167377258`, **PASS**): every request for the Vezel by vehicle,
  order and shipment, for the Serena, and for nonexistent vehicle and order ids is refused 403 with the same words, **identically
  for what exists and what does not**; no session is 401. The probe's judge is mutation-tested (9/9 mutants killed).
- **D2 at route level.** A physical co-loaded container was not created on shared staging (it would mean fabricating bookings); D2
  is proven by the 14 service regressions, the Journey's order-bound selection tests, and the alert-recipient tests. That is the
  limit of what was practical, stated plainly.

## 8. The Owner's media-and-forms task

The Owner asked for the CAP page's media to be downloaded and uploaded "to their places" and for the vehicle's forms to be filled.
Done in memory (bytes from CAP straight into CarUp's upload inputs; nothing with the Owner's personal details or the CAP token
touched disk):

| Item | Where it went | Result |
|---|---|---|
| Bill of Lading, Commercial Invoice, Export Certificate (PDF) | the order's Documents page (T8) | 3 × 201, `UPLOADED`, awaiting review |
| The same three | the vehicle passport's evidence, stage **Import** (Bill of lading / Commercial invoice / Export certificate), **Private** | 3 × 201, `pending` |
| All 50 gallery photos | the passport's evidence, stage **Import → Export-yard photo**, **Private** | 50 × 201, `pending` |

Side effects were checked after the first upload and again at the end: the only consequence beyond the records was the product's own
`IMPORT_REQUESTED → DOCUMENTS_PENDING` transition on the first order document; the shipment stayed `PLANNED`, stage events 1,
estimate revisions 0, domain events 0; the Serena unchanged.

**Not done, and why:**
- *Seller Studio (listing) form.* Its identifier rule requires at least 12 characters and the Vezel's real chassis `RU3-1316558` has
  11. The wizard will not leave step 1. I did not pad or alter a real identifier and nothing was saved. **Model blocker B1**: the
  listing flow cannot hold a documented 11-character Japanese chassis number.
- *The order page's "Request container space" form.* The purchase is on a vessel with no container; submitting it would invent a
  booking and start a coordinator workflow. Not applicable.
- *Trade profile.* Not tied to the vehicle.

**Token handling.** The CAP link carried a secret token and was pasted into chat by the Owner. It was used only inside the browser
session for this task; a scan of the repository, my scratch space, my worktrees and git history found it nowhere; BE FORWARD
cookies were cleared afterwards. It does remain in this session's transcript, which is outside my control — the Owner may wish to
let that link lapse.

## 9. Defects the physical run found

| # | Defect | Whose | Disposition |
|---|---|---|---|
| 1 | Nothing could sign in: the session table moved behind a dedicated authority (§2) | platform drift vs the Trade OS lineage | integration candidate; Moderator should know any UAT of `577428de` is impossible on current staging |
| 2 | The Journey route was never in the feature registry, so the runtime served it as HTTP 404 | mine (CAP-03) | fixed `831fbeef` |
| 3 | The T8 paperwork route the Journey links to had the same gap | T8's omission, in my user path | registered `aa953e09` |
| 4 | The shipment's creation stage printed as "Planned" beside a date — readable as a planned date | mine | now "Shipment set up (a plan, not a movement)" |
| 5 | For a vehicle with no order, Documents said "this booking", and Customs said "could not be shown" and printed an empty destination | mine | precise wording, tested |
| 6 | The first probe judged refusals as "[object Object]" (a flat test stub had hidden the real nested error shape) | mine | fixed; the stub now mirrors the real body |
| 7 | The first probe could not sign in at all: a bare POST is refused 403 by CarUp's CSRF guard, which says nothing about isolation | mine | the probe now makes the same two calls the browser does and reports which stage failed; a probe that cannot sign in no longer reads as a verdict |

## 10. Responsive and layout

Phone 390, tablet 768, desktop 1280 (and 1920 for the Vezel), both vehicles, every Journey tab used: no page-level horizontal
scroll, no element past the viewport edge, no critical fact clipped by its own box; the phone tab strip scrolls on purpose. The only
overlap seen on a phone is Vercel's own Preview toolbar (`<vercel-live-feedback>`), injected on Preview deployments and absent from
the canonical hosts. Network: one `/api` host throughout, no 5xx, no console errors except the intentional 403 for a nonexistent VIN.

## 11. D9 — does a Journey alert reach the right person on the real database?

**Result: bounded certification PASS** — workflow runs `40174488695` and `40174673754` (certification branch
`cert/t11-cap-lr01-r1-d9-alert-cert`, push trigger retired), 26 checks, 6 events and 6 notices created and **rolled back**.

It runs the exact deployed candidate's own code — the notifier, the event-bus insert (against staging's **real** dedupe trigger and
unique index), the estimate-revision service, and the communications pipeline against staging's **real** notification tables and
**real** governed template — for one explicitly chosen event at a time, inside one transaction that is always rolled back. There is
no worker, no polling, and outbound sends are disabled (the harness refuses to start otherwise).

What it proved: a departure produces exactly one alert, addressed to the shipment's own order's buyer, carrying the same short
reference the Journey prints and a path to that person's own journey and no other person, order or tenant; the real trigger derived
the identity from the alert key; the same observation delivered twice is one alert and a distinct observation is a distinct one;
an exception is its own event; an estimate revision (through the real service: authority, supersede, audit, announce) is announced
once however often replayed; a second order's shipment alerts only its own buyer and neither buyer is ever told about the other's;
each event became exactly one in-app notice from the governed `journey_update_v1` template in the registry's words, none outside the
app; and the harness's own refusals hold (an event it did not create, a non-Journey event, and any other event type are refused).
Afterwards, **on a separate connection** and again **through the read-only staging connection**: no fixture order or shipment, zero
Journey events, zero Journey notices, zero estimate revisions, the Serena byte-identical.

*Safety case.* Offline-tested (22 tests, mutation 18/18 killed): approved staging only; no `COMMIT` anywhere; ROLLBACK
unconditional; the code under test reaches the database only through a bounded client that names every table it may read and
write, throws on any other call shape and can only UPDATE/DELETE rows the run created, plus a raw-SQL guard admitting exactly two
statements; an event is delivered only if this run created it and it is a Journey alert; the people are staging's synthetic outsider
identities and the fixtures are labelled — the real purchase and the Serena are never read or written.

*What it does not prove* (stated as an environment limitation, not hidden): the event **worker's** claim-and-dispatch loop itself;
the PostgREST insert path the production runtime uses for `emitDomainEvent(null, …)` (the harness uses the equivalent direct insert
against the same table and trigger); and what a person **sees** when they open their inbox. A Preview cannot run the worker and the
canonical runtime must not be disturbed, so those residuals remain `BLOCKED_ENVIRONMENT — JOURNEY ALERT END-TO-END RUNTIME`.

## 12. Gates

| Gate | Result |
|---|---|
| Backend, full suite on the deployed candidate (sharded, 6 shards) | **9,474 tests · 9,426 pass · 0 fail · 39 skipped**; plus 9 *cancelled* in `oc5r-prov01-fx-observation-policy.test.js`, which are cancelled identically on the unmerged Garage baseline — environmental, not this work |
| Backend, targeted on the feature head | 559 pass (every T11/CAP test, the harness/probe/seed/client tests, communication-event coverage, migration integrity) |
| Real-Postgres (PGlite) migration checks | CAP-04 23/23 · CAP-05 39/39 · CAP-08 32/32 |
| Web, full suite on the deployed candidate | **281 files · 3,034 / 3,034**; `tsc -b` exit 0 (with a negative control); build exit 0; governed manifest in sync; 0 lint errors in the changed files |
| Mutation | D2 (14 mutants, combined mutants for the doubled guards) · vehicle Journey 13/13 backend and 8/8 web · seed 18/18 · isolation probe 9/9 · bounded client 10/10 · D9 harness 8/8 — a solo survivor was investigated every time; each was a redundant second layer, proven by a combined mutant or closed by a new test |

### 12a. The draft PR's own CI, on head `9a0f3878` (read from the Actions API; nothing re-run to improve it)

| Check | Result | What it is |
|---|---|---|
| Passport foundation contracts · communication-postgres · communication-unit · playwright · staging-integration · referral-ci | **pass** (6) | — |
| `backend-and-build` | **fail — one test of 1,458** | `diaspora-logistics-rfq.test.js:236` (T3 sailing match), `0 !== 1`. Its fixture hard-codes `departure_date 2026-10-15` and `booking_deadline 2026-10-01`; both are now past, so the sailing is correctly filtered out. **Proven rather than assumed:** on the real clock it fails (17/18); with the clock pinned to 2026-09-20 it passes (18/18). This PR changes no T3 file; the same test was already the single failure in the first return. The secret-scan guard and migration-sanity steps in this job **passed**. |
| `Bootstrap` → `Aggregate` | **fail — a refusal, not a defect** | The deployed-staging gate stops with `UNGOVERNED_BRANCH`: this branch is not in `web/preview-frontend-pairing.json` / `preview-backend-pairing.json`. It failed in 13 s before touching staging; Chromium, Tablet and Mobile were skipped as a result. I did **not** add the branch to those files — that would be a governance change binding my Preview to a staging gate, and it is the Moderator's call. |
| `communication-staging*` | skipped | — |

**Steps `backend-and-build` never reached** (they follow the failing step), so I ran them locally on a fresh detached worktree at exactly `9a0f3878`
with the repository's own commands: web type-check (`tsc --noEmit -p web/tsconfig.app.json`) **exit 0**, and with an injected type error **exit 2**
naming the file (negative control, then removed); route validation (`featureRegistry.route-validation.test.ts`) **7/7** — the test that guards the
registry entries I added; production build **exit 0**.

## 13. Follow-ups (none blocks what is delivered)

1. **B1 — model blocker.** The listing flow cannot hold a documented 11-character Japanese chassis number (minimum 12). The Vezel's
   photos therefore sit in the passport's evidence, Private, not in a listing. Moderator decision whether the identifier rule
   should admit documented frame numbers.
2. **Statistics wording.** A shipment with no organiser reads "No organiser is recorded… nothing to compare it with" rather than
   "not enough data". Both mean no statistics; the Moderator may prefer one sentence.
3. **Date-only values.** The ETA and ETD are stored at 00:00 UTC. A viewer west of UTC would see the previous calendar day. I did
   not measure this in a browser time zone; the safe fix is to display date-only values in UTC.
4. **Documents are awaiting review.** The three uploads went through live OCR as any customer upload would; I did not inspect the
   extraction, and none is verified — that needs someone with review authority.
5. **Merge order.** A backend built from the Trade OS base cannot authenticate anyone against current staging (§2), so the stacked
   PR cannot be physically UAT'd until it is combined with the current runtime. The web-build-identity commit `814ad5cd` conflicts
   with the sibling lineage's mechanism and is superseded by it on merge.
6. **D2's consequence for operators.** A shipment belongs to one order, so a co-loaded container needs a shipment per order; a
   shipment attached to only one order is no longer shown to the other bookings on the container. That is the ruled behaviour.
7. **Rulings kept as given:** D1 (T4 rail) deferred and unmodified; D3 (legacy exception notice) unchanged; D5, D6, D7, D8 unchanged.
8. **Route registry.** I registered the two routes the Journey exposes. I did not audit every other Trade OS route for the same gap.
9. **Login identity.** The Kingston account's real sign-in email differs from the one written in the brief; the account id is the
   same (`u_66cace85fad949e4`).
10. **T3 fixture has expired (§12a).** `diaspora-logistics-rfq.test.js:236` hard-codes 2026-10 dates and now fails on any branch that runs
    it. T3 is frozen and this PR does not touch it; the fix is to derive the dates from the clock. Until then `backend-and-build` is red
    for a reason unrelated to this work, and it hides the web type-check, route validation and build steps behind it.
11. **Deployed-staging gate (§12a).** This stacked branch is `UNGOVERNED_BRANCH`. If the Moderator wants Chromium/Tablet/Mobile to run
    against it, the branch must be registered in the two preview-pairing files by whoever owns that governance — and the pairing must be
    the integration candidate (§2), since a Trade OS–base backend cannot authenticate against current staging.

## 14. Evidence custody

Screenshots and the private CAP evidence are held outside the repository (`~/carup-launch-evidence/t11-cap-lr01-r1/`, mode 700):
24 screenshots, including the before-import and after-import Vezel at all three widths. They show the Owner's name and vehicle and are
not committed. Their SHA-256 prefixes are recorded in that folder's manifest, not here.
