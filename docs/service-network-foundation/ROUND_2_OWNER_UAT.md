# Service Network Foundation 1.0 — Round 2 Owner UAT

**What this is.** The second exploratory pass, run in a real browser against the deployed candidate
after the R1–R15 remediation tranche. Round 1 found fifteen things; this asked whether the tranche
actually fixed them *in the product*, rather than in the tests.

It found that one of the acceptance blockers was **not** closed, and that a second fix had been
aimed at the wrong cause. Both are now fixed and re-measured. This document records the first
reading as well as the second, because the first reading is the evidence.

---

## Round 2 — first pass

Run against `f7c0421b`, both sides, `unpaired: false`.

| | |
|---|---|
| Frontend | `f7c0421b…` · paired from `preview-backend-pairing.json` |
| Backend | `f7c0421b…` · `dpl_2d92LkgNTWerigxW3gt9xb8UKFwW` |
| Result | **17 PASS · 2 FAIL** |

### What worked, in the product, as a person

The owner journey Round 1 said was impossible now runs end to end:

- Garage Detail carries **"Request service from this garage"** — the dead end at the moment of
  intent is gone (F4).
- The request names a **vehicle** and a **garage**, so it is a request the Service Network can act
  on (F1). `POST /api/service-cases` → **201**.
- The confirmation reads: *"Your reference is **SR-47A09209**. SN Cert Garage snc002742 has your
  request for **Isuzu D-Max**."* — with *"Sent — waiting for the garage"* and *"The garage has your
  request and will accept or decline it. You will see the change here."* (F2).
- **My Service Requests** lists it afterwards, by garage NAME and in plain language (F2).
- `/marketplace/services` no longer claims providers are "onboarding" or promises a "vetted"
  provider (F7).
- The dead **"Upload unavailable"** button is gone, replaced by a route to the Evidence Vault (F12).
- `/s/:token` reaches a real page instead of the 404, and says nothing about capabilities, grants,
  tokens or resources (F8, R13).

### The two failures

**R2-F5a — P1 — a real garage tenant-member could not reach their garage.**

Signing in as `sn.garage.snz020359` and going to `/garage` landed on the **Owner Dashboard** — a
screen about selling their own car. Every garage API call answered 403.

I checked whether this was a broken fixture before calling it a defect. It is not:

```
tenant_users.role = 'mechanic'   tenants.type = 'garage'
garage_public_profiles.slug = 'sn-cert-snz020359'   publication_status = 'published'
users.role = 'owner'   ← what public registration creates
```

A genuine garage employee. So **F5 was not closed**, and the workspace this tranche built was
unreachable by the people it was built for.

Nothing was missing from the authority:

| request | result |
|---|---|
| `x-stakeholder-role: owner` | `403 Forbidden. Role 'owner' cannot access this resource.` |
| `x-stakeholder-role: mechanic` | `403 … 'mechanic' is not verified for this user context.` |
| `x-stakeholder-role: mechanic` **+ `x-tenant-id`** | **200** — queue, members, profile all served |

The browser could send neither header, because `/api/auth/me` answered with the platform role and
**no membership at all**. The session could not state what the server was perfectly willing to
verify.

**R2-F11 — P2 — the 27px overflow was still there.**

Round 1 attributed it to the metrics table. The table was constrained, and the overflow survived:
`scrollWidth 420` against `clientWidth 393`, unchanged. Walking every box against the viewport
found the actual source — the **header action row**, three controls totalling 404px in a flex that
could not wrap. The earlier fix was not wrong; it was not the cause.

### And two failures of my own measurement

Recorded because they are the reason the first reading was not as strong as its numbers suggested:

- Three garage steps reported **PASS** on the strength of "no error element on the page", while the
  browser was in fact showing the Owner Dashboard after a redirect. Absence of an error is not
  evidence that a surface rendered. They now assert they are *on* the page.
