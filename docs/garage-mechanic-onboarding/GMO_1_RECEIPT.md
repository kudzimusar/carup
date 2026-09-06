# GMO-1 — Garage Application · RECEIPT

**Status: PASS.** The applicant journey exists.

## What now works

A person who registers as `Business → Garage / Service Centre` can reach
**"Finish setting up your garage"** at `/dashboard/garage-setup`, start an application, save as they
go, see exactly what is still missing, and send it to CarUp. They can find it again after refresh,
logout/login and browser back, on desktop and mobile.

Route lives in the OWNER shell deliberately: an applicant is a platform `owner` until an approved
decision activates them, so the surface must be reachable *before* any garage exists.

## What it deliberately does NOT do

Nothing. `garageApplicationService` never touches `tenants`, `tenant_users`, `users` or
`GARAGE_ROLES`, and a test asserts that structurally. The page says so to the applicant too:
*"Sending this does not make you a CarUp garage on its own. Someone reviews it first."*

## Decisions worth recording

- **The self-service gate.** Reading the caller's OWN `business_type` to let them fill in their OWN
  form is legitimate — the boundary reconciled with O2 in the lane receipt. A broken profile read
  raises rather than presenting as *"you are not a garage applicant"*.
- **Autosave is permissive; submission is strict.** A draft may be half-finished; forcing
  completeness before anything saves is how progress gets lost. `submissionBlockers()` returns the
  list so the applicant is told before pressing send, not by a 400 afterwards.
- **Service categories** validate against the same governed vocabulary the garage will later publish
  and receive requests against.
- **PO-5 in the data model.** Rejected is terminal; a reapplication is a NEW row carrying
  `supersedes_application_id`. `information_required` keeps the SAME application editable.
- **Seven states never collapse.** A failed read is a loading problem, "not a garage applicant" is
  its own state, and neither is shown as "no application" or as a decision.

## Evidence

| gate | result |
|---|---|
| `gmo-1-garage-application.test.js` | **19 / 19** |
| `garageSetup.test.tsx` | **14 / 14** |
| migration integrity | **31 / 31** |
| runtime route mounting | all 4 GMO-1 routes mounted |
| adversarial + authority boundaries | **14 / 14** |
| design contract gate | **10 / 10** (new surface declared, legacy-card budget 0) |
| typecheck (`web/tsconfig.app.json`) | clean |

**Real PostgreSQL (approved staging, never production).** Four constraints proven by attempting the
refusal: a second live application is refused; a reapplication after rejection is allowed and linked;
`approved` without `decided_at` is refused; activating a non-approved application is refused.
Readback: 2 partial indexes, 4 check constraints, test rows cleaned up. These are what GMO-4's
idempotency rests on.

## Open, by design

Business-presence evidence (PO-2 item 9) arrives in **GMO-2**; person-identity approval (PO-2 item 2)
is O2's and is consumed, not rebuilt. The reviewer who can act on a submitted application arrives in
**GMO-3** — until then an application can be sent and will wait.
