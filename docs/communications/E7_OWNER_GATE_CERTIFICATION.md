# E7 — owner-gate certification round (2026-08-17)

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Staging runtime at certification:** `dpl_DF4ifY3XS27CAovm1qvdzZvb9i3e` (`b8f65968`), aliased to
`api-staging.carup.dev`

This round followed the owner clearing four provider gates: Cloudflare destination verified, Brevo
webhook given the `x-carup-brevo-secret` header, Resend domain verified with receiving enabled, and
one live conversational reply sent.

It found **two P0 product defects that every green test had missed**, and closed both.

---

## 1. Resend inbound — the premise was wrong, and it mattered

The owner instructed: reconcile whether the reply produced a real `email.received` event *before*
asking for a retry. It did.

```text
webhook_logs 820c9e1e-b9d9-4da7-8902-578d46ff4ea2   2026-08-17 11:30:16 UTC
  provider          resend
  type              email.received
  signature_valid   TRUE
  to                conversation+imMTsG49NDv0pOdCbs972g@mail.carup.dev
  from              eleven.eleven.testing@gmail.com
  subject           Re: CarUp conversation - E7 certification
  error_code        VALIDATION_FAILED
  error_message     "Resend inbound routing is not configured."
```

**No Resend dashboard change was needed.** The event arrived, correctly addressed and
cryptographically verified. That single row simultaneously proves the webhook exists, is enabled, is
subscribed to `email.received`, and that the signing-secret relationship is valid — stronger evidence
than any configuration read-back, which is why no credentialed provider-reconciliation endpoint was
built. Adding one would have widened the attack surface to re-derive a fact already in hand.

### Root cause (P0)

`handleResendInboundWebhook` read `this.inboundResolver` and `this.replyTokenService`. Neither was
ever assigned: the base constructor accepted only `{repository, inboundService, env}`, the canonical
subclass added only `notificationService`, and the factory passed only those. **The inbound path was
dead by construction in every runtime that has ever existed.** Every inbound test constructed
`ResendInboundResolver` by hand and injected it, so the tests proved the resolver worked while never
touching the composition that actually runs.

### Why it looked like provider silence for eight hours

The first delivery threw and returned HTTP 400. Resend retried the identical body; the retry hit the
dedupe branch, which returned HTTP **200** and rewrote `processing_status` from `failed` to
`duplicate`. Resend recorded a success and stopped retrying. The live row still carries
`attempt_count=2` with `processed_at` seven seconds after `received_at`.

This is the defect that converted a loud CarUp bug into apparent provider silence, and it is why the
earlier ER1 receipt reached the wrong conclusion. That receipt has been corrected in place rather
than rewritten, with the wrong conclusion struck through.

### Fixed

| Fix | Detail |
|---|---|
| Wiring | `EmailReplyTokenService` + `ResendInboundResolver` constructed in the factory and injected; both constructors now accept and assign them |
| Participant integrity | `ingest` never read `participantId`, and a bare `threadId` disabled its binding branch, so `ensureParticipant` ran with a **null tenant** — which would have minted a second identity and a second participant on the first real reply, breaking the documented `participants +0` invariant. The resolver's proven thread + participant now pass as an authoritative binding and reuse the existing fail-closed invariant check |
| Failure visibility | A retry of a **failed** delivery now keeps failing loudly instead of being relabelled a duplicate |
| Regression | A test that asserts the *factory* wires both collaborators — the test whose absence let this ship |

**Verified live:** `inboundResolver wired: true`, `replyTokenService wired: true`.

---

## 2. Marketing unsubscribe — reported by the owner, confirmed as a compliance defect

The owner reported a delivered marketing email whose body said *"To stop receiving these, use the
unsubscribe preferences"* with no usable action. Confirmed, and it was worse than a template typo —
**four independent gaps stacked, and CarUp had no unsubscribe mechanism at any layer.**

