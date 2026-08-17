# CF1 post-cutover verification + CP1 preparation

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Date:** 2026-08-17

## CF1 — POST-CUTOVER: PASS

Owner changed authoritative nameservers from `ns1/ns2.vercel-dns.com` to
`athena.ns.cloudflare.com` / `tate.ns.cloudflare.com`. DNSSEC left disabled, nothing proxied, the
Vercel zone retained as rollback.

| # | Check | Result |
|---|---|---|
| 1 | Delegation to Cloudflare | **PASS** — identical on Google `8.8.8.8`, Cloudflare `1.1.1.1`, Quad9 `9.9.9.9`, OpenDNS `208.67.222.222`; SOA is `athena.ns.cloudflare.com` |
| 2 | Cloudflare zone ACTIVE | **PENDING** — delegation is live and serving; Cloudflare's own activation flag had not flipped yet. `activation_check` needs `Zone:Zone:Edit`, which this token lacks. Cosmetic only: the zone is answering authoritatively for every record. |
| 3 | All prepared records resolve | **PASS** — 22/22 identical across two independent resolvers |
| 4 | `carup.dev` HTTPS | **PASS** — 200, SSL valid |
| 5 | `api.carup.dev` HTTPS | **PASS** — 200, `/api/health` |
| 6 | `staging.carup.dev` HTTPS | **PASS** — 200 |
| 7 | `api-staging.carup.dev` HTTPS | **PASS** — 200, `/api/health` |
| 8 | Resend DKIM/SPF/MX/DMARC | **PASS** — all four resolve unchanged |
| 9 | Brevo DKIM/verification/DMARC/branded | **PASS** — all seven resolve unchanged |
| 10 | Resend signed lifecycle webhook | **PASS** — real send → `email.sent` + `email.delivered`, both `processed`, attempt `delivered`, provider `resend`, request id `b1f05794-09b1-49f2-a001-66bb51708aed` |
| 11 | Brevo authenticated webhook | **PASS** — unauthenticated request rejected 403, zero mutation |

Two details worth recording:

**The apex self-corrected.** Before cutover Cloudflare's scan had pinned `216.150.1.1` at the apex,
which was already stale. Post-cutover the apex resolves via CNAME flattening to the live Vercel
addresses `216.150.1.193` / `216.150.16.193` — the pinned-IP fix made during preparation is proven
in production.

**CAA merged rather than replaced.** Cloudflare adds its own universal-SSL issuers
(`comodoca.com`, `digicert.com`, `ssl.com`) alongside the three cloned records. All of
`letsencrypt.org`, `pki.goog` and `sectigo.com` remain permitted, so Vercel certificate renewal is
unaffected. This looked alarming at first glance and was verified rather than assumed.

All four surfaces are served from Vercel addresses (`216.150.x`), confirming **nothing is proxied**.

## CP1 — prepared, NOT activated

Nothing is orange-clouded, so every item below is currently inert. That is deliberate: the
configuration is staged so that enabling the proxy later is a single reversible step.

| Capability | Token | Status |
|---|---|---|
| DNS / proxy toggle | allowed | ready |
| WAF custom rules | allowed | **provider-webhook skip rules CREATED** |
| Pro rate limiting | allowed | **auth rate limiting CREATED** |
| Managed WAF deployment | allowed | ready to deploy |
| Super Bot Fight Mode | allowed | set (`definitely_automated` → managed challenge, verified bots allowed) |
| **Transform Rules** | **BLOCKED** | `request is not authorized` — **this gates safe proxying** |
| **Turnstile** | **BLOCKED** | account-scope `Authentication error` |

Order matters and was respected: the **provider-webhook skip rules were created before any bot or
WAF enforcement**. Without them the first Resend (Svix) or Brevo webhook would have been challenged
or blocked, silently breaking E3/E5 the moment protection went live.

### Why `api-staging.carup.dev` was NOT proxied

Proxying without a Transform Rule would have *weakened* security, not improved it.

Express has no `trust proxy` configured, so behind Cloudflare every request would arrive from an
edge address and `req.ip` would become that edge IP. The rate limiter keys on it, so all visitors
would collapse into a single bucket — one attacker could exhaust the shared forgot-password budget
for everyone — and auth action tokens would record a meaningless IP.

The naive remedy is worse: the Vercel origin stays publicly reachable after proxying, so trusting
`CF-Connecting-IP` outright would let anyone bypass Cloudflare, forge the header, and pick or
poison a rate-limit bucket.

The implemented fix (`backend/middleware/edgeClientIp.js`, committed and deployed) believes
`CF-Connecting-IP` **only** on a request carrying a shared secret that a Cloudflare Transform Rule
injects and a direct caller cannot know. Absent a valid secret it falls back to today's behaviour
and never to a caller-supplied header. `CARUP_EDGE_SHARED_SECRET` is already generated and stored
on `carup-backend-staging`; the Cloudflare half cannot be created with the current token.

So the sequence is: grant Transform Rule permission → create the injection rule → proxy
`api-staging` → verify → deploy Managed WAF → security regression. `api.carup.dev` stays
unproxied until staging certification passes, per the frozen plan.
