# OC-5H — RC2 product journeys

Branch `feat/oc5h-rc2-journeys`, stacked on OC-5G (`aa98e81a`). OC-4E proved RC1's journeys locally.
This phase adds the journeys OC-5 made possible. Each one is one person's path through the shipped
app: real routes, real session authentication (every caller holds a `user_sessions` row; there is no
x-user-id fallback), and real services.

**Status: local proof only.** Canonical staging (`carup-staging`, `eoyenigwevnxwwhyhaer`) is
unavailable, so the deployed journeys are steps of the RC2 runbook. No journey here calls a live
provider, a deployed backend, or any database other than in-process ones.

## The AI label of every RC2 journey

The programme's rule: mocked, intercepted or simulated output is never provider, Trust, Identity,
OCR-quality or deployed evidence. Every journey on the RC2 lineage is labelled.

- **INTERCEPTED** means Cloudflare Workers AI is answered at `fetch` by the test, by model and prompt.
  The request is real; the answer is not.
- **NONE** means no model is in the path.
- **REAL**: no journey ran a real provider. OC-5 ran no live provider at all.

The OC-5H files go further than a label: a `fetch` guard refuses anything that leaves the process,
and a test asserts that nothing escaped.

| Journey | Suite | World | AI |
|---|---|---|---|
| **J1** An organisation is chosen, never guessed | `oc5h-rc2-product-journeys` | in-memory | **NONE** (asserted) |
| **J2** A customer's vehicle is serviced: nothing is recorded until its owner authorizes | `oc5h-rc2-product-journeys` | in-memory + one double (below) | **NONE** (asserted) |
| **J3** A garage is born under step-up, chosen by its founder, and hires a mechanic | `oc5h-rc2-garage-journey` | PGlite (own migrations) | **NONE** (asserted) |
| **J4** A seller's numbers survive a sale (rollup@2) | `oc5h-rc2-product-journeys` | in-memory | **NONE** (asserted) |
| **J5** A governed decision reaches the person — outbox → registry → in-app | `oc5h-rc2-product-journeys` | in-memory + OC-5G's rows from PGlite | **NONE** (asserted) |
| OC-4E Identity | `oc4e-product-journeys` | in-memory | **INTERCEPTED** — Qwen (`@cf/qwen/qwen3.8-27b`) |
| OC-4E People & Compliance | `oc4e-product-journeys` | in-memory | NONE |
| OC-4E Owner / Evidence | `oc4e-product-journeys` | in-memory | NONE |
| OC-4E Ledger | `oc4e-product-journeys` | in-memory | NONE |
| OC-4E Garage (odometer) | `oc4e-product-journeys` | in-memory | **INTERCEPTED** — Qwen |
| OC-4E AI (fraud scan) | `oc4e-product-journeys` | in-memory | **INTERCEPTED** — Gemma (`@cf/google/gemma-4-26b-a4b-it`) |
| OC-4E Seller (private) | `oc4e-product-journeys` | in-memory | **INTERCEPTED** — Gemma |
| OC-4E Seller (Dealer) | `oc4e-product-journeys` | in-memory | NONE |
| OC-4E Buyer | `oc4e-product-journeys` | in-memory | NONE |
| OC-4E Diaspora (Scenario Lab) | `oc4e-product-journeys` | in-memory | NONE |
| OC-4E Mechanic → PartSentry → Ledger | `oc4e-product-journeys` | in-memory | NONE |
| OC-4E browser: Buyer / Owner PartSentry | `tests/agents/50-oc4e-converged-journeys.spec.ts` | localhost browser | **MOCKED** — the API is mocked at the browser boundary |
| OC-5 web surfaces (organisation switcher, garage onboarding, team, Seller) | web suites (jsdom) | jsdom | **MOCKED** — the API client is mocked at its boundary |

## What each new journey asserts at its consequential step

- **J1 (OC-5D):**
  - A garage employee's sole membership is listed and never selected for them.
  - The workspace refuses by name until they choose it (`ACTIVE_TENANT_REQUIRED`).
  - A header naming another organisation is refused.
  - A dealership's admin who chose the dealership is not a garage (`ACTIVE_TENANT_TYPE`), and cannot
    choose a garage they do not belong to.
