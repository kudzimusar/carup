# G4 — Resend send-side provenance

Part of CarUp Email Experience & Design System 1.0. Follows
[G0](EMAIL_EXPERIENCE_1_0_RUNTIME_GAP_CLOSURE.md) ·
[G1](EMAIL_EXPERIENCE_G1_ESCAPING_AUTHORITY.md) ·
[G3](EMAIL_EXPERIENCE_G3_UNSUBSCRIBE_OWNERSHIP.md) ·
[G2](EMAIL_EXPERIENCE_G2_CANONICAL_RENDERER.md).

## Why

Brevo has recorded compliance provenance since E7, and the reason is worth restating: a delivered
marketing message once carried no unsubscribe control while every automated check said it did,
because every check was reading the **code** rather than the **payload**. Resend — which carries four
of the five families, including every P0 security Email — recorded none at all. The only answer to
"what did CarUp actually send?" was an inference from whichever build was believed to be running, and
that inference has already been wrong once, in production, on this exact programme.

No new persistence. The worker already routes `result.providerMetadata` into
`message_delivery_attempts.response_metadata.provider_metadata`; G4 gives Resend something truthful
to put there.

## A. Two different truths, deliberately not conflated

| | records |
|---|---|
| **renderer provenance** (G2) | what `renderEmail.js` **produced** |
| **send provenance** (G4) | what was handed to **Resend** |

During the auth compatibility period they legitimately disagree, and both are true of the same
message:

```text
html_part_rendered = false      # G2 deferred to the certified path
html_part_sent     = true       # authEmailTemplates.js supplied what went on the wire
auth_compatibility_html_used = true
```

Collapsing them would erase the only evidence that the certified auth renderer executed at all.
`html_part_sent` is **never** derived from renderer provenance — mutant Q2 does exactly that and dies.

## B/C. The schema

Every `*_sent` field is read from the `body` object **after** every field on it is settled, and
before the request is issued.

```jsonc
{
  // what the RENDERER produced — carried through untouched
  "renderer_version": "carup-email-renderer/1.0.0",
  "classification": "transactional",
  "classification_source": "producer",
  "template_key": null,
  "template_version": null,
  "footer_family": "transactional",
  "sender_persona": "carup_notifications",
  "leadership_identity_rendered": false,
  "render_fallback_used": null,
  "html_part_rendered": true,
  "cta_href_canonical": true,          // boolean — see §F
  "cta_route": "/orders/42",

  // what went ON THE WIRE
  "send_outcome": "provider_accepted",
  "html_part_sent": true,
  "text_part_sent": true,
  "reply_to_set": false,
  "subject_present": true,
  "html_source": "renderer",           // "renderer" | "auth_compatibility" | null
  "auth_compatibility_html_used": false,
  "sender_persona_consistent": true,
  "idempotency_key_sent": true
}
```

## E/F. Secret safety — the record outlives the credential

A delivery attempt is durable, read by operators, and retained long after any token in it expires. It
is one of the worst places for a live credential.

Nothing recorded: recipient address, Reply-To value, reply token, unsubscribe token, auth/reset
token, tokenized action URL, body, HTML, subject text, API key, headers, raw request, raw user row.

**G2 shipped `cta_href_canonical` as the full action URL.** An auth action URL carries an opaque
single-use reset token, so that field was an evidence-safety defect. It is now:

| field | meaning |
|---|---|
| `cta_href_canonical` | **boolean** — did the action point at a CarUp canonical origin? |
| `cta_route` | the path only. The query string, where every token lives, is discarded. |

Together they prove canonical-origin use and name the flow, and neither can carry a secret. **The
Email itself is unchanged** — the customer still receives the complete working link. Mutant Q5
restores the old behaviour and kills four tests.

`subject_present` is a boolean for the same reason: a subject may carry private content.

## G. Sender persona vs the actual `From`

The renderer names a persona; the adapter independently computes a `From`. If they disagree the
message goes out under an identity nobody chose.

`fromAddress()` keyed on `auth_template_key`; the persona keyed on `classification`. They agree on
every message that exists today — the only producer of `security` also sets an auth template key —
but a future security Email without one would have shipped from the notifications sender under a
Security persona. `fromAddress()` now accepts either, which makes agreement **structural** rather
than coincidental, and the remaining check refuses on mismatch:

```text
sender_persona_mismatch → zero provider calls
```

No new sending address; both branches read env that already exists.

## H/I. Auth compatibility is proven, not disturbed

R2 is **not** migrated. `authEmailTemplates.js` remains the certified P0 path.

| | `html_part_rendered` | `html_part_sent` | `auth_compatibility_html_used` | `text_part_sent` |
|---|---|---|---|---|
| auth success (`O1`) | false | **true** | **true** | true |
| auth HTML fails (`O2`) | false | false | **false** | true — and it still sends |

