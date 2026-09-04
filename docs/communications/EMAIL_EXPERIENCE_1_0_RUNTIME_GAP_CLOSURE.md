# Email Experience 1.0 — runtime gap closure blueprint

**Status:** documentation / analysis only. `EMAIL_EXPERIENCE_X0_COMPLETE_WRITE_LANE_BLOCKED`.
**Base:** `main@940c2235`. Companion to `EMAIL_EXPERIENCE_1_0_X2_X3_SPECIFICATION.md` — does not repeat X0.

Turns the four runtime defects and the producibility gap into an implementation-ready closure plan.

---

# A. Email producibility matrix

## A.1 The complete `NOTIFICATION_POLICIES` inventory

`communicationNotificationService.js:5-107` — **nine** entries, the sole gate on whether a product event
becomes a notification. Six are email-eligible; three are `in_app` only.

| Policy key | Email? | Template | Note |
|---|---|---|---|
| `marketplace.inquiry.created` | **yes** | `marketplace_inquiry_received_v1` | the only marketplace email producer |
| `ESCROW_CREATED` | **yes** (+whatsapp) | `escrow_status_v1` | |
| `ESCROW_UPDATED` | **yes** (+whatsapp) | `escrow_status_v1` | |
| `finance.application.status_changed` | **yes** | `finance_status_v1` | **regulated** |
| `finance.application.approved` | **yes** | `finance_status_v1` | **regulated** |
| `finance.application.declined` | **yes** | `finance_status_v1` | **regulated** |
| `identity.verification.decided` | no | `verification_decision_v1` | `in_app` only, `policyChannelsOnly` |
| `marketplace.listing.moderated` | no | `listing_moderation_v1` | `in_app` only |
| `evidence.review.decided` | no | `evidence_review_v1` | `in_app` only |

**All six email-eligible policies route through `queueFromDomainEvent`, which does not set `payload.email`.**
So every one of them is `EMAIL_POLICY_BUT_RECIPIENT_UNRESOLVABLE` on the primary attempt — the defect in §B is
not an edge case, it is the entire policy-driven surface.

Outside the policy map, two producers set `payload.email` directly and therefore work today: the auth recovery
routes (`authRecoveryRoutes.js`) and conversation email (`queueExistingMessage`).

## A.2 Plan §22 catalogue classification

| Catalogue area | Classification | Evidence |
|---|---|---|
| `password_reset` | **LIVE_PRODUCER** | `authRecoveryRoutes.js`, sets `payload.email` |
| `account_email_verification` | **TEMPLATE_ONLY** | template + redeem endpoint exist; no send producer |
| `password_changed` | **TEMPLATE_ONLY** | template exists; no producer |
| `new_sign_in`, `email_changed`, `mfa_*`, `account_recovery` | **FUTURE_CAPABILITY** | no flow; `authEmailTemplates.js:177-182` marks them unreconciled |
| `marketplace_new_message` (inquiry) | **EMAIL_POLICY_BUT_RECIPIENT_UNRESOLVABLE** | policy exists; no `payload.email` |
| conversation thread email | **LIVE_PRODUCER** (partial) | `queueExistingMessage` sets email; **no Reply-To minting** |
| `dealer/garage/parts/diaspora/support_new_message` | **LIVE_EVENT_BUT_NO_EMAIL_POLICY** | threads exist; no policy entry |
| SafeTrade / escrow | **EMAIL_POLICY_BUT_RECIPIENT_UNRESOLVABLE** + **PRODUCTION_PROHIBITED** | policy exists; providers empty, money edges gated |
| finance / insurance | **EMAIL_POLICY_BUT_RECIPIENT_UNRESOLVABLE** + regulated | minimization mandatory |
| `listing_published/unpublished`, reservations, inspections | **LIVE_EVENT_BUT_NO_EMAIL_POLICY** or **FUTURE_CAPABILITY** | no policy entries; inspection booking absent |
| Vehicle Passport / trust / evidence | **BLOCKED_BY_VEHICLE_TRUTH** | 4 contract surfaces arrive with PR #165 |
| Garage, parts/PartSentry, diaspora logistics, referral | **TEMPLATE_ONLY** | 11 registry rows with zero code producers |
| `carup_weekly`, `weekly_car_highlights` | **FUTURE_CAPABILITY** | not among the 24 registered keys; no cron; no curation |
| Leadership / onboarding (all 11 keys) | **FUTURE_CAPABILITY** | registration sends no email at all |