- **J2 (OC-5D, OC-5A):**
  - The owner requests a service, and the garage accepts and opens a work order. The order is born
    awaiting the custodian.
  - The mechanic's record is refused (409), and nothing is written.
  - The mechanic cannot authorize. The owner authorizes.
  - A record that declares itself `evidence_backed` is refused (400). The record lands as
    `garage_stated`.
  - The owner reads it back through the v1 history contract, which names no other person.
- **J3 (OC-5E, OC-5C, OC-5D):**
  - The reviewer is refused on a stale session (`STEP_UP_REQUIRED`), re-proves their password, and
    approves.
  - Exactly one garage is built in the same request, with the founder as admin.
  - The founder is offered the garage, chooses it, and invites a mechanic. The token is stored only
    hashed.
  - A stranger holding the link cannot take the seat. The mechanic, whose own verified address it
    is, accepts; a replay changes nothing.
  - Both appear on the team.
- **J4 (OC-5F):**
  - The rollup runs as an admin.
  - The seller's pulse counts the compare stage. It credits the reservation the buyer made with the
    seller to the seller, even though the vehicle has since transferred to the buyer.
  - The buyer is not credited. The rows are `rollup@2`.
- **J5 (OC-5G, OC-5C):**
  - The reviewer steps up and records a seller-authority decision (`under_review`). That writes one
    outbox event.
  - The real orchestrator receives it exactly as the live listener forwards it.
  - The seller, who prefers email, is notified in-app only (G1).
  - The copy is the governed registry row (OC-5G's corrected sentence), rendered from the registry and
    not from the in-code fallback.

**The one double.** J2's custodian decision is a single database function
(`mechanic_work_order_decide_authorization`, OC-5A). The in-memory world is not a database, so J2
registers a double with the same guards, error codes and state change.

- The real function (locking, the audit row, every transition) is proven on PostgreSQL in
  `oc5a-partsentry-service-authority`.
- J2 proves the chain around it: the route's own custodian check, and that nothing is recorded until
  the decision exists.
- Removing the route's custodian check alone is therefore not killed in J2. The function refuses the
  same actor, by design.

## Results

Commit `95b33191`; CI 37262014096, in which the OC-5H step runs the new journeys and OC-4E's.

| Proof | Result |
|---|---|
| RC2 journeys (J1–J5, plus the two AI-label guards) | 7/7 |
| OC-4E journeys on the same (extended) world | 11/11 |
| Every suite on the in-memory world, after the `or()` extension | 11 files, 156/156 |
| Mutants on the journeys | 9/9 killed (H-1 … H-10) |

The mutants change one law per journey:

| Mutant | Journey | What it breaks |
|---|---|---|
| H-1 | J1 | an unselected session is let through |
| H-2 | J2 | service is recorded before the owner authorizes |
| H-4 | J4 | reservation credit is dropped |
| H-5 | J4 | the compare stage is not counted |
| H-6 | J5 | G1's channel cap is removed |
| H-7 | J5 | the governed copy changes |
| H-8 | J3 | an invitation is accepted by someone else's account (SQL) |
| H-9 | J3 | approval no longer builds the workspace |
| H-10 | J3 | the decision no longer needs a step-up |

## Recorded, not hidden

- **The in-memory world gained a flat PostgREST `or()`.** Seller Intelligence resolves a seller's
  listings with `.or('owner_id.eq.x,current_seller_id.eq.x')`, and the world answered every such read
  with an error, so J4 first failed with "Intelligence could not be read". The extension refuses
  nested or unknown grammar loudly rather than mis-parsing it.
- **J3's PGlite world** applies `users.password_hash` from its own migration (`20260613010000`),
  verbatim, so the reviewer's step-up is a real password re-proof.
- **No new browser spec.** OC-5's web surfaces are proven in jsdom with the API mocked at the client
  boundary; CI runs the full web suite. A localhost browser journey of the organisation switcher and
  garage onboarding is a candidate for the RC2 runbook's deployed step.
