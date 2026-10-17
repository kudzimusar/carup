# OC-5G — The notification registry, completed

Branch `feat/oc5g-notification-template-registry`, stacked on OC-5F (`4bb346d1`). The programme
moderator directed this phase to register six templates:

- `seller_authority_v1`
- `verification_decision_v1`
- `evidence_review_v1`
- `listing_moderation_v1`
- `vehicle_trust_update_v1`
- `safetrade_transaction_v1`

Each was to leave the coverage gate's `KNOWN_UNREGISTERED` only once registered. All six are
registered and the list is gone. Registering them alone would not have delivered them correctly, so
this phase also fixes the live routing those notices run on, and widens the gate to see every
governed render.

Evidence levels follow `ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md`:

- Every slice is **SOURCE-certified** (CI plus mutation testing).
- The migration is also **DATABASE-certified**: PGlite over Communications 2.0's own registry DDL, and
  alongside every other template-only migration.
- Receipts are in `certification/ONE_CARUP_CERTIFICATION_MANIFEST.json`.

Nothing here is deployed or applied anywhere, and no provider was called.

## Slices

| Slice | Commit | CI | Mutants | Disposition |
|---|---|---|---|---|
| G1 — the live notification path honours `policyChannelsOnly` | `572a8927` | 37259048084 | 5/5 | NEW FIX |
| G2 — the six policy templates registered, with mirrors and copy rules | `e49b17ce` | 37260537175 | 17/17 | REGISTERED (moderator-directed) |
| G3 — the coverage gate sees every governed render | `e49b17ce` | 37260537175 | 7/7 | NEW GUARD |

29 mutants were killed and none survived. Five of them are product mutations: three emitter or
variable regressions and two call-site key changes.

## What changed, and why