## A.3 The six references — twelve-question readiness

Legend: ✅ ready · ⚠️ partial · ❌ absent

| Question | R1 Leadership | R2 Password Reset | R3 Conversation | R4 SafeTrade | R5 Passport | R6 Weekly |
|---|---|---|---|---|---|---|
| Event exists? | ⚠️ registration exists | ✅ | ✅ | ⚠️ diaspora only | ❌ | ❌ |
| Producer exists? | ❌ no email on register | ✅ | ✅ | ⚠️ gated OFF | ❌ | ❌ |
| Email policy exists? | ❌ | n/a (direct) | ⚠️ inquiry only | ✅ escrow | ❌ | ❌ |
| **Recipient resolves?** | ❌ | ✅ | ✅ (direct) | ❌ | ❌ | ❌ |
| Template exists? | ❌ | ✅ | ⚠️ text only | ⚠️ text only | ❌ | ❌ |
| HTML renderer? | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ synthesised |
| Plain text? | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Provider ready? | ✅ Resend | ✅ Resend | ✅ Resend | ✅ Resend | ✅ Resend | ✅ Brevo |
| Reply path ready? | ✅ `info@` | n/a no-reply | ❌ **no minting** | n/a | n/a | n/a |
| Consent/preference? | ✅ service | ✅ essential | ✅ | ✅ | ✅ | ⚠️ marketing only, no centre |
| **Provenance ready?** | ❌ Resend | ❌ Resend | ❌ Resend | ❌ Resend | ❌ Resend | ✅ Brevo |
| **Production eligible?** | ❌ | ⚠️ after migration | ❌ | ❌ | ❌ | ❌ |

**Only R2 is close to production-eligible**, and only after its migration is proven equivalent. A renderer
existing is never sufficient — nine of the twelve columns are outside the renderer.

---

# B. Recipient-resolution contract (G0)

## B.1 Defect

`queueFromDomainEvent` writes `payload: { event_type, safe_payload }` — no `email`
(`communicationNotificationService.js:200`). The worker reads the address only from `notification.payload`
(`communicationDeliveryWorker.js:100-116`). `ResendEmailAdapter` hard-fails `recipient_missing`
(`providerAdapters.js:338-339`). Enrichment from `users.email` exists **only** in `resolveFallbackRoute`
(`communicationCanonicalNotificationService.js:276-289`) — i.e. after a primary failure.

Net effect: **every policy-driven email fails its first attempt and succeeds only by fallback.**

## B.2 Contract

One resolver, `resolveNotificationRecipient(notification, deps)`, called by the **worker** immediately before
adapter dispatch — not by producers.

```text
input   { recipient_user_id | recipient_identity_id | recipient_id, channel, tenant_id }
output  { ok: true,  address, identityId, userId, verified }
      | { ok: false, reason: 'no_recipient_reference' | 'no_verified_address'
                           | 'channel_not_available' | 'lookup_failed' }
```

Resolution order: explicit `payload.email` (back-compatible, wins) → `channel_identities` verified address for
the channel → `users.email` for `recipient_user_id`. First match wins; no guessing across tenants.

## B.3 Requirements satisfied

| Requirement | How |
|---|---|
| authoritative identity | resolves through `channel_identities` / `users`; never a provider list |
| producers don't duplicate addresses | producers keep passing IDs; only the worker resolves |
| **fail closed** | `ok:false` → notification `failed` with `recipient_unresolved`; **no provider call** |
| missing recipient ≠ provider failure | distinct `error_code`: `recipient_unresolved` vs `provider_*`; distinct metric |
| no enumeration | resolver is internal; never reachable from a public route; failures never echo an address |
| no raw user leakage | returns only the four fields above — never the user row into template context |
| preserves custom auth | reads `public.users` / `channel_identities` only; no Supabase Auth |

