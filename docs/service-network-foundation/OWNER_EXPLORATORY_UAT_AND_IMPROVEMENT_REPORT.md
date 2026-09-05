# Service Network Foundation 1.0 — Owner Exploratory UAT and Improvement Report

**Executive verdict: `OWNER UAT — PASS WITH REQUIRED IMPROVEMENTS`**

The engineering certification is sound and I am not relitigating it. But engineering green did not
decide this verdict, and it should not: the backend is genuinely well-built and unusually honest,
while the **product a real user can reach is a public garage directory plus an owner service-history
read**. The governed case lifecycle, work orders, mechanic assignment, service records and Service
Links — the substance of a Service Network — have no user interface on this candidate.

The single finding that decides the verdict is not a missing screen. It is that the **one
service-request entry point CarUp exposes produces a request the Service Network is structurally
unable to act on**, and the owner is never told.

---

## Candidate under test

| | |
|---|---|
| Repo head | `996da42b61ee97f02e76de0151440bfcee9229d6` |
| Branch / PR | `feat/service-network-foundation-1-0` · PR #197 (**Draft**, unchanged) |
| Frontend | `carup-staging-git-feat-service-network-foundation-1-0-11-11.vercel.app` |
| FE provenance | `commit_sha 996da42b…`, **`unpaired: false`**, paired from `preview-backend-pairing.json` |
| Backend | `carup-backend-staging-git-feat-service-network-fou-fda7ff-11-11.vercel.app` |
| BE provenance | `build.commit_sha 996da42b…`, `deployment_id dpl_5WUu65vdBTPo1CZC2G7GL5rpBGTV` |
| Staging DB | `eoyenigwevnxwwhyhaer` (approved) |
| Communications | `BLOCKED` (staging configuration) |
| UAT start | 2026-09-05T23:15:08Z |

Production and `main` untouched. No fix was implemented during this pass.

---

## Tested surfaces

Anonymous: `/` · `/garages` · `/garages/:slug` (published) · `/garages/does-not-exist-xyz` ·
`/marketplace/services` · `/service-links/:token` · `/s/:token` · `/scan/:token` ·
`/dashboard/service-history` · `/mechanic/work-orders` · `/login`