**G1 — the routing those notices run on.**
- Every in-app-only policy declares `channels: ['in_app'], fallbackChannels: [],
  policyChannelsOnly: true`. Four suites pin that declaration ("a user preference cannot widen it
  into an external send"). None proved the live path enforced it, and it did not.
- The factory wires `CommunicationProductNotificationService` → `CommunicationCanonicalNotificationService`.
  The canonical class's reimplemented `queueFromDomainEvent` took the preference route as given; only
  the unused base class applied the cap.
- So an in-app-only notice went out on email to anyone who preferred email. Even the default
  preferences queued email and push as its fallbacks.
- The cap now applies in the method that runs. The proof goes through `createCommunicationServices`
  (the wiring, not the class), over every capped policy and every preferred external channel.
- **Behaviour change, disclosed:** people who preferred email or push no longer receive in-app-only
  notices on those channels. Their policies never allowed it.

**G2 — the six templates.**
- `20261004210000` registers each key once: active, classified as its policies are, with one approved
  version.
- **Channels follow the policies.**
  - The four in-app-only templates get an `in_app` version. The registry approves exactly what the
    policy allows, so an off-policy route fails closed instead of sending.
  - Vehicle trust and SafeTrade route by preference, so theirs is `default`.
  - A version attaches only to a template this migration registered. If another lane registered a key
    first, that registration governs.
- **Every required variable is fed by the real emitter.** This holds for all fifteen bound event types:
  - identity: approve, request resubmission, reject;
  - all six moderation actions;
  - both evidence outcomes;
  - every reviewer seller-authority decision;
  - vehicle trust;
  - all ten SafeTrade stages, through the real adapter on payloads shaped by keys read out of the SQL
    emitters.

  None of these variables is ever a placeholder default (`listing`, `CarUp`, `updated` …). The
  runtime cannot catch a placeholder; its required-variable check only rejects empty values.
- **Each emitter's payload is pinned to its source.** An emitter that stops sending a variable fails
  the build.
- **The in-code mirrors are the registered copy.** Vehicle trust and SafeTrade had no mirror. Before a
  registry existed they fell back to the acknowledgement template, so a SafeTrade stage read "CarUp
  received your message about MARKETPLACE_FUNDS_HELD".
- `KNOWN_UNREGISTERED` is gone. The gate is strict: a new policy key ships with its registration, or
  the build fails.

**G3 — the gate sees every governed render.**
- The registration gate read `NOTIFICATION_POLICIES` only. A key rendered through the governed path by
  a producer, the auth emails or a route could be unregistered, with every send failing closed, while
  the suite stayed green.
- The gate now parses the `queueNotification` / `queueAuthEmail` / `templateService.render` call
  sites. It found one such key: **`leadership_welcome_v1`**. Email Experience R1's producer renders it
  on every verified address, and no migration registers it. It is recorded below as an owner decision.
- The gate also had a second blind spot: it did not count schema-qualified registrations
  (`INSERT INTO public.communication_templates`, which is how SA1 registers the auth emails).

**A full-suite flake, fixed on the way.** The first full backend run of this phase failed one test
(7939 passed, 1 failed). The X1 "zero runtime references" scan listed
`backend/services/blockchain/__mutant__2.blockchainService.js` and then could not read it.
`issue-158-terminal-operation-identity` writes such transient copies beside the real module while
other files run, so the scan raced against it. The test passes alone. Three earlier scanners already
skip `__mutant__*`; X1's did not, and G3's new walk would have had the same exposure. Both now skip
it, as the others do. Other tree scanners are listed for the RC2 residual scan.

## The copy, for the lanes and the owner

- **Four lane copies registered as they stand, one corrected.**
  - Verification, moderation and evidence are the lanes' own in-code mirrors, verbatim.
  - The seller-authority mirror said "was reviewed by CarUp: {{decision}}". `under_review` is a valid
    reviewer decision, so it read "was reviewed by CarUp: Seller authority under CarUp review".
  - It now reads "CarUp updated the seller authority for vehicle {{listing_id}}: {{decision}}." That
    is true of every statement. The mirror changed with it.
- **Two new bodies, deliberately minimal.**
  - They state governed facts only: the vehicle, and where to look. They make no stage, payment or
    score claim; R4/R5 forbid inventing those, and no variable carries them safely.
  - SafeTrade does not name the stage in-app. R4 requires a sandbox stage to say SANDBOX, and nothing
    in the event tells the template whether the provider is live.
  - Their subjects are R4/R5's own headings. Their email bodies are still built by R4/R5.
- **Raw tokens remain** in the lanes' wording, for example "has an outcome: request_resubmission" and
  "moderation decision: flag_risk". Mapping them to labels is the lanes' change.

## Not done, and why

- **`leadership_welcome_v1`** (Email Experience R1). Its governed subject and body are the lane's to
  author, and it was not in the six. It is listed in the gate as an owner decision. The gate fails when
  it is registered, until the entry is removed.
- **Replay of dead-lettered events.** Events that dead-lettered before registration stay dead.
  Replaying them would send stale SafeTrade stages and trust changes, so it is an operator decision.
- **The registry's state on staging and production** was not verified: OC-5 has no staging access.

## Not applied anywhere

`database/migrations/20261004210000_oc5g_policy_notification_templates.sql`.

## Residuals for the RC2 scan

- `leadership_welcome_v1` is unregistered (owner decision above).
- **Listing moderation stores the moderator's free-text reason.** It is never rendered (pinned), but
  the policy path stores every variable, so it persists in `messages.content_json.data` and
  `notification_queue.payload.safe_payload`. Present before OC-5G.
- **Raw decision tokens** in governed copy (lanes).
- **Tree scanners without the `__mutant__` guard.** A race with
  `issue-158-terminal-operation-identity`'s transient copies can flake them in a parallel full run.
  Observed once, in X1, and fixed there.

## Open owner decisions recorded by this phase

1. The two new bodies and the seller-authority correction: the lanes' review. A later governed
   version can replace any of them.
2. `leadership_welcome_v1`: register R1's copy (Email Experience lane).
3. Whether to replay dead-lettered events.
4. Labels instead of raw tokens in decision copy.
5. Keep, or stop storing, the moderator's free text in notification payloads.
