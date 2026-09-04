# G2 — the canonical Email renderer, and an explicit classification contract

Part of CarUp Email Experience & Design System 1.0. Closes the fourth runtime gap, after
[G0 recipient resolution](EMAIL_EXPERIENCE_1_0_RUNTIME_GAP_CLOSURE.md),
[G1 escaping authority](EMAIL_EXPERIENCE_G1_ESCAPING_AUTHORITY.md) and
[G3 unsubscribe ownership](EMAIL_EXPERIENCE_G3_UNSUBSCRIBE_OWNERSHIP.md).

Two coupled outcomes: every Email reaches the worker with **one explicit classification**, and every
Email presentation is produced through **one rendering boundary** before transport.

## A. Absence stopped being a semantic

G3 left this: four of the five non-marketing families were "not marketing" by **absence**, not
assertion — `String(undefined) !== 'marketing'` happened to reach the right answer. Two components
defaulted the same missing field differently: the transport router to `'transactional'`, the delivery
worker to `''`. So a missing classification silently **chose a provider**, which is precisely how a
governed marketing campaign rode the transactional transport with no unsubscribe control.

The vocabulary is not new. `emailStakeholderMatrix.js` already declared
`CLASSIFICATION_TRANSPORT` — five values and their transports — so `emailClassification.js` is the
**validator over it**, not a second vocabulary. There is deliberately no sixth `auth` value:
account protection is `security`, and `'auth'` is now refused as invalid rather than reaching Resend
by falling through the marketing check.

| Condition | Result |
|---|---|
| valid explicit classification | proceeds |
| missing | **refuse** `email_classification_missing`, zero provider calls |
| invalid | **refuse** `email_classification_invalid`, zero provider calls |
| payload and metadata **disagree** | **refuse** `email_classification_conflict`, zero provider calls |

Conflict is its own outcome because two stored values disagreeing is the state where a message is
rendered as one family and transported as another. Picking a winner would make that silent.

Enforced at **two independent layers** — the worker before dispatch, and the router before it selects
a transport. The worker refuses first, so a router-level test exists specifically to keep that second
guard reachable rather than dead.

### A2 — the real producers

| Producer | Classification | Note |
|---|---|---|
| `authRecoveryRoutes.js` | `security` | already explicit; provenance added |
| `communicationCampaignService.js` | `marketing` | G3 made it explicit; provenance added |
| `communicationCanonicalConversationService.js` | `conversational` | a human message in a human thread |
| `adminCommunicationRoutes.js` (3 sites) | `conversational` | an operator replying inside a thread |
| `communicationInboundService.js` | `transactional` | an acknowledgement is a receipt, not the conversation |
| all nine `NOTIFICATION_POLICIES` | `transactional` | status changes and acknowledgements |
| default policy (unknown event) | **none** | refused at the boundary, never defaulted |

`service` is deliberately unused. The owner's rule is that a family is **selected by a producer**,
never arrived at because something else was missing.

**The live subclass, not the base class.** `CommunicationProductNotificationService` extends
`CommunicationCanonicalNotificationService` extends `CommunicationNotificationService`, and the
canonical subclass **reimplements `queueNotification` without calling `super`**. The first version of
this change edited only the base class and was therefore dead on the live path — the same shape as
the G3 P1 and the inbound reply failure before it. The shared helpers are now exported once and used
by both, and `O9`–`O12` drive `CommunicationProductNotificationService` for that reason.

### A3 — persistence and provenance

`payload.classification` is canonical; `metadata.classification` is provenance, written from the same
value alongside `metadata.classification_source` (`producer` / `policy` / `governed_template` /
`legacy_deterministic`). They can only disagree if a row was written outside the service or mutated
afterwards — and that disagreement is refused, not resolved.

### A4 — legacy rows

Derived **only** from one-to-one canonical signals: an auth template key, an auth template key on the
row, or campaign identity. Everything else is quarantined.

`missing => transactional` is explicitly not an inference. Neither is `metadata.transactional: true`,
the most tempting signal available: it is true of security, transactional, conversational **and**
service, so it identifies nothing.

## B. The renderer foundation

Eleven modules, each carrying real behaviour. No file was created because the plan lists it.

