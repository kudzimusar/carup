# GMO-3 — Review & Decision · RECEIPT

**Status: PASS.** There is now someone who can say yes.

## What now works

An authorised CarUp Operations / Compliance reviewer opens **Garage Applications**, sees what is
waiting, reads the evidence and the applicant's governed identity state, and records a decision:
start reviewing · ask for more · approve · not approve.

Before this, an application could be sent and would wait forever.

## The load-bearing separation: a decision is not an activation

`approve` writes status, who decided, when, and why. It creates **no tenant and no membership**.
That is GMO-4's single job, and the schema enforces the ordering — `activated_tenant_id` is refused
unless the row is already approved.

Proven three ways: an approval run against a logging client touches no `tenants`/`tenant_users`
(and never sets `activated_tenant_id`); a structural test asserts the service file cannot reference
those tables at all; and a mutation that makes approval also activate turns the suite red.

## PO-3, honoured with canonical machinery

Three layers, the same ones that already govern dealer compliance decisions and identity review:

```
authorizeRole(['admin','government','reviewer'])   a real admin-class session
requireOperationsCapability(GARAGE_ONBOARDING_REVIEW)  named authority from the SERVER-side
                                                        platform role + a proven session
requireAuthenticationAssurance(SENSITIVE)          X3 step-up, on deciding AND on viewing
                                                    private evidence
```

`operations.garage_onboarding.review` was added to the existing capability catalogue rather than
built as a parallel gate.

**Access UAT.** `owner`, `mechanic`, `dealer`, `buyer` and `seller` all lack the capability. And a
**tenant** role cannot confer it — `{platformRole:'owner', role:'admin'}` is refused, which matters
because GMO-4 is about to create exactly that shape: a garage admin who is a platform owner.

**A reviewer cannot decide their own application.** No capability check catches self-approval; this
is a separate explicit guard, and removing it turns the suite red.

## The six states, kept apart

| status | reviewer may | notes |
|---|---|---|
| `submitted` | start_review · request_more_info · approve · reject | |
| `under_review` | request_more_info · approve · reject | |
| `information_required` | *nothing* | waiting on the applicant; it returns when they resend |
| `approved` / `rejected` | *nothing* | terminal |

`request_more_info` keeps the **same** application and creates no new row. `reject` is terminal and
records reason + reason code (PO-5: never rewritten back into review). Both require a reason —
*"a decision that pauses or closes an application must carry a reason."*

## PO-2 prerequisites, checked as facts

Approval is refused unless the applicant's **governed O2 identity** is approved and at least one
piece of business-presence evidence exists. Identity is consumed from O2, never re-derived and never
inferred from the application's own contents.

**An identity outage is not a finding against the applicant.** A failed read blocks approval with
*"This is a system problem, not a finding against them — try again before deciding"* — deliberately
different wording from *"not approved"*, and tested to be so.

**Approving is not verifying.** A test asserts the service can never write a business-verified flag,
and the page tells the reviewer: *"Approving records your decision. It does not verify the business,
and the workspace is created separately."* PO-2's public truth rule survives intact.

## Decisions worth recording

- **The ledger is written before the status moves.** A decision that moved an application but
  recorded no author is worse than one that failed outright. Mutation-proven by reordering.
- **The browser renders authority, never computes it.** `allowed_decisions` and `blocking` come from
  the server, so a reviewer cannot reach an action the server would refuse.
- **Withdrawn evidence stays visible to the reviewer**, marked as withdrawn — no gap where their
  reasoning used to be.
- **Concurrent reviewers:** the status update is guarded on the state that was read, so the loser is
  told *"your decision was not applied"* rather than silently overwriting.

## Evidence

| gate | result |
|---|---|
| `gmo-3-garage-review.test.js` | **30 / 30** |
| `garageApplications.test.tsx` | **16 / 16** |
| GMO-1 + GMO-2 + mounting + migrations + boundaries | **108 / 108** |
| web: design gate + garage + admin + lib + config | **627 / 627** (51 files) |
| O2 parent regression (`o2-*`, `operations-*`, `identity-*`, `dealer-*`) | **343 / 344** |
| runtime route mounting | 14 GMO routes live (4 + 6 + 4); 774 total |
| typecheck (`web/tsconfig.app.json`) | clean |

The single O2 failure is **X7-4**, the lane-isolation guard asserting *"PR #197 code must NOT be
present on this branch"* — false by construction on a convergence branch, dispositioned in the lane
reconciliation receipt §4.1 and deliberately not modified. It is the same assertion as before this
phase; the X4 biometric failure recorded alongside it has since been fixed, so the parent went from
2 failures to 1.

## Mutation gates (all five turn the suite red)

| mutation | result |
|---|---|
| remove the self-review guard | **red** — 1 test |
| let approval proceed with an unapproved identity | **red** — 3 tests |
| make approval also set `activated_tenant_id` | **red** — 2 tests |
| grant `owner` the review capability | **red** — 2 tests |
| write the ledger *after* the status moves | **red** — 1 test |

Every mutation was reverted and the suite re-verified clean at 30/30.

An earlier attempt at the fifth mutation renamed variables without actually reordering anything and
so proved nothing; it was redone as a genuine reorder. A mutation that does not mutate is a green
light you have not earned.

## Open

Activation — creating the tenant and the founding membership — is **GMO-4**. Until then an approved
application is a recorded judgment with no workspace behind it, which is exactly what the schema
expects.
