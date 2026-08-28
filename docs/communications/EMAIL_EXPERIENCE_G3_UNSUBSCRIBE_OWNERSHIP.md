# G3 — one unsubscribe owner, and fail-closed marketing consent

Part of CarUp Email Experience & Design System 1.0. Closes the third runtime gap in
`CARUP_EMAIL_EXPERIENCE_DESIGN_SYSTEM_1_0_CANONICAL_PLAN.md`. Follows [G0 recipient
resolution](EMAIL_EXPERIENCE_1_0_RUNTIME_GAP_CLOSURE.md) and [G1 escaping
authority](EMAIL_EXPERIENCE_G1_ESCAPING_AUTHORITY.md).

## Three authorities, and none of them does another's job

| Authority | Owns | Where |
|---|---|---|
| **Canonical consent** | whether a marketing message may be sent | `marketingConsentState.js` over `communication_suppressions` |
| **Presentation** | what the reader sees, in both representations | `emailExperience/marketingUnsubscribePresentation.js` |
| **Transport compliance** | `List-Unsubscribe` / `List-Unsubscribe-Post`, and fail-closed validation | `BrevoMarketingAdapter` |

No new consent store, no new token service, no change to the one-click flow.
`communication_suppressions`, `marketingUnsubscribeService.js` and the marketing preference state
remain the canonical authorities. G3 is ownership and integration closure.

## A. The fail-open

```js
const suppression = await this.marketingSuppressionFor(notification).catch(() => null);
if (suppression) { refuse }
```

`.catch(() => null)` is indistinguishable from *not suppressed*. A database timeout, a dropped
connection, a missing table, a revoked grant — every way of **failing to know** whether someone had
unsubscribed was silently converted into permission to mail them. That is the one failure mode a
consent system must not have: the one where losing the record means the answer is yes.

Three outcomes now, and *unavailable* is its own outcome rather than a shade of either other one:

| Verdict | Provider call | Disposition |
|---|---|---|
| `PERMITTED` | proceeds | — |
| `SUPPRESSED` | **none** | dead-letter, `recipient_suppressed` |
| `UNAVAILABLE` + transient | **none** | retry, `marketing_consent_unavailable:transient` |
| `UNAVAILABLE` + durable | **none** | dead-letter, `marketing_consent_unavailable:durable` |

Unavailable is never folded into `recipient_suppressed`. Recording a fault of ours as a customer's
unsubscribe would put a decision in the audit trail that nobody made.

**Transient is a narrow allow-list**, not a deny-list of known-permanent faults — an unrecognised
failure is durable. Both dispositions are safe because neither sends; they differ only in whether
re-asking could plausibly succeed. A dead-lettered campaign message is recoverable by an operator
requeueing it. An email sent to someone who unsubscribed is not recoverable at all.

**Scoped to marketing in both directions.** An unsubscribe from marketing never blocks security, auth
or transaction email — physically certified during Email 1.0 — and equally, a marketing consent fault
never holds a P0 security email, because the gate is not consulted for non-marketing classifications
at all.

## B. G0 ordering preserved

```text
resolve recipient → canonical consent → prepare compliant content → transport validation → provider
```

Consent is evaluated against the **G0-resolved address**, passed in rather than re-derived. Deriving
it twice is how the two drift apart and consent is checked for one person while mail goes to another.
Pinned by `B1` (call ordering) and `B2` (an unresolved recipient never reaches the consent lookup).

## C/D. The adapter stopped authoring the footer

Deleted from `providerAdapters.js`: `appendUnsubscribeText`, `appendUnsubscribeHtml`,
`escapeHtmlText`. Customer-facing copy is not a transport concern, and a component that *adds* an
unsubscribe block cannot also be trusted to detect a duplicate one.

The adapter now receives finished content, validates it, and passes it through **byte-for-byte**.
Transport headers stay adapter-owned, because those genuinely are a MIME/provider concern.

Canonical copy is preserved **verbatim** from the E7 physical certification — a human read that
wording in a real inbox and accepted it, so it was moved, not re-authored.

## F. The exactly-one contract