## B.4 Files that will change

| File | Change |
|---|---|
| `emailExperience/recipientResolution.js` | **CREATE** the resolver |
| `communicationDeliveryWorker.js` | **MODIFY** — call before dispatch; fail closed |
| `communicationCanonicalNotificationService.js:276-289` | **MODIFY** — fallback route delegates to the resolver instead of duplicating it |
| `adapters/providerAdapters.js:338-339` | **RETAIN** — keeps its own guard as defence in depth |
| `backend/tests/email-experience-recipient-resolution.test.js` | **CREATE** |

## B.5 Tests

Each precedence branch resolves; unverified address is refused; **zero provider calls** when unresolved;
`recipient_unresolved` is distinguishable from provider failure; failure payloads contain no address; explicit
`payload.email` still wins (back-compat); a resolved recipient never puts a user object in template context.

---

# C. Outbound reply-token minting (G5)

Inbound resolution is wired and certified. `EmailReplyTokenService.issue()` has **no production caller**.

## C.1 Round trip

```text
thread + participant
  -> worker: mint/reuse token for (thread, participant)
  -> Reply-To: conversation+<base64url16>@mail.carup.dev
  -> human replies
  -> Resend email.received  ->  signature verified
  -> ResendInboundResolver: token -> thread + participant (dual-signal, fail closed)
  -> body fetched from Receiving API by email_id
  -> ingest into the SAME thread, +1 message, +0 participants
```

| Aspect | Decision |
|---|---|
| Mint point | delivery worker, when family is conversational **and** thread+participant known — never in producers |
| Reuse | one live token per `(thread, participant)`, so a long thread keeps a stable address |
| Lifetime | 90 days (existing default), refreshed on reuse |
| Binding | `thread_id`, `participant_id`, `tenant_id`, `binding_id`, `provider` |
| Storage | SHA-256 hash only; raw value exists only in the delivered email |
| Replay | multi-use; `use_count` increments; ingest idempotent on `(provider, provider_message_id)` |
| Ambiguity | two tokens in recipients → refuse (`multiple_reply_tokens`); token/RFC disagreement → refuse |
| Authorization | participant must still be active and the binding `can_receive`; revalidated at resolve time |
| Expiry | expired/revoked → **permanently unroutable** → acknowledge (2xx) and record, never retry-loop |
| Forwarding | a forwarded reply still carries the token; it resolves to the original participant **by design** — the token is the credential, so it must never be printed in receipts |

**Do not redesign Communications 2.0.** All of the above already exists in `emailReplyTokenService.js` and
`resendWebhookService.js`; the only missing piece is the mint call.

## C.2 Certification

Deterministic: address format ≤64-octet local part; case-sensitive base64url survives round trip; reuse
returns the same address; revoked/expired refuse; ambiguity refuses.
Physical: real send → human reply → assert `+1` inbound message, `+0` threads/participants/identities,
`use_count` 0→1, `authenticated_reply_token`, body non-empty, replay creates no duplicate.

---

# D. One escaping authority (G1)

## D.1 Defect

`communicationGovernedTemplateService.js:12-14` HTML-escapes variables into the **plain-text** body; Brevo
re-escapes at `providerAdapters.js:91`. `&` → `&amp;` → `&amp;amp;`. The frozen descriptor would ship as
**`Automotive Intelligence &amp;amp; Trust Network`**.

## D.2 Ownership — exactly one layer per context

