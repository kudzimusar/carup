# Service Network Foundation 1.0 — Owner-Approved UAT Remediation Tranche (R1–R15)

**What this document is.** The engineering record of the remediation tranche the Product Owner
approved after the exploratory owner UAT. It states what was changed, what was deliberately not
changed, how each change was proven, and — separately — what remains open.

It does not restate the UAT report. That report stands as written, including the finding that
decided its verdict and the correction I recorded against my own testing. This document is what
happened next.

| | |
|---|---|
| Branch / PR | `feat/service-network-foundation-1-0` · PR #197 (**Draft**, unchanged) |
| Tranche base | `104c2954` (the certified deployed-provenance head) |
| Migrations added | **none** |
| Production / `main` | untouched |

---

## The governing rule, and how it was applied

The tranche's rule was: *connect existing certified capabilities to product surfaces; do not create
replacement tables, duplicate workflows or new authority surfaces because UI is missing.*

**No table was created. No migration was written. No second request ledger exists.** Every screen in
this tranche calls a route that was already certified in Foundation 1.0.

**One endpoint was added**, and it is worth stating plainly rather than burying:

> `GET /api/garage/mechanics` — the garage's own members.

`assignMechanic` takes a `mechanic_user_id` and refuses any id that is not a member of the caller's
tenant. Nothing in the product could tell an operator what those ids *are*, so a certified
assignment capability was reachable only by typing a UUID — which is the same as not having it. The
new route reads the **same** `tenant_users` membership `assignMechanic` already validates against,
for the caller's own tenant only, under the same `authorizeSessionRole(GARAGE_ROLES)` gate as every
other private garage read. It adds no authority and creates no record. It is registered in both
certified gates: the runtime mounting roll-call and the adversarial session-auth list.

---

## What changed, finding by finding

### Acceptance blockers

**F1 — a service request that could never reach anyone.** The only entry point was a generic
marketplace inquiry storing `target_provider_tenant_id: NULL` and `listing_id: NULL`. The S3 bridge
refuses to open a Service Case without a target garage, so the request could not become one. Garage
Detail now carries a primary *"Request service from this garage"* action, and the request carries a
garage and a vehicle.

The garage is addressed by **public slug**, not tenant id. The public garage payload deliberately
withholds `tenant_id`, so the browser never handles one and cannot be the source of targeting. The
server resolves the slug through the same governed publication check a tenant id goes through, and
refuses an unpublished or unknown slug with **wording identical to a bad tenant id** — a test asserts
the two messages are equal, so a slug leaks no more than an id does. The tenant-id form still works;
the change is additive.

**F2 — a successful request vanished.** No confirmation, no reference, and findable nowhere. There
is now a confirmation carrying a short reference, the garage, the vehicle, the status and what
happens next; and a **My Service Requests** page. That page reads the canonical Service Cases the
owner already owns. It is not a second ledger — there is one, and this is a view of it.
`listMyServiceCases` now attaches the governed garage **name**, because a tenant UUID answers
nothing for the person who made the request. An unprofiled tenant is reported as not recorded, only
a published garage is linked, and a failed identity read still returns the requests.

**F3 — two CarUp surfaces described one service differently.** The Passport showed
`Garage not recorded`, `Mileage not recorded`, `$0` for a service that Owner Service History showed
correctly. The cause was that VehicleProfile derived services from the passport timeline while
Service History read the governed endpoint. Both now read `/api/service-history/me` and format
through one module, `web/src/lib/ownerServiceHistory.ts`, so parity is **structural** rather than
maintained. A fixture-driven test renders both surfaces from one payload and asserts they agree.

`$0` is gone: an unrecorded cost reads *"Cost not recorded"*, because zero is a claim and absence is
not.

**F4 — a dead end at the moment of intent.** Garage Detail said *"this garage takes contact through
CarUp only"* and offered no way to make contact. It now opens the request flow; signed out, it
routes to login and returns.

**F5 — no garage-operator product at all.** The whole garage side was certified and had no screen.
A garage tenant-member who signed in was shown the **owner** dashboard — "sell your car", "your
listings" — while `/api/garage/queue` had been returning their real work all along.

There is now a **Workshop** (`/garage`) showing the queue with the counts and `next_action` the
server already computes; one **case screen** (`/garage/cases/:caseId`) that runs a job from request
to service record — accept, decline, open a job card, assign a mechanic, start, record work, cost,
a mileage observation, complete; a **Customers** list; and the garage's own **public page** with
publish and unpublish.

