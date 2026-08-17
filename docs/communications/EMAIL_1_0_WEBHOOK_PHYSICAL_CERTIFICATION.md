# Email 1.0 — Webhook physical certification (pre-CF1)

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Date:** 2026-08-17
**Controlled inbox:** `eleven.eleven.testing@gmail.com` (the only authorized real external inbox)
**Controlled account:** `u_cert_email_2026` (staging only)

Candidate SHAs used during this run (two P1 defects were found by real provider traffic and fixed
on the same branch, each freezing a new candidate):

```text
2226d974  entry candidate (E1–E6 implementation)
1ebc1ec1  P1 #1 fix — lifecycle events treated as receipt-only
ba0916a9  P1 #2 fix — receipt correlation by request id + RFC Message-ID backfill
```

## Two P1 defects found by live traffic, not by inspection

Both were invisible to source review and to every mocked test, and only surfaced once genuine
Resend-signed events hit the deployed endpoint.

**P1 #1 — lifecycle events were routed to the inbound parser.**
Real `email.sent` / `email.delivered` events arrived with a *valid* Svix signature, then fell
through to `parseChannelPayload('email', …)`, which has no `email` parser and threw
`"Unsupported referral channel."`. The receipt-only early-return allowlist was hardcoded to
`['sendgrid','twilio','expo','cloudflare']` and never gained the new Email transports. No
canonical transition was applied. Fixed by adding `resend`/`brevo`; `email.received` is
unaffected because it yields no delivery receipt and still reaches the inbound handler.

**P1 #2 — receipts never correlated to their delivery attempt.**
After #1, events were accepted and `processed`, but the attempt stayed `sent` and `delivered_at`
was never set. `resolveDeliveryAttempt` matched **only** on `provider_message_id`, yet Resend's
send response returns only its own email id while the lifecycle webhook reports the RFC
Message-ID — so the attempt held a uuid and the receipt carried an RFC id, and they never matched.
Fixed by falling back to `provider_request_id` (the one identifier present on both sides) and by
backfilling the RFC Message-ID onto the attempt when a lifecycle event first reveals it.

That backfill is load-bearing for E4: an inbound reply's `In-Reply-To`/`References` carry the RFC
id, and without it there is nothing to map a real reply back to. Left unfixed, inbound reply
routing would have failed in production while every unit test passed.

## WEBHOOK_PHYSICAL_CERTIFICATION

```text
RESEND_VALID_SIGNATURE=PASS   real Resend-signed email.sent + email.delivered accepted,
                              signature_valid=true, processing_status=processed, no error
RESEND_REPLAY=PASS            provider-replayed event deduped by
                              dedupe_key=resend:email:<type>:<email_id>; second receipt inert
RESEND_INVALID_SIGNATURE=PASS unsigned, forged-signature and forged-inbound all HTTP 403 with
                              ZERO business mutation (threads/messages/participants/attempts/
                              suppressions all unchanged); rows logged rejected/invalid_signature
BREVO_VALID_AUTH=PENDING      endpoint deployed and reachable; awaiting a real marketing send
BREVO_REPLAY=PENDING          same
BREVO_INVALID_AUTH=PASS       unauthenticated request HTTP 403, zero mutation
```

Provider identity is correct: `message_delivery_attempts.provider = 'resend'` — the SA1 fix
holds, and the internal router name never reaches provider identity.

## SA1_MAILBOX_CLOSURE

```text
AUTH_A=PARTIAL   request -> generic non-enumerating 200 (identical for unknown address);
                 real branded Email SENT and DELIVERED to the controlled inbox via Resend
                 (delivered lifecycle event received and verified);
                 sender CarUp Security <auth@mail.carup.dev>;
                 link https://staging.carup.dev/auth/reset-password?token=… — canonical,
                 zero *.vercel.app, zero supabase.co;
                 reset completes and token replay is rejected.
                 REMAINING: visual confirmation that the branded message renders correctly
                 inside Gmail requires a human looking at the mailbox — see "Owner-only steps".
AUTH_C=PARTIAL   password-changed notification is queued, classified security (P0) and sent via
                 Resend after a successful reset. Mailbox-eyes confirmation is the same
                 owner-only step.
```

## Owner-only steps that no automation can perform

These are not blockers for CF1, but they cannot be honestly claimed without a human:

1. **Confirming the branded email renders correctly in Gmail.** Delivery is proven by Resend's
   `email.delivered` lifecycle event; how it *looks* in the client is a visual check.
2. **Pressing Reply in Gmail** to generate a genuine inbound `email.received`. Inbound routing is
   proven at source level across eleven scenarios (token-only, RFC-only, both-agree,
   both-disagree, unknown RFC, tampered/expired token, wrong tenant, inactive participant,
   unreceivable binding, multiple tokens, unknown sender), and the endpoint correctly rejects
   forged inbound — but a real round-trip needs someone to hit Reply.
3. **A real Brevo marketing delivery**, which requires an opt-in through the CarUp preference path
   for the controlled recipient and then a governed campaign execution.

No other real inbox was contacted at any point.

## Bounded evidence

```text
controlled user         u_cert_email_2026 (eleven.eleven.testing@gmail.com)
notifications           324, 325, 326  (auth_password_reset_v1, classification=security)
provider request ids    667c199e-164d-4bb0-9214-40b4467c6a2d
                        16f332c6-6f74-45ee-9805-12a851623f35
RFC Message-ID observed <010601a00e165ccd-…-000000@ap-northeast-1.amazonses.com>
webhook logs (resend)   email.sent / email.delivered — processed, signature_valid=true
                        3 rejected rows, invalid_signature, zero mutation
```

Production Communications remains **INACTIVE**. No WhatsApp traffic was sent. Telegram not started.
