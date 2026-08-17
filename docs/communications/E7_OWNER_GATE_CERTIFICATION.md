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