Two rules keep the case screen honest:

- only the action the case is *waiting for* is offered, so an operator is never handed a button that
  comes back 409;
- a completed, declined or withdrawn case is **history**: shown, and not editable.

One decision worth recording: the case screen discovers its job card by **reading the queue**, not by
calling the idempotent create endpoint. Calling create would have been simpler and would have opened
a job card for every operator who merely *looked* at a case. A test pins that it is never called on
view.

The garage's public page matters more than its size suggests. Without it no garage could enter the
directory without someone calling the API, so the entire owner journey had **no supply side**.
Publication's real preconditions — a name, a city, at least one kind of work — are stated before the
button is pressed rather than arriving as a 400 nobody can act on. Being listed is described as being
findable, never as a CarUp endorsement.

**F6 — a foreign VIN opened in the private owner portal**, with an *"Edit / continue listing"* action
routing into Seller Studio for a vehicle the viewer does not own. The private vehicle page now
resolves management scope from the owner's own governed vehicle list, and a vehicle outside it
renders a boundary state with no management controls. The deliberate public VIN lookup contract was
**not** changed to solve this: that would have traded a real product capability for a UI bug.

**F8 — every QR code opened the 404 page.** `/api/service-links/:publicToken` was certified from the
start and the web app had no `/s/:token` route. It exists now, and **Service Link security is not
redesigned**: the page renders the resolver's decision and adds nothing to it.

- An anonymous scan is a **safe** state — *"this is a real CarUp link"* — with a login that returns
  to the link, and no vehicle, case or garage detail.
- A stranger scanning a windscreen sticker sees **no VIN**, because the resolver withheld it.
- A non-participant is not shown a status, not even that one exists.
- Revoked, expired and never-existed stay **one answer**. The page is not an oracle.
- A network failure is reported as a failure, never as an invalid link — those are different facts,
  and blaming the holder of a good code for our outage is the wrong one to pick.

### Remaining items

**F7 / R9 — claims the product could not support.** `/marketplace/services` said *"service providers
are onboarding"* while the directory already listed published garages, and promised a *"vetted
provider"* while the garage profile correctly states CarUp has verified nothing. Both are gone, and
the page points at the directory where a garage-addressed request can actually be made.

**F9 / R10 — channels offered while blocked.** The inquiry form offered WhatsApp and Email while
every provider reported `BLOCKED`. Channels are now read from `/api/health` and an unavailable one is
offered *as* unavailable, with a note that replies stay in CarUp. **No provider was enabled and no
credential was added.**

**F11 — 27px horizontal overflow at 393px.** The metrics table scrolls; its min-content width was
propagating out through its ancestors. Constrained at the scroll container. **No column was hidden**
— the test is green because the layout is fixed, not because the data was removed.

**F12 — a permanently disabled "Upload unavailable" button**, which was the page's only control.
Uploading genuinely works in the Evidence Vault, so the page now says where instead of offering a
dead button. The truthfulness test it touched was rewritten to assert the **property** (this
dashboard never starts or claims a document operation) rather than the **mechanism** (the button is
disabled), so the test survives the fix it was meant to protect.

**F13 / R13 — internal vocabulary.** Customer-facing status wording is plain language in
`web/src/lib/serviceRequests.ts` (*"Sent — waiting for the garage"*), and `serviceLink.ts` carries a
test asserting that *capability, grant, token, resource* and *redemption* appear in nothing a person
reads, across every link state. Backend authority names are unchanged. **What was not done** is
recorded under *Left open* below.

**F14 / R14 — demo identities on production.** The login page shipped three named accounts and a
hard-coded password, rendered unconditionally, on every build. The **build** now decides, and it
fails closed: `vite.config.ts` sets the flag only for a Vercel environment that positively identifies
itself as non-production, so anything that cannot prove it is a preview ships none.

Writing that test surfaced a second leak I would otherwise have missed: a real demo account's email
address was the **placeholder** on the login page and on Trust & Safety. Both are now generic. The
test asserts both directions — hidden without the flag, present with it — because a test that only
checks for absence would still pass if the whole block were deleted.

**F15 / R15 — fixture provenance.** The directory is populated by certification fixtures. **No code
was written to disguise them**, which was the explicit instruction, and none should be: the honest
remedy is real garages, not code that makes fixtures look like real garages. Fixture isolation itself
was checked and is not wrong — the fixtures are ordinary published garages in the staging database,
carrying no special code path, and nothing in the product treats them differently from a real one.

