# WAF & DDoS Configuration

- **Status:** Proposed (Milestone 6)
- **Owners:** Infrastructure & Release
- **Edge provider:** Cloudflare (see `DEPLOYMENT_ARCHITECTURE_ADR.md` §3.6)
- **Sample config:** [`infra/cloudflare-waf.sample.json`](../../infra/cloudflare-waf.sample.json)
- **Relates to:** app-level limiter in `backend/middleware/securityMiddleware.js`

> Cloudflare sits in front of **both** the Vercel SPA and the Fly.io API. It is
> the authoritative DNS + TLS termination point and the single place security
> policy lives. The in-app rate limiter remains as defence-in-depth, not the
> primary control.

---

## 1. Layered model

| Layer | Control | Where |
| ----- | ------- | ----- |
| L3/L4 | Volumetric DDoS auto-mitigation | Cloudflare (always on) |
| L7 | Managed DDoS + WAF managed rulesets (OWASP) | Cloudflare |
| L7 | Bot management / credential-stuffing | Cloudflare |
| L7 | Rate-based rules (global, API, auth, ingest) | Cloudflare |
| L7 | Custom rules (admin protection, probe blocking) | Cloudflare |
| App | Per-IP rate limiter, CSRF, security headers | `securityMiddleware.js` |

---

## 2. Managed WAF rules

Enable the **Cloudflare Managed Ruleset** (`managed_challenge`) and the **OWASP
Core Ruleset** (`block`, paranoia PL2, anomaly threshold 40). These cover SQLi,
XSS, RCE, path traversal, and common CVE signatures. Tune false positives by
adding scoped exceptions, never by lowering the global threshold.

## 3. Bot & credential-stuffing controls

- Bot management in **managed** mode: block *definitely automated*, challenge
  *likely automated*, allow *verified* bots (search engines).
- Auth endpoints (`/api/auth/login`, `/api/auth/register`,
  `/api/auth/reset-password`) get an aggressive rate-based rule: **10 req / 60s
  per IP+path, block for 600s**. This is the primary credential-stuffing defence;
  the app limiter (`rateLimiter({ isSensitive: true })`) is the backstop.
- API requests with an empty `User-Agent` are challenged.

## 4. Request body limits

- Multipart uploads (evidence) capped at **25 MB**. Evidence uploads use
  signed-URL flow to Supabase Storage; the cap limits abuse of the multipart path.
- JSON bodies on `/api/*` capped at **512 KB** — API payloads are small, so
  oversized bodies are suspicious.

## 5. Rate-based rules (summary)

| Rule | Scope | Limit | Action |
| ---- | ----- | ----- | ------ |
| `global-baseline` | all paths | 600 / 60s / IP | managed challenge |
| `api-rate` | `/api/*` | 120 / 60s / IP | block |
| `auth-credential-stuffing` | auth endpoints | 10 / 60s / IP+path | block 600s |
| `ocr-evidence-ingest` | `/api/(evidence\|ocr\|media)/*` POST/PUT | 30 / 60s / IP | managed challenge |

The `ocr-evidence-ingest` rule directly protects the **AI cost budget** — see
`OBSERVABILITY_AND_ALERTS.md` (AI cost alert).

## 6. Admin / API route protection

- Admin and governance routes (`/api/admin/*`, `/api/governance/*`,
  `/api/feature-governance/*`) are restricted to an **operator IP allowlist**
  (`$operator_allowlist`); all other sources are challenged. Populate the
  allowlist out of band — **do not commit real IPs**.
- Dangerous HTTP methods (`TRACE`, `TRACK`, `CONNECT`) are blocked.
- Dotfile/secret probes (`.env`, `.git`, `*.pem`, `*.key`) are blocked.

## 7. TLS

- Minimum TLS **1.2**, Always-Use-HTTPS, Automatic HTTPS Rewrites.
- HSTS: `max-age=31536000; includeSubDomains; preload` — consistent with the app
  header set in `securityMiddleware.js`.

## 8. Logging & alerting

- Logpush enabled for `http_requests` and `firewall_events` at 100% sampling to
  the observability sink.
- Alert on firewall-event spikes and sustained rate-limit blocks (owner + runbook
  link in `OBSERVABILITY_AND_ALERTS.md`).
- During an active incident, switch the zone to **Attack Mode**
  (`managed_challenge_all`) per `DISASTER_RECOVERY_RUNBOOK.md`.

## 9. Apply procedure

The sample is declarative. Apply via Terraform (`cloudflare_ruleset`,
`cloudflare_rate_limit`) or the Cloudflare API. Stage changes, verify against the
test matrix below, then promote.

### Test matrix (post-apply verification)

1. Normal browsing of the SPA and a logged-in API call succeed.
2. 15 rapid POSTs to `/api/auth/login` → blocked after ~10.
3. `curl -X TRACE` against the origin → blocked.
4. Request `/.env` → blocked.
5. API call with empty UA → challenged.
6. Admin route from a non-allowlisted IP → challenged.
7. `firewall_events` appear in the log sink within minutes.