| Concern | Owner | Rule |
|---|---|---|
| **Plain text** | nobody — identity function | text is text; **never** HTML-escaped, anywhere |
| **HTML text nodes** | `emailMarkup.escapeHtml()` at interpolation | escape once, at the boundary |
| **HTML attributes** | `emailMarkup.escapeAttr()` | quotes always escaped |
| **URLs** | `canonicalEmailLinks` — `encodeURIComponent` per component, then `escapeAttr` in `href` | never double-encode a whole URL |
| **Provider payload** | `JSON.stringify` only | adapters **never** escape content |

**Invariant:** values enter the renderer **raw**. The renderer escapes per output context. Adapters receive
finished strings and must not transform them. A value's escaping state is never inferred.

Enforced by an opt-in marker: `safeHtml(str)` is the *only* way to pass pre-built markup; everything else is
escaped. Template authors cannot accidentally pass raw HTML.

## D.3 Changes

`communicationGovernedTemplateService.js:3-14` and `communicationTemplateService.js:58-74` become
context-aware (text path stops escaping); `providerAdapters.js:91` **stops escaping entirely**;
`emailMarkup.js` becomes the single implementation, replacing five duplicates.

## D.4 Mutation tests

For each of `&`, `<`, `>`, `"`, `'`, `&amp;` (a literal that must survive), `→ é 日本語 🚗`, and a URL with
`?a=1&b=2`:

1. plain text output === input, byte for byte;
2. HTML text node escaped **exactly once** — assert no `&amp;amp;` anywhere;
3. attribute context has no unescaped quote;
4. URL query separators survive and are not double-encoded;
5. **the frozen descriptor renders as `Automotive Intelligence &amp; Trust Network` in HTML and
   `Automotive Intelligence & Trust Network` in text** — the named regression;
6. round trip through the Brevo adapter changes nothing.

---

# E. One unsubscribe owner (G3)

## E.1 Ownership

**The renderer owns all six concerns**: visible link, `List-Unsubscribe`, `List-Unsubscribe-Post`,
preference/suppression check, HTML footer, plain-text unsubscribe text.

The adapter keeps exactly one power: **a mandatory fail-closed refusal**. It may refuse to send marketing
without a valid unsubscribe capability — the E7-certified control at `providerAdapters.js:439-447` — but it may
**never silently append a second visual footer**.

## E.2 Change

`appendUnsubscribeHtml` / `appendUnsubscribeText` (`providerAdapters.js:472`, `:82-94`) become **assertions,
not mutations**: if the rendered HTML already contains the canonical unsubscribe block, pass through; if it
does not, **refuse** (never inject). Header setting stays in the adapter because headers are transport, but the
URL comes from the renderer.

> The refusal must remain unconditional. A guard that skips the check when the renderer "should have" added a
> footer would convert a certified control into an assumption.

## E.3 Tests

```text
zero unsubscribe blocks   -> FAIL  (refused, provider never called, dead-lettered)
exactly one canonical     -> PASS
two blocks                -> FAIL  (refused; the double-footer regression)
```

Plus: `List-Unsubscribe` and `List-Unsubscribe-Post` present and matching the visible link; a suppressed
recipient never reaches the provider (send-time guard); non-marketing families emit **no** unsubscribe block;
and the refusal fires even when the renderer is bypassed entirely.

---

# F. Resend send-side provenance (G4)

## F.1 Persist per send, on `message_delivery_attempts.response_metadata.provider_metadata`

```text
provider                 renderer_version
provider_message_id      template_key
provider_request_id      template_version
classification           footer_family
sender_persona           reply_to_set            (boolean)
message_id / thread_id   recipient_identity_ref  (identity id — never the address)
attempt_id               html_part_sent / text_part_sent   (booleans)
sent_at / completed_at   accepted | rejected + error code
correlation_id           cta_href_canonical      (boolean, not the URL)
```

**Never persist the rendered body.** Provenance answers *what shape was transmitted*, not *what was said*.
Booleans and identifiers only — no addresses, no tokens, no body, no vehicle or financial detail.

## F.2 What upgrades `OBSERVED, PROVENANCE_UNAVAILABLE` to certified PASS

All four, together:

1. `provider_metadata` present on the delivery attempt for that exact send;
2. `renderer_version` + `template_version` match the certified SHA;
3. staging runtime revision parity **PASS at that SHA across both runtimes**;
4. a Level C human observation naming a screenshot and an observer.

Any three without the fourth is `NOT CERTIFIED`. Provider `delivered` alone remains worthless as visual
evidence — the E7 lesson, encoded as a gate.

## F.3 Tests

Resend adapter returns `providerMetadata` (the regression whose absence let the original defect ship); the
worker persists it; no address, token or body appears anywhere in it; a rejected send still records provenance
with `accepted:false`.

---

# G. Producer closure for the six references

Minimum work only. **Not** ~90 producers.

## R1 Leadership Welcome
Trigger: **email verification success**, not registration — plan §9 stages security first, and a welcome
before verification would reward an unverified address. Idempotency: a `leadership_welcome` notification is
`dedupe_key = leadership_welcome:<user_id>`, so the DB unique index makes repeat sends impossible. Recipient:
resolver (§B). No role branching — public registration forces `owner`.

## R2 Password Reset
No producer work. Migration only: onto the shared renderer with golden-fixture equivalence. **The reference
proof for the whole system**, because it is the only fully live flow.

## R3 Marketplace Conversation
Event: the existing conversation message path (`queueExistingMessage`), which already sets `payload.email`.
Two additions: mint the Reply-To token at dispatch (§C), and attach vehicle context **only** through the
post-#165 projection. Recipient already resolves. Regulated workflows get no body detail.

## R4 SafeTrade
Truthful event: `ESCROW_CREATED` / `ESCROW_UPDATED` — real policies, real templates. **Scope: diaspora import
orders only.** Forbidden language while `SAFETRADE_APPROVED_LIVE_PROVIDERS` is empty and money edges gated:
"payment received", "funds released", "paid", "refunded", "in escrow", any amount presented as settled.
Permitted: the state actually reached, the reference, the next step, a secure-review CTA.

## R5 Vehicle Passport / Trust
**Blocked by PR #165.** Trigger after merge: a canonical trust/evidence event exposed through
`canonicalTrustService`. Projection: only fields `publicVehicleProjection` permits. Omit the Trust Score
entirely when absent — never `0`, never `—`. No before/after unless a real history source lands.

## R6 CarUp Weekly
**What CarUp can truthfully curate today:** a human-selected set of currently-eligible published listings, using
only fields the public projection permits. Nothing else. Forbidden: "based on your saved search", "price drop
on a car you follow", "recommended for you", any implied per-user personalization — none of those capabilities
exist. `recommendationService.js` is VIN-anchored item similarity that takes no user input, so it cannot power
a per-recipient section. "Manage preferences" is **omitted** until a preference centre exists.

---

# H. Quality scoring rule — owner-approved interpretation of plan §26

```text
OVERALL_SCORE_REQUIRED            >= 90/100
ACCESSIBILITY_AREA_MINIMUM        >= 8/10
MANDATORY_INVARIANTS              all must PASS
```

Score can never override a mandatory failure.

**Mandatory accessibility invariants** — each an automatic fail: WCAG-AA text and CTA contrast; meaningful alt
text on informative images; comprehension with images disabled; logical heading/content order; descriptive
links and CTAs; mobile-suitable touch targets; information never conveyed by colour alone; readable mobile
layout and zoom behaviour.

**Automatic fails (any one fails the template regardless of score):**

| # | Condition |
|---|---|
| 1 | broken canonical link — including one resolving to the SPA shell |
| 2 | fabricated identity or data |
| 3 | sensitive/regulated data overexposure |
| 4 | wrong sender or Reply-To identity |
| 5 | missing marketing unsubscribe |
| 6 | **duplicate** marketing unsubscribe |
| 7 | non-canonical `*.vercel.app` customer link |
| 8 | unresolved recipient |
| 9 | double escaping visible to a customer |
| 10 | fixture/demo identity leakage |
| 11 | incorrect regulated transaction claim |
| 12 | any mandatory accessibility invariant failing |
| 13 | template implies a capability that does not exist |
| 14 | S.K Musarurwa rendered as CEO |

