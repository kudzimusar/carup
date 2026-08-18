# SA1 (Path A) — CarUp custom-auth Email certification

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Date:** 2026-08-17
**Owner decision:** PATH A — CarUp custom auth remains the authentication authority. Supabase Auth is **not** migrated to and **not** configured.

```text
CARUP CUSTOM AUTH      authentication authority (public.users -> public.user_sessions)
SUPABASE POSTGRES      persistence / database only
CARUP COMMUNICATIONS   governed auth/security Email generation, delivery state, audit, quota
RESEND                 auth/security + transactional/conversational transport
BREVO                  marketing only
```

Supabase does **not** become a fourth outbound provider. Supabase Auth SMTP/templates were not
configured. A future migration to Supabase Auth, and the Supabase Send Email Hook, are separate
programmes and are not part of Email 1.0.

## SA1B — reconciled current auth (unchanged by this work)

| Surface | Reality |
|---|---|
| Login | `POST /api/auth/login` (`server.js:1252`), scrypt via `evaluateLoginCredentials`, issues `sk_live_…` into `user_sessions` |
| Register | `POST /api/auth/register` (`server.js:1328`) — **public self-signup exists**, server-forced role `owner` |
| Session validation | `authMiddleware.authorizeRole()` on `x-session-token` → `user_sessions.is_valid` + `expires_at` |
| Password policy | scrypt, min 8 chars (`backend/utils/passwordAuth.js`) — **not bcrypt**; reused as-is |
| Revocation | `user_sessions.is_valid = false` |
| Rate limiting | `rateLimiter({max,windowMs,isSensitive})` from `securityMiddleware.js` |
| Admin-created users / invitations | none exist |
| Change-email / change-password endpoints | none exist |
| Mobile | same custom endpoints (`mobile/app/(auth)/`) |

The login token format and session contract were **not changed**.

## SA1C — auth_action_tokens

`database/migrations/20260817120000_sa1_auth_action_tokens.sql` — one provider-neutral primitive,
not per-flow tables. Purposes are constrained to flows that exist or are capability-ready:
`password_reset`, `email_verification`, `email_change`, `reauthentication`.

- **Only a SHA-256 hash is stored** (`char_length = 64`, UNIQUE). The raw token exists solely in
  the one-time link. Proven: the raw secret appears nowhere in the persisted row.
- **Atomic consume** — a single conditional `UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL
  AND expires_at > now() … RETURNING`. There is no read-then-write window, so replay and
  concurrent redemption both lose.
- Purpose-bound, user-bound, revocable, superseding (issuing a new reset revokes the previous),
  short TTL (reset 60m, verification 24h, reauth 10m), timing-safe hash comparison helper.
- RLS `ENABLED` + `FORCED`, `REVOKE ALL … FROM anon, authenticated` — no browser client can read it.

**Mutation proof (staging, applied):** 75/75 existing users grandfathered
`email_verified_at = COALESCE(created_at, now())`, `user_sessions` unchanged at 864 total / 861
valid, `password_hash` count unchanged at 57.

## SA1F — email verification (capability-ready, activated for NEW accounts only)

`public.users.email_verified_at` added additively. It is **separate from `is_verified`**, which
already existed and means identity/KYC (surfaced as `userContext.isVerified`); overloading it
would have conflated two different trust signals.

**Grandfathering policy for the existing 75 users: all were set verified at migration time.** New
signups start `NULL`. No existing user was locked out, no mass reconfirmation was forced, and no
identity was mutated. The `POST /api/auth/verify-email` endpoint exists and is proven to reject
wrong-purpose tokens; wiring it into the signup path is a follow-on step, since doing so changes
what a brand-new account can do and deserves its own decision.

## SA1D — password recovery endpoints

`backend/routes/authRecoveryRoutes.js`, mounted in `server.js`.

`POST /api/auth/forgot-password` — rate-limited 5 / 15 min (sensitive tier).
**No account enumeration:** known address, unknown address, missing field, and internal/provider
failure all return byte-identical `200 {"success":true,"message":"If an account exists…"}`. The
unknown-account path performs equivalent scrypt work, so response *latency* does not leak
existence either.

`POST /api/auth/reset-password` — rate-limited 10 / 15 min. Validates and consumes the token
atomically, enforces the existing scrypt policy via `hashPassword()`, updates the password,
**revokes every live session**, revokes sibling reset tokens, and queues the password-changed
notification. Expired / used / unknown / wrong-purpose / malformed all return one opaque message.
It deliberately does **not** sign the user in — sessions are only minted by `/api/auth/login`, so
holding the emailed link never yields a session.

All auth Email is enqueued through canonical CarUp Communications with `classification=security`
(P0) and delivered by Resend. Nothing bypasses the queue, so every auth Email lands in canonical
audit, `message_delivery_attempts`, and quota governance.

## E2 transport core (pulled forward — SA1D mandates Resend)

