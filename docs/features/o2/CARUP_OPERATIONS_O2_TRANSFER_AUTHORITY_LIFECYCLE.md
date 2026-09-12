# O2 — Ownership transfer → Seller Authority lifecycle design (P1)

The concrete M8-identified gap, verified at `dd94c56d`: completing an ownership transfer changes
`vehicles.owner_id` inside `passport_transition_ownership_transfer_atomic`, but **nothing touches
`vehicle_seller_authority`**, so the previous owner keeps a standing `confirmed` authority over a
vehicle they no longer own.

## Lifecycle principle (from the O2 mandate, verbatim in intent)

ownership transfer becomes canonical
→ prior Seller Authority no longer remains active
→ new authority/ownership relationship follows the governed ownership lifecycle
→ history remains auditable.

## Design

**Where the supersession lives:** in the canonical domain services — specifically, as part of the
transfer COMPLETION path (`transitionOwnershipTransfer` → on `state === 'complete'`), calling a new
`supersedeSellerAuthorityOnOwnershipTransfer` function exported by **`sellerAuthorityService`**
(Seller Authority's own service supersedes its own rows; the transfer service only invokes it).
Operations is not involved at all — this is domain-to-domain, exactly like the publish route calling
`refreshCanonicalTrust`.

**What it does:**

1. Reads the ACTIVE authority rows for the transfer's `vin` whose `seller_user_id` is the
   **previous** owner and whose status is one of `confirmed` / `under_review` / `evidence_submitted`
   / `insufficient`.
2. For each, records the supersession THROUGH the service's governed update: status → `revoked`,
   `reason = 'superseded_by_ownership_transfer:<transferId>'`, `basis` unchanged (history),
   `decided_by = <the governance actor who completed the transfer>`, `decided_by_role` likewise,
   `policy_version` stamped. **No row is deleted; nothing is overwritten silently — the previous
   values live on in the audit event exactly as every other authority decision does.**
3. Writes the standard Seller Authority audit event (fail-closed, before the mutation, same as
   every governed decision in that service).
4. Does **not** create authority for the incoming owner. The new owner's authority follows the
   normal governed lifecycle: their owner relationship (now canonical via `vehicles.owner_id`)
   makes `hasExistingSellerRelationship` true, so if they choose to list, the ordinary
   `seller_authority` machinery applies. **Fabricating a `confirmed` row for them would be
   fabricating a review.**

**Ordering and atomicity:** the `owner_id` change is atomic inside the RPC. The supersession runs
immediately after a successful `complete` transition, in the service layer. If the supersession
write fails, the completion **stands** (ownership is the stronger fact — canonical registry-backed)
and the failure is surfaced loudly in the transfer response *and* thrown to the caller's attention
rather than swallowed, because a standing stale authority is a real inconsistency: the behavioral
test asserts both the success path and the loud-failure path. A follow-up governed re-run of the
supersession is idempotent (revoking a revoked row is a no-op by the service's own no-change exit).

**Disputes and reversals — fail closed:**

- A transfer that is NOT `complete` (any earlier state, or a disputed/cancelled one) supersedes
  nothing. Only the canonical completion event does.
- If an authority row is already `disputed`, supersession still applies (`revoked` with the
  transfer reason) — the dispute's history remains in audit; a dispute against a vehicle you no
  longer own does not keep authority alive.
- There is no "reversal" of a completed transfer in the current domain model; if one ever exists it
  must be its own governed transition, and the previous owner's authority does NOT auto-resurrect —
  they re-claim through the normal path. (Recorded as a deferred question; not built.)

## What P1 explicitly does NOT do

- No deletion of history, no audit rewrite, no fabricated ownership, no Operations-owned truth.
- No new table. No new endpoint. No change to the RPC's SQL (the supersession is service-layer, so
  the registry-backed `owner_id` authority stays exactly as certified).
- No authority grant to the incoming owner.

## Proof obligations (P1 gate)

PGlite behavioral test: seed vehicle + previous-owner `confirmed` authority → begin + complete a
transfer through the real service functions → assert (a) `owner_id` changed, (b) previous
authority `revoked` with the transfer-stamped reason and the completing actor's attribution,
(c) the audit event exists and precedes the mutation in the code path, (d) the incoming owner has
NO authority row, (e) re-running supersession is a no-op, (f) an incomplete transfer supersedes
nothing, and (g) a supersession failure surfaces loudly while the completion stands.
