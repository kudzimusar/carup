# G10 — R5 Vehicle Passport / Trust Update: `R5_PRODUCER_GAP`

**Status: STOPPED, as the directive requires. No producer was invented.**

## The finding

There is **no canonical producer, domain event, outbox event type or notification policy** in this
repository representing a trust score change or a Vehicle Passport update being communicated to a
customer.

Verified independently, four ways:

| Check | Result |
|---|---|
| `COMMUNICATION_EVENT_TYPES` | 17 subscribed types. None is trust- or passport-related. |
| JS emitters (`emit*Event` / `publish*Event` / `persist*Event` literals) under `backend/services` and `backend/routes` | **zero** matches mentioning trust or passport |
| SQL `INSERT INTO domain_events` across all migrations | six migrations; every event literal is a `MARKETPLACE_*` transaction event |
| `canonicalTrustService.js` | contains no emit, publish, domain-event or notification call of any kind |

`refreshCanonicalTrust(vin, opts)` is the single writer of `vehicles.trust_score` (INV-TRUST-2). It
computes the canonical record, writes the seven-column patch, and returns
`{ record, patch, written, reason }` — and tells nobody.

## Why this is a stop and not a workaround

The directive is explicit: *"If no such producer exists, STOP G10 with `R5_PRODUCER_GAP`… Do not
fake producer availability with a test-only direct queue call and call the reference complete."*

That prohibition is the right one. A reference whose only caller is its own test is not a reference —
it is a renderer with a screenshot. G5 and G2 both nearly shipped in exactly that condition, and both
times the gap was found by driving the real producer rather than a hand-built payload.

The three nearest existing events were considered and each is a **different fact**:

| Event | What it actually means | Why it is not R5 |
|---|---|---|
| `evidence.review.decided` | a reviewer accepted or rejected ONE piece of evidence | an evidence decision is an input to a trust evaluation, not the evaluation. Sending R5 on it would announce a score change that may not have happened. |
| `marketplace.listing.moderated` | a moderator changed a listing's PUBLICATION state | a publication-workflow decision, unrelated to what is known about the vehicle |
| `identity.verification.decided` | a KYC outcome for a PERSON | not about a vehicle at all |

Using any of them would communicate a trust update that the canonical authority never made.

## The minimal wiring required

R5 needs one event, emitted where the trust position actually changes.

**1. Emit at the single writer.** `refreshCanonicalTrust` already holds everything the event needs
— it returns the full canonical `record` and knows whether a write occurred (`written`) and why
(`reason`). The event should be emitted only when the PUBLISHED position changed, not on every
recompute: a refresh that produces the same band and the same evaluation state is not news, and
mailing a customer about it would train them to ignore the ones that matter.

```text
event_type:  vehicle.trust.updated          (canonical dotted form, matching the existing family)
payload:     { vin, evaluation_state, previous_evaluation_state, band, previous_band,
               calculation_version, recipientUserId }
```

**2. Decide the recipient authority.** This is the substantive open question, not the emission. A
vehicle has an owner, possibly a seller, and possibly watchers — and `vehicles.owner_id` is on
`PRIVATE_VEHICLE_FIELDS`, so the resolution must happen inside a producer that is allowed to read it,
never in the Email layer. **Owner decision required:** who is told when a vehicle's trust position
changes?

**3. Subscribe and classify.** Add to `COMMUNICATION_EVENT_TYPES` and give it an explicit
`NOTIFICATION_POLICIES` entry. Classification is `transactional` on the same reasoning as every other
policy — a status change about something the recipient owns.

**4. Then, and only then, R5.** The rendering side is already unblocked: `toPublicTrust` supplies the
audience-safe projection with all ten `PUBLIC_TRUST_FIELDS`, `known_limitations` is always a frozen
array of strings, and `buildMarketplaceListingSummary` supplies public vehicle identity. R5 needs no
new truth source — only something to tell it that a trust position moved.

## What R5 must never do, recorded now so the eventual implementation inherits it

- `evaluated`, `not_evaluated`, `stale` and `unavailable` are four DIFFERENT states. Never map
  `not_evaluated` to `0`, to `unavailable`, or to a placeholder score.
- A numeric score renders **only** when the canonical projection publishes one — which happens only
  when `evaluation_state === 'evaluated'` AND a valid band exists. Otherwise the presentation is
  qualitative. No `--/100`, no estimate, no zero.
- Never read `vehicles.trust_score`. It is excluded from `PUBLIC_VEHICLE_FIELDS` because projecting
  it once published `trust_score: 84` beside a report saying `not_evaluated`.
- Explanations come from canonical `known_limitations` and the evidence basis. Never manufacture
  prose about why a score is low.
- Unknown vehicle facts render as `not_recorded` / `withheld` per `FIELD_STATES` — never backfilled
  from legacy or default columns.

## Blocking status

`R5_PRODUCER_GAP` blocks **R5 only**. It does not block R6, the preview pack, or B4 for the five
references that exist. R5 is absent from the preview pack for the same reason it is absent from the
registry: it has not been built.
