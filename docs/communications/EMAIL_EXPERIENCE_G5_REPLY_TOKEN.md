# G5 — outbound authenticated conversation Reply-To

Part of CarUp Email Experience & Design System 1.0. Follows
[G0](EMAIL_EXPERIENCE_1_0_RUNTIME_GAP_CLOSURE.md) · [G1](EMAIL_EXPERIENCE_G1_ESCAPING_AUTHORITY.md) ·
[G3](EMAIL_EXPERIENCE_G3_UNSUBSCRIBE_OWNERSHIP.md) · [G2](EMAIL_EXPERIENCE_G2_CANONICAL_RENDERER.md) ·
[G4](EMAIL_EXPERIENCE_G4_RESEND_SEND_PROVENANCE.md).

The inbound half was already implemented and certified. What was missing was the outbound
attachment: conversational Email went out from `notifications@mail.carup.dev` with no reply
credential, so a human who pressed reply sent a message carrying no token and no RFC reference, and
it was permanently unroutable. That was observed, not theorised.

## A. The token-reuse contradiction, fixed first

`issue()` documented itself as reusing a live token for the same pair. It could not. Only a SHA-256
hash was stored, so a live row's raw value was unrecoverable **by construction** — and the code
handled that by minting a new token and **revoking the old one**:

```text
outbound Email A  ->  token A
outbound Email B  ->  token B, and token A REVOKED
```

Wired as-is, sending a second message in a thread would have permanently unrouted every reply to the
first. The customer opens last week's Email, presses reply, and their answer vanishes. That is a
worse failure than the gap G5 exists to close, so it was fixed before anything was wired.

## C/D. v2 — derived, not stored

The raw token is now **derived from the row id**, so the trusted server can reproduce it while the
database still holds only a hash:

```text
raw = base64url( HMAC-SHA256( CARUP_EMAIL_REPLY_TOKEN_SECRET,
                              "carup-email-reply-token:v2:<row id>" )[0..16] )
```

22 characters, so `conversation+<token>@mail.carup.dev` is 50 octets — well inside the 64-octet local
part. ~128 bits of strength. The row id is not secret and derives nothing usable without the secret.

**Hash-only at rest is preserved.** Nothing replayable is stored: not the raw token, not the address,
not the secret, not a reversible form. A database read on its own still produces no routing
credential.

The secret is **dedicated**: `CARUP_EMAIL_REPLY_TOKEN_SECRET`, server-only, injected rather than read
from `process.env` at the point of use, added to both env examples as an empty required field, and
deliberately not shared with the webhook secret, the worker secret, the CSRF secret, the auth token
secret or a provider API key — a credential authorising two unrelated things cannot be rotated for
one without breaking the other.

## E/F. Reuse, and what is never revoked

Reuse selects the **earliest live v2 row for the pair that this application can reproduce**.

| | |
|---|---|
| three issues, same pair | the **same** address, every time |
| a second Email in the thread | does **not** revoke the first Email's credential |
| reuse | refreshes the 90-day window; the address does not change |
| a binding learned later | attached; thread and participant authority never move |
| a different participant | a **different** credential — never silently rebound |
| a still-live **v1** token | never revoked, and still resolves. Only generation changed; the resolver looks up by hash and does not care which version produced it |

## G. Rotation and revocation

A revoked credential is never silently resurrected: it keeps resolving as `revoked_token`, and the
next legitimate issue returns a **new** address. An expired one keeps resolving as `expired_token`;
history is not rewritten to make it valid.

## H. Secret rotation cannot unroute delivered Email

If a v2 row exists but the current secret does not derive a token whose hash matches the stored one,
the row was minted under a previous secret. It is:

- **not sent** — an address whose hash is not the stored one is an address the resolver cannot find,
  which is worse than issuing a new credential;
- **not revoked** — Email carrying it is already in someone's inbox and must keep routing until its
  own expiry;
- **skipped for reuse**, and a new generation is created alongside it.