**R6 — the mechanic and the garage manager were the same screen.** The queue now carries
`assigned_mechanic_user_id`, read from `work_order_assignments` — the authority, not the legacy
`mechanic_id` column — and live assignments only. Without it a mechanic had to open every job to find
their own. The Workshop gains an *"Assigned to me"* view, and an empty "mine" is a different fact
from an empty garage and says so rather than telling a mechanic to go publish the garage page.

The mechanic dashboard reads the **legacy** work-order ledger only. The two ledgers are **not**
merged — that would fabricate a relationship between them — but the page now says the CarUp request
ledger exists and where it is, instead of leaving a mechanic sitting on a page while real work waited.

Its sidebar badge said **"8"** work orders, to every mechanic on every account, counted from nothing.
The honest number is no number.

---

## How it was proven

### Mutation gates

A test that has never been shown to fail is not yet coverage. All six required gates were run: the
mutation applied, the suite observed red, the mutation reverted, the suite observed green.

| # | Mutation | Result |
|---|---|---|
| 1 | Drop the target garage from the request | journey suite **red** (1 of 9) |
| 2 | Drop the vehicle from the request | journey suite **red** (1 of 9) |
| 3 | Passport and Service History read different sources | parity suite **red** |
| 4 | Remove the garage-role session guard | adversarial suite **red** (3 tests) |
| 5 | Allow management controls on a foreign VIN | boundary suite **red** |
| 6 | Let an anonymous scan grant authority | link suites **red** (4 tests) |

Gate 4 is worth reading closely: replacing `authorizeSessionRole` with `authorizeRole` on the garage
routes turns three adversarial tests red, including the one asserting that every consequential route
**composes** the session guard in source. Gate 6 turns four red across two suites.

### Suites

| Suite | Result |
|---|---|
| Service Network backend | **267 / 267** |
| Garage operator journey (new) | **15 / 15** |
| Service Link surface (new) | **11 / 11** |
| Request service journey (new) | **9 / 9** |
| Service truth parity (new) | **5 / 5** |
| Vehicle management boundary (new) | **5 / 5** |
| Demo identity guard (new) | **5 / 5** |
| Service Network UAT remediation, backend (new) | **16 / 16** |
| Route convergence | green, with `/s/:token` and `/dashboard/service-requests` added to the roll-call |
| Typecheck | clean |

### Lint, stated honestly

The web workspace lint gate is **red repo-wide, and was red before this tranche**. Measured rather
than assumed:

| | web workspace errors |
|---|---|
| Before typing the new API surface | 179 |
| After | **135** |

This tranche **removed 44 and added none**. The 44 were `no-explicit-any` on lines it had itself
added: `any` is the established idiom in `useCarUpApi.ts`, which is not a reason to add more where
the server contract is known exactly, so the Service Network methods are properly typed. The
remaining 135 are pre-existing and outside this tranche — verified by line-level attribution, not by
assertion.

---

## Left open, deliberately

- **F10 — the garage directory has no search, filter, sort, count, distance, hours or photo.** It is
  a list, not a directory. Search and filtering are product work, not connection work, and were not
  in the tranche.
- **F13, beyond the Service Network surfaces.** "Governed" and "canonical" still appear in
  user-facing copy on Seller Studio, Evidence Vault, Communications and Seller Intelligence. Those
  surfaces belong to other certified programmes with their own copy tests; rewording them on a P3
  under this tranche would churn another programme's certified text for no user-visible gain here.
  Recorded rather than silently skipped.
- **The mechanic portal's legacy pages** (`/mechanic/work-orders`, `/mechanic/service-logs`,
  `/mechanic/parts`, `/mechanic/customers`) are a pre-existing product on a different ledger. They
  were left as they are; only the false badge and the missing signpost were fixed.
- **Everything the tranche explicitly deferred** — quotations, appointment calendar, payments,
  warranty, towing, labour rates, VAT, bay utilisation, inventory, ratings, mobile mechanic
  marketplace, full chat, advanced search, map routing — was not built and is not implied by any
  screen added here.

---

## Certified authorities: unchanged

Canonical Service Case; Marketplace target-garage provenance; canonical Communications integration;
canonical work orders; canonical Service Records; canonical Evidence; canonical Passport projection;
canonical lifecycle; Service Link and capability authority; deterministic event identity; tenant
isolation; proven-session requirements; and **mileage as an observation, never a canonical-odometer
mutation** — which the garage case screen states in plain words at the point the reading is typed.