Owner: `/dashboard` · `/dashboard/garage` · `/dashboard/garage/:vin` (own **and** another owner's) ·
`/dashboard/service-history` · `/dashboard/communications` · `/dashboard/sell-vehicle?vin=` ·
`/marketplace/services` (+ request modal) · `/marketplace/listing/:vin` · `/garages/:slug` signed in

Garage tenant-member: `/dashboard` · `/mechanic` · `/mechanic/work-orders` · `/mechanic/customers` ·
`/mechanic/service-logs`

Mobile (Pixel 5, 393px): `/` · `/garages` · `/garages/:slug` · `/marketplace/services` ·
`/dashboard` · `/dashboard/service-history` · `/dashboard/garage/:vin`

## Interaction coverage

| | |
|---|---|
| Distinct routes opened | 21 |
| Controls physically exercised | 31 (login submit, request CTA ×3, contact-preference select, Send inquiry, Passport tabs Documents/Service History, Upload Document, Edit / continue listing, portal switcher entry, directory cards, Back to directory, nav links) |
| Forms submitted | 3 (login ×3 accounts, service inquiry ×1) |
| Roles | anonymous, owner, second owner (outsider), garage tenant-member, mechanic tenant-member |
| Desktop journeys | 6 |
| Mobile journeys | 7 surfaces |
| Direct-URL tests | 9 (incl. 3 guessed Service Link routes, cross-owner VIN, case-UUID-as-VIN) |
| Refresh / re-login tests | 5 |
| Negative / loophole tests | 6 |
| Screenshots captured | 29 |

---

## Findings summary

| ID | Sev | Type | Surface | Finding | Foundation blocker? |
|---|---|---|---|---|---|
| F1 | **P1** | PRODUCT GAP / DATA | `/marketplace/services` | The only service-request entry produces an inquiry with **no garage and no vehicle**; the S3 bridge refuses to open a Service Case without a target garage, so it can never become one | **YES** |
| F2 | **P1** | UX / BUSINESS PROCESS | `/marketplace/services` | A successful request gives **no confirmation and no reference**, and is then findable **nowhere** in the owner's account | **YES** |
| F3 | **P1** | DATA / TRUTH | Vehicle Passport | Passport shows `Garage not recorded`, `Mileage not recorded`, **`$0`** for a service that Owner Service History shows as **`SN Cert Garage snz020359`, `ZIG 250`, `91,000 km observed`** | **YES** |
| F4 | **P1** | PRODUCT GAP | Garage Detail | Page states "This garage takes contact through CarUp only" and offers **no way to make contact** — a dead end at the moment of intent | **YES** |
| F5 | **P1** | PRODUCT GAP | whole garage side | No garage-operator UI exists. `/dashboard/garage` is the **owner's** vehicle page; `/mechanic/*` **redirects to `/dashboard`** for a garage tenant-member | **YES** (for the promised journey) |
| F6 | **P1** | TRUST/SAFETY / NAVIGATION | `/dashboard/garage/:vin` | Any authenticated user can open **another owner's** vehicle in the private portal, seeing mileage, asking price and service counts, with an **"Edit / continue listing"** action that routes into Seller Studio for that foreign VIN | **YES** (decision required) |
| F7 | **P2** | CONTENT / TRUST | `/marketplace/services` | Claims "**Service providers are onboarding** — verified garages will appear here" while `/garages` lists 4 published garages; and promises "we will connect you to a **vetted** provider" while Garage Detail correctly says CarUp has verified nothing | No |
| F8 | **P2** | PRODUCT GAP | Service Link | No Service Link UI exists at any route. The scan journey — the reason the tokens are printed — cannot be performed | No (backend correct) |
| F9 | **P2** | CONTENT | request modal | Offers **WhatsApp / Email** as contact preference while Communications is `BLOCKED`; nothing tells the user the channel may not be delivered | No |
| F10 | **P2** | UX | `/garages` | Directory has no search, filter, sort, count, distance, hours or photo — a list, not a directory | No |
| F11 | **P2** | MOBILE | `/dashboard` | 27px horizontal overflow at 393px (metrics table) | No |
| F12 | **P2** | UX | `/dashboard` | Permanently disabled **"Upload unavailable"** button with no explanation — the only control on the page | No |
| F13 | **P3** | CONTENT | several | Internal vocabulary leaks: "Service Case", "capability", "Evidence", "PartSentry", "governed", "canonical" | No |
| F14 | **P3** | UX | `/login` | "Demo: Dealer" / "Demo: Mechanic" / "Browse as Buyer (Tendai Moyo)" shortcuts sit beside real sign-in | No |
| F15 | **P3** | DATA | `/garages` | Directory is populated entirely by certification fixtures ("SN Cert Garage snrun621507" ×4) | No |

**P0: 0 · P1: 6 · P2: 6 · P3: 3**

### A correction to my own testing, recorded deliberately

My first pass reported Service History as showing "Recorded Services 0 / Not recorded". That was a
**2.2-second wait race in my harness, not a product defect**. Re-tested with a proper wait, the page
correctly shows `Recorded Services 1`, `ZIG 250`, `Replaced front pads`, `SN Cert Garage snz020359`,
`91,000 km observed`, `Source not recorded`. The page is **good**, and F3 exists because the Passport
disagrees with it — not because Service History is wrong.

---

## Detailed findings

### F1 — P1 — The only service request CarUp offers cannot become a Service Case

**Context.** `/marketplace/services` is the sole "Request a service / inspection" entry point in the
product. Garage Detail has no request action (F4).

**Steps.** Sign in as an owner → `/marketplace/services` → "Request a service / inspection" → fill
name, email, phone, message → "Send inquiry".

**Expected.** A service request directed at a chosen garage for a chosen vehicle, which a garage can
receive and act on.

**Actual.** The modal is a **generic marketplace inquiry form**. Its only dropdown is *contact
preference* (`CarUp / WhatsApp / Email`). There is **no garage selector, no vehicle selector and no
service category**. The request posts `201` and stores:

```
inquiry_type            garage_service_request
target_provider_tenant_id   NULL      ← no garage
listing_id                  NULL      ← no vehicle
status                      new
```

The S3 marketplace bridge refuses to open a Service Case without a target garage — proven earlier by
its own guard ("routing is governed, not guessed — no target garage means no Service Case"). So this
request is structurally incapable of entering the Service Network.

**Why it matters.** Everything downstream — queue, acceptance, work order, mechanic, service record,
owner history — is reachable only from a Service Case. The product's front door does not open into
the building. The backend `POST /api/service-cases` accepts a VIN and a garage tenant, so the
capability exists; nothing in the UI calls it.

**Recommended improvement.** Make the request flow garage-addressed and vehicle-addressed: request
from Garage Detail with the garage implied, a vehicle picker from the owner's garage, and a service
category from the governed list. **Classification: A — must fix before accepting Foundation.**

---

### F2 — P1 — A successful request disappears

**Steps.** Submit the request in F1 → observe the page → check `/dashboard`,
`/dashboard/communications`, `/dashboard/service-history`.

**Expected.** Confirmation with a reference, a statement of which garage received it, and somewhere
to return to.

**Actual.** `POST 201`. The modal closes and the page returns to its prior state. No confirmation
text, no reference, no status. The message text appears on **none** of the three surfaces checked.
The owner has no evidence the request exists.

**Why it matters.** §10 of the UAT brief names this precisely. A person who is not sure their request
arrived will phone or WhatsApp the garage instead, and CarUp loses the interaction it just captured.

**Recommended improvement.** A confirmation state with a reference and the receiving garage, plus a
"My service requests" list. **Classification: A.**

---

### F3 — P1 — The Passport and Service History tell different stories about one service

**Steps.** As the owner of `SNCLOSE020359VIN1`: open `/dashboard/service-history`, then
`/dashboard/garage/SNCLOSE020359VIN1` → "Service History" tab.

**Expected.** One vehicle truth.

**Actual.**

| | Owner Service History | Vehicle Passport |
|---|---|---|
| Garage | `SN Cert Garage snz020359` | **`Garage not recorded`** |
| Cost | `ZIG 250` | **`$0`** |
| Mileage | `91,000 km observed` | **`Mileage not recorded`** |

Database holds `total_cost 250, currency ZIG`, a known garage tenant and a `91000 garage_stated`
observation. The string "ZIG" appears nowhere on the Passport. The Passport's Vehicle Summary also
reads `Total Services 1` beside `Recorded Service Cost $0`.

**Why it matters.** This is the exact truth debt the S6 owner projection was built to retire — "an
absent cost rendered as $0", "a generic literal standing in for provider identity" — reappearing on
the Passport, which is the surface a **buyer** reads. A buyer sees a serviced vehicle with $0 spent
and no garage named, which understates real provenance and reads as a suspicious record. The dollar
sign on a ZiG amount is independently wrong.

The Passport service section is evidently reading legacy `mechanic_work_orders` rather than the
governed owner projection or `service_records`. (Diagnosis offered for triage only — no fix applied.)

**Recommended improvement.** Point the Passport service section at the same governed projection the
owner surface uses. **Classification: A.**

---

### F4 — P1 — Garage Detail is a dead end at the moment of intent

**Steps.** `/garages/sn-cert-snz020359`, signed out and signed in.

**Expected.** A way to act — request service, ask a question, save.

**Actual.** The page renders identity, city, services offered, branches, verification and PartSentry
sections. Signed in or out, the only page-specific control is "Back to directory". The page states
*"This garage takes contact through CarUp only"* — and then offers no CarUp contact.

**Why it matters.** This is the page a person reaches when they have decided. Telling them contact
happens only through CarUp while providing no CarUp contact is worse than silence.

**Recommended improvement.** A primary "Request service from this garage" CTA that carries the garage
into the request. **Classification: A** (it is also the natural fix for F1).

---

### F5 — P1 — There is no garage-operator product

**Steps.** Sign in as a garage tenant-member → `/dashboard` → `/mechanic`, `/mechanic/work-orders`,
`/mechanic/customers`, `/mechanic/service-logs`.

**Expected.** A garage workspace: incoming requests, active jobs, mechanics, history.

**Actual.** `/dashboard` renders **"Owner Dashboard — Monitor your vehicles, escrows, and insurance
logs"** for a garage business user. All four `/mechanic/*` routes **redirect to `/dashboard`**. The
sidebar portal switcher lists "Mechanic" but the entry is not actionable for this account.
`/dashboard/garage` is the owner's vehicle workspace ("My Garage"), not a garage business.

Endpoint-to-UI coverage measured across the web source: of the 35 Service Network endpoints, only
**garage-directory (2), garage/customers (1), service-history/me (1)** are called by any page.
`service-cases` (9), `garage/queue`, `garage/profile` + `branches` (6), `service-work-orders` (5),
`service-links` + `service-capabilities` (5) are called by **nothing**.

**Why it matters.** A garage cannot see, accept, assign or complete anything. The queue, acceptance,
assignment and completion journeys are performable only by API.

**Recommended improvement.** A garage portal is the substance of Service Network 1.1. For Foundation,
the honest minimum is to stop presenting an Owner Dashboard to a garage tenant-member.
**Classification: A for the role mislabel; B for the portal.**

---

### F6 — P1 — Another owner's vehicle opens inside the private portal, with owner actions

**Steps.** As owner of `SNCLOSE020359VIN1`, open `/dashboard/garage/SNFINAL014553VIN1` (a different
owner's vehicle). Then click "Edit / continue listing".

**Expected.** Refusal, or a clearly public read-only view without owner affordances.

**Actual.** The Passport renders inside the owner portal: `2020 Mazda BT-50`, VIN, `Mileage 62,000
km`, `Recorded Price $21,000`, `Total Services 1`, and its service entry. "Edit / continue listing"
navigates to `/dashboard/sell-vehicle?vin=SNFINAL014553VIN1` — **Seller Studio for a VIN the user does
not own**.

**Measured limits, stated fairly.** Anonymous access to the same route correctly redirects to
`/login`. "Upload Document" is **not** rendered for the foreign vehicle. **No write occurred** — the
only non-GET calls in the whole interaction were `auth/login` and analytics. CarUp's governed lookup
policy also makes **exact-VIN lookup deliberately public**, so VIN, make, model and mileage are not
private by CarUp's own decision.

**Why it matters.** Two things are nevertheless wrong. Asking price and service counts inside a
private portal exceed what the public VIN passport is for; and presenting an owner action on a
stranger's vehicle is an authority mis-signal — the user is invited into a seller flow for a car
they have no relationship with. I did not attempt a write, so I am **not** claiming an authority
breach; I am reporting an unclear boundary that needs a product decision.

**Recommended improvement.** Either scope `/dashboard/garage/:vin` to owned vehicles and send others
to the public passport, or render it explicitly as the public view with all owner affordances
removed. **Classification: A — decision required before acceptance.**

---

### F7 — P2 — The services page contradicts the directory and over-claims verification

`/marketplace/services` states *"Service providers are onboarding. Verified garages and mechanics
will appear here"* while `/garages` lists four published garages, and promises *"we will connect you
to a vetted provider"* while Garage Detail correctly says *"CarUp has not verified this garage.
Nothing here is a CarUp verification claim."* One of these two pages is misleading; the honest one is
Garage Detail. **Classification: A** (the trust claim), **B** (the empty state).

### F8 — P2 — The Service Link journey cannot be performed

`GET /api/service-links/:publicToken` works and is correctly anonymous-safe. No frontend route
resolves a token: `/service-links/:token`, `/s/:token` and `/scan/:token` all render "Page not
found". A printed sticker or job card therefore leads nowhere. **Classification: B.**

### F9 — P2 — Channels are offered that staging cannot deliver

The request modal offers WhatsApp and Email as contact preference while Communications is `BLOCKED`.
Nothing sets expectations. This is a staging-configuration limitation, but the UI makes a promise it
does not qualify anywhere. **Classification: B.**

### F10 — P2 — The directory is a list, not a directory

`/garages` shows name, city and one category per card, with no search, filter, sort, result count,
distance, opening hours, photo, or way to compare. With four entries this is survivable; with forty
it is unusable. Nothing distinguishes a garage from a mechanic or a dealer workshop.
**Classification: B.**

### F11 — P2 — Owner dashboard overflows horizontally on a phone

27px horizontal overflow at 393px, from the monthly-summary metrics table. Public pages, Service
History and the Passport are all 0px and clean. **Classification: B.**

### F12 — P2 — A permanently disabled button with no explanation

`/dashboard` renders exactly one control: **"Upload unavailable"**, disabled, unexplained. The UAT
brief names this pattern explicitly. **Classification: B.**

### P3 group

**F13 terminology.** "Service Case", "capability", "governed", "canonical", "Evidence", "PartSentry",
"provenance" appear in customer-facing copy. Plain alternatives: *service request / job*, *access
link*, *checked*, *records*, *parts check*. **F14** demo-role shortcuts sit beside real sign-in on
`/login`. **F15** the live directory is populated entirely by certification fixtures.

---

## Journey assessment

| Journey | Rating | Why |
|---|---|---|
| Garage discovery | **ACCEPTABLE** | Reachable from global nav and footer; honest subtitle. No search/filter/distance (F10) |
| Garage Detail | **WEAK** | Genuinely honest content, but no action at the point of intent (F4) |
| Service request | **BROKEN** | Produces a request with no garage and no vehicle that cannot become a Service Case (F1) |
| Garage queue | **BROKEN** | No UI exists (F5) |
| Work order | **BROKEN** | No UI exists (F5) |
| Mechanic experience | **BROKEN** | `/mechanic/*` redirects to an Owner Dashboard (F5) |
| Service record | **BROKEN** | No UI; records are creatable only by API |
| Owner Service History | **GOOD** | Correct garage, `ZIG 250`, mileage *observed*, "Source not recorded". Genuinely well done |
| Passport / lifecycle | **WEAK** | Contradicts Service History on garage, cost and mileage (F3) |
| Service Link | **BROKEN** | No page exists (F8) |
| Communications degradation | **ACCEPTABLE** | Nothing falsely claims delivery; but WhatsApp/Email are offered unqualified (F9) |
| Mobile | **ACCEPTABLE** | Public + history + passport clean at 393px; dashboard overflows 27px (F11) |

---

## What the product does genuinely well

This deserves to be recorded, because it is unusual and it is the foundation the rest can be built on.

- **Truthful absence everywhere.** "CarUp has not verified this garage. Nothing here is a CarUp
  verification claim." · "This garage has not listed any branches." · "Not evaluated… That is not a
  score of zero." · "5 of 5 figures could not be measured and are reported as unavailable, not as
  zero", with a "WHAT IT IS NOT" column per metric.
- **The unknown-garage response is non-enumerable**: "This garage is not published. It may never have
  been listed, or it may have unpublished its profile" — it does not confirm existence.
- **Owner Service History states provenance honestly**: "91,000 km **observed**", "Source not
  recorded", currency carried as `ZIG`.
- **A failed Passport load says so**: "CarUp could not load this Passport. This does not mean the
  vehicle has no records."

The discipline the engineering lane was certified for is visible in the interface. The gap is reach,
not honesty — with the exception of F3, where the Passport is not yet holding that line.

---

## Missing business capabilities (separate from defects)

**1 — Essential next.** Garage portal (queue, accept/decline, assign, complete); owner "my service
requests"; request from Garage Detail with vehicle + category; Service Link resolver page.

**2 — High value.** Quotation and estimate approval before work; booking date/time; diagnostic-first
requests; parts and labour lines with totals; owner-visible vs internal technician notes; vehicle
not-driveable / towing; walk-in job creation by the garage.

**3 — Optional.** Branch-level queues and staff; opening hours and response-time expectations;
photos on the garage profile; repeat-customer view; multi-garage quote comparison.

**4 — Future.** Payment status and settlement; warranty and comeback/rework; disputes; mobile
mechanics and body-shop specialisations; ratings grounded in completed governed work.

### Zimbabwe-reality gaps worth weighing

WhatsApp-first contact is the norm and is offered but undeliverable here (F9). Owners frequently buy
their own parts — the model assumes the garage records parts. Diagnosis-before-quote is standard and
has no representation. Payment is commonly cash/EcoCash on collection, with no state for it. Walk-ins
and phone bookings dominate over online requests, yet a garage cannot create a job for a walk-in.

---

## Loopholes and adversarial findings

| Attempt | Result |
|---|---|
| Anonymous → `/dashboard/service-history` | **Correctly refused** → `/login?returnTo=…` |
| Anonymous → `/mechanic/work-orders` | **Correctly refused** → `/login?returnTo=…` |
| Anonymous → `/dashboard/garage/:othersVIN` | **Correctly refused** → `/login?returnTo=…` |
| Unknown garage slug | **Correctly non-enumerable** — "not published", no existence disclosure |
| Case UUID used as a VIN in the passport route | **Correctly refused** — "Vehicle Passport unavailable… does not mean the vehicle has no records" |
| Owner → another owner's vehicle passport | **Rendered** — mileage, price, service count, plus a Seller Studio route (F6). No write occurred |
| Garage tenant-member → `/mechanic/*` | Redirected to Owner Dashboard (F5) |
| Forged target tenant on a service request (API, earlier) | **Correctly refused** — "not a published garage on CarUp" |

Successful refusals outnumber loopholes, and the refusals are well-worded. F6 is the one boundary
that needs a decision.

---

## UX / design recommendations

**Navigation.** Give the garage tenant-member a portal that is not the Owner Dashboard. Add "My
service requests" to the owner sidebar. Add a Service Link route so a scan resolves.

**Status presentation.** Show a request's state to the owner (sent → received → accepted → in
progress → completed) with the receiving garage named at every step.

**Wording.** "Service Case" → "service request"; "capability" → "access link"; "governed" → drop or
"checked"; keep the honest-absence sentences, which are the product's best writing.

**Mobile.** Make the dashboard metrics table scroll inside its own container rather than widening the
page.

**Data presentation.** One currency rule across surfaces — never render a ZiG amount with `$`, and
never render an absent cost as `0`.

---

## Recommended next implementation tranche

### Before Foundation acceptance (true blockers)

1. **F1/F4** — garage-addressed, vehicle-addressed service request, entered from Garage Detail, that
   creates a real Service Case.
2. **F2** — confirmation with a reference, and a place the owner can find the request again.
3. **F3** — Passport service section reads the governed projection; no `$0` for an unrecorded cost,
   no `$` on a ZiG amount, no "Garage not recorded" when the garage is known.
4. **F6** — decide and enforce the boundary of `/dashboard/garage/:vin` for non-owned vehicles.
5. **F7 (trust claim only)** — stop promising a "vetted provider" while verification is explicitly
   disclaimed elsewhere.
6. **F5 (label only)** — stop presenting an Owner Dashboard to a garage tenant-member.

### Immediately after Foundation

F8 Service Link page · F9 channel expectations · F10 directory search/filter · F11 mobile overflow ·
F12 disabled-button explanation · F15 clear certification fixtures from the staging directory.

### Service Network 1.1 / Phase 2

The garage portal in full: queue, accept/decline, assignment, work-order lifecycle, service-record
capture, customer history. Quotation and estimate approval. Booking. Walk-in job creation.

### Later

Payments and settlement, warranty and rework, disputes, ratings from completed governed work,
branch-level operations, mobile-mechanic and specialist models.

---

## Product assessment

**Service Network today is a technical foundation with two working product surfaces, not yet a usable
MVP service product.**

What exists is real and well made: a governed backend with 35 mounted endpoints, an honest public
garage directory, and an owner Service History that states provenance more carefully than most
production products manage. The refusals are correct and well-worded, and the empty states tell the
truth rather than implying zero.

But a Service Network is judged by whether a person can get their car fixed through it. On this
candidate an owner can find a garage and cannot ask it for anything; a garage cannot see or accept
work; a mechanic has no assigned-work view; and a completed service is described differently by two
CarUp surfaces. The capability is built and governed — it is simply not yet connected to anyone.

The distance to an MVP is smaller than the finding count suggests: five of the six blockers are
connection work against endpoints that already exist and are already certified. F3 is the one that
matters beyond usability, because it puts a false `$0` and a missing garage name in front of buyers.