Rotating the secret costs a new address for future Email. It never costs a broken conversation.

## I. Concurrency — and why no migration was added

Within one process, interleaved issues converge: whoever inserted first wins, the loser retires a row
that has never been handed to a provider, and every later issue returns the same address. Twelve
mutants and a three-way concurrent test pin that.

**Stated precisely, because the distinction matters:** under Postgres READ COMMITTED neither
transaction sees the other's uncommitted insert, so a genuine cross-process race can leave **two**
live credentials for a pair. That outcome is acceptable and is why no migration was added — both
credentials resolve to the same thread and the same participant, so neither misroutes and nobody is
stranded, and reuse then converges on the earliest.

The alternative was rejected on its merits. A partial unique index **cannot express liveness**: an
index predicate must be IMMUTABLE and `expires_at > now()` is not, so the only enforceable form is
`(thread_id, participant_id, version) WHERE revoked_at IS NULL`. That is strictly *stronger* than one
live row — an expired-but-unrevoked row would occupy the slot and start **refusing** legitimate
issues, dead-lettering conversational Email. Trading a harmless duplicate credential for a lost
conversation is the wrong trade.

**Migration gate, if it is ever wanted.** Preflight is currently clean: staging holds 2 rows, 0 live,
and no `(thread_id, participant_id)` group has more than one live row; production does not have the
table at all. Adding the index would require the minting path to revoke on expiry first. **Not
applied here, in any environment.**

## J/K/L. Mint point and binding

Minted at the **delivery worker**, and nowhere else — not the producer, not the conversation UI, not
the adapter, not the renderer, not the webhook. The worker is where classification is proven, the
recipient is resolved, canonical context is present and transport is about to happen.

Only when `channel === 'email'` **and** `classification === 'conversational'`.

Bound to `thread_id`, the **recipient** `participant_id`, `tenant_id`, `binding_id` when an exact
email binding is known, and `provider: 'resend'`. Never to the sender participant, a most-recent
guess, an address, or a subject line.

The producers now carry that context onto the notification, because they are the only place it is
known: the canonical conversation service adds `recipient_participant_id`, `recipient_binding_id` and
`recipient_binding_channel`; both admin thread-reply paths add the participant they actually
addressed, which meant `resolveExternalReplyIdentity` returning the participant it had already
selected instead of discarding it.

`recipient_binding_channel` is load-bearing: a notification that falls back from WhatsApp to Email
inherits the same metadata, and an Email credential validated against a WhatsApp binding is a
credential validated against the wrong object. The worker uses the binding only when it is an email
binding.

## M/Q/X. The raw credential is never persisted

The worker builds an **ephemeral** content object carrying `reply_to` for the provider call. It is
never written back. `X1` searches ten stored tables — `notification_queue`, `messages`,
`message_delivery_attempts`, `email_reply_tokens`, threads, participants, identities, bindings, audit
events, webhook logs — and asserts the raw token and the address appear in none of them, while
asserting they *are* on the wire, which is the one place they belong.

For correlation the delivery attempt records `request_metadata.email_reply_token_id` — the token
**record** id, never the credential. Attempt → token → thread/participant is provable without the
audit trail becoming replayable.

## N. Failure semantics

A conversational Email that looks replyable and cannot route is worse than one not sent.

| | |
|---|---|
| issuance succeeds | send |
| transient token-store failure | **zero provider calls**, retry, `reply_token_unavailable` |
| missing canonical context | **zero provider calls**, dead-letter, `conversation_reply_context_missing` |
| secret not configured | **zero provider calls**, dead-letter, `reply_token_secret_missing` |

## O/P. Everything else is untouched

Security, transactional, service and marketing get no conversation reply token. Auth remains as
certified. The Resend adapter mints nothing — it receives the finished address and G4 records
`reply_to_set: true` without recording the value. Leadership Reply-To stays an R1 concern.

## A tenant reconciliation the fallback path exposed

