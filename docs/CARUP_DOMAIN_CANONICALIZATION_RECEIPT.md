# CarUp Domain Canonicalization — Receipt (D0–D9)

**Programme:** migrate CarUp off `*.vercel.app` canonical product identity onto `carup.dev`
**Branch / PR:** `feat/communications-email-transport` / PR #163 (shared with CarUp Email 1.0)
**Date:** 2026-08-16 → 2026-08-17

Vercel remains the hosting/deployment platform. What changed is CarUp's *canonical identity* —
the domains baked into source defaults, config, security allowlists, CI/UAT harnesses, docs, and
user-visible links. No Vercel alias was removed; every `.vercel.app` hostname still resolves and
still works.

## D1 — Canonical domain map (frozen)

| Role | Canonical domain | Vercel project | Legacy alias (still live) |
|---|---|---|---|
| Production web | `https://carup.dev` | `carup` | `carup.vercel.app` |
| Production API | `https://api.carup.dev` | `carup-backend` | `carup-backend.vercel.app` |
| Staging web | `https://staging.carup.dev` | `carup-staging` | `carup-staging.vercel.app` |
| Staging API | `https://api-staging.carup.dev` | `carup-backend-staging` | `carup-backend-staging.vercel.app` |
| Transactional email | `mail.carup.dev` | — (Resend) | — |
| Marketing email | `marketing.carup.dev` (reserved) | — (Brevo, not yet configured) | — |

`VERCEL_HOSTING=YES` · `VERCEL_PUBLIC_CANONICAL_URLS=NO`

`carup.dev` is registered and DNS-hosted directly under the Vercel team `11-11`
(`team_InL2Jmsg4dbG0rFY8nxriTha`). Nameservers are `ns1/ns2.vercel-dns.com` and were **not**
changed. Because the zone is Vercel-hosted with a wildcard ALIAS at the apex, attaching each
subdomain to its project auto-verified with no manual DNS record required.

> Tooling note: the `vercel domains` / `vercel dns` CLI subcommands return a false
> "you don't have access" error for this account. Use the REST API
> (`api.vercel.com/v9|v10/...?teamId=...`) or the dashboard instead. The team was formerly named
> `pay-pass-project`; that slug survives in historical deployment hostnames but no longer
> resolves as a `--scope`.

## D2 — Domains attached and verified

All four hostnames attached via `POST /v10/projects/{project}/domains`, auto-verified, SSL live,
content parity confirmed against the corresponding legacy alias. Production and staging names
were each attached to their correct project — no cross-wiring.

## D3/D4 — Source, config and security migration

Security-relevant changes are **additive**: canonical origins were added *alongside* the existing
`.vercel.app` entries so nothing that works today breaks. No origin check was loosened.

- `backend/config/corsOptions.js` — `productionOrigins` gains `https://carup.dev` and
  `https://staging.carup.dev`; legacy Vercel origins retained (removal deferred to post-D8).
- `backend/services/referral/referralEngineService.js` — **live production bug fixed**:
  `DEFAULT_PRODUCTION_PUBLIC_APP_URL` was `https://carup.app`, a domain that was never
  registered and does not resolve. With no `PUBLIC_APP_URL` override set on any project,
  production referral share links pointed at a dead host. Now `https://carup.dev`; staging
  default now `https://staging.carup.dev`. Trusted-host predicates also accept the canonical
  hosts.
- `web/src/lib/apiClient.ts` — the char-code-obfuscated `DEFAULT_PRODUCTION_API_BASE_URL`
  fallback now decodes to `https://api.carup.dev/api`. (The obfuscation is intentional and was
  preserved: it stops a drift-detection grep over a staging bundle from false-positiving on this
  deliberate production literal.)
- `web/src/lib/stage5CredentialGate.ts` — the fail-closed destructive-UAT target allowlist gains
  `api-staging.carup.dev`.
- CI/UAT harness defaults → canonical staging domains:
  `.github/workflows/diaspora-canonical-staging-uat.yml`, `playwright.staging.config.ts`,
  `tests/agents/staging-helpers.ts`, `tests/agents/staging-global-setup.ts`,
  `backend/scripts/staging-create-test-identities.mjs`.
- `.env.example` guidance, `docs/STAGING_ENVIRONMENT.md` (rewritten),
  `docs/features/NAVIGATION_INTELLIGENCE.md`, `docs/diaspora-frontend-discovery.md`.