- **`ResendEmailAdapter`** — canonical dedupe identity mapped to `Idempotency-Key` so one send
  intent causes at most one provider send; RFC Message-ID persisted as `provider_message_id` for
  durable reply correlation; branded HTML rendered from the single source of truth while
  plain-text is always sent.
- **`EmailTransportRouter`** — provider selected by governed CarUp classification, replacing the
  old single `EMAIL_PROVIDER` ternary. security/auth/transactional/conversational/service →
  Resend; marketing → Brevo, **failing closed when Brevo is unconfigured rather than silently
  falling back onto the transactional transport**. SendGrid/Cloudflare quarantined behind
  `EMAIL_PROVIDER_LEGACY`.
- **Defect found by physical evidence and fixed:** delivery attempts recorded
  `provider='carup_email_router'` (the router's own name). Provider lifecycle webhooks arrive
  stamped `resend`, and reconciliation looks attempts up by `(provider, provider_message_id)` — so
  this would have silently broken E3 correlation. The worker now records `result.routedProvider`.

## SA1G — the fake OTP is gone

`/verify-otp` rendered a client-side placebo: any six digits passed via `setTimeout`, with no
network call, no backend, and no verification. No backend OTP flow exists and nothing linked to
it, so **option B applied** — the fake security control was deleted (component removed, registry
entry removed, feature manifest regenerated) and the path now redirects to the real auth journey
so existing bookmarks do not 404. Confirmed absent from the deployed bundle
(`'Phone number verified'` → 0 occurrences).

## SA1E — frontend

`/auth/forgot-password` and `/auth/reset-password`, both live on canonical staging. The dead
`<Link to="#">Forgot password?</Link>` in `Login.tsx` now points at the real flow. The success
state is identical regardless of account existence — including on network failure, so the client
adds no enumeration oracle of its own. Invalid/missing-token and expired states are handled, and
the user is returned to `/login` rather than auto-signed-in.

## SA1K — physical staging certification

**Frozen candidate:** `dff40561e0ac41590205fdc21951b771db86e481`
**Deployments:** backend `carup-backend-staging-hqb475e10`, frontend `carup-staging-hqrf0cdcv`
(both to the staging projects only; `carup` / `carup-backend` production projects untouched).
**Synthetic account:** `u_sa1_probe_2026` / `sa1.probe@carup-staging.test` (a non-routable
`.test` address — no real inbox was contacted).

| Gate | Result |
|---|---|
| Password policy enforced | `400 Password must be at least 8 characters.` |
| Reset with valid token | `200` success |
| **Token replay rejected** | `400` opaque message |
| Wrong-purpose token on verify-email | `400` rejected |
| **AUTH-B: pre-reset session revoked** | `GET /auth/me` `200` → **`401`** after reset |
| Old password rejected | `401` |
| New password accepted | `200` |
| **AUTH-D: unknown email** | identical generic `200` body to a known address |
| Empty/malformed email | identical generic `200` body |
| **Other users unaffected** | 861 valid sessions before and after — no mass invalidation |
| Auth Email entered the canonical queue | `notification_queue` id 323, `channel=email`, `classification=security`, `auth_template_key=password_changed` |
| **Real Resend send** | `message_delivery_attempts` `status=sent`, `provider_request_id=7fbf59ec-b2d2-4e6f-8e82-75f868b02981`, idempotency key = canonical dedupe identity, no error |
| Frontend screens | `/auth/forgot-password`, `/auth/reset-password` → `200` on `staging.carup.dev` |
| OTP placebo | absent from deployed bundle |

### Not proven here, and why

**Inbox-delivery gates (AUTH-A steps 3–6, AUTH-C) require a controlled inbox address that has not
been provided.** The probe deliberately used a non-routable `.test` address so no real mailbox was
contacted without authorisation. What *is* proven is the entire chain up to and including real
provider acceptance by Resend; what remains is confirming the branded message renders in a real
inbox and that its link opens the reset page. **AUTH-E** (signup verification) is not wired into
the signup path yet, and **AUTH-F** is satisfied by removal — the placebo journey is no longer
exposed.

## SA1L — bounded cleanup

Recorded before deletion, then removed by id only. No auth/session table was broadly truncated.

```text
probe user            u_sa1_probe_2026            deleted
probe sessions        3                            deleted
auth action tokens    1                            deleted
notification          323                          deleted
delivery attempt      957b106b-35bf-45e9-a705-cf95ef45920f   deleted
message               4641fb4a-3ffd-44fa-b75f-1a4d3c8e2d77   deleted
thread                f5853233-1446-4f4a-93a0-1c3efee5f4cf   deleted
```

**Post-cleanup baseline restored exactly:** 75 users, 861 valid sessions, 75 email-verified,
`auth_action_tokens` 0 rows.

## Verification

Backend 3311 pass (12 pre-existing environmental failures in `verification-*` /
`provision-staging-qa-accounts` — Postgres auth and Gemini OCR, unrelated and reproducible without
this work). Web 818/818. Typecheck clean. Feature manifest regenerated.

Production Communications remains **INACTIVE**. WhatsApp untouched. Telegram not started.