`message_threads.tenant_id` is nullable and NULL genuinely means the platform tenant — most
marketplace threads are exactly that — while `email_reply_tokens.tenant_id` is NOT NULL. The token
would have stored `'platform'`, `resolve()` would have compared it against a live NULL, and rejected
its own credential as a tenant violation. Every reply to a platform-tenant conversation would have
been lost — the exact failure G5 closes.

Both sides are now canonicalised. It is more permissive in that single case and no other: a token is
still never routed against a different tenant, and a test pins that.

## Y. Anti-vacuity: twelve source mutants, all killed

| # | Mutant | Killed |
|---|---|---|
| 1 | restore the old `issue()` — new token each time, revoke the old | 7 |
| 2 | return a different token on reuse | 4 |
| 3 | persist the raw token on the row | 2 |
| 4 | omit the worker mint call | 12 |
| 5 | mint on transactional Email too | 3 |
| 6 | the real producer binds to the SENDER participant | 1 |
| 6b | the real producer drops the exact binding | 1 |
| 7 | worker omits a supplied binding | 1 |
| 8 | send anyway after issuance failure | 2 |
| 9 | remove the token/RFC disagreement refusal | 2 |
| 10 | drop the tenant canonicalisation | 1 |

**Mutant 6 survived its first run, and that was a finding about the tests, not the mutant.** The
round-trip handed the notification service a participant directly, which proves the worker uses what
it is given but not that the producer gives it the right one. `U5` was added to drive the real
`routeMessage`; mutant 6 and 6b both die against it now.

## Regression

CI environment contract from `.github/workflows/ci.yml`.

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| Baseline (G4 head `09c6f34c`) | 4466 | 4445 | 0 | 21 |
| With G5 | 4498 | 4477 | 0 | 21 |

Delta exactly +32 — 18 token-service tests plus 14 outbound/round-trip tests.
Communications/Email/auth suites: 566 pass, 0 fail. Lint is scoped to `web/`; G5 is backend only.

## Existing tests reclassified

Conversational Email now fails closed without a credential, so three fixtures that included the
conversational family needed the canonical context and a token authority: the G3 marketing-scoping
tests, the G2 non-marketing footer test, and the canonical fallback test. Each reclassification is
recorded inline with its reason; every original assertion is unchanged. Nothing was rewritten to
reach green.

## Physical certification

```text
G5_SOURCE_CERTIFIED
G5_PHYSICAL_ROUND_TRIP_PENDING_STAGING
```

The deterministic round trip proves the source contract: real producer → real notification service →
worker → router → captured Resend payload → real inbound resolver behind a genuinely signed webhook →
+1 inbound message, +0 threads, +0 participants, +0 identities, `use_count` 0 → 1, replay idempotent.
That is **not** a claim about a human inbox. Physical certification must still prove a real outbound
Email, a real human reply, the same canonical thread, and an idempotent replay.

`PRODUCTION_COMMUNICATIONS=INACTIVE` throughout. No deploy, no DNS, no provider configuration change,
and no production secret created or requested.

## Reported, not changed

1. **`email_reply_tokens.version` still DEFAULTs to 1** while the service mints 2. Every writer in
   the codebase passes it explicitly, so the live path is correct — but a backfill, a manual insert
   or a future service that omits the column would land on v1, become invisible to the v2 lookups,
   and mint a duplicate instead of reusing. Changing a column default is a production migration.
2. **`permanentReasons` in `communicationWebhookService.js` omits three reason strings** that
   `resolveBoundParticipant` actually emits — `bound_participant_missing`,
   `bound_participant_thread_mismatch`, `bound_participant_inactive`. They are permanent conditions
   classified as transient, so the provider would retry a permanently unroutable message. Inbound,
   and §R says preserve the inbound path, so it is reported rather than changed.
3. **A redundant index**: `idx_email_reply_tokens_hash` duplicates the unique constraint already on
   `token_hash`. Costs a write per insert and serves no query. Safe to drop in a future migration.