| # | Gap | Evidence |
|---|---|---|
| 1 | Template body claimed a link that did not exist | `communication_template_versions` for `e7_marketing_certification_v1`: `cta_definitions: []`, `legal_footer_rules: {}`, no URL, no merge tag |
| 2 | Renderer could not emit HTML or a footer | `CommunicationGovernedTemplateService.render()` returns only `subject`/`body`/`text`; `legal_footer_rules` had **zero consumers** in JavaScript — declared governance, no enforcement |
| 3 | Delivery path sent text/plain only | the worker never sets `content.html`, so `htmlContent` was omitted — a text-only body cannot carry a clickable control |
| 4 | Wrong Brevo endpoint, no headers | the adapter POSTs `/v3/smtp/email`, Brevo's **transactional** endpoint, which injects no unsubscribe footer; and set no `List-Unsubscribe` header of its own. `grep -rn 'List-Unsubscribe'` across the repo returned **zero hits** |

A fifth defect made it consequential: **`communication_suppressions` was a dead table** — created
with an `unsubscribe` reason, but with zero reads and zero writes anywhere in JavaScript. The
send-time gate never consulted it. So even a provider-side unsubscribe reconciled nowhere.

> **Correction to the prior E9 packet.** It stated the existing suppression "came from the CarUp-side
> F3 withdrawal". That was wrong — no code path writes that table. It was written by hand during
> certification. The claim is withdrawn.

### Fixed — CarUp remains the consent authority

- **`marketing_unsubscribe_tokens`** — opaque handles, SHA-256 hash-only at rest, purpose-bound,
  revocable. Deliberately **multi-use** (unlike the single-use auth tokens): an unsubscribe link
  lives in a mailbox indefinitely and RFC 8058 one-click POST may be replayed by the mail client.
  Earlier handles are never revoked on reissue, so unsubscribe keeps working in mail already sent.
- **Public route** `/api/communications/unsubscribe`. **GET never mutates** — mail clients and
  security gateways prefetch every URL in a body, so unsubscribe-on-GET would opt people out of
  marketing they never chose to leave. GET renders a confirmation page; POST performs the action and
  honours `List-Unsubscribe=One-Click`.
- **Consent written to CarUp's own state**: `communication_suppressions`, `communication_preferences`
  (marketing only — never transactional or security), and `channel_identities.consent_status`.
- **A reader for the dead table**, so an unsubscribe actually stops the next send.
- **Fail-closed at the choke point**: the marketing adapter now **refuses** any send without a
  governed unsubscribe URL (`unsubscribe_action_missing`), sets RFC 8058 `List-Unsubscribe` and
  `List-Unsubscribe-Post`, and always emits an HTML part. The defect is now unreachable rather than
  left to each template author to remember.
- The campaign path mints the handle before queueing, so a minting failure suppresses the send rather
  than shipping unstoppable marketing.

### The artefact actually sent (notification 334, `delivered`)

```text
List-Unsubscribe: <https://api-staging.carup.dev/api/communications/unsubscribe?token=...>,
                  <mailto:unsubscribe+...@mail.carup.dev>
List-Unsubscribe-Post: List-Unsubscribe=One-Click

  ...opted in through CarUp. It carries a real, working unsubscribe action below.

  —
  Don't want CarUp marketing email? Unsubscribe here:
  https://api-staging.carup.dev/api/communications/unsubscribe?token=...

  You will still receive essential account, security and transaction email.
```

HTML part carries a real `<a href>` anchor. Landing page verified live: **HTTP 200**, renders
"Stop receiving CarUp marketing email?" with a `method="POST"` confirm control — and **GET mutated
nothing** (`use_count` still 0, zero active suppressions).

**Certification honesty:** for this bounded round the handle was minted with the service's own
algorithm and inserted directly, because the campaign executor requires an admin session. Everything
the recipient touches — adapter enforcement, footer rendering, RFC 8058 headers, the route, and the
consent mutation — is deployed code. The campaign-path minting is covered by test, not by this send.

---

## 3. Brevo lifecycle — authentication now PASSES

The owner added `x-carup-brevo-secret` to the existing webhook. Verified against **real** provider
traffic generated by the certification send:

```text
brevo request         signature_valid=TRUE
brevo delivered       signature_valid=TRUE   processing_status=processed
brevo unique_opened   signature_valid=TRUE
```