| Module | Owns |
|---|---|
| `emailClassification.js` | the five-value contract, its normalizer and its validator |
| `emailMarkup.js` | the shared HTML boundary — `escapeHtml`, `escapeAttr`, `safeHtml`, `html` |
| `emailBrandTokens.js` | the certified auth tokens, now shared |
| `emailBrandIdentity.js` | frozen B1/B2/B3; every unverified field is `null` |
| `canonicalEmailLinks.js` | typed links, and which routes actually exist |
| `emailSenderPersona.js` | classification → sending identity, over existing env only |
| `emailComponents.js` | preheader, masthead, button, panel, divider, paragraphs, heading, link row |
| `emailFooters.js` | the three §10.4 families |
| `emailLayouts.js` | one shell, not six templates |
| `emailTextRenderer.js` | first-class plain text from the same document |
| `renderEmail.js` | `renderEmailForNotification(notification, deps)` — the one entry point |

`emailMarkup.js` treats an unmarked value as **text**; only `safeHtml()` passes markup through. The
default for an unknown value is therefore safe rather than trusting, and `safeHtml(x)` in a diff is a
greppable claim that x is markup the author controls.

## C. The render result

`{ ok, subject, text, html, classification, classification_source, renderer_version, template_key,
template_version, footer_family, sender_persona, html_part_rendered, text_part_rendered,
cta_href_canonical, leadership_identity_rendered, render_fallback_used }`.

Built from named fields only, so an unrelated column added to `users` or `notification_queue` can
never reach an Email body. `M2` asserts the exact key set and that no secret or raw row appears.

## D. G1 survives

Plain text literal; HTML escaped exactly once; a URL encoded as a URL and then attribute-escaped only
on insertion; provider JSON never pre-escaped. `Automotive Intelligence & Trust Network` is literal
in text and `&amp;` once in HTML — never `&amp;amp;`. The temporary escaper in
`marketingUnsubscribePresentation.js` now delegates to the shared boundary.

## E. G3 absorbed, not reimplemented

`emailFooters.js` **composes** G3's `unsubscribeHtmlBlock` / `unsubscribeTextBlock`, so the block the
customer clicks is the block the Brevo adapter validates. The interim carrier is gone:
`wrapPlainTextAsHtml` and `applyMarketingUnsubscribePresentation` are **retired**, since the canonical
shell now renders the marketing family and a second way to produce marketing HTML would be a second
way to drift.

The renderer proves marketing compliance itself before returning, rather than leaving it to
transport. Both layers refuse; finding out at the provider boundary would make the failure someone
else's to diagnose.

## F. R6 handoff — unchanged, and it would be refused today

R6 is **not** made production-ready here and its score is **not** inflated. The prototype footer as
drawn carries no `data-carup-unsubscribe` marker and different copy from the E7-certified wording, so
it would be refused at send. What G2 proves instead is that any MARKETING output **from the canonical
renderer** carries exactly one G3 block, matching HTML/text URLs, and passes the adapter's validator
(`P7`, `P8`). R6 visual reconciliation stays at the R6/B4 stage.

## G. Footer truthfulness

No registered legal address (`DEFERRED_UNTIL_VERIFIED` — a partial statutory address is a false legal
claim, not a smaller one). No social links. No CEO, and no `Tendai Moyo`, which is seeded user `u1`
reused as a mock seller avatar. No headshot or signature asset. No logo artwork, because none exists
anywhere in the repository or its history — the wordmark renders as text.

`P12` asserts the absences across every non-marketing family; `P13` asserts the frozen descriptor and
entity render correctly in both representations.

## H. Canonical links

| Route | Frontend | Emitted |
|---|---|---|
| `/privacy` | real | yes |
| `/terms` | real | yes |
| `/support` | **not routed** | **no** — G12 |
| `/security` | **not routed** | **no** — G12 |

Owner approval of a URL is not the same as the page existing. `web/vercel.json` rewrites `/(.*)` to
`index.html`, so an unrouted path returns HTTP 200 with SPA HTML — a soft 404 no status check can
detect. `P15` asserts both directions: nothing links to `/support` or `/security`, **and** every
family does link `/privacy` and `/terms`, so it cannot pass by rendering nothing.

`support@carup.dev` is still rendered as a **contact**. It is one of the seven E7-certified aliases;
a mailbox is not a route.

## I. Auth safety