---

# I. Implementation order

The proposed G0–G15 shape is sound. **Two changes, for safety:**

- **G3 (unsubscribe) moves before G2 (renderer insertion).** The moment the worker supplies HTML for
  marketing, the adapter appends a second footer. Establishing ownership first means that regression can never
  exist, rather than existing briefly between two steps.
- **G12 (support/security/assets) moves before G6.** All three footer families carry a Support link, so no
  family — including R2's security footer — can reach a customer until those routes are real.

| Step | Depends on | Files | Tests | Fail-closed | DONE when |
|---|---|---|---|---|---|
| **G0** recipient resolution | — | `recipientResolution.js` C; worker M; canonical notification M | resolution precedence, no-provider-call, no enumeration | notification `failed` with `recipient_unresolved`; provider never called | all six policy producers resolve on the **primary** attempt |
| **G1** escaping authority | — | `emailMarkup.js` C; two template services M; adapter M | mutation suite incl. the descriptor regression | render throws rather than emit ambiguous escaping | descriptor renders correctly in both parts; no `&amp;amp;` reachable |
| **G3** unsubscribe ownership | G1 | `emailFooters.js` C; adapter M | zero=FAIL, one=PASS, two=FAIL | adapter refuses; never injects | E7 refusal intact **and** double-footer impossible |
| **G12** support/security/assets | — | `App.tsx`, `vercel.json`, two pages | page-identity + ETag assertions; asset content-type | missing asset must not return SPA HTML | all four canonical URLs pass the three-part assertion |
| **G2** renderer insertion | G0,G1,G3 | `renderEmail.js` + module tree C; worker M | Level A suite | render fault degrades to today's text-only | worker supplies `content.html`; auth unchanged |
| **G4** Resend provenance | G2 | adapter M; worker M | provenance present; no PII | absent provenance blocks certification, not sending | every Resend send records provenance |
| **G5** reply-token minting | G2 | worker M | address format, reuse, expiry, ambiguity | no token → send without Reply-To, never a broken one | physical round trip: +1 message, +0 participants |
| **G6** R2 migration | G2,G12 | `authEmailTemplates.js` M | golden fixture + allowed-diff manifest | any unlisted diff fails | R2 equivalent and anti-enumeration intact |
| **G7** R1 producer + template | G0,G2,G6 | verification success hook; template C | dedupe, no role invention | dedupe index makes repeats impossible | one welcome per user, ever |
| **G8** R3 conversation | G5,G7 | conversation template C | escaping of user content; regulated minimization | no vehicle card if projection unavailable | reply round trip certified |
| **G9** R4 transaction | G2 | escrow template C | forbidden-language assertions | refuse to render settled-money language while gated | states truthful; no money implied |
| **G10** R5 passport | **PR #165** + G2 | trust template C | projection compliance; omit-when-absent | omit metric rather than render a placeholder | no invented Trust value |
| **G11** R6 weekly | G3,G2 | editorial template C | no-personalization assertions | omit "Manage preferences" until it exists | truthfully curated; one unsubscribe |
| **G13** B4 gate | G6–G11 | — | screenshot set | — | **owner visual approval** |
| **G14** remaining migration | G13 | per-template | per-template Level A | no dormant catalogue enablement | every *live* producer on the system |
| **G15** physical certification | G14 | — | Level C matrix | provenance gate (§F.2) | certified PASS, not OBSERVED |

**Rollback posture throughout:** every step degrades to current behaviour. The worker insertion is
failure-tolerant, so the worst case of a renderer fault is today's text-only email — never a blocked P0
security message.

---

EMAIL_RUNTIME_GAP_CLOSURE_BLUEPRINT_COMPLETE
READY_FOR_SINGLE_LANE_IMPLEMENTATION_AFTER_CANONICALIZATION