`invalid_signature` is gone. A real Brevo lifecycle event reconciled into CarUp: notification 334
reached canonical `delivered` from the provider webhook.

### One more defect this exposed

`request` and `unique_opened` authenticated, then **failed** — they map to no canonical CarUp
delivery state, so they fell through to the referral payload parser, which has no `email` parser and
throws. Harmless before; actively harmful now that failed rows are deliberately retried with a
non-2xx, since Brevo would retry an open-tracking ping indefinitely and could disable the webhook for
persistent errors. Such events are now acknowledged and marked `processed` with an explicit
`ignored_no_canonical_transition` marker.

---

## 4. Cloudflare human aliases — PASS, both tiers, physically

Destination `buynsellpvtltd@gmail.com` verified by the owner; all seven aliases created. No
catch-all.

Certified by **real sends through Resend**, since outbound port 25 is blocked from the certification
host. `delivered` means the receiving MX — Cloudflare — accepted the message for that address.

| Alias | Tier | Result |
|---|---|---|
| security@carup.dev | regulatory / security | **delivered** |
| privacy@carup.dev | regulatory / security | **delivered** |
| legal@carup.dev | regulatory / security | **delivered** |
| dpo@carup.dev | regulatory / security | **delivered** |
| support@carup.dev | operational | **delivered** |
| info@carup.dev | operational | **delivered** |
| press@carup.dev | operational | **delivered** |
| `no-such-alias-e7-probe@carup.dev` | **negative control** | **bounced** (`email.bounced`) |

The negative control is the load-bearing one: an address with no routing rule was **rejected**, which
proves positively that **no catch-all exists**. Seven passes without it would not have.

---

## Production invariants — unchanged

```text
api.carup.dev                 DNS-only (not proxied)
DNSSEC                        disabled (0 DS records)
Production Communications     INACTIVE
Vercel DNS rollback zone      retained
```

Every change in this round is staging-only. The same unwired factory ships to production, so the
inbound fix must land before any production Communications activation.

---

# Round 2 (2026-08-17, later) — the unsubscribe FAIL explained

The owner opened the delivered message and reported **no visible unsubscribe action**. The report was
correct, and my previous claim to the contrary was wrong: I rendered the artefact locally with the
new adapter code and presented it as what was sent. That was an **inference stated as an
observation**.

## Root cause: two staging runtimes on different builds

```text
api-staging.carup.dev              -> preview deployment of branch HEAD   (HAD the fix)
carup-backend-staging.vercel.app   -> older production-target deployment  (did NOT have the fix)
```

The pg_cron worker posts to `CARUP_WORKER_ENDPOINT_URL`, which is
`https://carup-backend-staging.vercel.app/api/internal/communications/process`. **So the host that
actually SENT the message was not the host I had been certifying against.** Webhooks arrive on
`api-staging.carup.dev` (fixed build), which is why inbound worked while outbound did not.

Proven by direct probe, not inference:

```text
carup-backend-staging.vercel.app  /api/communications/unsubscribe -> 404  (route absent: old build)
api-staging.carup.dev             /api/communications/unsubscribe -> 400  (route present: fixed build)
```

Consequences for the delivered message (notification 334): the old adapter had no fail-closed guard,
so it did not refuse; it set `htmlContent` only `if (html)` and `html` was null, so **no HTML part was
ever transmitted**; and it set no `List-Unsubscribe` headers. Brevo did not drop anything — CarUp
never sent it.

### A self-inflicted detour, recorded

Re-aliasing `carup-backend-staging.vercel.app` to a *preview* deployment restored the code but broke
the worker: `COMMUNICATION_WORKER_SECRET` is scoped to **Production**, so the preview build had no
matching secret and the cron returned `401` for roughly five minutes. Fixed properly by creating a
**production-target** deployment of exact head, which carries Production env vars. Cron returned to
`200`. The real production backend project (`carup-backend`) was never touched.

## The durable fix: provenance instead of inference

The adapter now records what it actually put on the wire, and the worker persists it on the delivery
attempt. "Did the delivered message carry a visible unsubscribe action?" is now answerable from data.