- The **F3 parity** and **F6 boundary** checks silently did not run: both are gated on a VIN, the
  VIN was scraped from prose, the scrape returned nothing, and the harness said nothing. A check
  that cannot find its subject must say so rather than vanish. The VIN can now be pinned, and an
  unfound one is reported.
- The owner requested service from whichever garage happened to be **first in the directory**, not
  the garage whose account is signed into afterwards — so the queue check was measuring a different
  tenant.

---

## What was changed in response

**One fact, made visible in three places that had disagreed.**

`/api/auth/me` now reports the caller's tenant membership: the tenant id, the role recorded **in**
that tenant, its name and type. This grants nothing. `resolveEffectiveRole` is untouched and still
refuses any role that is not the platform role or the **verified** `tenant_users` role — pinned by
tests covering the honoured case, the unverified case, the cross-role case, the rule that a tenant
role can never confer `admin`, and the rule that a request which asks for nothing still acts as the
platform role.

One membership is reported, because the product has no tenant switcher and inventing an "active" one
where several exist would be a guess; the oldest is used so the answer is at least stable. A
membership read that fails leaves the session with none — the fail-closed direction.

The API client asserts the tenant role on `/garage/*` only; every other route keeps the platform
role, so nothing outside the garage surfaces changes.

Route access and sidebar visibility accept **either** role, which is the same rule the backend
applies. Pinned in both directions: a tenant label that is not a real role matches nothing, an admin
surface stays shut to a garage mechanic, an unauthenticated visitor is not admitted by a tenant
role, and — the control case — without the tenant role the redirect still happens.

**F11** is fixed at its real cause: the row wraps. No control was hidden and nothing was truncated.
jsdom performs no layout, which is exactly why the first fix passed review and failed in a browser,
so the load-bearing evidence is the browser measurement; the unit test only guards that the row may
still wrap.

---

## Round 2 — second pass (`e2c920dc`)

**17 PASS · 5 FAIL.** Two of the five were the same defect seen more honestly, one was a harness
flaw, and two were newly-visible truths.

**Fixed and confirmed by measurement:**

- **F11** — `scrollWidth 393` against `clientWidth 393`. Zero overflow, down from 27px. The fix was
  at the real cause this time.
- **F6** — measured for the FIRST time (it had silently skipped in the first pass for want of a
  VIN): a foreign VIN renders the boundary state with `edit-listing=0, upload=0`. No management
  control is offered on a vehicle the viewer does not own.
- **F1/F2/F4** against the correct garage — the harness had been requesting service from whichever
  garage was first in the directory rather than the one under test. Corrected, the request reaches
  **SN Cert Garage snz020359**, `POST 201`, reference `SR-5D66E987`, and is listed afterwards.

**Still failing — F5, and the reason is worth recording:**

The garage tenant-member was *still* redirected off `/garage`, on a candidate that contained the
membership fix. The backend was reporting the membership correctly. Nothing consumed it.

`AuthContext` restores the user from `localStorage` and calls `validateStoredSession`, which has
always returned the authoritative user from `/auth/me` — and threw it away. The app ran on whatever
`localStorage` happened to hold. **A server that is asked and ignored is the same as one that was
never asked**, and this is the failure mode where every unit test is green because the calculation
is right and the wire does not exist.

Fixed by adopting the validated user (and persisting it, so a stale stored identity cannot outlive
its session), and by having `/auth/login` carry the membership too — otherwise the first navigation
after signing in has no tenant and only a full page load would fix it. Login and `/auth/me` share
**one** projection, because two copies is how they would start disagreeing about who someone is.
Four tests pin the WIRE rather than the calculation.

**A harness flaw reported as a product defect — corrected:**

F3 parity was reported FAIL (`history=true profile=false`). It was not. The provider name lives
inside a Radix tab, and Radix **unmounts inactive tab content**, so reading the document text
without opening the tab measured a tab that was not on screen. The API returns exactly the right
data for this owner:

```
provider: { known: true, display_name: "SN Cert Garage snz020359", slug: "sn-cert-snz020359" }
cost:     { recorded: true, amount: 250, currency: "ZIG" }
mileage_observation: { observed_mileage: 91000, source: "garage_stated" }
```

The measurement now opens the tab, additionally compares the always-rendered Vehicle Summary, and
compares the recorded **cost** across both surfaces — which is what F3 was actually about, since the
original defect was a `$0` shown against a real ZIG amount.

### Three measurement flaws of my own, in one round

Worth stating plainly, because they all had the same shape — **a check that could not see its
subject reported something other than "I could not see it"**:

1. Three garage steps reported PASS on "no error element", while the browser was showing the Owner
   Dashboard after a redirect.
2. F3 and F6 silently did not run when a VIN scrape came back empty.
3. F3 read a tab that was unmounted and called the absence a product defect.

Each is now either an explicit assertion that the surface rendered, or an explicit finding that the
check could not be performed.


---

## Round 2 — third and fourth passes, and what they were really about

F5 took **four** attempts. Each fix was correct in the layer I was looking at and did not reach the
layer that mattered. Recording the sequence, because the sequence is the finding:

| pass | candidate | what happened |
|---|---|---|
| 2b | `e2c920dc` | The backend was extended to report the membership. The **session never read it** — `AuthContext` called `/auth/me` and discarded the answer. |
| 2c | `f9721691` | The session adopted it. The **backend could no longer produce it**: `resolveActiveMembership` selected `tenant_users.created_at`, a column that does not exist, and a bare `catch` turned the PostgREST error into a confident *"this person belongs to no tenant."* |
| 2d | `f649b679` | The membership arrived. The garage member reached `/garage` — and was shown **"Feature unavailable. This feature is currently turned off."** Feature governance computed eligibility from the platform role alone. |
| 2e | `1a8efc1b` | Eligibility accepts the verified tenant role, as `resolveEffectiveRole` already did. |

**The shape of it.** A garage employee holds two true roles: `owner` platform-wide, `mechanic`
inside their garage. **Four separate layers** judged them by the wrong one — the API role check,
route access, sidebar visibility, and feature governance. Each was written independently, each
looked right on its own, and each was a complete block on its own. The rule was already settled in
`resolveEffectiveRole`: *the platform role **or** the verified tenant role*. Three layers had simply
never been told.

None of this was visible from the test suites, which were green throughout. It was visible the
moment a real account opened a real browser.

**A defect I introduced and the tests could not have caught.** `resolveActiveMembership` guessed a
column name, and the `catch` around it converted a broken query into an answer. A stub-based test
cannot catch either: a stub returns whatever it is asked for. The test that now guards it reads the
query out of `server.js` and checks every column it names against the canonical schema in
`database/migrations/002`, and asserts the error is inspected and logged rather than swallowed.
Mutation-tested: putting `created_at` back turns it red.

### The measurement discipline this round forced

Four readings in this harness were wrong, all with one shape — **a check that could not see its
subject reported something other than "I could not see it."**

| what I did | what it reported | what was true |
|---|---|---|
| Checked for an error element | PASS | the browser was on the Owner Dashboard after a redirect |
| Scraped a VIN from prose | (silently skipped F3 and F6) | the checks never ran |
| Read a Radix tab without opening it | "the two surfaces disagree" | the tab was unmounted |
| Waited 6s for a page that renders at ~10s | "the two surfaces disagree" | it was a screenshot of a spinner |

Every fixed wait is now a wait on a real signal, and every surface check now distinguishes
**rendered**, **redirected** and **never-rendered** rather than collapsing them. The Workshop step
in pass 2d reported *"redirected away — landed on /garage"* — a sentence that cannot be true, and
the clearest evidence that the harness, not the product, was confused.

**An observation, not a defect:** the Vehicle Profile renders at ~10s, gated on
`/vehicles/:vin/passport` taking ~9.4s on staging. Nothing in this tranche caused it and nothing
here fixes it, but a ten-second wait for a core owner surface is worth someone's attention.