`authEmailTemplates.js` remains the physically certified P0 path until G6. An auth notification
renders `html: null` with `render_fallback_used: 'auth_compatibility'`, so the Resend adapter's
existing `resolveAuthHtml()` keeps producing the HTML and nothing races it. The canonical text passes
through untouched.

## J. Failure semantics point opposite ways

| Family | On a render fault |
|---|---|
| security / transactional / conversational / service | degrade to the canonical plain text, recorded as `plain_text_degraded` |
| marketing | **refuse**, zero provider calls |

A password reset must not be lost because decorative HTML failed — the text part carries the full
meaning. A marketing message must not fall back to an unmarked text-only send, because that send
would carry no unsubscribe control, which is the exact artefact that reached a real human inbox.

## K. Worker insertion — modified last

Injected through `communicationServiceFactory.js`, called only at the Email dispatch boundary.

`content.body` **and** `content.text` both carry the renderer's final text. `textBody()` reads
`content.body || content.text`, so leaving `body` as the pre-render message would have let the
adapter transmit the stale copy while the renderer's text went nowhere. `K1` proves the provider
payload is the renderer output; `K2` proves `in_app` and `push` never reach the renderer and stay
byte-identical.

## Q. Anti-vacuity: ten source mutants, all killed

Each applied to the source, suite run, source restored.

| # | Mutant | Killed |
|---|---|---|
| 1 | router default `'transactional'` restored | 2 |
| 1b | worker ignores the renderer's refusal | 4 |
| 2 | campaign classification omitted | 3 |
| 3 | policy classification omitted on the live canonical path | 1 |
| 4 | HTML escaping removed at the shared boundary | 8 |
| 5 | double escaping reintroduced | 29 |
| 6 | a second marketing unsubscribe block added to the footer | 24 |
| 7 | marketing render failure falls through as plain text | 2 |
| 8 | worker's renderer call removed | 8 |
| 9 | adapter prefers the stale pre-render body | 2 |
| 10 | an unrouted `/support` linked anyway | 1 |

Mutant 7 initially killed only the renderer-level test, because `J2` injects a failing renderer at the
worker seam and never exercises the real one. `J3` was added to drive the **real** renderer into a
compliance failure end to end; mutant 7 now kills both.

## Regression

CI environment contract from `.github/workflows/ci.yml`.

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| Baseline (G3 head `f4460ac6`) | 4411 | 4390 | 0 | 21 |
| With G2 | 4450 | 4429 | 0 | 21 |

Delta exactly +39 — 14 classification tests plus 25 renderer tests. Communications/Email/auth suites:
479 pass, 0 fail. The lint gate scopes ESLint to `web/`; G2 is backend only.

## Existing tests reclassified

| Test | Classification |
|---|---|
| `auth-recovery-security.test.js` — router families | included `'auth'`, which reached Resend only by falling through the marketing check. Removed from the valid list; an explicit refusal assertion added. |
| `email-webhook-and-reply-routing.test.js` — router families | same; same treatment |
| `email-experience-recipient-resolution.test.js` — G0 policy fixture | pre-dated the contract. Given the classification a real policy producer now stamps; the G0 assertion is untouched. |
| `communications-2-canonical-service-hardening.test.js` — fallback fixture | hand-built queue row with no classification. Given `conversational`, which the email fallback row then inherits by spreading the parent payload. |
| `email-experience-*.test.js` — G1/G3 marketing helpers | used the retired interim composer. Now compose through the real renderer, which makes them end-to-end; every original assertion kept. |
| `auth-email-templates.test.js` | **unchanged** — it guards the certified P0 auth path, which G2 does not touch. |

Nothing was rewritten to reach green.

## Handed forward

1. **G4** consumes `email_render_provenance` on the delivery attempt. The data is real and asserted
   now; nothing is persisted yet.
2. **G12** flips `/support` and `/security` to `available: true` in `canonicalEmailLinks.js`. That is
   the only change needed there.
3. **G6** migrates R2 and may then retire `resolveAuthHtml()` — not before equivalence is proven.
4. **R6** must build its footer from `marketingUnsubscribePresentation.js`, not from the prototype
   markup.
5. Under `NODE_ENV=test` the canonical web origin resolves to `http://localhost:5173`. Correct for a
   dev default, but it means a link-host assertion must supply its own env rather than assume
   `carup.dev`.

`PRODUCTION_COMMUNICATIONS=INACTIVE` throughout. No deploy, no DNS, no provider configuration change.