Keyed on a CarUp-owned structural marker, `data-carup-unsubscribe="v1"`, emitted only by the
presentation module, invisible to the reader and inert in every mail client. Counting the *word*
"unsubscribe" cannot distinguish the canonical control from editorial copy that mentions
unsubscribing — and a marketing email about managing your preferences is exactly that copy.

| Canonical blocks | Result |
|---|---|
| 0 | **refuse** `unsubscribe_presentation_missing`, zero provider calls |
| 1 | pass |
| ≥2 | **refuse** `unsubscribe_presentation_duplicated`, zero provider calls |

Plus `unsubscribe_presentation_inconsistent` when the control links somewhere other than the
canonical URL, or the transport target disagrees with the visible one.

Validation is deliberately **independent of the composer**: it counts what is in the payload rather
than trusting the declared `unsubscribe_presentation` provenance, so a hand-built send, a future
renderer, or a caller that skipped composition entirely is refused on the same terms. The E7 control
(`unsubscribe_action_missing` with no URL at all) is untouched.

## G. One URL identity, three representations

| Representation | Form |
|---|---|
| HTML `href` | `?token=t&amp;campaign=c` — escaped once, per G1 |
| plain text | `?token=t&campaign=c` |
| `List-Unsubscribe` | `<...?token=t&campaign=c>` — raw, never HTML-escaped |

