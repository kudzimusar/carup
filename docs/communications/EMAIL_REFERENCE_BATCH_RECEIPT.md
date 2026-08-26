# Email Experience 1.0 — reference batch source receipt

Branch `feat/email-experience-design-system-1-0-implementation`, starting from `baf82319`.

## What shipped

| Gate | Reference | SHA | Status |
|---|---|---|---|
| G7 | R1 Leadership Welcome | `f1be1dd8` | complete |
| G8 | R3 Marketplace Conversation | `2fc2323a` | complete |
| G9 | R4 SafeTrade Transaction | `498c9acf` (+ `da3853e6`) | complete |
| G10 | R5 Vehicle Passport / Trust | `ecc7ebf1` gap → `801d30cc` **closed** | complete |
| G11 | R6 CarUp Weekly | `591e6f62` | complete |

R2 was completed earlier at G6 (`baf82319`) and is included in the preview pack.

## The template registry

`emailExperience/emailTemplateRegistry.js`. Not a competing template database —
`communication_templates` remains the approval authority for governed sends.

| | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|
| template key | `leadership_welcome_v1` | `auth_password_reset_v1` | `marketplace_conversation_v1` | `safetrade_transaction_v1` | `vehicle_trust_update_v1` | `carup_weekly_v1` |
| version | 1 | 1 | 1 | 1 | 1 | 1 |
| family | leadership | security | conversational | transactional | service | marketing |
| classification | transactional | security | conversational | transactional | **service** | marketing |
| sender persona | `carup_notifications` | `carup_security` | `carup_conversations` | `carup_notifications` | `carup_service` | `carup_weekly` |
| transport | resend | resend | resend | resend | resend | **brevo** |
| workflow | account_lifecycle | authentication | marketplace | safetrade | vehicle_trust | growth |
| recipient role | account_holder | account_holder | conversation_participant | transaction_party | **vehicle_owner** | marketing_subscriber |
| consent | none_lifecycle | none_security | none_conversation | none_lifecycle | none_lifecycle | **marketing_opt_in** |
| regulated data | not_applicable | minimise | minimise | minimise | minimise | not_applicable |
| primary action | open_marketplace | reset_password | open_conversations | open_journey | view_vehicle_record | browse_marketplace |
| footer family | transactional | security | transactional | transactional | transactional | marketing |
| media policy | text wordmark | text wordmark | canonical listing media | text wordmark | text wordmark | canonical listing media |
| leadership | **yes** | no | no | no | no | no |

All six references are registered.

## Real producers

| Reference | Producer | Wiring |
|---|---|---|
| R1 | `POST /api/auth/verify-email` success path | queued after `email_verified_at` is written; idempotent per user via the canonical queue dedupe key |
| R2 | `authRecoveryRouter.queueAuthEmail` | pre-existing; G6 added the equivalence guard |
| R3 | `communicationCanonicalConversationService.routeMessage` | carries `reference_template`, excerpt, VIN and the injected public listing summary |
| R4 | `issue164_transition_session_atomic` + `issue164_record_payment_state_atomic` | **10 events** newly subscribed; all were already emitted and never listened to |
| R5 | `trustPresentationChangeProducer.emitTrustPresentationChange`, called by `refreshCanonicalTrust` immediately after a successful canonical write | emits `vehicle.trust.presentation_changed` only when the audience-safe projection materially moved AND a current active owner resolves |
| R6 | `communicationCampaignService.executeCampaign` | unchanged lifecycle: active governed marketing template → approval → execute |

## Benchmark — honest scores

Scored against the canonical 100-point benchmark. **No score was inflated to cross a threshold.**

| Reference | Score | Accessibility | Automatic fails | Note |
|---|---|---|---|---|
| R1 | **92** | 9/10 | none | The uncertified "fastest route" comparative claim is gone; Support is now a descriptive link. |
| R2 | **93** | 9/10 | none | The footer now carries the real Security and Support destinations G12 built. All 16 equivalence invariants still hold. |
| R3 | **91** | 9/10 | none | Descriptive "View vehicle record" link replaces the naked URL. Still held below the mid-90s by the CTA limitation: **no thread deep-link route exists**, so the action goes to the conversations surface. |
| R4 | **91** | 9/10 | none | The action label and destination now agree. Deliberately restrained — it could look richer only by carrying financial detail it must not carry. |
| R5 | **91** | 9/10 | none | Four canonical states, each visually distinct. No dedicated Passport deep-link route exists, so the action goes to the owner vehicle profile. |
| R6 | **91** | 9/10 | none | **Raised from 88, and earned.** Editorial dark masthead, accent-bordered cards, descriptive per-vehicle links, real section hierarchy. **No media was faked and no listing invented** — the no-media variant is now a supported design rather than a degraded one. |

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