- Vercel env: staging `VITE_API_URL` → `https://api-staging.carup.dev/api`; staging backend
  `COMMUNICATION_WEBHOOK_BASE_URL` and `CARUP_PUBLIC_API_URL` → `https://api-staging.carup.dev`
  (both were previously **empty** — a pre-existing gap).

## Share-origin security fix (in scope: canonical-domain enforcement)

`POST /api/communications/share` built outbound WhatsApp/Telegram share links from
`req.body.origin` with **no validation**, falling back to `process.env.CARUP_PUBLIC_WEB_URL` and
then the hardcoded dead domain `https://carup.co.zw`. A caller could therefore cause CarUp to
generate and message out a CarUp-branded share link pointing at any host.

Fixed via a new governed resolver, `backend/config/canonicalWebOrigin.js`, which **delegates to
the pre-existing** `resolveReferralPublicAppUrl` governance chain rather than introducing a
competing configuration system:

- caller-supplied origin is honoured **only** if it is already a canonical CarUp origin;
  anything else is ignored in favour of the governed canonical origin (never throws — sharing
  degrades rather than failing the user's action);
- exact-hostname matching, so lookalikes such as `carup.dev.evil.example.com` are rejected;
- HTTPS required (except localhost for development);
- a misconfigured `CARUP_PUBLIC_WEB_URL` cannot redirect links off the CarUp domain family.

Origin policy here is deliberately **stricter than CORS**. CORS answers "who may call our API?"
and must keep trusting the live `.vercel.app` aliases and preview deployments. This resolver
answers "what domain may we publish to a human?" — a share link is durable and forwardable, so
it must carry canonical CarUp identity and never a Vercel-branded alias.

Proven by `backend/tests/share-origin-canonical-enforcement.test.js` (source-level only; no
physical WhatsApp/Telegram send required): production canonical origin, staging canonical origin,
attacker origin ignored, and `*.vercel.app` never becoming an outbound share origin.

## D6 — Database

Exhaustive read-only sweep of ~180 URL/link/content/metadata-shaped columns across ~90 tables in
the staging Supabase project (`eoyenigwevnxwwhyhaer`) found exactly one hit set:
`referral_share_assets.payload`, 11 rows, all created by the synthetic UAT user
`u_uat_ref_admin_2026` between 2026-07-17 and 2026-07-22 (asset types `share_kit`,
`post_merge_alignment_share_kit`, `pr119_preview_share_kit`). These are historical Referral V1
certification fixtures, **preserved intentionally** — they are evidence, not live canonical links.

`DB_VERCEL_CANONICAL_REMNANTS=0`.

## D7 — Regression guard

`backend/tests/no-vercel-canonical-regression.test.js` pins the exact runtime defaults that were
fixed, so a future edit cannot silently reintroduce a `.vercel.app` canonical default. It rides
the `backend/tests/*.test.js` glob already enforced by `.github/workflows/ci.yml`.

It deliberately does **not** blanket-ban the string `vercel.app`: legitimate infrastructure
provenance, Vercel preview-URL trust patterns, and immutable certification receipts must keep
theirs. Banning the string outright would force those to be falsified.

> Pre-existing CI gap (noted, not fixed here): `web/` Vitest tests are not run by the general CI
> workflow — only by `diaspora-phases-3-7-validation.yml`. The frontend-side assertions in this
> programme are therefore additionally mirrored by the backend-side guard above, which does run.

## carup.co.zw — bounded status (NOT complete)

`carup.co.zw` is a **third dead domain** (like the former `carup.app`): it does not resolve.

**Web URLs — migrated now:**
- `backend/routes/communicationBaseRoutes.js` share-link fallback → replaced by the governed
  canonical resolver above. This was the only *live runtime* product URL depending on the domain.
- `web/src/pages/APIDocs.tsx` — 17 occurrences (`https://api.carup.co.zw/v1/...` code samples and
  a `report_url` sample) → `https://api.carup.dev` / `https://carup.dev`.
  ⚠ **Separate accuracy problem, not addressed here:** these samples also use paths that do not
  match the real partner API. The real endpoints are under `/api/partner/v1/vehicles/:vin/...`
  (see `backend/routes/partnerApiRoutes.js`), and documented endpoints such as `/v1/dealers`,
  `/v1/inspections` and `/v1/vehicles/valuations` do not exist. The domain is now correct; the
  documented API surface still needs product review.

**Email addresses — deliberately NOT changed.** Preserved until replacement aliases physically
exist and route. Currently in use across `backend/server.js` legal pages (Terms, Privacy, Data
Deletion) and `web/src/pages/*` + `web/src/components/layout/Footer.tsx`:

| Address | Where |
|---|---|
| `legal@carup.co.zw` | `backend/server.js` (footer, Terms, Privacy, Data Deletion), `web/src/pages/TermsOfService.tsx`, `web/src/pages/PrivacyPolicy.tsx` |
| `privacy@carup.co.zw` | `backend/server.js` (Privacy, Data Deletion) |
| `support@carup.co.zw` | `backend/server.js` (Terms), `web/src/pages/HelpCenter.tsx`, `web/src/pages/TermsOfService.tsx` |
| `info@carup.co.zw` | `web/src/components/layout/Footer.tsx`, `web/src/pages/Contact.tsx` |
| `dpo@carup.co.zw` | `web/src/pages/PrivacyPolicy.tsx` |
| `press@carup.co.zw`, `rudo.mutasa@`, `chipo.sibanda@` | `web/src/pages/PressKit.tsx` |
| `tendai@carup.co.zw` (form placeholder) | `web/src/pages/Careers.tsx` |
| `admin@carup.co.zw` (test fixture) | `tests/agents/16-vehicle-evidence-flow.spec.ts` |

### Required before the email switch (bounded migration note)

These `@carup.dev` aliases must **physically exist and be proven to deliver** before any of the
above addresses are changed. Switching first would break legally-required contact channels
(GDPR/data-deletion requests, Terms enquiries) — a worse failure than a dead-but-documented
address.

```text
legal@carup.dev        (Terms, legal enquiries)
privacy@carup.dev      (Privacy policy, data-deletion requests)  ← regulated, highest priority
dpo@carup.dev          (Data Protection Officer)
support@carup.dev      (Help Centre, Terms)
info@carup.dev         (Footer, Contact page)
press@carup.dev        (Press Kit)
```

Named individual addresses in `PressKit.tsx` additionally need a person-by-person decision, and
the `Careers.tsx` value is only a form placeholder (cosmetic).

Note `mail.carup.dev` is already delegated to Resend for *application* mail; these are **human
inbox aliases** on the root domain and are a separate concern — likely Cloudflare Email Routing
or equivalent, per the Email 1.0 directive's root-alias topology.

**Status: `carup.co.zw` email cleanup is NOT complete and must not be claimed as complete.**

## Deliberately untouched (with reasons)

- `docs/agent-8-omnichannel/PRODUCTION_ACTIVATION_LEDGER.md` — immutable historical evidence
  (specific deployment ID, timestamps, the Meta webhook URL as registered at activation).
  Rewriting it would falsify the record.
- `backend/scripts/staging-apply-events-cron.mjs` — writes the live Supabase Vault secret
  `CARUP_EVENTS_ENDPOINT_URL` consumed every minute by `pg_cron`/`pg_net`, still pointed at the
  stable `carup-backend-staging.vercel.app` alias. Live scheduled infrastructure state, not
  source config; the alias works. Migrating it is a reasonable follow-up but must be a
  deliberate, verified action (re-run, confirm the cron still fires).
- `backend/scripts/production-apply-publication-gate.mjs`,
  `backend/scripts/production-disable-misrouted-comms-cron.mjs` — the `.vercel.app` strings are
  *detection signatures* for a past misrouted-cron incident, matched against live state. Changing
  them would break the guard.
- `mobile/.env.local` — local-only, gitignored, not shipped.
- Twilio SMS status-callback URL construction — dormant; zero Twilio env vars are configured on
  any project.
- Cloudflare communications-edge worker `CARUP_API_BASE_URL` — no committed `wrangler.toml`, no
  Cloudflare credentials available; current deployed value unverifiable from here.
- WhatsApp/Meta webhook callback URL — registered in Meta's dashboard, not computed by our code.
  Unchanged; non-urgent because the registered alias still resolves. Changing it would require
  re-verification of an already-certified channel.
- Test files retaining `.vercel.app` cases by design — proving rejection, exercising preview-URL
  behaviour, or asserting genuine deployment provenance. All were *extended* with canonical
  coverage rather than rewritten.

## Verification

- Backend: 3263 passing. 12 pre-existing failures in `verification-*` and
  `provision-staging-qa-accounts` — all environmental (`password authentication failed for user
  "postgres"`, `Malformed Gemini vision API response`), reproduce independently of this work.
- Web: 818/818 passing across 91 files. Typecheck clean.
- Live: all four canonical domains return HTTP 200 with valid SSL and content matching their
  legacy alias.
