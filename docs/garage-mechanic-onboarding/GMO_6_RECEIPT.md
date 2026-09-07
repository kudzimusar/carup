# GMO-6 — Mechanic Invitation & Membership · RECEIPT

**Status: PASS.** A garage can bring in the people who work for it.

This is the second of only **two** product paths that create a garage membership, and the only one
an ordinary person can trigger. GMO-4's activation creates the founding admin; this creates everyone
else.

## What now works

A garage administrator invites someone by email, choosing whether they will be a **mechanic** (takes
jobs, records work) or an **administrator** (can also invite). They get a link, shown once. The
invitee lands on a page that tells them which garage, what role, and which email address to use —
*before* asking them to create an account.

## The protections, and what each one actually stops

| protection | what it stops |
|---|---|
| **hashed token** | a leaked table, backup or query log revealing how to accept. Reuses `hashCapabilityToken`, the scheme service capability grants already use. |
| **expiry (7 days)** | an invitation found in an old inbox two years later being a way in. |
| **single use** | a forwarded link seating a second person. |
| **email binding** | *the* wrong-recipient guard. Without it, anyone holding the link joins — and a garage's private customer list is on the other side of it. |
| **tenant binding** | the invitation names its garage; accepting cannot land you anywhere else. |
| **revocable** | an offer sent to the wrong address, withdrawn before it is taken up. |
| **one live invitation per person per garage** | two valid tokens for one person is two independent ways in. |

Each is tested by **attempting the attack**, not by asserting a guard exists.

## Decisions worth recording

- **The claim precedes the membership.** The invitation is marked accepted — guarded on it still
  being open — *before* `tenant_users` is written. If two requests race, exactly one wins the claim
  and the loser creates nothing. The reverse order would mint a membership for a spent invitation.
- **The original invitee re-clicking is a no-op, not an error.** Their membership already exists;
  reporting a failure would send someone to support over a double-tap.
- **An unreadable account email FAILS CLOSED.** The tempting alternative — skip the check when the
  address cannot be read — would turn a database hiccup into an open invitation.
- **Only a garage `admin` may invite**, verified against `tenant_users` for the tenant being acted
  on. A mechanic cannot invite or revoke.
- **`INVITABLE_ROLES` is `['mechanic','admin']`**, constrained in the service *and* by a database
  CHECK. A garage admin cannot mint a platform role.
- **The tenant comes from the verified context, never the request body** — Garage A cannot invite
  into Garage B.
- **CarUp does not pretend to have sent anything.** The page says so: delivery is the garage's, by
  whatever they already use. Implying a message was sent leaves a mechanic waiting for one that
  never arrives.
- **The return path is built, never taken from the URL.** An invitation link is exactly the kind of
  thing that gets forwarded and rewritten; a `?next=` honoured after sign-in is an open redirect
  with a captive audience. Tested with a hostile `next=https://evil.example.com`.
- **Peeking reveals the garage name, role and invited address — nothing operational.** A token found
  in a forwarded email must not be a reconnaissance tool.

## PO-6 — multiple garages

Accepting names ONE tenant and touches no other membership. Joining Garage B does not modify Garage
A, asserted by checking that no update or delete reaches `tenant_users` during acceptance. Someone
already in the garage keeps the role they hold rather than gaining a second row.

## A new invariant, from an adversarial finding

A review noted that no repo-wide rule prevented a future service from writing `tenant_users` — which
matters more now that the garage route gate consults that column. So the authorised set is now
**enumerated in a test**:

1. `activate_garage_application` (the PostgreSQL function, after governed approval) — the founder
2. `garageInvitationService.acceptInvitation` — everyone else

Any other service that writes `tenant_users` fails the suite. A new way to become an operator must
be a deliberate decision, not a diff nobody noticed.

This same discipline caught `garageInvitationRoutes.js` joining the `authorizeTenantRole` opt-in set:
the enumeration test went red and required the decision be recorded. It is legitimate — its
`GARAGE_ADMIN_ROLES` means *administrator of this garage* — and it is now listed explicitly.

## Evidence

| gate | result |
|---|---|
| `gmo-6-garage-invitations.test.js` | **34 / 34** |
| `garageTeam.test.tsx` · `JoinGarage.test.tsx` | see web run |
| GMO 1–6 backend | **154 / 154** |
| Service Network parent (#197) | **289 / 289** |
| authority boundaries (incl. the new invariant) | **10 / 10** |
| typecheck | clean |

## Mutation gates — 10 of 10 red, all reverted

| # | mutation | result |
|---|---|---|
| 1 | drop the wrong-recipient guard | **red** |
| 2 | let anyone replay a spent invitation | **red** |
| 3 | ignore expiry | **red** |
| 4 | ignore revocation | **red** |
| 5 | store the raw token instead of its hash | **red** |
| 6 | let any member invite | **red** (2) |
| 7 | take the tenant from the request body | **red** |
| 8 | create the membership before claiming the invitation | **red** (3) |
| 9 | skip the email check when the account address is unreadable | **red** |
| 10 | allow inviting a platform role | **red** |

## Open

Delivery is manual by design in this lane — no provider was configured or activated, and the UI
states that plainly rather than implying CarUp sent a message. Wiring this to the Communications
lane would be a separate, authorised piece of work.