`O2` drives a real failure (an unknown auth template makes `renderAuthEmail` throw, which
`resolveAuthHtml` swallows so a P0 Email is never blocked). The degradation is now **observable**
instead of silent, and `auth_compatibility_html_used` stays false — an auth template *key* is not
proof the render ran. Mutant Q10 claims it from the key alone and dies.

For the rendered families (`O3`), the HTML Resend receives is byte-identical to the renderer's — the
Resend analogue of G3's Brevo pass-through proof.

## L. Failure semantics

| Situation | Provenance |
|---|---|
| renderer refusal | no provider call, no send provenance |
| adapter pre-send refusal (`O7`) | no provider call, `providerMetadata` **absent** |
| HTTP rejection (`O10b`) | `send_outcome: request_attempted_provider_rejected`, and the fields are named `html_part_in_request` / `text_part_in_request` / `reply_to_in_request` — `*_sent` is **not present** |
| success | complete send provenance |

Attempted is not sent, and the field names must not blur that. Mutant Q8 relabels an attempt as a
send and dies.

## J/K. Level A

`O10` starts from a canonical notification and finishes on the stored row, through the **real**
worker → **real** `EmailTransportRouter` → Resend adapter with captured HTTP:

- exactly one provider call, to `api.resend.com/emails`;
- `attempt.provider === 'resend'` — the routed transport, not the router's own name;
- `attempt.provider_message_id === '<rfc-level-a@mail.carup.dev>'` — the RFC identity a reply carries;
- every stored boolean asserted **against the captured body**, not against itself;
- `stored !== renderer provenance`, and no recipient address anywhere in it.

Mutant Q12 records the router's name instead of the routed transport. Only a test that goes through
the real router can tell the difference — it dies, which is the anti-vacuity receipt for the seam.

## N. The G3 guard is preserved

A Resend payload carrying the marketing unsubscribe marker is still refused with zero provider calls
(`O7`), and that refusal carries **no** `providerMetadata` — nothing was attempted, so there is
nothing truthful to say about a request body. Mutant Q11 removes the guard and kills two tests.

## M. Idempotency

Unchanged. `Idempotency-Key`, `providerRequestId` and the RFC Message-ID keep their existing
semantics. Provenance records `idempotency_key_sent: true` only; the canonical key already lives in
`request_metadata` and is not duplicated.

## Q. Anti-vacuity: twelve source mutants, all killed

| # | Mutant | Killed |
|---|---|---|
| 1 | `html_part_sent` hardcoded true | 1 |
| 2 | `html_part_rendered` copied into `html_part_sent` | 1 |
| 3 | `reply_to_set` hardcoded false | 2 |
| 4 | raw `reply_to` persisted | 1 |
| 5 | full tokenized CTA URL persisted (the G2 defect restored) | 4 |
| 6 | `providerMetadata` dropped from the Resend success result | 12 |
| 7 | worker stores renderer provenance in place of provider metadata | 2 |
| 8 | a rejected request labelled as sent | 1 |
| 9 | sender-persona refusal dropped | 1 |
| 10 | auth compatibility claimed from the template key alone | 1 |
| 11 | G3 non-marketing guard removed from Resend | 2 |
| 12 | worker records the router name instead of the routed transport | 1 |

## Regression

CI environment contract from `.github/workflows/ci.yml`.

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| Baseline (G2 head `a5781e27`) | 4450 | 4429 | 0 | 21 |
| With G4 | 4466 | 4445 | 0 | 21 |

Delta exactly +16 — the new provenance tests. Communications/Email/auth suites: 534 pass, 0 fail.
The lint gate scopes ESLint to `web/`; G4 is backend only.

## Existing tests reclassified

Two assertions in `email-experience-renderer.test.js` expected `cta_href_canonical` to be the full
URL. That was the G2 evidence-safety defect, and the owner named it as a G4 item; both were updated
to the boolean-plus-route contract with the reason recorded inline. Nothing else changed, and nothing
was rewritten to reach green.

## Handed forward

1. **G5** mints per-thread reply addresses. `O4` records `reply_to_set: false` for the conversational
   family today — that is not a gap in the evidence, it **is** the evidence, and it is what makes G5's
   arrival visible in the delivery record.
2. **G6** may retire `resolveAuthHtml()` once R2 equivalence is proven. `auth_compatibility_html_used`
   is the field that will show the migration actually happened rather than being assumed.
3. No live `service` producer exists yet, so `O5` is fixture-driven and says so. A family must be
   selected by a producer, not invented to make a test look real.

`PRODUCTION_COMMUNICATIONS=INACTIVE` throughout. No deploy, no DNS, no provider configuration change.
