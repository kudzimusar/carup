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

## Round 2 — second pass

*(Filled in below from the re-run against the corrected candidate.)*
