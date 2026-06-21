# WAF & DDoS Controls (Milestone 6, master plan §12.7)

Deployable Cloudflare configuration in front of the CarUp API/origin. Sample machine-readable
config: [`infra/cloudflare-waf.sample.json`](../../infra/cloudflare-waf.sample.json).

## Layers

1. **Managed WAF rulesets** — Cloudflare managed + OWASP core (block at medium sensitivity).
2. **DDoS** — Cloudflare automatic L3/4 + L7 mitigation set to *high*; origin shielding so the
   Fly origin only accepts Cloudflare IPs (reject direct-to-origin).
3. **Rate-based rules (edge)** — complement the app-level distributed limiter (`rateLimitStore.js`
   with `REDIS_URL`). Defence in depth: edge stops volumetric abuse; app enforces per-user/org quotas.
4. **Bot management** — challenge/block low-score unverified automated traffic; protect login from
   credential stuffing.
5. **Request body limit** — 12 MB at the edge (above the 10 MB evidence cap so legit uploads pass;
   blocks oversized payload abuse).
6. **Sensitive-route protection** — managed-challenge on `/api/admin/*` and `/api/governance/*`.
7. **TLS** — min 1.2, full(strict).
8. **Logging** — Logpush of WAF/rate-limit actions for review + alerting.

## Rate limits (starting points — tune on real traffic)

| Scope | Limit | Action |
|---|---|---|
| Global per-IP on `/api/*` | 600 / 60s | managed challenge |
| Auth (`/login`, `/switch-role`) | 10 / 60s | block |
| Evidence upload | 20 / 60s | block |
| Report generation | 30 / 300s | challenge |
| Ingestion trigger | 10 / 60s | block |
| Expensive search | 120 / 60s | challenge |

App-level limits (already shipped in M6 code) cover authenticated-user, org/source, upload, report,
and AI-analysis budgets via the pluggable store.

## Apply / rollback

- **Apply:** import the sample via Cloudflare API/Terraform after the zone exists. Stage in
  *log/challenge* before *block*; watch Logpush; then promote to block.
- **Rollback:** revert ruleset to log-only or disable the firewall rule set; origin remains
  protected by the app-level limiter.

## External blocker

Requires a Cloudflare account + zone + origin lock to Cloudflare IPs (accounts/billing/DNS). The
config is deployable but not applied here (no production change without approval — master plan §12.2).
