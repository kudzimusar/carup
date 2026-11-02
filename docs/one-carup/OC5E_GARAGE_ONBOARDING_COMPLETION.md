# OC-5E — Garage onboarding completion (the #209 port)

Branch `feat/oc5e-garage-onboarding-completion`, stacked on OC-5D (`f1d47716`), itself stacked on
OC-5A, OC-5B and OC-5C from RC1 (`75449a16`). PR #209 (`ce45e16f`, Draft) was **ported, never
merged**: GMO-3 (the reviewer), GMO-4 (activation), GMO-6 (invitations) and GMO-7 (membership) were
re-read against this lineage and moved onto OC-5D's verified, explicit active-tenant context and
OC-5C's step-up and identity assurance. GMO-1 and GMO-2 were already in RC1 (OCR C3).

Evidence levels follow `ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md`. Every slice is
**SOURCE-certified** (CI plus mutation testing). The four new database functions and the invitations
table are also **DATABASE-certified**: PGlite, built only from the repository's own migrations, with
Supabase's default privileges applied so that a missing REVOKE would show. Receipts are in
`certification/ONE_CARUP_CERTIFICATION_MANIFEST.json`.

Nothing here is deployed, live-provider certified or owner-accepted. No migration was applied
anywhere. #209's owner acceptance (GMO-8, at `5bc3c96e`) certified #209's own lineage; it does not
transfer to this port.

## Slices

| Slice | Commit | CI | Mutants | Disposition |
|---|---|---|---|---|
| C3 evidence audits name their subject | `2f9a8e18` | 37249756173 | 2/2 | NEW FIX (found while porting GMO-3) |
| GMO-3/4 backend — atomic decision, activation | `b28cf5b2` | 37249756173 | 34/34 | PORTED, re-authored |
| GMO-3/4 web — the reviewer, the founder's way in | `02020b8d` | 37250510581 | 11/11 | PORTED, re-authored |
| GMO-6/7 backend — invitations, membership, F1 | `4068fe1f` | 37252471534 | 27/28 + 1 equivalent | PORTED, re-authored |
| GMO-6/7 web — joining, the team | `30371365` | 37252997449 | 12/12 | PORTED, re-authored |
| GMO-0 writer guard; GMO-1 autosave tests | `a602575c` | 37253509997 | 3/3 | NEW GUARD; tests PORTED |

In all, 89 mutants were killed and 1 is recorded as equivalent: auditing the invitation token under
the key `token` is redacted by the audit logger, and the test still searches the whole audit row for
the token.

## What changed beyond #209, and why

**The reviewer (GMO-3).**
- A decision is ONE transaction (`record_garage_application_decision`). #209 wrote the ledger row
  first and then made a status-guarded update. The loser of a race was told "not applied" while the
  ledger kept its decision.
- A reviewer never sees an application the applicant has not submitted. #209 listed and opened drafts.
- The review capability is platform administration only. #209 put it in the shared people set, so
  `government` would have gained, implicitly, the power to create business workspaces. Recorded as an
  owner decision; it fails closed.
- Every consequential web action (deciding, previewing a private document, retrying the workspace)
  goes through the ONE shared step-up path. #209 kept its own prompt and never guarded the retry.

**Activation (GMO-4).**
- #209's function is unchanged in shape, so it applies over an environment that ran #209's copy. It
  is now SECURITY INVOKER with a pinned search_path, and only the backend may execute it.
- Activation re-checks the applicant's governed identity. A retry can arrive after a suspension.
- The founder is offered the new garage and SELECTS it (OC-5D: chosen, never guessed). #209's own
  garage-context rule (GMO-5) is not ported: OC-5D superseded it.

**Invitations and membership (GMO-6/7), and F1.**
- F1: #209's services read `actor.tenantId` / `actor.tenantRole`, which a dealership's tenant admin
  also carries. Acceptance never read the tenant at all. Now the routes require the selected,
  verified organisation to be a garage and the person to be its admin. The services read only that
  verified garage. Acceptance seats people only in an ACTIVE GARAGE. Each layer is pinned on its own.
- Acceptance is ONE transaction. The person's own address must be the invited one AND verified (SA1);
  otherwise whoever registers the invitee's address first takes the link. #209 claimed the
  invitation, then inserted the membership in a second call.
- Removal and role changes run under a lock on the garage. #209 counted admins, then acted, in two
  calls, so two admins demoting each other at once left the garage with none.
- Signing in comes back to the invitation via `returnTo`. #209 linked `?next=`, which nothing reads.
  Joining takes the person into the garage, not to the owner dashboard.
- An expired invitation can be cancelled. Until it is, it blocks re-inviting that person.

**Audit (all slices).** `trust_audit_events` has no target column. The normalizer keeps a target id
only for vehicle, evidence and PartSentry targets, and reads `previous_value`, not `old_value`.
#209's rows, and RC1's C3 evidence rows, could not be tied to what they recorded. Every OC-5E event
now carries its subject's ids in its values. The platform-wide gap is recorded for the RC2 residual
scan.

**GMO-0.** This lineage had no product writer of `tenant_users`. GMO adds exactly four (activation,
acceptance, removal, role change), each one database function behind one service. A guard enumerates
every write in backend code (supabase chains and raw SQL) and in the schema, and fails on any other.

## Deferred, and why

- **GMO-8 re-certification tooling** (golden journey, activation race, step-up scripts). It runs
  against a staging pair, and staging identity is unresolved, so OC-5 deploys nothing to staging.
  The race on `FOR UPDATE` cannot be shown on single-connection PGlite. Both belong to the staging
  certification step of the RC2 runbook.
- **Notifications** for decisions, activation, invitations and membership changes. No template exists
  for any of them. #209 subscribed none, and `KNOWN_UNREGISTERED` must not grow. Invitation delivery
  is manual: the admin copies the link.
- **#209 43be0ad2** (identity classification and extraction trust as independent axes) is O2's lane.
  Without it, some applicants may never reach an approved identity, so approval stays blocked for
  them.

## Not applied anywhere

`database/migrations/20261004190000..20261004190300_gmo*` (the decision, activation, invitations and
membership functions, and the invitations table).

## Correction to the OC-5D record

OC-5D wrote that `PUT /api/auth/active-tenant` is "the only way a session gains an organisation".
`switch-role` also mints a NEW session bound to a verified membership, and audits it. The accurate
statement: an existing session gains an organisation only through that endpoint, a new session can
be born with one through `switch-role`, and login never selects. Both paths re-verify.

## Open owner decisions recorded by this phase

1. Who holds garage review: platform administration only (this port, fail closed) or `government` too
   (#209).
2. Approval builds the workspace in the same request (kept from #209), reported separately and
   retryable.
3. Activation audit failure: the workspace is committed, so the call does not fail; the result
   reports `auditRecorded: false`.
4. Invitation acceptance requires a verified email (this port). The alternative is to accept an
   unverified one and accept the account-squatting risk.
5. A garage admin may invite another admin (kept from #209), with no identity check of the invitee
   beyond the verified email.
6. Removal is a hard delete of the membership. A removed admin's pending invitations stay open, and a
   removed mechanic's open assignments stay.
7. An invitation's `invited_by_user_id` is NO ACTION (#209's shape, kept for parity), which blocks
   deleting that person.
8. Garage events notify nobody until templates are authored and registered.
9. Port #209 43be0ad2 (O2) before any end-to-end garage UAT.
10. Lending the `mechanic` role through a garage membership (OC-5A's lendable rule) to the legacy
    `/api/mechanic/*` routes: should it require the tenant to be a garage?