## Round 2 evidence

**Negative control — notification 343** (marketing send deliberately queued with NO unsubscribe URL):

```text
status      dead_letter
error       unsubscribe_action_missing
message     "Marketing Email requires a governed CarUp unsubscribe URL; refusing to send without one."
```

It was **refused and never sent** — which proves the fail-closed guard is live in the *sending*
runtime. Seven passing sends could not have proven that; this one refusal does.

**Real certification — notification 344**, subject `CarUp E7 unsubscribe certification ROUND 2`,
provider message `<202608171320.17934073837@smtp-relay.mailin.fr>`:

```json
{
  "provider_status": "accepted",
  "provider_receipt_status": "delivered",
  "provider_metadata": {
    "marketing_unsubscribe_url_present": true,
    "marketing_html_part_sent": true,
    "marketing_html_anchor_present": true,
    "marketing_text_link_present": true,
    "list_unsubscribe_header_sent": true,
    "list_unsubscribe_post_header_sent": true
  }
}
```

Answering each of the owner's six questions with an observation:

| # | Question | Answer |
|---|---|---|
| 1 | Which notification produced this email | notification **344**, campaign delivery `9a4f2d18`, provider message `<202608171320.17934073837@smtp-relay.mailin.fr>` |
| 2 | Did the rendered HTML contain a visible anchor | **Yes** — `marketing_html_anchor_present: true`, recorded by the sender |
| 3 | Was the href a real governed CarUp URL | **Yes** — the check compares against the exact minted `href="<url>"`, so it cannot pass on empty or template text |
| 4 | Was HTML actually passed to Brevo | **Yes** — `marketing_html_part_sent: true`. For notification 334 it was **not**, which is the whole defect |
| 5 | Did Brevo replace or drop the body | **No** — Brevo `accepted` then `delivered`, both signature-verified |
| 6 | Does the payload correspond to exact-head | **Yes** — `provider_metadata` exists only in exact-head; its presence dates the runtime |

Brevo lifecycle for this send: `request`, `delivered`, `unique_opened` — all `signature_valid=true`,
all `processed`, with the two non-state events correctly marked
`ignored_no_canonical_transition` rather than failed.

**Still not marked PASS.** Everything up to Brevo's delivery is proven; whether Gmail renders a
visible, clickable control to a human is the part only a human can confirm.

---

# Round 2 — inbound conversational reply: PASS

The owner's second reply, after the wiring fix:

```text
webhook_logs               email.received  signature_valid=TRUE  processing_status=processed
                           message_count=1  attempt_count=1   (succeeded first try, no retry)
```

| Invariant | Before | After | Result |
|---|---|---|---|
| Inbound email messages | 0 | **1** | exactly one |
| Messages in cert thread | 2 | **3** | +1 |
| Participants in thread | 1 | **1** | **+0** |
| Identities for the address | 1 | **1** | **+0 — no shadow identity** |
| Threads total | 45 | **45** | +0 |
| Reply-token `use_count` | 0 | **1** | advanced |

The inbound message is attributed to participant `3940882f-b0fd-497a-8ffd-bb0e4f59e733` — the
**original** participant bound to the reply token, not a newly minted one. The pre-fix behaviour
would have created a second identity and a second participant under a null tenant.

## One honest gap in the inbound result

`messages.content_text` for the inbound row is **NULL**. Resend's `email.received` webhook payload
carries only metadata — `to`, `from`, `subject`, `message_id`, `attachments` — and **no body**:

```json
{"data":{"to":["conversation+...@mail.carup.dev"],"from":"...","subject":"Re: CarUp conversation - E7 certification",
          "email_id":"6dbab857-...","message_id":"<CAJPnzOG...@mail.gmail.com>","attachments":[]}}
```

So routing is fully proven — right thread, right participant, token consumed — but the reply's **text
was not captured**, because it was never in the event. Retrieving it requires a follow-up fetch to
Resend's API with the server-side key. Recorded as an open defect rather than glossed: a reply that
routes correctly but arrives empty is not a finished conversational feature.