The adapter reads the https target back **out of the header it actually built**, rather than reusing
the variable that went in — checking the header against itself would prove nothing.
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` is retained; the mailto stays as the RFC 2369
fallback with the https action authoritative.

## H. Non-marketing families

The contract now reads **both ways**. Before G3 it was one-directional: transport refused marketing
content that *lacked* a control, and nothing anywhere refused a security email that *carried* one.

`assertNoMarketingUnsubscribePresentation` runs on the Resend path, which carries every non-marketing
family. Refused, not stripped — silently rewriting content is the behaviour G3 removed. Keyed on the
marker, so a transactional email may still legitimately discuss unsubscribing.

Today no non-marketing family has an HTML part to contaminate. That changes in G2, when
`emailFooters.js` becomes one module switching between three footer families and a wrong branch would
ship a security email inviting the reader to unsubscribe from mail they cannot unsubscribe from — and
a client honouring one-click could act on it. The guard is cheap now and unwritable later. `H1` is
therefore stated as *whatever HTML these families gain carries no marker*, not *they have no HTML*,
so it survives the renderer.

## The P1 this exposed: the marketing path was dead by construction

Every marketing safeguard CarUp has is keyed on one field: `payload.classification === 'marketing'`.
The transport router reads it to choose Brevo over Resend. The consent gate reads it to decide whether
to consult suppression state. The presentation step reads it to decide whether a control is required.
E7's fail-closed refusal lives inside the adapter that only that field can select.

**`communicationCampaignService.js` — the only producer of marketing notifications — never wrote it.**
`classification: 'marketing'` lived on the campaign row and was dropped at
`queueNotification({ payload })`. So a real campaign:

- routed to **Resend**, the transactional transport, because the router defaults a missing
  classification to `'transactional'`;
- never reached the send-time consent gate, whose first act is
  `if (classification !== 'marketing') return permitted('not_marketing')`;
- never had an unsubscribe control composed or required;
- never reached the Brevo adapter where E7's refusal lives.

`campaign_delivery_id` was missing too — minted after queueing, so even a correctly-routed send would
have been refused `campaign_context_missing`.

Proven empirically in `email-experience-marketing-path-wiring.test.js`, which drives the **real**
`executeCampaign` rather than a hand-built payload. Before the fix: 3 of 4 red. This is the same
failure shape as the inbound reply path earlier in this programme — implemented, unit-tested against
a hand-built payload, and unreachable from production.

Fixed by stamping the governed classification onto the payload and hoisting the delivery id so the id
on the wire and the id in `communication_campaign_deliveries` are the same value.

## Two further fail-opens closed, same defect class

**`communicationNotificationService.suppressedByCanonicalState`** ended its lookup with
`.catch(() => [])`. Now fails closed for **marketing only** (`suppressed_consent_state_unavailable`)
and deliberately not for anything else: holding a password reset because a suppression lookup timed
out would lock someone out of their account over a consent question that does not apply to security
mail.

**`communicationCampaignService.resolveRecipient`** used `.catch(() => [])` on `channel_identities` —
a fail-open with an *active fallback*, which is worse than a bare one. A lookup fault did not merely
skip the `opted_out`/`revoked`/`verified` filters; it then substituted `user.email` and mailed
marketing to an address whose channel identity may say `opted_out`. Now suppresses the recipient with
`channel_consent_state_unavailable`.

## Anti-vacuity: ten source mutants, all killed

Each applied to the source, suite run, source restored.

| # | Mutant | Killed |
|---|---|---|
| 1 | `.catch(() => permitted)` re-added at the worker's consent call | **0** — see below |
| 1b | the original defect: a lookup failure returns PERMITTED | 2 |
| 1c | the worker ignores the UNAVAILABLE verdict | 2 |
| 1d | UNAVAILABLE collapsed into `recipient_suppressed` | 2 |
| 2 | transport appends a footer again | 5 |
| 3 | zero-block refusal removed | 1 |
| 4 | duplicate blocks allowed | 1 |
| 5 | `List-Unsubscribe` headers removed | 5 |
| 6 | header target ≠ visible control | 12 |
| 7 | reverse guard dropped | 2 |
| 8 | classification un-wired from the real campaign payload | 2 |
| 9 | queue-time `.catch(() => [])` restored | 1 |
| 10 | campaign channel-identity fail-open restored | 1 |

**Mutant 1 survived, and that is a true result worth stating.** Re-adding `.catch()` at the call site
changes nothing because `evaluateMarketingConsent` no longer rejects — it catches internally and
returns a typed UNAVAILABLE verdict. The fail-open is not reachable by that syntax any more, which is
why 1b/1c/1d were run: they restore the *semantics* of the original defect, and all three are killed.

## Regression

CI environment contract from `.github/workflows/ci.yml`.

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| Baseline (G1 head `68b02a5d`) | 4375 | 4354 | 0 | 21 |
| With G3 | 4411 | 4390 | 0 | 21 |

Delta exactly +36 — 32 ownership tests plus 4 wiring tests — with no failure anywhere.
Communications/Email/auth suites: 479 pass, 0 fail. Lint gate scopes ESLint to `web/`; G3 is backend
only.

## Existing tests reclassified

Three tests in `email-webhook-and-reply-routing.test.js` and the `synthesizedHtml` helper in
`email-experience-escaping-authority.test.js` handed the adapter a raw body and asserted the
**adapter** appended the footer. That is the OLD ADAPTER-MUTATION CONTRACT. Each was rewritten to
compose through the presentation authority first; **every original assertion was kept**, and the
pass-through assertion was added alongside. The G1 escaping tests still exercise a real HTML boundary
— the boundary moved to `marketingUnsubscribePresentation.js`, the contract did not.

Nothing was rewritten to reach green.

## Handed to G2, not fixed here

1. **Four of five non-marketing families are "not marketing" by absence, not assertion.** Only
   `authRecoveryRoutes.js` (`security`) and the campaign path (`marketing`) stamp a classification.
   Conversational, transactional and service reach the correct outcome because `String(undefined)`
   happens not to equal `'marketing'`. The renderer needs a real family, and there are **two
   conflicting defaults for the same missing field**: the transport router defaults to
   `'transactional'`, the worker to `''`. G2 must pick one.
2. **The R6 prototype's marketing footer would be refused at send** — no marker, and different copy
   from the E7-certified wording. `emailFooters.js` must build it from
   `marketingUnsubscribePresentation.js`, not from the preview markup.
3. **`/support` and `/security` 404** — they appear in five of six prototype footers.
   Already a stated prerequisite; unchanged by G3.
4. **`marketingUnsubscribeService.unsubscribe()` discards errors on steps 2–4** (preferences, channel
   identities, token counter) while reporting success. Bounded: step 1, the
   `communication_suppressions` upsert, does throw on error, and that is the store the authoritative
   send-time gate reads — so the invariant holds. Left alone because §I forbids redesigning the
   unsubscribe token service, and reported instead.

`PRODUCTION_COMMUNICATIONS=INACTIVE` throughout. No deploy, no DNS, no provider configuration change.
