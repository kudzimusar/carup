# CP1 — Cloudflare Pro staging proxy certification

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Date:** 2026-08-17
**Zone:** `carup.dev` — **ACTIVE**, plan **Pro**, activated 2026-08-17T07:31:05Z

## Scope actually changed

Exactly one host is proxied:

```text
api-staging.carup.dev   PROXIED   (104.26.8.219 / 104.26.9.219 / 172.67.70.175)
api.carup.dev           DNS-only
carup.dev               DNS-only
www.carup.dev           DNS-only
staging.carup.dev       DNS-only
*.carup.dev             DNS-only
```

DNSSEC remains disabled. The Vercel DNS zone is retained as rollback.

## Trust-proxy proof — physical, not configuration

The proof uses `auth_action_tokens.requested_ip`, which records whatever the application resolved
as the client IP. Nothing here is inferred from settings.

| # | Claim | Evidence |
|---|---|---|
| A | Real client IP preserved | request **through Cloudflare** recorded `requested_ip = 210.194.189.33` — the actual public IP of the caller |
| B | Edge IP is NOT the shared identity | no Cloudflare edge address (104.26.x / 172.67.x) was ever recorded as the rate-limit identity |
| C | Direct-origin forgery rejected | request sent **straight to the Vercel origin** with `CF-Connecting-IP: 203.0.113.66` **and** a forged `x-carup-edge-secret` recorded `127.0.0.1` — the forged values were ignored entirely |
| D | Safe fallback | same request still succeeded functionally (HTTP 200), degrading to existing behaviour rather than failing open on a spoofed identity |
| E | Secret never exposed | not echoed in any response header or body; absent from the working tree, from `docs/`, and from **every object in git history** (verified by `git grep` across `git rev-list --all`) |

The Cloudflare rate limiter was also observed firing genuinely: repeated calls to
`/api/auth/forgot-password` returned **429**, then returned to 200 once the window elapsed.

## Provider webhook regression — the certified paths survived proxying

| Check | Result |
|---|---|
| Real **signed** Resend webhook through the proxied host | **PASS** — `email.sent` + `email.delivered` both `processed`; notifications 328 and 329 reached canonical `delivered`, provider `resend` |
| Resend forged/unsigned signature | **PASS** — 403 from the *application*, `cf-mitigated` absent |
| Brevo unauthenticated | **PASS** — 403 from the application |
| Zero challenge/interstitial on webhook paths | **PASS** — no `cf-mitigated: challenge` on any webhook request |

Application-level webhook authentication was not weakened anywhere; Cloudflare passes the request
through and the origin still rejects anything unsigned.

## A finding that would have broken production

The first proxied request returned **`403` with `cf-mitigated: challenge`** on *every* path,
including the provider webhooks — despite the skip rules being in place. Super Bot Fight Mode
cannot be narrowed by custom-rule skip products on this plan.

More importantly it was the **wrong control for this host**. `api-staging.carup.dev` is a pure API
surface: every legitimate caller — the mobile native app, server-to-server traffic, provider
webhooks, CI — is "automated" by definition, so an interactive bot challenge breaks the product
instead of protecting it. The browser-facing hosts are not proxied, so SBFM was guarding nothing.

Resolution: `sbfm_definitely_automated → allow`, `browser_check → off`, `security_level → medium`,
with real protection coming from Managed WAF + rate limiting + application authentication. This
should be revisited per-host if a browser surface is ever proxied.

## Cloudflare Pro security posture deployed

| Control | State |
|---|---|
| Cloudflare Managed Ruleset | deployed on `api-staging`, provider webhooks exempt |
| OWASP Core Ruleset | deployed on `api-staging`, provider webhooks exempt |
| Exposed Credentials Check | deployed on `/api/auth/*` only — credential-stuffing defence aimed exactly at the auth surface |
| Rate limiting | 30 req / 60s on `/api/auth/*`, managed challenge, 10-minute mitigation |
| Super Bot Fight Mode | verified bots allowed; automated traffic allowed (see finding above) |
| Webhook exemption | **narrow** — one path prefix (`/api/communications/webhooks/`) on one host. No blanket bypass exists. |

