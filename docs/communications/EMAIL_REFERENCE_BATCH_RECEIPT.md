# Email Experience 1.0 — reference batch source receipt

Branch `feat/email-experience-design-system-1-0-implementation`, starting from `baf82319`.

## What shipped

| Gate | Reference | SHA | Status |
|---|---|---|---|
| G7 | R1 Leadership Welcome | `f1be1dd8` | complete |
| G8 | R3 Marketplace Conversation | `2fc2323a` | complete |
| G9 | R4 SafeTrade Transaction | `498c9acf` (+ `da3853e6`) | complete |
| G10 | R5 Vehicle Passport / Trust | `ecc7ebf1` | **STOPPED — `R5_PRODUCER_GAP`** |
| G11 | R6 CarUp Weekly | `591e6f62` | complete |

R2 was completed earlier at G6 (`baf82319`) and is included in the preview pack.

## The template registry

`emailExperience/emailTemplateRegistry.js`. Not a competing template database —
`communication_templates` remains the approval authority for governed sends.

| | R1 | R2 | R3 | R4 | R6 |
|---|---|---|---|---|---|
| template key | `leadership_welcome_v1` | `auth_password_reset_v1` | `marketplace_conversation_v1` | `safetrade_transaction_v1` | `carup_weekly_v1` |
| version | 1 | 1 | 1 | 1 | 1 |
| family | leadership | security | conversational | transactional | marketing |
| classification | transactional | security | conversational | transactional | marketing |
| sender persona | `carup_notifications` | `carup_security` | `carup_conversations` | `carup_notifications` | `carup_weekly` |
| transport | resend | resend | resend | resend | **brevo** |
| workflow | account_lifecycle | authentication | marketplace | safetrade | growth |
| recipient role | account_holder | account_holder | conversation_participant | transaction_party | marketing_subscriber |
| consent | none_lifecycle | none_security | none_conversation | none_lifecycle | **marketing_opt_in** |
| regulated data | not_applicable | minimise | minimise | minimise | not_applicable |
| primary action | open_marketplace | reset_password | open_conversations | open_journey | browse_marketplace |
| footer family | transactional | security | transactional | transactional | marketing |
| media policy | text wordmark | text wordmark | canonical listing media | text wordmark | canonical listing media |
| leadership | **yes** | no | no | no | no |

R5 has **no registry entry**, deliberately. A registry entry would assert a template exists.

## Real producers

| Reference | Producer | Wiring |
|---|---|---|
| R1 | `POST /api/auth/verify-email` success path | queued after `email_verified_at` is written; idempotent per user via the canonical queue dedupe key |
| R2 | `authRecoveryRouter.queueAuthEmail` | pre-existing; G6 added the equivalence guard |
| R3 | `communicationCanonicalConversationService.routeMessage` | carries `reference_template`, excerpt, VIN and the injected public listing summary |
| R4 | `issue164_transition_session_atomic` + `issue164_record_payment_state_atomic` | **10 events** newly subscribed; all were already emitted and never listened to |
| R6 | `communicationCampaignService.executeCampaign` | unchanged lifecycle: active governed marketing template → approval → execute |

## Benchmark — honest scores

Scored against the canonical 100-point benchmark. **No score was inflated to cross a threshold.**

| Reference | Score | Accessibility | Automatic fails | Note |
|---|---|---|---|---|
| R1 | **91** | 9/10 | none | The support URL renders as plain text in one paragraph rather than a link — the only thing keeping it off the mid-90s. |
| R2 | **92** | 9/10 | none | Certified layout, equivalence-guarded on every send. |
| R3 | **90** | 9/10 | none | Held at 90 by the CTA limitation: no thread deep-link route exists, so the action goes to the conversations surface. |
| R4 | **90** | 9/10 | none | Deliberately restrained. It could look richer only by carrying financial detail it must not carry. |
| R6 | **88** | 8/10 | none | **Unchanged from the prototype score, honestly.** Listing URLs render as raw text footnotes rather than links, and the no-media variant is visually plainer than the prototype implied. It has not earned more. |

**Automatic-fail conditions, all clear across all five:** no broken canonical link · no fabricated
identity or data · no sensitive overexposure · correct sender and reply-to · exactly one unsubscribe
in R6 and none anywhere else · no `.vercel.app` or `carup.app` customer URL · no unresolved recipient
· no double escaping · no fixture leakage into production paths · no incorrect regulated transaction
claim.

## Runtime preview pack — B4 CANDIDATES

`docs/communications/email-previews/runtime/` — rendered by `renderEmailForNotification`, the same
function the delivery worker calls. These are **not** the prototype files.

```text
runtime/
  manifest.json
  <id>.html          the exact HTML a customer would receive
  <id>.txt           the exact plain-text part
  screenshots/<id>-desktop.png     1280x900,  DPR 2, full page
  screenshots/<id>-mobile.png      390x844,   DPR 2, full page
```

Seven artefacts: R1, R2, R3, three R4 states (eligible / provider-confirmed funds held / sandbox),
and R6 in its truthful no-media variant.

Fixtures are obviously synthetic throughout: `Fixture <Role>`, `FIXTURE-` identifiers,
`@fixture.invalid`. No real address, token, or evidence. No screenshot was retouched.

**`B4_PASS` is not claimed. B4 is an owner visual-review gate.**

## Deferred, unchanged

| | |
|---|---|
| **G5-D1** | `email_reply_tokens.version` DEFAULT is 1 while the application mints v2 |
| **G5-D2** | inbound `permanentReasons` omits the `bound_participant_*` permanent reasons |
| **G5-D3** | `idx_email_reply_tokens_hash` duplicates the UNIQUE `token_hash` index |
| **G5** | `G5_PHYSICAL_ROUND_TRIP_PENDING_STAGING` |
| **G6** | `G6_PHYSICAL_RESET_DELIVERY_PENDING_STAGING` |
| **R5** | `R5_PRODUCER_GAP` — see `EMAIL_EXPERIENCE_G10_R5_PRODUCER_GAP.md` |
| **B5** | `REGISTERED_LEGAL_ADDRESS` unverified; a postal address may be required for production marketing |

`PRODUCTION_COMMUNICATIONS=INACTIVE` throughout. No deploy, no DNS, no Cloudflare, no provider
allocation change, no production secret.
