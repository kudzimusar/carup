# GMO-7 — Membership Revocation & Lifecycle · RECEIPT

**Status: PASS.** A garage can end someone's access without erasing what they did.

## The whole phase in one sentence

Removing someone ends what they can do **next**; it touches nothing about what they already did.

```
FUTURE authority   lives in `tenant_users`. Deleting the row ends it.
HISTORICAL truth   lives in `work_order_assignments.mechanic_user_id` and the service record —
                   columns that store WHO DID THE WORK, not who is currently employed.
```

A garage that could erase who serviced a car by removing a mechanic would be a garage whose service
history means nothing — and that history is the thing the Service Network exists to make
trustworthy. **The vehicle's record belongs to the vehicle.**

## Ending future authority — three gates, none of them this service's

Revocation asserts nothing about capability. It follows from the membership row being gone, and the
three places that read it each fail closed for a non-member:

| gate | behaviour for a removed person |
|---|---|
| `assignMechanic` | *"That mechanic is not a member of this garage"* |
| the route gate | 403 before any role decision is reached |
| the mechanic picker | lists only current members |

Asserted by reading those three files, so the claim rests on their code rather than on this
receipt's word.

## Preserving history — proven by what is absent

- No write to `work_order_assignments`, `service_records`, `service_cases`, `service_work_orders` or
  `vehicles` occurs during a removal — checked against a logging client.
- The service is **structurally incapable** of referencing any of them.
- A mutation that adds `UPDATE work_order_assignments SET mechanic_user_id = NULL` turns **two**
  tests red.
- The removal itself survives in the audit record: the membership row is gone; *that this garage
  ended this person's access, and who did it,* is not.

## The last administrator

Cannot be removed, and cannot be demoted. A garage with nobody who can invite, assign or manage is a
garage **no product path can restore** — so `changeMemberRole` exists specifically to give an
administrator a way to hand over before leaving. `removable` is computed server-side and rendered;
the browser does not work it out.

A broken admin count **raises**. Guessing low blocks a legitimate removal; guessing high removes the
last administrator.

## PO-6

Every write names ONE tenant — the caller's verified one. Removal from Garage A cannot reach the
same person's membership of Garage B, asserted across all writes rather than on the delete alone.

## Evidence

| gate | result |
|---|---|
| `gmo-7-membership-lifecycle.test.js` | **27 / 27** |
| `garageTeam.test.tsx` (incl. GMO-7 panel) | 20 / 20 |
| **full backend suite** | **6,395 tests · 1 failure** (the known X7-4 lane guard) · 21 skipped |
| **full web suite** | **1,803 / 1,803** across 186 files |
| typecheck | clean |

## Mutation gates — 7 of 7 red, all reverted

| mutation | result |
|---|---|
| let a mechanic remove people | **red** |
| allow removing the last administrator | **red** |
| **take the tenant from a caller-supplied option** | **red** *(after a gap was closed — see below)* |
| revocation also clears the work history | **red** (2) |
| a broken admin count reads as "plenty" | **red** |
| allow promoting someone to a platform role | **red** |
| a broken member read becomes an empty garage | **red** |

### Two mutations that first looked green

**One was a coverage gap.** `options.tenantId || requireGarageAdmin(actor)` survived, because every
test passed `{}` for options and the fallback always ran — the hostile shape was never constructed.
This is the *same* gap that let the GMO-5 gate change through. Two tests now pass a hostile
`options.tenantId` and both go red under the mutation.

**One was an artifact.** The "broken admin count" mutation did not apply — shell escaping mangled
the replacement. Re-applied with a printed confirmation that the file actually changed, it turns the
suite red. A mutation that does not mutate is a green light you have not earned, and it is now
standard here to prove the edit landed before believing the result.

## A test that earned its keep

`garageSideRoutes.test.ts` parses the backend's own route declarations rather than a list someone
typed. When GMO-5 renamed the garage gate to `authorizeTenantRole`, its parser matched nothing — and
its **sanity check refused to pass on an empty parse**, failing loudly instead of silently agreeing
with zero routes. The parser now accepts both spellings. That guard is the difference between a test
and a decoration.