### WAF behaviour verified

```text
SQLi union select        403 blocked
XSS script tag           403 blocked
shell injection          403 blocked
path traversal           200 not blocked  (see note)
GET /api/health          200 passes
POST /api/auth/login     401 passes to app (correct rejection)
POST forgot-password     200 generic anti-enumeration body preserved
```

**Path-traversal note, reported rather than hidden:** the traversal string was an unused *query
parameter* on a JSON health route. The application never reads it and no file access is possible,
so the practical risk is nil — but it is recorded as not-mitigated rather than claimed as a pass.

## Turnstile — assessed, deliberately NOT implemented

The directive asked for an evidence-based assessment rather than forced adoption. The evidence
says no, for now:

1. **It would break real clients.** `api-staging.carup.dev` serves a mobile native app and
   server-to-server callers. Turnstile is a browser challenge; adding it to these API endpoints
   breaks non-browser clients, which the directive explicitly requires preserving.
2. **The abuse it would address is already bounded.** `/api/auth/forgot-password` is limited to
   5 requests / 15 min per client at the application layer *and* 30 req/60s at the edge, both now
   keyed on the **real** client IP. Credential stuffing is additionally covered by Exposed
   Credentials Check.
3. **It risks the anti-enumeration guarantee.** Forgot-password must return one identical response
   for every input. A challenge interstitial introduces a second observable outcome and is exactly
   the kind of differential an attacker probes for.
4. **The browser surfaces where it would fit are not proxied.** `carup.dev` and
   `staging.carup.dev` remain DNS-only, so there is nowhere Turnstile could sit today without
   targeting API traffic.

**Decision: not justified yet.** Revisit when (a) a browser surface is proxied, or (b) evidence of
real abuse survives the existing rate limits. The permission is in place, so implementation is
unblocked whenever the evidence changes.

## Regression summary

```text
api-staging HTTPS                 PASS (200 through Cloudflare)
CORS from staging.carup.dev       PASS (204 preflight)
CORS rejects evil origin          PASS (zero allow-origin headers)
login                             PASS (401 on bad credentials)
forgot password                   PASS (200, generic body)
password reset invalid token      PASS (400, opaque)
correct client IP                 PASS (real IP recorded)
application rate limiting         PASS (keyed on real client)
Cloudflare rate limiting          PASS (429 observed, window expiry observed)
direct-origin spoof resistance    PASS (forged headers ignored)
WAF normal traffic                PASS
WAF malicious probes              PASS (3 of 4 blocked; traversal noted above)
bot controls                      PASS (no false challenges on API traffic)
Resend signed webhook             PASS (delivered state reached)
Resend forged webhook             PASS (403, no mutation)
Brevo unauthenticated webhook     PASS (403, no mutation)
health endpoints                  PASS
unproxied surfaces unaffected     PASS (carup.dev / staging.carup.dev / api.carup.dev all 200)
production Communications         INACTIVE (unchanged)
```

## Production proxy recommendation for `api.carup.dev`

**Recommendation: do not proxy production yet — but the remaining risk is now small and specific.**

What staging has already de-risked: the trust-proxy design works and is spoof-resistant; the
provider webhook exemption is narrow and functional; the WAF and rate limits behave; and the SBFM
trap that would have broken every API client has been found and neutralised *before* it could
touch production.

What is still unproven for production, and why it matters:

1. **`CARUP_EDGE_SHARED_SECRET` does not exist on the production backend.** Proxying
   `api.carup.dev` without it would immediately collapse production rate limiting onto Cloudflare
   edge IPs — the exact defect this phase exists to prevent. A production Transform Rule and a
   production env var are both prerequisites.
2. **Production runs a different deployment** (`release/production` branch, separate Supabase).
   Nothing in this run touched it, so its behaviour behind a proxy is genuinely untested.
3. **Production has real users.** A false WAF positive on a real customer journey is a materially
   different cost than on staging, and staging traffic is not representative enough to rule it out.
4. Prudent sequencing would be: set the production secret → create the production Transform Rule →
   proxy → observe in **WAF log-only mode** before enforcing.

Production proxying therefore remains owner-gated.
